// src/hooks/useCatalogoCache.ts
import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, query, QueryConstraint } from 'firebase/firestore';
import { db } from '../config/firebase';

/* =============================================================================
   ESTRATEGIA DE CACHÉ DE CATÁLOGOS - 3 NIVELES

   L1 (Memoria):    Map global. Persiste mientras la pestaña esté abierta.
                    Acceso instantáneo. 0 lecturas a Firestore.

   L2 (localStorage con TTL):
                    Persiste entre recargas y entre pestañas del mismo navegador.
                    Cada entrada tiene timestamp. Si el TTL venció, se ignora.
                    0 lecturas a Firestore mientras esté vigente.

   L3 (Firestore):  Solo se consulta cuando L1 y L2 fallan o están expirados.
                    Al leer, se guarda en L1 y L2 para futuros accesos.

   Esto reduce drásticamente las lecturas. Un catálogo que cambia 1-2 veces
   al mes no necesita ser leído 50 veces al día.
============================================================================= */

// ✅ TTL por defecto: 6 horas. Configurable por catálogo según qué tan estables sean los datos.
const TTL_DEFECTO_MS = 6 * 60 * 60 * 1000;

// L1: Caché en memoria global compartida entre todos los componentes del app
const memCache = new Map<string, { data: any[]; ts: number }>();

// Listeners para que múltiples componentes que usan el mismo catálogo se actualicen juntos
const listeners = new Map<string, Set<(data: any[]) => void>>();

const notifyListeners = (key: string, data: any[]) => {
  const set = listeners.get(key);
  if (set) set.forEach(fn => fn(data));
};

// ✅ Helpers de localStorage con manejo seguro de errores (puede fallar en modo incógnito,
// cuando el storage está lleno, o si el JSON parseado está corrupto).
const lsGet = (key: string): { data: any[]; ts: number } | null => {
  try {
    const raw = localStorage.getItem(`cat_v1__${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data) || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
};

const lsSet = (key: string, data: any[]) => {
  try {
    localStorage.setItem(`cat_v1__${key}`, JSON.stringify({ data, ts: Date.now() }));
  } catch (e) {
    // Si localStorage está lleno o bloqueado, fallback silencioso a solo memoria
    console.warn(`[useCatalogoCache] No se pudo escribir en localStorage para "${key}":`, e);
  }
};

const lsDelete = (key: string) => {
  try { localStorage.removeItem(`cat_v1__${key}`); } catch {}
};

// ✅ Limpia toda la caché (útil al cerrar sesión o cuando se edita un catálogo)
export const limpiarCacheCatalogos = (key?: string) => {
  if (key) {
    memCache.delete(key);
    lsDelete(key);
    notifyListeners(key, []);
  } else {
    memCache.clear();
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('cat_v1__'))
        .forEach(k => localStorage.removeItem(k));
    } catch {}
    // ✅ El primer parámetro de forEach (el Set de listeners) no se usa aquí;
    // solo necesitamos la clave para notificar. El underscore le indica a TS/ESLint que es intencional.
    listeners.forEach((_set, k) => notifyListeners(k, []));
  }
};

/* =============================================================================
   CARGAR UN CATÁLOGO (con caché L1 + L2 + Firestore)
   - key:        nombre de la colección en Firestore
   - ttlMs:      tiempo de vida en milisegundos (defecto 6h)
   - constraints: filtros opcionales (where, etc.). Si los usas, key debe ser único.
   - forzar:     true para saltarse la caché y leer Firestore directo
============================================================================= */
export const cargarCatalogo = async <T = any>(
  key: string,
  opciones?: { ttlMs?: number; constraints?: QueryConstraint[]; forzar?: boolean }
): Promise<T[]> => {
  const ttl = opciones?.ttlMs ?? TTL_DEFECTO_MS;
  const constraints = opciones?.constraints || [];
  const forzar = opciones?.forzar === true;

  // ----- L1: Memoria -----
  if (!forzar) {
    const enMem = memCache.get(key);
    if (enMem && Date.now() - enMem.ts < ttl) {
      return enMem.data as T[];
    }
  }

  // ----- L2: localStorage con TTL -----
  if (!forzar) {
    const enLS = lsGet(key);
    if (enLS && Date.now() - enLS.ts < ttl) {
      // Subir a L1 para próximos accesos
      memCache.set(key, enLS);
      return enLS.data as T[];
    }
  }

  // ----- L3: Firestore -----
  console.log(`[useCatalogoCache] 📡 Leyendo "${key}" de Firestore...`);
  const ref = constraints.length > 0
    ? query(collection(db, key), ...constraints)
    : collection(db, key);
  const snap = await getDocs(ref);
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as T[];

  // Persistir en ambos niveles
  const entry = { data, ts: Date.now() };
  memCache.set(key, entry);
  lsSet(key, data);
  notifyListeners(key, data);

  return data;
};

/* =============================================================================
   HOOK PARA REACT
   Uso típico:
     const { data: empresas, cargando } = useCatalogoCache('empresas');
   o con TTL custom:
     const { data: tc } = useCatalogoCache('tipo_cambio', { ttlMs: 30 * 60 * 1000 }); // 30 min
============================================================================= */
export function useCatalogoCache<T = any>(
  key: string,
  opciones?: { ttlMs?: number; auto?: boolean }
) {
  const auto = opciones?.auto !== false;
  const [data, setData] = useState<T[]>(() => {
    // Inicialización síncrona: si está en L1 lo usamos inmediatamente (cero flash)
    const enMem = memCache.get(key);
    return (enMem?.data || []) as T[];
  });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const recargar = useCallback(async (forzar = false) => {
    setCargando(true);
    setError(null);
    try {
      const datos = await cargarCatalogo<T>(key, { ttlMs: opciones?.ttlMs, forzar });
      setData(datos);
    } catch (e: any) {
      console.error(`[useCatalogoCache] Error cargando "${key}":`, e);
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [key, opciones?.ttlMs]);

  useEffect(() => {
    if (!auto) return;

    // Suscribir a cambios desde otros componentes (si se invalida el catálogo)
    let set = listeners.get(key);
    if (!set) { set = new Set(); listeners.set(key, set); }
    const fn = (nuevos: any[]) => setData(nuevos as T[]);
    set.add(fn);

    // Carga inicial (puede salir cacheado y ser síncrono efectivo)
    recargar(false);

    return () => {
      const s = listeners.get(key);
      if (s) s.delete(fn);
    };
  }, [key, auto, recargar]);

  return { data, cargando, error, recargar };
}

/* =============================================================================
   CARGAR VARIOS CATÁLOGOS EN PARALELO
   Útil para la pantalla inicial del dashboard, evita N llamadas secuenciales.

   Uso:
     const todos = await cargarCatalogosBatch(['empresas', 'unidades', 'empleados']);
     // todos.empresas, todos.unidades, todos.empleados
============================================================================= */
export const cargarCatalogosBatch = async (
  keys: string[],
  opciones?: { ttlMs?: number; forzar?: boolean }
): Promise<Record<string, any[]>> => {
  const promesas = keys.map(k =>
    cargarCatalogo(k, opciones).then(data => [k, data] as const)
  );
  const resultados = await Promise.all(promesas);
  return Object.fromEntries(resultados);
};

/* =============================================================================
   TTLs RECOMENDADOS POR TIPO DE CATÁLOGO
   Exportados como constantes para que cada componente use el adecuado.
============================================================================= */
export const TTL = {
  // Datos casi inmutables: empleados, unidades, remolques (cambian muy poco)
  ESTATICO:    24 * 60 * 60 * 1000,  // 24 horas

  // Datos que cambian ocasionalmente: empresas, convenios, tarifas
  MEDIO:        6 * 60 * 60 * 1000,  // 6 horas

  // Datos dinámicos: tipo de cambio, status servicio
  CORTO:       30 * 60 * 1000,       // 30 minutos

  // Datos transaccionales: operaciones, horarios
  // (no usar caché o caché muy corta)
  TRANSACCIONAL: 60 * 1000,          // 1 minuto
};
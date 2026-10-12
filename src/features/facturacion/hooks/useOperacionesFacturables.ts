// src/features/facturacion/hooks/useOperacionesFacturables.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.1) — HOOK DE DATOS: operaciones de Facturación (antes copiado
// en FacturacionClientes y FacturacionProveedores, idéntico salvo el lado).
//   · con `consultasCanonicas` (Fase 7.3): solo las pendientes de facturar
//     (porFacturar*); las ya facturadas (completadas y falsos) se piden al abrir
//     "Facturadas" o "Todas". La ÚLTIMA petición manda y ninguna se cancela al
//     cambiar de vista ("Cargando…" siempre se apaga, sin descargas repetidas).
//   · sin la bandera: status facturables por páginas de 1,000 (tope 20,000) y,
//     si falta el índice, toda la colección filtrada aquí (camino de siempre).
// La lista la siguen modificando los tableros (guardados en vivo, facturar);
// por eso el hook entrega también `setOperaciones`.
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { collection, documentId, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import type { DocumentData, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useFlags } from '../../../shared/data/flags';
import { paginaOperaciones, paginaPorFacturar, todasLasPaginas } from '../../../shared/data/consultas';
import { sinPruebas } from '../../../utils/operacionPrueba';
import { LIMITE_OPS_TODAS } from '../selectores';

const PAG_OPS = 1000;

export type VistaOps = 'pendientes' | 'facturadas' | 'todas';

export interface OperacionesFacturables<T> {
  operaciones: T[];
  setOperaciones: Dispatch<SetStateAction<T[]>>;
  cargando: boolean;
  /** Se alcanzó el tope de descarga (el tablero lo avisa). */
  topeAlcanzado: boolean;
  /** Con la bandera: ya están las facturadas además de las pendientes. */
  facturadasCargadas: boolean;
  /** ✅ V00449: ya terminó al menos una descarga (bien o con error). Antes de eso una lista vacía
   *  no quiere decir "no hay operaciones": el tablero muestra la animación de espera. */
  descargaTerminada: boolean;
  /** Descarga (si la lista está vacía, o siempre con `forzar`). */
  descargar: (forzar?: boolean) => Promise<void>;
}

type Datos = Record<string, unknown>;
const masReciente = (a: Datos, b: Datos) => String(b.fechaServicio || b.createdAt || '').localeCompare(String(a.fechaServicio || a.createdAt || ''));

/**
 * @param lado 'cliente' | 'proveedor'
 * @param statusFacturables ids de status que se facturan (completados + "Falso" del catálogo); solo el camino viejo
 * @param vistaOps vista actual de la tabla (con la bandera, "Facturadas"/"Todas" piden las ya facturadas)
 */
export function useOperacionesFacturables<T extends Datos = Datos>(
  lado: 'cliente' | 'proveedor', statusFacturables: readonly string[], vistaOps: VistaOps,
): OperacionesFacturables<T> {
  const flags = useFlags();
  const [operaciones, setOperaciones] = useState<T[]>([]);
  const [cargando, setCargando] = useState(false);
  const [topeAlcanzado, setTopeAlcanzado] = useState(false);
  const [facturadasCargadas, setFacturadasCargadas] = useState(false);
  const [descargaTerminada, setDescargaTerminada] = useState(false); // ✅ V00449
  const peticionCanonRef = useRef({ id: 0, conFacturadas: false, enVuelo: false });
  // ✅ V00447: descarga vieja en curso. Sin esto, si el efecto del tablero corría otra vez
  //   antes de que terminara (cambio de pestaña, React en modo desarrollo), se bajaban las
  //   hasta 20,000 operaciones DOS veces en paralelo.
  const legadoEnVueloRef = useRef<Promise<void> | null>(null);
  const idLegadoRef = useRef(0); // la ÚLTIMA descarga vieja manda (un Refrescar no lo pisa otra anterior)

  const cargarCanonico = async (conFacturadas: boolean): Promise<void> => {
    const id = peticionCanonRef.current.id + 1;
    peticionCanonRef.current = { id, conFacturadas, enVuelo: true };
    setCargando(true);
    try {
      const [pend, fact] = await Promise.all([
        todasLasPaginas((c) => paginaPorFacturar(lado, null, PAG_OPS, c), LIMITE_OPS_TODAS),
        conFacturadas
          ? todasLasPaginas((c) => paginaOperaciones({ estados: ['completada', 'falso'] }, PAG_OPS, c), LIMITE_OPS_TODAS)
          : Promise.resolve(null),
      ]);
      if (peticionCanonRef.current.id !== id) return;
      const vistos = new Set<string>();
      const todas = sinPruebas([...pend.docs, ...(fact?.docs ?? [])]).filter((o) => {
        const k = String(o._docId);
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      });
      todas.sort(masReciente);
      setOperaciones(todas as unknown as T[]);
      setFacturadasCargadas(conFacturadas);
      setTopeAlcanzado(pend.truncado || !!fact?.truncado);
    } catch (e: unknown) {
      if (peticionCanonRef.current.id !== id) return;
      console.error('[Facturación] Error al cargar operaciones:', e);
      alert(`No se pudieron cargar las operaciones.\n\nDetalle: ${String((e as { message?: string })?.message || e)}`);
    } finally {
      if (peticionCanonRef.current.id === id) {
        peticionCanonRef.current = { ...peticionCanonRef.current, enVuelo: false };
        setCargando(false);
        setDescargaTerminada(true);
      }
    }
  };

  /** Camino viejo: páginas de 1,000 por status facturable; sin índice, toda la colección filtrada aquí. */
  const descargarLegado = async (): Promise<void> => {
    const id = ++idLegadoRef.current;
    setCargando(true);
    try {
      let todas: Datos[] = [];
      const paginar = async (filtros: QueryConstraint[], tomar: (d: QueryDocumentSnapshot<DocumentData>) => void) => {
        let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
        for (let i = 0; i < Math.ceil(LIMITE_OPS_TODAS / PAG_OPS); i++) {
          const cons: QueryConstraint[] = [...filtros, orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(PAG_OPS)];
          const snap = await getDocs(query(collection(db, 'operaciones'), ...cons));
          if (snap.empty) break;
          snap.docs.forEach(tomar);
          cursor = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < PAG_OPS) break;
        }
      };
      let usarFallback = false;
      try {
        await paginar([where('status', 'in', [...statusFacturables])], (d) => todas.push({ id: d.id, ...d.data() }));
      } catch (e1: unknown) {
        const msg1 = String((e1 as { message?: unknown })?.message || (e1 as { code?: unknown })?.code || e1 || '');
        if (msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition')) {
          console.warn('[Facturación] Falta índice (status+__name__). Fallback: traer todo y filtrar en memoria. Detalle:', msg1);
          usarFallback = true;
        } else {
          throw e1;
        }
      }
      if (usarFallback) {
        todas = [];
        await paginar([], (d) => {
          const o: Datos = { id: d.id, ...d.data() };
          if (statusFacturables.includes(String(o.status || '').trim())) todas.push(o);
        });
      }
      todas = sinPruebas(todas); // ✅ V00380: las operaciones de prueba no se facturan
      todas.sort(masReciente);
      if (id !== idLegadoRef.current) return; // llegó una descarga más nueva
      setOperaciones(todas as T[]);
      setTopeAlcanzado(todas.length >= LIMITE_OPS_TODAS);
    } catch (e: unknown) {
      if (id !== idLegadoRef.current) return;
      const msg = String((e as { message?: unknown })?.message || (e as { code?: unknown })?.code || e || '');
      console.error('[Facturación] Error al cargar operaciones completadas:', e);
      alert(`No se pudieron cargar las operaciones.\n\nDetalle: ${msg}`);
    }
    setCargando(false);
    setDescargaTerminada(true);
  };

  const descargar = async (forzar = false): Promise<void> => {
    if (!forzar && operaciones.length > 0) return;
    if (flags.consultasCanonicas) {
      if (!forzar && peticionCanonRef.current.enVuelo) return; // ya viene una en camino
      await cargarCanonico(facturadasCargadas || vistaOps !== 'pendientes');
      return;
    }
    if (!forzar && legadoEnVueloRef.current) return legadoEnVueloRef.current;
    const p = descargarLegado().finally(() => { if (legadoEnVueloRef.current === p) legadoEnVueloRef.current = null; });
    legadoEnVueloRef.current = p;
    await p;
  };

  // ✅ V00449: al pasar a "Facturadas"/"Todas" sin tenerlas, "cargando" se enciende en el MISMO
  //   render del cambio de vista. El efecto de abajo las pide un render después y, mientras, la
  //   tabla mostraba "No hay operaciones facturadas…". Misma condición que el efecto: él es quien
  //   pide los datos y quien apaga la bandera al terminar (no cambia qué se pide ni cuándo).
  const [vistaAnterior, setVistaAnterior] = useState(vistaOps);
  if (vistaAnterior !== vistaOps) {
    setVistaAnterior(vistaOps);
    if (flags.consultasCanonicas && vistaOps !== 'pendientes' && !facturadasCargadas) setCargando(true);
  }

  // Con la bandera, "Facturadas"/"Todas" piden las ya facturadas (una vez).
  const pedirFacturadas = useEffectEvent(() => {
    const p = peticionCanonRef.current;
    if (p.enVuelo && p.conFacturadas) return; // ya viene en camino
    void cargarCanonico(true);
  });
  useEffect(() => {
    if (!flags.consultasCanonicas || vistaOps === 'pendientes' || facturadasCargadas) return;
    pedirFacturadas();
  }, [flags.consultasCanonicas, vistaOps, facturadasCargadas]);

  return { operaciones, setOperaciones, cargando, topeAlcanzado, facturadasCargadas, descargaTerminada, descargar };
}

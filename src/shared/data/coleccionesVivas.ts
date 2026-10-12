// src/shared/data/coleccionesVivas.ts
// ---------------------------------------------------------------------------
// ✅ V00439 (Fase 3.4) — CONSULTAS EN VIVO COMPARTIDAS.
// Un solo onSnapshot por clave para toda la app, con conteo de quién lo usa:
//   · Dos vistas que piden la misma clave comparten el listener (y sus lecturas).
//   · Cuando nadie lo usa, sigue abierto MINUTOS_PERMANENCIA (navegar de ida y
//     vuelta no vuelve a leer) y luego se cierra.
//   · Respeta MantenerVivo: un módulo oculto suelta su demanda y conserva los
//     últimos datos.
//   · ✅ V00446 (rendimiento): los avisos a React se AGRUPAN en una ventana corta
//     (VENTANA_AVISO_MS): varios catálogos que llegan seguidos = un solo repintado
//     (useSyncExternalStore repinta de forma síncrona por cada aviso). La
//     confirmación del servidor sin cambios ya no repinta. Un módulo OCULTO no
//     recibe avisos (se pone al día al volver a verse). Las claves `permanente`
//     (catálogos) no se cierran por tiempo: solo al cerrar sesión.
// La clave identifica la consulta: misma clave = misma consulta (p. ej.
// `pagos:cliente`). Los catálogos (src/shared/data/catalogos.ts) usan esto con
// la colección completa como clave.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { onSnapshot } from 'firebase/firestore';
import type { Query } from 'firebase/firestore';
import { useModuloVivoActivo } from '../../utils/moduloVivoContexto';

/**
 * Documento tal como lo guardan los módulos: { id, ...datos }.
 * `_docId` (no enumerable) es el id REAL del documento: úsalo para escribir y para
 * guardar referencias; `id` puede ser un campo `id` guardado dentro del documento.
 */
export type DocVivo = { id: string; readonly _docId?: string } & Record<string, unknown>;

export interface EstadoVivo {
  datos: DocVivo[];
  /** Ya llegó al menos un snapshot (de la caché local o del servidor). */
  listo: boolean;
  /** Ya llegó un snapshot confirmado por el servidor. */
  delServidor: boolean;
  error: string | null;
}

/** Id REAL del documento de un DocVivo (para escribir y guardar referencias). */
export const idReal = (d: { id: string; _docId?: string }): string => d._docId ?? d.id;

export const ESTADO_VACIO: EstadoVivo = Object.freeze({ datos: [], listo: false, delServidor: false, error: null }) as EstadoVivo;
/** Minutos que un listener (no permanente) sigue abierto después de que ninguna vista lo usa. */
export const MINUTOS_PERMANENCIA = 15;
/** ✅ V00446: avisos a React agrupados en esta ventana (ms). */
export const VENTANA_AVISO_MS = 50;

interface Entrada {
  estado: EstadoVivo;
  demanda: number;
  crear: (() => Query) | null;
  cancelar: (() => void) | null;
  temporizador: ReturnType<typeof setTimeout> | null;
  oyentes: Set<() => void>;
  esperandoServidor: Set<() => void>;
  /** Esperando el PRIMER snapshot (de la caché local o del servidor). */
  esperandoDatos: Set<() => void>;
  /** Ya llegó un snapshot del servidor (fuera del estado publicado: no repinta). */
  confirmado: boolean;
  /** No se cierra por tiempo (catálogos): solo con reiniciarVivas. */
  permanente: boolean;
  /** ✅ V00448: el próximo snapshot es el primero de un listener (re)abierto: se publica siempre. */
  primerSnapshot: boolean;
}

const entradas = new Map<string, Entrada>();

export const entradaViva = (clave: string): Entrada => {
  let e = entradas.get(clave);
  if (!e) {
    e = {
      estado: ESTADO_VACIO, demanda: 0, crear: null, cancelar: null, temporizador: null, oyentes: new Set(),
      esperandoServidor: new Set(), esperandoDatos: new Set(), confirmado: false, permanente: false, primerSnapshot: false,
    };
    entradas.set(clave, e);
  }
  return e;
};

// Avisos agrupados: el estado se actualiza al instante (quien lo lea ve lo último);
// solo el aviso a React espera la ventana, y cada oyente se avisa una vez por ventana.
const avisosPendientes = new Set<() => void>();
let temporizadorAvisos: ReturnType<typeof setTimeout> | null = null;
const avisar = (oyentes: Set<() => void>): void => {
  oyentes.forEach((f) => avisosPendientes.add(f));
  if (temporizadorAvisos || avisosPendientes.size === 0) return;
  temporizadorAvisos = setTimeout(() => {
    temporizadorAvisos = null;
    const lista = Array.from(avisosPendientes);
    avisosPendientes.clear();
    lista.forEach((f) => f());
  }, VENTANA_AVISO_MS);
};

const resolverEspera = (conjunto: Set<() => void>): void => {
  const lista = Array.from(conjunto);
  conjunto.clear();
  lista.forEach((f) => f());
};

const publicar = (e: Entrada, estado: EstadoVivo): void => {
  e.estado = estado;
  avisar(e.oyentes);
  if (estado.listo) resolverEspera(e.esperandoDatos);
  if (e.confirmado || estado.error) resolverEspera(e.esperandoServidor);
};

/** Arma el documento como lo usaban los módulos y agrega el id REAL del documento. */
export const armarDoc = (id: string, datos: Record<string, unknown>): DocVivo => {
  // Misma forma que usaba cada módulo: { id: d.id, ...datos }. Si el documento
  // guarda su propio campo `id` (registros importados de AppSheet), ese campo
  // gana, igual que antes. El id REAL del documento va en `_docId`, NO enumerable:
  // no se copia con {...doc} ni se escribe de vuelta a Firestore por accidente.
  // Úsalo para escribir y para guardar referencias (doc(db, col, x._docId)).
  const doc = { id, ...datos } as DocVivo;
  Object.defineProperty(doc, '_docId', { value: id, enumerable: false });
  return doc;
};

const abrir = (clave: string, e: Entrada): void => {
  if (e.cancelar || !e.crear) return;
  // Al reabrir (tras un error o tras cerrarse por permanencia) el estado anterior
  // ya no está confirmado por el servidor.
  e.confirmado = false;
  e.primerSnapshot = true;
  if (e.estado.error || e.estado.delServidor) e.estado = { ...e.estado, delServidor: false, error: null };
  e.cancelar = onSnapshot(
    e.crear(),
    // includeMetadataChanges: cuando la caché local ya tenía los datos y el
    // servidor confirma SIN cambios, el SDK no avisa salvo con esta opción; sin
    // ella `delServidor` nunca llegaba y obtenerCatalogo esperaba los 6 s completos.
    { includeMetadataChanges: true },
    (snap) => {
      if (!snap.metadata.fromCache) e.confirmado = true;
      const delServidor = e.confirmado;
      const primero = e.primerSnapshot;
      e.primerSnapshot = false;
      // Cambio solo de metadatos (confirmación del servidor, escrituras pendientes):
      // no hay datos nuevos. ✅ V00446: no se repinta; solo se libera a quien espera
      // al servidor (obtenerCatalogo fresco). ✅ V00448: el primer snapshot de un listener
      // reabierto se publica siempre (si ahora viene vacío, no deben quedar las filas viejas).
      if (!primero && e.estado.listo && snap.docChanges().length === 0) {
        if (e.confirmado) resolverEspera(e.esperandoServidor);
        return;
      }
      const datos = snap.docs.map((d) => armarDoc(d.id, d.data() as Record<string, unknown>));
      // En desarrollo el arreglo se congela: lo comparten todas las vistas y
      // ordenarlo o modificarlo en sitio afectaría a las demás (copia antes: [...datos]).
      if (import.meta.env.DEV) Object.freeze(datos);
      publicar(e, { datos, listo: true, delServidor, error: null });
    },
    (err) => {
      console.error(`[en vivo] ${clave}:`, err);
      e.cancelar = null; // el listener murió: la próxima demanda lo reabre
      publicar(e, { ...e.estado, listo: true, delServidor: false, error: err.message || 'No se pudo leer' });
    },
  );
};

/** Suma demanda a una clave (abre el listener si hace falta). `permanente`: no se cierra por tiempo. */
export const pedirVivo = (clave: string, crear: () => Query, opciones: { permanente?: boolean } = {}): void => {
  const e = entradaViva(clave);
  e.crear = crear;
  if (opciones.permanente) e.permanente = true;
  e.demanda += 1;
  if (e.temporizador) { clearTimeout(e.temporizador); e.temporizador = null; }
  abrir(clave, e);
};

/** Resta demanda; sin demanda, el listener se cierra después de la permanencia. */
export const soltarVivo = (clave: string): void => {
  const e = entradaViva(clave);
  e.demanda = Math.max(0, e.demanda - 1);
  if (e.demanda > 0 || !e.cancelar || e.temporizador || e.permanente) return;
  e.temporizador = setTimeout(() => {
    e.temporizador = null;
    if (e.demanda === 0 && e.cancelar) {
      e.cancelar();
      e.cancelar = null;
      // Sin listener los datos pueden envejecer: el próximo obtenerVivo espera al servidor.
      e.confirmado = false;
      e.estado = { ...e.estado, delServidor: false };
    }
  }, MINUTOS_PERMANENCIA * 60 * 1000);
};

export const estadoVivo = (clave: string): EstadoVivo => entradas.get(clave)?.estado ?? ESTADO_VACIO;

/**
 * Datos de una clave para servicios fuera de React: abre (o reutiliza) el listener.
 * · Por omisión (✅ V00446) devuelve en cuanto HAY datos (caché local o servidor): con el
 *   listener ya abierto es inmediato. Antes siempre esperaba al servidor y una acción
 *   (abrir un formulario, un reporte) podía tardar hasta 6 s.
 * · `fresco: true` espera la confirmación del SERVIDOR (máx. `esperaMs`; sin red, lo que
 *   haya en la caché): para servicios que ESCRIBEN decidiendo con esos datos.
 * · ✅ V00448: RECHAZA si el listener falló o si pasó `esperaMs` sin NINGÚN dato (ni de la
 *   caché ni del servidor). Antes devolvía `[]`, y un servicio que escribe no distinguía
 *   "la colección está vacía" de "no llegó": la reparación de convenios creaba tarifarios
 *   vacíos y re-apuntaba los convenios a ellos.
 */
export const obtenerVivo = (
  clave: string, crear: () => Query, esperaMs = 6000, opciones: { fresco?: boolean; permanente?: boolean } = {},
): Promise<DocVivo[]> => {
  const e = entradaViva(clave);
  pedirVivo(clave, crear, { permanente: opciones.permanente });
  const conjunto = opciones.fresco ? e.esperandoServidor : e.esperandoDatos;
  const yaEsta = () => !!e.estado.error || (opciones.fresco ? e.confirmado : e.estado.listo);
  return new Promise<DocVivo[]>((resolver, rechazar) => {
    const terminar = () => {
      clearTimeout(t);
      soltarVivo(clave);
      if (e.estado.error) rechazar(new Error(`No se pudo leer ${clave}: ${e.estado.error}`));
      else if (!e.estado.listo) rechazar(new Error(`No se pudo leer ${clave}: sin respuesta en ${Math.round(esperaMs / 1000)} s.`));
      else resolver(e.estado.datos);
    };
    const t = setTimeout(() => { conjunto.delete(terminar); terminar(); }, esperaMs);
    if (yaEsta()) { terminar(); return; }
    conjunto.add(terminar);
  });
};

/** Cierra todos los listeners y borra los datos (al cerrar sesión). */
export const reiniciarVivas = (): void => {
  entradas.forEach((e) => {
    if (e.temporizador) clearTimeout(e.temporizador);
    e.cancelar?.();
    e.cancelar = null;
    e.temporizador = null;
    e.demanda = 0;
    e.confirmado = false;
    e.permanente = false;
    publicar(e, ESTADO_VACIO);
  });
};

/**
 * Hook: consulta en vivo compartida. `clave` null = no escuchar.
 * `crear` arma la consulta; solo se usa al abrir el listener (la clave manda).
 * Por defecto solo escucha mientras el módulo está a la vista (MantenerVivo).
 */
export function useColeccionViva(clave: string | null, crear: () => Query, opciones: { soloVisible?: boolean; activo?: boolean } = {}): EstadoVivo {
  const visible = useModuloVivoActivo();
  const activo = (opciones.activo ?? true) && (opciones.soloVisible === false || visible) && clave !== null;
  // `crear` puede ser una función nueva en cada render: la clave identifica la
  // consulta, así que se guarda la más reciente en una ref (no re-suscribe).
  const crearRef = useRef(crear);
  useEffect(() => { crearRef.current = crear; });
  // ✅ V00446: oculto (MantenerVivo) no recibe avisos: no se repinta en segundo plano;
  //   al volver a verse se vuelve a suscribir y React toma el estado más reciente.
  const avisos = opciones.soloVisible === false || visible;
  const suscribir = useCallback((aviso: () => void) => {
    if (clave === null) return () => {};
    const e = entradaViva(clave);
    if (avisos) e.oyentes.add(aviso);
    if (activo) pedirVivo(clave, () => crearRef.current());
    return () => {
      e.oyentes.delete(aviso);
      if (activo) soltarVivo(clave);
    };
  }, [clave, activo, avisos]);
  const leer = useCallback(() => (clave === null ? ESTADO_VACIO : estadoVivo(clave)), [clave]);
  return useSyncExternalStore(suscribir, leer, leer);
}

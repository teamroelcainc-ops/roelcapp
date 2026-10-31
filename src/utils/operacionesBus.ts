// src/utils/operacionesBus.ts
// ✅ V00126: BUS DE CAMBIOS DE OPERACIONES.
//   Cualquier módulo que escriba en la colección `operaciones` avisa aquí;
//   Facturación (clientes/proveedores) y Pagos escuchan y actualizan su vista
//   al instante, además de invalidar sus cachés de sesión para que la próxima
//   carga vuelva a leer de Firestore.
// ✅ V00536: TODA escritura en `operaciones` avisa (también las respuestas del servidor y las
//   herramientas por lotes), las listas encuentran la fila por `_docId` o por `id`, y el bus
//   invalida las cachés que de verdad dependen de `operaciones` (Completados y Cancelados).
import { limpiarCachesPorPrefijo } from './cacheMemoria';
import { esOperacionPrueba } from './operacionPrueba';

export const EVENTO_OPERACION_GUARDADA = 'roelca:operacion-guardada';

/**
 * Cachés (memoria y sesión) armadas con operaciones. Solo los PREFIJOS de datos: los filtros, columnas
 * y exportaciones guardados de Completados (`roelca_completadas_filtros_…`, `…_columnas_…`, `…_export_…`)
 * viven en localStorage y no se tocan.
 */
export const PREFIJOS_CACHE_DE_OPERACIONES = [
  'roelca_completadas_all_',   // Completados, descarga completa (camino viejo)
  'roelca_completadas_rango_', // Completados, por rango (camino viejo)
  'roelca_completadas_canon_', // Completados, consultasCanonicas
  'cancelados_',               // Cancelados (cancelados_ops_v1 y cancelados_canon_…)
] as const;

/** Campo del aviso que dice que la operación se eliminó (las listas la quitan). */
export const CAMPO_ELIMINADA = '_eliminada';

export interface OperacionGuardadaDetalle {
  id: string;
  data: Record<string, unknown>;
  origen?: string;
  /**
   * ✅ V00451: campos que CAMBIARON (si el que avisa lo sabe). `data` trae la operación completa
   * (para quien no la tiene en su lista), pero puede ser una copia vieja: quien ya la tiene aplica
   * solo estos campos y no pisa datos más nuevos.
   */
  campos?: readonly string[];
}

/** Lo que hay que aplicar a una operación que YA está en la lista: solo los campos que cambiaron, si se saben. */
export const datosAAplicar = ({ data, campos }: Pick<OperacionGuardadaDetalle, 'data' | 'campos'>): Record<string, unknown> =>
  campos ? Object.fromEntries(campos.filter((c) => c in data).map((c) => [c, data[c]])) : data;

export const notificarOperacionGuardada = (id: string, data: Record<string, unknown>, origen = 'operaciones', campos?: readonly string[]) => {
  PREFIJOS_CACHE_DE_OPERACIONES.forEach((p) => { try { limpiarCachesPorPrefijo(p); } catch { /* noop */ } });
  try {
    window.dispatchEvent(new CustomEvent<OperacionGuardadaDetalle>(EVENTO_OPERACION_GUARDADA, { detail: { id: String(id), data, origen, ...(campos ? { campos } : {}) } }));
  } catch { /* SSR / entorno sin window */ }
};

/** ✅ V00536: varias operaciones escritas juntas (un lote): un aviso por cada una con los campos que cambiaron. */
export const notificarOperacionesGuardadas = (cambios: Iterable<readonly [string, Record<string, unknown>]>, origen: string): void => {
  for (const [id, datos] of cambios) notificarCambiosOperacion(id, datos, origen);
};

/** ✅ V00536: una operación con solo lo que cambió (`cambios` son los campos escritos). */
export const notificarCambiosOperacion = (id: string, cambios: Record<string, unknown>, origen: string): void =>
  notificarOperacionGuardada(id, cambios, origen, Object.keys(cambios));

/** ✅ V00536: la operación se eliminó: las listas que la tienen la quitan. */
export const notificarOperacionEliminada = (id: string, origen: string): void =>
  notificarOperacionGuardada(id, { [CAMPO_ELIMINADA]: true }, origen, [CAMPO_ELIMINADA]);

export const suscribirOperacionGuardada = (cb: (d: OperacionGuardadaDetalle) => void): (() => void) => {
  // ✅ V00380: las operaciones de PRUEBA nunca llegan a Facturación/Pagos.
  const handler = (e: Event) => { const d = (e as CustomEvent<OperacionGuardadaDetalle>).detail; if (d && d.id && !esOperacionPrueba(d.data)) cb(d); };
  window.addEventListener(EVENTO_OPERACION_GUARDADA, handler);
  return () => window.removeEventListener(EVENTO_OPERACION_GUARDADA, handler);
};

// ── Aplicar un aviso a una lista ─────────────────────────────────────────
type Fila = { id?: unknown; _docId?: unknown };
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Ids con los que la operación del aviso puede estar en una lista: el del documento y el `id` guardado. */
export const idsDelAviso = ({ id, data }: Pick<OperacionGuardadaDetalle, 'id' | 'data'>): string[] =>
  Array.from(new Set([id, texto(data._docId), texto(data.id)].filter(Boolean)));

/** La fila es la operación (por su `_docId` o por su `id`, que en las importadas puede ser otro). */
export const esDeLosIds = (fila: Fila | null | undefined, ids: readonly string[]): boolean =>
  !!fila && ((texto(fila._docId) !== '' && ids.includes(texto(fila._docId))) || (texto(fila.id) !== '' && ids.includes(texto(fila.id))));

/** El aviso trae ese campo (si dice qué cambió, solo cuenta lo que cambió). */
export const avisoTraeCampo = ({ data, campos }: Pick<OperacionGuardadaDetalle, 'data' | 'campos'>, campo: string): boolean =>
  (campos ? campos.includes(campo) : campo in data);

/** Los datos sin `id` ni `_docId`: al aplicar un aviso, la fila conserva los suyos. */
export const sinIds = (datos: Record<string, unknown>): Record<string, unknown> => {
  const r = { ...datos };
  delete r.id;
  delete r._docId;
  return r;
};

export const avisoDeEliminada = (aviso: Pick<OperacionGuardadaDetalle, 'data'>): boolean => aviso.data[CAMPO_ELIMINADA] === true;

export interface ReglaLista {
  /** Campos con los que se decide si la operación va en la lista (p. ej. `status`). */
  campos: readonly string[];
  /** Con esos campos en el aviso: ¿la operación (ya con el cambio) va en la lista? */
  pertenece: (fila: Record<string, unknown>) => boolean;
  /** Una que no estaba y ahora pertenece: ¿entra? (sin esto, no entra). */
  agregar?: (fila: Record<string, unknown>) => boolean;
}

/**
 * ✅ V00536: aplica un aviso a una lista de operaciones, igual en todas las pantallas:
 * - Eliminada: sale.
 * - Si el aviso trae los campos de la `regla`, la regla decide si se queda, sale o entra.
 * - Si no los trae (p. ej. "Diferencia en cargos" no manda el status), la que estaba se actualiza y se
 *   queda, y la que no estaba no entra: un aviso incompleto ya no saca filas.
 * Al actualizar se aplican solo los campos que cambiaron (si se saben) y la fila conserva su `id`/`_docId`.
 */
export const aplicarAvisoEnLista = <T extends Fila>(prev: readonly T[], aviso: OperacionGuardadaDetalle, regla?: ReglaLista): T[] => {
  const ids = idsDelAviso(aviso);
  const idx = prev.findIndex((o) => esDeLosIds(o, ids));
  if (avisoDeEliminada(aviso)) return idx >= 0 ? prev.filter((_, k) => k !== idx) : (prev as T[]);
  const cambios = sinIds(datosAAplicar(aviso));
  const decide = !!regla && regla.campos.some((c) => avisoTraeCampo(aviso, c));
  if (idx >= 0) {
    const actual = { ...prev[idx], ...cambios } as T;
    if (decide && !regla.pertenece(actual as Record<string, unknown>)) return prev.filter((_, k) => k !== idx);
    const next = [...prev]; next[idx] = actual; return next;
  }
  // Solo entra con la operación completa: un aviso que trae únicamente lo que cambió no alcanza para una fila.
  const parcial = !!aviso.campos && Object.keys(aviso.data).every((k) => aviso.campos?.includes(k));
  if (!decide || !regla.agregar || parcial) return prev as T[];
  const nueva = { id: aviso.id, ...aviso.data, _docId: texto(aviso.data._docId) || aviso.id } as unknown as T;
  return regla.pertenece(nueva as Record<string, unknown>) && regla.agregar(nueva as Record<string, unknown>) ? [nueva, ...prev] : (prev as T[]);
};

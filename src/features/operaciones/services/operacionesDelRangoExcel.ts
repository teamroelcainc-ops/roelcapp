// src/features/operaciones/services/operacionesDelRangoExcel.ts
// ---------------------------------------------------------------------------
// ✅ V00498 — TODAS las operaciones de un rango de fechas de servicio, de CUALQUIER status, para el
// "Excel de operaciones". Misma consulta que la ruta rápida de Servicios Completados (V00310/V00421):
// `fechaServicio` (texto ISO de las nuevas) + `fechaServicioISO` (la normalizada), unidas, pero sin
// filtrar por status. Solo lee el rango.
// ✅ V00499: en páginas y SIN tope (antes una sola consulta con limit 25,000, que Firestore rechaza:
//   "Limit value in the structured query is over the maximum value of 10000").
// ---------------------------------------------------------------------------
import { todasLasOperacionesDelRango } from '../../../shared/data/consultas';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { sinPruebas } from '../../../utils/operacionPrueba';
import { normalizarFechaServicioISO } from '../components/completados/formatos';

export type OperacionExcel = Record<string, unknown> & { id: string; _fechaISO: string };

const consecutivo = (op: Record<string, unknown>): number => {
  const m = String(op.ref ?? '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
};

/** Puro: une, deja solo las del rango (con la fecha normalizada), sin pruebas, de la más reciente. */
export const unirOperacionesDelRango = (
  lotes: readonly (readonly { id: string; datos: Record<string, unknown> }[])[], desde: string, hasta: string,
): OperacionExcel[] => {
  const porId = new Map<string, OperacionExcel>();
  lotes.flat().forEach(({ id, datos }) => {
    if (porId.has(id)) return;
    const iso = String(datos.fechaServicioISO || '') || normalizarFechaServicioISO(datos.fechaServicio);
    if (!iso || iso < desde || iso > hasta) return;
    porId.set(id, { id, ...datos, _fechaISO: iso });
  });
  return sinPruebas(Array.from(porId.values())).sort((a, b) => {
    if (a._fechaISO !== b._fechaISO) return b._fechaISO.localeCompare(a._fechaISO);
    return consecutivo(b) - consecutivo(a);
  });
};

/**
 * Lee TODAS las operaciones del rango (las dos fechas, en páginas). `alAvanzar`: cuántas van, aprox.
 * (la mayor de las dos consultas: casi todas las operaciones salen en las dos, sumarlas contaría doble).
 */
export async function leerOperacionesDelRango(desde: string, hasta: string, alAvanzar?: (leidas: number) => void): Promise<OperacionExcel[]> {
  const leidos = { texto: 0, iso: 0 };
  const avisar = () => alAvanzar?.(Math.max(leidos.texto, leidos.iso));
  const [a, b] = await Promise.all([
    todasLasOperacionesDelRango('fechaServicio', desde, hasta, (n) => { leidos.texto = n; avisar(); }),
    todasLasOperacionesDelRango('fechaServicioISO', desde, hasta, (n) => { leidos.iso = n; avisar(); }),
  ]);
  const lote = (docs: (Record<string, unknown> & { id: string; _docId?: string })[]) => docs.map((d) => ({ id: idReal(d), datos: d }));
  return unirOperacionesDelRango([lote(a), lote(b)], desde, hasta);
}

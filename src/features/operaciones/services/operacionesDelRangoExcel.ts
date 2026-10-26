// src/features/operaciones/services/operacionesDelRangoExcel.ts
// ---------------------------------------------------------------------------
// ✅ V00498 — TODAS las operaciones de un rango de fechas de servicio, de CUALQUIER status, para el
// "Excel de operaciones". Misma consulta que la ruta rápida de Servicios Completados (V00310/V00421):
// `fechaServicio` (texto ISO de las nuevas) + `fechaServicioISO` (la normalizada), unidas, pero sin
// filtrar por status. Solo lee el rango; tope de seguridad que se avisa.
// ---------------------------------------------------------------------------
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { sinPruebas } from '../../../utils/operacionPrueba';
import { normalizarFechaServicioISO } from '../components/completados/formatos';

export type OperacionExcel = Record<string, unknown> & { id: string; _fechaISO: string };

/** Tope por consulta: un rango con más se avisa (acortarlo). */
export const TOPE_OPERACIONES_EXCEL = 25000;

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

export async function leerOperacionesDelRango(desde: string, hasta: string): Promise<{ operaciones: OperacionExcel[]; truncado: boolean }> {
  const col = collection(db, 'operaciones');
  const [a, b] = await Promise.all([
    getDocs(query(col, where('fechaServicio', '>=', desde), where('fechaServicio', '<=', hasta), limit(TOPE_OPERACIONES_EXCEL))),
    getDocs(query(col, where('fechaServicioISO', '>=', desde), where('fechaServicioISO', '<=', hasta), limit(TOPE_OPERACIONES_EXCEL))),
  ]);
  const lote = (s: typeof a) => s.docs.map((d) => ({ id: d.id, datos: d.data() as Record<string, unknown> }));
  return {
    operaciones: unirOperacionesDelRango([lote(a), lote(b)], desde, hasta),
    truncado: a.size >= TOPE_OPERACIONES_EXCEL || b.size >= TOPE_OPERACIONES_EXCEL,
  };
}

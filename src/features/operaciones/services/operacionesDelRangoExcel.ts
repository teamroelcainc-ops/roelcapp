// src/features/operaciones/services/operacionesDelRangoExcel.ts
// ---------------------------------------------------------------------------
// ✅ V00498 — TODAS las operaciones de un rango de fechas de servicio, de CUALQUIER status, para el
// "Excel de operaciones". Sin filtro de status; quita las de prueba.
// ✅ V00499: en páginas (Firestore no acepta limit > 10,000).
// ✅ V00500: COMPLETO sin importar cómo esté guardada la fecha. La consulta por rango de
//   `fechaServicio`/`fechaServicioISO` (V00499) solo veía las que tienen la fecha en texto
//   AAAA-MM-DD: en producción salieron 20 de enero a octubre. Las demás (AppSheet: d/m/aaaa,
//   Timestamp) no tienen `fechaServicioISO` hasta la migración P2. Por eso:
//     · con `consultasCanonicas` (se enciende DESPUÉS de la migración: todas tienen
//       `fechaServicioISO`) → solo el rango, en páginas;
//     · sin ella → se revisan TODAS las operaciones y se filtra con la fecha normalizada.
// ---------------------------------------------------------------------------
import { contarOperaciones, recorrerOperaciones, todasLasOperacionesDelRango } from '../../../shared/data/consultas';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { obtenerFlags } from '../../../shared/data/flags';
import { sinPruebas } from '../../../utils/operacionPrueba';
import { normalizarFechaServicioISO } from '../components/completados/formatos';

export type OperacionExcel = Record<string, unknown> & { id: string; _fechaISO: string };
type DocLeido = Record<string, unknown> & { id: string; _docId?: string };

/** Avance de la lectura: cuántas lleva, de cuántas (si se sabe) y cuántas van en el rango. */
export interface AvanceExcel { leidas: number; total: number | null; enRango: number | null }

const consecutivo = (op: Record<string, unknown>): number => {
  const m = String(op.ref ?? '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
};

/** Fecha de servicio AAAA-MM-DD de la operación: la canónica o la normalizada (ISO, d/m/aaaa, Timestamp). */
export const fechaOperacionExcel = (datos: Record<string, unknown>): string =>
  String(datos.fechaServicioISO || '') || normalizarFechaServicioISO(datos.fechaServicio);

/** Puro: une, deja solo las del rango (con la fecha normalizada), sin pruebas, de la más reciente. */
export const unirOperacionesDelRango = (
  lotes: readonly (readonly { id: string; datos: Record<string, unknown> }[])[], desde: string, hasta: string,
): OperacionExcel[] => {
  const porId = new Map<string, OperacionExcel>();
  lotes.flat().forEach(({ id, datos }) => {
    if (porId.has(id)) return;
    const iso = fechaOperacionExcel(datos);
    if (!iso || iso < desde || iso > hasta) return;
    porId.set(id, { id, ...datos, _fechaISO: iso });
  });
  return sinPruebas(Array.from(porId.values())).sort((a, b) => {
    if (a._fechaISO !== b._fechaISO) return b._fechaISO.localeCompare(a._fechaISO);
    return consecutivo(b) - consecutivo(a);
  });
};

const lote = (docs: readonly DocLeido[]) => docs.map((d) => ({ id: idReal(d), datos: d }));

/** Lee TODAS las operaciones del rango, de cualquier status (ver la cabecera). */
export async function leerOperacionesDelRango(desde: string, hasta: string, alAvanzar?: (a: AvanceExcel) => void): Promise<OperacionExcel[]> {
  if ((await obtenerFlags()).consultasCanonicas) {
    const docs = await todasLasOperacionesDelRango('fechaServicioISO', desde, hasta, (leidas) => alAvanzar?.({ leidas, total: null, enRango: null }));
    return unirOperacionesDelRango([lote(docs)], desde, hasta);
  }
  // Solo para el aviso de avance ("12,000 de 35,000"): 1 lectura por cada 1,000 operaciones.
  const total = await contarOperaciones().catch(() => null);
  const delRango: DocLeido[] = [];
  await recorrerOperaciones(
    (docs) => {
      docs.forEach((d) => {
        const iso = fechaOperacionExcel(d);
        if (iso && iso >= desde && iso <= hasta) delRango.push(d);
      });
    },
    (leidas) => alAvanzar?.({ leidas, total, enRango: delRango.length }),
  );
  return unirOperacionesDelRango([lote(delRango)], desde, hasta);
}

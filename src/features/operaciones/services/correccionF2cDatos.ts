// src/features/operaciones/services/correccionF2cDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00539 — "Solucionar" de F2c (factura distinta por centavos): "Actualizar factura" en lote
// (sincronizarFacturaConOperaciones, la misma de Editar factura): cada factura se relee con sus
// operaciones en UNA transacción y sus renglones toman lo que cobra hoy cada operación; el total sube o
// baja esa diferencia solo si la factura cuadraba con sus renglones (no se inventa un total). Las que
// ya estaban al día, o cuyo total no se puede mover solo, quedan para Solucionar (Editar factura).
// ---------------------------------------------------------------------------
import { registrarLog } from '../../../utils/logger';
import { sincronizarFacturaConOperaciones } from '../../facturacion/services/sincronizarFactura';
import type { ResultadoCorreccion } from './correccion';
import type { FilaRevision } from './revisionDatos';

export const filasPruebaF2c = (filas: readonly FilaRevision[]): Record<string, string>[] =>
  filas.map((f) => ({ 'Acción': 'Actualizar factura con sus operaciones', Invoice: f.ref, Cliente: f.cliente, Fecha: f.fecha, Status: f.status, 'Diferencia (hoy)': f.detalle }));

export const respaldoF2c = (filas: readonly FilaRevision[], cuando: string, quien: string) => ({
  tipo: 'F2c: factura al centavo con sus operaciones', cuando, quien,
  facturas: filas.map((f) => ({ id: f.idDoc ?? f.destino.id, invoice: f.ref, detalle: f.detalle })),
});

export const aplicarAlCentavoF2c = async (filas: readonly FilaRevision[], cuando: string, quien: string, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoCorreccion> => {
  const omitidas: ResultadoCorreccion['omitidas'] = [];
  const hechas: string[] = [];
  const ids = Array.from(new Map(filas.map((f) => [f.idDoc ?? f.destino.id, f] as const)).values());
  for (let i = 0; i < ids.length; i++) {
    const f = ids[i];
    try {
      const r = await sincronizarFacturaConOperaciones(f.idDoc ?? f.destino.id, cuando, quien);
      if (!r.plan) omitidas.push({ id: f.destino.id, ref: f.ref, motivo: 'Sus renglones ya estaban al día: la diferencia viene de la factura. Ábrela con Solucionar (Editar factura).' });
      else if (r.plan.modo === 'soloImportes') omitidas.push({ id: f.destino.id, ref: f.ref, motivo: 'Se guardó lo que cobra cada operación, pero el total no cuadraba antes y no se movió solo: ábrela con Solucionar (Editar factura).' });
      else hechas.push(`${f.ref} (${r.plan.totalAntes.toFixed(2)} → ${r.plan.totalDespues.toFixed(2)})`);
    } catch (e) {
      omitidas.push({ id: f.destino.id, ref: f.ref, motivo: e instanceof Error ? e.message : 'No se pudo poner al día (revisa la conexión).' });
    }
    alAvanzar(i + 1, ids.length);
  }
  if (hechas.length > 0) {
    await registrarLog('Facturación Clientes', 'Edición', `Revisión de datos (F2c): ${hechas.length} factura(s) al centavo con sus operaciones: ${hechas.join(', ')}.`).catch(() => {});
  }
  return { hechas: hechas.length, omitidas, error: '' };
};

// src/features/operaciones/services/correccionesD2F3.ts
// ---------------------------------------------------------------------------
// ✅ V00539 — Lo puro de "Solucionar" en D2 (referencia repetida) y F3 (Invoice que no existe):
// qué se escribe, cuándo ya no se escribe (cambió desde la prueba), y la prueba y el respaldo.
// Los planes los arma revisarDatos (revisionDatos.ts); la escritura está en correccionesD2F3Datos.ts.
// ---------------------------------------------------------------------------
import { refDeOperacion } from '../../../shared/dominio/dinero';
import { lista as listaIds, renglonesDeFactura } from '../../../shared/dominio/facturacion';
import { facturadaCliente, facturadaProveedor } from '../../../shared/dominio/operacionCanonica';
import type { PlanD2, PlanF3 } from './revisionDatos';

type Datos = Record<string, unknown>;
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

// ── D2 ──────────────────────────────────────────────────────────────────────
/** Consecutivo de una referencia LÍNEA-DDMMAA-NNN (0 si no tiene esa forma). */
export const consecutivoDeRef = (ref: unknown): number => {
  const m = /-(\d+)$/.exec(txt(ref));
  return m ? Number(m[1]) || 0 : 0;
};

/** La referencia nueva y los campos que la guardan (los mismos que muestra la app: numReferencia, referencia, ref). */
export const camposRenumerar = (op: Datos, p: Pick<PlanD2, 'prefijo' | 'ddmmyy'>, asignado: number, cuando: string): Datos => {
  const nueva = `${p.prefijo}-${p.ddmmyy}-${String(asignado).padStart(3, '0')}`;
  const campos: Datos = { ref: nueva, refPrefijo: `${p.prefijo}-${p.ddmmyy}`, refConsecutivo: asignado, refAnterior: refDeOperacion(op, ''), refRenumeradaPorRevision: cuando };
  (['numReferencia', 'referencia'] as const).forEach((c) => { if (txt(op[c])) campos[c] = nueva; });
  return campos;
};

/** Por qué ya no se renumera al aplicar ('' = se renumera). */
export const motivoAlRenumerar = (op: Datos | null, p: PlanD2): string => {
  if (!op) return 'La operación ya no existe.';
  if (refDeOperacion(op, p.opId).toUpperCase() !== p.ref.toUpperCase()) return 'Su referencia cambió desde la prueba.';
  if (facturadaCliente(op) || facturadaProveedor(op)) return 'Se facturó desde la prueba: revísala a mano.';
  return '';
};

export const filasPruebaD2 = (planes: readonly PlanD2[]): Record<string, string>[] => planes.map((p) => ({
  'Acción': p.motivo ? 'No se toca (a mano)' : 'Se renumera',
  Referencia: p.ref, Cliente: p.cliente, Fecha: p.fecha, 'Se queda con la referencia': p.seQueda,
  'Referencia nueva': p.motivo ? '' : `${p.prefijo}-${p.ddmmyy}-(siguiente consecutivo al aplicar)`, Motivo: p.motivo,
}));

export const respaldoD2 = (planes: readonly PlanD2[], cuando: string, quien: string) => ({
  tipo: 'D2: renumerar referencias repetidas', cuando, quien,
  operaciones: planes.filter((p) => !p.motivo).map((p) => ({ id: p.opId, ref: p.ref })),
});

// ── F3 ──────────────────────────────────────────────────────────────────────
export const camposLigarF3 = (p: Pick<PlanF3, 'facturaId' | 'folio'>, cuando: string): Datos =>
  ({ facturaClienteId: p.facturaId, facturaClienteInvoice: p.folio, facturado: true, invoiceCorregidoPorRevision: cuando });

export const camposLiberarF3 = (cuando: string): Datos =>
  ({ facturaClienteId: null, facturaClienteInvoice: '', facturado: false, invoiceCorregidoPorRevision: cuando });

/** ¿La factura lista la operación? (operacionesIds o sus renglones, por id del documento o `id` guardado). */
export const facturaListaOperacionF3 = (factura: Datos, opId: string, op: Datos): boolean => {
  const ids = new Set([opId, txt(op.id)].filter(Boolean));
  return listaIds(factura.operacionesIds).some((x) => ids.has(x)) || renglonesDeFactura(factura).some((r) => ids.has(txt(r.id)));
};

/** Por qué ya no se escribe al aplicar ('' = se escribe). */
export const motivoAlCorregirF3 = (op: Datos | null, factura: Datos | null, p: PlanF3): string => {
  if (!op) return 'La operación ya no existe.';
  if (txt(op.facturaClienteInvoice) !== p.invoice) return 'Su Invoice cambió desde la prueba.';
  if (p.accion === 'ligar' && (!factura || !facturaListaOperacionF3(factura, p.opId, op))) return 'La factura ya no la lista.';
  return '';
};

export const filasPruebaF3 = (planes: readonly PlanF3[]): Record<string, string>[] => planes.map((p) => ({
  'Acción': p.accion === 'ligar' ? `Se liga a la factura ${p.folio}` : p.accion === 'liberar' ? 'Se libera (vuelve a Por facturar)' : 'No se toca (a mano)',
  Referencia: p.ref, Cliente: p.cliente, 'Invoice que trae': p.invoice, 'Invoice nuevo': p.accion === 'ligar' ? p.folio : p.accion === 'liberar' ? '(ninguno)' : '', Motivo: p.motivo,
}));

export const respaldoF3 = (planes: readonly PlanF3[], cuando: string, quien: string) => ({
  tipo: 'F3: ligar o liberar el Invoice', cuando, quien,
  operaciones: planes.filter((p) => p.accion !== 'manual').map((p) => ({ id: p.opId, ref: p.ref, facturaClienteInvoice: p.invoice, facturaClienteId: p.facturaIdAntes, facturado: p.facturadoAntes })),
});

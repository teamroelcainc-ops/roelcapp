// src/features/empresas/services/monedaPagos.ts
// ---------------------------------------------------------------------------
// ✅ V00496 — Moneda de la empresa → pagos: un pago solo toma la moneda nueva si TODAS las facturas a
//   las que está aplicado quedan en esa moneda. Desde la V00495 una factura emitida no cambia de moneda
//   sola; si el pago sí cambiara quedaría, p. ej., una factura emitida en MXN con su pago en USD.
//   Un pago sin facturas aplicadas (o de MTTO) sigue la moneda de la empresa como antes.
// ---------------------------------------------------------------------------
import { valorCongelado } from '../../../shared/dominio/cascadaFacturas';
import { monedaDeFactura } from '../../../shared/dominio/dinero';
import type { Moneda } from '../../../shared/dominio/moneda';

type Datos = Record<string, unknown>;

/** Colección de las facturas de un pago por su tipo; null = MTTO (sus facturas están en otro lado). */
export const coleccionFacturasDePago = (tipo: unknown): 'facturas_clientes' | 'facturas_proveedores' | null => {
  const t = String(tipo ?? '').trim().toLowerCase();
  if (t === 'cliente') return 'facturas_clientes';
  if (t === 'proveedor') return 'facturas_proveedores';
  return null;
};

/** Ids de las facturas a las que está aplicado el pago. */
export const facturasDelPago = (pago: Datos): string[] =>
  Array.from(new Set((Array.isArray(pago.facturas) ? pago.facturas : [])
    .map((f) => String((f as Datos | null)?.facturaId ?? '').trim())
    .filter(Boolean)));

/** ¿La propagación escribe la moneda nueva en esta factura? Solo si es distinta y es un borrador (No Facturado). */
export const facturaTomaMoneda = (factura: Datos, distinta: boolean): boolean => distinta && !valorCongelado(factura.statusFactura);

/**
 * Moneda con la que queda una factura al propagar `canon`: la nueva si se le escribe; si no, la suya
 * tal como la leen la tabla, la ficha y Pagos (`monedaDeFactura`: primero monedaFacturacion /
 * monedaProveedor, que es lo que escribe Editar factura).
 */
export const monedaFinalDeFactura = (factura: Datos, canon: Moneda, seEscribe: boolean): Moneda | null =>
  seEscribe ? canon : monedaDeFactura(factura);

/**
 * ¿La factura no está del todo en `canon`? Como antes (monedaId y `moneda` con el código) y además la moneda
 * que se lee primero (`monedaDeFactura`: monedaFacturacion / monedaProveedor, lo que escribe Editar factura).
 */
export const facturaEnOtraMoneda = (factura: Datos, canon: Moneda, monedaId: string): boolean =>
  String(factura.monedaId ?? '') !== monedaId || String(factura.moneda ?? '') !== canon || monedaDeFactura(factura) !== canon;

/**
 * ¿El pago toma la moneda `canon`? Sí si no tiene facturas aplicadas (o es de MTTO), o si todas
 * quedan en `canon`. Una factura que no se encontró (undefined) cuenta como "no se sabe" → no se toca.
 */
export const pagoTomaMoneda = (pago: Datos, canon: Moneda, monedaFinal: (coleccion: string, id: string) => Moneda | null | undefined): boolean => {
  const col = coleccionFacturasDePago(pago.tipo);
  const ids = facturasDelPago(pago);
  if (!col || ids.length === 0) return true;
  return ids.every((id) => monedaFinal(col, id) === canon);
};

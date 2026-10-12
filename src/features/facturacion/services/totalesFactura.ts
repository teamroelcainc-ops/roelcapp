// src/features/facturacion/services/totalesFactura.ts
// ✅ Fase 1.8 (c, d) → ✅ V00441 (Fase 5.1): las reglas de los totales viven en
// src/shared/dominio/dinero.ts (las mismas en la web y en el servidor). Este
// archivo conserva los nombres que usan Facturación Clientes y Proveedores y
// los avisos de pantalla.
import { totalesTrasCambioDeOps as totalesTrasCambioDeOpsDominio } from '../../../shared/dominio/dinero';
import type { ResultadoTotales } from '../../../shared/dominio/dinero';

export {
  ajustarTotal, monedaDeFactura, montoPagadoDe, tienePagosAplicados, totalConversionDeOperaciones,
  totalNativoDeOperaciones, totalNativoFactura, totalNativoFacturaLegado,
} from '../../../shared/dominio/dinero';
export type { CamposTotalesFactura, ResultadoTotales } from '../../../shared/dominio/dinero';

/** Máximo de escrituras por writeBatch (Firestore permite 500; se deja margen). */
export const MAX_ESCRITURAS_LOTE = 450;

/** Campos de cada elemento de `operacionesGuardadas` que cuentan para el total. */
export interface ResumenOpFactura {
  monto?: unknown;        // conversión: total en la moneda de facturación de la operación
  subtotalBase?: unknown; // subtotal sin cargos, en la escala del convenio
  dol?: unknown;          // total en dólares
  pes?: unknown;          // total en pesos
}

/** Campos de una factura (cliente o proveedor) que intervienen en su total y su saldo. */
export interface FacturaTotales {
  id?: unknown;
  monedaFacturacion?: unknown; // Clientes
  monedaProveedor?: unknown;   // Proveedores
  moneda?: unknown;            // facturas importadas
  monedaId?: unknown;
  subtotalMonedaFactura?: unknown;
  subtotalFactura?: unknown;
  total?: unknown;
  montoFactura?: unknown;
  operacionesGuardadas?: unknown;
  montoPagado?: unknown;
  saldoPendiente?: unknown;
  statusPago?: unknown;
  totalManualCentavos?: unknown;
}

/** Totales tras cambiar las operaciones de una factura (avisa en consola si conserva un total). */
export const totalesTrasCambioDeOps = (facturaFresca: FacturaTotales, operacionesNuevas: unknown): ResultadoTotales =>
  totalesTrasCambioDeOpsDominio(facturaFresca, operacionesNuevas, (m) => console.warn(m));

/** Aviso al intentar borrar una factura con pagos (`monto` ya formateado). */
export const avisoFacturaConPagos = (monto: string): string =>
  `Esta factura tiene pagos aplicados por ${monto}. Revierte los pagos en Pagos antes de eliminarla.`;

/** Aviso cuando quitar operaciones dejaría la factura por debajo de lo pagado. */
export const avisoTotalBajoPagado = (total: string, pagado: string): string =>
  `No se puede quitar: el nuevo total (${total}) quedaría por debajo de lo ya pagado (${pagado}).\n\nElimina primero el pago aplicado en el módulo de Pagos y vuelve a intentar.`;

/** Aviso cuando un guardado necesitaría más escrituras de las que caben en un lote. */
export const avisoLoteGrande = (
  escrituras: number,
  consejo = 'Divide la selección en partes más pequeñas y vuelve a intentar.',
): string =>
  `Este cambio necesita ${escrituras} escrituras y el máximo por lote es ${MAX_ESCRITURAS_LOTE}.\n\n${consejo}`;

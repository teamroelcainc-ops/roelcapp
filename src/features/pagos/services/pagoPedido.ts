// src/features/pagos/services/pagoPedido.ts
// ✅ V00483 — abrir un pago de Pagos desde otro módulo (la ficha de una factura en Facturación).
// ✅ V00502: va por el pedido de apertura compartido (shared/data/aperturas.ts), el mismo del buscador
//   global (que sí puede pedir un pago con Pagos ya abierto). Antes Pagos lo leía solo al montarse.
import { abrirRegistro } from '../../../shared/data/aperturas';
import type { TipoPago } from './facturasPagables';

export interface PagoPedido {
  /** Id del documento en `pagos`. */
  id: string;
  tipo: TipoPago;
}

/** Pide abrir el pago y lleva al módulo Pagos. */
export const abrirPagoEnPagos = (p: PagoPedido): void => abrirRegistro('pagos', p.id, p.tipo);

/** El tipo de pago de un pedido (o null si no es uno de Pagos). */
export const tipoPagoDe = (tipo: unknown): TipoPago | null => (tipo === 'cliente' || tipo === 'proveedor' || tipo === 'mtto' ? tipo : null);

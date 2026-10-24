// src/features/pagos/services/pagoPedido.ts
// ✅ V00483 — abrir un pago de Pagos desde otro módulo (la ficha de una factura en Facturación).
// Pagos no se queda montado (no usa MantenerVivo): al entrar lee el pedido y abre ese pago en
// cuanto llega su lista. El pedido vive en memoria; si nadie lo atiende, se olvida al recargar.
export interface PagoPedido {
  /** Id del documento en `pagos`. */
  id: string;
  tipo: 'cliente' | 'proveedor';
}

let pedido: PagoPedido | null = null;

/** Pide abrir el pago y lleva al módulo Pagos. */
export const abrirPagoEnPagos = (p: PagoPedido): void => {
  pedido = p;
  window.dispatchEvent(new CustomEvent('roelca:navegar', { detail: { modulo: 'pagos' } }));
};

/** El pago pedido (sin borrarlo: React puede llamar dos veces al inicializar). */
export const pagoPedido = (): PagoPedido | null => pedido;

/** Pagos ya atendió el pedido. */
export const olvidarPagoPedido = (): void => { pedido = null; };

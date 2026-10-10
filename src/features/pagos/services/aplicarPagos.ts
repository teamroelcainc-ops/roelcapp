// src/features/pagos/services/aplicarPagos.ts
// ---------------------------------------------------------------------------
// ✅ Fase 1.8a → ✅ V00441 (Fase 5.1): la lógica pura de abonos y reversiones
//   vive en src/shared/dominio/dinero.ts. Pagos la usa DENTRO de runTransaction
//   con la regla de total "legado" (la misma que el trigger del servidor) hasta
//   que se apruebe la reconciliación (P3) y se encienda `dineroPorServidor`.
// ---------------------------------------------------------------------------
import { ErrorDinero } from '../../../shared/dominio/dinero';

export {
  ErrorDinero as ErrorPago, TOLERANCIA_SALDO, aplicadoPorFactura, calcularAbono, calcularReversion, estadoFactura,
  statusPagoDe, totalNativoFacturaLegado as totalNativoFactura,
} from '../../../shared/dominio/dinero';
export type { CambiosPagoFactura, StatusPago } from '../../../shared/dominio/dinero';

/** Firestore admite 500 escrituras por transacción; se deja margen para el doc del pago. */
export const MAX_FACTURAS_POR_PAGO = 400;

/** Lanza ErrorPago si un pago tocaría más facturas de las que caben en una transacción. */
export function validarLimiteFacturas(cuantas: number): void {
  if (cuantas > MAX_FACTURAS_POR_PAGO) {
    throw new ErrorDinero(
      `Este pago afecta ${cuantas} facturas y en una sola operación se pueden procesar como máximo ${MAX_FACTURAS_POR_PAGO}. No se guardó nada.`,
    );
  }
}

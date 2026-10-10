// src/features/pagos/services/aplicarPagos.ts
// ---------------------------------------------------------------------------
// ✅ Fase 1.8a — Lógica PURA para aplicar y revertir pagos sobre facturas.
//   PagosDashboard la usa DENTRO de runTransaction: le pasa el documento de la
//   factura recién leído con tx.get() y escribe lo que estas funciones
//   devuelven. Sin Firebase ni React y sin efectos: Firestore puede reintentar
//   la transacción y el resultado es el mismo.
// ---------------------------------------------------------------------------
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { aCentavos, deCentavos, r2 } from '../../../shared/dominio/numeros';
import { normalizarTexto } from '../../../shared/dominio/texto';

/** Margen al comparar lo aplicado contra el saldo fresco (un centavo de redondeo). */
export const TOLERANCIA_SALDO = 0.01;
/** Debajo de esto un saldo o un pagado cuenta como cero (mismo umbral que la UI). */
const CERO = 0.009;
/** Firestore admite 500 escrituras por transacción; se deja margen para el doc del pago. */
export const MAX_FACTURAS_POR_PAGO = 400;

export type StatusPago = 'PAGADA' | 'PARCIAL' | '';

/** Campos de la factura que cambian al aplicar o revertir un pago. */
export interface CambiosPagoFactura {
  montoPagado: number;
  saldoPendiente: number;
  statusPago: StatusPago;
}

/** Error de validación de un pago: su `message` se muestra tal cual al usuario. */
export class ErrorPago extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorPago';
  }
}

// Documento de factura (facturas_clientes / facturas_proveedores) sin tipo
// canónico todavía: se lee campo por campo y se reduce cada valor.
type DocFactura = Record<string, unknown>;

const comoDoc = (v: unknown): DocFactura => (v !== null && typeof v === 'object' ? (v as DocFactura) : {});

const montoTexto = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * TOTAL NATIVO de la factura: el total a cobrar/pagar en la MONEDA de la
 * factura (USD → dólares, MXN → pesos), NO la conversión.
 *   1) subtotalMonedaFactura (las facturas nuevas lo guardan directo);
 *   2) suma de operacionesGuardadas según la moneda (dol / monto / pes / subtotalBase);
 *   3) respaldo: subtotalFactura (conversión), total o montoFactura.
 * Es la MISMA función con la que Pagos pinta el saldo y con la que la
 * transacción lo valida. El reconocimiento de la moneda es a propósito el
 * mismo que el espejo del servidor (totalNativoFacturaRel en
 * functions/src/relacional.ts) y no el más amplio de `monedaCanonica`: si
 * cliente y servidor difieren, el trigger reescribe el saldo con otro total.
 */
export function totalNativoFactura(factura: unknown): number {
  const fac = comoDoc(factura);
  const monTxt = normalizarTexto(fac.monedaFacturacion || fac.monedaProveedor || fac.moneda || fac.monedaId);
  const esUSD = monTxt === ID_USD.toLowerCase() || monTxt === 'usd' || monTxt === 'us$' || monTxt === 'dls' || monTxt.startsWith('dolar');
  const esMXN = monTxt === ID_MXN.toLowerCase() || monTxt === 'mxn' || monTxt === 'mn' || monTxt.startsWith('peso');
  const directo = Number(fac.subtotalMonedaFactura);
  if (!isNaN(directo) && directo > 0) return directo;
  const ops: unknown[] = Array.isArray(fac.operacionesGuardadas) ? fac.operacionesGuardadas : [];
  const suma = (campo: string): number => ops.reduce<number>((s, o) => s + (Number(comoDoc(o)[campo]) || 0), 0);
  if (ops.length > 0) {
    if (esUSD) {
      // Factura en DÓLARES: el monto por operación en dólares; si la factura
      // es vieja y no lo trae, subtotalBase (subtotal en la escala USD).
      const dol = suma('dol');
      if (dol > 0) return dol;
      const base = suma('subtotalBase');
      if (base > 0) return base;
    } else if (esMXN) {
      // Factura en PESOS: la CONVERSIÓN es el total en pesos (cubre convenios
      // en dólares: dólares × TC, y convenios en pesos: pesos directos).
      const conv = suma('monto');
      if (conv > 0) return conv;
      const pes = suma('pes');
      if (pes > 0) return pes;
      const base = suma('subtotalBase');
      if (base > 0) return base;
    } else {
      const base = suma('subtotalBase');
      if (base > 0) return base;
    }
  }
  return Number(fac.subtotalFactura) || Number(fac.total) || Number(fac.montoFactura) || 0;
}

/** Total nativo, acumulado pagado y saldo de la factura, a 2 decimales. */
export function estadoFactura(factura: unknown): { total: number; montoPagado: number; saldo: number } {
  const total = r2(totalNativoFactura(factura));
  const montoPagado = r2(comoDoc(factura).montoPagado);
  return { total, montoPagado, saldo: r2(Math.max(0, total - montoPagado)) };
}

/** statusPago con la misma regla que el servidor (relacional.ts): sin saldo → PAGADA; con pagos → PARCIAL; sin pagos → '' (pendiente). */
export const statusPagoDe = (montoPagado: number, saldo: number): StatusPago =>
  saldo <= CERO ? 'PAGADA' : (montoPagado > CERO ? 'PARCIAL' : '');

/**
 * Aplica `aplicado` sobre el estado ACTUAL de la factura. Si el monto supera
 * su saldo fresco por más de TOLERANCIA_SALDO lanza ErrorPago (no se acota en
 * silencio: el usuario decide de nuevo con los datos al día).
 */
export function calcularAbono(factura: unknown, aplicado: number, etiqueta: string): {
  total: number;
  saldoAnterior: number;
  aplicado: number;
  saldoNuevo: number;
  cambios: CambiosPagoFactura;
} {
  const { total, montoPagado, saldo } = estadoFactura(factura);
  const monto = r2(aplicado);
  if (monto > saldo + TOLERANCIA_SALDO) {
    throw new ErrorPago(
      `La factura ${etiqueta} ya no tiene saldo suficiente: su saldo actual es ${montoTexto(saldo)} y se intentó aplicar ${montoTexto(monto)}.\n\n`
      + 'Es posible que otro usuario haya registrado un pago sobre ella. Recarga las facturas y vuelve a intentarlo. No se guardó nada.',
    );
  }
  const pagadoNuevo = r2(montoPagado + monto);
  const saldoNuevo = r2(Math.max(0, total - pagadoNuevo));
  return {
    total,
    saldoAnterior: saldo,
    aplicado: monto,
    saldoNuevo,
    cambios: { montoPagado: pagadoNuevo, saldoPendiente: saldoNuevo, statusPago: statusPagoDe(pagadoNuevo, saldoNuevo) },
  };
}

/** Revierte `aplicado` sobre el estado ACTUAL de la factura (el pagado nunca queda negativo). */
export function calcularReversion(factura: unknown, aplicado: number): CambiosPagoFactura {
  const { total, montoPagado } = estadoFactura(factura);
  const pagadoNuevo = r2(Math.max(0, montoPagado - r2(aplicado)));
  const saldoNuevo = r2(Math.max(0, total - pagadoNuevo));
  return { montoPagado: pagadoNuevo, saldoPendiente: saldoNuevo, statusPago: statusPagoDe(pagadoNuevo, saldoNuevo) };
}

/**
 * Lo aplicado por factura a partir de un arreglo `facturas[]` de un pago
 * ({ facturaId, aplicado }). Suma en centavos si una factura aparece dos
 * veces y descarta montos ≤ 0. Acepta datos crudos de Firestore.
 */
export function aplicadoPorFactura(facturas: unknown): Map<string, number> {
  const centavos = new Map<string, number>();
  for (const item of Array.isArray(facturas) ? facturas : []) {
    const f = comoDoc(item);
    const id = String(f.facturaId ?? '').trim();
    const c = aCentavos(f.aplicado);
    if (!id || c <= 0) continue;
    centavos.set(id, (centavos.get(id) ?? 0) + c);
  }
  return new Map(Array.from(centavos, ([id, c]) => [id, deCentavos(c)]));
}

/** Lanza ErrorPago si un pago tocaría más facturas de las que caben en una transacción. */
export function validarLimiteFacturas(cuantas: number): void {
  if (cuantas > MAX_FACTURAS_POR_PAGO) {
    throw new ErrorPago(
      `Este pago afecta ${cuantas} facturas y en una sola operación se pueden procesar como máximo ${MAX_FACTURAS_POR_PAGO}. No se guardó nada.`,
    );
  }
}

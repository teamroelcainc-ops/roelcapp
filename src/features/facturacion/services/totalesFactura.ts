// src/features/facturacion/services/totalesFactura.ts
// ✅ Fase 1.8 (c, d): reglas PURAS de los totales de una factura, iguales para
// Facturación Clientes y Proveedores (sin Firebase ni React).
//  · totalNativoFactura: el total a cobrar/pagar en la MONEDA de la factura.
//    Antes estaba copiado igual en los dos dashboards.
//  · totalesTrasCambioDeOps: lo que se escribe JUNTO con operacionesGuardadas
//    cada vez que cambia el conjunto de operaciones. Antes subtotalMonedaFactura
//    se quedaba con el total viejo y Pagos cobraba ese total.
//  · tienePagosAplicados: una factura con pagos no se borra (dejaba entradas
//    huérfanas en pagos.facturas[]).
import { monedaCanonica } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { aNumero, r2, sumarMontos } from '../../../shared/dominio/numeros';

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
}

const esObjeto = (v: unknown): v is ResumenOpFactura => typeof v === 'object' && v !== null;
const opsDe = (v: unknown): ResumenOpFactura[] => (Array.isArray(v) ? v.filter(esObjeto) : []);
const trae = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/** Moneda de la factura: el primer campo de moneda que se reconozca como USD o MXN. */
export const monedaDeFactura = (fac: FacturaTotales | null | undefined): Moneda | null =>
  [fac?.monedaFacturacion, fac?.monedaProveedor, fac?.moneda, fac?.monedaId]
    .map(monedaCanonica)
    .find((m): m is Moneda => m !== null) ?? null;

/**
 * Total en la moneda de la factura calculado SOLO con sus operaciones (no mira
 * subtotalMonedaFactura). 0 si no hay de dónde calcularlo.
 *  · USD → `dol` de cada operación (las guardadas sin `dol` usan `subtotalBase`).
 *  · MXN → la conversión (`monto`); si no hay, `pes`; luego `subtotalBase`.
 *  · Moneda desconocida → `subtotalBase`.
 */
export const totalNativoDeOperaciones = (moneda: unknown, operaciones: unknown): number => {
  const ops = opsDe(operaciones);
  if (ops.length === 0) return 0;
  const suma = (valor: (o: ResumenOpFactura) => unknown): number => sumarMontos(ops.map(valor));
  const mon = monedaCanonica(moneda);
  const candidatos =
    mon === 'USD' ? [suma((o) => (trae(o.dol) ? o.dol : o.subtotalBase)), suma((o) => o.subtotalBase)]
    : mon === 'MXN' ? [suma((o) => o.monto), suma((o) => o.pes), suma((o) => o.subtotalBase)]
    : [suma((o) => o.subtotalBase)];
  return candidatos.find((n) => n > 0) ?? 0;
};

/**
 * Total a cobrar/pagar en la MONEDA de la factura (no la conversión):
 *  1) subtotalMonedaFactura guardado;
 *  2) el de sus operaciones (totalNativoDeOperaciones);
 *  3) respaldo: subtotalFactura / total / montoFactura (facturas sin detalle).
 */
export const totalNativoFactura = (fac: FacturaTotales | null | undefined): number => {
  const directo = aNumero(fac?.subtotalMonedaFactura);
  if (directo > 0) return directo;
  const deOps = totalNativoDeOperaciones(monedaDeFactura(fac), fac?.operacionesGuardadas);
  if (deOps > 0) return deOps;
  return aNumero(fac?.subtotalFactura) || aNumero(fac?.total) || aNumero(fac?.montoFactura);
};

/** Suma de la conversión (`monto`) de las operaciones. */
export const totalConversionDeOperaciones = (operaciones: unknown): number =>
  sumarMontos(opsDe(operaciones).map((o) => o.monto));

/**
 * Nuevo total cuando cambian las operaciones de una factura.
 *  · Si las filas de ANTES reproducían el total guardado (±0.01), el nuevo total
 *    es la suma de las filas de DESPUÉS.
 *  · Si no (total capturado a mano en Pagos, o filas de relleno en 0 de facturas
 *    importadas), solo se aplica la diferencia: total + (después − antes).
 * A 2 decimales y nunca negativo.
 */
export const ajustarTotal = (totalAntes: number, filasAntes: number, filasDespues: number): number => {
  const nuevo = Math.abs(totalAntes - filasAntes) <= 0.01 ? filasDespues : totalAntes + (filasDespues - filasAntes);
  return r2(Math.max(0, nuevo));
};

/** Monto ya aplicado en Pagos a la factura (2 decimales). */
export const montoPagadoDe = (fac: FacturaTotales | null | undefined): number => r2(fac?.montoPagado);

/** ¿La factura tiene pagos aplicados? (montoPagado > 0 o statusPago PAGADA/PARCIAL). */
export const tienePagosAplicados = (fac: FacturaTotales | null | undefined): boolean => {
  if (montoPagadoDe(fac) > 0.009) return true;
  const st = String(fac?.statusPago ?? '').trim().toUpperCase();
  return st === 'PAGADA' || st === 'PARCIAL';
};

/** Campos de total que se escriben en el MISMO batch que el nuevo `operacionesGuardadas`. */
export interface CamposTotalesFactura {
  subtotalFactura: number;
  subtotalMonedaFactura: number;
  saldoPendiente?: number;
  statusPago?: 'PAGADA' | 'PARCIAL';
}

export type ResultadoTotales =
  | { ok: true; campos: CamposTotalesFactura; total: number }
  | { ok: false; total: number; pagado: number };

/**
 * Totales de una factura después de cambiar su conjunto de operaciones
 * (`facturaFresca.operacionesGuardadas` = filas de ANTES; `operacionesNuevas` =
 * filas de DESPUÉS). Cada total se ajusta con `ajustarTotal`:
 *  · subtotalMonedaFactura (moneda de la factura): parte de totalNativoFactura.
 *  · subtotalFactura (conversión): parte del guardado o, si no hay, de la suma de `monto`.
 * Nunca escribe 0 encima de un total positivo si quedan operaciones (se conserva
 * y se avisa en consola). Con saldo/pagos, el saldo y el status de pago se ajustan
 * al NUEVO total; un total por debajo de lo pagado se rechaza (`ok: false`).
 * `facturaFresca` debe venir del servidor (getDoc), no de la lista en memoria.
 */
export const totalesTrasCambioDeOps = (
  facturaFresca: FacturaTotales,
  operacionesNuevas: unknown,
): ResultadoTotales => {
  const moneda = monedaDeFactura(facturaFresca);
  const filasAntes = facturaFresca.operacionesGuardadas;
  const quedanFilas = opsDe(operacionesNuevas).length > 0;
  const nuevoTotal = (campo: string, totalAntes: number, antes: number, despues: number): number => {
    const nuevo = ajustarTotal(totalAntes, antes, despues);
    if (nuevo <= 0 && quedanFilas && totalAntes > 0) {
      console.warn(`[facturas] ${campo} de la factura ${String(facturaFresca.id ?? '')} quedaría en 0 con operaciones restantes; se conserva ${totalAntes}.`);
      return totalAntes;
    }
    return nuevo;
  };
  const conversionGuardada = r2(facturaFresca.subtotalFactura);
  const campos: CamposTotalesFactura = {
    subtotalMonedaFactura: nuevoTotal(
      'subtotalMonedaFactura',
      r2(totalNativoFactura(facturaFresca)),
      totalNativoDeOperaciones(moneda, filasAntes),
      totalNativoDeOperaciones(moneda, operacionesNuevas),
    ),
    subtotalFactura: nuevoTotal(
      'subtotalFactura',
      conversionGuardada > 0 ? conversionGuardada : totalConversionDeOperaciones(filasAntes),
      totalConversionDeOperaciones(filasAntes),
      totalConversionDeOperaciones(operacionesNuevas),
    ),
  };
  const total = campos.subtotalMonedaFactura;
  const pagado = montoPagadoDe(facturaFresca);
  if (pagado > 0.009 && total < pagado - 0.009) return { ok: false, total, pagado };
  if (pagado > 0.009 || trae(facturaFresca.saldoPendiente)) {
    campos.saldoPendiente = r2(Math.max(0, total - pagado));
    if (pagado > 0.009) campos.statusPago = campos.saldoPendiente <= 0.009 ? 'PAGADA' : 'PARCIAL';
  }
  return { ok: true, campos, total };
};

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

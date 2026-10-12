// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.
// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).
// src/shared/dominio/dinero.ts
// ---------------------------------------------------------------------------
// ✅ V00441 (Fase 5.1) — DINERO: UNA sola fórmula para la web y el servidor.
//
// Antes había 4 copias de la conversión de una operación (Facturación Clientes,
// Facturación Proveedores, el espejo del servidor en relacional.ts y el
// "desglose" de Pagos) y 3 del total de una factura. Aquí quedan:
//
//   · conversionOperacion / montoOperacion — lo que vale una operación en la
//     moneda de su factura (regla V00126: convenio USD + factura MXN → × TC;
//     convenio MXN + factura USD → ÷ TC; misma moneda → igual; cargos igual).
//   · renglonFactura — el renglón que se guarda en la factura.
//   · totalNativoFactura — el total a cobrar/pagar EN LA MONEDA de la factura
//     (respeta un total capturado a mano: totalManualCentavos).
//   · totalNativoFacturaLegado — la regla que usan HOY Pagos y el trigger para el
//     saldo. Se conserva idéntica hasta aprobar la reconciliación (punto de parada
//     P3); con la bandera `dineroPorServidor` todo pasa a totalNativoFactura.
//   · abonos y reversiones de pagos, y los agregados en centavos de la factura.
//
// Lógica PURA (sin Firebase ni React). La copia de functions/src/dominio la
// genera scripts/sincronizar-dominio.mjs.
// ---------------------------------------------------------------------------
import { ID_MXN, ID_USD } from './constantes.js';
import { monedaCanonica } from './moneda.js';
import type { Moneda } from './moneda.js';
import { aCentavos, aNumero, deCentavos, r2, sumarMontos } from './numeros.js';
import { normalizarTexto } from './texto.js';

type Datos = Record<string, unknown>;
export type Lado = 'cliente' | 'proveedor';

const comoDatos = (v: unknown): Datos => (v !== null && typeof v === 'object' ? (v as Datos) : {});
const num = (v: unknown): number => Number(v ?? 0) || 0; // misma lectura que Number(x || 0)
const r2f = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

// ── Conversión de una operación ──────────────────────────────────────────
export interface MontosOperacion {
  /** Monto del convenio expresado en la moneda de la factura. */
  subtotal: number;
  cargos: number;
  /** subtotal + cargos (2 decimales). */
  total: number;
  /** Total en dólares (si la factura es en dólares). */
  dol: number;
  /** Total en pesos (si la factura es en pesos). */
  pes: number;
  /** Conversión a pesos (MXN): dólares × TC o pesos directos. */
  conv: number;
  tc: number;
}

const textoUsd = (t: string): boolean => t.includes('USD') || t.includes('DOLAR') || t.includes('DÓLAR');
const textoMxn = (t: string): boolean => t.includes('MXN') || t.includes('PESO');

/** Campos de la operación según el lado (cliente = lo que se cobra; proveedor = lo que se paga). */
const camposLado = (op: Datos, lado: Lado) => (lado === 'cliente'
  ? { fact: op.facturadoEnCobrar, monto: op.montoConvenioCliente, cargos: op.cargosAdicionales, nombreMoneda: op.monedaCobroNombre, monedaConvenio: op.monedaConvenioCliente }
  : { fact: op.facturadoEnUnidad, monto: op.totalAPagarProv, cargos: op.cargosAdicionalesProv, nombreMoneda: op.monedaUnidadNombre, monedaConvenio: op.monedaConvenioProv });

/**
 * Regla de monedas (V00126 · V00243 · V00244). Es exactamente la de
 * calcularConversionCliente / calcularConversionProveedor de Facturación y la del
 * espejo del servidor (relacional.ts), ahora en un solo lugar.
 */
export const conversionOperacion = (operacion: unknown, lado: Lado): MontosOperacion => {
  const op = comoDatos(operacion);
  const c = camposLado(op, lado);
  const tc = Number(op.tipoCambioAprobado) || Number(op.tipoCambioDia) || 0;
  const montoConvenio = num(c.monto);
  const cargos = num(c.cargos);
  const nombreMoneda = String(c.nombreMoneda ?? '').toUpperCase();
  const factUSD = c.fact === ID_USD || textoUsd(nombreMoneda);
  const factMXN = c.fact === ID_MXN || textoMxn(nombreMoneda);
  const monConv = String(c.monedaConvenio ?? '');
  const convUSD = monConv === ID_USD || (!!monConv && textoUsd(monConv.toUpperCase()));
  const convMXN = monConv === ID_MXN || (!!monConv && textoMxn(monConv.toUpperCase()));
  let subtotal = montoConvenio;
  if (convUSD && factMXN) subtotal = tc > 0 ? montoConvenio * tc : 0;
  else if (convMXN && factUSD) subtotal = tc > 0 ? montoConvenio / tc : 0;
  let cargosFact = cargos;
  if (convUSD && factMXN) cargosFact = tc > 0 ? cargos * tc : 0;
  else if (convMXN && factUSD) cargosFact = tc > 0 ? cargos / tc : 0;
  const total = r2f(r2f(subtotal) + r2f(cargosFact));
  let dol = 0; let pes = 0; let conv = 0;
  const facturaUSD = factUSD || (!factMXN && convUSD);
  if (facturaUSD) { dol = total; pes = 0; conv = total * tc; } else { dol = 0; pes = total; conv = total; }
  return { subtotal: r2f(subtotal), cargos: r2f(cargosFact), total, dol: r2f(dol), pes: r2f(pes), conv: r2f(conv), tc };
};

/**
 * Lo que vale la operación para facturar (obtenerMontoOperacion de cada lado):
 * la conversión calculada y, si no se puede calcular (falta el TC o los
 * montos), la conversión que la operación ya trae guardada. Proveedores cae
 * además a la Confirmación de Tarifa guardada.
 */
export const montoOperacion = (operacion: unknown, lado: Lado): MontosOperacion => {
  const op = comoDatos(operacion);
  const calc = conversionOperacion(op, lado);
  if (lado === 'cliente') {
    const convGuardada = Number(op.conversionCliente);
    if (calc.conv === 0 && !isNaN(convGuardada) && convGuardada > 0) {
      return { ...calc, conv: convGuardada, total: calc.total || Number(op.subtotalCliente) || 0, pes: Number(op.pesosCliente) || calc.pes, dol: Number(op.dolaresCliente) || calc.dol };
    }
    return calc;
  }
  if (calc.total > 0 && calc.conv > 0) return calc;
  const convGuardada = Number(op.conversionProv);
  if (!isNaN(convGuardada) && convGuardada > 0) {
    return {
      ...calc, subtotal: calc.subtotal || Number(op.subtotalProv) || 0, total: calc.total || Number(op.subtotalProv) || 0,
      dol: Number(op.dolaresProv) || calc.dol, pes: Number(op.pesosProv) || calc.pes, conv: convGuardada,
    };
  }
  if (calc.subtotal > 0 || calc.conv > 0) return calc;
  // FIX MONTOS EN CERO: la Confirmación de Tarifa guardada (op.confirmacionTarifa).
  const ct = op.confirmacionTarifa;
  if (ct && typeof ct === 'object') {
    const t = ct as Datos;
    const subtotalCT = Number(t.subtotalProv) || ((Number(t.convenioProv) || 0) + (Number(t.costosAdic) || 0));
    if (subtotalCT > 0) {
      const tc = Number(op.tipoCambioAprobado) || Number(t.tipoCambio) || 0;
      const monedaTxt = String(t.facturadoEn || t.monedaConvenio || '').toUpperCase();
      const esDolarCT = textoUsd(monedaTxt);
      const esPesoCT = textoMxn(monedaTxt);
      const convCT = Number(t.totalAFacturar) || (esDolarCT && tc > 0 ? subtotalCT * tc : subtotalCT);
      return {
        subtotal: Number(t.convenioProv) || subtotalCT, cargos: Number(t.costosAdic) || 0, total: subtotalCT,
        dol: esDolarCT ? subtotalCT : 0, pes: esPesoCT ? subtotalCT : 0, conv: convCT, tc,
      };
    }
  }
  return calc;
};

// ── Renglón de factura ──────────────────────────────────────────────────
/** Elemento de `operacionesGuardadas` (forma que lee toda la app hoy). */
export interface RenglonLegado {
  id: string;
  ref: string;
  monto: number;
  subtotalBase: number;
  dol: number;
  pes: number;
  convenioNombre: string;
  refCliente?: string;
  remolque: string;
}

const primero = (...vs: unknown[]): string => {
  for (const v of vs) { const t = v === null || v === undefined ? '' : String(v).trim(); if (t) return t; }
  return '';
};

/** Referencia que se muestra de una operación (numReferencia → referencia → ref → id corto). */
export const refDeOperacion = (op: Datos, id: string): string => primero(op.numReferencia, op.referencia, op.ref) || id.substring(0, 6);

/**
 * Renglón que se guarda al facturar una operación (mismo cálculo y campos que
 * Facturación). `nombreRemolque` traduce un ID de remolque a su nombre (catálogo).
 */
export const renglonFactura = (id: string, operacion: unknown, lado: Lado, nombreRemolque: (v: string) => string = (v) => v): RenglonLegado => {
  const op = comoDatos(operacion);
  const m = montoOperacion(op, lado);
  const remolqueCrudo = primero(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque);
  const renglon: RenglonLegado = {
    id,
    ref: refDeOperacion(op, id),
    monto: m.conv,
    subtotalBase: m.subtotal,
    dol: m.dol,
    pes: m.pes,
    convenioNombre: lado === 'cliente'
      ? primero(op.convenioNombre, op.convenioClienteNombre)
      : primero(op.convenioProvNombre, op.convenioProveedorNombre, op.convenioNombre),
    remolque: remolqueCrudo ? (nombreRemolque(remolqueCrudo) || remolqueCrudo) : '-',
  };
  if (lado === 'cliente') renglon.refCliente = String(op.refCliente ?? '');
  return renglon;
};

// ── Total de una factura ────────────────────────────────────────────────
const MONEDA_FACTURA = ['monedaFacturacion', 'monedaProveedor', 'moneda', 'monedaId'] as const;

/** Moneda de la factura: el primer campo de moneda que se reconozca como USD o MXN. */
export const monedaDeFactura = (factura: unknown): Moneda | null => {
  const fac = comoDatos(factura);
  return MONEDA_FACTURA.map((c) => monedaCanonica(fac[c])).find((m): m is Moneda => m !== null) ?? null;
};

const renglones = (v: unknown): Datos[] => (Array.isArray(v) ? v.filter((x): x is Datos => x !== null && typeof x === 'object') : []);
const trae = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * Total en la moneda de la factura calculado SOLO con sus renglones. 0 si no hay de dónde.
 *  · USD → `dol` de cada renglón (los que no lo traen usan `subtotalBase`).
 *  · MXN → la conversión (`monto`); si no hay, `pes`; luego `subtotalBase`.
 *  · Moneda desconocida → `subtotalBase`.
 */
export const totalNativoDeOperaciones = (moneda: unknown, operaciones: unknown): number => {
  const ops = renglones(operaciones);
  if (ops.length === 0) return 0;
  const suma = (valor: (o: Datos) => unknown): number => sumarMontos(ops.map(valor));
  const mon = monedaCanonica(moneda);
  const candidatos =
    mon === 'USD' ? [suma((o) => (trae(o.dol) ? o.dol : o.subtotalBase)), suma((o) => o.subtotalBase)]
    : mon === 'MXN' ? [suma((o) => o.monto), suma((o) => o.pes), suma((o) => o.subtotalBase)]
    : [suma((o) => o.subtotalBase)];
  return candidatos.find((n) => n > 0) ?? 0;
};

/**
 * TOTAL de la factura en SU moneda (la regla única):
 *  0) un total capturado a mano (totalManualCentavos) manda;
 *  1) subtotalMonedaFactura guardado;
 *  2) el de sus renglones;
 *  3) respaldo: subtotalFactura / total / montoFactura (facturas sin detalle).
 */
export const totalNativoFactura = (factura: unknown): number => {
  const fac = comoDatos(factura);
  const manual = aNumero(fac.totalManualCentavos);
  if (manual > 0) return deCentavos(manual);
  const directo = aNumero(fac.subtotalMonedaFactura);
  if (directo > 0) return directo;
  const deOps = totalNativoDeOperaciones(monedaDeFactura(fac), fac.operacionesGuardadas);
  if (deOps > 0) return deOps;
  return aNumero(fac.subtotalFactura) || aNumero(fac.total) || aNumero(fac.montoFactura);
};

/**
 * Regla que usan HOY Pagos (aplicar/revertir) y el trigger de saldo del servidor.
 * Reconoce la moneda solo por el ID o por 'usd'/'us$'/'dls'/'dólar…' y 'mxn'/'mn'/'peso…',
 * y suma los renglones sin el respaldo por renglón. Se conserva IDÉNTICA hasta que
 * se apruebe la reconciliación (P3): cambiarla movería saldos sin revisión.
 */
export const totalNativoFacturaLegado = (factura: unknown): number => {
  const fac = comoDatos(factura);
  const monTxt = normalizarTexto(fac.monedaFacturacion || fac.monedaProveedor || fac.moneda || fac.monedaId);
  const esUSD = monTxt === ID_USD.toLowerCase() || monTxt === 'usd' || monTxt === 'us$' || monTxt === 'dls' || monTxt.startsWith('dolar');
  const esMXN = monTxt === ID_MXN.toLowerCase() || monTxt === 'mxn' || monTxt === 'mn' || monTxt.startsWith('peso');
  const directo = Number(fac.subtotalMonedaFactura);
  if (!isNaN(directo) && directo > 0) return directo;
  const ops = Array.isArray(fac.operacionesGuardadas) ? fac.operacionesGuardadas : [];
  const suma = (campo: string): number => ops.reduce<number>((s, o) => s + (Number(comoDatos(o)[campo]) || 0), 0);
  if (ops.length > 0) {
    if (esUSD) {
      const dol = suma('dol'); if (dol > 0) return dol;
      const base = suma('subtotalBase'); if (base > 0) return base;
    } else if (esMXN) {
      const conv = suma('monto'); if (conv > 0) return conv;
      const pes = suma('pes'); if (pes > 0) return pes;
      const base = suma('subtotalBase'); if (base > 0) return base;
    } else {
      const base = suma('subtotalBase'); if (base > 0) return base;
    }
  }
  return Number(fac.subtotalFactura) || Number(fac.total) || Number(fac.montoFactura) || 0;
};

/**
 * Total del servidor espejo de Facturación cuando cambia el monto de una operación
 * (relacional.ts, V00275): calcula desde los renglones SIN mirar subtotalMonedaFactura.
 * Se conserva idéntico (lo usa el trigger operacionMontoCambiado).
 */
export const totalNativoDeRenglonesLegado = (factura: unknown, operaciones: readonly unknown[]): number => {
  const fac = comoDatos(factura);
  const monTxt = normalizarTexto(fac.monedaFacturacion || fac.monedaProveedor || fac.moneda || fac.monedaId);
  const esUSD = monTxt === ID_USD.toLowerCase() || monTxt === 'usd' || monTxt === 'us$' || monTxt === 'dls' || monTxt.startsWith('dolar');
  const esMXN = monTxt === ID_MXN.toLowerCase() || monTxt === 'mxn' || monTxt === 'mn' || monTxt.startsWith('peso');
  const suma = (campo: string): number => operaciones.reduce<number>((acc, o) => acc + (Number(comoDatos(o)[campo]) || 0), 0);
  if (operaciones.length > 0) {
    const orden = esUSD ? ['dol', 'subtotalBase'] : esMXN ? ['monto', 'pes', 'subtotalBase'] : ['subtotalBase'];
    for (const campo of orden) { const v = suma(campo); if (v > 0) return r2f(v); }
  }
  return r2f(fac.subtotalFactura || fac.total || fac.montoFactura || 0);
};

/** Suma de la conversión (`monto`) de los renglones. */
export const totalConversionDeOperaciones = (operaciones: unknown): number => sumarMontos(renglones(operaciones).map((o) => o.monto));

/**
 * Nuevo total cuando cambian las operaciones de una factura.
 *  · Si los renglones de ANTES reproducían el total guardado (±0.01), el nuevo
 *    total es la suma de los de DESPUÉS.
 *  · Si no (total capturado a mano, o renglones de relleno en 0 de facturas
 *    importadas), solo se aplica la diferencia: total + (después − antes).
 * A 2 decimales y nunca negativo.
 */
export const ajustarTotal = (totalAntes: number, filasAntes: number, filasDespues: number): number => {
  const nuevo = Math.abs(totalAntes - filasAntes) <= 0.01 ? filasDespues : totalAntes + (filasDespues - filasAntes);
  return r2(Math.max(0, nuevo));
};

/** Monto ya aplicado en Pagos a la factura (2 decimales). */
export const montoPagadoDe = (factura: unknown): number => r2(comoDatos(factura).montoPagado);

/** ¿La factura tiene pagos aplicados? (montoPagado > 0 o statusPago PAGADA/PARCIAL). */
export const tienePagosAplicados = (factura: unknown): boolean => {
  if (montoPagadoDe(factura) > 0.009) return true;
  const st = String(comoDatos(factura).statusPago ?? '').trim().toUpperCase();
  return st === 'PAGADA' || st === 'PARCIAL';
};

/** Campos de total que se escriben junto con el nuevo `operacionesGuardadas`. */
export interface CamposTotalesFactura {
  subtotalFactura: number;
  subtotalMonedaFactura: number;
  saldoPendiente?: number;
  statusPago?: 'PAGADA' | 'PARCIAL';
  totalManualCentavos?: number;
}

export type ResultadoTotales =
  | { ok: true; campos: CamposTotalesFactura; total: number }
  | { ok: false; total: number; pagado: number };

/**
 * Totales de una factura después de cambiar su conjunto de operaciones
 * (`facturaFresca.operacionesGuardadas` = renglones de ANTES; `operacionesNuevas`
 * = de DESPUÉS). Cada total se ajusta con `ajustarTotal`; nunca se escribe 0
 * encima de un total positivo si quedan renglones. Un total por debajo de lo
 * pagado se rechaza (`ok: false`). Si la factura tiene un total capturado a mano
 * (totalManualCentavos), se ajusta con la misma diferencia y se conserva la marca.
 * `facturaFresca` debe venir del servidor, no de una lista en memoria.
 */
export const totalesTrasCambioDeOps = (facturaFresca: unknown, operacionesNuevas: unknown, avisar: (m: string) => void = () => {}): ResultadoTotales => {
  const fac = comoDatos(facturaFresca);
  const moneda = monedaDeFactura(fac);
  const filasAntes = fac.operacionesGuardadas;
  const quedanFilas = renglones(operacionesNuevas).length > 0;
  const nuevoTotal = (campo: string, totalAntes: number, antes: number, despues: number): number => {
    const nuevo = ajustarTotal(totalAntes, antes, despues);
    if (nuevo <= 0 && quedanFilas && totalAntes > 0) {
      avisar(`[facturas] ${campo} de la factura ${String(fac.id ?? '')} quedaría en 0 con operaciones restantes; se conserva ${totalAntes}.`);
      return totalAntes;
    }
    return nuevo;
  };
  // ✅ V00448: un total GUARDADO (aunque sea 0) es el punto de partida. Antes, con 0 se tomaba
  //   el de los renglones: el documento secundario de un folio repetido (que guarda 0/0 porque
  //   el total lo lleva el primero) quedaba con saldo al quitarle o moverle una operación.
  const guardado = (v: unknown): number | null => (trae(v) && Number.isFinite(Number(v)) ? r2(v) : null);
  const nativoGuardado = aNumero(fac.totalManualCentavos) > 0 ? null : guardado(fac.subtotalMonedaFactura);
  const conversionGuardada = guardado(fac.subtotalFactura);
  const campos: CamposTotalesFactura = {
    subtotalMonedaFactura: nuevoTotal(
      'subtotalMonedaFactura',
      nativoGuardado ?? r2(totalNativoFactura(fac)),
      totalNativoDeOperaciones(moneda, filasAntes),
      totalNativoDeOperaciones(moneda, operacionesNuevas),
    ),
    subtotalFactura: nuevoTotal(
      'subtotalFactura',
      conversionGuardada ?? totalConversionDeOperaciones(filasAntes),
      totalConversionDeOperaciones(filasAntes),
      totalConversionDeOperaciones(operacionesNuevas),
    ),
  };
  if (aNumero(fac.totalManualCentavos) > 0) campos.totalManualCentavos = aCentavos(campos.subtotalMonedaFactura);
  const total = campos.subtotalMonedaFactura;
  const pagado = montoPagadoDe(fac);
  if (pagado > 0.009 && total < pagado - 0.009) return { ok: false, total, pagado };
  if (pagado > 0.009 || trae(fac.saldoPendiente)) {
    campos.saldoPendiente = r2(Math.max(0, total - pagado));
    if (pagado > 0.009) campos.statusPago = campos.saldoPendiente <= 0.009 ? 'PAGADA' : 'PARCIAL';
  }
  return { ok: true, campos, total };
};

// ── Pagos ───────────────────────────────────────────────────────────────
/** Margen al comparar lo aplicado contra el saldo fresco (un centavo de redondeo). */
export const TOLERANCIA_SALDO = 0.01;
const CERO = 0.009;

export type StatusPago = 'PAGADA' | 'PARCIAL' | '';
export type ReglaTotal = 'legado' | 'unica';

/** Campos de la factura que cambian al aplicar o revertir un pago. */
export interface CambiosPagoFactura {
  montoPagado: number;
  saldoPendiente: number;
  statusPago: StatusPago;
}

/** Error de negocio: su `message` se muestra tal cual al usuario (Pagos lo llama ErrorPago). */
export class ErrorDinero extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDinero';
  }
}

const totalSegun = (regla: ReglaTotal, factura: unknown): number =>
  (regla === 'unica' ? totalNativoFactura(factura) : totalNativoFacturaLegado(factura));

const montoTexto = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Total nativo, acumulado pagado y saldo de la factura, a 2 decimales. */
export const estadoFactura = (factura: unknown, regla: ReglaTotal = 'legado'): { total: number; montoPagado: number; saldo: number } => {
  const total = r2(totalSegun(regla, factura));
  const montoPagado = r2(comoDatos(factura).montoPagado);
  return { total, montoPagado, saldo: r2(Math.max(0, total - montoPagado)) };
};

/** statusPago: sin saldo → PAGADA; con pagos → PARCIAL; sin pagos → '' (pendiente). */
export const statusPagoDe = (montoPagado: number, saldo: number): StatusPago =>
  saldo <= CERO ? 'PAGADA' : (montoPagado > CERO ? 'PARCIAL' : '');

/**
 * Aplica `aplicado` sobre el estado ACTUAL de la factura. Si supera su saldo
 * fresco por más de TOLERANCIA_SALDO lanza ErrorDinero (no se acota en silencio).
 */
export const calcularAbono = (factura: unknown, aplicado: number, etiqueta: string, regla: ReglaTotal = 'legado') => {
  const { total, montoPagado, saldo } = estadoFactura(factura, regla);
  const monto = r2(aplicado);
  if (monto > saldo + TOLERANCIA_SALDO) {
    throw new ErrorDinero(
      `La factura ${etiqueta} ya no tiene saldo suficiente: su saldo actual es ${montoTexto(saldo)} y se intentó aplicar ${montoTexto(monto)}.\n\n`
      + 'Es posible que otro usuario haya registrado un pago sobre ella. Recarga las facturas y vuelve a intentarlo. No se guardó nada.',
    );
  }
  const pagadoNuevo = r2(montoPagado + monto);
  const saldoNuevo = r2(Math.max(0, total - pagadoNuevo));
  const cambios: CambiosPagoFactura = { montoPagado: pagadoNuevo, saldoPendiente: saldoNuevo, statusPago: statusPagoDe(pagadoNuevo, saldoNuevo) };
  return { total, saldoAnterior: saldo, aplicado: monto, saldoNuevo, cambios };
};

/** Revierte `aplicado` sobre el estado ACTUAL de la factura (el pagado nunca queda negativo). */
export const calcularReversion = (factura: unknown, aplicado: number, regla: ReglaTotal = 'legado'): CambiosPagoFactura => {
  const { total, montoPagado } = estadoFactura(factura, regla);
  const pagadoNuevo = r2(Math.max(0, montoPagado - r2(aplicado)));
  const saldoNuevo = r2(Math.max(0, total - pagadoNuevo));
  return { montoPagado: pagadoNuevo, saldoPendiente: saldoNuevo, statusPago: statusPagoDe(pagadoNuevo, saldoNuevo) };
};

/**
 * Lo aplicado por factura a partir de `facturas[]` de un pago ({ facturaId, aplicado }).
 * Suma en centavos si una factura aparece dos veces y descarta montos ≤ 0.
 */
export const aplicadoPorFactura = (facturas: unknown): Map<string, number> => {
  const centavos = new Map<string, number>();
  for (const item of Array.isArray(facturas) ? facturas : []) {
    const f = comoDatos(item);
    const id = String(f.facturaId ?? '').trim();
    const c = aCentavos(f.aplicado);
    if (!id || c <= 0) continue;
    centavos.set(id, (centavos.get(id) ?? 0) + c);
  }
  return new Map(Array.from(centavos, ([id, c]) => [id, deCentavos(c)]));
};

/** Factura cobrable/pagable: sin status = 'Facturado'; fuera las canceladas y 'No Facturado'. */
export const esFacturaCobrable = (factura: unknown): boolean => {
  const s = normalizarTexto(comoDatos(factura).statusFactura || 'Facturado');
  if (!s) return true;
  if (s.includes('cancel')) return false;
  return !s.startsWith('no ');
};

// ── Agregados en centavos (Fase 5.2) ─────────────────────────────────────
export interface AgregadosFactura {
  totalCentavos: number;
  montoPagadoCentavos: number;
  /** Lo que falta por cobrar/pagar (nunca negativo). */
  saldoCentavos: number;
  /** Lo pagado de MÁS (si el total bajó por debajo de lo pagado): no se pierde con un Math.max. */
  saldoAFavorCentavos: number;
  /** Con saldo y cobrable (para consultar "facturas abiertas"). */
  abierta: boolean;
}

/** Agregados de dinero de una factura con la regla única. */
export const agregadosFactura = (factura: unknown): AgregadosFactura => {
  const totalCentavos = aCentavos(totalNativoFactura(factura));
  const montoPagadoCentavos = aCentavos(comoDatos(factura).montoPagado);
  const saldoCentavos = Math.max(0, totalCentavos - montoPagadoCentavos);
  return {
    totalCentavos,
    montoPagadoCentavos,
    saldoCentavos,
    saldoAFavorCentavos: Math.max(0, montoPagadoCentavos - totalCentavos),
    abierta: saldoCentavos > 0 && esFacturaCobrable(factura),
  };
};

/**
 * ✅ V00442 (Fase 6.1) — Campos que mantiene el servidor en una factura (regla única):
 * saldo y status de pago (si tiene pagos o saldo guardado), agregados en centavos y
 * `esquemaDinero: 2`. Solo los que DIFIEREN del documento (vacío = nada que escribir).
 * Lo usan el trigger de saldo y las callables (que los escriben de una vez para que el
 * trigger ya no tenga que volver a escribir la factura).
 */
export const derivadosFactura = (factura: unknown): Datos => {
  const fac = comoDatos(factura);
  const cambios: Datos = {};
  const montoPagado = Number(fac.montoPagado) || 0;
  if (montoPagado > 0 || typeof fac.saldoPendiente === 'number') {
    const saldo = Math.max(0, r2(totalNativoFactura(fac) - montoPagado));
    const status = saldo <= 0.009 ? 'PAGADA' : (montoPagado > 0 ? 'PARCIAL' : String(fac.statusPago || ''));
    if (Math.abs((Number(fac.saldoPendiente) || 0) - saldo) > 0.005) cambios.saldoPendiente = saldo;
    if (status && String(fac.statusPago || '') !== status) cambios.statusPago = status;
  }
  for (const [k, v] of Object.entries(agregadosFactura(fac))) if (fac[k] !== v) cambios[k] = v;
  if (fac.esquemaDinero !== 2) cambios.esquemaDinero = 2;
  return cambios;
};

/** Renglón para la subcolección facturas_x/{id}/renglones/{opId} (Fase 5.2). */
export interface RenglonCentavos {
  ref: string;
  moneda: Moneda | null;
  /** En la moneda de la factura. */
  montoCentavos: number;
  conversionMxnCentavos: number;
  subtotalBaseCentavos: number;
  dolCentavos: number;
  pesCentavos: number;
  convenioNombre: string;
  refCliente: string;
  remolque: string;
}

/** Renglón en centavos a partir del renglón guardado en `operacionesGuardadas`. */
export const renglonEnCentavos = (renglon: unknown, monedaFactura: Moneda | null): RenglonCentavos => {
  const r = comoDatos(renglon);
  const nativo = monedaFactura === 'USD' ? (trae(r.dol) ? r.dol : r.subtotalBase)
    : monedaFactura === 'MXN' ? (aNumero(r.monto) > 0 ? r.monto : aNumero(r.pes) > 0 ? r.pes : r.subtotalBase)
    : r.subtotalBase;
  return {
    ref: String(r.ref ?? ''),
    moneda: monedaFactura,
    montoCentavos: aCentavos(nativo),
    conversionMxnCentavos: aCentavos(r.monto),
    subtotalBaseCentavos: aCentavos(r.subtotalBase),
    dolCentavos: aCentavos(r.dol),
    pesCentavos: aCentavos(r.pes),
    convenioNombre: String(r.convenioNombre ?? ''),
    refCliente: String(r.refCliente ?? ''),
    remolque: String(r.remolque ?? ''),
  };
};

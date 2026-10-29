// src/features/facturacion/services/diferenciaEnCargos.ts
// ---------------------------------------------------------------------------
// ✅ V00519 — La DIFERENCIA entre el documento de la factura (PDF / XML) y la factura de la app se pone en
// los COSTOS ADICIONALES de sus operaciones (Analizar documento, Ficha de Factura de Clientes). El
// usuario escribe cuánto va a cada operación (en la moneda de la factura); por cada una:
//   · cargosAdicionales (en la moneda del convenio: se convierte con su T.C. para que en la factura
//     sume justo lo escrito) y su Por Cobrar (subtotalCliente, dolaresCliente, pesosCliente,
//     conversionCliente, utilidadEstimada) con la regla única (conversionOperacion);
//   · la observación en "Observaciones de costos adicionales" (cargosAdicionalesNotas, se agrega);
//   · `diferenciaFacturaAplicada` (factura, monto, fecha, quién) para saber de dónde salió.
// Y la factura (una factura emitida no cambia sola, V00495): su renglón de cada operación, su total
// (+ la suma de lo agregado, así se respeta un total que ya traía impuestos), su total manual si lo
// tenía, el saldo y el status de pago. No puede quedar por debajo de lo pagado.
// Es una escritura de DINERO: una sola TRANSACCIÓN que relee la factura y las operaciones. Con la
// bandera dineroPorServidor el servidor no deja escribir la factura desde la web: no se ofrece.
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { conversionOperacion, ErrorDinero, montoOperacion, montoPagadoDe, totalNativoFacturaLegado } from '../../../shared/dominio/dinero';
import { avisoTotalBajoPagado, renglonesDeFactura } from '../../../shared/dominio/facturacion';
import { aCentavos, r2 } from '../../../shared/dominio/numeros';
import { importeEn } from './cotejoCfdi';
import { esRefOperacion } from './leerCfdi';
import { estaCancelada } from './reglasFactura';

type Datos = Record<string, unknown>;
type MonedaFactura = 'USD' | 'MXN';

const txt = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Una operación de la factura a la que se le puede poner la diferencia. */
export interface OpDeFactura { opId: string; ref: string; importe: number }
/** Lo que el usuario escribió para una operación (en la moneda de la factura; puede ser negativo). */
export interface AsignacionCargo { opId: string; ref: string; monto: number }

export interface DatosDiferenciaCargos {
  folio: string;
  moneda: MonedaFactura;
  asignaciones: readonly AsignacionCargo[];
  nota: string;
  ahoraISO: string;
  usuario: string;
}

export interface CambioOp { id: string; ref: string; cargosAntes: number; cargosDespues: number; cobroAntes: number; cobroDespues: number; datos: Datos }
export interface PlanCargos { ops: CambioOp[]; facturaId: string; totalAntes: number; totalDespues: number; datosFactura: Datos }

/** Lo que cobra un renglón de la factura en su moneda (Dólares: dol; Pesos: la conversión). */
export const importeRenglon = (r: Datos, moneda: MonedaFactura): number =>
  moneda === 'USD' ? r2(num(r.dol) || num(r.subtotalBase)) : r2(num(r.monto) || num(r.pes) || num(r.subtotalBase));

/** Las operaciones de la factura (con su id real) y lo que cobra cada una en la moneda de la factura. */
export const opsDeFactura = (fac: Datos, moneda: MonedaFactura): OpDeFactura[] =>
  renglonesDeFactura(fac)
    .filter((r) => txt(r.id) && !esRefOperacion(txt(r.id))) // los renglones armados solo con la referencia no traen id
    .map((r) => ({ opId: txt(r.id), ref: txt(r.ref) || txt(r.id), importe: importeRenglon(r, moneda) }));

/**
 * Cuánto se suma a cargosAdicionales (en la moneda del convenio) para que la operación cobre `delta` más en
 * la moneda de la factura. null = no se puede convertir (falta el T.C. o el monto de la operación).
 */
export const cargoEnMonedaConvenio = (op: Datos, moneda: MonedaFactura, delta: number): number | null => {
  const base = num(op.cargosAdicionales);
  const cobro = (x: number): number => importeEn(moneda, { ...op, cargosAdicionales: r2(base + x) });
  const antes = cobro(0);
  const pendiente = (cobro(1000) - antes) / 1000;
  if (!(pendiente > 0)) return null;
  const meta = aCentavos(antes + delta);
  const x0 = r2(delta / pendiente);
  const candidatos = [0, 0.01, -0.01, 0.02, -0.02].map((d) => r2(x0 + d));
  const exacto = candidatos.find((x) => aCentavos(cobro(x)) === meta);
  if (exacto !== undefined) return exacto;
  const cerca = candidatos.reduce((a, b) => (Math.abs(aCentavos(cobro(b)) - meta) < Math.abs(aCentavos(cobro(a)) - meta) ? b : a));
  return Math.abs(aCentavos(cobro(cerca)) - meta) <= 1 ? cerca : null;
};

const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Qué se escribe (puro). Lanza ErrorDinero si algo no deja hacerlo. */
export const planDiferenciaEnCargos = (d: DatosDiferenciaCargos, factura: { id: string; datos: Datos }, ops: readonly { id: string; datos: Datos }[]): PlanCargos => {
  const fac = factura.datos;
  if (estaCancelada(txt(fac.statusFactura))) throw new ErrorDinero(`La factura ${d.folio} está cancelada: no se le ponen costos.`);
  const asignaciones = d.asignaciones.filter((a) => aCentavos(a.monto) !== 0);
  if (asignaciones.length === 0) throw new ErrorDinero('Escribe cuánto va a cada operación.');
  if (!d.nota.trim()) throw new ErrorDinero('Escribe la observación de los costos adicionales.');
  const enFactura = new Set(opsDeFactura(fac, d.moneda).map((o) => o.opId));
  const porId = new Map(ops.map((o) => [o.id, o.datos] as const));
  const renglones = renglonesDeFactura(fac).map((r) => ({ ...r }));
  const cambios: CambioOp[] = [];
  let delta = 0;
  let deltaConv = 0;
  for (const a of asignaciones) {
    const op = porId.get(a.opId);
    if (!op) throw new ErrorDinero(`La operación ${a.ref} ya no existe. No se guardó nada.`);
    if (!enFactura.has(a.opId)) throw new ErrorDinero(`La operación ${a.ref} ya no está en la factura ${d.folio}. No se guardó nada.`);
    const x = cargoEnMonedaConvenio(op, d.moneda, a.monto);
    if (x === null) throw new ErrorDinero(`${a.ref}: no se pudo convertir la diferencia a la moneda de su convenio (revisa el monto del convenio y el tipo de cambio de la operación). No se guardó nada.`);
    const cargosAntes = num(op.cargosAdicionales);
    const cargosDespues = r2(cargosAntes + x);
    const nueva = { ...op, cargosAdicionales: cargosDespues };
    const calc = conversionOperacion(nueva, 'cliente');
    const mAntes = montoOperacion(op, 'cliente');
    const mDespues = montoOperacion(nueva, 'cliente');
    const cobroAntes = importeEn(d.moneda, op);
    const cobroDespues = importeEn(d.moneda, nueva);
    const notaPrevia = txt(op.cargosAdicionalesNotas);
    cambios.push({
      id: a.opId, ref: a.ref, cargosAntes, cargosDespues, cobroAntes, cobroDespues,
      datos: {
        cargosAdicionales: cargosDespues,
        cargosAdicionalesNotas: notaPrevia ? `${notaPrevia}\n${d.nota.trim()}` : d.nota.trim(),
        subtotalCliente: calc.total, dolaresCliente: calc.dol, pesosCliente: calc.pes, conversionCliente: calc.conv,
        utilidadEstimada: r2(calc.conv - num(op.conversionProv)),
        diferenciaFacturaAplicada: { factura: d.folio, monto: r2(cobroDespues - cobroAntes), moneda: d.moneda, en: d.ahoraISO, por: d.usuario },
      },
    });
    const i = renglones.findIndex((r) => txt(r.id) === a.opId);
    if (i >= 0) renglones[i] = { ...renglones[i], monto: mDespues.conv, subtotalBase: mDespues.subtotal, dol: mDespues.dol, pes: mDespues.pes };
    delta += cobroDespues - cobroAntes;
    deltaConv += mDespues.conv - mAntes.conv;
  }
  const totalAntes = r2(totalNativoFacturaLegado(fac));
  const totalDespues = r2(totalAntes + delta);
  if (totalDespues <= 0) throw new ErrorDinero(`La factura quedaría en ${dinero(totalDespues)}: revisa los montos. No se guardó nada.`);
  const pagado = montoPagadoDe(fac);
  if (totalDespues < pagado - 0.009) throw new ErrorDinero(avisoTotalBajoPagado(totalDespues, pagado));
  const saldo = r2(Math.max(0, totalDespues - pagado));
  const datosFactura: Datos = {
    ...(Array.isArray(fac.operacionesGuardadas) && fac.operacionesGuardadas.length ? { operacionesGuardadas: renglones } : {}),
    subtotalMonedaFactura: totalDespues,
    ...(num(fac.subtotalFactura) > 0 ? { subtotalFactura: r2(num(fac.subtotalFactura) + deltaConv) } : {}),
    ...(num(fac.totalManualCentavos) > 0 ? { totalManualCentavos: aCentavos(totalDespues) } : {}),
    saldoPendiente: saldo,
    ...(pagado > 0.009 ? { statusPago: saldo <= 0.009 ? 'PAGADA' : 'PARCIAL' } : {}),
    editadoEn: d.ahoraISO, editadoPor: d.usuario,
  };
  return { ops: cambios, facturaId: factura.id, totalAntes, totalDespues, datosFactura };
};

/** Lee la factura y las operaciones, arma el plan y lo escribe, todo en UNA transacción. */
export const aplicarDiferenciaEnCargos = async (facturaId: string, d: DatosDiferenciaCargos): Promise<PlanCargos> =>
  runTransaction(db, async (tx) => {
    const refFactura = doc(db, 'facturas_clientes', facturaId);
    const sf = await tx.get(refFactura);
    if (!sf.exists()) throw new ErrorDinero('La factura ya no existe. No se guardó nada.');
    const sops = await Promise.all(d.asignaciones.map((a) => tx.get(doc(db, 'operaciones', a.opId))));
    const ops = sops.filter((s) => s.exists()).map((s) => ({ id: s.id, datos: s.data() as Datos }));
    const plan = planDiferenciaEnCargos(d, { id: sf.id, datos: sf.data() as Datos }, ops);
    plan.ops.forEach((o) => tx.update(doc(db, 'operaciones', o.id), o.datos));
    tx.set(refFactura, plan.datosFactura, { merge: true });
    return plan;
  });

// src/features/facturacion/services/sincronizarFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00520 — Poner una factura de cliente AL DÍA con sus operaciones (botón Actualizar de Editar factura).
// Una factura emitida no cambia sola cuando se edita una operación (V00495); si el costo de una de sus
// operaciones cambió (se editó desde la factura con ✎), al presionar Actualizar:
//   · el renglón de esa operación toma lo que cobra hoy (montoOperacion: conversión, subtotal, dólares, pesos);
//   · el total sube o baja la MISMA diferencia (así un total que ya traía IVA lo conserva), igual que
//     diferenciaEnCargos.ts; también subtotalFactura, el total manual si lo tenía, el saldo y el status de
//     pago. No puede quedar por debajo de lo pagado.
// Escritura de DINERO: una TRANSACCIÓN que relee la factura y sus operaciones. No con dineroPorServidor.
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { ErrorDinero, monedaDeFactura, montoOperacion, montoPagadoDe, totalNativoFacturaLegado } from '../../../shared/dominio/dinero';
import { avisoTotalBajoPagado, renglonesDeFactura } from '../../../shared/dominio/facturacion';
import { aCentavos, r2 } from '../../../shared/dominio/numeros';
import { cuadreDeFactura } from './cuadreFactura';
import { importeRenglon, opsDeFactura } from './diferenciaEnCargos';

type Datos = Record<string, unknown>;
type MonedaFactura = 'USD' | 'MXN';
const txt = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Una operación cuyo cobro de hoy no es el de su renglón en la factura. */
export interface OpDesfasada { opId: string; ref: string; antes: number; ahora: number }

/** El renglón de la factura con lo que cobra HOY la operación (los demás datos del renglón se quedan). */
export const renglonAlDia = (r: Datos, op: Datos): Datos => {
  const m = montoOperacion(op, 'cliente');
  return { ...r, monto: m.conv, subtotalBase: m.subtotal, dol: m.dol, pes: m.pes };
};

/**
 * Los renglones GUARDADOS de la factura, solo si traen lo que cobró cada operación. Una factura sin
 * `operacionesGuardadas` (o con todos sus renglones en 0) no dice qué cobró cada una: no se compara
 * (cada operación saldría "cambiada" y el total se sumaría dos veces).
 */
export const renglonesConImporte = (fac: Datos, moneda: MonedaFactura): Datos[] => {
  if (!Array.isArray(fac.operacionesGuardadas) || fac.operacionesGuardadas.length === 0) return [];
  const rs = renglonesDeFactura(fac);
  return rs.some((r) => importeRenglon(r, moneda) > 0) ? rs : [];
};

/** Las operaciones de la factura que cambiaron de costo (comparando su renglón con lo que cobran hoy). */
export const opsDesfasadas = (fac: Datos, ops: readonly { id: string; datos: Datos }[], moneda: MonedaFactura): OpDesfasada[] => {
  const porId = new Map(ops.map((o) => [o.id, o.datos] as const));
  return renglonesConImporte(fac, moneda).flatMap((r) => {
    const op = porId.get(txt(r.id));
    if (!op) return [];
    const antes = importeRenglon(r, moneda);
    const ahora = importeRenglon(renglonAlDia(r, op), moneda);
    return aCentavos(antes) === aCentavos(ahora) ? [] : [{ opId: txt(r.id), ref: txt(r.ref) || txt(op.ref) || txt(r.id), antes, ahora }];
  });
};

/**
 * ✅ V00527 — Cómo queda el total al poner los renglones al día (cada uno con el TOTAL de hoy de su operación):
 *  · 'yaIncluido': lo que suman hoy sus operaciones YA es el total de la factura (p. ej. la 39802: el renglón
 *    guardó el subtotal $140 y después se capturaron $250 de cargos; el total ya decía $390). El total no cambia.
 *  · 'diferencia': la factura cuadraba con sus renglones (o con su IVA): el total sube o baja la diferencia (V00520).
 *  · 'soloImportes': no cuadraba antes ni cuadra con lo de hoy: se guardan los importes de hoy y el total NO se
 *    toca (no se inventa un total); queda en Corregir con la diferencia real.
 */
export type ModoSincronizar = 'yaIncluido' | 'diferencia' | 'soloImportes';
export interface PlanSincronizar { desfasadas: OpDesfasada[]; totalAntes: number; totalDespues: number; modo: ModoSincronizar; datosFactura: Datos }

/** Qué se escribe en la factura (null = ya está al día). Lanza ErrorDinero si no se puede. */
export const planSincronizarFactura = (fac: Datos, ops: readonly { id: string; datos: Datos }[], moneda: MonedaFactura, ahoraISO: string, usuario: string): PlanSincronizar | null => {
  const desfasadas = opsDesfasadas(fac, ops, moneda);
  if (desfasadas.length === 0) return null;
  const porId = new Map(ops.map((o) => [o.id, o.datos] as const));
  const cambiadas = new Set(desfasadas.map((d) => d.opId));
  let deltaConv = 0;
  const renglones = renglonesDeFactura(fac).map((r) => {
    const op = porId.get(txt(r.id));
    if (!op || !cambiadas.has(txt(r.id))) return r;
    const nuevo = renglonAlDia(r, op);
    deltaConv += num(nuevo.monto) - num(r.monto);
    return nuevo;
  });
  const delta = desfasadas.reduce((s, d) => s + (d.ahora - d.antes), 0);
  const totalAntes = r2(totalNativoFacturaLegado(fac));
  // ✅ V00527: no se suma dos veces lo que el total ya incluía (ver ModoSincronizar).
  const sumaHoy = renglones.reduce((s, r) => s + aCentavos(importeRenglon(r, moneda)), 0);
  const antes = cuadreDeFactura(renglonesDeFactura(fac), moneda, totalAntes).motivo;
  const modo: ModoSincronizar = sumaHoy === aCentavos(totalAntes) ? 'yaIncluido' : (antes === 'cuadra' || antes === 'iva') ? 'diferencia' : 'soloImportes';
  const totalDespues = modo === 'diferencia' ? r2(totalAntes + delta) : totalAntes;
  if (totalDespues <= 0) throw new ErrorDinero('La factura quedaría en $0.00 o menos: revisa los costos de sus operaciones. No se guardó nada.');
  const pagado = montoPagadoDe(fac);
  if (totalDespues < pagado - 0.009) throw new ErrorDinero(avisoTotalBajoPagado(totalDespues, pagado));
  const saldo = r2(Math.max(0, totalDespues - pagado));
  return {
    desfasadas, totalAntes, totalDespues, modo,
    datosFactura: {
      operacionesGuardadas: renglones,
      subtotalMonedaFactura: totalDespues,
      ...(modo === 'diferencia' && num(fac.subtotalFactura) > 0 ? { subtotalFactura: r2(num(fac.subtotalFactura) + deltaConv) } : {}),
      ...(num(fac.totalManualCentavos) > 0 ? { totalManualCentavos: aCentavos(totalDespues) } : {}),
      saldoPendiente: saldo,
      ...(pagado > 0.009 ? { statusPago: saldo <= 0.009 ? 'PAGADA' : 'PARCIAL' } : {}),
      editadoEn: ahoraISO, editadoPor: usuario,
    },
  };
};

/** Relee la factura y sus operaciones y la pone al día, en UNA transacción (null = ya estaba al día). */
export const sincronizarFacturaConOperaciones = async (facturaId: string, ahoraISO: string, usuario: string): Promise<PlanSincronizar | null> =>
  runTransaction(db, async (tx) => {
    const ref = doc(db, 'facturas_clientes', facturaId);
    const sf = await tx.get(ref);
    if (!sf.exists()) throw new ErrorDinero('La factura ya no existe. No se guardó nada.');
    const fac = sf.data() as Datos;
    const moneda = monedaDeFactura(fac);
    if (moneda !== 'USD' && moneda !== 'MXN') throw new ErrorDinero('La factura no tiene moneda: no se puede poner al día con sus operaciones.');
    const ids = opsDeFactura(fac, moneda).map((o) => o.opId);
    const snaps = await Promise.all(ids.map((id) => tx.get(doc(db, 'operaciones', id))));
    const ops = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, datos: s.data() as Datos }));
    const plan = planSincronizarFactura(fac, ops, moneda, ahoraISO, usuario);
    if (plan) tx.set(ref, plan.datosFactura, { merge: true });
    return plan;
  });

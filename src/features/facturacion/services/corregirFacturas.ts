// src/features/facturacion/services/corregirFacturas.ts
// ---------------------------------------------------------------------------
// ✅ V00482 — CORREGIR MONEDAS Y MONTOS (lógica pura, Clientes y Proveedores).
// Para cada factura:
//   · moneda = la de su empresa en Empresas;
//   · total  = la suma de sus operaciones en esa moneda: Dólares → Dólares (Cliente/Proveedor);
//     Pesos → Conversión Final (pesos directos + dólares × TC). Es el "Recalcular montos" de
//     Pagos (planRecalcularFactura, la misma regla del servidor) aplicado a todas.
// Se SALTAN (y se listan): canceladas, empresa sin moneda, sin operaciones ligadas o cuyo recálculo
// da $0. ✅ V00483: las que tienen pagos SÍ se corrigen (pedido de Omaf): su saldo se recalcula con
// lo ya pagado; si lo pagado pasa del total nuevo quedan PAGADA con saldo 0 y se marcan "pagada de más".
// ---------------------------------------------------------------------------
import { ErrorDinero, monedaDeFactura, montoPagadoDe, statusPagoDe, tienePagosAplicados, totalNativoFactura } from '../../../shared/dominio/dinero';
import type { Lado } from '../../../shared/dominio/dinero';
import { LADOS, lista, planRecalcularFactura } from '../../../shared/dominio/facturacion';
import type { DocLeido } from '../../../shared/dominio/facturacion';
import { idMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { r2 } from '../../../shared/dominio/numeros';
import { estaCancelada } from './reglasFactura';

export type EstadoRevision = 'corregir' | 'bien' | 'omitida';

export interface RevisionFactura {
  id: string;
  invoice: string;
  empresa: string;
  monedaAntes: Moneda | null;
  monedaNueva: Moneda | null;
  totalAntes: number;
  totalNuevo: number;
  /** Lo ya pagado (montoPagado) y lo que pasa del total nuevo. */
  pagado: number;
  pagadoDeMas: number;
  estado: EstadoRevision;
  /** Por qué se salta (solo 'omitida'). */
  motivo: string;
  /** Campos que se escriben en la factura (solo 'corregir'). */
  datos: Record<string, unknown> | null;
}

export const MOTIVO_CANCELADA = 'Cancelada';
export const MOTIVO_SIN_MONEDA = 'Su empresa no tiene moneda en Empresas';
export const MOTIVO_SIN_OPERACIONES = 'No tiene operaciones ligadas';

/** IDs de operación de una factura que se pueden leer (sin rutas). */
export const idsDeOperaciones = (factura: Record<string, unknown>): string[] =>
  lista(factura.operacionesIds).filter((x) => !x.includes('/'));

/** Motivo para no tocar la factura (antes de mirar sus operaciones), o null si se puede corregir. */
export const motivoParaSaltar = (factura: Record<string, unknown>, monedaEmpresa: Moneda | null): string | null => {
  if (estaCancelada(factura.statusFactura)) return MOTIVO_CANCELADA;
  if (!monedaEmpresa) return MOTIVO_SIN_MONEDA;
  if (idsDeOperaciones(factura).length === 0) return MOTIVO_SIN_OPERACIONES;
  return null;
};

export const revisarFactura = (
  lado: Lado, factura: DocLeido, ops: readonly DocLeido[], monedaEmpresa: Moneda | null,
  empresa: string, ahoraISO: string, usuario: string,
): RevisionFactura => {
  const fac = factura.datos;
  const base: RevisionFactura = {
    id: factura.id,
    invoice: String(fac.invoice ?? '').trim() || '(sin folio)',
    empresa,
    monedaAntes: monedaDeFactura(fac),
    monedaNueva: monedaEmpresa,
    totalAntes: totalNativoFactura(fac),
    totalNuevo: 0,
    pagado: montoPagadoDe(fac),
    pagadoDeMas: 0,
    estado: 'omitida',
    motivo: '',
    datos: null,
  };
  const omitir = (motivo: string): RevisionFactura => ({ ...base, motivo });
  const saltar = motivoParaSaltar(fac, monedaEmpresa);
  if (saltar || !monedaEmpresa) return omitir(saltar ?? MOTIVO_SIN_MONEDA);
  let datos: Record<string, unknown>;
  try {
    // El plan rechaza un total menor a lo pagado; aquí se calcula sin pagos y el saldo se pone abajo.
    const sinPagos: DocLeido = { id: factura.id, datos: { ...fac, montoPagado: 0, statusPago: '' } };
    const plan = planRecalcularFactura(lado, sinPagos, ops, monedaEmpresa, ahoraISO, usuario);
    const escritura = plan.escrituras[0];
    datos = escritura && escritura.tipo !== 'borrar' ? { ...escritura.datos } : {};
  } catch (e) {
    if (e instanceof ErrorDinero) return omitir(e.message.split('\n')[0]);
    throw e;
  }
  // La moneda en el campo que leen la tabla, la ficha y Pagos (el plan solo escribía `moneda`).
  datos[LADOS[lado].campoMoneda] = monedaEmpresa;
  datos.monedaId = idMoneda(monedaEmpresa);
  const totalNuevo = Number(datos.subtotalMonedaFactura) || 0;
  // Saldo con lo ya pagado (los pagos no se tocan).
  const pagado = base.pagado;
  if (pagado > 0.009) {
    const saldo = r2(Math.max(0, totalNuevo - pagado));
    datos.saldoPendiente = saldo;
    datos.statusPago = statusPagoDe(pagado, saldo);
  } else if (tienePagosAplicados(fac)) {
    // Marcada PAGADA/PARCIAL sin montoPagado (importada de AppSheet): su estado de pago se queda.
    delete datos.saldoPendiente;
  }
  const pagadoDeMas = r2(Math.max(0, pagado - totalNuevo));
  const igual = base.monedaAntes === monedaEmpresa && Math.abs(totalNuevo - base.totalAntes) < 0.005;
  return { ...base, totalNuevo, pagadoDeMas, estado: igual ? 'bien' : 'corregir', datos: igual ? null : datos };
};

export interface ResumenRevision {
  corregir: RevisionFactura[];
  bien: number;
  omitidas: RevisionFactura[];
  /** De las que se corrigen: con pagos aplicados y las que quedan pagadas de más. */
  conPagos: number;
  deMas: number;
  /** Omitidas agrupadas por motivo, de la más frecuente a la menos. */
  porMotivo: { motivo: string; n: number }[];
}

export const resumirRevision = (revisiones: readonly RevisionFactura[]): ResumenRevision => {
  const corregir = revisiones.filter((r) => r.estado === 'corregir');
  const omitidas = revisiones.filter((r) => r.estado === 'omitida');
  const conteo = new Map<string, number>();
  omitidas.forEach((r) => conteo.set(r.motivo, (conteo.get(r.motivo) ?? 0) + 1));
  return {
    corregir,
    bien: revisiones.filter((r) => r.estado === 'bien').length,
    conPagos: corregir.filter((r) => r.pagado > 0.009).length,
    deMas: corregir.filter((r) => r.pagadoDeMas > 0.009).length,
    omitidas,
    porMotivo: [...conteo].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo, 'es')),
  };
};

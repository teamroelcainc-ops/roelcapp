// src/features/facturacion/services/corregirFacturas.ts
// ---------------------------------------------------------------------------
// ✅ V00482 — CORREGIR MONEDAS Y MONTOS (lógica pura, Clientes y Proveedores).
// Para cada factura:
//   · moneda = la de su empresa en Empresas;
//   · total  = la suma de sus operaciones en esa moneda: Dólares → Dólares (Cliente/Proveedor);
//     Pesos → Conversión Final (pesos directos + dólares × TC). Es el "Recalcular montos" de
//     Pagos (planRecalcularFactura, la misma regla del servidor) aplicado a todas.
// Se SALTAN (y se listan): canceladas, con pagos aplicados, empresa sin moneda, sin operaciones
// ligadas o cuyo recálculo da $0.
// ---------------------------------------------------------------------------
import { ErrorDinero, monedaDeFactura, tienePagosAplicados, totalNativoFactura } from '../../../shared/dominio/dinero';
import type { Lado } from '../../../shared/dominio/dinero';
import { LADOS, lista, planRecalcularFactura } from '../../../shared/dominio/facturacion';
import type { DocLeido } from '../../../shared/dominio/facturacion';
import { idMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
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
  estado: EstadoRevision;
  /** Por qué se salta (solo 'omitida'). */
  motivo: string;
  /** Campos que se escriben en la factura (solo 'corregir'). */
  datos: Record<string, unknown> | null;
}

export const MOTIVO_CANCELADA = 'Cancelada';
export const MOTIVO_CON_PAGOS = 'Tiene pagos aplicados (revísala en Pagos)';
export const MOTIVO_SIN_MONEDA = 'Su empresa no tiene moneda en Empresas';
export const MOTIVO_SIN_OPERACIONES = 'No tiene operaciones ligadas';

/** IDs de operación de una factura que se pueden leer (sin rutas). */
export const idsDeOperaciones = (factura: Record<string, unknown>): string[] =>
  lista(factura.operacionesIds).filter((x) => !x.includes('/'));

/** Motivo para no tocar la factura (antes de mirar sus operaciones), o null si se puede corregir. */
export const motivoParaSaltar = (factura: Record<string, unknown>, monedaEmpresa: Moneda | null): string | null => {
  if (estaCancelada(factura.statusFactura)) return MOTIVO_CANCELADA;
  if (tienePagosAplicados(factura)) return MOTIVO_CON_PAGOS;
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
    estado: 'omitida',
    motivo: '',
    datos: null,
  };
  const omitir = (motivo: string): RevisionFactura => ({ ...base, motivo });
  const saltar = motivoParaSaltar(fac, monedaEmpresa);
  if (saltar || !monedaEmpresa) return omitir(saltar ?? MOTIVO_SIN_MONEDA);
  let datos: Record<string, unknown>;
  try {
    const plan = planRecalcularFactura(lado, factura, ops, monedaEmpresa, ahoraISO, usuario);
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
  const igual = base.monedaAntes === monedaEmpresa && Math.abs(totalNuevo - base.totalAntes) < 0.005;
  return { ...base, totalNuevo, estado: igual ? 'bien' : 'corregir', datos: igual ? null : datos };
};

export interface ResumenRevision {
  corregir: RevisionFactura[];
  bien: number;
  omitidas: RevisionFactura[];
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
    omitidas,
    porMotivo: [...conteo].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo, 'es')),
  };
};

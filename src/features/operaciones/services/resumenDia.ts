// src/features/operaciones/services/resumenDia.ts
// ✅ V00456: reglas del RESUMEN DEL DÍA (tarjetas de Operaciones Activas), antes
//   sueltas dentro de App.tsx. Lógica pura: la usan las tarjetas, la pestaña
//   "Completadas hoy" del tablero y los modales de tipo de cambio y diesel, para
//   que el número de la tarjeta y la lista digan lo mismo.
import { STATUS_CANCELADO, STATUS_COMPLETADOS } from '../../../shared/dominio/constantes';
import { DESCUENTO_MURPHY_POR_GALON, esCargaMurphy } from '../../../shared/dominio/cobroDiesel';

type Datos = Record<string, unknown>;

const sinAcentos = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Fecha AAAA-MM-DD de un valor guardado (ISO, d/m/aaaa o Timestamp); '' si no se reconoce. */
export const normalizarFechaResumen = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};

/** Tipo de cambio de un registro de tipo_cambio (los campos cambiaron con los años). */
export const extraerTipoCambio = (row: Datos | null | undefined): number | null => {
  if (!row || typeof row !== 'object') return null;
  const valKey = Object.keys(row).find((k) => {
    const kk = String(k).toLowerCase();
    return kk.includes('dof') || kk.includes('valor') || kk === 'tc' || kk.includes('cambio') || kk.includes('monto') || kk.includes('t.c');
  });
  if (valKey) {
    const n = Number(String(row[valKey]).replace(/[^0-9.-]+/g, ''));
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const posibles = Object.values(row)
    .map((v) => parseFloat(String(v).replace(/[^0-9.-]+/g, '')))
    .filter((n) => !Number.isNaN(n) && n > 5 && n < 60);
  return posibles.length > 0 ? posibles[0] : null;
};

/** La fecha más reciente que aparezca en el registro (AAAA-MM-DD). */
export const mejorFechaRegistro = (row: Datos | null | undefined): string => {
  let mejor = '';
  Object.values(row || {}).forEach((v) => {
    const iso = normalizarFechaResumen(v);
    if (iso && iso > mejor) mejor = iso;
  });
  return mejor;
};

/** ¿Cancelada? (por id o por nombre del status). */
export const esCanceladaDelDia = (op: Datos): boolean => op.status === STATUS_CANCELADO || sinAcentos(op.statusNombre).includes('cancel');

/** ¿Completada? (la regla de la tarjeta: por id o por nombre, y no cancelada). */
export const esCompletadaDelDia = (op: Datos): boolean =>
  !esCanceladaDelDia(op) && (STATUS_COMPLETADOS.includes(String(op.status ?? '')) || sinAcentos(op.statusNombre).includes('complet'));

export type TipoCompletada = 'cruces' | 'transfer' | 'fletes' | 'renta' | 'otros';

/** Tipo de operación para el desglose de completadas (V00409). */
export const tipoCompletada = (op: Datos): TipoCompletada => {
  const tipo = sinAcentos(op.tipoOperacionNombre);
  if (tipo.includes('flete')) return 'fletes';
  if (tipo.includes('logistica')) return 'cruces';
  if (tipo.includes('transfer')) return 'transfer';
  if (tipo.includes('renta')) return 'renta';
  return 'otros';
};

export interface ConteoDelDia {
  totalHoy: number;
  completadasHoy: number;
  canceladasHoy: number;
  completadasPorTipo: Record<TipoCompletada, number>;
}

/** Conteo de las operaciones con fecha de servicio de hoy (tarjeta Operaciones del día). */
export const contarDelDia = (ops: readonly Datos[]): ConteoDelDia => {
  const c: ConteoDelDia = { totalHoy: 0, completadasHoy: 0, canceladasHoy: 0, completadasPorTipo: { cruces: 0, transfer: 0, fletes: 0, renta: 0, otros: 0 } };
  ops.forEach((op) => {
    c.totalHoy += 1;
    if (esCanceladaDelDia(op)) c.canceladasHoy += 1;
    else if (esCompletadaDelDia(op)) {
      c.completadasHoy += 1;
      c.completadasPorTipo[tipoCompletada(op)] += 1;
    }
  });
  return c;
};

/** Registro de tipo de cambio para el modal. */
export interface FilaTipoCambio { id: string; fecha: string; dia: string; tc: number; variacion: number | null; creadoEn: string; }

/** Tipos de cambio del más reciente al más antiguo, con la variación contra el registro anterior. */
export const filasTipoCambio = (regs: readonly (Datos & { id: string })[]): FilaTipoCambio[] => {
  const base = regs
    .map((r) => ({ id: r.id, fecha: normalizarFechaResumen(r.fecha) || mejorFechaRegistro(r), dia: String(r.dia ?? ''), tc: extraerTipoCambio(r), creadoEn: String(r.createdAt ?? '') }))
    .filter((r): r is Omit<FilaTipoCambio, 'variacion'> & { tc: number } => r.tc != null)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn.localeCompare(a.creadoEn));
  return base.map((r, i) => ({ ...r, variacion: i + 1 < base.length ? Math.round((r.tc - base[i + 1].tc) * 10000) / 10000 : null }));
};

/**
 * Captura de diesel para el modal.
 * ✅ V00460: `descuento` por galón (Murphy descuenta $0.20, los demás 0) y `costoReal` = costo − descuento.
 */
export interface FilaDiesel { id: string; fecha: string; proveedor: string; costo: number; descuento: number; costoReal: number; creadoEn: string; masBajoDelDia: boolean; }

/**
 * Capturas de diesel del más reciente al más antiguo; marca la más baja de cada día.
 * ✅ V00460: la más baja por COSTO REAL (lo que de verdad se paga por galón). El descuento
 *   vale para todas las fechas: aquí solo se muestra, no mueve ningún saldo.
 */
export const filasDiesel = (regs: readonly (Datos & { id: string })[]): FilaDiesel[] => {
  const base = regs
    .map((r) => {
      const costo = Number(r.costo) || 0;
      const proveedor = String(r.proveedor ?? '');
      const descuento = esCargaMurphy({ proveedorNombre: proveedor }) ? DESCUENTO_MURPHY_POR_GALON : 0;
      return { id: r.id, fecha: normalizarFechaResumen(r.fecha), proveedor, costo, descuento, costoReal: Math.round((costo - descuento) * 10000) / 10000, creadoEn: String(r.createdAt ?? '') };
    })
    .filter((r) => r.costo > 0)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn.localeCompare(a.creadoEn));
  const minimo = new Map<string, number>();
  base.forEach((r) => { if (!minimo.has(r.fecha) || r.costoReal < (minimo.get(r.fecha) ?? Infinity)) minimo.set(r.fecha, r.costoReal); });
  const marcado = new Set<string>();
  return base.map((r) => {
    const esMin = r.costoReal === minimo.get(r.fecha) && !marcado.has(r.fecha);
    if (esMin) marcado.add(r.fecha);
    return { ...r, masBajoDelDia: esMin };
  });
};

/** Galones → litros (para el precio por litro del diesel). */
export const LITROS_POR_GALON = 3.78541;

// src/features/facturacion/services/cuadreFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00522 — ¿La SUMA de las operaciones de una factura (lo que cobra cada una en su renglón, en la
// moneda de la factura) es igual a su TOTAL? Lo usan la columna Referencias del Historial (el importe
// de cada referencia) y la pestaña Corregir (las que no cuadran). Solo lee: no cambia ningún total.
// Puro: sin Firebase ni React.
// ---------------------------------------------------------------------------
import { aCentavos } from '../../../shared/dominio/numeros';
import { estaCancelada, importesDeRenglones } from './reglasFactura';

/** Por qué no cuadra (o 'cuadra'). */
export type MotivoCuadre = 'cuadra' | 'diferencia' | 'iva' | 'sinMontos' | 'sinOperaciones';

export interface CuadreFactura {
  /** Lo que cobra cada renglón en la moneda de la factura (mismo orden que operacionesGuardadas). */
  importes: number[];
  suma: number;
  total: number;
  /** total − suma (positivo: el total es mayor que sus operaciones). */
  diferencia: number;
  motivo: MotivoCuadre;
}

/** IVA de las facturas viejas que guardaron el total con impuestos. */
export const TASA_IVA = 0.16;

export const TEXTO_MOTIVO: Record<Exclude<MotivoCuadre, 'cuadra'>, string> = {
  diferencia: 'Sus operaciones no suman el total',
  iva: 'La diferencia es el IVA (16%)',
  sinMontos: 'No guardó lo que cobró cada operación',
  sinOperaciones: 'No tiene operaciones',
};

/** Compara la suma de los renglones con el total (en centavos). */
export const cuadreDeFactura = (renglones: unknown, moneda: unknown, total: number): CuadreFactura => {
  const importes = importesDeRenglones(moneda, renglones).map((x) => aCentavos(x) / 100);
  const sumaC = importes.reduce((s, x) => s + aCentavos(x), 0);
  const totalC = aCentavos(total);
  const base = { importes, suma: sumaC / 100, total: totalC / 100, diferencia: (totalC - sumaC) / 100 };
  if (sumaC === totalC) return { ...base, motivo: 'cuadra' };
  if (importes.length === 0) return { ...base, motivo: 'sinOperaciones' };
  if (sumaC === 0) return { ...base, motivo: 'sinMontos' };
  if (Math.abs(Math.round(sumaC * (1 + TASA_IVA)) - totalC) <= 1) return { ...base, motivo: 'iva' };
  return { ...base, motivo: 'diferencia' };
};

/** Una factura (fila del Historial) que no cuadra. */
export interface FacturaPorCorregir<T> { fila: T; cuadre: CuadreFactura }

/**
 * Las facturas que no cuadran, las más nuevas primero. Las canceladas no se revisan (no suman en los
 * totales). `datos` da, por fila, sus renglones, su moneda, su total, su status y su fecha (AAAA-MM-DD).
 */
export const facturasQueNoCuadran = <T>(
  filas: readonly T[],
  datos: (f: T) => { renglones: unknown; moneda: unknown; total: number; status: unknown; fecha: string },
): FacturaPorCorregir<T>[] =>
  filas
    .map((fila) => ({ fila, d: datos(fila) }))
    .filter(({ d }) => !estaCancelada(d.status))
    .map(({ fila, d }) => ({ fila, fecha: d.fecha, cuadre: cuadreDeFactura(d.renglones, d.moneda, d.total) }))
    .filter((x) => x.cuadre.motivo !== 'cuadra')
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
    .map(({ fila, cuadre }) => ({ fila, cuadre }));

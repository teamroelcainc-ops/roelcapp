// src/utils/sueldoFalso.ts
// ✅ V00387: MOVIMIENTO EN FALSO → el sueldo del operador cambia al entrar a un estatus cuyo nombre
//   contiene "Falso" (ej. "7. Falso"); el completo queda en `sueldoOperadorCompleto` y, si la
//   operación sale de Falso, se restaura. `sueldoMitadAplicada` (nombre de la V00387: hoy significa
//   "ya se aplicó el sueldo de Falso") evita aplicarlo dos veces. Sueldo Total = Sueldo + Extra.
// ✅ V00511 (regla del usuario, 29-oct): en Falso el sueldo ya no es la mitad, es FIJO según el
//   movimiento de la operación (la misma clasificación de Estadísticas y del Reporte de empresas):
//     · cruce de Importación o de Exportación → $200 pesos
//     · Movimiento → $150 pesos
//     · sin clasificar → el sueldo no se toca
//   y el DIESEL (combustible, en galones) queda en 3; el que traía queda en `combustibleCompleto`
//   (marca `combustibleFalsoAplicado`) y regresa al salir de Falso. Lo extra (sueldo y combustible)
//   no se toca. Nunca sube: si el sueldo o el combustible ya eran menores, se quedan; con 0 (trompo,
//   unidad de proveedor sin diesel) no se toca nada.
//   Las operaciones que ya estaban en Falso antes de la V00511 se quedan como están; al salir de
//   Falso regresan su sueldo completo como siempre.
import { movimientoDeOperacion } from '../features/operaciones/services/clasificacionOperacion';

const normalizar = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export const esStatusFalso = (statusNombre: unknown): boolean => /\bFALSO\b/.test(normalizar(statusNombre));

/** Sueldo del operador en Falso (pesos). */
export const SUELDO_FALSO_CRUCE = 200;
export const SUELDO_FALSO_MOVIMIENTO = 150;
/** Diesel (galones) de una operación en Falso. */
export const GALONES_FALSO = 3;

type Datos = Record<string, unknown>;
const num = (v: unknown): number => Number(v) || 0;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Sueldo de Falso para la operación (null = sin clasificar: no se toca). */
export const sueldoFalsoDe = (op: Datos): number | null => {
  const mov = movimientoDeOperacion(op);
  if (mov === 'Importación' || mov === 'Exportación') return SUELDO_FALSO_CRUCE;
  if (mov === 'Movimiento') return SUELDO_FALSO_MOVIMIENTO;
  return null;
};

const ajusteSueldo = (op: Datos, falso: boolean): Record<string, number | boolean> => {
  const aplicada = op.sueldoMitadAplicada === true;
  const sueldo = num(op.sueldoOperador);
  const extra = num(op.sueldoExtra);
  if (falso && !aplicada) {
    const fijo = sueldoFalsoDe(op);
    if (!sueldo || fijo === null) return {};
    const nuevo = Math.min(fijo, sueldo);
    return { sueldoOperadorCompleto: sueldo, sueldoOperador: nuevo, sueldoTotal: r2(nuevo + extra), sueldoMitadAplicada: true };
  }
  if (!falso && aplicada) {
    const completo = num(op.sueldoOperadorCompleto) || sueldo * 2;
    return { sueldoOperador: completo, sueldoTotal: r2(completo + extra), sueldoMitadAplicada: false };
  }
  return {};
};

const ajusteCombustible = (op: Datos, falso: boolean): Record<string, number | boolean> => {
  const aplicado = op.combustibleFalsoAplicado === true;
  const base = num(op.combustible);
  const extra = num(op.combustibleExtra);
  if (falso && !aplicado) {
    if (!(base > 0)) return {};
    const nuevo = Math.min(GALONES_FALSO, base);
    return { combustibleCompleto: base, combustible: nuevo, combustibleTotal: nuevo + extra, combustibleFalsoAplicado: true };
  }
  if (!falso && aplicado) {
    const completo = num(op.combustibleCompleto) || base;
    return { combustible: completo, combustibleTotal: completo + extra, combustibleFalsoAplicado: false };
  }
  return {};
};

/** Campos del operador (sueldo y diesel) a fusionar en la operación según el estatus al que llega ({} si no cambia nada). */
export const ajusteOperadorPorStatus = (op: Datos | null | undefined, statusNombre: unknown): Record<string, number | boolean> => {
  if (!op) return {};
  const falso = esStatusFalso(statusNombre);
  return { ...ajusteSueldo(op, falso), ...ajusteCombustible(op, falso) };
};

// src/utils/sueldoFalso.ts
// ✅ V00387: MOVIMIENTO EN FALSO → el sueldo del operador se paga a la MITAD.
//   Al llegar a un estatus cuyo nombre contiene "Falso" (ej. "7. Falso") el
//   Sueldo Operador se divide entre 2 (400 → 200) y se guarda el completo en
//   `sueldoOperadorCompleto`; si la operación sale de Falso, se restaura.
//   `sueldoMitadAplicada` evita dividirlo dos veces. Sueldo Total = Sueldo + Extra.

const normalizar = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export const esStatusFalso = (statusNombre: unknown): boolean => /\bFALSO\b/.test(normalizar(statusNombre));

type OpSueldo = { sueldoOperador?: unknown; sueldoExtra?: unknown; sueldoMitadAplicada?: unknown; sueldoOperadorCompleto?: unknown } | null | undefined;

/** Campos a fusionar en la operación según el estatus al que llega ({} si no cambia nada). */
export const ajusteSueldoPorStatus = (op: OpSueldo, statusNombre: unknown): Record<string, number | boolean> => {
  if (!op) return {};
  const falso = esStatusFalso(statusNombre);
  const aplicada = op.sueldoMitadAplicada === true;
  const sueldo = Number(op.sueldoOperador) || 0;
  const extra = Number(op.sueldoExtra) || 0;
  if (falso && !aplicada) {
    if (!sueldo) return {};
    const mitad = Math.round((sueldo / 2) * 100) / 100;
    return { sueldoOperadorCompleto: sueldo, sueldoOperador: mitad, sueldoTotal: mitad + extra, sueldoMitadAplicada: true };
  }
  if (!falso && aplicada) {
    const completo = Number(op.sueldoOperadorCompleto) || sueldo * 2;
    return { sueldoOperador: completo, sueldoTotal: completo + extra, sueldoMitadAplicada: false };
  }
  return {};
};

// src/shared/utils/formatos.ts
// ---------------------------------------------------------------------------
// ✅ V00540 — Formatos para mostrar (una sola copia). Lo que se calcula va en src/shared/dominio.
// ---------------------------------------------------------------------------
import { aNumero } from '../dominio/numeros';

/** "$ 1,234.50" (siempre 2 decimales; acepta "1,234.50" y "$1,234.50"). Lo que no es número → "$ 0.00". */
export const formatearMoneda = (monto: unknown): string => {
  const num = aNumero(monto);
  return Number.isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

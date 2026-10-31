// src/features/operaciones/services/correccion.ts
// ✅ V00538 — Tipos de las correcciones de la Revisión de datos (lo que devuelve "aplicar" y lo que
// pinta PasosCorreccion). Cada herramienta nueva devuelve esto; F1, D3 y Corregir desglose tienen
// los suyos (se unifican en el paso 7 del refactor).
import type { CeldaExcel } from './excelOperaciones';

export interface OmitidaCorreccion {
  id: string;
  ref: string;
  motivo: string;
}

export interface ResultadoCorreccion {
  /** Cuántos registros se escribieron. */
  hechas: number;
  /** Los que no se escribieron y por qué (cambiaron desde la prueba, ya no existen…). */
  omitidas: OmitidaCorreccion[];
  /** Error que detuvo la corrección ('' = terminó). Lo escrito antes del error ya quedó. */
  error: string;
}

export interface PruebaCorreccion {
  filas: Record<string, CeldaExcel>[];
  columnasMoneda: string[];
}

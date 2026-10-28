// src/features/operaciones/services/clasificacionOperacion.ts
// ---------------------------------------------------------------------------
// ✅ V00507 — MOVIMIENTO DE UNA OPERACIÓN (Importación / Exportación / Movimiento), lógica pura.
// Es la regla que usaba Estadísticas dentro de su componente (V00468); salió aquí para que el
// Reporte de empresas cuente igual. Estadísticas la importa sin cambios:
//   1) la clasificación MANUAL (`movimientoManual`, modal "Sin clasificar" de Estadísticas) manda;
//   2) si no, el texto del convenio + tipo de operación + tipo de servicio: "impo", "expo", "mov".
// ---------------------------------------------------------------------------

type Datos = Record<string, unknown>;

export type Movimiento = 'Importación' | 'Exportación' | 'Movimiento' | 'Sin clasificar';

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const norm = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Texto clasificable de la operación (convenio + tipo de operación + tipo de servicio), sin acentos y en minúsculas. */
export const textoDeOperacion = (op: Datos): string =>
  norm(`${txt(op.convenioNombre || '')} ${txt(op.tipoOperacionNombre || op.tipoOperacion || '')} ${txt(op.tipoServicioNombre || op.tipoServicio || '')}`);

/** Movimiento según un texto ya normalizado ("impo", "expo", "mov"). */
export const movimientoDeTexto = (t: string): Movimiento => {
  if (t.includes('impo')) return 'Importación';
  if (t.includes('expo')) return 'Exportación';
  if (t.includes('mov')) return 'Movimiento';
  return 'Sin clasificar';
};

/** Movimiento de la operación: la clasificación manual y, si no hay, su texto. */
export const movimientoDeOperacion = (op: Datos): Movimiento => {
  const manual = txt(op.movimientoManual);
  if (manual === 'Importación' || manual === 'Exportación' || manual === 'Movimiento') return manual;
  return movimientoDeTexto(textoDeOperacion(op));
};

/** Normaliza un texto suelto (p. ej. el nombre del tráfico) para movimientoDeTexto. */
export const normalizarMovimiento = (v: unknown): string => norm(txt(v));

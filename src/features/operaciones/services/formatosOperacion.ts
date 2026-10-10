// src/features/operaciones/services/formatosOperacion.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — formatos puros de las tablas de operaciones. Antes
// COPIADOS idénticos en OperacionesDashboard, ServiciosCompletados y
// ServiciosCancelados. (El formulario tiene su propio colorTipoOperacion con
// 'logist' antes que 'flete': diferencia anotada en code-notes, no se unificó.)
// ---------------------------------------------------------------------------

/** Fecha y hora legibles para la auditoría de referencias. */
export const fmtFechaAuditoria = (iso: unknown): string => {
  try {
    const d = new Date(String(iso));
    if (isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(iso || ''); }
};

/**
 * Color por TIPO DE OPERACIÓN: Transfer → naranja, Fletes → verde, Logística → azul; otro → neutro.
 * ✅ V00177: 'flete' se evalúa ANTES que 'logist' ("Logistica Fletes" se pinta VERDE).
 */
export const colorTipoOperacion = (nombre: unknown): string => {
  const n = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.includes('transfer')) return '#fb923c';
  if (n.includes('flete')) return '#3fb950';
  if (n.includes('logist')) return '#58a6ff';
  return '#c9d1d9';
};

/**
 * Quita las claves `undefined` antes de escribir en Firestore (las rechaza con "Unsupported field
 * value: undefined" y aborta el batch completo — causa típica de "Se revirtió el cambio").
 */
export const limpiarUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const out: Partial<T> = {};
  (Object.keys(obj) as (keyof T)[]).forEach((k) => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
};

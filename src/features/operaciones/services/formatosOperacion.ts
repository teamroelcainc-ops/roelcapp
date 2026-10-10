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
 * Ordena nombres de status por su número inicial (1, 3, 4.1, 5 … 10.1, 10.3 …) y, con el mismo
 * número, alfabéticamente. Los que no empiezan con número van al final, alfabéticamente.
 */
export const compararStatusPorNumero = (a: string, b: string): number => {
  const parse = (s: string): number[] | null => {
    const m = String(s ?? '').trim().match(/^(\d+(?:\.\d+)*)/);
    return m ? m[1].split('.').map((n) => parseInt(n, 10)) : null;
  };
  const na = parse(a);
  const nb = parse(b);
  if (na && nb) {
    const len = Math.max(na.length, nb.length);
    for (let i = 0; i < len; i++) {
      const da = na[i] ?? 0;
      const db = nb[i] ?? 0;
      if (da !== db) return da - db;
    }
    return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
  }
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
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

// src/features/operaciones/services/auditoriaLog.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — utilidades del Historial de Actividad de operaciones
// (antes COPIADAS idénticas en FormularioOperacion.tsx y ServiciosCompletados.tsx).
// Nunca deben romper el guardado: los llamados a registrarLog van con .catch.
// ---------------------------------------------------------------------------
type Datos = Record<string, unknown>;

const comparable = (x: unknown): string => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? ''));

export const truncarValorLog = (v: unknown): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '(vacío)';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
};

/** "campo: viejo → nuevo" de los campos que cambiaron (hasta 15, para el log). */
export const describirCambiosLog = (nuevo: Datos | null | undefined, anterior: Datos | null | undefined, etiquetas: Record<string, string> = {}): string => {
  const cambios: string[] = [];
  Object.keys(nuevo || {}).forEach((k) => {
    const a = anterior ? anterior[k] : undefined;
    const n = (nuevo as Datos)[k];
    if (comparable(a) === comparable(n)) return;
    cambios.push(`${etiquetas[k] || k}: "${truncarValorLog(a)}" → "${truncarValorLog(n)}"`);
  });
  if (cambios.length === 0) return 'sin cambios de valor detectados';
  const visibles = cambios.slice(0, 15);
  const resto = cambios.length - visibles.length;
  return visibles.join(' | ') + (resto > 0 ? ` | ...y ${resto} campos más` : '');
};

/**
 * Auditoría NO editable: lista completa de cambios "campo: viejo → nuevo" (hasta 40) que se guarda
 * DENTRO de la operación (historialEdiciones): cuántas veces se editó, quién y qué cambió.
 */
export const listaCambiosAuditoria = (nuevo: Datos | null | undefined, anterior: Datos | null | undefined, etiquetas: Record<string, string> = {}): string[] => {
  const cambios: string[] = [];
  Object.keys(nuevo || {}).forEach((k) => {
    if (k === 'historialEdiciones' || k === 'creadoPor' || k === 'creadoEn') return;
    const a = anterior ? anterior[k] : undefined;
    const n = (nuevo as Datos)[k];
    if (comparable(a) === comparable(n)) return;
    cambios.push(`${etiquetas[k] || k}: "${truncarValorLog(a)}" → "${truncarValorLog(n)}"`);
  });
  return cambios.slice(0, 40);
};

/** Campos capturados al crear (hasta 20, para el log). */
export const describirCamposCapturadosLog = (datos: Datos | null | undefined, etiquetas: Record<string, string> = {}): string => {
  const d = datos || {};
  const claves = Object.keys(d).filter((k) => {
    const v = d[k];
    return v !== '' && v !== null && v !== undefined && v !== false;
  });
  const visibles = claves.slice(0, 20);
  const resto = claves.length - visibles.length;
  return visibles.map((k) => `${etiquetas[k] || k}: "${truncarValorLog(d[k])}"`).join(' | ') + (resto > 0 ? ` | ...y ${resto} campos más` : '');
};

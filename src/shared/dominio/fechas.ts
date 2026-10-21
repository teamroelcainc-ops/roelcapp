// src/shared/dominio/fechas.ts — ✅ V00436: fechas de servicio a ISO (AAAA-MM-DD).
// La base tiene tres formatos en `fechaServicio`: ISO, Timestamp y d/m/aaaa
// (operaciones migradas de AppSheet). Las consultas por rango solo funcionan
// con un formato: el canónico es `fechaServicioISO` (Fase 4).

const pad2 = (n: number): string => String(n).padStart(2, '0');

const esFechaValida = (y: number, m: number, d: number): boolean => {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
};

/**
 * Cualquier representación de fecha → 'AAAA-MM-DD' (o null si no se reconoce).
 * · 'AAAA-MM-DD' o 'AAAA-MM-DDTHH:mm…' (ISO)
 * · 'd/m/aaaa', 'dd/mm/aa', 'd-m-aaaa' (formato mexicano: día primero)
 * · Timestamp de Firestore ({ toDate() } o { seconds }), Date
 * Las fechas Date/Timestamp se toman en hora LOCAL (igual que fechaHoraLocal.ts).
 */
export const aFechaISO = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toDate === 'function') return aFechaISO(o.toDate());
    const s = typeof o.seconds === 'number' ? o.seconds : typeof o._seconds === 'number' ? o._seconds : null;
    if (s != null) return aFechaISO(new Date(s * 1000));
    return null;
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = Number(m[1]); const mes = Number(m[2]); const d = Number(m[3]);
    return esFechaValida(y, mes, d) ? `${y}-${pad2(mes)}-${pad2(d)}` : null;
  }
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    const d = Number(m[1]); const mes = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y += 2000;
    return esFechaValida(y, mes, d) ? `${y}-${pad2(mes)}-${pad2(d)}` : null;
  }
  return null;
};

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' para mostrar (formato usado en la app). */
export const isoADma = (iso: string | null | undefined): string => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/**
 * ✅ V00440 (Fase 4) — FECHA DE SERVICIO → 'AAAA-MM-DD' para el campo canónico
 * `fechaServicioISO`. Es la regla de "⚡ Acelerar búsquedas" (V00310), que ya
 * escribió ese campo en muchas operaciones, para que servidor, migración y
 * pantalla den SIEMPRE el mismo día:
 * · Timestamp / Date / número epoch → fecha en UTC (no depende de la zona
 *   horaria de la máquina que corre la migración).
 * · 'd/m/aaaa' (día primero); si el primero es ≤ 12 y el segundo > 12 → 'm/d/aaaa'.
 * · ISO tal cual; otro texto que el motor de fechas entienda → su fecha.
 * Devuelve null si no se reconoce (nunca escribe basura).
 */
export const aFechaServicioISO = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const deDate = (d: Date): string | null => (Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10));
  if (v instanceof Date) return deDate(v);
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? deDate(new Date(v > 1e12 ? v : v * 1000)) : null;
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toDate === 'function') return deDate(o.toDate());
    const s = typeof o.seconds === 'number' ? o.seconds : typeof o._seconds === 'number' ? o._seconds : null;
    return s != null ? deDate(new Date(s * 1000)) : null;
  }
  const t = String(v).trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = Number(m[1]); const mes = Number(m[2]); const d = Number(m[3]);
    return esFechaValida(y, mes, d) ? `${y}-${pad2(mes)}-${pad2(d)}` : null;
  }
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?!\d)/);
  if (m) {
    let d = Number(m[1]); let mes = Number(m[2]);
    if (d <= 12 && mes > 12) [d, mes] = [mes, d];
    let y = Number(m[3]);
    if (m[3].length === 2) y += 2000;
    return esFechaValida(y, mes, d) ? `${y}-${pad2(mes)}-${pad2(d)}` : null;
  }
  if (/^\d+$/.test(t)) return aFechaServicioISO(Number(t));
  return deDate(new Date(t));
};

/**
 * ✅ V00469: fecha de servicio de una OPERACIÓN en AAAA-MM-DD: el canónico `fechaServicioISO` o, si
 * falta, `fechaServicio` convertida (las de AppSheet vienen en d/m/aaaa o como Timestamp). '' si no
 * se reconoce. Para comparar o armar ids con la fecha (un "15/10/2026" partía el id de un documento).
 */
export const fechaServicioDeOperacion = (op: Record<string, unknown>): string =>
  String(op.fechaServicioISO || '').slice(0, 10) || aFechaServicioISO(op.fechaServicio) || '';

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

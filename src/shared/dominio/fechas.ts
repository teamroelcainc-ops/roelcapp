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

// ── ✅ V00501 — DESGLOSE DE UNA FECHA como lo cuenta Roelca ─────────────────
// (Estadísticas Operativas → Diario "mes · semana · día · fecha", y el Excel de operaciones).
export const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;
/** Índice = día de la semana de `Date` (0 = domingo). */
export const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;

const partesISO = (iso: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(y, mes - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d ? [y, mes, d] : null;
};

/**
 * Semana del año: de lunes a domingo; la semana 1 es la del 1 de enero (aunque no empiece en lunes).
 * Se cuenta en UTC: con la hora local, el cambio de horario de verano pasaba cada lunes a la
 * semana anterior (de marzo a noviembre en Texas). 0 si la fecha no es válida.
 */
export const semanaDelAnio = (iso: string): number => {
  const p = partesISO(iso);
  if (!p) return 0;
  const [y, mes, d] = p;
  const enero1 = Date.UTC(y, 0, 1);
  const dia = Math.round((Date.UTC(y, mes - 1, d) - enero1) / 86400000);
  const corrimiento = (new Date(enero1).getUTCDay() + 6) % 7; // lunes = 0
  return Math.floor((dia + corrimiento) / 7) + 1;
};

export interface PartesFecha { anio: number; mes: string; semana: number; dia: string }

/** Año, mes (nombre), semana del año y día de la semana (nombre) de una fecha AAAA-MM-DD; null si no es válida. */
export const partesDeFecha = (iso: string): PartesFecha | null => {
  const p = partesISO(iso);
  if (!p) return null;
  const [y, mes, d] = p;
  return { anio: y, mes: NOMBRES_MES[mes - 1], semana: semanaDelAnio(iso), dia: NOMBRES_DIA[new Date(Date.UTC(y, mes - 1, d)).getUTCDay()] };
};

// ── ✅ V00535: fecha corta para mostrar y "hoy" en la zona de las operaciones ──

/**
 * Fecha corta en español para MOSTRAR ("31 oct 2026"), de cualquier representación que entienda
 * aFechaISO. Nunca con `new Date('AAAA-MM-DD')`: esa la lee en UTC y en México muestra el día anterior.
 * '' si no se reconoce.
 */
export const fechaCortaEs = (v: unknown): string => {
  const iso = aFechaISO(v);
  const p = iso ? partesISO(iso) : null;
  if (!p) return '';
  const [y, mes, d] = p;
  return new Date(y, mes - 1, d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Zona horaria de las operaciones de Roelca (Nuevo Laredo, Tamaulipas: la franja fronteriza sigue el
 * horario de verano de EE. UU., como Laredo, Texas). La usa el "hoy" del DOMINIO, que corre igual en
 * la web y en las Cloud Functions (que están en UTC): así los dos dan el mismo día. El "hoy" de las
 * pantallas sigue en `src/utils/fechaHoraLocal.ts` (ZONA_HORARIA_OPERACIONES, hoy null = el dispositivo).
 */
export const ZONA_HORARIA_DOMINIO = 'America/Matamoros';

/** 'AAAA-MM-DD' de `ahora` en una zona horaria (Intl). Con una zona inválida, la fecha UTC. */
export const hoyEnZona = (zona: string, ahora: Date = new Date()): string => {
  try {
    const partes = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(ahora).map((parte) => [parte.type, parte.value]),
    );
    if (partes.year && partes.month && partes.day) return `${partes.year}-${partes.month}-${partes.day}`;
  } catch { /* zona inválida: abajo */ }
  return ahora.toISOString().slice(0, 10);
};

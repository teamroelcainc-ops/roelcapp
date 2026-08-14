// src/utils/fechaHoraLocal.ts
//
// ✅ FIX HORARIOS/FECHAS DE OPERACIONES
//
// PROBLEMA DETECTADO: en muchos módulos se calculaba la fecha "de hoy" con
//   new Date().toISOString().split('T')[0]
// Eso devuelve la fecha en horario UTC (Inglaterra), NO la fecha local.
// En México / Texas (UTC-5 / UTC-6), a partir de las ~6-7 PM el resultado ya
// es la fecha de MAÑANA. Por eso las operaciones, referencias y horarios
// creados por la tarde/noche aparecían con la fecha "cambiada" al día
// siguiente (y el consecutivo LO-DDMMYY-### se generaba con el día equivocado).
//
// Este módulo centraliza el cálculo de fecha/hora "de hoy" usando el reloj
// LOCAL del dispositivo, o bien una ZONA HORARIA FIJA de la empresa si se
// configura abajo. Con la zona fija, todos los usuarios registran la misma
// hora sin importar cómo esté configurada la zona horaria de su computadora
// o celular.
//
// ⚠️ NOTA: si el RELOJ de la computadora está mal (hora incorrecta), ninguna
// solución de código lo puede corregir al 100%; se recomienda activar
// "Establecer hora automáticamente" en Windows/Android/iOS.

// ──────────────────────────────────────────────────────────────────────
// ZONA HORARIA FIJA DE LA EMPRESA (opcional).
//   · null  -> usa la zona horaria configurada en el dispositivo (default).
//   · 'America/Monterrey'   -> centro de México SIN horario de verano.
//   · 'America/Matamoros'   -> franja fronteriza (sigue horario de verano USA).
//   · 'America/Chicago'     -> hora del centro de EE.UU. (Texas).
// Si la defines, TODAS las fechas y horas de operaciones se calculan en esa
// zona sin importar la configuración de cada compu.
// ──────────────────────────────────────────────────────────────────────
export const ZONA_HORARIA_OPERACIONES: string | null = null;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Piezas de fecha/hora del instante dado en la zona configurada (o local). */
const piezas = (d: Date): { y: string; m: string; dd: string; hh: string; mi: string } => {
  if (ZONA_HORARIA_OPERACIONES) {
    try {
      // en-CA da formato "YYYY-MM-DD, HH:mm" estable para parsear por partes.
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA_HORARIA_OPERACIONES,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const p: Record<string, string> = {};
      fmt.formatToParts(d).forEach(part => { p[part.type] = part.value; });
      if (p.year && p.month && p.day) {
        // hour puede venir como "24" en algunos motores; se normaliza a "00".
        const hh = p.hour === '24' ? '00' : (p.hour || '00');
        return { y: p.year, m: p.month, dd: p.day, hh, mi: p.minute || '00' };
      }
    } catch { /* zona inválida -> cae al reloj local */ }
  }
  return {
    y: String(d.getFullYear()),
    m: pad2(d.getMonth() + 1),
    dd: pad2(d.getDate()),
    hh: pad2(d.getHours()),
    mi: pad2(d.getMinutes()),
  };
};

/** Fecha de HOY en formato ISO "YYYY-MM-DD" (para inputs type="date"). */
export const hoyLocalISO = (): string => {
  const { y, m, dd } = piezas(new Date());
  return `${y}-${m}-${dd}`;
};

/** Fecha y hora ACTUAL "YYYY-MM-DDTHH:mm" (para inputs type="datetime-local"
 *  y para el campo `fechaHora` de la colección `horarios`). */
export const ahoraLocalISOCorto = (): string => {
  const { y, m, dd, hh, mi } = piezas(new Date());
  return `${y}-${m}-${dd}T${hh}:${mi}`;
};

/** Convierte un Date (p. ej. Timestamp.toDate()) a "YYYY-MM-DD" LOCAL,
 *  sin el brinco de día que provoca toISOString() (UTC). */
export const fechaLocalISO = (d: Date): string => {
  const { y, m, dd } = piezas(d);
  return `${y}-${m}-${dd}`;
};

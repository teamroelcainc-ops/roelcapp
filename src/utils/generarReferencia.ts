// src/utils/generarReferencia.ts
//
// Genera la referencia legible de una operación con el formato:
//   <PREFIJO>-<DDMMYY>-<NNN>     ej.  TR-160626-001
//
//   · PREFIJO : clave del tipo de operación (TR / LO / FL / OP …). Se obtiene
//               traduciendo el nombre del tipo de operación con
//               `prefijoTipoOperacion()` (TRANSFER -> TR, LOGISTICA -> LO,
//               FLETE -> FL). Así puedes pasar el nombre completo y aquí se
//               convierte al prefijo corto.
//   · DDMMYY  : día/mes/año en 2 dígitos cada uno (16 jun 2026 -> 160626).
//   · NNN     : consecutivo IRREPETIBLE de ese día (lo entrega la transacción
//               del contador por día en operacionesService.ts), con 3 dígitos.
//
// IMPORTANTE: la unicidad del consecutivo la garantiza la transacción de
// Firestore (contador por día). Aquí solo se da formato.

// Fecha de hoy (o la que se pase) en formato DDMMYY.
export const fechaDDMMYY = (d: Date = new Date()): string => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
};

// ──────────────────────────────────────────────────────────────────────
// ✅ Traduce el NOMBRE del tipo de operación a su PREFIJO de 2 letras.
//    TRANSFER  -> TR
//    LOGISTICA -> LO   (acepta "logística" con acento)
//    FLETE     -> FL   (acepta "flete" y "fletes")
//
//    · Si ya recibe un prefijo corto válido (TR/LO/FL/OP), lo respeta.
//    · Si no reconoce el valor, usa las 2 primeras letras en mayúscula como
//      respaldo (o 'OP' si viene vacío).
// ──────────────────────────────────────────────────────────────────────
export const prefijoTipoOperacion = (tipo: string): string => {
  // Normaliza: sin acentos, mayúsculas, sin espacios extra.
  const t = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  if (!t) return 'OP';

  // Si ya es un prefijo corto conocido, se respeta tal cual.
  if (['TR', 'LO', 'FL', 'OP'].includes(t)) return t;

  // Mapeo por contenido del nombre (tolera variantes y plurales).
  if (t.includes('TRANSFER')) return 'TR';
  if (t.includes('LOGIST')) return 'LO';
  if (t.includes('FLETE')) return 'FL';

  // Respaldo: primeras 2 letras del nombre.
  return t.replace(/[^A-Z0-9]/g, '').slice(0, 2) || 'OP';
};

// Arma la referencia final. `ddmmyy` es opcional: por defecto usa el día actual,
// pero el servicio lo pasa explícito para que coincida con la llave del contador.
//
// `prefijo` puede ser el NOMBRE completo del tipo de operación (TRANSFER,
// LOGISTICA, FLETE) o ya el prefijo corto (TR/LO/FL): en ambos casos se
// normaliza con prefijoTipoOperacion().
export const generarReferencia = (
  prefijo: string,
  correlativo: number,
  ddmmyy: string = fechaDDMMYY(),
): string => {
  const pref = prefijoTipoOperacion(prefijo);
  const fecha = String(ddmmyy || fechaDDMMYY()).trim();
  const consec = String(Math.max(1, Number(correlativo) || 1)).padStart(3, '0');
  return `${pref}-${fecha}-${consec}`;
};
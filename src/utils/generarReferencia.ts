// src/utils/generarReferencia.ts
//
// Genera la referencia legible de una operación con el formato:
//   <PREFIJO>-<DDMMYY>-<NNN>     ej.  TR-160626-001
//
//   · PREFIJO : clave del tipo de operación (TR / LO / FL / OP …). Lo resuelve
//               el servicio a partir del catálogo de tipos de operación.
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

// Arma la referencia final. `ddmmyy` es opcional: por defecto usa el día actual,
// pero el servicio lo pasa explícito para que coincida con la llave del contador.
export const generarReferencia = (
  prefijo: string,
  correlativo: number,
  ddmmyy: string = fechaDDMMYY(),
): string => {
  const pref = String(prefijo || 'OP').toUpperCase().trim();
  const fecha = String(ddmmyy || fechaDDMMYY()).trim();
  const consec = String(Math.max(1, Number(correlativo) || 1)).padStart(3, '0');
  return `${pref}-${fecha}-${consec}`;
};
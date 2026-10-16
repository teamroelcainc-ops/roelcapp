// src/shared/dominio/tipoCambio.ts
// ---------------------------------------------------------------------------
// ✅ V00461 — TIPO DE CAMBIO DE UNA FECHA (renglones de `tipo_cambio`).
// La operación usa el T.C. de SU fecha de servicio. El renglón de un día se
// reconoce por su campo `fecha` (AAAA-MM-DD; los viejos pueden traer d/m/aaaa
// o Timestamp), NUNCA por createdAt/updatedAt: esos dicen cuándo se capturó y
// van en UTC. Antes se aceptaba cualquier campo con fecha y el T.C. del 15
// capturado a las 8 p. m. (createdAt del 16 en UTC) se tomaba como el del 16.
// Lógica pura: sin Firebase ni React (se copia a functions/).
// ---------------------------------------------------------------------------
import { aFechaServicioISO } from './fechas.js';
import { monedaCanonica } from './moneda.js';

type Datos = Record<string, unknown>;

/** Campos con la fecha del renglón (el de siempre y sus variantes de importaciones viejas). */
const CAMPOS_FECHA = ['fecha', 'Fecha', 'FECHA'] as const;

/** Fecha AAAA-MM-DD a la que corresponde el renglón ('' si no tiene). */
export const fechaDeTipoCambio = (fila: unknown): string => {
  if (!fila || typeof fila !== 'object') return '';
  const f = fila as Datos;
  for (const campo of CAMPOS_FECHA) {
    const iso = aFechaServicioISO(f[campo]);
    if (iso) return iso;
  }
  return '';
};

/** Valor del T.C. de un renglón (columna dof/valor/tc/cambio/monto, o un número entre 5 y 60). */
export const valorDeTipoCambio = (fila: unknown): number | null => {
  if (!fila || typeof fila !== 'object') return null;
  const f = fila as Datos;
  const llave = Object.keys(f).find((k) => {
    const kk = k.toLowerCase();
    return kk.includes('dof') || kk.includes('valor') || kk === 'tc' || kk.includes('cambio') || kk.includes('monto') || kk.includes('t.c');
  });
  if (llave) {
    const n = Number(String(f[llave]).replace(/[^0-9.-]+/g, ''));
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const posibles = Object.values(f)
    .map((v) => parseFloat(String(v).replace(/[^0-9.-]+/g, '')))
    .filter((n) => !Number.isNaN(n) && n > 5 && n < 60);
  return posibles.length > 0 ? posibles[0] : null;
};

/** T.C. de una fecha en una lista de renglones de tipo_cambio (null si esa fecha no tiene). */
export const tipoCambioDeFecha = (filas: unknown, fechaISO: string): number | null => {
  if (!fechaISO || !Array.isArray(filas)) return null;
  for (const fila of filas) {
    if (fechaDeTipoCambio(fila) !== fechaISO) continue;
    const valor = valorDeTipoCambio(fila);
    if (valor !== null) return valor;
  }
  return null;
};

/** Día de la semana de una fecha AAAA-MM-DD (0 domingo … 6 sábado). */
const diaSemana = (iso: string): number => new Date(`${iso}T12:00:00Z`).getUTCDay();
const diaAnterior = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * T.C. que le toca a una fecha: el suyo; si es sábado o domingo y no tiene registro, el del
 * viernes (el DOF no publica en fin de semana; es la misma regla con la que Tipo de Cambio
 * crea esos días al capturar el viernes). Un día hábil sin registro → null (no se toma otro día).
 * `buscar` da el T.C. registrado de una fecha exacta.
 */
export const tipoCambioAplicable = (buscar: (fechaISO: string) => number | null, fechaISO: string): { valor: number; fecha: string } | null => {
  let fecha = fechaISO;
  for (let i = 0; i < 3 && fecha; i++) {
    const valor = buscar(fecha);
    if (valor !== null) return { valor, fecha };
    const dia = diaSemana(fecha);
    if (dia !== 6 && dia !== 0) return null;
    fecha = diaAnterior(fecha);
  }
  return null;
};

/** ¿Es el mismo T.C.? (hasta 4 decimales, regla V00274). */
export const mismoTipoCambio = (a: unknown, b: unknown): boolean =>
  Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.00005;

/** Fecha → T.C. (el primer renglón con valor de cada fecha). */
export const mapaTipoCambio = (filas: readonly unknown[]): Map<string, number> => {
  const mapa = new Map<string, number>();
  for (const fila of filas) {
    const fecha = fechaDeTipoCambio(fila);
    const valor = valorDeTipoCambio(fila);
    if (fecha && valor !== null && !mapa.has(fecha)) mapa.set(fecha, valor);
  }
  return mapa;
};

/** ¿Algún lado de la operación convierte moneda (convenio en una, factura en otra)? */
export const operacionConvierteMoneda = (op: Datos): boolean => {
  const distinta = (convenio: unknown, factura: unknown, nombre: unknown): boolean => {
    const c = monedaCanonica(convenio);
    const f = monedaCanonica(factura) ?? monedaCanonica(nombre);
    return !!c && !!f && c !== f;
  };
  return distinta(op.monedaConvenioCliente, op.facturadoEnCobrar, op.monedaCobroNombre)
    || distinta(op.monedaConvenioProv, op.facturadoEnUnidad, op.monedaUnidadNombre);
};

/**
 * ¿El T.C. de la operación mueve dinero? Si convierte moneda, o si un lado se factura en
 * dólares (su equivalente en pesos, `conversion*`, y la utilidad usan el T.C.; ver dinero.ts).
 */
export const tipoCambioMueveDinero = (op: Datos): boolean =>
  operacionConvierteMoneda(op)
  || (monedaCanonica(op.facturadoEnCobrar) ?? monedaCanonica(op.monedaCobroNombre)) === 'USD'
  || (monedaCanonica(op.facturadoEnUnidad) ?? monedaCanonica(op.monedaUnidadNombre)) === 'USD';

export type EstadoTipoCambioOperacion = 'ok' | 'distinto' | 'sinTC' | 'fechaSinTC' | 'sinFecha';

/**
 * Revisión del T.C. que usa la operación (tipoCambioAprobado o, si falta, tipoCambioDia: el
 * mismo orden que dinero.ts) contra el que le toca a su fecha de servicio (tipoCambioAplicable):
 * ok · distinto (trae otro) · sinTC (trae 0 y su fecha sí tiene) · fechaSinTC (su fecha no tiene registro) · sinFecha.
 */
export const revisarTipoCambioOperacion = (op: Datos, mapa: ReadonlyMap<string, number>): { fecha: string; guardado: number; deSuFecha: number | null; fechaDelTC: string; estado: EstadoTipoCambioOperacion } => {
  const fecha = aFechaServicioISO(op.fechaServicioISO) ?? aFechaServicioISO(op.fechaServicio) ?? '';
  const guardado = Number(op.tipoCambioAprobado) || Number(op.tipoCambioDia) || 0;
  const aplicable = fecha ? tipoCambioAplicable((f) => mapa.get(f) ?? null, fecha) : null;
  const deSuFecha = aplicable?.valor ?? null;
  const estado: EstadoTipoCambioOperacion = !fecha ? 'sinFecha'
    : deSuFecha === null ? 'fechaSinTC'
    : !(guardado > 0) ? 'sinTC'
    : mismoTipoCambio(guardado, deSuFecha) ? 'ok' : 'distinto';
  return { fecha, guardado, deSuFecha, fechaDelTC: aplicable?.fecha ?? '', estado };
};

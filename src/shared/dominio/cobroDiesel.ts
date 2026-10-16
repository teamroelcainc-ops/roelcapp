// src/shared/dominio/cobroDiesel.ts
// ---------------------------------------------------------------------------
// ✅ V00459 — COBRO REAL de una carga de diesel (referencias_diesel).
// La app calcula el monto con el costo del día (galones × costo). Murphy cobra
// menos: descuenta por galón y al día siguiente el cobro real aparece en la
// tarjeta (reporte "Net of Discount"). Para que el Saldo Diesel cuadre con el
// banco, cada carga guarda lo que realmente se cobró:
//   · descuentoDiesel — el descuento del reporte (capturado)
//   · montoCobrado    — lo cobrado del reporte (capturado)
// Mientras no se capturan se ESTIMAN: descuento = $0.20 × galones cargados solo
// en las cargas de Murphy con fecha desde INICIO_DESCUENTO_MURPHY (las
// anteriores quedan como estaban), y cobrado = sin descuento − descuento.
// El saldo de diesel descuenta `cobrado` (ver saldosCorrientes.ts).
// Lógica pura: sin Firebase ni React (se copia a functions/).
// ---------------------------------------------------------------------------

type Datos = Record<string, unknown>;

/** Descuento de Murphy por galón (estimado, mientras no se captura el real). */
export const DESCUENTO_MURPHY_POR_GALON = 0.2;
/** Desde esta fecha de carga se estima el descuento de Murphy; antes, sin descuento (como siempre). */
export const INICIO_DESCUENTO_MURPHY = '2026-10-17';

const norm = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Número capturado (0 cuenta); vacío, null o texto no numérico = no capturado. */
export const numeroCapturado = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Fecha AAAA-MM-DD de la referencia ('' si viene en otro formato: d/m/aaaa, número, Timestamp…). */
const fechaISO = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

/**
 * ¿La carga es de Murphy? Por el nombre del proveedor que guarda la referencia al crearse (y que
 * el servidor mantiene al día): el ID de Murphy no es una constante del código. Solo decide el
 * descuento ESTIMADO; lo capturado del reporte vale para cualquier proveedor.
 */
export const esCargaMurphy = (r: Datos): boolean => norm(r.proveedorNombre).includes('murphy');

/** Galones cargados × costo del día (el "Total Cargado" de siempre, sin descuento). */
export const montoSinDescuentoDiesel = (r: Datos): number =>
  Number(r.totalCargado) || ((Number(r.galonesCargados) || 0) * (Number(r.costoDiesel) || 0));

/** Descuento estimado: $0.20 × galones cargados en cargas de Murphy desde INICIO_DESCUENTO_MURPHY. */
export const descuentoEstimadoDiesel = (r: Datos): number => {
  const galones = Number(r.galonesCargados) || 0;
  const fecha = fechaISO(r.fecha);
  if (!(galones > 0) || !esCargaMurphy(r) || !fecha || fecha < INICIO_DESCUENTO_MURPHY) return 0;
  return r2(galones * DESCUENTO_MURPHY_POR_GALON);
};

export interface CobroDiesel {
  /** Galones cargados × costo (sin descuento). */
  sinDescuento: number;
  descuento: number;
  descuentoCapturado: boolean;
  /** Lo cobrado: el capturado o, si falta, sin descuento − descuento. Es lo que descuenta del saldo. */
  cobrado: number;
  cobradoCapturado: boolean;
  /** Galones cargados − galones autorizados (+ = cargó más de lo autorizado). */
  difGalones: number;
  /** Sin descuento − cobrado (lo que se pagó de menos contra lo calculado). */
  difMonto: number;
}

export const cobroDiesel = (r: Datos): CobroDiesel => {
  const sinDescuento = montoSinDescuentoDiesel(r);
  const descCapturado = numeroCapturado(r.descuentoDiesel);
  const descuento = descCapturado ?? descuentoEstimadoDiesel(r);
  const cobCapturado = numeroCapturado(r.montoCobrado);
  // Sin descuento ni captura queda EXACTO el total de siempre (las cargas anteriores no cambian).
  const cobrado = cobCapturado ?? (descuento ? sinDescuento - descuento : sinDescuento);
  return {
    sinDescuento,
    descuento,
    descuentoCapturado: descCapturado !== null,
    cobrado,
    cobradoCapturado: cobCapturado !== null,
    difGalones: (Number(r.galonesCargados) || 0) - (Number(r.galonesAutorizados) || 0),
    difMonto: sinDescuento - cobrado,
  };
};

/** ¿Falta confirmar el cobro? Cargas con monto desde INICIO_DESCUENTO_MURPHY que aún no tienen Monto cobrado. */
export const cobroPorConfirmar = (r: Datos): boolean => {
  const fecha = fechaISO(r.fecha);
  return montoSinDescuentoDiesel(r) > 0 && numeroCapturado(r.montoCobrado) === null && !!fecha && fecha >= INICIO_DESCUENTO_MURPHY;
};

/** ¿Lo que se ve es un estimado? (descuento estimado aplicado, o un cobro por confirmar). Las cargas viejas no. */
export const cobroEstimado = (r: Datos): { descuento: boolean; cobrado: boolean } => {
  const c = cobroDiesel(r);
  const descuento = !c.descuentoCapturado && c.descuento > 0;
  return { descuento, cobrado: !c.cobradoCapturado && (descuento || cobroPorConfirmar(r)) };
};

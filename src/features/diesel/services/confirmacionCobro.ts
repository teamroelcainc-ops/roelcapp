// src/features/diesel/services/confirmacionCobro.ts
// ✅ V00459: CONFIRMAR EL COBRO de una carga (Referencias del Diesel): galones que realmente
//   se cargaron, el descuento y lo cobrado según el reporte de Murphy. Lógica pura: arma los
//   campos que se guardan en referencias_diesel (la escritura está en confirmacionCobroDatos.ts).
import { montoSinDescuentoDiesel, numeroCapturado } from '../../../shared/dominio/cobroDiesel';

type Datos = Record<string, unknown>;

/** Lo que se captura en el formulario (texto tal cual; vacío = no capturado). */
export interface CapturaCobro {
  galonesCargados: string;
  descuento: string;
  montoCobrado: string;
}

/** Status de la referencia, la misma regla del formulario de edición: cargó → Cargado; con extras → Autorizado. */
export const statusReferenciaDiesel = (galonesExtras: number, galonesCargados: number): string =>
  galonesCargados ? 'Cargado' : galonesExtras ? 'Autorizado' : 'No Autorizado';

/** ¿Cambian los galones cargados? (solo entonces se reescriben galones, total y status). */
export const cambianGalones = (ref: Datos, c: CapturaCobro): boolean => {
  const gal = numeroCapturado(c.galonesCargados);
  return gal !== null && Math.abs(gal - (Number(ref.galonesCargados) || 0)) > 0.0001;
};

/** Problema de la captura ('' si se puede guardar). */
export const errorCaptura = (ref: Datos, c: CapturaCobro): string => {
  const gal = numeroCapturado(c.galonesCargados);
  if (gal === null || gal < 0) return 'Captura los galones que se cargaron.';
  if (cambianGalones(ref, c) && !((Number(ref.costoDiesel) || 0) > 0)) return 'Esta referencia no tiene costo por galón: corrige los galones desde Editar referencia.';
  const sinDescuento = cambianGalones(ref, c) ? gal * (Number(ref.costoDiesel) || 0) : montoSinDescuentoDiesel(ref);
  const desc = numeroCapturado(c.descuento);
  if (c.descuento.trim() !== '' && (desc === null || desc < 0)) return 'El descuento debe ser un número mayor o igual a 0.';
  if (desc !== null && sinDescuento > 0 && desc > sinDescuento) return 'El descuento no puede ser mayor que el monto sin descuento.';
  const cob = numeroCapturado(c.montoCobrado);
  if (c.montoCobrado.trim() !== '' && (cob === null || cob < 0)) return 'El monto cobrado debe ser un número mayor o igual a 0.';
  if (cob === 0 && gal > 0) return 'Si todavía no hay cobro en el reporte, deja vacío el Monto cobrado.';
  return '';
};

/** Aviso para revisar antes de guardar ('' si todo se ve normal): suele ser un valor en el campo equivocado. */
export const avisoCaptura = (ref: Datos, c: CapturaCobro): string => {
  const gal = numeroCapturado(c.galonesCargados) ?? 0;
  const sinDescuento = cambianGalones(ref, c) ? gal * (Number(ref.costoDiesel) || 0) : montoSinDescuentoDiesel(ref);
  if (!(sinDescuento > 0)) return '';
  const desc = numeroCapturado(c.descuento);
  const cob = numeroCapturado(c.montoCobrado);
  if (desc !== null && desc > sinDescuento * 0.5) return 'El descuento es más de la mitad de lo calculado. ¿No es el Monto cobrado?';
  if (cob !== null && cob < sinDescuento * 0.5) return 'Lo cobrado es menos de la mitad de lo calculado. ¿No es el Descuento?';
  if (cob !== null && cob > sinDescuento * 1.5) return 'Lo cobrado es mucho más que lo calculado. Revisa los galones o el monto.';
  return '';
};

/** La referencia con lo capturado (para calcular en vivo con cobroDiesel). */
export const referenciaConCaptura = (ref: Datos, c: CapturaCobro): Datos => {
  const gal = numeroCapturado(c.galonesCargados) ?? 0;
  return {
    ...ref,
    ...(cambianGalones(ref, c) ? { galonesCargados: gal, totalCargado: gal * (Number(ref.costoDiesel) || 0) } : {}),
    descuentoDiesel: numeroCapturado(c.descuento),
    montoCobrado: numeroCapturado(c.montoCobrado),
  };
};

/**
 * Campos a guardar, calculados con la referencia ACTUAL (la transacción la vuelve a leer).
 * Galones, total y status solo si cambiaron los galones (el total de una referencia vieja
 * sin costo no se toca). `quien` / `cuando` quedan solo si se capturó lo cobrado.
 */
export const camposConfirmacion = (ref: Datos, c: CapturaCobro, quien: string, cuando: string): Datos => {
  const gal = numeroCapturado(c.galonesCargados) ?? 0;
  const montoCobrado = numeroCapturado(c.montoCobrado);
  return {
    ...(cambianGalones(ref, c) ? {
      galonesCargados: gal,
      totalCargado: gal * (Number(ref.costoDiesel) || 0),
      status: statusReferenciaDiesel(Number(ref.galonesExtras) || 0, gal),
    } : {}),
    descuentoDiesel: numeroCapturado(c.descuento),
    montoCobrado,
    cobroConfirmadoPor: montoCobrado !== null ? quien : null,
    cobroConfirmadoEn: montoCobrado !== null ? cuando : null,
  };
};

/** Lo que trae el formulario al abrir: lo ya capturado (o vacío para que se use el estimado). */
export const capturaInicial = (ref: Datos): CapturaCobro => {
  const texto = (v: unknown) => { const n = numeroCapturado(v); return n === null ? '' : String(n); };
  return { galonesCargados: texto(ref.galonesCargados), descuento: texto(ref.descuentoDiesel), montoCobrado: texto(ref.montoCobrado) };
};

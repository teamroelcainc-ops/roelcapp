// src/features/operaciones/services/reintentosCallable.ts
// ---------------------------------------------------------------------------
// ✅ V00463 — Reintentos de las Cloud Functions de Operaciones (crearOperacion,
// renumerarOperacion).
//
// El aviso "internal" (en minúsculas) NO lo manda la función: lo arma el SDK de
// Firebase cuando el navegador no recibió ninguna respuesta válida (se cortó la
// conexión, se agotó la espera o el servidor la rechazó antes de que la función
// contestara). Un error de la propia función llega con su mensaje en español, y
// uno no controlado llega como "INTERNAL" en mayúsculas.
//
// Las dos funciones son idempotentes (crearOperacion por `clienteOpId`,
// renumerarOperacion no cambia una operación que ya está en su línea): reintentar
// con los mismos datos nunca duplica.
// ---------------------------------------------------------------------------

/** Códigos del SDK que pueden ser pasajeros (vale la pena reintentar). */
const CODIGOS_PASAJEROS: ReadonlySet<string> = new Set([
  'internal', 'unavailable', 'deadline-exceeded', 'aborted', 'resource-exhausted', 'unknown', 'cancelled',
]);

/** Código de un error de callable sin el prefijo `functions/` ('' si no trae). */
export const codigoCallable = (e: unknown): string =>
  String((e as { code?: unknown } | null)?.code ?? '').replace(/^functions\//, '').toLowerCase();

const mensajeDe = (e: unknown): string => String((e as { message?: unknown } | null)?.message ?? '').trim();

/**
 * ¿Falló la comunicación y no la función? El SDK pone de mensaje el mismo código
 * ("internal", "unavailable"…) cuando no hubo respuesta con un mensaje propio.
 */
export const esFalloDeConexion = (e: unknown): boolean => {
  const codigo = codigoCallable(e);
  const mensaje = mensajeDe(e).toLowerCase();
  return CODIGOS_PASAJEROS.has(codigo) && (!mensaje || mensaje === codigo);
};

/** ¿Vale la pena reintentar? Fallos de conexión y códigos pasajeros (contención, servidor ocupado). */
export const esReintentable = (e: unknown): boolean => CODIGOS_PASAJEROS.has(codigoCallable(e));

export interface ResultadoConReintentos<T> {
  valor: T;
  intentos: number;
  /** Código del último fallo antes del éxito ('' si salió a la primera). */
  ultimoCodigo: string;
}

/** Error final con lo necesario para diagnosticar (cuántos intentos y cuánto tardó). */
export class ErrorTrasReintentos extends Error {
  readonly causa: unknown;
  readonly intentos: number;
  readonly segundos: number;
  constructor(causa: unknown, intentos: number, segundos: number) {
    super(mensajeDe(causa) || codigoCallable(causa) || 'Error desconocido');
    this.name = 'ErrorTrasReintentos';
    this.causa = causa;
    this.intentos = intentos;
    this.segundos = segundos;
  }
}

/**
 * Llama `fn` hasta `esperasMs.length + 1` veces mientras el fallo sea reintentable,
 * esperando entre intentos. `fn` debe ser idempotente.
 */
export const conReintentos = async <T>(
  fn: (intento: number) => Promise<T>,
  esperasMs: readonly number[] = [1500, 4000],
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ahora: () => number = () => Date.now(),
): Promise<ResultadoConReintentos<T>> => {
  const inicio = ahora();
  let ultimoCodigo = '';
  for (let intento = 1; ; intento++) {
    try {
      return { valor: await fn(intento), intentos: intento, ultimoCodigo };
    } catch (e) {
      ultimoCodigo = codigoCallable(e) || 'desconocido';
      const espera = esperasMs[intento - 1];
      if (espera === undefined || !esReintentable(e)) {
        throw new ErrorTrasReintentos(e, intento, Math.round((ahora() - inicio) / 100) / 10);
      }
      console.warn(`[callable] intento ${intento} falló (${ultimoCodigo}); se reintenta en ${espera} ms`, e);
      await esperar(espera);
    }
  }
};

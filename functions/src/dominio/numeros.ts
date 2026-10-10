// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.
// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).
// src/shared/dominio/numeros.ts — ✅ V00436: números y dinero en centavos.
// Regla del negocio (V00274): todos los montos a 2 decimales; el tipo de cambio hasta 4.

/** Convierte a número: acepta números, strings con comas/espacios/$ y vacíos (→ 0). */
export const aNumero = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const limpio = v.replace(/[$,\s]/g, '');
    if (!limpio) return 0;
    const n = Number(limpio);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** Redondeo a 2 decimales (montos). */
export const r2 = (n: unknown): number => Math.round(aNumero(n) * 100) / 100;

/** Redondeo a 4 decimales (tipo de cambio). */
export const r4 = (n: unknown): number => Math.round(aNumero(n) * 10000) / 10000;

/** Monto → centavos enteros (evita sumar flotantes). */
export const aCentavos = (n: unknown): number => Math.round(aNumero(n) * 100);

/** Centavos enteros → monto con 2 decimales. */
export const deCentavos = (c: unknown): number => Math.round(aNumero(c)) / 100;

/** Suma montos sin errores de flotante (suma en centavos). */
export const sumarMontos = (montos: readonly unknown[]): number =>
  deCentavos(montos.reduce<number>((s, m) => s + aCentavos(m), 0));

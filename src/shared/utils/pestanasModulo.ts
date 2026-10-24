// src/shared/utils/pestanasModulo.ts
// ✅ V00480 — a qué pestaña lleva el menú de un apartado con varios módulos (Operaciones, Facturación).

/** La que ya se ve, o la primera con permiso; null si no tiene ninguna. */
export const pestanaDeEntrada = <K extends string>(modulos: readonly K[], actual: string, puede: (m: K) => boolean): K | null => {
  const actualEsDelApartado = (modulos as readonly string[]).includes(actual);
  if (actualEsDelApartado && puede(actual as K)) return actual as K;
  return modulos.find(puede) ?? null;
};

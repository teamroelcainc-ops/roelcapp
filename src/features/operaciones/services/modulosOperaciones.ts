// src/features/operaciones/services/modulosOperaciones.ts
// ✅ V00477 — los tres módulos que forman "Operaciones" (pestañas Activas / Completadas / Canceladas).
export type ModuloOperaciones = 'operaciones' | 'serviciosCompletados' | 'serviciosCancelados';

export const MODULOS_OPERACIONES: readonly ModuloOperaciones[] = ['operaciones', 'serviciosCompletados', 'serviciosCancelados'];

export const esModuloOperaciones = (m: string): m is ModuloOperaciones => (MODULOS_OPERACIONES as readonly string[]).includes(m);

/** Pestaña a la que lleva el menú "Operaciones": la que ya se ve, o la primera con permiso. */
export const pestanaDeEntrada = (actual: string, puede: (m: ModuloOperaciones) => boolean): ModuloOperaciones | null =>
  esModuloOperaciones(actual) && puede(actual) ? actual : MODULOS_OPERACIONES.find(puede) ?? null;

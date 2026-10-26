// src/features/operaciones/services/modulosOperaciones.ts
// ✅ V00477 — los módulos que forman "Operaciones" (pestañas Activas / Completadas / Canceladas).
// ✅ V00498: + Reportes (antes su propio ítem del menú), con su mismo permiso.
import { pestanaDeEntrada as entradaDe } from '../../../shared/utils/pestanasModulo';

export type ModuloOperaciones = 'operaciones' | 'serviciosCompletados' | 'serviciosCancelados' | 'reportes';

export const MODULOS_OPERACIONES: readonly ModuloOperaciones[] = ['operaciones', 'serviciosCompletados', 'serviciosCancelados', 'reportes'];

export const esModuloOperaciones = (m: string): m is ModuloOperaciones => (MODULOS_OPERACIONES as readonly string[]).includes(m);

/** Pestaña a la que lleva el menú "Operaciones": la que ya se ve, o la primera con permiso. */
export const pestanaDeEntrada = (actual: string, puede: (m: ModuloOperaciones) => boolean): ModuloOperaciones | null =>
  entradaDe(MODULOS_OPERACIONES, actual, puede); // ✅ V00480: regla compartida con Facturación

// src/features/facturacion/services/modulosFacturacion.ts
// ✅ V00480 — los dos módulos que forman "Facturación" (pestañas Clientes / Proveedores).
import { pestanaDeEntrada as entradaDe } from '../../../shared/utils/pestanasModulo';

export type ModuloFacturacion = 'facturacionClientes' | 'facturacionProveedores';

export const MODULOS_FACTURACION: readonly ModuloFacturacion[] = ['facturacionClientes', 'facturacionProveedores'];

export const esModuloFacturacion = (m: string): m is ModuloFacturacion => (MODULOS_FACTURACION as readonly string[]).includes(m);

/** Pestaña a la que lleva el menú "Facturación": la que ya se ve, o la primera con permiso. */
export const pestanaDeFacturacion = (actual: string, puede: (m: ModuloFacturacion) => boolean): ModuloFacturacion | null =>
  entradaDe(MODULOS_FACTURACION, actual, puede);

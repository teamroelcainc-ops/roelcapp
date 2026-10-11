// src/features/operaciones/services/catalogosFormulario.ts
// ---------------------------------------------------------------------------
// ✅ V00447 — Catálogos del FORMULARIO DE OPERACIÓN en un solo lugar: los usa el
// formulario (useCatalogos) y Operaciones Activas los abre en segundo plano al
// arrancar (precalentarCatalogosFormulario) para que el formulario abra sin esperar
// "Cargando catálogos de Roelca…" (en la V00435 se pintaba al instante desde las
// copias en localStorage).
// ---------------------------------------------------------------------------
import { precalentarCatalogos } from '../../../shared/data/catalogos';
import type { ColeccionCatalogo } from '../../../shared/data/catalogos';

/** Lo que el formulario necesita para pintarse (espera a que estén). */
export const CATALOGOS_FORMULARIO_BASE = {
  empresas: 'empresas',
  remolques: 'remolques',
  unidades: 'unidades',
  empleados: 'empleados',
  unidadesProveedor: 'unidades_proveedor',
  proveedoresUnidad: 'proveedores_unidad',
  tiposOperacion: 'catalogo_tipo_operacion',
  statusServicio: 'catalogo_status_servicio',
  catalogoMoneda: 'catalogo_moneda',
} as const satisfies Record<string, ColeccionCatalogo>;

/** El resto (tarifas, convenios, direcciones…): llegan después sin bloquear el formulario. */
export const CATALOGOS_FORMULARIO_EXTRA = {
  tarifas: 'catalogo_tarifas_referencia',
  embalajes: 'catalogo_embalaje',
  tarifasGastosIncluidos: 'tarifas_gastos_incluidos',
  tarifasRendimiento: 'tarifas_rendimiento',
  tiposGastos: 'catalogo_tipos_gastos',
  catalogoConvClientes: 'convenios_clientes',
  catalogoConvDetalles: 'convenios_clientes_detalles',
  catalogoTarifarios: 'tarifario_clientes',
  catalogoTarifariosProv: 'tarifario_proveedores',
  conveniosProv: 'convenios_proveedores',
  catalogoConvProvDetalles: 'convenios_proveedores_detalles',
  catalogoTrafico: 'catalogo_trafico',
  direcciones: 'direcciones',
  flujos: 'config_flujos_operacion',
} as const satisfies Record<string, ColeccionCatalogo>;

/** Abre en segundo plano los catálogos del formulario (primero los que lo bloquean). */
export const precalentarCatalogosFormulario = (): void => {
  precalentarCatalogos([
    ...Object.values(CATALOGOS_FORMULARIO_BASE),
    ...Object.values(CATALOGOS_FORMULARIO_EXTRA),
    'tipo_cambio', // lo pasa Operaciones Activas al formulario (catalogosCacheados)
  ]);
};

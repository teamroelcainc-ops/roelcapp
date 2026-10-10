// src/features/facturacion/services/mapaCatalogos.ts
// ---------------------------------------------------------------------------
// ✅ V00439 (Fase 3.x): mapa id → nombre de Facturación (Clientes y Proveedores).
// Antes se armaba leyendo TODAS las copias de catálogos en localStorage
// (cat_v1__*, cat_v2__*, roelca_catalogos_v2) que otros módulos hubieran dejado;
// ahora sale de los catálogos en vivo (useCatalogos) que pueden aparecer en los
// campos que Facturación traduce: status, tipo de operación, embalaje, moneda,
// remolque, unidad, operador, unidad/operador del proveedor y convenios.
// La regla para tomar el nombre de cada registro es la misma de antes.
// ---------------------------------------------------------------------------
import type { ColeccionCatalogo, DocCatalogo } from '../../../shared/data/catalogos';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';

/** Catálogos (alias → colección) cuyos IDs se traducen a nombre en Facturación. */
export const CATALOGOS_NOMBRES_FACTURACION = {
  statusServicio: 'catalogo_status_servicio',
  tiposOperacion: 'catalogo_tipo_operacion',
  embalajes: 'catalogo_embalaje',
  catalogoMoneda: 'catalogo_moneda',
  remolques: 'remolques',
  unidades: 'unidades',
  empleados: 'empleados',
  unidades_proveedor: 'unidades_proveedor',
  proveedores_unidad: 'proveedores_unidad',
  conveniosProv: 'convenios_proveedores',
  catalogoConvClientes: 'convenios_clientes',
} as const satisfies Record<string, ColeccionCatalogo>;

/** Empresa con los campos que lee Facturación (el resto queda como unknown). */
export type EmpresaFacturacion = DocCatalogo & {
  nombre?: string;
  nombreCorto?: string;
  rfc?: string;
  moneda?: string;
  monedaRef?: string;
  monedaFacturacion?: string;
  monedaProveedor?: string;
};

const valor = (item: DocCatalogo, ...campos: string[]): unknown => {
  for (const c of campos) {
    const v = item[c];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

/** Nombre legible de un registro de catálogo (misma prioridad que antes). */
const tomarNombre = (item: DocCatalogo): string | null => {
  if (!item || item.id === undefined || item.id === null) return null;
  const fn = valor(item, 'firstName', 'first_name');
  const lp = valor(item, 'lastNamePaternal', 'last_name_paternal', 'apellidoPaterno');
  if (fn || lp) {
    const full = `${fn || ''} ${lp || ''}`.trim();
    if (full) return full;
  }
  if (typeof item.unidad === 'string' && item.unidad.trim() !== '') return item.unidad.trim();
  const placa = valor(item, 'placas', 'placa');
  if (item.nombre && placa) return `${item.nombre} ${placa}`.trim();
  const n = valor(item, 'nombre', 'nombreCorto', 'label', 'descripcion', 'name', 'titulo', 'moneda', 'tipo_operacion');
  return (n !== undefined && n !== null && String(n) !== '') ? String(n) : null;
};

/**
 * Mapa id → nombre. Las empresas mandan con su nombre/nombreCorto y las dos
 * monedas se muestran como 'USD' / 'MXN' (igual que antes).
 */
export const construirMapaCatalogos = (catalogos: readonly DocCatalogo[][], empresas: readonly EmpresaFacturacion[]): Record<string, string> => {
  const mapa: Record<string, string> = {};
  [...catalogos, empresas].forEach((lista) => lista.forEach((item) => {
    const n = tomarNombre(item);
    if (n) mapa[String(item.id)] = n;
  }));
  empresas.forEach((e) => {
    if (e?.id) mapa[String(e.id)] = e.nombre || e.nombreCorto || mapa[String(e.id)] || String(e.id);
  });
  mapa[ID_USD] = 'USD';
  mapa[ID_MXN] = 'MXN';
  return mapa;
};

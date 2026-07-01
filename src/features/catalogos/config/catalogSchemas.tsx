// src/features/catalogos/config/catalogSchemas.ts
import React from 'react';

export type FieldType = 'text' | 'number' | 'select' | 'currency';

export interface CatalogField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  dynamicOptions?: {
    collection: string;
    labelField: string;
    valueField: string;
    filterField?: string;
    filterValue?: string;
  };
}

export interface CatalogDetailSchema {
  collection: string;
  titulo: string;
  icono: React.ReactNode;
  foreignKey: string;
  fields: CatalogField[];
}

export interface CatalogSchema {
  id: string;
  titulo: string;
  icono: React.ReactNode;
  fields: CatalogField[];
  details?: CatalogDetailSchema[];
}

// ✅ Opciones de "Cargada / Vacía". DEBEN ser las mismas que el selector de
//    CARGA del Editor de Flujos (Reglas de Status): Cargada / Vacía / N/A / Trompo.
//    Mantener esta constante como única fuente para que coincidan siempre.
export const OPCIONES_CARGA = ['Cargada', 'Vacía', 'N/A', 'Trompo'];

export const catalogosConfig: Record<string, CatalogSchema> = {
  aduanas: {
    id: 'aduanas', titulo: 'Aduanas',
    icono: <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
    fields: [{ name: 'aduana', label: 'Aduana', type: 'text', required: true }]
  },
  bancos: {
    id: 'bancos', titulo: 'Bancos',
    icono: <path d="M4 10h3v7H4zM10.5 10h3v7h-3zM2 19h20v3H2zM17 10h3v7h-3zM12 1L2 6v2h20V6L12 1z" />,
    fields: [
      { name: 'banco', label: 'Banco', type: 'text', required: true },
      { name: 'moneda', label: 'Moneda', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_moneda', labelField: 'moneda', valueField: 'id' } }
    ]
  },
  departamentos: {
    id: 'departamentos', titulo: 'Departamentos',
    icono: <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />,
    fields: [{ name: 'departamento', label: 'Departamento', type: 'text', required: true }]
  },
  paises: {
    id: 'paises', titulo: 'Direcciones / País',
    icono: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />,
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true },
      { name: 'codigo', label: 'Código', type: 'number', required: true }
    ]
  },
  estados: {
    id: 'estados', titulo: 'Direcciones / Estado',
    icono: <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />,
    fields: [
      { name: 'pais', label: 'País', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_paises', labelField: 'nombre', valueField: 'id' } },
      { name: 'estado', label: 'Estado', type: 'text', required: true }
    ]
  },
  municipios: {
    id: 'municipios', titulo: 'Direcciones / Municipios',
    icono: <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />,
    fields: [
      { name: 'estado', label: 'Estado', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_estados', labelField: 'estado', valueField: 'id' } },
      { name: 'municipio', label: 'Municipio', type: 'text', required: true }
    ]
  },
  colonias: {
    id: 'colonias', titulo: 'Direcciones / Colonia',
    icono: <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />,
    fields: [
      { name: 'municipio', label: 'Municipio', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_municipios', labelField: 'municipio', valueField: 'id' } },
      { name: 'colonia', label: 'Colonia', type: 'text', required: true }
    ]
  },
  codigo_postal: {
    id: 'codigo_postal', titulo: 'Direcciones / Código Postal',
    icono: <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />,
    fields: [
      { name: 'colonia', label: 'Colonia', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_colonias', labelField: 'colonia', valueField: 'id' } },
      { name: 'codigo_postal', label: 'Codigo Postal', type: 'text', required: true }
    ]
  },
  calles: {
    id: 'calles', titulo: 'Direcciones / Calles',
    icono: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />,
    fields: [
      { name: 'codigo_postal', label: 'Código Postal', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_codigo_postal', labelField: 'codigo_postal', valueField: 'id' } },
      { name: 'calle', label: 'Calle', type: 'text', required: true }
    ]
  },
  dispositivos: {
    id: 'dispositivos', titulo: 'Dispositivos',
    icono: <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>,
    fields: [{ name: 'dispositivo', label: 'Dispositivo', type: 'text', required: true }]
  },
  embalaje: {
    id: 'embalaje', titulo: 'Embalaje',
    icono: <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 14H4v-6h8v6zm8 0h-6v-6h6v6zm0-8H4V6h16v4z"/>,
    fields: [
      { name: 'clave', label: 'Clave', type: 'text', required: true },
      { name: 'nombre', label: 'Nombre', type: 'text', required: true },
      { name: 'descripcion', label: 'Descripción', type: 'text', required: true }
    ]
  },
  formas_pago: {
    id: 'formas_pago', titulo: 'Formas de Pago',
    icono: <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" />,
    fields: [
      { name: 'forma_pago', label: 'Forma de Pago', type: 'text', required: true },
      { name: 'descripcion', label: 'Descripción', type: 'text' }
    ]
  },
  moneda: {
    id: 'moneda', titulo: 'Monedas',
    icono: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.21 1.87 1.53 0 2.15-.81 2.15-1.5 0-2.09-4.44-1.61-4.44-4.83 0-1.46 1.03-2.57 2.41-2.94V5.11h2.67v1.94c1.37.33 2.49 1.25 2.65 2.85h-2.04c-.11-.83-.69-1.34-1.69-1.34-1.21 0-1.9.59-1.9 1.37 0 1.9 4.46 1.35 4.46 4.62 0 1.51-.92 2.98-2.56 3.54z" />,
    fields: [
      { name: 'moneda', label: 'Moneda', type: 'text', required: true },
      { name: 'pais', label: 'Pais', type: 'text' },
      { name: 'estado', label: 'Estado', type: 'text' },
      { name: 'municipio', label: 'Municipio', type: 'text' },
      { name: 'colonia', label: 'Colonia', type: 'text' },
      { name: 'calle', label: 'Calle', type: 'text' },
      { name: 'codigo_postal', label: 'Codigo_Postal', type: 'text' },
      { name: 'num_interior', label: 'Numero_interior', type: 'text' },
      { name: 'num_exterior', label: 'Numero_exterior', type: 'text' },
      { name: 'descripcion_dir', label: 'DescripcionDireccion', type: 'text' },
      { name: 'city_state_zip', label: 'CityStateZip', type: 'text' }
    ]
  },
  tipo_operacion: {
    id: 'tipo_operacion', titulo: 'Tipo de Operación',
    icono: <path d="M19 15v4H5v-4h14m1-2H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 18.5c-.82 0-1.5-.68-1.5-1.5s.68-1.5 1.5-1.5 1.5.68 1.5 1.5-.68 1.5-1.5 1.5zM19 5v4H5V5h14m1-2H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 8.5c-.82 0-1.5-.68-1.5-1.5S6.18 5.5 7 5.5s1.5.68 1.5 1.5S7.82 8.5 7 8.5z" />,
    fields: [{ name: 'tipo_operacion', label: 'Tipo de Operación', type: 'text', required: true }]
  },
  tipo_cargo: {
    id: 'tipo_cargo', titulo: 'Tipo de Cargo',
    icono: <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />,
    fields: [
      { name: 'nombre_puesto', label: 'Nombre del puesto', type: 'text', required: true },
      { name: 'departamento', label: 'Departamento', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_departamentos', labelField: 'departamento', valueField: 'id' } },
      { name: 'empresa', label: 'Empresa', type: 'select', required: true, dynamicOptions: { collection: 'empresas', labelField: 'nombre', valueField: 'id' } }
    ]
  },
  regimen_fiscal: {
    id: 'regimen_fiscal', titulo: 'Régimen Fiscal',
    icono: <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />,
    fields: [
      { name: 'clave', label: 'Clave', type: 'text', required: true },
      { name: 'descripcion', label: 'Descripción', type: 'text', required: true }
    ]
  },
  status_servicio: {
    id: 'status_servicio', titulo: 'Status del Servicio',
    icono: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />,
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true },
      { name: 'descripcion', label: 'Descripción', type: 'text' },
      { name: 'tipo', label: 'Type', type: 'select', required: true, options: ['Importación', 'Exportación', 'Movimiento'] },
      { name: 'boton_status', label: 'Botón/Status', type: 'select', required: true, options: ['Botón', 'Status'] },
      { name: 'operacion', label: 'Operación', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_tipo_operacion', labelField: 'tipo_operacion', valueField: 'id' } },
      { name: 'obligatorio', label: 'Obligatorio', type: 'select', required: true, options: ['Sí', 'No'] }
    ]
  },
  tipo_empresa: {
    id: 'tipo_empresa', titulo: 'Tipo de Empresa',
    icono: <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm10 12h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V5h2v2zm4 12h-2v-2h2v2zm0-4h-2v-2h2v2z"/>,
    fields: [{ name: 'tipo', label: 'Tipo', type: 'text', required: true }]
  },
  tipo_remolque: {
    id: 'tipo_remolque', titulo: 'Tipo de Remolque',
    icono: <path d="M23 18h-2v-2h2v2zm-4-4h-2v2h2v-2zm-4-4h-2v2h2v-2zM1 18v-2h2v2H1zm4-4v-2h2v2H5zm4-4V8h2v2H9zm8 10H7v-2h10v2zm4-12v2h-2V8h2zm-4 4v2h-2v-2h2zm-4 4v2h-2v-2h2zM12 2L2 7l10 5 10-5-10-5z" />,
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true },
      { name: 'medida', label: 'Medida', type: 'text' },
      { name: 'descripcion', label: 'Descripción', type: 'text' },
      { name: 'ejes', label: 'Ejes', type: 'number' }
    ]
  },
  tipo_servicio: {
    id: 'tipo_servicio', titulo: 'Tipo de Servicio',
    icono: <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM7 7h10v2H7V7zm10 12H7v-2h10v2zm0-4H7v-2h10v2z" />,
    fields: [{ name: 'nombre', label: 'Nombre', type: 'text', required: true }]
  },
  tipos_gastos: {
    id: 'tipos_gastos', titulo: 'Tipos de Gastos',
    icono: <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" />,
    fields: [
      { name: 'nombre_gasto', label: 'Tipo de Gasto', type: 'text', required: true },
      { name: 'categoria_gasto', label: 'Tipo de Gasto (Cat)', type: 'select', required: true, options: ['Puente', 'Gastos'] },
      { name: 'importe', label: 'Importe', type: 'number', required: true },
      { name: 'moneda', label: 'Moneda', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_moneda', labelField: 'moneda', valueField: 'id' } },
      { name: 'trafico', label: 'Exportación/Importación', type: 'select', required: true, options: ['Exportación', 'Importación'] }
    ]
  },
  tipos_tarifarios: {
    id: 'tipos_tarifarios', titulo: 'Tipos de Tarifarios',
    icono: <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 14h-4v-2h4v2zm0-4h-4v-2h4v2zm-3-5V3.5L18.5 9H13z" />,
    fields: [
      { name: 'descripcion', label: 'Descripción', type: 'text', required: true },
      { name: 'aduana', label: 'Aduana', type: 'select', required: true, options: ['Sí', 'No'] },
      // ✅ MODIFICADO: opciones desde `catalogo_trafico`. Guarda el ID hex del documento,
      // muestra el campo `nombre`. Los 66 registros existentes guardan TEXTO en `movimiento`,
      // así que se debe correr la migración (ver MigracionTrafico.tsx) o se verán crudos.
      { name: 'movimiento', label: 'Importación/Exportación', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_trafico', labelField: 'nombre', valueField: 'id' } }
    ]
  },
  tarifas_referencia: {
    id: 'tarifas_referencia', 
    titulo: 'Tarifas de Referencia',
    icono: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="14" height="14" rx="2" />
        <path d="M16 16h6V8l-6-3" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="19" r="2" />
      </svg>
    ),
    fields: [
      { name: 'tipo_operacion', label: 'Tipo de Operación', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_tipos_tarifarios', labelField: 'descripcion', valueField: 'id' } },
      { name: 'tipo_remolque', label: 'Tipo de Remolque', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_tipo_remolque', labelField: 'nombre', valueField: 'id' } },
      // ✅ MODIFICADO: "Cargada / Vacía" ahora usa las MISMAS opciones que la
      //    CARGA del Editor de Flujos (Reglas de Status): Cargada / Vacía / N/A.
      { name: 'estado_carga', label: 'Cargada / Vacía', type: 'select', required: true, options: OPCIONES_CARGA },
      { name: 'trompo', label: 'Trompo', type: 'select', required: true, options: ['Sí', 'No'] },
      { name: 'regular_hazmat', label: 'Regular / Hazmat', type: 'select', required: true, options: ['Regular', 'Hazmat'] },
      { name: 'aduana', label: 'Aduana', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_aduanas', labelField: 'aduana', valueField: 'id' } },
      { name: 'descripcion', label: 'Descripción', type: 'text', required: true },
      { name: 'tarifa_cliente_1', label: 'Tarifa Cliente 1', type: 'number' },
      { name: 'tarifa_cliente_2', label: 'Tarifa Cliente 2', type: 'number' },
      { name: 'tarifa_cliente_3', label: 'Tarifa Cliente 3', type: 'number' },
      { name: 'tarifa_proveedor_1', label: 'Tarifa Proveedor 1', type: 'number' },
      { name: 'tarifa_proveedor_2', label: 'Tarifa Proveedor 2', type: 'number' },
      { name: 'tarifa_proveedor_3', label: 'Tarifa Proveedor 3', type: 'number' }
    ],
    details: [
      {
        collection: 'tarifas_gastos_incluidos',
        titulo: 'Gastos Incluidos',
        foreignKey: 'tarifa_referencia_id',
        icono: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        ),
        fields: [
          { name: 'gasto', label: 'Gasto', type: 'select', required: true, dynamicOptions: { collection: 'catalogo_tipos_gastos', labelField: 'nombre_gasto', valueField: 'id' } },
          { name: 'monto', label: 'Monto', type: 'currency', required: true }
        ]
      },
      {
        collection: 'tarifas_rendimiento',
        titulo: 'Rendimiento y Combustible',
        // ✅ CORRECCIÓN CLAVE: El nombre real de la llave foránea en Firebase es ID_SERVICES
        foreignKey: 'ID_SERVICES', 
        icono: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="22" x2="15" y2="22" />
            <line x1="4" y1="9" x2="14" y2="9" />
            <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" />
            <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5" />
          </svg>
        ),
        fields: [
          // ✅ CORRECCIÓN CLAVE: Usamos los nombres exactos que están en Firebase (Combustible, GALONES, Quantity)
          { name: 'Combustible', label: 'Gasolina / Diesel', type: 'select', required: true, options: ['Gasolina', 'Diesel'] },
          { name: 'GALONES', label: 'Galones / Litros', type: 'select', required: true, options: ['Litros', 'Galones'] },
          { name: 'Quantity', label: 'Cantidad', type: 'number', required: true }
        ]
      }
    ]
  },
  tipo_factura: {
    id: 'tipo_factura',
    titulo: 'Tipo de Facturas',
    icono: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    ),
    fields: [
      { name: 'nombre', label: 'Name', type: 'text', required: true },
      { name: 'moneda', label: 'Moneda', type: 'select', required: true, options: ['Dolares', 'Pesos'] },
      { name: 'empresaId', label: 'Empresa', type: 'select', required: true, dynamicOptions: { collection: 'empresas', labelField: 'nombre', valueField: 'id' } }
    ]
  },
  // ✅ Catálogo de Tráfico (solo campo Nombre) — alimenta el campo "Importación/Exportación" de Tipos de Tarifarios
  trafico: {
    id: 'trafico', titulo: 'Tráfico',
    icono: <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM10 17H6v-2h4v2zm0-4H6v-2h4v2zm0-4H6V7h4v2zm8 8h-6v-2h6v2zm0-4h-6v-2h6v2zm0-4h-6V7h6v2z"/>,
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true }
    ]
  },
  // ✅ Catálogo de Tipo de Archivo — define qué documentos existen, a qué módulo
  // pertenecen y si su carga es obligatoria. Crea la colección `catalogo_tipo_archivo`.
  tipo_archivo: {
    id: 'tipo_archivo', titulo: 'Tipo de Archivo',
    icono: <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" />,
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true },
      { name: 'modulo', label: 'Módulo', type: 'select', required: true, options: ['Empleado', 'Cliente', 'Proveedor', 'Bodega', 'Empresa', 'Operación', 'Unidad', 'Otro'] },
      { name: 'obligatorio', label: 'Obligatorio', type: 'select', required: true, options: ['Sí', 'No'] }
    ]
  }
};

export const listaCatalogos = Object.values(catalogosConfig);
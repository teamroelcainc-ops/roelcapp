// src/features/facturacion/components/FacturacionClientesDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// CAMBIOS EN ESTA VERSIÓN (solicitados)
// ═══════════════════════════════════════════════════════════════════════
// A) CONFIGURACIÓN DE COLUMNAS COMPARTIDA (global para todos los usuarios):
//    · Al pulsar "Guardar para todos" en cualquiera de los dos modales de
//      "Configurar Columnas" (Asignar Operaciones e Historial de Facturas),
//      la selección + el ORDEN se guardan en Firestore:
//          config_columnas/facturacion_clientes_ops
//          config_columnas/facturacion_clientes_historial
//    · Al abrir el módulo, esa configuración se lee una sola vez y se aplica
//      para TODOS los usuarios que vean la vista.
//    · Solo se persiste { id, visible } + orden; el resto de metadatos
//      (sourceField, tipo, grupo…) siempre se toma del código (BASE), así las
//      columnas nuevas que se agreguen en el futuro siguen apareciendo.
//
// B) MOSTRAR NOMBRES EN LUGAR DE IDs:
//    · Se construye un mapa id→nombre con TODOS los catálogos ya cacheados
//      (cat_v1__* y, como respaldo, roelca_catalogos_v2) + empresas + monedas.
//      Cero lecturas extra a Firestore.
//    · Cuando una operación vieja solo guardó el ID (status, convenio, origen,
//      embalaje, proveedor, unidad, operador, cliente-mercancía, etc.), se
//      muestra el NOMBRE resuelto tanto en la tabla, como en el Excel y en la
//      ficha de detalle de la operación.
//
// (Cambios anteriores que se conservan)
// 1) FILTRO PRINCIPAL = RANGO DE FECHAS (Desde / Hasta). Cliente OPCIONAL.
// 2) "Asignar Operaciones" muestra SOLO operaciones NO facturadas.
// 3) LECTURAS MÍNIMAS (caché-primero para empresas, consultas acotadas).
// (Se conservan: conversión USD/MXN, exportación a Excel con columnas
//  configurables, ficha de factura y detalle de operación.)
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  query,
  writeBatch,
  doc,
  limit,
  orderBy,
  where,
  getDocs,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

// ──────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────
const ID_TIPO_CLIENTE_PAGA = '7eec9cbb';
const STATUS_COMPLETADOS = ['f557b751', 'c2d57403'];
const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// Límites para acotar lecturas (ajustables).
const LIMITE_OPS_RANGO = 400;

// ✅ (A) Documento(s) de configuración de columnas COMPARTIDA en Firestore.
const CONFIG_COLUMNAS_COLLECTION = 'config_columnas';
const DOC_COLUMNAS_OPS = 'facturacion_clientes_ops';
const DOC_COLUMNAS_HISTORIAL = 'facturacion_clientes_historial';

// ✅ Lee un catálogo desde la caché local (cat_v1__<alias>) que mantienen
// OperacionesDashboard / FormularioOperacion. Evita lecturas de Firestore.
const leerCacheLocal = (alias: string): any[] | null => {
  try {
    const raw = localStorage.getItem(`cat_v1__${alias}`);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && Array.isArray(obj.data) ? obj.data : null;
  } catch { return null; }
};

// ──────────────────────────────────────────────────────────────────────
// ✅ (B) Mapa id→nombre con TODOS los catálogos cacheados. Cero lecturas a
//     Firestore: usa únicamente lo que ya guardaron otros dashboards. Sirve
//     para mostrar el NOMBRE cuando un registro viejo solo tiene el ID.
// ──────────────────────────────────────────────────────────────────────
const construirMapaCatalogos = (): Record<string, string> => {
  const mapa: Record<string, string> = {};
  const tomarNombre = (item: any): string | null => {
    if (!item || item.id === undefined || item.id === null) return null;
    const n = item.nombre ?? item.nombreCorto ?? item.label ?? item.descripcion ?? item.name ?? item.titulo;
    return (n !== undefined && n !== null && String(n) !== '') ? String(n) : null;
  };
  // Catálogos estándar cat_v1__<alias>
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.indexOf('cat_v1__') !== 0) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        const arr = obj && Array.isArray(obj.data) ? obj.data : (Array.isArray(obj) ? obj : null);
        if (!arr) continue;
        arr.forEach((item: any) => {
          const n = tomarNombre(item);
          if (n) mapa[String(item.id)] = n;
        });
      } catch { /* catálogo corrupto: ignorar */ }
    }
  } catch { /* localStorage no disponible */ }
  // Respaldo: roelca_catalogos_v2 (forma desconocida → con guardas defensivas)
  try {
    const rawV2 = localStorage.getItem('roelca_catalogos_v2');
    if (rawV2) {
      const obj = JSON.parse(rawV2);
      Object.values(obj || {}).forEach((val: any) => {
        const arr = Array.isArray(val) ? val : (val && Array.isArray(val.data) ? val.data : null);
        if (!arr) return;
        arr.forEach((item: any) => {
          const n = tomarNombre(item);
          if (n && !mapa[String(item.id)]) mapa[String(item.id)] = n;
        });
      });
    }
  } catch { /* noop */ }
  return mapa;
};

// ✅ (A) Reconstruye las columnas a partir de la BASE (código) aplicando el
//     orden + visibilidad guardados. Garantiza que columnas nuevas del código
//     que no estaban guardadas sigan apareciendo (al final).
const aplicarConfigColumnasGuardada = (base: any[], guardadas: any): any[] => {
  if (!Array.isArray(guardadas) || guardadas.length === 0) return base.map((c: any) => ({ ...c }));
  const baseById = new Map<string, any>(base.map((c: any) => [c.id, c]));
  const resultado: any[] = [];
  const usados = new Set<string>();
  guardadas.forEach((g: any) => {
    const def = baseById.get(g?.id);
    if (def && !usados.has(g.id)) {
      resultado.push({ ...def, visible: !!g.visible });
      usados.add(g.id);
    }
  });
  // Columnas nuevas (agregadas en código) que no estaban guardadas → al final
  base.forEach((c: any) => { if (!usados.has(c.id)) resultado.push({ ...c }); });
  return resultado;
};

// Columnas configurables del Historial de Facturas (tabla + Excel).
const COLUMNAS_FACTURA_BASE = [
  { id: 'invoice',     label: 'Invoice',      visible: true },
  { id: 'fecha',       label: 'Fecha',        visible: true },
  { id: 'cliente',     label: 'Cliente',      visible: true },
  { id: 'moneda',      label: 'Moneda',       visible: true },
  { id: 'facturaCcp',  label: 'Factura CCP',  visible: true },
  { id: 'cantOps',     label: 'Cant. Ops',    visible: true },
  { id: 'referencias', label: 'Referencias',  visible: true },
  { id: 'total',       label: 'Total',        visible: true },
  { id: 'createdAt',   label: 'Registrada',   visible: false },
];

// Límite para "Historial de Facturas" cuando se carga sin filtro de fechas.
const LIMITE_FACTURAS_TODAS = 2000;

// ──────────────────────────────────────────────────────────────────────
// ✅ Normalización de facturas (compat. con datos viejos):
//    · fecha    : acepta 'fecha' (ISO) o 'fechaFactura' (DD/M/YYYY o D/M/YYYY)
//    · operacionesIds       : string o array → siempre array
//    · operacionesGuardadas : ausente → reconstruir desde operacionesIds
//    · campos faltantes     : clienteNombre, subtotalFactura, monedaFacturacion,
//      facturaCcp se completan con defaults seguros para que el resto del
//      dashboard funcione (orden, búsqueda, totales, render de píldoras).
// ──────────────────────────────────────────────────────────────────────
const parseFechaFactura = (val: any): string => {
  if (!val) return '';
  const s = String(val).trim();
  if (!s) return '';
  // Ya en ISO (YYYY-MM-DD…)
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${y}-${(m || '01').padStart(2, '0')}-${(d || '01').padStart(2, '0')}`;
  }
  // DD/MM/YYYY o D/M/YYYY
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  // YYYY/MM/DD
  const m2 = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  return s;
};

const normalizarFactura = (raw: any): any => {
  const fechaNorm = parseFechaFactura(raw.fecha || raw.fechaFactura);

  // operacionesIds: string o array → array
  let opsIds: any = raw.operacionesIds;
  if (typeof opsIds === 'string') opsIds = opsIds ? [opsIds] : [];
  if (!Array.isArray(opsIds)) opsIds = [];

  // operacionesGuardadas: si no es array, construir mínimo desde opsIds
  let opsGuardadas: any = raw.operacionesGuardadas;
  if (!Array.isArray(opsGuardadas) || opsGuardadas.length === 0) {
    opsGuardadas = opsIds.map((idOrRef: string) => ({
      id: String(idOrRef || ''),
      ref: String(idOrRef || ''),
      monto: 0,
      subtotalBase: 0,
    }));
  }

  return {
    ...raw,
    fecha: fechaNorm || String(raw.fecha || raw.fechaFactura || ''),
    operacionesIds: opsIds,
    operacionesGuardadas: opsGuardadas,
    // defaults defensivos
    subtotalFactura: Number(raw.subtotalFactura) || Number(raw.total) || 0,
    monedaFacturacion: raw.monedaFacturacion || raw.moneda || 'N/A',
    clienteNombre: raw.clienteNombre || raw.cliente || '',
    facturaCcp: raw.facturaCcp || raw.ccp || '',
    invoice: raw.invoice || raw.numeroInvoice || raw.numInvoice || raw.folio || String(raw.id || ''),
  };
};

// Columnas configurables de la tabla "Asignar Operaciones" (tabla + Excel).
// Las 10 primeras tienen render bespoke y son visibles por defecto. El resto
// se renderizan de forma genérica a partir de `sourceField` (qué propiedad
// leer del doc de `operaciones`) + `tipo` (cómo formatear el valor).
// Cuando `sourceField` es un array, se toma la primera con valor.
const COLUMNAS_OPS_BASE: any[] = [
  // ─── Defaults visibles (render bespoke) ──────────────────────────
  { id: 'ref',           label: 'Ref. Operación',  visible: true,  orden: true,  grupo: 'General' },
  { id: 'fechaServicio', label: 'Fecha Servicio',  visible: true,  orden: true,  grupo: 'General' },
  { id: 'cliente',       label: 'Cliente',         visible: true,  orden: true,  grupo: 'General' },
  { id: 'cartaPorte',    label: 'Carta Porte',     visible: true,  orden: false, grupo: 'General' },
  { id: 'destino',       label: 'Destino',         visible: true,  orden: true,  grupo: 'General' },
  { id: 'moneda',        label: 'Moneda',          visible: true,  orden: false, grupo: 'Por Cobrar' },
  { id: 'subtotal',      label: 'Subtotal',        visible: true,  orden: true,  grupo: 'Por Cobrar' },
  { id: 'dolares',       label: 'Dólares',         visible: true,  orden: false, grupo: 'Por Cobrar' },
  { id: 'pesos',         label: 'Pesos',           visible: true,  orden: false, grupo: 'Por Cobrar' },
  { id: 'conv',          label: 'Conversión',      visible: true,  orden: true,  grupo: 'Por Cobrar' },

  // ─── Información General ─────────────────────────────────────────
  { id: 'tipoOperacion',  label: 'Tipo de Operación', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['tipoOperacionNombre', 'tipoOperacionId'] },
  { id: 'status',         label: 'Status',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['statusNombre', 'status'] },
  { id: 'fechaCita',      label: 'Fecha Cita',        visible: false, orden: true,  grupo: 'General', tipo: 'fechaHora', sourceField: 'fechaCita' },
  { id: 'convenio',       label: 'Convenio (Tarifa)', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['convenioNombre', 'convenio'] },
  { id: 'remolque',       label: '# Remolque',        visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['remolqueNombre', 'remolquePlaca', 'numeroRemolque'] },
  { id: 'refCliente',     label: 'Ref Cliente',       visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: 'refCliente' },
  { id: 'origen',         label: 'Origen',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['origenNombre', 'origen'] },
  { id: 'observacionesEjecutivo', label: 'Obs. Ejecutivo',    visible: false, orden: false, grupo: 'General', tipo: 'texto',     sourceField: 'observacionesEjecutivo' },
  { id: 'createdAt',      label: 'Fecha de Creación', visible: false, orden: true,  grupo: 'General', tipo: 'fechaHora', sourceField: 'createdAt' },

  // ─── Pedimento y CT ──────────────────────────────────────────────
  { id: 'clienteMercancia',     label: 'Cliente (Mercancía)',  visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: ['clienteMercanciaNombre', 'clienteMercancia'] },
  { id: 'descripcionMercancia', label: 'Descripción Mercancía', visible: false, orden: false, grupo: 'Pedimento', tipo: 'texto',  sourceField: 'descripcionMercancia' },
  { id: 'cantidad',             label: 'Cantidad',              visible: false, orden: true,  grupo: 'Pedimento', tipo: 'numero', sourceField: 'cantidad' },
  { id: 'embalaje',             label: 'Embalaje',              visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: ['embalajeNombre', 'embalaje'] },
  { id: 'pesoKg',               label: 'Peso (Kg)',             visible: false, orden: true,  grupo: 'Pedimento', tipo: 'numero', sourceField: 'pesoKg' },
  { id: 'numDoda',              label: '# DODA',                visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: 'numDoda' },
  { id: 'fechaEmisionDoda',     label: 'Fecha Emisión DODA',    visible: false, orden: true,  grupo: 'Pedimento', tipo: 'fecha',  sourceField: 'fechaEmisionDoda' },

  // ─── Entry's y Manifiestos ───────────────────────────────────────
  { id: 'numeroEntrys',    label: "# Entry's",          visible: false, orden: false, grupo: 'Manifiestos', tipo: 'texto',  sourceField: 'numeroEntrys' },
  { id: 'cantEntrys',      label: "Cant. Entry's",      visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'numero', sourceField: 'cantEntrys' },
  { id: 'numManifiesto',   label: '# Manifiesto',       visible: false, orden: false, grupo: 'Manifiestos', tipo: 'texto',  sourceField: 'numManifiesto' },
  { id: 'provServicios',   label: 'Prov. Servicios',    visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'texto',  sourceField: ['provServiciosNombre', 'provServicios'] },
  { id: 'montoManifiesto', label: 'Costo Manifiesto',   visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'monto',  sourceField: 'montoManifiesto' },

  // ─── Unidad y Operador ───────────────────────────────────────────
  { id: 'proveedorUnidad',       label: 'Proveedor Transporte', visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: ['proveedorUnidadNombre', 'proveedorUnidad'] },
  { id: 'monedaUnidad',          label: 'Moneda Prov.',         visible: false, orden: false, grupo: 'Unidad', tipo: 'texto', sourceField: ['monedaUnidadNombre', 'facturadoEnUnidad'] },
  { id: 'convenioProveedor',     label: 'Convenio Proveedor',   visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: ['convenioProveedorNombre', 'convenioProveedor'] },
  { id: 'monedaConvenioProv',    label: 'Moneda Convenio Prov.', visible: false, orden: false, grupo: 'Unidad', tipo: 'moneda', sourceField: 'monedaConvenioProv' },
  { id: 'totalAPagarProv',       label: 'Monto a Pagar (Prov)', visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'totalAPagarProv' },
  { id: 'cargosAdicionalesProv', label: 'Cargos Adic. (Prov)',  visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'cargosAdicionalesProv' },
  { id: 'subtotalProv',          label: 'Subtotal Prov.',       visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'subtotalProv' },
  { id: 'dolaresProv',           label: 'Dólares Prov.',        visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'dolaresProv' },
  { id: 'pesosProv',             label: 'Pesos Prov.',          visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'pesosProv' },
  { id: 'conversionProv',        label: 'Conversión Prov.',     visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'conversionProv' },
  { id: 'unidad',                label: 'Unidad Asignada',      visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: ['unidadNombre', 'unidad'] },
  { id: 'operador',              label: 'Operador',             visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: ['operadorNombre', 'operador'] },
  { id: 'sueldoOperador',        label: 'Sueldo Operador',      visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'sueldoOperador' },
  { id: 'sueldoExtra',           label: 'Sueldo Extra',         visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'sueldoExtra' },
  { id: 'sueldoTotal',           label: 'Sueldo Total',         visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'sueldoTotal' },
  { id: 'combustible',           label: 'Combustible',          visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'combustible' },
  { id: 'combustibleExtra',      label: 'Combustible Extra',    visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'combustibleExtra' },
  { id: 'combustibleTotal',      label: 'Total Combustible',    visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'combustibleTotal' },
  { id: 'totalGastos',           label: 'Total Gastos',         visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'totalGastos' },
  { id: 'unidadProveedor',       label: 'Unidad Externa',       visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: 'unidadProveedor' },
  { id: 'operadorProveedor',     label: 'Operador Externo',     visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: 'operadorProveedor' },
  { id: 'observacionesUnidad',   label: 'Obs. Unidad/Prov.',    visible: false, orden: false, grupo: 'Unidad', tipo: 'texto', sourceField: 'observacionesUnidad' },

  // ─── Por Cobrar ──────────────────────────────────────────────────
  { id: 'monedaConvenioCliente', label: 'Moneda Convenio Cliente', visible: false, orden: false, grupo: 'Por Cobrar', tipo: 'moneda', sourceField: 'monedaConvenioCliente' },
  { id: 'montoConvenioCliente',  label: 'Monto Convenio Cliente',  visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'montoConvenioCliente' },
  { id: 'cargosAdicionales',     label: 'Cargos Adicionales',      visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'cargosAdicionales' },
  { id: 'subtotalCliente',       label: 'Subtotal Cliente',        visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'subtotalCliente' },
  { id: 'tipoCambioAprobado',    label: 'TC Aprobado',             visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'numero', sourceField: 'tipoCambioAprobado' },
  { id: 'dolaresCliente',        label: 'Dólares Cliente',         visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'dolaresCliente' },
  { id: 'pesosCliente',          label: 'Pesos Cliente',           visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'pesosCliente' },
  { id: 'conversionCliente',     label: 'Conversión Cliente',      visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'conversionCliente' },
  { id: 'utilidadEstimada',      label: 'Utilidad Estimada',       visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'utilidadEstimada' },
  { id: 'observacionesCobrar',   label: 'Obs. Facturación/Cobro',  visible: false, orden: false, grupo: 'Por Cobrar', tipo: 'texto',  sourceField: 'observacionesCobrar' },
];

// ──────────────────────────────────────────────────────────────────────
// Helpers de conversión (misma lógica que el formulario de Operaciones)
// ──────────────────────────────────────────────────────────────────────
const calcularConversionCliente = (op: any) => {
  const fact = op.facturadoEnCobrar;
  const tc = Number(op.tipoCambioAprobado) || 0;
  const subtotal = Number(op.montoConvenioCliente || 0) + Number(op.cargosAdicionales || 0);
  let dol = 0, pes = 0, conv = 0;
  const nombreMoneda = String(op.monedaCobroNombre || '').toUpperCase();
  const esDolar = fact === ID_USD || nombreMoneda.includes('USD');
  const esPeso = fact === ID_MXN || nombreMoneda.includes('MXN');
  if (esDolar) { dol = subtotal; pes = 0; conv = subtotal * tc; }
  else if (esPeso) { dol = 0; pes = subtotal; conv = subtotal; }
  else { conv = subtotal; }
  return { subtotal, dol, pes, conv };
};

const obtenerMontoOperacion = (op: any) => {
  const convGuardada = Number(op.conversionCliente);
  if (!isNaN(convGuardada) && convGuardada > 0) {
    return {
      subtotal: Number(op.subtotalCliente) || 0,
      dol: Number(op.dolaresCliente) || 0,
      pes: Number(op.pesosCliente) || 0,
      conv: convGuardada,
    };
  }
  return calcularConversionCliente(op);
};

export const FacturacionClientesDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial'>('operaciones');

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [facturasGlobales, setFacturasGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(false);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);

  // Catálogos
  const [empresasList, setEmpresasList] = useState<any[]>([]);

  // ✅ (1) Filtro principal: rango de fechas (obligatorio). Cliente opcional.
  const [fechaDesdeOps, setFechaDesdeOps] = useState('');
  const [fechaHastaOps, setFechaHastaOps] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const ambasFechas = !!(fechaDesdeOps && fechaHastaOps);

  // Orden
  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [ordenFac, setOrdenFac] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fecha', dir: 'desc' });

  // Buscador de cliente
  const [textoBuscarCliente, setTextoBuscarCliente] = useState('');
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);

  // ✅ Buscador del Historial de Facturas (filtra en memoria)
  const [textoBuscarFactura, setTextoBuscarFactura] = useState('');

  // Paginación Historial
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Modal de facturación
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [facturaViendo, setFacturaViendo] = useState<any | null>(null);

  // ✅ (A) Estado de guardado de la configuración de columnas (compartida)
  const [guardandoCols, setGuardandoCols] = useState(false);

  // Columnas del historial
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasFactura, setColumnasFactura] = useState(COLUMNAS_FACTURA_BASE.map(c => ({ ...c })));
  // Columnas de "Asignar Operaciones"
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);
  // ✅ Buscador dentro del modal "Configurar Columnas" de Operaciones
  const [busquedaColOps, setBusquedaColOps] = useState('');
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // Detalle de operación
  const [operacionDetalle, setOperacionDetalle] = useState<any | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');

  // Campos del formulario de factura
  const [invoiceForm, setInvoiceForm] = useState('');
  const [fechaForm, setFechaForm] = useState(new Date().toISOString().split('T')[0]);
  const [facturaCcpForm, setFacturaCcpForm] = useState('');

  // ──────────────────────────────────────────────────────────────────
  // Formateadores
  // ──────────────────────────────────────────────────────────────────
  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatearFechaSpanish = (fechaString: string) => {
    if (!fechaString) return '-';
    try {
      return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return fechaString; }
  };

  const formatearFechaHora = (isoString: string | undefined | null) => {
    if (!isoString) return '-';
    try { return new Date(isoString).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return isoString; }
  };

  const mostrarDato = (dato: any) => (dato && dato !== '' ? dato : '-');

  const mostrarMoneda = (val: string | null | undefined) => {
    if (val === ID_USD) return 'USD';
    if (val === ID_MXN) return 'MXN';
    return val || '-';
  };

  // ──────────────────────────────────────────────────────────────────
  // ✅ (B) Resolución de NOMBRE a partir de un ID (catálogos cacheados)
  // ──────────────────────────────────────────────────────────────────
  const mapaCatalogos = useMemo(() => {
    const m = construirMapaCatalogos();
    // Empresas ya cargadas (clientes, proveedores, etc.)
    empresasList.forEach((e: any) => {
      if (e?.id) m[String(e.id)] = e.nombre || e.nombreCorto || m[String(e.id)] || String(e.id);
    });
    // Monedas conocidas
    m[ID_USD] = 'USD';
    m[ID_MXN] = 'MXN';
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresasList]);

  // Devuelve el nombre si el valor es un ID conocido; si no, el valor tal cual.
  const resolverNombre = (val: any): any => {
    if (val === '' || val === null || val === undefined) return val;
    return mapaCatalogos[String(val)] || val;
  };

  // Primer candidato con valor, resolviendo ID→nombre. '-' si todos vacíos.
  const txt = (...cands: any[]): string => {
    for (const c of cands) {
      if (c !== undefined && c !== null && c !== '') {
        const r = resolverNombre(c);
        return (r === undefined || r === null || r === '') ? '-' : String(r);
      }
    }
    return '-';
  };

  // ──────────────────────────────────────────────────────────────────
  // ✅ (3) Empresas: caché-primero, getDocs UNA vez si falta. Sin onSnapshot.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const cache = leerCacheLocal('empresas');
    if (cache && cache.length) { setEmpresasList(cache); return; }
    let activo = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'empresas'));
        if (!activo) return;
        const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setEmpresasList(docs);
        try { localStorage.setItem('cat_v1__empresas', JSON.stringify({ data: docs, ts: Date.now() })); } catch { /* noop */ }
      } catch (e) { console.error('Error cargando empresas:', e); }
    })();
    return () => { activo = false; };
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // ✅ (A) Cargar configuración de columnas COMPARTIDA (una sola lectura por
  //     documento al montar). Si existe, se aplica para todos los usuarios.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [snapOps, snapHist] = await Promise.all([
          getDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_OPS)),
          getDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_HISTORIAL)),
        ]);
        if (!activo) return;
        if (snapOps.exists()) {
          const data = snapOps.data() as any;
          setColumnasOps(aplicarConfigColumnasGuardada(COLUMNAS_OPS_BASE, data?.columnas));
        }
        if (snapHist.exists()) {
          const data = snapHist.data() as any;
          setColumnasFactura(aplicarConfigColumnasGuardada(COLUMNAS_FACTURA_BASE, data?.columnas));
        }
      } catch (e) {
        console.error('Error cargando configuración de columnas (compartida):', e);
      }
    })();
    return () => { activo = false; };
  }, []);

  // ✅ (A) Guardar configuración de columnas de "Asignar Operaciones" para
  //     TODOS los usuarios (Firestore).
  const guardarConfigColumnasOps = async () => {
    setGuardandoCols(true);
    try {
      const payload = columnasOps.map(c => ({ id: c.id, visible: !!c.visible }));
      await setDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_OPS), {
        columnas: payload,
        updatedAt: new Date().toISOString(),
      });
      setModalColumnasOps(false);
      setBusquedaColOps('');
    } catch (e) {
      console.error('Error guardando columnas (operaciones):', e);
      alert('No se pudo guardar la configuración de columnas para todos los usuarios.\nRevisa tus permisos de escritura en Firestore (colección config_columnas).');
    } finally {
      setGuardandoCols(false);
    }
  };

  // ✅ (A) Guardar configuración de columnas del "Historial de Facturas" para
  //     TODOS los usuarios (Firestore).
  const guardarConfigColumnasHistorial = async () => {
    setGuardandoCols(true);
    try {
      const payload = columnasFactura.map(c => ({ id: c.id, visible: !!c.visible }));
      await setDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_HISTORIAL), {
        columnas: payload,
        updatedAt: new Date().toISOString(),
      });
      setModalColumnas(false);
    } catch (e) {
      console.error('Error guardando columnas (historial):', e);
      alert('No se pudo guardar la configuración de columnas para todos los usuarios.\nRevisa tus permisos de escritura en Firestore (colección config_columnas).');
    } finally {
      setGuardandoCols(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────
  // ✅ HISTORIAL DE FACTURAS: carga TODAS al entrar a la pestaña historial,
  //    igual que el Historial de Referencias del Diésel.
  //    IMPORTANTE: NO usar orderBy('fecha') porque las facturas antiguas
  //    NO tienen ese campo (usan 'fechaFactura' en formato DD/M/YYYY) y
  //    quedarían fuera del resultado. Cargamos sin orden y ordenamos en
  //    memoria con la fecha ya normalizada.
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'historial') return;
    // Si ya hay facturas cargadas, no volver a pedirlas al cambiar filtros.
    if (facturasGlobales.length > 0) return;

    const descargar = async () => {
      setCargandoFacturas(true);
      try {
        const snap = await getDocs(query(
          collection(db, 'facturas_clientes'),
          limit(LIMITE_FACTURAS_TODAS),
        ));
        const docs = snap.docs.map(d => normalizarFactura({ id: d.id, ...(d.data() as any) }));
        // Orden por fecha ISO desc; las que no tengan fecha se quedan al final.
        docs.sort((a: any, b: any) => {
          const fa = String(a.fecha || '');
          const fb = String(b.fecha || '');
          if (!fa && !fb) return 0;
          if (!fa) return 1;
          if (!fb) return -1;
          return fb.localeCompare(fa);
        });
        setFacturasGlobales(docs);
        if (docs.length === LIMITE_FACTURAS_TODAS) {
          console.warn(`[Facturación Historial] Se alcanzó el límite de ${LIMITE_FACTURAS_TODAS} facturas. Podría haber más.`);
        }
      } catch (e: any) {
        const msg = String(e?.message || e?.code || e || '');
        console.error('[Facturación Historial] Error al cargar facturas:', e);
        alert(`No se pudieron cargar las facturas.\n\nDetalle: ${msg}`);
      }
      setCargandoFacturas(false);
    };

    descargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ──────────────────────────────────────────────────────────────────
  // ✅ (1)(3) OPERACIONES por RANGO DE FECHAS + status completado (cliente
  //    opcional). Solo en la pestaña operaciones y solo con ambas fechas.
  //    El filtro "no facturadas" se aplica en memoria (ver operacionesMostradas).
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'operaciones') return;
    if (!ambasFechas) { setOperacionesGlobales([]); return; }

    const descargar = async () => {
      setCargandoOperaciones(true);

      const filtrarMem = (ops: any[]) => ops.filter(op =>
        STATUS_COMPLETADOS.includes(String(op.status || '').trim()) &&
        (!filtroCliente || String(op.clientePaga || op.clienteId || '') === filtroCliente)
      );

      let opsFinal: any[] = [];
      let exito = false;

      try {
        const cons: any[] = [
          where('status', 'in', STATUS_COMPLETADOS),
          where('fechaServicio', '>=', fechaDesdeOps),
          where('fechaServicio', '<=', fechaHastaOps),
          orderBy('fechaServicio', 'desc'),
          limit(LIMITE_OPS_RANGO),
        ];
        if (filtroCliente) cons.unshift(where('clientePaga', '==', filtroCliente));
        const snap = await getDocs(query(collection(db, 'operaciones'), ...cons));
        opsFinal = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        exito = true;
      } catch (e1: any) {
        const msg1 = String(e1?.message || e1?.code || e1 || '');
        const esIndice = msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition');
        if (esIndice) {
          console.warn('[Facturación] Falta índice (status+fecha). Fallback por rango de fecha. Detalle:', msg1);
          try {
            // Sin índice compuesto: rango por fecha (índice automático) y se
            // filtra status/cliente en memoria.
            const snap2 = await getDocs(query(
              collection(db, 'operaciones'),
              where('fechaServicio', '>=', fechaDesdeOps),
              where('fechaServicio', '<=', fechaHastaOps),
              orderBy('fechaServicio', 'desc'),
              limit(LIMITE_OPS_RANGO * 2),
            ));
            const todas = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            opsFinal = filtrarMem(todas).slice(0, LIMITE_OPS_RANGO);
            exito = true;
          } catch (e2: any) {
            console.error('[Facturación] Fallback falló:', e2);
            alert(`No se pudieron cargar las operaciones.\n\nDetalle: ${e2?.message || e2}`);
          }
        } else {
          console.error('[Facturación] Error inesperado:', e1);
          alert(`Hubo un problema al cargar las operaciones.\n\nDetalle: ${msg1}`);
        }
      }

      if (exito) setOperacionesGlobales(opsFinal);
      setCargandoOperaciones(false);
    };

    descargar();
  }, [fechaDesdeOps, fechaHastaOps, filtroCliente, activeTab, ambasFechas]);

  // ──────────────────────────────────────────────────────────────────
  // Traductor de clientes / buscador
  // ──────────────────────────────────────────────────────────────────
  const getNombreCliente = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = empresasList.find(e => e.id === idOrName || e.nombre === idOrName || e.nombreCorto === idOrName);
    if (found) return found.nombre || found.nombreCorto || idOrName;
    // ✅ (B) Fallback: otros catálogos cacheados (para datos viejos con ID).
    const porCatalogo = mapaCatalogos[String(idOrName)];
    return porCatalogo || idOrName;
  };

  const clientesFiltradosBuscador = useMemo(() => {
    if (!empresasList.length) return [];
    const esClientePaga = (emp: any) => {
      const tipos = emp?.tiposEmpresa;
      if (Array.isArray(tipos)) return tipos.some((t: any) => String(t).trim() === ID_TIPO_CLIENTE_PAGA);
      if (typeof tipos === 'string') return tipos.includes(ID_TIPO_CLIENTE_PAGA);
      if (tipos && typeof tipos === 'object') return Object.values(tipos).some((v: any) => String(v).trim() === ID_TIPO_CLIENTE_PAGA);
      return false;
    };
    const clientes = empresasList
      .filter(esClientePaga)
      .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
    if (!textoBuscarCliente.trim()) return clientes.slice(0, 30);
    const q = textoBuscarCliente.toLowerCase().trim();
    return clientes.filter((c: any) =>
      String(c.nombre || '').toLowerCase().includes(q) ||
      String(c.rfc || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [empresasList, textoBuscarCliente]);

  const nombreClienteSeleccionado = useMemo(() => {
    if (!filtroCliente || !empresasList.length) return filtroCliente || '';
    const cli = empresasList.find(e => e.id === filtroCliente);
    return cli?.nombre || filtroCliente;
  }, [filtroCliente, empresasList]);

  // ──────────────────────────────────────────────────────────────────
  // (2) "No facturada" = la operación no está ligada a ninguna factura.
  // ──────────────────────────────────────────────────────────────────
  const esFacturada = (op: any) => !!op.facturaClienteId || !!op.facturado;

  // Cliente efectivo para la factura: el del filtro, o —si no hay filtro— el
  // único cliente compartido por las operaciones seleccionadas.
  const clienteFacturaId = useMemo(() => {
    if (filtroCliente) return filtroCliente;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = op?.clientePaga || op?.clienteId;
      if (c) ids.add(String(c));
    });
    return ids.size === 1 ? [...ids][0] : '';
  }, [filtroCliente, seleccionadas, operacionesGlobales]);

  const seleccionMultiCliente = useMemo(() => {
    if (filtroCliente) return false;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = op?.clientePaga || op?.clienteId;
      if (c) ids.add(String(c));
    });
    return ids.size > 1;
  }, [filtroCliente, seleccionadas, operacionesGlobales]);

  const nombreClienteFactura = useMemo(() => {
    if (!clienteFacturaId) return '';
    const porCatalogo = getNombreCliente(clienteFacturaId);
    if (porCatalogo && porCatalogo !== clienteFacturaId) return porCatalogo;
    const op = operacionesGlobales.find(o => String(o.clientePaga || o.clienteId || '') === clienteFacturaId);
    return op?.clienteNombre || op?.nombreCliente || clienteFacturaId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteFacturaId, empresasList, operacionesGlobales]);

  const monedaFacturacion = useMemo(() => {
    if (!clienteFacturaId) return '-';
    const empresa = empresasList.find(e => e.id === clienteFacturaId);
    if (!empresa) {
      const op = operacionesGlobales.find(o => String(o.clientePaga || o.clienteId || '') === clienteFacturaId);
      return op?.monedaCobroNombre || '-';
    }
    const idMoneda = empresa.monedaRef || empresa.moneda;
    if (idMoneda === ID_MXN) return 'MXN';
    if (idMoneda === ID_USD) return 'USD';
    return idMoneda || 'No definida en catálogo';
  }, [clienteFacturaId, empresasList, operacionesGlobales]);

  // ──────────────────────────────────────────────────────────────────
  // ✅ Helpers genéricos para columnas configurables (sourceField + tipo)
  //    Se usan en `valorOrdenOp`, `valorCeldaOps` y `renderCeldaOps` para
  //    soportar dinámicamente cualquier campo del doc de `operaciones`.
  // ──────────────────────────────────────────────────────────────────
  const valorGenericoOp = (op: any, col: any): any => {
    if (!col?.sourceField) return '';
    const fields: string[] = Array.isArray(col.sourceField) ? col.sourceField : [col.sourceField];
    for (const f of fields) {
      const v = (op as any)?.[f];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return '';
  };

  const formatearValorGenericoOp = (val: any, tipo?: string): string => {
    if (val === '' || val === null || val === undefined) return '-';
    switch (tipo) {
      case 'monto':     return formatoMoneda(val);
      case 'numero':    return String(val);
      case 'fecha':     return formatearFechaSpanish(String(val));
      case 'fechaHora': return formatearFechaHora(String(val));
      case 'moneda':    return mostrarMoneda(String(val));
      // ✅ (B) texto: si el valor es un ID conocido, mostrar el NOMBRE.
      default:          return String(resolverNombre(val));
    }
  };

  const valorOrdenOp = (op: any, campo: string): string | number => {
    switch (campo) {
      case 'ref': return String(op.numReferencia || op.referencia || op.ref || op.id || '').toLowerCase();
      case 'fechaServicio': return String(op.fechaServicio || op.createdAt || '');
      case 'cliente': return getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId).toLowerCase();
      case 'destino': return String(op.destinoNombre || op.destino || '').toLowerCase();
      case 'subtotal': return obtenerMontoOperacion(op).subtotal;
      case 'conv': return obtenerMontoOperacion(op).conv;
      default: {
        const col = columnasOps.find(c => c.id === campo);
        const raw = valorGenericoOp(op, col);
        if (col?.tipo === 'monto' || col?.tipo === 'numero') return Number(raw) || 0;
        // ✅ (B) ordenar por NOMBRE resuelto cuando es texto/ID.
        return String(resolverNombre(raw) || '').toLowerCase();
      }
    }
  };

  // Rango de fechas en memoria (respaldo; la consulta ya viene acotada).
  const dentroRangoFecha = (op: any) => {
    if (!fechaDesdeOps && !fechaHastaOps) return true;
    const f = String(op.fechaServicio || op.createdAt || '').slice(0, 10);
    if (!f) return false;
    if (fechaDesdeOps && f < fechaDesdeOps) return false;
    if (fechaHastaOps && f > fechaHastaOps) return false;
    return true;
  };

  // ✅ (2) Solo NO facturadas, dentro del rango. Ordenadas.
  const operacionesMostradas = useMemo(() => {
    if (!ambasFechas) return [];
    const lista = operacionesGlobales.filter(op => !esFacturada(op) && dentroRangoFecha(op));
    const dir = ordenOps.dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = valorOrdenOp(a, ordenOps.campo);
      const vb = valorOrdenOp(b, ordenOps.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, ambasFechas, ordenOps, empresasList, fechaDesdeOps, fechaHastaOps, columnasOps, mapaCatalogos]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });

  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const valorCeldaOps = (op: any, key: string, m: any) => {
    switch (key) {
      case 'ref': return op.numReferencia || op.referencia || op.ref || op.id;
      case 'fechaServicio': return formatearFechaSpanish(op.fechaServicio || op.createdAt);
      case 'cliente': return getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId);
      case 'cartaPorte': return op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-';
      case 'destino': return op.destinoNombre || op.destino || '-';
      case 'moneda': return op.monedaCobroNombre || mostrarMoneda(op.facturadoEnCobrar);
      case 'subtotal': return m.subtotal;
      case 'dolares': return m.dol;
      case 'pesos': return m.pes;
      case 'conv': return m.conv;
      default: {
        const col = columnasOps.find(c => c.id === key);
        return formatearValorGenericoOp(valorGenericoOp(op, col), col?.tipo);
      }
    }
  };

  const renderCeldaOps = (op: any, key: string, m: any) => {
    const tdBase: React.CSSProperties = { padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' };
    switch (key) {
      case 'ref': return <td key={key} style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op.numReferencia || op.referencia || op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'cliente': return <td key={key} style={tdBase}>{getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId)}</td>;
      case 'cartaPorte': return <td key={key} style={tdBase}>{op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destinoNombre || op.destino || '-'}</td>;
      case 'moneda': return <td key={key} style={tdBase}>{op.monedaCobroNombre || mostrarMoneda(op.facturadoEnCobrar)}</td>;
      case 'subtotal': return <td key={key} style={tdBase}>{formatoMoneda(m.subtotal)}</td>;
      case 'dolares': return <td key={key} style={{ ...tdBase, color: '#10b981' }}>{formatoMoneda(m.dol)}</td>;
      case 'pesos': return <td key={key} style={{ ...tdBase, color: '#3b82f6' }}>{formatoMoneda(m.pes)}</td>;
      case 'conv': return <td key={key} style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.conv)}</td>;
      default: {
        const col = columnasOps.find(c => c.id === key);
        const text = formatearValorGenericoOp(valorGenericoOp(op, col), col?.tipo);
        if (col?.tipo === 'monto') return <td key={key} style={{ ...tdBase, color: '#3fb950' }}>{text}</td>;
        if (col?.tipo === 'numero') return <td key={key} style={{ ...tdBase, textAlign: 'right' as const }}>{text}</td>;
        // texto largo: permite ajustar línea para no romper el layout
        const long = (col?.tipo === 'texto') && typeof text === 'string' && text.length > 60;
        if (long) return <td key={key} style={{ ...tdBase, whiteSpace: 'normal', maxWidth: '320px' }}>{text}</td>;
        return <td key={key} style={tdBase}>{text}</td>;
      }
    }
  };

  const handleDragStartOps = (_e: React.DragEvent, index: number) => setDraggedColOpsIndex(index);
  const handleDragEnterOps = (index: number) => {
    if (draggedColOpsIndex === null || draggedColOpsIndex === index) return;
    const nuevas = [...columnasOps];
    const movida = nuevas.splice(draggedColOpsIndex, 1)[0];
    nuevas.splice(index, 0, movida);
    setDraggedColOpsIndex(index);
    setColumnasOps(nuevas);
  };
  const toggleColumnaVisibleOps = (index: number) => {
    const nuevas = [...columnasOps];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasOps(nuevas);
  };

  const exportarExcelOps = () => {
    if (operacionesMostradas.length === 0) return alert('No hay operaciones para exportar con los filtros actuales.');
    const cols = columnasOps.filter(c => c.visible);
    if (cols.length === 0) return alert('Selecciona al menos una columna para exportar.');
    const datos = operacionesMostradas.map(op => {
      const m = obtenerMontoOperacion(op);
      const fila: any = {};
      cols.forEach(col => { fila[col.label] = valorCeldaOps(op, col.id, m); });
      return fila;
    });
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ops_Por_Facturar');
    const cli = (filtroCliente ? (nombreClienteSeleccionado || 'cliente') : 'todos').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
    XLSX.writeFile(wb, `Operaciones_PorFacturar_${cli}_${fechaDesdeOps}_a_${fechaHastaOps}.xlsx`);
  };

  // ──────────────────────────────────────────────────────────────────
  // Selección / resumen
  // ──────────────────────────────────────────────────────────────────
  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const resumenSeleccion = useMemo(() => {
    let subtotal = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        subtotal += obtenerMontoOperacion(op).conv;
        refs.push(op.numReferencia || op.referencia || op.ref || op.id?.substring(0, 6));
      }
    });
    return { subtotal, refs };
  }, [seleccionadas, operacionesGlobales]);

  // ──────────────────────────────────────────────────────────────────
  // Guardado de factura (cliente derivado; valida un solo cliente)
  // ──────────────────────────────────────────────────────────────────
  const handleGuardarFactura = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceForm.trim()) return alert('El # de Invoice es obligatorio.');
    if (seleccionMultiCliente || !clienteFacturaId) {
      return alert('Las operaciones seleccionadas deben ser de un mismo cliente. Selecciona un cliente en el filtro o elige operaciones de un solo cliente.');
    }
    setGuardando(true);
    try {
      const batch = writeBatch(db);

      const nuevoId = doc(collection(db, 'facturas_clientes')).id;

      const operacionesResumenEstable = seleccionadas.map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        const montos = op ? obtenerMontoOperacion(op) : { subtotal: 0, conv: 0, dol: 0, pes: 0 };
        return {
          id,
          ref: op?.numReferencia || op?.referencia || op?.ref || id.substring(0, 6),
          monto: montos.conv,
          subtotalBase: montos.subtotal,
        };
      });

      const data = {
        invoice: invoiceForm.trim(),
        fecha: fechaForm,
        facturaCcp: facturaCcpForm.trim(),
        clienteId: clienteFacturaId,
        clienteNombre: nombreClienteFactura || getNombreCliente(clienteFacturaId),
        monedaFacturacion,
        operacionesIds: seleccionadas,
        operacionesGuardadas: operacionesResumenEstable,
        subtotalFactura: resumenSeleccion.subtotal,
        createdAt: new Date().toISOString(),
      };

      batch.set(doc(db, 'facturas_clientes', nuevoId), data);
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), {
          facturaClienteId: nuevoId,
          facturaClienteInvoice: invoiceForm.trim(),
          facturado: true,
        });
      });

      await batch.commit();
      setModalAbierto(false);
      const idsFacturadas = [...seleccionadas];
      setSeleccionadas([]);
      setInvoiceForm('');
      setFacturaCcpForm('');
      // (2) marcar localmente como facturadas para que salgan de la lista
      setOperacionesGlobales(prev => prev.map(op =>
        idsFacturadas.includes(op.id) ? { ...op, facturaClienteId: nuevoId, facturaClienteInvoice: invoiceForm.trim(), facturado: true } : op
      ));
      setFacturasGlobales(prev => [normalizarFactura({ id: nuevoId, ...data }), ...prev]);
      setActiveTab('historial');
    } catch (error) {
      console.error(error);
      alert('Error al guardar la factura.');
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarFactura = async (e: React.MouseEvent, facData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar la factura ${facData.invoice}? Las operaciones asociadas quedarán liberadas nuevamente.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'facturas_clientes', facData.id));
        if (Array.isArray(facData.operacionesIds)) {
          facData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), {
              facturaClienteId: null,
              facturaClienteInvoice: null,
              facturado: false,
            });
          });
        }
        await batch.commit();
        setFacturasGlobales(prev => prev.filter(f => f.id !== facData.id));
        const idsLiberadas: string[] = Array.isArray(facData.operacionesIds) ? facData.operacionesIds : [];
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, facturaClienteId: null, facturaClienteInvoice: null, facturado: false } : op
        ));
      } catch (error) {
        console.error('Error al eliminar factura:', error);
        alert('Hubo un error al eliminar.');
      }
    }
  };

  // ──────────────────────────────────────────────────────────────────
  // Historial: orden + paginación
  // ──────────────────────────────────────────────────────────────────
  const valorOrdenFac = (f: any, campo: string): string | number => {
    switch (campo) {
      case 'invoice': return String(f.invoice || '').toLowerCase();
      case 'fecha': return String(f.fecha || '');
      case 'cliente': return String(f.clienteNombre || '').toLowerCase();
      case 'moneda': return String(f.monedaFacturacion || '').toLowerCase();
      case 'cantOps': return Number(f.operacionesIds?.length || 0);
      case 'total': return Number(f.subtotalFactura || 0);
      case 'createdAt': return String(f.createdAt || '');
      default: return '';
    }
  };

  const historialOrdenado = useMemo(() => {
    const dir = ordenFac.dir === 'asc' ? 1 : -1;
    const q = textoBuscarFactura.trim().toLowerCase();

    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.clienteNombre || '').toLowerCase().includes(q)) return true;
      // Fallback: nombre resuelto vía catálogo (facturas viejas sin clienteNombre)
      if (f.clienteId) {
        const nom = getNombreCliente(f.clienteId);
        if (nom && nom.toLowerCase().includes(q)) return true;
      }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaFacturacion || '').toLowerCase().includes(q)) return true;
      // Buscar también dentro de las referencias guardadas
      if (Array.isArray(f.operacionesGuardadas)) {
        if (f.operacionesGuardadas.some((op: any) => String(op?.ref || '').toLowerCase().includes(q))) return true;
      }
      return false;
    };

    const coincideCliente = (f: any) => !filtroCliente || String(f.clienteId || '') === filtroCliente;

    const coincideFechas = (f: any) => {
      if (!fechaDesdeOps && !fechaHastaOps) return true;
      const fc = String(f.fecha || '').slice(0, 10);
      if (!fc) return false;
      if (fechaDesdeOps && fc < fechaDesdeOps) return false;
      if (fechaHastaOps && fc > fechaHastaOps) return false;
      return true;
    };

    const filtradas = facturasGlobales.filter(f => coincideTexto(f) && coincideCliente(f) && coincideFechas(f));

    return [...filtradas].sort((a, b) => {
      const va = valorOrdenFac(a, ordenFac.campo);
      const vb = valorOrdenFac(b, ordenFac.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [facturasGlobales, ordenFac, textoBuscarFactura, filtroCliente, fechaDesdeOps, fechaHastaOps]);

  // ✅ Resumen para tarjetas del historial (siempre sobre lo filtrado/visible)
  const resumenHistorial = useMemo(() => {
    let totalUSD = 0;
    let totalMXN = 0;
    let totalSinMoneda = 0;
    let totalOps = 0;
    historialOrdenado.forEach(f => {
      const monto = Number(f.subtotalFactura) || 0;
      const mon = String(f.monedaFacturacion || '').toUpperCase();
      if (mon === 'USD') totalUSD += monto;
      else if (mon === 'MXN') totalMXN += monto;
      else totalSinMoneda += monto;
      totalOps += Array.isArray(f.operacionesIds) ? f.operacionesIds.length : 0;
    });
    return { cuenta: historialOrdenado.length, totalUSD, totalMXN, totalSinMoneda, totalOps };
  }, [historialOrdenado]);

  const toggleOrdenFac = (campo: string) =>
    setOrdenFac(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });

  const flechaFac = (campo: string) => ordenFac.campo === campo ? (ordenFac.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const totalPaginas = Math.ceil(historialOrdenado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialOrdenado.slice(indexFirst, indexLast);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  useEffect(() => { setPaginaActual(1); }, [filtroCliente, ordenFac, fechaDesdeOps, fechaHastaOps, textoBuscarFactura]);

  // ──────────────────────────────────────────────────────────────────
  // Columnas configurables — valor por columna + export
  // ──────────────────────────────────────────────────────────────────
  const nombreClienteFactura_ = (f: any): string => {
    if (f.clienteNombre) return f.clienteNombre;
    if (f.cliente) return f.cliente;
    if (f.clienteId) {
      const nom = getNombreCliente(f.clienteId);
      if (nom && nom !== f.clienteId) return nom;
    }
    return '-';
  };

  const valorCeldaFactura = (f: any, colId: string): any => {
    switch (colId) {
      case 'invoice': return f.invoice || '';
      case 'fecha': return formatearFechaSpanish(f.fecha);
      case 'cliente': return nombreClienteFactura_(f);
      case 'moneda': return f.monedaFacturacion || 'N/A';
      case 'facturaCcp': return f.facturaCcp || '-';
      case 'cantOps': return f.operacionesIds?.length || 0;
      case 'referencias':
        return Array.isArray(f.operacionesGuardadas)
          ? f.operacionesGuardadas.map((op: any) => op?.ref || '').filter(Boolean).join(', ')
          : '-';
      case 'total': return Number(f.subtotalFactura) || 0;
      case 'createdAt': return f.createdAt ? formatearFechaHora(f.createdAt) : '-';
      default: return '-';
    }
  };

  const renderCeldaFactura = (f: any, colId: string) => {
    switch (colId) {
      case 'invoice': return <span style={{ color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace' }}>{f.invoice}</span>;
      case 'fecha': return <span style={{ color: '#c9d1d9' }}>{formatearFechaSpanish(f.fecha)}</span>;
      case 'cliente': return <span style={{ color: '#f0f6fc' }}>{nombreClienteFactura_(f)}</span>;
      case 'moneda': return <span style={{ color: '#10b981', fontWeight: 'bold' }}>{f.monedaFacturacion || 'N/A'}</span>;
      case 'facturaCcp': return <span style={{ color: '#c9d1d9' }}>{f.facturaCcp || '-'}</span>;
      case 'cantOps': return <span style={{ color: '#8b949e' }}>{f.operacionesIds?.length || 0}</span>;
      case 'referencias': {
        const ops: any[] = Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : [];
        if (ops.length === 0) return <span style={{ color: '#8b949e' }}>-</span>;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxWidth: '420px', whiteSpace: 'normal' }}>
            {ops.map((op: any, idx: number) => (
              <button
                key={`${f.id}_ref_${op?.id || idx}`}
                onClick={(e) => { e.stopPropagation(); if (op?.id) verDetalleOperacion(op.id); }}
                title="Ver detalle de la operación"
                style={{
                  backgroundColor: '#21262d',
                  border: '1px solid #58a6ff',
                  color: '#58a6ff',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                }}>
                {op?.ref || '-'}
              </button>
            ))}
          </div>
        );
      }
      case 'total': return <span style={{ color: '#58a6ff', fontWeight: 'bold' }}>{formatoMoneda(f.subtotalFactura)}</span>;
      case 'createdAt': return <span style={{ color: '#8b949e' }}>{f.createdAt ? formatearFechaHora(f.createdAt) : '-'}</span>;
      default: return '-';
    }
  };

  const exportarCSV = () => {
    if (historialOrdenado.length === 0) return alert('No hay datos para exportar.');
    const columnasVisibles = columnasFactura.filter(c => c.visible);
    if (columnasVisibles.length === 0) return alert('Selecciona al menos una columna para exportar.');

    const datosExcel = historialOrdenado.map(f => {
      const fila: any = {};
      columnasVisibles.forEach(col => { fila[col.label] = valorCeldaFactura(f, col.id); });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturas_Clientes');
    XLSX.writeFile(workbook, `Facturas_Clientes_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDragStart = (_e: React.DragEvent, index: number) => setDraggedColIndex(index);
  const handleDragEnter = (index: number) => {
    if (draggedColIndex === null || draggedColIndex === index) return;
    const nuevas = [...columnasFactura];
    const movida = nuevas.splice(draggedColIndex, 1)[0];
    nuevas.splice(index, 0, movida);
    setDraggedColIndex(index);
    setColumnasFactura(nuevas);
  };
  const toggleColumnaVisible = (index: number) => {
    const nuevas = [...columnasFactura];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasFactura(nuevas);
  };

  // ──────────────────────────────────────────────────────────────────
  // Detalle de operación
  // ──────────────────────────────────────────────────────────────────
  const verDetalleOperacion = async (opId: string) => {
    if (!opId) return;
    setCargandoDetalle(true);
    setPestañaDetalleActiva('general');
    try {
      const snap = await getDoc(doc(db, 'operaciones', String(opId)));
      if (snap.exists()) {
        setOperacionDetalle({ id: snap.id, ...(snap.data() as any) });
      } else {
        alert('No se encontró la operación (puede haber sido eliminada).');
      }
    } catch (e) {
      console.error('Error cargando detalle de operación:', e);
      alert('No se pudo cargar el detalle de la operación.');
    }
    setCargandoDetalle(false);
  };

  const det = operacionDetalle;
  const evalTipoOpText = String(det?.tipoOperacionNombre || det?.tipoOperacionId || '').toLowerCase();
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsRoelca = String(det?.proveedorUnidadNombre || det?.proveedorUnidad || '').toLowerCase().includes('roelca');
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  const tabsDetalle = [
    { id: 'general', label: 'Información General' },
    { id: 'pedimento', label: 'Pedimento y CT' },
    { id: 'manifiestos', label: "Entry's y Manifiestos" },
    { id: 'unidad', label: 'Unidad y Operador' },
    { id: 'cobrar', label: 'Por Cobrar' },
  ];

  // ──────────────────────────────────────────────────────────────────
  // Estilos auxiliares
  // ──────────────────────────────────────────────────────────────────
  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any,
  });

  const thOrdenStyle: React.CSSProperties = { padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const selectOrdenStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 10px', fontSize: '0.85rem' };
  const btnDirStyle: React.CSSProperties = { backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' };
  const dateInputStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '9px 10px', fontSize: '0.9rem', colorScheme: 'dark' };

  // Buscador de cliente reutilizable (opcional) para la barra de filtro
  const BuscadorCliente = () => (
    <div style={{ flex: 1, minWidth: '280px', position: 'relative' }}>
      <label style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>CLIENTE (opcional)</label>
      {filtroCliente ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', minHeight: '20px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span style={{ color: '#10b981', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreClienteSeleccionado}</span>
          <button onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); setSeleccionadas([]); }} title="Quitar cliente" style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" placeholder="Buscar cliente por nombre o RFC (opcional)..." value={textoBuscarCliente}
            onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
            onFocus={() => setMostrarSugerenciasCliente(true)} onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
            style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
        </div>
      )}
      {!filtroCliente && mostrarSugerenciasCliente && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', maxHeight: '320px', overflowY: 'auto', zIndex: 100, marginTop: '4px', boxShadow: '0 6px 16px rgba(0,0,0,0.5)' }}>
          {clientesFiltradosBuscador.length === 0 ? (
            <div style={{ padding: '14px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>{textoBuscarCliente.trim() ? 'Sin coincidencias' : 'No hay clientes (tipo Cliente-Paga) cargados'}</div>
          ) : (
            <>
              <div style={{ padding: '6px 12px', fontSize: '0.7rem', color: '#8b949e', borderBottom: '1px solid #21262d', backgroundColor: '#161b22' }}>{clientesFiltradosBuscador.length} {clientesFiltradosBuscador.length === 1 ? 'cliente' : 'clientes'}{textoBuscarCliente.trim() ? '' : ' (primeros 30)'}</div>
              {clientesFiltradosBuscador.map((cli: any) => (
                <div key={cli.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFiltroCliente(cli.id); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); setSeleccionadas([]); }}
                  style={{ padding: '10px 12px', cursor: 'pointer', color: '#c9d1d9', fontSize: '0.88rem', borderBottom: '1px solid #21262d', transition: 'background-color 0.15s' }}
                  onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div style={{ fontWeight: '500' }}>{cli.nombre || cli.id}</div>
                  {cli.rfc && <div style={{ color: '#8b949e', fontSize: '0.75rem', marginTop: '2px' }}>{cli.rfc}</div>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Facturación de Clientes</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Facturas</button>
      </div>

      {/* ════════ FILTROS POR PESTAÑA ════════ */}
      {activeTab === 'operaciones' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA DESDE ★</label>
            <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={dateInputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA HASTA ★</label>
            <input type="date" value={fechaHastaOps} onChange={(e) => setFechaHastaOps(e.target.value)} style={dateInputStyle} />
          </div>
          {(fechaDesdeOps || fechaHastaOps) && (
            <button onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
          )}
          <BuscadorCliente />
        </div>
      ) : (
        /* Historial: buscador + cliente + (fechas opcionales) */
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
          <div style={{ flex: 2, minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold' }}>BUSCAR EN HISTORIAL</label>
            <div style={{ position: 'relative' }}>
              <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#58a6ff' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input
                type="text"
                placeholder="Buscar por invoice, cliente, CCP o referencia..."
                value={textoBuscarFactura}
                onChange={(e) => setTextoBuscarFactura(e.target.value)}
                style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }}
              />
              {textoBuscarFactura && (
                <button onClick={() => setTextoBuscarFactura('')} title="Limpiar búsqueda" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '0.95rem' }}>✕</button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA DESDE (opcional)</label>
            <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={dateInputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA HASTA (opcional)</label>
            <input type="date" value={fechaHastaOps} onChange={(e) => setFechaHastaOps(e.target.value)} style={dateInputStyle} />
          </div>
          {(fechaDesdeOps || fechaHastaOps) && (
            <button onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
          )}
          <BuscadorCliente />
        </div>
      )}

      {/* Aviso solo para "Asignar Operaciones": ambas fechas obligatorias */}
      {activeTab === 'operaciones' && !ambasFechas ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: '#8b949e', backgroundColor: '#0d1117', border: '1px dashed #30363d', borderRadius: '8px' }}>
          <div style={{ fontSize: '1.05rem', color: '#c9d1d9', marginBottom: '6px' }}>Selecciona <b style={{ color: '#D84315' }}>Fecha Desde</b> y <b style={{ color: '#D84315' }}>Fecha Hasta</b></div>
          <div style={{ fontSize: '0.9rem' }}>
            Las operaciones por facturar aparecerán al definir ambas fechas. El cliente es opcional.
          </div>
        </div>
      ) : activeTab === 'operaciones' ? (
        /* ════════════════════ ASIGNAR OPERACIONES ════════════════════ */
        <div className="animation-fade-in">
          {/* Controles: orden + conteo + columnas + exportar + generar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
              <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
                {columnasOps.filter(c => c.visible && c.orden).map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
              </button>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>
                {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'operación por facturar' : 'operaciones por facturar'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">⚙ Configurar Columnas</button>
              <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                  cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                  backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                  color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                ⬇ Exportar Excel
              </button>
              <button disabled={seleccionadas.length === 0 || seleccionMultiCliente} onClick={() => setModalAbierto(true)}
                style={{ padding: '8px 20px', backgroundColor: (seleccionadas.length > 0 && !seleccionMultiCliente) ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && !seleccionMultiCliente) ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Generar Factura ({seleccionadas.length})
              </button>
            </div>
          </div>

          {/* Aviso multi-cliente */}
          {seleccionMultiCliente && (
            <div style={{ backgroundColor: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.4)', color: '#ff7b72', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.85rem' }}>
              Seleccionaste operaciones de <b>distintos clientes</b>. Una factura debe ser de un solo cliente: usa el filtro de cliente o selecciona operaciones del mismo cliente.
            </div>
          )}

          {/* Resumen de selección */}
          {seleccionadas.length > 0 && !seleccionMultiCliente && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Seleccionadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Conversión Estimada</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Cliente</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{nombreClienteFactura || '—'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Moneda</span>
                  <span style={{ color: '#D84315', fontSize: '1.8rem', fontWeight: 'bold' }}>{monedaFacturacion}</span>
                </div>
              </div>
            </div>
          )}

          {/* Tabla de operaciones */}
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '50px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}></th>
                  {columnasOps.filter(c => c.visible).map(col => (
                    <th key={col.id}
                      style={col.orden ? thOrdenStyle : { padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}
                      onClick={col.orden ? () => toggleOrdenOps(col.id) : undefined}>
                      {col.label.toUpperCase()}{col.orden ? flechaOps(col.id) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cargandoOperaciones ? (
                  <tr><td colSpan={columnasOps.filter(c => c.visible).length + 1} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando operaciones completadas del rango...</td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td colSpan={columnasOps.filter(c => c.visible).length + 1} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>No hay operaciones por facturar en este rango de fechas{filtroCliente ? ' para el cliente seleccionado' : ''}.</td></tr>
                ) : (
                  operacionesMostradas.map(op => {
                    const m = obtenerMontoOperacion(op);
                    return (
                      <tr key={op.id} onClick={() => toggleSeleccion(op.id)}
                        style={{ cursor: 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                        <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                        </td>
                        {columnasOps.filter(c => c.visible).map(col => renderCeldaOps(op, col.id, m))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      ) : (
        /* ════════════════════ HISTORIAL DE FACTURAS ════════════════════ */
        <div className="animation-fade-in">

          {/* ✅ Tarjetas de resumen del Historial (similar al historial de Diésel) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px' }}>
              <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '6px' }}>Facturas Listadas</span>
              <span style={{ color: '#58a6ff', fontSize: '2rem', fontWeight: 'bold' }}>{resumenHistorial.cuenta}</span>
            </div>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px' }}>
              <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '6px' }}>Ops. Facturadas</span>
              <span style={{ color: '#3fb950', fontSize: '2rem', fontWeight: 'bold' }}>{resumenHistorial.totalOps}</span>
            </div>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px' }}>
              <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '6px' }}>Total Facturado (USD)</span>
              <span style={{ color: '#10b981', fontSize: '1.5rem', fontWeight: 'bold' }}>{formatoMoneda(resumenHistorial.totalUSD)}</span>
            </div>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px' }}>
              <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '6px' }}>Total Facturado (MXN)</span>
              <span style={{ color: '#3b82f6', fontSize: '1.5rem', fontWeight: 'bold' }}>{formatoMoneda(resumenHistorial.totalMXN)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
              <select value={ordenFac.campo} onChange={(e) => setOrdenFac(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
                <option value="invoice">Invoice</option>
                <option value="fecha">Fecha</option>
                <option value="cliente">Cliente</option>
                <option value="moneda">Moneda</option>
                <option value="cantOps">Cant. Ops</option>
                <option value="total">Total</option>
              </select>
              <button onClick={() => setOrdenFac(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                {ordenFac.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
              </button>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>{historialOrdenado.length} {historialOrdenado.length === 1 ? 'factura' : 'facturas'}</span>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button title="Configurar columnas" onClick={() => setModalColumnas(true)} style={btnDirStyle}>⚙ Configurar Columnas</button>
              <button title="Exportar a Excel" onClick={exportarCSV} style={{ ...btnDirStyle, backgroundColor: '#1a7f37', color: '#fff', border: 'none' }}>⬇ Exportar Excel</button>
            </div>
          </div>

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>ACCIONES</th>
                  {columnasFactura.filter(c => c.visible).map(col => (
                    <th key={`th_${col.id}`} style={thOrdenStyle} onClick={() => toggleOrdenFac(col.id)}>
                      {col.label.toUpperCase()}{flechaFac(col.id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cargandoFacturas ? (
                  <tr><td colSpan={columnasFactura.filter(c => c.visible).length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Cargando facturas...</td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td colSpan={columnasFactura.filter(c => c.visible).length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                    {facturasGlobales.length === 0
                      ? 'Aún no hay facturas registradas.'
                      : `No se encontraron facturas con los filtros actuales${textoBuscarFactura ? ` (búsqueda: "${textoBuscarFactura}")` : ''}${filtroCliente ? ' para el cliente seleccionado' : ''}.`}
                  </td></tr>
                ) : (
                  registrosVisibles.map(f => (
                    <tr key={f.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button title="Ver Ficha" onClick={() => setFacturaViendo(f)} style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button title="Eliminar Factura" onClick={(e) => handleEliminarFactura(e, f)} style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      {columnasFactura.filter(c => c.visible).map(col => (
                        <td key={`cell_${f.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>{renderCeldaFactura(f, col.id)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '20px' }}>
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span style={{ color: '#fff', alignSelf: 'center' }}>{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════ MODAL CONFIGURAR COLUMNAS (Historial) ════════════════════ */}
      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '720px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '20px' }}>Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel. <b style={{ color: '#58a6ff' }}>Esta configuración se guarda y se aplica para todos los usuarios.</b></p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {columnasFactura.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStart(e, idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={() => setDraggedColIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={guardarConfigColumnasHistorial} disabled={guardandoCols} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: guardandoCols ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoCols ? 0.7 : 1 }}>{guardandoCols ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ MODAL CONFIGURAR COLUMNAS (Asignar Operaciones) ═══════════ */}
      {modalColumnasOps && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '860px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
                <span style={{ color: '#8b949e', fontSize: '0.78rem' }}>
                  {columnasOps.filter(c => c.visible).length} visibles de {columnasOps.length} disponibles
                </span>
              </div>
              <button onClick={() => { setModalColumnasOps(false); setBusquedaColOps(''); }} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            {/* Buscador y atajos */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
                <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#58a6ff' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="text" placeholder="Buscar columna por nombre o grupo..." value={busquedaColOps} onChange={(e) => setBusquedaColOps(e.target.value)}
                  style={{ width: '100%', padding: '8px 8px 8px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.88rem', boxSizing: 'border-box' }} />
              </div>
              <button onClick={() => setColumnasOps(cs => cs.map(c => ({ ...c, visible: false })))} style={{ ...btnDirStyle, color: '#8b949e' }} title="Ocultar todas">Ocultar todas</button>
              <button onClick={() => setColumnasOps(cs => cs.map(c => ({ ...c, visible: true })))} style={{ ...btnDirStyle, color: '#10b981' }} title="Mostrar todas">Mostrar todas</button>
              <button onClick={() => setColumnasOps(COLUMNAS_OPS_BASE.map(c => ({ ...c })))} style={{ ...btnDirStyle, color: '#D84315' }} title="Restablecer al estado por defecto">Restablecer</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.8rem', marginBottom: '14px' }}>
              Arrastra para reordenar. Marca las que quieras ver en la tabla y en el Excel. El grupo entre paréntesis indica de qué pestaña del detalle viene el campo. <b style={{ color: '#58a6ff' }}>Esta configuración se guarda y se aplica para todos los usuarios.</b>
            </p>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {columnasOps
                .map((col, idx) => ({ col, idx }))
                .filter(({ col }) => {
                  if (!busquedaColOps.trim()) return true;
                  const q = busquedaColOps.trim().toLowerCase();
                  return String(col.label || '').toLowerCase().includes(q) || String(col.grupo || '').toLowerCase().includes(q) || String(col.id || '').toLowerCase().includes(q);
                })
                .map(({ col, idx }) => (
                  <li key={col.id} draggable={!busquedaColOps} onDragStart={(e) => handleDragStartOps(e, idx)} onDragEnter={() => handleDragEnterOps(idx)} onDragEnd={() => setDraggedColOpsIndex(null)} onDragOver={(e) => e.preventDefault()}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: draggedColOpsIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: busquedaColOps ? 'default' : 'grab' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                      <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                      {col.grupo && (
                        <span style={{ color: '#6e7681', fontSize: '0.7rem' }}>({col.grupo})</span>
                      )}
                    </div>
                  </li>
                ))}
            </ul>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={guardarConfigColumnasOps} disabled={guardandoCols} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: guardandoCols ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoCols ? 0.7 : 1 }}>{guardandoCols ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ MODAL GENERAR FACTURA ════════════════════ */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '16px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Generar Factura</h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d', marginBottom: '24px' }}>
              <div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Cliente</span>
                <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{nombreClienteFactura || getNombreCliente(clienteFacturaId)}</span>
              </div>
              <div style={{ textAlign: 'center', borderLeft: '1px solid #30363d', borderRight: '1px solid #30363d', padding: '0 20px' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Moneda Cliente</span>
                <span style={{ color: '#10b981', fontSize: '1.1rem', fontWeight: 'bold' }}>{monedaFacturacion}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Conversión ({seleccionadas.length} Ops)</span>
                <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
              </div>
            </div>
            <form onSubmit={handleGuardarFactura}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>NÚMERO DE INVOICE</label>
                  <input type="text" required placeholder="Ej. INV-2026-001" value={invoiceForm} onChange={e => setInvoiceForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#D84315', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold', fontSize: '1.1rem' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA DE FACTURACIÓN</label>
                  <input type="date" required value={fechaForm} onChange={e => setFechaForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FACTURA CCP (Opcional)</label>
                  <input type="text" placeholder="Referencia CCP..." value={facturaCcpForm} onChange={e => setFacturaCcpForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '20px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : 'Confirmar Factura'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════ MODAL FICHA DE FACTURA ════════════════════ */}
      {facturaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Ficha de Factura</h2>
              <button onClick={() => setFacturaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', alignItems: 'center' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Invoice</span>
                    <span style={{ color: '#D84315', fontSize: '1.4rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{facturaViendo.invoice}</span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Moneda</span>
                    <span style={{ color: '#10b981', fontSize: '1.1rem', fontWeight: 'bold' }}>{facturaViendo.monedaFacturacion || 'N/A'}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Fecha de Facturación</span>
                    <span style={{ color: '#c9d1d9', fontSize: '1.1rem', fontWeight: 'bold' }}>{formatearFechaSpanish(facturaViendo.fecha)}</span>
                  </div>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Cliente Facturado</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{facturaViendo.clienteNombre || getNombreCliente(facturaViendo.clienteId) || '-'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Factura CCP</span>
                  <span style={{ color: '#c9d1d9', fontSize: '1rem' }}>{facturaViendo.facturaCcp || '-'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Total Facturado</span>
                  <span style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>{formatoMoneda(facturaViendo.subtotalFactura)}</span>
                </div>

                <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                <div style={{ gridColumn: 'span 3', marginTop: '8px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Referencias / Operaciones Facturadas ({facturaViendo.operacionesGuardadas?.length || 0}) — haz clic para ver el detalle
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {facturaViendo.operacionesGuardadas?.map((op: any) => (
                      <button key={op.id} onClick={() => verDetalleOperacion(op.id)} title="Ver detalle de la operación"
                        style={{ backgroundColor: '#21262d', border: '1px solid #58a6ff', padding: '8px 14px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                        onMouseEnter={(e: any) => { e.currentTarget.style.backgroundColor = '#1f2d44'; e.currentTarget.style.borderColor = '#79b8ff'; }}
                        onMouseLeave={(e: any) => { e.currentTarget.style.backgroundColor = '#21262d'; e.currentTarget.style.borderColor = '#58a6ff'; }}>
                        <span style={{ color: '#58a6ff', fontSize: '0.9rem', fontFamily: 'monospace', fontWeight: 'bold' }}>{op.ref}</span>
                        <span style={{ color: '#3fb950', fontSize: '0.85rem' }}>{formatoMoneda(op.monto)}</span>
                      </button>
                    )) || <span style={{ color: '#8b949e' }}>Sin detalle de operaciones.</span>}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
              <button onClick={() => setFacturaViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ MODAL DETALLE DE OPERACIÓN ════════════════════ */}
      {(operacionDetalle || cargandoDetalle) && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1800, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div className="form-card detail-card" style={{ width: '1100px', maxWidth: '100%', maxHeight: '94vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            {cargandoDetalle || !operacionDetalle ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#8b949e' }}>Cargando detalle de la operación...</div>
            ) : (
              <>
                <div className="form-header" style={{ padding: '16px 32px 0 32px', borderBottom: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.5px' }}>Detalle de Operación</h2>
                      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ color: '#D84315', fontWeight: 'bold', fontSize: '1.1rem', letterSpacing: '0.5px' }}>{det.ref || det.id?.substring(0, 6)}</span>
                        <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 'bold' }}>{txt(det.statusNombre, det.status)}</span>
                      </div>
                    </div>
                    <button onClick={() => setOperacionDetalle(null)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }} onMouseEnter={(e) => e.currentTarget.style.color = '#f0f6fc'} onMouseLeave={(e) => e.currentTarget.style.color = '#8b949e'}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '12px 32px 0 32px', overflowX: 'auto', flexShrink: 0 }}>
                  {tabsDetalle.map(tab => (
                    <button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)}
                      style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontWeight: pestañaDetalleActiva === tab.id ? 600 : 'normal', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="detail-content" style={{ padding: '18px 32px', overflowY: 'auto', flex: 1 }}>
                  {pestañaDetalleActiva === 'general' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Tipo de Operación</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.tipoOperacionNombre, det.tipoOperacionId)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Servicio / Status</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.fechaServicio)} <span style={{ color: '#30363d', margin: '0 8px' }}>|</span> <span style={{ color: '#10b981', fontWeight: 'bold' }}>{txt(det.statusNombre, det.status)}</span></span></div>
                      {evalIsFletes ? (
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Cita</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatearFechaHora(det.fechaCita)}</span></div>
                      ) : (<div></div>)}
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Paga)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.clienteNombre, det.nombreCliente, det.clientePaga)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio (Tarifa)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.convenioNombre, det.convenio)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Remolque</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.remolqueNombre, det.remolquePlaca, det.numeroRemolque)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Ref Cliente</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.refCliente)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Origen</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.origenNombre, det.origen)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Destino</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.destinoNombre, det.destino)}</span></div>
                      <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Observaciones Ejecutivo</span><div style={{ color: '#c9d1d9', fontWeight: 500, backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>{mostrarDato(det.observacionesEjecutivo)}</div></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'pedimento' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Mercancía)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.clienteMercanciaNombre, det.clienteMercancia)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Descripción de la Mercancía</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.descripcionMercancia)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cantidad (Enteros)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.cantidad)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Embalaje</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.embalajeNombre, det.embalaje)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Peso (Kg)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.pesoKg)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># DODA</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.numDoda)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Emisión (DODA)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.fechaEmisionDoda)}</span></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'manifiestos' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Entry's</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.numeroEntrys)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cantidad de Entry's</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.cantEntrys)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># Manifiesto</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.numManifiesto)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Proveedor de Servicios</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.provServiciosNombre, det.provServicios)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Costo Manifiesto ($)</span><span style={{ color: '#c9d1d9', fontWeight: 'bold', fontSize: '1.05rem' }}>{formatoMoneda(det.montoManifiesto)}</span></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'unidad' && (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                        <div style={{ gridColumn: 'span 3' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Proveedor de Transporte</span><span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem' }}>{txt(det.proveedorUnidadNombre, det.proveedorUnidad)}</span></div>
                      </div>
                      <div style={{ backgroundColor: '#161b22', padding: '20px', borderRadius: '12px', border: '1px solid #30363d', marginBottom: '24px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '16px' }}>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Facturado En:</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.monedaUnidadNombre || mostrarMoneda(det.facturadoEnUnidad)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio Proveedor</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.convenioProveedorNombre, det.convenioProveedor)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Moneda del Convenio (Base)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarMoneda(det.monedaConvenioProv)}</span></div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d', marginBottom: '16px' }}>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Monto a Pagar (Base)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatoMoneda(det.totalAPagarProv)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Costos Adicionales</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatoMoneda(det.cargosAdicionalesProv)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Subtotal (Convenio + Costos)</span><span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.subtotalProv)}</span></div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Dólares</span><span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.dolaresProv)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Pesos</span><span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.pesosProv)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#f85149', fontWeight: 'bold', marginBottom: '4px' }}>Conversión Final (Gasto)</span><span style={{ color: '#f85149', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.conversionProv)}</span></div>
                        </div>
                      </div>

                      {showDetailInternalFleet && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                          <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#f0f6fc', margin: '0 0 8px 0' }}>Flota Operativa (Roelca)</h4></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Unidad Asignada</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.unidadNombre, det.unidad)}</span></div>
                          <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Operador Asignado</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{txt(det.operadorNombre, det.operador)}</span></div>
                          <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo del Operador</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatoMoneda(det.sueldoOperador)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo Extra</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatoMoneda(det.sueldoExtra)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo Total</span><span style={{ color: '#f0f6fc', fontWeight: 'bold', backgroundColor: '#161b22', padding: '6px 10px', borderRadius: '4px', border: '1px solid #30363d', display: 'inline-block' }}>{formatoMoneda(det.sueldoTotal)}</span></div>
                          <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Combustible</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatoMoneda(det.combustible)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Combustible Extra</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatoMoneda(det.combustibleExtra)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Total Combustible</span><span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.combustibleTotal)}</span></div>
                        </div>
                      )}

                      {showDetailExternalFleet && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                          <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#58a6ff', margin: '0 0 8px 0' }}>Flota Externa (Proveedor)</h4></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Unidad Externa</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.unidadProveedor)}</span></div>
                          <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Operador Externo</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.operadorProveedor)}</span></div>
                        </div>
                      )}

                      <div style={{ marginTop: '20px' }}>
                        <div style={{ backgroundColor: '#0d1117', border: '1px solid #f85149', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                          <div style={{ color: '#8b949e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Total Gastos [Sueldos + Manifiesto]</div>
                          <div style={{ color: '#f85149', fontSize: '2rem', fontWeight: 'bold' }}>{formatoMoneda(det.totalGastos)}</div>
                        </div>
                      </div>

                      <div style={{ marginTop: '24px' }}>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '8px' }}>Observaciones (Unidad / Proveedor)</span>
                        <div style={{ color: '#c9d1d9', fontWeight: 500, backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>{mostrarDato(det.observacionesUnidad)}</div>
                      </div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'cobrar' && (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Facturado En:</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.monedaCobroNombre || mostrarMoneda(det.facturadoEnCobrar)}</span></div>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Moneda Convenio (Cliente)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarMoneda(det.monedaConvenioCliente)}</span></div>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio Seleccionado (Base)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatoMoneda(det.montoConvenioCliente)}</span></div>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cargos Adicionales</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatoMoneda(det.cargosAdicionales)}</span></div>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Subtotal (Convenio + Cargos)</span><span style={{ color: '#c9d1d9', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.subtotalCliente)}</span></div>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Tipo de Cambio del Día</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.tipoCambioAprobado)}</span></div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingBottom: '24px', borderBottom: '1px solid #30363d' }}>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Dólares (Cliente)</span><span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.dolaresCliente)}</span></div>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Pesos (Cliente)</span><span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.pesosCliente)}</span></div>
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Conversión Final (Ingreso)</span><span style={{ color: '#D84315', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(det.conversionCliente)}</span></div>
                      </div>
                      <div style={{ marginTop: '24px', padding: '24px', backgroundColor: '#0d1117', border: '1px solid #10b981', borderRadius: '12px', textAlign: 'center' }}>
                        <span style={{ display: 'block', fontSize: '0.9rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Utilidad Estimada de la Operación (Ingreso - Gasto)</span>
                        <span style={{ fontSize: '2.5rem', color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(det.utilidadEstimada)}</span>
                      </div>
                      <div style={{ marginTop: '24px' }}>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '8px' }}>Observaciones (Facturación / Cobro)</span>
                        <div style={{ color: '#c9d1d9', fontWeight: 500, backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>{mostrarDato(det.observacionesCobrar)}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-actions" style={{ padding: '12px 32px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', flexShrink: 0 }}>
                  <button onClick={() => setOperacionDetalle(null)} className="btn btn-outline" style={{ padding: '10px 32px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar Detalle</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
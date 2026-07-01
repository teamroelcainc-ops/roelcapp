// src/features/facturacion/components/FacturacionProveedoresDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// PARIDAD TOTAL CON FacturacionClientesDashboard (lado "POR PAGAR")
// ═══════════════════════════════════════════════════════════════════════
// Este módulo replica EXACTAMENTE el comportamiento del de Clientes, pero
// trabajando el lado del PROVEEDOR de transporte:
//   subtotal   = totalAPagarProv + cargosAdicionalesProv
//   moneda     = facturadoEnUnidad / monedaUnidadNombre
//   conversión = conversionProv (o recálculo USD/MXN)
//   Facturas en `facturas_proveedores`; la operación facturada se marca con
//   facturaProveedorId / facturaProveedorFolio / facturadoProveedor.
//
// ⚠️ CONFIG: ajusta ID_TIPO_PROVEEDOR con el ID del tipo "Proveedor" de tu
//    catálogo de empresas. Vacío ('') = el buscador muestra TODAS las empresas.
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
  documentId,
  startAfter,
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

// ──────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────
const ID_TIPO_PROVEEDOR = '';                 // ID del tipo "Proveedor" en tiposEmpresa. Vacío = muestra todas las empresas.
const CAMPO_PROVEEDOR_OP = 'proveedorUnidad'; // campo de la operación que referencia al proveedor
const STATUS_COMPLETADOS = ['f557b751', 'c2d57403'];
const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

const LIMITE_OPS_TODAS = 20000;
const PAG_OPS = 1000;
const SS_OPS = 'roelca_ops_prov_completadas_v2';
const SS_OPS_TTL = 30 * 60 * 1000;

const CONFIG_COLUMNAS_COLLECTION = 'config_columnas';
const DOC_COLUMNAS_OPS = 'facturacion_proveedores_ops';
const DOC_COLUMNAS_HISTORIAL = 'facturacion_proveedores_historial';

const LS_COLS_OPS = 'cfgcols_facturacion_prov_ops_v1';
const LS_COLS_HIST = 'cfgcols_facturacion_prov_hist_v1';

const leerCacheLocal = (alias: string): any[] | null => {
  try {
    const raw = localStorage.getItem(`cat_v1__${alias}`) || localStorage.getItem(`cat_v2__${alias}`);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && Array.isArray(obj.data) ? obj.data : null;
  } catch { return null; }
};

const construirMapaCatalogos = (): Record<string, string> => {
  const mapa: Record<string, string> = {};
  const tomarNombre = (item: any): string | null => {
    if (!item || item.id === undefined || item.id === null) return null;
    const fn = item.firstName ?? item.first_name;
    const lp = item.lastNamePaternal ?? item.last_name_paternal ?? item.apellidoPaterno;
    if (fn || lp) {
      const full = `${fn || ''} ${lp || ''}`.trim();
      if (full) return full;
    }
    if (item.unidad && typeof item.unidad === 'string' && item.unidad.trim() !== '') return String(item.unidad).trim();
    const placa = item.placas ?? item.placa;
    if (item.nombre && placa) return `${item.nombre} ${placa}`.trim();
    const n = item.nombre ?? item.nombreCorto ?? item.label ?? item.descripcion ?? item.name ?? item.titulo ?? item.moneda ?? item.tipo_operacion;
    return (n !== undefined && n !== null && String(n) !== '') ? String(n) : null;
  };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || (key.indexOf('cat_v1__') !== 0 && key.indexOf('cat_v2__') !== 0)) continue;
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
  base.forEach((c: any) => { if (!usados.has(c.id)) resultado.push({ ...c }); });
  return resultado;
};

const moverIdAlInicio = (cols: any[], id: string): any[] => {
  const idx = cols.findIndex((c: any) => c.id === id);
  if (idx <= 0) return cols;
  const copia = [...cols];
  const [el] = copia.splice(idx, 1);
  copia.unshift(el);
  return copia;
};
const moverStatusAlInicio = (cols: any[]): any[] => moverIdAlInicio(cols, 'statusFactura');

const STATUS_FACTURA_OPCIONES = ['Facturado', 'Cancelado', 'No Facturado'];
const colorStatusFactura = (s: any): string => {
  const t = String(s || '').toLowerCase();
  if (t.includes('cancel')) return '#f85149';
  if (t.includes('no')) return '#f59e0b';
  if (t.includes('factur')) return '#10b981';
  return '#8b949e';
};

const COLUMNAS_FACTURA_BASE = [
  { id: 'statusFactura', label: 'Status',        visible: true },
  { id: 'invoice',      label: 'Factura Prov.', visible: true },
  { id: 'fecha',        label: 'Fecha',         visible: true },
  { id: 'proveedor',    label: 'Proveedor',     visible: true },
  { id: 'moneda',       label: 'Moneda',        visible: true },
  { id: 'facturaCcp',   label: 'Referencia',    visible: true },
  { id: 'cantOps',      label: 'Cant. Ops',     visible: true },
  { id: 'referencias',  label: 'Referencias',   visible: true },
  { id: 'total',        label: 'Total',         visible: true },
  { id: 'createdAt',    label: 'Registrada',    visible: false },
];

const LIMITE_FACTURAS_TODAS = 12000;
const PAG_FACTURAS = 1000;
const SS_FACTURAS = 'roelca_facturas_proveedores_v1';
const SS_FACTURAS_TTL = 30 * 60 * 1000;

const parseFechaFactura = (val: any): string => {
  if (!val) return '';
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${y}-${(m || '01').padStart(2, '0')}-${(d || '01').padStart(2, '0')}`;
  }
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  const m2 = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  return s;
};

const normalizarFactura = (raw: any): any => {
  const fechaNorm = parseFechaFactura(raw.fecha || raw.fechaFactura);
  let opsIds: any = raw.operacionesIds;
  if (typeof opsIds === 'string') opsIds = opsIds ? [opsIds] : [];
  if (!Array.isArray(opsIds)) opsIds = [];
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
    subtotalFactura: Number(raw.subtotalFactura) || Number(raw.total) || 0,
    monedaProveedor: raw.monedaProveedor || raw.moneda || 'N/A',
    proveedorNombre: raw.proveedorNombre || raw.proveedor || '',
    facturaCcp: raw.facturaCcp || raw.ccp || '',
    invoice: raw.invoice || raw.numeroInvoice || raw.numInvoice || raw.folio || String(raw.id || ''),
    statusFactura: raw.statusFactura || 'Facturado',
  };
};

const COLUMNAS_OPS_BASE: any[] = [
  { id: 'factura',       label: '# Factura',       visible: true,  orden: true,  grupo: 'General' },
  { id: 'ref',           label: 'Ref. Operación',  visible: true,  orden: true,  grupo: 'General' },
  { id: 'fechaServicio', label: 'Fecha Servicio',  visible: true,  orden: true,  grupo: 'General' },
  { id: 'proveedor',     label: 'Proveedor',       visible: true,  orden: true,  grupo: 'General' },
  { id: 'cartaPorte',    label: 'Carta Porte',     visible: true,  orden: false, grupo: 'General' },
  { id: 'destino',       label: 'Destino',         visible: true,  orden: true,  grupo: 'General' },
  { id: 'moneda',        label: 'Moneda',          visible: true,  orden: false, grupo: 'Por Pagar' },
  { id: 'subtotal',      label: 'Subtotal',        visible: true,  orden: true,  grupo: 'Por Pagar' },
  { id: 'dolares',       label: 'Dólares',         visible: true,  orden: false, grupo: 'Por Pagar' },
  { id: 'pesos',         label: 'Pesos',           visible: true,  orden: false, grupo: 'Por Pagar' },
  { id: 'conv',          label: 'Conversión',      visible: true,  orden: true,  grupo: 'Por Pagar' },
  { id: 'tipoOperacion',  label: 'Tipo de Operación', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['tipoOperacionNombre', 'tipoOperacionId'] },
  { id: 'status',         label: 'Status',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['statusNombre', 'status'] },
  { id: 'fechaCita',      label: 'Fecha Cita',        visible: false, orden: true,  grupo: 'General', tipo: 'fechaHora', sourceField: 'fechaCita' },
  { id: 'convenio',       label: 'Convenio (Tarifa)', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['convenioNombre', 'convenio'] },
  { id: 'remolque',       label: '# Remolque',        visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['remolqueNombre', 'remolquePlaca', 'numeroRemolque'] },
  { id: 'refCliente',     label: 'Ref Cliente',       visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: 'refCliente' },
  { id: 'origen',         label: 'Origen',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['origenNombre', 'origen'] },
  { id: 'cliente',        label: 'Cliente (Paga)',    visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['clienteNombre', 'nombreCliente', 'clientePaga', 'clienteId'] },
  { id: 'observacionesEjecutivo', label: 'Obs. Ejecutivo',    visible: false, orden: false, grupo: 'General', tipo: 'texto',     sourceField: 'observacionesEjecutivo' },
  { id: 'createdAt',      label: 'Fecha de Creación', visible: false, orden: true,  grupo: 'General', tipo: 'fechaHora', sourceField: 'createdAt' },
  { id: 'clienteMercancia',     label: 'Cliente (Mercancía)',  visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: ['clienteMercanciaNombre', 'clienteMercancia'] },
  { id: 'descripcionMercancia', label: 'Descripción Mercancía', visible: false, orden: false, grupo: 'Pedimento', tipo: 'texto',  sourceField: 'descripcionMercancia' },
  { id: 'cantidad',             label: 'Cantidad',              visible: false, orden: true,  grupo: 'Pedimento', tipo: 'numero', sourceField: 'cantidad' },
  { id: 'embalaje',             label: 'Embalaje',              visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: ['embalajeNombre', 'embalaje'] },
  { id: 'pesoKg',               label: 'Peso (Kg)',             visible: false, orden: true,  grupo: 'Pedimento', tipo: 'numero', sourceField: 'pesoKg' },
  { id: 'numDoda',              label: '# DODA',                visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: 'numDoda' },
  { id: 'fechaEmisionDoda',     label: 'Fecha Emisión DODA',    visible: false, orden: true,  grupo: 'Pedimento', tipo: 'fecha',  sourceField: 'fechaEmisionDoda' },
  { id: 'numeroEntrys',    label: "# Entry's",          visible: false, orden: false, grupo: 'Manifiestos', tipo: 'texto',  sourceField: 'numeroEntrys' },
  { id: 'cantEntrys',      label: "Cant. Entry's",      visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'numero', sourceField: 'cantEntrys' },
  { id: 'numManifiesto',   label: '# Manifiesto',       visible: false, orden: false, grupo: 'Manifiestos', tipo: 'texto',  sourceField: 'numManifiesto' },
  { id: 'provServicios',   label: 'Prov. Servicios',    visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'texto',  sourceField: ['provServiciosNombre', 'provServicios'] },
  { id: 'montoManifiesto', label: 'Costo Manifiesto',   visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'monto',  sourceField: 'montoManifiesto' },
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

const calcularConversionProveedor = (op: any) => {
  const fact = op.facturadoEnUnidad;
  const tc = Number(op.tipoCambioAprobado) || 0;
  const subtotal = Number(op.totalAPagarProv || 0) + Number(op.cargosAdicionalesProv || 0);
  let dol = 0, pes = 0, conv = 0;
  const nombreMoneda = String(op.monedaUnidadNombre || '').toUpperCase();
  const esDolar = fact === ID_USD || nombreMoneda.includes('USD');
  const esPeso = fact === ID_MXN || nombreMoneda.includes('MXN');
  if (esDolar) { dol = subtotal; pes = 0; conv = subtotal * tc; }
  else if (esPeso) { dol = 0; pes = subtotal; conv = subtotal; }
  else { conv = subtotal; }
  return { subtotal, dol, pes, conv };
};

const obtenerMontoOperacion = (op: any) => {
  const convGuardada = Number(op.conversionProv);
  if (!isNaN(convGuardada) && convGuardada > 0) {
    return {
      subtotal: Number(op.subtotalProv) || 0,
      dol: Number(op.dolaresProv) || 0,
      pes: Number(op.pesosProv) || 0,
      conv: convGuardada,
    };
  }
  return calcularConversionProveedor(op);
};

export const FacturacionProveedoresDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial'>('operaciones');

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [facturasGlobales, setFacturasGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(false);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);

  const [empresasList, setEmpresasList] = useState<any[]>([]);

  const [fechaDesdeOps, setFechaDesdeOps] = useState('');
  const [fechaHastaOps, setFechaHastaOps] = useState('');
  const [fechaDesdeHist, setFechaDesdeHist] = useState('');
  const [fechaHastaHist, setFechaHastaHist] = useState('');
  const [textoBuscarRemolqueOps, setTextoBuscarRemolqueOps] = useState('');
  const [vistaOps, setVistaOps] = useState<'pendientes' | 'facturadas' | 'todas'>('pendientes');
  const [topeOpsAlcanzado, setTopeOpsAlcanzado] = useState(false);
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [ordenFac, setOrdenFac] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fecha', dir: 'desc' });

  const [textoBuscarProveedor, setTextoBuscarProveedor] = useState('');
  const [mostrarSugerenciasProveedor, setMostrarSugerenciasProveedor] = useState(false);

  const [textoBuscarFactura, setTextoBuscarFactura] = useState('');
  const [filtroStatusFactura, setFiltroStatusFactura] = useState<string>('Todos');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [filtroTipoOp, setFiltroTipoOp] = useState('');

  const [paginaActual, setPaginaActual] = useState(1);
  const [paginaOps, setPaginaOps] = useState(1);
  const registrosPorPagina = 50;

  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [facturaViendo, setFacturaViendo] = useState<any | null>(null);

  const [guardandoCols, setGuardandoCols] = useState(false);

  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasFactura, setColumnasFactura] = useState(COLUMNAS_FACTURA_BASE.map(c => ({ ...c })));
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);
  const [busquedaColOps, setBusquedaColOps] = useState('');
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  const [operacionDetalle, setOperacionDetalle] = useState<any | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');

  const [invoiceForm, setInvoiceForm] = useState('');
  const [fechaForm, setFechaForm] = useState(new Date().toISOString().split('T')[0]);
  const [facturaCcpForm, setFacturaCcpForm] = useState('');
  const [statusFacturaForm, setStatusFacturaForm] = useState<string>('Facturado');

  const [modalCostoAdic, setModalCostoAdic] = useState(false);
  const [costoAdicOpId, setCostoAdicOpId] = useState('');
  const [costoAdicMonto, setCostoAdicMonto] = useState('');
  const [costoAdicConcepto, setCostoAdicConcepto] = useState('');
  const [guardandoCostoAdic, setGuardandoCostoAdic] = useState(false);

  const [opInfoMap, setOpInfoMap] = useState<Record<string, any>>({});
  const [modalDiagnostico, setModalDiagnostico] = useState(false);

  const [facturaEditando, setFacturaEditando] = useState<any | null>(null);
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [editInvoice, setEditInvoice] = useState('');
  const [editFecha, setEditFecha] = useState('');
  const [editCcp, setEditCcp] = useState('');
  const [editStatus, setEditStatus] = useState('Facturado');
  const [editMoneda, setEditMoneda] = useState('');
  const [editTotal, setEditTotal] = useState('');

  const [gestionOp, setGestionOp] = useState<any | null>(null);
  const [gestionInvoice, setGestionInvoice] = useState('');
  const [guardandoGestionOp, setGuardandoGestionOp] = useState(false);
  const [agregarRefFactura, setAgregarRefFactura] = useState<any | null>(null);
  const [busquedaRefPendiente, setBusquedaRefPendiente] = useState('');
  const [agregandoRef, setAgregandoRef] = useState(false);

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const formatearFechaSpanish = (fechaString: any) => {
    if (!fechaString) return '-';
    const fmt = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    if (typeof fechaString === 'object') {
      try {
        if (typeof fechaString.toDate === 'function') { const d = fechaString.toDate(); return isNaN(d.getTime()) ? '-' : fmt(d); }
        if (typeof fechaString.seconds === 'number') { const d = new Date(fechaString.seconds * 1000); return isNaN(d.getTime()) ? '-' : fmt(d); }
      } catch { /* noop */ }
      return '-';
    }
    const s = String(fechaString).trim();
    if (!s) return '-';
    let y = '', mo = '', da = '';
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { y = m[1]; mo = m[2]; da = m[3]; }
    if (!y) { m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (m) { y = m[1]; mo = m[2]; da = m[3]; } }
    if (!y) { m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (m) { da = m[1]; mo = m[2]; y = m[3]; } }
    if (!y) { m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/);
      if (m) { da = m[1]; mo = m[2]; y = '20' + m[3]; } }
    if (y && mo && da) {
      const d = new Date(`${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}T00:00:00`);
      if (!isNaN(d.getTime())) return fmt(d);
    }
    const d2 = new Date(s);
    if (!isNaN(d2.getTime())) return fmt(d2);
    return s;
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
  const chipStatusFactura = (s: any) => {
    const texto = s || 'Facturado';
    const color = colorStatusFactura(texto);
    return (
      <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', color, border: `1px solid ${color}`, backgroundColor: `${color}1a`, whiteSpace: 'nowrap' }}>
        {texto}
      </span>
    );
  };

  const mapaCatalogos = useMemo(() => {
    const m = construirMapaCatalogos();
    empresasList.forEach((e: any) => {
      if (e?.id) m[String(e.id)] = e.nombre || e.nombreCorto || m[String(e.id)] || String(e.id);
    });
    m[ID_USD] = 'USD';
    m[ID_MXN] = 'MXN';
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresasList]);

  const resolverNombre = (val: any): any => {
    if (val === '' || val === null || val === undefined) return val;
    return mapaCatalogos[String(val)] || val;
  };

  const STATUS_FACTURABLES = useMemo(() => {
    const ids = new Set<string>(STATUS_COMPLETADOS);
    Object.entries(mapaCatalogos).forEach(([id, nombre]) => {
      const n = String(nombre || '');
      if (/\bfalso/i.test(n) || /falso\b/i.test(n)) ids.add(id);
    });
    return Array.from(ids);
  }, [mapaCatalogos]);

  const txt = (...cands: any[]): string => {
    for (const c of cands) {
      if (c !== undefined && c !== null && c !== '') {
        const r = resolverNombre(c);
        return (r === undefined || r === null || r === '') ? '-' : String(r);
      }
    }
    return '-';
  };

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

  useEffect(() => {
    const aplicarOps = (guardadas: any) => {
      let cols = aplicarConfigColumnasGuardada(COLUMNAS_OPS_BASE, guardadas);
      if (!cols.some((c: any) => c.id === 'factura')) {
        const base = COLUMNAS_OPS_BASE.find((c: any) => c.id === 'factura');
        if (base) cols = [{ ...base, visible: true }, ...cols];
      }
      cols = cols.map((c: any) => c.id === 'factura' ? { ...c, visible: true } : c);
      cols = moverIdAlInicio(cols, 'factura');
      return cols;
    };
    const aplicarHist = (guardadas: any) => {
      let cols = aplicarConfigColumnasGuardada(COLUMNAS_FACTURA_BASE, guardadas);
      const teniaStatus = Array.isArray(guardadas) && guardadas.some((g: any) => g?.id === 'statusFactura');
      if (!teniaStatus) cols = moverStatusAlInicio(cols);
      return cols;
    };
    try {
      const lsOps = localStorage.getItem(LS_COLS_OPS);
      if (lsOps) setColumnasOps(aplicarOps(JSON.parse(lsOps)));
      const lsHist = localStorage.getItem(LS_COLS_HIST);
      if (lsHist) setColumnasFactura(aplicarHist(JSON.parse(lsHist)));
    } catch { /* noop */ }

    let activo = true;
    (async () => {
      try {
        const [snapOps, snapHist] = await Promise.all([
          getDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_OPS)),
          getDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_HISTORIAL)),
        ]);
        if (!activo) return;
        if (snapOps.exists()) {
          const guardadas = (snapOps.data() as any)?.columnas;
          setColumnasOps(aplicarOps(guardadas));
          try { localStorage.setItem(LS_COLS_OPS, JSON.stringify(guardadas || [])); } catch { /* noop */ }
        }
        if (snapHist.exists()) {
          const guardadas = (snapHist.data() as any)?.columnas;
          setColumnasFactura(aplicarHist(guardadas));
          try { localStorage.setItem(LS_COLS_HIST, JSON.stringify(guardadas || [])); } catch { /* noop */ }
        }
      } catch (e) {
        console.error('Error cargando configuración de columnas (compartida):', e);
      }
    })();
    return () => { activo = false; };
  }, []);

  const guardarConfigColumnasOps = async () => {
    setGuardandoCols(true);
    try {
      const payload = columnasOps.map(c => ({ id: c.id, visible: !!c.visible }));
      try { localStorage.setItem(LS_COLS_OPS, JSON.stringify(payload)); } catch { /* noop */ }
      await setDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_OPS), { columnas: payload, updatedAt: new Date().toISOString() });
      setModalColumnasOps(false);
      setBusquedaColOps('');
    } catch (e) {
      console.error('Error guardando columnas (operaciones):', e);
      alert('No se pudo guardar la configuración de columnas para todos los usuarios.\nRevisa tus permisos de escritura en Firestore (colección config_columnas).');
    } finally {
      setGuardandoCols(false);
    }
  };

  const guardarConfigColumnasHistorial = async () => {
    setGuardandoCols(true);
    try {
      const payload = columnasFactura.map(c => ({ id: c.id, visible: !!c.visible }));
      try { localStorage.setItem(LS_COLS_HIST, JSON.stringify(payload)); } catch { /* noop */ }
      await setDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_HISTORIAL), { columnas: payload, updatedAt: new Date().toISOString() });
      setModalColumnas(false);
    } catch (e) {
      console.error('Error guardando columnas (historial):', e);
      alert('No se pudo guardar la configuración de columnas para todos los usuarios.\nRevisa tus permisos de escritura en Firestore (colección config_columnas).');
    } finally {
      setGuardandoCols(false);
    }
  };

  const guardarCacheFacturas = (docs: any[]) => {
    try { sessionStorage.setItem(SS_FACTURAS, JSON.stringify({ ts: Date.now(), data: docs })); } catch { /* cuota */ }
  };

  useEffect(() => {
    if (facturasGlobales.length > 0) return;
    try {
      const raw = sessionStorage.getItem(SS_FACTURAS);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.data) && obj.data.length && (Date.now() - (obj.ts || 0)) < SS_FACTURAS_TTL) {
          setFacturasGlobales(obj.data.map((f: any) => normalizarFactura(f)));
          return;
        }
      }
    } catch { /* noop */ }

    const descargar = async () => {
      setCargandoFacturas(true);
      try {
        const todas: any[] = [];
        let cursor: any = null;
        for (let i = 0; i < Math.ceil(LIMITE_FACTURAS_TODAS / PAG_FACTURAS); i++) {
          const cons: any[] = [orderBy(documentId()), limit(PAG_FACTURAS)];
          if (cursor) cons.splice(1, 0, startAfter(cursor));
          const snap = await getDocs(query(collection(db, 'facturas_proveedores'), ...cons));
          if (snap.empty) break;
          snap.docs.forEach(d => todas.push(normalizarFactura({ id: d.id, ...(d.data() as any) })));
          cursor = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < PAG_FACTURAS) break;
        }
        todas.sort((a: any, b: any) => {
          const fa = String(a.fecha || '');
          const fb = String(b.fecha || '');
          if (!fa && !fb) return 0;
          if (!fa) return 1;
          if (!fb) return -1;
          return fb.localeCompare(fa);
        });
        setFacturasGlobales(todas);
        guardarCacheFacturas(todas);
      } catch (e: any) {
        const msg = String(e?.message || e?.code || e || '');
        console.error('[Facturación Historial] Error al cargar facturas:', e);
        alert(`No se pudieron cargar las facturas.\n\nDetalle: ${msg}`);
      }
      setCargandoFacturas(false);
    };
    descargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (facturasGlobales.length > 0) guardarCacheFacturas(facturasGlobales);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales]);

  const guardarCacheOps = (docs: any[]) => {
    try { sessionStorage.setItem(SS_OPS, JSON.stringify({ ts: Date.now(), data: docs })); } catch { /* cuota */ }
  };

  const descargarOpsCompletadas = async (forzar = false) => {
    if (!forzar && operacionesGlobales.length > 0) return;
    if (!forzar) {
      try {
        const raw = sessionStorage.getItem(SS_OPS);
        if (raw) {
          const obj = JSON.parse(raw);
          if (obj && Array.isArray(obj.data) && obj.data.length && (Date.now() - (obj.ts || 0)) < SS_OPS_TTL) {
            setOperacionesGlobales(obj.data);
            setTopeOpsAlcanzado(obj.data.length >= LIMITE_OPS_TODAS);
            return;
          }
        }
      } catch { /* noop */ }
    }
    setCargandoOperaciones(true);
    try {
      let todas: any[] = [];
      let usarFallback = false;
      try {
        let cursor: any = null;
        for (let i = 0; i < Math.ceil(LIMITE_OPS_TODAS / PAG_OPS); i++) {
          const cons: any[] = [where('status', 'in', STATUS_FACTURABLES), orderBy(documentId()), limit(PAG_OPS)];
          if (cursor) cons.splice(2, 0, startAfter(cursor));
          const snap = await getDocs(query(collection(db, 'operaciones'), ...cons));
          if (snap.empty) break;
          snap.docs.forEach(d => todas.push({ id: d.id, ...(d.data() as any) }));
          cursor = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < PAG_OPS) break;
        }
      } catch (e1: any) {
        const msg1 = String(e1?.message || e1?.code || e1 || '');
        if (msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition')) {
          console.warn('[Facturación] Falta índice (status+__name__). Fallback: traer todo y filtrar en memoria. Detalle:', msg1);
          usarFallback = true;
        } else {
          throw e1;
        }
      }
      if (usarFallback) {
        todas = [];
        let cursor: any = null;
        for (let i = 0; i < Math.ceil(LIMITE_OPS_TODAS / PAG_OPS); i++) {
          const cons: any[] = [orderBy(documentId()), limit(PAG_OPS)];
          if (cursor) cons.splice(1, 0, startAfter(cursor));
          const snap = await getDocs(query(collection(db, 'operaciones'), ...cons));
          if (snap.empty) break;
          snap.docs.forEach(d => {
            const o: any = { id: d.id, ...(d.data() as any) };
            if (STATUS_FACTURABLES.includes(String(o.status || '').trim())) todas.push(o);
          });
          cursor = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < PAG_OPS) break;
        }
      }
      todas.sort((a: any, b: any) => String(b.fechaServicio || b.createdAt || '').localeCompare(String(a.fechaServicio || a.createdAt || '')));
      setOperacionesGlobales(todas);
      setTopeOpsAlcanzado(todas.length >= LIMITE_OPS_TODAS);
      guardarCacheOps(todas);
    } catch (e: any) {
      const msg = String(e?.message || e?.code || e || '');
      console.error('[Facturación] Error al cargar operaciones completadas:', e);
      alert(`No se pudieron cargar las operaciones.\n\nDetalle: ${msg}`);
    }
    setCargandoOperaciones(false);
  };

  useEffect(() => {
    if (activeTab !== 'operaciones') return;
    if (operacionesGlobales.length > 0) return;
    descargarOpsCompletadas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, operacionesGlobales.length]);

  useEffect(() => {
    if (operacionesGlobales.length > 0) guardarCacheOps(operacionesGlobales);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales]);

  const recargarOperaciones = () => {
    try { sessionStorage.removeItem(SS_OPS); } catch { /* noop */ }
    setSeleccionadas([]);
    descargarOpsCompletadas(true);
  };

  const getNombreEmpresa = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = empresasList.find(e => e.id === idOrName || e.nombre === idOrName || e.nombreCorto === idOrName);
    if (found) return found.nombre || found.nombreCorto || idOrName;
    const porCatalogo = mapaCatalogos[String(idOrName)];
    return porCatalogo || idOrName;
  };

  const proveedoresFiltradosBuscador = useMemo(() => {
    if (!empresasList.length) return [];
    const esProveedor = (emp: any) => {
      if (!ID_TIPO_PROVEEDOR) return true;
      const tipos = emp?.tiposEmpresa;
      if (Array.isArray(tipos)) return tipos.some((t: any) => String(t).trim() === ID_TIPO_PROVEEDOR);
      if (typeof tipos === 'string') return tipos.includes(ID_TIPO_PROVEEDOR);
      if (tipos && typeof tipos === 'object') return Object.values(tipos).some((v: any) => String(v).trim() === ID_TIPO_PROVEEDOR);
      return false;
    };
    const proveedores = empresasList
      .filter(esProveedor)
      .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
    if (!textoBuscarProveedor.trim()) return proveedores.slice(0, 30);
    const q = textoBuscarProveedor.toLowerCase().trim();
    return proveedores.filter((c: any) =>
      String(c.nombre || '').toLowerCase().includes(q) ||
      String(c.rfc || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [empresasList, textoBuscarProveedor]);

  const nombreProveedorSeleccionado = useMemo(() => {
    if (!filtroProveedor || !empresasList.length) return filtroProveedor || '';
    const cli = empresasList.find(e => e.id === filtroProveedor);
    return cli?.nombre || filtroProveedor;
  }, [filtroProveedor, empresasList]);

  const opIndex = useMemo(() => {
    const m = new Map<string, { invoice: string; facturaId: string; fecha: string; proveedorId: string; moneda: string }>();
    facturasGlobales.forEach((f: any) => {
      const ids = Array.isArray(f.operacionesIds) ? f.operacionesIds : [];
      ids.forEach((id: any) => {
        const k = String(id || '');
        if (k && !m.has(k)) m.set(k, { invoice: f.invoice, facturaId: f.id, fecha: f.fecha, proveedorId: f.proveedorId, moneda: f.monedaProveedor });
      });
    });
    return m;
  }, [facturasGlobales]);

  const monedaDeProveedor = (provId: any): string => {
    if (!provId) return '';
    const empresa = empresasList.find(e => e.id === provId);
    const idMoneda = empresa?.monedaRef || empresa?.moneda || empresa?.monedaProveedor;
    if (idMoneda === ID_MXN) return 'MXN';
    if (idMoneda === ID_USD) return 'USD';
    return idMoneda ? String(idMoneda) : '';
  };

  const resolverMoneda = (val: any): string => {
    const s = String(val || '').trim();
    if (!s) return '';
    if (s === ID_USD || s.toUpperCase() === 'USD') return 'USD';
    if (s === ID_MXN || s.toUpperCase() === 'MXN') return 'MXN';
    if (s.toUpperCase() === 'N/A') return '';
    const nombre = mapaCatalogos[s];
    return nombre || s;
  };

  const monedaFacturaMostrar = (f: any): string => {
    const propia = resolverMoneda(f.monedaProveedor);
    if (propia) return propia;
    return monedaDeProveedor(f.proveedorId) || 'N/A';
  };

  const esFacturada = (op: any) => opIndex.has(String(op.id)) || !!op.facturaProveedorId || !!op.facturadoProveedor;
  const invoiceDeOp = (op: any): string => op.facturaProveedorFolio || opIndex.get(String(op.id))?.invoice || '';
  const provDeOp = (op: any) => op?.[CAMPO_PROVEEDOR_OP] || op?.proveedorUnidadId;

  const proveedorFacturaId = useMemo(() => {
    if (filtroProveedor) return filtroProveedor;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = provDeOp(op);
      if (c) ids.add(String(c));
    });
    return ids.size === 1 ? [...ids][0] : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroProveedor, seleccionadas, operacionesGlobales]);

  const seleccionMultiProveedor = useMemo(() => {
    if (filtroProveedor) return false;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = provDeOp(op);
      if (c) ids.add(String(c));
    });
    return ids.size > 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroProveedor, seleccionadas, operacionesGlobales]);

  const nombreProveedorFactura = useMemo(() => {
    if (!proveedorFacturaId) return '';
    const porCatalogo = getNombreEmpresa(proveedorFacturaId);
    if (porCatalogo && porCatalogo !== proveedorFacturaId) return porCatalogo;
    const op = operacionesGlobales.find(o => String(provDeOp(o) || '') === proveedorFacturaId);
    return op?.proveedorUnidadNombre || proveedorFacturaId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorFacturaId, empresasList, operacionesGlobales]);

  const monedaProveedor = useMemo(() => {
    if (!proveedorFacturaId) return '-';
    const empresa = empresasList.find(e => e.id === proveedorFacturaId);
    if (!empresa) {
      const op = operacionesGlobales.find(o => String(provDeOp(o) || '') === proveedorFacturaId);
      return op?.monedaUnidadNombre || '-';
    }
    const idMoneda = empresa.monedaRef || empresa.moneda;
    if (idMoneda === ID_MXN) return 'MXN';
    if (idMoneda === ID_USD) return 'USD';
    return idMoneda || 'No definida en catálogo';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorFacturaId, empresasList, operacionesGlobales]);

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
      default:          return String(resolverNombre(val));
    }
  };

  const fechaOrdenKey = (val: any): string => {
    const s = String(val || '').trim();
    if (!s) return '00000000';
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0');
    m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) return m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0');
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0');
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/);
    if (m) return '20' + m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0');
    const d = new Date(s);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return s;
  };

  const refNaturalKey = (op: any): string => {
    const r = String(op.numReferencia || op.referencia || op.ref || op.id || '');
    return r.toLowerCase().replace(/\d+/g, (n) => n.padStart(12, '0'));
  };

  const valorOrdenOp = (op: any, campo: string): string | number => {
    switch (campo) {
      case 'factura': return String(op.facturaProveedorFolio || '').toLowerCase();
      case 'ref': return refNaturalKey(op);
      case 'fechaServicio': return fechaOrdenKey(op.fechaServicio || op.createdAt);
      case 'proveedor': return getNombreEmpresa(provDeOp(op) || op.proveedorUnidadNombre).toLowerCase();
      case 'destino': return String(op.destinoNombre || op.destino || '').toLowerCase();
      case 'subtotal': return obtenerMontoOperacion(op).subtotal;
      case 'conv': return obtenerMontoOperacion(op).conv;
      default: {
        const col = columnasOps.find(c => c.id === campo);
        const raw = valorGenericoOp(op, col);
        if (col?.tipo === 'monto' || col?.tipo === 'numero') return Number(raw) || 0;
        return String(resolverNombre(raw) || '').toLowerCase();
      }
    }
  };

  const dentroRangoFecha = (op: any) => {
    if (!fechaDesdeOps && !fechaHastaOps) return true;
    const f = String(op.fechaServicio || op.createdAt || '').slice(0, 10);
    if (!f) return false;
    if (fechaDesdeOps && f < fechaDesdeOps) return false;
    if (fechaHastaOps && f > fechaHastaOps) return false;
    return true;
  };

  const coincideProveedorOp = (op: any) => !filtroProveedor || String(provDeOp(op) || '') === filtroProveedor;

  const tipoOpNombre = (op: any): string => txt(op.tipoOperacionNombre, op.tipoOperacionId);
  const tiposOperacionDisponibles = useMemo(() => {
    const set = new Set<string>();
    operacionesGlobales.forEach(op => {
      const t = tipoOpNombre(op);
      if (t && t !== '-') set.add(t);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, mapaCatalogos]);
  const coincideTipoOp = (op: any) => !filtroTipoOp || tipoOpNombre(op) === filtroTipoOp;

  const operacionesMostradas = useMemo(() => {
    const q = textoBuscarRemolqueOps.trim().toLowerCase();
    const coincide = (op: any) => {
      if (!q) return true;
      const campos = [
        op.remolqueNombre, op.remolquePlaca, op.numeroRemolque, op.remolque,
        op.numReferencia, op.referencia, op.ref, invoiceDeOp(op), op.refCliente,
      ];
      return campos.some(v => String(v ?? '').toLowerCase().includes(q));
    };
    const coincideVista = (op: any) => {
      if (vistaOps === 'todas') return true;
      if (vistaOps === 'facturadas') return esFacturada(op);
      return !esFacturada(op);
    };
    const lista = operacionesGlobales.filter(op =>
      dentroRangoFecha(op) && coincideProveedorOp(op) && coincideTipoOp(op) && coincideVista(op) && coincide(op)
    );
    const dir = ordenOps.dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = valorOrdenOp(a, ordenOps.campo);
      const vb = valorOrdenOp(b, ordenOps.campo);
      let cmp = (typeof va === 'number' && typeof vb === 'number') ? (va - vb) : String(va).localeCompare(String(vb));
      cmp *= dir;
      if (cmp !== 0) return cmp;
      return refNaturalKey(a).localeCompare(refNaturalKey(b));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, ordenOps, empresasList, fechaDesdeOps, fechaHastaOps, columnasOps, mapaCatalogos, vistaOps, textoBuscarRemolqueOps, facturasGlobales, filtroProveedor, filtroTipoOp]);

  const resumenOps = useMemo(() => {
    const enRango = operacionesGlobales.filter(op => dentroRangoFecha(op) && coincideProveedorOp(op) && coincideTipoOp(op));
    const facturadas = enRango.filter(op => esFacturada(op)).length;
    const total = enRango.length;
    const porFacturar = total - facturadas;
    return { porFacturar, facturadas, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, fechaDesdeOps, fechaHastaOps, facturasGlobales, filtroProveedor, filtroTipoOp]);

  const diagnostico = useMemo(() => {
    const totalFacturas = facturasGlobales.length;
    const opsFacturadasUnicas = opIndex.size;
    const porClave = new Map<string, number>();
    facturasGlobales.forEach((f: any) => {
      const k = `${String(f.invoice || '').trim().toLowerCase()}__${String(f.proveedorId || '')}`;
      porClave.set(k, (porClave.get(k) || 0) + 1);
    });
    let invoicesDuplicados = 0;
    porClave.forEach(v => { if (v > 1) invoicesDuplicados++; });
    let sinMoneda = 0, sinFecha = 0, sinTotal = 0;
    facturasGlobales.forEach((f: any) => {
      if (monedaFacturaMostrar(f) === 'N/A') sinMoneda++;
      if (!String(f.fecha || '').trim()) sinFecha++;
      if (!(Number(f.subtotalFactura) > 0)) sinTotal++;
    });
    const enRango = operacionesGlobales.filter(op => dentroRangoFecha(op));
    const rangoTotal = enRango.length;
    const rangoFacturadas = enRango.filter(op => esFacturada(op)).length;
    const rangoPorFacturar = rangoTotal - rangoFacturadas;
    const huerfanas = enRango.filter(op => (op.facturadoProveedor || op.facturaProveedorId) && !opIndex.has(String(op.id))).length;
    return {
      totalFacturas, opsFacturadasUnicas, invoicesDuplicados,
      sinMoneda, sinFecha, sinTotal,
      rangoTotal, rangoFacturadas, rangoPorFacturar, huerfanas,
      topeFacturas: totalFacturas >= LIMITE_FACTURAS_TODAS,
      topeOps: topeOpsAlcanzado,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, opIndex, operacionesGlobales, fechaDesdeOps, fechaHastaOps, empresasList, topeOpsAlcanzado]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const valorCeldaOps = (op: any, key: string, m: any) => {
    switch (key) {
      case 'factura': { const inv = invoiceDeOp(op); return inv || (esFacturada(op) ? 'Facturada' : 'Por facturar'); }
      case 'ref': return op.numReferencia || op.referencia || op.ref || op.id;
      case 'fechaServicio': return formatearFechaSpanish(op.fechaServicio || op.createdAt);
      case 'proveedor': return getNombreEmpresa(provDeOp(op) || op.proveedorUnidadNombre);
      case 'cartaPorte': return op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-';
      case 'destino': return op.destinoNombre || op.destino || '-';
      case 'moneda': return op.monedaUnidadNombre || mostrarMoneda(op.facturadoEnUnidad);
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
      case 'factura': {
        const inv = invoiceDeOp(op);
        if (inv) return <td key={key} style={{ padding: '16px', whiteSpace: 'nowrap' }}><span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 'bold', color: '#58a6ff', border: '1px solid #58a6ff', backgroundColor: 'rgba(88,166,255,0.1)', fontFamily: 'monospace' }}>{inv}</span></td>;
        return <td key={key} style={{ padding: '16px', whiteSpace: 'nowrap' }}><span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Por facturar</span></td>;
      }
      case 'ref': return <td key={key} style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op.numReferencia || op.referencia || op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'proveedor': return <td key={key} style={tdBase}>{getNombreEmpresa(provDeOp(op) || op.proveedorUnidadNombre)}</td>;
      case 'cartaPorte': return <td key={key} style={tdBase}>{op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destinoNombre || op.destino || '-'}</td>;
      case 'moneda': return <td key={key} style={tdBase}>{op.monedaUnidadNombre || mostrarMoneda(op.facturadoEnUnidad)}</td>;
      case 'subtotal': return <td key={key} style={tdBase}>{formatoMoneda(m.subtotal)}</td>;
      case 'dolares': return <td key={key} style={{ ...tdBase, color: '#10b981' }}>{formatoMoneda(m.dol)}</td>;
      case 'pesos': return <td key={key} style={{ ...tdBase, color: '#3b82f6' }}>{formatoMoneda(m.pes)}</td>;
      case 'conv': return <td key={key} style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.conv)}</td>;
      default: {
        const col = columnasOps.find(c => c.id === key);
        const text = formatearValorGenericoOp(valorGenericoOp(op, col), col?.tipo);
        if (col?.tipo === 'monto') return <td key={key} style={{ ...tdBase, color: '#3fb950' }}>{text}</td>;
        if (col?.tipo === 'numero') return <td key={key} style={{ ...tdBase, textAlign: 'right' as const }}>{text}</td>;
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
    const prov = (filtroProveedor ? (nombreProveedorSeleccionado || 'proveedor') : 'todos').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
    const rango = (fechaDesdeOps || fechaHastaOps) ? `_${fechaDesdeOps || 'inicio'}_a_${fechaHastaOps || 'hoy'}` : '_todas';
    XLSX.writeFile(wb, `Operaciones_${vistaOps}_${prov}${rango}.xlsx`);
  };

  const toggleSeleccion = (id: string) => {
    const op = operacionesGlobales.find(o => o.id === id);
    if (op && esFacturada(op)) return;
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const abrirModalCostoAdic = () => {
    setCostoAdicOpId(seleccionadas.length > 0 ? seleccionadas[0] : '');
    setCostoAdicMonto(''); setCostoAdicConcepto(''); setModalCostoAdic(true);
  };
  const abrirCostoAdicParaOp = (opId: string) => {
    setCostoAdicOpId(opId);
    setCostoAdicMonto(''); setCostoAdicConcepto(''); setModalCostoAdic(true);
  };

  const handleGuardarCostoAdic = async () => {
    const op = operacionesGlobales.find(o => o.id === costoAdicOpId);
    if (!op) return alert('Selecciona una operación.');
    const monto = Number(costoAdicMonto);
    if (!monto || isNaN(monto)) return alert('Captura un monto válido (puede ser negativo para un descuento).');
    setGuardandoCostoAdic(true);
    try {
      const nuevoCargos = (Number(op.cargosAdicionalesProv) || 0) + monto;
      const { subtotal, dol, pes, conv } = calcularConversionProveedor({ ...op, cargosAdicionalesProv: nuevoCargos });
      const concepto = costoAdicConcepto.trim();
      const updates: any = {
        cargosAdicionalesProv: nuevoCargos,
        subtotalProv: subtotal,
        dolaresProv: dol,
        pesosProv: pes,
        conversionProv: conv,
      };
      if (concepto) {
        const obsPrev = String(op.observacionesUnidad || '').trim();
        updates.observacionesUnidad = `${obsPrev ? obsPrev + ' | ' : ''}Costo adicional: ${concepto} (${monto >= 0 ? '+' : ''}${monto})`;
      }
      await setDoc(doc(db, 'operaciones', String(op.id)), updates, { merge: true });
      setOperacionesGlobales(prev => prev.map(o => o.id === op.id ? { ...o, ...updates } : o));
      setModalCostoAdic(false);
    } catch (e) {
      console.error('Error guardando costo adicional:', e);
      alert('No se pudo guardar el costo adicional.');
    } finally {
      setGuardandoCostoAdic(false);
    }
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

  const handleGuardarFactura = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceForm.trim()) return alert('El # de Invoice es obligatorio.');
    if (seleccionMultiProveedor || !proveedorFacturaId) {
      return alert('Las operaciones seleccionadas deben ser de un mismo proveedor. Selecciona un proveedor en el filtro o elige operaciones de un solo proveedor.');
    }
    setGuardando(true);
    try {
      const batch = writeBatch(db);
      const nuevoId = doc(collection(db, 'facturas_proveedores')).id;
      const operacionesResumenEstable = seleccionadas.map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        const montos = op ? obtenerMontoOperacion(op) : { subtotal: 0, conv: 0, dol: 0, pes: 0 };
        return {
          id,
          ref: op?.numReferencia || op?.referencia || op?.ref || id.substring(0, 6),
          monto: montos.conv,
          subtotalBase: montos.subtotal,
          remolque: op ? txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque) : '',
        };
      });
      const remolquesFactura = Array.from(new Set(
        operacionesResumenEstable.map((o: any) => String(o.remolque || '')).filter(r => r && r !== '-')
      ));
      const data = {
        invoice: invoiceForm.trim(),
        fecha: fechaForm,
        facturaCcp: facturaCcpForm.trim(),
        statusFactura: statusFacturaForm,
        proveedorId: proveedorFacturaId,
        proveedorNombre: nombreProveedorFactura || getNombreEmpresa(proveedorFacturaId),
        monedaProveedor,
        operacionesIds: seleccionadas,
        operacionesGuardadas: operacionesResumenEstable,
        remolques: remolquesFactura,
        subtotalFactura: resumenSeleccion.subtotal,
        createdAt: new Date().toISOString(),
      };
      const invKey = invoiceForm.trim().toLowerCase();
      const existente = facturasGlobales.find(f =>
        String(f.invoice || '').trim().toLowerCase() === invKey &&
        String(f.proveedorId || '') === String(proveedorFacturaId)
      );
      let docId = nuevoId;
      let facturaResultante: any = data;
      if (existente) {
        docId = existente.id;
        const idsPrev: string[] = Array.isArray(existente.operacionesIds) ? existente.operacionesIds.map(String) : [];
        const idsUnion = Array.from(new Set([...idsPrev, ...seleccionadas]));
        const guardadasPrev: any[] = Array.isArray(existente.operacionesGuardadas) ? existente.operacionesGuardadas : [];
        const mapaGuardadas = new Map<string, any>();
        [...guardadasPrev, ...operacionesResumenEstable].forEach((o: any) => { if (o?.id) mapaGuardadas.set(String(o.id), o); });
        const guardadasUnion = Array.from(mapaGuardadas.values());
        const remolquesUnion = Array.from(new Set([
          ...(Array.isArray(existente.remolques) ? existente.remolques : []),
          ...remolquesFactura,
        ].map((r: any) => String(r || '')).filter(r => r && r !== '-')));
        const subtotalUnion = Number(existente.subtotalFactura || 0) + Number(resumenSeleccion.subtotal || 0);
        const merge = {
          invoice: existente.invoice || invoiceForm.trim(),
          facturaCcp: facturaCcpForm.trim() || existente.facturaCcp || '',
          statusFactura: statusFacturaForm || existente.statusFactura || 'Facturado',
          proveedorId: proveedorFacturaId,
          proveedorNombre: existente.proveedorNombre || data.proveedorNombre,
          monedaProveedor: existente.monedaProveedor || monedaProveedor,
          operacionesIds: idsUnion,
          operacionesGuardadas: guardadasUnion,
          remolques: remolquesUnion,
          subtotalFactura: subtotalUnion,
          updatedAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'facturas_proveedores', docId), merge, { merge: true });
        facturaResultante = { ...existente, ...merge };
      } else {
        batch.set(doc(db, 'facturas_proveedores', docId), data);
      }
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), {
          facturaProveedorId: docId,
          facturaProveedorFolio: invoiceForm.trim(),
          facturadoProveedor: true,
        });
      });
      await batch.commit();
      setModalAbierto(false);
      const idsFacturadas = [...seleccionadas];
      const invoiceTrim = invoiceForm.trim();
      setSeleccionadas([]);
      setInvoiceForm('');
      setFacturaCcpForm('');
      setStatusFacturaForm('Facturado');
      setOperacionesGlobales(prev => prev.map(op =>
        idsFacturadas.includes(op.id) ? { ...op, facturaProveedorId: docId, facturaProveedorFolio: invoiceTrim, facturadoProveedor: true } : op
      ));
      setFacturasGlobales(prev => {
        if (existente) {
          return prev.map(f => f.id === docId ? normalizarFactura({ id: docId, ...facturaResultante }) : f);
        }
        return [normalizarFactura({ id: docId, ...data }), ...prev];
      });
      setActiveTab('historial');
    } catch (error) {
      console.error(error);
      alert('Error al guardar la factura.');
    } finally {
      setGuardando(false);
    }
  };

  const handleCambiarStatusFactura = async (factura: any, nuevoStatus: string) => {
    if (!factura?.id) return;
    const ids: string[] = Array.isArray(factura.__groupIds) && factura.__groupIds.length ? factura.__groupIds : [factura.id];
    try {
      const batch = writeBatch(db);
      ids.forEach(id => batch.set(doc(db, 'facturas_proveedores', id), { statusFactura: nuevoStatus }, { merge: true }));
      await batch.commit();
      setFacturasGlobales(prev => prev.map(f => ids.includes(f.id) ? { ...f, statusFactura: nuevoStatus } : f));
      setFacturaViendo((prev: any) => (prev && (ids.includes(prev.id) || prev.id === factura.id)) ? { ...prev, statusFactura: nuevoStatus } : prev);
    } catch (e) {
      console.error('Error actualizando status de factura:', e);
      alert('No se pudo actualizar el status de la factura.');
    }
  };

  const abrirEditarFactura = (e: React.MouseEvent, f: any) => {
    e.stopPropagation();
    setFacturaEditando(f);
    setEditInvoice(String(f.invoice || ''));
    setEditFecha(String(f.fecha || '').slice(0, 10));
    setEditCcp(String(f.facturaCcp || ''));
    setEditStatus(String(f.statusFactura || 'Facturado'));
    setEditMoneda(resolverMoneda(f.monedaProveedor) || '');
    setEditTotal(String(Number(f.subtotalFactura) || 0));
  };

  const handleGuardarEdicionFactura = async () => {
    if (!facturaEditando) return;
    if (!editInvoice.trim()) return alert('El # de Invoice es obligatorio.');
    setGuardandoEdit(true);
    try {
      const ids: string[] = Array.isArray(facturaEditando.__groupIds) && facturaEditando.__groupIds.length ? facturaEditando.__groupIds : [facturaEditando.id];
      const totalNum = Number(editTotal) || 0;
      const baseUpdate: any = {
        invoice: editInvoice.trim(),
        fecha: editFecha || '',
        facturaCcp: editCcp.trim(),
        statusFactura: editStatus,
        monedaProveedor: editMoneda || 'N/A',
        updatedAt: new Date().toISOString(),
      };
      const batch = writeBatch(db);
      ids.forEach((id, idx) => {
        batch.set(doc(db, 'facturas_proveedores', id), { ...baseUpdate, subtotalFactura: idx === 0 ? totalNum : 0 }, { merge: true });
      });
      await batch.commit();
      setFacturasGlobales(prev => prev.map(f => {
        if (!ids.includes(f.id)) return f;
        const esPrimero = f.id === ids[0];
        return normalizarFactura({ ...f, ...baseUpdate, subtotalFactura: esPrimero ? totalNum : 0 });
      }));
      setFacturaViendo((prev: any) => (prev && ids.includes(prev.id)) ? { ...prev, ...baseUpdate, subtotalFactura: totalNum } : prev);
      setFacturaEditando(null);
    } catch (e) {
      console.error('Error guardando edición de factura:', e);
      alert('No se pudo guardar la edición de la factura.');
    } finally {
      setGuardandoEdit(false);
    }
  };

  const remolquesDeGuardadas = (guardadas: any[]): string[] =>
    Array.from(new Set((guardadas || []).map((o: any) => String(o?.remolque || '')).filter(r => r && r !== '-')));

  const buildResumenOp = (op: any) => {
    const m = obtenerMontoOperacion(op);
    return {
      id: String(op.id),
      ref: op.numReferencia || op.referencia || op.ref || String(op.id).substring(0, 6),
      monto: m.conv,
      subtotalBase: m.subtotal,
      remolque: txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque),
    };
  };

  const aplicarCambiosFacturas = (cambios: any[]) => {
    setFacturasGlobales(prev => {
      let arr = [...prev];
      cambios.forEach((c: any) => {
        if (c.tipo === 'delete') arr = arr.filter(f => f.id !== c.id);
        else if (c.tipo === 'update') arr = arr.map(f => f.id === c.id ? normalizarFactura({ ...f, ...c.data }) : f);
        else if (c.tipo === 'create') arr = [normalizarFactura({ id: c.id, ...c.data }), ...arr];
      });
      return arr;
    });
  };

  const abrirGestionOp = (e: React.MouseEvent, op: any) => {
    e.stopPropagation();
    setGestionOp(op);
    setGestionInvoice(invoiceDeOp(op) || '');
  };

  const quitarOpDeFactura = async (op: any) => {
    const opId = String(op.id);
    const refTxt = op.numReferencia || op.referencia || op.ref || opId.substring(0, 6);
    if (!window.confirm(`¿Quitar la operación ${refTxt} de su factura? Volverá a "Pendientes" y se restará su monto de la factura.`)) return;
    const facturasConOp = facturasGlobales.filter(f => (f.operacionesIds || []).map(String).includes(opId));
    setGuardandoGestionOp(true);
    try {
      const batch = writeBatch(db);
      const cambios: any[] = [];
      for (const f of facturasConOp) {
        const g = (f.operacionesGuardadas || []).find((o: any) => String(o.id) === opId);
        const monto = g ? (Number(g.monto) || 0) : obtenerMontoOperacion(op).conv;
        const ids = (f.operacionesIds || []).map(String).filter((id: string) => id !== opId);
        const guardadas = (f.operacionesGuardadas || []).filter((o: any) => String(o.id) !== opId);
        const subtotal = Math.max(0, Number(f.subtotalFactura || 0) - monto);
        if (ids.length === 0) {
          batch.delete(doc(db, 'facturas_proveedores', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
        } else {
          const data = { operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), subtotalFactura: subtotal, updatedAt: new Date().toISOString() };
          batch.set(doc(db, 'facturas_proveedores', f.id), data, { merge: true });
          cambios.push({ tipo: 'update', id: f.id, data });
        }
      }
      batch.update(doc(db, 'operaciones', opId), { facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false });
      await batch.commit();
      aplicarCambiosFacturas(cambios);
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false } : o));
      setGestionOp(null);
    } catch (e) {
      console.error('Error quitando operación de la factura:', e);
      alert('No se pudo quitar la operación de la factura.');
    } finally {
      setGuardandoGestionOp(false);
    }
  };

  const editarInvoiceDeOp = async (op: any, nuevoInvoiceRaw: string) => {
    const nuevoInvoice = String(nuevoInvoiceRaw || '').trim();
    if (!nuevoInvoice) return alert('Captura un número de factura.');
    const opId = String(op.id);
    const provId = String(provDeOp(op) || '');
    const facturasConOp = facturasGlobales.filter(f => (f.operacionesIds || []).map(String).includes(opId));
    setGuardandoGestionOp(true);
    try {
      const batch = writeBatch(db);
      const cambios: any[] = [];

      let resumenOrigen: any = null;
      let metaCarry: any = null;
      for (const f of facturasConOp) {
        if (!metaCarry) metaCarry = { statusFactura: f.statusFactura, monedaProveedor: f.monedaProveedor, facturaCcp: f.facturaCcp, fecha: f.fecha, proveedorNombre: f.proveedorNombre };
        const g = (f.operacionesGuardadas || []).find((o: any) => String(o.id) === opId);
        if (g && !resumenOrigen) resumenOrigen = g;
      }
      if (!resumenOrigen) resumenOrigen = buildResumenOp(op);
      const montoOp = Number(resumenOrigen.monto) || 0;

      for (const f of facturasConOp) {
        const ids = (f.operacionesIds || []).map(String).filter((id: string) => id !== opId);
        const guardadas = (f.operacionesGuardadas || []).filter((o: any) => String(o.id) !== opId);
        const subtotal = Math.max(0, Number(f.subtotalFactura || 0) - montoOp);
        if (ids.length === 0) {
          batch.delete(doc(db, 'facturas_proveedores', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
        } else {
          const data = { operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), subtotalFactura: subtotal, updatedAt: new Date().toISOString() };
          batch.set(doc(db, 'facturas_proveedores', f.id), data, { merge: true });
          cambios.push({ tipo: 'update', id: f.id, data });
        }
      }

      const target = facturasGlobales.find(f =>
        String(f.invoice || '').trim().toLowerCase() === nuevoInvoice.toLowerCase() &&
        String(f.proveedorId || '') === provId &&
        !facturasConOp.some(fc => fc.id === f.id)
      );
      let targetId: string;
      if (target) {
        const ids = Array.from(new Set([...(target.operacionesIds || []).map(String), opId]));
        const mapG = new Map<string, any>();
        [...(target.operacionesGuardadas || []), resumenOrigen].forEach((o: any) => { if (o?.id) mapG.set(String(o.id), o); });
        const guardadas = Array.from(mapG.values());
        const subtotal = Number(target.subtotalFactura || 0) + montoOp;
        targetId = target.id;
        const data = { invoice: target.invoice || nuevoInvoice, operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), subtotalFactura: subtotal, updatedAt: new Date().toISOString() };
        batch.set(doc(db, 'facturas_proveedores', targetId), data, { merge: true });
        cambios.push({ tipo: 'update', id: targetId, data });
      } else {
        targetId = doc(collection(db, 'facturas_proveedores')).id;
        const data: any = {
          invoice: nuevoInvoice,
          fecha: metaCarry?.fecha || '',
          facturaCcp: metaCarry?.facturaCcp || '',
          statusFactura: metaCarry?.statusFactura || 'Facturado',
          proveedorId: provId,
          proveedorNombre: metaCarry?.proveedorNombre || getNombreEmpresa(provId),
          monedaProveedor: metaCarry?.monedaProveedor || 'N/A',
          operacionesIds: [opId],
          operacionesGuardadas: [resumenOrigen],
          remolques: remolquesDeGuardadas([resumenOrigen]),
          subtotalFactura: montoOp,
          createdAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'facturas_proveedores', targetId), data);
        cambios.push({ tipo: 'create', id: targetId, data });
      }

      batch.update(doc(db, 'operaciones', opId), { facturaProveedorId: targetId, facturaProveedorFolio: nuevoInvoice, facturadoProveedor: true });
      await batch.commit();
      aplicarCambiosFacturas(cambios);
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaProveedorId: targetId, facturaProveedorFolio: nuevoInvoice, facturadoProveedor: true } : o));
      setGestionOp(null);
    } catch (e) {
      console.error('Error editando # de factura de la operación:', e);
      alert('No se pudo cambiar el número de factura de la operación.');
    } finally {
      setGuardandoGestionOp(false);
    }
  };

  const agregarOpAFactura = async (facturaGrupo: any, op: any) => {
    const opId = String(op.id);
    const rawId = (Array.isArray(facturaGrupo.__groupIds) && facturaGrupo.__groupIds.length) ? facturaGrupo.__groupIds[0] : facturaGrupo.id;
    const rawDoc = facturasGlobales.find(f => f.id === rawId) || facturaGrupo;
    const resumen = buildResumenOp(op);
    const monto = Number(resumen.monto) || 0;
    setAgregandoRef(true);
    try {
      const ids = Array.from(new Set([...(rawDoc.operacionesIds || []).map(String), opId]));
      const mapG = new Map<string, any>();
      [...(rawDoc.operacionesGuardadas || []), resumen].forEach((o: any) => { if (o?.id) mapG.set(String(o.id), o); });
      const guardadas = Array.from(mapG.values());
      const data = {
        operacionesIds: ids,
        operacionesGuardadas: guardadas,
        remolques: remolquesDeGuardadas(guardadas),
        subtotalFactura: Number(rawDoc.subtotalFactura || 0) + monto,
        updatedAt: new Date().toISOString(),
      };
      const batch = writeBatch(db);
      batch.set(doc(db, 'facturas_proveedores', rawId), data, { merge: true });
      batch.update(doc(db, 'operaciones', opId), { facturaProveedorId: rawId, facturaProveedorFolio: rawDoc.invoice || facturaGrupo.invoice, facturadoProveedor: true });
      await batch.commit();
      setFacturasGlobales(prev => prev.map(f => f.id === rawId ? normalizarFactura({ ...f, ...data }) : f));
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaProveedorId: rawId, facturaProveedorFolio: rawDoc.invoice || facturaGrupo.invoice, facturadoProveedor: true } : o));
      const aplicarEnGrupo = (g: any) => {
        if (!g) return g;
        const mismoGrupo = (Array.isArray(g.__groupIds) ? g.__groupIds : [g.id]).includes(rawId) || g.id === facturaGrupo.id;
        if (!mismoGrupo) return g;
        const mapG2 = new Map<string, any>();
        [...(g.operacionesGuardadas || []), resumen].forEach((o: any) => { if (o?.id) mapG2.set(String(o.id), o); });
        const guardadas2 = Array.from(mapG2.values());
        return { ...g, operacionesIds: Array.from(new Set([...(g.operacionesIds || []).map(String), opId])), operacionesGuardadas: guardadas2, remolques: remolquesDeGuardadas(guardadas2), subtotalFactura: Number(g.subtotalFactura || 0) + monto };
      };
      setAgregarRefFactura((prev: any) => aplicarEnGrupo(prev));
      setFacturaViendo((prev: any) => aplicarEnGrupo(prev));
    } catch (e) {
      console.error('Error agregando operación a la factura:', e);
      alert('No se pudo agregar la operación a la factura.');
    } finally {
      setAgregandoRef(false);
    }
  };

  const candidatosPendientes = useMemo(() => {
    if (!agregarRefFactura) return [];
    const provId = String(agregarRefFactura.proveedorId || '');
    const q = busquedaRefPendiente.trim().toLowerCase();
    const lista = operacionesGlobales.filter(op => {
      if (esFacturada(op)) return false;
      if (provId && String(provDeOp(op) || '') !== provId) return false;
      if (!q) return true;
      const campos = [op.numReferencia, op.referencia, op.ref, op.remolqueNombre, op.remolquePlaca, op.numeroRemolque];
      return campos.some(v => String(v ?? '').toLowerCase().includes(q));
    });
    return lista.slice(0, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agregarRefFactura, operacionesGlobales, busquedaRefPendiente, facturasGlobales]);

  const handleEliminarFactura = async (e: React.MouseEvent, facData: any) => {
    e.stopPropagation();
    const ids: string[] = Array.isArray(facData.__groupIds) && facData.__groupIds.length ? facData.__groupIds : [facData.id];
    const aviso = ids.length > 1
      ? `¿Eliminar las ${ids.length} facturas con el número ${facData.invoice}? Las operaciones asociadas quedarán liberadas nuevamente.`
      : `¿Estás seguro de eliminar la factura ${facData.invoice}? Las operaciones asociadas quedarán liberadas nuevamente.`;
    if (window.confirm(aviso)) {
      try {
        const batch = writeBatch(db);
        const idsLiberadas: string[] = [];
        ids.forEach(fid => batch.delete(doc(db, 'facturas_proveedores', fid)));
        const docs: any[] = Array.isArray(facData.__groupDocs) && facData.__groupDocs.length ? facData.__groupDocs : [facData];
        docs.forEach((d: any) => {
          if (Array.isArray(d.operacionesIds)) {
            d.operacionesIds.forEach((opId: string) => {
              idsLiberadas.push(opId);
              batch.update(doc(db, 'operaciones', opId), {
                facturaProveedorId: null,
                facturaProveedorFolio: null,
                facturadoProveedor: false,
              });
            });
          }
        });
        await batch.commit();
        setFacturasGlobales(prev => prev.filter(f => !ids.includes(f.id)));
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false } : op
        ));
      } catch (error) {
        console.error('Error al eliminar factura:', error);
        alert('Hubo un error al eliminar.');
      }
    }
  };

  const valorOrdenFac = (f: any, campo: string): string | number => {
    switch (campo) {
      case 'statusFactura': return String(f.statusFactura || '').toLowerCase();
      case 'invoice': return String(f.invoice || '').toLowerCase();
      case 'fecha': return String(f.fecha || '');
      case 'proveedor': return String(f.proveedorNombre || '').toLowerCase();
      case 'moneda': return String(f.monedaProveedor || '').toLowerCase();
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
      if (String(f.proveedorNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.proveedorId) { const nom = getNombreEmpresa(f.proveedorId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaProveedor || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(f.remolques) && f.remolques.some((r: any) => String(r || '').toLowerCase().includes(q))) return true;
      if (Array.isArray(f.operacionesGuardadas)) {
        if (f.operacionesGuardadas.some((op: any) => {
          const info = opInfoMap[String(op?.id || '')] || {};
          return String(op?.ref || '').toLowerCase().includes(q) ||
            String(op?.remolque || '').toLowerCase().includes(q) ||
            String(info.ref || '').toLowerCase().includes(q) ||
            String(info.remolque || '').toLowerCase().includes(q);
        })) return true;
      }
      return false;
    };
    const coincideProveedor = (f: any) => !filtroProveedor || String(f.proveedorId || '') === filtroProveedor;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = String(f.fecha || '').slice(0, 10);
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const filtradas = facturasGlobales.filter(f => coincideTexto(f) && coincideProveedor(f) && coincideFechas(f));
    const grupos = new Map<string, any>();
    for (const f of filtradas) {
      const key = `${String(f.invoice || f.id).trim().toLowerCase()}__${String(f.proveedorId || '')}`;
      if (!grupos.has(key)) {
        grupos.set(key, {
          ...f,
          operacionesIds: Array.isArray(f.operacionesIds) ? [...f.operacionesIds] : [],
          operacionesGuardadas: Array.isArray(f.operacionesGuardadas) ? [...f.operacionesGuardadas] : [],
          remolques: Array.isArray(f.remolques) ? [...f.remolques] : [],
          subtotalFactura: Number(f.subtotalFactura) || 0,
          __groupIds: [f.id],
          __groupDocs: [f],
        });
      } else {
        const g = grupos.get(key);
        g.__groupIds.push(f.id);
        g.__groupDocs.push(f);
        const setIds = new Set<string>([...(g.operacionesIds || []).map(String), ...((f.operacionesIds || []).map(String))]);
        g.operacionesIds = Array.from(setIds);
        const mapG = new Map<string, any>();
        [...(g.operacionesGuardadas || []), ...(f.operacionesGuardadas || [])].forEach((o: any) => { if (o?.id) mapG.set(String(o.id), o); });
        g.operacionesGuardadas = Array.from(mapG.values());
        g.remolques = Array.from(new Set([...(g.remolques || []), ...((f.remolques) || [])].map((r: any) => String(r || '')).filter(Boolean)));
        g.subtotalFactura = Number(g.subtotalFactura || 0) + (Number(f.subtotalFactura) || 0);
        if (String(f.fecha || '') > String(g.fecha || '')) g.fecha = f.fecha;
        if (!g.createdAt || (f.createdAt && String(f.createdAt) < String(g.createdAt))) g.createdAt = f.createdAt || g.createdAt;
        const rank = (s: any) => { const t = String(s || '').toLowerCase(); if (t.includes('cancel')) return 3; if (t.includes('no')) return 2; return 1; };
        if (rank(f.statusFactura) > rank(g.statusFactura)) g.statusFactura = f.statusFactura;
      }
    }
    let agrupadas = Array.from(grupos.values());
    if (filtroStatusFactura && filtroStatusFactura !== 'Todos') {
      agrupadas = agrupadas.filter(g => String(g.statusFactura || 'Facturado') === filtroStatusFactura);
    }
    return agrupadas.sort((a, b) => {
      const va = valorOrdenFac(a, ordenFac.campo);
      const vb = valorOrdenFac(b, ordenFac.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, ordenFac, textoBuscarFactura, filtroProveedor, fechaDesdeHist, fechaHastaHist, opInfoMap, filtroStatusFactura]);

  const resumenHistorial = useMemo(() => {
    let totalUSD = 0, totalMXN = 0, totalSinMoneda = 0, totalOps = 0;
    historialOrdenado.forEach(f => {
      const monto = Number(f.subtotalFactura) || 0;
      const mon = monedaFacturaMostrar(f).toUpperCase();
      if (mon === 'USD') totalUSD += monto;
      else if (mon === 'MXN') totalMXN += monto;
      else totalSinMoneda += monto;
      totalOps += Array.isArray(f.operacionesIds) ? f.operacionesIds.length : 0;
    });
    return { cuenta: historialOrdenado.length, totalUSD, totalMXN, totalSinMoneda, totalOps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historialOrdenado]);

  const conteoStatus = useMemo(() => {
    const q = textoBuscarFactura.trim().toLowerCase();
    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.proveedorNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.proveedorId) { const nom = getNombreEmpresa(f.proveedorId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaProveedor || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(f.remolques) && f.remolques.some((r: any) => String(r || '').toLowerCase().includes(q))) return true;
      return false;
    };
    const coincideProveedor = (f: any) => !filtroProveedor || String(f.proveedorId || '') === filtroProveedor;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = String(f.fecha || '').slice(0, 10);
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const base = facturasGlobales.filter(f => coincideTexto(f) && coincideProveedor(f) && coincideFechas(f));
    const c = { Todos: base.length } as Record<string, number>;
    base.forEach((f: any) => {
      const s = (String(f.statusFactura || 'Facturado').trim()) || 'Facturado';
      c[s] = (c[s] || 0) + 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, textoBuscarFactura, filtroProveedor, fechaDesdeHist, fechaHastaHist]);

  const statusBotones = useMemo(() => {
    const orden = ['Facturado', 'No Facturado', 'Cancelado'];
    const otros = Object.keys(conteoStatus).filter(k => k !== 'Todos');
    otros.sort((a, b) => {
      const ia = orden.indexOf(a); const ib = orden.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });
    return ['Todos', ...otros];
  }, [conteoStatus]);

  const toggleOrdenFac = (campo: string) =>
    setOrdenFac(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const flechaFac = (campo: string) => ordenFac.campo === campo ? (ordenFac.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const totalPaginas = Math.ceil(historialOrdenado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialOrdenado.slice(indexFirst, indexLast);

  const pareceReferencia = (s: any): boolean => /^[A-Za-z]{1,6}[-\s]?\d{3,}/.test(String(s || '').trim());

  useEffect(() => {
    const fuentes: any[] = activeTab === 'historial' ? [...registrosVisibles] : [];
    if (facturaViendo) fuentes.push(facturaViendo);
    if (agregarRefFactura) fuentes.push(agregarRefFactura);
    if (fuentes.length === 0) return;
    const faltantes = new Set<string>();
    const considerar = (id: string) => {
      const k = String(id || '').trim();
      if (!k || opInfoMap[k]) return;
      if (pareceReferencia(k)) return;
      if (k.length < 6) return;
      faltantes.add(k);
    };
    const considerarValor = (valor: any) => String(valor || '').split(/[,\s]+/).forEach(t => considerar(t));
    fuentes.forEach((f: any) => {
      (Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : []).forEach((op: any) => {
        considerar(String(op?.id || ''));
        considerarValor(op?.ref);
      });
      (Array.isArray(f.operacionesIds) ? f.operacionesIds : []).forEach((id: any) => considerar(String(id || '')));
    });
    if (faltantes.size === 0) return;
    let activo = true;
    (async () => {
      const ids = Array.from(faltantes).slice(0, 150);
      const nuevos: Record<string, any> = {};
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        try {
          const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', chunk)));
          snap.docs.forEach(d => {
            const o: any = { id: d.id, ...(d.data() as any) };
            nuevos[d.id] = {
              ref: o.numReferencia || o.referencia || o.ref || d.id,
              remolque: txt(o.remolqueNombre, o.remolquePlaca, o.numeroRemolque),
              moneda: o.monedaUnidadNombre || mostrarMoneda(o.facturadoEnUnidad),
              proveedorId: provDeOp(o) || '',
            };
          });
        } catch (e) { console.warn('No se pudo resolver lote de operaciones del historial:', e); }
      }
      if (activo && Object.keys(nuevos).length) setOpInfoMap(prev => ({ ...prev, ...nuevos }));
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrosVisibles, facturaViendo, agregarRefFactura, activeTab]);

  const refDeOp = (op: any): string => {
    const id = String(op?.id || '');
    const directos = [op?.numReferencia, op?.referencia, op?.ref].map((v: any) => String(v || '')).filter(Boolean);
    const refDirecta = directos.find(pareceReferencia);
    if (refDirecta) return refDirecta;
    const info = opInfoMap[id];
    if (info?.ref && pareceReferencia(String(info.ref))) return String(info.ref);
    const tokens = new Set<string>();
    [id, ...directos].forEach(v => String(v).split(/[,\s]+/).forEach(t => { if (t) tokens.add(t); }));
    const resueltas: string[] = [];
    tokens.forEach(t => { const i = opInfoMap[t]; if (i?.ref && pareceReferencia(String(i.ref))) resueltas.push(String(i.ref)); });
    if (resueltas.length) return Array.from(new Set(resueltas)).join(', ');
    return directos[0] || (info?.ref ? String(info.ref) : '') || id;
  };

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));
  useEffect(() => { setPaginaActual(1); }, [filtroProveedor, ordenFac, fechaDesdeHist, fechaHastaHist, textoBuscarFactura, filtroStatusFactura]);
  useEffect(() => { setPaginaOps(1); }, [filtroProveedor, ordenOps, fechaDesdeOps, fechaHastaOps, textoBuscarRemolqueOps, vistaOps, operacionesGlobales, filtroTipoOp]);

  const nombreProveedorFactura_ = (f: any): string => {
    if (f.proveedorNombre) return f.proveedorNombre;
    if (f.proveedor) return f.proveedor;
    if (f.proveedorId) {
      const nom = getNombreEmpresa(f.proveedorId);
      if (nom && nom !== f.proveedorId) return nom;
    }
    return '-';
  };

  const valorCeldaFactura = (f: any, colId: string): any => {
    switch (colId) {
      case 'statusFactura': return f.statusFactura || 'Facturado';
      case 'invoice': return f.invoice || '';
      case 'fecha': return formatearFechaSpanish(f.fecha);
      case 'proveedor': return nombreProveedorFactura_(f);
      case 'moneda': return monedaFacturaMostrar(f);
      case 'facturaCcp': return f.facturaCcp || '-';
      case 'cantOps': return f.operacionesIds?.length || 0;
      case 'referencias':
        return Array.isArray(f.operacionesGuardadas)
          ? f.operacionesGuardadas.map((op: any) => refDeOp(op)).filter(Boolean).join(', ')
          : '-';
      case 'total': return Number(f.subtotalFactura) || 0;
      case 'createdAt': return f.createdAt ? formatearFechaHora(f.createdAt) : '-';
      default: return '-';
    }
  };

  const renderCeldaFactura = (f: any, colId: string) => {
    switch (colId) {
      case 'statusFactura': return chipStatusFactura(f.statusFactura);
      case 'invoice': return <span style={{ color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace' }}>{f.invoice}</span>;
      case 'fecha': return <span style={{ color: '#c9d1d9' }}>{formatearFechaSpanish(f.fecha)}</span>;
      case 'proveedor': return <span style={{ color: '#f0f6fc' }}>{nombreProveedorFactura_(f)}</span>;
      case 'moneda': { const mon = monedaFacturaMostrar(f); return <span style={{ color: mon === 'N/A' ? '#8b949e' : '#10b981', fontWeight: 'bold' }}>{mon}</span>; }
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
                style={{ backgroundColor: '#21262d', border: '1px solid #58a6ff', color: '#58a6ff', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                {refDeOp(op)}
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
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturas_Proveedores');
    XLSX.writeFile(workbook, `Facturas_Proveedores_${new Date().toISOString().split('T')[0]}.xlsx`);
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

  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any,
  });
  const thOrdenStyle: React.CSSProperties = { padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const selectOrdenStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 10px', fontSize: '0.85rem' };
  const btnDirStyle: React.CSSProperties = { backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' };
  const dateInputStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '9px 10px', fontSize: '0.9rem', colorScheme: 'dark' };

  const segBtnStyle = (active: boolean, col: string): React.CSSProperties => ({
    padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 'bold', whiteSpace: 'nowrap',
    backgroundColor: active ? `${col}22` : 'transparent',
    color: active ? col : '#8b949e',
    borderBottom: active ? `2px solid ${col}` : '2px solid transparent',
  });

  const BuscadorProveedor = () => (
    <div style={{ flex: 1, minWidth: '280px', position: 'relative' }}>
      <label style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>PROVEEDOR (opcional)</label>
      {filtroProveedor ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', minHeight: '20px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span style={{ color: '#10b981', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreProveedorSeleccionado}</span>
          <button onClick={() => { setFiltroProveedor(''); setTextoBuscarProveedor(''); setMostrarSugerenciasProveedor(false); setSeleccionadas([]); }} title="Quitar proveedor" style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" placeholder="Buscar proveedor por nombre o RFC (opcional)..." value={textoBuscarProveedor}
            onChange={(e) => { setTextoBuscarProveedor(e.target.value); setMostrarSugerenciasProveedor(true); }}
            onFocus={() => setMostrarSugerenciasProveedor(true)} onBlur={() => setTimeout(() => setMostrarSugerenciasProveedor(false), 180)}
            style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
        </div>
      )}
      {!filtroProveedor && mostrarSugerenciasProveedor && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', maxHeight: '320px', overflowY: 'auto', zIndex: 100, marginTop: '4px', boxShadow: '0 6px 16px rgba(0,0,0,0.5)' }}>
          {proveedoresFiltradosBuscador.length === 0 ? (
            <div style={{ padding: '14px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>{textoBuscarProveedor.trim() ? 'Sin coincidencias' : 'No hay proveedores cargados'}</div>
          ) : (
            <>
              <div style={{ padding: '6px 12px', fontSize: '0.7rem', color: '#8b949e', borderBottom: '1px solid #21262d', backgroundColor: '#161b22' }}>{proveedoresFiltradosBuscador.length} {proveedoresFiltradosBuscador.length === 1 ? 'proveedor' : 'proveedores'}{textoBuscarProveedor.trim() ? '' : ' (primeros 30)'}</div>
              {proveedoresFiltradosBuscador.map((cli: any) => (
                <div key={cli.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFiltroProveedor(cli.id); setTextoBuscarProveedor(''); setMostrarSugerenciasProveedor(false); setSeleccionadas([]); }}
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

  const OPS_POR_PAGINA = 100;
  const totalPaginasOps = Math.max(1, Math.ceil(operacionesMostradas.length / OPS_POR_PAGINA));
  const paginaOpsSegura = Math.min(paginaOps, totalPaginasOps);
  const operacionesPagina = operacionesMostradas.slice((paginaOpsSegura - 1) * OPS_POR_PAGINA, paginaOpsSegura * OPS_POR_PAGINA);

  const filtrosActivos = activeTab === 'operaciones'
    ? [fechaDesdeOps, fechaHastaOps, textoBuscarRemolqueOps, filtroTipoOp, filtroProveedor].filter(Boolean).length
    : [textoBuscarFactura, fechaDesdeHist, fechaHastaHist, filtroProveedor].filter(Boolean).length;
  const limpiarFiltros = () => {
    if (activeTab === 'operaciones') { setFechaDesdeOps(''); setFechaHastaOps(''); setTextoBuscarRemolqueOps(''); setFiltroTipoOp(''); }
    else { setTextoBuscarFactura(''); setFechaDesdeHist(''); setFechaHastaHist(''); }
    setFiltroProveedor(''); setTextoBuscarProveedor('');
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Facturación de Proveedores</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Facturas</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setFiltrosAbiertos(true)} title="Mostrar filtros"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${filtrosActivos > 0 ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          Filtros
          {filtrosActivos > 0 && <span style={{ backgroundColor: '#D84315', color: '#fff', borderRadius: '10px', padding: '1px 8px', fontSize: '0.72rem' }}>{filtrosActivos}</span>}
        </button>
        {filtrosActivos > 0 && (
          <button onClick={limpiarFiltros} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar todos los filtros">✕ Limpiar filtros</button>
        )}
        {activeTab === 'operaciones' && filtroTipoOp && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'rgba(163,113,247,0.1)', border: '1px solid #a371f7', borderRadius: '14px', color: '#a371f7', fontSize: '0.8rem', fontWeight: 'bold' }}>
            {filtroTipoOp}
            <button onClick={() => setFiltroTipoOp('')} style={{ background: 'transparent', border: 'none', color: '#a371f7', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}>✕</button>
          </span>
        )}
        {filtroProveedor && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid #10b981', borderRadius: '14px', color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold' }}>
            {nombreProveedorSeleccionado}
            <button onClick={() => { setFiltroProveedor(''); setTextoBuscarProveedor(''); }} style={{ background: 'transparent', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}>✕</button>
          </span>
        )}
      </div>

      {filtrosAbiertos && (
        <div onClick={() => setFiltrosAbiertos(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1400, backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '380px', maxWidth: '92%', backgroundColor: '#0d1117', borderLeft: '1px solid #30363d', boxShadow: '-8px 0 28px rgba(0,0,0,0.5)', padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', zIndex: 1401, animation: 'fadeIn 0.15s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.05rem' }}>Filtros · {activeTab === 'operaciones' ? 'Operaciones' : 'Historial'}</h3>
              <button onClick={() => setFiltrosAbiertos(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            {activeTab === 'operaciones' ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}># REMOLQUE / REFERENCIA (opcional)</label>
                  <div style={{ position: 'relative' }}>
                    <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#58a6ff' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input type="text" placeholder="Buscar por # remolque o referencia..." value={textoBuscarRemolqueOps}
                      onChange={(e) => setTextoBuscarRemolqueOps(e.target.value)}
                      style={{ width: '100%', padding: '9px 10px 9px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                    {textoBuscarRemolqueOps && (
                      <button onClick={() => setTextoBuscarRemolqueOps('')} title="Limpiar" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '0.95rem' }}>✕</button>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ color: '#a371f7', fontSize: '0.8rem', fontWeight: 'bold' }}>TIPO DE OPERACIÓN (opcional)</label>
                  <select value={filtroTipoOp} onChange={(e) => setFiltroTipoOp(e.target.value)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: `1px solid ${filtroTipoOp ? '#a371f7' : '#30363d'}`, borderRadius: '6px', color: filtroTipoOp ? '#a371f7' : '#c9d1d9', fontSize: '0.9rem', fontWeight: filtroTipoOp ? 'bold' : 'normal', boxSizing: 'border-box' }}>
                    <option value="">Todos los tipos ({tiposOperacionDisponibles.length})</option>
                    {tiposOperacionDisponibles.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {tiposOperacionDisponibles.length === 0 && (
                    <span style={{ color: '#6e7681', fontSize: '0.72rem' }}>Carga las operaciones para ver los tipos disponibles.</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA DESDE</label>
                    <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA HASTA</label>
                    <input type="date" value={fechaHastaOps} onChange={(e) => setFechaHastaOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(fechaDesdeOps || fechaHastaOps) && (
                  <button onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }} style={{ ...btnDirStyle, color: '#8b949e', alignSelf: 'flex-start' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
                )}
                {BuscadorProveedor()}
                <div style={{ color: '#6e7681', fontSize: '0.75rem' }}>
                  Por defecto se muestran <b style={{ color: '#8b949e' }}>todas</b> las operaciones completadas. El rango de fechas y el proveedor son <b style={{ color: '#8b949e' }}>opcionales</b> para acotar.
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold' }}>BUSCAR EN HISTORIAL</label>
                  <div style={{ position: 'relative' }}>
                    <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#58a6ff' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input type="text" placeholder="Factura, proveedor, status, referencia o # remolque..." value={textoBuscarFactura} onChange={(e) => setTextoBuscarFactura(e.target.value)}
                      style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                    {textoBuscarFactura && (
                      <button onClick={() => setTextoBuscarFactura('')} title="Limpiar búsqueda" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '0.95rem' }}>✕</button>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA DESDE</label>
                    <input type="date" value={fechaDesdeHist} onChange={(e) => setFechaDesdeHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA HASTA</label>
                    <input type="date" value={fechaHastaHist} onChange={(e) => setFechaHastaHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(fechaDesdeHist || fechaHastaHist) && (
                  <button onClick={() => { setFechaDesdeHist(''); setFechaHastaHist(''); }} style={{ ...btnDirStyle, color: '#8b949e', alignSelf: 'flex-start' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
                )}
                {BuscadorProveedor()}
                <div style={{ color: '#6e7681', fontSize: '0.75rem' }}>
                  Por defecto se muestran <b style={{ color: '#8b949e' }}>todas</b> las facturas (sin filtro de fechas). Las facturas importadas sin fecha se ocultan al filtrar por fecha.
                </div>
              </>
            )}

            <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', borderTop: '1px solid #30363d', paddingTop: '14px' }}>
              <button onClick={limpiarFiltros} style={{ flex: 1, padding: '10px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Limpiar</button>
              <button onClick={() => setFiltrosAbiertos(false)} style={{ flex: 1, padding: '10px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px 20px' }}>
              <span style={{ display: 'block', color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones en espera por facturar</span>
              <span style={{ color: '#f59e0b', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenOps.porFacturar}</span>
            </div>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px 20px' }}>
              <span style={{ display: 'block', color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones ya facturadas (en historial)</span>
              <span style={{ color: '#10b981', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenOps.facturadas}</span>
            </div>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px 20px' }}>
              <span style={{ display: 'block', color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total completadas cargadas</span>
              <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenOps.total}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '6px 8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: '1px solid #30363d', borderRadius: '6px', overflow: 'hidden' }}>
              <button onClick={() => { setVistaOps('pendientes'); setSeleccionadas([]); }} style={segBtnStyle(vistaOps === 'pendientes', '#f59e0b')}>Pendientes ({resumenOps.porFacturar})</button>
              <button onClick={() => { setVistaOps('facturadas'); setSeleccionadas([]); }} style={segBtnStyle(vistaOps === 'facturadas', '#10b981')}>Facturadas ({resumenOps.facturadas})</button>
              <button onClick={() => { setVistaOps('todas'); setSeleccionadas([]); }} style={segBtnStyle(vistaOps === 'todas', '#58a6ff')}>Todas ({resumenOps.total})</button>
            </div>
            <span style={{ color: '#6e7681', fontSize: '0.78rem' }}>
              {vistaOps === 'facturadas' ? 'Solo lectura (las facturadas no se seleccionan).' : vistaOps === 'todas' ? 'Pendientes seleccionables; facturadas marcadas en verde.' : 'Operaciones listas para generar factura.'}
            </span>
          </div>

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
                {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'mostrada' : 'mostradas'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button onClick={recargarOperaciones} style={btnDirStyle} title="Volver a leer todas las operaciones desde la base de datos">↻ Recargar</button>
              <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">⚙ Configurar Columnas</button>
              <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                  cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                  backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                  color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                ⬇ Exportar Excel
              </button>
              <button disabled={seleccionadas.length === 0} onClick={abrirModalCostoAdic}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #58a6ff', backgroundColor: 'transparent', color: seleccionadas.length === 0 ? '#484f58' : '#58a6ff', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap', cursor: seleccionadas.length === 0 ? 'not-allowed' : 'pointer' }}
                title="Agregar un costo adicional al proveedor en una operación seleccionada">
                ➕ Costo adicional
              </button>
              <button disabled={seleccionadas.length === 0 || seleccionMultiProveedor} onClick={() => { setStatusFacturaForm('Facturado'); setModalAbierto(true); }}
                style={{ padding: '8px 20px', backgroundColor: (seleccionadas.length > 0 && !seleccionMultiProveedor) ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && !seleccionMultiProveedor) ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Generar Factura ({seleccionadas.length})
              </button>
            </div>
          </div>

          {topeOpsAlcanzado && (
            <div style={{ backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.85rem' }}>
              Se alcanzó el tope de <b>{LIMITE_OPS_TODAS}</b> operaciones cargadas, por lo que podría haber más que no se muestran. Usa el <b>rango de fechas</b> o el <b>proveedor</b> para acotar.
            </div>
          )}

          {seleccionMultiProveedor && (
            <div style={{ backgroundColor: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.4)', color: '#ff7b72', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.85rem' }}>
              Seleccionaste operaciones de <b>distintos proveedores</b>. Una factura debe ser de un solo proveedor: usa el filtro de proveedor o selecciona operaciones del mismo proveedor.
            </div>
          )}

          {seleccionadas.length > 0 && !seleccionMultiProveedor && (
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
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Proveedor</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{nombreProveedorFactura || '—'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Moneda</span>
                  <span style={{ color: '#D84315', fontSize: '1.8rem', fontWeight: 'bold' }}>{monedaProveedor}</span>
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>ACCIONES</th>
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
                  <tr><td colSpan={columnasOps.filter(c => c.visible).length + 2} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando todas las operaciones completadas...</td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td colSpan={columnasOps.filter(c => c.visible).length + 2} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>No hay operaciones {vistaOps === 'facturadas' ? 'facturadas' : vistaOps === 'pendientes' ? 'pendientes' : 'completadas'} con los filtros actuales{filtroProveedor ? ' para el proveedor seleccionado' : ''}.</td></tr>
                ) : (
                  operacionesPagina.map(op => {
                    const m = obtenerMontoOperacion(op);
                    const yaFacturada = esFacturada(op);
                    return (
                      <tr key={op.id} onClick={() => { if (!yaFacturada) toggleSeleccion(op.id); }}
                        style={{ cursor: yaFacturada ? 'default' : 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : (yaFacturada ? 'rgba(16,185,129,0.04)' : 'transparent') }}>
                        <td style={{ padding: '12px 16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {yaFacturada ? (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button onClick={(e) => abrirGestionOp(e, op)} title="Editar el # de factura de esta operación"
                                style={{ backgroundColor: 'transparent', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>✎ #</button>
                              <button onClick={(e) => { e.stopPropagation(); quitarOpDeFactura(op); }} title="Quitar esta operación de la factura (vuelve a Pendientes)"
                                style={{ backgroundColor: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>✕ Quitar</button>
                            </div>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); abrirCostoAdicParaOp(op.id); }} title="Agregar costo adicional a esta operación"
                              style={{ backgroundColor: 'transparent', border: '1px solid #58a6ff', color: '#58a6ff', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>＋ Costo</button>
                          )}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {yaFacturada ? (
                            <span title="Ya facturada" style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                          ) : (
                            <input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#ffffff' }} />
                          )}
                        </td>
                        {columnasOps.filter(c => c.visible).map(col => renderCeldaOps(op, col.id, m))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {totalPaginasOps > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
              <button onClick={() => setPaginaOps(p => Math.max(1, p - 1))} disabled={paginaOpsSegura === 1}
                style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaOpsSegura === 1 ? 'not-allowed' : 'pointer', color: paginaOpsSegura === 1 ? '#484f58' : '#c9d1d9' }}>Anterior</button>
              <span style={{ color: '#8b949e', fontSize: '0.85rem' }}>
                Página {paginaOpsSegura} / {totalPaginasOps} · {operacionesMostradas.length} operaciones
              </span>
              <button onClick={() => setPaginaOps(p => Math.min(totalPaginasOps, p + 1))} disabled={paginaOpsSegura === totalPaginasOps}
                style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaOpsSegura === totalPaginasOps ? 'not-allowed' : 'pointer', color: paginaOpsSegura === totalPaginasOps ? '#484f58' : '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>

      ) : (
        <div className="animation-fade-in">
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '6px 8px', flexWrap: 'wrap' }}>
            <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', paddingLeft: '4px' }}>Status:</span>
            <div style={{ display: 'flex', border: '1px solid #30363d', borderRadius: '6px', overflow: 'hidden', flexWrap: 'wrap' }}>
              {statusBotones.map(s => {
                const col = s === 'Todos' ? '#58a6ff' : colorStatusFactura(s);
                return (
                  <button key={s} onClick={() => setFiltroStatusFactura(s)} style={segBtnStyle(filtroStatusFactura === s, col)}>
                    {s} ({conteoStatus[s] ?? 0})
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
              <select value={ordenFac.campo} onChange={(e) => setOrdenFac(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
                <option value="statusFactura">Status</option>
                <option value="invoice">Factura</option>
                <option value="fecha">Fecha</option>
                <option value="proveedor">Proveedor</option>
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
              <button title="Verificar consistencia de la facturación" onClick={() => setModalDiagnostico(true)} style={{ ...btnDirStyle, borderColor: '#58a6ff', color: '#58a6ff' }}>🩺 Verificar</button>
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
                      : `No se encontraron facturas con los filtros actuales${textoBuscarFactura ? ` (búsqueda: "${textoBuscarFactura}")` : ''}${filtroStatusFactura !== 'Todos' ? ` (status: "${filtroStatusFactura}")` : ''}${filtroProveedor ? ' para el proveedor seleccionado' : ''}.`}
                  </td></tr>
                ) : (
                  registrosVisibles.map(f => (
                    <tr key={f.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button title="Ver Ficha" onClick={() => setFacturaViendo(f)} style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button title="Editar Factura" onClick={(e) => abrirEditarFactura(e, f)} style={{ background: 'transparent', border: '1px solid #f59e0b', borderRadius: '4px', color: '#f59e0b', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
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

      {modalCostoAdic && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1700, padding: '20px', backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '520px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '16px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.2rem' }}>Costo adicional al proveedor</h2>
              <button onClick={() => setModalCostoAdic(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.82rem', marginBottom: '16px' }}>
              Se suma a los <b style={{ color: '#c9d1d9' }}>Cargos Adicionales</b> del proveedor en la operación elegida y se recalcula su subtotal/conversión. Usa un monto negativo para aplicar un descuento.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>OPERACIÓN</label>
                <select value={costoAdicOpId} onChange={e => setCostoAdicOpId(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', boxSizing: 'border-box' }}>
                  <option value="">-- Selecciona una operación --</option>
                  {Array.from(new Set([costoAdicOpId, ...seleccionadas].filter(Boolean))).map(id => {
                    const o = operacionesGlobales.find(x => x.id === id);
                    const ref = o?.numReferencia || o?.referencia || o?.ref || String(id).substring(0, 6);
                    return <option key={id} value={id}>{ref}</option>;
                  })}
                </select>
              </div>
              {(() => {
                const o = operacionesGlobales.find(x => x.id === costoAdicOpId);
                if (!o) return null;
                const mm = obtenerMontoOperacion(o);
                return (
                  <div style={{ backgroundColor: '#010409', border: '1px dashed #30363d', borderRadius: '8px', padding: '12px 14px', fontSize: '0.82rem', color: '#8b949e' }}>
                    Cargos actuales: <b style={{ color: '#c9d1d9' }}>{formatoMoneda(o.cargosAdicionalesProv)}</b> · Conversión actual: <b style={{ color: '#3fb950' }}>{formatoMoneda(mm.conv)}</b>
                  </div>
                );
              })()}
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>MONTO ADICIONAL (en la moneda del convenio)</label>
                <input type="number" step="any" value={costoAdicMonto} onChange={e => setCostoAdicMonto(e.target.value)} placeholder="Ej. 150.00"
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#D84315', border: '1px solid #30363d', borderRadius: '6px', fontWeight: 'bold', fontSize: '1.05rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>CONCEPTO (opcional)</label>
                <input type="text" value={costoAdicConcepto} onChange={e => setCostoAdicConcepto(e.target.value)} placeholder="Ej. Estadía, maniobras, demora..."
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '6px', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '18px', marginTop: '20px' }}>
              <button onClick={() => setModalCostoAdic(false)} disabled={guardandoCostoAdic} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={handleGuardarCostoAdic} disabled={guardandoCostoAdic || !costoAdicOpId} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: (guardandoCostoAdic || !costoAdicOpId) ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: (guardandoCostoAdic || !costoAdicOpId) ? 0.7 : 1 }}>{guardandoCostoAdic ? 'Guardando...' : 'Agregar costo'}</button>
            </div>
          </div>
        </div>
      )}

      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '16px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Registrar Factura de Proveedor</h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d', marginBottom: '24px' }}>
              <div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Proveedor</span>
                <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{nombreProveedorFactura || getNombreEmpresa(proveedorFacturaId)}</span>
              </div>
              <div style={{ textAlign: 'center', borderLeft: '1px solid #30363d', borderRight: '1px solid #30363d', padding: '0 20px' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Moneda Proveedor</span>
                <span style={{ color: '#10b981', fontSize: '1.1rem', fontWeight: 'bold' }}>{monedaProveedor}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Conversión ({seleccionadas.length} Ops)</span>
                <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
              </div>
            </div>
            <form onSubmit={handleGuardarFactura}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>STATUS DE LA FACTURA</label>
                  <select value={statusFacturaForm} onChange={e => setStatusFacturaForm(e.target.value)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: colorStatusFactura(statusFacturaForm), border: `1px solid ${colorStatusFactura(statusFacturaForm)}`, borderRadius: '4px', fontWeight: 'bold' }}>
                    {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>N° DE FACTURA DEL PROVEEDOR</label>
                  <input type="text" required placeholder="Ej. A-1234" value={invoiceForm} onChange={e => setInvoiceForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#D84315', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold', fontSize: '1.1rem' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA DE FACTURACIÓN</label>
                  <input type="date" required value={fechaForm} onChange={e => setFechaForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>REFERENCIA (Opcional)</label>
                  <input type="text" placeholder="Referencia interna..." value={facturaCcpForm} onChange={e => setFacturaCcpForm(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
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

      {facturaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Ficha de Factura</h2>
              <button onClick={() => setFacturaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#161b22', padding: '12px 16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '20px', flexWrap: 'wrap' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Status de la factura</span>
                <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', color: colorStatusFactura(facturaViendo.statusFactura), border: `1px solid ${colorStatusFactura(facturaViendo.statusFactura)}`, backgroundColor: `${colorStatusFactura(facturaViendo.statusFactura)}1a`, whiteSpace: 'nowrap' }}>{facturaViendo.statusFactura || 'Facturado'}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#8b949e', fontSize: '0.78rem' }}>Cambiar a:</span>
                  <select value={facturaViendo.statusFactura || 'Facturado'} onChange={(e) => handleCambiarStatusFactura(facturaViendo, e.target.value)}
                    style={{ backgroundColor: '#0d1117', border: `1px solid ${colorStatusFactura(facturaViendo.statusFactura)}`, color: colorStatusFactura(facturaViendo.statusFactura), borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}>
                    {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', alignItems: 'center' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Factura Prov.</span>
                    <span style={{ color: '#D84315', fontSize: '1.4rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{facturaViendo.invoice}</span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Moneda</span>
                    <span style={{ color: '#10b981', fontSize: '1.1rem', fontWeight: 'bold' }}>{monedaFacturaMostrar(facturaViendo)}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Fecha de Facturación</span>
                    <span style={{ color: '#c9d1d9', fontSize: '1.1rem', fontWeight: 'bold' }}>{formatearFechaSpanish(facturaViendo.fecha)}</span>
                  </div>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Proveedor Facturado</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{facturaViendo.proveedorNombre || getNombreEmpresa(facturaViendo.proveedorId) || '-'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Referencia</span>
                  <span style={{ color: '#c9d1d9', fontSize: '1rem' }}>{facturaViendo.facturaCcp || '-'}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Total Facturado</span>
                  <span style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>{formatoMoneda(facturaViendo.subtotalFactura)}</span>
                </div>

                <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                <div style={{ gridColumn: 'span 3', marginTop: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>
                      Referencias / Operaciones Facturadas ({facturaViendo.operacionesGuardadas?.length || 0}) — haz clic para ver el detalle
                    </span>
                    <button
                      onClick={() => { setAgregarRefFactura(facturaViendo); setBusquedaRefPendiente(''); if (operacionesGlobales.length === 0) descargarOpsCompletadas(); }}
                      title="Agregar una operación pendiente (sin facturar) a esta factura"
                      style={{ backgroundColor: 'transparent', border: '1px solid #10b981', color: '#10b981', borderRadius: '6px', padding: '7px 14px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                      ＋ Agregar referencia
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {facturaViendo.operacionesGuardadas?.map((op: any) => (
                      <button key={op.id} onClick={() => verDetalleOperacion(op.id)} title="Ver detalle de la operación"
                        style={{ backgroundColor: '#21262d', border: '1px solid #58a6ff', padding: '8px 14px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '4px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                        onMouseEnter={(e: any) => { e.currentTarget.style.backgroundColor = '#1f2d44'; e.currentTarget.style.borderColor = '#79b8ff'; }}
                        onMouseLeave={(e: any) => { e.currentTarget.style.backgroundColor = '#21262d'; e.currentTarget.style.borderColor = '#58a6ff'; }}>
                        <span style={{ color: '#58a6ff', fontSize: '0.9rem', fontFamily: 'monospace', fontWeight: 'bold' }}>{refDeOp(op)}</span>
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

      {modalDiagnostico && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1900, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }} onClick={() => setModalDiagnostico(false)}>
          <div style={{ width: '720px', maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#f0f6fc', fontSize: '1.15rem', fontWeight: 'bold' }}>🩺 Verificación de Facturación (Proveedores)</span>
              <button onClick={() => setModalDiagnostico(false)} style={{ background: 'transparent', border: 'none', color: '#8b949e', fontSize: '1.4rem', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {cargandoFacturas && (
                <div style={{ color: '#f59e0b', fontSize: '0.85rem' }}>Cargando facturas… los números pueden cambiar al terminar.</div>
              )}
              <div>
                <div style={{ color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '10px' }}>Resumen global (facturas cargadas)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                  {[
                    { lbl: 'Facturas', val: diagnostico.totalFacturas, col: '#58a6ff' },
                    { lbl: 'Ops facturadas (únicas)', val: diagnostico.opsFacturadasUnicas, col: '#3fb950' },
                    { lbl: 'Invoices duplicados', val: diagnostico.invoicesDuplicados, col: diagnostico.invoicesDuplicados > 0 ? '#f85149' : '#3fb950' },
                  ].map((c, i) => (
                    <div key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '14px' }}>
                      <div style={{ color: '#8b949e', fontSize: '0.72rem', textTransform: 'uppercase' }}>{c.lbl}</div>
                      <div style={{ color: c.col, fontSize: '1.5rem', fontWeight: 'bold' }}>{c.val}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '10px' }}>Operaciones cargadas (pestaña “Asignar Operaciones”)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                  {[
                    { lbl: (fechaDesdeOps || fechaHastaOps) ? 'Completadas en rango' : 'Completadas (todas)', val: diagnostico.rangoTotal, col: '#c9d1d9' },
                    { lbl: 'Ya facturadas', val: diagnostico.rangoFacturadas, col: '#3fb950' },
                    { lbl: 'Por facturar', val: diagnostico.rangoPorFacturar, col: '#f59e0b' },
                  ].map((c, i) => (
                    <div key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '14px' }}>
                      <div style={{ color: '#8b949e', fontSize: '0.72rem', textTransform: 'uppercase' }}>{c.lbl}</div>
                      <div style={{ color: c.col, fontSize: '1.5rem', fontWeight: 'bold' }}>{c.val}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '10px' }}>Posibles pendientes a revisar</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.88rem' }}>
                  {[
                    { ok: diagnostico.huerfanas === 0, txt: diagnostico.huerfanas === 0 ? 'No hay operaciones marcadas como facturadas sin factura asociada.' : `${diagnostico.huerfanas} operación(es) marcadas como facturadas pero sin factura que las referencie.` },
                    { ok: diagnostico.invoicesDuplicados === 0, txt: diagnostico.invoicesDuplicados === 0 ? 'No hay invoices duplicados (mismo # y proveedor).' : `${diagnostico.invoicesDuplicados} invoice(s) aparecen duplicados (mismo # y proveedor).` },
                    { ok: diagnostico.sinMoneda === 0, txt: diagnostico.sinMoneda === 0 ? 'Todas las facturas resuelven su moneda.' : `${diagnostico.sinMoneda} factura(s) sin moneda (ni propia ni por proveedor).`, warn: true },
                    { ok: diagnostico.sinFecha === 0, txt: diagnostico.sinFecha === 0 ? 'Todas las facturas tienen fecha.' : `${diagnostico.sinFecha} factura(s) sin fecha de facturación.`, warn: true },
                    { ok: diagnostico.sinTotal === 0, txt: diagnostico.sinTotal === 0 ? 'Todas las facturas tienen total.' : `${diagnostico.sinTotal} factura(s) con total en $0 (datos importados sin monto).`, warn: true },
                    { ok: !diagnostico.topeFacturas, txt: diagnostico.topeFacturas ? `Se alcanzó el tope de ${LIMITE_FACTURAS_TODAS} facturas cargadas: podría faltar información.` : `Se cargaron todas las facturas (sin alcanzar el tope de ${LIMITE_FACTURAS_TODAS}).` },
                  ].map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', color: r.ok ? '#3fb950' : (r.warn ? '#f59e0b' : '#f85149') }}>
                      <span style={{ flexShrink: 0 }}>{r.ok ? '✓' : (r.warn ? '⚠' : '✕')}</span>
                      <span style={{ color: '#c9d1d9' }}>{r.txt}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ backgroundColor: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.3)', borderRadius: '8px', padding: '12px 14px', color: '#8b949e', fontSize: '0.8rem' }}>
                Nota: el total en $0 y la fecha vacía en facturas importadas vienen del sistema anterior. La moneda se completa con la del proveedor cuando la factura no la trae. El # de referencia (TR) y el # de remolque se resuelven al ver cada página del historial.
              </div>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => { try { sessionStorage.removeItem(SS_FACTURAS); } catch {} ; setFacturasGlobales([]); setOpInfoMap({}); setModalDiagnostico(false); }}
                style={{ ...btnDirStyle }} title="Volver a leer todas las facturas desde la base de datos">↻ Recargar facturas</button>
              <button onClick={() => setModalDiagnostico(false)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {gestionOp && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1750, padding: '20px', backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '520px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '18px', borderBottom: '1px solid #30363d', paddingBottom: '14px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.15rem' }}>Gestionar operación facturada</h2>
              <button onClick={() => setGestionOp(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ backgroundColor: '#010409', border: '1px dashed #30363d', borderRadius: '8px', padding: '12px 14px', marginBottom: '18px', fontSize: '0.85rem', color: '#8b949e' }}>
              Operación: <b style={{ color: '#58a6ff', fontFamily: 'monospace' }}>{gestionOp.numReferencia || gestionOp.referencia || gestionOp.ref || String(gestionOp.id).substring(0, 6)}</b><br />
              Factura actual: <b style={{ color: '#D84315', fontFamily: 'monospace' }}>{invoiceDeOp(gestionOp) || '—'}</b>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '6px' }}>NUEVO NÚMERO DE FACTURA</label>
              <input type="text" value={gestionInvoice} onChange={e => setGestionInvoice(e.target.value)} placeholder="Ej. A-1234"
                style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#D84315', border: '1px solid #30363d', borderRadius: '6px', fontWeight: 'bold', fontSize: '1.05rem', boxSizing: 'border-box' }} />
              <p style={{ color: '#6e7681', fontSize: '0.75rem', marginTop: '8px' }}>
                La operación se moverá a la factura con ese número (del mismo proveedor). Si no existe, se crea; si la factura original queda sin operaciones, se elimina. El Historial se actualiza solo.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '16px', flexWrap: 'wrap' }}>
              <button onClick={() => quitarOpDeFactura(gestionOp)} disabled={guardandoGestionOp}
                style={{ padding: '8px 18px', backgroundColor: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', cursor: guardandoGestionOp ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoGestionOp ? 0.7 : 1 }}>
                ✕ Quitar de la factura
              </button>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setGestionOp(null)} disabled={guardandoGestionOp} style={{ padding: '8px 18px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button onClick={() => editarInvoiceDeOp(gestionOp, gestionInvoice)} disabled={guardandoGestionOp || !gestionInvoice.trim()}
                  style={{ padding: '8px 18px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: (guardandoGestionOp || !gestionInvoice.trim()) ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: (guardandoGestionOp || !gestionInvoice.trim()) ? 0.7 : 1 }}>
                  {guardandoGestionOp ? 'Guardando...' : 'Cambiar número'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {agregarRefFactura && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1750, padding: '20px', backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid #30363d', paddingBottom: '14px' }}>
              <div>
                <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.15rem' }}>Agregar referencia a la factura</h2>
                <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>
                  Factura <b style={{ color: '#D84315', fontFamily: 'monospace' }}>{agregarRefFactura.invoice}</b> · {agregarRefFactura.proveedorNombre || getNombreEmpresa(agregarRefFactura.proveedorId) || '-'}
                </span>
              </div>
              <button onClick={() => setAgregarRefFactura(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" autoFocus placeholder="Buscar operación pendiente por referencia o # remolque..." value={busquedaRefPendiente} onChange={e => setBusquedaRefPendiente(e.target.value)}
                style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #30363d', borderRadius: '8px', backgroundColor: '#010409' }}>
              {cargandoOperaciones ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#8b949e' }}>Cargando operaciones pendientes...</div>
              ) : operacionesGlobales.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#8b949e' }}>
                  No hay operaciones cargadas.
                  <div style={{ marginTop: '12px' }}>
                    <button onClick={() => descargarOpsCompletadas(true)} style={{ ...btnDirStyle, color: '#58a6ff', margin: '0 auto' }}>↻ Cargar operaciones</button>
                  </div>
                </div>
              ) : candidatosPendientes.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#8b949e' }}>
                  No se encontraron operaciones pendientes{agregarRefFactura.proveedorId ? ' de este proveedor' : ''}{busquedaRefPendiente.trim() ? ` para "${busquedaRefPendiente}"` : ''}.
                </div>
              ) : (
                candidatosPendientes.map((op: any) => {
                  const mm = obtenerMontoOperacion(op);
                  return (
                    <div key={op.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 14px', borderBottom: '1px solid #21262d' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: '#58a6ff', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.9rem' }}>{op.numReferencia || op.referencia || op.ref || String(op.id).substring(0, 6)}</div>
                        <div style={{ color: '#8b949e', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {formatearFechaSpanish(op.fechaServicio || op.createdAt)} · {txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque)} · {formatoMoneda(mm.conv)}
                        </div>
                      </div>
                      <button onClick={() => agregarOpAFactura(agregarRefFactura, op)} disabled={agregandoRef}
                        style={{ flexShrink: 0, backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 14px', cursor: agregandoRef ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 'bold', opacity: agregandoRef ? 0.7 : 1 }}>
                        ＋ Agregar
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #30363d', paddingTop: '14px', marginTop: '14px' }}>
              <span style={{ color: '#6e7681', fontSize: '0.78rem' }}>Solo se muestran operaciones <b style={{ color: '#8b949e' }}>sin facturar</b>{agregarRefFactura.proveedorId ? ' del mismo proveedor' : ''} (máx. 50).</span>
              <button onClick={() => setAgregarRefFactura(null)} style={{ padding: '8px 20px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {facturaEditando && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1600, padding: '20px', backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '16px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.2rem' }}>Editar Factura</h2>
              <button onClick={() => setFacturaEditando(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ backgroundColor: '#010409', border: '1px dashed #30363d', borderRadius: '8px', padding: '12px 14px', marginBottom: '18px', fontSize: '0.82rem', color: '#8b949e' }}>
              Proveedor: <b style={{ color: '#c9d1d9' }}>{facturaEditando.proveedorNombre || getNombreEmpresa(facturaEditando.proveedorId) || '-'}</b>
              {Array.isArray(facturaEditando.__groupIds) && facturaEditando.__groupIds.length > 1 && (
                <span> · <b style={{ color: '#f59e0b' }}>{facturaEditando.__groupIds.length} documentos agrupados</b> (el total se asigna al primero)</span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>STATUS DE LA FACTURA</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: colorStatusFactura(editStatus), border: `1px solid ${colorStatusFactura(editStatus)}`, borderRadius: '6px', fontWeight: 'bold', boxSizing: 'border-box' }}>
                  {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  {!STATUS_FACTURA_OPCIONES.includes(editStatus) && editStatus && <option value={editStatus}>{editStatus}</option>}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>NÚMERO DE FACTURA</label>
                <input type="text" value={editInvoice} onChange={e => setEditInvoice(e.target.value)} placeholder="Ej. A-1234"
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#D84315', border: '1px solid #30363d', borderRadius: '6px', fontWeight: 'bold', fontSize: '1.05rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA DE FACTURACIÓN</label>
                <input type="date" value={editFecha} onChange={e => setEditFecha(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '6px', boxSizing: 'border-box', colorScheme: 'dark' }} />
              </div>
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>MONEDA</label>
                <select value={editMoneda} onChange={e => setEditMoneda(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#10b981', border: '1px solid #30363d', borderRadius: '6px', fontWeight: 'bold', boxSizing: 'border-box' }}>
                  <option value="">(Sin definir / del proveedor)</option>
                  <option value="USD">USD</option>
                  <option value="MXN">MXN</option>
                </select>
              </div>
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>TOTAL FACTURADO</label>
                <input type="number" step="any" value={editTotal} onChange={e => setEditTotal(e.target.value)} placeholder="0.00"
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#3fb950', border: '1px solid #30363d', borderRadius: '6px', fontWeight: 'bold', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>REFERENCIA (Opcional)</label>
                <input type="text" value={editCcp} onChange={e => setEditCcp(e.target.value)} placeholder="Referencia interna..."
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '6px', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '18px' }}>
              <button onClick={() => setFacturaEditando(null)} disabled={guardandoEdit} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={handleGuardarEdicionFactura} disabled={guardandoEdit} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: guardandoEdit ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoEdit ? 0.7 : 1 }}>{guardandoEdit ? 'Guardando...' : 'Guardar cambios'}</button>
            </div>
          </div>
        </div>
      )}

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
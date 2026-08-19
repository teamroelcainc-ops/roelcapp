// src/features/facturacion/components/FacturacionClientesDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// CAMBIOS EN ESTA VERSIÓN
// ═══════════════════════════════════════════════════════════════════════
// D) VER TODO POR DEFECTO + SEPARAR PENDIENTES/FACTURADAS + FILTRO STATUS.
// E) EXPORTACIÓN A EXCEL PROFESIONAL (ExcelJS: estilos, colores, logo).
// F) REMISIÓN EN PDF DESDE REACT (emisor por moneda: USD→Camila, MXN→Rolando)
//    con encabezado editable ("⚙ Encabezado Remisión").
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
import { SelectBuscable } from '../../catalogos/components/SelectBuscable';
import { db } from '../../../config/firebase';
import { exportarExcelProfesional } from './exportarExcelProfesional';
import { generarRemisionPDF } from './generarRemisionPDF';
import type { EmisorRemision, RemisionData } from './generarRemisionPDF';
import './FacturacionClientesDashboard.css';
import { almacenSesion } from '../../../utils/cacheMemoria';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';

// ──────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────
const ID_TIPO_CLIENTE_PAGA = '7eec9cbb';
const STATUS_COMPLETADOS = ['f557b751', 'c2d57403'];
const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// ✅ (D) Cargar TODAS las operaciones completadas (sin filtro de fecha).
const LIMITE_OPS_TODAS = 20000;
const PAG_OPS = 1000;
const SS_OPS = 'roelca_ops_completadas_v2';
const SS_OPS_TTL = 30 * 60 * 1000; // 30 min

// ✅ (A) Documento(s) de configuración de columnas COMPARTIDA en Firestore.
// ⚠️ v2: se cambió la versión para RESETEAR la configuración guardada y que
//    apliquen las nuevas columnas por defecto (# Remolque + columnas AppSheet).
const CONFIG_COLUMNAS_COLLECTION = 'config_columnas';
const DOC_COLUMNAS_OPS = 'facturacion_clientes_ops_v2';
const DOC_COLUMNAS_HISTORIAL = 'facturacion_clientes_historial_v2';

// ✅ (REMISIÓN) Documento de encabezado de remisiones (emisores) en Firestore.
//    Se guarda en la MISMA colección config_columnas para reusar sus reglas.
const DOC_REMISION_EMISORES = 'facturacion_remision_emisores';
const LS_REMISION_EMISORES = 'cfg_remision_emisores_v1';

// Emisor por defecto para remisiones en PESOS (MXN) → Rolando.
const EMISOR_MXN_DEFAULT: EmisorRemision = {
  facturaNombre: 'ROLANDO ROBERTO MONTALVO CISNEROS',
  direccion: 'MAR DE LAS ANTILLAS 947, COL. LA PAZ',
  ciudadEstado: 'NUEVO LAREDO, TAMPS | (867) 196 4690',
  email: 'COBRANZA@ROELCA.COM',
};
// Emisor por defecto para remisiones en DÓLARES (USD) → Camila.
// ⚠️ EDITA el nombre y datos reales de Camila en "⚙ Encabezado Remisión".
const EMISOR_USD_DEFAULT: EmisorRemision = {
  facturaNombre: 'CAMILA (EDITAR NOMBRE REAL)',
  direccion: 'MAR DE LAS ANTILLAS 947, COL. LA PAZ',
  ciudadEstado: 'NUEVO LAREDO, TAMPS | (867) 196 4690',
  email: 'COBRANZA@ROELCA.COM',
};

// ✅ Persistencia local (respaldo instantáneo que sobrevive al refresco).
const LS_COLS_OPS = 'cfgcols_facturacion_ops_v2';
const LS_COLS_HIST = 'cfgcols_facturacion_hist_v2';

// ✅ Lee un catálogo desde la caché local (cat_v1__<alias>).
const leerCacheLocal = (alias: string): any[] | null => {
  try {
    const raw = localStorage.getItem(`cat_v1__${alias}`) || localStorage.getItem(`cat_v2__${alias}`);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && Array.isArray(obj.data) ? obj.data : null;
  } catch { return null; }
};

// ──────────────────────────────────────────────────────────────────────
// ✅ (B) Mapa id→nombre con TODOS los catálogos cacheados. Cero lecturas.
// ──────────────────────────────────────────────────────────────────────
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

// ✅ (A) Reconstruye las columnas a partir de la BASE aplicando orden + visibilidad.
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

// ✅ (C) Opciones y colores del status de la factura.
const STATUS_FACTURA_OPCIONES = ['Facturado', 'Cancelado', 'No Facturado'];
const colorStatusFactura = (s: any): string => {
  const t = String(s || '').toLowerCase();
  if (t.includes('cancel')) return '#f85149';
  if (t.includes('no')) return '#f59e0b';
  if (t.includes('factur')) return '#10b981';
  return '#8b949e';
};

const COLUMNAS_FACTURA_BASE = [
  { id: 'statusFactura', label: 'Status',       visible: true },
  { id: 'invoice',     label: 'Invoice',      visible: true },
  { id: 'fecha',       label: 'Fecha',        visible: true },
  { id: 'remolque',    label: '# Remolque',   visible: true },
  { id: 'cliente',     label: 'Cliente',      visible: true },
  { id: 'refCliente',  label: 'Ref Cliente',  visible: true }, // ✅ NUEVO: viene de las operaciones
  { id: 'moneda',      label: 'Moneda',       visible: true },
  { id: 'facturaCcp',  label: 'Factura CCP',  visible: true },
  { id: 'cantOps',     label: 'Cant. Ops',    visible: true },
  { id: 'referencias', label: 'Referencias',  visible: true },
  { id: 'total',       label: 'Total',        visible: true },
  { id: 'createdAt',   label: 'Registrada',   visible: false },
];

const LIMITE_FACTURAS_TODAS = 12000;
const PAG_FACTURAS = 1000;
const SS_FACTURAS = 'roelca_facturas_clientes_v1';
const SS_FACTURAS_TTL = 30 * 60 * 1000; // 30 min

const parseFechaFactura = (val: any): string => {
  if (!val) return '';
  const s = String(val).trim();
  if (!s) return '';
  // ISO (YYYY-MM-DD) → tal cual
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${y}-${(m || '01').padStart(2, '0')}-${(d || '01').padStart(2, '0')}`;
  }
  // YYYY/M/D
  const mISO = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (mISO) return `${mISO[1]}-${mISO[2].padStart(2, '0')}-${mISO[3].padStart(2, '0')}`;

  // A/B/YYYY (ambiguo: D/M/YYYY vs M/D/YYYY). Se resuelve evitando fechas
  // imposibles y, si ambas son válidas, evitando fechas FUTURAS (una factura
  // no puede tener fecha posterior a hoy). Las no ambiguas (día > 12) no cambian.
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const y = m[3];
    const hoy = new Date(); hoy.setHours(23, 59, 59, 999);
    const arma = (dia: number, mes: number) => `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const valido = (dia: number, mes: number) => mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
    const esPasada = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return !isNaN(d.getTime()) && d <= hoy; };

    const dm = valido(a, b) ? arma(a, b) : ''; // A = día, B = mes  (D/M/YYYY)
    const md = valido(b, a) ? arma(b, a) : ''; // A = mes, B = día  (M/D/YYYY)

    if (dm && !md) return dm;
    if (md && !dm) return md;
    if (dm && md) {
      // Ambas válidas: preferimos D/M/YYYY, salvo que dé futuro y M/D/YYYY sí sea pasada.
      if (!esPasada(dm) && esPasada(md)) return md;
      return dm;
    }
  }
  return s;
};

const normalizarFactura = (raw: any): any => {
  const fechaNorm = parseFechaFactura(raw.fecha || raw.fechaFactura);

  // Convierte a arreglo tanto si viene como arreglo, como si viene en texto
  // separado por comas (así llegan las facturas importadas desde el CSV).
  const aArray = (v: any): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
    if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
    return [];
  };

  const opsIds = aArray(raw.operacionesIds);
  const opsRefs = aArray(raw.operaciones);

  let opsGuardadas: any = raw.operacionesGuardadas;
  if (!Array.isArray(opsGuardadas) || opsGuardadas.length === 0) {
    // Sin detalle (factura importada): combinamos IDs + referencias por posición.
    const n = Math.max(opsIds.length, opsRefs.length);
    opsGuardadas = [];
    for (let i = 0; i < n; i++) {
      opsGuardadas.push({
        id: String(opsIds[i] || opsRefs[i] || ''),
        ref: String(opsRefs[i] || opsIds[i] || ''),
        monto: 0,
        subtotalBase: 0,
      });
    }
  }
  return {
    ...raw,
    fecha: fechaNorm || String(raw.fecha || raw.fechaFactura || ''),
    operacionesIds: opsIds,
    operaciones: opsRefs,
    operacionesGuardadas: opsGuardadas,
    subtotalFactura: Number(raw.subtotalFactura) || Number(raw.total) || 0,
    monedaFacturacion: raw.monedaFacturacion || raw.moneda || 'N/A',
    monedaId: raw.monedaId || '',
    clienteNombre: raw.clienteNombre || raw.cliente || '',
    facturaCcp: raw.facturaCcp || raw.ccp || '',
    invoice: raw.invoice || raw.numeroInvoice || raw.numInvoice || raw.folio || String(raw.id || ''),
    statusFactura: raw.statusFactura || 'Facturado',
  };
};

const COLUMNAS_OPS_BASE: any[] = [
  { id: 'factura',       label: '# Factura',       visible: true,  orden: true,  grupo: 'General' },
  { id: 'ref',           label: 'Ref. Operación',  visible: true,  orden: true,  grupo: 'General' },
  { id: 'fechaServicio', label: 'Fecha Servicio',  visible: true,  orden: true,  grupo: 'General' },
  // ✅ # Remolque entre Fecha y Cliente. Si nombre y placa son el MISMO número
  //    se muestra uno solo; si son diferentes se muestran ambos con "≠".
  { id: 'remolque',      label: '# Remolque',      visible: true,  orden: true,  grupo: 'General', tipo: 'texto', sourceField: ['remolqueNombre', 'remolquePlaca', 'numeroRemolque'] },
  { id: 'cliente',       label: 'Cliente',         visible: true,  orden: true,  grupo: 'General' },
  { id: 'cartaPorte',    label: 'Carta Porte',     visible: true,  orden: false, grupo: 'General' },
  { id: 'destino',       label: 'Destino',         visible: true,  orden: true,  grupo: 'General' },
  // ✅ Columnas de facturación según AppSheet (misma lógica de monedas:
  //    USD → Dólares, MXN → Pesos, Conversión = total en MXN con el TC).
  { id: 'moneda',        label: 'Facturado en',    visible: true,  orden: false, grupo: 'Por Cobrar' },
  { id: 'montoConvenioCliente',  label: 'Convenio',           visible: true,  orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'montoConvenioCliente' },
  { id: 'cargosAdicionales',     label: 'Cargos Adicionales', visible: true,  orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'cargosAdicionales' },
  { id: 'subtotal',      label: 'Importe',         visible: true,  orden: true,  grupo: 'Por Cobrar' },
  { id: 'dolares',       label: 'Dólares',         visible: true,  orden: false, grupo: 'Por Cobrar' },
  { id: 'tipoCambioAprobado',    label: 'Tipo de Cambio',     visible: true,  orden: true,  grupo: 'Por Cobrar', tipo: 'numero', sourceField: 'tipoCambioAprobado' },
  { id: 'pesos',         label: 'Pesos',           visible: true,  orden: false, grupo: 'Por Cobrar' },
  { id: 'conv',          label: 'Conversión',      visible: true,  orden: true,  grupo: 'Por Cobrar' },
  { id: 'observacionesCobrar',   label: 'Observaciones (Costos)', visible: true, orden: false, grupo: 'Por Cobrar', tipo: 'texto', sourceField: 'observacionesCobrar' },
  { id: 'tipoOperacion',  label: 'Tipo de Operación', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['tipoOperacionNombre', 'tipoOperacionId'] },
  { id: 'status',         label: 'Status',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['statusNombre', 'status'] },
  { id: 'fechaCita',      label: 'Fecha Cita',        visible: false, orden: true,  grupo: 'General', tipo: 'fechaHora', sourceField: 'fechaCita' },
  { id: 'convenio',       label: 'Convenio (Tarifa)', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['convenioNombre', 'convenio'] },
  { id: 'refCliente',     label: 'Ref Cliente',       visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: 'refCliente' },
  { id: 'origen',         label: 'Origen',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['origenNombre', 'origen'] },
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
  { id: 'subtotalCliente',       label: 'Subtotal Cliente',        visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'subtotalCliente' },
  { id: 'dolaresCliente',        label: 'Dólares Cliente',         visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'dolaresCliente' },
  { id: 'pesosCliente',          label: 'Pesos Cliente',           visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'pesosCliente' },
  { id: 'conversionCliente',     label: 'Conversión Cliente',      visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'conversionCliente' },
  { id: 'utilidadEstimada',      label: 'Utilidad Estimada',       visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'utilidadEstimada' },
];

const calcularConversionCliente = (op: any) => {
  const fact = op.facturadoEnCobrar;
  const tc = Number(op.tipoCambioAprobado) || 0;
  const subtotal = Number(op.montoConvenioCliente || 0) + Number(op.cargosAdicionales || 0);
  let dol = 0, pes = 0, conv = 0;
  const nombreMoneda = String(op.monedaCobroNombre || '').toUpperCase();
  const factUSD = fact === ID_USD || nombreMoneda.includes('USD');
  const factMXN = fact === ID_MXN || nombreMoneda.includes('MXN');
  // ✅ REGLA DE MONEDAS (igual que el formulario de Operaciones):
  //   - Convenio USD + Factura MXN -> se muestra la CONVERSIÓN (subtotal × TC).
  //   - Convenio USD + Factura USD -> dólares tal cual.
  //   - Convenio MXN + Factura MXN -> pesos tal cual.
  //   - Convenio MXN + Factura USD -> dólares = subtotal ÷ TC.
  //   Si la operación no trae la moneda del convenio (registros viejos), se
  //   asume la de la factura (comportamiento anterior).
  const monConv = String(op.monedaConvenioCliente || '');
  const convUSD = monConv === ID_USD || (!!monConv && monConv.toUpperCase().includes('USD'));
  const convMXN = monConv === ID_MXN || (!!monConv && monConv.toUpperCase().includes('MXN'));
  const cUSD = convUSD || (!convMXN && factUSD);
  const cMXN = convMXN || (!convUSD && factMXN);
  if (cUSD && factMXN) { dol = 0; pes = subtotal * tc; conv = subtotal * tc; }
  else if (cUSD) { dol = subtotal; pes = 0; conv = subtotal * tc; }
  else if (cMXN && factUSD) { dol = tc > 0 ? subtotal / tc : 0; pes = 0; conv = subtotal; }
  else if (cMXN) { dol = 0; pes = subtotal; conv = subtotal; }
  else { conv = subtotal; }
  return { subtotal, dol, pes, conv };
};


// ✅ FIX MONEDA — TOTAL NATIVO DE LA FACTURA: el total a cobrar/pagar en la
//   MONEDA de la factura (USD -> dólares, MXN -> pesos), NO la conversión.
//   1) subtotalMonedaFactura (facturas nuevas lo guardan directo);
//   2) suma de subtotalBase de operacionesGuardadas (monto en la moneda de
//      facturación de cada operación — cubre las facturas existentes);
//   3) respaldo: subtotalFactura (conversión) para facturas sin detalle.
const totalNativoFactura = (fac: any): number => {
  const norm = (v: any): string => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const monTxt = norm(fac?.monedaFacturacion || fac?.monedaProveedor || fac?.moneda || fac?.monedaId);
  const esUSD = monTxt === '7dca62b3' || monTxt === 'usd' || monTxt === 'us$' || monTxt === 'dls' || monTxt.startsWith('dolar');
  const esMXN = monTxt === 'f95d8894' || monTxt === 'mxn' || monTxt === 'mn' || monTxt.startsWith('peso');
  const directo = Number(fac?.subtotalMonedaFactura);
  if (!isNaN(directo) && directo > 0) return directo;
  const ops = Array.isArray(fac?.operacionesGuardadas) ? fac.operacionesGuardadas : [];
  const suma = (campo: string) => ops.reduce((s: number, o: any) => s + (Number(o?.[campo]) || 0), 0);
  if (ops.length > 0) {
    if (esUSD) {
      // Factura en DÓLARES: el monto por operación en dólares; si la factura
      // es vieja y no lo trae, subtotalBase (subtotal en la escala USD).
      const dol = suma('dol');
      if (dol > 0) return dol;
      const base = suma('subtotalBase');
      if (base > 0) return base;
    } else if (esMXN) {
      // Factura en PESOS: la CONVERSIÓN es el total en pesos (cubre convenios
      // en dólares: dólares × TC, y convenios en pesos: pesos directos).
      const conv = suma('monto');
      if (conv > 0) return conv;
      const pes = suma('pes');
      if (pes > 0) return pes;
      const base = suma('subtotalBase');
      if (base > 0) return base;
    } else {
      const base = suma('subtotalBase');
      if (base > 0) return base;
    }
  }
  return Number(fac?.subtotalFactura) || Number(fac?.total) || Number(fac?.montoFactura) || 0;
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

  const [empresasList, setEmpresasList] = useState<any[]>([]);

  const [fechaDesdeOps, setFechaDesdeOps] = useState('');
  const [fechaHastaOps, setFechaHastaOps] = useState('');
  const [fechaDesdeHist, setFechaDesdeHist] = useState('');
  const [fechaHastaHist, setFechaHastaHist] = useState('');
  const [textoBuscarRemolqueOps, setTextoBuscarRemolqueOps] = useState('');
  const [vistaOps, setVistaOps] = useState<'pendientes' | 'facturadas' | 'todas'>('pendientes');
  const [topeOpsAlcanzado, setTopeOpsAlcanzado] = useState(false);
  const [filtroCliente, setFiltroCliente] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [ordenFac, setOrdenFac] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fecha', dir: 'desc' });

  const [textoBuscarCliente, setTextoBuscarCliente] = useState('');
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);

  const [textoBuscarFactura, setTextoBuscarFactura] = useState('');
  const [filtroStatusFactura, setFiltroStatusFactura] = useState<string>('Todos');
  // ✅ NUEVO: tab para separar la facturación por moneda (Todas | Dólares | Pesos).
  const [filtroMonedaHist, setFiltroMonedaHist] = useState<'todas' | 'USD' | 'MXN'>('todas');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  // ✅ NUEVO: las tablas arrancan VACÍAS; cada pestaña muestra datos hasta que
  //   se presiona "Buscar" en el panel lateral de filtros.
  const [busquedaOpsHecha, setBusquedaOpsHecha] = useState(false);
  const [busquedaHistHecha, setBusquedaHistHecha] = useState(false);
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
  const [fechaForm, setFechaForm] = useState(hoyLocalISO());
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
  const [editClienteId, setEditClienteId] = useState(''); // ✅ NUEVO: reasignar cliente

  const [gestionOp, setGestionOp] = useState<any | null>(null);
  const [gestionInvoice, setGestionInvoice] = useState('');
  const [guardandoGestionOp, setGuardandoGestionOp] = useState(false);
  const [agregarRefFactura, setAgregarRefFactura] = useState<any | null>(null);
  const [busquedaRefPendiente, setBusquedaRefPendiente] = useState('');
  const [agregandoRef, setAgregandoRef] = useState(false);

  // ✅ (REMISIÓN) Encabezados (emisores) por moneda + preview editable.
  const [emisorMXN, setEmisorMXN] = useState<EmisorRemision>(EMISOR_MXN_DEFAULT);
  const [emisorUSD, setEmisorUSD] = useState<EmisorRemision>(EMISOR_USD_DEFAULT);
  const [modalEmisores, setModalEmisores] = useState(false);
  const [guardandoEmisores, setGuardandoEmisores] = useState(false);
  const [remisionPreview, setRemisionPreview] = useState<any | null>(null);
  const [cargandoRemision, setCargandoRemision] = useState(false);

  // Formateadores
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
      // ✅ Ref Cliente: si la configuración guardada no la conocía, se inserta
      //   JUNTO a Cliente (no al final) y visible.
      const teniaRefCli = Array.isArray(guardadas) && guardadas.some((g: any) => g?.id === 'refCliente');
      if (!teniaRefCli) {
        const idxRef = cols.findIndex((c: any) => c.id === 'refCliente');
        if (idxRef >= 0) {
          const [colRef] = cols.splice(idxRef, 1);
          colRef.visible = true;
          const idxCli = cols.findIndex((c: any) => c.id === 'cliente');
          cols.splice(idxCli >= 0 ? idxCli + 1 : cols.length, 0, colRef);
        }
      }
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

  // ✅ (REMISIÓN) Cargar encabezados (emisores) desde localStorage + Firestore.
  useEffect(() => {
    try {
      const ls = localStorage.getItem(LS_REMISION_EMISORES);
      if (ls) {
        const obj = JSON.parse(ls);
        if (obj?.mxn) setEmisorMXN({ ...EMISOR_MXN_DEFAULT, ...obj.mxn });
        if (obj?.usd) setEmisorUSD({ ...EMISOR_USD_DEFAULT, ...obj.usd });
      }
    } catch { /* noop */ }
    let activo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_REMISION_EMISORES));
        if (!activo || !snap.exists()) return;
        const data = snap.data() as any;
        if (data?.mxn) setEmisorMXN({ ...EMISOR_MXN_DEFAULT, ...data.mxn });
        if (data?.usd) setEmisorUSD({ ...EMISOR_USD_DEFAULT, ...data.usd });
        try { localStorage.setItem(LS_REMISION_EMISORES, JSON.stringify({ mxn: data?.mxn, usd: data?.usd })); } catch { /* noop */ }
      } catch (e) { console.error('Error cargando encabezados de remisión:', e); }
    })();
    return () => { activo = false; };
  }, []);

  const guardarEmisores = async () => {
    setGuardandoEmisores(true);
    try {
      const payload = { mxn: emisorMXN, usd: emisorUSD, updatedAt: new Date().toISOString() };
      try { localStorage.setItem(LS_REMISION_EMISORES, JSON.stringify({ mxn: emisorMXN, usd: emisorUSD })); } catch { /* noop */ }
      await setDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_REMISION_EMISORES), payload);
      setModalEmisores(false);
    } catch (e) {
      console.error('Error guardando encabezados de remisión:', e);
      alert('No se pudo guardar el encabezado de remisiones para todos los usuarios.\nRevisa tus permisos de escritura en Firestore (colección config_columnas).');
    } finally {
      setGuardandoEmisores(false);
    }
  };

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
    try { almacenSesion.setItem(SS_FACTURAS, JSON.stringify({ ts: Date.now(), data: docs })); } catch { /* cuota */ }
  };

  // Descarga TODAS las facturas desde Firestore (reutilizable por el botón Refrescar).
  const descargarFacturas = async () => {
    setCargandoFacturas(true);
    try {
      const todas: any[] = [];
      let cursor: any = null;
      for (let i = 0; i < Math.ceil(LIMITE_FACTURAS_TODAS / PAG_FACTURAS); i++) {
        const cons: any[] = [orderBy(documentId()), limit(PAG_FACTURAS)];
        if (cursor) cons.splice(1, 0, startAfter(cursor));
        const snap = await getDocs(query(collection(db, 'facturas_clientes'), ...cons));
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
      console.error('[Facturación Historial] Error al recargar facturas:', e);
      alert('No se pudieron recargar las facturas. ' + String(e?.message || e?.code || e || ''));
    }
    setCargandoFacturas(false);
  };

  // Fuerza el refresco de la colección de facturas: limpia la caché y vuelve a leer.
  const recargarFacturas = () => {
    try { almacenSesion.removeItem(SS_FACTURAS); } catch { /* noop */ }
    descargarFacturas();
  };

  useEffect(() => {
    if (facturasGlobales.length > 0) return;
    try {
      const raw = almacenSesion.getItem(SS_FACTURAS);
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
          const snap = await getDocs(query(collection(db, 'facturas_clientes'), ...cons));
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
    try { almacenSesion.setItem(SS_OPS, JSON.stringify({ ts: Date.now(), data: docs })); } catch { /* cuota */ }
  };

  const descargarOpsCompletadas = async (forzar = false) => {
    if (!forzar && operacionesGlobales.length > 0) return;
    if (!forzar) {
      try {
        const raw = almacenSesion.getItem(SS_OPS);
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
    try { almacenSesion.removeItem(SS_OPS); } catch { /* noop */ }
    setSeleccionadas([]);
    descargarOpsCompletadas(true);
  };

  // Refresca AMBAS colecciones (operaciones + facturas) forzando lectura desde Firestore.
  const recargarTodo = () => {
    recargarOperaciones();
    recargarFacturas();
  };

  const getNombreCliente = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = empresasList.find(e => e.id === idOrName || e.nombre === idOrName || e.nombreCorto === idOrName);
    if (found) return found.nombre || found.nombreCorto || idOrName;
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

  const opIndex = useMemo(() => {
    const m = new Map<string, { invoice: string; facturaId: string; fecha: string; clienteId: string; moneda: string }>();
    facturasGlobales.forEach((f: any) => {
      const ids = Array.isArray(f.operacionesIds) ? f.operacionesIds : [];
      ids.forEach((id: any) => {
        const k = String(id || '');
        if (k && !m.has(k)) m.set(k, { invoice: f.invoice, facturaId: f.id, fecha: f.fecha, clienteId: f.clienteId, moneda: f.monedaFacturacion });
      });
    });
    return m;
  }, [facturasGlobales]);

  const monedaDeCliente = (clienteId: any): string => {
    if (!clienteId) return '';
    const empresa = empresasList.find(e => e.id === clienteId);
    const idMoneda = empresa?.monedaRef || empresa?.moneda || empresa?.monedaFacturacion;
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
    const propia = resolverMoneda(f.monedaFacturacion);
    if (propia) return propia;
    return monedaDeCliente(f.clienteId) || 'N/A';
  };

  const esFacturada = (op: any) => opIndex.has(String(op.id)) || !!op.facturaClienteId || !!op.facturado;
  const invoiceDeOp = (op: any): string => op.facturaClienteInvoice || opIndex.get(String(op.id))?.invoice || '';

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

  // ──────────────────────────────────────────────────────────────────
  // ✅ (# REMOLQUE) El valor del remolque CONCATENA el # de caja con la
  //    placa (p. ej. "PLT.51 187-WN7"). Solo interesa el # de CAJA, que es
  //    el PRIMER token. Si una factura tiene varias operaciones con cajas
  //    DIFERENTES, se muestran todas con un indicador "≠".
  // ──────────────────────────────────────────────────────────────────
  const cajaDeTexto = (valor: any): string => {
    const r = resolverNombre(valor);
    const tokens = String(r ?? '')
      .split(/[\s,|]+/)
      .map(t => t.trim())
      .filter(t => t && t !== '-' && /[A-Za-z0-9]/.test(t));
    return tokens[0] || '';
  };

  // # de caja de una OPERACIÓN (primer campo con valor: nombre → placa → número).
  const remolqueOpTokens = (op: any): string[] => {
    const cands = [op?.remolqueNombre, op?.remolquePlaca, op?.numeroRemolque, op?.remolque];
    for (const c of cands) {
      if (c !== undefined && c !== null && c !== '') {
        const caja = cajaDeTexto(c);
        if (caja) return [caja];
      }
    }
    return [];
  };

  // ✅ Número de caja (# remolque) de una operación de la factura: usa el valor
  //    guardado en el resumen y, si falta (facturas viejas), cae al opInfoMap
  //    que se resuelve bajo demanda.
  const remolqueDeOp = (op: any): string => {
    const directo = String(op?.remolque || '').trim();
    if (directo && directo !== '-') return directo;
    const info = opInfoMap[String(op?.id || '')];
    const resuelto = String(info?.remolque || '').trim();
    return resuelto && resuelto !== '-' ? resuelto : '';
  };

  // # de caja de una FACTURA: una caja por operación, sin repetir.
  const remolquesFacturaTokens = (f: any): string[] => {
    const cajas: string[] = [];
    const vistos = new Set<string>();
    const agregar = (valor: any) => {
      const caja = cajaDeTexto(valor);
      if (!caja) return;
      const k = caja.toUpperCase();
      if (!vistos.has(k)) { vistos.add(k); cajas.push(caja); }
    };
    (Array.isArray(f?.operacionesGuardadas) ? f.operacionesGuardadas : []).forEach((op: any) => agregar(remolqueDeOp(op)));
    if (cajas.length === 0 && Array.isArray(f?.remolques)) f.remolques.forEach((r: any) => agregar(r));
    return cajas;
  };

  // Render compartido: 1 caja → una sola; varias (ops con cajas distintas) → todas + "≠".
  const renderRemolqueTokens = (tokens: string[]) => {
    if (tokens.length === 0) return <span className="fcd-x1">-</span>;
    if (tokens.length === 1) return <span className="fcd-x2">{tokens[0]}</span>;
    return (
      <span className="fcd-x3" title="Las operaciones de esta factura tienen números de caja diferentes">
        <span className="fcd-x2">{tokens.join(' / ')}</span>
        <span className="fcd-x4">≠</span>
      </span>
    );
  };
  // Texto plano para exportar a Excel.
  const remolqueTokensTexto = (tokens: string[]): string =>
    tokens.length === 0 ? '' : (tokens.length === 1 ? tokens[0] : `${tokens.join(' / ')} (≠)`);

  const fechaOrdenKey = (val: any): string => {    const s = String(val || '').trim();
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
      case 'factura': return String(op.facturaClienteInvoice || '').toLowerCase();
      case 'ref': return refNaturalKey(op);
      case 'fechaServicio': return fechaOrdenKey(op.fechaServicio || op.createdAt);
      case 'remolque': return remolqueOpTokens(op).join(' ').toLowerCase();
      case 'cliente': return getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId).toLowerCase();
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

  const coincideClienteOp = (op: any) => !filtroCliente || String(op.clientePaga || op.clienteId || '') === filtroCliente;

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
        op.clienteNombre, op.proveedorUnidadNombre, op.origenNombre, op.destinoNombre,
        op.observacionesEjecutivo,
      ];
      return campos.some(v => String(v ?? '').toLowerCase().includes(q));
    };
    const coincideVista = (op: any) => {
      if (vistaOps === 'todas') return true;
      if (vistaOps === 'facturadas') return esFacturada(op);
      return !esFacturada(op);
    };
    const lista = operacionesGlobales.filter(op =>
      dentroRangoFecha(op) && coincideClienteOp(op) && coincideTipoOp(op) && coincideVista(op) && coincide(op)
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
  }, [operacionesGlobales, ordenOps, empresasList, fechaDesdeOps, fechaHastaOps, columnasOps, mapaCatalogos, vistaOps, textoBuscarRemolqueOps, facturasGlobales, filtroCliente, filtroTipoOp]);

  const resumenOps = useMemo(() => {
    const enRango = operacionesGlobales.filter(op => dentroRangoFecha(op) && coincideClienteOp(op) && coincideTipoOp(op));
    const facturadas = enRango.filter(op => esFacturada(op)).length;
    const total = enRango.length;
    const porFacturar = total - facturadas;
    return { porFacturar, facturadas, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, fechaDesdeOps, fechaHastaOps, facturasGlobales, filtroCliente, filtroTipoOp]);

  const diagnostico = useMemo(() => {
    const totalFacturas = facturasGlobales.length;
    const opsFacturadasUnicas = opIndex.size;
    const porClave = new Map<string, number>();
    facturasGlobales.forEach((f: any) => {
      const k = `${String(f.invoice || '').trim().toLowerCase()}__${String(f.clienteId || '')}`;
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
    const huerfanas = enRango.filter(op => (op.facturado || op.facturaClienteId) && !opIndex.has(String(op.id))).length;
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

  const renderCeldaOps = (op: any, key: string, m: any) => {
    const tdBase: React.CSSProperties = { padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' };
    switch (key) {
      case 'factura': {
        const inv = invoiceDeOp(op);
        if (inv) return <td className="fcd-x5" key={key}><span className="fcd-x6">{inv}</span></td>;
        return <td className="fcd-x5" key={key}><span className="fcd-x7">Por facturar</span></td>;
      }
      case 'ref': return <td className="fcd-x8" key={key}>{op.numReferencia || op.referencia || op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'remolque': return <td key={key} style={tdBase}>{renderRemolqueTokens(remolqueOpTokens(op))}</td>;
      case 'cliente': return <td key={key} style={tdBase}>{getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId)}</td>;
      case 'cartaPorte': return <td key={key} style={tdBase}>{op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destinoNombre || op.destino || '-'}</td>;
      case 'moneda': return <td key={key} style={tdBase}>{op.monedaCobroNombre || mostrarMoneda(op.facturadoEnCobrar)}</td>;
      case 'subtotal': return <td key={key} style={tdBase}>{formatoMoneda(m.subtotal)}</td>;
      case 'dolares': return <td key={key} style={{ ...tdBase, color: '#10b981' }}>{formatoMoneda(m.dol)}</td>;
      case 'pesos': return <td key={key} style={{ ...tdBase, color: '#3b82f6' }}>{formatoMoneda(m.pes)}</td>;
      case 'conv': return <td className="fcd-x9" key={key}>{formatoMoneda(m.conv)}</td>;
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

  // ✅ (E) Exportación PROFESIONAL a Excel (ExcelJS con estilos + logo).
  const exportarExcelOps = async () => {
    if (operacionesMostradas.length === 0) return alert('No hay operaciones para exportar con los filtros actuales.');
    const cols = columnasOps.filter(c => c.visible);
    if (cols.length === 0) return alert('Selecciona al menos una columna para exportar.');

    const tipoExcel = (c: any): 'texto' | 'fecha' | 'fechaHora' | 'monto' | 'numero' => {
      if (['subtotal', 'dolares', 'pesos', 'conv'].includes(c.id)) return 'monto';
      if (c.id === 'fechaServicio') return 'fecha';
      if (c.tipo === 'monto') return 'monto';
      if (c.tipo === 'numero') return 'numero';
      if (c.tipo === 'fecha') return 'fecha';
      if (c.tipo === 'fechaHora') return 'fechaHora';
      return 'texto';
    };
    const columnas = cols.map(c => ({ key: c.id, label: c.label, tipo: tipoExcel(c) }));

    const valorRaw = (op: any, key: string, m: any): any => {
      switch (key) {
        case 'factura': { const inv = invoiceDeOp(op); return inv || (esFacturada(op) ? 'Facturada' : 'Por facturar'); }
        case 'ref': return op.numReferencia || op.referencia || op.ref || op.id;
        case 'fechaServicio': return op.fechaServicio || op.createdAt || '';
        case 'remolque': return remolqueTokensTexto(remolqueOpTokens(op));
        case 'cliente': return getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId);
        case 'cartaPorte': return op.cartaPorte || op.numeroCartaPorte || op.numDoda || '';
        case 'destino': return op.destinoNombre || op.destino || '';
        case 'moneda': return op.monedaCobroNombre || mostrarMoneda(op.facturadoEnCobrar);
        case 'subtotal': return Number(m.subtotal) || 0;
        case 'dolares': return Number(m.dol) || 0;
        case 'pesos': return Number(m.pes) || 0;
        case 'conv': return Number(m.conv) || 0;
        default: {
          const col = columnasOps.find(c => c.id === key);
          const raw = valorGenericoOp(op, col);
          if (col?.tipo === 'monto' || col?.tipo === 'numero') return Number(raw) || 0;
          if (col?.tipo === 'fecha' || col?.tipo === 'fechaHora') return raw || '';
          return String(resolverNombre(raw) ?? '');
        }
      }
    };

    const filas = operacionesMostradas.map(op => {
      const m = obtenerMontoOperacion(op);
      const fila: any = {};
      cols.forEach(c => { fila[c.id] = valorRaw(op, c.id, m); });
      return fila;
    });

    const cliTxt = filtroCliente ? (nombreClienteSeleccionado || 'Cliente') : 'Todos los clientes';
    const rangoTxt = (fechaDesdeOps || fechaHastaOps) ? `${fechaDesdeOps || 'inicio'} a ${fechaHastaOps || 'hoy'}` : 'Todas las fechas';
    const vistaTxt = vistaOps === 'facturadas' ? 'Facturadas' : vistaOps === 'todas' ? 'Todas' : 'Pendientes';
    const cliFile = cliTxt.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);

    try {
      await exportarExcelProfesional({
        nombreArchivo: `Facturacion_Operaciones_${vistaTxt}_${cliFile}_${hoyLocalISO()}.xlsx`,
        tituloReporte: 'Reporte de Facturación · Operaciones',
        subtitulo: `${vistaTxt}  ·  Cliente: ${cliTxt}  ·  ${rangoTxt}  ·  ${filas.length} operaciones`,
        nombreHoja: 'Operaciones',
        columnas,
        filas,
      });
    } catch (e) {
      console.error('Error exportando Excel de operaciones:', e);
      alert('No se pudo generar el Excel.');
    }
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
      const nuevoCargos = (Number(op.cargosAdicionales) || 0) + monto;
      const { subtotal, dol, pes, conv } = calcularConversionCliente({ ...op, cargosAdicionales: nuevoCargos });
      const concepto = costoAdicConcepto.trim();
      const updates: any = {
        cargosAdicionales: nuevoCargos,
        subtotalCliente: subtotal,
        dolaresCliente: dol,
        pesosCliente: pes,
        conversionCliente: conv,
      };
      if (concepto) {
        const obsPrev = String(op.observacionesCobrar || '').trim();
        updates.observacionesCobrar = `${obsPrev ? obsPrev + ' | ' : ''}Costo adicional: ${concepto} (${monto >= 0 ? '+' : ''}${monto})`;
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
          dol: montos.dol,   // ✅ FIX MONEDA
          pes: montos.pes,   // ✅ FIX MONEDA
          convenioNombre: String((op?.convenioNombre || op?.convenioClienteNombre) || ''), // ✅ NUEVO: convenio revisable
          refCliente: String(op?.refCliente || ''), // ✅ NUEVO: Ref Cliente en el historial
          remolque: op ? txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque) : '',
        };
      });
      // ✅ FIX MONEDA: total en la moneda de la factura (no la conversión).
      // ✅ FIX: el total en la moneda de la factura depende de EN QUÉ se
      //   factura, no de la moneda del convenio: USD -> suma de dólares;
      //   MXN -> suma de la conversión (dólares × TC + pesos directos).
      const subtotalMonedaFactura = totalNativoFactura({
        monedaFacturacion,
        operacionesGuardadas: operacionesResumenEstable,
      });
      const remolquesFactura = Array.from(new Set(
        operacionesResumenEstable.map((o: any) => String(o.remolque || '')).filter(r => r && r !== '-')
      ));
      // Moneda para el esquema de facturación: ID + nombre legible.
      const monedaIdFactura = monedaFacturacion === 'MXN' ? ID_MXN : (monedaFacturacion === 'USD' ? ID_USD : '');
      const operacionesRefs = operacionesResumenEstable.map((o: any) => o.ref).filter(Boolean);

      const data = {
        invoice: invoiceForm.trim(),
        fecha: fechaForm,
        facturaCcp: facturaCcpForm.trim(),
        statusFactura: statusFacturaForm,
        clienteId: clienteFacturaId,
        clienteNombre: nombreClienteFactura || getNombreCliente(clienteFacturaId),
        monedaFacturacion,
        monedaId: monedaIdFactura,                 // ← campo de la colección
        operacionesIds: seleccionadas,
        operaciones: operacionesRefs,              // ← campo de la colección (refs)
        operacionesGuardadas: operacionesResumenEstable,
        remolques: remolquesFactura,
        subtotalFactura: resumenSeleccion.subtotal,
        subtotalMonedaFactura, // ✅ FIX MONEDA: lo que se cobra en la moneda de la factura
        createdAt: new Date().toISOString(),
      };
      const invKey = invoiceForm.trim().toLowerCase();
      const existente = facturasGlobales.find(f =>
        String(f.invoice || '').trim().toLowerCase() === invKey &&
        String(f.clienteId || '') === String(clienteFacturaId)
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
          clienteId: clienteFacturaId,
          clienteNombre: existente.clienteNombre || data.clienteNombre,
          monedaFacturacion: existente.monedaFacturacion || monedaFacturacion,
          monedaId: existente.monedaId || monedaIdFactura,
          operacionesIds: idsUnion,
          operaciones: guardadasUnion.map((o: any) => o.ref).filter(Boolean),
          operacionesGuardadas: guardadasUnion,
          remolques: remolquesUnion,
          subtotalFactura: subtotalUnion,
          updatedAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'facturas_clientes', docId), merge, { merge: true });
        facturaResultante = { ...existente, ...merge };
      } else {
        batch.set(doc(db, 'facturas_clientes', docId), data);
      }
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), {
          facturaClienteId: docId,
          facturaClienteInvoice: invoiceForm.trim(),
          facturado: true,
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
        idsFacturadas.includes(op.id) ? { ...op, facturaClienteId: docId, facturaClienteInvoice: invoiceTrim, facturado: true } : op
      ));
      setFacturasGlobales(prev => {
        if (existente) {
          return prev.map(f => f.id === docId ? normalizarFactura({ ...facturaResultante, id: docId }) : f);
        }
        return [normalizarFactura({ ...data, id: docId }), ...prev];
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
      ids.forEach(id => batch.set(doc(db, 'facturas_clientes', id), { statusFactura: nuevoStatus }, { merge: true }));
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
    setEditMoneda(resolverMoneda(f.monedaFacturacion) || '');
    setEditTotal(String(Number(f.subtotalFactura) || 0));
    setEditClienteId(String(f.clienteId || '')); // ✅ NUEVO
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
        monedaFacturacion: editMoneda || 'N/A',
        updatedAt: new Date().toISOString(),
      };
      // ✅ NUEVO — REASIGNAR CLIENTE: corrige facturas que quedaron a nombre
      //   de otro cliente (el nombre corregido se refleja también en Pagos,
      //   que lee clienteId/clienteNombre de la factura).
      if (editClienteId) {
        const cli: any = empresasList.find((e: any) => e.id === editClienteId);
        if (cli) { baseUpdate.clienteId = editClienteId; baseUpdate.clienteNombre = String(cli.nombre || ''); }
      }
      // ✅ FIX IMPORTE EDITADO: el total capturado se escribe TAMBIÉN en
      //   subtotalMonedaFactura (el campo que la tabla, las tarjetas y Pagos
      //   leen primero) — antes solo se escribía subtotalFactura y por eso
      //   "seguía arrojando el que tenía". Además se recalcula el saldo
      //   pendiente respetando lo ya pagado.
      const pagadoActual = Number(facturaEditando.montoPagado) || 0;
      const saldoNuevo = Math.max(0, totalNum - pagadoActual);
      const extraPago: any = { saldoPendiente: saldoNuevo };
      if (pagadoActual > 0.009) extraPago.statusPago = saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL';

      const batch = writeBatch(db);
      ids.forEach((id, idx) => {
        batch.set(doc(db, 'facturas_clientes', id), {
          ...baseUpdate,
          subtotalFactura: idx === 0 ? totalNum : 0,
          subtotalMonedaFactura: idx === 0 ? totalNum : 0, // ✅ FIX: el campo que se muestra
          ...(idx === 0 ? extraPago : {}),
        }, { merge: true });
      });
      await batch.commit();
      setFacturasGlobales(prev => prev.map(f => {
        if (!ids.includes(f.id)) return f;
        const esPrimero = f.id === ids[0];
        return normalizarFactura({ ...f, ...baseUpdate, subtotalFactura: esPrimero ? totalNum : 0, subtotalMonedaFactura: esPrimero ? totalNum : 0, ...(esPrimero ? extraPago : {}) });
      }));
      setFacturaViendo((prev: any) => (prev && ids.includes(prev.id)) ? { ...prev, ...baseUpdate, subtotalFactura: totalNum, subtotalMonedaFactura: totalNum, ...extraPago } : prev);
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
      refCliente: String(op.refCliente || ''), // ✅ NUEVO
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
          batch.delete(doc(db, 'facturas_clientes', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
        } else {
          const data = { operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), subtotalFactura: subtotal, updatedAt: new Date().toISOString() };
          batch.set(doc(db, 'facturas_clientes', f.id), data, { merge: true });
          cambios.push({ tipo: 'update', id: f.id, data });
        }
      }
      batch.update(doc(db, 'operaciones', opId), { facturaClienteId: null, facturaClienteInvoice: null, facturado: false });
      await batch.commit();
      aplicarCambiosFacturas(cambios);
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaClienteId: null, facturaClienteInvoice: null, facturado: false } : o));
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
    const clienteId = String(op.clientePaga || op.clienteId || '');
    const facturasConOp = facturasGlobales.filter(f => (f.operacionesIds || []).map(String).includes(opId));
    setGuardandoGestionOp(true);
    try {
      const batch = writeBatch(db);
      const cambios: any[] = [];

      let resumenOrigen: any = null;
      let metaCarry: any = null;
      for (const f of facturasConOp) {
        if (!metaCarry) metaCarry = { statusFactura: f.statusFactura, monedaFacturacion: f.monedaFacturacion, facturaCcp: f.facturaCcp, fecha: f.fecha, clienteNombre: f.clienteNombre };
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
          batch.delete(doc(db, 'facturas_clientes', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
        } else {
          const data = { operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), subtotalFactura: subtotal, updatedAt: new Date().toISOString() };
          batch.set(doc(db, 'facturas_clientes', f.id), data, { merge: true });
          cambios.push({ tipo: 'update', id: f.id, data });
        }
      }

      const target = facturasGlobales.find(f =>
        String(f.invoice || '').trim().toLowerCase() === nuevoInvoice.toLowerCase() &&
        String(f.clienteId || '') === clienteId &&
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
        batch.set(doc(db, 'facturas_clientes', targetId), data, { merge: true });
        cambios.push({ tipo: 'update', id: targetId, data });
      } else {
        targetId = doc(collection(db, 'facturas_clientes')).id;
        const data: any = {
          invoice: nuevoInvoice,
          fecha: metaCarry?.fecha || '',
          facturaCcp: metaCarry?.facturaCcp || '',
          statusFactura: metaCarry?.statusFactura || 'Facturado',
          clienteId,
          clienteNombre: metaCarry?.clienteNombre || getNombreCliente(clienteId),
          monedaFacturacion: metaCarry?.monedaFacturacion || 'N/A',
          operacionesIds: [opId],
          operacionesGuardadas: [resumenOrigen],
          remolques: remolquesDeGuardadas([resumenOrigen]),
          subtotalFactura: montoOp,
          createdAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'facturas_clientes', targetId), data);
        cambios.push({ tipo: 'create', id: targetId, data });
      }

      batch.update(doc(db, 'operaciones', opId), { facturaClienteId: targetId, facturaClienteInvoice: nuevoInvoice, facturado: true });
      await batch.commit();
      aplicarCambiosFacturas(cambios);
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaClienteId: targetId, facturaClienteInvoice: nuevoInvoice, facturado: true } : o));
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
      batch.set(doc(db, 'facturas_clientes', rawId), data, { merge: true });
      batch.update(doc(db, 'operaciones', opId), { facturaClienteId: rawId, facturaClienteInvoice: rawDoc.invoice || facturaGrupo.invoice, facturado: true });
      await batch.commit();
      setFacturasGlobales(prev => prev.map(f => f.id === rawId ? normalizarFactura({ ...f, ...data }) : f));
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaClienteId: rawId, facturaClienteInvoice: rawDoc.invoice || facturaGrupo.invoice, facturado: true } : o));
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
    const clienteId = String(agregarRefFactura.clienteId || '');
    const q = busquedaRefPendiente.trim().toLowerCase();
    const lista = operacionesGlobales.filter(op => {
      if (esFacturada(op)) return false;
      if (clienteId && String(op.clientePaga || op.clienteId || '') !== clienteId) return false;
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
        ids.forEach(fid => batch.delete(doc(db, 'facturas_clientes', fid)));
        const docs: any[] = Array.isArray(facData.__groupDocs) && facData.__groupDocs.length ? facData.__groupDocs : [facData];
        docs.forEach((d: any) => {
          if (Array.isArray(d.operacionesIds)) {
            d.operacionesIds.forEach((opId: string) => {
              idsLiberadas.push(opId);
              batch.update(doc(db, 'operaciones', opId), {
                facturaClienteId: null,
                facturaClienteInvoice: null,
                facturado: false,
              });
            });
          }
        });
        await batch.commit();
        setFacturasGlobales(prev => prev.filter(f => !ids.includes(f.id)));
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, facturaClienteId: null, facturaClienteInvoice: null, facturado: false } : op
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
      case 'remolque': return remolquesFacturaTokens(f).join(' ').toLowerCase();
      case 'cliente': return String(f.clienteNombre || '').toLowerCase();
      case 'refCliente': return refClienteDeFactura(f).toLowerCase();
      case 'moneda': return String(f.monedaFacturacion || '').toLowerCase();
      case 'cantOps': return Number(f.operacionesIds?.length || 0);
      case 'total': return totalNativoFactura(f); // ✅ FIX MONEDA
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
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.clienteId) { const nom = getNombreCliente(f.clienteId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaFacturacion || '').toLowerCase().includes(q)) return true;
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
    const coincideCliente = (f: any) => !filtroCliente || String(f.clienteId || '') === filtroCliente;
    const coincideMoneda = (f: any) => filtroMonedaHist === 'todas' || monedaFacturaMostrar(f).toUpperCase() === filtroMonedaHist;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = String(f.fecha || '').slice(0, 10);
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const filtradas = facturasGlobales.filter(f => coincideTexto(f) && coincideCliente(f) && coincideMoneda(f) && coincideFechas(f));
    const grupos = new Map<string, any>();
    for (const f of filtradas) {
      const key = `${String(f.invoice || f.id).trim().toLowerCase()}__${String(f.clienteId || '')}`;
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
  }, [facturasGlobales, ordenFac, textoBuscarFactura, filtroCliente, fechaDesdeHist, fechaHastaHist, opInfoMap, filtroStatusFactura, filtroMonedaHist]);

  const resumenHistorial = useMemo(() => {
    let totalUSD = 0, totalMXN = 0, totalSinMoneda = 0, totalOps = 0;
    historialOrdenado.forEach(f => {
      const monto = totalNativoFactura(f); // ✅ FIX MONEDA: suma en la moneda de la factura
      // ✅ FIX: la moneda puede venir como nombre de catálogo ("Dólares",
      //   "Pesos") y las tarjetas comparaban contra 'USD'/'MXN' exactos, por
      //   lo que TOTAL FACTURADO marcaba $0.00. Se normaliza antes de sumar.
      const monTxt = monedaFacturaMostrar(f).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      const mon = (monTxt === 'USD' || monTxt.startsWith('DOLAR') || monTxt === 'DLS' || monTxt === 'US$') ? 'USD'
        : (monTxt === 'MXN' || monTxt.startsWith('PESO') || monTxt === 'MN') ? 'MXN' : monTxt;
      if (mon === 'USD') totalUSD += monto;
      else if (mon === 'MXN') totalMXN += monto;
      else totalSinMoneda += monto;
      totalOps += Array.isArray(f.operacionesIds) ? f.operacionesIds.length : 0;
    });
    return { cuenta: historialOrdenado.length, totalUSD, totalMXN, totalSinMoneda, totalOps };
  }, [historialOrdenado]);

  const conteoStatus = useMemo(() => {
    const q = textoBuscarFactura.trim().toLowerCase();
    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.clienteNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.clienteId) { const nom = getNombreCliente(f.clienteId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaFacturacion || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(f.remolques) && f.remolques.some((r: any) => String(r || '').toLowerCase().includes(q))) return true;
      return false;
    };
    const coincideCliente = (f: any) => !filtroCliente || String(f.clienteId || '') === filtroCliente;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = String(f.fecha || '').slice(0, 10);
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const coincideMoneda = (f: any) => filtroMonedaHist === 'todas' || monedaFacturaMostrar(f).toUpperCase() === filtroMonedaHist;
    const base = facturasGlobales.filter(f => coincideTexto(f) && coincideCliente(f) && coincideMoneda(f) && coincideFechas(f));
    const c = { Todos: base.length } as Record<string, number>;
    base.forEach((f: any) => {
      const s = (String(f.statusFactura || 'Facturado').trim()) || 'Facturado';
      c[s] = (c[s] || 0) + 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, textoBuscarFactura, filtroCliente, fechaDesdeHist, fechaHastaHist, filtroMonedaHist]);

  // ✅ Conteo de facturas por moneda (para el tab Todas | Dólares | Pesos del filtro).
  //    Respeta texto, cliente, fechas y status, pero NO el propio filtro de moneda.
  const conteoMonedaHist = useMemo(() => {
    const q = textoBuscarFactura.trim().toLowerCase();
    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.clienteNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.clienteId) { const nom = getNombreCliente(f.clienteId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaFacturacion || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(f.remolques) && f.remolques.some((r: any) => String(r || '').toLowerCase().includes(q))) return true;
      return false;
    };
    const coincideCliente = (f: any) => !filtroCliente || String(f.clienteId || '') === filtroCliente;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = String(f.fecha || '').slice(0, 10);
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const coincideStatus = (f: any) => filtroStatusFactura === 'Todos' || String(f.statusFactura || 'Facturado') === filtroStatusFactura;
    const base = facturasGlobales.filter(f => coincideTexto(f) && coincideCliente(f) && coincideFechas(f) && coincideStatus(f));
    let usd = 0, mxn = 0;
    base.forEach((f: any) => {
      const mon = monedaFacturaMostrar(f).toUpperCase();
      if (mon === 'USD') usd++;
      else if (mon === 'MXN') mxn++;
    });
    return { todas: base.length, USD: usd, MXN: mxn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, textoBuscarFactura, filtroCliente, fechaDesdeHist, fechaHastaHist, filtroStatusFactura, empresasList, mapaCatalogos]);

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
              moneda: o.monedaCobroNombre || mostrarMoneda(o.facturadoEnCobrar),
              clienteId: o.clientePaga || o.clienteId || '',
              refCliente: String(o.refCliente || ''), // ✅ NUEVO
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
  useEffect(() => { setPaginaActual(1); }, [filtroCliente, ordenFac, fechaDesdeHist, fechaHastaHist, textoBuscarFactura, filtroStatusFactura, filtroMonedaHist]);
  useEffect(() => { setPaginaOps(1); }, [filtroCliente, ordenOps, fechaDesdeOps, fechaHastaOps, textoBuscarRemolqueOps, vistaOps, operacionesGlobales, filtroTipoOp]);

  const nombreClienteFactura_ = (f: any): string => {
    if (f.clienteNombre) return f.clienteNombre;
    if (f.cliente) return f.cliente;
    if (f.clienteId) {
      const nom = getNombreCliente(f.clienteId);
      if (nom && nom !== f.clienteId) return nom;
    }
    return '-';
  };

  // ✅ REF CLIENTE de una factura: junta las referencias de cliente de sus
  //   operaciones (del snapshot o resueltas en vivo con opInfoMap), sin repetir.
  const refClienteDeFactura = (f: any): string => {
    const refs: string[] = [];
    const vistos = new Set<string>();
    (Array.isArray(f?.operacionesGuardadas) ? f.operacionesGuardadas : []).forEach((op: any) => {
      const v = String(op?.refCliente || opInfoMap[String(op?.id || '')]?.refCliente || '').trim();
      if (v && !vistos.has(v.toLowerCase())) { vistos.add(v.toLowerCase()); refs.push(v); }
    });
    return refs.join(', ');
  };

  // ✅ NUEVO — QUITAR UNA REFERENCIA (operación) DE LA FACTURA:
  //   la operación vuelve a "Por facturar", la factura recalcula totales y
  //   saldo con las operaciones restantes, y si la factura está aplicada en
  //   PAGOS, el snapshot del pago se actualiza con el nuevo total/saldo.
  const [quitandoRef, setQuitandoRef] = useState('');
  const quitarRefDeFactura = async (fv: any, opSnap: any) => {
    if (quitandoRef) return;
    const guardadas: any[] = Array.isArray(fv.operacionesGuardadas) ? fv.operacionesGuardadas : [];
    if (guardadas.length <= 1) {
      alert('No puedes dejar la factura sin operaciones.\n\nSi quieres deshacerla por completo, usa el botón de eliminar factura (las operaciones vuelven a Por facturar).');
      return;
    }
    const restantes = guardadas.filter((g) => String(g.id) !== String(opSnap.id));
    const sumConv = restantes.reduce((s, o) => s + (Number(o.monto) || 0), 0);
    const nativoNuevo = totalNativoFactura({ monedaFacturacion: fv.monedaFacturacion, operacionesGuardadas: restantes });
    const pagado = Number(fv.montoPagado) || 0;
    if (nativoNuevo < pagado - 0.009) {
      alert(`No se puede quitar: el nuevo total (${formatoMoneda(nativoNuevo)}) quedaría por debajo de lo ya pagado (${formatoMoneda(pagado)}).\n\nElimina primero el pago aplicado en el módulo de Pagos y vuelve a intentar.`);
      return;
    }
    if (!window.confirm(`¿Quitar la referencia ${refDeOp(opSnap)} de la factura ${fv.invoice}?\n\n· La operación vuelve a "Por facturar".\n· La factura queda con ${restantes.length} operación(es) y total ${formatoMoneda(nativoNuevo)}.${pagado > 0 ? '\n· El pago aplicado se actualizará con el nuevo total/saldo.' : ''}`)) return;
    setQuitandoRef(String(opSnap.id));
    try {
      const saldoNuevo = Math.max(0, nativoNuevo - pagado);
      const batch = writeBatch(db);
      const cambiosFactura: any = {
        operacionesGuardadas: restantes,
        operacionesIds: (Array.isArray(fv.operacionesIds) ? fv.operacionesIds : []).filter((id: any) => String(id) !== String(opSnap.id)),
        operaciones: restantes.map((g) => refDeOp(g)).filter(Boolean),
        subtotalFactura: sumConv,
        subtotalMonedaFactura: nativoNuevo,
        saldoPendiente: saldoNuevo,
        updatedAt: new Date().toISOString(),
      };
      if (pagado > 0.009) cambiosFactura.statusPago = saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL';
      batch.set(doc(db, 'facturas_clientes', fv.id), cambiosFactura, { merge: true });
      // La operación vuelve a "Por facturar".
      batch.set(doc(db, 'operaciones', String(opSnap.id)), {
        facturaClienteId: '', facturaClienteInvoice: '', facturado: false,
      }, { merge: true });
      await batch.commit();

      // ✅ Propagación a PAGOS: actualiza el snapshot de esta factura en los
      //   pagos donde esté aplicada (total y saldo nuevos).
      try {
        const idsPagos: string[] = Array.isArray(fv.pagosIds) ? fv.pagosIds.map(String) : [];
        for (const pagoId of idsPagos) {
          const snapPago = await getDoc(doc(db, 'pagos', pagoId));
          if (!snapPago.exists()) continue;
          const pData: any = snapPago.data();
          const facturasPago: any[] = Array.isArray(pData.facturas) ? pData.facturas : [];
          let cambio = false;
          const nuevas = facturasPago.map((fa: any) => {
            if (String(fa.facturaId) !== String(fv.id)) return fa;
            cambio = true;
            return { ...fa, total: nativoNuevo, saldoNuevo: Math.max(0, nativoNuevo - pagado) };
          });
          if (cambio) await setDoc(doc(db, 'pagos', pagoId), { facturas: nuevas }, { merge: true });
        }
      } catch (eP) { console.warn('No se pudo actualizar el snapshot del pago:', eP); }

      console.log(`Quitó la referencia ${refDeOp(opSnap)} de la factura ${fv.invoice} (nuevo total ${formatoMoneda(nativoNuevo)}).`);
      // Refresco local (tabla + modal).
      const facturaLocal = { ...fv, ...cambiosFactura };
      setFacturasGlobales((prev: any[]) => prev.map((x: any) => x.id === fv.id ? normalizarFactura(facturaLocal) : x));
      setFacturaViendo(normalizarFactura(facturaLocal));
      setOperacionesGlobales((prev: any[]) => prev.map((o: any) => String(o.id) === String(opSnap.id) ? { ...o, facturaClienteId: '', facturaClienteInvoice: '', facturado: false } : o));
    } catch (e) {
      console.error('No se pudo quitar la referencia:', e);
      alert('No se pudo quitar la referencia. Intenta de nuevo.');
    } finally {
      setQuitandoRef('');
    }
  };

  const renderCeldaFactura = (f: any, colId: string) => {
    switch (colId) {
      case 'statusFactura': return chipStatusFactura(f.statusFactura);
      case 'invoice': return <span className="fcd-x10">{f.invoice}</span>;
      case 'fecha': return <span className="fcd-x11">{formatearFechaSpanish(f.fecha)}</span>;
      case 'remolque': return renderRemolqueTokens(remolquesFacturaTokens(f));
      case 'cliente': return <span className="fcd-x12">{nombreClienteFactura_(f)}</span>;
      case 'refCliente': { const rc = refClienteDeFactura(f); return rc ? <span className="fcd-x11">{rc}</span> : <span className="fcd-x1">-</span>; }
      case 'moneda': { const mon = monedaFacturaMostrar(f); return <span style={{ color: mon === 'N/A' ? '#8b949e' : '#10b981', fontWeight: 'bold' }}>{mon}</span>; }
      case 'facturaCcp': return <span className="fcd-x11">{f.facturaCcp || '-'}</span>;
      case 'cantOps': return <span className="fcd-x1">{f.operacionesIds?.length || 0}</span>;
      case 'referencias': {
        const ops: any[] = Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : [];
        if (ops.length === 0) return <span className="fcd-x1">-</span>;
        return (
          <div className="fcd-x13">
            {ops.map((op: any, idx: number) => (
              <button className="fcd-x14"
                key={`${f.id}_ref_${op?.id || idx}`}
                onClick={(e) => { e.stopPropagation(); if (op?.id) verDetalleOperacion(op.id); }}
                title="Ver detalle de la operación">
                {refDeOp(op)}
              </button>
            ))}
          </div>
        );
      }
      case 'total': return <span className="fcd-x15">{formatoMoneda(totalNativoFactura(f))}</span>;
      case 'createdAt': return <span className="fcd-x1">{f.createdAt ? formatearFechaHora(f.createdAt) : '-'}</span>;
      default: return '-';
    }
  };

  // ✅ (E) Exportación PROFESIONAL a Excel del Historial (ExcelJS con estilos + logo).
  const exportarCSV = async () => {
    if (historialOrdenado.length === 0) return alert('No hay datos para exportar.');
    const columnasVisibles = columnasFactura.filter(c => c.visible);
    if (columnasVisibles.length === 0) return alert('Selecciona al menos una columna para exportar.');

    const tipoExcel = (id: string): 'texto' | 'fecha' | 'fechaHora' | 'monto' | 'numero' => {
      if (id === 'total') return 'monto';
      if (id === 'fecha') return 'fecha';
      if (id === 'createdAt') return 'fechaHora';
      if (id === 'cantOps') return 'numero';
      return 'texto';
    };
    const columnas = columnasVisibles.map(c => ({ key: c.id, label: c.label, tipo: tipoExcel(c.id) }));

    const valorRaw = (f: any, colId: string): any => {
      switch (colId) {
        case 'statusFactura': return f.statusFactura || 'Facturado';
        case 'invoice': return f.invoice || '';
        case 'fecha': return f.fecha || '';
        case 'remolque': return remolqueTokensTexto(remolquesFacturaTokens(f));
        case 'cliente': return nombreClienteFactura_(f);
        case 'refCliente': return refClienteDeFactura(f);
        case 'moneda': return monedaFacturaMostrar(f);
        case 'facturaCcp': return f.facturaCcp || '';
        case 'cantOps': return Number(f.operacionesIds?.length || 0);
        case 'referencias': return Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas.map((op: any) => refDeOp(op)).filter(Boolean).join(', ') : '';
        case 'total': return totalNativoFactura(f); // ✅ FIX MONEDA
        case 'createdAt': return f.createdAt || '';
        default: return '';
      }
    };

    const filas = historialOrdenado.map(f => {
      const fila: any = {};
      columnasVisibles.forEach(col => { fila[col.id] = valorRaw(f, col.id); });
      return fila;
    });

    const cliTxt = filtroCliente ? (nombreClienteSeleccionado || 'Cliente') : 'Todos los clientes';
    const rangoTxt = (fechaDesdeHist || fechaHastaHist) ? `${fechaDesdeHist || 'inicio'} a ${fechaHastaHist || 'hoy'}` : 'Todas las fechas';
    const statusTxt = filtroStatusFactura && filtroStatusFactura !== 'Todos' ? filtroStatusFactura : 'Todos los status';

    try {
      await exportarExcelProfesional({
        nombreArchivo: `Facturas_Clientes_${hoyLocalISO()}.xlsx`,
        tituloReporte: 'Reporte de Facturación · Facturas',
        subtitulo: `${statusTxt}  ·  Cliente: ${cliTxt}  ·  ${rangoTxt}  ·  ${filas.length} facturas`,
        nombreHoja: 'Facturas',
        columnas,
        filas,
      });
    } catch (e) {
      console.error('Error exportando Excel de facturas:', e);
      alert('No se pudo generar el Excel.');
    }
  };

  // ✅ (F) Preparar la remisión de una factura → abre el modal de vista previa.
  //    Emisor según moneda: USD → Camila (emisorUSD), MXN → Rolando (emisorMXN).
  const abrirRemision = async (f: any) => {
    if (!f) return;
    setCargandoRemision(true);
    try {
      // ✅ El encabezado toma la MONEDA YA FACTURADA, la misma de la columna
      //   "Moneda" del historial (monedaFacturaMostrar): si es Dólares/USD sale
      //   Camila; si es Pesos/MXN sale Rolando. La columna resuelve el NOMBRE
      //   del catálogo ("Dolares"/"Pesos"), por eso se detecta por texto y no
      //   solo por el código USD.
      const monRaw = monedaFacturaMostrar(f).toUpperCase();
      const esUSD = monRaw.includes('USD') || monRaw.includes('DOLAR') || monRaw.includes('DÓLAR');
      const emisor = esUSD ? emisorUSD : emisorMXN;

      const ids = (Array.from(new Set((f.operacionesIds || []).map((x: any) => String(x)))) as string[]).filter(Boolean).slice(0, 60);
      const byId = new Map<string, any>();
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        try {
          const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', chunk)));
          snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...(d.data() as any) }));
        } catch (e) { console.warn('No se pudieron leer operaciones para la remisión:', e); }
      }

      const guardadas: any[] = Array.isArray(f.operacionesGuardadas) && f.operacionesGuardadas.length
        ? f.operacionesGuardadas
        : ids.map((id) => ({ id }));

      const filas = guardadas.map((g: any) => {
        const o = byId.get(String(g.id)) || {};
        // (REMISIÓN CLIENTES) En EQ va el # de REMOLQUE; la unidad solo como
        // respaldo cuando la operación no tiene remolque capturado.
        const equipoRemolque = txt(o.remolqueNombre, o.remolquePlaca, o.numeroRemolque);
        const equipo = equipoRemolque !== '-' ? equipoRemolque : txt(o.unidadNombre, o.unidad);
        const importe = Number(g.monto) || (o.id ? obtenerMontoOperacion(o).conv : 0) || 0;
        const ref = refDeOp({ ...g, ...o }) || o.numReferencia || g.ref || '';
        const fechaFmt = formatearFechaSpanish(o.fechaServicio || o.createdAt || '');
        const org = txt(o.origenNombre, o.origen);
        const dst = txt(o.destinoNombre, o.destino);
        return {
          ref,
          fecha: fechaFmt === '-' ? '' : fechaFmt,
          equipo: equipo === '-' ? '' : equipo,
          origen: org === '-' ? '' : org,
          destino: dst === '-' ? '' : dst,
          descripcion: o.descripcionServicio || o.observacionesEjecutivo || o.descripcionMercancia || '',
          importe,
        };
      });

      const totalCalc = filas.reduce((s: number, r: any) => s + (Number(r.importe) || 0), 0);
      const total = totalCalc > 0 ? totalCalc : (Number(f.subtotalFactura) || 0);

      const emp: any = empresasList.find(e => e.id === f.clienteId) || {};

      setRemisionPreview({
        esUSD,
        emisorNombre: emisor.facturaNombre,
        emisorDireccion: emisor.direccion,
        emisorCiudadEstado: emisor.ciudadEstado,
        emisorEmail: emisor.email,
        numero: f.invoice || String(f.id || ''),
        fecha: String(f.fecha || '').slice(0, 10),
        clienteNombre: f.clienteNombre || getNombreCliente(f.clienteId) || '',
        diasCredito: String(emp.diasCredito ?? emp.credito ?? emp.diasDeCredito ?? ''),
        direccion: String(emp.direccion ?? emp.domicilio ?? emp.calle ?? ''),
        numExtInt: String(emp.numExtInt ?? emp.numeroExterior ?? emp.numExt ?? ''),
        colonia: String(emp.colonia ?? ''),
        ciudad: String(emp.ciudad ?? emp.municipio ?? ''),
        moneda: esUSD ? 'Dólares' : 'Pesos',
        observaciones: '',
        fechaTipoCambio: '',
        tipoCambio: '',
        total,
        filas,
      });
    } catch (e) {
      console.error('Error preparando la remisión:', e);
      alert('No se pudo preparar la remisión.');
    } finally {
      setCargandoRemision(false);
    }
  };

  const generarPDFDeRemision = () => {
    if (!remisionPreview) return;
    const data: RemisionData = {
      emisor: {
        facturaNombre: remisionPreview.emisorNombre || '',
        direccion: remisionPreview.emisorDireccion || '',
        ciudadEstado: remisionPreview.emisorCiudadEstado || '',
        email: remisionPreview.emisorEmail || '',
      },
      numero: remisionPreview.numero || '',
      fecha: remisionPreview.fecha || '',
      clienteNombre: remisionPreview.clienteNombre || '',
      diasCredito: remisionPreview.diasCredito || '',
      direccion: remisionPreview.direccion || '',
      numExtInt: remisionPreview.numExtInt || '',
      colonia: remisionPreview.colonia || '',
      ciudad: remisionPreview.ciudad || '',
      moneda: remisionPreview.moneda || '',
      observaciones: remisionPreview.observaciones || '',
      fechaTipoCambio: remisionPreview.fechaTipoCambio || '',
      tipoCambio: remisionPreview.tipoCambio || '',
      total: Number(remisionPreview.total) || 0,
      filas: (remisionPreview.filas || []).map((r: any) => ({
        ref: r.ref || '',
        fecha: r.fecha || '',
        equipo: r.equipo || '',
        origen: r.origen || '',
        destino: r.destino || '',
        descripcion: r.descripcion || '',
        importe: Number(r.importe) || 0,
      })),
    };
    generarRemisionPDF(data);
  };

  const setRP = (campo: string, valor: any) => setRemisionPreview((prev: any) => prev ? { ...prev, [campo]: valor } : prev);

  // ✅ Cambia el emisor de la remisión abierta (Rolando/MXN ↔ Camila/USD) sin
  //   perder el resto de la captura; también actualiza la denominación. Los
  //   campos del encabezado siguen siendo editables a mano después del cambio.
  const aplicarEmisorEnPreview = (usarUSD: boolean) => {
    const emisor = usarUSD ? emisorUSD : emisorMXN;
    setRemisionPreview((prev: any) => prev ? {
      ...prev,
      esUSD: usarUSD,
      emisorNombre: emisor.facturaNombre,
      emisorDireccion: emisor.direccion,
      emisorCiudadEstado: emisor.ciudadEstado,
      emisorEmail: emisor.email,
      moneda: usarUSD ? 'Dólares' : 'Pesos',
    } : prev);
  };
  const setRPFila = (idx: number, campo: string, valor: any) =>
    setRemisionPreview((prev: any) => {
      if (!prev) return prev;
      const filas = [...(prev.filas || [])];
      filas[idx] = { ...filas[idx], [campo]: valor };
      const total = filas.reduce((s: number, r: any) => s + (Number(r.importe) || 0), 0);
      return { ...prev, filas, total };
    });
  const quitarFilaRemision = (idx: number) =>
    setRemisionPreview((prev: any) => {
      if (!prev) return prev;
      const filas = (prev.filas || []).filter((_: any, i: number) => i !== idx);
      const total = filas.reduce((s: number, r: any) => s + (Number(r.importe) || 0), 0);
      return { ...prev, filas, total };
    });

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

  // Estilos reutilizables de los modales de remisión.
  const rInputStyle: React.CSSProperties = { width: '100%', padding: '8px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.85rem', boxSizing: 'border-box' };
  const rLabelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.72rem', display: 'block', marginBottom: '4px', fontWeight: 'bold' };
  const rCellStyle: React.CSSProperties = { padding: '6px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '4px', color: '#c9d1d9', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' };

  const BuscadorCliente = () => (
    <div className="fcd-x16">
      <label className="fcd-x17">CLIENTE (opcional)</label>
      {filtroCliente ? (
        <div className="fcd-x18">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span className="fcd-x19">{nombreClienteSeleccionado}</span>
          <button className="fcd-x20" onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); setSeleccionadas([]); }} title="Quitar cliente">✕</button>
        </div>
      ) : (
        <div className="fcd-x21">
          <svg className="fcd-x22" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input className="fcd-x23" type="text" placeholder="Buscar cliente por nombre o RFC (opcional)..." value={textoBuscarCliente}
            onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
            onFocus={() => setMostrarSugerenciasCliente(true)} onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)} />
        </div>
      )}
      {!filtroCliente && mostrarSugerenciasCliente && (
        <div className="fcd-x24">
          {clientesFiltradosBuscador.length === 0 ? (
            <div className="fcd-x25">{textoBuscarCliente.trim() ? 'Sin coincidencias' : 'No hay clientes (tipo Cliente-Paga) cargados'}</div>
          ) : (
            <>
              <div className="fcd-x26">{clientesFiltradosBuscador.length} {clientesFiltradosBuscador.length === 1 ? 'cliente' : 'clientes'}{textoBuscarCliente.trim() ? '' : ' (primeros 30)'}</div>
              {clientesFiltradosBuscador.map((cli: any) => (
                <div className="fcd-x27" key={cli.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFiltroCliente(cli.id); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); setSeleccionadas([]); }}
                  onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div className="fcd-x28">{cli.nombre || cli.id}</div>
                  {cli.rfc && <div className="fcd-x29">{cli.rfc}</div>}
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
    ? [fechaDesdeOps, fechaHastaOps, textoBuscarRemolqueOps, filtroTipoOp, filtroCliente].filter(Boolean).length
    : [textoBuscarFactura, fechaDesdeHist, fechaHastaHist, filtroCliente].filter(Boolean).length + (filtroMonedaHist !== 'todas' ? 1 : 0);
  const limpiarFiltros = () => {
    if (activeTab === 'operaciones') { setFechaDesdeOps(''); setFechaHastaOps(''); setTextoBuscarRemolqueOps(''); setFiltroTipoOp(''); }
    else { setTextoBuscarFactura(''); setFechaDesdeHist(''); setFechaHastaHist(''); setFiltroMonedaHist('todas'); }
    setFiltroCliente(''); setTextoBuscarCliente('');
  };

  return (
    <div className="module-container fcd-x30">
      <h1 className="fcd-x31">Facturación de Clientes</h1>

      <div className="fcd-x32">
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Facturas</button>
        <button onClick={recargarTodo} disabled={cargandoOperaciones || cargandoFacturas}
          title="Vuelve a leer operaciones y facturas desde la base de datos (limpia la caché)"
          style={{ marginLeft: 'auto', marginBottom: '6px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', color: '#c9d1d9', cursor: (cargandoOperaciones || cargandoFacturas) ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', opacity: (cargandoOperaciones || cargandoFacturas) ? 0.6 : 1 }}>
          <span className="fcd-x33">↻</span>
          {(cargandoOperaciones || cargandoFacturas) ? 'Refrescando…' : 'Refrescar'}
        </button>
      </div>

      <div className="fcd-x34">
        <button onClick={() => setFiltrosAbiertos(true)} title="Mostrar filtros"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${filtrosActivos > 0 ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          Filtros
          {filtrosActivos > 0 && <span className="fcd-x35">{filtrosActivos}</span>}
        </button>
        {filtrosActivos > 0 && (
          <button onClick={() => { limpiarFiltros(); if (activeTab === 'operaciones') setBusquedaOpsHecha(false); else setBusquedaHistHecha(false); }} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar todos los filtros">✕ Limpiar filtros</button>
        )}
        {activeTab === 'operaciones' && filtroTipoOp && (
          <span className="fcd-x36">
            {filtroTipoOp}
            <button className="fcd-x37" onClick={() => setFiltroTipoOp('')}>✕</button>
          </span>
        )}
        {activeTab === 'historial' && filtroMonedaHist !== 'todas' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: filtroMonedaHist === 'USD' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)', border: `1px solid ${filtroMonedaHist === 'USD' ? '#10b981' : '#3b82f6'}`, borderRadius: '14px', color: filtroMonedaHist === 'USD' ? '#10b981' : '#3b82f6', fontSize: '0.8rem', fontWeight: 'bold' }}>
            {filtroMonedaHist === 'USD' ? '$ Dólares (USD)' : '$ Pesos (MXN)'}
            <button className="fcd-x38" onClick={() => setFiltroMonedaHist('todas')}>✕</button>
          </span>
        )}
        {filtroCliente && (
          <span className="fcd-x39">
            {nombreClienteSeleccionado}
            <button className="fcd-x40" onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); }}>✕</button>
          </span>
        )}
      </div>

      {filtrosAbiertos && (
        <div className="fcd-x41" onClick={() => setFiltrosAbiertos(false)}>
          <div className="fcd-x42" onClick={(e) => e.stopPropagation()}>
            <div className="fcd-x43">
              <h3 className="fcd-x44">Filtros · {activeTab === 'operaciones' ? 'Operaciones' : 'Historial'}</h3>
              <button className="fcd-x45" onClick={() => setFiltrosAbiertos(false)}>✕</button>
            </div>

            {activeTab === 'operaciones' ? (
              <>
                <div className="fcd-x46">
                  <label className="fcd-x47"># REMOLQUE / REFERENCIA (opcional)</label>
                  <div className="fcd-x21">
                    <svg className="fcd-x48" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input className="fcd-x49" type="text" placeholder="Buscar por # remolque o referencia..." value={textoBuscarRemolqueOps}
                      onChange={(e) => setTextoBuscarRemolqueOps(e.target.value)} />
                    {textoBuscarRemolqueOps && (
                      <button className="fcd-x50" onClick={() => setTextoBuscarRemolqueOps('')} title="Limpiar">✕</button>
                    )}
                  </div>
                </div>
                <div className="fcd-x46">
                  <label className="fcd-x51">TIPO DE OPERACIÓN (opcional)</label>
                  <select value={filtroTipoOp} onChange={(e) => setFiltroTipoOp(e.target.value)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: `1px solid ${filtroTipoOp ? '#a371f7' : '#30363d'}`, borderRadius: '6px', color: filtroTipoOp ? '#a371f7' : '#c9d1d9', fontSize: '0.9rem', fontWeight: filtroTipoOp ? 'bold' : 'normal', boxSizing: 'border-box' }}>
                    <option value="">Todos los tipos ({tiposOperacionDisponibles.length})</option>
                    {tiposOperacionDisponibles.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {tiposOperacionDisponibles.length === 0 && (
                    <span className="fcd-x52">Carga las operaciones para ver los tipos disponibles.</span>
                  )}
                </div>
                <div className="fcd-x53">
                  <div className="fcd-x54">
                    <label className="fcd-x47">FECHA DESDE</label>
                    <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div className="fcd-x54">
                    <label className="fcd-x47">FECHA HASTA</label>
                    <input type="date" value={fechaHastaOps} onChange={(e) => setFechaHastaOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(fechaDesdeOps || fechaHastaOps) && (
                  <button onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }} style={{ ...btnDirStyle, color: '#8b949e', alignSelf: 'flex-start' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
                )}
                <div className="fcd-x46">
                  <label className="fcd-x55">VISTA</label>
                  <div className="fcd-x56">
                    <button onClick={() => { setVistaOps('pendientes'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'pendientes', '#f59e0b'), flex: 1 }}>Pendientes ({resumenOps.porFacturar})</button>
                    <button onClick={() => { setVistaOps('facturadas'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'facturadas', '#10b981'), flex: 1 }}>Facturadas ({resumenOps.facturadas})</button>
                    <button onClick={() => { setVistaOps('todas'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'todas', '#58a6ff'), flex: 1 }}>Todas ({resumenOps.total})</button>
                  </div>
                </div>
                <div className="fcd-x46">
                  <label className="fcd-x47">ORDENAR POR</label>
                  <div className="fcd-x57">
                    <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={{ ...selectOrdenStyle, flex: 1 }}>
                      {columnasOps.filter(c => c.visible && c.orden).map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                    <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                      {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                    </button>
                  </div>
                </div>
                {BuscadorCliente()}
                <div className="fcd-x58">
                  Por defecto se muestran <b className="fcd-x1">todas</b> las operaciones completadas. El rango de fechas y el cliente son <b className="fcd-x1">opcionales</b> para acotar.
                </div>
              </>
            ) : (
              <>
                <div className="fcd-x46">
                  <label className="fcd-x59">BUSCAR EN HISTORIAL</label>
                  <div className="fcd-x21">
                    <svg className="fcd-x48" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input className="fcd-x23" type="text" placeholder="Invoice, cliente, status, CCP, referencia o # remolque..." value={textoBuscarFactura} onChange={(e) => setTextoBuscarFactura(e.target.value)} />
                    {textoBuscarFactura && (
                      <button className="fcd-x50" onClick={() => setTextoBuscarFactura('')} title="Limpiar búsqueda">✕</button>
                    )}
                  </div>
                </div>
                <div className="fcd-x53">
                  <div className="fcd-x54">
                    <label className="fcd-x47">FECHA DESDE</label>
                    <input type="date" value={fechaDesdeHist} onChange={(e) => setFechaDesdeHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div className="fcd-x54">
                    <label className="fcd-x47">FECHA HASTA</label>
                    <input type="date" value={fechaHastaHist} onChange={(e) => setFechaHastaHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(fechaDesdeHist || fechaHastaHist) && (
                  <button onClick={() => { setFechaDesdeHist(''); setFechaHastaHist(''); }} style={{ ...btnDirStyle, color: '#8b949e', alignSelf: 'flex-start' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
                )}
                <div className="fcd-x46">
                  <label className="fcd-x47">STATUS DE FACTURA</label>
                  <div className="fcd-x60">
                    {statusBotones.map(s => {
                      const col = s === 'Todos' ? '#58a6ff' : colorStatusFactura(s);
                      return (
                        <button key={s} onClick={() => setFiltroStatusFactura(s)} style={{ ...segBtnStyle(filtroStatusFactura === s, col), flex: '1 1 auto' }}>
                          {s} ({conteoStatus[s] ?? 0})
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="fcd-x46">
                  <label className="fcd-x47">MONEDA DE FACTURACIÓN</label>
                  <div className="fcd-x56">
                    <button onClick={() => setFiltroMonedaHist('todas')} style={{ ...segBtnStyle(filtroMonedaHist === 'todas', '#58a6ff'), flex: 1 }}>Todas ({conteoMonedaHist.todas})</button>
                    <button onClick={() => setFiltroMonedaHist('USD')} style={{ ...segBtnStyle(filtroMonedaHist === 'USD', '#10b981'), flex: 1 }}>$ Dólares ({conteoMonedaHist.USD})</button>
                    <button onClick={() => setFiltroMonedaHist('MXN')} style={{ ...segBtnStyle(filtroMonedaHist === 'MXN', '#3b82f6'), flex: 1 }}>$ Pesos ({conteoMonedaHist.MXN})</button>
                  </div>
                </div>
                <div className="fcd-x46">
                  <label className="fcd-x47">ORDENAR POR</label>
                  <div className="fcd-x57">
                    <select value={ordenFac.campo} onChange={(e) => setOrdenFac(prev => ({ ...prev, campo: e.target.value }))} style={{ ...selectOrdenStyle, flex: 1 }}>
                <option value="statusFactura">Status</option>
                <option value="invoice">Invoice</option>
                <option value="fecha">Fecha</option>
                <option value="remolque"># Remolque</option>
                <option value="cliente">Cliente</option>
                <option value="moneda">Moneda</option>
                <option value="cantOps">Cant. Ops</option>
                <option value="total">Total</option>
                    </select>
                    <button onClick={() => setOrdenFac(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                      {ordenFac.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                    </button>
                  </div>
                </div>
                {BuscadorCliente()}
                <div className="fcd-x58">
                  Por defecto se muestran <b className="fcd-x1">todas</b> las facturas (sin filtro de fechas). Las facturas importadas sin fecha se ocultan al filtrar por fecha.
                </div>
              </>
            )}

            <div className="fcd-x61">
              <button className="fcd-x62" onClick={() => { limpiarFiltros(); if (activeTab === 'operaciones') setBusquedaOpsHecha(false); else setBusquedaHistHecha(false); }}>Limpiar</button>
              <button className="fcd-x63" onClick={() => { if (activeTab === 'operaciones') setBusquedaOpsHecha(true); else setBusquedaHistHecha(true); setFiltrosAbiertos(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          <div className="fcd-x64">
            <div className="fcd-x65">
              <span className="fcd-x66">Operaciones en espera por facturar</span>
              <span className="fcd-x67">{resumenOps.porFacturar}</span>
            </div>
            <div className="fcd-x65">
              <span className="fcd-x66">Operaciones ya facturadas (en historial)</span>
              <span className="fcd-x68">{resumenOps.facturadas}</span>
            </div>
            <div className="fcd-x65">
              <span className="fcd-x66">Total completadas cargadas</span>
              <span className="fcd-x69">{resumenOps.total}</span>
            </div>
          </div>

          <div className="fcd-x70">
            <div className="fcd-x71">
              <span className="fcd-x7">
                {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'mostrada' : 'mostradas'}
              </span>
            </div>

            <div className="fcd-x72">
              <button onClick={recargarOperaciones} style={btnDirStyle} title="Volver a leer todas las operaciones desde la base de datos">↻ Recargar</button>
              <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">⚙ Configurar Columnas</button>
              <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                  cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                  backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                  color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                Exportar Excel
              </button>
              <button disabled={seleccionadas.length === 0} onClick={abrirModalCostoAdic}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #58a6ff', backgroundColor: 'transparent', color: seleccionadas.length === 0 ? '#484f58' : '#58a6ff', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap', cursor: seleccionadas.length === 0 ? 'not-allowed' : 'pointer' }}
                title="Agregar un costo adicional al cliente en una operación seleccionada">
                Costo adicional
              </button>
              <button disabled={seleccionadas.length === 0 || seleccionMultiCliente} onClick={() => { setStatusFacturaForm('Facturado'); setModalAbierto(true); }}
                style={{ padding: '8px 20px', backgroundColor: (seleccionadas.length > 0 && !seleccionMultiCliente) ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && !seleccionMultiCliente) ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Generar Factura ({seleccionadas.length})
              </button>
            </div>
          </div>

          {topeOpsAlcanzado && (
            <div className="fcd-x73">
              Se alcanzó el tope de <b>{LIMITE_OPS_TODAS}</b> operaciones cargadas, por lo que podría haber más que no se muestran. Usa el <b>rango de fechas</b> o el <b>cliente</b> para acotar.
            </div>
          )}

          {seleccionMultiCliente && (
            <div className="fcd-x74">
              Seleccionaste operaciones de <b>distintos clientes</b>. Una factura debe ser de un solo cliente: usa el filtro de cliente o selecciona operaciones del mismo cliente.
            </div>
          )}

          {seleccionadas.length > 0 && !seleccionMultiCliente && (
            <div className="fcd-x75">
              <div className="fcd-x76">
                <div className="fcd-x77">
                  <span className="fcd-x78">Seleccionadas</span>
                  <span className="fcd-x69">{seleccionadas.length}</span>
                </div>
                <div className="fcd-x77">
                  <span className="fcd-x78">Conversión Estimada</span>
                  <span className="fcd-x79">{formatoMoneda(resumenSeleccion.subtotal)}</span>
                </div>
                <div className="fcd-x77">
                  <span className="fcd-x78">Cliente</span>
                  <span className="fcd-x80">{nombreClienteFactura || '—'}</span>
                </div>
                <div>
                  <span className="fcd-x78">Moneda</span>
                  <span className="fcd-x81">{monedaFacturacion}</span>
                </div>
              </div>
            </div>
          )}

          <div className="table-container fcd-x82">
            <table className="fcd-x83">
              <thead className="fcd-x84">
                <tr>
                  <th className="fcd-x85">ACCIONES</th>
                  <th className="fcd-x86"></th>
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
                {!busquedaOpsHecha ? (
                  <tr><td className="fcd-x87" colSpan={columnasOps.filter(c => c.visible).length + 2}>
                    <div className="fcd-x88">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="fcd-x89">Define tus filtros y presiona <b className="fcd-x90">Buscar</b> para ver las operaciones.</span>
                      <button className="fcd-x91" onClick={() => setFiltrosAbiertos(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : cargandoOperaciones ? (
                  <tr><td className="fcd-x92" colSpan={columnasOps.filter(c => c.visible).length + 2}>Cargando todas las operaciones completadas...</td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td className="fcd-x92" colSpan={columnasOps.filter(c => c.visible).length + 2}>No hay operaciones {vistaOps === 'facturadas' ? 'facturadas' : vistaOps === 'pendientes' ? 'pendientes' : 'completadas'} con los filtros actuales{filtroCliente ? ' para el cliente seleccionado' : ''}.</td></tr>
                ) : (
                  operacionesPagina.map(op => {
                    const m = obtenerMontoOperacion(op);
                    const yaFacturada = esFacturada(op);
                    return (
                      <tr key={op.id} onClick={() => { if (!yaFacturada) toggleSeleccion(op.id); }}
                        style={{ cursor: yaFacturada ? 'default' : 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : (yaFacturada ? 'rgba(16,185,129,0.04)' : 'transparent') }}>
                        <td className="fcd-x93">
                          {yaFacturada ? (
                            <div className="fcd-x94">
                              <button className="fcd-x95"
                                onClick={(e) => abrirGestionOp(e, op)}
                                title="Editar el # de factura de esta operación">
                                ✎ #
                              </button>
                              <button className="fcd-x96"
                                onClick={(e) => { e.stopPropagation(); quitarOpDeFactura(op); }}
                                title="Quitar esta operación de la factura (vuelve a Pendientes)">
                                ✕ Quitar
                              </button>
                            </div>
                          ) : (
                            <button className="fcd-x97"
                              onClick={(e) => { e.stopPropagation(); abrirCostoAdicParaOp(op.id); }}
                              title="Agregar costo adicional a esta operación">
                              ＋ Costo
                            </button>
                          )}
                        </td>
                        <td className="fcd-x98">
                          {yaFacturada ? (
                            <span className="fcd-x99" title="Ya facturada" />
                          ) : (
                            <input className="fcd-x100" type="checkbox" checked={seleccionadas.includes(op.id)} readOnly />
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
          {busquedaOpsHecha && totalPaginasOps > 1 && (
            <div className="fcd-x101">
              <button onClick={() => setPaginaOps(p => Math.max(1, p - 1))} disabled={paginaOpsSegura === 1}
                style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaOpsSegura === 1 ? 'not-allowed' : 'pointer', color: paginaOpsSegura === 1 ? '#484f58' : '#c9d1d9' }}>Anterior</button>
              <span className="fcd-x102">
                Página {paginaOpsSegura} / {totalPaginasOps} · {operacionesMostradas.length} operaciones
              </span>
              <button onClick={() => setPaginaOps(p => Math.min(totalPaginasOps, p + 1))} disabled={paginaOpsSegura === totalPaginasOps}
                style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaOpsSegura === totalPaginasOps ? 'not-allowed' : 'pointer', color: paginaOpsSegura === totalPaginasOps ? '#484f58' : '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>

      ) : (
        <div className="animation-fade-in">

          <div className="fcd-x103">
            <div className="fcd-x104">
              <span className="fcd-x105">Facturas Listadas</span>
              <span className="fcd-x106">{resumenHistorial.cuenta}</span>
            </div>
            <div className="fcd-x104">
              <span className="fcd-x105">Ops. Facturadas</span>
              <span className="fcd-x107">{resumenHistorial.totalOps}</span>
            </div>
            <div className="fcd-x104">
              <span className="fcd-x108">Total Facturado (USD)</span>
              <span className="fcd-x109">{formatoMoneda(resumenHistorial.totalUSD)}</span>
            </div>
            <div className="fcd-x104">
              <span className="fcd-x108">Total Facturado (MXN)</span>
              <span className="fcd-x110">{formatoMoneda(resumenHistorial.totalMXN)}</span>
            </div>
          </div>

          <div className="fcd-x70">
            <div className="fcd-x111">
              <span className="fcd-x7">{historialOrdenado.length} {historialOrdenado.length === 1 ? 'factura' : 'facturas'}</span>
            </div>
            <div className="fcd-x72">
              <button title="Editar el encabezado de las remisiones (emisor por moneda: USD→Camila, MXN→Rolando)" onClick={() => setModalEmisores(true)} style={{ ...btnDirStyle, borderColor: '#fb923c', color: '#fb923c' }}>⚙ Encabezado Remisión</button>
              <button title="Verificar consistencia de la facturación" onClick={() => setModalDiagnostico(true)} style={{ ...btnDirStyle, borderColor: '#58a6ff', color: '#58a6ff' }}>Verificar</button>
              <button title="Configurar columnas" onClick={() => setModalColumnas(true)} style={btnDirStyle}>⚙ Configurar Columnas</button>
              <button title="Exportar a Excel" onClick={exportarCSV} style={{ ...btnDirStyle, backgroundColor: '#1a7f37', color: '#fff', border: 'none' }}>Exportar Excel</button>
            </div>
          </div>

          <div className="table-container fcd-x82">
            <table className="fcd-x83">
              <thead className="fcd-x84">
                <tr>
                  <th className="fcd-x85">ACCIONES</th>
                  {columnasFactura.filter(c => c.visible).map(col => (
                    <th key={`th_${col.id}`} style={thOrdenStyle} onClick={() => toggleOrdenFac(col.id)}>
                      {col.label.toUpperCase()}{flechaFac(col.id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaHistHecha ? (
                  <tr><td className="fcd-x87" colSpan={columnasFactura.filter(c => c.visible).length + 1}>
                    <div className="fcd-x88">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="fcd-x89">Define tus filtros y presiona <b className="fcd-x90">Buscar</b> para ver las facturas.</span>
                      <button className="fcd-x91" onClick={() => setFiltrosAbiertos(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : cargandoFacturas ? (
                  <tr><td className="fcd-x112" colSpan={columnasFactura.filter(c => c.visible).length + 1}>Cargando facturas...</td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td className="fcd-x112" colSpan={columnasFactura.filter(c => c.visible).length + 1}>
                    {facturasGlobales.length === 0
                      ? 'Aún no hay facturas registradas.'
                      : `No se encontraron facturas con los filtros actuales${textoBuscarFactura ? ` (búsqueda: "${textoBuscarFactura}")` : ''}${filtroStatusFactura !== 'Todos' ? ` (status: "${filtroStatusFactura}")` : ''}${filtroCliente ? ' para el cliente seleccionado' : ''}.`}
                  </td></tr>
                ) : (
                  registrosVisibles.map(f => (
                    <tr className="fcd-x113" key={f.id}>
                      <td className="fcd-x98">
                        <div className="fcd-x114">
                          <button className="fcd-x115" title="Ver Ficha" onClick={() => setFacturaViendo(f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button className="fcd-x116" title="Generar Remisión (PDF)" onClick={() => abrirRemision(f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                          </button>
                          <button className="fcd-x117" title="Editar Factura" onClick={(e) => abrirEditarFactura(e, f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          </button>
                          <button className="fcd-x118" title="Eliminar Factura" onClick={(e) => handleEliminarFactura(e, f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      {columnasFactura.filter(c => c.visible).map(col => (
                        <td className="fcd-x5" key={`cell_${f.id}_${col.id}`}>{renderCeldaFactura(f, col.id)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {busquedaHistHecha && totalPaginas > 1 && (
            <div className="fcd-x119">
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span className="fcd-x120">{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {modalColumnas && (
        <div className="modal-overlay fcd-x121">
          <div className="fcd-x122">
            <div className="fcd-x123">
              <h3 className="fcd-x124">Configurar Columnas</h3>
              <button className="fcd-x45" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="fcd-x125">Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel. <b className="fcd-x126">Esta configuración se guarda y se aplica para todos los usuarios.</b></p>
            <ul className="fcd-x127">
              {columnasFactura.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStart(e, idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={() => setDraggedColIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="fcd-x128" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="fcd-x129">
              <button onClick={guardarConfigColumnasHistorial} disabled={guardandoCols} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: guardandoCols ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoCols ? 0.7 : 1 }}>{guardandoCols ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {modalColumnasOps && (
        <div className="modal-overlay fcd-x121">
          <div className="fcd-x130">
            <div className="fcd-x131">
              <div>
                <h3 className="fcd-x124">Configurar Columnas</h3>
                <span className="fcd-x132">
                  {columnasOps.filter(c => c.visible).length} visibles de {columnasOps.length} disponibles
                </span>
              </div>
              <button className="fcd-x45" onClick={() => { setModalColumnasOps(false); setBusquedaColOps(''); }}>✕</button>
            </div>
            <div className="fcd-x133">
              <div className="fcd-x134">
                <svg className="fcd-x48" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="fcd-x135" type="text" placeholder="Buscar columna por nombre o grupo..." value={busquedaColOps} onChange={(e) => setBusquedaColOps(e.target.value)} />
              </div>
              <button onClick={() => setColumnasOps(cs => cs.map(c => ({ ...c, visible: false })))} style={{ ...btnDirStyle, color: '#8b949e' }} title="Ocultar todas">Ocultar todas</button>
              <button onClick={() => setColumnasOps(cs => cs.map(c => ({ ...c, visible: true })))} style={{ ...btnDirStyle, color: '#10b981' }} title="Mostrar todas">Mostrar todas</button>
              <button onClick={() => setColumnasOps(COLUMNAS_OPS_BASE.map(c => ({ ...c })))} style={{ ...btnDirStyle, color: '#D84315' }} title="Restablecer al estado por defecto">Restablecer</button>
            </div>
            <p className="fcd-x136">
              Arrastra para reordenar. Marca las que quieras ver en la tabla y en el Excel. El grupo entre paréntesis indica de qué pestaña del detalle viene el campo. <b className="fcd-x126">Esta configuración se guarda y se aplica para todos los usuarios.</b>
            </p>
            <ul className="fcd-x137">
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
                    <input className="fcd-x128" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} />
                    <div className="fcd-x138">
                      <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                      {col.grupo && (
                        <span className="fcd-x139">({col.grupo})</span>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
            <div className="fcd-x129">
              <button onClick={guardarConfigColumnasOps} disabled={guardandoCols} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: guardandoCols ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoCols ? 0.7 : 1 }}>{guardandoCols ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {modalCostoAdic && (
        <div className="modal-overlay fcd-x140">
          <div className="fcd-x141">
            <div className="fcd-x142">
              <h2 className="fcd-x143">Costo adicional al cliente</h2>
              <button className="fcd-x45" onClick={() => setModalCostoAdic(false)}>✕</button>
            </div>
            <p className="fcd-x144">
              Se suma a los <b className="fcd-x11">Cargos Adicionales</b> del cliente en la operación elegida y se recalcula su subtotal/conversión. Usa un monto negativo para aplicar un descuento.
            </p>
            <div className="fcd-x145">
              <div>
                <label className="fcd-x146">OPERACIÓN</label>
                <select className="fcd-x147" value={costoAdicOpId} onChange={e => setCostoAdicOpId(e.target.value)}>
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
                  <div className="fcd-x148">
                    Cargos actuales: <b className="fcd-x11">{formatoMoneda(o.cargosAdicionales)}</b> · Conversión actual: <b className="fcd-x149">{formatoMoneda(mm.conv)}</b>
                  </div>
                );
              })()}
              <div>
                <label className="fcd-x146">MONTO ADICIONAL (en la moneda del convenio)</label>
                <input className="fcd-x150" type="number" step="any" value={costoAdicMonto} onChange={e => setCostoAdicMonto(e.target.value)} placeholder="Ej. 150.00" />
              </div>
              <div>
                <label className="fcd-x146">CONCEPTO (opcional)</label>
                <input className="fcd-x151" type="text" value={costoAdicConcepto} onChange={e => setCostoAdicConcepto(e.target.value)} placeholder="Ej. Estadía, maniobras, demora..." />
              </div>
            </div>
            <div className="fcd-x152">
              <button className="fcd-x153" onClick={() => setModalCostoAdic(false)} disabled={guardandoCostoAdic}>Cancelar</button>
              <button onClick={handleGuardarCostoAdic} disabled={guardandoCostoAdic || !costoAdicOpId} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: (guardandoCostoAdic || !costoAdicOpId) ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: (guardandoCostoAdic || !costoAdicOpId) ? 0.7 : 1 }}>{guardandoCostoAdic ? 'Guardando...' : 'Agregar costo'}</button>
            </div>
          </div>
        </div>
      )}

      {modalAbierto && (
        <div className="modal-overlay fcd-x154">
          <div className="fcd-x155">
            <div className="fcd-x142">
              <h2 className="fcd-x156">Generar Factura</h2>
              <button className="fcd-x45" onClick={() => setModalAbierto(false)}>✕</button>
            </div>
            <div className="fcd-x157">
              <div>
                <span className="fcd-x158">Cliente</span>
                <span className="fcd-x80">{nombreClienteFactura || getNombreCliente(clienteFacturaId)}</span>
              </div>
              <div className="fcd-x159">
                <span className="fcd-x158">Moneda Cliente</span>
                <span className="fcd-x160">{monedaFacturacion}</span>
              </div>
              <div className="fcd-x161">
                <span className="fcd-x158">Conversión ({seleccionadas.length} Ops)</span>
                <span className="fcd-x162">{formatoMoneda(resumenSeleccion.subtotal)}</span>
              </div>
            </div>
            <form onSubmit={handleGuardarFactura}>
              <div className="fcd-x163">
                <div className="fcd-x164">
                  <label className="fcd-x146">STATUS DE LA FACTURA</label>
                  <select value={statusFacturaForm} onChange={e => setStatusFacturaForm(e.target.value)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: colorStatusFactura(statusFacturaForm), border: `1px solid ${colorStatusFactura(statusFacturaForm)}`, borderRadius: '4px', fontWeight: 'bold' }}>
                    {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fcd-x164">
                  <label className="fcd-x146">NÚMERO DE INVOICE</label>
                  <input className="fcd-x165" type="text" required placeholder="Ej. INV-2026-001" value={invoiceForm} onChange={e => setInvoiceForm(e.target.value)} />
                </div>
                <div>
                  <label className="fcd-x146">FECHA DE FACTURACIÓN</label>
                  <input className="fcd-x166" type="date" required value={fechaForm} onChange={e => setFechaForm(e.target.value)} />
                </div>
                <div>
                  <label className="fcd-x146">FACTURA CCP (Opcional)</label>
                  <input className="fcd-x166" type="text" placeholder="Referencia CCP..." value={facturaCcpForm} onChange={e => setFacturaCcpForm(e.target.value)} />
                </div>
              </div>
              <div className="fcd-x167">
                <button className="fcd-x153" type="button" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
                <button className="fcd-x168" type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Confirmar Factura'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {facturaViendo && (
        <div className="modal-overlay fcd-x169">
          <div className="fcd-x170">
            <div className="fcd-x171">
              <h2 className="fcd-x172">Ficha de Factura</h2>
              <div className="fcd-x173">
                <button onClick={() => abrirRemision(facturaViendo)} disabled={cargandoRemision}
                  title="Generar la Remisión en PDF de esta factura"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#fb923c', color: '#0d1117', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: cargandoRemision ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', opacity: cargandoRemision ? 0.7 : 1 }}>
                  {cargandoRemision ? 'Preparando...' : 'Remisión'}
                </button>
                <button className="fcd-x45" onClick={() => setFacturaViendo(null)}>✕</button>
              </div>
            </div>
            <div className="fcd-x174">
              <div className="fcd-x175">
                <span className="fcd-x176">Status de la factura</span>
                <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', color: colorStatusFactura(facturaViendo.statusFactura), border: `1px solid ${colorStatusFactura(facturaViendo.statusFactura)}`, backgroundColor: `${colorStatusFactura(facturaViendo.statusFactura)}1a`, whiteSpace: 'nowrap' }}>{facturaViendo.statusFactura || 'Facturado'}</span>
                <div className="fcd-x177">
                  <span className="fcd-x132">Cambiar a:</span>
                  <select value={facturaViendo.statusFactura || 'Facturado'} onChange={(e) => handleCambiarStatusFactura(facturaViendo, e.target.value)}
                    style={{ backgroundColor: '#0d1117', border: `1px solid ${colorStatusFactura(facturaViendo.statusFactura)}`, color: colorStatusFactura(facturaViendo.statusFactura), borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}>
                    {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="fcd-x178">
                <div className="fcd-x179">
                  <div>
                    <span className="fcd-x180">Invoice</span>
                    <span className="fcd-x181">{facturaViendo.invoice}</span>
                  </div>
                  <div className="fcd-x182">
                    <span className="fcd-x180">Moneda</span>
                    <span className="fcd-x160">{monedaFacturaMostrar(facturaViendo)}</span>
                  </div>
                  <div className="fcd-x161">
                    <span className="fcd-x180">Fecha de Facturación</span>
                    <span className="fcd-x183">{formatearFechaSpanish(facturaViendo.fecha)}</span>
                  </div>
                </div>
                <div>
                  <span className="fcd-x180">Cliente Facturado</span>
                  <span className="fcd-x80">{facturaViendo.clienteNombre || getNombreCliente(facturaViendo.clienteId) || '-'}</span>
                </div>
                <div>
                  <span className="fcd-x180">Factura CCP</span>
                  <span className="fcd-x184">{facturaViendo.facturaCcp || '-'}</span>
                </div>
                <div>
                  <span className="fcd-x180">Total Facturado</span>
                  <span className="fcd-x185">{formatoMoneda(facturaViendo.subtotalFactura)}</span>
                </div>

                <div className="fcd-x186"><hr className="fcd-x187" /></div>

                <div className="fcd-x188">
                  <div className="fcd-x189">
                    <span className="fcd-x176">
                      Referencias / Operaciones Facturadas ({facturaViendo.operacionesGuardadas?.length || 0}) — haz clic para ver el detalle
                    </span>
                    <button className="fcd-x190"
                      onClick={() => { setAgregarRefFactura(facturaViendo); setBusquedaRefPendiente(''); if (operacionesGlobales.length === 0) descargarOpsCompletadas(); }}
                      title="Agregar una operación pendiente (sin facturar) a esta factura">
                      ＋ Agregar referencia
                    </button>
                  </div>
                  <div className="fcd-x191">
                    {facturaViendo.operacionesGuardadas?.map((op: any) => {
                      const numeroCaja = remolqueDeOp(op);
                      return (
                        <button className="fcd-x192" key={op.id} onClick={() => verDetalleOperacion(op.id)} title="Ver detalle de la operación"
                          onMouseEnter={(e: any) => { e.currentTarget.style.backgroundColor = '#1f2d44'; e.currentTarget.style.borderColor = '#79b8ff'; }}
                          onMouseLeave={(e: any) => { e.currentTarget.style.backgroundColor = '#21262d'; e.currentTarget.style.borderColor = '#58a6ff'; }}>
                          <span className="fcd-x193">{refDeOp(op)}</span>
                          {numeroCaja && (
                            <span className="fcd-x194">
                              <span className="fcd-x1">Caja:</span> {numeroCaja}
                            </span>
                          )}
                          {op.convenioNombre && (
                            <span className="fcd-x194"><span className="fcd-x1">Convenio:</span> {op.convenioNombre}</span>
                          )}
                          <span className="fcd-x195">{formatoMoneda(op.monto)}</span>
                          {/* ✅ NUEVO: quitar esta referencia de la factura */}
                          <span
                            role="button"
                            title="Quitar esta referencia de la factura (la operación vuelve a Por facturar)"
                            onClick={(e: any) => { e.stopPropagation(); quitarRefDeFactura(facturaViendo, op); }}
                            style={{ marginLeft: '8px', color: quitandoRef === String(op.id) ? '#6e7681' : '#f85149', fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}
                          >
                            {quitandoRef === String(op.id) ? '…' : '✕'}
                          </span>
                        </button>
                      );
                    }) || <span className="fcd-x1">Sin detalle de operaciones.</span>}
                  </div>
                </div>
              </div>
            </div>
            <div className="fcd-x196">
              <button onClick={() => setFacturaViendo(null)} className="btn btn-outline fcd-x197">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {modalDiagnostico && (
        <div className="modal-overlay fcd-x198" onClick={() => setModalDiagnostico(false)}>
          <div className="fcd-x199" onClick={(e) => e.stopPropagation()}>
            <div className="fcd-x171">
              <span className="fcd-x200">Verificación de Facturación</span>
              <button className="fcd-x201" onClick={() => setModalDiagnostico(false)}>×</button>
            </div>
            <div className="fcd-x202">
              {cargandoFacturas && (
                <div className="fcd-x203">Cargando facturas… los números pueden cambiar al terminar.</div>
              )}
              <div>
                <div className="fcd-x204">Resumen global (facturas cargadas)</div>
                <div className="fcd-x205">
                  {[
                    { lbl: 'Facturas', val: diagnostico.totalFacturas, col: '#58a6ff' },
                    { lbl: 'Ops facturadas (únicas)', val: diagnostico.opsFacturadasUnicas, col: '#3fb950' },
                    { lbl: 'Invoices duplicados', val: diagnostico.invoicesDuplicados, col: diagnostico.invoicesDuplicados > 0 ? '#f85149' : '#3fb950' },
                  ].map((c, i) => (
                    <div className="fcd-x206" key={i}>
                      <div className="fcd-x207">{c.lbl}</div>
                      <div style={{ color: c.col, fontSize: '1.5rem', fontWeight: 'bold' }}>{c.val}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="fcd-x204">Operaciones cargadas (pestaña “Asignar Operaciones”)</div>
                <div className="fcd-x205">
                  {[
                    { lbl: (fechaDesdeOps || fechaHastaOps) ? 'Completadas en rango' : 'Completadas (todas)', val: diagnostico.rangoTotal, col: '#c9d1d9' },
                    { lbl: 'Ya facturadas', val: diagnostico.rangoFacturadas, col: '#3fb950' },
                    { lbl: 'Por facturar', val: diagnostico.rangoPorFacturar, col: '#f59e0b' },
                  ].map((c, i) => (
                    <div className="fcd-x206" key={i}>
                      <div className="fcd-x207">{c.lbl}</div>
                      <div style={{ color: c.col, fontSize: '1.5rem', fontWeight: 'bold' }}>{c.val}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="fcd-x204">Posibles pendientes a revisar</div>
                <div className="fcd-x208">
                  {[
                    { ok: diagnostico.huerfanas === 0, txt: diagnostico.huerfanas === 0 ? 'No hay operaciones marcadas como facturadas sin factura asociada.' : `${diagnostico.huerfanas} operación(es) marcadas como facturadas pero sin factura que las referencie.` },
                    { ok: diagnostico.invoicesDuplicados === 0, txt: diagnostico.invoicesDuplicados === 0 ? 'No hay invoices duplicados (mismo # y cliente).' : `${diagnostico.invoicesDuplicados} invoice(s) aparecen duplicados (mismo # y cliente).` },
                    { ok: diagnostico.sinMoneda === 0, txt: diagnostico.sinMoneda === 0 ? 'Todas las facturas resuelven su moneda.' : `${diagnostico.sinMoneda} factura(s) sin moneda (ni propia ni por cliente).`, warn: true },
                    { ok: diagnostico.sinFecha === 0, txt: diagnostico.sinFecha === 0 ? 'Todas las facturas tienen fecha.' : `${diagnostico.sinFecha} factura(s) sin fecha de facturación.`, warn: true },
                    { ok: diagnostico.sinTotal === 0, txt: diagnostico.sinTotal === 0 ? 'Todas las facturas tienen total.' : `${diagnostico.sinTotal} factura(s) con total en $0 (datos importados sin monto).`, warn: true },
                    { ok: !diagnostico.topeFacturas, txt: diagnostico.topeFacturas ? `Se alcanzó el tope de ${LIMITE_FACTURAS_TODAS} facturas cargadas: podría faltar información.` : `Se cargaron todas las facturas (sin alcanzar el tope de ${LIMITE_FACTURAS_TODAS}).` },
                  ].map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', color: r.ok ? '#3fb950' : (r.warn ? '#f59e0b' : '#f85149') }}>
                      <span className="fcd-x209">{r.ok ? '✓' : (r.warn ? '' : '✕')}</span>
                      <span className="fcd-x11">{r.txt}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="fcd-x210">
                Nota: el total en $0 y la fecha vacía en muchas facturas vienen de la importación del sistema anterior. La moneda se completa con la del cliente cuando la factura no la trae. El # de referencia (TR) y el # de remolque se resuelven al ver cada página del historial.
              </div>
            </div>
            <div className="fcd-x211">
              <button onClick={() => { try { almacenSesion.removeItem(SS_FACTURAS); } catch {} ; setFacturasGlobales([]); setOpInfoMap({}); setModalDiagnostico(false); }}
                style={{ ...btnDirStyle }} title="Volver a leer todas las facturas desde la base de datos">↻ Recargar facturas</button>
              <button className="fcd-x212" onClick={() => setModalDiagnostico(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {gestionOp && (
        <div className="modal-overlay fcd-x213">
          <div className="fcd-x141">
            <div className="fcd-x214">
              <h2 className="fcd-x215">Gestionar operación facturada</h2>
              <button className="fcd-x45" onClick={() => setGestionOp(null)}>✕</button>
            </div>

            <div className="fcd-x216">
              Operación: <b className="fcd-x217">{gestionOp.numReferencia || gestionOp.referencia || gestionOp.ref || String(gestionOp.id).substring(0, 6)}</b><br />
              Factura actual: <b className="fcd-x218">{invoiceDeOp(gestionOp) || '—'}</b>
            </div>

            <div className="fcd-x219">
              <label className="fcd-x220">NUEVO NÚMERO DE FACTURA</label>
              <input className="fcd-x150" type="text" value={gestionInvoice} onChange={e => setGestionInvoice(e.target.value)} placeholder="Ej. INV-2026-001" />
              <p className="fcd-x221">
                La operación se moverá a la factura con ese número (del mismo cliente). Si no existe, se crea; si la factura original queda sin operaciones, se elimina. El Historial se actualiza solo.
              </p>
            </div>

            <div className="fcd-x222">
              <button onClick={() => quitarOpDeFactura(gestionOp)} disabled={guardandoGestionOp}
                style={{ padding: '8px 18px', backgroundColor: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', cursor: guardandoGestionOp ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoGestionOp ? 0.7 : 1 }}>
                ✕ Quitar de la factura
              </button>
              <div className="fcd-x223">
                <button className="fcd-x224" onClick={() => setGestionOp(null)} disabled={guardandoGestionOp}>Cancelar</button>
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
        <div className="modal-overlay fcd-x213">
          <div className="fcd-x225">
            <div className="fcd-x226">
              <div>
                <h2 className="fcd-x215">Agregar referencia a la factura</h2>
                <span className="fcd-x7">
                  Factura <b className="fcd-x218">{agregarRefFactura.invoice}</b> · {agregarRefFactura.clienteNombre || getNombreCliente(agregarRefFactura.clienteId) || '-'}
                </span>
              </div>
              <button className="fcd-x45" onClick={() => setAgregarRefFactura(null)}>✕</button>
            </div>

            <div className="fcd-x227">
              <svg className="fcd-x22" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input className="fcd-x23" type="text" autoFocus placeholder="Buscar operación pendiente por referencia o # remolque..." value={busquedaRefPendiente} onChange={e => setBusquedaRefPendiente(e.target.value)} />
            </div>

            <div className="fcd-x228">
              {cargandoOperaciones ? (
                <div className="fcd-x229">Cargando operaciones pendientes...</div>
              ) : operacionesGlobales.length === 0 ? (
                <div className="fcd-x230">
                  No hay operaciones cargadas.
                  <div className="fcd-x231">
                    <button onClick={() => descargarOpsCompletadas(true)} style={{ ...btnDirStyle, color: '#58a6ff', margin: '0 auto' }}>↻ Cargar operaciones</button>
                  </div>
                </div>
              ) : candidatosPendientes.length === 0 ? (
                <div className="fcd-x230">
                  No se encontraron operaciones pendientes{agregarRefFactura.clienteId ? ' de este cliente' : ''}{busquedaRefPendiente.trim() ? ` para "${busquedaRefPendiente}"` : ''}.
                </div>
              ) : (
                candidatosPendientes.map((op: any) => {
                  const mm = obtenerMontoOperacion(op);
                  return (
                    <div className="fcd-x232" key={op.id}>
                      <div className="fcd-x233">
                        <div className="fcd-x234">{op.numReferencia || op.referencia || op.ref || String(op.id).substring(0, 6)}</div>
                        <div className="fcd-x235">
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

            <div className="fcd-x236">
              <span className="fcd-x237">Solo se muestran operaciones <b className="fcd-x1">sin facturar</b>{agregarRefFactura.clienteId ? ' del mismo cliente' : ''} (máx. 50).</span>
              <button className="fcd-x238" onClick={() => setAgregarRefFactura(null)}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {facturaEditando && (
        <div className="modal-overlay fcd-x239">
          <div className="fcd-x240">
            <div className="fcd-x142">
              <h2 className="fcd-x143">Editar Factura</h2>
              <button className="fcd-x45" onClick={() => setFacturaEditando(null)}>✕</button>
            </div>

            {/* ✅ NUEVO — el cliente de la factura ahora es EDITABLE (corrige
                facturas a nombre del cliente equivocado; Pagos lo hereda). */}
            <div className="fcd-x241" style={{ display: 'block' }}>
              <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Cliente de la factura</label>
              <SelectBuscable
                opciones={empresasList
                  .slice()
                  .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }))
                  .map((e: any) => ({ value: e.id, label: String(e.nombre || e.id) }))}
                value={editClienteId}
                onChange={setEditClienteId}
                placeholder="Buscar cliente..."
              />
              {Array.isArray(facturaEditando.__groupIds) && facturaEditando.__groupIds.length > 1 && (
                <span> · <b className="fcd-x242">{facturaEditando.__groupIds.length} documentos agrupados</b> (el total se asigna al primero)</span>
              )}
            </div>

            <div className="fcd-x163">
              <div className="fcd-x164">
                <label className="fcd-x146">STATUS DE LA FACTURA</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: colorStatusFactura(editStatus), border: `1px solid ${colorStatusFactura(editStatus)}`, borderRadius: '6px', fontWeight: 'bold', boxSizing: 'border-box' }}>
                  {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  {!STATUS_FACTURA_OPCIONES.includes(editStatus) && editStatus && <option value={editStatus}>{editStatus}</option>}
                </select>
              </div>
              <div className="fcd-x164">
                <label className="fcd-x146">NÚMERO DE INVOICE</label>
                <input className="fcd-x150" type="text" value={editInvoice} onChange={e => setEditInvoice(e.target.value)} placeholder="Ej. INV-2026-001" />
              </div>
              <div>
                <label className="fcd-x146">FECHA DE FACTURACIÓN</label>
                <input className="fcd-x243" type="date" value={editFecha} onChange={e => setEditFecha(e.target.value)} />
              </div>
              <div>
                <label className="fcd-x146">MONEDA</label>
                <select className="fcd-x244" value={editMoneda} onChange={e => setEditMoneda(e.target.value)}>
                  <option value="">(Sin definir / del cliente)</option>
                  <option value="USD">USD</option>
                  <option value="MXN">MXN</option>
                </select>
              </div>
              <div>
                <label className="fcd-x146">TOTAL FACTURADO</label>
                <input className="fcd-x245" type="number" step="any" value={editTotal} onChange={e => setEditTotal(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="fcd-x146">FACTURA CCP (Opcional)</label>
                <input className="fcd-x151" type="text" value={editCcp} onChange={e => setEditCcp(e.target.value)} placeholder="Referencia CCP..." />
              </div>
            </div>

            <div className="fcd-x246">
              <button className="fcd-x153" onClick={() => setFacturaEditando(null)} disabled={guardandoEdit}>Cancelar</button>
              <button onClick={handleGuardarEdicionFactura} disabled={guardandoEdit} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: guardandoEdit ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoEdit ? 0.7 : 1 }}>{guardandoEdit ? 'Guardando...' : 'Guardar cambios'}</button>
            </div>
          </div>
        </div>
      )}

      {(operacionDetalle || cargandoDetalle) && (
        <div className="modal-overlay fcd-x247">
          <div className="form-card detail-card fcd-x248">
            {cargandoDetalle || !operacionDetalle ? (
              <div className="fcd-x249">Cargando detalle de la operación...</div>
            ) : (
              <>
                <div className="form-header fcd-x250">
                  <div className="fcd-x251">
                    <div>
                      <h2 className="fcd-x252">Detalle de Operación</h2>
                      <div className="fcd-x253">
                        <span className="fcd-x254">{det.ref || det.id?.substring(0, 6)}</span>
                        <span className="fcd-x255">{txt(det.statusNombre, det.status)}</span>
                      </div>
                    </div>
                    <button className="fcd-x256" onClick={() => setOperacionDetalle(null)} onMouseEnter={(e) => e.currentTarget.style.color = '#f0f6fc'} onMouseLeave={(e) => e.currentTarget.style.color = '#8b949e'}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                </div>

                <div className="fcd-x257">
                  {tabsDetalle.map(tab => (
                    <button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)}
                      style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontWeight: pestañaDetalleActiva === tab.id ? 600 : 'normal', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="detail-content fcd-x258">
                  {pestañaDetalleActiva === 'general' && (
                    <div className="fcd-x259">
                      <div><span className="fcd-x260">Tipo de Operación</span><span className="fcd-x261">{txt(det.tipoOperacionNombre, det.tipoOperacionId)}</span></div>
                      <div><span className="fcd-x260">Fecha de Servicio / Status</span><span className="fcd-x261">{mostrarDato(det.fechaServicio)} <span className="fcd-x262">|</span> <span className="fcd-x263">{txt(det.statusNombre, det.status)}</span></span></div>
                      {evalIsFletes ? (
                        <div><span className="fcd-x260">Fecha de Cita</span><span className="fcd-x261">{formatearFechaHora(det.fechaCita)}</span></div>
                      ) : (<div></div>)}
                      <div className="fcd-x186"><hr className="fcd-x264" /></div>
                      <div><span className="fcd-x265">Cliente (Paga)</span><span className="fcd-x261">{txt(det.clienteNombre, det.nombreCliente, det.clientePaga)}</span></div>
                      <div><span className="fcd-x265">Convenio (Tarifa)</span><span className="fcd-x261">{txt(det.convenioNombre, det.convenio)}</span></div>
                      <div><span className="fcd-x265"># de Remolque</span><span className="fcd-x261">{txt(det.remolqueNombre, det.remolquePlaca, det.numeroRemolque)}</span></div>
                      <div><span className="fcd-x265">Ref Cliente</span><span className="fcd-x261">{mostrarDato(det.refCliente)}</span></div>
                      <div><span className="fcd-x266">Origen</span><span className="fcd-x261">{txt(det.origenNombre, det.origen)}</span></div>
                      <div><span className="fcd-x266">Destino</span><span className="fcd-x261">{txt(det.destinoNombre, det.destino)}</span></div>
                      <div className="fcd-x267"><span className="fcd-x265">Observaciones Ejecutivo</span><div className="fcd-x268">{mostrarDato(det.observacionesEjecutivo)}</div></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'pedimento' && (
                    <div className="fcd-x259">
                      <div className="fcd-x164"><span className="fcd-x265">Cliente (Mercancía)</span><span className="fcd-x261">{txt(det.clienteMercanciaNombre, det.clienteMercancia)}</span></div>
                      <div><span className="fcd-x265">Descripción de la Mercancía</span><span className="fcd-x261">{mostrarDato(det.descripcionMercancia)}</span></div>
                      <div className="fcd-x186"><hr className="fcd-x264" /></div>
                      <div><span className="fcd-x265">Cantidad (Enteros)</span><span className="fcd-x261">{mostrarDato(det.cantidad)}</span></div>
                      <div><span className="fcd-x265">Embalaje</span><span className="fcd-x261">{txt(det.embalajeNombre, det.embalaje)}</span></div>
                      <div><span className="fcd-x265">Peso (Kg)</span><span className="fcd-x261">{mostrarDato(det.pesoKg)}</span></div>
                      <div className="fcd-x186"><hr className="fcd-x264" /></div>
                      <div><span className="fcd-x265"># DODA</span><span className="fcd-x261">{mostrarDato(det.numDoda)}</span></div>
                      <div><span className="fcd-x265">Fecha de Emisión (DODA)</span><span className="fcd-x261">{mostrarDato(det.fechaEmisionDoda)}</span></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'manifiestos' && (
                    <div className="fcd-x259">
                      <div><span className="fcd-x265"># de Entry's</span><span className="fcd-x261">{mostrarDato(det.numeroEntrys)}</span></div>
                      <div><span className="fcd-x265">Cantidad de Entry's</span><span className="fcd-x261">{mostrarDato(det.cantEntrys)}</span></div>
                      <div className="fcd-x186"><hr className="fcd-x264" /></div>
                      <div><span className="fcd-x265"># Manifiesto</span><span className="fcd-x261">{mostrarDato(det.numManifiesto)}</span></div>
                      <div><span className="fcd-x265">Proveedor de Servicios</span><span className="fcd-x261">{txt(det.provServiciosNombre, det.provServicios)}</span></div>
                      <div><span className="fcd-x265">Costo Manifiesto ($)</span><span className="fcd-x269">{formatoMoneda(det.montoManifiesto)}</span></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'unidad' && (
                    <div>
                      <div className="fcd-x270">
                        <div className="fcd-x186"><span className="fcd-x265">Proveedor de Transporte</span><span className="fcd-x271">{txt(det.proveedorUnidadNombre, det.proveedorUnidad)}</span></div>
                      </div>
                      <div className="fcd-x272">
                        <div className="fcd-x273">
                          <div><span className="fcd-x265">Facturado En:</span><span className="fcd-x261">{det.monedaUnidadNombre || mostrarMoneda(det.facturadoEnUnidad)}</span></div>
                          <div><span className="fcd-x265">Convenio Proveedor</span><span className="fcd-x261">{txt(det.convenioProveedorNombre, det.convenioProveedor)}</span></div>
                          <div><span className="fcd-x265">Moneda del Convenio (Base)</span><span className="fcd-x261">{mostrarMoneda(det.monedaConvenioProv)}</span></div>
                        </div>
                        <div className="fcd-x274">
                          <div><span className="fcd-x265">Monto a Pagar (Base)</span><span className="fcd-x261">{formatoMoneda(det.totalAPagarProv)}</span></div>
                          <div><span className="fcd-x265">Costos Adicionales</span><span className="fcd-x261">{formatoMoneda(det.cargosAdicionalesProv)}</span></div>
                          <div><span className="fcd-x260">Subtotal (Convenio + Costos)</span><span className="fcd-x275">{formatoMoneda(det.subtotalProv)}</span></div>
                        </div>
                        <div className="fcd-x276">
                          <div><span className="fcd-x265">Dólares</span><span className="fcd-x277">{formatoMoneda(det.dolaresProv)}</span></div>
                          <div><span className="fcd-x265">Pesos</span><span className="fcd-x277">{formatoMoneda(det.pesosProv)}</span></div>
                          <div><span className="fcd-x278">Conversión Final (Gasto)</span><span className="fcd-x279">{formatoMoneda(det.conversionProv)}</span></div>
                        </div>
                      </div>

                      {showDetailInternalFleet && (
                        <div className="fcd-x270">
                          <div className="fcd-x186"><h4 className="fcd-x280">Flota Operativa (Roelca)</h4></div>
                          <div><span className="fcd-x265">Unidad Asignada</span><span className="fcd-x261">{txt(det.unidadNombre, det.unidad)}</span></div>
                          <div className="fcd-x164"><span className="fcd-x265">Operador Asignado</span><span className="fcd-x261">{txt(det.operadorNombre, det.operador)}</span></div>
                          <div className="fcd-x186"><hr className="fcd-x187" /></div>
                          <div><span className="fcd-x265">Sueldo del Operador</span><span className="fcd-x261">{formatoMoneda(det.sueldoOperador)}</span></div>
                          <div><span className="fcd-x265">Sueldo Extra</span><span className="fcd-x261">{formatoMoneda(det.sueldoExtra)}</span></div>
                          <div><span className="fcd-x260">Sueldo Total</span><span className="fcd-x281">{formatoMoneda(det.sueldoTotal)}</span></div>
                          <div className="fcd-x186"><hr className="fcd-x187" /></div>
                          <div><span className="fcd-x265">Combustible</span><span className="fcd-x261">{formatoMoneda(det.combustible)}</span></div>
                          <div><span className="fcd-x265">Combustible Extra</span><span className="fcd-x261">{formatoMoneda(det.combustibleExtra)}</span></div>
                          <div><span className="fcd-x260">Total Combustible</span><span className="fcd-x275">{formatoMoneda(det.combustibleTotal)}</span></div>
                        </div>
                      )}

                      {showDetailExternalFleet && (
                        <div className="fcd-x270">
                          <div className="fcd-x186"><h4 className="fcd-x282">Flota Externa (Proveedor)</h4></div>
                          <div><span className="fcd-x266">Unidad Externa</span><span className="fcd-x261">{mostrarDato(det.unidadProveedor)}</span></div>
                          <div className="fcd-x164"><span className="fcd-x266">Operador Externo</span><span className="fcd-x261">{mostrarDato(det.operadorProveedor)}</span></div>
                        </div>
                      )}

                      <div className="fcd-x283">
                        <div className="fcd-x284">
                          <div className="fcd-x285">Total Gastos [Sueldos + Manifiesto]</div>
                          <div className="fcd-x286">{formatoMoneda(det.totalGastos)}</div>
                        </div>
                      </div>

                      <div className="fcd-x287">
                        <span className="fcd-x288">Observaciones (Unidad / Proveedor)</span>
                        <div className="fcd-x289">{mostrarDato(det.observacionesUnidad)}</div>
                      </div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'cobrar' && (
                    <div>
                      <div className="fcd-x270">
                        <div><span className="fcd-x265">Facturado En:</span><span className="fcd-x261">{det.monedaCobroNombre || mostrarMoneda(det.facturadoEnCobrar)}</span></div>
                        <div><span className="fcd-x265">Moneda Convenio (Cliente)</span><span className="fcd-x261">{mostrarMoneda(det.monedaConvenioCliente)}</span></div>
                        <div><span className="fcd-x265">Convenio Seleccionado (Base)</span><span className="fcd-x261">{formatoMoneda(det.montoConvenioCliente)}</span></div>
                        <div><span className="fcd-x265">Cargos Adicionales</span><span className="fcd-x261">{formatoMoneda(det.cargosAdicionales)}</span></div>
                        <div><span className="fcd-x260">Subtotal (Convenio + Cargos)</span><span className="fcd-x290">{formatoMoneda(det.subtotalCliente)}</span></div>
                        <div><span className="fcd-x265">Tipo de Cambio del Día</span><span className="fcd-x261">{mostrarDato(det.tipoCambioAprobado)}</span></div>
                      </div>
                      <div className="fcd-x291">
                        <div><span className="fcd-x265">Dólares (Cliente)</span><span className="fcd-x292">{formatoMoneda(det.dolaresCliente)}</span></div>
                        <div><span className="fcd-x265">Pesos (Cliente)</span><span className="fcd-x277">{formatoMoneda(det.pesosCliente)}</span></div>
                        <div><span className="fcd-x260">Conversión Final (Ingreso)</span><span className="fcd-x293">{formatoMoneda(det.conversionCliente)}</span></div>
                      </div>
                      <div className="fcd-x294">
                        <span className="fcd-x295">Utilidad Estimada de la Operación (Ingreso - Gasto)</span>
                        <span className="fcd-x296">{formatoMoneda(det.utilidadEstimada)}</span>
                      </div>
                      <div className="fcd-x287">
                        <span className="fcd-x288">Observaciones (Facturación / Cobro)</span>
                        <div className="fcd-x289">{mostrarDato(det.observacionesCobrar)}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-actions fcd-x297">
                  <button onClick={() => setOperacionDetalle(null)} className="btn btn-outline fcd-x298">Cerrar Detalle</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ MODAL ENCABEZADO DE REMISIONES (emisores) ════════════════ */}
      {modalEmisores && (
        <div className="modal-overlay fcd-x299">
          <div className="fcd-x300">
            <div className="fcd-x301">
              <h2 className="fcd-x143">Encabezado de las Remisiones</h2>
              <button className="fcd-x45" onClick={() => setModalEmisores(false)}>✕</button>
            </div>
            <p className="fcd-x302">
              El nombre y los datos que van en la parte superior de la remisión dependen de la <b className="fcd-x11">moneda</b> de la factura:
              las remisiones en <b className="fcd-x303">PESOS (MXN)</b> salen a nombre de <b className="fcd-x11">Rolando</b> y las de
              <b className="fcd-x304"> DÓLARES (USD)</b> a nombre de <b className="fcd-x11">Camila</b>. Esta configuración se guarda para todos los usuarios.
            </p>

            <div className="fcd-x305">
              {/* MXN → Rolando */}
              <div className="fcd-x306">
                <div className="fcd-x307">PESOS (MXN) · Rolando</div>
                <div className="fcd-x308">
                  <label style={rLabelStyle}>NOMBRE (aparece arriba)</label>
                  <input type="text" value={emisorMXN.facturaNombre} onChange={e => setEmisorMXN({ ...emisorMXN, facturaNombre: e.target.value })} style={rInputStyle} />
                </div>
                <div className="fcd-x308">
                  <label style={rLabelStyle}>DIRECCIÓN</label>
                  <input type="text" value={emisorMXN.direccion} onChange={e => setEmisorMXN({ ...emisorMXN, direccion: e.target.value })} style={rInputStyle} />
                </div>
                <div className="fcd-x308">
                  <label style={rLabelStyle}>CIUDAD / ESTADO / TEL.</label>
                  <input type="text" value={emisorMXN.ciudadEstado} onChange={e => setEmisorMXN({ ...emisorMXN, ciudadEstado: e.target.value })} style={rInputStyle} />
                </div>
                <div>
                  <label style={rLabelStyle}>EMAIL</label>
                  <input type="text" value={emisorMXN.email} onChange={e => setEmisorMXN({ ...emisorMXN, email: e.target.value })} style={rInputStyle} />
                </div>
              </div>

              {/* USD → Camila */}
              <div className="fcd-x309">
                <div className="fcd-x310">DÓLARES (USD) · Camila</div>
                <div className="fcd-x308">
                  <label style={rLabelStyle}>NOMBRE (aparece arriba)</label>
                  <input type="text" value={emisorUSD.facturaNombre} onChange={e => setEmisorUSD({ ...emisorUSD, facturaNombre: e.target.value })} style={rInputStyle} />
                </div>
                <div className="fcd-x308">
                  <label style={rLabelStyle}>DIRECCIÓN</label>
                  <input type="text" value={emisorUSD.direccion} onChange={e => setEmisorUSD({ ...emisorUSD, direccion: e.target.value })} style={rInputStyle} />
                </div>
                <div className="fcd-x308">
                  <label style={rLabelStyle}>CIUDAD / ESTADO / TEL.</label>
                  <input type="text" value={emisorUSD.ciudadEstado} onChange={e => setEmisorUSD({ ...emisorUSD, ciudadEstado: e.target.value })} style={rInputStyle} />
                </div>
                <div>
                  <label style={rLabelStyle}>EMAIL</label>
                  <input type="text" value={emisorUSD.email} onChange={e => setEmisorUSD({ ...emisorUSD, email: e.target.value })} style={rInputStyle} />
                </div>
              </div>
            </div>

            <div className="fcd-x152">
              <button className="fcd-x153" onClick={() => setModalEmisores(false)} disabled={guardandoEmisores}>Cancelar</button>
              <button onClick={guardarEmisores} disabled={guardandoEmisores} style={{ padding: '8px 24px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: guardandoEmisores ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoEmisores ? 0.7 : 1 }}>{guardandoEmisores ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ MODAL VISTA PREVIA DE REMISIÓN (editable) ════════════════ */}
      {remisionPreview && (
        <div className="modal-overlay fcd-x311">
          <div className="fcd-x312">
            <div className="fcd-x313">
              <div>
                <h2 className="fcd-x143">Remisión · vista previa</h2>
                <div className="fcd-x314">
                  <button type="button" onClick={() => aplicarEmisorEnPreview(false)}
                    title="Usar el encabezado de PESOS (Rolando)"
                    style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer', backgroundColor: !remisionPreview.esUSD ? '#1f3a5f' : 'transparent', color: !remisionPreview.esUSD ? '#58a6ff' : '#8b949e', border: `1px solid ${!remisionPreview.esUSD ? '#3b82f6' : '#30363d'}` }}>
                    PESOS (MXN) · Rolando
                  </button>
                  <button type="button" onClick={() => aplicarEmisorEnPreview(true)}
                    title="Usar el encabezado de DÓLARES (Camila)"
                    style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer', backgroundColor: remisionPreview.esUSD ? '#12352a' : 'transparent', color: remisionPreview.esUSD ? '#10b981' : '#8b949e', border: `1px solid ${remisionPreview.esUSD ? '#10b981' : '#30363d'}` }}>
                    DÓLARES (USD) · Camila
                  </button>
                </div>
              </div>
              <button className="fcd-x45" onClick={() => setRemisionPreview(null)}>✕</button>
            </div>
            <p className="fcd-x315">
              Revisa y edita lo que necesites; luego pulsa <b className="fcd-x316">Generar PDF</b>. Se abrirá el diálogo de impresión donde puedes elegir <b className="fcd-x11">“Guardar como PDF”</b>.
            </p>

            {/* Emisor (encabezado) */}
            <div className="fcd-x317">
              <div className="fcd-x318">ENCABEZADO (EMISOR)</div>
              <div className="fcd-x319">
                <div><label style={rLabelStyle}>NOMBRE</label><input type="text" value={remisionPreview.emisorNombre} onChange={e => setRP('emisorNombre', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>EMAIL</label><input type="text" value={remisionPreview.emisorEmail} onChange={e => setRP('emisorEmail', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DIRECCIÓN</label><input type="text" value={remisionPreview.emisorDireccion} onChange={e => setRP('emisorDireccion', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CIUDAD / ESTADO / TEL.</label><input type="text" value={remisionPreview.emisorCiudadEstado} onChange={e => setRP('emisorCiudadEstado', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            {/* Datos de la remisión y del cliente */}
            <div className="fcd-x317">
              <div className="fcd-x320">DATOS DE LA REMISIÓN Y DEL CLIENTE</div>
              <div className="fcd-x321">
                <div><label style={rLabelStyle}># REMISIÓN</label><input type="text" value={remisionPreview.numero} onChange={e => setRP('numero', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>FECHA</label><input type="text" value={remisionPreview.fecha} onChange={e => setRP('fecha', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DENOMINACIÓN</label><input type="text" value={remisionPreview.moneda} onChange={e => setRP('moneda', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DÍAS CRÉDITO</label><input type="text" value={remisionPreview.diasCredito} onChange={e => setRP('diasCredito', e.target.value)} style={rInputStyle} /></div>
                <div className="fcd-x164"><label style={rLabelStyle}>CLIENTE</label><input type="text" value={remisionPreview.clienteNombre} onChange={e => setRP('clienteNombre', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>NUM. EXT/INT</label><input type="text" value={remisionPreview.numExtInt} onChange={e => setRP('numExtInt', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>COLONIA</label><input type="text" value={remisionPreview.colonia} onChange={e => setRP('colonia', e.target.value)} style={rInputStyle} /></div>
                <div className="fcd-x186"><label style={rLabelStyle}>DIRECCIÓN</label><input type="text" value={remisionPreview.direccion} onChange={e => setRP('direccion', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CIUDAD</label><input type="text" value={remisionPreview.ciudad} onChange={e => setRP('ciudad', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            {/* Renglones de servicios */}
            <div className="fcd-x317">
              <div className="fcd-x322">SERVICIOS ({(remisionPreview.filas || []).length})</div>
              <div className="fcd-x323">
                <table className="fcd-x324">
                  <thead>
                    <tr className="fcd-x325">
                      <th className="fcd-x326">REF#</th>
                      <th className="fcd-x326">FECHA</th>
                      <th className="fcd-x326">EQ.</th>
                      <th className="fcd-x326">ORIGEN</th>
                      <th className="fcd-x326">DESTINO</th>
                      <th className="fcd-x326">DESCRIPCIÓN</th>
                      <th className="fcd-x327">IMPORTE</th>
                      <th className="fcd-x328"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(remisionPreview.filas || []).map((r: any, idx: number) => (
                      <tr className="fcd-x329" key={idx}>
                        <td className="fcd-x330"><input value={r.ref} onChange={e => setRPFila(idx, 'ref', e.target.value)} style={{ ...rCellStyle, minWidth: '90px' }} /></td>
                        <td className="fcd-x330"><input value={r.fecha} onChange={e => setRPFila(idx, 'fecha', e.target.value)} style={{ ...rCellStyle, minWidth: '90px' }} /></td>
                        <td className="fcd-x330"><input value={r.equipo} onChange={e => setRPFila(idx, 'equipo', e.target.value)} style={{ ...rCellStyle, minWidth: '60px' }} /></td>
                        <td className="fcd-x330"><input value={r.origen} onChange={e => setRPFila(idx, 'origen', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                        <td className="fcd-x330"><input value={r.destino} onChange={e => setRPFila(idx, 'destino', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                        <td className="fcd-x330"><input value={r.descripcion} onChange={e => setRPFila(idx, 'descripcion', e.target.value)} style={{ ...rCellStyle, minWidth: '160px' }} /></td>
                        <td className="fcd-x330"><input type="number" step="any" value={r.importe} onChange={e => setRPFila(idx, 'importe', e.target.value)} style={{ ...rCellStyle, minWidth: '90px', textAlign: 'right', color: '#3fb950' }} /></td>
                        <td className="fcd-x331">
                          <button className="fcd-x332" onClick={() => quitarFilaRemision(idx)} title="Quitar renglón">✕</button>
                        </td>
                      </tr>
                    ))}
                    {(remisionPreview.filas || []).length === 0 && (
                      <tr><td className="fcd-x333" colSpan={8}>Sin renglones.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pie: tipo de cambio, total, observaciones */}
            <div className="fcd-x334">
              <div><label style={rLabelStyle}>FECHA TIPO DE CAMBIO (DOF)</label><input type="text" value={remisionPreview.fechaTipoCambio} onChange={e => setRP('fechaTipoCambio', e.target.value)} placeholder="Ej. 24/06/2026" style={rInputStyle} /></div>
              <div><label style={rLabelStyle}>TIPO DE CAMBIO</label><input type="text" value={remisionPreview.tipoCambio} onChange={e => setRP('tipoCambio', e.target.value)} placeholder="Ej. 17.5505" style={rInputStyle} /></div>
              <div><label style={rLabelStyle}>TOTAL</label><input type="number" step="any" value={remisionPreview.total} onChange={e => setRP('total', e.target.value)} style={{ ...rInputStyle, color: '#3fb950', fontWeight: 'bold' }} /></div>
              <div className="fcd-x186"><label style={rLabelStyle}>OBSERVACIONES</label><input type="text" value={remisionPreview.observaciones} onChange={e => setRP('observaciones', e.target.value)} style={rInputStyle} /></div>
            </div>

            <div className="fcd-x246">
              <button className="fcd-x153" onClick={() => setRemisionPreview(null)}>Cerrar</button>
              <button className="fcd-x335" onClick={generarPDFDeRemision}>Generar PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
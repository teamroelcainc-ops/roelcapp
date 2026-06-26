// src/features/facturacion/components/FacturacionProveedoresDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// MISMAS CORRECCIONES QUE FacturacionClientesDashboard
// ═══════════════════════════════════════════════════════════════════════
// A) CONFIGURACIÓN DE COLUMNAS COMPARTIDA (global para todos los usuarios):
//    · Al pulsar "Guardar para todos" en cualquiera de los dos modales de
//      "Configurar Columnas", la selección + el ORDEN se guardan en Firestore:
//          config_columnas/facturacion_proveedores_ops
//          config_columnas/facturacion_proveedores_historial
//    · Al abrir el módulo, esa configuración se lee una sola vez y se aplica
//      para TODOS los usuarios que vean la vista.
//    · Solo se persiste { id, visible } + orden; el resto de metadatos siempre
//      se toma del código (BASE), así las columnas nuevas siguen apareciendo.
//
// B) MOSTRAR NOMBRES EN LUGAR DE IDs:
//    · Mapa id→nombre con TODOS los catálogos ya cacheados (cat_v1__* y, de
//      respaldo, roelca_catalogos_v2) + empresas + monedas. Cero lecturas
//      extra a Firestore. Se aplica en tabla, Excel y ficha de detalle.
//
// (Correcciones anteriores que se conservan)
// 1) FILTRO PRINCIPAL = RANGO DE FECHAS (Desde / Hasta). Proveedor OPCIONAL.
// 2) "Asignar Operaciones" muestra SOLO operaciones NO facturadas.
// 3) LECTURAS MÍNIMAS (caché-primero para empresas, consultas acotadas).
//
// Trabaja el lado "POR PAGAR" (proveedor de transporte):
//   subtotal = totalAPagarProv + cargosAdicionalesProv ; moneda por
//   facturadoEnUnidad/monedaUnidadNombre ; conversión = conversionProv.
//   Facturas en `facturas_proveedores`; la operación facturada se marca con
//   facturaProveedorId / facturadoProveedor.
// (Se conservan: conversión USD/MXN, exportación a Excel con columnas
//  configurables, ficha de factura y detalle de operación.)
//
// ⚠️ CONFIGURACIÓN: ajusta ID_TIPO_PROVEEDOR con el ID del tipo "Proveedor"
//    de tu catálogo de empresas. Si lo dejas en '', el buscador mostrará TODAS
//    las empresas. CAMPO_PROVEEDOR_OP es el campo de la operación que apunta al
//    proveedor (por defecto 'proveedorUnidad').
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
const ID_TIPO_PROVEEDOR = '';            // ID del tipo "Proveedor" en tiposEmpresa. Vacío = muestra todas las empresas.
const CAMPO_PROVEEDOR_OP = 'proveedorUnidad'; // campo de la operación que referencia al proveedor
const STATUS_COMPLETADOS = ['f557b751', 'c2d57403'];
const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// Límites para acotar lecturas (ajustables).
const LIMITE_OPS_RANGO = 400;
// Carga total del historial (paginado) para que el índice de operaciones
// facturadas sea completo, y caché de sesión para no releer miles de docs.
const LIMITE_FACTURAS_TODAS = 12000;
const PAG_FACTURAS = 1000;
const SS_FACTURAS = 'roelca_facturas_proveedores_v1';
const SS_FACTURAS_TTL = 30 * 60 * 1000; // 30 min

// ✅ (A) Documento(s) de configuración de columnas COMPARTIDA en Firestore.
const CONFIG_COLUMNAS_COLLECTION = 'config_columnas';
const DOC_COLUMNAS_OPS = 'facturacion_proveedores_ops';
const DOC_COLUMNAS_HISTORIAL = 'facturacion_proveedores_historial';

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
  base.forEach((c: any) => { if (!usados.has(c.id)) resultado.push({ ...c }); });
  return resultado;
};

// Columnas configurables del Historial de Facturas (tabla + Excel).
const COLUMNAS_FACTURA_BASE = [
  { id: 'invoice', label: 'Factura Prov.', visible: true },
  { id: 'fecha', label: 'Fecha', visible: true },
  { id: 'proveedor', label: 'Proveedor', visible: true },
  { id: 'moneda', label: 'Moneda', visible: true },
  { id: 'facturaCcp', label: 'Referencia', visible: true },
  { id: 'referencias', label: 'Operaciones / Refs', visible: true },
  { id: 'cantOps', label: 'Cant. Ops', visible: true },
  { id: 'total', label: 'Total', visible: true },
  { id: 'createdAt', label: 'Registrada', visible: false },
];

// Columnas configurables de la tabla "Asignar Operaciones" (tabla + Excel).
const COLUMNAS_OPS_BASE = [
  { id: 'factura', label: '# Factura', visible: true, orden: false },
  { id: 'ref', label: 'Ref. Operación', visible: true, orden: true },
  { id: 'fechaServicio', label: 'Fecha Servicio', visible: true, orden: true },
  { id: 'proveedor', label: 'Proveedor', visible: true, orden: true },
  { id: 'cartaPorte', label: 'Carta Porte', visible: true, orden: false },
  { id: 'destino', label: 'Destino', visible: true, orden: true },
  { id: 'moneda', label: 'Moneda', visible: true, orden: false },
  { id: 'subtotal', label: 'Subtotal', visible: true, orden: true },
  { id: 'dolares', label: 'Dólares', visible: true, orden: false },
  { id: 'pesos', label: 'Pesos', visible: true, orden: false },
  { id: 'conv', label: 'Conversión', visible: true, orden: true },
];

// ──────────────────────────────────────────────────────────────────────
// Helpers de conversión del PROVEEDOR (misma lógica USD/MXN del formulario):
//   subtotal = totalAPagarProv + cargosAdicionalesProv
//     · USD -> dólares = subtotal ; conversión = subtotal * TC
//     · MXN -> pesos   = subtotal ; conversión = subtotal
// ──────────────────────────────────────────────────────────────────────
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
  else { conv = subtotal; } // moneda sin determinar: deja la conversión = subtotal
  return { subtotal, dol, pes, conv };
};

// Prefiere los valores ya calculados/guardados por el formulario; si no
// existen, recalcula con la misma fórmula.
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

  // Catálogos
  const [empresasList, setEmpresasList] = useState<any[]>([]);

  // ✅ (1) Filtro principal: rango de fechas (obligatorio). Proveedor opcional.
  const [fechaDesdeOps, setFechaDesdeOps] = useState('');
  const [fechaHastaOps, setFechaHastaOps] = useState('');
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  // ✅ Filtro de fechas INDEPENDIENTE para el Historial (opcional).
  const [fechaDesdeHist, setFechaDesdeHist] = useState('');
  const [fechaHastaHist, setFechaHastaHist] = useState('');
  // ✅ Búsqueda en el historial (factura, proveedor, ref, remolque, moneda).
  const [textoBuscarFactura, setTextoBuscarFactura] = useState('');
  // ✅ Mostrar también las ya facturadas en "Asignar Operaciones".
  const [mostrarFacturadas, setMostrarFacturadas] = useState(false);
  // ✅ Bandera: se alcanzó el tope de operaciones cargadas en el rango.
  const [topeOpsAlcanzado, setTopeOpsAlcanzado] = useState(false);
  // ✅ Info de operaciones resuelta bajo demanda (ref TR, remolque, moneda).
  const [opInfoMap, setOpInfoMap] = useState<Record<string, any>>({});
  // ✅ Diagnóstico / verificación.
  const [modalDiagnostico, setModalDiagnostico] = useState(false);

  const ambasFechas = !!(fechaDesdeOps && fechaHastaOps);

  // Orden
  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [ordenFac, setOrdenFac] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fecha', dir: 'desc' });

  // Buscador de proveedor
  const [textoBuscarProveedor, setTextoBuscarProveedor] = useState('');
  const [mostrarSugerenciasProveedor, setMostrarSugerenciasProveedor] = useState(false);

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
    empresasList.forEach((e: any) => {
      if (e?.id) m[String(e.id)] = e.nombre || e.nombreCorto || m[String(e.id)] || String(e.id);
    });
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
  // ✅ Cargar TODAS las facturas al MONTAR (paginado), para que el índice de
  //    operaciones facturadas esté disponible en ambas pestañas. Caché de
  //    sesión (30 min) para no releer miles de documentos por montaje.
  // ──────────────────────────────────────────────────────────────────
  const guardarCacheFacturas = (docs: any[]) => {
    try { sessionStorage.setItem(SS_FACTURAS, JSON.stringify({ ts: Date.now(), data: docs })); } catch { /* cuota */ }
  };

  useEffect(() => {
    if (facturasGlobales.length > 0) return;

    // 1) Caché de sesión primero.
    try {
      const raw = sessionStorage.getItem(SS_FACTURAS);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.data) && obj.data.length && (Date.now() - (obj.ts || 0)) < SS_FACTURAS_TTL) {
          setFacturasGlobales(obj.data);
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
          snap.docs.forEach(d => todas.push({ id: d.id, ...(d.data() as any) }));
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

  // ✅ Mantener la caché de sesión sincronizada cuando cambian las facturas.
  useEffect(() => {
    if (facturasGlobales.length > 0) guardarCacheFacturas(facturasGlobales);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales]);

  // ──────────────────────────────────────────────────────────────────
  // ✅ (1)(3) OPERACIONES por RANGO DE FECHAS + status completado (proveedor
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
        (!filtroProveedor || String(op[CAMPO_PROVEEDOR_OP] || op.proveedorUnidadId || '') === filtroProveedor)
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
        if (filtroProveedor) cons.unshift(where(CAMPO_PROVEEDOR_OP, '==', filtroProveedor));
        const snap = await getDocs(query(collection(db, 'operaciones'), ...cons));
        opsFinal = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setTopeOpsAlcanzado(snap.docs.length >= LIMITE_OPS_RANGO);
        exito = true;
      } catch (e1: any) {
        const msg1 = String(e1?.message || e1?.code || e1 || '');
        const esIndice = msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition');
        if (esIndice) {
          console.warn('[Facturación] Falta índice (status+fecha). Fallback por rango de fecha. Detalle:', msg1);
          try {
            // Sin índice compuesto: rango por fecha (índice automático) y se
            // filtra status/proveedor en memoria.
            const snap2 = await getDocs(query(
              collection(db, 'operaciones'),
              where('fechaServicio', '>=', fechaDesdeOps),
              where('fechaServicio', '<=', fechaHastaOps),
              orderBy('fechaServicio', 'desc'),
              limit(LIMITE_OPS_RANGO * 2),
            ));
            const todas = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            opsFinal = filtrarMem(todas).slice(0, LIMITE_OPS_RANGO);
            setTopeOpsAlcanzado(opsFinal.length >= LIMITE_OPS_RANGO);
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
  }, [fechaDesdeOps, fechaHastaOps, filtroProveedor, activeTab, ambasFechas]);

  // ──────────────────────────────────────────────────────────────────
  // Traductor de proveedores / buscador
  // ──────────────────────────────────────────────────────────────────
  const getNombreEmpresa = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = empresasList.find(e => e.id === idOrName || e.nombre === idOrName || e.nombreCorto === idOrName);
    if (found) return found.nombre || found.nombreCorto || idOrName;
    // ✅ (B) Fallback: otros catálogos cacheados (para datos viejos con ID).
    const porCatalogo = mapaCatalogos[String(idOrName)];
    return porCatalogo || idOrName;
  };

  const proveedoresFiltradosBuscador = useMemo(() => {
    if (!empresasList.length) return [];
    // Si no se configuró el tipo de proveedor, se muestran todas las empresas.
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

  // ──────────────────────────────────────────────────────────────────
  // ✅ ÍNDICE de operaciones facturadas (a partir de las facturas). El vínculo
  //    op↔factura vive en la factura (operacionesIds): mapa opId → factura.
  // ──────────────────────────────────────────────────────────────────
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

  // ✅ Moneda que corresponde al proveedor (desde su ficha de empresa).
  const monedaDeProveedor = (provId: any): string => {
    if (!provId) return '';
    const empresa = empresasList.find(e => e.id === provId);
    const idMoneda = empresa?.monedaRef || empresa?.moneda || empresa?.monedaProveedor;
    if (idMoneda === ID_MXN) return 'MXN';
    if (idMoneda === ID_USD) return 'USD';
    return idMoneda ? String(idMoneda) : '';
  };

  // Moneda a mostrar para una factura: la propia, o si es N/A la del proveedor.
  const monedaFacturaMostrar = (f: any): string => {
    const m = String(f.monedaProveedor || '').trim();
    if (m && m.toUpperCase() !== 'N/A') return m;
    return monedaDeProveedor(f.proveedorId) || 'N/A';
  };

  // ──────────────────────────────────────────────────────────────────
  // (2) "Facturada" = ligada a una factura (índice) o marcada en su doc.
  // ──────────────────────────────────────────────────────────────────
  const esFacturada = (op: any) => opIndex.has(String(op.id)) || !!op.facturaProveedorId || !!op.facturadoProveedor;
  const invoiceDeOp = (op: any): string => op.facturaProveedorFolio || opIndex.get(String(op.id))?.invoice || '';

  // Proveedor efectivo para la factura: el del filtro, o —si no hay filtro— el
  // único proveedor compartido por las operaciones seleccionadas.
  const proveedorFacturaId = useMemo(() => {
    if (filtroProveedor) return filtroProveedor;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = op?.[CAMPO_PROVEEDOR_OP] || op?.proveedorUnidadId;
      if (c) ids.add(String(c));
    });
    return ids.size === 1 ? [...ids][0] : '';
  }, [filtroProveedor, seleccionadas, operacionesGlobales]);

  const seleccionMultiProveedor = useMemo(() => {
    if (filtroProveedor) return false;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = op?.[CAMPO_PROVEEDOR_OP] || op?.proveedorUnidadId;
      if (c) ids.add(String(c));
    });
    return ids.size > 1;
  }, [filtroProveedor, seleccionadas, operacionesGlobales]);

  const nombreProveedorFactura = useMemo(() => {
    if (!proveedorFacturaId) return '';
    const porCatalogo = getNombreEmpresa(proveedorFacturaId);
    if (porCatalogo && porCatalogo !== proveedorFacturaId) return porCatalogo;
    const op = operacionesGlobales.find(o => String(o[CAMPO_PROVEEDOR_OP] || o.proveedorUnidadId || '') === proveedorFacturaId);
    return op?.proveedorUnidadNombre || proveedorFacturaId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorFacturaId, empresasList, operacionesGlobales]);

  const monedaProveedor = useMemo(() => {
    if (!proveedorFacturaId) return '-';
    const empresa = empresasList.find(e => e.id === proveedorFacturaId);
    if (!empresa) {
      const op = operacionesGlobales.find(o => String(o[CAMPO_PROVEEDOR_OP] || o.proveedorUnidadId || '') === proveedorFacturaId);
      return op?.monedaUnidadNombre || '-';
    }
    const idMoneda = empresa.monedaRef || empresa.moneda;
    if (idMoneda === ID_MXN) return 'MXN';
    if (idMoneda === ID_USD) return 'USD';
    return idMoneda || 'No definida en catálogo';
  }, [proveedorFacturaId, empresasList, operacionesGlobales]);

  const valorOrdenOp = (op: any, campo: string): string | number => {
    switch (campo) {
      case 'ref': return String(op.numReferencia || op.referencia || op.ref || op.id || '').toLowerCase();
      case 'fechaServicio': return String(op.fechaServicio || op.createdAt || '');
      case 'proveedor': return getNombreEmpresa(op[CAMPO_PROVEEDOR_OP] || op.proveedorUnidadId || op.proveedorUnidadNombre).toLowerCase();
      case 'destino': return String(op.destinoNombre || resolverNombre(op.destino) || '').toLowerCase();
      case 'subtotal': return obtenerMontoOperacion(op).subtotal;
      case 'conv': return obtenerMontoOperacion(op).conv;
      default: return '';
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

  // ✅ (2) Por defecto solo NO facturadas; con el toggle se muestran también
  //    las facturadas. Dentro del rango y ordenadas.
  const operacionesMostradas = useMemo(() => {
    if (!ambasFechas) return [];
    const lista = operacionesGlobales.filter(op => (mostrarFacturadas || !esFacturada(op)) && dentroRangoFecha(op));
    const dir = ordenOps.dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = valorOrdenOp(a, ordenOps.campo);
      const vb = valorOrdenOp(b, ordenOps.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, ambasFechas, ordenOps, empresasList, fechaDesdeOps, fechaHastaOps, mapaCatalogos, mostrarFacturadas, facturasGlobales]);

  // ✅ Conteos sobre TODO el rango cargado (no depende del toggle de visibilidad).
  const resumenOps = useMemo(() => {
    if (!ambasFechas) return { porFacturar: 0, facturadas: 0 };
    const enRango = operacionesGlobales.filter(op => dentroRangoFecha(op));
    const facturadas = enRango.filter(op => esFacturada(op)).length;
    const porFacturar = enRango.length - facturadas;
    return { porFacturar, facturadas };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, ambasFechas, fechaDesdeOps, fechaHastaOps, facturasGlobales]);

  // ──────────────────────────────────────────────────────────────────
  // ✅ DIAGNÓSTICO: verifica la consistencia con los datos cargados (sin
  //    lecturas extra). Útil para validar "¿está todo ok?".
  // ──────────────────────────────────────────────────────────────────
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

    const enRango = ambasFechas ? operacionesGlobales.filter(op => dentroRangoFecha(op)) : [];
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
  }, [facturasGlobales, opIndex, operacionesGlobales, ambasFechas, fechaDesdeOps, fechaHastaOps, empresasList, topeOpsAlcanzado]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });

  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const valorCeldaOps = (op: any, key: string, m: any) => {
    switch (key) {
      case 'factura': { const inv = invoiceDeOp(op); return inv || (esFacturada(op) ? 'Facturada' : 'Por facturar'); }
      case 'ref': return op.numReferencia || op.referencia || op.ref || op.id;
      case 'fechaServicio': return formatearFechaSpanish(op.fechaServicio || op.createdAt);
      case 'proveedor': return getNombreEmpresa(op[CAMPO_PROVEEDOR_OP] || op.proveedorUnidadId || op.proveedorUnidadNombre);
      case 'cartaPorte': return op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-';
      case 'destino': return op.destinoNombre || resolverNombre(op.destino) || '-';
      case 'moneda': return op.monedaUnidadNombre || mostrarMoneda(op.facturadoEnUnidad);
      case 'subtotal': return m.subtotal;
      case 'dolares': return m.dol;
      case 'pesos': return m.pes;
      case 'conv': return m.conv;
      default: return '-';
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
      case 'proveedor': return <td key={key} style={tdBase}>{getNombreEmpresa(op[CAMPO_PROVEEDOR_OP] || op.proveedorUnidadId || op.proveedorUnidadNombre)}</td>;
      case 'cartaPorte': return <td key={key} style={tdBase}>{op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destinoNombre || resolverNombre(op.destino) || '-'}</td>;
      case 'moneda': return <td key={key} style={tdBase}>{op.monedaUnidadNombre || mostrarMoneda(op.facturadoEnUnidad)}</td>;
      case 'subtotal': return <td key={key} style={tdBase}>{formatoMoneda(m.subtotal)}</td>;
      case 'dolares': return <td key={key} style={{ ...tdBase, color: '#10b981' }}>{formatoMoneda(m.dol)}</td>;
      case 'pesos': return <td key={key} style={{ ...tdBase, color: '#3b82f6' }}>{formatoMoneda(m.pes)}</td>;
      case 'conv': return <td key={key} style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.conv)}</td>;
      default: return <td key={key} style={tdBase}>-</td>;
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
    const cli = (filtroProveedor ? (nombreProveedorSeleccionado || 'proveedor') : 'todos').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
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
  // Guardado de factura (proveedor derivado; valida un solo proveedor)
  // ──────────────────────────────────────────────────────────────────
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
        };
      });

      const data = {
        invoice: invoiceForm.trim(),
        fecha: fechaForm,
        facturaCcp: facturaCcpForm.trim(),
        proveedorId: proveedorFacturaId,
        proveedorNombre: nombreProveedorFactura || getNombreEmpresa(proveedorFacturaId),
        monedaProveedor,
        operacionesIds: seleccionadas,
        operacionesGuardadas: operacionesResumenEstable,
        subtotalFactura: resumenSeleccion.subtotal,
        createdAt: new Date().toISOString(),
      };

      batch.set(doc(db, 'facturas_proveedores', nuevoId), data);
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), {
          facturaProveedorId: nuevoId,
          facturaProveedorFolio: invoiceForm.trim(),
          facturadoProveedor: true,
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
        idsFacturadas.includes(op.id) ? { ...op, facturaProveedorId: nuevoId, facturaProveedorFolio: invoiceForm.trim(), facturadoProveedor: true } : op
      ));
      setFacturasGlobales(prev => [{ id: nuevoId, ...data }, ...prev]);
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
        batch.delete(doc(db, 'facturas_proveedores', facData.id));
        if (Array.isArray(facData.operacionesIds)) {
          facData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), {
              facturaProveedorId: null,
              facturaProveedorFolio: null,
              facturadoProveedor: false,
            });
          });
        }
        await batch.commit();
        setFacturasGlobales(prev => prev.filter(f => f.id !== facData.id));
        const idsLiberadas: string[] = Array.isArray(facData.operacionesIds) ? facData.operacionesIds : [];
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false } : op
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
      case 'proveedor': return String(f.proveedorNombre || getNombreEmpresa(f.proveedorId) || '').toLowerCase();
      case 'moneda': return String(monedaFacturaMostrar(f) || '').toLowerCase();
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
      if (f.proveedorId) {
        const nom = getNombreEmpresa(f.proveedorId);
        if (nom && nom.toLowerCase().includes(q)) return true;
      }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(monedaFacturaMostrar(f) || '').toLowerCase().includes(q)) return true;
      // ✅ búsqueda por # de Remolque y referencia TR (por operación, resueltas)
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
      const fch = String(f.fecha || '').slice(0, 10);
      if (!fch) return true; // facturas sin fecha NO se ocultan
      if (fechaDesdeHist && fch < fechaDesdeHist) return false;
      if (fechaHastaHist && fch > fechaHastaHist) return false;
      return true;
    };

    return facturasGlobales
      .filter(f => coincideProveedor(f) && coincideFechas(f) && coincideTexto(f))
      .sort((a, b) => {
        const va = valorOrdenFac(a, ordenFac.campo);
        const vb = valorOrdenFac(b, ordenFac.campo);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, ordenFac, mapaCatalogos, textoBuscarFactura, filtroProveedor, fechaDesdeHist, fechaHastaHist, opInfoMap]);

  const toggleOrdenFac = (campo: string) =>
    setOrdenFac(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });

  const flechaFac = (campo: string) => ordenFac.campo === campo ? (ordenFac.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const totalPaginas = Math.ceil(historialOrdenado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialOrdenado.slice(indexFirst, indexLast);

  // ✅ Resolver bajo demanda la info real (ref TR, remolque, moneda) de las
  //    operaciones de las facturas visibles, en lotes por documentId (máx 30).
  useEffect(() => {
    if (activeTab !== 'historial' || registrosVisibles.length === 0) return;
    const faltantes = new Set<string>();
    registrosVisibles.forEach((f: any) => {
      (Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : []).forEach((op: any) => {
        const id = String(op?.id || '');
        if (id && !opInfoMap[id] && !/[-\s]/.test(id) && id.length >= 12) faltantes.add(id);
      });
    });
    if (faltantes.size === 0) return;
    let activo = true;
    (async () => {
      const ids = Array.from(faltantes).slice(0, 120);
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
              proveedorId: o[CAMPO_PROVEEDOR_OP] || o.proveedorUnidadId || '',
            };
          });
        } catch (e) { console.warn('No se pudo resolver lote de operaciones del historial:', e); }
      }
      if (activo && Object.keys(nuevos).length) setOpInfoMap(prev => ({ ...prev, ...nuevos }));
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrosVisibles, activeTab]);

  // Ref real de una operación guardada en factura (resuelta o tal cual).
  const refDeOp = (op: any): string => {
    const id = String(op?.id || '');
    const info = opInfoMap[id];
    if (info?.ref) return String(info.ref);
    const r = String(op?.ref || '');
    if (r && /[-\s]/.test(r)) return r;
    return r || id;
  };

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  useEffect(() => { setPaginaActual(1); }, [filtroProveedor, ordenFac, fechaDesdeHist, fechaHastaHist, textoBuscarFactura]);

  // ──────────────────────────────────────────────────────────────────
  // Columnas configurables — valor por columna + export
  // ──────────────────────────────────────────────────────────────────
  const nombreProveedorFactura_ = (f: any): string => {
    if (f.proveedorNombre) return f.proveedorNombre;
    if (f.proveedorId) {
      const nom = getNombreEmpresa(f.proveedorId);
      if (nom && nom !== f.proveedorId) return nom;
    }
    return '-';
  };

  const valorCeldaFactura = (f: any, colId: string): any => {
    switch (colId) {
      case 'invoice': return f.invoice || '';
      case 'fecha': return formatearFechaSpanish(f.fecha);
      case 'proveedor': return nombreProveedorFactura_(f);
      case 'moneda': return monedaFacturaMostrar(f);
      case 'facturaCcp': return f.facturaCcp || '-';
      case 'referencias':
        return Array.isArray(f.operacionesGuardadas)
          ? f.operacionesGuardadas.map((op: any) => refDeOp(op)).filter(Boolean).join(', ')
          : '-';
      case 'cantOps': return f.operacionesIds?.length || 0;
      case 'total': return Number(f.subtotalFactura) || 0;
      case 'createdAt': return f.createdAt ? formatearFechaHora(f.createdAt) : '-';
      default: return '-';
    }
  };

  const renderCeldaFactura = (f: any, colId: string) => {
    switch (colId) {
      case 'invoice': return <span style={{ color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace' }}>{f.invoice}</span>;
      case 'fecha': return <span style={{ color: '#c9d1d9' }}>{formatearFechaSpanish(f.fecha)}</span>;
      case 'proveedor': return <span style={{ color: '#f0f6fc' }}>{nombreProveedorFactura_(f)}</span>;
      case 'moneda': { const mon = monedaFacturaMostrar(f); return <span style={{ color: mon === 'N/A' ? '#8b949e' : '#10b981', fontWeight: 'bold' }}>{mon}</span>; }
      case 'facturaCcp': return <span style={{ color: '#c9d1d9' }}>{f.facturaCcp || '-'}</span>;
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
      case 'cantOps': return <span style={{ color: '#8b949e' }}>{f.operacionesIds?.length || 0}</span>;
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

  // ──────────────────────────────────────────────────────────────────
  // Detalle de operación
  // ──────────────────────────────────────────────────────────────────
  const verDetalleOperacion = async (opId: string) => {
    if (!opId) return;
    setCargandoDetalle(true);
    setPestañaDetalleActiva('unidad');
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

  // Buscador de proveedor reutilizable (opcional) para la barra de filtro
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

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Facturación de Proveedores</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Facturas</button>
      </div>

      {activeTab === 'operaciones' ? (
        /* ════════════════════ ASIGNAR OPERACIONES ════════════════════ */
        <div className="animation-fade-in">
          {/* Filtro: rango de fechas OBLIGATORIO + proveedor opcional */}
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
            <BuscadorProveedor />
          </div>

          {!ambasFechas ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#8b949e', backgroundColor: '#0d1117', border: '1px dashed #30363d', borderRadius: '8px' }}>
              <div style={{ fontSize: '1.05rem', color: '#c9d1d9', marginBottom: '6px' }}>Selecciona <b style={{ color: '#D84315' }}>Fecha Desde</b> y <b style={{ color: '#D84315' }}>Fecha Hasta</b></div>
              <div style={{ fontSize: '0.9rem' }}>Las operaciones por facturar aparecerán al definir ambas fechas. El proveedor es opcional.</div>
            </div>
          ) : (
          <>
          {/* Resumen de conteos del rango (no depende del toggle de visibilidad) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px 20px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Operaciones en espera por facturar</div>
              <div style={{ color: '#f59e0b', fontSize: '2rem', fontWeight: 'bold' }}>{resumenOps.porFacturar}</div>
            </div>
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px 20px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Operaciones ya facturadas (en historial)</div>
              <div style={{ color: '#3fb950', fontSize: '2rem', fontWeight: 'bold' }}>{resumenOps.facturadas}</div>
            </div>
          </div>
          {/* Controles: orden + conteo + columnas + exportar + generar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
              <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
                <option value="ref">Referencia</option>
                <option value="fechaServicio">Fecha Servicio</option>
                <option value="proveedor">Proveedor</option>
                <option value="destino">Destino</option>
                <option value="subtotal">Subtotal</option>
                <option value="conv">Conversión</option>
              </select>
              <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
              </button>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>
                {operacionesMostradas.length} mostradas · <b style={{ color: '#f59e0b' }}>{resumenOps.porFacturar}</b> por facturar
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#8b949e', fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={mostrarFacturadas} onChange={(e) => setMostrarFacturadas(e.target.checked)} style={{ cursor: 'pointer' }} />
                Mostrar facturadas
              </label>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">⚙ Configurar Columnas</button>
              <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                style={{
                  padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                  cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                  backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                  color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff'
                }}>
                ⬇ Exportar Excel
              </button>
              <button disabled={seleccionadas.length === 0 || seleccionMultiProveedor} onClick={() => setModalAbierto(true)}
                style={{ padding: '8px 20px', backgroundColor: (seleccionadas.length > 0 && !seleccionMultiProveedor) ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && !seleccionMultiProveedor) ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Generar Factura ({seleccionadas.length})
              </button>
            </div>
          </div>

          {/* Aviso multi-proveedor */}
          {seleccionMultiProveedor && (
            <div style={{ backgroundColor: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.4)', color: '#ff7b72', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.85rem' }}>
              Seleccionaste operaciones de <b>distintos proveedores</b>. Una factura debe ser de un solo proveedor: usa el filtro de proveedor o selecciona operaciones del mismo proveedor.
            </div>
          )}

          {/* Aviso: se alcanzó el tope de operaciones cargadas en el rango */}
          {topeOpsAlcanzado && (
            <div style={{ backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.85rem' }}>
              Se alcanzó el tope de <b>{LIMITE_OPS_RANGO}</b> operaciones cargadas para este rango, por lo que podría haber más que no se muestran. <b>Acota el rango de fechas</b> (o filtra por proveedor) para ver el total real por facturar.
            </div>
          )}

          {/* Resumen de selección */}
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
                  <tr><td colSpan={columnasOps.filter(c => c.visible).length + 1} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>No hay operaciones por facturar en este rango de fechas{filtroProveedor ? ' para el proveedor seleccionado' : ''}.</td></tr>
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
          </>
          )}
        </div>

      ) : (
        /* ════════════════════ HISTORIAL DE FACTURAS ════════════════════ */
        <div className="animation-fade-in">
          {/* Filtro INDEPENDIENTE del historial: fechas opcionales + proveedor + búsqueda */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '16px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA DESDE (opcional)</label>
              <input type="date" value={fechaDesdeHist} onChange={(e) => setFechaDesdeHist(e.target.value)} style={dateInputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>FECHA HASTA (opcional)</label>
              <input type="date" value={fechaHastaHist} onChange={(e) => setFechaHastaHist(e.target.value)} style={dateInputStyle} />
            </div>
            {(fechaDesdeHist || fechaHastaHist) && (
              <button onClick={() => { setFechaDesdeHist(''); setFechaHastaHist(''); }} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
            )}
            <div style={{ flex: 1, minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold' }}>BUSCAR</label>
              <input type="text" placeholder="Factura, proveedor, # remolque, referencia o moneda..." value={textoBuscarFactura}
                onChange={(e) => setTextoBuscarFactura(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
            </div>
            <BuscadorProveedor />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
              <select value={ordenFac.campo} onChange={(e) => setOrdenFac(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
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
                  <tr><td colSpan={columnasFactura.filter(c => c.visible).length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Cargando facturas del rango...</td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td colSpan={columnasFactura.filter(c => c.visible).length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay facturas en este rango de fechas{filtroProveedor ? ' para el proveedor seleccionado' : ''}.</td></tr>
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
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '720px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnasOps(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '20px' }}>Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel. <b style={{ color: '#58a6ff' }}>Esta configuración se guarda y se aplica para todos los usuarios.</b></p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {columnasOps.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStartOps(e, idx)} onDragEnter={() => handleDragEnterOps(idx)} onDragEnd={() => setDraggedColOpsIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColOpsIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
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
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Referencias / Operaciones Facturadas ({facturaViendo.operacionesGuardadas?.length || 0}) — haz clic para ver el detalle
                  </span>
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

      {/* ════════════════════ MODAL DIAGNÓSTICO / VERIFICACIÓN ════════════════════ */}
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
                <div style={{ color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '10px' }}>Operaciones del rango (pestaña “Asignar Operaciones”)</div>
                {ambasFechas ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    {[
                      { lbl: 'Completadas en rango', val: diagnostico.rangoTotal, col: '#c9d1d9' },
                      { lbl: 'Ya facturadas', val: diagnostico.rangoFacturadas, col: '#3fb950' },
                      { lbl: 'Por facturar', val: diagnostico.rangoPorFacturar, col: '#f59e0b' },
                    ].map((c, i) => (
                      <div key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '14px' }}>
                        <div style={{ color: '#8b949e', fontSize: '0.72rem', textTransform: 'uppercase' }}>{c.lbl}</div>
                        <div style={{ color: c.col, fontSize: '1.5rem', fontWeight: 'bold' }}>{c.val}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#8b949e', fontSize: '0.85rem' }}>Selecciona un rango de fechas en “Asignar Operaciones” para ver el desglose por facturar.</div>
                )}
              </div>

              <div>
                <div style={{ color: '#8b949e', fontSize: '0.78rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '10px' }}>Posibles pendientes a revisar</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.88rem' }}>
                  {[
                    { ok: diagnostico.huerfanas === 0, txt: diagnostico.huerfanas === 0 ? 'No hay operaciones marcadas como facturadas sin factura asociada (en el rango).' : `${diagnostico.huerfanas} operación(es) del rango marcadas como facturadas pero sin factura que las referencie.` },
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
                Nota: el total en $0 y la fecha vacía en facturas importadas vienen del sistema anterior (no se migraron). La moneda se completa con la del proveedor cuando la factura no la trae. El # de referencia (TR) y el # de remolque se resuelven al ver cada página del historial.
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
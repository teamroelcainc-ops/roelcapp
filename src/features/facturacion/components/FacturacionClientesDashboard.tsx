// src/features/facturacion/components/FacturacionClientesDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// CAMBIOS APLICADOS EN ESTA VERSIÓN
// ═══════════════════════════════════════════════════════════════════════
// 1) Exportar a Excel con SELECTOR + ORDEN de columnas (modal "Configurar
//    columnas") para el Historial de Facturas. Lo configurado se refleja
//    tanto en la tabla como en el archivo exportado.
// 2) Conversión idéntica a la del formulario de Operaciones (lógica USD/MXN):
//    subtotal = montoConvenioCliente + cargosAdicionales
//      · USD  -> dólares = subtotal ; conversión = subtotal * TC
//      · MXN  -> pesos   = subtotal ; conversión = subtotal
//    Se prefieren los valores ya guardados; si faltan, se recalculan.
//    El total de la factura ahora suma la CONVERSIÓN.
// 3) Una operación ya facturada NO aparece en "Asignar Operaciones"
//    (vista por defecto = Pendientes).
// 4) En la ficha de la factura, al clicar una referencia se abre el DETALLE
//    completo de la operación (mismas pestañas que OperacionesDashboard).
// 5) Control para ORDENAR en ambas pestañas (botón de dirección + cabeceras
//    clicables).
// 6) Botones para filtrar Pendientes (rojo) / Facturadas (verde).
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  writeBatch,
  doc,
  limit,
  orderBy,
  where,
  getDocs,
  getDoc,
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

// ──────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────
const ID_TIPO_CLIENTE_PAGA = '7eec9cbb';
const STATUS_COMPLETADOS = ['f557b751', 'c2d57403'];
const LIMITE_OPERACIONES_CLIENTE = 100;
const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// Columnas configurables del Historial de Facturas (tabla + Excel).
// El campo `id` se usa para resolver el valor; `label` es el encabezado.
const COLUMNAS_FACTURA_BASE = [
  { id: 'invoice',   label: 'Invoice',     visible: true },
  { id: 'fecha',     label: 'Fecha',       visible: true },
  { id: 'cliente',   label: 'Cliente',     visible: true },
  { id: 'moneda',    label: 'Moneda',      visible: true },
  { id: 'facturaCcp',label: 'Factura CCP', visible: true },
  { id: 'cantOps',   label: 'Cant. Ops',   visible: true },
  { id: 'total',     label: 'Total',       visible: true },
  { id: 'createdAt', label: 'Registrada',  visible: false },
];

// Columnas configurables de la tabla "Asignar Operaciones" (tabla + Excel).
// orden:true -> la cabecera es clicable para ordenar por ese campo.
const COLUMNAS_OPS_BASE = [
  { id: 'ref',           label: 'Ref. Operación', visible: true,  orden: true },
  { id: 'fechaServicio', label: 'Fecha Servicio',  visible: true,  orden: true },
  { id: 'cliente',       label: 'Cliente',         visible: true,  orden: true },
  { id: 'cartaPorte',    label: 'Carta Porte',     visible: true,  orden: false },
  { id: 'destino',       label: 'Destino',         visible: true,  orden: true },
  { id: 'moneda',        label: 'Moneda',          visible: true,  orden: false },
  { id: 'subtotal',      label: 'Subtotal',        visible: true,  orden: true },
  { id: 'dolares',       label: 'Dólares',         visible: true,  orden: false },
  { id: 'pesos',         label: 'Pesos',           visible: true,  orden: false },
  { id: 'conv',          label: 'Conversión',      visible: true,  orden: true },
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
  else { conv = subtotal; } // moneda sin determinar: deja la conversión = subtotal
  return { subtotal, dol, pes, conv };
};

// Prefiere los valores ya calculados/guardados por el formulario; si no
// existen, recalcula con la misma fórmula.
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
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial'>('historial');

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [facturasGlobales, setFacturasGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(false);
  const [cargandoFacturas, setCargandoFacturas] = useState(false);

  // Catálogos
  const [empresasList, setEmpresasList] = useState<any[]>([]);

  // Filtros / selección
  const [filtroCliente, setFiltroCliente] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  // ✅ (6) Filtro Pendientes / Facturadas
  const [filtroEstadoOps, setFiltroEstadoOps] = useState<'pendientes' | 'facturadas'>('pendientes');

  // ✅ (5) Orden
  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [ordenFac, setOrdenFac] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fecha', dir: 'desc' });

  // Buscador de cliente
  const [textoBuscarCliente, setTextoBuscarCliente] = useState('');
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);

  // Paginación Historial
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Modal de facturación
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [facturaViendo, setFacturaViendo] = useState<any | null>(null);

  // ✅ (1) Columnas del historial
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasFactura, setColumnasFactura] = useState(COLUMNAS_FACTURA_BASE.map(c => ({ ...c })));
  // Configurador de columnas + rango de fechas para la tabla "Asignar Operaciones"
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);
  const [fechaDesdeOps, setFechaDesdeOps] = useState('');
  const [fechaHastaOps, setFechaHastaOps] = useState('');
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // ✅ (4) Detalle de operación (al clicar referencia en la ficha de factura)
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
  // 1. Carga de empresas (buscador de cliente en ambas pestañas)
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unSubEmpresas = onSnapshot(collection(db, 'empresas'), (snap) => {
      setEmpresasList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => { unSubEmpresas(); };
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // 2. Carga de FACTURAS del cliente (on demand)
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!filtroCliente) { setFacturasGlobales([]); return; }

    const descargarFacturasCliente = async () => {
      setCargandoFacturas(true);
      try {
        const q1 = query(
          collection(db, 'facturas_clientes'),
          where('clienteId', '==', filtroCliente),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        const snap = await getDocs(q1);
        setFacturasGlobales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (e1: any) {
        const msg1 = String(e1?.message || e1?.code || e1 || '');
        const esIndice = msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition');
        if (esIndice) {
          console.warn('[Facturación Historial] Falta índice. Crea el índice:', msg1);
          try {
            const q2 = query(
              collection(db, 'facturas_clientes'),
              where('clienteId', '==', filtroCliente),
              limit(100)
            );
            const snap2 = await getDocs(q2);
            const docs = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            docs.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
            setFacturasGlobales(docs);
          } catch (e2: any) {
            console.error('[Facturación Historial] Fallback falló:', e2);
            alert(`No se pudieron cargar las facturas.\n\nDetalle: ${e2?.message || e2}`);
          }
        } else {
          console.error('[Facturación Historial] Error:', e1);
          alert(`Hubo un problema al cargar las facturas.\n\nDetalle: ${msg1}`);
        }
      }
      setCargandoFacturas(false);
    };

    descargarFacturasCliente();
  }, [filtroCliente]);

  // ──────────────────────────────────────────────────────────────────
  // 3. Carga de OPERACIONES del cliente (completadas) — on demand
  //    Nota: NO filtramos las facturadas aquí; el filtro Pendientes/Facturadas
  //    se aplica en memoria (ver `operacionesMostradas`).
  // ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'operaciones') return;
    if (!filtroCliente) { setOperacionesGlobales([]); return; }

    const descargarOperacionesCliente = async () => {
      setCargandoOperaciones(true);
      const filtrarLegacy = (ops: any[]) => ops.filter((op: any) =>
        STATUS_COMPLETADOS.includes(String(op.status || '').trim())
      );

      let opsFinal: any[] = [];
      let exito = false;

      try {
        const q1 = query(
          collection(db, 'operaciones'),
          where('clientePaga', '==', filtroCliente),
          where('status', 'in', STATUS_COMPLETADOS),
          orderBy('fechaServicio', 'desc'),
          limit(LIMITE_OPERACIONES_CLIENTE)
        );
        const snap = await getDocs(q1);
        opsFinal = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        exito = true;
      } catch (e1: any) {
        const msg1 = String(e1?.message || e1?.code || e1 || '');
        const esIndice = msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition');
        if (esIndice) {
          console.warn('[Facturación] Query óptima falló (falta índice). Crea el índice:', msg1);
          try {
            const q2 = query(
              collection(db, 'operaciones'),
              where('clientePaga', '==', filtroCliente),
              where('status', 'in', STATUS_COMPLETADOS),
              limit(LIMITE_OPERACIONES_CLIENTE * 2)
            );
            const snap2 = await getDocs(q2);
            opsFinal = snap2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            opsFinal.sort((a, b) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')));
            opsFinal = opsFinal.slice(0, LIMITE_OPERACIONES_CLIENTE);
            exito = true;
          } catch (e2: any) {
            console.warn('[Facturación] Fallback 1 falló, probando legacy:', String(e2?.message || e2 || ''));
            try {
              const q3 = query(
                collection(db, 'operaciones'),
                where('clientePaga', '==', filtroCliente),
                limit(500)
              );
              const snap3 = await getDocs(q3);
              const todas = snap3.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
              opsFinal = filtrarLegacy(todas);
              opsFinal.sort((a, b) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')));
              opsFinal = opsFinal.slice(0, LIMITE_OPERACIONES_CLIENTE);
              exito = true;
            } catch (e3: any) {
              console.error('[Facturación] Todos los intentos fallaron:', e3);
              alert(`No se pudieron cargar las operaciones del cliente.\n\nDetalle: ${e3?.message || e3}`);
            }
          }
        } else {
          console.error('[Facturación] Error inesperado:', e1);
          alert(`Hubo un problema al cargar las operaciones.\n\nDetalle: ${msg1}`);
        }
      }

      if (exito) setOperacionesGlobales(opsFinal);
      setCargandoOperaciones(false);
    };

    descargarOperacionesCliente();
  }, [filtroCliente, activeTab]);

  // ──────────────────────────────────────────────────────────────────
  // Traductor de clientes / buscador
  // ──────────────────────────────────────────────────────────────────
  const getNombreCliente = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = empresasList.find(e => e.id === idOrName || e.nombre === idOrName || e.nombreCorto === idOrName);
    return found ? (found.nombre || found.nombreCorto || idOrName) : idOrName;
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
    if (!filtroCliente || !empresasList.length) return '';
    const cli = empresasList.find(e => e.id === filtroCliente);
    return cli?.nombre || filtroCliente;
  }, [filtroCliente, empresasList]);

  const monedaFacturacion = useMemo(() => {
    if (!filtroCliente) return '-';
    const empresa = empresasList.find(e => e.id === filtroCliente);
    if (!empresa) return '-';
    const idMoneda = empresa.monedaRef || empresa.moneda;
    if (idMoneda === ID_MXN) return 'MXN';
    if (idMoneda === ID_USD) return 'USD';
    return idMoneda || 'No definida en catálogo';
  }, [filtroCliente, empresasList]);

  // ──────────────────────────────────────────────────────────────────
  // (3)+(6) Operaciones filtradas por estado y (5) ordenadas
  // ──────────────────────────────────────────────────────────────────
  const esFacturada = (op: any) => !!op.facturaClienteId || !!op.facturado;

  const conteoOps = useMemo(() => {
    const pendientes = operacionesGlobales.filter(op => !esFacturada(op)).length;
    const facturadas = operacionesGlobales.filter(esFacturada).length;
    return { pendientes, facturadas };
  }, [operacionesGlobales]);

  const valorOrdenOp = (op: any, campo: string): string | number => {
    switch (campo) {
      case 'ref': return String(op.numReferencia || op.referencia || op.ref || op.id || '').toLowerCase();
      case 'fechaServicio': return String(op.fechaServicio || op.createdAt || '');
      case 'cliente': return getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId).toLowerCase();
      case 'destino': return String(op.destinoNombre || op.destino || '').toLowerCase();
      case 'subtotal': return obtenerMontoOperacion(op).subtotal;
      case 'conv': return obtenerMontoOperacion(op).conv;
      default: return '';
    }
  };

  // Rango de fechas (sobre fechaServicio). Vacío = sin límite.
  const dentroRangoFecha = (op: any) => {
    if (!fechaDesdeOps && !fechaHastaOps) return true;
    const f = String(op.fechaServicio || op.createdAt || '').slice(0, 10);
    if (!f) return false;
    if (fechaDesdeOps && f < fechaDesdeOps) return false;
    if (fechaHastaOps && f > fechaHastaOps) return false;
    return true;
  };

  const operacionesMostradas = useMemo(() => {
    if (!filtroCliente) return [];
    const lista = operacionesGlobales.filter(op =>
      (filtroEstadoOps === 'facturadas' ? esFacturada(op) : !esFacturada(op)) && dentroRangoFecha(op)
    );
    const dir = ordenOps.dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = valorOrdenOp(a, ordenOps.campo);
      const vb = valorOrdenOp(b, ordenOps.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [operacionesGlobales, filtroCliente, filtroEstadoOps, ordenOps, empresasList, fechaDesdeOps, fechaHastaOps]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });

  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  // Valor textual/numérico de cada columna (para el Excel)
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
      default: return '-';
    }
  };

  // Celda con formato visual para la tabla
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
      default: return <td key={key} style={tdBase}>-</td>;
    }
  };

  // Drag & drop / visibilidad de columnas de la tabla de operaciones
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

  // (3) Exportar a Excel las operaciones mostradas (respeta cliente, estado,
  //     rango de fechas y columnas/orden configurados).
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
    const etiqueta = filtroEstadoOps === 'facturadas' ? 'Facturadas' : 'Pendientes';
    XLSX.utils.book_append_sheet(wb, ws, `Ops_${etiqueta}`);
    const cli = (nombreClienteSeleccionado || 'cliente').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
    const hoy = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Operaciones_${etiqueta}_${cli}_${hoy}.xlsx`);
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
        subtotal += obtenerMontoOperacion(op).conv; // (2) suma la conversión
        refs.push(op.numReferencia || op.referencia || op.ref || op.id?.substring(0, 6));
      }
    });
    return { subtotal, refs };
  }, [seleccionadas, operacionesGlobales]);

  // ──────────────────────────────────────────────────────────────────
  // Guardado de factura
  // ──────────────────────────────────────────────────────────────────
  const handleGuardarFactura = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceForm.trim()) return alert('El # de Invoice es obligatorio.');
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
          monto: montos.conv,            // (2) conversión
          subtotalBase: montos.subtotal, // referencia adicional
        };
      });

      const data = {
        invoice: invoiceForm.trim(),
        fecha: fechaForm,
        facturaCcp: facturaCcpForm.trim(),
        clienteId: filtroCliente,
        clienteNombre: getNombreCliente(filtroCliente),
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
      setSeleccionadas([]);
      setInvoiceForm('');
      setFacturaCcpForm('');
      // (3) marcar localmente como facturadas para que salgan de "Pendientes"
      setOperacionesGlobales(prev => prev.map(op =>
        seleccionadas.includes(op.id) ? { ...op, facturaClienteId: nuevoId, facturaClienteInvoice: invoiceForm.trim(), facturado: true } : op
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
        // liberar localmente las operaciones (vuelven a Pendientes)
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
  // (5) Historial: orden + paginación
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
    return [...facturasGlobales].sort((a, b) => {
      const va = valorOrdenFac(a, ordenFac.campo);
      const vb = valorOrdenFac(b, ordenFac.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [facturasGlobales, ordenFac]);

  const toggleOrdenFac = (campo: string) =>
    setOrdenFac(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });

  const flechaFac = (campo: string) => ordenFac.campo === campo ? (ordenFac.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const totalPaginas = Math.ceil(historialOrdenado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialOrdenado.slice(indexFirst, indexLast);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  useEffect(() => { setPaginaActual(1); }, [filtroCliente, ordenFac]);

  // ──────────────────────────────────────────────────────────────────
  // (1) Columnas configurables — valor por columna + export
  // ──────────────────────────────────────────────────────────────────
  const valorCeldaFactura = (f: any, colId: string): any => {
    switch (colId) {
      case 'invoice': return f.invoice || '';
      case 'fecha': return formatearFechaSpanish(f.fecha);
      case 'cliente': return f.clienteNombre || '-';
      case 'moneda': return f.monedaFacturacion || 'N/A';
      case 'facturaCcp': return f.facturaCcp || '-';
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
      case 'cliente': return <span style={{ color: '#f0f6fc' }}>{f.clienteNombre || '-'}</span>;
      case 'moneda': return <span style={{ color: '#10b981', fontWeight: 'bold' }}>{f.monedaFacturacion || 'N/A'}</span>;
      case 'facturaCcp': return <span style={{ color: '#c9d1d9' }}>{f.facturaCcp || '-'}</span>;
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
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturas_Clientes');
    XLSX.writeFile(workbook, `Facturas_Clientes_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Drag & drop / visibilidad de columnas
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
  // (4) Detalle de operación
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

  // Banderas para el detalle (mismas reglas que OperacionesDashboard)
  const det = operacionDetalle;
  const evalTipoOpText = String(det?.tipoOperacionNombre || det?.tipoOperacionId || '').toLowerCase();
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
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
  const dateInputStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '7px 10px', fontSize: '0.85rem', colorScheme: 'dark' };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Facturación de Clientes</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Facturas</button>
      </div>

      {/* ════════════════════ ASIGNAR OPERACIONES ════════════════════ */}
      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          {/* Buscador de cliente */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ flex: 1, minWidth: '320px', position: 'relative' }}>
              <label style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>CLIENTE ★</label>
              {filtroCliente ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', minHeight: '20px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  <span style={{ color: '#10b981', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreClienteSeleccionado}</span>
                  <button onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); setSeleccionadas([]); }} title="Cambiar cliente" style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}>✕</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  <input type="text" placeholder="Buscar cliente por nombre o RFC..." value={textoBuscarCliente}
                    onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
                    onFocus={() => setMostrarSugerenciasCliente(true)} onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
                    style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
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

            <button disabled={seleccionadas.length === 0 || filtroEstadoOps === 'facturadas'} onClick={() => setModalAbierto(true)}
              style={{ padding: '10px 20px', backgroundColor: (seleccionadas.length > 0 && filtroEstadoOps !== 'facturadas') ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && filtroEstadoOps !== 'facturadas') ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
              Generar Factura ({seleccionadas.length})
            </button>
          </div>

          {/* (6) Filtros Pendientes / Facturadas + (5) Orden */}
          {filtroCliente && (
            <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => { setFiltroEstadoOps('pendientes'); }}
                  style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                    border: `1px solid ${filtroEstadoOps === 'pendientes' ? '#ef4444' : '#30363d'}`,
                    backgroundColor: filtroEstadoOps === 'pendientes' ? 'rgba(239,68,68,0.15)' : 'transparent',
                    color: filtroEstadoOps === 'pendientes' ? '#ef4444' : '#8b949e' }}>
                  ● Pendientes ({conteoOps.pendientes})
                </button>
                <button onClick={() => { setFiltroEstadoOps('facturadas'); setSeleccionadas([]); }}
                  style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                    border: `1px solid ${filtroEstadoOps === 'facturadas' ? '#10b981' : '#30363d'}`,
                    backgroundColor: filtroEstadoOps === 'facturadas' ? 'rgba(16,185,129,0.15)' : 'transparent',
                    color: filtroEstadoOps === 'facturadas' ? '#10b981' : '#8b949e' }}>
                  ● Facturadas ({conteoOps.facturadas})
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
                <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
                  <option value="ref">Referencia</option>
                  <option value="fechaServicio">Fecha Servicio</option>
                  <option value="cliente">Cliente</option>
                  <option value="destino">Destino</option>
                  <option value="subtotal">Subtotal</option>
                  <option value="conv">Conversión</option>
                </select>
                <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                  {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                </button>
              </div>
            </div>

            {/* (3) Rango de fechas + Configurar columnas + Exportar Excel */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold' }}>FECHA DESDE</label>
                  <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={dateInputStyle} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold' }}>FECHA HASTA</label>
                  <input type="date" value={fechaHastaOps} onChange={(e) => setFechaHastaOps(e.target.value)} style={dateInputStyle} />
                </div>
                {(fechaDesdeOps || fechaHastaOps) && (
                  <button onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar filtro de fechas">
                    ✕ Limpiar fechas
                  </button>
                )}
                <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>
                  {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'operación' : 'operaciones'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">
                  ⚙ Configurar Columnas
                </button>
                <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                    cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                    backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                    color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                  ⬇ Exportar Excel ({filtroEstadoOps === 'facturadas' ? 'Facturadas' : 'Pendientes'})
                </button>
              </div>
            </div>
            </>
          )}

          {/* Resumen de selección */}
          {seleccionadas.length > 0 && filtroEstadoOps === 'pendientes' && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones Seleccionadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Conversión Estimada</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Moneda del Cliente</span>
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
                {!filtroCliente ? (
                  <tr><td colSpan={columnasOps.filter(c => c.visible).length + 1} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Selecciona un Cliente en el filtro superior para ver las operaciones completadas.</td></tr>
                ) : cargandoOperaciones ? (
                  <tr><td colSpan={columnasOps.filter(c => c.visible).length + 1} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando últimas 100 operaciones completadas del cliente...</td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td colSpan={columnasOps.filter(c => c.visible).length + 1} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>
                    {filtroEstadoOps === 'pendientes'
                      ? 'No hay operaciones pendientes de facturar para este cliente.'
                      : 'No hay operaciones facturadas para este cliente.'}
                  </td></tr>
                ) : (
                  operacionesMostradas.map(op => {
                    const m = obtenerMontoOperacion(op);
                    const seleccionable = filtroEstadoOps === 'pendientes';
                    return (
                      <tr key={op.id} onClick={() => seleccionable && toggleSeleccion(op.id)}
                        style={{ cursor: seleccionable ? 'pointer' : 'default', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                        <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {seleccionable ? (
                            <input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                          ) : (
                            <span title={op.facturaClienteInvoice || 'Facturada'} style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
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
        </div>

      ) : (
        /* ════════════════════ HISTORIAL DE FACTURAS ════════════════════ */
        <div className="animation-fade-in">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ flex: 1, minWidth: '320px', position: 'relative' }}>
              <label style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>CLIENTE ★</label>
              {filtroCliente ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', minHeight: '20px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  <span style={{ color: '#10b981', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreClienteSeleccionado}</span>
                  <button onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); }} title="Cambiar cliente" style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}>✕</button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  <input type="text" placeholder="Buscar cliente por nombre o RFC..." value={textoBuscarCliente}
                    onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
                    onFocus={() => setMostrarSugerenciasCliente(true)} onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
                    style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
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
                        <div key={cli.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFiltroCliente(cli.id); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); }}
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

            {/* (5) Orden del historial */}
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
            </div>

            {/* (1) Configurar columnas */}
            <button title="Configurar columnas" onClick={() => setModalColumnas(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '10px 14px', borderRadius: '6px', cursor: 'pointer', height: 'fit-content', gap: '6px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>

            {/* (1) Exportar Excel (columnas configurables) */}
            <button title="Exportar a Excel" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '10px 14px', borderRadius: '6px', cursor: 'pointer', height: 'fit-content' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', backgroundColor: '#161b22' }}>
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
                {!filtroCliente ? (
                  <tr><td colSpan={columnasFactura.filter(c => c.visible).length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Selecciona un cliente para ver su historial de facturas.</td></tr>
                ) : cargandoFacturas ? (
                  <tr><td colSpan={columnasFactura.filter(c => c.visible).length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Cargando últimas 100 facturas del cliente...</td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td colSpan={columnasFactura.filter(c => c.visible).length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Este cliente no tiene facturas registradas.</td></tr>
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

      {/* ════════════════════ (1) MODAL CONFIGURAR COLUMNAS ════════════════════ */}
      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '720px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '20px' }}>Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel.</p>
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
              <button onClick={() => setModalColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
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
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '20px' }}>Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel.</p>
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
              <button onClick={() => setModalColumnasOps(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
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
                <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{getNombreCliente(filtroCliente)}</span>
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
                  <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{facturaViendo.clienteNombre || '-'}</span>
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

                {/* ✅ (4) Referencias clicables -> abren el detalle de la operación */}
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

      {/* ════════════════════ (4) MODAL DETALLE DE OPERACIÓN ════════════════════ */}
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
                        <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 'bold' }}>{det.statusNombre || det.status || '-'}</span>
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
                  {/* GENERAL */}
                  {pestañaDetalleActiva === 'general' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Tipo de Operación</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.tipoOperacionNombre || det.tipoOperacionId || '-'}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Servicio / Status</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.fechaServicio)} <span style={{ color: '#30363d', margin: '0 8px' }}>|</span> <span style={{ color: '#10b981', fontWeight: 'bold' }}>{det.statusNombre || det.status || '-'}</span></span></div>
                      {evalIsFletes ? (
                        <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Cita</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{formatearFechaHora(det.fechaCita)}</span></div>
                      ) : (<div></div>)}
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Paga)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.clienteNombre || det.nombreCliente || det.clientePaga)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio (Tarifa)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.convenioNombre || det.convenio || '-'}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Remolque</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.remolqueNombre || det.remolquePlaca || det.numeroRemolque || '-'}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Ref Cliente</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.refCliente)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Origen</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.origenNombre || det.origen || '-'}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Destino</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.destinoNombre || det.destino || '-'}</span></div>
                      <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Observaciones Ejecutivo</span><div style={{ color: '#c9d1d9', fontWeight: 500, backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>{mostrarDato(det.observacionesEjecutivo)}</div></div>
                    </div>
                  )}

                  {/* PEDIMENTO */}
                  {pestañaDetalleActiva === 'pedimento' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Mercancía)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.clienteMercanciaNombre || det.clienteMercancia || '-'}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Descripción de la Mercancía</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.descripcionMercancia)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cantidad (Enteros)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.cantidad)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Embalaje</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.embalajeNombre || det.embalaje || '-'}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Peso (Kg)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.pesoKg)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># DODA</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.numDoda)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Emisión (DODA)</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.fechaEmisionDoda)}</span></div>
                    </div>
                  )}

                  {/* MANIFIESTOS */}
                  {pestañaDetalleActiva === 'manifiestos' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Entry's</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.numeroEntrys)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cantidad de Entry's</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.cantEntrys)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># Manifiesto</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{mostrarDato(det.numManifiesto)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Proveedor de Servicios</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.provServiciosNombre || det.provServicios || '-'}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Costo Manifiesto ($)</span><span style={{ color: '#c9d1d9', fontWeight: 'bold', fontSize: '1.05rem' }}>{formatoMoneda(det.montoManifiesto)}</span></div>
                    </div>
                  )}

                  {/* UNIDAD */}
                  {pestañaDetalleActiva === 'unidad' && (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                        <div style={{ gridColumn: 'span 3' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Proveedor de Transporte</span><span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem' }}>{det.proveedorUnidadNombre || det.proveedorUnidad || '-'}</span></div>
                      </div>
                      <div style={{ backgroundColor: '#161b22', padding: '20px', borderRadius: '12px', border: '1px solid #30363d', marginBottom: '24px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '16px' }}>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Facturado En:</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.monedaUnidadNombre || mostrarMoneda(det.facturadoEnUnidad)}</span></div>
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio Proveedor</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.convenioProveedorNombre || det.convenioProveedor || '-'}</span></div>
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
                          <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Unidad Asignada</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.unidadNombre || det.unidad || '-'}</span></div>
                          <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Operador Asignado</span><span style={{ color: '#c9d1d9', fontWeight: 500, fontSize: '1.05rem' }}>{det.operadorNombre || det.operador || '-'}</span></div>
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

                  {/* COBRAR */}
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
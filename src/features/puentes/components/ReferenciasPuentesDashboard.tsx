// src/features/puentes/components/ReferenciasPuentesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  writeBatch,
  doc,
  limit,
  orderBy
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

// ⚠ Si tu colección de convenios de clientes tiene otro nombre, cámbialo aquí.
const COLECCION_CONVENIOS = 'convenios_clientes';

const COLUMNAS_OPS_PUENTES_BASE = [
  { id: 'ref',           label: 'Ref. Operación', visible: true,  orden: true },
  { id: 'fechaServicio', label: 'Fecha Servicio', visible: true,  orden: true },
  { id: 'trafico',       label: 'Tráfico',        visible: true,  orden: true },
  { id: 'operador',      label: 'Operador',       visible: true,  orden: true },
  { id: 'cliente',       label: 'Cliente',        visible: true,  orden: true },
  { id: 'origen',        label: 'Origen',         visible: false, orden: true },
  { id: 'destino',       label: 'Destino',        visible: false, orden: true },
  { id: 'puente',        label: 'Puente',         visible: true,  orden: true },
];

export const ReferenciasPuentesDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial'>('historial');

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [referenciasGlobales, setReferenciasGlobales] = useState<any[]>([]);
  const [operadoresList, setOperadoresList] = useState<any[]>([]);
  const [conveniosList, setConveniosList] = useState<any[]>([]);

  // Filtros pestaña 1
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [filtroTrafico, setFiltroTrafico] = useState<'todos' | 'importacion' | 'exportacion'>('todos');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const [filtroEstadoOps, setFiltroEstadoOps] = useState<'pendientes' | 'asignadas'>('pendientes');
  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_PUENTES_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);

  // Historial
  const [busquedaHistorial, setBusquedaHistorial] = useState('');
  const [filtroEstadoHist, setFiltroEstadoHist] = useState<'pendientes' | 'pagadas'>('pendientes');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Modal generar referencia
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [consecutivoForm, setConsecutivoForm] = useState('');
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split('T')[0]);
  const [statusPagado, setStatusPagado] = useState<'Pendiente' | 'Pagada'>('Pendiente');
  const [observacionesForm, setObservacionesForm] = useState('');

  const [referenciaViendo, setReferenciaViendo] = useState<any | null>(null);

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatearFechaSpanish = (fechaString: string) => {
    if (!fechaString) return '-';
    try { return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return fechaString; }
  };

  // ── Cargas ──
  useEffect(() => {
    const qRefs = query(collection(db, 'referencias_puentes'), orderBy('createdAt', 'desc'), limit(400));
    const unSubRefs = onSnapshot(qRefs, (snap) => {
      setReferenciasGlobales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unSubRefs();
  }, []);

  useEffect(() => {
    if (activeTab !== 'operaciones') return;
    const subs: Array<() => void> = [];
    subs.push(onSnapshot(collection(db, 'empleados'), (snap) => {
      setOperadoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, COLECCION_CONVENIOS), (snap) => {
      setConveniosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    const qOps = query(collection(db, 'operaciones'), limit(500));
    subs.push(onSnapshot(qOps, (snap) => {
      const ops = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      ops.sort((a: any, b: any) => new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime());
      setOperacionesGlobales(ops);
    }));
    return () => subs.forEach(u => u());
  }, [activeTab]);

  const getNombreOperador = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = operadoresList.find(o => o.id === idOrName || `${o.firstName} ${o.lastNamePaternal}`.trim() === String(idOrName).trim());
    return found ? `${found.firstName || ''} ${found.lastNamePaternal || ''}`.trim() : idOrName;
  };

  const getCliente = (op: any) => op.clienteNombre || op.clientePagaNombre || op.nombreCliente || op.clientePaga || '-';

  // Costo de puente/caseta de la operación (con varios nombres posibles)
  const getPuente = (op: any) => Number(
    op.puenteTotal ?? op.casetasTotal ?? op.casetaTotal ?? op.costoPuente ??
    op.puente ?? op.peajeTotal ?? op.cruceTotal ?? op.casetas ?? 0
  );

  // Mapa de convenios por id para resolver el tráfico de cada operación
  const convenioPorId = useMemo(() => {
    const map = new Map<string, any>();
    conveniosList.forEach(c => map.set(String(c.id), c));
    return map;
  }, [conveniosList]);

  const detectarTrafico = (txt: any): 'Importación' | 'Exportación' | '—' => {
    const t = String(txt || '').toLowerCase();
    if (t.includes('export')) return 'Exportación';
    if (t.includes('import')) return 'Importación';
    return '—';
  };

  // El tráfico vive en el CONVENIO de la operación (op.convenio = id del convenio).
  const getTrafico = (op: any): 'Importación' | 'Exportación' | '—' => {
    const convId = op.convenio ?? op.convenioId ?? op.convenioClienteId ?? op.idConvenio;
    const conv = convId ? convenioPorId.get(String(convId)) : null;
    if (conv) {
      // 1) Campo dedicado de tráfico en el convenio
      const campo = conv.trafico ?? conv.tipoTrafico ?? conv.tipoOperacion ?? conv.tipoOperacionNombre ?? conv.movimiento ?? conv.sentido ?? conv.direccion ?? '';
      let r = detectarTrafico(campo);
      if (r !== '—') return r;
      // 2) Si no, se busca en cualquier texto del convenio (nombre/label/descripción)
      const todoTexto = Object.values(conv).filter(v => typeof v === 'string').join(' ');
      r = detectarTrafico(todoTexto);
      if (r !== '—') return r;
    }
    // 3) Respaldo: campos denormalizados en la propia operación
    if (op.trafico) { const r = detectarTrafico(op.trafico); if (r !== '—') return r; }
    return detectarTrafico(`${op.convenioNombre || ''} ${op.tarifaLabel || ''} ${op.tarifarioLabel || ''} ${op.tipoOperacionNombre || ''} ${op.tipoServicio || ''} ${op.ref || ''}`);
  };

  const dentroRangoFecha = (op: any) => {
    if (!fechaInicio && !fechaFin) return true;
    const f = String(op.fechaServicio || op.createdAt || '').slice(0, 10);
    if (!f) return false;
    if (fechaInicio && f < fechaInicio) return false;
    if (fechaFin && f > fechaFin) return false;
    return true;
  };

  // No se muestra nada hasta que se ponga al menos una fecha de servicio
  const filtrosCompletos = !!(fechaInicio || fechaFin);

  const operacionesBaseFiltro = useMemo(() => {
    if (!filtrosCompletos) return [];
    return operacionesGlobales.filter(op => {
      const tr = getTrafico(op);
      const matchTrafico =
        filtroTrafico === 'todos' ||
        (filtroTrafico === 'importacion' && tr === 'Importación') ||
        (filtroTrafico === 'exportacion' && tr === 'Exportación');
      return matchTrafico && dentroRangoFecha(op);
    });
  }, [operacionesGlobales, filtroTrafico, fechaInicio, fechaFin, filtrosCompletos, convenioPorId]);

  const esAsignada = (op: any) => !!op.referenciaPuentesId;

  const conteoOps = useMemo(() => ({
    pendientes: operacionesBaseFiltro.filter(op => !esAsignada(op)).length,
    asignadas: operacionesBaseFiltro.filter(esAsignada).length,
  }), [operacionesBaseFiltro]);

  const valorOrdenOp = (op: any, campo: string): string | number => {
    switch (campo) {
      case 'ref': return String(op.ref || op.id || '').toLowerCase();
      case 'fechaServicio': return String(op.fechaServicio || op.createdAt || '');
      case 'trafico': return getTrafico(op);
      case 'operador': return getNombreOperador(op.operadorNombre || op.operadorId || op.operador).toLowerCase();
      case 'cliente': return String(getCliente(op)).toLowerCase();
      case 'origen': return String(op.origen || '').toLowerCase();
      case 'destino': return String(op.destino || '').toLowerCase();
      case 'puente': return getPuente(op);
      default: return '';
    }
  };

  const operacionesMostradas = useMemo(() => {
    const lista = operacionesBaseFiltro.filter(op =>
      filtroEstadoOps === 'asignadas' ? esAsignada(op) : !esAsignada(op)
    );
    const dir = ordenOps.dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = valorOrdenOp(a, ordenOps.campo);
      const vb = valorOrdenOp(b, ordenOps.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [operacionesBaseFiltro, filtroEstadoOps, ordenOps, operadoresList, convenioPorId]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const valorCeldaOps = (op: any, key: string) => {
    switch (key) {
      case 'ref': return op.ref || op.id;
      case 'fechaServicio': return formatearFechaSpanish(op.fechaServicio || op.createdAt);
      case 'trafico': return getTrafico(op);
      case 'operador': return getNombreOperador(op.operadorNombre || op.operadorId || op.operador);
      case 'cliente': return getCliente(op);
      case 'origen': return op.origen || '-';
      case 'destino': return op.destino || '-';
      case 'puente': return getPuente(op);
      default: return '-';
    }
  };

  const chipTrafico = (tr: string) => {
    const color = tr === 'Exportación' ? '#f37021' : tr === 'Importación' ? '#58a6ff' : '#8b949e';
    return <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', color, border: `1px solid ${color}`, backgroundColor: `${color}1a` }}>{tr}</span>;
  };

  const renderCeldaOps = (op: any, key: string) => {
    const tdBase: React.CSSProperties = { padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' };
    switch (key) {
      case 'ref': return <td key={key} style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'trafico': return <td key={key} style={{ padding: '16px', whiteSpace: 'nowrap' }}>{chipTrafico(getTrafico(op))}</td>;
      case 'operador': return <td key={key} style={tdBase}>{getNombreOperador(op.operadorNombre || op.operadorId || op.operador)}</td>;
      case 'cliente': return <td key={key} style={tdBase}>{getCliente(op)}</td>;
      case 'origen': return <td key={key} style={tdBase}>{op.origen || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destino || '-'}</td>;
      case 'puente': return <td key={key} style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(getPuente(op))}</td>;
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
      const fila: any = {};
      cols.forEach(col => { fila[col.label] = valorCeldaOps(op, col.id); });
      return fila;
    });
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    const etiqueta = filtroEstadoOps === 'asignadas' ? 'Asignadas' : 'Pendientes';
    XLSX.utils.book_append_sheet(wb, ws, `Puentes_${etiqueta}`);
    const hoy = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Operaciones_Puentes_${etiqueta}_${hoy}.xlsx`);
  };

  const toggleSeleccion = (id: string) =>
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);

  const resumenSeleccion = useMemo(() => {
    let subtotal = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) { subtotal += getPuente(op); refs.push(op.ref || op.id?.substring(0, 6)); }
    });
    return { subtotal, refs };
  }, [seleccionadas, operacionesGlobales]);

  const generarConsecutivo = (fechaStr: string) => {
    const [year, month, day] = fechaStr.split('-');
    const prefix = `PUENTES-${day}${month}${year}-`;
    const delDia = referenciasGlobales.filter(r => r.consecutivo?.startsWith(prefix));
    let maxSeq = 0;
    delDia.forEach(r => {
      const parts = r.consecutivo.split('-');
      if (parts.length === 3) { const seq = parseInt(parts[2], 10); if (seq > maxSeq) maxSeq = seq; }
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  const abrirModalGenerar = () => {
    setConsecutivoForm(generarConsecutivo(fechaPago));
    setStatusPagado('Pendiente');
    setObservacionesForm('');
    setModalAbierto(true);
  };

  const traficoPredominante = useMemo(() => {
    let imp = 0, exp = 0;
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (!op) return;
      const tr = getTrafico(op);
      if (tr === 'Importación') imp++; else if (tr === 'Exportación') exp++;
    });
    if (imp && exp) return 'Mixto';
    if (imp) return 'Importación';
    if (exp) return 'Exportación';
    return '—';
  }, [seleccionadas, operacionesGlobales]);

  const handleGuardarReferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (seleccionadas.length === 0) return alert('Selecciona al menos una operación.');
    setGuardando(true);
    try {
      const batch = writeBatch(db);
      const nuevoId = doc(collection(db, 'referencias_puentes')).id;
      const consecutivoFinal = generarConsecutivo(fechaPago);

      const operacionesGuardadas = seleccionadas.map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        return {
          id,
          ref: op?.ref || id.substring(0, 6),
          fecha: op?.fechaServicio || op?.fecha || '',
          trafico: op ? getTrafico(op) : '—',
          operador: op ? getNombreOperador(op.operadorNombre || op.operadorId || op.operador) : '-',
          cliente: op ? getCliente(op) : '-',
          origen: op?.origen || '-',
          destino: op?.destino || '-',
          puente: op ? getPuente(op) : 0,
        };
      });

      const data = {
        consecutivo: consecutivoFinal,
        fechaPago, fechaInicio, fechaFin,
        filtroTrafico,
        traficoPredominante,
        operacionesIds: seleccionadas,
        operacionesGuardadas,
        subtotalPuentes: resumenSeleccion.subtotal,
        statusPagado: statusPagado === 'Pagada',
        observaciones: observacionesForm,
        createdAt: new Date().toISOString(),
      };

      batch.set(doc(db, 'referencias_puentes', nuevoId), data);
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { referenciaPuentesId: nuevoId, referenciaPuentesConsecutivo: consecutivoFinal });
      });

      await batch.commit();
      const idsAsignadas = [...seleccionadas];
      setOperacionesGlobales(prev => prev.map(op =>
        idsAsignadas.includes(op.id) ? { ...op, referenciaPuentesId: nuevoId, referenciaPuentesConsecutivo: consecutivoFinal } : op
      ));
      setModalAbierto(false);
      setSeleccionadas([]);
      setActiveTab('historial');
    } catch (error) {
      console.error(error);
      alert('Error al guardar la referencia de puentes.');
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarReferencia = async (e: React.MouseEvent, refData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Eliminar la referencia ${refData.consecutivo}? Las operaciones quedarán liberadas nuevamente.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'referencias_puentes', refData.id));
        if (Array.isArray(refData.operacionesIds)) {
          refData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), { referenciaPuentesId: null, referenciaPuentesConsecutivo: null });
          });
        }
        await batch.commit();
        const idsLiberadas: string[] = Array.isArray(refData.operacionesIds) ? refData.operacionesIds : [];
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, referenciaPuentesId: null, referenciaPuentesConsecutivo: null } : op
        ));
      } catch (error) {
        console.error('Error al eliminar referencia:', error);
        alert('Hubo un error al eliminar.');
      }
    }
  };

  const handleTogglePago = async (e: React.MouseEvent, refData: any) => {
    e.stopPropagation();
    const nuevoPagado = !refData.statusPagado;
    const accion = nuevoPagado ? 'marcar como PAGADA' : 'regresar a PENDIENTE';
    if (!window.confirm(`¿Deseas ${accion} la referencia ${refData.consecutivo}?`)) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'referencias_puentes', refData.id), { statusPagado: nuevoPagado });
      await batch.commit();
      setReferenciasGlobales(prev => prev.map(r => r.id === refData.id ? { ...r, statusPagado: nuevoPagado } : r));
    } catch (error) {
      console.error('Error al actualizar estatus:', error);
      alert('No se pudo actualizar el estatus.');
    }
  };

  // ── Historial ──
  const historialBusqueda = useMemo(() => {
    const t = busquedaHistorial.toLowerCase();
    return referenciasGlobales.filter(r =>
      r.consecutivo?.toLowerCase().includes(t) ||
      String(r.traficoPredominante || '').toLowerCase().includes(t)
    );
  }, [referenciasGlobales, busquedaHistorial]);

  const conteoHist = useMemo(() => {
    const pagadas = historialBusqueda.filter(r => !!r.statusPagado).length;
    return { pendientes: historialBusqueda.length - pagadas, pagadas };
  }, [historialBusqueda]);

  const historialFiltrado = useMemo(() =>
    historialBusqueda.filter(r => filtroEstadoHist === 'pagadas' ? !!r.statusPagado : !r.statusPagado),
  [historialBusqueda, filtroEstadoHist]);

  const totalPaginas = Math.ceil(historialFiltrado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialFiltrado.slice(indexFirst, indexLast);
  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  useEffect(() => { setPaginaActual(1); }, [busquedaHistorial, filtroEstadoHist]);

  const exportarHistorialExcel = () => {
    if (historialFiltrado.length === 0) return alert('No hay datos para exportar.');
    const datos = historialFiltrado.map(r => ({
      'Consecutivo': r.consecutivo,
      'Tráfico': r.traficoPredominante || '-',
      'Fecha Pago': formatearFechaSpanish(r.fechaPago),
      'Período': `${formatearFechaSpanish(r.fechaInicio)} al ${formatearFechaSpanish(r.fechaFin)}`,
      'Status': r.statusPagado ? 'PAGADA' : 'PENDIENTE',
      'Operaciones': Array.isArray(r.operacionesIds) ? r.operacionesIds.length : 0,
      'Subtotal Puentes': Number(r.subtotalPuentes || 0),
      'Observaciones': r.observaciones || ''
    }));
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Puentes');
    XLSX.writeFile(wb, `Historial_Puentes_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any
  });
  const thOrdenStyle: React.CSSProperties = { padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const selectOrdenStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 10px', fontSize: '0.85rem' };
  const btnDirStyle: React.CSSProperties = { backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' };
  const colsOpsVisibles = columnasOps.filter(c => c.visible).length + 1;
  const labelFiltro: React.CSSProperties = { color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' };
  const inputFiltro: React.CSSProperties = { width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Referencias de Puentes</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Referencias</button>
      </div>

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ minWidth: '200px' }}>
              <label style={labelFiltro}>TRÁFICO</label>
              <select value={filtroTrafico} onChange={e => { setFiltroTrafico(e.target.value as any); setSeleccionadas([]); }} style={{ ...inputFiltro, cursor: 'pointer' }}>
                <option value="todos">Todos</option>
                <option value="importacion">Importación</option>
                <option value="exportacion">Exportación</option>
              </select>
            </div>
            <div>
              <label style={labelFiltro}>FECHA SERVICIO (Inicio)</label>
              <input type="date" value={fechaInicio} onChange={e => { setFechaInicio(e.target.value); setSeleccionadas([]); }} style={inputFiltro} />
            </div>
            <div>
              <label style={labelFiltro}>FECHA SERVICIO (Fin)</label>
              <input type="date" value={fechaFin} onChange={e => { setFechaFin(e.target.value); setSeleccionadas([]); }} style={inputFiltro} />
            </div>
            {(fechaInicio || fechaFin || filtroTrafico !== 'todos') && (
              <button onClick={() => { setFechaInicio(''); setFechaFin(''); setFiltroTrafico('todos'); setSeleccionadas([]); }} style={{ ...btnDirStyle, height: '40px' }}>Limpiar filtros</button>
            )}
            <button
              disabled={seleccionadas.length === 0 || filtroEstadoOps === 'asignadas'}
              onClick={abrirModalGenerar}
              style={{ padding: '10px 20px', backgroundColor: (seleccionadas.length > 0 && filtroEstadoOps !== 'asignadas') ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && filtroEstadoOps !== 'asignadas') ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
              Generar Referencia ({seleccionadas.length})
            </button>
          </div>

          {filtrosCompletos ? (
          <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setFiltroEstadoOps('pendientes')}
                style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                  border: `1px solid ${filtroEstadoOps === 'pendientes' ? '#ef4444' : '#30363d'}`,
                  backgroundColor: filtroEstadoOps === 'pendientes' ? 'rgba(239,68,68,0.15)' : 'transparent',
                  color: filtroEstadoOps === 'pendientes' ? '#ef4444' : '#8b949e' }}>
                ● Pendientes ({conteoOps.pendientes})
              </button>
              <button onClick={() => { setFiltroEstadoOps('asignadas'); setSeleccionadas([]); }}
                style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                  border: `1px solid ${filtroEstadoOps === 'asignadas' ? '#10b981' : '#30363d'}`,
                  backgroundColor: filtroEstadoOps === 'asignadas' ? 'rgba(16,185,129,0.15)' : 'transparent',
                  color: filtroEstadoOps === 'asignadas' ? '#10b981' : '#8b949e' }}>
                ● Asignadas ({conteoOps.asignadas})
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
              <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
                <option value="fechaServicio">Fecha Servicio</option>
                <option value="ref">Referencia</option>
                <option value="trafico">Tráfico</option>
                <option value="operador">Operador</option>
                <option value="cliente">Cliente</option>
                <option value="puente">Puente</option>
              </select>
              <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
            <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>
              {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'operación' : 'operaciones'}{(fechaInicio || fechaFin) ? ` · ${fechaInicio ? formatearFechaSpanish(fechaInicio) : '...'} al ${fechaFin ? formatearFechaSpanish(fechaFin) : '...'}` : ''}{filtroTrafico !== 'todos' ? ` · ${filtroTrafico === 'importacion' ? 'Importación' : 'Exportación'}` : ''}
            </span>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">⚙ Configurar Columnas</button>
              <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                  cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                  backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                  color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                ⬇ Exportar Excel ({filtroEstadoOps === 'asignadas' ? 'Asignadas' : 'Pendientes'})
              </button>
            </div>
          </div>

          {seleccionadas.length > 0 && filtroEstadoOps === 'pendientes' && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Tráfico</span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{chipTrafico(traficoPredominante)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Subtotal Puentes</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
                </div>
              </div>
            </div>
          )}

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
                {operacionesMostradas.length === 0 ? (
                  <tr><td colSpan={colsOpsVisibles} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>
                    {filtroEstadoOps === 'pendientes' ? 'No hay operaciones pendientes con estos filtros.' : 'No hay operaciones asignadas a referencias con estos filtros.'}
                  </td></tr>
                ) : (
                  operacionesMostradas.map(op => {
                    const seleccionable = filtroEstadoOps === 'pendientes';
                    return (
                      <tr key={op.id} onClick={() => seleccionable && toggleSeleccion(op.id)}
                        style={{ cursor: seleccionable ? 'pointer' : 'default', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                        <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {seleccionable ? (
                            <input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                          ) : (
                            <span title={op.referenciaPuentesConsecutivo || 'Asignada'} style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                          )}
                        </td>
                        {columnasOps.filter(c => c.visible).map(col => renderCeldaOps(op, col.id))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          </>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e', border: '1px solid #30363d', borderRadius: '8px', backgroundColor: '#161b22' }}>
              Selecciona una <b>Fecha de Servicio</b> (inicio o fin) para comenzar a ver las operaciones.
            </div>
          )}
        </div>

      ) : (
        <div className="animation-fade-in">
          <div style={{ position: 'relative', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <input type="text" placeholder="Buscar en historial (Consecutivo, Tráfico)..." value={busquedaHistorial} onChange={e => setBusquedaHistorial(e.target.value)} style={{ width: '100%', maxWidth: '400px', padding: '10px 16px', backgroundColor: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            <button title="Exportar a Excel" onClick={exportarHistorialExcel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <button onClick={() => setFiltroEstadoHist('pendientes')}
              style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                border: `1px solid ${filtroEstadoHist === 'pendientes' ? '#f59e0b' : '#30363d'}`,
                backgroundColor: filtroEstadoHist === 'pendientes' ? 'rgba(245,158,11,0.15)' : 'transparent',
                color: filtroEstadoHist === 'pendientes' ? '#f59e0b' : '#8b949e' }}>
              ● Pendientes ({conteoHist.pendientes})
            </button>
            <button onClick={() => setFiltroEstadoHist('pagadas')}
              style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                border: `1px solid ${filtroEstadoHist === 'pagadas' ? '#10b981' : '#30363d'}`,
                backgroundColor: filtroEstadoHist === 'pagadas' ? 'rgba(16,185,129,0.15)' : 'transparent',
                color: filtroEstadoHist === 'pagadas' ? '#10b981' : '#8b949e' }}>
              ● Pagadas ({conteoHist.pagadas})
            </button>
          </div>

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>ACCIONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CONSECUTIVO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>STATUS</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>TRÁFICO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>FECHA PAGO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>PERÍODO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>OPS.</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>SUBTOTAL PUENTES</th>
                </tr>
              </thead>
              <tbody>
                {registrosVisibles.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                    {filtroEstadoHist === 'pendientes' ? 'No hay referencias pendientes de pago.' : 'No hay referencias pagadas.'}
                  </td></tr>
                ) : (
                  registrosVisibles.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          {r.statusPagado ? (
                            <button title="Regresar a Pendiente" onClick={(e) => handleTogglePago(e, r)} style={{ background: 'transparent', border: '1px solid #f59e0b', borderRadius: '4px', color: '#f59e0b', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                            </button>
                          ) : (
                            <button title="Marcar como Pagada" onClick={(e) => handleTogglePago(e, r)} style={{ background: 'transparent', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </button>
                          )}
                          <button title="Ver Detalle" onClick={() => setReferenciaViendo(r)} style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button title="Eliminar" onClick={(e) => handleEliminarReferencia(e, r)} style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{r.consecutivo}</td>
                      <td style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                        <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold',
                          backgroundColor: r.statusPagado ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: r.statusPagado ? '#10b981' : '#f59e0b',
                          border: `1px solid ${r.statusPagado ? '#10b981' : '#f59e0b'}` }}>
                          {r.statusPagado ? 'PAGADA' : 'PENDIENTE'}
                        </span>
                      </td>
                      <td style={{ padding: '16px', whiteSpace: 'nowrap' }}>{chipTrafico(r.traficoPredominante || '—')}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(r.fechaPago)}</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(r.fechaInicio)} <br/>al {formatearFechaSpanish(r.fechaFin)}</td>
                      <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', whiteSpace: 'nowrap', textAlign: 'center' }}>{Array.isArray(r.operacionesIds) ? r.operacionesIds.length : 0}</td>
                      <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(r.subtotalPuentes)}</td>
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

      {/* MODAL CONFIGURAR COLUMNAS */}
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

      {/* MODAL GENERAR REFERENCIA */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '720px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '16px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Generar Referencia: <span style={{ color: '#D84315' }}>{consecutivoForm}</span></h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d', marginBottom: '20px' }}>
              <div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones ({seleccionadas.length})</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{chipTrafico(traficoPredominante)}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Subtotal Puentes</span>
                <span style={{ color: '#3fb950', fontSize: '1.3rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
              </div>
            </div>

            <form onSubmit={handleGuardarReferencia}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <label style={labelFiltro}>Consecutivo</label>
                  <input readOnly value={consecutivoForm} style={{ ...inputFiltro, color: '#D84315', fontFamily: 'monospace', fontWeight: 'bold' }} />
                </div>
                <div>
                  <label style={labelFiltro}>Fecha Pago</label>
                  <input type="date" value={fechaPago} onChange={e => { setFechaPago(e.target.value); setConsecutivoForm(generarConsecutivo(e.target.value)); }} style={{ ...inputFiltro, color: '#fff' }} />
                </div>
                <div>
                  <label style={labelFiltro}>Status</label>
                  <select value={statusPagado} onChange={e => setStatusPagado(e.target.value as any)} style={{ ...inputFiltro, color: statusPagado === 'Pagada' ? '#10b981' : '#f0f6fc', fontWeight: 'bold' }}>
                    <option value="Pendiente">Pendiente</option>
                    <option value="Pagada">Pagada ✔</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <label style={labelFiltro}>Observaciones</label>
                <textarea value={observacionesForm} onChange={e => setObservacionesForm(e.target.value)} style={{ ...inputFiltro, color: '#fff', height: '60px' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '20px', marginTop: '20px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : 'Confirmar Referencia'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FICHA / DETALLE */}
      {referenciaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '900px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Detalle de Referencia</h2>
              <button onClick={() => setReferenciaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Consecutivo</span>
                  <span style={{ color: '#D84315', fontSize: '1.2rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{referenciaViendo.consecutivo}</span>
                </div>
                <div style={{ textAlign: 'center' }}>{chipTrafico(referenciaViendo.traficoPredominante || '—')}</div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Status</span>
                  <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold',
                    backgroundColor: referenciaViendo.statusPagado ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    color: referenciaViendo.statusPagado ? '#10b981' : '#f59e0b',
                    border: `1px solid ${referenciaViendo.statusPagado ? '#10b981' : '#f59e0b'}` }}>
                    {referenciaViendo.statusPagado ? 'PAGADA' : 'PENDIENTE'}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Subtotal Puentes</span>
                  <span style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>{formatoMoneda(referenciaViendo.subtotalPuentes)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '20px', color: '#c9d1d9', fontSize: '0.9rem' }}>
                <div><span style={{ color: '#8b949e' }}>Fecha de pago: </span>{formatearFechaSpanish(referenciaViendo.fechaPago)}</div>
                <div><span style={{ color: '#8b949e' }}>Período: </span>{formatearFechaSpanish(referenciaViendo.fechaInicio)} al {formatearFechaSpanish(referenciaViendo.fechaFin)}</div>
                {referenciaViendo.observaciones && <div><span style={{ color: '#8b949e' }}>Obs.: </span>{referenciaViendo.observaciones}</div>}
              </div>

              <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>
                Operaciones incluidas ({referenciaViendo.operacionesGuardadas?.length || 0})
              </span>
              <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead style={{ backgroundColor: '#1f2937', color: '#8b949e' }}>
                    <tr>
                      <th style={{ padding: '12px', whiteSpace: 'nowrap' }}>REFERENCIA</th>
                      <th style={{ padding: '12px', whiteSpace: 'nowrap' }}>FECHA</th>
                      <th style={{ padding: '12px', whiteSpace: 'nowrap' }}>TRÁFICO</th>
                      <th style={{ padding: '12px', whiteSpace: 'nowrap' }}>OPERADOR</th>
                      <th style={{ padding: '12px', whiteSpace: 'nowrap' }}>CLIENTE</th>
                      <th style={{ padding: '12px', whiteSpace: 'nowrap' }}>PUENTE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(referenciaViendo.operacionesGuardadas || []).map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d' }}>
                        <td style={{ padding: '12px', color: '#58a6ff', fontFamily: 'monospace', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{op.ref}</td>
                        <td style={{ padding: '12px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(op.fecha)}</td>
                        <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>{chipTrafico(op.trafico || '—')}</td>
                        <td style={{ padding: '12px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.operador || '-'}</td>
                        <td style={{ padding: '12px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.cliente || '-'}</td>
                        <td style={{ padding: '12px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(op.puente)}</td>
                      </tr>
                    ))}
                    {(!referenciaViendo.operacionesGuardadas || referenciaViendo.operacionesGuardadas.length === 0) && (
                      <tr><td colSpan={6} style={{ padding: '20px', textAlign: 'center', color: '#8b949e' }}>Sin detalle de operaciones.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
              <button onClick={() => setReferenciaViendo(null)} style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
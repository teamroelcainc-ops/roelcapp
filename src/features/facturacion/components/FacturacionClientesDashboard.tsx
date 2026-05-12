// src/features/facturacion/components/FacturacionClientesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

// 📋 DEFINICIÓN DE TODAS LAS COLUMNAS DINÁMICAS
const COLUMNAS_BASE = [
  { id: 'refOp', label: '# Referencia Op.' },
  { id: 'fecha', label: 'Fecha del Servicio' },
  { id: 'cartaPorte', label: '# Carta Porte' },
  { id: 'remolque', label: '# Remolque' },
  { id: 'refCliente', label: '# Ref. Cliente' },
  { id: 'clientePaga', label: 'Cliente que paga' },
  { id: 'operador', label: 'Operador' },
  { id: 'convenioProv', label: 'Convenio' },
  { id: 'facturadoEn', label: 'Facturado En' },
  { id: 'convenioCliente', label: 'Convenio del cliente' },
  { id: 'costosAdic', label: 'Costos adic. (Cliente)' },
  { id: 'totalFacturar', label: 'Total a facturar' },
  { id: 'dolaresCliente', label: 'Dólares cliente' },
  { id: 'tipoCambio', label: 'Tipo de cambio' },
  { id: 'pesosCliente', label: 'Pesos Cliente' },
  { id: 'observaciones', label: 'Observaciones' }
];

export const FacturacionClientesDashboard = () => {
  const [activeTab, setActiveTab] = useState<'por_facturar' | 'facturado'>('por_facturar');
  const [operaciones, setOperaciones] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState('');
  
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [operacionViendo, setOperacionViendo] = useState<any | null>(null);

  // DICCIONARIOS PARA TRADUCIR IDs
  const [clientesDict, setClientesDict] = useState<Record<string, string>>({});
  const [statusDict, setStatusDict] = useState<Record<string, string>>({});
  const [direccionesDict, setDireccionesDict] = useState<Record<string, string>>({});
  const [empleadosDict, setEmpleadosDict] = useState<Record<string, string>>({});
  const [remolquesDict, setRemolquesDict] = useState<Record<string, string>>({});

  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // ✅ ESTADOS PARA GESTIÓN DE COLUMNAS (Drag & Drop)
  const [modalConfigColumnas, setModalConfigColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c, visible: true })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // ✅ ESTADOS PARA EXCEL
  const [modalExcel, setModalExcel] = useState(false);
  const [columnasExcel, setColumnasExcel] = useState<string[]>(COLUMNAS_BASE.map(c => c.id));

  // 1. CARGAR DICCIONARIOS
  useEffect(() => {
    const unsubClientes = onSnapshot(collection(db, 'empresas'), (snapshot) => {
      const dict: Record<string, string> = {};
      snapshot.forEach(doc => { dict[doc.id] = doc.data().nombre || doc.data().nombreCorto || 'Cliente Desconocido'; });
      setClientesDict(dict);
    });
    const unsubStatus = onSnapshot(collection(db, 'catalogo_status_servicio'), (snapshot) => {
      const dict: Record<string, string> = {};
      snapshot.forEach(doc => { dict[doc.id] = doc.data().nombre || 'Status Desconocido'; });
      setStatusDict(dict);
    });
    const unsubDirecciones = onSnapshot(collection(db, 'direcciones'), (snapshot) => {
      const dict: Record<string, string> = {};
      snapshot.forEach(doc => { dict[doc.id] = doc.data().direccionCompleta || doc.data().calle || 'Dirección Desconocida'; });
      setDireccionesDict(dict);
    });
    const unsubEmpleados = onSnapshot(collection(db, 'empleados'), (snapshot) => {
      const dict: Record<string, string> = {};
      snapshot.forEach(doc => { 
        const data = doc.data();
        dict[doc.id] = `${data.firstName || ''} ${data.lastNamePaternal || ''}`.trim() || 'Operador Desconocido'; 
      });
      setEmpleadosDict(dict);
    });
    const unsubRemolques = onSnapshot(collection(db, 'remolques'), (snapshot) => {
      const dict: Record<string, string> = {};
      snapshot.forEach(doc => { dict[doc.id] = doc.data().economico || doc.data().numeroRemolque || 'Remolque Desconocido'; });
      setRemolquesDict(dict);
    });

    return () => { unsubClientes(); unsubStatus(); unsubDirecciones(); unsubEmpleados(); unsubRemolques(); };
  }, []);

  // 2. CARGAR OPERACIONES
  useEffect(() => {
    let qOperaciones;
    if (activeTab === 'por_facturar') {
      qOperaciones = query(collection(db, 'operaciones'), where('status', 'in', ['f557b751', 'c2d57403']));
    } else {
      qOperaciones = query(collection(db, 'operaciones'), where('facturado', '==', true), limit(150));
    }

    const unsubOperaciones = onSnapshot(qOperaciones, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setOperaciones(data);
    });

    return () => unsubOperaciones();
  }, [activeTab]);

  useEffect(() => {
    setPaginaActual(1);
    setSeleccionadas([]);
  }, [busqueda, activeTab]);

  const formatearFecha = (fechaString: string) => {
    if (!fechaString) return '-';
    try { return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }); } 
    catch { return fechaString; }
  };

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '-' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // PROCESAR Y FILTRAR REGISTROS
  const registrosFiltrados = useMemo(() => {
    let filtrados = operaciones.map(op => {
      const idClienteQuePaga = op.clientePaga || op.clientePagaId || op.clienteId;
      return {
        ...op,
        _clienteNombre: clientesDict[idClienteQuePaga] || idClienteQuePaga || 'Sin Cliente',
        _statusNombre: statusDict[op.status] || op.status || 'Sin Status',
        _numeroReferencia: op.numReferencia || op.numeroReferencia || op.referencia || op.folio || op.idOperacion || op.id?.substring(0,6),
        _origenNombre: direccionesDict[op.origenId || op.origen] || op.origenId || op.origen || '-',
        _destinoNombre: direccionesDict[op.destinoId || op.destino] || op.destinoId || op.destino || '-',
        _operadorNombre: empleadosDict[op.operadorId || op.operador] || op.operadorId || op.operador || '-',
        _remolqueNombre: remolquesDict[op.remolqueId || op.remolque] || op.remolqueId || op.remolque || '-'
      };
    });

    if (busqueda.trim() !== '') {
      const term = busqueda.toLowerCase();
      filtrados = filtrados.filter(op => 
        String(op._numeroReferencia || '').toLowerCase().includes(term) ||
        String(op._clienteNombre || '').toLowerCase().includes(term) ||
        String(op._origenNombre || '').toLowerCase().includes(term) ||
        String(op._destinoNombre || '').toLowerCase().includes(term) ||
        String(op.cartaPorte || '').toLowerCase().includes(term)
      );
    }
    return filtrados.sort((a, b) => (b.fechaServicio || b.createdAt || '').localeCompare(a.fechaServicio || a.createdAt || ''));
  }, [operaciones, busqueda, clientesDict, statusDict, direccionesDict, empleadosDict, remolquesDict]);

  const resumenSeleccion = useMemo(() => {
    let totalPesos = 0; let totalDolares = 0; let totalFacturar = 0; const referencias: string[] = [];
    seleccionadas.forEach(id => {
      const op = operaciones.find(o => o.id === id);
      if (op) {
        totalPesos += parseFloat(op.pesosCliente || op.montoMXN || 0);
        totalDolares += parseFloat(op.dolaresCliente || op.montoUSD || 0);
        totalFacturar += parseFloat(op.totalFacturar || op.total || op.subtotalCliente || 0);
        const numRef = op.numReferencia || op.numeroReferencia || op.referencia || op.folio || op.idOperacion || op.id?.substring(0,6);
        if (numRef) referencias.push(numRef);
      }
    });
    return { totalPesos, totalDolares, totalFacturar, cantidad: seleccionadas.length, referencias };
  }, [seleccionadas, operaciones]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const handleSelectRow = (id: string) => setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  // ✅ RENDERIZADOR DINÁMICO DE CELDAS
  const renderCellContent = (op: any, colId: string) => {
    switch (colId) {
      case 'refOp': return <span style={{ color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op._numeroReferencia}</span>;
      case 'fecha': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFecha(op.fechaServicio || op.fecha || op.createdAt)}</span>;
      case 'cartaPorte': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.cartaPorte || op.numeroCartaPorte || '-'}</span>;
      case 'remolque': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op._remolqueNombre}</span>;
      case 'refCliente': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.referenciaCliente || op.refCliente || '-'}</span>;
      case 'clientePaga': return <span style={{ color: '#f0f6fc', fontWeight: '500', whiteSpace: 'nowrap' }}>{op._clienteNombre}</span>;
      case 'operador': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op._operadorNombre}</span>;
      case 'convenioProv': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.convenio || op.nombreConvenio || '-'}</span>;
      case 'facturadoEn': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.facturadoEn || op.monedaFacturacion || '-'}</span>;
      case 'convenioCliente': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.convenioCliente || op.tarifaCliente || '-'}</span>;
      case 'costosAdic': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatoMoneda(op.costosAdicionalesCliente || op.cargosExtra)}</span>;
      case 'totalFacturar': return <span style={{ color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(op.totalFacturar || op.total || op.subtotalCliente)}</span>;
      case 'dolaresCliente': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatoMoneda(op.dolaresCliente || op.montoUSD)}</span>;
      case 'tipoCambio': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatoMoneda(op.tipoCambio || op.tipoCambioValor)}</span>;
      case 'pesosCliente': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatoMoneda(op.pesosCliente || op.montoMXN)}</span>;
      case 'observaciones': return <div style={{ color: '#8b949e', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={op.observaciones || op.notas || op.observacionesCobrar}>{op.observaciones || op.notas || op.observacionesCobrar || '-'}</div>;
      default: return '-';
    }
  };

  // ✅ LOGICA DRAG & DROP COLUMNAS
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedColIndex(index);
  };

  const handleDragEnter = (index: number) => {
    if (draggedColIndex === null || draggedColIndex === index) return;
    const nuevasColumnas = [...columnasTabla];
    const colMovida = nuevasColumnas.splice(draggedColIndex, 1)[0];
    nuevasColumnas.splice(index, 0, colMovida);
    setDraggedColIndex(index);
    setColumnasTabla(nuevasColumnas);
  };

  const toggleColumnaVisible = (index: number) => {
    const nuevas = [...columnasTabla];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasTabla(nuevas);
  };

  // ✅ EXPORTAR A EXCEL
  const generarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    if (columnasExcel.length === 0) return alert("Selecciona al menos una columna para exportar.");

    const datosExcel = registrosFiltrados.map(op => {
      const fila: any = {};
      
      columnasExcel.forEach(colId => {
        const config = COLUMNAS_BASE.find(c => c.id === colId);
        if (config) {
           let valRaw = renderCellContent(op, colId);
           // Si renderCell devuelve JSX, intentamos extraer el texto
           fila[config.label] = typeof valRaw === 'object' && valRaw.props ? (valRaw.props.children || '') : valRaw;
        }
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturacion');
    XLSX.writeFile(workbook, `Reporte_Facturacion_${new Date().toISOString().split('T')[0]}.xlsx`);
    setModalExcel(false);
  };

  const tabStyle = (isActive: boolean) => ({ padding: '12px 24px', background: 'none', border: 'none', borderBottom: isActive ? '2px solid #D84315' : '2px solid transparent', color: isActive ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontWeight: isActive ? '600' : 'normal', fontSize: '1rem', transition: 'all 0.2s ease', outline: 'none' });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', margin: '0 auto' }}>
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>Facturación de Clientes</h1>

        <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
          <button type="button" onClick={() => setActiveTab('por_facturar')} style={tabStyle(activeTab === 'por_facturar')}>Por Facturar</button>
          <button type="button" onClick={() => setActiveTab('facturado')} style={tabStyle(activeTab === 'facturado')}>Facturado</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
            <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" placeholder="Buscar por Referencia, Carta Porte, Cliente, Origen..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px 12px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }} />
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <button title="Configurar Columnas" onClick={() => setModalConfigColumnas(true)} style={{ backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button title="Exportar a Excel" onClick={() => setModalExcel(true)} style={{ backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            {activeTab === 'por_facturar' && (
              <button disabled={seleccionadas.length === 0} title="Generar Factura Múltiple" style={{ backgroundColor: seleccionadas.length === 0 ? '#30363d' : '#D84315', color: seleccionadas.length === 0 ? '#8b949e' : '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: seleccionadas.length === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.2s ease' }}>
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 1 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5z"/></svg>
                {seleccionadas.length > 0 && <span style={{marginLeft: '6px', fontWeight: 'bold'}}>{seleccionadas.length}</span>}
              </button>
            )}
          </div>
        </div>

        {/* ✅ PANEL DE SUMARIO DE FACTURACIÓN */}
        {activeTab === 'por_facturar' && seleccionadas.length > 0 && (
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }}>
              <div style={{ borderRight: '1px solid #30363d' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Seleccionadas</span>
                <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenSeleccion.cantidad}</span>
              </div>
              <div style={{ borderRight: '1px solid #30363d' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma en Dólares</span>
                <span style={{ color: '#3fb950', fontSize: '1.5rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.totalDolares)}</span>
              </div>
              <div style={{ borderRight: '1px solid #30363d' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma en Pesos</span>
                <span style={{ color: '#3fb950', fontSize: '1.5rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.totalPesos)}</span>
              </div>
              <div>
                <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total a Facturar Estimado</span>
                <span style={{ color: '#f0f6fc', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.totalFacturar)}</span>
              </div>
            </div>
            <div style={{ borderTop: '1px dashed #30363d', paddingTop: '16px' }}>
              <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Operaciones incluidas:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {resumenSeleccion.referencias.map((ref, i) => (
                  <span key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', fontFamily: 'monospace' }}>{ref}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TABLA DE DATOS DINÁMICA */}
        <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', backgroundColor: '#161b22' }}>
          <table style={{ width: '100%', minWidth: '1500px', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ backgroundColor: '#1f2937' }}>
              <tr>
                {activeTab === 'por_facturar' && (
                  <th style={{ padding: '16px', width: '50px', borderBottom: '1px solid #30363d', position: 'sticky', left: 0, backgroundColor: '#1f2937', zIndex: 10 }}></th>
                )}
                <th style={{ padding: '16px', width: '100px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', borderBottom: '1px solid #30363d', position: 'sticky', left: activeTab === 'por_facturar' ? '50px' : 0, backgroundColor: '#1f2937', zIndex: 10 }}>Acciones</th>
                {columnasTabla.filter(c => c.visible).map(col => (
                  <th key={col.id} style={{ padding: '16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', borderBottom: '1px solid #30363d' }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registrosEnPantalla.length === 0 ? (
                <tr><td colSpan={columnasTabla.length + 2} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay operaciones para mostrar.</td></tr>
              ) : (
                registrosEnPantalla.map(op => (
                  <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(59, 130, 246, 0.1)' : 'transparent', transition: 'background-color 0.2s', cursor: 'pointer' }} onClick={() => setOperacionViendo(op)} onMouseEnter={(e:any) => e.currentTarget.style.backgroundColor = seleccionadas.includes(op.id) ? 'rgba(59, 130, 246, 0.15)' : '#21262d'} onMouseLeave={(e:any) => e.currentTarget.style.backgroundColor = seleccionadas.includes(op.id) ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}>
                    {activeTab === 'por_facturar' && (
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: seleccionadas.includes(op.id) ? 'rgba(59, 130, 246, 0.15)' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={seleccionadas.includes(op.id)} onChange={() => handleSelectRow(op.id)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                      </td>
                    )}
                    <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: activeTab === 'por_facturar' ? '50px' : 0, backgroundColor: seleccionadas.includes(op.id) ? 'rgba(59, 130, 246, 0.15)' : 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e) => e.stopPropagation()}>
                      <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button type="button" title="Editar Operación" onClick={(e) => { e.stopPropagation(); console.log("Editar"); }} style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                        <button type="button" title="Eliminar Operación" onClick={(e) => { e.stopPropagation(); console.log("Eliminar"); }} style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                      </div>
                    </td>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <td key={col.id} style={{ padding: '16px' }}>{renderCellContent(op, col.id)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* CONTROLES DE PAGINACIÓN */}
        {registrosFiltrados.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px' }}>
            <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button title="Página Anterior" onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
              <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
              <button title="Página Siguiente" onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
            </div>
          </div>
        )}
      </div>

      {/* ✅ MODAL PARA ORDENAR Y OCULTAR COLUMNAS (Drag and Drop nativo) */}
      {modalConfigColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '400px', maxWidth: '90%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalConfigColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '16px' }}>Arrastra las filas para reordenar las columnas de la tabla. Desmarca las que desees ocultar.</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '50vh', overflowY: 'auto' }}>
              {columnasTabla.map((col, idx) => (
                <li 
                  key={col.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', marginBottom: '8px', borderRadius: '6px', cursor: 'grab' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} style={{ cursor: 'pointer' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button onClick={() => setModalConfigColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL DE EXPORTACIÓN A EXCEL */}
      {modalExcel && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '500px', maxWidth: '90%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#238636" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Exportar Reporte
              </h3>
              <button onClick={() => setModalExcel(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.9rem', marginBottom: '16px' }}>Selecciona las columnas que deseas incluir en el archivo Excel:</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', maxHeight: '50vh', overflowY: 'auto' }}>
              {COLUMNAS_BASE.map(col => {
                const isChecked = columnasExcel.includes(col.id);
                return (
                  <label key={`ex_${col.id}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isChecked ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={isChecked} onChange={() => setColumnasExcel(prev => prev.includes(col.id) ? prev.filter(k => k !== col.id) : [...prev, col.id])} />
                    {col.label}
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
              <button onClick={() => setColumnasExcel(COLUMNAS_BASE.map(c => c.id))} style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', textDecoration: 'underline' }}>Seleccionar Todas</button>
              <button onClick={generarExcel} style={{ backgroundColor: '#238636', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Descargar Excel</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALLES DE LA OPERACIÓN (Visualizador Oculto) */}
      {operacionViendo && (
        <div className="modal-overlay" style={{ zIndex: 1500, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ maxWidth: '600px', width: '100%', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ borderBottom: '1px solid #30363d', padding: '24px', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Detalles de la Operación</h2>
              <button onClick={() => setOperacionViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div style={{ gridColumn: 'span 2' }}><span style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block' }}>Cliente que Paga</span><span style={{ color: '#58a6ff', fontSize: '1.1rem', fontWeight: 'bold' }}>{operacionViendo._clienteNombre}</span></div>
              <div><span style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block' }}>Número de Referencia</span><span style={{ color: '#f0f6fc', fontFamily: 'monospace' }}>{operacionViendo._numeroReferencia}</span></div>
              <div><span style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block' }}>Fecha de Servicio</span><span style={{ color: '#c9d1d9' }}>{formatearFecha(operacionViendo.fechaServicio || operacionViendo.fecha || operacionViendo.createdAt)}</span></div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
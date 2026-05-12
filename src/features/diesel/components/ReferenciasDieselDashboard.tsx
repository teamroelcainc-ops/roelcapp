// src/features/diesel/components/ReferenciasDieselDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  getDocs, 
  where, 
  writeBatch, 
  doc, 
  limit 
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

export const ReferenciasDieselDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'referencias'>('operaciones');
  
  // Datos Globales
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [referenciasGlobales, setReferenciasGlobales] = useState<any[]>([]);
  
  // Catálogos
  const [unidadesList, setUnidadesList] = useState<any[]>([]);
  const [operadoresList, setOperadoresList] = useState<any[]>([]);
  const [proveedoresList, setProveedoresList] = useState<any[]>([]);

  // Filtros Pestaña 1
  const [filtroUnidad, setFiltroUnidad] = useState('');
  const [filtroOperador, setFiltroOperador] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  // Buscador y Paginación Pestaña 2
  const [busquedaRef, setBusquedaRef] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Estado del Modal (Formulario)
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [referenciaViendo, setReferenciaViendo] = useState<any | null>(null);

  // Campos del Formulario
  const [fechaForm, setFechaForm] = useState(new Date().toISOString().split('T')[0]);
  const [consecutivoForm, setConsecutivoForm] = useState('');
  const [galonesAutorizados, setGalonesAutorizados] = useState<number | ''>('');
  const [galonesCargados, setGalonesCargados] = useState<number | ''>('');
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState('');
  const [costoDieselDiario, setCostoDieselDiario] = useState<number>(0);
  const [observacionesForm, setObservacionesForm] = useState('');

  // FUNCIÓN: Formatear a Moneda
  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 1. CARGAR DATOS Y CATÁLOGOS CON LÍMITE
  useEffect(() => {
    const unSubUnidades = onSnapshot(collection(db, 'unidades'), (snap) => {
      setUnidadesList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubEmpleados = onSnapshot(collection(db, 'empleados'), (snap) => {
      setOperadoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubEmpresas = onSnapshot(collection(db, 'empresas'), (snap) => {
      setProveedoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    // Limitamos a las últimas 300 operaciones para ahorrar lecturas
    const qOps = query(collection(db, 'operaciones'), limit(300));
    const unSubOperaciones = onSnapshot(qOps, (snap) => {
      const ops = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      ops.sort((a: any, b: any) => new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime());
      setOperacionesGlobales(ops);
    });

    // Limitamos a las últimas 200 referencias de diesel
    const qRefs = query(collection(db, 'referencias_diesel'), limit(200));
    const unSubReferencias = onSnapshot(qRefs, (snap) => {
      const refs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      refs.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setReferenciasGlobales(refs);
    });

    return () => { unSubUnidades(); unSubEmpleados(); unSubEmpresas(); unSubOperaciones(); unSubReferencias(); };
  }, []);

  // 2. BUSCAR COSTO DEL DIESEL POR FECHA
  useEffect(() => {
    if (!fechaForm) return;
    const fetchCosto = async () => {
      try {
        const q = query(collection(db, 'combustibles'), where('fecha', '==', fechaForm));
        const snap = await getDocs(q);
        if (!snap.empty) {
          setCostoDieselDiario(Number(snap.docs[0].data().costo || 0));
        } else {
          setCostoDieselDiario(0);
        }
      } catch (error) {
        setCostoDieselDiario(0);
      }
    };
    fetchCosto();
  }, [fechaForm]);

  // 3. GENERADOR DE CONSECUTIVO (DIESEL-DDMMAA-SEQ)
  const generarConsecutivo = (fechaStr: string) => {
    const [year, month, day] = fechaStr.split('-');
    const aa = year.slice(2);
    const prefix = `DIESEL-${day}${month}${aa}-`;
    const referenciasHoy = referenciasGlobales.filter(r => r.consecutivo?.startsWith(prefix));
    let maxSeq = 0;
    referenciasHoy.forEach(r => {
      const parts = r.consecutivo.split('-');
      if (parts.length === 3) {
        const seq = parseInt(parts[2], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  // 4. LÓGICA DE ASIGNACIÓN (PESTAÑA 1)
  const operacionesPendientes = useMemo(() => {
    if (!filtroUnidad || !filtroOperador) return [];
    return operacionesGlobales.filter(op => {
      const matchUnidad = op.unidad === filtroUnidad || op.unidadId === filtroUnidad;
      const matchOperador = op.operador === filtroOperador || op.operadorId === filtroOperador;
      const noAsignada = !op.referenciaDieselId;
      return matchUnidad && matchOperador && noAsignada;
    });
  }, [operacionesGlobales, filtroUnidad, filtroOperador]);

  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const resumenSeleccion = useMemo(() => {
    let dieselTotal = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        dieselTotal += Number(op.combustibleTotal || 0);
        refs.push(op.ref || op.id?.substring(0,6));
      }
    });
    return { dieselTotal, refs };
  }, [seleccionadas, operacionesGlobales]);

  // Helpers UI (Se usan al guardar y mostrar)
  const getNombreUnidad = (id: string) => unidadesList.find(u => u.id === id)?.unidad || id;
  const getNombreOperador = (id: string) => {
    const op = operadoresList.find(o => o.id === id);
    return op ? `${op.firstName || ''} ${op.lastNamePaternal || ''}`.trim() : id;
  };
  const getNombreProveedor = (id: string) => proveedoresList.find(p => p.id === id)?.nombre || id;

  const formatearFechaSpanish = (fechaString: string) => {
    if (!fechaString) return '-';
    try { 
      return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }); 
    } 
    catch { return fechaString; }
  };

  // 5. GUARDADO MASIVO (BATCH)
  const handleGuardarReferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proveedorSeleccionado) return alert("Selecciona un proveedor.");
    setGuardando(true);
    try {
      const batch = writeBatch(db);
      const nuevoRefId = doc(collection(db, 'referencias_diesel')).id;
      const consecutivoFinal = generarConsecutivo(fechaForm);

      const data = {
        consecutivo: consecutivoFinal,
        fecha: fechaForm,
        unidadId: filtroUnidad,
        unidadNombre: getNombreUnidad(filtroUnidad),
        operadorId: filtroOperador,
        operadorNombre: getNombreOperador(filtroOperador),
        operacionesIds: seleccionadas,
        sumaDiesel: resumenSeleccion.dieselTotal,
        galonesAutorizados: Number(galonesAutorizados),
        galonesCargados: Number(galonesCargados),
        proveedorId: proveedorSeleccionado,
        proveedorNombre: getNombreProveedor(proveedorSeleccionado),
        costoDiesel: costoDieselDiario,
        totalAutorizado: Number(galonesAutorizados) * costoDieselDiario,
        totalCargado: Number(galonesCargados) * costoDieselDiario,
        observaciones: observacionesForm,
        createdAt: new Date().toISOString()
      };

      batch.set(doc(db, 'referencias_diesel', nuevoRefId), data);
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { referenciaDieselId: nuevoRefId, referenciaDieselConsecutivo: consecutivoFinal });
      });

      await batch.commit();
      setModalAbierto(false);
      setSeleccionadas([]);
      setActiveTab('referencias');
    } catch (error) {
      alert("Error al guardar.");
    } finally {
      setGuardando(false);
    }
  };

  // 6. ELIMINAR REFERENCIA
  const handleEliminarReferencia = async (e: React.MouseEvent, refData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar la referencia ${refData.consecutivo}? Las operaciones asociadas volverán a estar disponibles.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'referencias_diesel', refData.id));

        if (Array.isArray(refData.operacionesIds)) {
          refData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), {
              referenciaDieselId: null,
              referenciaDieselConsecutivo: null
            });
          });
        }
        await batch.commit();
      } catch (error) {
        console.error("Error al eliminar referencia:", error);
        alert("Hubo un error al eliminar.");
      }
    }
  };

  // 7. HISTORIAL Y PAGINACIÓN (PESTAÑA 2)
  const referenciasFiltradas = useMemo(() => {
    const t = busquedaRef.toLowerCase();
    return referenciasGlobales.filter(r => 
      r.consecutivo?.toLowerCase().includes(t) || r.unidadNombre?.toLowerCase().includes(t)
    );
  }, [referenciasGlobales, busquedaRef]);

  // SUMARIO DE HISTORIAL (PESTAÑA 2)
  const resumenHistorial = useMemo(() => {
    let totalGalones = 0;
    let granTotalCargado = 0;
    referenciasFiltradas.forEach(r => {
      totalGalones += Number(r.galonesCargados) || 0;
      granTotalCargado += Number(r.totalCargado) || 0;
    });
    return { totalGalones, granTotalCargado };
  }, [referenciasFiltradas]);

  const totalPaginas = Math.ceil(referenciasFiltradas.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = referenciasFiltradas.slice(indexFirst, indexLast);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  // EXPORTACIÓN EXCEL USANDO XLSX
  const exportarCSV = () => {
    if (referenciasFiltradas.length === 0) return alert("No hay datos para exportar.");
    const datosExcel = referenciasFiltradas.map(ref => ({
      'Consecutivo': ref.consecutivo,
      'Fecha': formatearFechaSpanish(ref.fecha),
      'Unidad': ref.unidadNombre,
      'Operador': ref.operadorNombre,
      'Proveedor': ref.proveedorNombre,
      'Suma de Diesel (Ref)': ref.sumaDiesel,
      'Galones Autorizados': ref.galonesAutorizados,
      'Galones Cargados': ref.galonesCargados,
      'Costo Diario Diesel': ref.costoDiesel,
      'Total Autorizado': ref.totalAutorizado,
      'Total Cargado': ref.totalCargado,
      'Observaciones': ref.observaciones
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Referencias Diesel');
    XLSX.writeFile(workbook, `Referencias_Diesel_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Estilos
  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any
  });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Referencias del Diesel</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('referencias')} style={tabStyle(activeTab === 'referencias')}>Historial de Referencias</button>
      </div>

      {/* =========================================
          PESTAÑA 1: OPERACIONES PENDIENTES
      ========================================= */}
      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          
          <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>UNIDAD</label>
              <select value={filtroUnidad} onChange={e => { setFiltroUnidad(e.target.value); setSeleccionadas([]); }} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }}>
                <option value="">Seleccionar...</option>
                {unidadesList.map(u => <option key={u.id} value={u.id}>{u.unidad}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>OPERADOR</label>
              <select value={filtroOperador} onChange={e => { setFiltroOperador(e.target.value); setSeleccionadas([]); }} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }}>
                <option value="">Seleccionar...</option>
                {operadoresList.map(o => <option key={o.id} value={o.id}>{o.firstName} {o.lastNamePaternal}</option>)}
              </select>
            </div>
            <button 
              disabled={seleccionadas.length === 0} 
              onClick={() => { setConsecutivoForm(generarConsecutivo(fechaForm)); setModalAbierto(true); }}
              style={{ padding: '10px 20px', backgroundColor: seleccionadas.length > 0 ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: seleccionadas.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}
            >
              Generar Referencia ({seleccionadas.length})
            </button>
          </div>

          {/* PANEL DE SUMARIO DE OPERACIONES SELECCIONADAS (PESTAÑA 1) */}
          {seleccionadas.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones Seleccionadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma Combustible Total</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.dieselTotal)}</span>
                </div>
              </div>
              <div style={{ borderTop: '1px dashed #30363d', paddingTop: '16px' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Operaciones incluidas:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {resumenSeleccion.refs.map((ref, i) => (
                    <span key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', fontFamily: 'monospace' }}>{ref}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ✅ CONTENEDOR CON SCROLL Y ENCABEZADO FIJO (PESTAÑA 1) */}
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '50px', textAlign: 'center', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>
                    {/* Checkbox global removido a petición */}
                  </th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>REF. OPERACIÓN</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>FECHA SERVICIO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>ORIGEN</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>DESTINO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>DIESEL (OP)</th>
                </tr>
              </thead>
              <tbody>
                {operacionesPendientes.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>No hay operaciones pendientes para los filtros seleccionados.</td></tr>
                ) : (
                  operacionesPendientes.map(op => (
                    <tr key={op.id} onClick={() => toggleSeleccion(op.id)} style={{ cursor: 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                      <td style={{ padding: '16px', textAlign: 'center' }}><input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} /></td>
                      <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace' }}>{op.ref || op.id.substring(0,6)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9' }}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.origen || '-'}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.destino || '-'}</td>
                      <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold' }}>{formatoMoneda(op.combustibleTotal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      /* =========================================
         PESTAÑA 2: HISTORIAL DE REFERENCIAS
      ========================================= */
      ) : (
        <div className="animation-fade-in">
          
          <div style={{ position: 'relative', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <input type="text" placeholder="Buscar en historial..." value={busquedaRef} onChange={e => setBusquedaRef(e.target.value)} style={{ width: '100%', maxWidth: '400px', padding: '10px 16px', backgroundColor: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            <button title="Exportar a Excel" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          {/* PANEL DE SUMARIO DE HISTORIAL (PESTAÑA 2) */}
          {referenciasFiltradas.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Referencias Listadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{referenciasFiltradas.length}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Galones Cargados</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenHistorial.totalGalones.toFixed(2)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Gran Total (Costo Diesel)</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenHistorial.granTotalCargado)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ✅ CONTENEDOR CON SCROLL Y ENCABEZADO FIJO (PESTAÑA 2) */}
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>ACCIONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>CONSECUTIVO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>UNIDAD</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>PROVEEDOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>GALONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {registrosVisibles.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay referencias registradas.</td></tr>
                ) : (
                  registrosVisibles.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button title="Ver Ficha" onClick={() => setReferenciaViendo(r)} style={{ background: 'transparent', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981', cursor: 'pointer', padding: '6px', display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
                          <button title="Eliminar Referencia" onClick={(e) => handleEliminarReferencia(e, r)} style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                        </div>
                      </td>
                      <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace' }}>{r.consecutivo}</td>
                      <td style={{ padding: '16px', color: '#f0f6fc' }}>{r.unidadNombre}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9' }}>{r.proveedorNombre}</td>
                      <td style={{ padding: '16px', color: '#58a6ff' }}>{r.galonesCargados} Gal.</td>
                      <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold' }}>{formatoMoneda(r.totalCargado)}</td>
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

      {/* MODAL FORMULARIO */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '600px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Nueva Referencia: <span style={{ color: '#D84315' }}>{consecutivoForm}</span></h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <form onSubmit={handleGuardarReferencia}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA</label>
                  <input type="date" value={fechaForm} onChange={e => setFechaForm(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>PROVEEDOR</label>
                  <select required value={proveedorSeleccionado} onChange={e => setProveedorSeleccionado(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }}>
                    <option value="">Seleccionar...</option>
                    {proveedoresList.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>GALONES AUTORIZADOS</label>
                  <input type="number" step="0.01" value={galonesAutorizados} onChange={e => setGalonesAutorizados(e.target.valueAsNumber || '')} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>GALONES CARGADOS</label>
                  <input type="number" step="0.01" value={galonesCargados} onChange={e => setGalonesCargados(e.target.valueAsNumber || '')} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
              </div>

              <div style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{color: '#8b949e'}}>Costo Diesel ({fechaForm}):</span><span style={{color: '#fff', fontWeight: 'bold'}}>{formatoMoneda(costoDieselDiario)}</span></div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{color: '#8b949e'}}>Total Autorizado:</span><span style={{color: '#58a6ff', fontWeight: 'bold'}}>{formatoMoneda((Number(galonesAutorizados) || 0) * costoDieselDiario)}</span></div>
                 <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{color: '#8b949e'}}>Total Cargado:</span><span style={{color: '#3fb950', fontWeight: 'bold'}}>{formatoMoneda((Number(galonesCargados) || 0) * costoDieselDiario)}</span></div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>OBSERVACIONES</label>
                <textarea value={observacionesForm} onChange={e => setObservacionesForm(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px', height: '80px' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : 'Guardar Referencia'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FICHA REFERENCIA */}
      {referenciaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Ficha de Referencia Diesel</h2>
              <button onClick={() => setReferenciaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Consecutivo</span>
                    <span style={{ color: '#D84315', fontSize: '1.2rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{referenciaViendo.consecutivo}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Fecha</span>
                    <span style={{ color: '#c9d1d9', fontSize: '1rem', fontWeight: 'bold' }}>{formatearFechaSpanish(referenciaViendo.fecha)}</span>
                  </div>
                </div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Unidad</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{referenciaViendo.unidadNombre}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Operador</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{referenciaViendo.operadorNombre}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Proveedor</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{referenciaViendo.proveedorNombre}</span>
                </div>

                <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Suma de Diesel</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{formatoMoneda(referenciaViendo.sumaDiesel)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Costo Diario</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{formatoMoneda(referenciaViendo.costoDiesel)}</span>
                </div>
                <div></div>

                <div style={{ backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Galones Autorizados</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold' }}>{Number(referenciaViendo.galonesAutorizados).toFixed(2)}</span>
                  <span style={{ display: 'block', color: '#c9d1d9', fontSize: '0.85rem', marginTop: '4px' }}>Total: {formatoMoneda(referenciaViendo.totalAutorizado)}</span>
                </div>
                
                <div style={{ backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Galones Cargados</span>
                  <span style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>{Number(referenciaViendo.galonesCargados).toFixed(2)}</span>
                  <span style={{ display: 'block', color: '#c9d1d9', fontSize: '0.85rem', marginTop: '4px' }}>Total: {formatoMoneda(referenciaViendo.totalCargado)}</span>
                </div>
                <div></div>

                <div style={{ gridColumn: 'span 3' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Observaciones</span>
                  <div style={{ color: '#c9d1d9', backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d', minHeight: '60px' }}>
                    {referenciaViendo.observaciones || '-'}
                  </div>
                </div>

                <div style={{ gridColumn: 'span 3' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Operaciones Incluidas en esta Referencia</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {referenciaViendo.operacionesIds?.map((idOp: string) => {
                      const match = operacionesGlobales.find(o => o.id === idOp);
                      const displayRef = match ? (match.ref || match.id?.substring(0,6)) : idOp.substring(0,6);
                      return (
                        <span key={idOp} style={{ backgroundColor: '#21262d', border: '1px solid #30363d', color: '#58a6ff', padding: '4px 12px', borderRadius: '16px', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                          {displayRef}
                        </span>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>
            
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
              <button onClick={() => setReferenciaViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
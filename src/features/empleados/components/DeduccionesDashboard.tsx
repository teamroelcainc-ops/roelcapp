// src/features/empleados/components/DeduccionesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  doc, 
  setDoc,
  updateDoc,
  deleteDoc,
  orderBy
} from 'firebase/firestore';
// ⚠️ Si marca error aquí, verifica en qué carpeta está realmente tu archivo firebase.ts
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

export const DeduccionesDashboard = () => {
  // Datos Globales
  const [deduccionesGlobales, setDeduccionesGlobales] = useState<any[]>([]);
  const [empleadosList, setEmpleadosList] = useState<any[]>([]);

  // Paginación y Búsqueda
  const [busqueda, setBusqueda] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Estado del Modal (Crear/Editar)
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [deduccionEditando, setDeduccionEditando] = useState<any | null>(null);

  // Campos del Formulario
  const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState('');
  const [montoDeduccion, setMontoDeduccion] = useState<number | ''>('');
  const [gastos, setGastos] = useState<number | ''>('');
  const [infonavit, setInfonavit] = useState<number | ''>('');
  const [imss, setImss] = useState<number | ''>('');
  const [isr, setIsr] = useState<number | ''>('');
  const [descuento, setDescuento] = useState<number | ''>('');
  const [nominaFiscal, setNominaFiscal] = useState<number | ''>('');
  const [saldoPrestamo, setSaldoPrestamo] = useState<number | ''>('');
  const [ahorro, setAhorro] = useState<number | ''>('');
  const [ahorroAcumulado, setAhorroAcumulado] = useState<number | ''>('');
  const [ahorroInicial, setAhorroInicial] = useState<number | ''>('');
  const [fonacot, setFonacot] = useState<number | ''>('');
  const [otrosDepositos, setOtrosDepositos] = useState<number | ''>('');
  const [otrasDeducciones, setOtrasDeducciones] = useState<number | ''>('');
  const [abonosInicial, setAbonosInicial] = useState<number | ''>('');
  const [fonacotInicial, setFonacotInicial] = useState<number | ''>('');
  const [saldo, setSaldo] = useState<number | ''>('');

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // ✅ 1. CARGA DE DATOS (Deducciones y Empleados)
  useEffect(() => {
    const qDeducciones = query(collection(db, 'deducciones'), orderBy('createdAt', 'desc'));
    const unSubDeducciones = onSnapshot(qDeducciones, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      setDeduccionesGlobales(docs);
    });

    const unSubEmpleados = onSnapshot(collection(db, 'empleados'), (snap) => {
      setEmpleadosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    return () => { unSubDeducciones(); unSubEmpleados(); };
  }, []);

  // ✅ 2. FILTRO ESTRICTO: Empleados disponibles
  const empleadosDisponibles = useMemo(() => {
    const idsAgregados = deduccionesGlobales.map(d => d.empleadoId);
    
    return empleadosList
      .filter(emp => !idsAgregados.includes(emp.id) || (deduccionEditando && deduccionEditando.empleadoId === emp.id))
      .sort((a, b) => {
        const nombreA = `${a.firstName || ''} ${a.lastNamePaternal || ''}`.trim();
        const nombreB = `${b.firstName || ''} ${b.lastNamePaternal || ''}`.trim();
        return nombreA.localeCompare(nombreB);
      });
  }, [empleadosList, deduccionesGlobales, deduccionEditando]);

  const getNombreEmpleado = (id: string) => {
    const emp = empleadosList.find(e => e.id === id);
    return emp ? `${emp.firstName || ''} ${emp.lastNamePaternal || ''}`.trim() : id;
  };

  // ✅ FUNCIONES DEL MODAL
  const abrirModalNuevo = () => {
    setDeduccionEditando(null);
    resetFormulario();
    setModalAbierto(true);
  };

  const abrirModalEditar = (d: any) => {
    setDeduccionEditando(d);
    setEmpleadoSeleccionado(d.empleadoId || '');
    setMontoDeduccion(d.montoDeduccion || '');
    setGastos(d.gastos || '');
    setInfonavit(d.infonavit || '');
    setImss(d.imss || '');
    setIsr(d.isr || '');
    setDescuento(d.descuento || '');
    setNominaFiscal(d.nominaFiscal || '');
    setSaldoPrestamo(d.saldoPrestamo || '');
    setAhorro(d.ahorro || '');
    setAhorroAcumulado(d.ahorroAcumulado || '');
    setAhorroInicial(d.ahorroInicial || '');
    setFonacot(d.fonacot || '');
    setOtrosDepositos(d.otrosDepositos || '');
    setOtrasDeducciones(d.otrasDeducciones || '');
    setAbonosInicial(d.abonosInicial || '');
    setFonacotInicial(d.fonacotInicial || '');
    setSaldo(d.saldo || '');
    setModalAbierto(true);
  };

  const resetFormulario = () => {
    setEmpleadoSeleccionado('');
    setMontoDeduccion(''); setGastos(''); setInfonavit(''); setImss(''); setIsr('');
    setDescuento(''); setNominaFiscal(''); setSaldoPrestamo(''); setAhorro('');
    setAhorroAcumulado(''); setAhorroInicial(''); setFonacot(''); setOtrosDepositos('');
    setOtrasDeducciones(''); setAbonosInicial(''); setFonacotInicial(''); setSaldo('');
  };

  // ✅ GUARDADO (Crear / Actualizar)
  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empleadoSeleccionado) return alert("Selecciona un empleado.");
    setGuardando(true);
    
    try {
      const data = {
        empleadoId: empleadoSeleccionado,
        empleadoNombre: getNombreEmpleado(empleadoSeleccionado),
        montoDeduccion: Number(montoDeduccion) || 0,
        gastos: Number(gastos) || 0,
        infonavit: Number(infonavit) || 0,
        imss: Number(imss) || 0,
        isr: Number(isr) || 0,
        descuento: Number(descuento) || 0,
        nominaFiscal: Number(nominaFiscal) || 0,
        saldoPrestamo: Number(saldoPrestamo) || 0,
        ahorro: Number(ahorro) || 0,
        ahorroAcumulado: Number(ahorroAcumulado) || 0,
        ahorroInicial: Number(ahorroInicial) || 0,
        fonacot: Number(fonacot) || 0,
        otrosDepositos: Number(otrosDepositos) || 0,
        otrasDeducciones: Number(otrasDeducciones) || 0,
        abonosInicial: Number(abonosInicial) || 0,
        fonacotInicial: Number(fonacotInicial) || 0,
        saldo: Number(saldo) || 0,
        updatedAt: new Date().toISOString()
      };

      if (deduccionEditando) {
        await updateDoc(doc(db, 'deducciones', deduccionEditando.id), data);
      } else {
        await setDoc(doc(collection(db, 'deducciones')), {
          ...data,
          createdAt: new Date().toISOString()
        });
      }

      setModalAbierto(false);
      resetFormulario();
    } catch (error) {
      console.error(error);
      alert("Error al guardar la deducción.");
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminar = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar este registro? El empleado volverá a estar disponible.`)) {
      try {
        await deleteDoc(doc(db, 'deducciones', docId));
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert("Hubo un error al eliminar.");
      }
    }
  };

  // ✅ FILTRADO Y PAGINACIÓN HISTORIAL
  const historialFiltrado = useMemo(() => {
    const t = busqueda.toLowerCase();
    return deduccionesGlobales.filter(d => 
      (d.empleadoNombre || '').toLowerCase().includes(t)
    );
  }, [deduccionesGlobales, busqueda]);

  const totalPaginas = Math.ceil(historialFiltrado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialFiltrado.slice(indexFirst, indexLast);

  // ✅ FUNCIONES DE PAGINACIÓN CORREGIDAS
  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  const exportarCSV = () => {
    if (historialFiltrado.length === 0) return alert("No hay datos para exportar.");
    const datosExcel = historialFiltrado.map(d => ({
      'Empleado': d.empleadoNombre,
      'Monto Deducción': d.montoDeduccion,
      'Gastos': d.gastos,
      'Infonavit': d.infonavit,
      'IMSS': d.imss,
      'ISR': d.isr,
      'Descuento': d.descuento,
      'Nómina Fiscal': d.nominaFiscal,
      'Saldo Préstamo': d.saldoPrestamo,
      'Ahorro': d.ahorro,
      'Ahorro Acumulado': d.ahorroAcumulado,
      'Ahorro Inicial': d.ahorroInicial,
      'Fonacot': d.fonacot,
      'Otros Depósitos': d.otrosDepositos,
      'Otras Deducciones': d.otrasDeducciones,
      'Abonos Inicial': d.abonosInicial,
      'Fonacot Inicial': d.fonacotInicial,
      'Saldo': d.saldo,
      'Fecha Actualización': new Date(d.updatedAt || d.createdAt).toLocaleDateString('es-ES')
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Deducciones');
    XLSX.writeFile(workbook, `Deducciones_Empleados_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      
      {/* 🔴 BARRA SUPERIOR AL ESTILO CATÁLOGO SIMPLE */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', margin: 0 }}>Deducciones y Saldos</h1>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }}>🔍</span>
            <input 
              type="text" 
              placeholder="Buscar empleado..." 
              value={busqueda} 
              onChange={e => setBusqueda(e.target.value)} 
              style={{ padding: '8px 16px 8px 36px', backgroundColor: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', width: '300px' }} 
            />
          </div>
          <button title="Exportar a Excel" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button onClick={abrirModalNuevo} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}>
            <span>+</span> Nuevo Registro
          </button>
        </div>
      </div>

      {/* 🔴 TABLA PRINCIPAL */}
      <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 200px)', backgroundColor: '#161b22' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
            <tr>
              <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap', width: '100px' }}>ACCIONES</th>
              <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>EMPLEADO</th>
              <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>MONTO DEDUCCIÓN</th>
              <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>SALDO PRÉSTAMO</th>
              <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>AHORRO ACUMULADO</th>
              <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>SALDO TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {registrosVisibles.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay registros de deducciones.</td></tr>
            ) : (
              registrosVisibles.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid #21262d' }} onDoubleClick={() => abrirModalEditar(d)}>
                  <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <button 
                        title="Editar Registro" 
                        onClick={() => abrirModalEditar(d)} 
                        style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', transition: 'all 0.2s' }}
                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                      </button>
                      
                      <button 
                        title="Eliminar Registro" 
                        onClick={(e) => handleEliminar(e, d.id)} 
                        style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', transition: 'all 0.2s' }}
                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: '16px', color: '#f0f6fc', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.empleadoNombre}</td>
                  <td style={{ padding: '16px', color: '#58a6ff', whiteSpace: 'nowrap' }}>{formatoMoneda(d.montoDeduccion)}</td>
                  <td style={{ padding: '16px', color: '#d2a8ff', whiteSpace: 'nowrap' }}>{formatoMoneda(d.saldoPrestamo)}</td>
                  <td style={{ padding: '16px', color: '#3fb950', whiteSpace: 'nowrap' }}>{formatoMoneda(d.ahorroAcumulado)}</td>
                  <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(d.saldo)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      
      {totalPaginas > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
          <span style={{ color: '#8b949e', fontSize: '0.85rem' }}>Mostrando {(paginaActual - 1) * registrosPorPagina + 1} - {Math.min(paginaActual * registrosPorPagina, historialFiltrado.length)} de {historialFiltrado.length} registros</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px' }}>Anterior</button>
            <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '6px 12px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px' }}>Siguiente</button>
          </div>
        </div>
      )}

      {/* 🔴 MODAL FORMULARIO */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '1000px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.7)' }}>
            
            <div style={{ position: 'sticky', top: 0, backgroundColor: '#0d1117', zIndex: 10, padding: '24px 24px 16px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.4rem' }}>
                {deduccionEditando ? 'Editar Deducción' : 'Nueva Deducción'}
              </h2>
              <button type="button" onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.4rem' }}>✕</button>
            </div>
            
            <form onSubmit={handleGuardar} style={{ padding: '24px' }}>
              
              <div style={{ marginBottom: '32px', backgroundColor: '#161b22', padding: '20px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                <label style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>EMPLEADO (NÓMINA)</label>
                <select 
                  required 
                  value={empleadoSeleccionado} 
                  onChange={e => setEmpleadoSeleccionado(e.target.value)} 
                  disabled={!!deduccionEditando}
                  style={{ width: '100%', maxWidth: '400px', padding: '12px', backgroundColor: deduccionEditando ? '#010409' : '#1f2937', color: deduccionEditando ? '#8b949e' : '#fff', border: '1px solid #30363d', borderRadius: '6px', fontSize: '1rem', cursor: deduccionEditando ? 'not-allowed' : 'pointer' }}
                >
                  <option value="">Seleccionar Empleado...</option>
                  {empleadosDisponibles.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {`${emp.firstName || ''} ${emp.lastNamePaternal || ''}`.trim()}
                    </option>
                  ))}
                </select>
                {!deduccionEditando && <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginTop: '8px' }}>* Solo se muestran los empleados que no tienen un registro activo.</span>}
              </div>

              <h3 style={{ color: '#D84315', fontSize: '1rem', borderBottom: '1px solid #30363d', paddingBottom: '8px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                Cantidades (MXN)
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                {[
                  {label: 'MONTO DEDUCCIÓN', val: montoDeduccion, setter: setMontoDeduccion},
                  {label: 'GASTOS', val: gastos, setter: setGastos},
                  {label: 'INFONAVIT', val: infonavit, setter: setInfonavit},
                  {label: 'IMSS', val: imss, setter: setImss},
                  {label: 'ISR', val: isr, setter: setIsr},
                  {label: 'DESCUENTO', val: descuento, setter: setDescuento},
                  {label: 'NÓMINA FISCAL', val: nominaFiscal, setter: setNominaFiscal},
                  {label: 'SALDO PRÉSTAMO', val: saldoPrestamo, setter: setSaldoPrestamo},
                  {label: 'AHORRO', val: ahorro, setter: setAhorro},
                  {label: 'AHORRO ACUMULADO', val: ahorroAcumulado, setter: setAhorroAcumulado},
                  {label: 'AHORRO INICIAL', val: ahorroInicial, setter: setAhorroInicial},
                  {label: 'FONACOT', val: fonacot, setter: setFonacot},
                  {label: 'OTROS DEPÓSITOS', val: otrosDepositos, setter: setOtrosDepositos},
                  {label: 'OTRAS DEDUCCIONES', val: otrasDeducciones, setter: setOtrasDeducciones},
                  {label: 'ABONOS INICIAL', val: abonosInicial, setter: setAbonosInicial},
                  {label: 'FONACOT INICIAL', val: fonacotInicial, setter: setFonacotInicial},
                  {label: 'SALDO TOTAL', val: saldo, setter: setSaldo},
                ].map((campo, i) => (
                  <div key={i} style={{ backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #21262d' }}>
                    <label style={{ color: '#8b949e', fontSize: '0.7rem', display: 'block', marginBottom: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{campo.label}</label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e', fontWeight: 'bold', fontSize: '0.85rem' }}>$</span>
                      <input 
                        type="number" 
                        step="0.01" 
                        value={campo.val} 
                        onChange={e => campo.setter(e.target.valueAsNumber || '')} 
                        style={{ width: '100%', padding: '8px 8px 8px 24px', backgroundColor: '#010409', color: '#3fb950', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold', boxSizing: 'border-box' }} 
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ position: 'sticky', bottom: 0, backgroundColor: '#0d1117', padding: '16px 0', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px', zIndex: 10 }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '10px 24px', background: 'none', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '10px 24px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}>{guardando ? 'Guardando...' : deduccionEditando ? 'Actualizar Registro' : 'Guardar Nuevo Registro'}</button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
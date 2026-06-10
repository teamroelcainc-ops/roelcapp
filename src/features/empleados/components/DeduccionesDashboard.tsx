// src/features/empleados/components/DeduccionesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

const COLUMNAS_BASE = [
  { id: 'empleadoNombre', label: 'Empleado', visible: true },
  { id: 'montoDeduccion', label: 'Monto Deducción', visible: true },
  { id: 'prestamo', label: 'Préstamo', visible: true },
  { id: 'pagoPrestamo', label: 'Pago Préstamo', visible: false },
  { id: 'saldoPrestamo', label: 'Saldo Préstamo', visible: true },
  { id: 'ahorroAcumulado', label: 'Ahorro Acumulado', visible: true },
  { id: 'saldo', label: 'Saldo Total', visible: true },
  { id: 'gastos', label: 'Gastos', visible: false },
  { id: 'infonavit', label: 'Infonavit', visible: false },
  { id: 'imss', label: 'IMSS', visible: false },
  { id: 'isr', label: 'ISR', visible: false },
  { id: 'descuento', label: 'Descuento', visible: false },
  { id: 'nominaFiscal', label: 'Nómina Fiscal', visible: false },
  { id: 'ahorro', label: 'Ahorro', visible: false },
  { id: 'ahorroInicial', label: 'Ahorro Inicial', visible: false },
  { id: 'fonacot', label: 'Fonacot', visible: false },
  { id: 'pagoFonacot', label: 'Pago Fonacot', visible: false },
  { id: 'saldoFonacot', label: 'Saldo Fonacot', visible: false },
  { id: 'otrosDepositos', label: 'Otros Depósitos', visible: false },
  { id: 'otrasDeducciones', label: 'Otras Deducciones', visible: false },
  { id: 'abonosInicial', label: 'Abonos Inicial', visible: false },
  { id: 'fonacotInicial', label: 'Fonacot Inicial', visible: false }
];

export const DeduccionesDashboard = () => {
  const [deduccionesGlobales, setDeduccionesGlobales] = useState<any[]>([]);
  const [empleadosList, setEmpleadosList] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [deduccionEditando, setDeduccionEditando] = useState<any | null>(null);

  const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState('');
  const [montoDeduccion, setMontoDeduccion] = useState<number | ''>('');
  const [gastos, setGastos] = useState<number | ''>('');
  const [infonavit, setInfonavit] = useState<number | ''>('');
  const [imss, setImss] = useState<number | ''>('');
  const [isr, setIsr] = useState<number | ''>('');
  const [descuento, setDescuento] = useState<number | ''>('');
  const [nominaFiscal, setNominaFiscal] = useState<number | ''>('');
  const [prestamo, setPrestamo] = useState<number | ''>('');
  const [pagoPrestamo, setPagoPrestamo] = useState<number | ''>('');
  const [saldoPrestamo, setSaldoPrestamo] = useState<number | ''>('');
  const [ahorro, setAhorro] = useState<number | ''>('');
  const [ahorroAcumulado, setAhorroAcumulado] = useState<number | ''>('');
  const [ahorroInicial, setAhorroInicial] = useState<number | ''>('');
  const [fonacot, setFonacot] = useState<number | ''>('');
  const [pagoFonacot, setPagoFonacot] = useState<number | ''>('');
  const [saldoFonacot, setSaldoFonacot] = useState<number | ''>('');
  const [otrosDepositos, setOtrosDepositos] = useState<number | ''>('');
  const [otrasDeducciones, setOtrasDeducciones] = useState<number | ''>('');
  const [abonosInicial, setAbonosInicial] = useState<number | ''>('');
  const [fonacotInicial, setFonacotInicial] = useState<number | ''>('');
  const [saldo, setSaldo] = useState<number | ''>('');

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  useEffect(() => {
    const unSubDeducciones = onSnapshot(collection(db, 'deducciones'), (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      docs.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (dateA !== dateB) return dateB - dateA;
        return (a.id || '').localeCompare(b.id || '');
      });
      setDeduccionesGlobales(docs);
      setCargando(false);
    });

    const unSubEmpleados = onSnapshot(collection(db, 'empleados'), (snap) => {
      setEmpleadosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    return () => { unSubDeducciones(); unSubEmpleados(); };
  }, []);

  const getNombreEmpleado = (id: string) => {
    if (!id) return '-';
    const emp = empleadosList.find(e => e.id === id || e.employeeId === id);
    return emp ? `${emp.firstName || ''} ${emp.lastNamePaternal || ''}`.trim() : id;
  };

  const empleadosDisponibles = useMemo(() => {
    const idsAgregados = deduccionesGlobales.map(d => d.empleadoId);
    return empleadosList
      .filter(emp => !idsAgregados.includes(emp.id) && !idsAgregados.includes(emp.employeeId) || (deduccionEditando && (deduccionEditando.empleadoId === emp.id || deduccionEditando.empleadoId === emp.employeeId)))
      .sort((a, b) => {
        const nombreA = `${a.firstName || ''} ${a.lastNamePaternal || ''}`.trim();
        const nombreB = `${b.firstName || ''} ${b.lastNamePaternal || ''}`.trim();
        return nombreA.localeCompare(nombreB);
      });
  }, [empleadosList, deduccionesGlobales, deduccionEditando]);

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
    setPrestamo(d.prestamo || '');
    setPagoPrestamo(d.pagoPrestamo || '');
    setSaldoPrestamo(d.saldoPrestamo || '');
    setAhorro(d.ahorro || '');
    setAhorroAcumulado(d.ahorroAcumulado || '');
    setAhorroInicial(d.ahorroInicial || '');
    setFonacot(d.fonacot || '');
    setPagoFonacot(d.pagoFonacot || '');
    setSaldoFonacot(d.saldoFonacot || '');
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
    setDescuento(''); setNominaFiscal('');
    setPrestamo(''); setPagoPrestamo(''); setSaldoPrestamo('');
    setAhorro(''); setAhorroAcumulado(''); setAhorroInicial('');
    setFonacot(''); setPagoFonacot(''); setSaldoFonacot('');
    setOtrosDepositos(''); setOtrasDeducciones(''); setAbonosInicial(''); setFonacotInicial(''); setSaldo('');
  };

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
        prestamo: Number(prestamo) || 0,
        pagoPrestamo: Number(pagoPrestamo) || 0,
        saldoPrestamo: Number(saldoPrestamo) || 0,
        ahorro: Number(ahorro) || 0,
        ahorroAcumulado: Number(ahorroAcumulado) || 0,
        ahorroInicial: Number(ahorroInicial) || 0,
        fonacot: Number(fonacot) || 0,
        pagoFonacot: Number(pagoFonacot) || 0,
        saldoFonacot: Number(saldoFonacot) || 0,
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
    if (window.confirm("¿Estás seguro de eliminar este registro? El empleado volverá a estar disponible.")) {
      try {
        await deleteDoc(doc(db, 'deducciones', docId));
      } catch (error) {
        console.error(error);
        alert("Hubo un error al eliminar.");
      }
    }
  };

  const registrosFiltrados = useMemo(() => {
    const listado = deduccionesGlobales.map(d => ({
      ...d,
      _empleadoNombre: d.empleadoNombre || getNombreEmpleado(d.empleadoId)
    }));
    
    if (!busqueda.trim()) return listado;
    const t = busqueda.toLowerCase();
    return listado.filter(d => 
      String(d._empleadoNombre).toLowerCase().includes(t) ||
      String(d.empleadoId || '').toLowerCase().includes(t)
    );
  }, [deduccionesGlobales, empleadosList, busqueda]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = registrosFiltrados.slice(indexFirst, indexLast);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  const handleDragStart = (index: number) => {
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

  const renderCellContent = (d: any, colId: string) => {
    switch (colId) {
      case 'empleadoNombre': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{d._empleadoNombre}</span>;
      case 'montoDeduccion': return <span style={{ color: '#58a6ff' }}>{formatoMoneda(d.montoDeduccion)}</span>;
      case 'prestamo': return <span style={{ color: '#d2a8ff' }}>{formatoMoneda(d.prestamo)}</span>;
      case 'pagoPrestamo': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.pagoPrestamo)}</span>;
      case 'saldoPrestamo': return <span style={{ color: '#d2a8ff' }}>{formatoMoneda(d.saldoPrestamo)}</span>;
      case 'ahorroAcumulado': return <span style={{ color: '#3fb950' }}>{formatoMoneda(d.ahorroAcumulado)}</span>;
      case 'saldo': return <span style={{ color: '#D84315', fontWeight: 'bold' }}>{formatoMoneda(d.saldo)}</span>;
      case 'gastos': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.gastos)}</span>;
      case 'infonavit': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.infonavit)}</span>;
      case 'imss': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.imss)}</span>;
      case 'isr': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.isr)}</span>;
      case 'descuento': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.descuento)}</span>;
      case 'nominaFiscal': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.nominaFiscal)}</span>;
      case 'ahorro': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.ahorro)}</span>;
      case 'ahorroInicial': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.ahorroInicial)}</span>;
      case 'fonacot': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.fonacot)}</span>;
      case 'pagoFonacot': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.pagoFonacot)}</span>;
      case 'saldoFonacot': return <span style={{ color: '#f59e0b' }}>{formatoMoneda(d.saldoFonacot)}</span>;
      case 'otrosDepositos': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.otrosDepositos)}</span>;
      case 'otrasDeducciones': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.otrasDeducciones)}</span>;
      case 'abonosInicial': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.abonosInicial)}</span>;
      case 'fonacotInicial': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(d.fonacotInicial)}</span>;
      default: return '-';
    }
  };

  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    const columnasVisibles = columnasTabla.filter(c => c.visible);
    const datosExcel = registrosFiltrados.map(d => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        switch (col.id) {
          case 'empleadoNombre': fila[col.label] = d._empleadoNombre; break;
          case 'montoDeduccion': fila[col.label] = Number(d.montoDeduccion || 0); break;
          case 'prestamo': fila[col.label] = Number(d.prestamo || 0); break;
          case 'pagoPrestamo': fila[col.label] = Number(d.pagoPrestamo || 0); break;
          case 'saldoPrestamo': fila[col.label] = Number(d.saldoPrestamo || 0); break;
          case 'ahorroAcumulado': fila[col.label] = Number(d.ahorroAcumulado || 0); break;
          case 'saldo': fila[col.label] = Number(d.saldo || 0); break;
          case 'gastos': fila[col.label] = Number(d.gastos || 0); break;
          case 'infonavit': fila[col.label] = Number(d.infonavit || 0); break;
          case 'imss': fila[col.label] = Number(d.imss || 0); break;
          case 'isr': fila[col.label] = Number(d.isr || 0); break;
          case 'descuento': fila[col.label] = Number(d.descuento || 0); break;
          case 'nominaFiscal': fila[col.label] = Number(d.nominaFiscal || 0); break;
          case 'ahorro': fila[col.label] = Number(d.ahorro || 0); break;
          case 'ahorroInicial': fila[col.label] = Number(d.ahorroInicial || 0); break;
          case 'fonacot': fila[col.label] = Number(d.fonacot || 0); break;
          case 'pagoFonacot': fila[col.label] = Number(d.pagoFonacot || 0); break;
          case 'saldoFonacot': fila[col.label] = Number(d.saldoFonacot || 0); break;
          case 'otrosDepositos': fila[col.label] = Number(d.otrosDepositos || 0); break;
          case 'otrasDeducciones': fila[col.label] = Number(d.otrasDeducciones || 0); break;
          case 'abonosInicial': fila[col.label] = Number(d.abonosInicial || 0); break;
          case 'fonacotInicial': fila[col.label] = Number(d.fonacotInicial || 0); break;
        }
      });
      return fila;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(datosExcel);
    XLSX.utils.book_append_sheet(wb, ws, "Deducciones");
    XLSX.writeFile(wb, `Deducciones_Empleados_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '24px', width: '100%' }}>
        <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', margin: 0, fontWeight: 'bold' }}>Deducciones y Saldos</h1>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input 
              type="text" 
              placeholder="Buscar empleado..." 
              value={busqueda} 
              onChange={e => setBusqueda(e.target.value)} 
              style={{ padding: '10px 16px 10px 40px', backgroundColor: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', width: '280px', boxSizing: 'border-box' }} 
            />
          </div>
          <button className="btn btn-outline" onClick={() => setModalColumnas(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '10px 12px', borderRadius: '6px', cursor: 'pointer' }} title="Configurar Columnas">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          </button>
          <button className="btn btn-outline" onClick={exportarExcel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '10px 12px', borderRadius: '6px', cursor: 'pointer' }} title="Exportar Excel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button onClick={abrirModalNuevo} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
            <span>+</span> Nuevo Registro
          </button>
        </div>
      </div>

      <div className="content-body" style={{ display: 'block', width: '100%' }}>
        <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
          <table style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
              <tr>
                <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
                {columnasTabla.filter(c => c.visible).map(col => (
                  <th key={`th_${col.id}`} style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                    Cargando deducciones...
                  </td>
                </tr>
              ) : registrosVisibles.length === 0 ? (
                <tr>
                  <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                    {busqueda ? 'No se encontraron registros de deducciones.' : 'Aún no hay deducciones registradas.'}
                  </td>
                </tr>
              ) : (
                registrosVisibles.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === d.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(d.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => abrirModalEditar(d)}>
                    <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(ev) => ev.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button onClick={(ev) => { ev.stopPropagation(); abrirModalEditar(d); }} style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        </button>
                        <button onClick={(ev) => handleEliminar(ev, d.id)} style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                      </div>
                    </td>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <td key={`cell_${d.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>{renderCellContent(d, col.id)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {registrosFiltrados.length > 0 && !cargando && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
              Mostrando {indexFirst + 1} - {Math.min(indexLast, registrosFiltrados.length)} de {registrosFiltrados.length} registros
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} title="Página Anterior" style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
              </button>
              <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} title="Página Siguiente" style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button type="button" onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {columnasTabla.map((col, idx) => (
                <li key={col.id} draggable onDragStart={() => handleDragStart(idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={() => setDraggedColIndex(null)} onDragOver={(e) => e.preventDefault()} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} style={{ cursor: 'pointer' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button type="button" onClick={() => setModalColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '1000px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.7)' }}>
            <div style={{ position: 'sticky', top: 0, backgroundColor: '#0d1117', zIndex: 10, padding: '24px 24px 16px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.4rem' }}>{deduccionEditando ? 'Editar Deducción' : 'Nueva Deducción'}</h2>
              <button type="button" onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.4rem' }}>✕</button>
            </div>
            
            <form onSubmit={handleGuardar} style={{ padding: '24px' }}>
              <div style={{ marginBottom: '32px', backgroundColor: '#161b22', padding: '20px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                <label style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>EMPLEADO (NÓMINA)</label>
                <select required value={empleadoSeleccionado} onChange={e => setEmpleadoSeleccionado(e.target.value)} disabled={!!deduccionEditando} style={{ width: '100%', maxWidth: '400px', padding: '12px', backgroundColor: deduccionEditando ? '#010409' : '#1f2937', color: deduccionEditando ? '#8b949e' : '#fff', border: '1px solid #30363d', borderRadius: '6px', fontSize: '1rem', cursor: deduccionEditando ? 'not-allowed' : 'pointer' }}>
                  <option value="">Seleccionar Empleado...</option>
                  {empleadosDisponibles.map(emp => (
                    <option key={emp.id} value={emp.id}>{`${emp.firstName || ''} ${emp.lastNamePaternal || ''}`.trim()}</option>
                  ))}
                </select>
                {!deduccionEditando && <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginTop: '8px' }}>* Solo se muestran los empleados que no tienen un registro activo.</span>}
              </div>

              <h3 style={{ color: '#D84315', fontSize: '1rem', borderBottom: '1px solid #30363d', paddingBottom: '8px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
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
                  {label: 'PRÉSTAMO', val: prestamo, setter: setPrestamo},
                  {label: 'PAGO PRÉSTAMO', val: pagoPrestamo, setter: setPagoPrestamo},
                  {label: 'SALDO PRÉSTAMO', val: saldoPrestamo, setter: setSaldoPrestamo},
                  {label: 'AHORRO', val: ahorro, setter: setAhorro},
                  {label: 'AHORRO ACUMULADO', val: ahorroAcumulado, setter: setAhorroAcumulado},
                  {label: 'AHORRO INICIAL', val: ahorroInicial, setter: setAhorroInicial},
                  {label: 'FONACOT', val: fonacot, setter: setFonacot},
                  {label: 'PAGO FONACOT', val: pagoFonacot, setter: setPagoFonacot},
                  {label: 'SALDO FONACOT', val: saldoFonacot, setter: setSaldoFonacot},
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
                      <input type="number" step="0.01" value={campo.val} onChange={e => campo.setter(e.target.valueAsNumber || '')} style={{ width: '100%', padding: '8px 8px 8px 24px', backgroundColor: '#010409', color: '#3fb950', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ position: 'sticky', bottom: 0, backgroundColor: '#0d1117', padding: '16px 0', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px', zIndex: 10 }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '10px 24px', background: 'none', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '10px 24px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : deduccionEditando ? 'Actualizar Registro' : 'Guardar Nuevo Registro'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
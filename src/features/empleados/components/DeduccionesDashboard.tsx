// src/features/empleados/components/DeduccionesDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// Deducciones y Saldos — réplica del formato de AppSheet:
//   TABLA (todas visibles, en este orden): Colaborador, Gastos, Infonavit,
//   IMSS, Fonacot, Fonacot Inicial, Saldo Fonacot, ISR, Descuento,
//   Nómina Fiscal, Préstamo Inicial, Abono Inicial, Abonos, Saldo,
//   Ahorro, Ahorro Inicial, Ahorro Acumulado.
//   FORMULARIO: Colaborador, Gastos, Infonavit, Fonacot, Fonacot Inicial,
//   Saldo Fonacot, IMSS, ISR, Descuento, Nómina Fiscal, Préstamo Inicial,
//   Ahorro, Ahorro Inicial y Ahorro Acumulado (solo lectura).
//   Abono Inicial, Abonos y Saldo NO se capturan en el formulario; se
//   conservan tal cual en el documento (vienen de la migración / nómina).
//   Formatos: $ con 2 decimales (Gastos, Infonavit, IMSS, Descuento,
//   Nómina Fiscal); $ con 4 decimales (Fonacot, préstamos y ahorros);
//   ISR como número a 4 decimales SIN signo de pesos.
// ═══════════════════════════════════════════════════════════════════════
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
import './DeduccionesDashboard.css';

const COLUMNAS_BASE = [
  { id: 'empleadoNombre',  label: 'Colaborador',      visible: true },
  { id: 'gastos',          label: 'Gastos',           visible: true },
  { id: 'infonavit',       label: 'Infonavit',        visible: true },
  { id: 'imss',            label: 'IMSS',             visible: true },
  { id: 'fonacot',         label: 'Fonacot',          visible: true },
  { id: 'fonacotInicial',  label: 'Fonacot Inicial',  visible: true },
  { id: 'saldoFonacot',    label: 'Saldo Fonacot',    visible: true },
  { id: 'isr',             label: 'ISR',              visible: true },
  { id: 'descuento',       label: 'Descuento',        visible: true },
  { id: 'nominaFiscal',    label: 'Nomina Fiscal',    visible: true },
  { id: 'prestamoInicial', label: 'Prestamo Inicial', visible: true },
  { id: 'abonoInicial',    label: 'Abono Inicial',    visible: true },
  { id: 'abonos',          label: 'Abonos',           visible: true },
  { id: 'saldoPrestamo',   label: 'Saldo',            visible: true },
  { id: 'ahorro',          label: 'Ahorro',           visible: true },
  { id: 'ahorroInicial',   label: 'Ahorro Inicial',   visible: true },
  { id: 'ahorroAcumulado', label: 'Ahorro Acumulado', visible: true }
];

export const DeduccionesDashboard = () => {
  const [deduccionesGlobales, setDeduccionesGlobales] = useState<any[]>([]);
  const [empleadosList, setEmpleadosList] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [deduccionEditando, setDeduccionEditando] = useState<any | null>(null);

  const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState('');
  const [gastos, setGastos] = useState<number | ''>('');
  const [infonavit, setInfonavit] = useState<number | ''>('');
  const [fonacot, setFonacot] = useState<number | ''>('');
  const [fonacotInicial, setFonacotInicial] = useState<number | ''>('');
  const [saldoFonacot, setSaldoFonacot] = useState<number | ''>('');
  const [imss, setImss] = useState<number | ''>('');
  const [isr, setIsr] = useState<number | ''>('');
  const [descuento, setDescuento] = useState<number | ''>('');
  const [nominaFiscal, setNominaFiscal] = useState<number | ''>('');
  const [prestamoInicial, setPrestamoInicial] = useState<number | ''>('');
  const [ahorro, setAhorro] = useState<number | ''>('');
  const [ahorroInicial, setAhorroInicial] = useState<number | ''>('');
  const [ahorroAcumulado, setAhorroAcumulado] = useState<number | ''>('');

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // $ con 2 decimales (Gastos, Infonavit, IMSS, Descuento, Nómina Fiscal).
  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  // $ con 4 decimales (Fonacot, préstamos y ahorros), como en AppSheet.
  const formatoMoneda4 = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.0000' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  };
  // ✅ (ISR = 7.5%) El ISR es un PORCENTAJE, no un monto ni un factor.
  //   Normaliza cualquier representación heredada al porcentaje real:
  //   0.075 (factor) -> 7.5 ; 75 (dato migrado de AppSheet) -> 7.5 ; 7.5 -> 7.5.
  const normalizarISRPct = (v: any): number => {
    const n = Number(v) || 0;
    if (n <= 0) return 0;
    if (n <= 1) return n * 100;
    if (n > 20) return n / 10;
    return n;
  };
  const formatoPorcentaje = (v: any) => `${normalizarISRPct(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

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
    setIsr(7.5); // ✅ El ISR es 7.5% por defecto.
    setModalAbierto(true);
  };

  const abrirModalEditar = (d: any) => {
    setDeduccionEditando(d);
    setEmpleadoSeleccionado(d.empleadoId || '');
    setGastos(d.gastos || '');
    setInfonavit(d.infonavit || '');
    setFonacot(d.fonacot || '');
    setFonacotInicial(d.fonacotInicial || '');
    setSaldoFonacot(d.saldoFonacot || '');
    setImss(d.imss || '');
    setIsr(normalizarISRPct(d.isr) || '');
    setDescuento(d.descuento || '');
    setNominaFiscal(d.nominaFiscal || '');
    setPrestamoInicial(d.prestamoInicial || '');
    setAhorro(d.ahorro || '');
    setAhorroInicial(d.ahorroInicial || '');
    setAhorroAcumulado(d.ahorroAcumulado || '');
    setModalAbierto(true);
  };

  const resetFormulario = () => {
    setEmpleadoSeleccionado('');
    setGastos(''); setInfonavit('');
    setFonacot(''); setFonacotInicial(''); setSaldoFonacot('');
    setImss(''); setIsr(''); setDescuento(''); setNominaFiscal('');
    setPrestamoInicial('');
    setAhorro(''); setAhorroInicial(''); setAhorroAcumulado('');
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empleadoSeleccionado) return alert("Selecciona un empleado.");
    setGuardando(true);
    
    try {
      // Abono Inicial, Abonos y Saldo NO se capturan en el formulario:
      // al EDITAR no se tocan (se conserva lo migrado / lo de nómina) y
      // al CREAR se inicializan en 0.
      const data = {
        empleadoId: empleadoSeleccionado,
        empleadoNombre: getNombreEmpleado(empleadoSeleccionado),
        gastos: Number(gastos) || 0,
        infonavit: Number(infonavit) || 0,
        fonacot: Number(fonacot) || 0,
        fonacotInicial: Number(fonacotInicial) || 0,
        saldoFonacot: Number(saldoFonacot) || 0,
        imss: Number(imss) || 0,
        isr: normalizarISRPct(isr), // ✅ Siempre como porcentaje (7.5 = 7.5%).
        descuento: Number(descuento) || 0,
        nominaFiscal: Number(nominaFiscal) || 0,
        prestamoInicial: Number(prestamoInicial) || 0,
        ahorro: Number(ahorro) || 0,
        ahorroInicial: Number(ahorroInicial) || 0,
        ahorroAcumulado: Number(ahorroAcumulado) || 0,
        updatedAt: new Date().toISOString()
      };

      if (deduccionEditando) {
        await updateDoc(doc(db, 'deducciones', deduccionEditando.id), data);
      } else {
        await setDoc(doc(collection(db, 'deducciones')), {
          ...data,
          abonoInicial: 0,
          abonos: 0,
          saldoPrestamo: 0,
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
      case 'empleadoNombre': return <span className="dd-x1">{d._empleadoNombre}</span>;
      case 'gastos': return <span className="dd-x2">{formatoMoneda(d.gastos)}</span>;
      case 'infonavit': return <span className="dd-x2">{formatoMoneda(d.infonavit)}</span>;
      case 'imss': return <span className="dd-x2">{formatoMoneda(d.imss)}</span>;
      case 'fonacot': return <span className="dd-x2">{formatoMoneda4(d.fonacot)}</span>;
      case 'fonacotInicial': return <span className="dd-x2">{formatoMoneda4(d.fonacotInicial)}</span>;
      case 'saldoFonacot': return <span className="dd-x3">{formatoMoneda4(d.saldoFonacot)}</span>;
      case 'isr': return <span className="dd-x2">{formatoPorcentaje(d.isr)}</span>;
      case 'descuento': return <span className="dd-x2">{formatoMoneda(d.descuento)}</span>;
      case 'nominaFiscal': return <span className="dd-x4">{formatoMoneda(d.nominaFiscal)}</span>;
      case 'prestamoInicial': return <span className="dd-x5">{formatoMoneda4(d.prestamoInicial)}</span>;
      case 'abonoInicial': return <span className="dd-x2">{formatoMoneda4(d.abonoInicial)}</span>;
      case 'abonos': return <span className="dd-x2">{formatoMoneda4(d.abonos)}</span>;
      case 'saldoPrestamo': return <span className="dd-x6">{formatoMoneda4(d.saldoPrestamo)}</span>;
      case 'ahorro': return <span className="dd-x2">{formatoMoneda4(d.ahorro)}</span>;
      case 'ahorroInicial': return <span className="dd-x2">{formatoMoneda4(d.ahorroInicial)}</span>;
      case 'ahorroAcumulado': return <span className="dd-x7">{formatoMoneda4(d.ahorroAcumulado)}</span>;
      default: return '-';
    }
  };

  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    const columnasVisibles = columnasTabla.filter(c => c.visible);
    const datosExcel = registrosFiltrados.map(d => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        if (col.id === 'empleadoNombre') {
          fila[col.label] = d._empleadoNombre;
        } else if (col.id === 'isr') {
          fila[col.label] = normalizarISRPct(d.isr); // ✅ Siempre como porcentaje (7.5).
        } else {
          fila[col.label] = Number(d[col.id] || 0);
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
    <div className="module-container dd-x8">
      <div className="dd-x9">
        <h1 className="dd-x10">Deducciones y Saldos</h1>
        
        <div className="dd-x11">
          <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${busqueda ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
            {busqueda && <span className="dd-x12">1</span>}
            </button>
          {busqueda && (
            <span className="dd-x13">
                "{busqueda}"
              <button className="dd-x14" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
          <span className="dd-x15">
            {busquedaHecha ? `${registrosFiltrados.length} registros` : 'Presiona Filtros y Buscar para ver los registros.'}
            </span>
          <button className="btn btn-outline dd-x16" onClick={() => setModalColumnas(true)} title="Configurar Columnas">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          </button>
          <button className="btn btn-outline dd-x16" onClick={exportarExcel} title="Exportar Excel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button className="dd-x17" onClick={abrirModalNuevo}>
            <span>+</span> Nuevo Registro
          </button>
        </div>
      </div>

      <div className="content-body dd-x18">
        <div className="table-container dd-x19">
          <table className="dd-x20">
            <thead className="dd-x21">
              <tr>
                <th className="dd-x22">Acciones</th>
                {columnasTabla.filter(c => c.visible).map(col => (
                  <th className="dd-x23" key={`th_${col.id}`}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!busquedaHecha ? (
                  <tr><td className="dd-x24" colSpan={columnasTabla.length + 1}>
                    <div className="dd-x25">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="dd-x26">Define tus filtros y presiona <b className="dd-x27">Buscar</b> para ver las deducciones.</span>
                      <button className="dd-x28" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
              ) : cargando ? (
                <tr>
                  <td className="dd-x29" colSpan={columnasTabla.length + 1}>
                    Cargando deducciones...
                  </td>
                </tr>
              ) : registrosVisibles.length === 0 ? (
                <tr>
                  <td className="dd-x29" colSpan={columnasTabla.length + 1}>
                    {busqueda ? 'No se encontraron registros de deducciones.' : 'Aún no hay deducciones registradas.'}
                  </td>
                </tr>
              ) : (
                registrosVisibles.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === d.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(d.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => abrirModalEditar(d)}>
                    <td className="dd-x30" onClick={(ev) => ev.stopPropagation()}>
                      <div className="dd-x31">
                        <button className="dd-x32" onClick={(ev) => { ev.stopPropagation(); abrirModalEditar(d); }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                        </button>
                        <button className="dd-x33" onClick={(ev) => handleEliminar(ev, d.id)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                      </div>
                    </td>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <td className="dd-x34" key={`cell_${d.id}_${col.id}`}>{renderCellContent(d, col.id)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {busquedaHecha && registrosFiltrados.length > 0 && !cargando && (
          <div className="dd-x35">
            <div className="dd-x36">
              Mostrando {registrosFiltrados.length === 0 ? 0 : indexFirst + 1} - {Math.min(indexLast, registrosFiltrados.length)} de {registrosFiltrados.length} registros
            </div>
            <div className="dd-x37">
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} title="Página Anterior" style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
              </button>
              <span className="dd-x38">{paginaActual} / {totalPaginas || 1}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} title="Página Siguiente" style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {modalColumnas && (
        <div className="modal-overlay dd-x39">
          <div className="dd-x40">
            <div className="dd-x41">
              <h3 className="dd-x42">Configurar Columnas</h3>
              <button className="dd-x43" type="button" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <ul className="dd-x44">
              {columnasTabla.map((col, idx) => (
                <li key={col.id} draggable onDragStart={() => handleDragStart(idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={() => setDraggedColIndex(null)} onDragOver={(e) => e.preventDefault()} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <input className="dd-x45" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="dd-x46">
              <button className="dd-x47" type="button" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {modalAbierto && (
        <div className="modal-overlay dd-x48">
          <div className="dd-x49">
            <div className="dd-x50">
              <h2 className="dd-x51">{deduccionEditando ? 'Editar Deducción' : 'Nueva Deducción'}</h2>
              <button className="dd-x52" type="button" onClick={() => setModalAbierto(false)}>✕</button>
            </div>
            
            <form className="dd-x53" onSubmit={handleGuardar}>
              <div className="dd-x54">
                <label className="dd-x55">EMPLEADO (NÓMINA)</label>
                <select required value={empleadoSeleccionado} onChange={e => setEmpleadoSeleccionado(e.target.value)} disabled={!!deduccionEditando} style={{ width: '100%', maxWidth: '400px', padding: '12px', backgroundColor: deduccionEditando ? '#010409' : '#1f2937', color: deduccionEditando ? '#8b949e' : '#fff', border: '1px solid #30363d', borderRadius: '6px', fontSize: '1rem', cursor: deduccionEditando ? 'not-allowed' : 'pointer' }}>
                  <option value="">Seleccionar Empleado...</option>
                  {empleadosDisponibles.map(emp => (
                    <option key={emp.id} value={emp.id}>{`${emp.firstName || ''} ${emp.lastNamePaternal || ''}`.trim()}</option>
                  ))}
                </select>
                {!deduccionEditando && <span className="dd-x56">* Solo se muestran los empleados que no tienen un registro activo.</span>}
              </div>

              <h3 className="dd-x57">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                Cantidades (MXN)
              </h3>
              
              <div className="dd-x58">
                {[
                  {label: 'GASTOS', val: gastos, setter: setGastos, conPeso: true, deshabilitado: false},
                  {label: 'INFONAVIT', val: infonavit, setter: setInfonavit, conPeso: true, deshabilitado: false},
                  {label: 'FONACOT', val: fonacot, setter: setFonacot, conPeso: true, deshabilitado: false},
                  {label: 'FONACOT INICIAL', val: fonacotInicial, setter: setFonacotInicial, conPeso: true, deshabilitado: false},
                  {label: 'SALDO FONACOT', val: saldoFonacot, setter: setSaldoFonacot, conPeso: true, deshabilitado: false},
                  {label: 'IMSS', val: imss, setter: setImss, conPeso: true, deshabilitado: false},
                  {label: 'ISR (%)', val: isr, setter: setIsr, conPeso: false, esPorcentaje: true, deshabilitado: false},
                  {label: 'DESCUENTO', val: descuento, setter: setDescuento, conPeso: true, deshabilitado: false},
                  {label: 'NÓMINA FISCAL', val: nominaFiscal, setter: setNominaFiscal, conPeso: true, deshabilitado: false},
                  {label: 'PRÉSTAMO INICIAL', val: prestamoInicial, setter: setPrestamoInicial, conPeso: true, deshabilitado: false},
                  {label: 'AHORRO', val: ahorro, setter: setAhorro, conPeso: true, deshabilitado: false},
                  {label: 'AHORRO INICIAL', val: ahorroInicial, setter: setAhorroInicial, conPeso: true, deshabilitado: false},
                  {label: 'AHORRO ACUMULADO', val: ahorroAcumulado, setter: setAhorroAcumulado, conPeso: true, deshabilitado: true},
                ].map((campo, i) => (
                  <div key={i} style={{ backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #21262d', opacity: campo.deshabilitado ? 0.6 : 1 }}>
                    <label className="dd-x59">{campo.label}{campo.deshabilitado ? ' (SOLO LECTURA)' : ''}</label>
                    <div className="dd-x60">
                      {campo.conPeso && <span className="dd-x61">$</span>}
                      {(campo as any).esPorcentaje && <span className="dd-x62">%</span>}
                      <input type="number" step="0.0001" value={campo.val} disabled={campo.deshabilitado} onChange={e => campo.setter(e.target.valueAsNumber || '')} style={{ width: '100%', padding: campo.conPeso ? '8px 8px 8px 24px' : (campo as any).esPorcentaje ? '8px 24px 8px 8px' : '8px', backgroundColor: '#010409', color: campo.deshabilitado ? '#8b949e' : '#3fb950', border: '1px solid #30363d', borderRadius: '4px', fontWeight: 'bold', boxSizing: 'border-box', cursor: campo.deshabilitado ? 'not-allowed' : 'text' }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="dd-x63">
                <button className="dd-x64" type="button" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
                <button className="dd-x65" type="submit" disabled={guardando}>{guardando ? 'Guardando...' : deduccionEditando ? 'Actualizar Registro' : 'Guardar Nuevo Registro'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ✅ NUEVO: panel lateral DERECHO de filtros (Deducciones y Saldos) */}
      {drawerFiltrosAbierto && (
        <div className="dd-x66" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="dd-x67" onClick={(e) => e.stopPropagation()}>
            <div className="dd-x68">
              <h3 className="dd-x69">Filtros · Deducciones y Saldos</h3>
              <button className="dd-x43" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="dd-x70">
              <label className="dd-x71">BÚSQUEDA</label>
              <div className="dd-x60">
                <svg className="dd-x72" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="dd-x73" type="text" placeholder="Nombre del empleado..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="dd-x74" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="dd-x75">
              La búsqueda es <b className="dd-x76">opcional</b>. Presiona <b className="dd-x27">Buscar</b> para ver todos los registros.
            </div>

            <div className="dd-x77">
              <button className="dd-x78" onClick={() => { setBusqueda(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="dd-x79" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>🔍 Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
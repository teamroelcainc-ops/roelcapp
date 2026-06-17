import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase';
import { EmployeeForm, TIPOS_DOCUMENTO_EMPLEADO } from './EmployeeForm';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import { HerramientasEmpleado } from './HerramientasEmpleado'; 
import type { Employee } from '../../../types/empleado';
import * as XLSX from 'xlsx';

const COLUMNAS_BASE = [
  { id: 'employeeId', label: '# Empleado', visible: true },
  { id: 'activo', label: 'Activo', visible: true },
  { id: 'firstName', label: 'Nombres', visible: true },
  { id: 'lastNamePaternal', label: 'Ap. Paterno', visible: true },
  { id: 'lastNameMaternal', label: 'Ap. Materno', visible: true },
  { id: 'cargo', label: 'Cargo', visible: true },
  { id: 'operaciones', label: 'Operaciones', visible: true },
  { id: 'telefono', label: 'Teléfono Asig.', visible: true },
  { id: 'fNacimiento', label: 'F. Nacimiento', visible: true },
  { id: 'fIngreso', label: 'F. Ingreso', visible: true }
];

export const EmpleadosDashboard = () => {
  const [empleados, setEmpleados] = useState<Employee[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [empleadoEditando, setEmpleadoEditando] = useState<Employee | null>(null);
  
  const [empleadoViendo, setEmpleadoViendo] = useState<Employee | null>(null);
  const [activeTabDetalle, setActiveTabDetalle] = useState<'general' | 'empresa' | 'herramientas'>('general');
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false);

  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;
  
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'empleados'), orderBy('employeeId', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmpleados(data);
      setCargando(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda]);

  const handleNuevo = () => { setEmpleadoEditando(null); setEstadoFormulario('abierto'); };
  
  const editarEmpleado = (emp: Employee) => { setEmpleadoViendo(null); setEmpleadoEditando(emp); setEstadoFormulario('abierto'); };
  
  const eliminarEmpleado = async (id: string) => {
    if (window.confirm('¿Eliminar empleado permanentemente?')) {
      try { await eliminarRegistro('empleados', id); setEmpleadoViendo(null); } 
      catch (error) { alert("Error al eliminar."); }
    }
  };

  const verDetalle = (emp: Employee) => {
    setEmpleadoViendo(emp);
    setActiveTabDetalle('general');
  };

  const formatearFecha = (isoString: string | undefined | null) => {
    if (!isoString) return '-';
    return new Date(isoString + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const registrosFiltrados = useMemo(() => {
    const b = busqueda.toLowerCase();
    return empleados.filter(e => 
      (e.employeeId || '').toLowerCase().includes(b) ||
      (e.firstName || '').toLowerCase().includes(b) ||
      (e.lastNamePaternal || '').toLowerCase().includes(b) ||
      (e.cargoNombre || '').toLowerCase().includes(b)
    ).sort((a, b) => {
      const numA = parseInt((a.employeeId || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt((b.employeeId || '').replace(/\D/g, ''), 10) || 0;
      return numB - numA;
    });
  }, [empleados, busqueda]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const empleadosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

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

  const renderCellContent = (emp: any, colId: string) => {
    switch (colId) {
      case 'employeeId': return <span className="font-mono" style={{ color: '#58a6ff', fontWeight: 'bold' }}>{emp.employeeId}</span>;
      case 'activo': return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: emp.activo ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: emp.activo ? '#10b981' : '#ef4444', fontWeight: 'bold', border: emp.activo ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)' }}>{emp.activo ? 'Activo' : 'Baja'}</span>;
      case 'firstName': return <span style={{ color: '#f0f6fc', fontWeight: '500' }}>{emp.firstName}</span>;
      case 'lastNamePaternal': return <span style={{ color: '#c9d1d9' }}>{emp.lastNamePaternal}</span>;
      case 'lastNameMaternal': return <span style={{ color: '#c9d1d9' }}>{emp.lastNameMaternal || '-'}</span>;
      case 'cargo': return <span style={{ color: '#c9d1d9' }}>{emp.cargoNombre || '-'}</span>;
      case 'operaciones': return <span style={{ color: '#8b949e', fontSize: '0.85rem' }}>{emp.operacionesIds?.length > 0 ? `${emp.operacionesIds.length} Asig.` : '-'}</span>;
      case 'telefono': return <span style={{ color: '#c9d1d9' }}>{emp.telefonoAsignado || '-'}</span>;
      case 'fNacimiento': return <span style={{ color: '#c9d1d9' }}>{formatearFecha(emp.birthDate)}</span>;
      case 'fIngreso': return <span style={{ color: '#c9d1d9' }}>{formatearFecha(emp.fechaIngreso)}</span>;
      default: return '-';
    }
  };

  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    const columnasVisibles = columnasTabla.filter(c => c.visible);
    const datosExcel = registrosFiltrados.map(emp => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        switch (col.id) {
          case 'employeeId': fila[col.label] = emp.employeeId; break;
          case 'activo': fila[col.label] = emp.activo ? 'Activo' : 'Baja'; break;
          case 'firstName': fila[col.label] = emp.firstName; break;
          case 'lastNamePaternal': fila[col.label] = emp.lastNamePaternal; break;
          case 'lastNameMaternal': fila[col.label] = emp.lastNameMaternal || ''; break;
          case 'cargo': fila[col.label] = emp.cargoNombre || ''; break;
          case 'operaciones': fila[col.label] = emp.operacionesIds?.length || 0; break;
          case 'telefono': fila[col.label] = emp.telefonoAsignado || ''; break;
          case 'fNacimiento': fila[col.label] = formatearFecha(emp.birthDate); break;
          case 'fIngreso': fila[col.label] = formatearFecha(emp.fechaIngreso); break;
        }
      });
      return fila;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(datosExcel);
    XLSX.utils.book_append_sheet(wb, ws, "Empleados");
    XLSX.writeFile(wb, `Directorio_Empleados_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 20px', background: 'none', border: 'none',
    borderBottom: isActive ? '2px solid #D84315' : '2px solid transparent',
    color: isActive ? '#f0f6fc' : '#8b949e', cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal', fontSize: '0.9rem',
    transition: 'all 0.2s ease', outline: 'none'
  });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      {estadoFormulario !== 'cerrado' && (
        <EmployeeForm 
          estado={estadoFormulario} initialData={empleadoEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setEmpleadoEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')}
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      <div style={{ width: '100%', margin: '0 auto' }}>
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>Directorio de Empleados</h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder="Buscar empleado..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }} />
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-outline" onClick={() => setModalColumnas(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }} title="Configurar Columnas">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button className="btn btn-outline" onClick={exportarExcel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }} title="Exportar Excel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button className="btn btn-primary" title="Agregar Empleado" onClick={handleNuevo} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            {cargando ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando empleados...</div>
            ) : (
              <table className="data-table" style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <th key={`th_${col.id}`} style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {empleadosEnPantalla.map(emp => (
                    <tr key={emp.id} onClick={() => verDetalle(emp)} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === emp.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(emp.id!)} onMouseLeave={() => setHoveredRowId(null)}>
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(ev: any) => ev.stopPropagation()}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button onClick={(ev) => { ev.stopPropagation(); editarEmpleado(emp); }} style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                          <button onClick={(ev) => { ev.stopPropagation(); eliminarEmpleado(emp.id!); }} style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                        </div>
                      </td>
                      {columnasTabla.filter(c => c.visible).map(col => (
                        <td key={`cell_${emp.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>{renderCellContent(emp, col.id)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {registrosFiltrados.length > 0 && !cargando && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} empleados
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button 
                  onClick={irPaginaSiguiente} 
                  disabled={paginaActual === totalPaginas || totalPaginas === 0}
                  title="Página Siguiente"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {columnasTabla.map((col, idx) => (
                <li key={col.id} draggable onDragStart={() => handleDragStart(idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={() => setDraggedColIndex(null)} onDragOver={(e) => e.preventDefault()} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}><button onClick={() => setModalColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar</button></div>
          </div>
        </div>
      )}

      {/* MODAL DETALLE EMPLEADO */}
      {empleadoViendo && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1500, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div className="form-card detail-card" style={{ maxWidth: '850px', width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', overflow: 'hidden' }}>
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.25rem' }}>Ficha: {empleadoViendo.firstName}</h2>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  onClick={() => setMostrarSubirDoc(true)}
                  title="Subir documentos del empleado"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '6px', border: 'none', backgroundColor: '#D84315', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Subir Documentos
                </button>
                <button onClick={() => setEmpleadoViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', backgroundColor: '#161b22', padding: '0 24px' }}>
              <button type="button" onClick={() => setActiveTabDetalle('general')} style={tabStyle(activeTabDetalle === 'general')}>Datos Personales</button>
              <button type="button" onClick={() => setActiveTabDetalle('empresa')} style={tabStyle(activeTabDetalle === 'empresa')}>Alta en Empresa</button>
              <button type="button" onClick={() => setActiveTabDetalle('herramientas')} style={tabStyle(activeTabDetalle === 'herramientas')}>Herramientas / Operativa</button>
            </div>
            <div className="detail-content" style={{ padding: '24px', minHeight: '300px', maxHeight: '60vh', overflowY: 'auto' }}>
              {activeTabDetalle === 'general' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                   <div><span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem' }}>Nombres</span><span style={{ color: '#f0f6fc' }}>{empleadoViendo.firstName}</span></div>
                   <div><span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem' }}>Ap. Paterno</span><span style={{ color: '#c9d1d9' }}>{empleadoViendo.lastNamePaternal}</span></div>
                   <div><span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem' }}>Ap. Materno</span><span style={{ color: '#c9d1d9' }}>{empleadoViendo.lastNameMaternal || '-'}</span></div>
                </div>
              )}
              {activeTabDetalle === 'empresa' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div><span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem' }}>Cargo</span><span style={{ color: '#58a6ff' }}>{empleadoViendo.cargoNombre || '-'}</span></div>
                  <div><span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem' }}>Ingreso</span><span style={{ color: '#c9d1d9' }}>{formatearFecha(empleadoViendo.fechaIngreso)}</span></div>
                </div>
              )}
              {activeTabDetalle === 'herramientas' && (
                 <HerramientasEmpleado empleadoId={empleadoViendo.id ?? ''} />
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#0d1117' }}>
              <button onClick={() => setEmpleadoViendo(null)} style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}
      {empleadoViendo && (
        <DocumentoUploadModal
          isOpen={mostrarSubirDoc}
          onClose={() => setMostrarSubirDoc(false)}
          coleccionOrigen="empleados"
          registroId={empleadoViendo.id ?? ''}
          registroNombre={`${empleadoViendo.firstName || ''} ${empleadoViendo.lastNamePaternal || ''} ${empleadoViendo.lastNameMaternal || ''}`.replace(/\s+/g, ' ').trim()}
          tiposDocumento={TIPOS_DOCUMENTO_EMPLEADO}
        />
      )}
    </div>
  );
}
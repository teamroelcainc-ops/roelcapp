import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase';
import { EmployeeForm, TIPOS_DOCUMENTO_EMPLEADO } from './EmployeeForm';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import { CargaMasivaDocumentosModal } from '../../documentos/CargaMasivaDocumentosModal';
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { HerramientasEmpleado } from './HerramientasEmpleado'; 
import type { Employee } from '../../../types/empleado';
import * as XLSX from 'xlsx';
import './EmpleadosDashboard.css';

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
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [empleadoEditando, setEmpleadoEditando] = useState<Employee | null>(null);
  
  const [empleadoViendo, setEmpleadoViendo] = useState<Employee | null>(null);
  const [activeTabDetalle, setActiveTabDetalle] = useState<'general' | 'empresa' | 'herramientas' | 'documentos'>('general');
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false);
  // ✅ V00144: carga masiva por carpetas
  const [mostrarCargaMasiva, setMostrarCargaMasiva] = useState(false);
  // ✅ NUEVO: empleado al que se le subirá un documento DIRECTO desde la fila
  //   (sin abrir la ficha). Si es null, el modal usa el empleado de la ficha.
  const [empleadoDocs, setEmpleadoDocs] = useState<any | null>(null);

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
      case 'employeeId': return <span className="font-mono ed-x1">{emp.employeeId}</span>;
      case 'activo': return <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: emp.activo ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: emp.activo ? '#10b981' : '#ef4444', fontWeight: 'bold', border: emp.activo ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)' }}>{emp.activo ? 'Activo' : 'Baja'}</span>;
      case 'firstName': return <span className="ed-x2">{emp.firstName}</span>;
      case 'lastNamePaternal': return <span className="ed-x3">{emp.lastNamePaternal}</span>;
      case 'lastNameMaternal': return <span className="ed-x3">{emp.lastNameMaternal || '-'}</span>;
      case 'cargo': return <span className="ed-x3">{emp.cargoNombre || '-'}</span>;
      case 'operaciones': return <span className="ed-x4">{emp.operacionesIds?.length > 0 ? `${emp.operacionesIds.length} Asig.` : '-'}</span>;
      case 'telefono': return <span className="ed-x3">{emp.telefonoAsignado || '-'}</span>;
      case 'fNacimiento': return <span className="ed-x3">{formatearFecha(emp.birthDate)}</span>;
      case 'fIngreso': return <span className="ed-x3">{formatearFecha(emp.fechaIngreso)}</span>;
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
    <div className="module-container ed-x5">
      {estadoFormulario !== 'cerrado' && (
        <EmployeeForm 
          estado={estadoFormulario} initialData={empleadoEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setEmpleadoEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')}
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      <div className="ed-x6">
        <h1 className="module-title ed-x7">Directorio de Empleados</h1>

        <div className="ed-x8">
          <div className="ed-x9">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${busqueda ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {busqueda && <span className="ed-x10">1</span>}
            </button>
            {busqueda && (
              <span className="ed-x11">
                "{busqueda}"
                <button className="ed-x12" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="ed-x13">
              {busquedaHecha ? `${registrosFiltrados.length} empleados` : 'Presiona Filtros y Buscar para ver el directorio.'}
            </span>
          </div>
          
          <div className="ed-x14">
            <button className="btn btn-outline ed-x15" onClick={() => setModalColumnas(true)} title="Configurar Columnas">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button className="btn btn-outline ed-x15" onClick={exportarExcel} title="Exportar Excel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button className="btn btn-primary ed-x16" title="Agregar Empleado" onClick={handleNuevo}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body ed-x17">
          <div className="table-container ed-x18">
            {cargando ? (
              <div className="ed-x19">Cargando empleados...</div>
            ) : (
              <table className="data-table ed-x20">
                <thead className="ed-x21">
                  <tr>
                    <th className="ed-x22">Acciones</th>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <th className="ed-x23" key={`th_${col.id}`}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!busquedaHecha ? (
                    <tr><td className="ed-x24" colSpan={columnasTabla.filter(c => c.visible).length + 1}>
                      <div className="ed-x25">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                        <span className="ed-x26">Define tus filtros y presiona <b className="ed-x27">Buscar</b> para ver el directorio.</span>
                        <button className="ed-x28" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                      </div>
                    </td></tr>
                  ) : empleadosEnPantalla.length === 0 ? (
                    <tr><td className="ed-x29" colSpan={columnasTabla.filter(c => c.visible).length + 1}>
                      {busqueda ? 'No se encontraron empleados para tu búsqueda.' : 'Aún no hay empleados registrados.'}
                    </td></tr>
                  ) : (
                  empleadosEnPantalla.map(emp => (
                    <tr key={emp.id} onClick={() => verDetalle(emp)} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === emp.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(emp.id!)} onMouseLeave={() => setHoveredRowId(null)}>
                      <td className="ed-x30" onClick={(ev: any) => ev.stopPropagation()}>
                        <div className="ed-x31">
                          <button className="ed-x32" onClick={(ev) => { ev.stopPropagation(); editarEmpleado(emp); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                          {/* ✅ NUEVO: subir documento directo desde la fila (sin abrir la ficha) */}
                          <button
                            className="ed-x32"
                            title="Subir documento"
                            style={{ color: '#fb923c' }}
                            onClick={(ev) => { ev.stopPropagation(); setEmpleadoDocs(emp); setMostrarSubirDoc(true); }}
                          ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>
                          <button
                            className="btn-icono btn-carga-masiva"
                            title="Carga masiva: sube de golpe la carpeta completa de documentos de este colaborador"
                            onClick={(ev) => { ev.stopPropagation(); setEmpleadoDocs(emp); setMostrarCargaMasiva(true); }}
                          >📁</button>
                          <button className="ed-x33" onClick={(ev) => { ev.stopPropagation(); eliminarEmpleado(emp.id!); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                        </div>
                      </td>
                      {columnasTabla.filter(c => c.visible).map(col => (
                        <td className="ed-x34" key={`cell_${emp.id}_${col.id}`}>{renderCellContent(emp, col.id)}</td>
                      ))}
                    </tr>
                  ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {busquedaHecha && registrosFiltrados.length > 0 && !cargando && (
            <div className="ed-x35">
              <div className="ed-x36">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} empleados
              </div>
              <div className="ed-x37">
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="ed-x38">{paginaActual} / {totalPaginas || 1}</span>
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
        <div className="modal-overlay ed-x39">
          <div className="ed-x40">
            <div className="ed-x41">
              <h3 className="ed-x42">Configurar Columnas</h3>
              <button className="ed-x43" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <ul className="ed-x44">
              {columnasTabla.map((col, idx) => (
                <li key={col.id} draggable onDragStart={() => handleDragStart(idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={() => setDraggedColIndex(null)} onDragOver={(e) => e.preventDefault()} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="ed-x45"><button className="ed-x46" onClick={() => setModalColumnas(false)}>Aplicar</button></div>
          </div>
        </div>
      )}

      {/* MODAL DETALLE EMPLEADO */}
      {empleadoViendo && (
        <div className="modal-overlay ed-x47">
          <div className="form-card detail-card ed-x48">
            <div className="form-header ed-x49">
              <h2 className="ed-x50">Ficha: {empleadoViendo.firstName}</h2>
              <div className="ed-x51">
                <button className="ed-x52"
                  onClick={() => setMostrarSubirDoc(true)}
                  title="Subir documentos del empleado"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Subir Documentos
                </button>
                <button className="ed-x53" onClick={() => setEmpleadoViendo(null)}>✕</button>
              </div>
            </div>
            <div className="ed-x54">
              <button type="button" onClick={() => setActiveTabDetalle('general')} style={tabStyle(activeTabDetalle === 'general')}>Datos Personales</button>
              <button type="button" onClick={() => setActiveTabDetalle('empresa')} style={tabStyle(activeTabDetalle === 'empresa')}>Alta en Empresa</button>
              <button type="button" onClick={() => setActiveTabDetalle('herramientas')} style={tabStyle(activeTabDetalle === 'herramientas')}>Herramientas / Operativa</button>
              <button type="button" onClick={() => setActiveTabDetalle('documentos')} style={tabStyle(activeTabDetalle === 'documentos')}>Documentos</button>
            </div>
            <div className="detail-content ed-x55">
              {activeTabDetalle === 'general' && (
                <div className="ed-x56">
                   <div><span className="ed-x57">Nombres</span><span className="ed-x58">{empleadoViendo.firstName}</span></div>
                   <div><span className="ed-x57">Ap. Paterno</span><span className="ed-x3">{empleadoViendo.lastNamePaternal}</span></div>
                   <div><span className="ed-x57">Ap. Materno</span><span className="ed-x3">{empleadoViendo.lastNameMaternal || '-'}</span></div>
                </div>
              )}
              {activeTabDetalle === 'empresa' && (
                <div className="ed-x56">
                  <div><span className="ed-x57">Cargo</span><span className="ed-x59">{empleadoViendo.cargoNombre || '-'}</span></div>
                  <div><span className="ed-x57">Ingreso</span><span className="ed-x3">{formatearFecha(empleadoViendo.fechaIngreso)}</span></div>
                </div>
              )}
              {activeTabDetalle === 'herramientas' && (
                 <HerramientasEmpleado empleadoId={empleadoViendo.id ?? ''} />
              )}
              {activeTabDetalle === 'documentos' && (
                 <DocumentosLista coleccionOrigen="empleados" registroId={empleadoViendo.id ?? ''} />
              )}
            </div>
            <div className="ed-x60">
              <button className="ed-x61" onClick={() => setEmpleadoViendo(null)}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}
      {(empleadoDocs || empleadoViendo) && (() => {
        // ✅ NUEVO: el modal funciona tanto desde la ficha como desde la fila.
        const objetivo = empleadoDocs || empleadoViendo;
        return (
          <>
          {/* ✅ V00144: carga masiva por carpetas */}
          <CargaMasivaDocumentosModal
            isOpen={mostrarCargaMasiva}
            onClose={() => { setMostrarCargaMasiva(false); setEmpleadoDocs(null); }}
            coleccionOrigen="empleados"
            registroId={objetivo?.id ?? ''}
            registroNombre={`${objetivo?.firstName ?? objetivo?.nombres ?? ''} ${objetivo?.lastNamePaternal ?? objetivo?.apellidoPaterno ?? ''}`.trim() || (objetivo?.id ?? '')}
          />
          <DocumentoUploadModal
            isOpen={mostrarSubirDoc}
            onClose={() => { setMostrarSubirDoc(false); setEmpleadoDocs(null); }}
            coleccionOrigen="empleados"
            registroId={objetivo.id ?? ''}
            registroNombre={`${objetivo.firstName || ''} ${objetivo.lastNamePaternal || ''} ${objetivo.lastNameMaternal || ''}`.replace(/\s+/g, ' ').trim()}
            tiposDocumento={TIPOS_DOCUMENTO_EMPLEADO}
            onUploaded={() => { if (empleadoViendo && !empleadoDocs) setActiveTabDetalle('documentos'); }}
          />
          </>
        );
      })()}

      {/* NUEVO: panel lateral DERECHO de filtros (Directorio de Empleados) */}
      {drawerFiltrosAbierto && (
        <div className="ed-x62" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="ed-x63" onClick={(e) => e.stopPropagation()}>
            <div className="ed-x64">
              <h3 className="ed-x65">Filtros · Directorio de Empleados</h3>
              <button className="ed-x43" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="ed-x66">
              <label className="ed-x67">BÚSQUEDA</label>
              <div className="ed-x68">
                <svg className="ed-x69" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="ed-x70" type="text" placeholder="Nombre, puesto, teléfono..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="ed-x71" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="ed-x72">
              La búsqueda es <b className="ed-x73">opcional</b>. Presiona <b className="ed-x27">Buscar</b> para ver todo el directorio.
            </div>

            <div className="ed-x74">
              <button className="ed-x75" onClick={() => { setBusqueda(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="ed-x76" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
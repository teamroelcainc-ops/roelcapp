// src/features/empleados/components/EmpleadosDashboard.tsx
import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase';
import { EmployeeForm } from './EmployeeForm';
import { HerramientasEmpleado } from './HerramientasEmpleado'; 
import type { Employee } from '../../../types/empleado';

export const EmpleadosDashboard = () => {
  const [empleados, setEmpleados] = useState<Employee[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [empleadoEditando, setEmpleadoEditando] = useState<Employee | null>(null);
  
  // Estado para el Modal de Detalle de solo lectura y sus pestañas
  const [empleadoViendo, setEmpleadoViendo] = useState<Employee | null>(null);
  const [activeTabDetalle, setActiveTabDetalle] = useState<'general' | 'empresa' | 'herramientas'>('general');

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

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

  // ✅ Filtrado GLOBAL y Ordenamiento Numérico Descendente
  const registrosFiltrados = empleados.filter(e => {
    const b = busqueda.toLowerCase();
    return (
      (e.employeeId || '').toLowerCase().includes(b) ||
      (e.firstName || '').toLowerCase().includes(b) ||
      (e.lastNamePaternal || '').toLowerCase().includes(b) ||
      (e.cargoNombre || '').toLowerCase().includes(b)
    );
  }).sort((a, b) => {
    const numA = parseInt((a.employeeId || '').replace(/\D/g, ''), 10) || 0;
    const numB = parseInt((b.employeeId || '').replace(/\D/g, ''), 10) || 0;
    return numB - numA; // Descendente
  });

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const empleadosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  const mostrarDato = (dato: any) => (dato && dato !== '' ? dato : '-');
  const formatoMoneda = (monto: any) => `$ ${parseFloat(monto || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 20px', background: 'none', border: 'none',
    borderBottom: isActive ? '2px solid #D84315' : '2px solid transparent',
    color: isActive ? '#f0f6fc' : '#8b949e', cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal', fontSize: '0.9rem',
    transition: 'all 0.2s ease', outline: 'none'
  });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      <style>{`
        @media (max-width: 768px) {
          .responsive-table thead { display: none; }
          .responsive-table tr { display: flex; flex-direction: column; border: 1px solid #30363d; margin-bottom: 16px; border-radius: 8px; background-color: #0d1117; padding: 12px; }
          .responsive-table td { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #21262d; padding: 8px 0; text-align: right; font-size: 0.9rem; }
          .responsive-table td:last-child { border-bottom: none; }
          .responsive-table td::before { content: attr(data-label); font-weight: bold; color: #8b949e; text-transform: uppercase; font-size: 0.75rem; text-align: left; }
          .actions-cell { width: 100%; justify-content: flex-end; }
        }
      `}</style>

      {estadoFormulario !== 'cerrado' && (
        <EmployeeForm 
          estado={estadoFormulario} initialData={empleadoEditando}
          onClose={() => setEstadoFormulario('cerrado')}
          onMinimize={() => setEstadoFormulario('minimizado')}
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      <div style={{ width: '100%', margin: '0 auto' }}>
        
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          Directorio de Empleados
        </h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '120px' }}>
            <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px' }}>
              <option>Filtro: Todos</option>
              <option>Solo Activos</option>
              <option>Solo Bajas</option>
            </select>
          </div>

          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Buscar empleado..." 
                value={busqueda} 
                onChange={(e) => setBusqueda(e.target.value)} 
                style={{ width: '100%', padding: '8px 12px 8px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '150px' }}>
            <button 
              className="btn btn-primary" 
              title="Alta de Empleado"
              onClick={handleNuevo} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', backgroundColor: '#010409' }}>
            {cargando ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Descargando base de datos de Empleados...</div>
            ) : (
              <table className="data-table responsive-table" style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}># Empleado</th>
                    <th style={{ padding: '16px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Activo</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Nombres</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Ap. Paterno</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Ap. Materno</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Cargo</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Operaciones</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Teléfono Asig.</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>F. Nacimiento</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>F. Ingreso</th>
                  </tr>
                </thead>
                <tbody>
                  {empleadosEnPantalla.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                        {busqueda ? 'No se encontraron empleados para tu búsqueda.' : 'No hay empleados registrados.'}
                      </td>
                    </tr>
                  ) : (
                    empleadosEnPantalla.map(emp => (
                      <tr 
                        key={emp.id} 
                        style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === emp.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredRowId(emp.id!)} 
                        onMouseLeave={() => setHoveredRowId(null)}
                        onClick={() => verDetalle(emp)} 
                      >
                        <td data-label="Acciones" style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: hoveredRowId === emp.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button 
                              type="button"
                              className="btn-small btn-edit" 
                              title="Editar Empleado"
                              onClick={(e) => { e.stopPropagation(); editarEmpleado(emp); }}
                              style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            </button>
                            <button 
                              type="button"
                              className="btn-small btn-danger-outline" 
                              title="Eliminar Empleado"
                              onClick={(e) => { e.stopPropagation(); eliminarEmpleado(emp.id!); }}
                              style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        <td data-label="# Empleado" className="font-mono" style={{ padding: '16px', color: '#58a6ff', fontSize: '0.95rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{emp.employeeId}</td>
                        <td data-label="Activo" style={{ padding: '16px', textAlign: 'center' }}>
                          <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: emp.activo ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: emp.activo ? '#10b981' : '#ef4444', fontWeight: 'bold', border: emp.activo ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)' }}>
                            {emp.activo ? 'Activo' : 'Baja'}
                          </span>
                        </td>
                        <td data-label="Nombres" style={{ padding: '16px', color: '#f0f6fc', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{emp.firstName}</td>
                        <td data-label="Ap. Paterno" style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{emp.lastNamePaternal}</td>
                        <td data-label="Ap. Materno" style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{emp.lastNameMaternal || '-'}</td>
                        <td data-label="Cargo" style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{emp.cargoNombre || '-'}</td>
                        <td data-label="Operaciones" style={{ padding: '16px', color: '#8b949e', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{emp.operacionesIds?.length > 0 ? `${emp.operacionesIds.length} Asignadas` : '-'}</td>
                        <td data-label="Teléfono Asig." style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{emp.telefonoAsignado || '-'}</td>
                        <td data-label="F. Nacimiento" style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatearFecha(emp.birthDate)}</td>
                        <td data-label="F. Ingreso" style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatearFecha(emp.fechaIngreso)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* CONTROLES DE PAGINACIÓN ICONOGRÁFICOS */}
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

      {/* ✅ MODAL DE DETALLE (Solo Lectura con Pestañas) */}
      {empleadoViendo && (
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
          <div className="form-card detail-card" style={{ maxWidth: '850px', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            
            <div className="form-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', borderBottom: '1px solid #30363d' }}>
              <div>
                <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  Ficha del Empleado <span style={{ color: '#D84315' }}>{empleadoViendo.employeeId}</span>
                </h2>
                {empleadoViendo.activo ? (
                  <span style={{ display: 'inline-block', marginTop: '8px', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 'bold', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                    ESTADO ACTIVO
                  </span>
                ) : (
                  <span style={{ display: 'inline-block', marginTop: '8px', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontWeight: 'bold', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    DADO DE BAJA EL {formatearFecha((empleadoViendo as any).fechaBaja)}
                  </span>
                )}
              </div>
              <button onClick={() => setEmpleadoViendo(null)} className="btn-window close" style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', backgroundColor: '#161b22', padding: '0 24px' }}>
              <button type="button" onClick={() => setActiveTabDetalle('general')} style={tabStyle(activeTabDetalle === 'general')}>Datos Personales</button>
              <button type="button" onClick={() => setActiveTabDetalle('empresa')} style={tabStyle(activeTabDetalle === 'empresa')}>Alta en Empresa</button>
              <button type="button" onClick={() => setActiveTabDetalle('herramientas')} style={tabStyle(activeTabDetalle === 'herramientas')}>Herramientas / Operativa</button>
            </div>
            
            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto', flex: 1, minHeight: '350px' }}>
              
              {!empleadoViendo.activo && activeTabDetalle === 'empresa' && (
                <div style={{ backgroundColor: 'rgba(248, 81, 73, 0.1)', border: '1px solid rgba(248, 81, 73, 0.4)', borderRadius: '8px', padding: '16px', marginBottom: '24px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '24px' }}>⚠️</div>
                  <div>
                    <h3 style={{ color: '#f85149', margin: '0 0 8px 0', fontSize: '1rem' }}>Empleado dado de Baja</h3>
                    <div style={{ display: 'flex', gap: '24px' }}>
                      <p style={{ margin: 0, color: '#c9d1d9', fontSize: '0.9rem' }}><strong>Fecha de Baja:</strong> {formatearFecha((empleadoViendo as any).fechaBaja)}</p>
                      <p style={{ margin: 0, color: '#c9d1d9', fontSize: '0.9rem' }}><strong>Motivo:</strong> {(empleadoViendo as any).observacionBaja || 'No especificado'}</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTabDetalle === 'general' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', animation: 'fadeIn 0.3s ease' }}>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Nombres</span><span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1rem' }}>{mostrarDato(empleadoViendo.firstName)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Apellido Paterno</span><span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1rem' }}>{mostrarDato(empleadoViendo.lastNamePaternal)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Apellido Materno</span><span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1rem' }}>{mostrarDato(empleadoViendo.lastNameMaternal)}</span></div>
                  
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>RFC</span><span style={{ color: '#c9d1d9', fontWeight: '500', letterSpacing: '1px' }}>{mostrarDato(empleadoViendo.rfc)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Fecha Nacimiento</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{formatearFecha(empleadoViendo.birthDate)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Alías</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{mostrarDato(empleadoViendo.alias)}</span></div>

                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Teléfono Personal</span><span style={{ color: '#58a6ff', fontWeight: '500' }}>{mostrarDato(empleadoViendo.personalPhone)}</span></div>
                  <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Correo Personal</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{mostrarDato(empleadoViendo.personalEmail)}</span></div>

                  <div style={{ gridColumn: '1 / -1' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Dirección Exacta</span><span style={{ color: '#c9d1d9', fontWeight: '500', display: 'block', padding: '16px', backgroundColor: '#161b22', borderRadius: '8px', border: '1px dashed #30363d' }}>{mostrarDato(empleadoViendo.addressLabel)}</span></div>
                  
                  <div style={{ backgroundColor: 'rgba(216, 67, 21, 0.05)', border: '1px solid rgba(216, 67, 21, 0.2)', padding: '16px', borderRadius: '8px', gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Contacto de Emergencia</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{mostrarDato(empleadoViendo.emergencyContactName)}</span></div>
                    <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Teléfono de Emergencia</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{mostrarDato(empleadoViendo.emergencyContactPhone)}</span></div>
                  </div>
                </div>
              )}

              {activeTabDetalle === 'empresa' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', animation: 'fadeIn 0.3s ease' }}>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Empresa Asignada</span><span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{mostrarDato(empleadoViendo.empresaNombre)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cargo</span><span style={{ color: '#58a6ff', fontWeight: '500' }}>{mostrarDato(empleadoViendo.cargoNombre)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Departamento</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{mostrarDato(empleadoViendo.departamentoNombre)}</span></div>

                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Ingreso</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{formatearFecha(empleadoViendo.fechaIngreso)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Fecha Alta IMSS</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{formatearFecha(empleadoViendo.fechaAltaIMSS)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Operaciones Autorizadas</span><span style={{ color: '#c9d1d9', fontWeight: '500' }}>{empleadoViendo.operacionesIds?.length || 0} asignadas</span></div>

                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginTop: '8px' }}>
                    <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Salario Diario Integrado</span><span style={{ color: '#3fb950', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(empleadoViendo.salarioDiario)}</span></div>
                    <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Descuento IMSS</span><span style={{ color: '#f85149', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(empleadoViendo.descuentoIMSS)}</span></div>
                    <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Descuento INFONAVIT</span><span style={{ color: '#f85149', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(empleadoViendo.descuentoInfonavit)}</span></div>
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Observaciones (Empresa)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', display: 'block', padding: '16px', backgroundColor: '#0d1117', borderRadius: '6px', border: '1px dashed #30363d', minHeight: '60px' }}>
                      {mostrarDato((empleadoViendo as any).observacionesEmpresa)}
                    </span>
                  </div>
                </div>
              )}

              {activeTabDetalle === 'herramientas' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div style={{ backgroundColor: '#161b22', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>Fondo de Gastos Asignados</span>
                      <span style={{ color: '#3fb950', fontWeight: 'bold', fontSize: '1.5rem' }}>{formatoMoneda(empleadoViendo.gastosAsignados)}</span>
                    </div>
                    
                    <div style={{ backgroundColor: '#161b22', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>Teléfono de Flota (Empresarial)</span>
                      <span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.2rem' }}>{mostrarDato(empleadoViendo.telefonoAsignado)}</span>
                    </div>
                  </div>

                  {/* ✅ AQUÍ ESTÁ INCRUSTADO EL COMPONENTE DE HERRAMIENTAS */}
                  {empleadoViendo.id && (
                    <HerramientasEmpleado empleadoId={empleadoViendo.id} />
                  )}
                </div>
              )}
            </div>

            <div className="form-actions detail-actions" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#0d1117', flexShrink: 0 }}>
              <button onClick={() => setEmpleadoViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
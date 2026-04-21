// src/features/empleados/components/EmpleadosDashboard.tsx
import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase';
import { EmployeeForm } from './EmployeeForm';
import type { Employee } from '../../../types/empleado';

export const EmpleadosDashboard = () => {
  const [empleados, setEmpleados] = useState<Employee[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [empleadoEditando, setEmpleadoEditando] = useState<Employee | null>(null);

  // ✅ Estados para Hover y Paginación idénticos a Operaciones
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
  const editarEmpleado = (emp: Employee) => { setEmpleadoEditando(emp); setEstadoFormulario('abierto'); };
  
  const eliminarEmpleado = async (id: string) => {
    if (window.confirm('¿Eliminar empleado permanentemente?')) {
      try { await eliminarRegistro('empleados', id); } 
      catch (error) { alert("Error al eliminar."); }
    }
  };

  const formatearFecha = (isoString: string) => {
    if (!isoString) return '-';
    return new Date(isoString + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const forzarRecarga = () => {
    window.location.reload();
  };

  // ✅ Filtrado GLOBAL por buscador
  const registrosFiltrados = empleados.filter(e => {
    const b = busqueda.toLowerCase();
    return (
      (e.employeeId || '').toLowerCase().includes(b) ||
      (e.firstName || '').toLowerCase().includes(b) ||
      (e.lastNamePaternal || '').toLowerCase().includes(b) ||
      (e.cargoNombre || '').toLowerCase().includes(b)
    );
  });

  // ✅ LOGICA DE PAGINACIÓN
  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const empleadosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  // ✅ Función para Exportar a CSV
  const exportarCSV = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    const encabezados = [
      '# Empleado', 'Activo', 'Nombres', 'Ap. Paterno', 'Ap. Materno', 'Cargo', 
      'Operaciones', 'Teléfono Asig.', 'F. Nacimiento', 'F. Ingreso'
    ];
    
    const lineas = registrosFiltrados.map(emp => [
      `"${emp.employeeId || ''}"`,
      `"${emp.activo ? 'Sí' : 'No'}"`, 
      `"${emp.firstName || ''}"`,
      `"${emp.lastNamePaternal || ''}"`,
      `"${emp.lastNameMaternal || ''}"`,
      `"${emp.cargoNombre || ''}"`,
      `"${emp.operacionesIds?.length || 0} Asignadas"`,
      `"${emp.telefonoAsignado || ''}"`,
      `"${formatearFecha(emp.birthDate)}"`,
      `"${formatearFecha(emp.fechaIngreso)}"`
    ].join(','));

    const csvContent = [encabezados.join(','), ...lineas].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Empleados_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      {/* ✅ ESTILOS RESPONSIVOS PARA TABLA EN MÓVIL (Cero scroll horizontal) */}
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
        
        {/* TÍTULO LIMPIO */}
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          Directorio de Empleados
        </h1>

        {/* BARRA DE CONTROLES: ESTILO OPERACIONES */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          
          {/* Izquierda: Filtro */}
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '120px' }}>
            <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px' }}>
              <option>Filtro: Todos</option>
              <option>Solo Activos</option>
              <option>Solo Bajas</option>
            </select>
          </div>

          {/* Centro: Buscador */}
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

          {/* Derecha: Botonera */}
          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '280px' }}>
            <button className="btn btn-outline" onClick={forzarRecarga} style={{ fontSize: '0.8rem', padding: '4px 12px', backgroundColor: 'transparent', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer' }} title="Actualizar Datos">
              ↻ Actualizar
            </button>
            <button className="btn btn-outline" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', backgroundColor: '#21262d', border: '1px solid #30363d', padding: '8px 16px', borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Exportar CSV
            </button>
            <button className="btn btn-primary" onClick={handleNuevo} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', whiteSpace: 'nowrap' }}>
              + Alta de Empleado
            </button>
          </div>
        </div>

        {/* TABLA RESPONSIVE */}
        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', backgroundColor: '#010409' }}>
            {cargando ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Descargando base de datos de Empleados...</div>
            ) : (
              <table className="data-table responsive-table" style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px', width: '140px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
                      Acciones
                    </th>
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
                        style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === emp.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'default' }}
                        onMouseEnter={() => setHoveredRowId(emp.id!)} 
                        onMouseLeave={() => setHoveredRowId(null)}
                      >
                        <td data-label="Acciones" style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: hoveredRowId === emp.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', zIndex: 5, borderRight: '1px solid #30363d' }}>
                          <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button 
                              type="button"
                              className="btn-small btn-edit" 
                              onClick={(e) => { e.stopPropagation(); editarEmpleado(emp); }}
                              style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '4px 8px', fontSize: '0.8rem', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              Editar
                            </button>
                            <button 
                              type="button"
                              className="btn-small btn-danger-outline" 
                              onClick={(e) => { e.stopPropagation(); eliminarEmpleado(emp.id!); }}
                              style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '4px 8px', fontSize: '0.8rem', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              Eliminar
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

          {/* CONTROLES DE PAGINACIÓN */}
          {registrosFiltrados.length > 0 && !cargando && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} empleados
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}
                >
                  Anterior
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button 
                  onClick={irPaginaSiguiente} 
                  disabled={paginaActual === totalPaginas || totalPaginas === 0}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
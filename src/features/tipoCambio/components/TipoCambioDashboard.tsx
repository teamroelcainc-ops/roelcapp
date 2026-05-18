// src/features/tipoCambio/components/TipoCambioDashboard.tsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore'; 
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { FormularioTipoCambio } from './FormularioTipoCambio';
import * as XLSX from 'xlsx';

// ✅ TODAS LAS COLUMNAS BASE DE LA TABLA TIPO DE CAMBIO
const COLUMNAS_BASE = [
  { id: 'fecha', label: 'Fecha', visible: true },
  { id: 'dia', label: 'Día', visible: true },
  { id: 'tcDof', label: 'T.C. DOF', visible: true },
  { id: 'tendencia', label: 'Tendencia', visible: true }
];

export const TipoCambioDashboard = () => {
  const [registrosGlobales, setRegistrosGlobales] = useState<any[]>([]);
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [registroEditando, setRegistroEditando] = useState<any | null>(null);

  // Estados de Búsqueda y Paginación
  const [busqueda, setBusqueda] = useState('');
  const [filtroTendencia, setFiltroTendencia] = useState('Todos');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ✅ ESTADOS PARA CONFIGURACIÓN DE COLUMNAS (DRAG & DROP)
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'tipo_cambio'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Ordenar por fecha (más reciente primero)
      data.sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      setRegistrosGlobales(data);
    });
    return () => unsubscribe();
  }, []);

  // Resetear página al buscar/filtrar
  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, filtroTendencia]);

  const handleNuevo = () => { 
    setRegistroEditando(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const editarRegistro = (registro: any) => { 
    setRegistroEditando(registro); 
    setEstadoFormulario('abierto'); 
  };

  const handleEliminar = async (e: React.MouseEvent, id: string, fecha: string) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar el registro del día ${formatearFecha(fecha)}?`)) {
      try {
        await deleteDoc(doc(db, 'tipo_cambio', id));
        await registrarLog('Tipo de Cambio', 'Eliminación', `Eliminó el T.C. del día ${fecha}`);
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert("Hubo un error al intentar eliminar el registro.");
      }
    }
  };

  // Formato de fecha en español
  const formatearFecha = (fechaStr: string) => {
    if (!fechaStr) return '';
    const [year, month, day] = fechaStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const renderTendencia = (tipo: string, texto: string) => {
    if (tipo === 'subio') return <span><span style={{color: '#ef4444', marginRight: '6px'}}>↗</span>{texto}</span>;
    if (tipo === 'bajo') return <span><span style={{color: '#3b82f6', marginRight: '6px'}}>↘</span>{texto}</span>;
    return <span><span style={{color: '#8b949e', marginRight: '6px'}}>—</span>{texto}</span>;
  };

  // ✅ FILTRADO Y BÚSQUEDA
  const registrosFiltrados = registrosGlobales.filter(r => {
    const b = busqueda.toLowerCase();
    const coincideBusqueda = 
      formatearFecha(r.fecha).includes(b) ||
      (r.dia || '').toLowerCase().includes(b) ||
      String(r.tcDof || '').includes(b);

    const coincideFiltro = filtroTendencia === 'Todos' || r.tipoTendencia === filtroTendencia;

    return coincideBusqueda && coincideFiltro;
  });

  // ✅ PAGINACIÓN
  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  // ✅ LÓGICA DE DRAG & DROP PARA COLUMNAS
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

  // ✅ RENDERIZADOR DINÁMICO DE CELDAS
  const renderCellContent = (registro: any, colId: string) => {
    switch (colId) {
      case 'fecha': return <span style={{ fontWeight: '500', color: '#f0f6fc', whiteSpace: 'nowrap' }}>{formatearFecha(registro.fecha)}</span>;
      case 'dia': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{registro.dia || '-'}</span>;
      case 'tcDof': return <span style={{ color: '#10b981', fontWeight: 'bold', whiteSpace: 'nowrap' }}>${registro.tcDof}</span>;
      case 'tendencia': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{renderTendencia(registro.tipoTendencia, registro.tendencia)}</span>;
      default: return <span style={{ color: '#c9d1d9' }}>-</span>;
    }
  };

  // ✅ EXPORTAR EXCEL CON LAS COLUMNAS VISIBLES ACTUALMENTE
  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    
    const columnasVisibles = columnasTabla.filter(c => c.visible);

    const datosExcel = registrosFiltrados.map(reg => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        let val: any = '-';
        switch (col.id) {
          case 'fecha': val = formatearFecha(reg.fecha); break;
          case 'dia': val = reg.dia || ''; break;
          case 'tcDof': val = Number(reg.tcDof || 0); break;
          case 'tendencia': val = reg.tendencia || ''; break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tipo de Cambio');
    XLSX.writeFile(workbook, `Tipo_Cambio_DOF_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioTipoCambio
          estado={estadoFormulario as 'abierto' | 'minimizado'}
          initialData={registroEditando}
          registros={registrosGlobales}
          onClose={() => setEstadoFormulario('cerrado')}
          onMinimize={() => setEstadoFormulario('minimizado')}
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      {/* CONTENEDOR MAESTRO */}
     <div style={{ width: '100%', margin: '0 auto' }}>
        
        {/* TÍTULO LIMPIO */}
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          Tipo de Cambio Oficial
        </h1>

        {/* BARRA DE CONTROLES: Responsive y Alineada */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          
          {/* Izquierda: Filtro Estático */}
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '150px' }}>
            <select 
              value={filtroTendencia} 
              onChange={(e) => setFiltroTendencia(e.target.value)}
              className="form-control" 
              style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', padding: '10px', borderRadius: '6px' }}
            >
              <option value="Todos">Filtro: Todos</option>
              <option value="subio">Tendencia: Subió</option>
              <option value="bajo">Tendencia: Bajó</option>
              <option value="igual">Tendencia: Se mantuvo</option>
            </select>
          </div>

          {/* Centro: Buscador Inteligente */}
          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Buscar por Fecha, Día o Monto..." 
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Derecha: Botones Iconográficos */}
          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '150px' }}>
            <button 
              className="btn btn-outline" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-outline" 
              title="Exportar a Excel"
              onClick={exportarExcel} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary" 
              title="Nuevo Registro"
              onClick={handleNuevo} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA RESPONSIVE */}
        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            <table className="data-table" style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
                    Acciones
                  </th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th key={`th_${col.id}`} style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              
              <tbody>
                {registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                      {busqueda || filtroTendencia !== 'Todos' ? 'No se encontraron registros con estos filtros.' : 'Aún no hay registros de tipo de cambio. Haz clic en el botón de agregar (+) para crear el primero.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((registro) => (
                    <tr 
                      key={registro.id} 
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === registro.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(registro.id)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => editarRegistro(registro)}
                    >
                      {/* Celda de Acciones fija a la izquierda con ICONOS */}
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn-small btn-edit" 
                            title="Editar Registro"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(registro); }}
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger" 
                            title="Eliminar Registro"
                            onClick={(e) => handleEliminar(e, registro.id, registro.fecha)}
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      {columnasTabla.filter(c => c.visible).map(col => (
                        <td key={`cell_${registro.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                          {renderCellContent(registro, col.id)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* CONTROLES DE PAGINACIÓN ICONOGRÁFICOS */}
          {registrosFiltrados.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button 
                  title="Página Siguiente"
                  onClick={irPaginaSiguiente} 
                  disabled={paginaActual === totalPaginas || totalPaginas === 0}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ✅ MODAL CONFIGURACIÓN COLUMNAS INTERACTIVAS (DRAG & DROP) */}
      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas de la Tabla</h3>
              <button onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '24px' }}>Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {columnasTabla.map((col, idx) => (
                <li 
                  key={col.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab', transition: 'background-color 0.2s' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} style={{ cursor: 'pointer' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={() => setModalColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
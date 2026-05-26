// src/features/remolques/components/RemolquesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase'; 
import { FormularioRemolque } from './FormularioRemolque';
import type { RemolqueRecord } from '../../../types/remolque'; 
import * as XLSX from 'xlsx';

// ✅ TODAS LAS COLUMNAS BASE DE LA TABLA REMOLQUES
const COLUMNAS_BASE = [
  { id: 'nombre', label: 'Nombre', visible: true },
  { id: 'tipo', label: 'Tipo', visible: true },
  { id: 'propietario', label: 'Propietario', visible: true },
  { id: 'placas', label: 'Placas', visible: true },
  { id: 'serie', label: 'Serie', visible: true },
  { id: 'marca', label: 'Marca', visible: true },
  { id: 'anio', label: 'Año', visible: true },
  { id: 'ubicacion', label: 'Ubicación (País/Est)', visible: true }
];

export const RemolquesDashboard: React.FC = () => {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [registroEditando, setRegistroEditando] = useState<RemolqueRecord | null>(null);
  
  // Lista de TODOS los registros bajados de la BD
  const [registrosGlobales, setRegistrosGlobales] = useState<RemolqueRecord[]>([]);
  const [busqueda, setBusqueda] = useState('');
  
  // ✅ ESTADOS DE PAGINACIÓN
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Estado para el hover de las filas
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ✅ ESTADOS PARA CONFIGURACIÓN DE COLUMNAS (DRAG & DROP)
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // Suscripción en tiempo real a Firebase
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'remolques'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as RemolqueRecord[];
      // Ordenar alfabéticamente por nombre
      data.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setRegistrosGlobales(data);
    });
    return () => unsubscribe();
  }, []);

  // Si el usuario busca algo, reseteamos a la página 1
  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda]);

  const handleNuevo = () => { 
    setRegistroEditando(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const editarRegistro = (registro: RemolqueRecord) => { 
    setRegistroEditando(registro); 
    setEstadoFormulario('abierto'); 
  };

  const handleEliminar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); 
    if (window.confirm('¿Estás seguro de que deseas eliminar permanentemente este remolque?')) {
      try {
        await eliminarRegistro('remolques', id);
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert('Hubo un error al eliminar. Revisa tu conexión.');
      }
    }
  };

  // ✅ Filtrado GLOBAL por buscador inteligente en memoria
  const registrosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return registrosGlobales;
    const b = busqueda.toLowerCase();
    return registrosGlobales.filter(reg => (
      String(reg.nombre || '').toLowerCase().includes(b) ||
      String(reg.tipoNombre || '').toLowerCase().includes(b) ||
      String(reg.propietarioNombre || '').toLowerCase().includes(b) ||
      String(reg.placas || '').toLowerCase().includes(b) ||
      String(reg.serie || '').toLowerCase().includes(b) ||
      String(reg.marca || '').toLowerCase().includes(b) ||
      String(reg.anio || '').toLowerCase().includes(b) ||
      String(reg.paisNombre || '').toLowerCase().includes(b) ||
      String(reg.estadoNombre || '').toLowerCase().includes(b)
    ));
  }, [busqueda, registrosGlobales]);

  // ✅ LÓGICA DE PAGINACIÓN
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
  const renderCellContent = (r: RemolqueRecord, colId: string) => {
    switch (colId) {
      case 'nombre': return <span style={{ fontWeight: 'bold', color: '#f0f6fc', whiteSpace: 'nowrap' }}>{r.nombre}</span>;
      case 'tipo': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{r.tipoNombre || '-'}</span>;
      case 'propietario': return <span style={{ color: '#c9d1d9', fontWeight: '500', whiteSpace: 'nowrap' }}>{r.propietarioNombre || '-'}</span>;
      case 'placas': return <span className="font-mono" style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{r.placas || '-'}</span>;
      case 'serie': return <span className="font-mono" style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{r.serie || '-'}</span>;
      case 'marca': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{r.marca || '-'}</span>;
      case 'anio': return <span className="font-mono" style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{r.anio || '-'}</span>;
      case 'ubicacion': return <span style={{ color: '#c9d1d9', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{r.paisNombre && r.estadoNombre ? `${r.paisNombre}, ${r.estadoNombre}` : '-'}</span>;
      default: return <span style={{ color: '#c9d1d9' }}>-</span>;
    }
  };

  // ✅ EXPORTAR EXCEL CON LAS COLUMNAS VISIBLES ACTUALMENTE
  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    
    const columnasVisibles = columnasTabla.filter(c => c.visible);

    const datosExcel = registrosFiltrados.map(r => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        let val: any = '-';
        switch (col.id) {
          case 'nombre': val = r.nombre || ''; break;
          case 'tipo': val = r.tipoNombre || ''; break;
          case 'propietario': val = r.propietarioNombre || ''; break;
          case 'placas': val = r.placas || ''; break;
          case 'serie': val = r.serie || ''; break;
          case 'marca': val = r.marca || ''; break;
          case 'anio': val = r.anio || ''; break;
          case 'ubicacion': val = (r.paisNombre && r.estadoNombre) ? `${r.paisNombre}, ${r.estadoNombre}` : ''; break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Remolques');
    XLSX.writeFile(workbook, `Remolques_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioRemolque 
          estado={estadoFormulario} 
          initialData={registroEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setRegistroEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} 
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      {/* ✅ CONTENEDOR MAESTRO */}
     <div style={{ width: '100%', margin: '0 auto' }}>
        
        {/* TÍTULO LIMPIO */}
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          Remolques
        </h1>

        {/* BARRA DE CONTROLES: Responsive y Alineada */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          
          {/* Izquierda: Filtro Estático */}
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '120px' }}>
            <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '10px', borderRadius: '6px' }}>
              <option>Filtro: Todo</option>
            </select>
          </div>

          {/* Centro: Buscador Inteligente */}
          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Buscar por Nombre, Placas, Serie..." 
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
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary" 
              title="Agregar Nuevo Remolque"
              onClick={handleNuevo} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA RESPONSIVE */}
        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            <table className="data-table" style={{ width: '100%', minWidth: '1000px', borderCollapse: 'collapse', textAlign: 'left' }}>
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
                      {busqueda ? 'No se encontraron remolques para tu búsqueda.' : 'Aún no hay remolques registrados.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map(reg => (
                    <tr 
                      key={reg.id} 
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === reg.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(reg.id!)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => editarRegistro(reg)}
                    >
                      {/* CELDA ACCIONES FIJA */}
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn-small btn-edit" 
                            title="Editar Remolque"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(reg); }}
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger" 
                            title="Eliminar Remolque"
                            onClick={(e) => handleEliminar(e, reg.id!)}
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      {columnasTabla.filter(col => col.visible).map(col => (
                        <td key={`cell_${reg.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                          {renderCellContent(reg, col.id)}
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

export default RemolquesDashboard;
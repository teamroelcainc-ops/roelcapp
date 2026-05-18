// src/features/direcciones/components/DireccionesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import type { DireccionRecord } from '../../../types/direccion';
import { FormularioDireccion } from './FormularioDireccion';
import * as XLSX from 'xlsx';

// ✅ TODAS LAS COLUMNAS BASE DE LA TABLA DIRECCIONES
const COLUMNAS_BASE = [
  { id: 'pais', label: 'País', visible: true },
  { id: 'estado', label: 'Estado', visible: true },
  { id: 'municipio', label: 'Municipio', visible: true },
  { id: 'colonia', label: 'Colonia', visible: false },
  { id: 'cp', label: 'Código Postal', visible: false },
  { id: 'calle', label: 'Calle', visible: false },
  { id: 'numExterior', label: '# Ext.', visible: false },
  { id: 'numInterior', label: '# Int.', visible: false },
  { id: 'direccionCompleta', label: 'Dirección Completa', visible: true }
];

export const DireccionesDashboard = () => {
  const [registrosGlobales, setRegistrosGlobales] = useState<DireccionRecord[]>([]);
  
  const [modalEstado, setModalEstado] = useState<'cerrado' | 'abierto' | 'minimizado' | 'detalle'>('cerrado');
  const [registroActual, setRegistroActual] = useState<DireccionRecord | null>(null);

  const [busqueda, setBusqueda] = useState('');
  
  // Estados de paginación
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ✅ ESTADOS PARA CONFIGURACIÓN DE COLUMNAS (DRAG & DROP)
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // CARGA DE DATOS PRINCIPAL (1 Lectura por documento, 0 adicionales gracias a la desnormalización de los Nombres)
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'direcciones'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DireccionRecord));
      // Ordenamos alfabéticamente por País de forma predeterminada
      data.sort((a, b) => (a.paisNombre || '').localeCompare(b.paisNombre || ''));
      setRegistrosGlobales(data);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda]);

  const handleEliminar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('¿Estás seguro de que deseas eliminar esta dirección de forma permanente?')) {
      try {
        await deleteDoc(doc(db, 'direcciones', id));
      } catch (error) {
        alert("Hubo un error al eliminar el registro.");
      }
    }
  };

  const handleNuevoRegistro = () => {
    setRegistroActual(null);
    setModalEstado('abierto');
  };

  const handleEditarRegistro = (reg: DireccionRecord) => {
    setRegistroActual(reg); 
    setModalEstado('abierto');
  };

  const handleAbrirDetalle = (reg: DireccionRecord) => {
    setRegistroActual(reg);
    setModalEstado('detalle');
  };

  // ✅ Filtrado GLOBAL por buscador inteligente
  const registrosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return registrosGlobales;
    const b = busqueda.toLowerCase();
    return registrosGlobales.filter(reg => (
      String(reg.paisNombre || '').toLowerCase().includes(b) ||
      String(reg.estadoNombre || '').toLowerCase().includes(b) ||
      String(reg.municipioNombre || '').toLowerCase().includes(b) ||
      String(reg.cpNombre || '').toLowerCase().includes(b) ||
      String(reg.direccionCompleta || '').toLowerCase().includes(b)
    ));
  }, [busqueda, registrosGlobales]);

  // Cálculos de Paginación
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

  // ✅ RENDERIZADOR DINÁMICO DE CELDAS (Aprovechando la data desnormalizada para 0 lecturas extra)
  const renderCellContent = (reg: DireccionRecord, colId: string) => {
    switch (colId) {
      case 'pais': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{reg.paisNombre || reg.paisId || '-'}</span>;
      case 'estado': return <span style={{ color: '#c9d1d9' }}>{reg.estadoNombre || reg.estadoId || '-'}</span>;
      case 'municipio': return <span style={{ color: '#c9d1d9' }}>{reg.municipioNombre || reg.municipioId || '-'}</span>;
      case 'colonia': return <span style={{ color: '#c9d1d9' }}>{reg.coloniaNombre || reg.coloniaId || '-'}</span>;
      case 'cp': return <span className="font-mono" style={{ color: '#58a6ff', fontWeight: 'bold' }}>{reg.cpNombre || reg.cpId || '-'}</span>;
      case 'calle': return <span style={{ color: '#c9d1d9' }}>{reg.calleNombre || reg.calleId || '-'}</span>;
      case 'numExterior': return <span style={{ color: '#c9d1d9' }}>{reg.numExterior || '-'}</span>;
      case 'numInterior': return <span style={{ color: '#c9d1d9' }}>{reg.numInterior || '-'}</span>;
      case 'direccionCompleta': return <span style={{ color: '#c9d1d9', fontSize: '0.9rem', lineHeight: '1.4' }}>{reg.direccionCompleta || '-'}</span>;
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
          case 'pais': val = reg.paisNombre || reg.paisId || ''; break;
          case 'estado': val = reg.estadoNombre || reg.estadoId || ''; break;
          case 'municipio': val = reg.municipioNombre || reg.municipioId || ''; break;
          case 'colonia': val = reg.coloniaNombre || reg.coloniaId || ''; break;
          case 'cp': val = reg.cpNombre || reg.cpId || ''; break;
          case 'calle': val = reg.calleNombre || reg.calleId || ''; break;
          case 'numExterior': val = reg.numExterior || ''; break;
          case 'numInterior': val = reg.numInterior || ''; break;
          case 'direccionCompleta': val = reg.direccionCompleta || ''; break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Direcciones');
    XLSX.writeFile(workbook, `Directorio_Direcciones_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      {/* CONTENEDOR MAESTRO */}
      <div style={{ width: '100%', margin: '0 auto' }}>
        
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          Directorio de Direcciones
        </h1>

        {/* BARRA DE CONTROLES */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '150px' }}>
            <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', padding: '10px', borderRadius: '6px' }}>
              <option>Filtro: Todo</option>
            </select>
          </div>

          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Buscar por País, Estado, C.P. o Dirección..." 
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

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
              title="Agregar Dirección"
              onClick={handleNuevoRegistro} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 16px', borderRadius: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA DINÁMICA */}
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
                      {busqueda ? 'No se encontraron direcciones para tu búsqueda.' : 'No hay direcciones registradas. Haz clic en el botón de agregar (+) para comenzar.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((reg) => (
                    <tr 
                      key={reg.id} 
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === reg.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(reg.id!)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => handleAbrirDetalle(reg)}
                    >
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn-small btn-edit" 
                            title="Editar Dirección"
                            onClick={(e) => { e.stopPropagation(); handleEditarRegistro(reg); }}
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger" 
                            title="Eliminar Dirección"
                            onClick={(e) => handleEliminar(e, reg.id!)}
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      {columnasTabla.filter(c => c.visible).map(col => (
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

          {/* CONTROLES DE PAGINACIÓN */}
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
            
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', maxHeight: '50vh', overflowY: 'auto' }}>
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

      {/* FORMULARIO DIRECCIÓN */}
      {(modalEstado === 'abierto' || modalEstado === 'minimizado') && (
        <FormularioDireccion 
          estado={modalEstado} 
          initialData={registroActual} 
          onClose={() => setModalEstado('cerrado')} 
          onMinimize={() => setModalEstado('minimizado')} 
          onRestore={() => setModalEstado('abierto')} 
        />
      )}

      {/* MODAL DE DETALLE DE LA DIRECCIÓN */}
      {modalEstado === 'detalle' && registroActual && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div className="form-card" style={{ maxWidth: '600px', width: '100%', borderRadius: '12px', border: '1px solid #444', backgroundColor: '#0d1117', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div className="form-header" style={{ padding: '24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', color: '#f0f6fc', margin: 0, fontWeight: '500' }}>Detalle de la Dirección</h2>
              <button onClick={() => setModalEstado('cerrado')} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div><span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>País</span><div style={{ color: '#f0f6fc', fontSize: '1rem' }}>{registroActual.paisNombre || (registroActual.paisId ? `(ID: ${registroActual.paisId})` : '-')}</div></div>
                <div><span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Estado</span><div style={{ color: '#f0f6fc', fontSize: '1rem' }}>{registroActual.estadoNombre || (registroActual.estadoId ? `(ID: ${registroActual.estadoId})` : '-')}</div></div>
                <div><span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Municipio</span><div style={{ color: '#f0f6fc', fontSize: '1rem' }}>{registroActual.municipioNombre || (registroActual.municipioId ? `(ID: ${registroActual.municipioId})` : '-')}</div></div>
                <div><span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Colonia</span><div style={{ color: '#f0f6fc', fontSize: '1rem' }}>{registroActual.coloniaNombre || (registroActual.coloniaId ? `(ID: ${registroActual.coloniaId})` : '-')}</div></div>
                <div><span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Código Postal</span><div className="font-mono" style={{ color: '#58a6ff', fontSize: '1rem', fontWeight: 'bold' }}>{registroActual.cpNombre || (registroActual.cpId ? `(ID: ${registroActual.cpId})` : '-')}</div></div>
                <div><span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Calle</span><div style={{ color: '#f0f6fc', fontSize: '1rem' }}>{registroActual.calleNombre || (registroActual.calleId ? `(ID: ${registroActual.calleId})` : '-')}</div></div>
                <div><span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}># Exterior</span><div style={{ color: '#f0f6fc', fontSize: '1rem' }}>{registroActual.numExterior || '-'}</div></div>
                <div><span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '4px', fontWeight: 'bold' }}># Interior</span><div style={{ color: '#f0f6fc', fontSize: '1rem' }}>{registroActual.numInterior || '-'}</div></div>
              </div>
              
              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                <span style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Dirección Completa Formateada</span>
                <div style={{ color: '#58a6ff', fontSize: '1.1rem', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  {registroActual.direccionCompleta || '-'}
                </div>
              </div>

              <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setModalEstado('cerrado')} style={{ backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
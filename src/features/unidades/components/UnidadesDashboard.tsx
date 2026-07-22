// src/features/unidades/components/UnidadesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase'; 
import { FormularioUnidad, TIPOS_DOCUMENTO_UNIDAD } from './FormularioUnidad';
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import type { UnidadRecord } from '../../../types/unidad'; 
import * as XLSX from 'xlsx';

// ✅ COLUMNAS BASE DE LA TABLA UNIDADES
const COLUMNAS_BASE = [
  { id: 'unidad', label: 'Unidad', visible: true },
  { id: 'tipo', label: 'Tipo', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'placas', label: 'Placas', visible: true },
  { id: 'serie', label: 'Serie', visible: true },
  { id: 'marca', label: 'Marca', visible: true },
  { id: 'modelo', label: 'Modelo', visible: true },
  { id: 'tanque1', label: 'Tanque 1', visible: true },
  { id: 'tanque2', label: 'Tanque 2', visible: true },
  { id: 'porcentaje', label: '% Recarga', visible: true }
];

export const UnidadesDashboard: React.FC = () => {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [registroEditando, setRegistroEditando] = useState<UnidadRecord | null>(null);
  
  // Lista de TODOS los registros bajados de la BD
  const [registrosGlobales, setRegistrosGlobales] = useState<UnidadRecord[]>([]);
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<string>('Todos');

  // ✅ ESTADOS DE PAGINACIÓN
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ✅ ESTADOS PARA CONFIGURACIÓN DE COLUMNAS (DRAG & DROP)
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // ✅ ESTADOS PARA DOCUMENTOS DE LA UNIDAD
  const [unidadDocumentos, setUnidadDocumentos] = useState<UnidadRecord | null>(null); // unidad cuyos documentos se ven
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false); // modal de subida dentro del visor

  // Suscripción en tiempo real a Firebase
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'unidades'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as UnidadRecord[];
      // Ordenar alfabéticamente por Unidad
      data.sort((a, b) => a.unidad.localeCompare(b.unidad));
      setRegistrosGlobales(data);
    });
    return () => unsubscribe();
  }, []);

  // Si el usuario busca o filtra algo, reseteamos a la página 1
  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, filtroTipo]);

  const handleNuevo = () => { 
    setRegistroEditando(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const editarRegistro = (registro: UnidadRecord) => { 
    setRegistroEditando(registro); 
    setEstadoFormulario('abierto'); 
  };

  const handleEliminar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); 
    if (window.confirm('¿Estás seguro de que deseas eliminar permanentemente esta unidad?')) {
      try {
        await eliminarRegistro('unidades', id);
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert('Hubo un error al eliminar. Revisa tu conexión.');
      }
    }
  };

  // --- LÓGICA DE FILTRADO DINÁMICO ---
  // 1. Extraer los tipos de unidad únicos
  const tiposDisponibles = useMemo(() => {
    const tipos = registrosGlobales.map(reg => reg.tipoUnidadNombre || 'Sin Asignar');
    return Array.from(new Set(tipos)).sort();
  }, [registrosGlobales]);

  // 2. Filtrado por Selector y Buscador Global
  const registrosFiltrados = useMemo(() => {
    let resultado = registrosGlobales;
    
    // Aplicar Filtro Select
    if (filtroTipo !== 'Todos') {
      resultado = resultado.filter(reg => (reg.tipoUnidadNombre || 'Sin Asignar') === filtroTipo);
    }

    // Aplicar Buscador de texto
    if (busqueda.trim() !== '') {
      const b = busqueda.toLowerCase();
      resultado = resultado.filter(reg => 
        (reg.unidad || '').toLowerCase().includes(b) ||
        (reg.tipoUnidadNombre || '').toLowerCase().includes(b) ||
        (reg.placas || '').toLowerCase().includes(b) ||
        (reg.serie || '').toLowerCase().includes(b) ||
        (reg.marca || '').toLowerCase().includes(b) ||
        (reg.modelo || '').toLowerCase().includes(b)
      );
    }

    return resultado;
  }, [registrosGlobales, filtroTipo, busqueda]);

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
  const renderCellContent = (reg: UnidadRecord, colId: string) => {
    switch (colId) {
      case 'unidad': return <span style={{ fontWeight: '500', color: '#f0f6fc', whiteSpace: 'nowrap' }}>{reg.unidad}</span>;
      case 'tipo': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{reg.tipoUnidadNombre || 'Sin Asignar'}</span>;
      case 'status': return reg.activo 
        ? <span style={{ backgroundColor: 'rgba(63, 185, 80, 0.1)', color: '#3fb950', border: '1px solid #3fb950', padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>Activo</span> 
        : <span style={{ backgroundColor: 'rgba(248, 81, 73, 0.1)', color: '#f85149', border: '1px solid #f85149', padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>Inactivo</span>;
      case 'placas': return <span className="font-mono" style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{reg.placas || '-'}</span>;
      case 'serie': return <span className="font-mono" style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{reg.serie || '-'}</span>;
      case 'marca': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{reg.marca || '-'}</span>;
      case 'modelo': return <span style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{reg.modelo || '-'}</span>;
      case 'tanque1': return <span className="font-mono" style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{reg.tanqueUno || 0}</span>;
      case 'tanque2': return <span className="font-mono" style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{reg.tanqueDos || 0}</span>;
      case 'porcentaje': return <span className="font-mono" style={{ color: '#c9d1d9', whiteSpace: 'nowrap' }}>{Number(reg.porcentajeRecarga || 0).toFixed(2)} %</span>;
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
          case 'unidad': val = reg.unidad || ''; break;
          case 'tipo': val = reg.tipoUnidadNombre || 'Sin Asignar'; break;
          case 'status': val = reg.activo ? 'Activo' : 'Inactivo'; break;
          case 'placas': val = reg.placas || ''; break;
          case 'serie': val = reg.serie || ''; break;
          case 'marca': val = reg.marca || ''; break;
          case 'modelo': val = reg.modelo || ''; break;
          case 'tanque1': val = Number(reg.tanqueUno || 0); break;
          case 'tanque2': val = Number(reg.tanqueDos || 0); break;
          case 'porcentaje': val = Number(reg.porcentajeRecarga || 0); break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Unidades Propias');
    XLSX.writeFile(workbook, `Unidades_Propias_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // ✅ nombre legible de la unidad en el visor de documentos
  const nombreUnidadDoc = unidadDocumentos ? (unidadDocumentos.unidad || unidadDocumentos.placas || unidadDocumentos.serie || 'Unidad') : '';

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioUnidad 
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
          Unidades Propias
        </h1>

        {/* BARRA DE CONTROLES: Responsive y Alineada */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          

          {/* Centro: Buscador Inteligente */}
          <div style={{ display: 'flex', gap: '10px', flex: '2 1 auto', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busqueda || filtroTipo !== 'Todos') ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(busqueda || filtroTipo !== 'Todos') && <span style={{ backgroundColor: '#D84315', color: '#fff', borderRadius: '10px', padding: '1px 8px', fontSize: '0.72rem' }}>{[busqueda, filtroTipo !== 'Todos' ? filtroTipo : ''].filter(Boolean).length}</span>}
            </button>
            {filtroTipo !== 'Todos' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'rgba(163,113,247,0.1)', border: '1px solid #a371f7', borderRadius: '14px', color: '#a371f7', fontSize: '0.8rem', fontWeight: 'bold' }}>
                {filtroTipo}
                <button onClick={() => setFiltroTipo('Todos')} style={{ background: 'transparent', border: 'none', color: '#a371f7', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}>✕</button>
              </span>
            )}
            {busqueda && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'rgba(88,166,255,0.1)', border: '1px solid #58a6ff', borderRadius: '14px', color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold' }}>
                "{busqueda}"
                <button onClick={() => setBusqueda('')} style={{ background: 'transparent', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}>✕</button>
              </span>
            )}
            <span style={{ color: '#8b949e', fontSize: '0.82rem' }}>
              {busquedaHecha ? `${registrosFiltrados.length} unidades` : 'Presiona Filtros y Buscar para ver el catálogo.'}
            </span>
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
              title="Agregar Nueva Unidad"
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
            <table className="data-table" style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '150px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
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
                {!busquedaHecha ? (
                  <tr><td colSpan={columnasTabla.length + 1} style={{ padding: '64px 24px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span style={{ color: '#8b949e', fontSize: '0.95rem' }}>Define tus filtros y presiona <b style={{ color: '#D84315' }}>Buscar</b> para ver las unidades.</span>
                      <button onClick={() => setDrawerFiltrosAbierto(true)} style={{ padding: '10px 20px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                      {busqueda || filtroTipo !== 'Todos' ? 'No se encontraron unidades con estos filtros.' : 'Aún no hay unidades registradas.'}
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
                      {/* Celda de Acciones fija a la izquierda */}
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn-small btn-edit" 
                            title="Editar Unidad"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(reg); }}
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>

                          {/* ✅ Ver Documentos de la unidad */}
                          <button 
                            className="btn-small" 
                            title="Ver Documentos"
                            onClick={(e) => { e.stopPropagation(); setUnidadDocumentos(reg); }}
                            style={{ background: 'transparent', border: '1px solid #fb923c', borderRadius: '4px', color: '#fb923c', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                          </button>

                          <button 
                            className="btn-small btn-danger" 
                            title="Eliminar Unidad"
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
          {busquedaHecha && registrosFiltrados.length > 0 && (
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

      {/* ✅ MODAL VISOR DE DOCUMENTOS DE LA UNIDAD */}
      {unidadDocumentos && (
        <div className="modal-overlay" style={{ zIndex: 2100, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)', padding: '20px' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '900px', maxWidth: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.2rem' }}>Documentos — <span style={{ color: '#58a6ff' }}>{nombreUnidadDoc}</span></h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setMostrarSubirDoc(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Subir Documento
                </button>
                <button onClick={() => { setUnidadDocumentos(null); setMostrarSubirDoc(false); }} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.3rem' }}>✕</button>
              </div>
            </div>
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              <DocumentosLista coleccionOrigen="unidades" registroId={unidadDocumentos.id ?? ''} />
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL SUBIR DOCUMENTO (dentro del visor) */}
      <DocumentoUploadModal
        isOpen={mostrarSubirDoc && !!unidadDocumentos}
        onClose={() => setMostrarSubirDoc(false)}
        coleccionOrigen="unidades"
        registroId={unidadDocumentos?.id ?? ''}
        registroNombre={nombreUnidadDoc}
        tiposDocumento={TIPOS_DOCUMENTO_UNIDAD}
      />


      {/* ✅ NUEVO: panel lateral DERECHO de filtros (Unidades) */}
      {drawerFiltrosAbierto && (
        <div onClick={() => setDrawerFiltrosAbierto(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1400, backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '360px', maxWidth: '92%', backgroundColor: '#0d1117', borderLeft: '1px solid #30363d', boxShadow: '-8px 0 28px rgba(0,0,0,0.5)', padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', zIndex: 1401, animation: 'fadeIn 0.15s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.05rem' }}>Filtros · Unidades</h3>
              <button onClick={() => setDrawerFiltrosAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#58a6ff', fontSize: '0.8rem', fontWeight: 'bold' }}>BÚSQUEDA</label>
              <div style={{ position: 'relative' }}>
                <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#58a6ff' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="text" placeholder="Unidad, placas, serie, modelo..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px 9px 32px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                {busqueda && (
                  <button onClick={() => setBusqueda('')} title="Limpiar" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '0.95rem' }}>✕</button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ color: '#a371f7', fontSize: '0.8rem', fontWeight: 'bold' }}>TIPO DE UNIDAD</label>
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
                style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: `1px solid ${filtroTipo !== 'Todos' ? '#a371f7' : '#30363d'}`, borderRadius: '6px', color: filtroTipo !== 'Todos' ? '#a371f7' : '#c9d1d9', cursor: 'pointer', fontWeight: filtroTipo !== 'Todos' ? 'bold' : 'normal', boxSizing: 'border-box' }}>
                <option value="Todos">Todos</option>
                {tiposDisponibles.map(tipo => (
                  <option key={tipo} value={tipo}>{tipo}</option>
                ))}
              </select>
            </div>

            <div style={{ color: '#6e7681', fontSize: '0.75rem' }}>
              Todos los campos son <b style={{ color: '#8b949e' }}>opcionales</b>. Presiona <b style={{ color: '#D84315' }}>Buscar</b> para ver todo el catálogo.
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', gap: '10px', borderTop: '1px solid #30363d', paddingTop: '14px' }}>
              <button onClick={() => { setBusqueda(''); setFiltroTipo('Todos'); setBusquedaHecha(false); }} style={{ flex: 1, padding: '10px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Limpiar</button>
              <button onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }} style={{ flex: 1, padding: '10px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>🔍 Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnidadesDashboard;
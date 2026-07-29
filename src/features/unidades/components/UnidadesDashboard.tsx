// src/features/unidades/components/UnidadesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase'; 
import { FormularioUnidad, TIPOS_DOCUMENTO_UNIDAD } from './FormularioUnidad';
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import type { UnidadRecord } from '../../../types/unidad'; 
import * as XLSX from 'xlsx';
import './UnidadesDashboard.css';

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
      case 'unidad': return <span className="ud-x1">{reg.unidad}</span>;
      case 'tipo': return <span className="ud-x2">{reg.tipoUnidadNombre || 'Sin Asignar'}</span>;
      case 'status': return reg.activo 
        ? <span className="ud-x3">Activo</span> 
        : <span className="ud-x4">Inactivo</span>;
      case 'placas': return <span className="font-mono ud-x2">{reg.placas || '-'}</span>;
      case 'serie': return <span className="font-mono ud-x2">{reg.serie || '-'}</span>;
      case 'marca': return <span className="ud-x2">{reg.marca || '-'}</span>;
      case 'modelo': return <span className="ud-x2">{reg.modelo || '-'}</span>;
      case 'tanque1': return <span className="font-mono ud-x2">{reg.tanqueUno || 0}</span>;
      case 'tanque2': return <span className="font-mono ud-x2">{reg.tanqueDos || 0}</span>;
      case 'porcentaje': return <span className="font-mono ud-x2">{Number(reg.porcentajeRecarga || 0).toFixed(2)} %</span>;
      default: return <span className="ud-x5">-</span>;
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
    <div className="module-container ud-x6">
      
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
     <div className="ud-x7">
        
        {/* TÍTULO LIMPIO */}
        <h1 className="module-title ud-x8">
          Unidades Propias
        </h1>

        {/* BARRA DE CONTROLES: Responsive y Alineada */}
        <div className="ud-x9">
          

          {/* Centro: Buscador Inteligente */}
          <div className="ud-x10">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busqueda || filtroTipo !== 'Todos') ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(busqueda || filtroTipo !== 'Todos') && <span className="ud-x11">{[busqueda, filtroTipo !== 'Todos' ? filtroTipo : ''].filter(Boolean).length}</span>}
            </button>
            {filtroTipo !== 'Todos' && (
              <span className="ud-x12">
                {filtroTipo}
                <button className="ud-x13" onClick={() => setFiltroTipo('Todos')}>✕</button>
              </span>
            )}
            {busqueda && (
              <span className="ud-x14">
                "{busqueda}"
                <button className="ud-x15" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="ud-x16">
              {busquedaHecha ? `${registrosFiltrados.length} unidades` : 'Presiona Filtros y Buscar para ver el catálogo.'}
            </span>
          </div>

          {/* Derecha: Botones Iconográficos */}
          <div className="ud-x17">
            <button 
              className="btn btn-outline ud-x18" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-outline ud-x18" 
              title="Exportar a Excel"
              onClick={exportarExcel}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary ud-x19" 
              title="Agregar Nueva Unidad"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA RESPONSIVE */}
        <div className="content-body ud-x20">
          <div className="table-container ud-x21">
            <table className="data-table ud-x22">
              <thead className="ud-x23">
                <tr>
                  <th className="ud-x24">
                    Acciones
                  </th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th className="ud-x25" key={`th_${col.id}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="ud-x26" colSpan={columnasTabla.length + 1}>
                    <div className="ud-x27">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="ud-x28">Define tus filtros y presiona <b className="ud-x29">Buscar</b> para ver las unidades.</span>
                      <button className="ud-x30" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="ud-x31" colSpan={columnasTabla.length + 1}>
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
                      <td className="ud-x32" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell ud-x33">
                          <button 
                            className="btn-small btn-edit ud-x34" 
                            title="Editar Unidad"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(reg); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>

                          {/* ✅ Ver Documentos de la unidad */}
                          <button 
                            className="btn-small ud-x35" 
                            title="Ver Documentos"
                            onClick={(e) => { e.stopPropagation(); setUnidadDocumentos(reg); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                          </button>

                          <button 
                            className="btn-small btn-danger ud-x36" 
                            title="Eliminar Unidad"
                            onClick={(e) => handleEliminar(e, reg.id!)}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      {columnasTabla.filter(col => col.visible).map(col => (
                        <td className="ud-x37" key={`cell_${reg.id}_${col.id}`}>
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
            <div className="ud-x38">
              <div className="ud-x39">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="ud-x40">
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="ud-x41">{paginaActual} / {totalPaginas || 1}</span>
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
        <div className="modal-overlay ud-x42">
          <div className="ud-x43">
            <div className="ud-x44">
              <h3 className="ud-x45">Configurar Columnas de la Tabla</h3>
              <button className="ud-x46" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="ud-x47">Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul className="ud-x48">
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
                  <input className="ud-x49" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="ud-x50">
              <button className="ud-x51" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL VISOR DE DOCUMENTOS DE LA UNIDAD */}
      {unidadDocumentos && (
        <div className="modal-overlay ud-x52">
          <div className="ud-x53">
            <div className="ud-x54">
              <h3 className="ud-x55">Documentos — <span className="ud-x56">{nombreUnidadDoc}</span></h3>
              <div className="ud-x57">
                <button className="ud-x58"
                  type="button"
                  onClick={() => setMostrarSubirDoc(true)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Subir Documento
                </button>
                <button className="ud-x59" onClick={() => { setUnidadDocumentos(null); setMostrarSubirDoc(false); }}>✕</button>
              </div>
            </div>
            <div className="ud-x60">
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
        <div className="ud-x61" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="ud-x62" onClick={(e) => e.stopPropagation()}>
            <div className="ud-x63">
              <h3 className="ud-x64">Filtros · Unidades</h3>
              <button className="ud-x46" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="ud-x65">
              <label className="ud-x66">BÚSQUEDA</label>
              <div className="ud-x67">
                <svg className="ud-x68" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="ud-x69" type="text" placeholder="Unidad, placas, serie, modelo..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="ud-x70" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="ud-x65">
              <label className="ud-x71">TIPO DE UNIDAD</label>
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
                style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: `1px solid ${filtroTipo !== 'Todos' ? '#a371f7' : '#30363d'}`, borderRadius: '6px', color: filtroTipo !== 'Todos' ? '#a371f7' : '#c9d1d9', cursor: 'pointer', fontWeight: filtroTipo !== 'Todos' ? 'bold' : 'normal', boxSizing: 'border-box' }}>
                <option value="Todos">Todos</option>
                {tiposDisponibles.map(tipo => (
                  <option key={tipo} value={tipo}>{tipo}</option>
                ))}
              </select>
            </div>

            <div className="ud-x72">
              Todos los campos son <b className="ud-x73">opcionales</b>. Presiona <b className="ud-x29">Buscar</b> para ver todo el catálogo.
            </div>

            <div className="ud-x74">
              <button className="ud-x75" onClick={() => { setBusqueda(''); setFiltroTipo('Todos'); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="ud-x76" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>🔍 Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnidadesDashboard;
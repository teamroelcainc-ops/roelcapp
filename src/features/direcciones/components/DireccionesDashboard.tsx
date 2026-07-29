// src/features/direcciones/components/DireccionesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import type { DireccionRecord } from '../../../types/direccion';
import { FormularioDireccion } from './FormularioDireccion';
import * as XLSX from 'xlsx';
import './DireccionesDashboard.css';

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
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  
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
      case 'pais': return <span className="dd-x1">{reg.paisNombre || reg.paisId || '-'}</span>;
      case 'estado': return <span className="dd-x2">{reg.estadoNombre || reg.estadoId || '-'}</span>;
      case 'municipio': return <span className="dd-x2">{reg.municipioNombre || reg.municipioId || '-'}</span>;
      case 'colonia': return <span className="dd-x2">{reg.coloniaNombre || reg.coloniaId || '-'}</span>;
      case 'cp': return <span className="font-mono dd-x3">{reg.cpNombre || reg.cpId || '-'}</span>;
      case 'calle': return <span className="dd-x2">{reg.calleNombre || reg.calleId || '-'}</span>;
      case 'numExterior': return <span className="dd-x2">{reg.numExterior || '-'}</span>;
      case 'numInterior': return <span className="dd-x2">{reg.numInterior || '-'}</span>;
      case 'direccionCompleta': return <span className="dd-x4">{reg.direccionCompleta || '-'}</span>;
      default: return <span className="dd-x2">-</span>;
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
    <div className="module-container dd-x5">
      
      {/* CONTENEDOR MAESTRO */}
      <div className="dd-x6">
        
        <h1 className="module-title dd-x7">
          Directorio de Direcciones
        </h1>

        {/* BARRA DE CONTROLES */}
        <div className="dd-x8">
          
          <div className="dd-x9">
            <select className="form-control dd-x10">
              <option>Filtro: Todo</option>
            </select>
          </div>

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
              {busquedaHecha ? `${registrosFiltrados.length} direcciones` : 'Presiona Filtros y Buscar para ver el catálogo.'}
            </span>
          </div>

          <div className="dd-x16">
            <button 
              className="btn btn-outline dd-x17" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-outline dd-x17" 
              title="Exportar a Excel"
              onClick={exportarExcel}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary dd-x18" 
              title="Agregar Dirección"
              onClick={handleNuevoRegistro}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA DINÁMICA */}
        <div className="content-body dd-x19">
          <div className="table-container dd-x20">
            <table className="data-table dd-x21">
              <thead className="dd-x22">
                <tr>
                  <th className="dd-x23">
                    Acciones
                  </th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th className="dd-x24" key={`th_${col.id}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="dd-x25" colSpan={columnasTabla.length + 1}>
                    <div className="dd-x26">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="dd-x27">Define tus filtros y presiona <b className="dd-x28">Buscar</b> para ver las direcciones.</span>
                      <button className="dd-x29" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="dd-x30" colSpan={columnasTabla.length + 1}>
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
                      <td className="dd-x31" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell dd-x32">
                          <button 
                            className="btn-small btn-edit dd-x33" 
                            title="Editar Dirección"
                            onClick={(e) => { e.stopPropagation(); handleEditarRegistro(reg); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger dd-x34" 
                            title="Eliminar Dirección"
                            onClick={(e) => handleEliminar(e, reg.id!)}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      {columnasTabla.filter(c => c.visible).map(col => (
                        <td className="dd-x35" key={`cell_${reg.id}_${col.id}`}>
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
          {busquedaHecha && registrosFiltrados.length > 0 && (
            <div className="dd-x36">
              <div className="dd-x37">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="dd-x38">
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="dd-x39">{paginaActual} / {totalPaginas || 1}</span>
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

      {/* MODAL CONFIGURACIÓN COLUMNAS INTERACTIVAS (DRAG & DROP) */}
      {modalColumnas && (
        <div className="modal-overlay dd-x40">
          <div className="dd-x41">
            <div className="dd-x42">
              <h3 className="dd-x43">Configurar Columnas de la Tabla</h3>
              <button className="dd-x44" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="dd-x45">Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul className="dd-x46">
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
                  <input className="dd-x47" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="dd-x48">
              <button className="dd-x49" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
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
        <div className="modal-overlay dd-x50">
          <div className="form-card dd-x51">
            <div className="form-header dd-x52">
              <h2 className="dd-x53">Detalle de la Dirección</h2>
              <button className="dd-x54" onClick={() => setModalEstado('cerrado')}>✕</button>
            </div>
            
            <div className="dd-x55">
              <div className="dd-x56">
                <div><span className="dd-x57">País</span><div className="dd-x58">{registroActual.paisNombre || (registroActual.paisId ? `(ID: ${registroActual.paisId})` : '-')}</div></div>
                <div><span className="dd-x57">Estado</span><div className="dd-x58">{registroActual.estadoNombre || (registroActual.estadoId ? `(ID: ${registroActual.estadoId})` : '-')}</div></div>
                <div><span className="dd-x57">Municipio</span><div className="dd-x58">{registroActual.municipioNombre || (registroActual.municipioId ? `(ID: ${registroActual.municipioId})` : '-')}</div></div>
                <div><span className="dd-x57">Colonia</span><div className="dd-x58">{registroActual.coloniaNombre || (registroActual.coloniaId ? `(ID: ${registroActual.coloniaId})` : '-')}</div></div>
                <div><span className="dd-x57">Código Postal</span><div className="font-mono dd-x59">{registroActual.cpNombre || (registroActual.cpId ? `(ID: ${registroActual.cpId})` : '-')}</div></div>
                <div><span className="dd-x57">Calle</span><div className="dd-x58">{registroActual.calleNombre || (registroActual.calleId ? `(ID: ${registroActual.calleId})` : '-')}</div></div>
                <div><span className="dd-x57"># Exterior</span><div className="dd-x58">{registroActual.numExterior || '-'}</div></div>
                <div><span className="dd-x57"># Interior</span><div className="dd-x58">{registroActual.numInterior || '-'}</div></div>
              </div>
              
              <div className="dd-x60">
                <span className="dd-x61">Dirección Completa Formateada</span>
                <div className="dd-x62">
                  {registroActual.direccionCompleta || '-'}
                </div>
              </div>

              <div className="dd-x63">
                <button className="dd-x64" type="button" onClick={() => setModalEstado('cerrado')}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NUEVO: panel lateral DERECHO de filtros (Direcciones) */}
      {drawerFiltrosAbierto && (
        <div className="dd-x65" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="dd-x66" onClick={(e) => e.stopPropagation()}>
            <div className="dd-x67">
              <h3 className="dd-x68">Filtros · Direcciones</h3>
              <button className="dd-x44" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="dd-x69">
              <label className="dd-x70">BÚSQUEDA</label>
              <div className="dd-x71">
                <svg className="dd-x72" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="dd-x73" type="text" placeholder="País, estado, C.P. o dirección..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="dd-x74" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="dd-x75">
              Todos los campos son <b className="dd-x76">opcionales</b>. Presiona <b className="dd-x28">Buscar</b> para ver todo el catálogo.
            </div>

            <div className="dd-x77">
              <button className="dd-x78" onClick={() => { setBusqueda(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="dd-x79" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
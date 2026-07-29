// src/features/unidadesProveedor/components/UnidadesProveedorDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase'; 
import { FormularioUnidadProveedor } from './FormularioUnidadProveedor';
import type { UnidadProveedorRecord } from '../../../types/unidadProveedor';
import * as XLSX from 'xlsx';
import './UnidadesProveedorDashboard.css';

// ✅ COLUMNAS BASE DE LA TABLA UNIDADES DE PROVEEDOR
const COLUMNAS_BASE = [
  { id: 'proveedor', label: 'Proveedor', visible: true },
  { id: 'unidad', label: '# De Unidad', visible: true },
  { id: 'serie', label: 'Serie', visible: true },
  { id: 'placas', label: 'Placas', visible: true },
  { id: 'pais', label: 'País', visible: true },
  { id: 'estado', label: 'Estado', visible: true }
];

export const UnidadesProveedorDashboard: React.FC = () => {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [registroEditando, setRegistroEditando] = useState<UnidadProveedorRecord | null>(null);
  
  // Lista de TODOS los registros bajados de la BD
  const [registrosGlobales, setRegistrosGlobales] = useState<UnidadProveedorRecord[]>([]);
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  
  // ✅ ESTADOS DE PAGINACIÓN
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ✅ ESTADOS PARA CONFIGURACIÓN DE COLUMNAS (DRAG & DROP)
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // Suscripción en tiempo real a Firebase
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'unidades_proveedor'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as UnidadProveedorRecord[];
      // Ordenar alfabéticamente por Proveedor
      data.sort((a, b) => (a.proveedorNombre || '').localeCompare(b.proveedorNombre || ''));
      setRegistrosGlobales(data);
    });
    return () => unsubscribe();
  }, []);

  // Si el usuario busca algo, reseteamos a la página 1 para que no se pierda el resultado
  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda]);

  const handleNuevo = () => { 
    setRegistroEditando(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const editarRegistro = (registro: UnidadProveedorRecord) => { 
    setRegistroEditando(registro); 
    setEstadoFormulario('abierto'); 
  };

  const handleEliminar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); 
    if (window.confirm('¿Estás seguro de que deseas eliminar permanentemente esta unidad?')) {
      try {
        await eliminarRegistro('unidades_proveedor', id);
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert('Hubo un error al eliminar. Revisa tu conexión.');
      }
    }
  };

  // ✅ Filtrado GLOBAL por buscador inteligente (A prueba de números en memoria)
  const registrosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return registrosGlobales;
    const b = busqueda.toLowerCase();
    return registrosGlobales.filter(r => (
      String(r.proveedorNombre || '').toLowerCase().includes(b) ||
      String(r.numeroUnidad || '').toLowerCase().includes(b) ||
      String(r.numeroSerie || '').toLowerCase().includes(b) ||
      String(r.placas || '').toLowerCase().includes(b) ||
      String(r.pais || '').toLowerCase().includes(b) ||
      String(r.estadoUbicacion || '').toLowerCase().includes(b)
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
  const renderCellContent = (reg: UnidadProveedorRecord, colId: string) => {
    switch (colId) {
      case 'proveedor': return <span className="upd-x1">{reg.proveedorNombre || '-'}</span>;
      case 'unidad': return <span className="font-mono upd-x2">{reg.numeroUnidad || '-'}</span>;
      case 'serie': return <span className="font-mono upd-x2">{reg.numeroSerie || '-'}</span>;
      case 'placas': return <span className="font-mono upd-x2">{reg.placas || '-'}</span>;
      case 'pais': return <span className="upd-x2">{reg.pais || '-'}</span>;
      case 'estado': return <span className="upd-x2">{reg.estadoUbicacion || '-'}</span>;
      default: return <span className="upd-x3">-</span>;
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
          case 'proveedor': val = r.proveedorNombre || ''; break;
          case 'unidad': val = r.numeroUnidad || ''; break;
          case 'serie': val = r.numeroSerie || ''; break;
          case 'placas': val = r.placas || ''; break;
          case 'pais': val = r.pais || ''; break;
          case 'estado': val = r.estadoUbicacion || ''; break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Unidades Proveedor');
    XLSX.writeFile(workbook, `Unidades_Proveedor_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container upd-x4">
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioUnidadProveedor 
          estado={estadoFormulario} 
          initialData={registroEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setRegistroEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} 
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      {/* ✅ CONTENEDOR MAESTRO */}
      <div className="upd-x5">
        
        {/* TÍTULO LIMPIO */}
        <h1 className="module-title upd-x6">
          Unidades del Proveedor
        </h1>

        {/* BARRA DE CONTROLES: Responsive y Alineada */}
        <div className="upd-x7">
          
          {/* Izquierda: Filtro Estático */}
          <div className="upd-x8">
            <select className="form-control upd-x9">
              <option>Filtro: Todo</option>
            </select>
          </div>

          {/* Centro: Buscador Inteligente */}
          <div className="upd-x10">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${busqueda ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {busqueda && <span className="upd-x11">1</span>}
            </button>
            {busqueda && (
              <span className="upd-x12">
                "{busqueda}"
                <button className="upd-x13" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="upd-x14">
              {busquedaHecha ? `${registrosFiltrados.length} registros` : 'Presiona Filtros y Buscar para ver el catálogo.'}
            </span>
          </div>

          {/* Derecha: Botones Iconográficos */}
          <div className="upd-x15">
            <button 
              className="btn btn-outline upd-x16" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-outline upd-x16" 
              title="Exportar a Excel"
              onClick={exportarExcel}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary upd-x17" 
              title="Agregar Nueva Unidad Externa"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA RESPONSIVE */}
        <div className="content-body upd-x18">
          <div className="table-container upd-x19">
            <table className="data-table upd-x20">
              <thead className="upd-x21">
                <tr>
                  <th className="upd-x22">
                    Acciones
                  </th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th className="upd-x23" key={`th_${col.id}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="upd-x24" colSpan={columnasTabla.length + 1}>
                    <div className="upd-x25">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="upd-x26">Define tus filtros y presiona <b className="upd-x27">Buscar</b> para ver las unidades de proveedor.</span>
                      <button className="upd-x28" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="upd-x29" colSpan={columnasTabla.length + 1}>
                      {busqueda ? 'No se encontraron registros que coincidan con tu búsqueda.' : 'Aún no hay registros. Haz clic en "+" para crear el primero.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((reg) => (
                    <tr 
                      key={reg.id} 
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === reg.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(reg.id!)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => editarRegistro(reg)}
                    >
                      {/* CELDA ACCIONES FIJA Y SÓLIDA CON ICONOS */}
                      <td className="upd-x30" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell upd-x31">
                          <button 
                            className="btn-small btn-edit upd-x32" 
                            title="Editar Unidad"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(reg); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger upd-x33" 
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
                        <td className="upd-x34" key={`cell_${reg.id}_${col.id}`}>
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
            <div className="upd-x35">
              <div className="upd-x36">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="upd-x37">
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="upd-x38">{paginaActual} / {totalPaginas || 1}</span>
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
        <div className="modal-overlay upd-x39">
          <div className="upd-x40">
            <div className="upd-x41">
              <h3 className="upd-x42">Configurar Columnas de la Tabla</h3>
              <button className="upd-x43" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="upd-x44">Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul className="upd-x45">
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
                  <input className="upd-x46" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="upd-x47">
              <button className="upd-x48" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}


      {/* ✅ NUEVO: panel lateral DERECHO de filtros (Unidades de Proveedor) */}
      {drawerFiltrosAbierto && (
        <div className="upd-x49" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="upd-x50" onClick={(e) => e.stopPropagation()}>
            <div className="upd-x51">
              <h3 className="upd-x52">Filtros · Unidades de Proveedor</h3>
              <button className="upd-x43" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="upd-x53">
              <label className="upd-x54">BÚSQUEDA</label>
              <div className="upd-x55">
                <svg className="upd-x56" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="upd-x57" type="text" placeholder="Proveedor, unidad, placas, serie..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="upd-x58" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="upd-x59">
              Todos los campos son <b className="upd-x60">opcionales</b>. Presiona <b className="upd-x27">Buscar</b> para ver todo el catálogo.
            </div>

            <div className="upd-x61">
              <button className="upd-x62" onClick={() => { setBusqueda(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="upd-x63" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>🔍 Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnidadesProveedorDashboard;
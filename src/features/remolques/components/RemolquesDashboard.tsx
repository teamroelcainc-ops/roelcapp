// src/features/remolques/components/RemolquesDashboard.tsx
import { useState, useEffect, useMemo } from 'react';
import type React from 'react';
import { FormularioRemolque } from './FormularioRemolque';
import { useRemolques } from '../hooks/useRemolques';
import type { RemolqueRecord } from '../../../types/remolque'; 
import * as XLSX from 'xlsx';
import './RemolquesDashboard.css';

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

export function RemolquesDashboard() {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [registroEditando, setRegistroEditando] = useState<RemolqueRecord | null>(null);
  
  // ✅ Datos de servidor vía TanStack Query (caché compartido + tiempo real).
  const { remolques: registrosGlobales, eliminarRemolque } = useRemolques();
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  
  // ✅ ESTADOS DE PAGINACIÓN
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // ✅ ESTADOS PARA CONFIGURACIÓN DE COLUMNAS (DRAG & DROP)
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

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
        await eliminarRemolque(id);
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
      case 'nombre': return <span className="rd-x1">{r.nombre}</span>;
      case 'tipo': return <span className="rd-x2">{r.tipoNombre || '-'}</span>;
      case 'propietario': return <span className="rd-x3">{r.propietarioNombre || '-'}</span>;
      case 'placas': return <span className="font-mono rd-x2">{r.placas || '-'}</span>;
      case 'serie': return <span className="font-mono rd-x2">{r.serie || '-'}</span>;
      case 'marca': return <span className="rd-x2">{r.marca || '-'}</span>;
      case 'anio': return <span className="font-mono rd-x2">{r.anio || '-'}</span>;
      case 'ubicacion': return <span className="rd-x4">{r.paisNombre && r.estadoNombre ? `${r.paisNombre}, ${r.estadoNombre}` : '-'}</span>;
      default: return <span className="rd-x5">-</span>;
    }
  };

  // ✅ EXPORTAR EXCEL CON LAS COLUMNAS VISIBLES ACTUALMENTE
  const exportarExcel = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    
    const columnasVisibles = columnasTabla.filter(c => c.visible);

    const datosExcel = registrosFiltrados.map(r => {
      const fila: Record<string, string | number> = {};
      columnasVisibles.forEach(col => {
        let val: string | number = '-';
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
    <div className="module-container rd-x6">
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioRemolque 
          estado={estadoFormulario} 
          initialData={registroEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setRegistroEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} 
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      {/* CONTENEDOR MAESTRO */}
     <div className="rd-x7">
        
        {/* TÍTULO LIMPIO */}
        <h1 className="module-title rd-x8">
          Remolques
        </h1>

        {/* BARRA DE CONTROLES: Responsive y Alineada */}
        <div className="rd-x9">
          
          {/* Izquierda: Filtro Estático */}
          <div className="rd-x10">
            <select className="form-control rd-x11">
              <option>Filtro: Todo</option>
            </select>
          </div>

          {/* Centro: Buscador Inteligente */}
          <div className="rd-x12">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${busqueda ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {busqueda && <span className="rd-x13">1</span>}
            </button>
            {busqueda && (
              <span className="rd-x14">
                "{busqueda}"
                <button className="rd-x15" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="rd-x16">
              {busquedaHecha ? `${registrosFiltrados.length} remolques` : 'Presiona Filtros y Buscar para ver el catálogo.'}
            </span>
          </div>

          {/* Derecha: Botones Iconográficos */}
          <div className="rd-x17">
            <button 
              className="btn btn-outline rd-x18" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-outline rd-x19" 
              title="Exportar a Excel"
              onClick={exportarExcel}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary rd-x20" 
              title="Agregar Nuevo Remolque"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA RESPONSIVE */}
        <div className="content-body rd-x21">
          <div className="table-container rd-x22">
            <table className="data-table rd-x23">
              <thead className="rd-x24">
                <tr>
                  <th className="rd-x25">
                    Acciones
                  </th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th className="rd-x26" key={`th_${col.id}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="rd-x27" colSpan={columnasTabla.length + 1}>
                    <div className="rd-x28">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="rd-x29">Define tus filtros y presiona <b className="rd-x30">Buscar</b> para ver los remolques.</span>
                      <button className="rd-x31" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="rd-x32" colSpan={columnasTabla.length + 1}>
                      {busqueda ? 'No se encontraron remolques para tu búsqueda.' : 'Aún no hay remolques registrados.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map(reg => (
                    <tr
                      key={reg.id}
                      className="rd-fila"
                      onClick={() => editarRegistro(reg)}
                    >
                      {/* CELDA ACCIONES FIJA */}
                      <td className="rd-x33" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <div className="actions-cell rd-x34">
                          <button 
                            className="btn-small btn-edit rd-x35" 
                            title="Editar Remolque"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(reg); }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger rd-x36" 
                            title="Eliminar Remolque"
                            onClick={(e) => handleEliminar(e, reg.id!)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      {columnasTabla.filter(col => col.visible).map(col => (
                        <td className="rd-x37" key={`cell_${reg.id}_${col.id}`}>
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
            <div className="rd-x38">
              <div className="rd-x39">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="rd-x40">
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="rd-x41">{paginaActual} / {totalPaginas || 1}</span>
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
        <div className="modal-overlay rd-x42">
          <div className="rd-x43">
            <div className="rd-x44">
              <h3 className="rd-x45">Configurar Columnas de la Tabla</h3>
              <button className="rd-x46" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="rd-x47">Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul className="rd-x48">
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
                  <input className="rd-x49" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="rd-x50">
              <button className="rd-x51" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}


      {/* NUEVO: panel lateral DERECHO de filtros (Remolques) */}
      {drawerFiltrosAbierto && (
        <div className="rd-x52" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="rd-x53" onClick={(e) => e.stopPropagation()}>
            <div className="rd-x54">
              <h3 className="rd-x55">Filtros · Remolques</h3>
              <button className="rd-x46" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="rd-x56">
              <label className="rd-x57">BÚSQUEDA</label>
              <div className="rd-x58">
                <svg className="rd-x59" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="rd-x60" type="text" placeholder="Nombre, placas, serie..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="rd-x61" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="rd-x62">
              Todos los campos son <b className="rd-x63">opcionales</b>. Presiona <b className="rd-x30">Buscar</b> para ver todo el catálogo.
            </div>

            <div className="rd-x64">
              <button className="rd-x65" onClick={() => { setBusqueda(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="rd-x66" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RemolquesDashboard;
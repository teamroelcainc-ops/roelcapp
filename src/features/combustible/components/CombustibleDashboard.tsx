// src/features/combustible/components/CombustibleDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import type { CombustibleRecord } from '../../../types/combustible';
import { getCombustibles } from '../services/combustibleService';
import { FormularioCombustible } from './FormularioCombustible';
import { eliminarRegistro } from '../../../config/firebase'; 
import * as XLSX from 'xlsx';
import './CombustibleDashboard.css';

// ✅ TODAS LAS COLUMNAS BASE DE LA TABLA COMBUSTIBLE
const COLUMNAS_BASE = [
  { id: 'fecha', label: 'Fecha', visible: true },
  { id: 'proveedor', label: 'Proveedor', visible: true },
  { id: 'tipoCombustible', label: 'Tipo', visible: true },
  { id: 'tipoMedida', label: 'Medida', visible: true },
  { id: 'monedaNombre', label: 'Moneda', visible: true },
  { id: 'costo', label: 'Costo', visible: true },
  { id: 'tipoCambio', label: 'T.C.', visible: true },
  { id: 'totalPesos', label: 'Total MXN', visible: true }
];

export const CombustibleDashboard: React.FC = () => {
  const [registrosGlobales, setRegistrosGlobales] = useState<CombustibleRecord[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [registroEditando, setRegistroEditando] = useState<CombustibleRecord | null>(null);
  
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  // ✅ NUEVO: rango de fechas del costo de combustible (opcional).
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  
  // ✅ ESTADOS DE PAGINACIÓN
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Estado para el hover de las filas
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ✅ ESTADOS PARA CONFIGURACIÓN DE COLUMNAS (DRAG & DROP)
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  const cargarDatos = async () => {
    const data = await getCombustibles();
    // Ordenamos por fecha más reciente primero por defecto
    data.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    setRegistrosGlobales(data);
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  // Si el usuario busca algo, reseteamos a la página 1
  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda]);

  // Formatear la fecha estrictamente en español
  const formatearFechaEsp = (fechaString: string) => {
    if (!fechaString) return '-';
    try {
      const fechaObj = new Date(fechaString + 'T00:00:00'); // Evita desfase horario
      return fechaObj.toLocaleDateString('es-ES', { 
        year: 'numeric', month: 'long', day: 'numeric' 
      });
    } catch (e) {
      return fechaString;
    }
  };

  // Manejadores de los botones de acción
  const handleNuevo = () => {
    setRegistroEditando(null);
    setModalAbierto(true);
  };

  const handleEditar = (registro: CombustibleRecord) => {
    setRegistroEditando(registro);
    setModalAbierto(true);
  };

  const handleEliminar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!id) return alert("Este registro no tiene ID.");
    if (window.confirm('¿Estás seguro de que deseas eliminar permanentemente este registro de combustible?')) {
      try {
        await eliminarRegistro('combustibles', id);
        cargarDatos();
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert('Hubo un error al eliminar. Revisa tu conexión.');
      }
    }
  };

  // Filtrado GLOBAL por buscador inteligente
  const registrosFiltrados = useMemo(() => {
    // ✅ Rango de fechas primero (la fecha se guarda en ISO YYYY-MM-DD).
    let base = registrosGlobales;
    if (fechaDesde || fechaHasta) {
      base = base.filter(reg => {
        const f = String(reg.fecha || '').slice(0, 10);
        if (!f) return false;
        if (fechaDesde && f < fechaDesde) return false;
        if (fechaHasta && f > fechaHasta) return false;
        return true;
      });
    }
    if (!busqueda.trim()) return base;
    const b = busqueda.toLowerCase();
    return base.filter(reg => (
      String(formatearFechaEsp(reg.fecha)).toLowerCase().includes(b) ||
      String(reg.proveedor || '').toLowerCase().includes(b) ||
      String(reg.tipoCombustible || '').toLowerCase().includes(b) ||
      String(reg.tipoMedida || '').toLowerCase().includes(b) ||
      String(reg.monedaNombre || '').toLowerCase().includes(b) ||
      String(reg.costo || '').toLowerCase().includes(b) ||
      String(reg.totalPesos || '').toLowerCase().includes(b)
    ));
  }, [busqueda, registrosGlobales, fechaDesde, fechaHasta]);

  // LÓGICA DE PAGINACIÓN
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
  const renderCellContent = (r: CombustibleRecord, colId: string) => {
    switch (colId) {
      case 'fecha': return <span className="cd-x1">{formatearFechaEsp(r.fecha)}</span>;
      case 'proveedor': return <span className="cd-x2">{r.proveedor}</span>;
      case 'tipoCombustible': return <span className="cd-x2">{r.tipoCombustible}</span>;
      case 'tipoMedida': return <span className="cd-x2">{r.tipoMedida}</span>;
      case 'monedaNombre': return <span className="cd-x2">{r.monedaNombre}</span>;
      case 'costo': return <span className="font-mono cd-x3">${r.costo.toFixed(2)}</span>;
      case 'tipoCambio': return <span className="font-mono cd-x2">{r.tipoCambio ? `$${r.tipoCambio.toFixed(4)}` : '-'}</span>;
      case 'totalPesos': return <span className="font-mono cd-x4">{r.totalPesos ? `$${r.totalPesos.toFixed(2)}` : '-'}</span>;
      default: return <span className="cd-x5">-</span>;
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
          case 'fecha': val = reg.fecha || ''; break;
          case 'proveedor': val = reg.proveedor || ''; break;
          case 'tipoCombustible': val = reg.tipoCombustible || ''; break;
          case 'tipoMedida': val = reg.tipoMedida || ''; break;
          case 'monedaNombre': val = reg.monedaNombre || ''; break;
          case 'costo': val = Number(reg.costo || 0); break;
          case 'tipoCambio': val = Number(reg.tipoCambio || 0); break;
          case 'totalPesos': val = Number(reg.totalPesos || 0); break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Combustible');
    XLSX.writeFile(workbook, `Costo_Combustible_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="module-container cd-x6">
      
      {/* CONTENEDOR MAESTRO */}
      <div className="cd-x7">
        
        {/* TÍTULO LIMPIO */}
        <h1 className="module-title cd-x8">
          Costo del Combustible
        </h1>

        {/* BARRA DE CONTROLES */}
        <div className="cd-x9">
          
          {/* Izquierda: Filtro Estático */}
          <div className="cd-x10">
            <select className="form-control cd-x11">
              <option>Filtro: Todo</option>
            </select>
          </div>

          {/* Centro: Buscador Inteligente */}
          <div className="cd-x12">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${busqueda ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {busqueda && <span className="cd-x13">1</span>}
            </button>
            {busqueda && (
              <span className="cd-x14">
                "{busqueda}"
                <button className="cd-x15" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="cd-x16">
              {busquedaHecha ? `${registrosFiltrados.length} registros` : 'Presiona Filtros y Buscar para ver el catálogo.'}
            </span>
          </div>

          {/* Derecha: Botones */}
          <div className="cd-x17">
            <button 
              className="btn btn-outline cd-x18" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-outline cd-x18" 
              title="Exportar a Excel"
              onClick={exportarExcel}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary cd-x19" 
              title="Agregar Registro de Combustible"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA RESPONSIVE */}
        <div className="content-body cd-x20">
          <div className="table-container cd-x21">
            <table className="data-table cd-x22">
              <thead className="cd-x23">
                <tr>
                  <th className="cd-x24">
                    Acciones
                  </th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th className="cd-x25" key={`th_${col.id}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="cd-x26" colSpan={columnasTabla.length + 1}>
                    <div className="cd-x27">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="cd-x28">Define tus filtros y presiona <b className="cd-x29">Buscar</b> para ver los costos de combustible.</span>
                      <button className="cd-x30" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="cd-x31" colSpan={columnasTabla.length + 1}>
                      {busqueda ? 'No se encontraron registros para tu búsqueda.' : 'Aún no hay registros. Haz clic en el botón de agregar (+) para crear el primero.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((r, i) => {
                    const docId = (r as any).id;
                    return (
                      <tr 
                        key={docId || i} 
                        style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === (docId || String(i)) ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'default' }}
                        onMouseEnter={() => setHoveredRowId(docId || String(i))} 
                        onMouseLeave={() => setHoveredRowId(null)}
                      >
                        {/* CELDA ACCIONES FIJA */}
                        <td className="cd-x32">
                          <div className="actions-cell cd-x33">
                            <button 
                              className="btn-small btn-edit cd-x34" 
                              title="Editar Registro"
                              onClick={(e) => { e.stopPropagation(); handleEditar(r); }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            </button>
                            <button 
                              className="btn-small btn-danger cd-x35" 
                              title="Eliminar Registro"
                              onClick={(e) => handleEliminar(e, docId)}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>

                        {columnasTabla.filter(col => col.visible).map(col => (
                          <td className="cd-x36" key={`cell_${docId}_${col.id}`}>
                            {renderCellContent(r, col.id)}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* CONTROLES DE PAGINACIÓN */}
          {busquedaHecha && registrosFiltrados.length > 0 && (
            <div className="cd-x37">
              <div className="cd-x38">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="cd-x39">
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="cd-x40">{paginaActual} / {totalPaginas || 1}</span>
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
        <div className="modal-overlay cd-x41">
          <div className="cd-x42">
            <div className="cd-x43">
              <h3 className="cd-x44">Configurar Columnas de la Tabla</h3>
              <button className="cd-x45" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="cd-x46">Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul className="cd-x47">
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
                  <input className="cd-x48" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="cd-x49">
              <button className="cd-x50" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal del formulario */}
      {modalAbierto && (
        <FormularioCombustible 
          initialData={registroEditando}
          onClose={() => setModalAbierto(false)} 
          onSuccess={() => { setModalAbierto(false); cargarDatos(); }} 
        />
      )}

      {/* NUEVO: panel lateral DERECHO de filtros (Combustible) */}
      {drawerFiltrosAbierto && (
        <div className="cd-x51" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="cd-x52" onClick={(e) => e.stopPropagation()}>
            <div className="cd-x53">
              <h3 className="cd-x54">Filtros · Combustible</h3>
              <button className="cd-x45" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="cd-x55">
              <label className="cd-x56">BÚSQUEDA</label>
              <div className="cd-x57">
                <svg className="cd-x58" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="cd-x59" type="text" placeholder="Proveedor, fecha, monto..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="cd-x60" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            {/* ✅ NUEVO: rango de fechas */}
            <div className="cd-fechas">
              <div className="cd-fecha-campo">
                <label className="cd-x56">FECHA DESDE</label>
                <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="cd-fecha-input" />
              </div>
              <div className="cd-fecha-campo">
                <label className="cd-x56">FECHA HASTA</label>
                <input type="date" value={fechaHasta} min={fechaDesde || undefined} onChange={(e) => setFechaHasta(e.target.value)} className="cd-fecha-input" />
              </div>
            </div>

            <div className="cd-x61">
              La búsqueda y las fechas son <b className="cd-x62">opcionales</b>. Presiona <b className="cd-x29">Buscar</b> para ver todo el catálogo.
            </div>

            <div className="cd-x63">
              <button className="cd-x64" onClick={() => { setBusqueda(''); setFechaDesde(''); setFechaHasta(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="cd-x65" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
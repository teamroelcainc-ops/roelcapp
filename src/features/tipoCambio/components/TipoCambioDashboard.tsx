// src/features/tipoCambio/components/TipoCambioDashboard.tsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, deleteDoc, getDoc, setDoc } from 'firebase/firestore'; 
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { FormularioTipoCambio } from './FormularioTipoCambio';
import * as XLSX from 'xlsx';
import './TipoCambioDashboard.css';

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
  // ✅ NUEVO: panel lateral derecho de filtros. Por DEFECTO la tabla muestra
  //   únicamente el tipo de cambio de HOY; con Buscar se consulta el historial.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  const [filtroTendencia, setFiltroTendencia] = useState('Todos');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ── ✅ DÍAS FESTIVOS (compartidos para todos): config_dias_festivos/general.
  //   En estos días no se trabaja y el tipo de cambio toma el valor del día
  //   anterior; el formulario los usa para auto-generar esos registros. ──
  const [modalFestivos, setModalFestivos] = useState(false);
  const [festivos, setFestivos] = useState<{ fecha: string; nombre: string }[]>([]);
  const [nuevoFestivo, setNuevoFestivo] = useState<{ fecha: string; nombre: string }>({ fecha: '', nombre: '' });
  const [guardandoFestivos, setGuardandoFestivos] = useState(false);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'config_dias_festivos', 'general'));
        if (activo && snap.exists()) {
          const lista = ((snap.data() as any).festivos || []).map((f: any) => ({ fecha: String(f.fecha || ''), nombre: String(f.nombre || '') })).filter((f: any) => f.fecha);
          lista.sort((a: any, b: any) => a.fecha.localeCompare(b.fecha));
          setFestivos(lista);
        }
      } catch (e) { console.error('Error cargando días festivos:', e); }
    })();
    return () => { activo = false; };
  }, []);

  const agregarFestivo = () => {
    const fecha = nuevoFestivo.fecha;
    if (!fecha) { alert('Selecciona la fecha del día festivo.'); return; }
    if (festivos.some(f => f.fecha === fecha)) { alert('Esa fecha ya está en la lista de festivos.'); return; }
    const lista = [...festivos, { fecha, nombre: nuevoFestivo.nombre.trim() || 'Día festivo' }];
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
    setFestivos(lista);
    setNuevoFestivo({ fecha: '', nombre: '' });
  };

  const quitarFestivo = (fecha: string) => setFestivos(prev => prev.filter(f => f.fecha !== fecha));

  const guardarFestivos = async () => {
    setGuardandoFestivos(true);
    try {
      await setDoc(doc(db, 'config_dias_festivos', 'general'), { festivos, updatedAt: new Date().toISOString() }, { merge: true });
      await registrarLog('Tipo de Cambio', 'Configuración', `Actualizó la lista de días festivos (${festivos.length} fechas)`);
      alert('Días festivos guardados. Aplican para todos los usuarios.');
      setModalFestivos(false);
    } catch (e) {
      console.error(e);
      alert('No se pudieron guardar los días festivos. Revisa tu conexión.');
    } finally { setGuardandoFestivos(false); }
  };

  const formatoFechaFestivo = (iso: string) => {
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); } catch { return iso; }
  };

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
    if (tipo === 'subio') return <span><span className="tcd-x1">↗</span>{texto}</span>;
    if (tipo === 'bajo') return <span><span className="tcd-x2">↘</span>{texto}</span>;
    return <span><span className="tcd-x3">—</span>{texto}</span>;
  };

  // ✅ FILTRADO Y BÚSQUEDA
  // ✅ NUEVO: fecha de hoy (local) y normalizador para comparar r.fecha con hoy.
  const hoyISOTc = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const normFechaISO = (v: any): string => {
    const t = String(v ?? '').trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
  };

  const registrosFiltrados = registrosGlobales.filter(r => {
    // ✅ Por defecto (sin Buscar) solo se muestra el tipo de cambio de HOY.
    if (!busquedaHecha) return normFechaISO(r.fecha) === hoyISOTc;
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
      case 'fecha': return <span className="tcd-x4">{formatearFecha(registro.fecha)}</span>;
      case 'dia': return <span className="tcd-x5">{registro.dia || '-'}</span>;
      case 'tcDof': return <span className="tcd-x6">${registro.tcDof}</span>;
      case 'tendencia': return <span className="tcd-x5">{renderTendencia(registro.tipoTendencia, registro.tendencia)}</span>;
      default: return <span className="tcd-x7">-</span>;
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
    <div className="module-container tcd-x8">
      
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
     <div className="tcd-x9">
        
        {/* TÍTULO LIMPIO */}
        <h1 className="module-title tcd-x10">
          Tipo de Cambio Oficial
        </h1>

        {/* BARRA DE CONTROLES: Responsive y Alineada */}
        <div className="tcd-x11">
          

          {/* Centro: Buscador Inteligente */}
          <div className="tcd-x12">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busqueda || filtroTendencia !== 'Todos') ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(busqueda || filtroTendencia !== 'Todos') && <span className="tcd-x13">{[busqueda, filtroTendencia !== 'Todos' ? filtroTendencia : ''].filter(Boolean).length}</span>}
            </button>
            {filtroTendencia !== 'Todos' && (
              <span className="tcd-x14">
                {filtroTendencia === 'subio' ? 'Subió' : filtroTendencia === 'bajo' ? 'Bajó' : 'Se mantuvo'}
                <button className="tcd-x15" onClick={() => setFiltroTendencia('Todos')}>✕</button>
              </span>
            )}
            {busqueda && (
              <span className="tcd-x16">
                "{busqueda}"
                <button className="tcd-x17" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="tcd-x18">
              {busquedaHecha
                ? `${registrosFiltrados.length} registros`
                : <>Mostrando el tipo de cambio de <b className="tcd-x19">HOY</b> · usa Filtros para ver el historial</>}
            </span>
            {busquedaHecha && (
              <button className="tcd-x20" onClick={() => { setBusqueda(''); setFiltroTendencia('Todos'); setBusquedaHecha(false); }}>
                ← Volver a hoy
              </button>
            )}
          </div>

          {/* Derecha: Botones Iconográficos */}
          <div className="tcd-x21">
            <button 
              className="btn btn-outline tcd-x22" 
              title="Días Festivos (el T.C. toma el valor del día anterior)"
              onClick={() => setModalFestivos(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M12 14l1.1 2.2 2.4.35-1.75 1.7.4 2.4L12 19.5l-2.15 1.15.4-2.4-1.75-1.7 2.4-.35z"></path></svg>
            </button>
            <button 
              className="btn btn-outline tcd-x22" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-outline tcd-x22" 
              title="Exportar a Excel"
              onClick={exportarExcel}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary tcd-x23" 
              title="Nuevo Registro"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        {/* TABLA RESPONSIVE */}
        <div className="content-body tcd-x24">
          <div className="table-container tcd-x25">
            <table className="data-table tcd-x26">
              <thead className="tcd-x27">
                <tr>
                  <th className="tcd-x28">
                    Acciones
                  </th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th className="tcd-x29" key={`th_${col.id}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              
              <tbody>
                {registrosEnPantalla.length === 0 && !busquedaHecha ? (
                  <tr><td className="tcd-x30" colSpan={columnasTabla.length + 1}>
                    <div className="tcd-x31">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                      <span className="tcd-x32">Aún no se captura el tipo de cambio de <b className="tcd-x19">HOY</b>.</span>
                      <div className="tcd-x33">
                        <button className="tcd-x34" onClick={handleNuevo}>+ Capturar el TC de hoy</button>
                        <button className="tcd-x35" onClick={() => setDrawerFiltrosAbierto(true)}>Ver historial</button>
                      </div>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="tcd-x36" colSpan={columnasTabla.length + 1}>
                      No se encontraron registros con estos filtros.
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
                      <td className="tcd-x37" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell tcd-x38">
                          <button 
                            className="btn-small btn-edit tcd-x39" 
                            title="Editar Registro"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(registro); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger tcd-x40" 
                            title="Eliminar Registro"
                            onClick={(e) => handleEliminar(e, registro.id, registro.fecha)}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      {columnasTabla.filter(c => c.visible).map(col => (
                        <td className="tcd-x41" key={`cell_${registro.id}_${col.id}`}>
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
            <div className="tcd-x42">
              <div className="tcd-x43">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="tcd-x44">
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="tcd-x45">{paginaActual} / {totalPaginas || 1}</span>
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

      {/* MODAL CONFIGURACIÓN COLUMNAS INTERACTIVAS (DRAG & DROP) */}
      {/* MODAL DE DÍAS FESTIVOS */}
      {modalFestivos && (
        <div className="modal-overlay tcd-x46">
          <div className="tcd-x47">
            <div className="tcd-x48">
              <h3 className="tcd-x49">Días Festivos</h3>
              <button className="tcd-x50" onClick={() => setModalFestivos(false)}>✕</button>
            </div>
            <div className="tcd-x51">
              <p className="tcd-x52">
                En estos días no se trabaja: el tipo de cambio <b className="tcd-x7">toma el valor del día anterior</b> y se genera automáticamente al capturar ese día anterior. La lista aplica para <b className="tcd-x53">todos los usuarios</b>.
              </p>
              <div className="tcd-x54">
                <input className="tcd-x55" type="date" value={nuevoFestivo.fecha} onChange={e => setNuevoFestivo(prev => ({ ...prev, fecha: e.target.value }))} />
                <input className="tcd-x56" type="text" placeholder="Nombre (ej. 4 de Julio)" value={nuevoFestivo.nombre} onChange={e => setNuevoFestivo(prev => ({ ...prev, nombre: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarFestivo(); } }} />
                <button className="tcd-x57" type="button" onClick={agregarFestivo}>Agregar</button>
              </div>
              {festivos.length === 0 ? (
                <div className="tcd-x58">Sin días festivos registrados.</div>
              ) : (
                <div className="tcd-x59">
                  {festivos.map(f => (
                    <div className="tcd-x60" key={f.fecha}>
                      <div>
                        <span className="tcd-x61">{f.nombre}</span>
                        <span className="tcd-x62">{formatoFechaFestivo(f.fecha)}</span>
                      </div>
                      <button className="tcd-x63" type="button" title="Quitar" onClick={() => quitarFestivo(f.fecha)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="tcd-x64">
              <button className="tcd-x65" type="button" onClick={() => setModalFestivos(false)}>Cancelar</button>
              <button className="tcd-x66" type="button" onClick={guardarFestivos} disabled={guardandoFestivos}>{guardandoFestivos ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {modalColumnas && (
        <div className="modal-overlay tcd-x67">
          <div className="tcd-x68">
            <div className="tcd-x69">
              <h3 className="tcd-x70">Configurar Columnas de la Tabla</h3>
              <button className="tcd-x50" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="tcd-x71">Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul className="tcd-x72">
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
                  <input className="tcd-x73" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="tcd-x74">
              <button className="tcd-x75" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}


      {/* NUEVO: panel lateral DERECHO de filtros (Tipo de Cambio · historial) */}
      {drawerFiltrosAbierto && (
        <div className="tcd-x76" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="tcd-x77" onClick={(e) => e.stopPropagation()}>
            <div className="tcd-x78">
              <h3 className="tcd-x79">Filtros · Historial de TC</h3>
              <button className="tcd-x50" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="tcd-x59">
              <label className="tcd-x80">BÚSQUEDA</label>
              <div className="tcd-x81">
                <svg className="tcd-x82" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="tcd-x83" type="text" placeholder="Fecha, día o monto..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="tcd-x84" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="tcd-x59">
              <label className="tcd-x85">TENDENCIA</label>
              <div className="tcd-x86">
                <button onClick={() => setFiltroTendencia('Todos')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', backgroundColor: filtroTendencia === 'Todos' ? 'rgba(88,166,255,0.15)' : 'transparent', color: filtroTendencia === 'Todos' ? '#58a6ff' : '#8b949e' }}>Todas</button>
                <button onClick={() => setFiltroTendencia('subio')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', backgroundColor: filtroTendencia === 'subio' ? 'rgba(63,185,80,0.15)' : 'transparent', color: filtroTendencia === 'subio' ? '#3fb950' : '#8b949e' }}>▲ Subió</button>
                <button onClick={() => setFiltroTendencia('bajo')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', backgroundColor: filtroTendencia === 'bajo' ? 'rgba(248,81,73,0.15)' : 'transparent', color: filtroTendencia === 'bajo' ? '#f85149' : '#8b949e' }}>▼ Bajó</button>
                <button onClick={() => setFiltroTendencia('igual')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', backgroundColor: filtroTendencia === 'igual' ? 'rgba(245,158,11,0.15)' : 'transparent', color: filtroTendencia === 'igual' ? '#f59e0b' : '#8b949e' }}>= Igual</button>
              </div>
            </div>

            <div className="tcd-x87">
              Presiona <b className="tcd-x88">Buscar</b> para ver el historial completo con estos filtros. <b className="tcd-x89">Limpiar</b> regresa a la vista del día de hoy.
            </div>

            <div className="tcd-x90">
              <button className="tcd-x91" onClick={() => { setBusqueda(''); setFiltroTendencia('Todos'); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="tcd-x92" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
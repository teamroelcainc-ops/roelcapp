// src/features/contactos/components/ContactosDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase';
import { FormularioContacto } from './FormularioContacto';
import './ContactosDashboard.css';
import { almacenSesion } from '../../../utils/cacheMemoria';

// ✅ TODAS LAS COLUMNAS DE LA COLECCIÓN CON NOMBRES LEGIBLES
const COLUMNAS_BASE = [
  { id: 'empresa', label: 'Empresa / Cliente', visible: true },
  { id: 'persona', label: 'Persona Encargada', visible: true },
  { id: 'puesto', label: 'Puesto', visible: true },
  { id: 'telefono', label: 'Teléfono', visible: true },
  { id: 'correo', label: 'Correo', visible: true }
];

export const ContactosDashboard = () => {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [contactoEditando, setContactoEditando] = useState<any | null>(null);
  
  const [contactoViendo, setContactoViendo] = useState<any | null>(null);
  const [contactos, setContactos] = useState<any[]>([]);
  const [empresasDict, setEmpresasDict] = useState<Record<string, string>>({});
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);

  // Estados de paginación
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // Estados para configuración de columnas
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // Cargar Contactos y Diccionario de Empresas (Optimizado con Caché)
  useEffect(() => {
    const fetchEmpresas = async () => {
      const cacheKey = 'roelca_empresas_contactos_dict';
      const cacheData = almacenSesion.getItem(cacheKey);

      if (cacheData) {
        setEmpresasDict(JSON.parse(cacheData));
        return;
      }

      console.warn(`[FIREBASE READ] Descargando catálogo de empresas para Contactos...`);
      try {
        const snap = await getDocs(collection(db, 'empresas'));
        const dict: Record<string, string> = {};
        snap.forEach(doc => { dict[doc.id] = doc.data().nombre || 'Sin nombre'; });
        
        almacenSesion.setItem(cacheKey, JSON.stringify(dict));
        setEmpresasDict(dict);
      } catch (e) {
        console.error("Error al cargar empresas:", e);
      }
    };

    fetchEmpresas();

    const unsubContactos = onSnapshot(collection(db, 'contactos'), (snapshot) => {
      setContactos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubContactos();
    };
  }, []);

  useEffect(() => setPaginaActual(1), [busqueda]);

  const handleNuevo = () => { setContactoEditando(null); setEstadoFormulario('abierto'); };
  
  const editarContacto = (contacto: any) => { 
    setContactoEditando(contacto); 
    setContactoViendo(null); 
    setEstadoFormulario('abierto'); 
  };

  const eliminarContacto = async (id: string) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar este contacto permanentemente?')) {
      try {
        await eliminarRegistro('contactos', id);
        setContactoViendo(null);
      } catch (error) {
        alert('Hubo un error al eliminar el registro.');
      }
    }
  };

  // Cruce de datos y filtrado
  const registrosListos = useMemo(() => {
    return contactos.map(c => ({
      ...c,
      _empresaNombre: empresasDict[c.id_cliente] || 'Empresa Eliminada o Desconocida'
    }));
  }, [contactos, empresasDict]);

  const registrosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return registrosListos;
    const term = busqueda.toLowerCase();
    return registrosListos.filter(c => 
      String(c.persona_encargada || '').toLowerCase().includes(term) ||
      String(c._empresaNombre || '').toLowerCase().includes(term) ||
      String(c.puesto || '').toLowerCase().includes(term) ||
      String(c.correo || '').toLowerCase().includes(term)
    );
  }, [registrosListos, busqueda]);

  // Cálculos de Paginación
  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  // Lógica de Drag & Drop para columnas
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

  // Renderizador Dinámico de Celdas
  const renderCellContent = (c: any, colId: string) => {
    switch (colId) {
      case 'empresa': return <span className="cd-x1">{c._empresaNombre}</span>;
      case 'persona': return <span className="cd-x2">{c.persona_encargada}</span>;
      case 'puesto': return <span className="cd-x3">{c.puesto || '-'}</span>;
      case 'telefono': return <span className="cd-x3">{c.telefono || '-'}</span>;
      case 'correo': return <span className="cd-x3">{c.correo || '-'}</span>;
      default: return <span className="cd-x3">-</span>;
    }
  };

  return (
    <div className="module-container cd-x4">
      
      <FormularioContacto 
        estado={estadoFormulario} 
        initialData={contactoEditando} 
        onClose={() => { setEstadoFormulario('cerrado'); setContactoEditando(null); }}
        onMinimize={() => setEstadoFormulario('minimizado')} 
        onRestore={() => setEstadoFormulario('abierto')}
      />

      <div className="cd-x5">
        <h1 className="module-title cd-x6">
          Directorio de Contactos
        </h1>

        <div className="cd-x7">
          <div className="cd-x8">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${busqueda ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {busqueda && <span className="cd-x9">1</span>}
            </button>
            {busqueda && (
              <span className="cd-x10">
                "{busqueda}"
                <button className="cd-x11" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="cd-x12">
              {busquedaHecha ? `${registrosFiltrados.length} contactos` : 'Presiona Filtros y Buscar para ver los contactos.'}
            </span>
          </div>
          
          <div className="cd-x13">
            <button 
              className="btn btn-outline cd-x14" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-primary cd-x15" 
              title="Agregar Nuevo Contacto"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body cd-x16">
          <div className="table-container cd-x17">
            <table className="data-table cd-x18">
              <thead className="cd-x19">
                <tr>
                  <th className="cd-x20">
                    Acciones
                  </th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th className="cd-x21" key={`th_${col.id}`}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="cd-x22" colSpan={columnasTabla.length + 1}>
                    <div className="cd-x23">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="cd-x24">Define tus filtros y presiona <b className="cd-x25">Buscar</b> para ver los contactos.</span>
                      <button className="cd-x26" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="cd-x27" colSpan={columnasTabla.length + 1}>No se encontraron contactos.</td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((c) => (
                    <tr 
                      key={c.id} 
                      onClick={() => setContactoViendo(c)}
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === c.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(c.id)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                    >
                      <td className="cd-x28" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell cd-x29">
                          <button className="cd-x30" 
                            title="Editar Contacto"
                            onClick={(e) => { e.stopPropagation(); editarContacto(c); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} 
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button className="cd-x31" 
                            title="Eliminar Contacto"
                            onClick={(e) => { e.stopPropagation(); eliminarContacto(c.id); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      {columnasTabla.filter(col => col.visible).map(col => (
                        <td className="cd-x32" key={`cell_${c.id}_${col.id}`}>
                          {renderCellContent(c, col.id)}
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
            <div className="cd-x33">
              <div className="cd-x34">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="cd-x35">
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="cd-x36">{paginaActual} / {totalPaginas || 1}</span>
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
      {modalColumnas && (
        <div className="modal-overlay cd-x37">
          <div className="cd-x38">
            <div className="cd-x39">
              <h3 className="cd-x40">Configurar Columnas de la Tabla</h3>
              <button className="cd-x41" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="cd-x42">Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul className="cd-x43">
              {columnasTabla.map((col, idx) => (
                <li 
                  key={col.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="cd-x44" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="cd-x45">
              <button className="cd-x46" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALLES DEL CONTACTO */}
      {contactoViendo && (
        <div className="modal-overlay cd-x47">
          <div className="cd-x48">
            
            <div className="cd-x49">
              <h2 className="cd-x50">Detalles del Contacto</h2>
              <button className="cd-x41" onClick={() => setContactoViendo(null)}>✕</button>
            </div>
            
            <div className="cd-x51">
              <div className="cd-x52">
                <div className="cd-x53">
                  <span className="cd-x54">Empresa / Cliente</span>
                  <span className="cd-x55">{contactoViendo._empresaNombre}</span>
                </div>
                <div>
                  <span className="cd-x54">Persona Encargada</span>
                  <span className="cd-x56">{contactoViendo.persona_encargada}</span>
                </div>
                <div>
                  <span className="cd-x54">Puesto</span>
                  <span className="cd-x57">{contactoViendo.puesto}</span>
                </div>
                <div>
                  <span className="cd-x54">Teléfono</span>
                  <span className="cd-x57">{contactoViendo.telefono || '-'}</span>
                </div>
                <div>
                  <span className="cd-x54">Correo Electrónico</span>
                  <span className="cd-x57">{contactoViendo.correo || '-'}</span>
                </div>
              </div>
            </div>

            <div className="cd-x58">
              <button className="cd-x59" onClick={() => setContactoViendo(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}


      {/* NUEVO: panel lateral DERECHO de filtros (Contactos) */}
      {drawerFiltrosAbierto && (
        <div className="cd-x60" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="cd-x61" onClick={(e) => e.stopPropagation()}>
            <div className="cd-x62">
              <h3 className="cd-x63">Filtros · Contactos</h3>
              <button className="cd-x41" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="cd-x64">
              <label className="cd-x65">BÚSQUEDA</label>
              <div className="cd-x66">
                <svg className="cd-x67" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="cd-x68" type="text" placeholder="Nombre, empresa, puesto o correo..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="cd-x69" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="cd-x70">
              La búsqueda es <b className="cd-x71">opcional</b>. Presiona <b className="cd-x25">Buscar</b> para ver todos los contactos.
            </div>

            <div className="cd-x72">
              <button className="cd-x73" onClick={() => { setBusqueda(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="cd-x74" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
// src/features/contactos/components/ContactosDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase';
import { FormularioContacto } from './FormularioContacto';

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
      const cacheData = sessionStorage.getItem(cacheKey);

      if (cacheData) {
        setEmpresasDict(JSON.parse(cacheData));
        return;
      }

      console.warn(`[FIREBASE READ] Descargando catálogo de empresas para Contactos...`);
      try {
        const snap = await getDocs(collection(db, 'empresas'));
        const dict: Record<string, string> = {};
        snap.forEach(doc => { dict[doc.id] = doc.data().nombre || 'Sin nombre'; });
        
        sessionStorage.setItem(cacheKey, JSON.stringify(dict));
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
      case 'empresa': return <span style={{ color: '#58a6ff', fontWeight: '500' }}>{c._empresaNombre}</span>;
      case 'persona': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{c.persona_encargada}</span>;
      case 'puesto': return <span style={{ color: '#c9d1d9' }}>{c.puesto || '-'}</span>;
      case 'telefono': return <span style={{ color: '#c9d1d9' }}>{c.telefono || '-'}</span>;
      case 'correo': return <span style={{ color: '#c9d1d9' }}>{c.correo || '-'}</span>;
      default: return <span style={{ color: '#c9d1d9' }}>-</span>;
    }
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      <FormularioContacto 
        estado={estadoFormulario} 
        initialData={contactoEditando} 
        onClose={() => { setEstadoFormulario('cerrado'); setContactoEditando(null); }}
        onMinimize={() => setEstadoFormulario('minimizado')} 
        onRestore={() => setEstadoFormulario('abierto')}
      />

      <div style={{ width: '100%', margin: '0 auto' }}>
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          Directorio de Contactos
        </h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Buscar por nombre, empresa, puesto o correo..." 
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              className="btn btn-outline" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-primary" 
              title="Agregar Nuevo Contacto"
              onClick={handleNuevo} 
              style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            <table className="data-table" style={{ width: '100%', minWidth: '1000px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', borderBottom: '1px solid #30363d', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d' }}>
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
                    <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No se encontraron contactos.</td>
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
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            title="Editar Contacto"
                            onClick={(e) => { e.stopPropagation(); editarContacto(c); }} 
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} 
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            title="Eliminar Contacto"
                            onClick={(e) => { e.stopPropagation(); eliminarContacto(c.id); }} 
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      {columnasTabla.filter(col => col.visible).map(col => (
                        <td key={`cell_${c.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>
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
          {registrosFiltrados.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
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
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}
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

      {/* MODAL DE DETALLES DEL CONTACTO */}
      {contactoViendo && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ maxWidth: '600px', width: '100%', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            
            <div style={{ borderBottom: '1px solid #30363d', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.25rem' }}>Detalles del Contacto</h2>
              <button onClick={() => setContactoViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Empresa / Cliente</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.1rem', fontWeight: 'bold' }}>{contactoViendo._empresaNombre}</span>
                </div>
                <div>
                  <span style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Persona Encargada</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{contactoViendo.persona_encargada}</span>
                </div>
                <div>
                  <span style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Puesto</span>
                  <span style={{ color: '#c9d1d9', fontSize: '1rem' }}>{contactoViendo.puesto}</span>
                </div>
                <div>
                  <span style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Teléfono</span>
                  <span style={{ color: '#c9d1d9', fontSize: '1rem' }}>{contactoViendo.telefono || '-'}</span>
                </div>
                <div>
                  <span style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Correo Electrónico</span>
                  <span style={{ color: '#c9d1d9', fontSize: '1rem' }}>{contactoViendo.correo || '-'}</span>
                </div>
              </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', backgroundColor: '#161b22' }}>
              <button onClick={() => setContactoViendo(null)} style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
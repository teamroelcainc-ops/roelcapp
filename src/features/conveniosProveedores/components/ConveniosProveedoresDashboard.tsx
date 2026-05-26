// src/features/conveniosProveedores/components/ConveniosProveedoresDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs, query, where, limit, orderBy } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase'; 
import { FormularioConvenioProveedor } from './FormularioConvenioProveedor';
import type { ConvenioProveedorRecord } from '../../../types/convenioProveedor';

// ============================================================
// HELPER DE NORMALIZACIÓN PARA EL CRUCE
// ------------------------------------------------------------
// El campo operaciones.convenioProveedor guarda el ID del DETALLE
// (doc de convenios_proveedores_detalles), NO el ID del maestro.
// El nombre del detalle se guarda en operaciones.convenioProveedorNombre.
// Normalizamos textos (minúsculas, sin acentos ni espacios sobrantes)
// para que el cruce por nombre nunca falle por formato.
// ============================================================
const normalizar = (texto: any): string => {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

export const ConveniosProveedoresDashboard: React.FC = () => {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [registroEditando, setRegistroEditando] = useState<ConvenioProveedorRecord | null>(null);
  
  const [convenioViendo, setConvenioViendo] = useState<any | null>(null);
  const [activeTabDetalle, setActiveTabDetalle] = useState<'general' | 'detalles' | 'uso'>('general');
  const [operacionesUso, setOperacionesUso] = useState<any[]>([]);
  const [cargandoUso, setCargandoUso] = useState(false);

  // Datos crudos en vivo — base para todos los cruces.
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [detallesGlobales, setDetallesGlobales] = useState<any[]>([]);

  const [registrosGlobales, setRegistrosGlobales] = useState<ConvenioProveedorRecord[]>([]);
  const [busqueda, setBusqueda] = useState('');
  
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // =========================================================
  // 1. CARGA EN TIEMPO REAL: CONVENIOS + DETALLES + OPERACIONES
  // =========================================================
  useEffect(() => {
    // 1.A) Convenios maestros de proveedores
    const unsubscribeConvenios = onSnapshot(collection(db, 'convenios_proveedores'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ConvenioProveedorRecord[];
      data.sort((a, b) => {
        const numA = parseInt((a.numeroConvenio || '').replace(/\D/g, ''), 10) || 0;
        const numB = parseInt((b.numeroConvenio || '').replace(/\D/g, ''), 10) || 0;
        return numB - numA;
      });
      setRegistrosGlobales(data);
    });

    // 1.B) Detalles de convenios de proveedores (convenios_proveedores_detalles)
    const unsubscribeDetalles = onSnapshot(collection(db, 'convenios_proveedores_detalles'), (snap) => {
      setDetallesGlobales(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // 1.C) Operaciones (las más recientes, para el cruce de uso)
    const qOps = query(collection(db, 'operaciones'), orderBy('fechaServicio', 'desc'), limit(3000));
    const unsubscribeOperaciones = onSnapshot(qOps, (snap) => {
      setOperacionesGlobales(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubscribeConvenios();
      unsubscribeDetalles();
      unsubscribeOperaciones();
    };
  }, []);

  // =========================================================
  // 2. ÍNDICES DE CRUCE
  // =========================================================

  // idDetalle -> convenioId maestro
  const detalleToConvenio = useMemo(() => {
    const m: Record<string, string> = {};
    detallesGlobales.forEach(d => {
      if (d.convenioId) m[String(d.id).trim()] = String(d.convenioId).trim();
    });
    return m;
  }, [detallesGlobales]);

  // convenioId maestro -> proveedorId (para acotar el cruce por nombre)
  const convenioToProveedor = useMemo(() => {
    const m: Record<string, string> = {};
    registrosGlobales.forEach((c: any) => {
      if (c.proveedorId) m[String(c.id).trim()] = String(c.proveedorId).trim();
    });
    return m;
  }, [registrosGlobales]);

  // Última fecha de uso por DETALLE.
  // Cruce con doble llave:
  //   (a) ID  -> operacion.convenioProveedor === detalle.id
  //   (b) Nombre + proveedor -> operacion.convenioProveedorNombre === detalle.tipoConvenioNombre
  const lastUsedDetalleMap = useMemo(() => {
    const map: Record<string, string> = {};

    // Índice de nombres: "proveedorId|nombreNormalizado" -> [idDetalle, ...]
    const nombreIndex: Record<string, string[]> = {};
    detallesGlobales.forEach(d => {
      const idDet = String(d.id).trim();
      const convId = detalleToConvenio[idDet];
      const provId = convId ? (convenioToProveedor[convId] || '') : '';
      const nom = normalizar(d.tipoConvenioNombre || d.nombre || d.descripcion);
      if (!nom) return;
      const conProv = `${provId}|${nom}`;
      const sinProv = `|${nom}`;
      if (!nombreIndex[conProv]) nombreIndex[conProv] = [];
      nombreIndex[conProv].push(idDet);
      if (!nombreIndex[sinProv]) nombreIndex[sinProv] = [];
      nombreIndex[sinProv].push(idDet);
    });

    const registrar = (idDetalle: string, fecha: string) => {
      const id = String(idDetalle).trim();
      if (!id || !fecha) return;
      if (!map[id] || new Date(fecha) > new Date(map[id])) {
        map[id] = fecha;
      }
    };

    operacionesGlobales.forEach(op => {
      const fechaRaw = op.fechaServicio || op.createdAt;
      if (!fechaRaw || typeof fechaRaw !== 'string') return;
      const fecha = fechaRaw.split('T')[0];

      // (a) Cruce directo por ID del detalle.
      const idEnOp = op.convenioProveedor || op.convenioProveedorDetalleId;
      let cruzadoPorId = false;
      if (idEnOp && typeof idEnOp === 'string' && detalleToConvenio[String(idEnOp).trim()] !== undefined) {
        registrar(idEnOp, fecha);
        cruzadoPorId = true;
      }

      // (b) Cruce por nombre (respaldo si el ID no coincide).
      if (!cruzadoPorId) {
        const nombreOp = normalizar(
          op.convenioProveedorNombre || op.convenioProveedorDetalleNombre || op.tarifaNombre
        );
        if (nombreOp) {
          const provOp = String(op.proveedorUnidad || op.proveedorId || '').trim();
          let candidatos = nombreIndex[`${provOp}|${nombreOp}`];
          if (!candidatos || candidatos.length === 0) {
            candidatos = nombreIndex[`|${nombreOp}`];
          }
          if (candidatos) {
            candidatos.forEach(idDet => registrar(idDet, fecha));
          }
        }
      }
    });

    return map;
  }, [operacionesGlobales, detallesGlobales, detalleToConvenio, convenioToProveedor]);

  // Última fecha de uso por CONVENIO maestro = fecha más reciente
  // entre TODOS sus detalles (el último detalle usado).
  const lastUsedConvenioMap = useMemo(() => {
    const map: Record<string, string> = {};
    Object.entries(lastUsedDetalleMap).forEach(([idDetalle, fecha]) => {
      const convId = detalleToConvenio[idDetalle];
      if (!convId) return;
      if (!map[convId] || new Date(fecha) > new Date(map[convId])) {
        map[convId] = fecha;
      }
    });
    return map;
  }, [lastUsedDetalleMap, detalleToConvenio]);

  // =========================================================
  // 3. REGISTROS LISTOS
  // =========================================================
  const registrosListos = useMemo(() => {
    return registrosGlobales.map(reg => ({
      ...reg,
      _fechaDinamicaUso: lastUsedConvenioMap[reg.id!] || (reg as any).fechaUltimoUso || '',
      status: (reg as any).status || 'Activo'
    }));
  }, [registrosGlobales, lastUsedConvenioMap]);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda]);

  const handleNuevo = () => { 
    setRegistroEditando(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const editarRegistro = (registro: ConvenioProveedorRecord) => { 
    setRegistroEditando(registro); 
    setEstadoFormulario('abierto'); 
  };

  // =========================================================
  // 4. FICHA DE DETALLE
  // =========================================================
  const verDetalle = async (convenio: any) => {
    setConvenioViendo({ ...convenio, detalles: [] });
    setActiveTabDetalle('general');
    setCargandoUso(true);
    setOperacionesUso([]);

    try {
      // Detalles reales del convenio
      const qDetalles = query(collection(db, 'convenios_proveedores_detalles'), where('convenioId', '==', convenio.id));
      const snapDetalles = await getDocs(qDetalles);
      const detallesList = snapDetalles.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setConvenioViendo((prev: any) => ({ ...prev, detalles: detallesList }));

      // IDs y nombres válidos de este convenio para filtrar operaciones.
      const idsDetalles = new Set(detallesList.map(d => String(d.id).trim()));
      const nombresDetalles = new Set(
        detallesList
          .map(d => normalizar((d as any).tipoConvenioNombre || (d as any).nombre || (d as any).descripcion))
          .filter(Boolean)
      );
      const proveedorConvenio = String((convenio as any).proveedorId || '').trim();

      // Filtramos operaciones desde memoria (operacionesGlobales ya está en vivo).
      const opsFiltradas = operacionesGlobales.filter(op => {
        const idEnOp = String(op.convenioProveedor || op.convenioProveedorDetalleId || '').trim();
        if (idEnOp && idsDetalles.has(idEnOp)) return true;

        // Respaldo por nombre + proveedor
        const nombreOp = normalizar(op.convenioProveedorNombre || op.convenioProveedorDetalleNombre || op.tarifaNombre);
        if (!nombreOp || !nombresDetalles.has(nombreOp)) return false;
        const provOp = String(op.proveedorUnidad || op.proveedorId || '').trim();
        return !proveedorConvenio || !provOp || provOp === proveedorConvenio;
      });

      opsFiltradas.sort((a: any, b: any) => 
        new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime()
      );
      
      setOperacionesUso(opsFiltradas.slice(0, 50));
    } catch (error) {
      console.error("Error cargando ficha del convenio de proveedor:", error);
    } finally {
      setCargandoUso(false);
    }
  };

  const handleEliminar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); 
    if (window.confirm('¿Estás seguro de que deseas eliminar permanentemente este convenio?')) {
      try {
        await eliminarRegistro('convenios_proveedores', id);
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert('Hubo un error al eliminar. Revisa tu conexión.');
      }
    }
  };

  const formatearFechaEsp = (fechaString: string) => {
    if (!fechaString) return '-';
    const fechaObj = new Date(fechaString + 'T00:00:00'); 
    return fechaObj.toLocaleDateString('es-ES', { 
      year: 'numeric', month: '2-digit', day: '2-digit' 
    });
  };

  const obtenerColorInactividad = (fechaStr: string) => {
    if (!fechaStr) return '#8b949e'; 
    const fechaUltimo = new Date(fechaStr + 'T00:00:00');
    const hoy = new Date();
    
    const diffTime = hoy.getTime() - fechaUltimo.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 45) return '#10b981'; 
    if (diffDays >= 46 && diffDays <= 90) return '#f59e0b'; 
    return '#ef4444'; 
  };

  const registrosFiltrados = registrosListos.filter(reg => {
    const b = busqueda.toLowerCase();
    return (
      String(reg.numeroConvenio || '').toLowerCase().includes(b) ||
      String(reg.proveedorNombre || '').toLowerCase().includes(b) ||
      String(reg.monedaNombre || '').toLowerCase().includes(b) ||
      formatearFechaEsp(reg.fechaConvenio).toLowerCase().includes(b) ||
      formatearFechaEsp(reg.fechaVencimiento).toLowerCase().includes(b)
    );
  });

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  const exportarCSV = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    const encabezados = ['# de Convenio', 'Fecha del Convenio', 'Fecha de Vencimiento', 'Proveedor', 'Moneda', 'Crédito', 'Último Uso'];
    const lineas = registrosFiltrados.map(r => [
      `"${r.numeroConvenio || ''}"`, `"${formatearFechaEsp(r.fechaConvenio)}"`, 
      `"${formatearFechaEsp(r.fechaVencimiento)}"`, `"${r.proveedorNombre || ''}"`, 
      `"${r.monedaNombre || ''}"`, `"${r.credito || ''}"`,
      `"${r._fechaDinamicaUso ? formatearFechaEsp(r._fechaDinamicaUso) : 'Nunca usado'}"`
    ].join(','));
    const csvContent = [encabezados.join(','), ...lineas].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Convenios_Proveedores_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 20px', background: 'none', border: 'none',
    borderBottom: isActive ? '2px solid #D84315' : '2px solid transparent',
    color: isActive ? '#f0f6fc' : '#8b949e', cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal', fontSize: '0.9rem',
    transition: 'all 0.2s ease', outline: 'none'
  });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioConvenioProveedor 
          estado={estadoFormulario} 
          initialData={registroEditando}
          registrosExistentes={registrosGlobales}
          onClose={() => { setEstadoFormulario('cerrado'); setRegistroEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} 
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      <div style={{ width: '100%', margin: '0 auto' }}>
        
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          Convenios de Proveedores
        </h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '120px' }}>
            <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '10px', borderRadius: '6px' }}>
              <option>Filtro: Todo</option>
            </select>
          </div>

          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Buscar por # Convenio, Proveedor, Fechas..." 
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '280px' }}>
            <button 
              className="btn btn-outline" 
              title="Exportar a CSV"
              onClick={exportarCSV} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary" 
              title="Agregar Nuevo Convenio"
              onClick={handleNuevo} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            <table className="data-table" style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '160px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
                    Acciones
                  </th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}># de Convenio</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Fecha del convenio</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Fecha de vencimiento</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Proveedor</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Moneda</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Crédito</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Último Uso</th>
                </tr>
              </thead>
              <tbody>
                {registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                      {busqueda ? 'No se encontraron convenios para tu búsqueda.' : 'Aún no hay convenios registrados. Haz clic en el botón de "+" para comenzar.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((reg) => {
                    const colorSemaforo = obtenerColorInactividad(reg._fechaDinamicaUso);

                    return (
                    <tr 
                      key={reg.id} 
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === reg.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(reg.id!)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => verDetalle(reg)}
                    >
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn-small btn-edit" 
                            title="Editar Convenio"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(reg); }}
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger" 
                            title="Eliminar Convenio"
                            onClick={(e) => handleEliminar(e, reg.id!)}
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      <td className="font-mono" style={{ padding: '16px', fontWeight: 'bold', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span 
                            title={reg._fechaDinamicaUso ? `Color por días de inactividad` : 'Nunca usado'} 
                            style={{ 
                              width: '12px', 
                              height: '12px', 
                              borderRadius: '50%', 
                              backgroundColor: colorSemaforo, 
                              display: 'inline-block', 
                              flexShrink: 0, 
                              boxShadow: `0 0 5px ${colorSemaforo}` 
                            }}>
                          </span>
                          <span style={{ color: '#f0f6fc' }}>{reg.numeroConvenio}</span>
                        </div>
                      </td>

                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatearFechaEsp(reg.fechaConvenio)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatearFechaEsp(reg.fechaVencimiento)}</td>
                      <td style={{ padding: '16px', color: '#f0f6fc', fontSize: '0.95rem', fontWeight: '500', whiteSpace: 'nowrap' }}>{reg.proveedorNombre}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{reg.monedaNombre}</td>
                      <td className="font-mono" style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{reg.credito}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                        {reg._fechaDinamicaUso ? formatearFechaEsp(reg._fechaDinamicaUso) : '-'}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

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

      {/* MODAL FICHA DE CONVENIO */}
      {convenioViendo && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1000, position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div className="form-card detail-card" style={{ maxWidth: '850px', width: '100%', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.25rem' }}>Ficha de Convenio <span style={{ color: '#D84315' }}>{convenioViendo.numeroConvenio}</span></h2>
              </div>
              <button onClick={() => setConvenioViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', backgroundColor: '#161b22', padding: '0 24px', flexShrink: 0, overflowX: 'auto' }}>
              <button type="button" onClick={() => setActiveTabDetalle('general')} style={tabStyle(activeTabDetalle === 'general')}>General</button>
              <button type="button" onClick={() => setActiveTabDetalle('detalles')} style={tabStyle(activeTabDetalle === 'detalles')}>Detalles / Tarifas</button>
              <button type="button" onClick={() => setActiveTabDetalle('uso')} style={tabStyle(activeTabDetalle === 'uso')}>Historial de Uso (Operaciones)</button>
            </div>

            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              
              {activeTabDetalle === 'general' && (
                <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', animation: 'fadeIn 0.3s ease' }}>
                  <div className="detail-item" style={{ gridColumn: 'span 2' }}>
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Proveedor</span>
                    <span className="detail-value" style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{convenioViendo.proveedorNombre || '-'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Estatus</span>
                    <span className="detail-value" style={{ color: '#c9d1d9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`dot dot-green`} style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }}></span>
                      {convenioViendo.status || 'Activo'}
                    </span>
                  </div>
                  
                  <div className="detail-item">
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Fecha de Convenio</span>
                    <span className="detail-value" style={{ color: '#c9d1d9' }}>{formatearFechaEsp(convenioViendo.fechaConvenio)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Fecha de Vencimiento</span>
                    <span className="detail-value" style={{ color: '#c9d1d9' }}>{formatearFechaEsp(convenioViendo.fechaVencimiento)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Último Uso Operativo</span>
                    <span className="detail-value font-mono" style={{ color: '#58a6ff', fontWeight: 'bold' }}>
                      {lastUsedConvenioMap[convenioViendo.id]
                        ? formatearFechaEsp(lastUsedConvenioMap[convenioViendo.id])
                        : '-'}
                    </span>
                  </div>

                  <div className="detail-item" style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>

                  <div className="detail-item">
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Moneda Base</span>
                    <span className="detail-value" style={{ color: '#c9d1d9' }}>{convenioViendo.monedaNombre || '-'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Días de Crédito</span>
                    <span className="detail-value font-mono" style={{ color: '#c9d1d9' }}>{convenioViendo.credito || '-'}</span>
                  </div>
                </div>
              )}

              {activeTabDetalle === 'detalles' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '16px' }}>
                    Mostrando los detalles/tarifas del convenio y su último uso en base a las operaciones registradas.
                  </p>
                  {(!convenioViendo.detalles || convenioViendo.detalles.length === 0) ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e', backgroundColor: '#161b22', borderRadius: '8px' }}>
                      Este convenio no tiene detalles o tarifas registradas.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', minWidth: '700px', borderCollapse: 'collapse', textAlign: 'left', backgroundColor: '#161b22', borderRadius: '8px', overflow: 'hidden' }}>
                        <thead style={{ backgroundColor: '#1f2937' }}>
                          <tr>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>DESCRIPCIÓN / CONCEPTO</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>COSTO TARIFA</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>ÚLTIMO USO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {convenioViendo.detalles.map((det: any, idx: number) => {
                            // El cruce usa el ID del documento del detalle, que es
                            // exactamente lo que la operación guarda en "convenioProveedor".
                            const idDet = String(det.id || '').trim();
                            const fechaUso = idDet ? (lastUsedDetalleMap[idDet] || '') : '';
                            const colorInactividadDetalle = obtenerColorInactividad(fechaUso);

                            return (
                              <tr key={idDet || idx} style={{ borderBottom: '1px solid #30363d' }}>
                                <td style={{ padding: '12px 16px', color: '#f0f6fc', fontSize: '0.85rem' }}>
                                  {det.tipoConvenioNombre || det.nombre || `Concepto ${idx + 1}`}
                                </td>
                                <td style={{ padding: '12px 16px', color: '#10b981', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                  ${Number(det.tarifa || 0).toFixed(2)}
                                </td>
                                <td style={{ padding: '12px 16px', color: '#c9d1d9', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span 
                                      title={fechaUso ? `Último uso: ${formatearFechaEsp(fechaUso)}` : 'Nunca usado'} 
                                      style={{ 
                                        width: '10px', 
                                        height: '10px', 
                                        borderRadius: '50%', 
                                        backgroundColor: colorInactividadDetalle, 
                                        display: 'inline-block', 
                                        flexShrink: 0, 
                                        boxShadow: `0 0 5px ${colorInactividadDetalle}` 
                                      }}>
                                    </span>
                                    {fechaUso ? formatearFechaEsp(fechaUso) : 'Nunca usado'}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTabDetalle === 'uso' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  {cargandoUso ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando el historial de detalles y rutas usadas...</div>
                  ) : operacionesUso.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e', backgroundColor: '#161b22', borderRadius: '8px' }}>
                      Este convenio aún no ha sido asociado a ninguna operación registrada.
                    </div>
                  ) : (
                    <>
                      <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '16px' }}>
                        Mostrando las operaciones más recientes donde se seleccionó este Convenio de Proveedor.
                      </p>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', backgroundColor: '#161b22', borderRadius: '8px', overflow: 'hidden' }}>
                        <thead style={{ backgroundColor: '#1f2937' }}>
                          <tr>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>REF. OPERACIÓN</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>FECHA</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>TARIFA/DETALLE APLICADO</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>RUTA (ORIGEN / DESTINO)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {operacionesUso.map(op => {
                            const detalleUsado = op.convenioProveedorNombre || op.convenioProveedorDetalleNombre || op.tarifaNombre || 'No especificado';
                            const ruta = (op.origenNombre || op.origen) && (op.destinoNombre || op.destino)
                              ? `${op.origenNombre || op.origen} → ${op.destinoNombre || op.destino}`
                              : '-';

                            return (
                              <tr key={op.id} style={{ borderBottom: '1px solid #30363d' }}>
                                <td style={{ padding: '12px 16px', color: '#58a6ff', fontFamily: 'monospace', fontWeight: 'bold' }}>{op.ref || op.id.substring(0,6)}</td>
                                <td style={{ padding: '12px 16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaEsp(op.fechaServicio || op.createdAt)}</td>
                                <td style={{ padding: '12px 16px', color: '#10b981', fontSize: '0.85rem' }}>{detalleUsado}</td>
                                <td style={{ padding: '12px 16px', color: '#c9d1d9', fontSize: '0.85rem' }}>{ruta}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

            </div>
            
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22', flexShrink: 0 }}>
              <button onClick={() => setConvenioViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ConveniosProveedoresDashboard;
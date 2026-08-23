// src/features/conveniosProveedores/components/ConveniosProveedoresDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs, query, where, limit, orderBy } from 'firebase/firestore';
import { db, eliminarRegistro, actualizarRegistro } from '../../../config/firebase'; 
import { FormularioConvenioProveedor } from './FormularioConvenioProveedor';
import type { ConvenioProveedorRecord } from '../../../types/convenioProveedor';
import './ConveniosProveedoresDashboard.css';

// ============================================================
// HELPER DE NORMALIZACIÓN PARA EL CRUCE
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

  // ✅ NUEVO (Cambio 2): edición / eliminación de detalles (tarifas) del convenio.
  const [detalleEditando, setDetalleEditando] = useState<any | null>(null);
  const [guardandoDetalle, setGuardandoDetalle] = useState(false);

  // Datos crudos en vivo — base para todos los cruces.
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [detallesGlobales, setDetallesGlobales] = useState<any[]>([]);

  // ✅ catálogo catalogo_tarifas_referencia indexado por id (carga directa).
  const [tarifasReferencia, setTarifasReferencia] = useState<Record<string, any>>({});
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'catalogo_tarifas_referencia'));
        const map: Record<string, any> = {};
        snap.docs.forEach(d => { map[String(d.id)] = { id: d.id, ...d.data() }; });
        setTarifasReferencia(map);
      } catch (err) {
        console.error('[ConveniosProveedoresDashboard] Error cargando catalogo_tarifas_referencia:', err);
        setTarifasReferencia({});
      }
    })();
  }, []);

  const [registrosGlobales, setRegistrosGlobales] = useState<ConvenioProveedorRecord[]>([]);
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // =========================================================
  // 1. CARGA EN TIEMPO REAL: CONVENIOS + DETALLES + OPERACIONES
  // =========================================================
  useEffect(() => {
    const unsubscribeConvenios = onSnapshot(collection(db, 'convenios_proveedores'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ConvenioProveedorRecord[];
      data.sort((a, b) => {
        const numA = parseInt((a.numeroConvenio || '').replace(/\D/g, ''), 10) || 0;
        const numB = parseInt((b.numeroConvenio || '').replace(/\D/g, ''), 10) || 0;
        return numB - numA;
      });
      setRegistrosGlobales(data);
    });

    const unsubscribeDetalles = onSnapshot(collection(db, 'convenios_proveedores_detalles'), (snap) => {
      setDetallesGlobales(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

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
  const detalleToConvenio = useMemo(() => {
    const m: Record<string, string> = {};
    detallesGlobales.forEach(d => {
      if (d.convenioId) m[String(d.id).trim()] = String(d.convenioId).trim();
    });
    return m;
  }, [detallesGlobales]);

  const convenioToProveedor = useMemo(() => {
    const m: Record<string, string> = {};
    registrosGlobales.forEach((c: any) => {
      if (c.proveedorId) m[String(c.id).trim()] = String(c.proveedorId).trim();
    });
    return m;
  }, [registrosGlobales]);

  // ✅ NUEVO (Cambio 3): cuántos convenios tiene cada proveedor.
  const conteoConveniosPorProveedor = useMemo(() => {
    const porId: Record<string, number> = {};
    const porNombre: Record<string, number> = {};
    registrosGlobales.forEach((c: any) => {
      const id = String(c.proveedorId || '').trim();
      const nom = String(c.proveedorNombre || '').trim().toLowerCase();
      if (id) porId[id] = (porId[id] || 0) + 1;
      if (nom) porNombre[nom] = (porNombre[nom] || 0) + 1;
    });
    return { porId, porNombre };
  }, [registrosGlobales]);

  const contarConveniosProveedor = (reg: any): number => {
    const id = String(reg?.proveedorId || '').trim();
    const nom = String(reg?.proveedorNombre || '').trim().toLowerCase();
    if (id && conteoConveniosPorProveedor.porId[id]) return conteoConveniosPorProveedor.porId[id];
    return conteoConveniosPorProveedor.porNombre[nom] || 0;
  };

  const lastUsedDetalleMap = useMemo(() => {
    const map: Record<string, string> = {};

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

      const idEnOp = op.convenioProveedor || op.convenioProveedorDetalleId;
      let cruzadoPorId = false;
      if (idEnOp && typeof idEnOp === 'string' && detalleToConvenio[String(idEnOp).trim()] !== undefined) {
        registrar(idEnOp, fecha);
        cruzadoPorId = true;
      }

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

  // ✅ Opciones del catálogo de tarifas para el selector del editor de detalle.
  const opcionesTarifas = useMemo(() => {
    return Object.entries(tarifasReferencia)
      .map(([id, data]: any) => ({ id, nombre: data?.descripcion || data?.nombre || id }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  }, [tarifasReferencia]);

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
      const qDetalles = query(collection(db, 'convenios_proveedores_detalles'), where('convenioId', '==', convenio.id));
      const snapDetalles = await getDocs(qDetalles);
      const detallesList = snapDetalles.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setConvenioViendo((prev: any) => ({ ...prev, detalles: detallesList }));

      const idsDetalles = new Set(detallesList.map(d => String(d.id).trim()));
      const nombresDetalles = new Set(
        detallesList
          .map(d => normalizar((d as any).tipoConvenioNombre || (d as any).nombre || (d as any).descripcion))
          .filter(Boolean)
      );
      const proveedorConvenio = String((convenio as any).proveedorId || '').trim();

      const opsFiltradas = operacionesGlobales.filter(op => {
        const idEnOp = String(op.convenioProveedor || op.convenioProveedorDetalleId || '').trim();
        if (idEnOp && idsDetalles.has(idEnOp)) return true;

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

  // ✅ NUEVO (Cambio 2): abrir editor de un detalle (tarifa) del convenio.
  const abrirEditorDetalle = (det: any) => {
    setDetalleEditando({
      ...det,
      tarifa: det.tarifa ?? '',
      costo: det.costo ?? '',
      venta: det.venta ?? '',
      tipoConvenioId: det.tipoConvenioId ?? '',
      tipoConvenioNombre: det.tipoConvenioNombre ?? '',
    });
  };

  // ✅ Guarda los cambios del detalle en convenios_proveedores_detalles.
  const guardarDetalleEditado = async () => {
    if (!detalleEditando) return;
    setGuardandoDetalle(true);
    try {
      const id = String(detalleEditando.id);
      const numOrUndef = (v: any) => (v === '' || v === null || v === undefined) ? undefined : Number(v);
      const payload: any = {
        tipoConvenioId: detalleEditando.tipoConvenioId || '',
        tipoConvenioNombre: detalleEditando.tipoConvenioNombre || '',
      };
      const t = numOrUndef(detalleEditando.tarifa);
      const c = numOrUndef(detalleEditando.costo);
      const v = numOrUndef(detalleEditando.venta);
      if (t !== undefined) payload.tarifa = t;
      if (c !== undefined) payload.costo = c;
      if (v !== undefined) payload.venta = v;

      await actualizarRegistro('convenios_proveedores_detalles', id, payload);

      setConvenioViendo((prev: any) => prev ? {
        ...prev,
        detalles: (prev.detalles || []).map((d: any) => d.id === id ? { ...d, ...payload } : d)
      } : prev);
      setDetalleEditando(null);
    } catch (error) {
      console.error('Error al guardar el detalle del convenio de proveedor:', error);
      alert('No se pudo guardar el detalle. Revisa tu conexión.');
    } finally {
      setGuardandoDetalle(false);
    }
  };

  // ✅ Elimina un detalle (tarifa) del convenio.
  const eliminarDetalle = async (det: any) => {
    const nombre = det.tipoConvenioNombre || det.nombre || 'esta tarifa';
    if (!window.confirm(`¿Eliminar el detalle "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await eliminarRegistro('convenios_proveedores_detalles', det.id);
      setConvenioViendo((prev: any) => prev ? {
        ...prev,
        detalles: (prev.detalles || []).filter((d: any) => d.id !== det.id)
      } : prev);
    } catch (error) {
      console.error('Error al eliminar el detalle del convenio de proveedor:', error);
      alert('No se pudo eliminar el detalle. Revisa tu conexión.');
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
    const encabezados = ['# de Convenio', 'Fecha del Convenio', 'Fecha de Vencimiento', 'Proveedor', 'Convenios del Proveedor', 'Moneda', 'Crédito', 'Último Uso'];
    const lineas = registrosFiltrados.map(r => [
      `"${r.numeroConvenio || ''}"`, `"${formatearFechaEsp(r.fechaConvenio)}"`, 
      `"${formatearFechaEsp(r.fechaVencimiento)}"`, `"${r.proveedorNombre || ''}"`, 
      `"${contarConveniosProveedor(r)}"`,
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
    <div className="module-container cpd-x1">
      
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

      <div className="cpd-x2">
        
        <h1 className="module-title cpd-x3">
          Convenios de Proveedores
        </h1>

        <div className="cpd-x4">
          
          <div className="cpd-x5">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${busqueda ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {busqueda && <span className="cpd-x6">1</span>}
            </button>
            {busqueda && (
              <span className="cpd-x7">
                "{busqueda}"
                <button className="cpd-x8" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="cpd-x9">
              {busquedaHecha ? `${registrosFiltrados.length} convenios` : 'Presiona Filtros y Buscar para ver los convenios.'}
            </span>
          </div>

          <div className="cpd-x10">
            <button 
              className="btn btn-outline cpd-x11" 
              title="Exportar a CSV"
              onClick={exportarCSV}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            {/* ✅ NUEVO (V00119): revisar convenios duplicados por proveedorId */}
          <button className="btn btn-outline" style={{ marginRight: '8px' }} title="Mostrar clientes/proveedores con más de un convenio" onClick={async () => {
            try {
              const snapDup = await getDocs(collection(db, 'convenios_proveedores'));
              const grupos: Record<string, string[]> = {};
              snapDup.docs.forEach((d) => { const x: any = d.data(); const k = String(x.proveedorId || ''); if (!k) return; (grupos[k] = grupos[k] || []).push(`${x.numeroConvenio || d.id} (${x.proveedorNombre || ''})`); });
              const dups = Object.values(grupos).filter((g) => g.length > 1);
              alert(dups.length === 0
                ? 'Sin duplicados: ningún registro tiene más de un convenio. ✅'
                : `DUPLICADOS ENCONTRADOS (${dups.length}):\n\n` + dups.map((g) => `• ${g.join('  |  ')}`).join('\n') + '\n\nElimina o une los sobrantes; desde V00119 ya no se pueden guardar nuevos duplicados.');
            } catch { alert('No se pudo revisar duplicados.'); }
          }}>Duplicados</button>
          <button 
              className="btn btn-primary cpd-x12" 
              title="Agregar Nuevo Convenio"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body cpd-x13">
          <div className="table-container cpd-x14">
            <table className="data-table cpd-x15">
              <thead className="cpd-x16">
                <tr>
                  <th className="cpd-x17">
                    Acciones
                  </th>
                  <th className="cpd-x18"># de Convenio</th>
                  <th className="cpd-x18">Fecha del convenio</th>
                  <th className="cpd-x18">Fecha de vencimiento</th>
                  <th className="cpd-x18">Proveedor</th>
                  <th className="cpd-x19">Convenios del Proveedor</th>
                  <th className="cpd-x18">Moneda</th>
                  <th className="cpd-x18">Crédito</th>
                  <th className="cpd-x18">Último Uso</th>
                </tr>
              </thead>
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="cpd-x20" colSpan={9}>
                    <div className="cpd-x21">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="cpd-x22">Define tus filtros y presiona <b className="cpd-x23">Buscar</b> para ver los convenios.</span>
                      <button className="cpd-x24" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="cpd-x25" colSpan={9}>
                      {busqueda ? 'No se encontraron convenios para tu búsqueda.' : 'Aún no hay convenios registrados. Haz clic en el botón de "+" para comenzar.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((reg) => {
                    const colorSemaforo = obtenerColorInactividad(reg._fechaDinamicaUso);
                    const numConvProv = contarConveniosProveedor(reg);

                    return (
                    <tr 
                      key={reg.id} 
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === reg.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(reg.id!)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => verDetalle(reg)}
                    >
                      <td className="cpd-x26" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell cpd-x27">
                          <button 
                            className="btn-small btn-edit cpd-x28" 
                            title="Editar Convenio"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(reg); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          <button 
                            className="btn-small btn-danger cpd-x29" 
                            title="Eliminar Convenio"
                            onClick={(e) => handleEliminar(e, reg.id!)}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      <td className="font-mono cpd-x30">
                        <div className="cpd-x31">
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
                          <span className="cpd-x32">{reg.numeroConvenio}</span>
                        </div>
                      </td>

                      <td className="cpd-x33">{formatearFechaEsp(reg.fechaConvenio)}</td>
                      <td className="cpd-x33">{formatearFechaEsp(reg.fechaVencimiento)}</td>
                      <td className="cpd-x34">{reg.proveedorNombre}</td>
                      <td className="cpd-x35">
                        <span className="cpd-x36" title={`Este proveedor tiene ${numConvProv} convenio(s) registrado(s)`}>
                          {numConvProv}
                        </span>
                      </td>
                      <td className="cpd-x33">{reg.monedaNombre}</td>
                      <td className="font-mono cpd-x33">{reg.credito}</td>
                      <td className="cpd-x33">
                        {reg._fechaDinamicaUso ? formatearFechaEsp(reg._fechaDinamicaUso) : '-'}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {busquedaHecha && registrosFiltrados.length > 0 && (
            <div className="cpd-x37">
              <div className="cpd-x38">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="cpd-x39">
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="cpd-x40">{paginaActual} / {totalPaginas || 1}</span>
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
        <div className="modal-overlay cpd-x41">
          <div className="form-card detail-card cpd-x42">
            
            <div className="form-header cpd-x43">
              <div>
                <h2 className="cpd-x44">Ficha de Convenio <span className="cpd-x23">{convenioViendo.numeroConvenio}</span></h2>
              </div>
              <button className="cpd-x45" onClick={() => setConvenioViendo(null)}>✕</button>
            </div>
            
            <div className="cpd-x46">
              <button type="button" onClick={() => setActiveTabDetalle('general')} style={tabStyle(activeTabDetalle === 'general')}>General</button>
              <button type="button" onClick={() => setActiveTabDetalle('detalles')} style={tabStyle(activeTabDetalle === 'detalles')}>Detalles / Tarifas</button>
              <button type="button" onClick={() => setActiveTabDetalle('uso')} style={tabStyle(activeTabDetalle === 'uso')}>Historial de Uso (Operaciones)</button>
            </div>

            <div className="detail-content cpd-x47">
              
              {activeTabDetalle === 'general' && (
                <div className="detail-grid cpd-x48">
                  <div className="detail-item cpd-x49">
                    <span className="detail-label cpd-x50">Proveedor</span>
                    <span className="detail-value cpd-x51">{convenioViendo.proveedorNombre || '-'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label cpd-x50">Estatus</span>
                    <span className="detail-value cpd-x52">
                      <span className={`dot dot-green`} style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }}></span>
                      {convenioViendo.status || 'Activo'}
                    </span>
                  </div>

                  <div className="detail-item cpd-x53">
                    <span className="detail-label cpd-x54">Convenios de este proveedor</span>
                    <span className="detail-value cpd-x51">
                      {contarConveniosProveedor(convenioViendo)} {contarConveniosProveedor(convenioViendo) === 1 ? 'convenio' : 'convenios'} registrado(s) para {convenioViendo.proveedorNombre || 'este proveedor'}
                    </span>
                  </div>
                  
                  <div className="detail-item">
                    <span className="detail-label cpd-x50">Fecha de Convenio</span>
                    <span className="detail-value cpd-x55">{formatearFechaEsp(convenioViendo.fechaConvenio)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label cpd-x50">Fecha de Vencimiento</span>
                    <span className="detail-value cpd-x55">{formatearFechaEsp(convenioViendo.fechaVencimiento)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label cpd-x50">Último Uso Operativo</span>
                    <span className="detail-value font-mono cpd-x56">
                      {lastUsedConvenioMap[convenioViendo.id]
                        ? formatearFechaEsp(lastUsedConvenioMap[convenioViendo.id])
                        : '-'}
                    </span>
                  </div>

                  <div className="detail-item cpd-x57"><hr className="cpd-x58" /></div>

                  <div className="detail-item">
                    <span className="detail-label cpd-x50">Moneda Base</span>
                    <span className="detail-value cpd-x55">{convenioViendo.monedaNombre || '-'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label cpd-x50">Días de Crédito</span>
                    <span className="detail-value font-mono cpd-x55">{convenioViendo.credito || '-'}</span>
                  </div>
                </div>
              )}

              {activeTabDetalle === 'detalles' && (
                <div className="cpd-x59">
                  <p className="cpd-x60">
                    Mostrando los detalles/tarifas del convenio y su último uso en base a las operaciones registradas. Usa los botones para editar o eliminar cada tarifa.
                  </p>
                  {(!convenioViendo.detalles || convenioViendo.detalles.length === 0) ? (
                    <div className="cpd-x61">
                      Este convenio no tiene detalles o tarifas registradas.
                    </div>
                  ) : (
                    <div className="cpd-x62">
                      <table className="cpd-x63">
                        <thead className="cpd-x64">
                          <tr>
                            <th className="cpd-x65">DESCRIPCIÓN / CONCEPTO</th>
                            <th className="cpd-x65">COSTO TARIFA</th>
                            <th className="cpd-x65">ÚLTIMO USO</th>
                            <th className="cpd-x66">ACCIONES</th>
                          </tr>
                        </thead>
                        <tbody>
                          {convenioViendo.detalles.map((det: any, idx: number) => {
                            const idDet = String(det.id || '').trim();
                            // Descripción real desde catalogo_tarifas_referencia (tipoConvenioId).
                            const refDoc = det.tipoConvenioId ? tarifasReferencia[String(det.tipoConvenioId)] : null;
                            const descMaster = refDoc?.descripcion || refDoc?.nombre || '';
                            const nomDet = det.tipoConvenioNombre || descMaster || det.nombre || det.descripcion;

                            const fechaUso = idDet ? (lastUsedDetalleMap[idDet] || '') : '';
                            const colorInactividadDetalle = obtenerColorInactividad(fechaUso);

                            return (
                              <tr className="cpd-x67" key={idDet || idx}>
                                <td className="cpd-x68">
                                  {nomDet || `Concepto ${idx + 1}`}
                                  {/* Cambio 1: ID del catálogo de tarifas (tipoConvenioId) */}
                                  <div className="cpd-x69">
                                    ID tarifa: {det.tipoConvenioId || '—'}
                                  </div>
                                </td>
                                <td className="cpd-x70">
                                  ${Number(det.tarifa || 0).toFixed(2)}
                                </td>
                                <td className="cpd-x71">
                                  <div className="cpd-x72">
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
                                {/* Cambio 2: editar y eliminar el detalle */}
                                <td className="cpd-x73">
                                  <div className="cpd-x27">
                                    <button className="cpd-x74"
                                      type="button"
                                      title="Editar detalle"
                                      onClick={() => abrirEditorDetalle(det)}
                                      onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                                      onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                    </button>
                                    <button className="cpd-x75"
                                      type="button"
                                      title="Eliminar detalle"
                                      onClick={() => eliminarDetalle(det)}
                                      onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                                      onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                    </button>
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
                <div className="cpd-x59">
                  {cargandoUso ? (
                    <div className="cpd-x76">Cargando el historial de detalles y rutas usadas...</div>
                  ) : operacionesUso.length === 0 ? (
                    <div className="cpd-x61">
                      Este convenio aún no ha sido asociado a ninguna operación registrada.
                    </div>
                  ) : (
                    <>
                      <p className="cpd-x60">
                        Mostrando las operaciones más recientes donde se seleccionó este Convenio de Proveedor.
                      </p>
                      <table className="cpd-x77">
                        <thead className="cpd-x64">
                          <tr>
                            <th className="cpd-x65">REF. OPERACIÓN</th>
                            <th className="cpd-x65">FECHA</th>
                            <th className="cpd-x65">TARIFA/DETALLE APLICADO</th>
                            <th className="cpd-x65">RUTA (ORIGEN / DESTINO)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {operacionesUso.map(op => {
                            const detalleUsado = op.convenioProveedorNombre || op.convenioProveedorDetalleNombre || op.tarifaNombre || 'No especificado';
                            const ruta = (op.origenNombre || op.origen) && (op.destinoNombre || op.destino)
                              ? `${op.origenNombre || op.origen} → ${op.destinoNombre || op.destino}`
                              : '-';

                            return (
                              <tr className="cpd-x67" key={op.id}>
                                <td className="cpd-x78">{op.ref || op.id.substring(0,6)}</td>
                                <td className="cpd-x79">{formatearFechaEsp(op.fechaServicio || op.createdAt)}</td>
                                <td className="cpd-x80">{detalleUsado}</td>
                                <td className="cpd-x81">{ruta}</td>
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
            
            <div className="cpd-x82">
              <button onClick={() => setConvenioViendo(null)} className="btn btn-outline cpd-x83">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* NUEVO (Cambio 2): MODAL EDITAR DETALLE / TARIFA */}
      {detalleEditando && (
        <div className="modal-overlay cpd-x84">
          <div className="form-card cpd-x85">
            <div className="cpd-x86">
              <h3 className="cpd-x87">Editar Detalle / Tarifa</h3>
              <button className="cpd-x45" onClick={() => setDetalleEditando(null)}>✕</button>
            </div>

            <div className="cpd-x88">
              <div>
                <label className="cpd-x89">Tipo de Convenio (Tarifa del catálogo)</label>
                <select className="cpd-x90"
                  value={detalleEditando.tipoConvenioId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    const data = tarifasReferencia[id];
                    const nombre = data?.descripcion || data?.nombre || '';
                    setDetalleEditando((prev: any) => prev ? { ...prev, tipoConvenioId: id, tipoConvenioNombre: nombre } : prev);
                  }}
                >
                  <option value="">-- Sin asignar --</option>
                  {detalleEditando.tipoConvenioId && !opcionesTarifas.some(o => o.id === detalleEditando.tipoConvenioId) && (
                    <option value={detalleEditando.tipoConvenioId}>{detalleEditando.tipoConvenioNombre || detalleEditando.tipoConvenioId} (actual)</option>
                  )}
                  {opcionesTarifas.map(o => (
                    <option key={o.id} value={o.id}>{o.nombre}</option>
                  ))}
                </select>
                <small className="cpd-x91">ID tarifa: {detalleEditando.tipoConvenioId || '—'}</small>
              </div>

              <div className="cpd-x92">
                <div>
                  <label className="cpd-x93">Tarifa ($)</label>
                  <input className="cpd-x94"
                    type="number"
                    step="0.01"
                    value={detalleEditando.tarifa}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, tarifa: e.target.value } : prev)}
                  />
                </div>
                <div>
                  <label className="cpd-x89">Costo ($)</label>
                  <input className="cpd-x90"
                    type="number"
                    step="0.01"
                    value={detalleEditando.costo}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, costo: e.target.value } : prev)}
                  />
                </div>
                <div>
                  <label className="cpd-x89">Venta ($)</label>
                  <input className="cpd-x90"
                    type="number"
                    step="0.01"
                    value={detalleEditando.venta}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, venta: e.target.value } : prev)}
                  />
                </div>
              </div>
              <small className="cpd-x95">
                Deja en blanco los montos que no apliquen. Si el detalle usa una sola "Tarifa", captura solo ese campo; si usa "Costo / Venta", captura esos dos.
              </small>
            </div>

            <div className="cpd-x96">
              <button className="cpd-x97" type="button" onClick={() => setDetalleEditando(null)} disabled={guardandoDetalle}>Cancelar</button>
              <button className="cpd-x98" type="button" onClick={guardarDetalleEditado} disabled={guardandoDetalle}>{guardandoDetalle ? 'Guardando...' : 'Guardar Detalle'}</button>
            </div>
          </div>
        </div>
      )}


      {/* NUEVO: panel lateral DERECHO de filtros (Convenios de Proveedores) */}
      {drawerFiltrosAbierto && (
        <div className="cpd-x99" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="cpd-x100" onClick={(e) => e.stopPropagation()}>
            <div className="cpd-x101">
              <h3 className="cpd-x102">Filtros · Convenios de Proveedores</h3>
              <button className="cpd-x45" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="cpd-x103">
              <label className="cpd-x104">BÚSQUEDA</label>
              <div className="cpd-x105">
                <svg className="cpd-x106" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="cpd-x107" type="text" placeholder="# Convenio, proveedor, fechas..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="cpd-x108" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="cpd-x109">
              La búsqueda es <b className="cpd-x110">opcional</b>. Presiona <b className="cpd-x23">Buscar</b> para ver todos los convenios.
            </div>

            <div className="cpd-x111">
              <button className="cpd-x112" onClick={() => { setBusqueda(''); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="cpd-x113" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConveniosProveedoresDashboard;
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs, query, where, limit, orderBy, writeBatch, doc } from 'firebase/firestore';
import { db, eliminarRegistro, actualizarRegistro } from '../../../config/firebase'; 
import { FormularioConvenioCliente } from './FormularioConvenioCliente';
import { registrarLog } from '../../../utils/logger';
// ✅ NUEVO (Cambio 1): helper cacheado para resolver tipoConvenioId → descripcion
import { obtenerTarifasReferencia } from '../services/tarifasReferenciaService';
import './ConveniosClientesDashboard.css';
import { hoyLocalISO, fechaLocalISO } from '../../../utils/fechaHoraLocal';

// ============================================================
// HELPERS DE CRUCE (NORMALIZACIÓN)
// ============================================================
const normalizar = (texto: any): string => {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // quita acentos
};

export const ConveniosClientesDashboard: React.FC = () => {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [registroEditando, setRegistroEditando] = useState<any | null>(null);
  
  const [convenioViendo, setConvenioViendo] = useState<any | null>(null);
  const [activeTabDetalle, setActiveTabDetalle] = useState<'general' | 'detalles' | 'uso'>('general');
  const [operacionesUso, setOperacionesUso] = useState<any[]>([]);
  const [cargandoUso, setCargandoUso] = useState(false);

  // ✅ NUEVO (Cambio 2): edición / eliminación de detalles (tarifas) del convenio.
  const [detalleEditando, setDetalleEditando] = useState<any | null>(null);
  const [guardandoDetalle, setGuardandoDetalle] = useState(false);

  // Todas las operaciones (en vivo) — base para todos los cruces.
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  // Todos los detalles de convenios (en vivo): doc de convenios_clientes_detalles.
  const [detallesGlobales, setDetallesGlobales] = useState<any[]>([]);

  // ✅ catálogo catalogo_tarifas_referencia indexado por id.
  const [tarifasReferencia, setTarifasReferencia] = useState<Record<string, any>>({});
  useEffect(() => {
    obtenerTarifasReferencia()
      .then(setTarifasReferencia)
      .catch((err) => {
        console.error('[ConveniosClientesDashboard] Error cargando catalogo_tarifas_referencia:', err);
        setTarifasReferencia({});
      });
  }, []);

  const [modalBajaAbierto, setModalBajaAbierto] = useState(false);
  const [convenioParaBaja, setConvenioParaBaja] = useState<any | null>(null);
  const [fechaBaja, setFechaBaja] = useState(hoyLocalISO());
  const [observacionesBaja, setObservacionesBaja] = useState('');
  const [guardandoBaja, setGuardandoBaja] = useState(false);

  const [registrosGlobales, setRegistrosGlobales] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  const [filtroActivo, setFiltroActivo] = useState('Todo');
  
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // =========================================================
  // 1. CARGA EN TIEMPO REAL: CONVENIOS + DETALLES + OPERACIONES
  // =========================================================
  useEffect(() => {
    const unsubscribeConvenios = onSnapshot(collection(db, 'convenios_clientes'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a: any, b: any) => {
        const numA = parseInt((a.numeroConvenio || '').replace(/\D/g, ''), 10) || 0;
        const numB = parseInt((b.numeroConvenio || '').replace(/\D/g, ''), 10) || 0;
        return numB - numA;
      });
      setRegistrosGlobales(data);
    });

    const unsubscribeDetalles = onSnapshot(collection(db, 'convenios_clientes_detalles'), (snap) => {
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
  // 2. ÍNDICES DE CRUCE ROBUSTOS
  // =========================================================
  const detalleToConvenio = useMemo(() => {
    const m: Record<string, string> = {};
    detallesGlobales.forEach(d => {
      if (d.convenioId) m[String(d.id).trim()] = String(d.convenioId).trim();
    });
    return m;
  }, [detallesGlobales]);

  const convenioToCliente = useMemo(() => {
    const m: Record<string, string> = {};
    registrosGlobales.forEach(c => {
      if (c.clienteId) m[String(c.id).trim()] = String(c.clienteId).trim();
    });
    return m;
  }, [registrosGlobales]);

  // ✅ NUEVO (Cambio 3): cuántos convenios tiene cada cliente.
  //   Se cuenta por clienteId (preferente) y también por nombre (respaldo).
  const conteoConveniosPorCliente = useMemo(() => {
    const porId: Record<string, number> = {};
    const porNombre: Record<string, number> = {};
    registrosGlobales.forEach(c => {
      const id = String(c.clienteId || '').trim();
      const nom = String(c.clienteNombre || '').trim().toLowerCase();
      if (id) porId[id] = (porId[id] || 0) + 1;
      if (nom) porNombre[nom] = (porNombre[nom] || 0) + 1;
    });
    return { porId, porNombre };
  }, [registrosGlobales]);

  const contarConveniosCliente = (reg: any): number => {
    const id = String(reg?.clienteId || '').trim();
    const nom = String(reg?.clienteNombre || '').trim().toLowerCase();
    if (id && conteoConveniosPorCliente.porId[id]) return conteoConveniosPorCliente.porId[id];
    return conteoConveniosPorCliente.porNombre[nom] || 0;
  };

  const lastUsedDetalleMap = useMemo(() => {
    const map: Record<string, string> = {};

    const nombreIndex: Record<string, string[]> = {};
    detallesGlobales.forEach(d => {
      const idDet = String(d.id).trim();
      const convId = detalleToConvenio[idDet];
      const cliId = convId ? (convenioToCliente[convId] || '') : '';
      const nom = normalizar(
        d.tipoConvenioNombre || d.tarifaNombre || d.nombre || d.descripcion
      );
      if (!nom) return;
      const key = `${cliId}|${nom}`;
      if (!nombreIndex[key]) nombreIndex[key] = [];
      nombreIndex[key].push(idDet);
      const keySinCliente = `|${nom}`;
      if (!nombreIndex[keySinCliente]) nombreIndex[keySinCliente] = [];
      nombreIndex[keySinCliente].push(idDet);
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

      const idEnOp = op.convenio || op.convenioTarifa || op.convenioTarifaId || op.tarifaId;
      let cruzadoPorId = false;
      if (idEnOp && typeof idEnOp === 'string' && detalleToConvenio[String(idEnOp).trim()] !== undefined) {
        registrar(idEnOp, fecha);
        cruzadoPorId = true;
      }

      if (!cruzadoPorId) {
        const nombreOp = normalizar(
          op.convenioNombre || op.convenioTarifaNombre || op.tarifaNombre || op.convenioTarifa
        );
        if (nombreOp) {
          const cliOp = String(op.clientePaga || op.clienteId || '').trim();
          let candidatos = nombreIndex[`${cliOp}|${nombreOp}`];
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
  }, [operacionesGlobales, detallesGlobales, detalleToConvenio, convenioToCliente]);

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
  // 3. REGISTROS LISTOS (con fecha dinámica de uso)
  // =========================================================
  const registrosListos = useMemo(() => {
    return registrosGlobales.map(reg => ({
      ...reg,
      _fechaDinamicaUso: lastUsedConvenioMap[reg.id] || reg.fechaUltimoUso || '',
      status: reg.status || 'Activo'
    }));
  }, [registrosGlobales, lastUsedConvenioMap]);

  // =========================================================
  // 4. SINCRONIZACIÓN AUTOMÁTICA DE STATUS (Semáforo > 90 días)
  // =========================================================
  useEffect(() => {
    const syncStatusAutomatico = async () => {
      if (registrosListos.length === 0) return;
      const batch = writeBatch(db);
      let updates = 0;
      const hoy = new Date();

      registrosListos.forEach(reg => {
        const statusActual = reg.status || 'Activo';
        const fechaUso = reg._fechaDinamicaUso; 
        if (!fechaUso) return;

        const diffTime = hoy.getTime() - new Date(fechaUso + 'T00:00:00').getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays > 90 && statusActual === 'Activo') {
          batch.update(doc(db, 'convenios_clientes', reg.id), {
            status: 'Baja',
            fechaBaja: fechaLocalISO(hoy),
            observacionesBaja: 'Sistema: Baja automática por inactividad mayor a 90 días (Semáforo Rojo).'
          });
          updates++;
        } 
        else if (diffDays <= 90 && statusActual === 'Baja' && reg.observacionesBaja?.includes('Sistema: Baja automática')) {
          batch.update(doc(db, 'convenios_clientes', reg.id), {
            status: 'Activo',
            fechaBaja: '',
            observacionesBaja: ''
          });
          updates++;
        }
      });

      if (updates > 0) {
        try {
          await batch.commit();
        } catch (error) {
        }
      }
    };

    const timer = setTimeout(syncStatusAutomatico, 2500);
    return () => clearTimeout(timer);
  }, [registrosListos]);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, filtroActivo]);

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
  
  const editarRegistro = (registro: any) => { 
    setRegistroEditando(registro); 
    setEstadoFormulario('abierto'); 
  };

  // =========================================================
  // 5. FICHA DE DETALLE
  // =========================================================
  const verDetalle = async (convenio: any) => {
    setConvenioViendo({ ...convenio, detalles: [] }); 
    setActiveTabDetalle('general');
    setCargandoUso(true);
    setOperacionesUso([]);

    try {
      const qDetalles = query(collection(db, 'convenios_clientes_detalles'), where('convenioId', '==', convenio.id));
      const snapDetalles = await getDocs(qDetalles);
      const detallesList = snapDetalles.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setConvenioViendo((prev: any) => ({ ...prev, detalles: detallesList }));

      const idsDetalles = new Set(detallesList.map(d => String(d.id).trim()));
      const nombresDetalles = new Set(
        detallesList
          .map(d => normalizar((d as any).tipoConvenioNombre || (d as any).tarifaNombre || (d as any).nombre || (d as any).descripcion))
          .filter(Boolean)
      );
      const clienteConvenio = String(convenio.clienteId || '').trim();

      const opsFiltradas = operacionesGlobales.filter(op => {
        const idEnOp = String(op.convenio || op.convenioTarifa || op.convenioTarifaId || op.tarifaId || '').trim();
        if (idEnOp && idsDetalles.has(idEnOp)) return true;

        const nombreOp = normalizar(op.convenioNombre || op.convenioTarifaNombre || op.tarifaNombre || op.convenioTarifa);
        if (!nombreOp || !nombresDetalles.has(nombreOp)) return false;
        const cliOp = String(op.clientePaga || op.clienteId || '').trim();
        return !clienteConvenio || !cliOp || cliOp === clienteConvenio;
      });

      opsFiltradas.sort((a: any, b: any) => 
        new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime()
      );
      
      setOperacionesUso(opsFiltradas.slice(0, 50));
    } catch (error) {
      console.error("Error cargando ficha del convenio:", error);
    } finally {
      setCargandoUso(false);
    }
  };

  const handleEliminar = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); 
    if (window.confirm('¿Estás seguro de que deseas eliminar permanentemente este convenio?')) {
      try {
        await eliminarRegistro('convenios_clientes', id);
        await registrarLog('Convenios', 'Eliminación', `Eliminó permanentemente un convenio de cliente.`);
      } catch (error) {
        alert('Hubo un error al eliminar. Revisa tu conexión.');
      }
    }
  };

  // ✅ NUEVO (Cambio 2): abrir el editor de un detalle (tarifa) del convenio.
  const abrirEditorDetalle = (det: any) => {
    setDetalleEditando({
      ...det,
      tarifa: det.tarifa ?? '',
      costo: det.costo ?? '',
      venta: det.venta ?? '',
      origenNombre: det.origenNombre ?? det.origen ?? '',
      destinoNombre: det.destinoNombre ?? det.destino ?? '',
      tipoConvenioId: det.tipoConvenioId ?? '',
      tipoConvenioNombre: det.tipoConvenioNombre ?? '',
    });
  };

  // ✅ Guarda los cambios del detalle en convenios_clientes_detalles.
  const guardarDetalleEditado = async () => {
    if (!detalleEditando) return;
    setGuardandoDetalle(true);
    try {
      const id = String(detalleEditando.id);
      const numOrUndef = (v: any) => (v === '' || v === null || v === undefined) ? undefined : Number(v);

      const payload: any = {
        tipoConvenioId: detalleEditando.tipoConvenioId || '',
        tipoConvenioNombre: detalleEditando.tipoConvenioNombre || '',
        origenNombre: detalleEditando.origenNombre || '',
        destinoNombre: detalleEditando.destinoNombre || '',
      };
      const t = numOrUndef(detalleEditando.tarifa);
      const c = numOrUndef(detalleEditando.costo);
      const v = numOrUndef(detalleEditando.venta);
      if (t !== undefined) payload.tarifa = t;
      if (c !== undefined) payload.costo = c;
      if (v !== undefined) payload.venta = v;

      await actualizarRegistro('convenios_clientes_detalles', id, payload);

      // Refleja el cambio en la ficha abierta (sin esperar al onSnapshot).
      setConvenioViendo((prev: any) => prev ? {
        ...prev,
        detalles: (prev.detalles || []).map((d: any) => d.id === id ? { ...d, ...payload } : d)
      } : prev);

      await registrarLog('Convenios', 'Edición', `Editó un detalle/tarifa del convenio ${convenioViendo?.numeroConvenio || ''}.`);
      setDetalleEditando(null);
    } catch (error) {
      console.error('Error al guardar el detalle del convenio:', error);
      alert('No se pudo guardar el detalle. Revisa tu conexión.');
    } finally {
      setGuardandoDetalle(false);
    }
  };

  // ✅ Elimina un detalle (tarifa) del convenio.
  const eliminarDetalle = async (det: any) => {
    const nombre = det.tipoConvenioNombre || det.tarifaNombre || det.nombre || 'esta tarifa';
    if (!window.confirm(`¿Eliminar el detalle "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await eliminarRegistro('convenios_clientes_detalles', det.id);
      setConvenioViendo((prev: any) => prev ? {
        ...prev,
        detalles: (prev.detalles || []).filter((d: any) => d.id !== det.id)
      } : prev);
      await registrarLog('Convenios', 'Eliminación', `Eliminó un detalle/tarifa del convenio ${convenioViendo?.numeroConvenio || ''}.`);
    } catch (error) {
      console.error('Error al eliminar el detalle del convenio:', error);
      alert('No se pudo eliminar el detalle. Revisa tu conexión.');
    }
  };

  const abrirModalBaja = (convenio: any) => {
    setConvenioParaBaja(convenio);
    setFechaBaja(hoyLocalISO());
    setObservacionesBaja('');
    setModalBajaAbierto(true);
  };

  const confirmarBaja = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoBaja(true);
    try {
      await actualizarRegistro('convenios_clientes', convenioParaBaja.id, {
        status: 'Baja',
        fechaBaja: fechaBaja,
        observacionesBaja: observacionesBaja
      });
      await registrarLog('Convenios', 'Edición', `Dio de baja al convenio: ${convenioParaBaja.numeroConvenio}`);
      
      if (convenioViendo && convenioViendo.id === convenioParaBaja.id) {
        setConvenioViendo({ ...convenioViendo, status: 'Baja', fechaBaja, observacionesBaja });
      }
      setModalBajaAbierto(false);
    } catch (error) {
      alert("Error al dar de baja. Revisa tu conexión.");
    } finally {
      setGuardandoBaja(false);
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

  const registrosFiltrados = useMemo(() => {
    return registrosListos.filter(reg => {
      let pasaFiltro = true;
      if (filtroActivo === 'Activos') pasaFiltro = reg.status !== 'Baja';
      else if (filtroActivo === 'Bajas') pasaFiltro = reg.status === 'Baja';
      
      if (!pasaFiltro) return false;

      if (!busqueda.trim()) return true;
      const b = busqueda.toLowerCase();
      return (
        String(reg.numeroConvenio || '').toLowerCase().includes(b) ||
        String(reg.clienteNombre || '').toLowerCase().includes(b) ||
        String(reg.monedaNombre || '').toLowerCase().includes(b) ||
        formatearFechaEsp(reg.fechaConvenio).toLowerCase().includes(b) ||
        formatearFechaEsp(reg.fechaVencimiento).toLowerCase().includes(b)
      );
    });
  }, [registrosListos, filtroActivo, busqueda]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  const exportarCSV = () => {
    if (registrosFiltrados.length === 0) return alert("No hay datos para exportar.");
    
    const encabezados = ['# de Convenio', 'Fecha del Convenio', 'Fecha de Vencimiento', 'Cliente', 'Convenios del Cliente', 'Moneda', 'Crédito', 'Último Uso', 'Status'];
    const lineas = registrosFiltrados.map(r => [
      `"${r.numeroConvenio || ''}"`, 
      `"${formatearFechaEsp(r.fechaConvenio)}"`, 
      `"${formatearFechaEsp(r.fechaVencimiento)}"`, 
      `"${r.clienteNombre || ''}"`, 
      `"${contarConveniosCliente(r)}"`,
      `"${r.monedaNombre || ''}"`, 
      `"${r.credito || ''}"`,
      `"${r._fechaDinamicaUso ? formatearFechaEsp(r._fechaDinamicaUso) : 'Nunca usado'}"`,
      `"${r.status || 'Activo'}"`
    ].join(','));
    
    const csvContent = [encabezados.join(','), ...lineas].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Convenios_Clientes_${hoyLocalISO()}.csv`);
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
    <div className="module-container ccd-x1">
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioConvenioCliente 
          estado={estadoFormulario} 
          initialData={registroEditando}
          registrosExistentes={registrosGlobales}
          onClose={() => { setEstadoFormulario('cerrado'); setRegistroEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} 
          onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      <div className="ccd-x2">
        
        <h1 className="module-title ccd-x3">
          Convenios de Clientes
        </h1>

        <div className="ccd-x4">
          
          <div className="ccd-x5">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busqueda || filtroActivo !== 'Todo') ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(busqueda || filtroActivo !== 'Todo') && <span className="ccd-x6">{[busqueda, filtroActivo !== 'Todo' ? filtroActivo : ''].filter(Boolean).length}</span>}
            </button>
            {filtroActivo !== 'Todo' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: filtroActivo === 'Activos' ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)', border: `1px solid ${filtroActivo === 'Activos' ? '#3fb950' : '#f85149'}`, borderRadius: '14px', color: filtroActivo === 'Activos' ? '#3fb950' : '#f85149', fontSize: '0.8rem', fontWeight: 'bold' }}>
                {filtroActivo}
                <button className="ccd-x7" onClick={() => setFiltroActivo('Todo')}>✕</button>
              </span>
            )}
            {busqueda && (
              <span className="ccd-x8">
                "{busqueda}"
                <button className="ccd-x9" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="ccd-x10">
              {busquedaHecha ? `${registrosFiltrados.length} convenios` : 'Presiona Filtros y Buscar para ver los convenios.'}
            </span>
          </div>

          <div className="ccd-x11">
            <button 
              className="btn btn-outline ccd-x12" 
              title="Exportar a CSV"
              onClick={exportarCSV}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            {/* ✅ NUEVO (V00119): revisar convenios duplicados por clienteId */}
          <button className="btn btn-outline" style={{ marginRight: '8px' }} title="Mostrar clientes/proveedores con más de un convenio" onClick={async () => {
            try {
              const snapDup = await getDocs(collection(db, 'convenios_clientes'));
              const grupos: Record<string, string[]> = {};
              snapDup.docs.forEach((d) => { const x: any = d.data(); const k = String(x.clienteId || ''); if (!k) return; (grupos[k] = grupos[k] || []).push(`${x.numeroConvenio || d.id} (${x.clienteNombre || ''})`); });
              const dups = Object.values(grupos).filter((g) => g.length > 1);
              alert(dups.length === 0
                ? 'Sin duplicados: ningún registro tiene más de un convenio. ✅'
                : `DUPLICADOS ENCONTRADOS (${dups.length}):\n\n` + dups.map((g) => `• ${g.join('  |  ')}`).join('\n') + '\n\nElimina o une los sobrantes; desde V00119 ya no se pueden guardar nuevos duplicados.');
            } catch { alert('No se pudo revisar duplicados.'); }
          }}>Duplicados</button>
          {/* ✅ NUEVO (V00123): recarga catálogos y referencias (monedas, tarifas) */}
          <button className="btn btn-outline" style={{ marginRight: '8px' }} title="Actualizar referencias: limpia cachés de catálogos y recarga" onClick={() => {
            try { Object.keys(localStorage).filter((k) => k.startsWith('cat_v2__') || k.startsWith('cat_v1__')).forEach((k) => localStorage.removeItem(k)); } catch { /* sin almacenamiento */ }
            window.location.reload();
          }}>↻ Referencias</button>
          <button 
              className="btn btn-primary ccd-x13" 
              title="Agregar Nuevo Convenio"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body ccd-x14">
          <div className="table-container ccd-x15">
            <table className="data-table ccd-x16">
              <thead className="ccd-x17">
                <tr>
                  <th className="ccd-x18">
                    ACCIONES
                  </th>
                  <th className="ccd-x19"># DE CONVENIO</th>
                  <th className="ccd-x19">FECHA DEL CONVENIO</th>
                  <th className="ccd-x19">FECHA DE VENCIMIENTO</th>
                  <th className="ccd-x19">CLIENTE</th>
                  <th className="ccd-x20">CONVENIOS DEL CLIENTE</th>
                  <th className="ccd-x19">MONEDA</th>
                  <th className="ccd-x19">CRÉDITO</th>
                  <th className="ccd-x19">ÚLTIMO USO</th>
                </tr>
              </thead>
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="ccd-x21" colSpan={9}>
                    <div className="ccd-x22">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="ccd-x23">Define tus filtros y presiona <b className="ccd-x24">Buscar</b> para ver los convenios.</span>
                      <button className="ccd-x25" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="ccd-x26" colSpan={9}>
                      {busqueda || filtroActivo !== 'Todo' ? 'No se encontraron convenios para tu búsqueda.' : 'Aún no hay convenios registrados. Haz clic en "+" para comenzar.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((reg) => {
                    const colorSemaforo = obtenerColorInactividad(reg._fechaDinamicaUso);
                    const numConvCliente = contarConveniosCliente(reg);
                    
                    return (
                    <tr 
                      key={reg.id} 
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === reg.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(reg.id!)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => verDetalle(reg)}
                    >
                      <td className="ccd-x27" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell ccd-x28">
                          <button 
                            className="btn-small btn-edit ccd-x29" 
                            title="Editar Convenio"
                            onClick={(e) => { e.stopPropagation(); editarRegistro(reg); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>

                          {reg.status !== 'Baja' && (
                            <button 
                              className="btn-small btn-warning ccd-x30" 
                              title="Dar de Baja"
                              onClick={(e) => { e.stopPropagation(); abrirModalBaja(reg); }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                            </button>
                          )}

                          <button 
                            className="btn-small btn-danger ccd-x31" 
                            title="Eliminar Convenio"
                            onClick={(e) => handleEliminar(e, reg.id!)}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      <td className="font-mono ccd-x32">
                        <div className="ccd-x33">
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
                          <span style={{ textDecoration: reg.status === 'Baja' ? 'line-through' : 'none', color: reg.status === 'Baja' ? '#ef4444' : '#f0f6fc' }}>
                            {reg.numeroConvenio}
                          </span>
                        </div>
                      </td>

                      <td className="ccd-x34">{formatearFechaEsp(reg.fechaConvenio)}</td>
                      <td className="ccd-x34">{formatearFechaEsp(reg.fechaVencimiento)}</td>
                      <td className="ccd-x35">
                        {reg.clienteNombre} {reg.status === 'Baja' && <span className="ccd-x36">BAJA</span>}
                      </td>
                      <td className="ccd-x37">
                        <span className="ccd-x38" title={`Este cliente tiene ${numConvCliente} convenio(s) registrado(s)`}>
                          {numConvCliente}
                        </span>
                      </td>
                      <td className="ccd-x34">{reg.monedaNombre}</td>
                      <td className="font-mono ccd-x34">{reg.credito}</td>
                      
                      <td className="ccd-x34">
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
            <div className="ccd-x39">
              <div className="ccd-x40">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="ccd-x41">
                <button 
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  title="Página Anterior"
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span className="ccd-x42">{paginaActual} / {totalPaginas || 1}</span>
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

      {convenioViendo && (
        <div className="modal-overlay ccd-x43">
          <div className="form-card detail-card ccd-x44">
            
            <div className="form-header ccd-x45">
              <div>
                <h2 className="ccd-x46">Ficha de Convenio <span className="ccd-x24">{convenioViendo.numeroConvenio}</span></h2>
                {convenioViendo.status === 'Baja' && (
                  <span className="ccd-x47">
                    DADO DE BAJA EL {formatearFechaEsp(convenioViendo.fechaBaja)}
                  </span>
                )}
              </div>
              <button className="ccd-x48" onClick={() => setConvenioViendo(null)}>✕</button>
            </div>
            
            <div className="ccd-x49">
              <button type="button" onClick={() => setActiveTabDetalle('general')} style={tabStyle(activeTabDetalle === 'general')}>General</button>
              <button type="button" onClick={() => setActiveTabDetalle('detalles')} style={tabStyle(activeTabDetalle === 'detalles')}>Detalles / Tarifas</button>
              <button type="button" onClick={() => setActiveTabDetalle('uso')} style={tabStyle(activeTabDetalle === 'uso')}>Historial de Uso (Operaciones)</button>
            </div>

            <div className="detail-content ccd-x50">
              
              {activeTabDetalle === 'general' && (
                <div className="detail-grid ccd-x51">
                  <div className="detail-item ccd-x52">
                    <span className="detail-label ccd-x53">Cliente</span>
                    <span className="detail-value ccd-x54">{convenioViendo.clienteNombre || '-'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label ccd-x53">Estatus</span>
                    <span className="detail-value ccd-x55">
                      <span className={`dot ${convenioViendo.status === 'Activo' ? 'dot-green' : 'dot-red'}`} style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: convenioViendo.status === 'Activo' ? '#10b981' : '#ef4444', display: 'inline-block' }}></span>
                      {convenioViendo.status || 'Activo'}
                    </span>
                  </div>

                  <div className="detail-item ccd-x56">
                    <span className="detail-label ccd-x57">Convenios de este cliente</span>
                    <span className="detail-value ccd-x54">
                      {contarConveniosCliente(convenioViendo)} {contarConveniosCliente(convenioViendo) === 1 ? 'convenio' : 'convenios'} registrado(s) para {convenioViendo.clienteNombre || 'este cliente'}
                    </span>
                  </div>
                  
                  <div className="detail-item">
                    <span className="detail-label ccd-x53">Fecha de Convenio</span>
                    <span className="detail-value ccd-x58">{formatearFechaEsp(convenioViendo.fechaConvenio)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label ccd-x53">Fecha de Vencimiento</span>
                    <span className="detail-value ccd-x58">{formatearFechaEsp(convenioViendo.fechaVencimiento)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label ccd-x53">Último Uso Operativo</span>
                    <span className="detail-value font-mono ccd-x59">
                      {lastUsedConvenioMap[convenioViendo.id]
                        ? formatearFechaEsp(lastUsedConvenioMap[convenioViendo.id])
                        : '-'}
                    </span>
                  </div>

                  <div className="detail-item ccd-x60"><hr className="ccd-x61" /></div>

                  <div className="detail-item">
                    <span className="detail-label ccd-x53">Moneda Base</span>
                    <span className="detail-value ccd-x58">{convenioViendo.monedaNombre || '-'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label ccd-x53">Días de Crédito</span>
                    <span className="detail-value font-mono ccd-x58">{convenioViendo.credito || '-'}</span>
                  </div>

                  {convenioViendo.status === 'Baja' && (
                    <div className="ccd-x62">
                      <div className="detail-item ccd-x63"><span className="detail-label ccd-x64">Fecha de Baja</span><span className="detail-value ccd-x58">{formatearFechaEsp(convenioViendo.fechaBaja)}</span></div>
                      <div className="detail-item"><span className="detail-label ccd-x64">Observaciones de Baja</span><span className="detail-value ccd-x58">{convenioViendo.observacionesBaja || '-'}</span></div>
                    </div>
                  )}
                </div>
              )}

              {activeTabDetalle === 'detalles' && (
                <div className="ccd-x65">
                  <p className="ccd-x66">
                    Mostrando los detalles/tarifas del convenio y su último uso en base a las operaciones registradas. Usa los botones para editar o eliminar cada tarifa.
                  </p>
                  {(!convenioViendo.detalles || convenioViendo.detalles.length === 0) ? (
                    <div className="ccd-x67">
                      Este convenio no tiene detalles o tarifas registradas.
                    </div>
                  ) : (
                    <div className="ccd-x68">
                      <table className="ccd-x69">
                        <thead className="ccd-x70">
                          <tr>
                            <th className="ccd-x71">DESCRIPCIÓN / TARIFA</th>
                            <th className="ccd-x71">RUTA</th>
                            <th className="ccd-x71">COSTO / VENTA</th>
                            <th className="ccd-x71">ÚLTIMO USO</th>
                            <th className="ccd-x72">ACCIONES</th>
                          </tr>
                        </thead>
                        <tbody>
                          {convenioViendo.detalles.map((det: any, idx: number) => {
                            const idDet = String(det.id || '').trim();
                            // Descripción real desde catalogo_tarifas_referencia (tipoConvenioId).
                            const refDoc = det.tipoConvenioId ? tarifasReferencia[String(det.tipoConvenioId)] : null;
                            const descMaster = refDoc?.descripcion || refDoc?.nombre || '';
                            const nomDet = det.tipoConvenioNombre || descMaster || det.tarifaNombre || det.nombre || det.tipoOperacionNombre || det.tipoServicio;

                            const fechaUso = idDet ? (lastUsedDetalleMap[idDet] || '') : '';
                            const colorInactividadDetalle = obtenerColorInactividad(fechaUso);

                            return (
                              <tr className="ccd-x73" key={idDet || idx}>
                                <td className="ccd-x74">
                                  {nomDet || `Tarifa ${idx + 1}`}
                                  {/* Cambio 1: ID del catálogo de tarifas (tipoConvenioId) */}
                                  <div className="ccd-x75">
                                    ID tarifa: {det.tipoConvenioId || '—'}
                                  </div>
                                </td>
                                <td className="ccd-x76">
                                  {det.origenNombre || det.origen || '-'} → {det.destinoNombre || det.destino || '-'}
                                </td>
                                <td className="ccd-x77">
                                  {det.tarifa !== undefined && det.tarifa !== null && det.tarifa !== '' ? `$${det.tarifa}` : `C: $${det.costo || 0} / V: $${det.venta || 0}`}
                                </td>
                                <td className="ccd-x78">
                                  <div className="ccd-x79">
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
                                <td className="ccd-x80">
                                  <div className="ccd-x28">
                                    <button className="ccd-x81"
                                      type="button"
                                      title="Editar detalle"
                                      onClick={() => abrirEditorDetalle(det)}
                                      onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                                      onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                    </button>
                                    <button className="ccd-x82"
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
                <div className="ccd-x65">
                  {cargandoUso ? (
                    <div className="ccd-x83">Cargando el historial de detalles y rutas usadas...</div>
                  ) : operacionesUso.length === 0 ? (
                    <div className="ccd-x67">
                      Este convenio aún no ha sido asociado a ninguna operación registrada.
                    </div>
                  ) : (
                    <>
                      <p className="ccd-x66">
                        Mostrando las operaciones más recientes donde se seleccionó este Convenio y sus Detalles (Tarifas).
                      </p>
                      <table className="ccd-x84">
                        <thead className="ccd-x70">
                          <tr>
                            <th className="ccd-x71">REF. OPERACIÓN</th>
                            <th className="ccd-x71">FECHA</th>
                            <th className="ccd-x71">TARIFA/DETALLE APLICADO</th>
                            <th className="ccd-x71">RUTA (ORIGEN / DESTINO)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {operacionesUso.map(op => {
                            const detalleUsado = op.convenioNombre || op.convenioTarifaNombre || op.tarifaNombre || op.convenioTarifa || 'No especificado';
                            const ruta = (op.origenNombre || op.origen) && (op.destinoNombre || op.destino)
                              ? `${op.origenNombre || op.origen} → ${op.destinoNombre || op.destino}`
                              : '-';

                            return (
                              <tr className="ccd-x73" key={op.id}>
                                <td className="ccd-x85">{op.ref || op.id.substring(0,6)}</td>
                                <td className="ccd-x86">{formatearFechaEsp(op.fechaServicio || op.createdAt)}</td>
                                <td className="ccd-x87">{detalleUsado}</td>
                                <td className="ccd-x76">{ruta}</td>
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
            
            <div className="ccd-x88">
              <button onClick={() => setConvenioViendo(null)} className="btn btn-outline ccd-x89">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* NUEVO (Cambio 2): MODAL EDITAR DETALLE / TARIFA */}
      {detalleEditando && (
        <div className="modal-overlay ccd-x90">
          <div className="form-card ccd-x91">
            <div className="ccd-x92">
              <h3 className="ccd-x93">Editar Detalle / Tarifa</h3>
              <button className="ccd-x48" onClick={() => setDetalleEditando(null)}>✕</button>
            </div>

            <div className="ccd-x94">
              <div>
                <label className="ccd-x95">Tipo de Convenio (Tarifa del catálogo)</label>
                <select className="ccd-x96"
                  value={detalleEditando.tipoConvenioId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    const data = tarifasReferencia[id];
                    const nombre = data?.descripcion || data?.nombre || '';
                    setDetalleEditando((prev: any) => prev ? { ...prev, tipoConvenioId: id, tipoConvenioNombre: nombre } : prev);
                  }}
                >
                  <option value="">-- Sin asignar --</option>
                  {/* Si el ID actual no está en el catálogo, lo mostramos igual para no perderlo */}
                  {detalleEditando.tipoConvenioId && !opcionesTarifas.some(o => o.id === detalleEditando.tipoConvenioId) && (
                    <option value={detalleEditando.tipoConvenioId}>{detalleEditando.tipoConvenioNombre || detalleEditando.tipoConvenioId} (actual)</option>
                  )}
                  {opcionesTarifas.map(o => (
                    <option key={o.id} value={o.id}>{o.nombre}</option>
                  ))}
                </select>
                <small className="ccd-x97">ID tarifa: {detalleEditando.tipoConvenioId || '—'}</small>
              </div>

              <div className="ccd-x98">
                <div>
                  <label className="ccd-x95">Origen</label>
                  <input className="ccd-x96"
                    type="text"
                    value={detalleEditando.origenNombre || ''}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, origenNombre: e.target.value } : prev)}
                  />
                </div>
                <div>
                  <label className="ccd-x95">Destino</label>
                  <input className="ccd-x96"
                    type="text"
                    value={detalleEditando.destinoNombre || ''}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, destinoNombre: e.target.value } : prev)}
                  />
                </div>
              </div>

              <div className="ccd-x99">
                <div>
                  <label className="ccd-x100">Tarifa ($)</label>
                  <input className="ccd-x101"
                    type="number"
                    step="0.01"
                    value={detalleEditando.tarifa}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, tarifa: e.target.value } : prev)}
                  />
                </div>
                <div>
                  <label className="ccd-x95">Costo ($)</label>
                  <input className="ccd-x96"
                    type="number"
                    step="0.01"
                    value={detalleEditando.costo}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, costo: e.target.value } : prev)}
                  />
                </div>
                <div>
                  <label className="ccd-x95">Venta ($)</label>
                  <input className="ccd-x96"
                    type="number"
                    step="0.01"
                    value={detalleEditando.venta}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, venta: e.target.value } : prev)}
                  />
                </div>
              </div>
              <small className="ccd-x102">
                Deja en blanco los montos que no apliquen. Si el detalle usa una sola "Tarifa", captura solo ese campo; si usa "Costo / Venta", captura esos dos.
              </small>
            </div>

            <div className="ccd-x103">
              <button className="ccd-x104" type="button" onClick={() => setDetalleEditando(null)} disabled={guardandoDetalle}>Cancelar</button>
              <button className="ccd-x105" type="button" onClick={guardarDetalleEditado} disabled={guardandoDetalle}>{guardandoDetalle ? 'Guardando...' : 'Guardar Detalle'}</button>
            </div>
          </div>
        </div>
      )}

      {modalBajaAbierto && (
        <div className="modal-overlay ccd-x106">
          <div className="form-card modal-content ccd-x107">
            <h3 className="ccd-x108">Dar de baja Convenio</h3>
            <p className="ccd-x109">Vas a dar de baja el convenio: <strong>{convenioParaBaja?.numeroConvenio}</strong></p>
            <form onSubmit={confirmarBaja}>
              <div className="form-group ccd-x110">
                <label className="ccd-x111">Fecha de Baja *</label>
                <input 
                  type="date" 
                  className="form-control ccd-x96" 
                  value={fechaBaja} 
                  onChange={(e) => setFechaBaja(e.target.value)} 
                  required
                />
              </div>
              <div className="form-group ccd-x112">
                <label className="ccd-x111">Observaciones (Opcional)</label>
                <textarea 
                  className="form-control ccd-x96" 
                  rows={3} 
                  value={observacionesBaja} 
                  onChange={(e) => setObservacionesBaja(e.target.value)} 
                  placeholder="Ej: Finalizó contrato comercial..."
                />
              </div>
              <div className="form-actions ccd-x113">
                <button type="button" className="btn btn-outline ccd-x114" onClick={() => setModalBajaAbierto(false)} disabled={guardandoBaja}>Cancelar</button>
                <button type="submit" className="btn btn-danger ccd-x115" disabled={guardandoBaja}>
                  {guardandoBaja ? 'Guardando...' : 'Confirmar Baja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NUEVO: panel lateral DERECHO de filtros (Convenios de Clientes) */}
      {drawerFiltrosAbierto && (
        <div className="ccd-x116" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="ccd-x117" onClick={(e) => e.stopPropagation()}>
            <div className="ccd-x118">
              <h3 className="ccd-x119">Filtros · Convenios de Clientes</h3>
              <button className="ccd-x48" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="ccd-x120">
              <label className="ccd-x121">BÚSQUEDA</label>
              <div className="ccd-x122">
                <svg className="ccd-x123" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="ccd-x124" type="text" placeholder="# Convenio, cliente, fechas..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="ccd-x125" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="ccd-x120">
              <label className="ccd-x126">STATUS</label>
              <div className="ccd-x127">
                <button onClick={() => setFiltroActivo('Todo')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroActivo === 'Todo' ? 'rgba(88,166,255,0.15)' : 'transparent', color: filtroActivo === 'Todo' ? '#58a6ff' : '#8b949e' }}>Todos</button>
                <button onClick={() => setFiltroActivo('Activos')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroActivo === 'Activos' ? 'rgba(63,185,80,0.15)' : 'transparent', color: filtroActivo === 'Activos' ? '#3fb950' : '#8b949e' }}>● Activos</button>
                <button onClick={() => setFiltroActivo('Bajas')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroActivo === 'Bajas' ? 'rgba(248,81,73,0.15)' : 'transparent', color: filtroActivo === 'Bajas' ? '#f85149' : '#8b949e' }}>● Bajas</button>
              </div>
            </div>

            <div className="ccd-x128">
              Todos los campos son <b className="ccd-x129">opcionales</b>. Presiona <b className="ccd-x24">Buscar</b> para ver todos los convenios.
            </div>

            <div className="ccd-x130">
              <button className="ccd-x131" onClick={() => { setBusqueda(''); setFiltroActivo('Todo'); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="ccd-x132" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConveniosClientesDashboard;
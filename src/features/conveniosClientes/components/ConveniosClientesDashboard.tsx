import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs, query, where, limit, orderBy, writeBatch, doc } from 'firebase/firestore';
import { db, eliminarRegistro, actualizarRegistro } from '../../../config/firebase'; 
import { FormularioConvenioCliente } from './FormularioConvenioCliente';
import { registrarLog } from '../../../utils/logger';
// ✅ NUEVO (Cambio 1): helper cacheado para resolver tipoConvenioId → descripcion
import { obtenerTarifasReferencia } from '../services/tarifasReferenciaService';

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
  const [fechaBaja, setFechaBaja] = useState(new Date().toISOString().split('T')[0]);
  const [observacionesBaja, setObservacionesBaja] = useState('');
  const [guardandoBaja, setGuardandoBaja] = useState(false);

  const [registrosGlobales, setRegistrosGlobales] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState('');
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
            fechaBaja: hoy.toISOString().split('T')[0],
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
    setFechaBaja(new Date().toISOString().split('T')[0]);
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
    link.setAttribute('download', `Convenios_Clientes_${new Date().toISOString().split('T')[0]}.csv`);
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
        <FormularioConvenioCliente 
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
          Convenios de Clientes
        </h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '120px' }}>
            <select 
              className="form-control" 
              value={filtroActivo} 
              onChange={(e) => setFiltroActivo(e.target.value)}
              style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '10px', borderRadius: '6px' }}
            >
              <option value="Todo">Filtro: Todos</option>
              <option value="Activos">Convenios Activos</option>
              <option value="Bajas">Convenios en Baja</option>
            </select>
          </div>

          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Buscar por # Convenio, Cliente, Fechas..." 
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
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary" 
              title="Agregar Nuevo Convenio"
              onClick={handleNuevo} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px', backgroundColor: '#D84315', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            <table className="data-table" style={{ width: '100%', minWidth: '1000px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
                    ACCIONES
                  </th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}># DE CONVENIO</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>FECHA DEL CONVENIO</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>FECHA DE VENCIMIENTO</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>CLIENTE</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d', textAlign: 'center' }}>CONVENIOS DEL CLIENTE</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>MONEDA</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>CRÉDITO</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>ÚLTIMO USO</th>
                </tr>
              </thead>
              <tbody>
                {registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
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

                          {reg.status !== 'Baja' && (
                            <button 
                              className="btn-small btn-warning" 
                              title="Dar de Baja"
                              onClick={(e) => { e.stopPropagation(); abrirModalBaja(reg); }}
                              style={{ background: 'transparent', border: '1px solid #f59e0b', borderRadius: '4px', color: '#f59e0b', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                            </button>
                          )}

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
                          <span style={{ textDecoration: reg.status === 'Baja' ? 'line-through' : 'none', color: reg.status === 'Baja' ? '#ef4444' : '#f0f6fc' }}>
                            {reg.numeroConvenio}
                          </span>
                        </div>
                      </td>

                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatearFechaEsp(reg.fechaConvenio)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{formatearFechaEsp(reg.fechaVencimiento)}</td>
                      <td style={{ padding: '16px', color: '#f0f6fc', fontSize: '0.95rem', fontWeight: '500', whiteSpace: 'nowrap' }}>
                        {reg.clienteNombre} {reg.status === 'Baja' && <span style={{ fontSize: '0.7rem', border: '1px solid #ef4444', color: '#ef4444', padding: '2px 4px', borderRadius: '4px', marginLeft: '6px' }}>BAJA</span>}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span title={`Este cliente tiene ${numConvCliente} convenio(s) registrado(s)`} style={{ display: 'inline-block', minWidth: '28px', padding: '3px 10px', borderRadius: '12px', backgroundColor: 'rgba(88,166,255,0.12)', border: '1px solid #58a6ff', color: '#58a6ff', fontWeight: 'bold', fontSize: '0.85rem' }}>
                          {numConvCliente}
                        </span>
                      </td>
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

      {convenioViendo && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1000, position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div className="form-card detail-card" style={{ maxWidth: '850px', width: '100%', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.25rem' }}>Ficha de Convenio <span style={{ color: '#D84315' }}>{convenioViendo.numeroConvenio}</span></h2>
                {convenioViendo.status === 'Baja' && (
                  <span style={{ display: 'inline-block', marginTop: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    DADO DE BAJA EL {formatearFechaEsp(convenioViendo.fechaBaja)}
                  </span>
                )}
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
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Cliente</span>
                    <span className="detail-value" style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{convenioViendo.clienteNombre || '-'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Estatus</span>
                    <span className="detail-value" style={{ color: '#c9d1d9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`dot ${convenioViendo.status === 'Activo' ? 'dot-green' : 'dot-red'}`} style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: convenioViendo.status === 'Activo' ? '#10b981' : '#ef4444', display: 'inline-block' }}></span>
                      {convenioViendo.status || 'Activo'}
                    </span>
                  </div>

                  <div className="detail-item" style={{ gridColumn: 'span 3', backgroundColor: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.3)', borderRadius: '8px', padding: '12px 16px' }}>
                    <span className="detail-label" style={{ color: '#58a6ff', fontSize: '0.85rem', display:'block', fontWeight: 'bold' }}>Convenios de este cliente</span>
                    <span className="detail-value" style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>
                      {contarConveniosCliente(convenioViendo)} {contarConveniosCliente(convenioViendo) === 1 ? 'convenio' : 'convenios'} registrado(s) para {convenioViendo.clienteNombre || 'este cliente'}
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

                  {convenioViendo.status === 'Baja' && (
                    <div style={{ gridColumn: 'span 3', backgroundColor: 'rgba(239, 68, 68, 0.05)', padding: '16px', borderRadius: '8px', border: '1px dashed #ef4444', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '16px' }}>
                      <div className="detail-item" style={{ marginBottom: '0' }}><span className="detail-label" style={{ color: '#ef4444', fontSize: '0.8rem', display:'block' }}>Fecha de Baja</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{formatearFechaEsp(convenioViendo.fechaBaja)}</span></div>
                      <div className="detail-item"><span className="detail-label" style={{ color: '#ef4444', fontSize: '0.8rem', display:'block' }}>Observaciones de Baja</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{convenioViendo.observacionesBaja || '-'}</span></div>
                    </div>
                  )}
                </div>
              )}

              {activeTabDetalle === 'detalles' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '16px' }}>
                    Mostrando los detalles/tarifas del convenio y su último uso en base a las operaciones registradas. Usa los botones para editar o eliminar cada tarifa.
                  </p>
                  {(!convenioViendo.detalles || convenioViendo.detalles.length === 0) ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e', backgroundColor: '#161b22', borderRadius: '8px' }}>
                      Este convenio no tiene detalles o tarifas registradas.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', minWidth: '760px', borderCollapse: 'collapse', textAlign: 'left', backgroundColor: '#161b22', borderRadius: '8px', overflow: 'hidden' }}>
                        <thead style={{ backgroundColor: '#1f2937' }}>
                          <tr>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>DESCRIPCIÓN / TARIFA</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>RUTA</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>COSTO / VENTA</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold' }}>ÚLTIMO USO</th>
                            <th style={{ padding: '12px 16px', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textAlign: 'center' }}>ACCIONES</th>
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
                              <tr key={idDet || idx} style={{ borderBottom: '1px solid #30363d' }}>
                                <td style={{ padding: '12px 16px', color: '#f0f6fc', fontSize: '0.85rem' }}>
                                  {nomDet || `Tarifa ${idx + 1}`}
                                  {/* ✅ Cambio 1: ID del catálogo de tarifas (tipoConvenioId) */}
                                  <div style={{ fontSize: '0.7rem', color: '#fb923c', marginTop: '4px', fontFamily: 'monospace' }}>
                                    ID tarifa: {det.tipoConvenioId || '—'}
                                  </div>
                                </td>
                                <td style={{ padding: '12px 16px', color: '#c9d1d9', fontSize: '0.85rem' }}>
                                  {det.origenNombre || det.origen || '-'} → {det.destinoNombre || det.destino || '-'}
                                </td>
                                <td style={{ padding: '12px 16px', color: '#10b981', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                  {det.tarifa !== undefined && det.tarifa !== null && det.tarifa !== '' ? `$${det.tarifa}` : `C: $${det.costo || 0} / V: $${det.venta || 0}`}
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
                                {/* ✅ Cambio 2: editar y eliminar el detalle */}
                                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                    <button
                                      type="button"
                                      title="Editar detalle"
                                      onClick={() => abrirEditorDetalle(det)}
                                      style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                      onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                                      onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                    </button>
                                    <button
                                      type="button"
                                      title="Eliminar detalle"
                                      onClick={() => eliminarDetalle(det)}
                                      style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                        Mostrando las operaciones más recientes donde se seleccionó este Convenio y sus Detalles (Tarifas).
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
                            const detalleUsado = op.convenioNombre || op.convenioTarifaNombre || op.tarifaNombre || op.convenioTarifa || 'No especificado';
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

      {/* ✅ NUEVO (Cambio 2): MODAL EDITAR DETALLE / TARIFA */}
      {detalleEditando && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1200, position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div className="form-card" style={{ maxWidth: '560px', width: '100%', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '12px', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '14px' }}>
              <h3 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.1rem' }}>Editar Detalle / Tarifa</h3>
              <button onClick={() => setDetalleEditando(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', color: '#8b949e', marginBottom: '6px', fontSize: '0.85rem' }}>Tipo de Convenio (Tarifa del catálogo)</label>
                <select
                  value={detalleEditando.tipoConvenioId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    const data = tarifasReferencia[id];
                    const nombre = data?.descripcion || data?.nombre || '';
                    setDetalleEditando((prev: any) => prev ? { ...prev, tipoConvenioId: id, tipoConvenioNombre: nombre } : prev);
                  }}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' }}
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
                <small style={{ color: '#fb923c', fontFamily: 'monospace', fontSize: '0.7rem' }}>ID tarifa: {detalleEditando.tipoConvenioId || '—'}</small>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', color: '#8b949e', marginBottom: '6px', fontSize: '0.85rem' }}>Origen</label>
                  <input
                    type="text"
                    value={detalleEditando.origenNombre || ''}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, origenNombre: e.target.value } : prev)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', color: '#8b949e', marginBottom: '6px', fontSize: '0.85rem' }}>Destino</label>
                  <input
                    type="text"
                    value={detalleEditando.destinoNombre || ''}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, destinoNombre: e.target.value } : prev)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', color: '#10b981', marginBottom: '6px', fontSize: '0.85rem', fontWeight: 'bold' }}>Tarifa ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={detalleEditando.tarifa}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, tarifa: e.target.value } : prev)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#10b981', fontWeight: 'bold', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', color: '#8b949e', marginBottom: '6px', fontSize: '0.85rem' }}>Costo ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={detalleEditando.costo}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, costo: e.target.value } : prev)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', color: '#8b949e', marginBottom: '6px', fontSize: '0.85rem' }}>Venta ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={detalleEditando.venta}
                    onChange={(e) => setDetalleEditando((prev: any) => prev ? { ...prev, venta: e.target.value } : prev)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              <small style={{ color: '#8b949e', fontSize: '0.75rem' }}>
                Deja en blanco los montos que no apliquen. Si el detalle usa una sola "Tarifa", captura solo ese campo; si usa "Costo / Venta", captura esos dos.
              </small>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button type="button" onClick={() => setDetalleEditando(null)} disabled={guardandoDetalle} style={{ padding: '9px 20px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
              <button type="button" onClick={guardarDetalleEditado} disabled={guardandoDetalle} style={{ padding: '9px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardandoDetalle ? 'Guardando...' : 'Guardar Detalle'}</button>
            </div>
          </div>
        </div>
      )}

      {modalBajaAbierto && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1100, position: 'fixed', inset: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div className="form-card modal-content" style={{ maxWidth: '400px', width: '100%', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '8px', padding: '24px' }}>
            <h3 style={{ color: '#ef4444', marginTop: 0 }}>Dar de baja Convenio</h3>
            <p style={{ color: '#c9d1d9', fontSize: '0.9rem' }}>Vas a dar de baja el convenio: <strong>{convenioParaBaja?.numeroConvenio}</strong></p>
            <form onSubmit={confirmarBaja}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#8b949e', marginBottom: '8px', fontSize: '0.9rem' }}>Fecha de Baja *</label>
                <input 
                  type="date" 
                  className="form-control" 
                  value={fechaBaja} 
                  onChange={(e) => setFechaBaja(e.target.value)} 
                  required 
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: '#8b949e', marginBottom: '8px', fontSize: '0.9rem' }}>Observaciones (Opcional)</label>
                <textarea 
                  className="form-control" 
                  rows={3} 
                  value={observacionesBaja} 
                  onChange={(e) => setObservacionesBaja(e.target.value)} 
                  placeholder="Ej: Finalizó contrato comercial..."
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' }}
                />
              </div>
              <div className="form-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setModalBajaAbierto(false)} disabled={guardandoBaja} style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" className="btn btn-danger" disabled={guardandoBaja} style={{ padding: '8px 16px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                  {guardandoBaja ? 'Guardando...' : 'Confirmar Baja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConveniosClientesDashboard;
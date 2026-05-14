// src/features/diesel/components/ReferenciasDieselDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  getDocs, 
  where, 
  writeBatch, 
  doc, 
  limit,
  orderBy
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

export const ReferenciasDieselDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'referencias'>('referencias');
  
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [referenciasGlobales, setReferenciasGlobales] = useState<any[]>([]);
  
  // Catálogos
  const [unidadesList, setUnidadesList] = useState<any[]>([]);
  const [operadoresList, setOperadoresList] = useState<any[]>([]);
  const [proveedoresList, setProveedoresList] = useState<any[]>([]);

  const [filtroUnidad, setFiltroUnidad] = useState('');
  const [filtroOperador, setFiltroOperador] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const [busquedaRef, setBusquedaRef] = useState('');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [referenciaViendo, setReferenciaViendo] = useState<any | null>(null);

  const [operacionAEditar, setOperacionAEditar] = useState<any | null>(null);
  const [editCombustibleOp, setEditCombustibleOp] = useState<number | ''>('');
  const [guardandoEdicionOp, setGuardandoEdicionOp] = useState(false);

  const [fechaForm, setFechaForm] = useState(new Date().toISOString().split('T')[0]);
  const [consecutivoForm, setConsecutivoForm] = useState('');
  const [galonesAutorizados, setGalonesAutorizados] = useState<number | ''>('');
  const [galonesCargados, setGalonesCargados] = useState<number | ''>('');
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState('');
  const [costoDieselDiario, setCostoDieselDiario] = useState<number>(0);
  const [observacionesForm, setObservacionesForm] = useState('');

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // ✅ 1. CARGAMOS REFERENCIAS Y CATÁLOGOS LIGEROS
  useEffect(() => {
    const qRefs = query(collection(db, 'referencias_diesel'), orderBy('createdAt', 'desc'), limit(400));
    const unSubReferencias = onSnapshot(qRefs, (snap) => {
      const refs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      refs.sort((a: any, b: any) => {
        const seqA = parseInt((a.consecutivo || '').split('-').pop() || '0', 10);
        const seqB = parseInt((b.consecutivo || '').split('-').pop() || '0', 10);
        return seqB - seqA; 
      });
      setReferenciasGlobales(refs);
    });

    const unSubUnidades = onSnapshot(collection(db, 'unidades'), (snap) => {
      setUnidadesList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubEmpleados = onSnapshot(collection(db, 'empleados'), (snap) => {
      setOperadoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unSubEmpresas = onSnapshot(collection(db, 'empresas'), (snap) => {
      setProveedoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    return () => { unSubReferencias(); unSubUnidades(); unSubEmpleados(); unSubEmpresas(); };
  }, []);

  // ✅ 2. LAZY LOAD DE OPERACIONES
  useEffect(() => {
    if (activeTab !== 'operaciones') return;

    const qOps = query(collection(db, 'operaciones'), limit(400));
    const unSubOperaciones = onSnapshot(qOps, (snap) => {
      const ops = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      ops.sort((a: any, b: any) => new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime());
      setOperacionesGlobales(ops);
    });

    return () => { unSubOperaciones(); };
  }, [activeTab]);

  // ✅ 3. OBTENER COSTO DIÉSEL
  useEffect(() => {
    if (!fechaForm || !proveedorSeleccionado || activeTab !== 'operaciones') {
      setCostoDieselDiario(0);
      return;
    }
    
    const fetchCosto = async () => {
      try {
        const q = query(
          collection(db, 'combustibles'), 
          where('fecha', '==', fechaForm),
          where('proveedorId', '==', proveedorSeleccionado)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          setCostoDieselDiario(Number(snap.docs[0].data().costo || 0));
        } else {
          setCostoDieselDiario(0);
        }
      } catch (error) {
        console.error("Error obteniendo el costo del diesel:", error);
        setCostoDieselDiario(0);
      }
    };
    fetchCosto();
  }, [fechaForm, proveedorSeleccionado, activeTab]);

  const generarConsecutivo = (fechaStr: string) => {
    const [year, month, day] = fechaStr.split('-');
    const aa = year.slice(2);
    const prefix = `DIESEL-${day}${month}${aa}-`;
    const referenciasHoy = referenciasGlobales.filter(r => r.consecutivo?.startsWith(prefix));
    let maxSeq = 0;
    referenciasHoy.forEach(r => {
      const parts = r.consecutivo.split('-');
      if (parts.length === 3) {
        const seq = parseInt(parts[2], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  const getNombreUnidad = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = unidadesList.find(u => u.id === idOrName || u.unidad === idOrName || u.nombre === idOrName);
    return found ? (found.unidad || found.nombre || found.numeroEconomico || idOrName) : idOrName;
  };

  const getNombreOperador = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = operadoresList.find(o => o.id === idOrName || `${o.firstName} ${o.lastNamePaternal}`.trim() === idOrName.trim());
    return found ? `${found.firstName || ''} ${found.lastNamePaternal || ''}`.trim() : idOrName;
  };

  const getNombreProveedor = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = proveedoresList.find(p => p.id === idOrName || p.nombre === idOrName);
    return found ? found.nombre : idOrName;
  };

  const formatearFechaSpanish = (fechaString: string) => {
    if (!fechaString) return '-';
    try { 
      return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }); 
    } 
    catch { return fechaString; }
  };

  const unidadesOptions = useMemo(() => {
    const names = operacionesGlobales
      .filter(op => !op.referenciaDieselId)
      .map(op => getNombreUnidad(op.unidadNombre || op.unidadId || op.unidad))
      .filter(n => n && n !== '-');
    return Array.from(new Set(names)).sort();
  }, [operacionesGlobales, unidadesList]);

  const operadoresOptions = useMemo(() => {
    const names = operadoresList
      .filter(emp => emp.cargoId === 'edda3a2b') 
      .map(emp => `${emp.firstName || ''} ${emp.lastNamePaternal || ''}`.trim())
      .filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [operadoresList]);

  const proveedoresFiltrados = useMemo(() => {
    return proveedoresList.filter(p => {
      const tieneTipoEmpresa = Array.isArray(p.tiposEmpresa) && p.tiposEmpresa.includes('11894dfd');
      const tieneTipoServicio = Array.isArray(p.tiposServicio) && p.tiposServicio.includes('189a4573');
      return tieneTipoEmpresa && tieneTipoServicio;
    });
  }, [proveedoresList]);

  const operacionesPendientes = useMemo(() => {
    if (!filtroUnidad) return []; 
    return operacionesGlobales.filter(op => {
      const opUnidad = getNombreUnidad(op.unidadNombre || op.unidadId || op.unidad || '');
      const opOperador = getNombreOperador(op.operadorNombre || op.operadorId || op.operador || '');
      const noAsignada = !op.referenciaDieselId;
      
      const matchUnidad = opUnidad === filtroUnidad;
      const matchOperador = filtroOperador ? opOperador === filtroOperador : true; 

      return matchUnidad && matchOperador && noAsignada;
    });
  }, [operacionesGlobales, filtroUnidad, filtroOperador, unidadesList, operadoresList]);

  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const resumenSeleccion = useMemo(() => {
    let dieselTotal = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        dieselTotal += Number(op.combustibleTotal || 0);
        refs.push(op.ref || op.id?.substring(0,6));
      }
    });
    return { dieselTotal, refs };
  }, [seleccionadas, operacionesGlobales]);

  // ✅ GALONES CALCULADOS = EXACTAMENTE LA SUMA DE COMBUSTIBLE DE LAS OPERACIONES (No dividido)
  const galonesCalculadosOp = resumenSeleccion.dieselTotal;

  // ✅ CÁLCULO DINÁMICO DEL STATUS
  const statusReferenciaForm = useMemo(() => {
    const authVacio = galonesAutorizados === '' || galonesAutorizados === 0 || isNaN(galonesAutorizados as number);
    const cargVacio = galonesCargados === '' || galonesCargados === 0 || isNaN(galonesCargados as number);

    if (authVacio && cargVacio) return 'No Autorizado';
    if (!authVacio && cargVacio) return 'Autorizado';
    return 'Cargado'; 
  }, [galonesAutorizados, galonesCargados]);

  const handleGuardarReferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proveedorSeleccionado) return alert("Selecciona un proveedor.");
    setGuardando(true);
    try {
      const batch = writeBatch(db);
      const nuevoRefId = doc(collection(db, 'referencias_diesel')).id;
      const consecutivoFinal = generarConsecutivo(fechaForm);

      const foundUni = unidadesList.find(u => u.unidad === filtroUnidad || u.nombre === filtroUnidad);
      const foundOp = operadoresList.find(o => `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim() === filtroOperador.trim());

      const data = {
        consecutivo: consecutivoFinal,
        fecha: fechaForm,
        unidadId: foundUni ? foundUni.id : null,
        unidadNombre: filtroUnidad, 
        operadorId: foundOp ? foundOp.id : null,
        operadorNombre: filtroOperador, 
        operacionesIds: seleccionadas,
        sumaDiesel: resumenSeleccion.dieselTotal,
        galonesCalculadosOperaciones: galonesCalculadosOp, // Guardamos la suma directa
        galonesAutorizados: Number(galonesAutorizados),
        galonesCargados: Number(galonesCargados),
        proveedorId: proveedorSeleccionado,
        proveedorNombre: getNombreProveedor(proveedorSeleccionado),
        costoDiesel: costoDieselDiario,
        totalAutorizado: Number(galonesAutorizados) * costoDieselDiario,
        totalCargado: Number(galonesCargados) * costoDieselDiario,
        observaciones: observacionesForm,
        status: statusReferenciaForm, 
        createdAt: new Date().toISOString()
      };

      batch.set(doc(db, 'referencias_diesel', nuevoRefId), data);
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { referenciaDieselId: nuevoRefId, referenciaDieselConsecutivo: consecutivoFinal });
      });

      await batch.commit();
      setModalAbierto(false);
      setSeleccionadas([]);
      
      // Limpiamos los campos
      setGalonesAutorizados('');
      setGalonesCargados('');
      setObservacionesForm('');
      setProveedorSeleccionado('');
      
      setActiveTab('referencias');
    } catch (error) {
      alert("Error al guardar.");
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarReferencia = async (e: React.MouseEvent, refData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar la referencia ${refData.consecutivo}? Las operaciones asociadas volverán a estar disponibles.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'referencias_diesel', refData.id));

        if (Array.isArray(refData.operacionesIds)) {
          refData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), {
              referenciaDieselId: null,
              referenciaDieselConsecutivo: null
            });
          });
        }
        await batch.commit();
      } catch (error) {
        console.error("Error al eliminar referencia:", error);
        alert("Hubo un error al eliminar.");
      }
    }
  };

  const handleActualizarOperacion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operacionAEditar || !referenciaViendo) return;

    setGuardandoEdicionOp(true);
    try {
      const batch = writeBatch(db);
      const combustibleNuevo = Number(editCombustibleOp) || 0;
      const combustibleViejo = Number(operacionAEditar.combustibleTotal || 0);
      
      batch.update(doc(db, 'operaciones', operacionAEditar.id), {
        combustibleTotal: combustibleNuevo
      });

      const diferencia = combustibleNuevo - combustibleViejo;
      const nuevaSumaReferencia = Number(referenciaViendo.sumaDiesel || 0) + diferencia;

      // Actualiza en base de datos tanto la suma original como el cálculo (que son iguales)
      batch.update(doc(db, 'referencias_diesel', referenciaViendo.id), {
        sumaDiesel: nuevaSumaReferencia,
        galonesCalculadosOperaciones: nuevaSumaReferencia 
      });

      await batch.commit();

      setReferenciaViendo({ 
        ...referenciaViendo, 
        sumaDiesel: nuevaSumaReferencia,
        galonesCalculadosOperaciones: nuevaSumaReferencia
      });
      setOperacionAEditar(null);
      
    } catch (error) {
      console.error("Error al actualizar la operación:", error);
      alert("Hubo un error al guardar la modificación.");
    } finally {
      setGuardandoEdicionOp(false);
    }
  };

  const referenciasFiltradas = useMemo(() => {
    const t = busquedaRef.toLowerCase();
    return referenciasGlobales.filter(r => {
      const nombreUni = r.unidadNombre || getNombreUnidad(r.unidadId || r.unidad);
      const nombreOpe = r.operadorNombre || getNombreOperador(r.operadorId || r.operador);
      const nombreProv = r.proveedorNombre || getNombreProveedor(r.proveedorId || r.proveedor);
      return (
        r.consecutivo?.toLowerCase().includes(t) || 
        nombreUni.toLowerCase().includes(t) ||
        nombreOpe.toLowerCase().includes(t) ||
        nombreProv.toLowerCase().includes(t) ||
        (r.status || '').toLowerCase().includes(t)
      );
    });
  }, [referenciasGlobales, busquedaRef, unidadesList, operadoresList, proveedoresList]);

  const resumenHistorial = useMemo(() => {
    let totalGalones = 0;
    let granTotalCargado = 0;
    referenciasFiltradas.forEach(r => {
      totalGalones += Number(r.galonesCargados) || 0;
      granTotalCargado += Number(r.totalCargado) || 0;
    });
    return { totalGalones, granTotalCargado };
  }, [referenciasFiltradas]);

  const totalPaginas = Math.ceil(referenciasFiltradas.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = referenciasFiltradas.slice(indexFirst, indexLast);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  const exportarCSV = () => {
    if (referenciasFiltradas.length === 0) return alert("No hay datos para exportar.");
    const datosExcel = referenciasFiltradas.map(ref => ({
      'Consecutivo': ref.consecutivo,
      'Status': ref.status || 'No Autorizado',
      'Fecha': formatearFechaSpanish(ref.fecha),
      'Unidad': ref.unidadNombre || getNombreUnidad(ref.unidadId || ref.unidad),
      'Operador': ref.operadorNombre || getNombreOperador(ref.operadorId || ref.operador),
      'Proveedor': ref.proveedorNombre || getNombreProveedor(ref.proveedorId || ref.proveedor),
      'Suma de Diesel (Ref)': ref.sumaDiesel,
      'Galones Autorizados': ref.galonesAutorizados,
      'Galones Cargados': ref.galonesCargados,
      'Costo Diario Diesel': ref.costoDiesel,
      'Total Autorizado': ref.totalAutorizado,
      'Total Cargado': ref.totalCargado,
      'Observaciones': ref.observaciones
    }));

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Referencias Diesel');
    XLSX.writeFile(workbook, `Referencias_Diesel_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any
  });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Referencias del Diesel</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('referencias')} style={tabStyle(activeTab === 'referencias')}>Historial de Referencias</button>
      </div>

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          
          <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>UNIDAD</label>
              <select value={filtroUnidad} onChange={e => { setFiltroUnidad(e.target.value); setFiltroOperador(''); setSeleccionadas([]); }} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }}>
                <option value="">Seleccionar Unidad...</option>
                {unidadesOptions.map((name, i) => <option key={i} value={name}>{name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>OPERADOR (Opcional)</label>
              <select 
                value={filtroOperador} 
                onChange={e => { setFiltroOperador(e.target.value); setSeleccionadas([]); }} 
                disabled={!filtroUnidad}
                style={{ 
                  width: '100%', 
                  padding: '10px', 
                  backgroundColor: !filtroUnidad ? '#21262d' : '#161b22', 
                  color: !filtroUnidad ? '#8b949e' : '#c9d1d9', 
                  border: '1px solid #30363d', 
                  borderRadius: '6px',
                  cursor: !filtroUnidad ? 'not-allowed' : 'pointer'
                }}
              >
                <option value="">{!filtroUnidad ? 'Selecciona unidad primero...' : 'Todos los Operadores...'}</option>
                {operadoresOptions.map((name, i) => <option key={i} value={name}>{name}</option>)}
              </select>
            </div>
            <button 
              disabled={seleccionadas.length === 0} 
              onClick={() => { setConsecutivoForm(generarConsecutivo(fechaForm)); setModalAbierto(true); }}
              style={{ padding: '10px 20px', backgroundColor: seleccionadas.length > 0 ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: seleccionadas.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}
            >
              Generar Referencia ({seleccionadas.length})
            </button>
          </div>

          {seleccionadas.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones Seleccionadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div>
                  {/* ✅ AQUÍ CAMBIÉ EL FORMATO PARA QUE MUESTRE SOLO NÚMERO DECIMAL */}
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Suma Combustible Total</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenSeleccion.dieselTotal.toFixed(2)}</span>
                </div>
              </div>
              <div style={{ borderTop: '1px dashed #30363d', paddingTop: '16px' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Operaciones incluidas:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {resumenSeleccion.refs.map((ref, i) => (
                    <span key={i} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', fontFamily: 'monospace' }}>{ref}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '50px', textAlign: 'center', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}></th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>REF. OPERACIÓN</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>FECHA SERVICIO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>UNIDAD</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>OPERADOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>ORIGEN</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>DESTINO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>DIESEL (OP)</th>
                </tr>
              </thead>
              <tbody>
                {!filtroUnidad ? (
                  <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Selecciona una Unidad en el filtro superior para buscar operaciones.</td></tr>
                ) : operacionesPendientes.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>No hay operaciones pendientes para los filtros seleccionados.</td></tr>
                ) : (
                  operacionesPendientes.map(op => (
                    <tr key={op.id} onClick={() => toggleSeleccion(op.id)} style={{ cursor: 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} /></td>
                      <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op.ref || op.id.substring(0,6)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{getNombreUnidad(op.unidadNombre || op.unidadId || op.unidad)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{getNombreOperador(op.operadorNombre || op.operadorId || op.operador)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.origen || '-'}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.destino || '-'}</td>
                      <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{Number(op.combustibleTotal || 0).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      ) : (
        <div className="animation-fade-in">
          
          <div style={{ position: 'relative', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <input type="text" placeholder="Buscar en historial (Unidad, Ref, Status)..." value={busquedaRef} onChange={e => setBusquedaRef(e.target.value)} style={{ width: '100%', maxWidth: '400px', padding: '10px 16px', backgroundColor: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            <button title="Exportar a Excel" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          {referenciasFiltradas.length > 0 && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Referencias Listadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{referenciasFiltradas.length}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Galones Cargados</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{resumenHistorial.totalGalones.toFixed(2)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Gran Total (Costo Diesel)</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenHistorial.granTotalCargado)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>ACCIONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>CONSECUTIVO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>STATUS</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>UNIDAD</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>OPERADOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>PROVEEDOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>GALONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>TOTAL</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', backgroundColor: '#1f2937', whiteSpace: 'nowrap' }}>OBSERVACIONES</th>
                </tr>
              </thead>
              <tbody>
                {registrosVisibles.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay referencias registradas.</td></tr>
                ) : (
                  registrosVisibles.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            title="Editar/Ver Ficha" 
                            onClick={() => setReferenciaViendo(r)} 
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          
                          <button 
                            title="Eliminar Referencia" 
                            onClick={(e) => handleEliminarReferencia(e, r)} 
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{r.consecutivo}</td>
                      <td style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                        <span style={{ 
                          padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', 
                          backgroundColor: r.status === 'No Autorizado' ? 'rgba(239, 68, 68, 0.1)' : r.status === 'Autorizado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                          color: r.status === 'No Autorizado' ? '#ef4444' : r.status === 'Autorizado' ? '#f59e0b' : '#10b981',
                          border: `1px solid ${r.status === 'No Autorizado' ? '#ef4444' : r.status === 'Autorizado' ? '#f59e0b' : '#10b981'}`
                        }}>
                          {r.status || 'No Autorizado'}
                        </span>
                      </td>
                      <td style={{ padding: '16px', color: '#f0f6fc', whiteSpace: 'nowrap' }}>{getNombreUnidad(r.unidadNombre || r.unidadId || r.unidad)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{getNombreOperador(r.operadorNombre || r.operadorId || r.operador)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{getNombreProveedor(r.proveedorNombre || r.proveedorId || r.proveedor)}</td>
                      <td style={{ padding: '16px', color: '#58a6ff', whiteSpace: 'nowrap' }}>{r.galonesCargados} Gal.</td>
                      <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(r.totalCargado)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{r.observaciones || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '20px' }}>
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span style={{ color: '#fff', alignSelf: 'center' }}>{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* MODAL FORMULARIO */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '600px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Nueva Referencia: <span style={{ color: '#D84315' }}>{consecutivoForm}</span></h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            {/* ✅ SECCIÓN DE ESTATUS Y GALONES CALCULADOS */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '20px' }}>
              <div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Status de la Referencia</span>
                <span style={{ 
                  padding: '4px 10px', 
                  borderRadius: '12px', 
                  fontSize: '0.85rem', 
                  fontWeight: 'bold', 
                  backgroundColor: statusReferenciaForm === 'No Autorizado' ? 'rgba(239, 68, 68, 0.1)' : statusReferenciaForm === 'Autorizado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                  color: statusReferenciaForm === 'No Autorizado' ? '#ef4444' : statusReferenciaForm === 'Autorizado' ? '#f59e0b' : '#10b981',
                  border: `1px solid ${statusReferenciaForm === 'No Autorizado' ? '#ef4444' : statusReferenciaForm === 'Autorizado' ? '#f59e0b' : '#10b981'}`
                }}>
                  {statusReferenciaForm}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Galones Calculados (Operaciones)</span>
                <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{galonesCalculadosOp.toFixed(2)} Gal.</span>
              </div>
            </div>
            
            <form onSubmit={handleGuardarReferencia}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>FECHA</label>
                  <input type="date" value={fechaForm} onChange={e => setFechaForm(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>PROVEEDOR</label>
                  <select required value={proveedorSeleccionado} onChange={e => setProveedorSeleccionado(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }}>
                    <option value="">Seleccionar...</option>
                    {proveedoresFiltrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>GALONES AUTORIZADOS</label>
                  <input type="number" step="0.01" value={galonesAutorizados} onChange={e => setGalonesAutorizados(e.target.valueAsNumber || '')} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>GALONES CARGADOS</label>
                  <input type="number" step="0.01" value={galonesCargados} onChange={e => setGalonesCargados(e.target.valueAsNumber || '')} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px' }} />
                </div>
              </div>

              <div style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{color: '#8b949e'}}>Costo Diesel ({fechaForm}):</span><span style={{color: '#fff', fontWeight: 'bold'}}>{formatoMoneda(costoDieselDiario)}</span></div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span style={{color: '#8b949e'}}>Total Autorizado:</span><span style={{color: '#58a6ff', fontWeight: 'bold'}}>{formatoMoneda((Number(galonesAutorizados) || 0) * costoDieselDiario)}</span></div>
                 <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{color: '#8b949e'}}>Total Cargado:</span><span style={{color: '#3fb950', fontWeight: 'bold'}}>{formatoMoneda((Number(galonesCargados) || 0) * costoDieselDiario)}</span></div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ color: '#8b949e', fontSize: '0.75rem', display: 'block', marginBottom: '4px' }}>OBSERVACIONES</label>
                <textarea value={observacionesForm} onChange={e => setObservacionesForm(e.target.value)} style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', color: '#fff', border: '1px solid #30363d', borderRadius: '4px', height: '80px' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : 'Guardar Referencia'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FICHA REFERENCIA */}
      {referenciaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '800px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Ficha de Referencia Diesel</h2>
              <button onClick={() => setReferenciaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', alignItems: 'center' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Consecutivo</span>
                    <span style={{ color: '#D84315', fontSize: '1.2rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{referenciaViendo.consecutivo}</span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Status</span>
                    <span style={{ 
                        padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold', 
                        backgroundColor: referenciaViendo.status === 'No Autorizado' ? 'rgba(239, 68, 68, 0.1)' : referenciaViendo.status === 'Autorizado' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                        color: referenciaViendo.status === 'No Autorizado' ? '#ef4444' : referenciaViendo.status === 'Autorizado' ? '#f59e0b' : '#10b981',
                        border: `1px solid ${referenciaViendo.status === 'No Autorizado' ? '#ef4444' : referenciaViendo.status === 'Autorizado' ? '#f59e0b' : '#10b981'}`
                      }}>
                        {referenciaViendo.status || 'No Autorizado'}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Fecha</span>
                    <span style={{ color: '#c9d1d9', fontSize: '1rem', fontWeight: 'bold' }}>{formatearFechaSpanish(referenciaViendo.fecha)}</span>
                  </div>
                </div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Unidad</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{getNombreUnidad(referenciaViendo.unidadNombre || referenciaViendo.unidadId || referenciaViendo.unidad)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Operador</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{getNombreOperador(referenciaViendo.operadorNombre || referenciaViendo.operadorId || referenciaViendo.operador)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Proveedor</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{getNombreProveedor(referenciaViendo.proveedorNombre || referenciaViendo.proveedorId || referenciaViendo.proveedor)}</span>
                </div>

                <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Suma de Diesel</span>
                  {/* ✅ En la Ficha también le quitamos el formato de moneda */}
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{Number(referenciaViendo.sumaDiesel || 0).toFixed(2)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Costo Diario</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{formatoMoneda(referenciaViendo.costoDiesel)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Galones Calculados</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem' }}>{Number(referenciaViendo.galonesCalculadosOperaciones || 0).toFixed(2)} Gal.</span>
                </div>

                <div style={{ backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Galones Autorizados</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold' }}>{Number(referenciaViendo.galonesAutorizados).toFixed(2)}</span>
                  <span style={{ display: 'block', color: '#c9d1d9', fontSize: '0.85rem', marginTop: '4px' }}>Total: {formatoMoneda(referenciaViendo.totalAutorizado)}</span>
                </div>
                
                <div style={{ backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Galones Cargados</span>
                  <span style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>{Number(referenciaViendo.galonesCargados).toFixed(2)}</span>
                  <span style={{ display: 'block', color: '#c9d1d9', fontSize: '0.85rem', marginTop: '4px' }}>Total: {formatoMoneda(referenciaViendo.totalCargado)}</span>
                </div>
                <div></div>

                <div style={{ gridColumn: 'span 3' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Observaciones</span>
                  <div style={{ color: '#c9d1d9', backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d', minHeight: '60px' }}>
                    {referenciaViendo.observaciones || '-'}
                  </div>
                </div>

                <div style={{ gridColumn: 'span 3' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>Operaciones Incluidas en esta Referencia</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {referenciaViendo.operacionesIds?.map((idOp: string) => {
                      const match = operacionesGlobales.find(o => o.id === idOp);
                      const displayRef = match ? (match.ref || match.id?.substring(0,6)) : idOp.substring(0,6);
                      
                      return (
                        <span 
                          key={idOp} 
                          onClick={() => { if(match) { setOperacionAEditar(match); setEditCombustibleOp(match.combustibleTotal || ''); } }}
                          title={match ? "Clic para ver/editar detalle" : "Detalle no disponible sin cargar Asignaciones"}
                          style={{ 
                            backgroundColor: '#21262d', border: '1px solid #58a6ff', color: '#58a6ff', 
                            padding: '6px 14px', borderRadius: '16px', fontSize: '0.85rem', fontFamily: 'monospace',
                            cursor: match ? 'pointer' : 'default', transition: 'all 0.2s ease', display: 'inline-flex', alignItems: 'center', gap: '6px'
                          }}
                        >
                          {displayRef}
                          {match && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>}
                        </span>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>
            
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
              <button onClick={() => setReferenciaViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDICIÓN RÁPIDA DE OPERACIÓN */}
      {operacionAEditar && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #58a6ff', borderRadius: '12px', width: '100%', maxWidth: '450px', padding: '24px', boxShadow: '0 10px 40px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                Edición de Operación
              </h2>
              <button onClick={() => setOperacionAEditar(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>REF. OPERACIÓN</span>
                <span style={{ color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace' }}>{operacionAEditar.ref || operacionAEditar.id.substring(0,6)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>ORIGEN</span>
                <span style={{ color: '#c9d1d9' }}>{operacionAEditar.origen || '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold' }}>DESTINO</span>
                <span style={{ color: '#c9d1d9' }}>{operacionAEditar.destino || '-'}</span>
              </div>
            </div>

            <form onSubmit={handleActualizarOperacion}>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: '#c9d1d9', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
                  Combustible Total (Diesel Op.)
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e', fontWeight: 'bold' }}>#</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={editCombustibleOp} 
                    onChange={e => setEditCombustibleOp(e.target.valueAsNumber || '')} 
                    required 
                    style={{ width: '100%', padding: '12px 12px 12px 30px', backgroundColor: '#010409', border: '1px solid #58a6ff', borderRadius: '6px', color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold', boxSizing: 'border-box' }} 
                  />
                </div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginTop: '8px' }}>
                  * Al guardar, se recalculará automáticamente la Suma de Diesel en la Referencia Maestra.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setOperacionAEditar(null)} disabled={guardandoEdicionOp} style={{ padding: '10px 20px', background: 'none', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardandoEdicionOp} style={{ padding: '10px 20px', backgroundColor: '#58a6ff', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                  {guardandoEdicionOp ? 'Guardando...' : 'Actualizar Diesel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
// src/features/puentes/components/ReferenciasPuentesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  writeBatch,
  doc,
  limit,
  orderBy,
  getDocs,
  getDoc,
  where
} from 'firebase/firestore';
import { db, auth } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import './ReferenciasPuentesDashboard.css';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { FormularioConfigurable } from '../../formularios/FormularioConfigurable';
import { esOperacionPrueba } from '../../../utils/operacionPrueba';
import { cargarCtxCobroPuente, cobroPuenteDeOperacion } from '../../../utils/puenteColombia';
import { COL_REF_AUTO, filaDeOperacion, grupoDeFila, quitarOperacionDeReferenciaAuto, recalcularHistorialCalculadoHoy, upsertReferenciaAuto } from '../../../utils/historialCalculadoPuentes';
import { FormularioOperacion } from '../../operaciones/components/FormularioOperacion';

// ⚠ Si tu colección de convenios de clientes tiene otro nombre, cámbialo aquí.
const COLECCION_CONVENIOS = 'convenios_clientes';

// ✅ V00392: columnas pedidas — Ref, Fecha, Unidad, Convenio, Puente, Monto
const COLUMNAS_OPS_PUENTES_BASE = [
  { id: 'ref',           label: 'Ref. Operación', visible: true,  orden: true },
  { id: 'fechaServicio', label: 'Fecha Servicio', visible: true,  orden: true },
  { id: 'horaVerde',     label: 'Hora (Verde)',   visible: true,  orden: true }, // ✅ V00393
  { id: 'unidad',        label: 'Unidad',         visible: true,  orden: true },
  { id: 'convenio',      label: 'Convenio',       visible: true,  orden: true },
  { id: 'puenteNombre',  label: 'Puente',         visible: true,  orden: true },
  { id: 'puente',        label: 'Monto',          visible: true,  orden: true },
  { id: 'trafico',       label: 'Tráfico',        visible: false, orden: true },
  { id: 'operador',      label: 'Operador',       visible: false, orden: true },
  { id: 'cliente',       label: 'Cliente',        visible: false, orden: true },
];

export const ReferenciasPuentesDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'otros' | 'saldos' | 'historial' | 'calculado'>('calculado');

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [referenciasGlobales, setReferenciasGlobales] = useState<any[]>([]);
  const [operadoresList, setOperadoresList] = useState<any[]>([]);
  const [conveniosList, setConveniosList] = useState<any[]>([]);
  const [tiposGastoList, setTiposGastoList] = useState<any[]>([]);
  const [empresasList, setEmpresasList] = useState<any[]>([]);
  const [traficoList, setTraficoList] = useState<any[]>([]);
  // Para resolver el tráfico por la cadena de la tarifa (igual que el formulario de operación)
  const [convDetallesList, setConvDetallesList] = useState<any[]>([]);
  const [tarifasRefList, setTarifasRefList] = useState<any[]>([]);
  const [tiposTarifariosList, setTiposTarifariosList] = useState<any[]>([]);

  // Filtros pestaña 1
  // ✅ V00402: por defecto se ven las operaciones de HOY
  const [fechaInicio, setFechaInicio] = useState(hoyLocalISO());
  const [fechaFin, setFechaFin] = useState(hoyLocalISO());
  // ✅ V00392: filtros Puente y Unidad; unidades para mostrar su número
  const [filtroPuente, setFiltroPuente] = useState<string>('todos');
  const [filtroUnidad, setFiltroUnidad] = useState<string>('todas');
  const [unidadesList, setUnidadesList] = useState<Record<string, unknown>[]>([]);
  const [asignandoMontos, setAsignandoMontos] = useState(false);
  // ✅ V00412: detalle de la operación (formulario) y sacar operaciones de una referencia
  const [opDetalle, setOpDetalle] = useState<Record<string, unknown> | null>(null);
  const [catalogosFormulario, setCatalogosFormulario] = useState<Record<string, unknown[]> | null>(null);
  const [cargandoDetalleOp, setCargandoDetalleOp] = useState(false);
  const [quitandoOp, setQuitandoOp] = useState('');
  const [cambiandoPuente, setCambiandoPuente] = useState('');
  const monedaDeCat = (m: unknown) => (String(m || '') === '7dca62b3' ? 'Dólares' : String(m || '') === 'f95d8894' ? 'Pesos' : String(m || ''));
  const cambiarPuenteOp = async (op: Record<string, unknown>, puenteId: string) => {
    const p = puentesCatalogo.find(x => x.id === puenteId);
    if (!p) return;
    const nombre = String(nombrePuente(p));
    const importe = Number(p.importe) || 0;
    const monedaC = monedaDeCat(p.moneda);
    const esCol = sinAcentos(nombre).includes('colombia');
    if (!window.confirm(`¿Cambiar el puente de ${String(op.ref || op.id)} a ${nombre} (${formatoMoneda(importe)} ${monedaC})?${esCol ? '\n\nColombia: también se agrega el Puente Mx Colombia.' : ''}`)) return;
    const campos: Record<string, unknown> = {
      saldoPuente: importe, saldoPuentePuente: nombre, saldoPuenteMoneda: monedaC,
      saldoPuenteFecha: String(op.saldoPuenteFecha || op.fechaServicio || hoyLocalISO()).slice(0, 10),
      saldoPuenteEvento: String(op.saldoPuenteEvento || 'Cambio manual (Referencias de Puentes)'),
    };
    if (esCol) {
      const piso = puentesCatalogo.find(x => sinAcentos(nombrePuente(x)) === 'puente mx colombia');
      if (piso && Number(piso.importe) > 0) Object.assign(campos, {
        saldoPuentePiso: Number(piso.importe), saldoPuentePisoPuente: String(nombrePuente(piso)), saldoPuentePisoMoneda: monedaDeCat(piso.moneda),
        saldoPuentePisoFecha: campos.saldoPuenteFecha, saldoPuentePisoEvento: campos.saldoPuenteEvento,
      });
    } else Object.assign(campos, { saldoPuentePiso: 0, saldoPuentePisoPuente: '', saldoPuentePisoMoneda: '' });
    setCambiandoPuente(String(op.id));
    try {
      const b = writeBatch(db);
      b.update(doc(db, 'operaciones', String(op._docId || op.id)), campos);
      await b.commit();
      setOperacionesGlobales(prev => prev.map(o => o.id === op.id ? { ...o, ...campos } : o));
    } catch (e) { alert(`No se pudo cambiar el puente: ${(e as Error)?.message || e}`); }
    finally { setCambiandoPuente(''); }
  };
  // ✅ V00415: agregar operaciones a una referencia desde su detalle
  const [agregarARef, setAgregarARef] = useState(false);
  const [selAgregar, setSelAgregar] = useState<string[]>([]);
  const [agregandoOps, setAgregandoOps] = useState(false);
  const [agregarTodasFechas, setAgregarTodasFechas] = useState(false);
  const cargarCatalogosFormulario = async () => {
    if (catalogosFormulario) return catalogosFormulario;
    const ALIAS: Record<string, string> = {
      empresas: 'empresas', tiposOperacion: 'catalogo_tipo_operacion', embalajes: 'catalogo_embalaje',
      remolques: 'remolques', tarifas: 'catalogo_tarifas_referencia', conveniosProv: 'convenios_proveedores',
      catalogoConvProvDetalles: 'convenios_proveedores_detalles', catalogoTC: 'tipo_cambio',
      catalogoConvClientes: 'convenios_clientes', catalogoConvDetalles: 'convenios_clientes_detalles',
      unidades: 'unidades', empleados: 'empleados', statusServicio: 'catalogo_status_servicio',
      unidades_proveedor: 'unidades_proveedor', proveedores_unidad: 'proveedores_unidad', catalogoMoneda: 'catalogo_moneda',
    };
    const resultado: Record<string, unknown[]> = {};
    await Promise.all(Object.entries(ALIAS).map(async ([alias, col]) => {
      try { const snap = await getDocs(collection(db, col)); resultado[alias] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) })); }
      catch { resultado[alias] = []; }
    }));
    setCatalogosFormulario(resultado);
    return resultado;
  };
  const abrirDetalleOperacion = async (opId: string) => {
    if (!opId || cargandoDetalleOp) return;
    setCargandoDetalleOp(true);
    try {
      await cargarCatalogosFormulario();
      const snap = await getDoc(doc(db, 'operaciones', opId));
      if (!snap.exists()) { alert('No se encontró la operación en la base de datos.'); return; }
      setOpDetalle({ id: snap.id, ...(snap.data() as Record<string, unknown>) });
    } catch (e) {
      console.error(e);
      alert('No se pudo abrir el detalle de la operación.');
    } finally { setCargandoDetalleOp(false); }
  };
  const candidatasParaRef = (ref: Record<string, unknown> | null): OpPuente[] => {
    if (!ref) return [];
    const g = String(ref.grupoPuente || '');
    return operacionesGlobales.filter(op => {
      if (!esPuenteRoelca(op) || esOperacionPrueba(op)) return false;
      if (idsEnHistorialCalculado.has(String(op._docId || op.id)) || idsEnHistorialCalculado.has(String(op.id))) return false;
      const tr = sinAcentos(getTrafico(op));
      if (tr !== 'importacion' && tr !== 'exportacion') return false;
      if (!agregarTodasFechas && String(op.fechaServicio || '').slice(0, 10) !== String(ref.fechaGeneracion || '')) return false;
      return grupoPuenteOp(op) === g;
    });
  };
  const agregarOpsARef = async () => {
    const ref = referenciaViendo as Record<string, unknown> | null;
    if (!ref || selAgregar.length === 0) return;
    setAgregandoOps(true);
    try {
      const filas: Record<string, unknown>[] = [];
      for (const id of selAgregar) {
        const op = operacionesGlobales.find(o => o.id === id);
        if (!op) continue;
        const r = await filaDeOperacion({ ...op, _docId: op._docId || op.id }, textoHoraVerde(op));
        if (r && r.grupo === ref.grupoPuente) filas.push(r.fila);
      }
      if (filas.length === 0) { alert('Ninguna de las seleccionadas corresponde a este puente.'); return; }
      await upsertReferenciaAuto(String(ref.id), ref.grupoPuente as 'AVI' | 'PT3' | 'PTC', String(ref.fechaGeneracion || hoyLocalISO()), filas, String(ref.horaGeneracion || horaAhora()), 'manual');
      setReferenciaViendo((prev: Record<string, unknown> | null) => prev ? {
        ...prev,
        operacionesIds: [...(((prev.operacionesIds as string[]) || [])), ...filas.map(f => String(f.id))],
        operacionesGuardadas: [...(((prev.operacionesGuardadas as Record<string, unknown>[]) || [])), ...filas],
        subtotalPuentes: (Number(prev.subtotalPuentes) || 0) + filas.reduce((a, f) => a + (Number(f.puente) || 0), 0),
      } : prev);
      setSelAgregar([]);
      setAgregarARef(false);
    } catch (e) { alert(`No se pudieron agregar: ${(e as Error)?.message || e}`); }
    finally { setAgregandoOps(false); }
  };
  const sacarDeReferencia = async (ref: { id?: unknown; consecutivo?: unknown }, op: { id?: unknown; ref?: unknown }) => {
    if (!window.confirm(`¿Sacar ${String(op.ref || op.id)} de ${String(ref.consecutivo || '')}? Regresará a "Operaciones sin asignar".`)) return;
    setQuitandoOp(String(op.id));
    try {
      const r = await quitarOperacionDeReferenciaAuto(String(ref.id), String(op.id));
      if (r === 'eliminada') { setReferenciaViendo(null); alert('La referencia se quedó sin operaciones y se eliminó.'); }
      else setReferenciaViendo((prev: Record<string, unknown> | null) => prev ? {
        ...prev,
        operacionesIds: ((prev.operacionesIds as string[]) || []).filter(x => String(x) !== String(op.id)),
        operacionesGuardadas: ((prev.operacionesGuardadas as Record<string, unknown>[]) || []).filter(o => String(o.id) !== String(op.id)),
      } : prev);
    } catch (e) { alert(`No se pudo sacar la operación: ${(e as Error)?.message || e}`); }
    finally { setQuitandoOp(''); }
  };
  // ✅ V00404: a qué referencia del Historial va cada grupo (puente + fecha de servicio)
  const [destinoPorGrupo, setDestinoPorGrupo] = useState<Record<string, string>>({});
  // ✅ V00402: HISTORIAL CALCULADO (referencias automáticas al marcar Verde)
  type RefAuto = { id: string; consecutivo?: string; puenteNombre?: string; fechaGeneracion?: string; horaGeneracion?: string; operaciones?: string[]; operacionesIds?: string[]; totalesPorMoneda?: Record<string, number>; subtotalPuentes?: number; statusPagado?: boolean };
  const [refsAuto, setRefsAuto] = useState<RefAuto[]>([]);
  const [recalculando, setRecalculando] = useState(false);
  // ✅ V00403: se escucha SIEMPRE — las operaciones que ya están en el Historial
  //   calculado no se muestran en Asignar Operaciones (si se borra, regresan).
  useEffect(() => {
    const u = onSnapshot(query(collection(db, COL_REF_AUTO), orderBy('fechaGeneracion', 'desc'), limit(1000)), (snap) => {
      setRefsAuto(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<RefAuto, 'id'>) })));
    }, () => setRefsAuto([]));
    return () => u();
  }, []);
  const idsEnHistorialCalculado = useMemo(() => {
    const set = new Set<string>();
    refsAuto.forEach(r => (r.operacionesIds || []).forEach(id => set.add(String(id))));
    return set;
  }, [refsAuto]);
  const recalcularHoy = async () => {
    setRecalculando(true);
    try {
      const n = await recalcularHistorialCalculadoHoy();
      alert(n ? `Se revisaron ${n} operación(es) con Verde de hoy.` : 'No hay operaciones marcadas Verde hoy.');
    } catch (e) { alert(`No se pudo recalcular: ${(e as Error)?.message || e}`); }
    finally { setRecalculando(false); }
  };
  const eliminarRefAuto = async (r: RefAuto) => {
    if (!window.confirm(`¿Eliminar la referencia ${r.consecutivo}?\n\nSus ${(r.operacionesIds || []).length} operación(es) regresan a "Operaciones sin asignar".`)) return;
    try { const b = writeBatch(db); b.delete(doc(db, COL_REF_AUTO, r.id)); await b.commit(); setSelRefsAuto(prev => prev.filter(x => x !== r.id)); }
    catch (e) { alert(`No se pudo eliminar: ${(e as Error)?.message || e}`); }
  };
  // ✅ V00414: BORRAR varias (o todas) las referencias del Historial — sus operaciones
  //   regresan a "Operaciones sin asignar".
  const [selRefsAuto, setSelRefsAuto] = useState<string[]>([]);
  const [borrandoRefs, setBorrandoRefs] = useState(false);
  const borrarRefsAuto = async (ids: string[]) => {
    const lista = refsAuto.filter(r => ids.includes(r.id));
    if (lista.length === 0) return;
    const ops = lista.reduce((a, r) => a + (r.operacionesIds || []).length, 0);
    if (!window.confirm(`¿Eliminar ${lista.length} referencia(s)?\n\n${lista.map(r => `· ${r.consecutivo}`).slice(0, 12).join('\n')}${lista.length > 12 ? '\n…' : ''}\n\nSus ${ops} operación(es) regresan a "Operaciones sin asignar".`)) return;
    setBorrandoRefs(true);
    try {
      for (let i = 0; i < lista.length; i += 400) {
        const b = writeBatch(db);
        lista.slice(i, i + 400).forEach(r => b.delete(doc(db, COL_REF_AUTO, r.id)));
        await b.commit();
      }
      setSelRefsAuto([]);
    } catch (e) { alert(`No se pudieron eliminar: ${(e as Error)?.message || e}`); }
    finally { setBorrandoRefs(false); }
  };
  // ✅ V00395: OTROS CRUCES (carros particulares, etc.) — van directo al Historial
  const [modalOtro, setModalOtro] = useState(false);
  const [otroFecha, setOtroFecha] = useState(hoyLocalISO());
  const [otroHora, setOtroHora] = useState('');
  const [otroPuenteId, setOtroPuenteId] = useState('');
  const [otroDestino, setOtroDestino] = useState(''); // ✅ V00415: referencia elegida para el otro cruce
  const [otroMonto, setOtroMonto] = useState('');
  const [otroUnidad, setOtroUnidad] = useState('');
  const [guardandoOtro, setGuardandoOtro] = useState(false);
  // ✅ V00396: AGREGAR SALDO — saldo inicial por puente (colección saldos_puentes,
  //   la misma que usan Saldos de Puentes y las tarjetas de Operaciones Activas)
  const [saldosLista, setSaldosLista] = useState<Record<string, unknown>[]>([]);
  const [modalSaldo, setModalSaldo] = useState(false);
  const [saldoFecha, setSaldoFecha] = useState(hoyLocalISO());
  const [saldoHora, setSaldoHora] = useState('');
  const [saldoPuenteId, setSaldoPuenteId] = useState('');
  const [saldoMonto, setSaldoMonto] = useState('');
  const [guardandoSaldo, setGuardandoSaldo] = useState(false);
  // ✅ V00397: cruces que descuentan de los saldos (operaciones con peaje + otros cruces)
  const [saldoViendo, setSaldoViendo] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (activeTab !== 'saldos') return;
    const u = onSnapshot(collection(db, 'saldos_puentes'), (snap) => {
      const l: Record<string, unknown>[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
      l.sort((a, b) => `${String(b.fecha || '')} ${String(b.hora || '')}`.localeCompare(`${String(a.fecha || '')} ${String(a.hora || '')}`));
      setSaldosLista(l);
    });
    return () => u();
  }, [activeTab]);
  // ✅ V00393: hora en que se marcó Verde MX / Verde USA (bitácora "horarios")
  const [horasVerde, setHorasVerde] = useState<Record<string, { etiqueta: string; fechaHora: string }[]>>({});
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const filtroEstadoOps = 'pendientes' as 'pendientes' | 'asignadas'; // ✅ V00399: fijo — las asignadas viven en el Historial
  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_PUENTES_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);

  // Historial
  const [busquedaHistorial, setBusquedaHistorial] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tablas VACÍAS hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaOpsHecha, setBusquedaOpsHecha] = useState(true); // ✅ V00402: búsqueda de hoy al entrar
  const [busquedaHistHecha, setBusquedaHistHecha] = useState(false);
  const [filtroEstadoHist, setFiltroEstadoHist] = useState<'pendientes' | 'pagadas'>('pendientes');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Modal generar referencia
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [horaReferencia, setHoraReferencia] = useState('');

  const [referenciaViendo, setReferenciaViendo] = useState<any | null>(null);

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatearFechaSpanish = (fechaString: string) => {
    if (!fechaString) return '-';
    try { return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return fechaString; }
  };

  // ── Cargas ──
  useEffect(() => {
    const qRefs = query(collection(db, 'referencias_puentes'), orderBy('createdAt', 'desc'), limit(3000));
    const unSubRefs = onSnapshot(qRefs, (snap) => {
      setReferenciasGlobales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unSubRefs();
  }, []);

  useEffect(() => {
    if (activeTab === 'historial') return; // ✅ V00395 / V00404: el historial de referencias también necesita operaciones (para asignar)
    const subs: Array<() => void> = [];
    subs.push(onSnapshot(collection(db, 'empleados'), (snap) => {
      setOperadoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, COLECCION_CONVENIOS), (snap) => {
      setConveniosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, 'catalogo_tipos_gastos'), (snap) => {
      setTiposGastoList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, 'empresas'), (snap) => {
      setEmpresasList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, 'catalogo_trafico'), (snap) => {
      setTraficoList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, 'convenios_clientes_detalles'), (snap) => {
      setConvDetallesList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, 'catalogo_tarifas_referencia'), (snap) => {
      setTarifasRefList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, 'catalogo_tipos_tarifarios'), (snap) => {
      setTiposTarifariosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));
    subs.push(onSnapshot(collection(db, 'unidades'), (snap) => {
      setUnidadesList(snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) })));
    }));
    // ✅ V00392: las más recientes por fecha de servicio (antes 500 sin orden)
    const qOps = query(collection(db, 'operaciones'), orderBy('fechaServicio', 'desc'), limit(2500));
    subs.push(onSnapshot(qOps, (snap) => {
      const ops = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      ops.sort((a: any, b: any) => new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime());
      setOperacionesGlobales(ops);
    }));
    return () => subs.forEach(u => u());
  }, [activeTab]);

  const getNombreOperador = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = operadoresList.find(o => o.id === idOrName || `${o.firstName} ${o.lastNamePaternal}`.trim() === String(idOrName).trim());
    return found ? `${found.firstName || ''} ${found.lastNamePaternal || ''}`.trim() : idOrName;
  };

  const getCliente = (op: any) => {
    // Nombre denormalizado si ya viene en la operación
    const directo = op.clienteNombre || op.clientePagaNombre || op.nombreCliente;
    if (directo) return directo;
    // Si solo viene el ID, lo resolvemos contra el catálogo de empresas
    const id = op.clientePaga || op.clienteId || op.cliente;
    if (id) {
      const emp = empresaPorId.get(String(id));
      if (emp) return emp.nombre || emp.empresa || emp.razonSocial || String(id);
    }
    return id ? String(id) : '-';
  };

  // Costo de puente/caseta de la operación (con varios nombres posibles)
  // ✅ V00392: monto REAL del cruce = caseta (saldoPuente) + piso de Colombia
  type OpPuente = Record<string, unknown>;
  const getPuente = (op: OpPuente) => (Number(op.saldoPuente) || 0) + (Number(op.saldoPuentePiso) || 0);
  const tieneMontoPuente = (op: OpPuente) => Number(op.saldoPuente) > 0;
  const nombresPuenteOp = (op: OpPuente): string[] => [op.saldoPuentePuente, Number(op.saldoPuentePiso) > 0 ? op.saldoPuentePisoPuente : ''].map((x) => String(x || '').trim()).filter(Boolean);
  const unidadPorId = useMemo(() => {
    const map = new Map<string, string>();
    unidadesList.forEach(u => map.set(String(u.id), String(u.unidad ?? u.numeroEconomico ?? u.nombre ?? u.id)));
    return map;
  }, [unidadesList]);
  const getUnidad = (op: OpPuente): string => {
    const v = String(op.unidadNombre || '').trim() || String(op.unidad || '').trim();
    return v ? (unidadPorId.get(v) || v) : '-';
  };
  const getConvenio = (op: OpPuente): string => {
    const det = detallePorId.get(String(op.convenio || ''));
    return String(op.convenioNombre || det?.descripcion || det?.nombre || '-');
  };

  // ── Mapas auxiliares (resolver IDs -> nombre) ──
  const convenioPorId = useMemo(() => {
    const map = new Map<string, any>();
    conveniosList.forEach(c => map.set(String(c.id), c));
    return map;
  }, [conveniosList]);

  const empresaPorId = useMemo(() => {
    const map = new Map<string, any>();
    empresasList.forEach(e => map.set(String(e.id), e));
    return map;
  }, [empresasList]);

  // catalogo_trafico: id -> nombre legible (Importación, Exportación, Movimiento, ...)
  const traficoPorId = useMemo(() => {
    const map = new Map<string, string>();
    traficoList.forEach(t => {
      const nombre = t.nombre ?? t.trafico ?? t.descripcion ?? t.label ?? t.movimiento ?? '';
      if (nombre) map.set(String(t.id), String(nombre));
    });
    return map;
  }, [traficoList]);

  // Mapas de la cadena de tarifa (para deducir el tráfico igual que el formulario)
  const detallePorId = useMemo(() => {
    const map = new Map<string, any>();
    convDetallesList.forEach(d => map.set(String(d.id), d));
    return map;
  }, [convDetallesList]);

  const tarifaRefPorId = useMemo(() => {
    const map = new Map<string, any>();
    tarifasRefList.forEach(t => map.set(String(t.id), t));
    return map;
  }, [tarifasRefList]);

  const tipoTarifarioPorId = useMemo(() => {
    const map = new Map<string, any>();
    tiposTarifariosList.forEach(t => map.set(String(t.id), t));
    return map;
  }, [tiposTarifariosList]);

  // ── Helpers de tráfico ──
  const sinAcentos = (s: any) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const capitalizar = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // ¿La cadena parece un ID (hex corto o id largo tipo Firestore) y no un nombre legible?
  const pareceId = (s: string) => {
    const x = String(s || '').replace(/\s+/g, '');
    return /^[0-9a-f]{6,}$/i.test(x) || /^[A-Za-z0-9_-]{18,}$/.test(x);
  };

  // Normaliza un texto a un tráfico canónico si reconoce la palabra clave.
  const normalizarTrafico = (txt: any): string => {
    const t = sinAcentos(txt);
    if (!t) return '';
    if (t.includes('export')) return 'Exportación';
    if (t.includes('import')) return 'Importación';
    if (t.includes('movim') || t.includes('transfer') || t.includes('traslad')) return 'Movimiento';
    return '';
  };

  // Convierte un valor crudo (que puede ser un ID del catálogo) a su nombre legible.
  const traficoCrudoANombre = (val: any): string => {
    const s = String(val ?? '').trim();
    if (!s) return '';
    const enCat = traficoPorId.get(s);
    if (enCat) return String(enCat);
    return s;
  };

  // Devuelve el NOMBRE del tráfico de la operación.
  // Prioriza el campo `trafico` de la operación (ya resuelto al crearla, o un ID
  // que se resuelve contra catalogo_trafico). Reconoce Importación / Exportación /
  // Movimiento, y si viene un nombre legible no estándar (p. ej. importado de otra
  // base) lo muestra tal cual. Si solo hay un ID sin catálogo, intenta por convenio.
  const getTrafico = (op: any): string => {
    // 1) Campo directo de la operación (lo más confiable)
    const directoCrudo = traficoCrudoANombre(op.trafico ?? op.traficoNombre ?? op.trafico_nombre ?? op.traficoId ?? '');
    const directoNorm = normalizarTrafico(directoCrudo);
    if (directoNorm) return directoNorm;
    if (directoCrudo && !pareceId(directoCrudo)) return capitalizar(directoCrudo);

    // 2) Cadena de la tarifa (igual que el formulario de operación):
    //    op.convenio (id del DETALLE) -> convenios_clientes_detalles -> tarifaBaseId
    //    -> catalogo_tarifas_referencia -> tipo_operacion
    //    -> catalogo_tipos_tarifarios -> movimiento -> catalogo_trafico -> nombre
    const detId = op.convenio ?? op.convenioId ?? op.convenioDetalleId ?? op.convenioClienteId ?? op.idConvenio;
    const det = detId ? detallePorId.get(String(detId)) : null;
    if (det) {
      const tarifaBaseId = String(
        det.tipoConvenioId ?? det.tipo_convenio_id ?? det.tipoConvenio ?? det.tipo_convenio ??
        det.tarifaBaseId ?? det.tarifaId ?? det.tarifa_id ?? det['TIPO DE CONVENIO'] ?? ''
      ).trim();
      const tarifa = tarifaBaseId ? tarifaRefPorId.get(tarifaBaseId) : null;
      if (tarifa) {
        const tipoOpId = String(tarifa.tipo_operacion ?? tarifa.tipoOperacion ?? tarifa.tipo_operacion_id ?? '').trim();
        const tipoTar = tipoOpId ? tipoTarifarioPorId.get(tipoOpId) : null;
        if (tipoTar) {
          const movRaw = tipoTar.movimiento ?? tipoTar.trafico ?? tipoTar.tipo_movimiento ?? '';
          const movNombre = traficoCrudoANombre(movRaw);
          const n = normalizarTrafico(movNombre);
          if (n) return n;
          if (movNombre && !pareceId(movNombre)) return capitalizar(movNombre);
        }
      }
    }

    // 3) Convenio MAESTRO ligado a la operación (respaldo)
    const convId = op.convenio ?? op.convenioId ?? op.convenioClienteId ?? op.idConvenio;
    const conv = convId ? convenioPorId.get(String(convId)) : null;
    if (conv) {
      const campos = [conv.trafico, conv.tipoTrafico, conv.movimiento, conv.tipoOperacion, conv.tipoOperacionNombre, conv.sentido, conv.direccion];
      for (const c of campos) {
        const n = normalizarTrafico(traficoCrudoANombre(c));
        if (n) return n;
      }
      const todoTexto = Object.values(conv).filter(v => typeof v === 'string').join(' ');
      const n2 = normalizarTrafico(todoTexto);
      if (n2) return n2;
    }

    // 3) Respaldo: textos denormalizados en la propia operación
    const respaldo = `${op.convenioNombre || ''} ${op.tarifaLabel || ''} ${op.tarifarioLabel || ''} ${op.tipoServicio || ''} ${op.descripcionTarifa || ''} ${op.ref || ''}`;
    const n3 = normalizarTrafico(respaldo);
    if (n3) return n3;

    return '—';
  };

  const dentroRangoFecha = (op: any) => {
    if (!fechaInicio && !fechaFin) return true;
    const f = String(op.fechaServicio || op.createdAt || '').slice(0, 10);
    if (!f) return false;
    if (fechaInicio && f < fechaInicio) return false;
    if (fechaFin && f > fechaFin) return false;
    return true;
  };

  // No se muestra nada hasta que se ponga al menos una fecha de servicio
  const filtrosCompletos = !!(fechaInicio || fechaFin);

  // ✅ Puentes solo aplica a flota propia Roelca: se muestran únicamente las
  //    operaciones de Transfer, o de Logística cuyo proveedor sea Roelca.
  //    (Fletes y Logística con proveedor externo se facturan al proveedor, no aquí.)
  const esPuenteRoelca = (op: any): boolean => {
    const tipo = String(op?.tipoOperacionNombre || op?.tipoOperacionId || '').toLowerCase();
    const isTransfer = tipo.includes('transfer');
    const isLogistica = (tipo.includes('logistica') || tipo.includes('logística')) && !tipo.includes('flete'); // ✅ V00393: Fletes no cruza puente
    const esRoelca = String(op?.proveedorUnidadNombre || op?.proveedorUnidad || '').toLowerCase().includes('roelca');
    return isTransfer || (isLogistica && esRoelca);
  };

  const operacionesBaseFiltro = useMemo(() => {
    if (!filtrosCompletos) return [];
    return operacionesGlobales.filter(op => {
      if (!esPuenteRoelca(op) || esOperacionPrueba(op)) return false;
      if (idsEnHistorialCalculado.has(String(op._docId || op.id)) || idsEnHistorialCalculado.has(String(op.id))) return false; // ✅ V00403
      // ✅ V00393: solo IMPORTACIÓN y EXPORTACIÓN (los movimientos no cruzan puente)
      const trOp = sinAcentos(getTrafico(op));
      if (trOp !== 'importacion' && trOp !== 'exportacion') return false;
      if (sinAcentos(op.statusNombre).includes('cancel')) return false;
      // ✅ V00392: filtros Puente (caseta o piso) y Unidad
      if (filtroPuente !== 'todos') {
        if (filtroPuente === '__sin__') { if (tieneMontoPuente(op)) return false; }
        else if (!nombresPuenteOp(op).some(n => sinAcentos(n) === sinAcentos(filtroPuente))) return false;
      }
      if (filtroUnidad !== 'todas' && getUnidad(op) !== filtroUnidad) return false;
      return dentroRangoFecha(op);
    });
  }, [operacionesGlobales, filtroPuente, filtroUnidad, fechaInicio, fechaFin, filtrosCompletos, unidadPorId, traficoPorId, detallePorId, tarifaRefPorId, tipoTarifarioPorId, idsEnHistorialCalculado]);
  const unidadesDisponibles = useMemo(() =>
    Array.from(new Set(operacionesGlobales.filter(op => esPuenteRoelca(op) && dentroRangoFecha(op)).map(getUnidad).filter(u => u && u !== '-'))).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [operacionesGlobales, fechaInicio, fechaFin, unidadPorId]);

  // ✅ V00394: HORA DEL VERDE — se consulta la bitácora por lotes en paralelo y
  //   cada lote se guarda en cuanto llega (antes cualquier actualización de la
  //   lista cancelaba la carga completa y la hora nunca aparecía). El nombre
  //   del estatus se toma de la bitácora o, si falta, del catálogo por su id.
  const horasPedidasRef = React.useRef<Set<string>>(new Set());
  const statusNombresRef = React.useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!busquedaOpsHecha) return;
    const faltan = operacionesBaseFiltro.map(op => String(op.id)).filter(id => !horasPedidasRef.current.has(id));
    if (faltan.length === 0) return;
    faltan.forEach(id => horasPedidasRef.current.add(id));
    (async () => {
      if (!statusNombresRef.current) {
        try {
          const cat = await getDocs(collection(db, 'catalogo_status_servicio'));
          statusNombresRef.current = new Map(cat.docs.map(d => [d.id, String((d.data() as Record<string, unknown>).nombre ?? (d.data() as Record<string, unknown>).descripcion ?? '')]));
        } catch { statusNombresRef.current = new Map(); }
      }
      const lotes: string[][] = [];
      for (let i = 0; i < faltan.length; i += 30) lotes.push(faltan.slice(i, i + 30));
      const procesar = async (lote: string[]) => {
        const nuevo: Record<string, { etiqueta: string; fechaHora: string }[]> = {};
        lote.forEach(id => { nuevo[id] = []; });
        try {
          const snap = await getDocs(query(collection(db, 'horarios'), where('operacionId', 'in', lote)));
          snap.docs.forEach(d => {
            const h = d.data() as Record<string, unknown>;
            const nombre = String(h.statusNombre || statusNombresRef.current?.get(String(h.status || '')) || '');
            const st = sinAcentos(nombre);
            const etiqueta = st.includes('verde usa') ? 'Verde USA' : (st.includes('verde mx') || st.includes('verde mexico')) ? 'Verde MX' : '';
            if (!etiqueta) return;
            const id = String(h.operacionId || '');
            (nuevo[id] = nuevo[id] || []).push({ etiqueta, fechaHora: String(h.fechaHora || h.registradoEn || '') });
          });
        } catch (e) { console.warn('Horas del verde:', e); lote.forEach(id => horasPedidasRef.current.delete(id)); return; }
        Object.values(nuevo).forEach(l => l.sort((x, y) => x.fechaHora.localeCompare(y.fechaHora)));
        setHorasVerde(prev => ({ ...prev, ...nuevo }));
      };
      for (let i = 0; i < lotes.length; i += 6) await Promise.all(lotes.slice(i, i + 6).map(procesar));
    })();
  }, [busquedaOpsHecha, operacionesBaseFiltro]);
  // hora en formato 12 h, igual que la bitácora (03:57 p.m.)
  const horaDe = (fh: string) => {
    const m = String(fh).match(/(\d{1,2}):(\d{2})/);
    if (!m) return '';
    const h24 = Number(m[1]);
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${String(h12).padStart(2, '0')}:${m[2]} ${h24 < 12 ? 'a.m.' : 'p.m.'}`;
  };
  const textoHoraVerde = (op: { id?: unknown }) => (horasVerde[String(op.id)] || []).map(v => `${v.etiqueta} ${horaDe(v.fechaHora)}`).join(' · ');

  const esAsignada = (op: any) => idsEnHistorialCalculado.has(String(op._docId || op.id)); // ✅ V00404: asignada = está en el Historial de referencias


  const valorOrdenOp = (op: any, campo: string): string | number => {
    switch (campo) {
      case 'ref': return String(op.ref || op.id || '').toLowerCase();
      case 'fechaServicio': return String(op.fechaServicio || op.createdAt || '');
      case 'trafico': return getTrafico(op);
      case 'operador': return getNombreOperador(op.operadorNombre || op.operadorId || op.operador).toLowerCase();
      case 'cliente': return String(getCliente(op)).toLowerCase();
      case 'origen': return String(op.origen || '').toLowerCase();
      case 'destino': return String(op.destino || '').toLowerCase();
      case 'puente': return getPuente(op);
      case 'horaVerde': return (horasVerde[String(op.id)] || [])[0]?.fechaHora || '';
      case 'unidad': return getUnidad(op).toLowerCase();
      case 'convenio': return getConvenio(op).toLowerCase();
      case 'puenteNombre': return nombresPuenteOp(op).join(' + ').toLowerCase();
      default: return '';
    }
  };

  const operacionesMostradas = useMemo(() => {
    const lista = operacionesBaseFiltro.filter(op =>
      filtroEstadoOps === 'asignadas' ? esAsignada(op) : !esAsignada(op)
    );
    const dir = ordenOps.dir === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = valorOrdenOp(a, ordenOps.campo);
      const vb = valorOrdenOp(b, ordenOps.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [operacionesBaseFiltro, filtroEstadoOps, ordenOps, operadoresList, convenioPorId, traficoPorId, empresaPorId, detallePorId, tarifaRefPorId, tipoTarifarioPorId, horasVerde]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const valorCeldaOps = (op: any, key: string) => {
    switch (key) {
      case 'ref': return op.ref || op.id;
      case 'fechaServicio': return formatearFechaSpanish(op.fechaServicio || op.createdAt);
      case 'trafico': return getTrafico(op);
      case 'operador': return getNombreOperador(op.operadorNombre || op.operadorId || op.operador);
      case 'cliente': return getCliente(op);
      case 'origen': return op.origen || '-';
      case 'destino': return op.destino || '-';
      case 'puente': return getPuente(op);
      case 'horaVerde': return textoHoraVerde(op) || '-';
      case 'unidad': return getUnidad(op);
      case 'convenio': return getConvenio(op);
      case 'puenteNombre': return nombresPuenteOp(op).join(' + ') || 'Sin monto';
      default: return '-';
    }
  };

  const colorTrafico = (tr: string) => {
    const n = sinAcentos(tr);
    if (n === 'exportacion') return '#f37021';
    if (n === 'importacion') return '#58a6ff';
    if (n === 'movimiento') return '#a371f7';
    if (n === 'mixto') return '#d29922';
    return '#8b949e';
  };
  const chipTrafico = (tr: string) => {
    const texto = tr || '—';
    const color = colorTrafico(texto);
    return <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', color, border: `1px solid ${color}`, backgroundColor: `${color}1a` }}>{texto}</span>;
  };

  const renderCeldaOps = (op: any, key: string) => {
    const tdBase: React.CSSProperties = { padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' };
    switch (key) {
      case 'ref': return <td className="rpd-x1" key={key}>{op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'trafico': return <td className="rpd-x2" key={key}>{chipTrafico(getTrafico(op))}</td>;
      case 'operador': return <td key={key} style={tdBase}>{getNombreOperador(op.operadorNombre || op.operadorId || op.operador)}</td>;
      case 'cliente': return <td key={key} style={tdBase}>{getCliente(op)}</td>;
      case 'origen': return <td key={key} style={tdBase}>{op.origen || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destino || '-'}</td>;
      case 'horaVerde': {
        const lista = horasVerde[String(op.id)];
        return (
          <td key={key} className="rpd-celda">
            {lista === undefined ? <span className="rpd-moneda">…</span>
              : lista.length === 0 ? <span className="rpd-moneda">Sin verde</span>
              : lista.map((v, i) => <div key={i} title={v.fechaHora.replace('T', ' ')}><b className="rpd-hora">{horaDe(v.fechaHora) || '—'}</b> <span className="rpd-moneda">{v.etiqueta}</span></div>)}
          </td>
        );
      }
      case 'unidad': return <td key={key} className="rpd-celda">{getUnidad(op)}</td>;
      case 'convenio': return <td key={key} className="rpd-celda rpd-celda--conv" title={getConvenio(op)}>{getConvenio(op)}</td>;
      case 'puenteNombre': {
        // ✅ V00415: se puede CAMBIAR el puente; el monto se actualiza con la tarifa del catálogo
        const nombres = nombresPuenteOp(op);
        const actual = puentesCatalogo.find(p => sinAcentos(nombrePuente(p)) === sinAcentos(op.saldoPuentePuente));
        return (
          <td key={key} className="rpd-celda" onClick={(e) => e.stopPropagation()}>
            <select className="rpd-select-puente" value={actual?.id || ''} disabled={cambiandoPuente === String(op.id)} onChange={(e) => cambiarPuenteOp(op, e.target.value)} title="Cambiar el puente (el monto se toma del catálogo)">
              {!actual && <option value="">{nombres.length ? nombres.join(' + ') : 'Sin monto — elegir puente'}</option>}
              {puentesCatalogo.filter(p => !sinAcentos(nombrePuente(p)).includes('puente mx colombia')).map(p => <option key={p.id} value={p.id}>{String(nombrePuente(p))}</option>)}
            </select>
            {Number(op.saldoPuentePiso) > 0 && <div className="rpd-moneda">+ {String(op.saldoPuentePisoPuente || 'Puente Mx Colombia')}</div>}
            {colombiaMalCobrada(op) && <div className="rpd-chip-mal" title="La aduana es Colombia: debe cruzar por Puente Colombia (caseta + puente). Usa 'Asignar monto del puente' o elige la caseta de Colombia.">Debe ser Colombia</div>}
          </td>
        );
      }
      case 'puente': return (
        <td className="rpd-x3" key={key}>
          {tieneMontoPuente(op) ? (
            <>
              <div>{formatoMoneda(Number(op.saldoPuente) || 0)} <span className="rpd-moneda">{op.saldoPuenteMoneda || ''}</span></div>
              {Number(op.saldoPuentePiso) > 0 && <div>{formatoMoneda(Number(op.saldoPuentePiso))} <span className="rpd-moneda">{op.saldoPuentePisoMoneda || ''}</span></div>}
            </>
          ) : <span className="rpd-sin-monto">—</span>}
        </td>
      );
      default: return <td key={key} style={tdBase}>-</td>;
    }
  };

  const handleDragStartOps = (_e: React.DragEvent, index: number) => setDraggedColOpsIndex(index);
  const handleDragEnterOps = (index: number) => {
    if (draggedColOpsIndex === null || draggedColOpsIndex === index) return;
    const nuevas = [...columnasOps];
    const movida = nuevas.splice(draggedColOpsIndex, 1)[0];
    nuevas.splice(index, 0, movida);
    setDraggedColOpsIndex(index);
    setColumnasOps(nuevas);
  };
  const toggleColumnaVisibleOps = (index: number) => {
    const nuevas = [...columnasOps];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasOps(nuevas);
  };

  const exportarExcelOps = () => {
    if (operacionesMostradas.length === 0) return alert('No hay operaciones para exportar con los filtros actuales.');
    const cols = columnasOps.filter(c => c.visible);
    if (cols.length === 0) return alert('Selecciona al menos una columna para exportar.');
    const datos = operacionesMostradas.map(op => {
      const fila: any = {};
      cols.forEach(col => { fila[col.label] = valorCeldaOps(op, col.id); });
      return fila;
    });
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    const etiqueta = filtroEstadoOps === 'asignadas' ? 'Asignadas' : 'Pendientes';
    XLSX.utils.book_append_sheet(wb, ws, `Puentes_${etiqueta}`);
    const hoy = hoyLocalISO();
    XLSX.writeFile(wb, `Operaciones_Puentes_${etiqueta}_${hoy}.xlsx`);
  };

  const toggleSeleccion = (id: string) =>
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);

  const resumenSeleccion = useMemo(() => {
    let subtotal = 0;
    const refs: string[] = [];
    const porMoneda: Record<string, number> = {};
    let sinMonto = 0;
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (!op) return;
      subtotal += getPuente(op);
      refs.push(op.ref || op.id?.substring(0, 6));
      if (!tieneMontoPuente(op)) sinMonto += 1;
      const m1 = String(op.saldoPuenteMoneda || 'Sin moneda');
      if (Number(op.saldoPuente) > 0) porMoneda[m1] = (porMoneda[m1] || 0) + Number(op.saldoPuente);
      const m2 = String(op.saldoPuentePisoMoneda || 'Sin moneda');
      if (Number(op.saldoPuentePiso) > 0) porMoneda[m2] = (porMoneda[m2] || 0) + Number(op.saldoPuentePiso);
    });
    return { subtotal, refs, porMoneda, sinMonto };
  }, [seleccionadas, operacionesGlobales]);

  // ✅ V00392: SELECCIONAR TODO (como Referencias del Diesel / Nómina)
  const idsSeleccionables = operacionesMostradas.map(op => op.id);
  const todasSeleccionadas = idsSeleccionables.length > 0 && idsSeleccionables.every(id => seleccionadas.includes(id));
  const toggleTodas = () => setSeleccionadas(todasSeleccionadas ? [] : idsSeleccionables);

  // ✅ V00392: ASIGNAR el monto correcto del puente a las operaciones que no lo
  //   tienen (caseta de la tarifa / por tráfico; Colombia = caseta + puente).
  const asignarMontosPuente = async () => {
    const candidatas = operacionesBaseFiltro.filter(op => !tieneMontoPuente(op) || colombiaMalCobrada(op) || (Number(op.saldoPuente) > 0 && !(Number(op.saldoPuentePiso) > 0)));
    if (candidatas.length === 0) { alert('Todas las operaciones del filtro ya tienen su monto de puente.'); return; }
    setAsignandoMontos(true);
    try {
      const ctx = await cargarCtxCobroPuente();
      // ✅ V00416: las de aduana Colombia con otra caseta se recalculan (caseta + puente de Colombia)
      const cambios = candidatas.map(op => ({ op, campos: colombiaMalCobrada(op) ? cobroPuenteDeOperacion(ctx, { ...op, saldoPuente: 0, saldoPuentePiso: 0 }) : cobroPuenteDeOperacion(ctx, op) })).filter(x => Object.keys(x.campos).length > 0);
      const sinRegla = candidatas.filter(op => !tieneMontoPuente(op)).length - cambios.filter(x => x.campos.saldoPuente !== undefined).length;
      if (cambios.length === 0) { alert(`No se pudo determinar el puente de ${candidatas.filter(op => !tieneMontoPuente(op)).length} operación(es): revisa su convenio (caseta en Gastos Incluidos) o su tráfico.`); return; }
      const casetas = cambios.filter(x => x.campos.saldoPuente !== undefined).length;
      const pisos = cambios.filter(x => x.campos.saldoPuentePiso !== undefined).length;
      if (!window.confirm(`Asignar el monto del puente a ${cambios.length} operación(es)?\n\n· Casetas: ${casetas}\n· Puente Mx Colombia (piso): ${pisos}${sinRegla > 0 ? `\n· Sin puente determinable (se omiten): ${sinRegla}` : ''}\n\nEl descuento se refleja en Saldos de Puentes.`)) return;
      for (let i = 0; i < cambios.length; i += 400) {
        const batch = writeBatch(db);
        cambios.slice(i, i + 400).forEach(({ op, campos }) => batch.update(doc(db, 'operaciones', op.id), campos));
        await batch.commit();
      }
      const mapa = new Map(cambios.map(x => [x.op.id, x.campos]));
      setOperacionesGlobales(prev => prev.map(op => mapa.has(op.id) ? { ...op, ...mapa.get(op.id) } : op));
      alert(`Listo: ${cambios.length} operación(es) con su monto de puente.`);
    } catch (e) {
      console.error(e);
      alert(`No se pudieron asignar los montos: ${(e as Error)?.message || e}`);
    } finally {
      setAsignandoMontos(false);
    }
  };

  // Puentes del catálogo de tipos de gasto (categoria_gasto = "Puente")
  const nombrePuente = (c: any) => c?.nombre ?? c?.concepto ?? c?.tipo_gasto ?? c?.tipoGasto ?? c?.descripcion ?? c?.nombre_gasto ?? c?.id ?? '-';

  const puentesCatalogo = useMemo(() =>
    tiposGastoList
      .filter(c => String(c.categoria_gasto ?? c.categoriaGasto ?? c.categoria ?? '').toLowerCase().includes('puente'))
      .sort((a, b) => String(nombrePuente(a)).localeCompare(String(nombrePuente(b)), 'es', { sensitivity: 'base' })),
  [tiposGastoList]);


  // ✅ V00394: UNA referencia por PUENTE con su propio consecutivo:
  //   AVI-DDMMYY-001 (Puente AVI) · PT3-DDMMYY-001 (Puente III) · PTC-DDMMYY-001 (Colombia).
  //   La fecha del consecutivo es la de GENERACIÓN.
  type GrupoRef = 'AVI' | 'PT3' | 'PTC';
  const NOMBRE_GRUPO: Record<GrupoRef, string> = { AVI: 'Puente AVI', PT3: 'Puente III', PTC: 'Puente Colombia' };
  // ✅ V00416: aduana Colombia (por su convenio) → Puente Colombia; la caseta cobrada debe ser de Colombia
  const esColombiaOp = (op: OpPuente) => sinAcentos(getConvenio(op)).includes('colombia');
  const colombiaMalCobrada = (op: OpPuente) => esColombiaOp(op) && Number(op.saldoPuente) > 0 && !sinAcentos(op.saldoPuentePuente).includes('colombia');
  const grupoPuenteOp = (op: OpPuente): GrupoRef | null => {
    if (esColombiaOp(op)) return 'PTC';
    if (!(Number(op.saldoPuente) > 0)) return null;
    const n = sinAcentos(`${String(op.saldoPuentePuente || '')} ${String(op.saldoPuentePisoPuente || '')}`);
    if (n.includes('colombia')) return 'PTC';
    if (n.includes('avi')) return 'AVI';
    return 'PT3';
  };
  const ddmmyyDe = (iso: string) => { const [y, m, d] = (iso || hoyLocalISO()).split('-'); return `${d}${m}${y.slice(2)}`; };
  const consecutivoPorPuente = (grupo: GrupoRef, usados: string[] = [], fechaIso?: string) => {
    const prefix = `${grupo}-${ddmmyyDe(fechaIso || hoyLocalISO())}-`;
    let maxSeq = 0;
    [...referenciasGlobales.map(r => String(r.consecutivo || '')), ...refsAuto.map(r => String(r.consecutivo || '')), ...usados].forEach(c => { // ✅ V00404: también las del Historial de referencias
      if (!c.startsWith(prefix)) return;
      const seq = parseInt(c.slice(prefix.length), 10);
      if (seq > maxSeq) maxSeq = seq;
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };


  const abrirModalGenerar = () => {
    setHoraReferencia(horaAhora()); // ✅ V00399
    setDestinoPorGrupo({});
    setModalAbierto(true);
  };


  // ✅ V00395: OTROS CRUCES — cruces que no son de una operación. Cada registro
  //   toma el consecutivo de su puente (AVI / PT3 / PTC, misma serie que las
  //   referencias) y queda en el Historial; también descuenta del saldo del puente.
  const grupoDeNombrePuente = (nombre: string): GrupoRef => {
    const n = sinAcentos(nombre);
    if (n.includes('colombia')) return 'PTC';
    if (n.includes('avi')) return 'AVI';
    return 'PT3';
  };
  const usuarioActual = () => auth.currentUser?.displayName || auth.currentUser?.email || 'Usuario';
  const horaAhora = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const monedaCatalogo = (m: unknown) => (String(m || '') === '7dca62b3' ? 'Dólares' : String(m || '') === 'f95d8894' ? 'Pesos' : String(m || ''));
  const otrosCruces = useMemo(() => {
    // ✅ V00415: los otros cruces nuevos viven DENTRO de una referencia del Historial
    const dentro = refsAuto.flatMap(r => ((r as { operacionesGuardadas?: Record<string, unknown>[] }).operacionesGuardadas || [])
      .filter(o => o.esOtroCruce)
      .map(o => ({ id: `${r.id}::${String(o.id)}`, tipo: 'otroCruce', consecutivo: r.consecutivo, fechaCruce: o.fecha, horaCruce: o.horaVerde, puenteNombre: o.puenteNombre, monto: o.caseta, moneda: o.casetaMoneda, unidad: o.unidad, registradoPor: o.registradoPor, _refId: r.id, _filaId: String(o.id) })));
    return [...dentro, ...referenciasGlobales.filter(r => r.tipo === 'otroCruce')];
  }, [referenciasGlobales, refsAuto]);
  const abrirOtroCruce = () => {
    setOtroFecha(hoyLocalISO()); setOtroHora(horaAhora()); setOtroPuenteId(''); setOtroMonto(''); setOtroUnidad(''); setOtroDestino('');
    setModalOtro(true);
  };
  const puenteOtro = puentesCatalogo.find(p => p.id === otroPuenteId) || null;
  // ✅ V00415: el OTRO CRUCE entra a la referencia del Historial que el usuario ELIJA
  //   (de ese puente) o a una nueva; ya no se crea sola.
  const refsDestinoOtro = puenteOtro ? refsAuto.filter(r => String((r as { grupoPuente?: string }).grupoPuente || '') === grupoDeNombrePuente(String(nombrePuente(puenteOtro)))) : [];
  const guardarOtroCruce = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puenteOtro) return alert('Elige el puente por donde cruzó.');
    const monto = Number(otroMonto);
    if (!(monto > 0)) return alert('Captura el monto del cruce.');
    if (!otroFecha || !otroHora) return alert('Captura la fecha y la hora del cruce.');
    if (!otroDestino) return alert('Elige la referencia a la que va este cruce (o crea una nueva).');
    setGuardandoOtro(true);
    try {
      const nombre = String(nombrePuente(puenteOtro));
      const grupo = grupoDeNombrePuente(nombre);
      const moneda = monedaCatalogo(puenteOtro.moneda);
      const fila = {
        id: `otro_${Date.now()}`, esOtroCruce: true, grupo,
        ref: `Otro cruce${otroUnidad.trim() ? ` · ${otroUnidad.trim()}` : ''}`,
        fecha: otroFecha, horaVerde: otroHora, unidad: otroUnidad.trim() || '—', convenio: 'Otro cruce (sin operación)',
        puenteNombre: nombre, caseta: monto, casetaMoneda: moneda, piso: 0, pisoMoneda: '', puente: monto,
        registradoPor: usuarioActual(),
      };
      const existentesDia = refsAuto.filter(r => String((r as { grupoPuente?: string }).grupoPuente || '') === grupo && String(r.fechaGeneracion || '') === otroFecha);
      const docId = otroDestino !== '__nuevo__' ? otroDestino
        : (existentesDia.length === 0 ? `${grupo}_${otroFecha}` : `${grupo}_${otroFecha}_${Date.now()}`);
      await upsertReferenciaAuto(docId, grupo, otroFecha, [fila], otroHora, 'manual');
      setModalOtro(false);
    } catch (err) {
      console.error(err);
      alert(`No se pudo registrar el cruce: ${(err as Error)?.message || err}`);
    } finally {
      setGuardandoOtro(false);
    }
  };

  const abrirSaldo = () => { setSaldoFecha(hoyLocalISO()); setSaldoHora(horaAhora()); setSaldoPuenteId(''); setSaldoMonto(''); setModalSaldo(true); };
  const guardarSaldo = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = puentesCatalogo.find(x => x.id === saldoPuenteId);
    if (!p) return alert('Elige el puente.');
    const n = Number(saldoMonto);
    if (!(n > 0)) return alert('Captura el saldo inicial.');
    if (!saldoFecha || !saldoHora) return alert('Captura la fecha y la hora.');
    setGuardandoSaldo(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(collection(db, 'saldos_puentes')), {
        fecha: saldoFecha, hora: saldoHora,
        puenteId: p.id, puenteNombre: String(nombrePuente(p)),
        moneda: monedaCatalogo(p.moneda), saldo: n,
        registradoPor: usuarioActual(),
        creadoEn: new Date().toISOString(),
      });
      await batch.commit();
      setModalSaldo(false);
    } catch (err) {
      alert(`No se pudo guardar el saldo: ${(err as Error)?.message || err}`);
    } finally { setGuardandoSaldo(false); }
  };
  const eliminarSaldo = async (r: Record<string, unknown>) => {
    if (!window.confirm(`¿Eliminar el saldo de ${String(r.puenteNombre || '')} del ${formatearFechaSpanish(String(r.fecha || ''))} por ${formatoMoneda(Number(r.saldo) || 0)}?`)) return;
    try { const batch = writeBatch(db); batch.delete(doc(db, 'saldos_puentes', String(r.id))); await batch.commit(); }
    catch (err) { alert(`No se pudo eliminar: ${(err as Error)?.message || err}`); }
  };

  // ✅ V00397: cada SALDO se consume en orden (primero el más antiguo) con los cruces
  //   de su puente desde su fecha → cruces, monto cruzado, balance y para cuántos
  //   cruces alcanza (balance ÷ tarifa del puente).
  // ✅ V00399: el MONTO CRUZADO de cada saldo es la suma de las REFERENCIAS del
  //   Historial (de operaciones y otros cruces) de su puente, desde su fecha; se
  //   consume primero el saldo más antiguo.
  type RefSaldo = { ref: Record<string, unknown>; fecha: string; hora: string; monto: number; ops: number };
  const asignacionSaldos = useMemo(() => {
    const res: Record<string, { refs: RefSaldo[]; consumido: number; balance: number; cruces: number }> = {};
    const porPuente = new Map<string, Record<string, unknown>[]>();
    // ✅ V00418: el saldo es por PUENTE (AVI / Puente III / Colombia): descuenta TODOS los
    //   cobros de ese puente — p. ej. Puente III = Caseta Puente III + Trompo Puente III;
    //   Colombia = Caseta Mx Colombia + Puente Mx Colombia — así cuadra con el Historial.
    saldosLista.forEach(r => { const k = grupoDeNombrePuente(String(r.puenteNombre || '')); porPuente.set(k, [...(porPuente.get(k) || []), r]); });
    porPuente.forEach((recs, k) => {
      const orden = [...recs].sort((a, b) => `${String(a.fecha || '')} ${String(a.hora || '')}`.localeCompare(`${String(b.fecha || '')} ${String(b.hora || '')}`));
      const primera = String(orden[0]?.fecha || '');
      const restante = orden.map(r => Number(r.saldo) || 0);
      orden.forEach(r => { res[String(r.id)] = { refs: [], consumido: 0, balance: Number(r.saldo) || 0, cruces: 0 }; });
      const items: RefSaldo[] = [];
      // ✅ V00404: Historial de referencias (calculado) + Otros Cruces
      [...(refsAuto as unknown as Record<string, unknown>[]), ...referenciasGlobales.filter((x: Record<string, unknown>) => x.tipo === 'otroCruce')].forEach((r: Record<string, unknown>) => {
        const fecha = String(r.fechaGeneracion || String(r.createdAt || '').slice(0, 10));
        if (primera && fecha < primera) return;
        const hora = String(r.horaGeneracion || r.horaCruce || '');
        if (r.tipo === 'otroCruce') {
          if (grupoDeNombrePuente(String(r.puenteNombre || '')) === k) items.push({ ref: r, fecha, hora, monto: Number(r.monto ?? r.subtotalPuentes) || 0, ops: 1 });
          return;
        }
        let monto = 0, ops = 0;
        (Array.isArray(r.operacionesGuardadas) ? r.operacionesGuardadas : []).forEach((o: Record<string, unknown>) => {
          const [nomCaseta, nomPiso] = String(o.puenteNombre || '').split(' + ');
          let cuenta = false;
          if (nomCaseta && grupoDeNombrePuente(nomCaseta) === k) { monto += Number(o.caseta ?? o.puente) || 0; cuenta = true; }
          if (nomPiso && grupoDeNombrePuente(nomPiso) === k) { monto += Number(o.piso) || 0; cuenta = true; }
          if (cuenta) ops += 1;
        });
        if (monto > 0) items.push({ ref: r, fecha, hora, monto, ops });
      });
      items.sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`)).forEach(it => {
        let i = restante.findIndex((v, idx) => v > 0.0001 && String(orden[idx].fecha || '') <= it.fecha);
        if (i < 0) { i = orden.length - 1; while (i > 0 && String(orden[i].fecha || '') > it.fecha) i--; }
        restante[i] -= it.monto;
        const e = res[String(orden[i].id)];
        e.refs.push(it); e.consumido += it.monto; e.balance -= it.monto; e.cruces += it.ops;
      });
    });
    return res;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- grupoDeNombrePuente es una función pura
  }, [referenciasGlobales, saldosLista, refsAuto]);
  const [refAbierta, setRefAbierta] = useState<string>('');
  const tarifaPuente = (r: Record<string, unknown>) => {
    const p = puentesCatalogo.find(x => x.id === r.puenteId) || puentesCatalogo.find(x => sinAcentos(nombrePuente(x)) === sinAcentos(r.puenteNombre));
    return Number(p?.importe) || 0;
  };

  const gruposAsignacion = useMemo(() => {
    const mapa = new Map<string, { grupo: GrupoRef; fecha: string; ops: OpPuente[] }>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (!op) return;
      const g = grupoPuenteOp(op) || 'PT3';
      const fecha = String(op.fechaServicio || '').slice(0, 10) || hoyLocalISO();
      const k = `${g}|${fecha}`;
      const ent = mapa.get(k) || { grupo: g, fecha, ops: [] };
      ent.ops.push(op);
      mapa.set(k, ent);
    });
    return Array.from(mapa.entries()).map(([clave, v]) => ({
      clave, ...v,
      total: v.ops.reduce((a, o) => a + getPuente(o), 0),
      existentes: refsAuto.filter(r => String((r as { grupoPuente?: string }).grupoPuente || '') === v.grupo && String(r.fechaGeneracion || '') === v.fecha),
    })).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.grupo.localeCompare(b.grupo));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionadas, operacionesGlobales, refsAuto]);

  const handleGuardarReferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    // ✅ V00404: las operaciones van al HISTORIAL DE REFERENCIAS (calculado) — a la
    //   referencia elegida de su puente y fecha de servicio, o a una nueva.
    if (seleccionadas.length === 0) return alert('Selecciona al menos una operación.');
    setGuardando(true);
    try {
      let omitidas = 0;
      for (const g of gruposAsignacion) {
        const destino = destinoPorGrupo[g.clave] || (g.existentes[0]?.id ?? '__nuevo__');
        const filas: Record<string, unknown>[] = [];
        for (const op of g.ops) {
          const r = await filaDeOperacion({ ...op, _docId: op._docId || op.id }, textoHoraVerde(op));
          if (r) filas.push(r.fila); else omitidas += 1;
        }
        if (filas.length === 0) continue;
        const docId = destino !== '__nuevo__' ? destino
          : (g.existentes.length === 0 ? `${g.grupo}_${g.fecha}` : `${g.grupo}_${g.fecha}_${Date.now()}`);
        await upsertReferenciaAuto(docId, g.grupo, g.fecha, filas, horaReferencia || horaAhora(), 'manual');
      }
      setModalAbierto(false);
      setSeleccionadas([]);
      setActiveTab('calculado');
      if (omitidas) alert(`${omitidas} operación(es) no se agregaron: no se pudo determinar su puente (revisa su convenio o tráfico).`);
    } catch (error) {
      console.error(error);
      alert(`Error al enviar al Historial de referencias: ${(error as Error)?.message || error}`);
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarReferencia = async (e: React.MouseEvent, refData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Eliminar la referencia ${refData.consecutivo}? Las operaciones quedarán liberadas nuevamente.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'referencias_puentes', refData.id));
        if (Array.isArray(refData.operacionesIds)) {
          refData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), { referenciaPuentesId: null, referenciaPuentesConsecutivo: null });
          });
        }
        await batch.commit();
        const idsLiberadas: string[] = Array.isArray(refData.operacionesIds) ? refData.operacionesIds : [];
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, referenciaPuentesId: null, referenciaPuentesConsecutivo: null } : op
        ));
      } catch (error) {
        console.error('Error al eliminar referencia:', error);
        alert('Hubo un error al eliminar.');
      }
    }
  };

  const handleTogglePago = async (e: React.MouseEvent, refData: any) => {
    e.stopPropagation();
    const nuevoPagado = !refData.statusPagado;
    const accion = nuevoPagado ? 'marcar como PAGADA' : 'regresar a PENDIENTE';
    if (!window.confirm(`¿Deseas ${accion} la referencia ${refData.consecutivo}?`)) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'referencias_puentes', refData.id), { statusPagado: nuevoPagado });
      await batch.commit();
      setReferenciasGlobales(prev => prev.map(r => r.id === refData.id ? { ...r, statusPagado: nuevoPagado } : r));
    } catch (error) {
      console.error('Error al actualizar estatus:', error);
      alert('No se pudo actualizar el estatus.');
    }
  };

  // ── Historial ──
  const historialBusqueda = useMemo(() => {
    const t = busquedaHistorial.toLowerCase();
    return referenciasGlobales.filter(r =>
      r.consecutivo?.toLowerCase().includes(t) ||
      String(r.traficoPredominante || '').toLowerCase().includes(t) ||
      String(r.puenteNombre || '').toLowerCase().includes(t) ||
      String(r.unidad || '').toLowerCase().includes(t)
    );
  }, [referenciasGlobales, busquedaHistorial]);

  const conteoHist = useMemo(() => {
    const pagadas = historialBusqueda.filter(r => !!r.statusPagado).length;
    return { pendientes: historialBusqueda.length - pagadas, pagadas };
  }, [historialBusqueda]);

  const historialFiltrado = useMemo(() =>
    historialBusqueda.filter(r => filtroEstadoHist === 'pagadas' ? !!r.statusPagado : !r.statusPagado),
  [historialBusqueda, filtroEstadoHist]);

  const totalPaginas = Math.ceil(historialFiltrado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialFiltrado.slice(indexFirst, indexLast);
  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  useEffect(() => { setPaginaActual(1); }, [busquedaHistorial, filtroEstadoHist]);

  const exportarHistorialExcel = () => {
    if (historialFiltrado.length === 0) return alert('No hay datos para exportar.');
    const datos = historialFiltrado.map(r => ({
      'Consecutivo': r.consecutivo,
      'Tráfico': r.traficoPredominante || '-',
      'Fecha Pago': formatearFechaSpanish(r.fechaPago),
      'Período': `${formatearFechaSpanish(r.fechaInicio)} al ${formatearFechaSpanish(r.fechaFin)}`,
      'Status': r.statusPagado ? 'PAGADA' : 'PENDIENTE',
      'Operaciones': Array.isArray(r.operacionesIds) ? r.operacionesIds.length : 0,
      'Subtotal Puentes': Number(r.subtotalPuentes || 0),
      'Observaciones': r.observaciones || ''
    }));
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Puentes');
    XLSX.writeFile(wb, `Historial_Puentes_${hoyLocalISO()}.xlsx`);
  };

  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any
  });
  const thOrdenStyle: React.CSSProperties = { padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const selectOrdenStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 10px', fontSize: '0.85rem' };
  const btnDirStyle: React.CSSProperties = { backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' };
  const colsOpsVisibles = columnasOps.filter(c => c.visible).length + 1;
  const labelFiltro: React.CSSProperties = { color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' };
  const inputFiltro: React.CSSProperties = { width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' };

  return (
    <div className="module-container rpd-x4">
      <h1 className="rpd-x5">Referencias de Puentes</h1>

      <div className="rpd-x6">
        {/* ✅ V00404: orden — Historial de referencias · Operaciones sin asignar · Saldo */}
        <button onClick={() => setActiveTab('calculado')} style={tabStyle(activeTab === 'calculado')}>Historial de referencias</button>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Operaciones sin asignar</button>
        <button onClick={() => setActiveTab('saldos')} style={tabStyle(activeTab === 'saldos')}>Saldo</button>
        <button onClick={() => setActiveTab('otros')} style={tabStyle(activeTab === 'otros')}>Otros Cruces</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial manual (anterior)</button>
      </div>

      {activeTab === 'calculado' ? (
        <div className="animation-fade-in">
          {/* ✅ V00402: HISTORIAL CALCULADO */}
          <div className="rpd-otros-barra">
            <span className="rpd-otros-nota">Una referencia por puente y día (AVI / PT3 / PTC). Las operaciones entran solas al marcar Verde (MX o USA) o se envían desde Operaciones sin asignar. Es lo que descuenta del Saldo.</span>
            <div className="rpd-acciones-hist">
              {selRefsAuto.length > 0 && (
                <button type="button" className="rpd-btn-borrar" onClick={() => borrarRefsAuto(selRefsAuto)} disabled={borrandoRefs}>{borrandoRefs ? 'Eliminando…' : `Eliminar seleccionadas (${selRefsAuto.length})`}</button>
              )}
              {refsAuto.length > 0 && (
                <button type="button" className="rpd-btn-borrar rpd-btn-borrar--todo" onClick={() => borrarRefsAuto(refsAuto.map(r => r.id))} disabled={borrandoRefs} title="Elimina todas las referencias; sus operaciones regresan a Operaciones sin asignar">Eliminar todas</button>
              )}
              <button type="button" className="rpd-btn-asignar" onClick={recalcularHoy} disabled={recalculando} title="Revisa la bitácora de hoy y agrega los verdes que falten">{recalculando ? 'Revisando…' : 'Recalcular hoy'}</button>
            </div>
          </div>
          <div className="table-container rpd-x41">
            <table className="rpd-x27">
              <thead className="rpd-x28">
                <tr>
                  <th className="rpd-x42">
                    <input type="checkbox" className="rpd-x32" title="Seleccionar todas" checked={refsAuto.length > 0 && selRefsAuto.length === refsAuto.length}
                      onChange={(e) => setSelRefsAuto(e.target.checked ? refsAuto.map(r => r.id) : [])} />
                  </th>
                  <th className="rpd-x43"># REFERENCIA</th>
                  <th className="rpd-x43">PUENTE</th>
                  <th className="rpd-x43">FECHA</th>
                  <th className="rpd-x43">HORA</th>
                  <th className="rpd-x43">REFERENCIAS SELECCIONADAS</th>
                  <th className="rpd-x43">TOTAL A PAGAR</th>
                </tr>
              </thead>
              <tbody>
                {refsAuto.length === 0 ? (
                  <tr><td className="rpd-x45" colSpan={7}>Aún no hay referencias automáticas. Se crean al marcar Verde una operación.</td></tr>
                ) : refsAuto.map(r => (
                  <tr key={r.id} className="rpd-x46 rpd-fila-clic" title="Ver detalle" onClick={() => setReferenciaViendo(r)}>
                    <td className="rpd-x47">
                      <input type="checkbox" className="rpd-x32" checked={selRefsAuto.includes(r.id)} onClick={(e) => e.stopPropagation()}
                        onChange={() => setSelRefsAuto(prev => prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id])} />
                      <button className="rpd-x51" title="Eliminar (sus operaciones regresan a Operaciones sin asignar)" onClick={(e) => { e.stopPropagation(); eliminarRefAuto(r); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    </td>
                    <td className="rpd-x52">{r.consecutivo} <span className="rpd-chip-auto">auto</span></td>
                    <td className="rpd-celda">{r.puenteNombre || '—'}</td>
                    <td className="rpd-celda">{formatearFechaSpanish(r.fechaGeneracion || "")}</td>
                    <td className="rpd-celda">{r.horaGeneracion || '—'}</td>
                    <td className="rpd-celda rpd-celda--refs" title={(r.operaciones || []).join(', ')}><b>{(r.operacionesIds || []).length}</b> · {(r.operaciones || []).join(', ')}</td>
                    <td className="rpd-x3">{r.totalesPorMoneda && Object.keys(r.totalesPorMoneda).length ? Object.entries(r.totalesPorMoneda as Record<string, number>).map(([m, t]) => <div key={m}>{formatoMoneda(t)} <span className="rpd-moneda">{m}</span></div>) : formatoMoneda(r.subtotalPuentes)}</td>
                  </tr>
                ))}
              </tbody>
              {/* ✅ V00410: cantidades del historial */}
              {refsAuto.length > 0 && (
                <tfoot>
                  <tr className="rpd-total-fila">
                    <td colSpan={5}><b>{refsAuto.length}</b> {refsAuto.length === 1 ? 'referencia' : 'referencias'}</td>
                    <td><b>{refsAuto.reduce((a, r) => a + (r.operacionesIds || []).length, 0)}</b> operaciones</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : activeTab === 'saldos' ? (
        <div className="animation-fade-in">
          {/* ✅ V00396: AGREGAR SALDO */}
          <div className="rpd-otros-barra">
            <span className="rpd-otros-nota">Saldo inicial de cada puente. Se descuenta con el Historial de referencias (y los Otros Cruces) de ese puente a partir de su fecha.</span>
            <button type="button" className="rpd-btn-otro" onClick={abrirSaldo}>+ Agregar saldo</button>
          </div>
          {/* ✅ V00413: balance de los TRES puentes */}
          <div className="rpd-balances">
            {(['AVI', 'PT3', 'PTC'] as GrupoRef[]).map(g => {
              const filas = saldosLista.filter(r => grupoDeNombrePuente(String(r.puenteNombre || '')) === g);
              const partes = filas.map(r => ({ r, a: asignacionSaldos[String(r.id)] || { consumido: 0, balance: Number(r.saldo) || 0, cruces: 0 } }));
              const balance = partes.reduce((x, p) => x + p.a.balance, 0);
              const agregado = filas.reduce((x, r) => x + (Number(r.saldo) || 0), 0);
              const consumido = partes.reduce((x, p) => x + p.a.consumido, 0);
              const cruces = partes.reduce((x, p) => x + p.a.cruces, 0);
              const mon = String(filas[0]?.moneda || '');
              // Colombia: caseta y puente por separado
              const porPuente = new Map<string, number>();
              partes.forEach(p => porPuente.set(String(p.r.puenteNombre || ''), (porPuente.get(String(p.r.puenteNombre || '')) || 0) + p.a.balance));
              return (
                <div key={g} className={`rpd-balance-card rpd-balance-card--${g.toLowerCase()}${balance < 0 ? ' rpd-balance-card--neg' : ''}`}>
                  <div className="rpd-balance-card__enc"><span>{NOMBRE_GRUPO[g]}</span>{mon && <em>{mon === 'Dólares' ? 'USD' : mon === 'Pesos' ? 'MXN' : mon}</em>}</div>
                  <b className="rpd-balance-card__v">{filas.length ? formatoMoneda(balance) : '—'}</b>
                  <span className="rpd-balance-card__sub">{filas.length ? 'Balance' : 'Sin saldo agregado'}</span>
                  <div className="rpd-balance-card__filas">
                    <div><span>Agregado</span><b className="rpd-abono">+{formatoMoneda(agregado)}</b></div>
                    <div><span>Cruzado · {cruces}</span><b className="rpd-cargo">−{formatoMoneda(consumido)}</b></div>
                    {g === 'PTC' && porPuente.size > 1 && Array.from(porPuente.entries()).map(([n, v]) => <div key={n}><span>{n}</span><b>{formatoMoneda(v)}</b></div>)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="table-container rpd-x41">
            <table className="rpd-x27">
              <thead className="rpd-x28">
                <tr>
                  <th className="rpd-x43">FECHA</th>
                  <th className="rpd-x43">HORA</th>
                  <th className="rpd-x43">PUENTE</th>
                  <th className="rpd-x43">SALDO INICIAL</th>
                  <th className="rpd-x43">CRUCES</th>
                  <th className="rpd-x43">MONTO CRUZADO</th>
                  <th className="rpd-x43">BALANCE</th>
                  <th className="rpd-x43">ALCANZA PARA</th>
                  <th className="rpd-x43"></th>
                </tr>
              </thead>
              <tbody>
                {saldosLista.length === 0 ? (
                  <tr><td className="rpd-x45" colSpan={9}>Aún no hay saldos registrados. Usa "+ Agregar saldo".</td></tr>
                ) : saldosLista.map(r => {
                  const a = asignacionSaldos[String(r.id)] || { refs: [], consumido: 0, balance: Number(r.saldo) || 0, cruces: 0 };
                  const tarifa = tarifaPuente(r);
                  const alcanza = tarifa > 0 && a.balance > 0 ? Math.floor(a.balance / tarifa) : 0;
                  return (
                  <tr className="rpd-x46 rpd-fila-clic" key={String(r.id)} title="Ver el asiento: saldo y descuentos" onClick={() => setSaldoViendo(r)}>
                    <td className="rpd-celda">{formatearFechaSpanish(String(r.fecha || ''))}</td>
                    <td className="rpd-celda">{String(r.hora || '—')}</td>
                    <td className="rpd-celda">{String(r.puenteNombre || '')}</td>
                    <td className="rpd-x3">{formatoMoneda(Number(r.saldo) || 0)} <span className="rpd-moneda">{String(r.moneda || '')}</span></td>
                    <td className="rpd-celda"><b>{a.cruces}</b> <span className="rpd-moneda">en {a.refs.length} ref.</span></td>
                    <td className="rpd-celda rpd-cargo">−{formatoMoneda(a.consumido)}</td>
                    <td className={`rpd-celda rpd-balance${a.balance < 0 ? ' rpd-balance--neg' : ''}`}>{formatoMoneda(a.balance)}</td>
                    <td className="rpd-celda">{tarifa > 0 ? <><b>{alcanza}</b> <span className="rpd-moneda">cruces · {formatoMoneda(tarifa)} c/u</span></> : '—'}</td>
                    <td className="rpd-celda">
                      <button className="rpd-x51" title="Eliminar" onClick={(e) => { e.stopPropagation(); eliminarSaldo(r); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ✅ V00397: ASIENTO del saldo — abono inicial y cada descuento con su saldo corrido */}
          {saldoViendo && (() => {
            const a = asignacionSaldos[String(saldoViendo.id)] || { refs: [], consumido: 0, balance: Number(saldoViendo.saldo) || 0, cruces: 0 };
            let corrido = Number(saldoViendo.saldo) || 0;
            const mon = String(saldoViendo.moneda || '');
            return (
              <div className="modal-overlay rpd-x68" onClick={() => setSaldoViendo(null)}>
                <div className="rpd-x69 rpd-asiento" onClick={(e) => e.stopPropagation()}>
                  <div className="rpd-x70">
                    <h2 className="rpd-x71">{String(saldoViendo.puenteNombre || '')} — saldo del {formatearFechaSpanish(String(saldoViendo.fecha || ''))}</h2>
                    <button className="rpd-x62" onClick={() => setSaldoViendo(null)}>✕</button>
                  </div>
                  <div className="rpd-asiento__resumen">
                    <div className="rpd-asiento__k rpd-asiento__k--abono"><span>Saldo inicial</span><b>{formatoMoneda(Number(saldoViendo.saldo) || 0)} <em>{mon}</em></b></div>
                    <div className="rpd-asiento__k"><span>Referencias · cruces</span><b>{a.refs.length} · {a.cruces}</b></div>
                    <div className="rpd-asiento__k rpd-asiento__k--cargo"><span>Monto cruzado</span><b>−{formatoMoneda(a.consumido)}</b></div>
                    <div className={`rpd-asiento__k rpd-asiento__k--balance${a.balance < 0 ? ' rpd-asiento__k--neg' : ''}`}><span>Balance</span><b>{formatoMoneda(a.balance)} <em>{mon}</em></b></div>
                  </div>
                  <div className="rpd-asiento__marco">
                    <table className="rpd-asiento__tabla">
                      <thead><tr><th>Fecha</th><th># Referencia</th><th>Concepto</th><th className="rpd-num">Cargo (−)</th><th className="rpd-num">Abono (+)</th><th className="rpd-num">Saldo</th></tr></thead>
                      <tbody>
                        <tr className="rpd-asiento__abono">
                          <td>{formatearFechaSpanish(String(saldoViendo.fecha || ''))}{saldoViendo.hora ? ` ${String(saldoViendo.hora)}` : ''}</td>
                          <td>—</td>
                          <td>Saldo inicial</td>
                          <td className="rpd-num"></td>
                          <td className="rpd-num rpd-abono">+{formatoMoneda(Number(saldoViendo.saldo) || 0)}</td>
                          <td className="rpd-num">{formatoMoneda(corrido)}</td>
                        </tr>
                        {a.refs.map((it) => {
                          corrido -= it.monto;
                          const id = String(it.ref.id);
                          const abierta = refAbierta === id;
                          // ✅ V00417: solo las operaciones (y la PARTE) que descuentan de ESTE saldo:
                          //   p. ej. el saldo de "Puente Mx Colombia" lleva el puente ($90) y no la caseta.
                          const kSaldo = grupoDeNombrePuente(String(saldoViendo.puenteNombre || '')); // ✅ V00418: por puente
                          const opsRef = ((Array.isArray(it.ref.operacionesGuardadas) ? it.ref.operacionesGuardadas : []) as Record<string, unknown>[])
                            .map((o): Record<string, unknown> & { _aplica: number; _concepto: string } => {
                              const [nomCaseta, nomPiso] = String(o.puenteNombre || '').split(' + ');
                              const enCaseta = !!nomCaseta && grupoDeNombrePuente(nomCaseta) === kSaldo;
                              const enPiso = !!nomPiso && grupoDeNombrePuente(nomPiso) === kSaldo;
                              const aplica = (enCaseta ? (Number(o.caseta ?? o.puente) || 0) : 0) + (enPiso ? (Number(o.piso) || 0) : 0);
                              return { ...o, _aplica: aplica, _concepto: [enCaseta ? nomCaseta : '', enPiso ? nomPiso : ''].filter(Boolean).join(' + ') };
                            })
                            .filter(o => o._aplica > 0);
                          return (
                            <React.Fragment key={id}>
                              <tr className="rpd-fila-clic rpd-asiento__cargo" title="Ver las operaciones de esta referencia" onClick={() => setRefAbierta(abierta ? '' : id)}>
                                <td>{formatearFechaSpanish(it.fecha)}{it.hora ? ` ${it.hora}` : ''}</td>
                                <td className="rpd-x52">{abierta ? '▾' : '▸'} {String(it.ref.consecutivo || '')}</td>
                                <td>{it.ref.tipo === 'otroCruce' ? `Otro cruce · ${String(it.ref.unidad || '')}` : `${it.ops} ${it.ops === 1 ? 'cruce' : 'cruces'}`}</td>
                                <td className="rpd-num rpd-cargo">−{formatoMoneda(it.monto)}</td>
                                <td className="rpd-num"></td>
                                <td className={`rpd-num${corrido < 0 ? ' rpd-balance--neg' : ''}`}>{formatoMoneda(corrido)}</td>
                              </tr>
                              {abierta && (
                                <tr className="rpd-asiento__sub">
                                  <td colSpan={6}>
                                    {it.ref.tipo === 'otroCruce' ? (
                                      <div className="rpd-asiento__sub-vacio">Cruce sin operación · {String(it.ref.puenteNombre || '')} · registrado por {String(it.ref.registradoPor || '—')}</div>
                                    ) : (
                                      <table>
                                        <thead><tr><th>Ref. Operación</th><th>Fecha servicio</th><th>Hora (verde)</th><th>Unidad</th><th>Convenio</th><th>Concepto (este saldo)</th><th className="rpd-num">Monto</th><th className="rpd-num">Total del cruce</th></tr></thead>
                                        <tbody>
                                          {opsRef.map((o, j) => (
                                            <tr key={j}>
                                              <td className="rpd-x52">{String(o.ref || '')}</td>
                                              <td>{formatearFechaSpanish(String(o.fecha || ''))}</td>
                                              <td>{String(o.horaVerde || '—')}</td>
                                              <td>{String(o.unidad || '—')}</td>
                                              <td>{String(o.convenio || '—')}</td>
                                              <td>{String(o._concepto || '—')}</td>
                                              <td className="rpd-num rpd-cargo">{formatoMoneda(o._aplica)}</td>
                                              <td className="rpd-num rpd-moneda" title={String(o.puenteNombre || '')}>{formatoMoneda(Number(o.puente) || 0)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                        {a.refs.length === 0 && <tr><td colSpan={6} className="rpd-x45">Aún no hay referencias en el Historial que descuenten de este saldo.</td></tr>}
                      </tbody>
                      <tfoot><tr><td colSpan={3}>Totales</td><td className="rpd-num rpd-cargo">−{formatoMoneda(a.consumido)}</td><td className="rpd-num rpd-abono">+{formatoMoneda(Number(saldoViendo.saldo) || 0)}</td><td className="rpd-num">{formatoMoneda(a.balance)}</td></tr></tfoot>
                    </table>
                  </div>
                  <div className="rpd-x83"><button className="rpd-x84" type="button" onClick={() => setSaldoViendo(null)}>Cerrar</button></div>
                </div>
              </div>
            );
          })()}

          {modalSaldo && (
            <div className="modal-overlay rpd-x68" onClick={() => !guardandoSaldo && setModalSaldo(false)}>
              <div className="rpd-x69" onClick={(e) => e.stopPropagation()}>
                <div className="rpd-x70">
                  <h2 className="rpd-x71">Agregar saldo</h2>
                  <button className="rpd-x62" onClick={() => setModalSaldo(false)}>✕</button>
                </div>
                <FormularioConfigurable modulo="referenciasPuentes">
                <form onSubmit={guardarSaldo} className="rpd-otro-form">
                  <div className="rpd-otro-grid">
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Fecha</label>
                      <input className="rpd-otro-input" type="date" required value={saldoFecha} onChange={(e) => setSaldoFecha(e.target.value)} />
                    </div>
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Hora</label>
                      <input className="rpd-otro-input" type="time" required value={saldoHora} onChange={(e) => setSaldoHora(e.target.value)} />
                    </div>
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Puente</label>
                      <select className="rpd-otro-input" required value={saldoPuenteId} onChange={(e) => setSaldoPuenteId(e.target.value)}>
                        <option value="">Seleccionar puente…</option>
                        {puentesCatalogo.map(p => <option key={p.id} value={p.id}>{String(nombrePuente(p))}</option>)}
                      </select>
                    </div>
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Saldo inicial{(() => { const p = puentesCatalogo.find(x => x.id === saldoPuenteId); return p ? ` (${monedaCatalogo(p.moneda)})` : ''; })()}</label>
                      <input className="rpd-otro-input" type="number" step="0.01" min="0" required value={saldoMonto} onChange={(e) => setSaldoMonto(e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                  <div className="rpd-x83">
                    <button className="rpd-x84" type="button" onClick={() => setModalSaldo(false)} disabled={guardandoSaldo}>Cancelar</button>
                    <button className="rpd-x85" type="submit" disabled={guardandoSaldo}>{guardandoSaldo ? 'Guardando…' : 'Guardar saldo'}</button>
                  </div>
                </form>
                </FormularioConfigurable>
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'otros' ? (
        <div className="animation-fade-in">
          {/* ✅ V00395: OTROS CRUCES */}
          <div className="rpd-otros-barra">
            <span className="rpd-otros-nota">Cruces que no son de una operación (por ejemplo, carros particulares). Cada registro toma el consecutivo de su puente, pasa al Historial y descuenta del saldo del puente.</span>
            <button type="button" className="rpd-btn-otro" onClick={abrirOtroCruce}>+ Agregar cruce</button>
          </div>
          <div className="table-container rpd-x41">
            <table className="rpd-x27">
              <thead className="rpd-x28">
                <tr>
                  <th className="rpd-x43">REFERENCIA</th>
                  <th className="rpd-x43">FECHA</th>
                  <th className="rpd-x43">HORA</th>
                  <th className="rpd-x43">PUENTE</th>
                  <th className="rpd-x43">MONTO</th>
                  <th className="rpd-x43">UNIDAD</th>
                  <th className="rpd-x43"></th>
                </tr>
              </thead>
              <tbody>
                {otrosCruces.length === 0 ? (
                  <tr><td className="rpd-x45" colSpan={7}>Aún no hay otros cruces registrados. Usa "+ Agregar cruce".</td></tr>
                ) : otrosCruces.map(r => (
                  <tr className="rpd-x46 rpd-fila-clic" key={r.id} title="Ver detalle" onClick={() => setReferenciaViendo(r)}>
                    <td className="rpd-x52">{r.consecutivo}</td>
                    <td className="rpd-celda">{formatearFechaSpanish(r.fechaCruce || r.fechaGeneracion)}</td>
                    <td className="rpd-celda">{r.horaCruce || r.horaGeneracion || '—'}</td>
                    <td className="rpd-celda">{r.puenteNombre}</td>
                    <td className="rpd-x3">{formatoMoneda(Number(r.monto ?? r.subtotalPuentes) || 0)} <span className="rpd-moneda">{r.moneda || ''}</span></td>
                    <td className="rpd-celda">{r.unidad || '—'}</td>
                    <td className="rpd-celda">
                      <button className="rpd-x51" title="Eliminar" onClick={(e) => { const rr = r as { _refId?: string; _filaId?: string }; if (rr._refId) { e.stopPropagation(); if (window.confirm('¿Eliminar este otro cruce de su referencia?')) quitarOperacionDeReferenciaAuto(String(rr._refId), String(rr._filaId)); } else handleEliminarReferencia(e, r); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {modalOtro && (
            <div className="modal-overlay rpd-x68" onClick={() => !guardandoOtro && setModalOtro(false)}>
              <div className="rpd-x69" onClick={(e) => e.stopPropagation()}>
                <div className="rpd-x70">
                  <h2 className="rpd-x71">Agregar otro cruce</h2>
                  <button className="rpd-x62" onClick={() => setModalOtro(false)}>✕</button>
                </div>
                <FormularioConfigurable modulo="referenciasPuentes">
                <form onSubmit={guardarOtroCruce} className="rpd-otro-form">
                  <div className="rpd-otro-grid">
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Enviar a la referencia</label>
                      <select className="rpd-otro-input" required value={otroDestino} onChange={(e) => setOtroDestino(e.target.value)} disabled={!puenteOtro}>
                        <option value="">{puenteOtro ? 'Elegir referencia…' : 'Primero elige el puente'}</option>
                        {refsDestinoOtro.map(r => <option key={r.id} value={r.id}>{r.consecutivo} · {formatearFechaSpanish(r.fechaGeneracion || '')} · {(r.operacionesIds || []).length} op.</option>)}
                        {puenteOtro && <option value="__nuevo__">+ Crear referencia nueva ({consecutivoPorPuente(grupoDeNombrePuente(String(nombrePuente(puenteOtro))), [], otroFecha)})</option>}
                      </select>
                    </div>
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Puente</label>
                      <select className="rpd-otro-input" required value={otroPuenteId} onChange={(e) => { setOtroPuenteId(e.target.value); setOtroDestino(''); const p = puentesCatalogo.find(x => x.id === e.target.value); if (p) setOtroMonto(String(Number(p.importe) || '')); }}>
                        <option value="">Seleccionar puente…</option>
                        {puentesCatalogo.map(p => <option key={p.id} value={p.id}>{String(nombrePuente(p))}</option>)}
                      </select>
                    </div>
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Fecha</label>
                      <input className="rpd-otro-input" type="date" required value={otroFecha} onChange={(e) => setOtroFecha(e.target.value)} />
                    </div>
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Hora</label>
                      <input className="rpd-otro-input" type="time" required value={otroHora} onChange={(e) => setOtroHora(e.target.value)} />
                    </div>
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Monto{puenteOtro ? ` (${monedaCatalogo(puenteOtro.moneda)})` : ''}</label>
                      <input className="rpd-otro-input" type="number" step="0.01" min="0" required value={otroMonto} onChange={(e) => setOtroMonto(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="rpd-otro-campo">
                      <label className="rpd-otro-label">Unidad</label>
                      <input className="rpd-otro-input" list="rpd-unidades-otro" value={otroUnidad} onChange={(e) => setOtroUnidad(e.target.value)} placeholder="Unidad o vehículo (ej. carro particular)" />
                      <datalist id="rpd-unidades-otro">
                        {unidadesList.map(u => <option key={String(u.id)} value={String(u.unidad ?? u.numeroEconomico ?? u.nombre ?? '')} />)}
                      </datalist>
                    </div>
                  </div>
                  <div className="rpd-x83">
                    <button className="rpd-x84" type="button" onClick={() => setModalOtro(false)} disabled={guardandoOtro}>Cancelar</button>
                    <button className="rpd-x85" type="submit" disabled={guardandoOtro}>{guardandoOtro ? 'Guardando…' : 'Registrar cruce'}</button>
                  </div>
                </form>
                </FormularioConfigurable>
              </div>
            </div>
          )}
        </div>
      ) : activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          <div className="rpd-x7">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(fechaInicio || fechaFin || filtroPuente !== 'todos' || filtroUnidad !== 'todas') ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(fechaInicio || fechaFin || filtroPuente !== 'todos' || filtroUnidad !== 'todas') && <span className="rpd-x8">{[fechaInicio || fechaFin, filtroPuente !== 'todos' ? filtroPuente : '', filtroUnidad !== 'todas' ? filtroUnidad : ''].filter(Boolean).length}</span>}
            </button>
            {(fechaInicio || fechaFin) && (
              <span className="rpd-x9">
                {(fechaInicio || '…')} → {(fechaFin || '…')}
                <button className="rpd-x10" onClick={() => { setFechaInicio(''); setFechaFin(''); setSeleccionadas([]); setBusquedaOpsHecha(false); }}>✕</button>
              </span>
            )}
            {filtroPuente !== 'todos' && (
              <span className="rpd-x11">
                {filtroPuente === '__sin__' ? 'Sin monto' : filtroPuente}
                <button className="rpd-x12" onClick={() => { setFiltroPuente('todos'); setSeleccionadas([]); }}>✕</button>
              </span>
            )}
            {filtroUnidad !== 'todas' && (
              <span className="rpd-x11">
                {filtroUnidad}
                <button className="rpd-x12" onClick={() => { setFiltroUnidad('todas'); setSeleccionadas([]); }}>✕</button>
              </span>
            )}
            {!(fechaInicio || fechaFin) && <span className="rpd-x13">Presiona Filtros, define la fecha de servicio y pulsa Buscar.</span>}
            <div className="rpd-x14">
              <button
                disabled={seleccionadas.length === 0 || filtroEstadoOps === 'asignadas'}
                onClick={abrirModalGenerar}
                style={{ padding: '10px 20px', backgroundColor: (seleccionadas.length > 0 && filtroEstadoOps !== 'asignadas') ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && filtroEstadoOps !== 'asignadas') ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Enviar al Historial ({seleccionadas.length})
              </button>
            </div>
          </div>

          {busquedaOpsHecha ? (
          <>
          <div className="rpd-x15">
            <span className="rpd-x16">
              {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'operación' : 'operaciones'}{(fechaInicio || fechaFin) ? ` · ${fechaInicio ? formatearFechaSpanish(fechaInicio) : '...'} al ${fechaFin ? formatearFechaSpanish(fechaFin) : '...'}` : ''}{filtroPuente !== 'todos' ? ` · ${filtroPuente === '__sin__' ? 'Sin monto' : filtroPuente}` : ''}{filtroUnidad !== 'todas' ? ` · ${filtroUnidad}` : ''}
            </span>
            <div className="rpd-x17">
              <button type="button" className="rpd-btn-asignar" onClick={asignarMontosPuente} disabled={asignandoMontos}
                title="Pone el monto correcto del puente a las operaciones del filtro que no lo tienen (Colombia: caseta + puente)">
                {asignandoMontos ? 'Asignando…' : `Asignar monto del puente (${operacionesBaseFiltro.filter(op => !tieneMontoPuente(op)).length} sin monto${operacionesBaseFiltro.some(colombiaMalCobrada) ? ` · ${operacionesBaseFiltro.filter(colombiaMalCobrada).length} de Colombia por corregir` : ''})`}
              </button>
              <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">⚙ Configurar Columnas</button>
              <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                  cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                  backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                  color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                Exportar Excel ({filtroEstadoOps === 'asignadas' ? 'Asignadas' : 'Pendientes'})
              </button>
            </div>
          </div>

          {seleccionadas.length > 0 && filtroEstadoOps === 'pendientes' && (
            <div className="rpd-x18">
              <div className="rpd-x19">
                <div className="rpd-x20">
                  <span className="rpd-x21">Operaciones</span>
                  <span className="rpd-x22">{seleccionadas.length}</span>
                </div>
                {Object.entries(resumenSeleccion.porMoneda).map(([mon, tot]) => (
                  <div key={mon} className="rpd-x20">
                    <span className="rpd-x21">Puentes ({mon})</span>
                    <span className="rpd-x25">{formatoMoneda(tot)}</span>
                  </div>
                ))}
                {resumenSeleccion.sinMonto > 0 && (
                  <div>
                    <span className="rpd-x24">Sin monto</span>
                    <span className="rpd-sin-monto">{resumenSeleccion.sinMonto}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="table-container rpd-x26">
            <table className="rpd-x27">
              <thead className="rpd-x28">
                <tr>
                  <th className="rpd-x29">
                    {filtroEstadoOps === 'pendientes' && operacionesMostradas.length > 0 && (
                      <input className="rpd-x32" type="checkbox" checked={todasSeleccionadas} onChange={toggleTodas} title="Seleccionar todas" />
                    )}
                  </th>
                  {columnasOps.filter(c => c.visible).map(col => (
                    <th key={col.id}
                      style={col.orden ? thOrdenStyle : { padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}
                      onClick={col.orden ? () => toggleOrdenOps(col.id) : undefined}>
                      {col.label.toUpperCase()}{col.orden ? flechaOps(col.id) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {operacionesMostradas.length === 0 ? (
                  <tr><td className="rpd-x30" colSpan={colsOpsVisibles}>
                    {filtroEstadoOps === 'pendientes' ? 'No hay operaciones pendientes con estos filtros.' : 'No hay operaciones asignadas a referencias con estos filtros.'}
                  </td></tr>
                ) : (
                  operacionesMostradas.map(op => {
                    const seleccionable = filtroEstadoOps === 'pendientes';
                    return (
                      <tr key={op.id} onClick={() => seleccionable && toggleSeleccion(op.id)}
                        style={{ cursor: seleccionable ? 'pointer' : 'default', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                        <td className="rpd-x31">
                          {seleccionable ? (
                            <input className="rpd-x32" type="checkbox" checked={seleccionadas.includes(op.id)} readOnly />
                          ) : (
                            <span className="rpd-x33" title={op.referenciaPuentesConsecutivo || 'Asignada'} />
                          )}
                        </td>
                        {columnasOps.filter(c => c.visible).map(col => renderCeldaOps(op, col.id))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          </>
          ) : (
            <div className="rpd-x34">
              <div className="rpd-x35">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                <span className="rpd-x36">Define la <b className="rpd-x37">Fecha de Servicio</b> en los filtros y presiona <b className="rpd-x38">Buscar</b> para ver las operaciones.</span>
                <button className="rpd-x39" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
              </div>
            </div>
          )}
        </div>

      ) : (
        <div className="animation-fade-in">
          <div className="rpd-x7">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${busquedaHistorial ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {busquedaHistorial && <span className="rpd-x8">1</span>}
            </button>
            {busquedaHistorial && (
              <span className="rpd-x11">
                "{busquedaHistorial}"
                <button className="rpd-x12" onClick={() => setBusquedaHistorial('')}>✕</button>
              </span>
            )}
            <span className="rpd-x13">
              {busquedaHistHecha ? `${historialFiltrado.length} referencias` : 'Presiona Filtros y Buscar para ver el historial.'}
            </span>
            <button className="rpd-x40" title="Exportar a Excel" onClick={exportarHistorialExcel}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          <div className="table-container rpd-x41">
            <table className="rpd-x27">
              <thead className="rpd-x28">
                <tr>
                  <th className="rpd-x42">ACCIONES</th>
                  <th className="rpd-x43"># REFERENCIA</th>
                  <th className="rpd-x43">PUENTE</th>
                  <th className="rpd-x43">FECHA</th>
                  <th className="rpd-x43">HORA</th>
                  <th className="rpd-x43">REFERENCIAS SELECCIONADAS</th>
                  <th className="rpd-x43">TOTAL A PAGAR</th>
                  <th className="rpd-x43">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {!busquedaHistHecha ? (
                  <tr><td className="rpd-x44" colSpan={8}>
                    <div className="rpd-x35">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="rpd-x36">Define tus filtros y presiona <b className="rpd-x38">Buscar</b> para ver las referencias.</span>
                      <button className="rpd-x39" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td className="rpd-x45" colSpan={8}>
                    {filtroEstadoHist === 'pendientes' ? 'No hay referencias pendientes de pago.' : 'No hay referencias pagadas.'}
                  </td></tr>
                ) : (
                  registrosVisibles.map(r => (
                    <tr className="rpd-x46" key={r.id}>
                      <td className="rpd-x31">
                        <div className="rpd-x47">
                          {r.statusPagado ? (
                            <button className="rpd-x48" title="Regresar a Pendiente" onClick={(e) => handleTogglePago(e, r)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                            </button>
                          ) : (
                            <button className="rpd-x49" title="Marcar como Pagada" onClick={(e) => handleTogglePago(e, r)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </button>
                          )}
                          <button className="rpd-x50" title="Ver Detalle" onClick={() => setReferenciaViendo(r)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button className="rpd-x51" title="Eliminar" onClick={(e) => handleEliminarReferencia(e, r)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      <td className="rpd-x52">{r.consecutivo}</td>
                      <td className="rpd-celda">{r.puenteNombre || '—'}</td>
                      <td className="rpd-celda">{formatearFechaSpanish(r.fechaGeneracion || String(r.createdAt || '').slice(0, 10))}</td>
                      <td className="rpd-celda">{r.horaGeneracion || (r.createdAt ? new Date(r.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—')}</td>
                      <td className="rpd-celda rpd-celda--refs" title={(Array.isArray(r.operaciones) ? r.operaciones : (r.operacionesGuardadas || []).map((o: { ref?: string }) => o.ref)).join(', ')}>
                        {r.tipo === 'otroCruce'
                          ? <><span className="rpd-chip-otro">Otro cruce</span> {r.unidad || '—'}</>
                          : <><b>{Array.isArray(r.operacionesIds) ? r.operacionesIds.length : 0}</b> · {(Array.isArray(r.operaciones) ? r.operaciones : (r.operacionesGuardadas || []).map((o: { ref?: string }) => o.ref)).join(', ')}</>}
                      </td>
                      <td className="rpd-x3">{r.totalesPorMoneda && Object.keys(r.totalesPorMoneda).length ? Object.entries(r.totalesPorMoneda as Record<string, number>).map(([m, t]) => <div key={m}>{formatoMoneda(t)} <span className="rpd-moneda">{m}</span></div>) : formatoMoneda(r.subtotalPuentes)}</td>
                      <td className="rpd-x2">
                        <span className={`rpd-status ${r.statusPagado ? 'rpd-status--pagada' : 'rpd-status--pendiente'}`}>{r.statusPagado ? 'PAGADA' : 'PENDIENTE'}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {busquedaHistHecha && totalPaginas > 1 && (
            <div className="rpd-x56">
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span className="rpd-x57">{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* MODAL CONFIGURAR COLUMNAS */}
      {modalColumnasOps && (
        <div className="modal-overlay rpd-x58">
          <div className="rpd-x59">
            <div className="rpd-x60">
              <h3 className="rpd-x61">Configurar Columnas</h3>
              <button className="rpd-x62" onClick={() => setModalColumnasOps(false)}>✕</button>
            </div>
            <p className="rpd-x63">Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel.</p>
            <ul className="rpd-x64">
              {columnasOps.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStartOps(e, idx)} onDragEnter={() => handleDragEnterOps(idx)} onDragEnd={() => setDraggedColOpsIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColOpsIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="rpd-x65" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="rpd-x66">
              <button className="rpd-x67" onClick={() => setModalColumnasOps(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GENERAR REFERENCIA */}
      {modalAbierto && (
        <div className="modal-overlay rpd-x68">
          <div className="rpd-x69 rpd-modal--ancho">
            <div className="rpd-x70">
              <h2 className="rpd-x71">Enviar al Historial de referencias</h2>
              <button className="rpd-x62" onClick={() => setModalAbierto(false)}>✕</button>
            </div>

            {/* ✅ V00404: por puente y fecha de servicio, elegir la referencia del Historial o crear una nueva */}
            <div className="rpd-grupos">
              {gruposAsignacion.map(g => {
                const destino = destinoPorGrupo[g.clave] || (g.existentes[0]?.id ?? '__nuevo__');
                return (
                  <div key={g.clave} className="rpd-grupo">
                    <div className="rpd-grupo__enc">
                      <span className="rpd-grupo__puente">{NOMBRE_GRUPO[g.grupo]} · {formatearFechaSpanish(g.fecha)}</span>
                      <span className="rpd-grupo__total">{formatoMoneda(g.total)}</span>
                    </div>
                    <div className="rpd-grupo__destino">
                      <label>Enviar a</label>
                      <select value={destino} onChange={e => setDestinoPorGrupo(prev => ({ ...prev, [g.clave]: e.target.value }))}>
                        {g.existentes.map(r => <option key={r.id} value={r.id}>{r.consecutivo} — {(r.operacionesIds || []).length} operación(es)</option>)}
                        <option value="__nuevo__">+ Crear referencia nueva {g.existentes.length === 0 ? `(${consecutivoPorPuente(g.grupo, [], g.fecha)})` : ''}</option>
                      </select>
                    </div>
                    <div className="rpd-grupo__tabla">
                      <table>
                        <thead><tr><th>Ref. Operación</th><th>Fecha servicio</th><th>Unidad</th><th>Convenio</th><th>Puente</th><th className="rpd-num">Monto</th></tr></thead>
                        <tbody>
                          {g.ops.map(o => (
                            <tr key={String(o.id)}>
                              <td className="rpd-x52">{String(o.ref || o.id)}</td>
                              <td>{formatearFechaSpanish(String(o.fechaServicio || ''))}</td>
                              <td>{getUnidad(o)}</td>
                              <td className="rpd-grupo__conv" title={getConvenio(o)}>{getConvenio(o)}</td>
                              <td>{nombresPuenteOp(o).join(' + ') || <span className="rpd-sin-monto">Se calcula al enviar</span>}</td>
                              <td className="rpd-num">{getPuente(o) ? formatoMoneda(getPuente(o)) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>

            <FormularioConfigurable modulo="referenciasPuentes">{/* ✅ V00385 */}
            <form onSubmit={handleGuardarReferencia}>
              {/* ✅ V00404: la fecha de cada referencia es la FECHA DE SERVICIO de sus operaciones */}
              <div className="rpd-x77">
                <div>
                  <label style={labelFiltro}>Hora (si se crea una referencia nueva)</label>
                  <input type="time" required value={horaReferencia} onChange={e => setHoraReferencia(e.target.value)} style={{ ...inputFiltro, color: '#fff' }} />
                </div>
              </div>

              <div className="rpd-x83">
                <button className="rpd-x84" type="button" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
                <button className="rpd-x85" type="submit" disabled={guardando}>{guardando ? 'Enviando…' : 'Enviar al Historial'}</button>
              </div>
            </form>
            </FormularioConfigurable>
          </div>
        </div>
      )}

      {/* MODAL FICHA / DETALLE */}
      {/* ✅ V00412: detalle de la operación al hacer clic en su fila (mismo formulario de Operaciones) */}
      {opDetalle && (
        <FormularioOperacion
          estado="abierto"
          initialData={opDetalle}
          catalogosCacheados={catalogosFormulario || {}}
          onClose={() => setOpDetalle(null)}
          onMinimize={() => {}}
          onRestore={() => {}}
          onSave={() => {}}
        />
      )}
      {/* mientras se ve la operación, el detalle de la referencia se oculta y vuelve al cerrar */}
      {referenciaViendo && !opDetalle && (
        <div className="modal-overlay rpd-x86">
          <div className="rpd-x87 rpd-modal--detalle">
            <div className="rpd-x88">
              <h2 className="rpd-x89">Detalle de Referencia</h2>
              <button className="rpd-x62" onClick={() => setReferenciaViendo(null)}>✕</button>
            </div>
            <div className="rpd-x90">
              <div className="rpd-x91">
                <div>
                  <span className="rpd-x92">Consecutivo</span>
                  <span className="rpd-x93">{referenciaViendo.consecutivo}</span>
                </div>
                {/* ✅ V00413: sin status; puente y fecha de la referencia */}
                <div className="rpd-x94">
                  <span className="rpd-x21">Puente</span>
                  <span className="rpd-detalle-puente">{referenciaViendo.puenteNombre || '—'}</span>
                </div>
                <div className="rpd-x94">
                  <span className="rpd-x21">Fecha</span>
                  <span className="rpd-detalle-puente">{formatearFechaSpanish(referenciaViendo.fechaGeneracion)}{referenciaViendo.horaGeneracion ? ` · ${referenciaViendo.horaGeneracion}` : ''}</span>
                </div>
                <div className="rpd-x75">
                  <span className="rpd-x92">Subtotal Puentes</span>
                  <span className="rpd-x95">{formatoMoneda(referenciaViendo.subtotalPuentes)}</span>
                </div>
              </div>

              {referenciaViendo.tipo === 'otroCruce' && (
                <div className="rpd-otro-detalle">
                  {/* ✅ V00396: el usuario solo se ve aquí, en el detalle */}
                  <div><span>Fecha</span><b>{formatearFechaSpanish(referenciaViendo.fechaCruce || referenciaViendo.fechaGeneracion)}</b></div>
                  <div><span>Hora</span><b>{referenciaViendo.horaCruce || referenciaViendo.horaGeneracion || '—'}</b></div>
                  <div><span>Puente</span><b>{referenciaViendo.puenteNombre}</b></div>
                  <div><span>Monto</span><b>{formatoMoneda(Number(referenciaViendo.monto ?? referenciaViendo.subtotalPuentes) || 0)} {referenciaViendo.moneda || ''}</b></div>
                  <div><span>Unidad</span><b>{referenciaViendo.unidad || '—'}</b></div>
                  <div><span>Registrado por</span><b>{referenciaViendo.registradoPor || '—'}</b></div>
                </div>
              )}
              {referenciaViendo.tipo !== 'otroCruce' && !referenciaViendo.automatico && (
              <div className="rpd-x96">
                <div><span className="rpd-x97">Fecha de pago: </span>{formatearFechaSpanish(referenciaViendo.fechaPago)}</div>
                <div><span className="rpd-x97">Período: </span>{formatearFechaSpanish(referenciaViendo.fechaInicio)} al {formatearFechaSpanish(referenciaViendo.fechaFin)}</div>
                {referenciaViendo.observaciones && <div><span className="rpd-x97">Obs.: </span>{referenciaViendo.observaciones}</div>}
              </div>
              )}

              <div className="rpd-detalle-barra">
                <span className="rpd-x98">Operaciones incluidas ({referenciaViendo.operacionesGuardadas?.length || 0})</span>
                {referenciaViendo.automatico && (
                  <button type="button" className="rpd-btn-asignar" onClick={() => { setSelAgregar([]); setAgregarARef(v => !v); }}>{agregarARef ? 'Cerrar' : '+ Agregar operaciones'}</button>
                )}
              </div>
              {/* ✅ V00415: agregar operaciones SIN ASIGNAR del mismo puente */}
              {referenciaViendo.automatico && agregarARef && (() => {
                const cands = candidatasParaRef(referenciaViendo);
                return (
                  <div className="rpd-agregar">
                    <div className="rpd-agregar__enc">
                      <span>Operaciones sin asignar de {referenciaViendo.puenteNombre}{agregarTodasFechas ? '' : ` del ${formatearFechaSpanish(referenciaViendo.fechaGeneracion)}`} ({cands.length})</span>
                      <label className="rpd-agregar__chk"><input type="checkbox" checked={agregarTodasFechas} onChange={(e) => setAgregarTodasFechas(e.target.checked)} /> Todas las fechas</label>
                    </div>
                    {cands.length === 0 ? <div className="rpd-moneda">No hay operaciones sin asignar de este puente{agregarTodasFechas ? '' : ' en esa fecha'}.</div> : (
                      <div className="rpd-grupo__tabla">
                        <table>
                          <thead><tr><th><input type="checkbox" checked={selAgregar.length === cands.length} onChange={(e) => setSelAgregar(e.target.checked ? cands.map(c => String(c.id)) : [])} /></th><th>Ref. Operación</th><th>Fecha servicio</th><th>Hora (verde)</th><th>Unidad</th><th>Convenio</th><th>Puente</th><th className="rpd-num">Monto</th></tr></thead>
                          <tbody>
                            {cands.map(o => (
                              <tr key={String(o.id)}>
                                <td><input type="checkbox" checked={selAgregar.includes(String(o.id))} onChange={() => setSelAgregar(prev => prev.includes(String(o.id)) ? prev.filter(x => x !== String(o.id)) : [...prev, String(o.id)])} /></td>
                                <td className="rpd-x52">{String(o.ref || o.id)}</td>
                                <td>{formatearFechaSpanish(String(o.fechaServicio || ''))}</td>
                                <td>{textoHoraVerde(o) || '—'}</td>
                                <td>{getUnidad(o)}</td>
                                <td className="rpd-grupo__conv" title={getConvenio(o)}>{getConvenio(o)}</td>
                                <td>{nombresPuenteOp(o).join(' + ') || '—'}</td>
                                <td className="rpd-num">{getPuente(o) ? formatoMoneda(getPuente(o)) : 'Se calcula'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="rpd-agregar__pie">
                      <button type="button" className="rpd-x85" disabled={agregandoOps || selAgregar.length === 0} onClick={agregarOpsARef}>{agregandoOps ? 'Agregando…' : `Agregar ${selAgregar.length || ''} a ${referenciaViendo.consecutivo}`}</button>
                    </div>
                  </div>
                );
              })()}
              <div className="table-container rpd-x99">
                <table className="rpd-x100">
                  <thead className="rpd-x101">
                    <tr>
                      {referenciaViendo.automatico && <th className="rpd-x102"></th>}
                      <th className="rpd-x102">#</th>
                      <th className="rpd-x102">REFERENCIA</th>
                      <th className="rpd-x102">FECHA</th>
                      <th className="rpd-x102">HORA (VERDE)</th>
                      <th className="rpd-x102">UNIDAD</th>
                      <th className="rpd-x102">CONVENIO</th>
                      <th className="rpd-x102">PUENTE</th>
                      <th className="rpd-x102">MONTO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(referenciaViendo.operacionesGuardadas || []).map((op: any, i: number) => {
                      const noCorresponde = !!referenciaViendo.grupoPuente && !!String(op.puenteNombre || '').trim() && grupoDeFila(op) !== referenciaViendo.grupoPuente; // ✅ V00413: por la caseta
                      return (
                      <tr className={`rpd-x46 rpd-fila-clic${noCorresponde ? ' rpd-fila--mal' : ''}`} key={op.id} title={op.esOtroCruce ? 'Otro cruce (sin operación)' : 'Ver el detalle de la operación'} onClick={() => { if (!op.esOtroCruce) abrirDetalleOperacion(String(op.id)); }}>
                        {referenciaViendo.automatico && (
                          <td className="rpd-x104">
                            <button type="button" className="rpd-btn-sacar" disabled={quitandoOp === String(op.id)} title="Sacar de esta referencia (regresa a Operaciones sin asignar)"
                              onClick={(e) => { e.stopPropagation(); sacarDeReferencia(referenciaViendo, op); }}>{quitandoOp === String(op.id) ? '…' : 'Sacar'}</button>
                          </td>
                        )}
                        <td className="rpd-x104 rpd-num-fila">{i + 1}</td>{/* ✅ V00410 */}
                        <td className="rpd-x103">{op.ref}{noCorresponde && <span className="rpd-chip-mal" title="Esta operación es de otro puente: sácala y vuelve a enviarla para que vaya a su referencia">Otro puente</span>}</td>
                        <td className="rpd-x104">{formatearFechaSpanish(op.fecha)}</td>
                        <td className="rpd-x104">{op.horaVerde || '-'}</td>
                        <td className="rpd-x104">{op.unidad || '-'}</td>
                        <td className="rpd-x104">{op.convenio || op.cliente || '-'}</td>
                        <td className="rpd-x104">{op.puenteNombre || '-'}</td>
                        <td className="rpd-x105">{op.caseta ? <>
                          <div>{formatoMoneda(op.caseta)} <span className="rpd-moneda">{op.casetaMoneda}</span></div>
                          {op.piso > 0 && <div>{formatoMoneda(op.piso)} <span className="rpd-moneda">{op.pisoMoneda}</span></div>}
                        </> : formatoMoneda(op.puente)}</td>
                      </tr>
                      );
                    })}
                    {(!referenciaViendo.operacionesGuardadas || referenciaViendo.operacionesGuardadas.length === 0) && (
                      <tr><td className="rpd-x106" colSpan={referenciaViendo.automatico ? 9 : 8}>Sin detalle de operaciones.</td></tr>
                    )}
                  </tbody>
                  {/* ✅ V00410: totales — cantidad de operaciones y monto por moneda */}
                  {(referenciaViendo.operacionesGuardadas || []).length > 0 && (() => {
                    const ops = (referenciaViendo.operacionesGuardadas || []) as Record<string, unknown>[];
                    const porMoneda: Record<string, number> = {};
                    ops.forEach(o => {
                      if (Number(o.caseta) > 0) porMoneda[String(o.casetaMoneda || '')] = (porMoneda[String(o.casetaMoneda || '')] || 0) + Number(o.caseta);
                      else if (Number(o.puente) > 0) porMoneda[''] = (porMoneda[''] || 0) + Number(o.puente);
                      if (Number(o.piso) > 0) porMoneda[String(o.pisoMoneda || '')] = (porMoneda[String(o.pisoMoneda || '')] || 0) + Number(o.piso);
                    });
                    const conVerde = ops.filter(o => String(o.horaVerde || '').trim() && String(o.horaVerde) !== '-').length;
                    return (
                      <tfoot>
                        <tr className="rpd-total-fila">
                          <td colSpan={referenciaViendo.automatico ? 8 : 7}><b>{ops.length}</b> {ops.length === 1 ? 'operación' : 'operaciones'} · {conVerde} con verde · {ops.length - conVerde} sin verde</td>
                          <td className="rpd-x105">{Object.entries(porMoneda).map(([m, t]) => <div key={m}>{formatoMoneda(t)} <span className="rpd-moneda">{m}</span></div>)}</td>
                        </tr>
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            </div>
            <div className="rpd-x107">
              <button className="rpd-x108" onClick={() => setReferenciaViendo(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* NUEVO: panel lateral DERECHO de filtros (Referencias de Puentes) */}
      {drawerFiltrosAbierto && (
        <div className="rpd-x109" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="rpd-x110" onClick={(e) => e.stopPropagation()}>
            <div className="rpd-x111">
              <h3 className="rpd-x112">Filtros · {activeTab === 'operaciones' ? 'Operaciones' : 'Historial'}</h3>
              <button className="rpd-x62" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            {activeTab === 'operaciones' ? (
              <>
                <div className="rpd-x113">
                  <div className="rpd-x114">
                    <label className="rpd-x115">FECHA INICIO <span className="rpd-x116">*</span></label>
                    <input type="date" value={fechaInicio} onChange={e => { setFechaInicio(e.target.value); setSeleccionadas([]); }} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: `1px solid ${fechaInicio ? '#58a6ff' : '#30363d'}`, borderRadius: '6px', colorScheme: 'dark', boxSizing: 'border-box' }} />
                  </div>
                  <div className="rpd-x114">
                    <label className="rpd-x115">FECHA FIN <span className="rpd-x116">*</span></label>
                    <input type="date" value={fechaFin} min={fechaInicio || undefined} onChange={e => { setFechaFin(e.target.value); setSeleccionadas([]); }} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: `1px solid ${fechaFin ? '#58a6ff' : '#30363d'}`, borderRadius: '6px', colorScheme: 'dark', boxSizing: 'border-box' }} />
                  </div>
                </div>

                {/* ✅ V00392: filtros Puente y Unidad */}
                <div className="rpd-x117">
                  <label className="rpd-x118">PUENTE</label>
                  <select className="rpd-x119" value={filtroPuente} onChange={e => { setFiltroPuente(e.target.value); setSeleccionadas([]); }}>
                    <option value="todos">Todos</option>
                    <option value="__sin__">Sin monto de puente</option>
                    {puentesCatalogo.map(p => <option key={p.id} value={String(nombrePuente(p))}>{String(nombrePuente(p))}</option>)}
                  </select>
                </div>
                <div className="rpd-x117">
                  <label className="rpd-x118">UNIDAD</label>
                  <select className="rpd-x119" value={filtroUnidad} onChange={e => { setFiltroUnidad(e.target.value); setSeleccionadas([]); }}>
                    <option value="todas">Todas</option>
                    {unidadesDisponibles.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>

                {/* ✅ V00399: Asignar muestra solo operaciones SIN referencia (las del Historial se quitan; al borrar la referencia regresan) */}
                <div className="rpd-x117">
                  <label className="rpd-x118">ORDENAR POR</label>
                  <div className="rpd-x121">
                    <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={{ ...selectOrdenStyle, flex: 1 }}>
                      <option value="fechaServicio">Fecha Servicio</option>
                      <option value="ref">Referencia</option>
                      <option value="horaVerde">Hora (Verde)</option>
                      <option value="unidad">Unidad</option>
                      <option value="convenio">Convenio</option>
                      <option value="trafico">Tráfico</option>
                      <option value="operador">Operador</option>
                      <option value="cliente">Cliente</option>
                      <option value="puente">Puente</option>
                    </select>
                    <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                      {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                    </button>
                  </div>
                </div>

                <div className="rpd-x122">
                  Se requiere <b className="rpd-x37">al menos una fecha</b> de servicio; puente, unidad y estado son opcionales. Solo aparecen operaciones de Importación y Exportación de Transfer y de Logística con proveedor Roelca.
                </div>
              </>
            ) : (
              <>
                <div className="rpd-x117">
                  <label className="rpd-x115">BÚSQUEDA</label>
                  <div className="rpd-x123">
                    <svg className="rpd-x124" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input className="rpd-x125" type="text" placeholder="Consecutivo, tráfico..." value={busquedaHistorial} onChange={e => setBusquedaHistorial(e.target.value)} />
                    {busquedaHistorial && (
                      <button className="rpd-x126" onClick={() => setBusquedaHistorial('')} title="Limpiar">✕</button>
                    )}
                  </div>
                </div>

                <div className="rpd-x117">
                  <label className="rpd-x118">ESTADO</label>
                  <div className="rpd-x120">
                    <button onClick={() => setFiltroEstadoHist('pendientes')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroEstadoHist === 'pendientes' ? 'rgba(245,158,11,0.15)' : 'transparent', color: filtroEstadoHist === 'pendientes' ? '#f59e0b' : '#8b949e' }}>● Pendientes ({conteoHist.pendientes})</button>
                    <button onClick={() => setFiltroEstadoHist('pagadas')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroEstadoHist === 'pagadas' ? 'rgba(16,185,129,0.15)' : 'transparent', color: filtroEstadoHist === 'pagadas' ? '#10b981' : '#8b949e' }}>● Pagadas ({conteoHist.pagadas})</button>
                  </div>
                </div>

                <div className="rpd-x122">
                  La búsqueda es <b className="rpd-x97">opcional</b>. Presiona <b className="rpd-x38">Buscar</b> para ver el historial.
                </div>
              </>
            )}

            <div className="rpd-x127">
              <button className="rpd-x128" onClick={() => {
                if (activeTab === 'operaciones') { setFechaInicio(''); setFechaFin(''); setFiltroPuente('todos'); setFiltroUnidad('todas'); setSeleccionadas([]); setBusquedaOpsHecha(false); }
                else { setBusquedaHistorial(''); setBusquedaHistHecha(false); }
              }}>Limpiar</button>
              <button className="rpd-x129" onClick={() => {
                if (activeTab === 'operaciones') {
                  if (!fechaInicio && !fechaFin) { alert('Selecciona al menos una Fecha de Servicio (inicio o fin) para buscar.'); return; }
                  setBusquedaOpsHecha(true);
                } else {
                  setBusquedaHistHecha(true);
                }
                setDrawerFiltrosAbierto(false);
              }}>Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
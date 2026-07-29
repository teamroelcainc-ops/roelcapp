// src/features/puentes/components/ReferenciasPuentesDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  query,
  writeBatch,
  doc,
  limit,
  orderBy
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import './ReferenciasPuentesDashboard.css';

// ⚠ Si tu colección de convenios de clientes tiene otro nombre, cámbialo aquí.
const COLECCION_CONVENIOS = 'convenios_clientes';

const COLUMNAS_OPS_PUENTES_BASE = [
  { id: 'ref',           label: 'Ref. Operación', visible: true,  orden: true },
  { id: 'fechaServicio', label: 'Fecha Servicio', visible: true,  orden: true },
  { id: 'trafico',       label: 'Tráfico',        visible: true,  orden: true },
  { id: 'operador',      label: 'Operador',       visible: true,  orden: true },
  { id: 'cliente',       label: 'Cliente',        visible: true,  orden: true },
  { id: 'origen',        label: 'Origen',         visible: false, orden: true },
  { id: 'destino',       label: 'Destino',        visible: false, orden: true },
  { id: 'puente',        label: 'Puente',         visible: true,  orden: true },
];

export const ReferenciasPuentesDashboard = () => {
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial'>('historial');

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
  const [puenteSeleccionadoId, setPuenteSeleccionadoId] = useState('');

  // Filtros pestaña 1
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [filtroTrafico, setFiltroTrafico] = useState<string>('todos');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const [filtroEstadoOps, setFiltroEstadoOps] = useState<'pendientes' | 'asignadas'>('pendientes');
  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_PUENTES_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);

  // Historial
  const [busquedaHistorial, setBusquedaHistorial] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tablas VACÍAS hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaOpsHecha, setBusquedaOpsHecha] = useState(false);
  const [busquedaHistHecha, setBusquedaHistHecha] = useState(false);
  const [filtroEstadoHist, setFiltroEstadoHist] = useState<'pendientes' | 'pagadas'>('pendientes');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  // Modal generar referencia
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [consecutivoForm, setConsecutivoForm] = useState('');
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split('T')[0]);
  const [statusPagado, setStatusPagado] = useState<'Pendiente' | 'Pagada'>('Pendiente');
  const [observacionesForm, setObservacionesForm] = useState('');

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
    const qRefs = query(collection(db, 'referencias_puentes'), orderBy('createdAt', 'desc'), limit(400));
    const unSubRefs = onSnapshot(qRefs, (snap) => {
      setReferenciasGlobales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unSubRefs();
  }, []);

  useEffect(() => {
    if (activeTab !== 'operaciones') return;
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
    const qOps = query(collection(db, 'operaciones'), limit(500));
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
  const getPuente = (op: any) => Number(
    op.puenteTotal ?? op.casetasTotal ?? op.casetaTotal ?? op.costoPuente ??
    op.puente ?? op.peajeTotal ?? op.cruceTotal ?? op.casetas ?? 0
  );

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
    const isLogistica = tipo.includes('logistica') || tipo.includes('logística');
    const esRoelca = String(op?.proveedorUnidadNombre || op?.proveedorUnidad || '').toLowerCase().includes('roelca');
    return isTransfer || (isLogistica && esRoelca);
  };

  const operacionesBaseFiltro = useMemo(() => {
    if (!filtrosCompletos) return [];
    return operacionesGlobales.filter(op => {
      if (!esPuenteRoelca(op)) return false;
      const tr = getTrafico(op);
      const matchTrafico = filtroTrafico === 'todos' || sinAcentos(tr) === sinAcentos(filtroTrafico);
      return matchTrafico && dentroRangoFecha(op);
    });
  }, [operacionesGlobales, filtroTrafico, fechaInicio, fechaFin, filtrosCompletos, convenioPorId, traficoPorId, detallePorId, tarifaRefPorId, tipoTarifarioPorId]);

  const esAsignada = (op: any) => !!op.referenciaPuentesId;

  const conteoOps = useMemo(() => ({
    pendientes: operacionesBaseFiltro.filter(op => !esAsignada(op)).length,
    asignadas: operacionesBaseFiltro.filter(esAsignada).length,
  }), [operacionesBaseFiltro]);

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
  }, [operacionesBaseFiltro, filtroEstadoOps, ordenOps, operadoresList, convenioPorId, traficoPorId, empresaPorId, detallePorId, tarifaRefPorId, tipoTarifarioPorId]);

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
      case 'puente': return <td className="rpd-x3" key={key}>{formatoMoneda(getPuente(op))}</td>;
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
    const hoy = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Operaciones_Puentes_${etiqueta}_${hoy}.xlsx`);
  };

  const toggleSeleccion = (id: string) =>
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);

  const resumenSeleccion = useMemo(() => {
    let subtotal = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) { subtotal += getPuente(op); refs.push(op.ref || op.id?.substring(0, 6)); }
    });
    return { subtotal, refs };
  }, [seleccionadas, operacionesGlobales]);

  // Puentes del catálogo de tipos de gasto (categoria_gasto = "Puente")
  const nombrePuente = (c: any) => c?.nombre ?? c?.concepto ?? c?.tipo_gasto ?? c?.tipoGasto ?? c?.descripcion ?? c?.nombre_gasto ?? c?.id ?? '-';

  const puentesCatalogo = useMemo(() =>
    tiposGastoList
      .filter(c => String(c.categoria_gasto ?? c.categoriaGasto ?? c.categoria ?? '').toLowerCase().includes('puente'))
      .sort((a, b) => String(nombrePuente(a)).localeCompare(String(nombrePuente(b)), 'es', { sensitivity: 'base' })),
  [tiposGastoList]);

  const puenteSeleccionado = useMemo(
    () => puentesCatalogo.find(p => p.id === puenteSeleccionadoId) || null,
    [puentesCatalogo, puenteSeleccionadoId]
  );
  const costoPuenteUnitario = Number(puenteSeleccionado?.importe ?? 0);
  const subtotalPuentesCalc = costoPuenteUnitario * seleccionadas.length;

  const generarConsecutivo = (fechaStr: string) => {
    const [year, month, day] = fechaStr.split('-');
    const prefix = `PUENTES-${day}${month}${year}-`;
    const delDia = referenciasGlobales.filter(r => r.consecutivo?.startsWith(prefix));
    let maxSeq = 0;
    delDia.forEach(r => {
      const parts = r.consecutivo.split('-');
      if (parts.length === 3) { const seq = parseInt(parts[2], 10); if (seq > maxSeq) maxSeq = seq; }
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  const abrirModalGenerar = () => {
    setConsecutivoForm(generarConsecutivo(fechaPago));
    setStatusPagado('Pendiente');
    setObservacionesForm('');
    setPuenteSeleccionadoId('');
    setModalAbierto(true);
  };

  const traficoPredominante = useMemo(() => {
    const conteo: Record<string, number> = {};
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (!op) return;
      const tr = getTrafico(op);
      if (tr && tr !== '—') conteo[tr] = (conteo[tr] || 0) + 1;
    });
    const entradas = Object.entries(conteo).sort((a, b) => b[1] - a[1]);
    if (entradas.length === 0) return '—';
    if (entradas.length > 1 && entradas[0][1] === entradas[1][1]) return 'Mixto';
    return entradas[0][0];
  }, [seleccionadas, operacionesGlobales, convenioPorId, traficoPorId, detallePorId, tarifaRefPorId, tipoTarifarioPorId]);

  const handleGuardarReferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (seleccionadas.length === 0) return alert('Selecciona al menos una operación.');
    if (!puenteSeleccionadoId) return alert('Selecciona el Puente.');
    setGuardando(true);
    try {
      const batch = writeBatch(db);
      const nuevoId = doc(collection(db, 'referencias_puentes')).id;
      const consecutivoFinal = generarConsecutivo(fechaPago);

      const operacionesGuardadas = seleccionadas.map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        return {
          id,
          ref: op?.ref || id.substring(0, 6),
          fecha: op?.fechaServicio || op?.fecha || '',
          trafico: op ? getTrafico(op) : '—',
          operador: op ? getNombreOperador(op.operadorNombre || op.operadorId || op.operador) : '-',
          cliente: op ? getCliente(op) : '-',
          origen: op?.origen || '-',
          destino: op?.destino || '-',
          puente: costoPuenteUnitario,
        };
      });

      const data = {
        consecutivo: consecutivoFinal,
        fechaPago, fechaInicio, fechaFin,
        filtroTrafico,
        traficoPredominante,
        operacionesIds: seleccionadas,
        operacionesGuardadas,
        puenteId: puenteSeleccionadoId,
        puenteNombre: nombrePuente(puenteSeleccionado),
        puenteImporte: costoPuenteUnitario,
        subtotalPuentes: subtotalPuentesCalc,
        statusPagado: statusPagado === 'Pagada',
        observaciones: observacionesForm,
        createdAt: new Date().toISOString(),
      };

      batch.set(doc(db, 'referencias_puentes', nuevoId), data);
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { referenciaPuentesId: nuevoId, referenciaPuentesConsecutivo: consecutivoFinal });
      });

      await batch.commit();
      const idsAsignadas = [...seleccionadas];
      setOperacionesGlobales(prev => prev.map(op =>
        idsAsignadas.includes(op.id) ? { ...op, referenciaPuentesId: nuevoId, referenciaPuentesConsecutivo: consecutivoFinal } : op
      ));
      setModalAbierto(false);
      setSeleccionadas([]);
      setActiveTab('historial');
    } catch (error) {
      console.error(error);
      alert('Error al guardar la referencia de puentes.');
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
      String(r.traficoPredominante || '').toLowerCase().includes(t)
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
    XLSX.writeFile(wb, `Historial_Puentes_${new Date().toISOString().split('T')[0]}.xlsx`);
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
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Referencias</button>
      </div>

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          <div className="rpd-x7">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(fechaInicio || fechaFin || filtroTrafico !== 'todos') ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(fechaInicio || fechaFin || filtroTrafico !== 'todos') && <span className="rpd-x8">{[fechaInicio || fechaFin, filtroTrafico !== 'todos' ? filtroTrafico : ''].filter(Boolean).length}</span>}
            </button>
            {(fechaInicio || fechaFin) && (
              <span className="rpd-x9">
                {(fechaInicio || '…')} → {(fechaFin || '…')}
                <button className="rpd-x10" onClick={() => { setFechaInicio(''); setFechaFin(''); setSeleccionadas([]); setBusquedaOpsHecha(false); }}>✕</button>
              </span>
            )}
            {filtroTrafico !== 'todos' && (
              <span className="rpd-x11">
                {capitalizar(filtroTrafico)}
                <button className="rpd-x12" onClick={() => { setFiltroTrafico('todos'); setSeleccionadas([]); }}>✕</button>
              </span>
            )}
            {!(fechaInicio || fechaFin) && <span className="rpd-x13">Presiona Filtros, define la fecha de servicio y pulsa Buscar.</span>}
            <div className="rpd-x14">
              <button
                disabled={seleccionadas.length === 0 || filtroEstadoOps === 'asignadas'}
                onClick={abrirModalGenerar}
                style={{ padding: '10px 20px', backgroundColor: (seleccionadas.length > 0 && filtroEstadoOps !== 'asignadas') ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && filtroEstadoOps !== 'asignadas') ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Generar Referencia ({seleccionadas.length})
              </button>
            </div>
          </div>

          {busquedaOpsHecha ? (
          <>
          <div className="rpd-x15">
            <span className="rpd-x16">
              {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'operación' : 'operaciones'}{(fechaInicio || fechaFin) ? ` · ${fechaInicio ? formatearFechaSpanish(fechaInicio) : '...'} al ${fechaFin ? formatearFechaSpanish(fechaFin) : '...'}` : ''}{filtroTrafico !== 'todos' ? ` · ${capitalizar(filtroTrafico)}` : ''}
            </span>
            <div className="rpd-x17">
              <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">⚙ Configurar Columnas</button>
              <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                  cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                  backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                  color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                ⬇ Exportar Excel ({filtroEstadoOps === 'asignadas' ? 'Asignadas' : 'Pendientes'})
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
                <div className="rpd-x20">
                  <span className="rpd-x21">Tráfico</span>
                  <span className="rpd-x23">{chipTrafico(traficoPredominante)}</span>
                </div>
                <div>
                  <span className="rpd-x24">Subtotal Puentes</span>
                  <span className="rpd-x25">{formatoMoneda(resumenSeleccion.subtotal)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="table-container rpd-x26">
            <table className="rpd-x27">
              <thead className="rpd-x28">
                <tr>
                  <th className="rpd-x29"></th>
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
                  <th className="rpd-x43">CONSECUTIVO</th>
                  <th className="rpd-x43">STATUS</th>
                  <th className="rpd-x43">TRÁFICO</th>
                  <th className="rpd-x43">FECHA PAGO</th>
                  <th className="rpd-x43">PERÍODO</th>
                  <th className="rpd-x43">OPS.</th>
                  <th className="rpd-x43">SUBTOTAL PUENTES</th>
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
                      <td className="rpd-x2">
                        <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold',
                          backgroundColor: r.statusPagado ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: r.statusPagado ? '#10b981' : '#f59e0b',
                          border: `1px solid ${r.statusPagado ? '#10b981' : '#f59e0b'}` }}>
                          {r.statusPagado ? 'PAGADA' : 'PENDIENTE'}
                        </span>
                      </td>
                      <td className="rpd-x2">{chipTrafico(r.traficoPredominante || '—')}</td>
                      <td className="rpd-x53">{formatearFechaSpanish(r.fechaPago)}</td>
                      <td className="rpd-x54">{formatearFechaSpanish(r.fechaInicio)} <br/>al {formatearFechaSpanish(r.fechaFin)}</td>
                      <td className="rpd-x55">{Array.isArray(r.operacionesIds) ? r.operacionesIds.length : 0}</td>
                      <td className="rpd-x3">{formatoMoneda(r.subtotalPuentes)}</td>
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
          <div className="rpd-x69">
            <div className="rpd-x70">
              <h2 className="rpd-x71">Generar Referencia: <span className="rpd-x38">{consecutivoForm}</span></h2>
              <button className="rpd-x62" onClick={() => setModalAbierto(false)}>✕</button>
            </div>

            <div className="rpd-x72">
              <div>
                <span className="rpd-x73">Operaciones ({seleccionadas.length})</span>
                <span className="rpd-x74">{chipTrafico(traficoPredominante)}</span>
              </div>
              <div className="rpd-x75">
                <span className="rpd-x73">Subtotal Puentes</span>
                <span className="rpd-x76">{formatoMoneda(subtotalPuentesCalc)}</span>
              </div>
            </div>

            <form onSubmit={handleGuardarReferencia}>
              <div className="rpd-x77">
                <div>
                  <label style={labelFiltro}>Consecutivo</label>
                  <input readOnly value={consecutivoForm} style={{ ...inputFiltro, color: '#D84315', fontFamily: 'monospace', fontWeight: 'bold' }} />
                </div>
                <div>
                  <label style={labelFiltro}>Fecha Pago</label>
                  <input type="date" value={fechaPago} onChange={e => { setFechaPago(e.target.value); setConsecutivoForm(generarConsecutivo(e.target.value)); }} style={{ ...inputFiltro, color: '#fff' }} />
                </div>
                <div>
                  <label style={labelFiltro}>Status</label>
                  <select value={statusPagado} onChange={e => setStatusPagado(e.target.value as any)} style={{ ...inputFiltro, color: statusPagado === 'Pagada' ? '#10b981' : '#f0f6fc', fontWeight: 'bold' }}>
                    <option value="Pendiente">Pendiente</option>
                    <option value="Pagada">Pagada ✔</option>
                  </select>
                </div>
              </div>
              <div className="rpd-x78">
                <div>
                  <label style={labelFiltro}>Puente ★</label>
                  <select value={puenteSeleccionadoId} onChange={e => setPuenteSeleccionadoId(e.target.value)} required style={{ ...inputFiltro, color: '#fff', cursor: 'pointer' }}>
                    <option value="">Seleccionar puente...</option>
                    {puentesCatalogo.map(p => (
                      <option key={p.id} value={p.id}>{nombrePuente(p)} — {formatoMoneda(p.importe)}</option>
                    ))}
                  </select>
                  {puentesCatalogo.length === 0 && (
                    <span className="rpd-x79">No hay puentes en el catálogo (catalogo_tipos_gastos con categoria_gasto = Puente).</span>
                  )}
                </div>
                <div>
                  <label style={labelFiltro}>Costo del Puente (Importe)</label>
                  <div className="rpd-x80">
                    {formatoMoneda(costoPuenteUnitario)}
                  </div>
                  <span className="rpd-x81">x {seleccionadas.length} {seleccionadas.length === 1 ? 'operación' : 'operaciones'} = {formatoMoneda(subtotalPuentesCalc)}</span>
                </div>
              </div>

              <div className="rpd-x82">
                <label style={labelFiltro}>Observaciones</label>
                <textarea value={observacionesForm} onChange={e => setObservacionesForm(e.target.value)} style={{ ...inputFiltro, color: '#fff', height: '60px' }} />
              </div>

              <div className="rpd-x83">
                <button className="rpd-x84" type="button" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
                <button className="rpd-x85" type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Confirmar Referencia'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FICHA / DETALLE */}
      {referenciaViendo && (
        <div className="modal-overlay rpd-x86">
          <div className="rpd-x87">
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
                <div className="rpd-x94">{chipTrafico(referenciaViendo.traficoPredominante || '—')}</div>
                <div className="rpd-x94">
                  <span className="rpd-x21">Status</span>
                  <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold',
                    backgroundColor: referenciaViendo.statusPagado ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    color: referenciaViendo.statusPagado ? '#10b981' : '#f59e0b',
                    border: `1px solid ${referenciaViendo.statusPagado ? '#10b981' : '#f59e0b'}` }}>
                    {referenciaViendo.statusPagado ? 'PAGADA' : 'PENDIENTE'}
                  </span>
                </div>
                <div className="rpd-x75">
                  <span className="rpd-x92">Subtotal Puentes</span>
                  <span className="rpd-x95">{formatoMoneda(referenciaViendo.subtotalPuentes)}</span>
                </div>
              </div>

              <div className="rpd-x96">
                <div><span className="rpd-x97">Fecha de pago: </span>{formatearFechaSpanish(referenciaViendo.fechaPago)}</div>
                <div><span className="rpd-x97">Período: </span>{formatearFechaSpanish(referenciaViendo.fechaInicio)} al {formatearFechaSpanish(referenciaViendo.fechaFin)}</div>
                {referenciaViendo.observaciones && <div><span className="rpd-x97">Obs.: </span>{referenciaViendo.observaciones}</div>}
              </div>

              <span className="rpd-x98">
                Operaciones incluidas ({referenciaViendo.operacionesGuardadas?.length || 0})
              </span>
              <div className="table-container rpd-x99">
                <table className="rpd-x100">
                  <thead className="rpd-x101">
                    <tr>
                      <th className="rpd-x102">REFERENCIA</th>
                      <th className="rpd-x102">FECHA</th>
                      <th className="rpd-x102">TRÁFICO</th>
                      <th className="rpd-x102">OPERADOR</th>
                      <th className="rpd-x102">CLIENTE</th>
                      <th className="rpd-x102">PUENTE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(referenciaViendo.operacionesGuardadas || []).map((op: any) => (
                      <tr className="rpd-x46" key={op.id}>
                        <td className="rpd-x103">{op.ref}</td>
                        <td className="rpd-x104">{formatearFechaSpanish(op.fecha)}</td>
                        <td className="rpd-x102">{chipTrafico(op.trafico || '—')}</td>
                        <td className="rpd-x104">{op.operador || '-'}</td>
                        <td className="rpd-x104">{op.cliente || '-'}</td>
                        <td className="rpd-x105">{formatoMoneda(op.puente)}</td>
                      </tr>
                    ))}
                    {(!referenciaViendo.operacionesGuardadas || referenciaViendo.operacionesGuardadas.length === 0) && (
                      <tr><td className="rpd-x106" colSpan={6}>Sin detalle de operaciones.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rpd-x107">
              <button className="rpd-x108" onClick={() => setReferenciaViendo(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO: panel lateral DERECHO de filtros (Referencias de Puentes) */}
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

                <div className="rpd-x117">
                  <label className="rpd-x118">TRÁFICO</label>
                  <select className="rpd-x119" value={filtroTrafico} onChange={e => { setFiltroTrafico(e.target.value); setSeleccionadas([]); }}>
                    <option value="todos">Todos</option>
                    <option value="importacion">Importación</option>
                    <option value="exportacion">Exportación</option>
                    <option value="movimiento">Movimiento</option>
                  </select>
                </div>

                <div className="rpd-x117">
                  <label className="rpd-x118">ESTADO</label>
                  <div className="rpd-x120">
                    <button onClick={() => setFiltroEstadoOps('pendientes')} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroEstadoOps === 'pendientes' ? 'rgba(239,68,68,0.15)' : 'transparent', color: filtroEstadoOps === 'pendientes' ? '#ef4444' : '#8b949e' }}>● Pendientes ({conteoOps.pendientes})</button>
                    <button onClick={() => { setFiltroEstadoOps('asignadas'); setSeleccionadas([]); }} style={{ flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: filtroEstadoOps === 'asignadas' ? 'rgba(16,185,129,0.15)' : 'transparent', color: filtroEstadoOps === 'asignadas' ? '#10b981' : '#8b949e' }}>● Asignadas ({conteoOps.asignadas})</button>
                  </div>
                </div>

                <div className="rpd-x117">
                  <label className="rpd-x118">ORDENAR POR</label>
                  <div className="rpd-x121">
                    <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={{ ...selectOrdenStyle, flex: 1 }}>
                      <option value="fechaServicio">Fecha Servicio</option>
                      <option value="ref">Referencia</option>
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
                  Se requiere <b className="rpd-x37">al menos una fecha</b> de servicio; el tráfico y el estado son opcionales.
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
                if (activeTab === 'operaciones') { setFechaInicio(''); setFechaFin(''); setFiltroTrafico('todos'); setSeleccionadas([]); setBusquedaOpsHecha(false); }
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
              }}>🔍 Buscar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
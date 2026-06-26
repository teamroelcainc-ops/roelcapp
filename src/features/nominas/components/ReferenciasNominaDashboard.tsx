// src/features/nominas/components/ReferenciasNominaDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  writeBatch, 
  updateDoc,
  doc, 
  getDocs,
  where,
  documentId,
  limit
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';
import { useEmpresaConfig } from '../../configuracion/useEmpresaConfig';
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';

const ID_CARGO_OPERADOR = 'edda3a2b';

const COLUMNAS_OPS_NOMINA_BASE = [
  { id: 'ref',           label: 'Ref. Operación', visible: true, orden: true },
  { id: 'fechaServicio', label: 'Fecha Servicio',  visible: true, orden: true },
  { id: 'operador',      label: 'Operador',        visible: true, orden: true },
  { id: 'origen',        label: 'Origen',          visible: true, orden: true },
  { id: 'destino',       label: 'Destino',         visible: true, orden: true },
  { id: 'sueldo',        label: 'Sueldo Op.',      visible: true, orden: true },
  { id: 'sueldoExtra',   label: 'Sueldo Extra',    visible: true, orden: true },
];

export const ReferenciasNominaDashboard = () => {
  const { config: empresaConfig } = useEmpresaConfig();

  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial' | 'prestamos' | 'ahorro'>('historial');

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [nominasGlobales, setNominasGlobales] = useState<any[]>([]);

  const [operadoresList, setOperadoresList] = useState<any[]>([]);
  const [formasPagoList, setFormasPagoList] = useState<any[]>([]);
  const [bancosList, setBancosList] = useState<any[]>([]);
  const [deduccionesList, setDeduccionesList] = useState<any[]>([]);
  const [empresasList, setEmpresasList] = useState<any[]>([]);
  const [conveniosList, setConveniosList] = useState<any[]>([]);

  const [filtroOperador, setFiltroOperador] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [textoBuscarOperador, setTextoBuscarOperador] = useState('');
  const [mostrarSugerenciasOperador, setMostrarSugerenciasOperador] = useState(false);

  const [filtroEstadoOps, setFiltroEstadoOps] = useState<'pendientes' | 'asignadas'>('pendientes');
  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_NOMINA_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);

  const [busquedaHistorial, setBusquedaHistorial] = useState('');
  const [filtroEstadoHist, setFiltroEstadoHist] = useState<'pendientes' | 'pagadas'>('pendientes');
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [nominaViendo, setNominaViendo] = useState<any | null>(null);
  const [opsFicha, setOpsFicha] = useState<any[]>([]);
  const [cargandoOpsFicha, setCargandoOpsFicha] = useState(false);
  const [pestanaModalNomina, setPestanaModalNomina] = useState<'general' | 'referencia' | 'deducciones' | 'totales'>('general');

  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split('T')[0]);
  const [formaPagoSeleccionada, setFormaPagoSeleccionada] = useState('');
  const [bancoSeleccionado, setBancoSeleccionado] = useState('');
  const [statusPagado, setStatusPagado] = useState<'Pendiente' | 'Pagada'>('Pendiente');
  const [consecutivoForm, setConsecutivoForm] = useState('');
  const [notaDepositos, setNotaDepositos] = useState('');

  const [extras, setExtras] = useState<number | ''>('');
  const [infonavit, setInfonavit] = useState<number | ''>('');
  const [fonacot, setFonacot] = useState<number | ''>('');
  const [imss, setImss] = useState<number | ''>('');
  const [isr, setIsr] = useState<number | ''>('');
  const [prestamoNuevo, setPrestamoNuevo] = useState<number | ''>('');
  const [pagoPrestamo, setPagoPrestamo] = useState<number | ''>('');
  const [depositoGastos, setDepositoGastos] = useState<number | ''>('');
  const [otrosDepositos, setOtrosDepositos] = useState<number | ''>('');
  // ✅ NUEVO: el ahorro ahora funciona igual que el préstamo (monto de esta nómina + pago/retiro).
  const [ahorroNuevo, setAhorroNuevo] = useState<number | ''>('');
  const [pagoAhorro, setPagoAhorro] = useState<number | ''>('');

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const aNum = (v: any) => Number(v) || 0;

  const calcularTotalAPagar = (n: any): number => {
    if (!n) return 0;
    const stored = aNum(n.totalAPagar);
    if (stored > 0) return stored;
    const subRef = aNum(n.subtotalPagar) > 0 ? aNum(n.subtotalPagar) : Math.max(aNum(n.subtotalAPagar) - aNum(n.extras), 0);
    const subAPagar = aNum(n.subtotalAPagar) > 0 ? aNum(n.subtotalAPagar) : (subRef + aNum(n.extras));
    const totalDed = aNum(n.totalDeducciones) > 0 ? aNum(n.totalDeducciones) : (aNum(n.imss) + aNum(n.isrMonto) + aNum(n.infonavit) + aNum(n.fonacot));
    const neto = aNum(n.total) > 0 ? aNum(n.total) : (subAPagar - totalDed);
    return neto + aNum(n.depositoGastos) + aNum(n.otrosDepositos);
  };

  const ordenarOpsRecientes = (arr: any[]) =>
    [...arr].sort((a, b) => {
      const fa = String(a.fecha || '');
      const fb = String(b.fecha || '');
      if (fb !== fa) return fb.localeCompare(fa);
      return String(b.ref || '').localeCompare(String(a.ref || ''));
    });

  const parsearIdsNomina = (val: any): string[] => {
    if (Array.isArray(val)) return val.map((x: any) => String(x).trim()).filter(Boolean);
    if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  const mapearOpDetalle = (op: any) => {
    const sueldoTotal = (op.sueldoTotal != null && op.sueldoTotal !== '')
      ? aNum(op.sueldoTotal)
      : aNum(op.sueldoOperador);
    return {
      id: op.id,
      ref: op.ref || op.id?.substring(0, 6),
      fecha: op.fechaServicio || op.fecha || '',
      clientePagaId: op.clientePaga || op.cliente || '',
      cliente: getNombreEmpresa(op.clientePaga) || op.clienteNombre || op.clientePagaNombre || op.nombreCliente || '',
      convenio: getNombreConvenio(op.convenioId || op.convenio) || op.convenioNombre || (typeof op.convenio === 'string' ? op.convenio : '') || '-',
      tipoServicio: op.tarifaLabel || op.tarifarioLabel || op.convenioNombre || op.tipoOperacionNombre || op.tipoServicio || '-',
      sueldo: sueldoTotal,
      sueldoExtra: Number(op.sueldoExtra || 0),
      importe: sueldoTotal,
    };
  };

  const cargarOperacionesDeNomina = async (nom: any): Promise<any[]> => {
    if (!nom) return [];
    if (Array.isArray(nom.operacionesGuardadas) && nom.operacionesGuardadas.length > 0) {
      return ordenarOpsRecientes(nom.operacionesGuardadas);
    }
    const vistos = new Set<string>();
    const encontradas: any[] = [];
    const agregar = (snap: any) => snap.docs.forEach((d: any) => {
      if (!vistos.has(d.id)) { vistos.add(d.id); encontradas.push({ id: d.id, ...d.data() }); }
    });

    if (nom.id) {
      agregar(await getDocs(query(collection(db, 'operaciones'), where('referenciaNominaId', '==', nom.id))));
    }
    if (nom.consecutivo) {
      agregar(await getDocs(query(collection(db, 'operaciones'), where('referenciaNominaConsecutivo', '==', nom.consecutivo))));
    }
    const idsNomina = parsearIdsNomina(nom.operacionesIds);
    for (let i = 0; i < idsNomina.length; i += 10) {
      const bloque = idsNomina.slice(i, i + 10);
      if (bloque.length) agregar(await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', bloque))));
    }

    return ordenarOpsRecientes(encontradas.map(mapearOpDetalle));
  };

  const reconstruirTotales = (n: any, ops?: any[]) => {
    if (!n) return { subRef: 0, subAPagar: 0, totalDed: 0, neto: 0, totalAPagar: 0 };
    const subRef = (ops && ops.length > 0)
      ? ops.reduce((s: number, o: any) => s + aNum(o.importe ?? o.sueldo ?? o.sueldoTotal), 0)
      : (aNum(n.subtotalPagar) > 0 ? aNum(n.subtotalPagar) : Math.max(aNum(n.subtotalAPagar) - aNum(n.extras), 0));
    const subAPagar = aNum(n.subtotalAPagar) > 0 ? aNum(n.subtotalAPagar) : (subRef + aNum(n.extras));
    const totalDed = aNum(n.totalDeducciones) > 0 ? aNum(n.totalDeducciones) : (aNum(n.imss) + aNum(n.isrMonto) + aNum(n.infonavit) + aNum(n.fonacot));
    const neto = aNum(n.total) > 0 ? aNum(n.total) : (subAPagar - totalDed);
    const totalAPagar = aNum(n.totalAPagar) > 0 ? aNum(n.totalAPagar) : (neto + aNum(n.depositoGastos) + aNum(n.otrosDepositos));
    return { subRef, subAPagar, totalDed, neto, totalAPagar };
  };

  useEffect(() => {
    const qNominas = query(collection(db, 'referencias_nomina'), limit(400));
    const unSubNominas = onSnapshot(qNominas, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      docs.sort((a: any, b: any) => {
        const ka = String(a.createdAt || a.fechaPago || '');
        const kb = String(b.createdAt || b.fechaPago || '');
        return kb.localeCompare(ka);
      });
      setNominasGlobales(docs);
    });
    const unSubEmpleados = onSnapshot(collection(db, 'empleados'), (snap) => {
      setOperadoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    const unSubEmpresas = onSnapshot(collection(db, 'empresas'), (snap) => {
      setEmpresasList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    const unSubConvenios = onSnapshot(collection(db, 'catalogo_convenios'), (snap) => {
      setConveniosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }, (err) => console.warn('[Nómina] No se pudo leer catalogo_convenios:', err));
    return () => { unSubNominas(); unSubEmpleados(); unSubEmpresas(); unSubConvenios(); };
  }, []);

  useEffect(() => {
    if (activeTab !== 'operaciones' && activeTab !== 'prestamos' && activeTab !== 'ahorro') return;

    const subs: Array<() => void> = [];

    subs.push(onSnapshot(collection(db, 'deducciones'), (snap) => {
      setDeduccionesList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }));

    if (activeTab === 'operaciones') {
      subs.push(onSnapshot(collection(db, 'catalogo_formas_pago'), (snap) => {
        setFormasPagoList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }));
      subs.push(onSnapshot(collection(db, 'catalogo_bancos'), (snap) => {
        setBancosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      }));
      const qOps = query(collection(db, 'operaciones'), limit(500));
      subs.push(onSnapshot(qOps, (snap) => {
        const ops = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        ops.sort((a: any, b: any) => new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime());
        setOperacionesGlobales(ops);
      }));
    }

    return () => subs.forEach(u => u());
  }, [activeTab]);

  const generarConsecutivo = (fechaStr: string) => {
    const [year, month, day] = fechaStr.split('-');
    const prefix = `NOMINA-${day}${month}${year}-`;
    const nominasDeEseDia = nominasGlobales.filter(n => n.consecutivo?.startsWith(prefix));
    let maxSeq = 0;
    nominasDeEseDia.forEach(n => {
      const parts = n.consecutivo.split('-');
      if (parts.length === 3) {
        const seq = parseInt(parts[2], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  };

  const getNombreOperador = (idOrName: string) => {
    if (!idOrName) return '-';
    const found = operadoresList.find(o => o.id === idOrName || `${o.firstName} ${o.lastNamePaternal}`.trim() === idOrName.trim());
    return found ? `${found.firstName || ''} ${found.lastNamePaternal || ''}`.trim() : idOrName;
  };

  const getNombreBanco = (id: string) => bancosList.find(b => b.id === id)?.nombre || id;
  const getNombreFormaPago = (id: string) => formasPagoList.find(f => f.id === id)?.forma_pago || id;
  const getNombreEmpresa = (id: string) => {
    if (!id) return '';
    return empresasList.find(e => e.id === id)?.nombre || '';
  };

  const getNombreConvenio = (idOrName: string) => {
    if (!idOrName) return '';
    const c = conveniosList.find(x => x.id === idOrName);
    if (c) return c.nombre || c.convenio || c.nombreConvenio || c.descripcion || c.name || '';
    return '';
  };

  const getConsecutivoNomina = (n: any): string => {
    if (!n) return '-';
    const candidatos = [
      n.referencia, n.folio, n.numeroReferencia, n.noReferencia,
      n.consecutivoOriginal, n.numero, n.referenciaNomina, n.consecutivo,
    ];
    const val = candidatos.find(v => typeof v === 'string' && v.trim() !== '');
    return (val as string) || (n.consecutivo || '-');
  };

  const formatearFechaSpanish = (fechaString: string) => {
    if (!fechaString) return '-';
    try { return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return fechaString; }
  };

  const tieneCargoOperador = (emp: any) => {
    const c = emp?.cargoId ?? emp?.cargo ?? '';
    if (Array.isArray(c)) return c.some((x: any) => String(x).includes(ID_CARGO_OPERADOR));
    if (c && typeof c === 'object') return Object.values(c).some((v: any) => String(v).includes(ID_CARGO_OPERADOR));
    return String(c).includes(ID_CARGO_OPERADOR);
  };

  const operadoresFiltradosBuscador = useMemo(() => {
    const lista = operadoresList
      .filter(tieneCargoOperador)
      .map(e => ({ id: e.id, nombre: `${e.firstName || ''} ${e.lastNamePaternal || ''}`.trim() }))
      .filter(o => o.nombre);
    const unicos = Array.from(new Map(lista.map(o => [o.nombre, o])).values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    if (!textoBuscarOperador.trim()) return unicos.slice(0, 30);
    const q = textoBuscarOperador.toLowerCase().trim();
    return unicos.filter(o => o.nombre.toLowerCase().includes(q)).slice(0, 30);
  }, [operadoresList, textoBuscarOperador]);

  const filtrosCompletos = !!filtroOperador;

  const dentroRangoFecha = (opFecha: string) => {
    if (!fechaInicio && !fechaFin) return true;
    const f = String(opFecha || '').slice(0, 10);
    if (!f) return false;
    if (fechaInicio && f < fechaInicio) return false;
    if (fechaFin && f > fechaFin) return false;
    return true;
  };

  const operacionesBaseFiltro = useMemo(() => {
    if (!filtrosCompletos) return [];
    return operacionesGlobales.filter(op => {
      const opOperador = getNombreOperador(op.operadorNombre || op.operadorId || op.operador || '');
      const opFecha = op.fechaServicio || op.fecha || '';
      const matchOperador = opOperador === filtroOperador;
      return matchOperador && dentroRangoFecha(opFecha);
    });
  }, [operacionesGlobales, filtroOperador, fechaInicio, fechaFin, filtrosCompletos, operadoresList]);

  const esAsignada = (op: any) => !!op.referenciaNominaId;

  const conteoOps = useMemo(() => {
    const pendientes = operacionesBaseFiltro.filter(op => !esAsignada(op)).length;
    const asignadas = operacionesBaseFiltro.filter(esAsignada).length;
    return { pendientes, asignadas };
  }, [operacionesBaseFiltro]);

  const valorOrdenOp = (op: any, campo: string): string | number => {
    switch (campo) {
      case 'ref': return String(op.ref || op.id || '').toLowerCase();
      case 'fechaServicio': return String(op.fechaServicio || op.createdAt || '');
      case 'operador': return getNombreOperador(op.operadorNombre || op.operadorId || op.operador).toLowerCase();
      case 'origen': return String(op.origen || '').toLowerCase();
      case 'destino': return String(op.destino || '').toLowerCase();
      case 'sueldo': return Number(op.sueldoTotal || op.sueldoOperador || 0);
      case 'sueldoExtra': return Number(op.sueldoExtra || 0);
      default: return '';
    }
  };

  const operacionesMostradas = useMemo(() => {
    if (!filtrosCompletos) return [];
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
  }, [operacionesBaseFiltro, filtrosCompletos, filtroEstadoOps, ordenOps]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const valorCeldaOps = (op: any, key: string) => {
    switch (key) {
      case 'ref': return op.ref || op.id;
      case 'fechaServicio': return formatearFechaSpanish(op.fechaServicio || op.createdAt);
      case 'operador': return getNombreOperador(op.operadorNombre || op.operadorId || op.operador);
      case 'origen': return op.origen || '-';
      case 'destino': return op.destino || '-';
      case 'sueldo': return Number(op.sueldoTotal || op.sueldoOperador || 0);
      case 'sueldoExtra': return Number(op.sueldoExtra || 0);
      default: return '-';
    }
  };

  const renderCeldaOps = (op: any, key: string) => {
    const tdBase: React.CSSProperties = { padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' };
    switch (key) {
      case 'ref': return <td key={key} style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'operador': return <td key={key} style={tdBase}>{getNombreOperador(op.operadorNombre || op.operadorId || op.operador)}</td>;
      case 'origen': return <td key={key} style={tdBase}>{op.origen || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destino || '-'}</td>;
      case 'sueldo': return <td key={key} style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(op.sueldoTotal || op.sueldoOperador)}</td>;
      case 'sueldoExtra': {
        const tieneExtra = Number(op.sueldoExtra || 0) > 0;
        return (
          <td key={key} style={{ padding: '16px', whiteSpace: 'nowrap' }}>
            <button type="button" onClick={(e) => abrirEditorExtra(e, op)} title="Editar sueldo extra de esta operación"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem',
                backgroundColor: tieneExtra ? 'rgba(245,158,11,0.12)' : 'transparent',
                border: `1px solid ${tieneExtra ? '#f59e0b' : '#30363d'}`,
                color: tieneExtra ? '#f59e0b' : '#8b949e' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
              {tieneExtra ? formatoMoneda(op.sueldoExtra) : 'Agregar'}
            </button>
          </td>
        );
      }
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
    XLSX.utils.book_append_sheet(wb, ws, `Ops_${etiqueta}`);
    const ope = (filtroOperador || 'operador').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
    const hoy = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Operaciones_Nomina_${etiqueta}_${ope}_${hoy}.xlsx`);
  };

  const toggleSeleccion = (id: string) => {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const todasMostradasSeleccionadas = operacionesMostradas.length > 0 && operacionesMostradas.every(op => seleccionadas.includes(op.id));
  const toggleSeleccionarTodo = () => {
    const idsMostradas = operacionesMostradas.map(o => o.id);
    if (idsMostradas.length > 0 && idsMostradas.every(id => seleccionadas.includes(id))) {
      setSeleccionadas(prev => prev.filter(id => !idsMostradas.includes(id)));
    } else {
      setSeleccionadas(prev => Array.from(new Set([...prev, ...idsMostradas])));
    }
  };

  // ── Edición rápida del sueldo extra por operación (campo sueldoExtra en operaciones) ──
  const [editandoExtra, setEditandoExtra] = useState<{ id: string; ref: string; valor: number | '' } | null>(null);
  const [guardandoExtra, setGuardandoExtra] = useState(false);

  // ✅ NUEVO: edición rápida del SUELDO BASE por operación (campo sueldoTotal en operaciones).
  const [editandoSueldo, setEditandoSueldo] = useState<{ id: string; ref: string; valor: number | '' } | null>(null);
  const [guardandoSueldo, setGuardandoSueldo] = useState(false);

  const abrirEditorExtra = (e: React.MouseEvent, op: any) => {
    e.stopPropagation();
    setEditandoExtra({
      id: op.id,
      ref: op.ref || op.id.substring(0, 6),
      valor: op.sueldoExtra != null && op.sueldoExtra !== '' ? Number(op.sueldoExtra) : '',
    });
  };

  const guardarExtraOperacion = async () => {
    if (!editandoExtra) return;
    const nuevoValor = Number(editandoExtra.valor) || 0;
    setGuardandoExtra(true);
    try {
      await updateDoc(doc(db, 'operaciones', editandoExtra.id), { sueldoExtra: nuevoValor });
      setOperacionesGlobales(prev => prev.map(o => o.id === editandoExtra.id ? { ...o, sueldoExtra: nuevoValor } : o));
      setOpsFicha(prev => prev.map(o => o.id === editandoExtra.id ? { ...o, sueldoExtra: nuevoValor } : o));
      setEditandoExtra(null);
    } catch (error) {
      console.error('Error al guardar el sueldo extra:', error);
      alert('No se pudo guardar el sueldo extra de la operación.');
    } finally {
      setGuardandoExtra(false);
    }
  };

  // ✅ NUEVO: abre el editor del SUELDO BASE (toma el valor mostrado en la columna SUELDO).
  const abrirEditorSueldo = (e: React.MouseEvent, op: any) => {
    e.stopPropagation();
    const base = (op.sueldo != null && op.sueldo !== '')
      ? Number(op.sueldo)
      : (op.importe != null && op.importe !== '')
        ? Number(op.importe)
        : Number(op.sueldoTotal ?? op.sueldoOperador ?? 0);
    setEditandoSueldo({
      id: op.id,
      ref: op.ref || op.id.substring(0, 6),
      valor: base || '',
    });
  };

  // ✅ NUEVO: guarda el SUELDO BASE en la operación (campo sueldoTotal) y refresca
  //   la Ficha y la tabla de asignación en vivo (incluye el recálculo de subtotales).
  const guardarSueldoOperacion = async () => {
    if (!editandoSueldo) return;
    const nuevoValor = Number(editandoSueldo.valor) || 0;
    setGuardandoSueldo(true);
    try {
      await updateDoc(doc(db, 'operaciones', editandoSueldo.id), { sueldoTotal: nuevoValor });
      setOperacionesGlobales(prev => prev.map(o => o.id === editandoSueldo.id ? { ...o, sueldoTotal: nuevoValor } : o));
      // En la Ficha, el detalle usa sueldo/importe/sueldoTotal: se actualizan los tres.
      setOpsFicha(prev => prev.map(o => o.id === editandoSueldo.id ? { ...o, sueldo: nuevoValor, importe: nuevoValor, sueldoTotal: nuevoValor } : o));
      setEditandoSueldo(null);
    } catch (error) {
      console.error('Error al guardar el sueldo:', error);
      alert('No se pudo guardar el sueldo de la operación.');
    } finally {
      setGuardandoSueldo(false);
    }
  };

  const resumenSeleccion = useMemo(() => {
    let subtotal = 0;
    let subtotalExtra = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        subtotal += Number(op.sueldoTotal || op.sueldoOperador || 0) + Number(op.sueldoExtra || 0);
        subtotalExtra += Number(op.sueldoExtra || 0);
        refs.push(op.ref || op.id?.substring(0,6));
      }
    });
    return { subtotal, subtotalExtra, refs };
  }, [seleccionadas, operacionesGlobales]);

  // ✅ NUEVO: detalle de las operaciones seleccionadas (para mostrarlas en la pestaña Referencia
  //   del modal junto con su sueldo total y así llevar el control de lo que se está pagando).
  const detalleSeleccionadas = useMemo(() => {
    return seleccionadas
      .map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        if (!op) return null;
        const base = Number(op.sueldoTotal || op.sueldoOperador || 0);
        const extra = Number(op.sueldoExtra || 0);
        return {
          id,
          ref: op.ref || op.id?.substring(0, 6) || '-',
          fecha: op.fechaServicio || op.fecha || '',
          origen: op.origen || '-',
          destino: op.destino || '-',
          sueldo: base,
          extra,
          total: base + extra,
        };
      })
      .filter(Boolean) as Array<{ id: string; ref: string; fecha: string; origen: string; destino: string; sueldo: number; extra: number; total: number }>;
  }, [seleccionadas, operacionesGlobales]);

  const operadorIdSeleccionado = useMemo(() => {
    const f = operadoresList.find(o => `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim() === filtroOperador.trim());
    return f?.id || '';
  }, [operadoresList, filtroOperador]);

  const deduccionOperador = useMemo(() => {
    if (!operadorIdSeleccionado) return null;
    return deduccionesList.find(d => String(d.empleadoId) === String(operadorIdSeleccionado)) || null;
  }, [deduccionesList, operadorIdSeleccionado]);

  const dNominaFiscal     = Number(deduccionOperador?.nominaFiscal || 0);
  const dInfonavit        = Number(deduccionOperador?.infonavit ?? deduccionOperador?.Infonavit ?? 0);
  const dFonacot          = Number(deduccionOperador?.fonacot ?? deduccionOperador?.Fonacot ?? 0);
  const dImss             = Number(deduccionOperador?.IMSS ?? deduccionOperador?.imss ?? 0);
  const dIsr              = Number(deduccionOperador?.ISR ?? deduccionOperador?.isr ?? 0);
  const dPrestamoAcumulado = Number(deduccionOperador?.prestamo ?? deduccionOperador?.prestamoAcumulado ?? 0);
  const dAhorroMonto      = Number(deduccionOperador?.ahorro || 0);
  const dAhorroAcumulado  = Number(deduccionOperador?.ahorroAcumulado || 0);

  const subtotalReferencias     = resumenSeleccion.subtotal;
  const subtotalAPagarCalc      = subtotalReferencias + (Number(extras) || 0);
  const diferenciaAplicableCalc = subtotalAPagarCalc - dNominaFiscal;
  const isrMontoCalc            = (Number(isr) || 0) * subtotalAPagarCalc;
  const prestamoAcumuladoTotal  = dPrestamoAcumulado + (Number(prestamoNuevo) || 0);
  const saldoPrestamoCalc       = prestamoAcumuladoTotal - (Number(pagoPrestamo) || 0);
  const totalDeduccionesCalc    = (Number(infonavit) || 0) + (Number(imss) || 0) + isrMontoCalc + (Number(fonacot) || 0);
  const totalNetoCalc           = subtotalAPagarCalc - totalDeduccionesCalc;
  // ✅ NUEVO: ahorro con la misma lógica que el préstamo.
  const ahorroAcumuladoTotal    = dAhorroAcumulado + (Number(ahorroNuevo) || 0);
  const saldoAhorroCalc         = ahorroAcumuladoTotal - (Number(pagoAhorro) || 0);
  const totalAPagarCalc         = totalNetoCalc + (Number(depositoGastos) || 0) + (Number(otrosDepositos) || 0);

  const abrirModalNomina = () => {
    setConsecutivoForm(generarConsecutivo(fechaPago));
    setPestanaModalNomina('general');
    setInfonavit(dInfonavit || '');
    setFonacot(dFonacot || '');
    setImss(dImss || '');
    setIsr(dIsr || '');
    setPrestamoNuevo('');
    setPagoPrestamo('');
    setExtras('');
    setDepositoGastos('');
    setOtrosDepositos('');
    setAhorroNuevo(dAhorroMonto || '');
    setPagoAhorro('');
    setModalAbierto(true);
  };

  const handleGuardarNomina = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formaPagoSeleccionada || !bancoSeleccionado) {
      setPestanaModalNomina('totales');
      return alert('Selecciona la Forma de Pago y el Banco en la pestaña Totales.');
    }
    setGuardando(true);
    try {
      const batch = writeBatch(db);
      const nuevoId = doc(collection(db, 'referencias_nomina')).id;
      const consecutivoFinal = generarConsecutivo(fechaPago);

      const operacionesResumenEstable = seleccionadas.map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        const base = Number(op?.sueldoTotal || op?.sueldoOperador || 0);
        const extraOp = Number(op?.sueldoExtra || 0);
        return {
          id,
          ref: op?.ref || id.substring(0,6),
          fecha: op?.fechaServicio || op?.fecha || '',
          cliente: getNombreEmpresa(op?.clientePaga)
            || op?.clienteNombre || op?.clientePagaNombre || op?.nombreCliente || '-',
          convenio: getNombreConvenio(op?.convenioId || op?.convenio) || op?.convenioNombre || (typeof op?.convenio === 'string' ? op?.convenio : '') || '-',
          tipoServicio: op?.tarifaLabel || op?.tarifarioLabel || op?.convenioNombre || op?.tipoOperacionNombre || op?.tipoServicio || '-',
          importe: base,
          sueldo: base,
          sueldoExtra: extraOp
        };
      });

      const data = {
        consecutivo: consecutivoFinal,
        fechaPago, fechaInicio, fechaFin,
        operadorId: operadorIdSeleccionado || null,
        operadorNombre: filtroOperador,
        deduccionId: deduccionOperador?.id || null,
        operacionesIds: seleccionadas,
        operacionesGuardadas: operacionesResumenEstable,
        statusPagado: statusPagado === 'Pagada',

        nominaFiscal: dNominaFiscal,
        subtotalPagar: subtotalReferencias,
        extras: Number(extras),
        subtotalAPagar: subtotalAPagarCalc,
        diferenciaAplicable: diferenciaAplicableCalc,

        infonavit: Number(infonavit),
        fonacot: Number(fonacot),
        imss: Number(imss),
        isr: Number(isr),
        isrMonto: isrMontoCalc,

        prestamoOtorgado: Number(prestamoNuevo),
        prestamoAcumuladoPrevio: dPrestamoAcumulado,
        prestamoAcumulado: prestamoAcumuladoTotal,
        pagoPrestamo: Number(pagoPrestamo),
        saldoPrestamo: saldoPrestamoCalc,

        // ✅ NUEVO: ahorro con la misma lógica que el préstamo.
        ahorro: Number(ahorroNuevo) || 0,
        pagoAhorro: Number(pagoAhorro) || 0,
        ahorroAcumuladoPrevio: dAhorroAcumulado,
        ahorroPagado: (Number(pagoAhorro) || 0) > 0,
        ahorroAcumulado: saldoAhorroCalc,

        totalDeducciones: totalDeduccionesCalc,
        total: totalNetoCalc,
        depositoGastos: Number(depositoGastos),
        otrosDepositos: Number(otrosDepositos),
        totalAPagar: totalAPagarCalc,

        formaPagoId: formaPagoSeleccionada,
        formaPagoNombre: getNombreFormaPago(formaPagoSeleccionada),
        bancoPagoId: bancoSeleccionado,
        bancoPagoNombre: getNombreBanco(bancoSeleccionado),
        notaDepositos,
        createdAt: new Date().toISOString()
      };

      batch.set(doc(db, 'referencias_nomina', nuevoId), data);

      if (deduccionOperador?.id) {
        batch.update(doc(db, 'deducciones', deduccionOperador.id), {
          prestamo: saldoPrestamoCalc,
          ahorroAcumulado: saldoAhorroCalc,
        });
      }

      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { referenciaNominaId: nuevoId, referenciaNominaConsecutivo: consecutivoFinal });
      });

      await batch.commit();
      generarReciboNomina({ ...data, id: nuevoId });
      const idsAsignadas = [...seleccionadas];
      setOperacionesGlobales(prev => prev.map(op =>
        idsAsignadas.includes(op.id) ? { ...op, referenciaNominaId: nuevoId, referenciaNominaConsecutivo: consecutivoFinal } : op
      ));
      setModalAbierto(false);
      setSeleccionadas([]);
      resetFormulario();
      setActiveTab('historial');
    } catch (error) {
      console.error(error);
      alert("Error al guardar la nómina.");
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminarNomina = async (e: React.MouseEvent, nomData: any) => {
    e.stopPropagation();
    if (window.confirm(`¿Estás seguro de eliminar la nómina ${nomData.consecutivo}? Las operaciones asociadas quedarán liberadas nuevamente.`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'referencias_nomina', nomData.id));
        if (Array.isArray(nomData.operacionesIds)) {
          nomData.operacionesIds.forEach((opId: string) => {
            batch.update(doc(db, 'operaciones', opId), { referenciaNominaId: null, referenciaNominaConsecutivo: null });
          });
        }
        await batch.commit();
        const idsLiberadas: string[] = Array.isArray(nomData.operacionesIds) ? nomData.operacionesIds : [];
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, referenciaNominaId: null, referenciaNominaConsecutivo: null } : op
        ));
      } catch (error) {
        console.error("Error al eliminar nómina:", error);
        alert("Hubo un error al eliminar.");
      }
    }
  };

  const resetFormulario = () => {
    setExtras(''); setInfonavit(''); setFonacot(''); setImss(''); setIsr('');
    setPrestamoNuevo(''); setPagoPrestamo(''); setDepositoGastos(''); setOtrosDepositos('');
    setAhorroNuevo(''); setPagoAhorro('');
    setNotaDepositos(''); setFormaPagoSeleccionada(''); setBancoSeleccionado(''); setStatusPagado('Pendiente');
    setPestanaModalNomina('general');
  };

  const generarReciboNomina = async (nom: any) => {
    const m = (v: any) => '$' + (Number(v) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let trips: any[] = [];
    try {
      trips = await cargarOperacionesDeNomina(nom);
    } catch (e) {
      console.error('[Recibo] No se pudieron cargar las operaciones:', e);
      trips = Array.isArray(nom.operacionesGuardadas) ? nom.operacionesGuardadas : [];
    }
    const tot = reconstruirTotales(nom, trips);
    const operadorNombreRec = getNombreOperador(nom.operadorNombre || nom.operadorId);
    const consecutivoRec = getConsecutivoNomina(nom);

    const filas = trips.map((t: any) => `
        <tr>
          <td>${esc(t.ref || '-')}</td>
          <td>${t.fecha ? esc(formatearFechaSpanish(t.fecha)) : '-'}</td>
          <td>${esc(t.cliente || getNombreEmpresa(t.clientePagaId) || '-')}</td>
          <td>${esc(t.convenio || t.tipoServicio || '-')}</td>
          <td>${m(t.importe ?? t.sueldo ?? 0)}</td>
        </tr>`).join('');

    const sueldoBase = nom.nominaFiscal ?? nom.nomina ?? 0;

    const logoSrc = (empresaConfig?.logoBase64 && empresaConfig.logoBase64.startsWith('data:'))
      ? empresaConfig.logoBase64
      : LOGO_DEFAULT;

    const htmlTemplate = `
<style>
  #recibo-nomina-root { background:#fff; color:#333; font-family:'Segoe UI',Roboto,Arial,sans-serif; width:1040px; box-sizing:border-box; }
  #recibo-nomina-root * { box-sizing:border-box; }
  #recibo-nomina-root .receipt-container { background:#fff; width:100%; padding:25px 35px; border-top:8px solid #f37021; }
  #recibo-nomina-root header { display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:10px; }
  #recibo-nomina-root .header-left { display:flex; align-items:center; gap:20px; }
  #recibo-nomina-root .logo-img { max-height:70px; width:auto; }
  #recibo-nomina-root .brand h1 { margin:0; color:#f37021; font-size:26px; letter-spacing:1px; line-height:1; }
  #recibo-nomina-root .brand p { margin:3px 0 0; color:#002d5a; font-weight:bold; font-size:13px; }
  #recibo-nomina-root .header-info { text-align:right; }
  #recibo-nomina-root .header-info h2 { margin:0; color:#f37021; font-size:20px; }
  #recibo-nomina-root .header-info p { margin:2px 0; font-size:0.85em; color:#666; }
  #recibo-nomina-root .summary-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:15px; margin-bottom:15px; }
  #recibo-nomina-root .card { background:#fffaf7; border:1px solid #ffd8c2; border-radius:8px; padding:12px 15px; }
  #recibo-nomina-root .card h3 { margin:0 0 8px 0; font-size:1em; color:#d65a10; border-bottom:2px solid #f37021; display:inline-block; padding-bottom:2px; }
  #recibo-nomina-root .row { display:flex; justify-content:space-between; margin:6px 0; font-size:0.85em; }
  #recibo-nomina-root .total-row { font-weight:bold; color:#000; border-top:1px dashed #f37021; padding-top:6px; margin-top:6px; }
  #recibo-nomina-root .table-section h3 { color:#002d5a; font-size:1.1em; margin-bottom:8px; }
  #recibo-nomina-root table { width:100%; border-collapse:collapse; font-size:0.8em; }
  #recibo-nomina-root th { background-color:#f37021; color:#fff; text-align:left; padding:8px; text-transform:uppercase; }
  #recibo-nomina-root td { padding:6px 8px; border-bottom:1px solid #eee; }
  #recibo-nomina-root tr:nth-child(even) { background-color:#fff9f5; }
  #recibo-nomina-root .footer-total { margin-top:15px; display:flex; justify-content:flex-end; }
  #recibo-nomina-root .total-box { background:#f37021; color:#fff; padding:12px 30px; border-radius:8px; text-align:right; }
  #recibo-nomina-root .total-box p { margin:0; font-size:0.8em; opacity:0.9; }
  #recibo-nomina-root .total-box h2 { margin:2px 0 0; font-size:1.7em; }
</style>
  <div class="receipt-container">
    <header>
      <div class="header-left">
        <img class="logo-img" alt="Logo" src="${logoSrc}" onerror="this.style.display='none'">
        <div class="brand"><h1>ROELCA</h1><p>ROELCA INC.</p></div>
      </div>
      <div class="header-info">
        <h2>RECIBO DE NÓMINA</h2>
        <p><strong>Operador:</strong> ${esc(operadorNombreRec || '-')}</p>
        <p><strong>Periodo:</strong> ${esc(formatearFechaSpanish(nom.fechaInicio))} al ${esc(formatearFechaSpanish(nom.fechaFin))}</p>
        <p><strong>Fecha de Pago:</strong> ${esc(formatearFechaSpanish(nom.fechaPago))}</p>
        <p><strong>Referencia:</strong> ${esc(consecutivoRec || '-')}</p>
      </div>
    </header>

    <div class="summary-grid">
      <div class="card">
        <h3>Percepciones</h3>
        <div class="row"><span>Sueldo Base</span><span>${m(sueldoBase)}</span></div>
        <div class="row"><span>Diferencia Aplicable</span><span>${m(nom.diferenciaAplicable)}</span></div>
        <div class="row"><span>Subtotal</span><span>${m(tot.subRef)}</span></div>
        <div class="row"><span>Extras</span><span>${m(nom.extras)}</span></div>
        <div class="row"><span>Otros Gastos</span><span>${m(nom.depositoGastos)}</span></div>
        <div class="row"><span>Otros Depositos</span><span>${m(nom.otrosDepositos)}</span></div>
        <div class="row total-row"><span>Total Bruto</span><span>${m(tot.subAPagar)}</span></div>
      </div>
      <div class="card">
        <h3>Deducciones</h3>
        <div class="row"><span>Retención IMSS</span><span>${m(nom.imss)}</span></div>
        <div class="row"><span>Retención ISR</span><span>${m(nom.isrMonto)}</span></div>
        <div class="row"><span>Infonavit</span><span>${m(nom.infonavit)}</span></div>
        <div class="row"><span>Fonacot</span><span>${m(nom.fonacot)}</span></div>
        <div class="row"><span>Ahorro</span><span>${m(nom.ahorro)}</span></div>
        <div class="row"><span>Retiro/Pago Ahorro</span><span>${m(nom.pagoAhorro)}</span></div>
        <div class="row"><span>Abono a Préstamo</span><span>${m(nom.pagoPrestamo)}</span></div>
        <div class="row total-row"><span>Total Deducciones</span><span>${m(tot.totalDed)}</span></div>
      </div>
      <div class="card">
        <h3>Saldos Informativos</h3>
        <div class="row"><span>Ahorro Acumulado</span><span>${m(nom.ahorroAcumulado)}</span></div>
        <div class="row"><span>Saldo de Préstamo</span><span>${m(nom.saldoPrestamo)}</span></div>
        <div class="row"><span>Banco</span><span>${esc(nom.bancoPagoNombre || '-')}</span></div>
        <div class="row"><span>Forma de Pago</span><span>${esc(nom.formaPagoNombre || '-')}</span></div>
        ${nom.ahorroPagado ? '<div class="row total-row"><span>Retiro de ahorro</span><span>SÍ</span></div>' : ''}
      </div>
    </div>

    <div class="table-section">
      <h3>Detalle de Viajes realizados</h3>
      <table>
        <thead><tr><th>Referencia</th><th>Fecha</th><th>Cliente</th><th>Convenio</th><th>Importe</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" style="text-align:center;color:#888;">Sin operaciones registradas.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="footer-total">
      <div class="total-box"><p>Neto a Recibir</p><h2>${m(tot.totalAPagar)}</h2></div>
    </div>
  </div>`;

    const elementoTemporal = document.createElement('div');
    elementoTemporal.id = 'recibo-nomina-root';
    elementoTemporal.innerHTML = htmlTemplate;
    document.body.appendChild(elementoTemporal);

    const filename = `Recibo_Nomina_${String(consecutivoRec || 'recibo').replace(/\W/g, '_')}.pdf`;

    const opt = {
      margin:       0.2,
      filename:     filename,
      image:        { type: 'jpeg' as const, quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, windowWidth: 1040 },
      jsPDF:        { unit: 'in' as const, format: 'letter', orientation: 'landscape' as const }
    };

    (async () => {
      const _imgs = Array.from(elementoTemporal.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(_imgs.map(im => (im.complete && im.naturalWidth > 0)
        ? Promise.resolve()
        : new Promise<void>(res => { im.onload = () => res(); im.onerror = () => res(); })));
      try {
        await html2pdf().set(opt).from(elementoTemporal).save();
      } finally {
        if (elementoTemporal.parentNode) document.body.removeChild(elementoTemporal);
      }
    })();
  };

  const historialBusqueda = useMemo(() => {
    const t = busquedaHistorial.toLowerCase();
    return nominasGlobales.filter(n =>
      getConsecutivoNomina(n).toLowerCase().includes(t) ||
      n.consecutivo?.toLowerCase().includes(t) ||
      (n.operadorNombre || n.operadorId || '').toLowerCase().includes(t)
    );
  }, [nominasGlobales, busquedaHistorial, conveniosList]);

  const conteoHist = useMemo(() => {
    const pagadas = historialBusqueda.filter(n => !!n.statusPagado).length;
    return { pendientes: historialBusqueda.length - pagadas, pagadas };
  }, [historialBusqueda]);

  const historialFiltrado = useMemo(() => {
    const lista = historialBusqueda.filter(n => filtroEstadoHist === 'pagadas' ? !!n.statusPagado : !n.statusPagado);
    return [...lista].sort((a, b) => {
      const fa = String(a.fechaPago || a.createdAt || '');
      const fb = String(b.fechaPago || b.createdAt || '');
      if (fb !== fa) return fb.localeCompare(fa);
      return getConsecutivoNomina(b).localeCompare(getConsecutivoNomina(a), 'es', { numeric: true });
    });
  }, [historialBusqueda, filtroEstadoHist, conveniosList]);

  const totalPaginas = Math.ceil(historialFiltrado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  const registrosVisibles = historialFiltrado.slice(indexFirst, indexLast);
  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));

  useEffect(() => { setPaginaActual(1); }, [busquedaHistorial, filtroEstadoHist]);

  useEffect(() => {
    if (!nominaViendo) { setOpsFicha([]); return; }
    let cancelado = false;
    (async () => {
      setCargandoOpsFicha(true);
      try {
        const ops = await cargarOperacionesDeNomina(nominaViendo);
        if (!cancelado) setOpsFicha(ops);
      } catch (e) {
        console.error('[Nómina] Error al cargar operaciones de la ficha:', e);
        if (!cancelado) setOpsFicha([]);
      } finally {
        if (!cancelado) setCargandoOpsFicha(false);
      }
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nominaViendo]);

  const subtotalReferenciasFicha = useMemo(
    () => reconstruirTotales(nominaViendo, opsFicha).subRef,
    [nominaViendo, opsFicha]
  );

  const fichaTotales = useMemo(
    () => reconstruirTotales(nominaViendo, opsFicha),
    [nominaViendo, opsFicha]
  );

  const subtotalesFicha = useMemo(() => {
    const sueldo = opsFicha.reduce((s: number, o: any) => s + aNum(o.sueldo ?? o.importe ?? o.sueldoTotal), 0);
    const extra = opsFicha.reduce((s: number, o: any) => s + aNum(o.sueldoExtra), 0);
    return { sueldo, extra, total: sueldo + extra };
  }, [opsFicha]);

  const handleTogglePagoNomina = async (e: React.MouseEvent, nom: any) => {
    e.stopPropagation();
    const nuevoPagado = !nom.statusPagado;
    const accion = nuevoPagado ? 'marcar como PAGADA' : 'regresar a PENDIENTE';
    if (!window.confirm(`¿Deseas ${accion} la nómina ${nom.consecutivo}?`)) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'referencias_nomina', nom.id), { statusPagado: nuevoPagado });
      await batch.commit();
      setNominasGlobales(prev => prev.map(n => n.id === nom.id ? { ...n, statusPagado: nuevoPagado } : n));
    } catch (error) {
      console.error('Error al actualizar estatus de nómina:', error);
      alert('No se pudo actualizar el estatus de la nómina.');
    }
  };

  const exportarCSV = () => {
    if (historialFiltrado.length === 0) return alert("No hay datos para exportar.");
    const datosExcel = historialFiltrado.map(n => ({
      'Consecutivo': getConsecutivoNomina(n),
      'Operador': n.operadorNombre || n.operadorId,
      'Fecha Pago': formatearFechaSpanish(n.fechaPago),
      'Semana': `${formatearFechaSpanish(n.fechaInicio)} al ${formatearFechaSpanish(n.fechaFin)}`,
      'Status': n.statusPagado ? 'PAGADA' : 'PENDIENTE',
      'Subtotal Referencias': n.subtotalPagar,
      'Extra': n.extras,
      'Subtotal a Pagar': n.subtotalAPagar,
      'Nómina Fiscal': n.nominaFiscal ?? n.nomina,
      'Diferencia Aplicable': n.diferenciaAplicable,
      'Infonavit': n.infonavit,
      'Fonacot': n.fonacot,
      'IMSS': n.imss,
      'ISR': n.isr,
      'ISR Monto': n.isrMonto,
      'Préstamo Otorgado': n.prestamoOtorgado,
      'Pago Préstamo': n.pagoPrestamo,
      'Saldo Préstamo': n.saldoPrestamo,
      'Ahorro': n.ahorro,
      'Pago/Retiro Ahorro': n.pagoAhorro,
      'Ahorro Acumulado': n.ahorroAcumulado,
      'Total Deducciones': n.totalDeducciones,
      'Total': n.total,
      'Depósito Gastos': n.depositoGastos,
      'Otros Depósitos': n.otrosDepositos,
      'Total a Pagar': n.totalAPagar,
      'Banco': n.bancoPagoNombre || n.bancoPagoId,
      'Forma Pago': n.formaPagoNombre || n.formaPagoId,
      'Notas': n.notaDepositos
    }));
    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Nominas');
    XLSX.writeFile(workbook, `Historial_Nominas_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Movimientos del operador (todas sus nóminas), en orden ascendente por fecha.
  const historialPrestamos = useMemo(() => {
    if (!filtroOperador) return [];
    const movs = nominasGlobales.filter(n =>
      (operadorIdSeleccionado && n.operadorId === operadorIdSeleccionado) ||
      (n.operadorNombre || '') === filtroOperador
    );
    return [...movs].sort((a, b) => String(a.fechaPago || a.createdAt || '').localeCompare(String(b.fechaPago || b.createdAt || '')));
  }, [nominasGlobales, filtroOperador, operadorIdSeleccionado]);

  const resumenPrestamos = useMemo(() => {
    let otorgado = 0, pagado = 0;
    historialPrestamos.forEach(n => {
      otorgado += Number(n.prestamoOtorgado || 0);
      pagado += Number(n.pagoPrestamo || 0);
    });
    return { otorgado, pagado };
  }, [historialPrestamos]);

  // ✅ NUEVO: reconstructor de movimientos (saldo corriente) para préstamo y ahorro.
  //   Se ancla al saldo guardado en cada nómina (lo más fiel a lo que realmente quedó),
  //   y deriva el SALDO INICIAL heredado a partir del primer movimiento. Así el saldo
  //   final del historial coincide con el saldo real de la colección `deducciones`.
  const construirMovimientos = (
    lista: any[],
    getAgregado: (n: any) => number,
    getPago: (n: any) => number | null,
    getStoredAfter: (n: any) => number | null,
    getPrevio: (n: any) => number | null,
    saldoActualFallback: number
  ) => {
    let running: number | null = null;
    let inicial = 0;
    let sumaAgregado = 0;
    let sumaPago = 0;
    const filas = lista.map((n, idx) => {
      const agregado = getAgregado(n);
      const storedAfter = getStoredAfter(n);
      const pagoExplicito = getPago(n);
      const previo = getPrevio(n);

      let before: number;
      if (running != null) before = running;
      else if (previo != null) before = previo;
      else if (storedAfter != null) before = Math.max(storedAfter - agregado + (pagoExplicito ?? 0), 0);
      else before = 0;

      if (idx === 0) inicial = before;

      let pago: number;
      let after: number;
      if (storedAfter != null) {
        after = storedAfter;
        pago = (pagoExplicito != null) ? pagoExplicito : Math.max(before + agregado - storedAfter, 0);
      } else {
        pago = pagoExplicito ?? 0;
        after = before + agregado - pago;
      }

      running = after;
      sumaAgregado += agregado;
      sumaPago += pago;

      return {
        id: n.id,
        fecha: n.fechaPago || n.createdAt || '',
        consecutivo: getConsecutivoNomina(n),
        agregado,
        pago,
        saldo: after,
      };
    });

    const saldoFinal = (running != null) ? running : saldoActualFallback;
    if (lista.length === 0) inicial = saldoActualFallback;
    return { inicial, filas, sumaAgregado, sumaPago, saldoFinal };
  };

  const datosPrestamo = useMemo(() => construirMovimientos(
    historialPrestamos,
    n => Number(n.prestamoOtorgado || 0),
    n => (n.pagoPrestamo != null && n.pagoPrestamo !== '') ? Number(n.pagoPrestamo) : null,
    n => (n.saldoPrestamo != null && n.saldoPrestamo !== '') ? Number(n.saldoPrestamo) : null,
    n => (n.prestamoAcumuladoPrevio != null && n.prestamoAcumuladoPrevio !== '') ? Number(n.prestamoAcumuladoPrevio) : null,
    dPrestamoAcumulado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [historialPrestamos, dPrestamoAcumulado]);

  const datosAhorro = useMemo(() => construirMovimientos(
    historialPrestamos,
    n => Number(n.ahorro || 0),
    n => (n.pagoAhorro != null && n.pagoAhorro !== '') ? Number(n.pagoAhorro) : null,
    n => (n.ahorroAcumulado != null && n.ahorroAcumulado !== '') ? Number(n.ahorroAcumulado) : null,
    n => (n.ahorroAcumuladoPrevio != null && n.ahorroAcumuladoPrevio !== '') ? Number(n.ahorroAcumuladoPrevio) : null,
    dAhorroAcumulado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [historialPrestamos, dAhorroAcumulado]);

  const exportarPrestamosCSV = () => {
    if (datosPrestamo.filas.length === 0) return alert("No hay movimientos de préstamo para este operador.");
    const datos = [
      { 'Fecha Pago': 'SALDO INICIAL (heredado)', 'Consecutivo': '-', 'Préstamo Otorgado': 0, 'Pago Préstamo': 0, 'Saldo': datosPrestamo.inicial },
      ...datosPrestamo.filas.map(f => ({
        'Fecha Pago': formatearFechaSpanish(f.fecha),
        'Consecutivo': f.consecutivo,
        'Préstamo Otorgado': f.agregado,
        'Pago Préstamo': f.pago,
        'Saldo': f.saldo,
      })),
    ];
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Prestamos');
    const ope = (filtroOperador || 'operador').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
    XLSX.writeFile(wb, `Prestamos_${ope}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportarAhorroCSV = () => {
    if (datosAhorro.filas.length === 0) return alert("No hay movimientos de ahorro para este operador.");
    const datos = [
      { 'Fecha Pago': 'SALDO INICIAL (heredado)', 'Consecutivo': '-', 'Ahorro Agregado': 0, 'Pago/Retiro Ahorro': 0, 'Saldo': datosAhorro.inicial },
      ...datosAhorro.filas.map(f => ({
        'Fecha Pago': formatearFechaSpanish(f.fecha),
        'Consecutivo': f.consecutivo,
        'Ahorro Agregado': f.agregado,
        'Pago/Retiro Ahorro': f.pago,
        'Saldo': f.saldo,
      })),
    ];
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ahorro');
    const ope = (filtroOperador || 'operador').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
    XLSX.writeFile(wb, `Ahorro_${ope}_${new Date().toISOString().split('T')[0]}.xlsx`);
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

  const tabModalStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal', fontSize: '0.9rem', whiteSpace: 'nowrap'
  });
  const labelNomStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.72rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 'bold' };
  const inputBaseStyle: React.CSSProperties = { width: '100%', padding: '8px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px' };

  const campoNumerico = (label: string, value: number | '', setter: (v: number | '') => void, step = '0.01') => (
    <div>
      <label style={labelNomStyle}>{label}</label>
      <input type="number" step={step} value={value}
        onChange={e => setter(e.target.valueAsNumber || '')}
        style={{ ...inputBaseStyle, color: '#3fb950', fontWeight: 'bold' }} />
    </div>
  );

  const campoTotal = (label: string, val: number, color = '#58a6ff', resaltar = false) => (
    <div>
      <label style={labelNomStyle}>{label}</label>
      <div style={{ color, fontSize: '1.1rem', fontWeight: 'bold', padding: '8px 12px',
        backgroundColor: resaltar ? 'rgba(216,67,21,0.1)' : '#0d1117',
        borderRadius: '6px', border: `1px solid ${resaltar ? '#D84315' : '#30363d'}` }}>
        {formatoMoneda(val)}
      </div>
    </div>
  );

  const gridTres: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' };

  const renderBuscadorOperador = () => (
    <div style={{ flex: 1, minWidth: '320px', position: 'relative' }}>
      <label style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>OPERADOR ★</label>
      {filtroOperador ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', minHeight: '20px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span style={{ color: '#10b981', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filtroOperador}</span>
          <button onClick={() => { setFiltroOperador(''); setTextoBuscarOperador(''); setMostrarSugerenciasOperador(false); setSeleccionadas([]); }} title="Cambiar operador" style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" placeholder="Buscar operador por nombre..." value={textoBuscarOperador}
            onChange={(e) => { setTextoBuscarOperador(e.target.value); setMostrarSugerenciasOperador(true); }}
            onFocus={() => setMostrarSugerenciasOperador(true)} onBlur={() => setTimeout(() => setMostrarSugerenciasOperador(false), 180)}
            style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#161b22', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
        </div>
      )}
      {!filtroOperador && mostrarSugerenciasOperador && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', maxHeight: '320px', overflowY: 'auto', zIndex: 100, marginTop: '4px', boxShadow: '0 6px 16px rgba(0,0,0,0.5)' }}>
          {operadoresFiltradosBuscador.length === 0 ? (
            <div style={{ padding: '14px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>{textoBuscarOperador.trim() ? 'Sin coincidencias' : 'No hay operadores (cargo Operador) cargados'}</div>
          ) : (
            <>
              <div style={{ padding: '6px 12px', fontSize: '0.7rem', color: '#8b949e', borderBottom: '1px solid #21262d', backgroundColor: '#161b22' }}>{operadoresFiltradosBuscador.length} {operadoresFiltradosBuscador.length === 1 ? 'operador' : 'operadores'}{textoBuscarOperador.trim() ? '' : ' (primeros 30)'}</div>
              {operadoresFiltradosBuscador.map((op: any) => (
                <div key={op.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFiltroOperador(op.nombre); setTextoBuscarOperador(''); setMostrarSugerenciasOperador(false); setSeleccionadas([]); }}
                  style={{ padding: '10px 12px', cursor: 'pointer', color: '#c9d1d9', fontSize: '0.88rem', borderBottom: '1px solid #21262d', transition: 'background-color 0.15s' }}
                  onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div style={{ fontWeight: '500' }}>{op.nombre}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 style={{ color: '#f0f6fc', fontSize: '1.5rem', marginBottom: '24px' }}>Referencias de Nómina</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Nóminas</button>
        <button onClick={() => setActiveTab('prestamos')} style={tabStyle(activeTab === 'prestamos')}>Préstamos</button>
        <button onClick={() => setActiveTab('ahorro')} style={tabStyle(activeTab === 'ahorro')}>Ahorro</button>
      </div>

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            {renderBuscadorOperador()}
            <div>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>FECHA INICIO (Opcional)</label>
              <input type="date" value={fechaInicio} onChange={e => {setFechaInicio(e.target.value); setSeleccionadas([]);}} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            </div>
            <div>
              <label style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>FECHA FIN (Opcional)</label>
              <input type="date" value={fechaFin} onChange={e => {setFechaFin(e.target.value); setSeleccionadas([]);}} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            </div>
            <button
              disabled={seleccionadas.length === 0 || filtroEstadoOps === 'asignadas'}
              onClick={abrirModalNomina}
              style={{ padding: '10px 20px', backgroundColor: (seleccionadas.length > 0 && filtroEstadoOps !== 'asignadas') ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && filtroEstadoOps !== 'asignadas') ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}
            >
              Generar Nómina ({seleccionadas.length})
            </button>
          </div>

          {filtrosCompletos && (
            <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => { setFiltroEstadoOps('pendientes'); }}
                  style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                    border: `1px solid ${filtroEstadoOps === 'pendientes' ? '#ef4444' : '#30363d'}`,
                    backgroundColor: filtroEstadoOps === 'pendientes' ? 'rgba(239,68,68,0.15)' : 'transparent',
                    color: filtroEstadoOps === 'pendientes' ? '#ef4444' : '#8b949e' }}>
                  ● Pendientes ({conteoOps.pendientes})
                </button>
                <button onClick={() => { setFiltroEstadoOps('asignadas'); setSeleccionadas([]); }}
                  style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                    border: `1px solid ${filtroEstadoOps === 'asignadas' ? '#10b981' : '#30363d'}`,
                    backgroundColor: filtroEstadoOps === 'asignadas' ? 'rgba(16,185,129,0.15)' : 'transparent',
                    color: filtroEstadoOps === 'asignadas' ? '#10b981' : '#8b949e' }}>
                  ● Asignadas ({conteoOps.asignadas})
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Ordenar:</span>
                <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={selectOrdenStyle}>
                  <option value="ref">Referencia</option>
                  <option value="fechaServicio">Fecha Servicio</option>
                  <option value="operador">Operador</option>
                  <option value="origen">Origen</option>
                  <option value="destino">Destino</option>
                  <option value="sueldo">Sueldo</option>
                </select>
                <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                  {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
              <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>
                {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'operación' : 'operaciones'}{(fechaInicio || fechaFin) ? ` · ${fechaInicio ? formatearFechaSpanish(fechaInicio) : '...'} al ${fechaFin ? formatearFechaSpanish(fechaFin) : '...'}` : ''}
              </span>
              <div style={{ display: 'flex', gap: '10px' }}>
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
            </>
          )}

          {seleccionadas.length > 0 && filtroEstadoOps === 'pendientes' && (
            <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '20px', marginBottom: '20px', animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', alignItems: 'center' }}>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operaciones Seleccionadas</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.8rem', fontWeight: 'bold' }}>{seleccionadas.length}</span>
                </div>
                <div style={{ borderRight: '1px solid #30363d' }}>
                  <span style={{ display: 'block', color: '#f59e0b', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Sueldo Extra (operaciones)</span>
                  <span style={{ color: '#f59e0b', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotalExtra)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#D84315', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Subtotal Sueldos a Pagar</span>
                  <span style={{ color: '#3fb950', fontSize: '1.8rem', fontWeight: 'bold' }}>{formatoMoneda(resumenSeleccion.subtotal)}</span>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.72rem', marginTop: '2px' }}>Incluye el sueldo extra de cada operación</span>
                </div>
              </div>
            </div>
          )}

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '50px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>
                    {filtroEstadoOps === 'pendientes' && operacionesMostradas.length > 0 && (
                      <input type="checkbox" checked={todasMostradasSeleccionadas} onChange={toggleSeleccionarTodo} title="Seleccionar todo" style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
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
                {!filtrosCompletos ? (
                  <tr><td colSpan={colsOpsVisibles} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Selecciona un operador para ver sus operaciones (las fechas son opcionales).</td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td colSpan={colsOpsVisibles} style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>
                    {filtroEstadoOps === 'pendientes' ? 'No hay operaciones pendientes para este operador.' : 'No hay operaciones asignadas a nómina para este operador.'}
                  </td></tr>
                ) : (
                  operacionesMostradas.map(op => {
                    const seleccionable = filtroEstadoOps === 'pendientes';
                    return (
                      <tr key={op.id} onClick={() => seleccionable && toggleSeleccion(op.id)}
                        style={{ cursor: seleccionable ? 'pointer' : 'default', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : 'transparent' }}>
                        <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {seleccionable ? (
                            <input type="checkbox" checked={seleccionadas.includes(op.id)} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                          ) : (
                            <span title={op.referenciaNominaConsecutivo || 'Asignada'} style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
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
        </div>

      ) : activeTab === 'historial' ? (
        <div className="animation-fade-in">
          <div style={{ position: 'relative', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
            <input type="text" placeholder="Buscar en historial (Consecutivo, Operador)..." value={busquedaHistorial} onChange={e => setBusquedaHistorial(e.target.value)} style={{ width: '100%', maxWidth: '400px', padding: '10px 16px', backgroundColor: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px' }} />
            <button title="Exportar a Excel" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <button onClick={() => setFiltroEstadoHist('pendientes')}
              style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                border: `1px solid ${filtroEstadoHist === 'pendientes' ? '#f59e0b' : '#30363d'}`,
                backgroundColor: filtroEstadoHist === 'pendientes' ? 'rgba(245,158,11,0.15)' : 'transparent',
                color: filtroEstadoHist === 'pendientes' ? '#f59e0b' : '#8b949e' }}>
              ● Pendientes ({conteoHist.pendientes})
            </button>
            <button onClick={() => setFiltroEstadoHist('pagadas')}
              style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem',
                border: `1px solid ${filtroEstadoHist === 'pagadas' ? '#10b981' : '#30363d'}`,
                backgroundColor: filtroEstadoHist === 'pagadas' ? 'rgba(16,185,129,0.15)' : 'transparent',
                color: filtroEstadoHist === 'pagadas' ? '#10b981' : '#8b949e' }}>
              ● Pagadas ({conteoHist.pagadas})
            </button>
          </div>

          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', backgroundColor: '#161b22' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>ACCIONES</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CONSECUTIVO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>STATUS</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>OPERADOR</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>FECHA PAGO</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>PERÍODO (SEMANA)</th>
                  <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>TOTAL A PAGAR</th>
                </tr>
              </thead>
              <tbody>
                {registrosVisibles.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                    {filtroEstadoHist === 'pendientes' ? 'No hay nóminas pendientes de pago.' : 'No hay nóminas pagadas.'}
                  </td></tr>
                ) : (
                  registrosVisibles.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #21262d' }}>
                      <td style={{ padding: '16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          {r.statusPagado ? (
                            <button title="Regresar a Pendiente" onClick={(e) => handleTogglePagoNomina(e, r)} style={{ background: 'transparent', border: '1px solid #f59e0b', borderRadius: '4px', color: '#f59e0b', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                            </button>
                          ) : (
                            <button title="Marcar como Pagada" onClick={(e) => handleTogglePagoNomina(e, r)} style={{ background: 'transparent', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </button>
                          )}
                          <button title="Ver Ficha" onClick={() => setNominaViendo(r)} style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button title="Recibo (PDF)" onClick={(e) => { e.stopPropagation(); generarReciboNomina(r); }} style={{ background: 'transparent', border: '1px solid #f37021', borderRadius: '4px', color: '#f37021', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                          </button>
                          <button title="Eliminar Nómina" onClick={(e) => handleEliminarNomina(e, r)} style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{getConsecutivoNomina(r)}</td>
                      <td style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                        <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold',
                          backgroundColor: r.statusPagado ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: r.statusPagado ? '#10b981' : '#f59e0b',
                          border: `1px solid ${r.statusPagado ? '#10b981' : '#f59e0b'}` }}>
                          {r.statusPagado ? 'PAGADA' : 'PENDIENTE'}
                        </span>
                      </td>
                      <td style={{ padding: '16px', color: '#f0f6fc', whiteSpace: 'nowrap' }}>{getNombreOperador(r.operadorNombre || r.operadorId)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(r.fechaPago)}</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(r.fechaInicio)} <br/>al {formatearFechaSpanish(r.fechaFin)}</td>
                      <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(calcularTotalAPagar(r))}</td>
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

      ) : activeTab === 'prestamos' ? (
        <div className="animation-fade-in">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            {renderBuscadorOperador()}
            {filtroOperador && (
              <button title="Exportar a Excel" onClick={exportarPrestamosCSV} style={{ padding: '10px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: '#1a7f37', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ⬇ Exportar Préstamos
              </button>
            )}
          </div>

          {!filtroOperador ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e', border: '1px solid #30363d', borderRadius: '8px', backgroundColor: '#161b22' }}>
              Selecciona un operador para ver su historial de préstamos.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Saldo Inicial (heredado)</span>
                  <span style={{ color: '#8b949e', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(datosPrestamo.inicial)}</span>
                </div>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Otorgado</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(resumenPrestamos.otorgado)}</span>
                </div>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Pagado</span>
                  <span style={{ color: '#3fb950', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(resumenPrestamos.pagado)}</span>
                </div>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #f59e0b', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#f59e0b', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Saldo Actual (deducciones)</span>
                  <span style={{ color: '#f59e0b', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(dPrestamoAcumulado)}</span>
                </div>
              </div>

              <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', backgroundColor: '#161b22' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>FECHA PAGO</th>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CONSECUTIVO</th>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>PRÉSTAMO OTORGADO</th>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>PAGO PRÉSTAMO</th>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>SALDO</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #21262d', backgroundColor: '#010409' }}>
                      <td style={{ padding: '16px', color: '#8b949e', fontStyle: 'italic', whiteSpace: 'nowrap' }}>Saldo inicial (heredado)</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>-</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>-</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>-</td>
                      <td style={{ padding: '16px', color: '#8b949e', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(datosPrestamo.inicial)}</td>
                    </tr>
                    {datosPrestamo.filas.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Este operador no tiene movimientos de préstamo en las nóminas registradas.</td></tr>
                    ) : (
                      datosPrestamo.filas.map(m => (
                        <tr key={m.id} style={{ borderBottom: '1px solid #21262d' }}>
                          <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(m.fecha)}</td>
                          <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{m.consecutivo}</td>
                          <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.agregado)}</td>
                          <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.pago)}</td>
                          <td style={{ padding: '16px', color: '#f59e0b', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.saldo)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

      ) : (
        <div className="animation-fade-in">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '20px', alignItems: 'flex-end', backgroundColor: '#0d1117', padding: '20px', borderRadius: '8px', border: '1px solid #30363d' }}>
            {renderBuscadorOperador()}
            {filtroOperador && (
              <button title="Exportar a Excel" onClick={exportarAhorroCSV} style={{ padding: '10px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', backgroundColor: '#1a7f37', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ⬇ Exportar Ahorro
              </button>
            )}
          </div>

          {!filtroOperador ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e', border: '1px solid #30363d', borderRadius: '8px', backgroundColor: '#161b22' }}>
              Selecciona un operador para ver su historial de ahorro.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Saldo Inicial (heredado)</span>
                  <span style={{ color: '#8b949e', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(datosAhorro.inicial)}</span>
                </div>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Ahorrado</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(datosAhorro.sumaAgregado)}</span>
                </div>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Pagado / Retirado</span>
                  <span style={{ color: '#3fb950', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(datosAhorro.sumaPago)}</span>
                </div>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #58a6ff', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#58a6ff', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Saldo Actual (deducciones)</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(dAhorroAcumulado)}</span>
                </div>
              </div>

              <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', backgroundColor: '#161b22' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', fontSize: '0.8rem', position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>FECHA PAGO</th>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>CONSECUTIVO</th>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>AHORRO AGREGADO</th>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>PAGO / RETIRO</th>
                      <th style={{ padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>SALDO</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #21262d', backgroundColor: '#010409' }}>
                      <td style={{ padding: '16px', color: '#8b949e', fontStyle: 'italic', whiteSpace: 'nowrap' }}>Saldo inicial (heredado)</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>-</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>-</td>
                      <td style={{ padding: '16px', color: '#8b949e', whiteSpace: 'nowrap' }}>-</td>
                      <td style={{ padding: '16px', color: '#8b949e', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(datosAhorro.inicial)}</td>
                    </tr>
                    {datosAhorro.filas.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Este operador no tiene movimientos de ahorro en las nóminas registradas.</td></tr>
                    ) : (
                      datosAhorro.filas.map(m => (
                        <tr key={m.id} style={{ borderBottom: '1px solid #21262d' }}>
                          <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(m.fecha)}</td>
                          <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{m.consecutivo}</td>
                          <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.agregado)}</td>
                          <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.pago)}</td>
                          <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(m.saldo)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* MODAL CONFIGURAR COLUMNAS */}
      {modalColumnasOps && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '720px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnasOps(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '20px' }}>Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel.</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {columnasOps.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStartOps(e, idx)} onDragEnter={() => handleDragEnterOps(idx)} onDragEnd={() => setDraggedColOpsIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColOpsIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={() => setModalColumnasOps(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* MINI MODAL: SUELDO EXTRA DE LA OPERACIÓN */}
      {editandoExtra && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100, padding: '20px', backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '420px', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.1rem' }}>Sueldo Extra · <span style={{ color: '#58a6ff', fontFamily: 'monospace' }}>{editandoExtra.ref}</span></h3>
              <button onClick={() => setEditandoExtra(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.82rem', marginTop: 0, marginBottom: '14px' }}>Se guarda directamente en la operación. Se sumará al sueldo de esta operación en la nómina.</p>
            <label style={{ color: '#f59e0b', fontSize: '0.72rem', display: 'block', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 'bold' }}>Monto del sueldo extra</label>
            <div style={{ position: 'relative', marginBottom: '20px' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e', fontWeight: 'bold' }}>$</span>
              <input type="number" step="0.01" autoFocus value={editandoExtra.valor} placeholder="0.00"
                onChange={e => setEditandoExtra(prev => prev ? { ...prev, valor: e.target.valueAsNumber || '' } : prev)}
                onKeyDown={e => { if (e.key === 'Enter') guardarExtraOperacion(); }}
                style={{ width: '100%', padding: '12px 12px 12px 26px', backgroundColor: '#161b22', color: '#3fb950', border: '1px solid #f59e0b', borderRadius: '6px', fontWeight: 'bold', fontSize: '1.2rem', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" onClick={() => setEditandoExtra(null)} disabled={guardandoExtra} style={{ padding: '9px 20px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
              <button type="button" onClick={guardarExtraOperacion} disabled={guardandoExtra} style={{ padding: '9px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardandoExtra ? 'Guardando...' : 'Guardar Extra'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO — MINI MODAL: SUELDO BASE DE LA OPERACIÓN */}
      {editandoSueldo && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100, padding: '20px', backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '420px', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.1rem' }}>Sueldo Base · <span style={{ color: '#58a6ff', fontFamily: 'monospace' }}>{editandoSueldo.ref}</span></h3>
              <button onClick={() => setEditandoSueldo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.82rem', marginTop: 0, marginBottom: '14px' }}>Se guarda directamente en la operación (campo Sueldo). Recalcula el Sueldo Total y los subtotales de la nómina.</p>
            <label style={{ color: '#3fb950', fontSize: '0.72rem', display: 'block', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 'bold' }}>Monto del sueldo base</label>
            <div style={{ position: 'relative', marginBottom: '20px' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e', fontWeight: 'bold' }}>$</span>
              <input type="number" step="0.01" autoFocus value={editandoSueldo.valor} placeholder="0.00"
                onChange={e => setEditandoSueldo(prev => prev ? { ...prev, valor: e.target.valueAsNumber || '' } : prev)}
                onKeyDown={e => { if (e.key === 'Enter') guardarSueldoOperacion(); }}
                style={{ width: '100%', padding: '12px 12px 12px 26px', backgroundColor: '#161b22', color: '#3fb950', border: '1px solid #3fb950', borderRadius: '6px', fontWeight: 'bold', fontSize: '1.2rem', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" onClick={() => setEditandoSueldo(null)} disabled={guardandoSueldo} style={{ padding: '9px 20px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
              <button type="button" onClick={guardarSueldoOperacion} disabled={guardandoSueldo} style={{ padding: '9px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardandoSueldo ? 'Guardando...' : 'Guardar Sueldo'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GENERAR NÓMINA */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '100%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid #30363d', paddingBottom: '16px' }}>
              <h2 style={{ color: '#f0f6fc', margin: 0 }}>Generar Nómina: <span style={{ color: '#D84315' }}>{consecutivoForm}</span></h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d', marginBottom: '16px' }}>
              <div>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Operador Seleccionado</span>
                <span style={{ color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 'bold' }}>{filtroOperador}</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Subtotal Referencias ({seleccionadas.length})</span>
                <span style={{ color: '#58a6ff', fontSize: '1.3rem', fontWeight: 'bold' }}>{formatoMoneda(subtotalReferencias)}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total a Pagar</span>
                <span style={{ color: '#3fb950', fontSize: '1.3rem', fontWeight: 'bold' }}>{formatoMoneda(totalAPagarCalc)}</span>
              </div>
            </div>

            {operadorIdSeleccionado && !deduccionOperador && (
              <div style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '0.82rem' }}>
                ⚠ No se encontró un registro en <b>deducciones</b> para este operador. Los valores se inician en cero (puedes capturarlos manualmente).
              </div>
            )}

            <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid #30363d', marginBottom: '24px', overflowX: 'auto' }}>
              {[
                { id: 'general', label: 'Información General' },
                { id: 'referencia', label: 'Referencia' },
                { id: 'deducciones', label: 'Deducciones' },
                { id: 'totales', label: 'Totales' },
              ].map(t => (
                <button key={t.id} type="button" onClick={() => setPestanaModalNomina(t.id as any)} style={tabModalStyle(pestanaModalNomina === t.id)}>
                  {t.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleGuardarNomina}>
              {pestanaModalNomina === 'general' && (
                <div style={gridTres}>
                  <div>
                    <label style={labelNomStyle}>Número de Referencia</label>
                    <input readOnly value={consecutivoForm} style={{ ...inputBaseStyle, color: '#D84315', fontFamily: 'monospace', fontWeight: 'bold' }} />
                  </div>
                  <div>
                    <label style={labelNomStyle}>Fecha Pago</label>
                    <input type="date" value={fechaPago} onChange={e => { setFechaPago(e.target.value); setConsecutivoForm(generarConsecutivo(e.target.value)); }} style={{ ...inputBaseStyle, color: '#fff' }} />
                  </div>
                  <div>
                    <label style={labelNomStyle}>Status Nómina</label>
                    <select value={statusPagado} onChange={e => setStatusPagado(e.target.value as any)} style={{ ...inputBaseStyle, color: statusPagado === 'Pagada' ? '#10b981' : '#f0f6fc', backgroundColor: statusPagado === 'Pagada' ? 'rgba(16, 185, 129, 0.1)' : '#161b22', fontWeight: 'bold' }}>
                      <option value="Pendiente">Pendiente</option>
                      <option value="Pagada">Pagada ✔</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelNomStyle}>Operador</label>
                    <input readOnly value={filtroOperador} style={{ ...inputBaseStyle, color: '#c9d1d9' }} />
                  </div>
                  {campoTotal('Nómina Fiscal', dNominaFiscal, '#c9d1d9')}
                </div>
              )}

              {pestanaModalNomina === 'referencia' && (
                <>
                  <div style={gridTres}>
                    {campoTotal('Subtotal a Referencias', subtotalReferencias, '#58a6ff')}
                    {campoNumerico('Extra', extras, setExtras)}
                    {campoTotal('Subtotal a Pagar', subtotalAPagarCalc, '#3fb950')}
                    {campoTotal('Diferencia Aplicable', diferenciaAplicableCalc, '#58a6ff')}
                  </div>

                  {/* ✅ NUEVO: referencias (operaciones) que se están pagando en esta nómina */}
                  <div style={{ marginTop: '20px' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '10px' }}>
                      Referencias en esta nómina ({detalleSeleccionadas.length})
                    </span>
                    <div style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', maxHeight: '300px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ backgroundColor: '#1f2937', color: '#8b949e', position: 'sticky', top: 0 }}>
                          <tr>
                            <th style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' }}>REFERENCIA</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' }}>FECHA</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>SUELDO</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>EXTRA</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>SUELDO TOTAL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detalleSeleccionadas.length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#8b949e' }}>No hay referencias seleccionadas.</td></tr>
                          ) : (
                            detalleSeleccionadas.map(d => (
                              <tr key={d.id} style={{ borderTop: '1px solid #21262d' }}>
                                <td style={{ padding: '10px 12px', color: '#58a6ff', fontFamily: 'monospace', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{d.ref}</td>
                                <td style={{ padding: '10px 12px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{d.fecha ? formatearFechaSpanish(d.fecha) : '-'}</td>
                                <td style={{ padding: '10px 12px', color: '#3fb950', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatoMoneda(d.sueldo)}</td>
                                <td style={{ padding: '10px 12px', color: '#f59e0b', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatoMoneda(d.extra)}</td>
                                <td style={{ padding: '10px 12px', color: '#58a6ff', fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoMoneda(d.total)}</td>
                              </tr>
                            ))
                          )}
                          {detalleSeleccionadas.length > 0 && (
                            <tr style={{ borderTop: '2px solid #30363d', backgroundColor: '#010409' }}>
                              <td colSpan={4} style={{ padding: '10px 12px', color: '#8b949e', fontWeight: 'bold', textAlign: 'right', textTransform: 'uppercase' }}>Subtotal a Referencias</td>
                              <td style={{ padding: '10px 12px', color: '#3fb950', fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoMoneda(subtotalReferencias)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {pestanaModalNomina === 'deducciones' && (
                <div style={gridTres}>
                  {campoNumerico('Infonavit', infonavit, setInfonavit)}
                  {campoNumerico('Fonacot', fonacot, setFonacot)}
                  {campoNumerico('IMSS', imss, setImss)}
                  {campoNumerico('ISR (factor)', isr, setIsr, '0.0001')}
                  {campoTotal('ISR Monto', isrMontoCalc, '#f85149')}
                  <div></div>

                  {campoNumerico('Préstamo (esta nómina)', prestamoNuevo, setPrestamoNuevo)}
                  {campoTotal('Préstamo Acumulado', prestamoAcumuladoTotal, '#c9d1d9')}
                  <div></div>
                  {campoNumerico('Pago Préstamo', pagoPrestamo, setPagoPrestamo)}
                  {campoTotal('Saldo del Préstamo', saldoPrestamoCalc, '#f59e0b')}
                  <div></div>
                  <div style={{ gridColumn: 'span 3', color: '#8b949e', fontSize: '0.78rem', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '10px 14px' }}>
                    Saldo inicial heredado <b style={{ color: '#c9d1d9' }}>{formatoMoneda(dPrestamoAcumulado)}</b>
                    {' + esta nómina '}<b style={{ color: '#58a6ff' }}>{formatoMoneda(Number(prestamoNuevo) || 0)}</b>
                    {' − pago '}<b style={{ color: '#3fb950' }}>{formatoMoneda(Number(pagoPrestamo) || 0)}</b>
                    {' = saldo '}<b style={{ color: '#f59e0b' }}>{formatoMoneda(saldoPrestamoCalc)}</b>
                  </div>

                  {/* ✅ NUEVO: ahorro con la misma lógica que el préstamo */}
                  {campoNumerico('Ahorro (esta nómina)', ahorroNuevo, setAhorroNuevo)}
                  {campoTotal('Ahorro Acumulado', ahorroAcumuladoTotal, '#c9d1d9')}
                  <div></div>
                  {campoNumerico('Pago / Retiro de Ahorro', pagoAhorro, setPagoAhorro)}
                  {campoTotal('Saldo del Ahorro', saldoAhorroCalc, '#58a6ff')}
                  <div></div>
                  <div style={{ gridColumn: 'span 3', color: '#8b949e', fontSize: '0.78rem', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '10px 14px' }}>
                    Saldo inicial heredado <b style={{ color: '#c9d1d9' }}>{formatoMoneda(dAhorroAcumulado)}</b>
                    {' + ahorro de esta nómina '}<b style={{ color: '#58a6ff' }}>{formatoMoneda(Number(ahorroNuevo) || 0)}</b>
                    {' − pago/retiro '}<b style={{ color: '#3fb950' }}>{formatoMoneda(Number(pagoAhorro) || 0)}</b>
                    {' = saldo '}<b style={{ color: '#58a6ff' }}>{formatoMoneda(saldoAhorroCalc)}</b>
                  </div>
                </div>
              )}

              {pestanaModalNomina === 'totales' && (
                <>
                  <div style={{ ...gridTres, marginBottom: '20px' }}>
                    {campoTotal('Total Deducciones', totalDeduccionesCalc, '#f85149')}
                    {campoTotal('Total', totalNetoCalc, '#58a6ff')}
                    {campoNumerico('Depósito de Gastos', depositoGastos, setDepositoGastos)}
                    {campoNumerico('Otros Depósitos', otrosDepositos, setOtrosDepositos)}
                    {campoTotal('Total a Pagar', totalAPagarCalc, '#3fb950', true)}
                  </div>
                  <div style={{ ...gridTres, marginBottom: '20px' }}>
                    <div>
                      <label style={labelNomStyle}>Forma de Pago</label>
                      <select value={formaPagoSeleccionada} onChange={e => setFormaPagoSeleccionada(e.target.value)} style={{ ...inputBaseStyle, color: '#fff' }}>
                        <option value="">Seleccionar...</option>
                        {formasPagoList.map(f => <option key={f.id} value={f.id}>{f.forma_pago}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelNomStyle}>Banco</label>
                      <select value={bancoSeleccionado} onChange={e => setBancoSeleccionado(e.target.value)} style={{ ...inputBaseStyle, color: '#fff' }}>
                        <option value="">Seleccionar...</option>
                        {bancosList.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={labelNomStyle}>Notas / Observaciones</label>
                    <textarea value={notaDepositos} onChange={e => setNotaDepositos(e.target.value)} style={{ ...inputBaseStyle, color: '#fff', height: '60px' }} />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '20px', marginTop: '24px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} disabled={guardando} style={{ padding: '8px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : 'Confirmar Nómina'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FICHA NÓMINA */}
      {nominaViendo && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '900px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Ficha de Nómina</h2>
              <button onClick={() => setNominaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'space-between', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', alignItems: 'center' }}>
                  <div>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Consecutivo</span>
                    <span style={{ color: '#D84315', fontSize: '1.2rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{getConsecutivoNomina(nominaViendo)}</span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Status</span>
                    <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 'bold',
                        backgroundColor: nominaViendo.statusPagado ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                        color: nominaViendo.statusPagado ? '#10b981' : '#f59e0b',
                        border: `1px solid ${nominaViendo.statusPagado ? '#10b981' : '#f59e0b'}` }}>
                        {nominaViendo.statusPagado ? 'PAGADA' : 'PENDIENTE'}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Fecha de Pago</span>
                    <span style={{ color: '#c9d1d9', fontSize: '1rem', fontWeight: 'bold' }}>{formatearFechaSpanish(nominaViendo.fechaPago)}</span>
                  </div>
                </div>

                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Operador</span>
                  <span style={{ color: '#f0f6fc', fontSize: '1rem', fontWeight: 'bold' }}>{getNombreOperador(nominaViendo.operadorNombre || nominaViendo.operadorId)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Período Reportado</span>
                  <span style={{ color: '#c9d1d9', fontSize: '0.9rem' }}>{formatearFechaSpanish(nominaViendo.fechaInicio)} al {formatearFechaSpanish(nominaViendo.fechaFin)}</span>
                </div>
                <div>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Método</span>
                  <span style={{ color: '#c9d1d9', fontSize: '0.9rem' }}>{nominaViendo.bancoPagoNombre} ({nominaViendo.formaPagoNombre})</span>
                </div>

                <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px dashed #30363d' }}>
                  {[
                    {lbl: 'SUBTOTAL REFERENCIAS', val: subtotalReferenciasFicha},
                    {lbl: 'EXTRA', val: nominaViendo.extras},
                    {lbl: 'SUBTOTAL A PAGAR', val: fichaTotales.subAPagar},
                    {lbl: 'NÓMINA FISCAL', val: nominaViendo.nominaFiscal ?? nominaViendo.nomina},
                    {lbl: 'DIFERENCIA APLICABLE', val: nominaViendo.diferenciaAplicable},
                    {lbl: 'INFONAVIT', val: nominaViendo.infonavit},
                    {lbl: 'FONACOT', val: nominaViendo.fonacot},
                    {lbl: 'IMSS', val: nominaViendo.imss},
                    {lbl: 'ISR MONTO', val: nominaViendo.isrMonto},
                    {lbl: 'TOTAL DEDUCCIONES', val: fichaTotales.totalDed},
                    {lbl: 'PRÉSTAMO OTORGADO', val: nominaViendo.prestamoOtorgado},
                    {lbl: 'PAGO PRÉSTAMO', val: nominaViendo.pagoPrestamo},
                    {lbl: 'SALDO PRÉSTAMO', val: nominaViendo.saldoPrestamo},
                    {lbl: 'AHORRO', val: nominaViendo.ahorro},
                    {lbl: 'PAGO AHORRO', val: nominaViendo.pagoAhorro},
                    {lbl: 'AHORRO ACUM.', val: nominaViendo.ahorroAcumulado},
                    {lbl: 'TOTAL', val: fichaTotales.neto},
                    {lbl: 'DEP. GASTOS', val: nominaViendo.depositoGastos},
                    {lbl: 'OTROS DEPÓSITOS', val: nominaViendo.otrosDepositos},
                    {lbl: 'TOTAL A PAGAR', val: fichaTotales.totalAPagar},
                  ].map((it, idx) => (
                    <div key={idx}>
                      <span style={{ display: 'block', color: '#8b949e', fontSize: '0.65rem', fontWeight: 'bold', textTransform: 'uppercase' }}>{it.lbl}</span>
                      <span style={{ color: it.lbl === 'TOTAL A PAGAR' ? '#3fb950' : (it.lbl === 'TOTAL DEDUCCIONES' || it.lbl === 'ISR MONTO') ? '#f85149' : '#58a6ff', fontSize: '0.95rem', fontWeight: 'bold' }}>{formatoMoneda(it.val)}</span>
                    </div>
                  ))}
                  {nominaViendo.ahorroPagado && (
                    <div style={{ gridColumn: 'span 5', color: '#3fb950', fontSize: '0.8rem', fontWeight: 'bold' }}>✔ En esta nómina se registró un pago/retiro de ahorro al operador.</div>
                  )}
                </div>

                <div style={{ gridColumn: 'span 3' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Notas / Observaciones</span>
                  <div style={{ color: '#c9d1d9', backgroundColor: '#161b22', padding: '12px', borderRadius: '6px', border: '1px solid #30363d', minHeight: '40px' }}>
                    {nominaViendo.notaDepositos || '-'}
                  </div>
                </div>

                <div style={{ gridColumn: 'span 3', marginTop: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Operaciones (Referencias) Pagadas en esta Nómina ({opsFicha.length})
                  </span>

                  {cargandoOpsFicha ? (
                    <div style={{ color: '#8b949e', fontSize: '0.85rem', padding: '12px' }}>Buscando las referencias ligadas a esta nómina...</div>
                  ) : opsFicha.length === 0 ? (
                    <div style={{ color: '#8b949e', fontSize: '0.85rem', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '12px' }}>
                      No hay detalle de operaciones ligado a esta nómina. Las nóminas generadas desde la app guardan el detalle automáticamente; las nóminas importadas necesitan el vínculo con sus operaciones (ver nota).
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ backgroundColor: '#1f2937', color: '#8b949e' }}>
                          <tr>
                            <th style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' }}>REFERENCIA</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' }}>FECHA</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left' }}>CLIENTE</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>SUELDO</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>SUELDO EXTRA</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>SUELDO TOTAL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {opsFicha.map((op: any) => {
                            const sueldoOp = aNum(op.sueldo ?? op.importe ?? op.sueldoTotal);
                            const extraOp = aNum(op.sueldoExtra);
                            const tieneExtra = extraOp > 0;
                            return (
                              <tr key={op.id} style={{ borderTop: '1px solid #21262d' }}>
                                <td style={{ padding: '10px 12px', color: '#58a6ff', fontFamily: 'monospace', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{op.ref}</td>
                                <td style={{ padding: '10px 12px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.fecha ? formatearFechaSpanish(op.fecha) : '-'}</td>
                                <td style={{ padding: '10px 12px', color: '#c9d1d9' }}>{op.cliente || getNombreEmpresa(op.clientePagaId) || '-'}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  <button type="button" onClick={(e) => abrirEditorSueldo(e, op)} title="Editar sueldo base de esta operación"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem',
                                      backgroundColor: 'rgba(63,185,80,0.12)',
                                      border: '1px solid #3fb950',
                                      color: '#3fb950' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                    {formatoMoneda(sueldoOp)}
                                  </button>
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  <button type="button" onClick={(e) => abrirEditorExtra(e, op)} title="Editar sueldo extra de esta operación"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem',
                                      backgroundColor: tieneExtra ? 'rgba(245,158,11,0.12)' : 'transparent',
                                      border: `1px solid ${tieneExtra ? '#f59e0b' : '#30363d'}`,
                                      color: tieneExtra ? '#f59e0b' : '#8b949e' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                    {tieneExtra ? formatoMoneda(extraOp) : 'Agregar'}
                                  </button>
                                </td>
                                <td style={{ padding: '10px 12px', color: '#58a6ff', fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoMoneda(sueldoOp + extraOp)}</td>
                              </tr>
                            );
                          })}
                          <tr style={{ borderTop: '2px solid #30363d', backgroundColor: '#010409' }}>
                            <td colSpan={3} style={{ padding: '10px 12px', color: '#8b949e', fontWeight: 'bold', textAlign: 'right', textTransform: 'uppercase' }}>Subtotales</td>
                            <td style={{ padding: '10px 12px', color: '#3fb950', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatoMoneda(subtotalesFicha.sueldo)}</td>
                            <td style={{ padding: '10px 12px', color: '#f59e0b', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>{formatoMoneda(subtotalesFicha.extra)}</td>
                            <td style={{ padding: '10px 12px', color: '#58a6ff', fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoMoneda(subtotalesFicha.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
              <button onClick={() => generarReciboNomina(nominaViendo)} style={{ padding: '8px 24px', borderRadius: '6px', color: '#fff', border: 'none', background: '#f37021', cursor: 'pointer', fontWeight: 'bold' }}>Descargar Recibo (PDF)</button>
              <button onClick={() => setNominaViendo(null)} className="btn btn-outline" style={{ padding: '8px 24px', borderRadius: '6px', color: '#c9d1d9', border: '1px solid #30363d', background: 'transparent', cursor: 'pointer' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
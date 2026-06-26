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
// ✅ NUEVO: el recibo de nómina ahora se genera como los demás documentos (html2pdf)
import html2pdf from 'html2pdf.js';
import { useEmpresaConfig } from '../../configuracion/useEmpresaConfig';
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';

// Cargo que identifica a un "Operador" dentro de la colección empleados.
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
  // ✅ NUEVO: configuración de empresa (para el logo del recibo)
  const { config: empresaConfig } = useEmpresaConfig();

  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial' | 'prestamos'>('historial');

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [nominasGlobales, setNominasGlobales] = useState<any[]>([]);

  // Catálogos
  const [operadoresList, setOperadoresList] = useState<any[]>([]);
  const [formasPagoList, setFormasPagoList] = useState<any[]>([]);
  const [bancosList, setBancosList] = useState<any[]>([]);
  const [deduccionesList, setDeduccionesList] = useState<any[]>([]);
  // ✅ NUEVO: catálogo de empresas (clientePaga -> empresas/{id}.nombre)
  const [empresasList, setEmpresasList] = useState<any[]>([]);
  // ✅ NUEVO: catálogo de convenios (operación.convenio -> nombre del convenio)
  const [conveniosList, setConveniosList] = useState<any[]>([]);

  // Filtros Pestaña 1 / Préstamos
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
  // ✅ NUEVO: detalle de operaciones (referencias) pagadas en la nómina abierta.
  const [opsFicha, setOpsFicha] = useState<any[]>([]);
  const [cargandoOpsFicha, setCargandoOpsFicha] = useState(false);
  const [pestanaModalNomina, setPestanaModalNomina] = useState<'general' | 'referencia' | 'deducciones' | 'totales'>('general');

  // Cabecera del formulario
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().split('T')[0]);
  const [formaPagoSeleccionada, setFormaPagoSeleccionada] = useState('');
  const [bancoSeleccionado, setBancoSeleccionado] = useState('');
  const [statusPagado, setStatusPagado] = useState<'Pendiente' | 'Pagada'>('Pendiente');
  const [consecutivoForm, setConsecutivoForm] = useState('');
  const [notaDepositos, setNotaDepositos] = useState('');

  // EDITABLES (deducciones se precargan de la colección pero se pueden modificar)
  const [extras, setExtras] = useState<number | ''>('');
  const [infonavit, setInfonavit] = useState<number | ''>('');
  const [fonacot, setFonacot] = useState<number | ''>('');
  const [imss, setImss] = useState<number | ''>('');
  const [isr, setIsr] = useState<number | ''>('');                 // factor (ej. 0.075)
  const [prestamoNuevo, setPrestamoNuevo] = useState<number | ''>(''); // préstamo otorgado en esta nómina
  const [pagoPrestamo, setPagoPrestamo] = useState<number | ''>('');
  const [depositoGastos, setDepositoGastos] = useState<number | ''>('');
  const [otrosDepositos, setOtrosDepositos] = useState<number | ''>('');
  const [pagarAhorro, setPagarAhorro] = useState(false);

  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Helper numérico seguro.
  const aNum = (v: any) => Number(v) || 0;

  // ✅ Total a Pagar efectivo de una nómina (para la tabla del Historial y la Ficha).
  //   Si el documento ya trae totalAPagar > 0, se usa tal cual. Si viene en 0
  //   (nóminas importadas), se reconstruye:
  //     Subtotal a Pagar − Total Deducciones + Depósitos (gastos + otros).
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

  // ✅ Ordena las operaciones de la ficha de la MÁS RECIENTE a la MÁS ANTIGUA
  //   (por fecha; empate por referencia descendente).
  const ordenarOpsRecientes = (arr: any[]) =>
    [...arr].sort((a, b) => {
      const fa = String(a.fecha || '');
      const fb = String(b.fecha || '');
      if (fb !== fa) return fb.localeCompare(fa);
      return String(b.ref || '').localeCompare(String(a.ref || ''));
    });

  // operacionesIds puede venir como ARREGLO o como STRING separado por comas.
  const parsearIdsNomina = (val: any): string[] => {
    if (Array.isArray(val)) return val.map((x: any) => String(x).trim()).filter(Boolean);
    if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  // Normaliza una operación a la forma que usan la Ficha y el Recibo.
  const mapearOpDetalle = (op: any) => {
    // ✅ Importe = sueldoTotal de la operación (estrictamente). Solo si sueldoTotal
    //   NO existe (null/undefined/''), se respalda con sueldoOperador.
    const sueldoTotal = (op.sueldoTotal != null && op.sueldoTotal !== '')
      ? aNum(op.sueldoTotal)
      : aNum(op.sueldoOperador);
    return {
      id: op.id,
      ref: op.ref || op.id?.substring(0, 6),
      fecha: op.fechaServicio || op.fecha || '',
      clientePagaId: op.clientePaga || op.cliente || '',
      cliente: getNombreEmpresa(op.clientePaga) || op.clienteNombre || op.clientePagaNombre || op.nombreCliente || '',
      // ✅ Nombre del convenio (se resuelve por catálogo si viene un ID).
      convenio: getNombreConvenio(op.convenioId || op.convenio) || op.convenioNombre || (typeof op.convenio === 'string' ? op.convenio : '') || '-',
      tipoServicio: op.tarifaLabel || op.tarifarioLabel || op.convenioNombre || op.tipoOperacionNombre || op.tipoServicio || '-',
      sueldo: sueldoTotal,
      sueldoExtra: Number(op.sueldoExtra || 0),
      // El importe que suma para el Subtotal Referencias es el sueldoTotal.
      importe: sueldoTotal,
    };
  };

  // ✅ Carga TODAS las operaciones (referencias) ligadas a una nómina.
  //   Combina TODAS las fuentes y deduplica, para no perder ninguna referencia:
  //     1) operacionesGuardadas (si la nómina ya trae el detalle, se usa directo)
  //     2) operaciones con referenciaNominaId === nómina.id
  //     3) operaciones con referenciaNominaConsecutivo === consecutivo
  //     4) operacionesIds (arreglo o string), buscadas por su ID en bloques de 10
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
    // SIEMPRE se combinan los operacionesIds (no solo cuando lo anterior viene vacío),
    // así no se pierden referencias cuando el vínculo está parcial.
    const idsNomina = parsearIdsNomina(nom.operacionesIds);
    for (let i = 0; i < idsNomina.length; i += 10) {
      const bloque = idsNomina.slice(i, i + 10);
      if (bloque.length) agregar(await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', bloque))));
    }

    return ordenarOpsRecientes(encontradas.map(mapearOpDetalle));
  };

  // ✅ Reconstruye los totales de una nómina (las importadas vienen con
  //   subtotalPagar/totalDeducciones/total/totalAPagar en 0). Si hay operaciones
  //   cargadas, el Subtotal Referencias = suma del sueldoTotal de esas operaciones.
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
    // ✅ CORREGIDO: NO usar orderBy('createdAt') en la query. Firestore EXCLUYE
    //   los documentos que NO tienen ese campo, por lo que las nóminas viejas o
    //   cargadas sin "createdAt" no aparecían (la lista salía vacía). Ahora se
    //   trae sin orderBy y se ordena en memoria: por createdAt (desc) y, si
    //   falta, por fechaPago como respaldo.
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
    // ✅ NUEVO: empleados SIEMPRE (no solo en Asignar/Préstamos), para poder
    //   resolver el NOMBRE del operador en el Historial y en la Ficha de Nómina.
    const unSubEmpleados = onSnapshot(collection(db, 'empleados'), (snap) => {
      setOperadoresList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    // ✅ NUEVO: empresas SIEMPRE, para resolver el nombre del cliente (clientePaga)
    //   en la Ficha de Nómina (columna Cliente del detalle de referencias).
    const unSubEmpresas = onSnapshot(collection(db, 'empresas'), (snap) => {
      setEmpresasList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    // ✅ NUEVO: convenios SIEMPRE, para mostrar el NOMBRE del convenio en la factura.
    const unSubConvenios = onSnapshot(collection(db, 'catalogo_convenios'), (snap) => {
      setConveniosList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    }, (err) => console.warn('[Nómina] No se pudo leer catalogo_convenios:', err));
    return () => { unSubNominas(); unSubEmpleados(); unSubEmpresas(); unSubConvenios(); };
  }, []);

  useEffect(() => {
    if (activeTab !== 'operaciones' && activeTab !== 'prestamos') return;

    const subs: Array<() => void> = [];

    // Deducciones se necesitan en ambas pestañas (operaciones y préstamos).
    // (empleados ya se suscribe al montar para todas las pestañas)
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
      // (empresas ya se suscribe al montar, para todas las pestañas)
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
  // ✅ NUEVO: resuelve el nombre del cliente que paga desde la colección empresas.
  const getNombreEmpresa = (id: string) => {
    if (!id) return '';
    return empresasList.find(e => e.id === id)?.nombre || '';
  };

  // ✅ NUEVO: resuelve el NOMBRE del convenio desde catalogo_convenios.
  //   Acepta el ID (lo busca en el catálogo) y prueba varios nombres de campo.
  const getNombreConvenio = (idOrName: string) => {
    if (!idOrName) return '';
    const c = conveniosList.find(x => x.id === idOrName);
    if (c) return c.nombre || c.convenio || c.nombreConvenio || c.descripcion || c.name || '';
    return '';
  };

  // ✅ NUEVO: consecutivo "real" de la nómina. Las nóminas importadas quedaron
  //   con el mismo valor en `consecutivo`; si el consecutivo correcto se guardó
  //   en otro campo durante la importación, se toma de ahí. Se prueban varios
  //   nombres de campo comunes y, si ninguno aplica, se usa `consecutivo`.
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
      setEditandoExtra(null);
    } catch (error) {
      console.error('Error al guardar el sueldo extra:', error);
      alert('No se pudo guardar el sueldo extra de la operación.');
    } finally {
      setGuardandoExtra(false);
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

  // ── Deducciones del operador (empleadoId === operadorId) ──
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
  const dIsr              = Number(deduccionOperador?.ISR ?? deduccionOperador?.isr ?? 0);   // factor (ej. 0.075)
  const dPrestamoAcumulado = Number(deduccionOperador?.prestamo ?? deduccionOperador?.prestamoAcumulado ?? 0); // saldo acumulado actual
  const dAhorroMonto      = Number(deduccionOperador?.ahorro || 0);
  const dAhorroAcumulado  = Number(deduccionOperador?.ahorroAcumulado || 0);

  // ── Totales calculados ──
  const subtotalReferencias     = resumenSeleccion.subtotal;
  const subtotalAPagarCalc      = subtotalReferencias + (Number(extras) || 0);
  const diferenciaAplicableCalc = subtotalAPagarCalc - dNominaFiscal;
  const isrMontoCalc            = (Number(isr) || 0) * subtotalAPagarCalc;
  // Préstamo acumulado tras sumar el préstamo otorgado en esta nómina
  const prestamoAcumuladoTotal  = dPrestamoAcumulado + (Number(prestamoNuevo) || 0);
  const saldoPrestamoCalc       = prestamoAcumuladoTotal - (Number(pagoPrestamo) || 0);
  const totalDeduccionesCalc    = (Number(infonavit) || 0) + (Number(imss) || 0) + isrMontoCalc + (Number(fonacot) || 0);
  const totalNetoCalc           = subtotalAPagarCalc - totalDeduccionesCalc;
  const ahorroAcumuladoNuevo    = pagarAhorro ? 0 : (dAhorroAcumulado + dAhorroMonto);
  const totalAPagarCalc         = totalNetoCalc + (Number(depositoGastos) || 0) + (Number(otrosDepositos) || 0);

  const abrirModalNomina = () => {
    setConsecutivoForm(generarConsecutivo(fechaPago));
    setPestanaModalNomina('general');
    // Precarga editable desde la colección deducciones
    setInfonavit(dInfonavit || '');
    setFonacot(dFonacot || '');
    setImss(dImss || '');
    setIsr(dIsr || '');
    setPrestamoNuevo('');
    setPagoPrestamo('');
    setExtras('');
    setDepositoGastos('');
    setOtrosDepositos('');
    setPagarAhorro(false);
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
          // ✅ Importe = sueldoTotal (el sueldo extra va aparte en sueldoExtra).
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

        // Préstamo: otorgado en esta nómina, acumulado previo, pago y saldo resultante
        prestamoOtorgado: Number(prestamoNuevo),
        prestamoAcumuladoPrevio: dPrestamoAcumulado,
        prestamoAcumulado: prestamoAcumuladoTotal,
        pagoPrestamo: Number(pagoPrestamo),
        saldoPrestamo: saldoPrestamoCalc,

        ahorro: dAhorroMonto,
        ahorroPagado: pagarAhorro,
        ahorroAcumulado: ahorroAcumuladoNuevo,

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

      // Actualiza la colección deducciones: nuevo saldo de préstamo y ahorro acumulado.
      if (deduccionOperador?.id) {
        batch.update(doc(db, 'deducciones', deduccionOperador.id), {
          prestamo: saldoPrestamoCalc,
          ahorroAcumulado: ahorroAcumuladoNuevo,
        });
      }

      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', id), { referenciaNominaId: nuevoId, referenciaNominaConsecutivo: consecutivoFinal });
      });

      await batch.commit();
      // Recibo de nómina (PDF vía impresión del navegador)
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
    setPagarAhorro(false);
    setNotaDepositos(''); setFormaPagoSeleccionada(''); setBancoSeleccionado(''); setStatusPagado('Pendiente');
    setPestanaModalNomina('general');
  };

  // ── Recibo de Nómina (PDF) generado desde React vía impresión del navegador ──
  const generarReciboNomina = async (nom: any) => {
    const m = (v: any) => '$' + (Number(v) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // ✅ Carga las operaciones reales (igual que la Ficha) para que el recibo
    //   muestre el detalle aunque la nómina venga importada sin operacionesGuardadas.
    let trips: any[] = [];
    try {
      trips = await cargarOperacionesDeNomina(nom);
    } catch (e) {
      console.error('[Recibo] No se pudieron cargar las operaciones:', e);
      trips = Array.isArray(nom.operacionesGuardadas) ? nom.operacionesGuardadas : [];
    }
    // ✅ Totales reconstruidos (las importadas traen 0 en varios campos).
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

    // ✅ Logo: usa el de la config si está en base64; si no, el logo incrustado por defecto.
    const logoSrc = (empresaConfig?.logoBase64 && empresaConfig.logoBase64.startsWith('data:'))
      ? empresaConfig.logoBase64
      : LOGO_DEFAULT;

    // HTML del recibo. Estilos scopeados a #recibo-nomina-root para no afectar
    // la página mientras el elemento temporal está montado en el DOM.
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
        <div class="row"><span>Abono a Préstamo</span><span>${m(nom.pagoPrestamo)}</span></div>
        <div class="row total-row"><span>Total Deducciones</span><span>${m(tot.totalDed)}</span></div>
      </div>
      <div class="card">
        <h3>Saldos Informativos</h3>
        <div class="row"><span>Ahorro Acumulado</span><span>${m(nom.ahorroAcumulado)}</span></div>
        <div class="row"><span>Saldo de Préstamo</span><span>${m(nom.saldoPrestamo)}</span></div>
        <div class="row"><span>Banco</span><span>${esc(nom.bancoPagoNombre || '-')}</span></div>
        <div class="row"><span>Forma de Pago</span><span>${esc(nom.formaPagoNombre || '-')}</span></div>
        ${nom.ahorroPagado ? '<div class="row total-row"><span>Ahorro pagado</span><span>SÍ</span></div>' : ''}
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

    // Igual que los 5 documentos de Operaciones: div temporal + html2pdf().save()
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

    // Esperar a que el logo (y cualquier imagen) terminen de decodificar antes de
    // "fotografiar" el HTML; si no, html2canvas omitiría el logo.
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

  // ✅ Orden pedido: por FECHA DE PAGO (más reciente → más antigua) y, como
  //   segundo criterio, por la REFERENCIA/consecutivo (descendente, numérico).
  const historialFiltrado = useMemo(() => {
    const lista = historialBusqueda.filter(n => filtroEstadoHist === 'pagadas' ? !!n.statusPagado : !n.statusPagado);
    return [...lista].sort((a, b) => {
      const fa = String(a.fechaPago || a.createdAt || '');
      const fb = String(b.fechaPago || b.createdAt || '');
      if (fb !== fa) return fb.localeCompare(fa); // fecha de pago desc
      // Empate por fecha: por referencia descendente (numérico-aware).
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

  // ✅ Al abrir la Ficha, carga el detalle de operaciones (referencias) con la
  //   función compartida (combina todas las fuentes y deduplica).
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

  // ✅ Subtotal de las referencias mostradas en la Ficha (suma del sueldoTotal
  //   de las operaciones cargadas; con respaldos si no hay detalle).
  const subtotalReferenciasFicha = useMemo(
    () => reconstruirTotales(nominaViendo, opsFicha).subRef,
    [nominaViendo, opsFicha]
  );

  // ✅ Totales reconstruidos para la cuadrícula de la Ficha.
  const fichaTotales = useMemo(
    () => reconstruirTotales(nominaViendo, opsFicha),
    [nominaViendo, opsFicha]
  );

  // Marcar una nómina como Pagada / Pendiente
  const handleTogglePagoNomina = async (e: React.MouseEvent, nom: any) => {
    e.stopPropagation();
    const nuevoPagado = !nom.statusPagado;
    const accion = nuevoPagado ? 'marcar como PAGADA' : 'regresar a PENDIENTE';
    if (!window.confirm(`¿Deseas ${accion} la nómina ${nom.consecutivo}?`)) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'referencias_nomina', nom.id), { statusPagado: nuevoPagado });
      await batch.commit();
      // onSnapshot refrescará la lista; actualizamos localmente por si acaso
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

  // ── Historial de PRÉSTAMOS por operador (derivado de las nóminas) ──
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

  const exportarPrestamosCSV = () => {
    if (historialPrestamos.length === 0) return alert("No hay movimientos de préstamo para este operador.");
    const datos = historialPrestamos.map(n => ({
      'Fecha Pago': formatearFechaSpanish(n.fechaPago),
      'Consecutivo': getConsecutivoNomina(n),
      'Préstamo Otorgado': Number(n.prestamoOtorgado || 0),
      'Pago Préstamo': Number(n.pagoPrestamo || 0),
      'Saldo': Number(n.saldoPrestamo ?? n.prestamo ?? 0),
    }));
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Prestamos');
    const ope = (filtroOperador || 'operador').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);
    XLSX.writeFile(wb, `Prestamos_${ope}_${new Date().toISOString().split('T')[0]}.xlsx`);
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

  // Buscador de operador reutilizable (Asignar Operaciones / Préstamos)
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

      ) : (
        /* ════════════════════ PRÉSTAMOS (HISTÓRICO POR OPERADOR) ════════════════════ */
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Otorgado (histórico)</span>
                  <span style={{ color: '#58a6ff', fontSize: '1.4rem', fontWeight: 'bold' }}>{formatoMoneda(resumenPrestamos.otorgado)}</span>
                </div>
                <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '16px' }}>
                  <span style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Total Pagado (histórico)</span>
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
                    {historialPrestamos.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Este operador no tiene movimientos de préstamo en las nóminas registradas.</td></tr>
                    ) : (
                      historialPrestamos.map(n => (
                        <tr key={n.id} style={{ borderBottom: '1px solid #21262d' }}>
                          <td style={{ padding: '16px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{formatearFechaSpanish(n.fechaPago)}</td>
                          <td style={{ padding: '16px', color: '#D84315', fontWeight: 'bold', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{getConsecutivoNomina(n)}</td>
                          <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(n.prestamoOtorgado || 0)}</td>
                          <td style={{ padding: '16px', color: '#3fb950', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(n.pagoPrestamo || 0)}</td>
                          <td style={{ padding: '16px', color: '#f59e0b', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(n.saldoPrestamo ?? n.prestamo ?? 0)}</td>
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
                <div style={gridTres}>
                  {campoTotal('Subtotal a Referencias', subtotalReferencias, '#58a6ff')}
                  {campoNumerico('Extra', extras, setExtras)}
                  {campoTotal('Subtotal a Pagar', subtotalAPagarCalc, '#3fb950')}
                  {campoTotal('Diferencia Aplicable', diferenciaAplicableCalc, '#58a6ff')}
                </div>
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
                  {campoTotal('Ahorro (por nómina)', dAhorroMonto, '#c9d1d9')}
                  {campoTotal('Ahorro Acumulado', dAhorroAcumulado, '#58a6ff')}
                  <div></div>
                  <div style={{ gridColumn: 'span 3', display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '12px 14px' }}>
                    <input type="checkbox" checked={pagarAhorro} onChange={e => setPagarAhorro(e.target.checked)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                    <span style={{ color: '#c9d1d9', fontSize: '0.85rem' }}>
                      Pagar ahorro acumulado al operador en esta nómina
                      {pagarAhorro
                        ? <b style={{ color: '#3fb950' }}> — se pagará {formatoMoneda(dAhorroAcumulado)} y el acumulado quedará en $0.00</b>
                        : <span style={{ color: '#8b949e' }}> — si no, se suma el ahorro de la semana ({formatoMoneda(dAhorroMonto)}); acumulado nuevo: {formatoMoneda(ahorroAcumuladoNuevo)}</span>}
                    </span>
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
                    <div style={{ gridColumn: 'span 5', color: '#3fb950', fontSize: '0.8rem', fontWeight: 'bold' }}>✔ En esta nómina se pagó el ahorro acumulado al operador.</div>
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
                    <div style={{ border: '1px solid #30363d', borderRadius: '8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ backgroundColor: '#1f2937', color: '#8b949e' }}>
                          <tr>
                            <th style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' }}>REFERENCIA</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' }}>FECHA</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left' }}>CLIENTE</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>IMPORTE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {opsFicha.map((op: any) => (
                            <tr key={op.id} style={{ borderTop: '1px solid #21262d' }}>
                              <td style={{ padding: '10px 12px', color: '#58a6ff', fontFamily: 'monospace', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{op.ref}</td>
                              <td style={{ padding: '10px 12px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>{op.fecha ? formatearFechaSpanish(op.fecha) : '-'}</td>
                              <td style={{ padding: '10px 12px', color: '#c9d1d9' }}>{op.cliente || getNombreEmpresa(op.clientePagaId) || '-'}</td>
                              <td style={{ padding: '10px 12px', color: '#3fb950', fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoMoneda(op.importe ?? op.sueldo ?? 0)}</td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: '2px solid #30363d', backgroundColor: '#010409' }}>
                            <td colSpan={3} style={{ padding: '10px 12px', color: '#8b949e', fontWeight: 'bold', textAlign: 'right', textTransform: 'uppercase' }}>Subtotal Referencias</td>
                            <td style={{ padding: '10px 12px', color: '#3fb950', fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatoMoneda(subtotalReferenciasFicha)}</td>
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
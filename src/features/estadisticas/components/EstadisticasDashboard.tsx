// src/features/estadisticas/components/EstadisticasDashboard.tsx
// ---------------------------------------------------------------------------
// ESTADÍSTICAS DEL PROYECTO — réplica en la app de los reportes del Excel
// "PROYECTO ESTADÍSTICAS" (TENDENCIA, E S, EV, GASTOS/EG, PROMEDIOS):
//   1. Tendencia por Cliente: servicios acumulados por línea + monto y
//      promedio, con desglose mensual.
//   2. Estadística de Servicios: conteo por día y resumen mensual por línea
//      (Transfer / Logística / Fletes).
//   3. Estadística de Ventas: por día y por mes — fiscal pesos, dólares,
//      conversión (TC) y venta total en pesos.
//   4. Utilidad: venta vs costo de proveedor por mes y línea, con margen.
//   5. Promedios: venta promedio por servicio y utilidad promedio, por mes.
// Fuente: operaciones del año (fechaServicio), EXCLUYENDO canceladas.
// Montos: mismos criterios que Facturación (cliente y proveedor, con
// respaldo en la Confirmación de Tarifa guardada).
// Exportación: Excel (XLSX) y PDF horizontal con el logo de la empresa.
// ---------------------------------------------------------------------------
import { useState, useMemo, useEffect } from 'react';
import { collection, query, where, getDocs, documentId } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';
import { cargarLogoDataUrl } from '../../../utils/pdfGenerator';
import { useEmpresaConfig } from '../../configuracion/useEmpresaConfig';
import { Download, RefreshCw, X, Settings2 } from 'lucide-react';
import { useEstadoPersistente } from '../../../hooks/useEstadoPersistente';
import { useEtiquetas } from '../../../contexts/EtiquetasContext';
import { FormularioOperacion } from '../../operaciones/components/FormularioOperacion';
import { EstadisticasOperativas } from './EstadisticasOperativas';
import './EstadisticasDashboard.css';

const STATUS_CANCELADO_ID = '7607f692';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

type Linea = 'Transfer' | 'Logística' | 'Fletes' | 'Otro';
type Pestana = 'tendencia' | 'servicios' | 'ventas' | 'utilidad' | 'promedios' | 'operativa';
// ✅ V00126: el módulo se divide en dos ÁREAS: OPERATIVA (conteo de servicios) y MONETARIA (ventas, utilidad, promedios)
type Area = 'operativa' | 'monetaria';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc de operación sin tipo canónico completo (mismo criterio que Facturación).
type Op = any;

const money = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => (Number(n) || 0).toLocaleString('en-US');

// ── Clasificación de línea de negocio (nombre del tipo; respaldo: prefijo de la ref) ──
const lineaDeOp = (op: Op): Linea => {
  const t = String(op.tipoOperacionNombre || op.tipoOperacion || '').toLowerCase();
  if (t.includes('transfer')) return 'Transfer';
  if (t.includes('log') || t.includes('cruce')) return 'Logística';
  if (t.includes('flet')) return 'Fletes';
  const ref = String(op.ref || '').toUpperCase();
  if (ref.startsWith('TR')) return 'Transfer';
  if (ref.startsWith('LG') || ref.startsWith('LO')) return 'Logística';
  if (ref.startsWith('FL') || ref.includes('-FL')) return 'Fletes';
  return 'Otro';
};

// ── Montos del CLIENTE (mismo criterio que Facturación de Clientes) ──
const montoClienteDe = (op: Op) => {
  const convGuardada = Number(op.conversionCliente);
  if (!isNaN(convGuardada) && convGuardada > 0) {
    return {
      dol: Number(op.dolaresCliente) || 0,
      pes: Number(op.pesosCliente) || 0,
      conv: convGuardada,
      tc: Number(op.tipoCambioAprobado) || 0,
    };
  }
  const tc = Number(op.tipoCambioAprobado) || 0;
  const subtotal = Number(op.montoConvenioCliente || 0) + Number(op.cargosAdicionales || 0);
  const nombreMoneda = String(op.monedaCobroNombre || '').toUpperCase();
  const factUSD = op.facturadoEnCobrar === '7dca62b3' || nombreMoneda.includes('USD') || nombreMoneda.includes('DOLAR') || nombreMoneda.includes('DÓLAR');
  const factMXN = op.facturadoEnCobrar === 'f95d8894' || nombreMoneda.includes('MXN') || nombreMoneda.includes('PESO');
  // ✅ REGLA DE MONEDAS: si el convenio es USD y se factura en MXN, el monto
  //   en pesos es la CONVERSIÓN (subtotal × TC), igual que en Operaciones.
  const monConv = String(op.monedaConvenioCliente || '');
  const convUSD = monConv === '7dca62b3' || (!!monConv && monConv.toUpperCase().includes('USD'));
  const convMXN = monConv === 'f95d8894' || (!!monConv && monConv.toUpperCase().includes('MXN'));
  const cUSD = convUSD || (!convMXN && factUSD);
  const cMXN = convMXN || (!convUSD && factMXN);
  if (cUSD && factMXN) return { dol: 0, pes: subtotal * tc, conv: subtotal * tc, tc };
  if (cUSD) return { dol: subtotal, pes: 0, conv: subtotal * tc, tc };
  if (cMXN && factUSD) return { dol: tc > 0 ? subtotal / tc : 0, pes: 0, conv: subtotal, tc };
  if (cMXN) return { dol: 0, pes: subtotal, conv: subtotal, tc };
  return { dol: 0, pes: 0, conv: subtotal, tc };
};

// ✅ NUEVO — Moneda en la que se FACTURA al cliente esa operación, derivada
//   de los mismos montos que usa Facturación (dólares/pesos del cliente).
const monedaClienteDe = (op: Op): 'USD' | 'MXN' | 'Mixta' | 'Sin dato' => {
  const m = montoClienteDe(op);
  if (m.dol > 0 && m.pes > 0) return 'Mixta';
  if (m.dol > 0) return 'USD';
  if (m.pes > 0) return 'MXN';
  const nombre = String(op.monedaCobroNombre || '').toUpperCase();
  if (nombre.includes('USD') || nombre.includes('DOLAR') || nombre.includes('DÓLAR')) return 'USD';
  if (nombre.includes('MXN') || nombre.includes('PESO')) return 'MXN';
  return 'Sin dato';
};

// ── Costo del PROVEEDOR (mismo criterio que Facturación de Proveedores,
//    con respaldo en la Confirmación de Tarifa guardada) ──
// ✅ NUEVO — desglose del PROVEEDOR (dol/pes/conv) con la regla de monedas.
const montoProveedorDe = (op: Op): { dol: number; pes: number; conv: number } => {
  const dolG = Number(op.dolaresProv) || 0;
  const pesG = Number(op.pesosProv) || 0;
  const convG = Number(op.conversionProv) || 0;
  if (convG > 0) return { dol: dolG, pes: pesG, conv: convG };
  const tc = Number(op.tipoCambioAprobado) || 0;
  const subtotal = Number(op.subtotalProv) || ((Number(op.totalAPagarProv) || 0) + (Number(op.cargosAdicionalesProv) || 0));
  if (subtotal <= 0) return { dol: 0, pes: 0, conv: 0 };
  const fact = String(op.facturadoEnUnidad || '');
  const nombreFact = String(op.monedaUnidadNombre || op.monedaPagoProvNombre || '').toUpperCase();
  const factUSD = fact === '7dca62b3' || nombreFact.includes('USD') || nombreFact.includes('DOLAR') || nombreFact.includes('DÓLAR');
  const factMXN = fact === 'f95d8894' || nombreFact.includes('MXN') || nombreFact.includes('PESO');
  const monConv = String(op.monedaConvenioProv || '');
  const convUSD = monConv === '7dca62b3' || (!!monConv && monConv.toUpperCase().includes('USD'));
  const convMXN = monConv === 'f95d8894' || (!!monConv && monConv.toUpperCase().includes('MXN'));
  const cUSD = convUSD || (!convMXN && factUSD);
  const cMXN = convMXN || (!convUSD && factMXN);
  if (cUSD && factMXN) return { dol: 0, pes: subtotal * tc, conv: subtotal * tc };
  if (cUSD) return { dol: subtotal, pes: 0, conv: subtotal * tc };
  if (cMXN && factUSD) return { dol: tc > 0 ? subtotal / tc : 0, pes: 0, conv: subtotal };
  if (cMXN) return { dol: 0, pes: subtotal, conv: subtotal };
  return { dol: 0, pes: 0, conv: subtotal };
};

const costoProveedorDe = (op: Op): number => {
  const convGuardada = Number(op.conversionProv);
  if (!isNaN(convGuardada) && convGuardada > 0) return convGuardada;
  const tc = Number(op.tipoCambioAprobado) || 0;
  const subtotal = Number(op.subtotalProv) || ((Number(op.totalAPagarProv) || 0) + (Number(op.cargosAdicionalesProv) || 0));
  if (subtotal > 0) {
    const monedaTxt = String(op.monedaPagoProvNombre || op.facturadoEnUnidad || '').toUpperCase();
    const esDolar = monedaTxt.includes('USD') || monedaTxt.includes('DOLAR') || monedaTxt.includes('DÓLAR');
    return esDolar && tc > 0 ? subtotal * tc : subtotal;
  }
  const ct = op.confirmacionTarifa;
  if (ct && typeof ct === 'object') {
    const subCT = Number(ct.subtotalProv) || ((Number(ct.convenioProv) || 0) + (Number(ct.costosAdic) || 0));
    if (subCT > 0) {
      const tcCT = tc || Number(ct.tipoCambio) || 0;
      const monedaTxt = String(ct.facturadoEn || ct.monedaConvenio || '').toUpperCase();
      const esDolar = monedaTxt.includes('USD') || monedaTxt.includes('DOLAR') || monedaTxt.includes('DÓLAR');
      const convCT = Number(ct.totalAFacturar) || 0;
      if (convCT > 0) return convCT;
      return esDolar && tcCT > 0 ? subCT * tcCT : subCT;
    }
  }
  return 0;
};

const fechaISODe = (op: Op): string => {
  const s = String(op.fechaServicio || op.fecha || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
};

const DIAS_SEMANA_TXT = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function EstadisticasDashboard() {
  const { config } = useEmpresaConfig();
  const { etq } = useEtiquetas();
  const anioActual = new Date().getFullYear();
  const [pestana, setPestana] = useState<Pestana>('operativa');
  const [area, setArea] = useState<Area>('operativa');
  const cambiarArea = (a: Area) => { setArea(a); setPestana(a === 'operativa' ? 'operativa' : 'tendencia'); };
  const [lineaVista, setLineaVista] = useState<'Globales' | Linea>('Globales');
  const [ops, setOps] = useState<Op[]>([]);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);

  // ✅ RANGO DE FECHAS con búsqueda diferida (patrón estándar de la app):
  //   los registros se consultan y muestran SOLO al presionar Buscar.
  const [fechaDesde, setFechaDesde] = useState(`${anioActual}-01-01`);
  const [fechaHasta, setFechaHasta] = useState(new Date().toISOString().slice(0, 10));
  const [busquedaHecha, setBusquedaHecha] = useState(false);
  // ✅ NUEVO: detalle de un MES en la pestaña Servicios (opcionalmente
  //   acotado a una línea: clic en el número de Transfer/Logística/Fletes).
  // ✅ GENERALIZADO: el modal de desglose ahora acepta CUALQUIER selección
  //   (mes de Servicios, cliente de Tendencia, mes de Ventas, línea de
  //   Utilidad/Promedios). `esLinea` oculta el panel de tipo de operación
  //   cuando ya se filtró por línea; `ocultarClientes` lo oculta cuando el
  //   desglose es de UN cliente.
  const [detalleSel, setDetalleSel] = useState<{ titulo: string; ops: Op[]; esLinea?: boolean; ocultarClientes?: boolean } | null>(null);
  // ✅ NUEVO: ficha de UNA operación (clic en su referencia) + edición con el
  //   MISMO formulario del módulo de Operaciones.
  // ✅ NUEVO: al hacer clic en cualquier elemento del detalle (cliente,
  //   unidad, operador, movimiento, línea, trompo) se muestran SUS referencias.
  const [refsFiltro, setRefsFiltro] = useState<{ etiqueta: string; ops: Op[]; formato?: 'transfer' | 'cruces' | 'fletes' } | null>(null);
  // ✅ Ficha de la operación (primero el DETALLE; Editar abre el formulario).
  const [opFicha, setOpFicha] = useState<Op | null>(null);
  // ✅ Tabla de referencias: columnas configurables (persisten entre sesiones)
  //   y filtros por columna.
  const [columnasRefs, setColumnasRefs] = useEstadoPersistente<string[]>('estadisticas_columnasRefs',
    ['ref', 'fechaServicio', 'linea', 'statusNombre', 'clientePagaNombre', 'unidadNombre', 'operadorNombre', 'origen', 'destino', 'monedaCobroNombre', 'importeCliente']);
  const [filtrosCols, setFiltrosCols] = useState<Record<string, string>>({});
  const [menuColumnas, setMenuColumnas] = useState(false);

  // ✅ Etiquetas de columnas personalizables (Configuración → Personalizar Etiquetas).
  const COLUMNAS_REFS: { campo: string; etiqueta: string }[] = [
    { campo: 'ref', etiqueta: etq('col.est.referencia', 'Referencia') },
    { campo: 'fechaServicio', etiqueta: etq('col.est.fecha_servicio', 'Fecha Servicio') },
    { campo: 'linea', etiqueta: etq('col.est.linea', 'Línea') },
    { campo: 'tipoOperacionNombre', etiqueta: etq('col.est.tipo_de_operacion', 'Tipo de Operación') },
    { campo: 'statusNombre', etiqueta: etq('col.est.status', 'Status') },
    { campo: 'clientePagaNombre', etiqueta: etq('col.est.cliente', 'Cliente') },
    { campo: 'convenioNombre', etiqueta: etq('col.est.convenio', 'Convenio') },
    { campo: 'unidadNombre', etiqueta: etq('col.est.unidad', 'Unidad') },
    { campo: 'operadorNombre', etiqueta: etq('col.est.operador', 'Operador') },
    { campo: 'numeroRemolque', etiqueta: etq('col.est.remolque', 'Remolque') },
    { campo: 'origen', etiqueta: etq('col.est.origen', 'Origen') },
    { campo: 'destino', etiqueta: etq('col.est.destino', 'Destino') },
    { campo: 'kilometrajeEstimado', etiqueta: etq('col.est.km_estimado', 'Km Estimado') },
    { campo: 'monedaCobroNombre', etiqueta: etq('col.est.moneda', 'Moneda') },
    { campo: 'importeCliente', etiqueta: etq('col.est.importe_cliente', 'Importe (Cliente)') },
  ];

  // ✅ NUEVO — RESOLUCIÓN DE IDs A NOMBRES en la ficha y la tabla.
  //   Algunos registros guardan el ID del catálogo (remolque, unidad,
  //   operador, origen/destino) sin el nombre denormalizado; se resuelven
  //   contra la MISMA caché local de catálogos que usa Operaciones
  //   (cat_v2__) y, si falta alguna colección, contra Firestore una sola vez.
  const [mapasNombres, setMapasNombres] = useState<Record<string, Record<string, string>> | null>(null);
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const fuentes: { alias: string; col: string; nombreDe: (r: any) => string }[] = [
        { alias: 'remolques', col: 'remolques', nombreDe: (r) => String(r.numeroRemolque || r.placa || r.nombre || '') },
        { alias: 'unidades', col: 'unidades', nombreDe: (r) => String(r.unidad || r.nombre || '') },
        { alias: 'empleados', col: 'empleados', nombreDe: (r) => `${r.firstName || ''} ${r.lastNamePaternal || ''}`.trim() },
        { alias: 'direcciones', col: 'direcciones', nombreDe: (r) => String(r.nombre || r.alias || r.direccion || '') },
        { alias: 'empresas', col: 'empresas', nombreDe: (r) => String(r.nombre || '') },
      ];
      const resultado: Record<string, Record<string, string>> = {};
      for (const fte of fuentes) {
        let registros: any[] = [];
        try {
          // Misma caché que Operaciones/Facturación (cat_v2__ con respaldo cat_v1__).
          const raw = localStorage.getItem(`cat_v2__${fte.alias}`) || localStorage.getItem(`cat_v1__${fte.alias}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            registros = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
          }
        } catch { /* caché ilegible */ }
        if (registros.length === 0) {
          try {
            const snap = await getDocs(collection(db, fte.col));
            registros = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          } catch { registros = []; }
        }
        const mapa: Record<string, string> = {};
        registros.forEach((r: any) => { const n = fte.nombreDe(r); if (r.id && n) mapa[String(r.id)] = n; });
        resultado[fte.alias] = mapa;
      }
      if (!cancelado) setMapasNombres(resultado);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Devuelve el nombre si el valor es un ID conocido en alguno de los
  //   catálogos indicados (en orden); si no, el valor tal cual.
  const resolverNombre = (aliases: string | string[], valor: any): string => {
    const s = String(valor ?? '').trim();
    if (!s) return '';
    for (const alias of (Array.isArray(aliases) ? aliases : [aliases])) {
      const n = mapasNombres?.[alias]?.[s];
      if (n) return n;
    }
    return s;
  };

  const valorColumna = (op: Op, campo: string): string => {
    if (campo === 'linea') return lineaDeOp(op);
    // ✅ Moneda derivada de los MONTOS reales (no del nombre crudo, que en
    //   registros viejos viene vacío o con otro formato).
    if (campo === 'monedaCobroNombre') return monedaClienteDe(op);
    if (campo === 'importeCliente') {
      const m = montoClienteDe(op);
      const partes: string[] = [];
      if (m.dol > 0) partes.push(`${money(m.dol)} USD`);
      if (m.pes > 0) partes.push(`${money(m.pes)} MXN`);
      return partes.join(' + ') || '—';
    }
    if (campo === 'unidadNombre') return String(op.unidadNombre || resolverNombre('unidades', op.unidad) || '');
    if (campo === 'operadorNombre') return String(op.operadorNombre || resolverNombre('empleados', op.operador) || '');
    if (campo === 'clientePagaNombre') return String(op.clientePagaNombre || op.clienteNombre || resolverNombre('empresas', op.clientePaga) || '');
    // ✅ Origen/Destino/Remolque: nombre denormalizado y, si el registro solo
    //   trae el ID, se resuelve contra el catálogo.
    if (campo === 'origen') return String(op.origenNombre || op.clienteOrigenNombre || resolverNombre(['direcciones', 'empresas'], op.origen) || '');
    if (campo === 'destino') return String(op.destinoNombre || op.clienteDestinoNombre || resolverNombre(['direcciones', 'empresas'], op.destino) || '');
    if (campo === 'numeroRemolque') return String(op.remolqueNombre || resolverNombre('remolques', op.numeroRemolque) || op.remolquePlaca || '');
    const v = op[campo];
    return v === null || v === undefined ? '' : String(v);
  };
  const [editandoOp, setEditandoOp] = useState<Op | null>(null);
  const [catalogosForm, setCatalogosForm] = useState<Record<string, unknown[]> | null>(null);
  const [cargandoCatalogos, setCargandoCatalogos] = useState(false);

  // Mismas colecciones y MISMA caché local (cat_v2__) que usa Operaciones.
  const COLECCIONES_FORM: Record<string, string> = {
    statusServicio: 'catalogo_status_servicio', tiposOperacion: 'catalogo_tipo_operacion',
    embalajes: 'catalogo_embalaje', catalogoMoneda: 'catalogo_moneda', tarifas: 'catalogo_tarifas_referencia',
    empresas: 'empresas', remolques: 'remolques', unidades: 'unidades', empleados: 'empleados',
    unidades_proveedor: 'unidades_proveedor', proveedores_unidad: 'proveedores_unidad',
    conveniosProv: 'convenios_proveedores', catalogoConvProvDetalles: 'convenios_proveedores_detalles',
    catalogoConvClientes: 'convenios_clientes', catalogoConvDetalles: 'convenios_clientes_detalles',
    catalogoTC: 'tipo_cambio', direcciones: 'direcciones',
  };

  const abrirEdicionOperacion = async (op: Op) => {
    if (catalogosForm) { setEditandoOp(op); return; }
    setCargandoCatalogos(true);
    try {
      const resultado: Record<string, unknown[]> = {};
      await Promise.all(Object.entries(COLECCIONES_FORM).map(async ([alias, col]) => {
        // 1º la caché compartida con Operaciones; 2º Firestore.
        try {
          const raw = localStorage.getItem(`cat_v2__${alias}`);
          if (raw) {
            const obj = JSON.parse(raw);
            if (obj && Array.isArray(obj.data) && obj.data.length > 0) { resultado[alias] = obj.data; return; }
          }
        } catch { /* caché ilegible: se baja de Firestore */ }
        const snap = await getDocs(collection(db, col));
        resultado[alias] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }));
      setCatalogosForm(resultado);
      setEditandoOp(op);
    } catch (e) {
      console.error('No se pudieron cargar los catálogos para editar:', e);
      alert('No se pudieron cargar los catálogos para abrir el formulario.');
    } finally {
      setCargandoCatalogos(false);
    }
  };

  const buscar = async () => {
    if (!fechaDesde || !fechaHasta) { alert('Captura la fecha Desde y Hasta.'); return; }
    if (fechaHasta < fechaDesde) { alert('La fecha Hasta no puede ser menor que la fecha Desde.'); return; }
    setCargando(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'operaciones'),
        where('fechaServicio', '>=', fechaDesde),
        where('fechaServicio', '<=', fechaHasta)
      ));
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Op))
        .filter((op) => String(op.status || '') !== STATUS_CANCELADO_ID);
      setOps(lista);
      setBusquedaHecha(true);
    } catch (e) {
      console.error('No se pudieron cargar las operaciones del rango:', e);
      alert('No se pudieron cargar las operaciones del rango.');
    } finally {
      setCargando(false);
    }
  };

  // Filtro de línea para las pestañas que lo usan
  const opsDeLinea = useMemo(() =>
    lineaVista === 'Globales' ? ops : ops.filter((o) => lineaDeOp(o) === lineaVista),
  [ops, lineaVista]);

  // ══════════ 1) TENDENCIA POR CLIENTE ══════════
  const tendencia = useMemo(() => {
    interface FilaCliente {
      cliente: string;
      total: number; transfer: number; logistica: number; fletes: number;
      monto: number;
      meses: { servicios: number; monto: number }[];
    }
    const mapa = new Map<string, FilaCliente>();
    ops.forEach((op) => {
      const cliente = String(op.clientePagaNombre || op.clienteNombre || 'SIN CLIENTE').trim() || 'SIN CLIENTE';
      const fila = mapa.get(cliente) || {
        cliente, total: 0, transfer: 0, logistica: 0, fletes: 0, monto: 0,
        meses: MESES.map(() => ({ servicios: 0, monto: 0 })),
      };
      const linea = lineaDeOp(op);
      const conv = montoClienteDe(op).conv;
      fila.total += 1;
      if (linea === 'Transfer') fila.transfer += 1;
      else if (linea === 'Logística') fila.logistica += 1;
      else if (linea === 'Fletes') fila.fletes += 1;
      fila.monto += conv;
      const mes = parseInt(fechaISODe(op).slice(5, 7), 10) - 1;
      if (mes >= 0 && mes < 12) { fila.meses[mes].servicios += 1; fila.meses[mes].monto += conv; }
      mapa.set(cliente, fila);
    });
    const filas = Array.from(mapa.values()).sort((a, b) => b.monto - a.monto);
    const general = filas.reduce((g, f) => ({
      total: g.total + f.total, transfer: g.transfer + f.transfer,
      logistica: g.logistica + f.logistica, fletes: g.fletes + f.fletes, monto: g.monto + f.monto,
    }), { total: 0, transfer: 0, logistica: 0, fletes: 0, monto: 0 });
    return { filas, general };
  }, [ops]);

  // ══════════ 2) SERVICIOS por día + resumen mensual ══════════
  const servicios = useMemo(() => {
    const porDia = new Map<string, { transfer: number; logistica: number; fletes: number }>();
    const porMes = MESES.map(() => ({ transfer: 0, logistica: 0, fletes: 0 }));
    ops.forEach((op) => {
      const f = fechaISODe(op);
      if (!f) return;
      const linea = lineaDeOp(op);
      const d = porDia.get(f) || { transfer: 0, logistica: 0, fletes: 0 };
      if (linea === 'Transfer') d.transfer += 1;
      else if (linea === 'Logística') d.logistica += 1;
      else if (linea === 'Fletes') d.fletes += 1;
      porDia.set(f, d);
      const mes = parseInt(f.slice(5, 7), 10) - 1;
      if (mes >= 0) {
        if (linea === 'Transfer') porMes[mes].transfer += 1;
        else if (linea === 'Logística') porMes[mes].logistica += 1;
        else if (linea === 'Fletes') porMes[mes].fletes += 1;
      }
    });
    const dias = Array.from(porDia.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return { dias, porMes };
  }, [ops]);

  // ══════════ 3) VENTAS por día + resumen mensual (línea seleccionable) ══════════
  const ventas = useMemo(() => {
    interface Acum { pes: number; dol: number; conv: number; venta: number; tcSuma: number; tcN: number; }
    const nuevo = (): Acum => ({ pes: 0, dol: 0, conv: 0, venta: 0, tcSuma: 0, tcN: 0 });
    const porDia = new Map<string, Acum>();
    const porMes = MESES.map(nuevo);
    opsDeLinea.forEach((op) => {
      const f = fechaISODe(op);
      if (!f) return;
      const m = montoClienteDe(op);
      const d = porDia.get(f) || nuevo();
      d.pes += m.pes; d.dol += m.dol; d.conv += m.dol > 0 ? m.conv : 0; d.venta += m.conv;
      if (m.dol > 0 && m.tc > 0) { d.tcSuma += m.tc; d.tcN += 1; }
      porDia.set(f, d);
      const mes = parseInt(f.slice(5, 7), 10) - 1;
      if (mes >= 0) {
        const pm = porMes[mes];
        pm.pes += m.pes; pm.dol += m.dol; pm.conv += m.dol > 0 ? m.conv : 0; pm.venta += m.conv;
        if (m.dol > 0 && m.tc > 0) { pm.tcSuma += m.tc; pm.tcN += 1; }
      }
    });
    const dias = Array.from(porDia.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return { dias, porMes };
  }, [opsDeLinea]);

  // ══════════ 4) UTILIDAD por mes y línea ══════════
  const utilidad = useMemo(() => {
    interface Acum { venta: number; costo: number; servicios: number; }
    const porMesLinea: Record<Linea, Acum[]> = {
      Transfer: MESES.map(() => ({ venta: 0, costo: 0, servicios: 0 })),
      'Logística': MESES.map(() => ({ venta: 0, costo: 0, servicios: 0 })),
      Fletes: MESES.map(() => ({ venta: 0, costo: 0, servicios: 0 })),
      Otro: MESES.map(() => ({ venta: 0, costo: 0, servicios: 0 })),
    };
    ops.forEach((op) => {
      const f = fechaISODe(op);
      const mes = parseInt(f.slice(5, 7), 10) - 1;
      if (mes < 0 || mes > 11) return;
      const linea = lineaDeOp(op);
      const acum = porMesLinea[linea][mes];
      acum.venta += montoClienteDe(op).conv;
      acum.costo += costoProveedorDe(op);
      acum.servicios += 1;
    });
    return porMesLinea;
  }, [ops]);

  // ══════════ 5) PROMEDIOS por mes y línea ══════════
  const promedios = useMemo(() => {
    return (['Transfer', 'Logística', 'Fletes'] as Linea[]).map((linea) => ({
      linea,
      meses: MESES.map((_, i) => {
        const u = utilidad[linea][i];
        return {
          servicios: u.servicios,
          venta: u.venta,
          promVenta: u.servicios > 0 ? u.venta / u.servicios : 0,
          promUtilidad: u.servicios > 0 ? (u.venta - u.costo) / u.servicios : 0,
        };
      }),
    }));
  }, [utilidad]);

  // ══════════ DETALLE DE UN MES (pestaña Servicios) ══════════
  const norm = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Texto clasificable de la operación (convenio + tipo + servicio).
  const textoDeOp = (op: Op) => norm(`${op.convenioNombre || ''} ${op.tipoOperacionNombre || op.tipoOperacion || ''} ${op.tipoServicioNombre || op.tipoServicio || ''}`);

  const movimientoDeOp = (op: Op): 'Importación' | 'Exportación' | 'Movimiento' | 'Sin clasificar' => {
    // ✅ NUEVO: la clasificación MANUAL (modal "Sin clasificar") manda.
    const manual = String((op as any).movimientoManual || '');
    if (manual === 'Importación' || manual === 'Exportación' || manual === 'Movimiento') return manual as any;
    const t = textoDeOp(op);
    if (t.includes('impo')) return 'Importación';
    if (t.includes('expo')) return 'Exportación';
    if (t.includes('mov')) return 'Movimiento';
    return 'Sin clasificar';
  };

  const esTrompo = (op: Op) => textoDeOp(op).includes('trompo');

  const contarPor = (lista: Op[], etiquetaDe: (op: Op) => string) => {
    const mapa = new Map<string, number>();
    lista.forEach((op) => {
      const k = (etiquetaDe(op) || '').trim() || '(Sin dato)';
      mapa.set(k, (mapa.get(k) || 0) + 1);
    });
    return Array.from(mapa.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  // Conteo por línea para las pestañas del desglose.
  const conteoLineasDet = useMemo(() => {
    const c: Record<string, number> = { Todas: detalleSel?.ops.length || 0, Transfer: 0, 'Logística': 0, Fletes: 0, Otro: 0 };
    (detalleSel?.ops || []).forEach((op: Op) => { c[lineaDeOp(op)] += 1; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalleSel]);

  // Ops de un mes (0-11), opcionalmente filtradas por línea.
  const opsDeMes = (mes: number, linea?: Linea) => ops.filter((op) => {
    const f = fechaISODe(op);
    if (parseInt(f.slice(5, 7), 10) - 1 !== mes) return false;
    return linea ? lineaDeOp(op) === linea : true;
  });
  const abrirDetalleMes = (mes: number, linea?: Linea) => {
    setDetalleSel({
      titulo: `Servicios de ${MESES[mes]}${linea ? ` · ${linea}` : ''}`,
      ops: opsDeMes(mes, linea),
      esLinea: !!linea,
    });
    setRefsFiltro(null);
  };
  // ✅ NUEVO — desglose por CLIENTE (desde Tendencia). '__ALL__' = General.
  const abrirDetalleCliente = (cliente: string) => {
    const esTodos = cliente === '__ALL__';
    setDetalleSel({
      titulo: esTodos ? `General · ${etiquetaRango}` : cliente,
      ops: esTodos ? ops : ops.filter((op) => ((String(op.clientePagaNombre || op.clienteNombre || 'SIN CLIENTE').trim()) || 'SIN CLIENTE') === cliente),
      ocultarClientes: !esTodos,
    });
    setRefsFiltro(null);
  };

  // ═══════════ ✅ NUEVO — PESTAÑAS POR TIPO DE OPERACIÓN EN EL REPORTE ═══════════
  //   El reporte de operaciones se separa en pestañas por línea (como las
  //   hojas del Excel). La pestaña TRANSFER usa el formato de columnas del
  //   Excel "Reporte de Transfer" (facturación + cobranza por operación).
  // ✅ CAMBIO: la pestaña por línea vive en el MODAL DE DESGLOSE (no en la
  //   tabla). La tabla hereda el formato Transfer vía refsFiltro.formato.
  const [tabLineaDet, setTabLineaDet] = useState<'Todas' | Linea>('Todas');
  // ✅ NUEVO — FILTROS EN CASCADA DEL DESGLOSE: cada clic dentro del reporte
  //   agrega un filtro y TODO el desglose se recalcula alrededor de él.
  const [filtrosDet, setFiltrosDet] = useState<{ etiqueta: string; fn: (op: Op) => boolean }[]>([]);
  // ✅ NUEVO — CLASIFICAR MANUALMENTE las operaciones "Sin clasificar".
  const [clasifAbierto, setClasifAbierto] = useState(false);
  const [ordenDia, setOrdenDia] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [clasifGuardando, setClasifGuardando] = useState('');
  const clasificarOp = async (op: Op, mov: 'Importación' | 'Exportación' | 'Movimiento') => {
    setClasifGuardando(String(op.id));
    try {
      const { updateDoc: upd, doc: docRef } = await import('firebase/firestore');
      await upd(docRef(db, 'operaciones', String(op.id)), { movimientoManual: mov });
      setOps((prev) => prev.map((o) => o.id === op.id ? { ...o, movimientoManual: mov } as any : o));
      if (detalleSel) setDetalleSel((prev) => prev ? { ...prev, ops: prev.ops.map((o: any) => o.id === op.id ? { ...o, movimientoManual: mov } : o) } : prev);
    } catch (e) { console.error(e); alert('No se pudo clasificar. Intenta de nuevo.'); }
    setClasifGuardando('');
  };

  const agregarFiltroDet = (etiqueta: string, fn: (op: Op) => boolean) => {
    setFiltrosDet((prev) => prev.some((x) => x.etiqueta === etiqueta) ? prev : [...prev, { etiqueta, fn }]);
  };
  useEffect(() => { setFiltrosDet([]); }, [detalleSel?.titulo]);
  useEffect(() => { setTabLineaDet('Todas'); }, [detalleSel?.titulo]);
  useEffect(() => { setFiltrosCols({}); setOrdenRefs(null); }, [refsFiltro]);
  // ✅ NUEVO — ORDEN POR COLUMNA en la tabla de operaciones (mismo patrón
  //   que Operaciones Activas): clic asc, segundo clic desc.
  const [ordenRefs, setOrdenRefs] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const clickOrdenRefs = (col: string) => setOrdenRefs((prev) => prev && prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 });
  const numeroDeTexto = (s: string): number | null => {
    const limpio = String(s).replace(/[$,\s]/g, '');
    if (limpio === '' || isNaN(Number(limpio))) return null;
    return Number(limpio);
  };

  // Al hacer drill-down desde el desglose, si la pestaña activa es Transfer
  // la tabla se abre con el formato del Excel de Transfer.
  const abrirRefsDesdeDetalle = (cfg: { etiqueta: string; ops: Op[] }) => {
    // ✅ La tabla hereda el formato Excel de la pestaña activa:
    //   Transfer -> TRANSFER · Logística -> CRUCES · Fletes -> FLETES.
    setRefsFiltro({ ...cfg, formato: formatoDeLinea(tabLineaDet) });
  };

  const detalle = useMemo(() => {
    if (detalleSel === null) return null;
    // ✅ Pestaña por línea del DESGLOSE: todos los paneles se recalculan
    //   sobre la línea seleccionada.
    let delSel = (tabLineaDet === 'Todas' || detalleSel.esLinea)
      ? detalleSel.ops
      : detalleSel.ops.filter((op: Op) => lineaDeOp(op) === tabLineaDet);
    // ✅ Filtros en cascada: todo el reporte gira alrededor de la selección.
    filtrosDet.forEach((fx) => { delSel = delSel.filter(fx.fn); });
    const porLinea = { Transfer: 0, 'Logística': 0, Fletes: 0, Otro: 0 } as Record<Linea, number>;
    const porMovimiento = { 'Importación': 0, 'Exportación': 0, 'Movimiento': 0, 'Sin clasificar': 0 };
    let trompos = 0;
    // ✅ NUEVO — separación por MONEDA de facturación (cliente): cuántas
    //   operaciones se facturan en dólares y cuántas en pesos, con montos.
    const monedas = {
      USD: { n: 0, dol: 0, conv: 0 },
      MXN: { n: 0, pes: 0 },
      Mixta: { n: 0, dol: 0, pes: 0, conv: 0 },
      'Sin dato': { n: 0 },
    };
    delSel.forEach((op) => {
      porLinea[lineaDeOp(op)] += 1;
      porMovimiento[movimientoDeOp(op)] += 1;
      if (esTrompo(op)) trompos += 1;
      const mon = monedaClienteDe(op);
      const m = montoClienteDe(op);
      monedas[mon].n += 1;
      if (mon === 'USD') { monedas.USD.dol += m.dol; monedas.USD.conv += m.conv; }
      else if (mon === 'MXN') { monedas.MXN.pes += m.pes; }
      else if (mon === 'Mixta') { monedas.Mixta.dol += m.dol; monedas.Mixta.pes += m.pes; monedas.Mixta.conv += m.conv; }
    });
    return {
      ops: delSel,
      porLinea,
      porMovimiento,
      trompos,
      // ✅ NUEVO — operaciones por DÍA DE LA SEMANA.
      porDia: (() => {
        const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const c: Record<string, number> = { Lunes: 0, Martes: 0, 'Miércoles': 0, Jueves: 0, Viernes: 0, 'Sábado': 0, Domingo: 0 };
        delSel.forEach((op: Op) => {
          const fch = fechaISODe(op);
          if (!fch) return;
          const d = new Date(`${fch}T12:00:00`);
          if (!isNaN(d.getTime())) c[DIAS[d.getDay()]] += 1;
        });
        return c;
      })(),
      monedas,
      unidades: contarPor(delSel, (op) => String(op.unidadNombre || op.unidad || '')),
      operadores: contarPor(delSel, (op) => String(op.operadorNombre || op.operador || '')),
      clientes: contarPor(delSel, (op) => String(op.clientePagaNombre || op.clienteNombre || op.clientePaga || '')),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalleSel, tabLineaDet, filtrosDet]);


  const COLUMNAS_TRANSFER: { campo: string; etiqueta: string; num?: boolean }[] = [
    { campo: 'refRoelca', etiqueta: '# REF ROELCA' },
    { campo: 'fecha', etiqueta: 'FECHA' },
    { campo: 'unidad', etiqueta: 'UNIDAD' },
    { campo: 'operador', etiqueta: 'OPERADOR' },
    { campo: 'clientePaga', etiqueta: 'CLIENTE PAGA' },
    { campo: 'tipoOper', etiqueta: 'TIPO DE OPER.' },
    { campo: 'expoImpo', etiqueta: 'EXPORTACION / IMPORTACION' },
    { campo: 'cv', etiqueta: 'C / V' },
    { campo: 'observaciones', etiqueta: 'OBSERVACIONES' },
    { campo: 'facturarEn', etiqueta: 'FACTURAR EN: PESOS / DOLARES' },
    { campo: 'tipoFactura', etiqueta: 'TIPO DE FACTURA' },
    { campo: 'factura', etiqueta: 'FACTURA' },
    { campo: 'fechaFactura', etiqueta: 'FECHA FACTURA' },
    { campo: 'dlls', etiqueta: 'DLLS', num: true },
    { campo: 'tipoCambio', etiqueta: 'TIPO DE CAMBIO', num: true },
    { campo: 'subtotal', etiqueta: 'SUBTOTAL', num: true },
    { campo: 'valorFactura', etiqueta: 'VALOR FACTURA', num: true },
    { campo: 'valorPesosSinIva', etiqueta: 'VALOR FACTURA EN PESOS SIN IVA', num: true },
    { campo: 'pago', etiqueta: 'PAGO', num: true },
    { campo: 'fechaPago', etiqueta: 'FECHA DE PAGO' },
    { campo: 'formaPago', etiqueta: 'FORMA DE PAGO' },
    { campo: 'saldoCobranza', etiqueta: 'SALDO COBRANZA', num: true },
    { campo: 'statusFactura', etiqueta: 'STATUS FACTURA' },
    { campo: 'obsRefPago', etiqueta: 'OBSERVACIONES DE LA REFERENCIA Y EL PAGO' },
    { campo: 'numCliente', etiqueta: '# CLIENTE' },
    { campo: 'mes', etiqueta: 'MES' },
  ];

  // ✅ NUEVO — Formato CRUCES (Logística) y FLETES: mismas columnas del Excel
  //   del usuario. Reutilizan los campos de Transfer + bloque del PROVEEDOR.
  const COLS_PROV: { campo: string; etiqueta: string; num?: boolean }[] = [
    { campo: 'facturarEnProv', etiqueta: 'FACTURADO EN: PESOS / DOLARES' },
    { campo: 'tipoFacturaProv', etiqueta: 'TIPO FACTURA PROVEEDOR' },
    { campo: 'facturaProv', etiqueta: 'FACTURA PROVEEDOR' },
    { campo: 'fechaFacturaProv', etiqueta: 'FECHA FACTURA PROVEEDOR' },
    { campo: 'valorProvPesos', etiqueta: 'VALOR FACTURA PROVEEDOR PESOS', num: true },
    { campo: 'valorProvDolares', etiqueta: 'VALOR FACTURA PROVEEDOR DOLARES', num: true },
    { campo: 'conversionProv', etiqueta: 'CONVERSION A PESOS PROVEEDOR', num: true },
    { campo: 'utilidad', etiqueta: 'UTILIDAD', num: true },
    { campo: 'pagoProv', etiqueta: 'PAGO A PROVEEDOR', num: true },
    { campo: 'fechaPagoProv', etiqueta: 'FECHA DE PAGO PROVEEDOR' },
    { campo: 'formaPagoProv', etiqueta: 'FORMA DE PAGO PROVEEDOR' },
    { campo: 'saldoProvSinIva', etiqueta: 'SALDO PROVEEDOR SIN IVA', num: true },
  ];
  const COLUMNAS_CRUCES: { campo: string; etiqueta: string; num?: boolean }[] = [
    { campo: 'refRoelca', etiqueta: '# REF ROELCA' },
    { campo: 'fecha', etiqueta: 'FECHA' },
    { campo: 'proveedor', etiqueta: 'PROVEEDOR' },
    { campo: 'clientePaga', etiqueta: 'CLIENTE PAGA' },
    { campo: 'tipoOper', etiqueta: 'TIPO DE OPER.' },
    { campo: 'expoImpo', etiqueta: 'IMPORTACION / EXPORTACION' },
    { campo: 'cv', etiqueta: 'C / V' },
    { campo: 'observaciones', etiqueta: 'OBSERVACIONES' },
    { campo: 'facturarEn', etiqueta: 'FACTURAR EN: PESOS / DOLARES' },
    { campo: 'tipoFactura', etiqueta: 'TIPO DE FACTURA' },
    { campo: 'factura', etiqueta: 'FACTURA' },
    { campo: 'fechaFactura', etiqueta: 'FECHA2' },
    { campo: 'dlls', etiqueta: 'DLLS', num: true },
    { campo: 'tipoCambio', etiqueta: 'TIPO DE CAMBIO', num: true },
    { campo: 'subtotal', etiqueta: 'SUBTOTAL', num: true },
    { campo: 'valorFactura', etiqueta: 'VALOR FACTURA', num: true },
    { campo: 'valorPesosSinIva', etiqueta: 'VALOR FACTURA EN PESOS', num: true },
    { campo: 'pago', etiqueta: 'PAGO', num: true },
    { campo: 'fechaPago', etiqueta: 'FECHA DE PAGO' },
    { campo: 'formaPago', etiqueta: 'FORMA DE PAGO' },
    { campo: 'saldoCobranza', etiqueta: 'SALDO COBRANZA', num: true },
    { campo: 'statusFactura', etiqueta: 'STATUS FACTURA' },
    { campo: 'saldoCobranzaSinIva', etiqueta: 'SALDO COBRANZA SIN IVA', num: true },
    ...COLS_PROV,
    { campo: 'numCliente', etiqueta: '# CLIENTE' },
    { campo: 'numProv', etiqueta: '# PROV' },
    { campo: 'mes', etiqueta: 'MES' },
  ];
  const COLUMNAS_FLETES: { campo: string; etiqueta: string; num?: boolean }[] = [
    { campo: 'refRoelca', etiqueta: '# REF ROELCA' },
    { campo: 'fecha', etiqueta: 'FECHA' },
    { campo: 'proveedor', etiqueta: 'PROVEEDOR' },
    { campo: 'clientePaga', etiqueta: 'CLIENTE PAGA' },
    { campo: 'tipoOper', etiqueta: 'TIPO DE OPER.' },
    { campo: 'expoImpo', etiqueta: 'IMPORTACION / EXPORTACION' },
    { campo: 'cv', etiqueta: 'C / V' },
    { campo: 'observaciones', etiqueta: 'OBSERVACIONES' },
    { campo: 'facturarEn', etiqueta: 'FACTURAR EN: PESOS / DOLARES' },
    { campo: 'tipoFactura', etiqueta: 'TIPO DE FACTURA' },
    { campo: 'factura', etiqueta: 'FACTURA DEL CLIENTE' },
    { campo: 'fechaFactura', etiqueta: 'FECHA DE FACTURA DEL CLIENTE' },
    { campo: 'dlls', etiqueta: 'DLLS', num: true },
    { campo: 'tipoCambio', etiqueta: 'TIPO DE CAMBIO', num: true },
    { campo: 'subtotal', etiqueta: 'SUBTOTAL', num: true },
    { campo: 'valorFactura', etiqueta: 'VALOR FACTURA DEL CLIENTE', num: true },
    { campo: 'valorPesosSinIva', etiqueta: 'VALOR TOTAL EN PESOS SIN IVA', num: true },
    { campo: 'pago', etiqueta: 'PAGO DEL CLIENTE', num: true },
    { campo: 'fechaPago', etiqueta: 'FECHA DE PAGO DEL CLIENTE' },
    { campo: 'formaPago', etiqueta: 'FORMA DE PAGO DEL CLIENTE' },
    { campo: 'saldoCobranza', etiqueta: 'SALDO COBRANZA CLIENTE', num: true },
    { campo: 'statusFactura', etiqueta: 'STATUS FACTURA CLIENTE' },
    { campo: 'saldoCobranzaSinIva', etiqueta: 'SALDO COBRANZA SIN IVA', num: true },
    ...COLS_PROV,
    { campo: 'mes', etiqueta: 'MES' },
  ];
  type FormatoExcel = 'transfer' | 'cruces' | 'fletes';
  const COLUMNAS_POR_FORMATO: Record<FormatoExcel, { campo: string; etiqueta: string; num?: boolean }[]> = {
    transfer: COLUMNAS_TRANSFER, cruces: COLUMNAS_CRUCES, fletes: COLUMNAS_FLETES,
  };
  const NOMBRE_HOJA: Record<FormatoExcel, string> = { transfer: 'TRANSFER', cruces: 'CRUCES', fletes: 'FLETES' };
  const formatoDeLinea = (l: 'Todas' | Linea): FormatoExcel | undefined =>
    l === 'Transfer' ? 'transfer' : l === 'Logística' ? 'cruces' : l === 'Fletes' ? 'fletes' : undefined;

  // Join perezoso con FACTURACIÓN y PAGOS (solo al abrir la pestaña Transfer):
  //   op.facturaClienteId -> doc de facturas_clientes; facturaId -> último pago.
  const [joinFacturas, setJoinFacturas] = useState<Record<string, any>>({});
  const [joinPagos, setJoinPagos] = useState<Record<string, { fecha: string; metodo: string; obs: string }> | null>(null);
  const [joinFacturasProv, setJoinFacturasProv] = useState<Record<string, any>>({});
  const [joinPagosProv, setJoinPagosProv] = useState<Record<string, { fecha: string; metodo: string; obs: string }> | null>(null);
  const [cargandoJoin, setCargandoJoin] = useState(false);

  useEffect(() => {
    // ✅ El join corre cuando la tabla está en formato Transfer O cuando la
    //   pestaña Transfer está activa en el desglose (para exportar desde ahí).
    const fmtTabla = refsFiltro?.formato as FormatoExcel | undefined;
    const fmtDetalle = detalleSel !== null ? formatoDeLinea(tabLineaDet) : undefined;
    const fmt = fmtTabla || fmtDetalle;
    if (!fmt) return;
    const opsBase: Op[] = fmtTabla ? refsFiltro!.ops : (detalleSel?.ops || []);
    const necesitaProv = fmt === 'cruces' || fmt === 'fletes';
    let cancelado = false;
    (async () => {
      setCargandoJoin(true);
      try {
        // 1) Facturas de las operaciones visibles que aún no estén en caché.
        const idsFact = Array.from(new Set(
          opsBase.map((op: Op) => String(op.facturaClienteId || '')).filter((id) => id && !(id in joinFacturas))
        ));
        const nuevas: Record<string, any> = {};
        for (let i = 0; i < idsFact.length; i += 10) {
          const lote = idsFact.slice(i, i + 10);
          const snap = await getDocs(query(collection(db, 'facturas_clientes'), where(documentId(), 'in', lote)));
          snap.docs.forEach((d) => { nuevas[d.id] = { id: d.id, ...(d.data() as any) }; });
        }
        if (Object.keys(nuevas).length > 0 && !cancelado) setJoinFacturas((prev) => ({ ...prev, ...nuevas }));
        // 1b) ✅ Facturas de PROVEEDOR (Cruces/Fletes).
        if (necesitaProv) {
          const idsProv = Array.from(new Set(
            opsBase.map((op: Op) => String(op.facturaProveedorId || '')).filter((id) => id && !(id in joinFacturasProv))
          ));
          const nuevasProv: Record<string, any> = {};
          for (let i = 0; i < idsProv.length; i += 10) {
            const lote = idsProv.slice(i, i + 10);
            const snap = await getDocs(query(collection(db, 'facturas_proveedores'), where(documentId(), 'in', lote)));
            snap.docs.forEach((d) => { nuevasProv[d.id] = { id: d.id, ...(d.data() as any) }; });
          }
          if (Object.keys(nuevasProv).length > 0 && !cancelado) setJoinFacturasProv((prev) => ({ ...prev, ...nuevasProv }));
        }
        // 2) Pagos de clientes (una sola vez): mapa facturaId -> último pago.
        if (joinPagos === null) {
          const snapP = await getDocs(query(collection(db, 'pagos'), where('tipo', '==', 'cliente')));
          const mapa: Record<string, { fecha: string; metodo: string; obs: string }> = {};
          snapP.docs
            .map((d) => d.data() as any)
            .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))
            .forEach((p) => {
              (Array.isArray(p.facturas) ? p.facturas : []).forEach((fa: any) => {
                if (Number(fa.aplicado) > 0) mapa[String(fa.facturaId)] = { fecha: String(p.fecha || ''), metodo: String(p.metodoPago || ''), obs: String(p.observaciones || '') };
              });
            });
          if (!cancelado) setJoinPagos(mapa);
        }
        // 2b) ✅ Pagos a PROVEEDORES (Cruces/Fletes), una sola vez.
        if (necesitaProv && joinPagosProv === null) {
          const snapPP = await getDocs(query(collection(db, 'pagos'), where('tipo', '==', 'proveedor')));
          const mapaP: Record<string, { fecha: string; metodo: string; obs: string }> = {};
          snapPP.docs
            .map((d) => d.data() as any)
            .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))
            .forEach((p) => {
              (Array.isArray(p.facturas) ? p.facturas : []).forEach((fa: any) => {
                if (Number(fa.aplicado) > 0) mapaP[String(fa.facturaId)] = { fecha: String(p.fecha || ''), metodo: String(p.metodoPago || ''), obs: String(p.observaciones || '') };
              });
            });
          if (!cancelado) setJoinPagosProv(mapaP);
        }
      } catch (e) { console.warn('No se pudo cargar el join de facturación/pagos:', e); }
      if (!cancelado) setCargandoJoin(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsFiltro, detalleSel, tabLineaDet]);

  const nummx = (n: number) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Valor de una celda del formato TRANSFER para una operación.
  const valorTransfer = (op: Op, campo: string): string => {
    const fac = op.facturaClienteId ? joinFacturas[String(op.facturaClienteId)] : null;
    const pago = fac && joinPagos ? joinPagos[String(fac.id)] : null;
    const m = montoClienteDe(op);
    const monEtq = monedaClienteDe(op);
    const facturarEn = monEtq === 'USD' ? 'DOLARES' : monEtq === 'MXN' ? 'PESOS' : monEtq === 'Mixta' ? 'MIXTA' : '—';
    const total = fac ? (Number(fac.subtotalFactura) || Number(fac.total) || 0) : 0;
    const pagado = fac ? (Number(fac.montoPagado) || 0) : 0;
    switch (campo) {
      case 'refRoelca': return String(op.ref || '');
      case 'fecha': return fechaISODe(op);
      case 'unidad': return valorColumna(op, 'unidadNombre');
      case 'operador': return valorColumna(op, 'operadorNombre');
      case 'clientePaga': return valorColumna(op, 'clientePagaNombre');
      case 'tipoOper': return String(op.tipoOperacionNombre || op.tipoOperacion || '');
      case 'expoImpo': { const mv = movimientoDeOp(op); return mv === 'Sin clasificar' ? '—' : mv.toUpperCase(); }
      case 'cv': {
        const t = `${op.cargadoVacio || ''} ${op.convenioNombre || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        if (t.includes('vaci')) return 'V';
        if (t.includes('carg')) return 'C';
        return String(op.cargadoVacio || '—');
      }
      case 'observaciones': return String(op.observaciones || '');
      case 'facturarEn': return facturarEn;
      case 'tipoFactura': return String(fac?.tipoFacturaNombre || fac?.tipoFactura || op.tipoFacturaNombre || '—');
      case 'factura': return String(op.facturaClienteInvoice || fac?.invoice || '');
      case 'fechaFactura': return String(fac?.fecha || '');
      case 'dlls': return m.dol > 0 ? nummx(m.dol) : '';
      case 'tipoCambio': { const tc = Number(op.tipoCambioAprobado) || Number(fac?.tipoCambio) || 0; return tc > 0 ? tc.toFixed(4) : ''; }
      case 'subtotal': return m.pes > 0 ? nummx(m.pes) : '';
      case 'valorFactura': return m.conv > 0 ? nummx(m.conv) : '';
      case 'valorPesosSinIva': return m.conv > 0 ? nummx(m.conv) : '';
      case 'pago': return fac && pagado > 0 ? nummx(pagado) : '';
      case 'fechaPago': return pago?.fecha || '';
      case 'formaPago': return pago?.metodo || '';
      case 'saldoCobranza': return fac ? nummx(Math.max(0, total - pagado)) : '';
      case 'statusFactura': return String(fac?.statusFactura || (op.facturaClienteId || op.facturado ? 'Facturado' : 'No Facturado'));
      case 'obsRefPago': return [fac?.observaciones, pago?.obs].filter(Boolean).join(' · ');
      case 'numCliente': return String(op.numeroCliente || op.clientePaga || '').substring(0, 12);
      case 'mes': { const f = fechaISODe(op); const mn = parseInt(f.slice(5, 7), 10); return mn >= 1 && mn <= 12 ? MESES[mn - 1] : ''; }
      // ── ✅ BLOQUE PROVEEDOR (formatos Cruces y Fletes) ──
      case 'proveedor': return String(op.provServiciosNombre || resolverNombre('empresas', op.provServicios) || '');
      case 'saldoCobranzaSinIva': return fac ? nummx(Math.max(0, total - pagado)) : '';
      case 'facturarEnProv': {
        const mp = montoProveedorDe(op);
        return mp.dol > 0 && mp.pes <= 0 ? 'DOLARES' : mp.pes > 0 && mp.dol <= 0 ? 'PESOS' : (mp.conv > 0 ? 'PESOS' : '—');
      }
      case 'tipoFacturaProv': { const fp = op.facturaProveedorId ? joinFacturasProv[String(op.facturaProveedorId)] : null; return String(fp?.tipoFacturaNombre || fp?.tipoFactura || '—'); }
      case 'facturaProv': { const fp = op.facturaProveedorId ? joinFacturasProv[String(op.facturaProveedorId)] : null; return String(op.facturaProveedorFolio || fp?.invoice || ''); }
      case 'fechaFacturaProv': { const fp = op.facturaProveedorId ? joinFacturasProv[String(op.facturaProveedorId)] : null; return String(fp?.fecha || ''); }
      case 'valorProvPesos': { const mp = montoProveedorDe(op); return mp.pes > 0 ? nummx(mp.pes) : ''; }
      case 'valorProvDolares': { const mp = montoProveedorDe(op); return mp.dol > 0 ? nummx(mp.dol) : ''; }
      case 'conversionProv': { const mp = montoProveedorDe(op); return mp.conv > 0 ? nummx(mp.conv) : ''; }
      case 'utilidad': { const mp = montoProveedorDe(op); return nummx(m.conv - mp.conv); }
      case 'pagoProv': { const fp = op.facturaProveedorId ? joinFacturasProv[String(op.facturaProveedorId)] : null; const pg = Number(fp?.montoPagado) || 0; return fp && pg > 0 ? nummx(pg) : ''; }
      case 'fechaPagoProv': { const fp = op.facturaProveedorId ? joinFacturasProv[String(op.facturaProveedorId)] : null; return (fp && joinPagosProv?.[String(fp.id)]?.fecha) || ''; }
      case 'formaPagoProv': { const fp = op.facturaProveedorId ? joinFacturasProv[String(op.facturaProveedorId)] : null; return (fp && joinPagosProv?.[String(fp.id)]?.metodo) || ''; }
      case 'saldoProvSinIva': {
        const fp = op.facturaProveedorId ? joinFacturasProv[String(op.facturaProveedorId)] : null;
        if (!fp) return '';
        const totP = Number(fp.subtotalMonedaFactura) || Number(fp.subtotalFactura) || Number(fp.total) || 0;
        return nummx(Math.max(0, totP - (Number(fp.montoPagado) || 0)));
      }
      case 'numProv': return String(op.provServicios || '').substring(0, 12);
      default: return '';
    }
  };

  // ✅ Valor NUMÉRICO por campo (para las filas TOTAL de los formatos).
  const numeroFormatoDe = (op: Op, campo: string): number => {
    const m = montoClienteDe(op);
    const mp = montoProveedorDe(op);
    const fac = op.facturaClienteId ? joinFacturas[String(op.facturaClienteId)] : null;
    const fp = op.facturaProveedorId ? joinFacturasProv[String(op.facturaProveedorId)] : null;
    const totalC = fac ? (Number(fac.subtotalFactura) || Number(fac.total) || 0) : 0;
    const pagadoC = fac ? (Number(fac.montoPagado) || 0) : 0;
    switch (campo) {
      case 'dlls': return m.dol;
      case 'subtotal': return m.pes;
      case 'valorFactura': case 'valorPesosSinIva': return m.conv;
      case 'pago': return pagadoC;
      case 'saldoCobranza': case 'saldoCobranzaSinIva': return fac ? Math.max(0, totalC - pagadoC) : 0;
      case 'valorProvPesos': return mp.pes;
      case 'valorProvDolares': return mp.dol;
      case 'conversionProv': return mp.conv;
      case 'utilidad': return m.conv - mp.conv;
      case 'pagoProv': return Number(fp?.montoPagado) || 0;
      case 'saldoProvSinIva': {
        if (!fp) return 0;
        const totP = Number(fp.subtotalMonedaFactura) || Number(fp.subtotalFactura) || Number(fp.total) || 0;
        return Math.max(0, totP - (Number(fp.montoPagado) || 0));
      }
      default: return 0;
    }
  };

  // Columnas activas y filas visibles de la tabla de referencias (tabla + export).
  const columnasActivas = useMemo(() => COLUMNAS_REFS.filter(c => columnasRefs.includes(c.campo)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnasRefs]);

  const formatoTabla = refsFiltro?.formato as FormatoExcel | undefined;
  const esModoTransfer = !!formatoTabla; // (nombre histórico: ahora cubre transfer/cruces/fletes)
  const columnasFormatoTabla = formatoTabla ? COLUMNAS_POR_FORMATO[formatoTabla] : null;

  const refsVisibles = useMemo(() => {
    if (!refsFiltro) return [];
    const porLinea = refsFiltro.ops;
    const cols = columnasFormatoTabla || columnasActivas;
    const valor = esModoTransfer ? valorTransfer : valorColumna;
    const filtradas = porLinea.filter(op =>
      cols.every(c => {
        const f = (filtrosCols[c.campo] || '').trim().toLowerCase();
        if (!f) return true;
        return valor(op, c.campo).toLowerCase().includes(f);
      })
    );
    // ✅ Orden por la columna activa (numérico si la celda es numérica).
    if (!ordenRefs) return filtradas;
    const { col, dir } = ordenRefs;
    return [...filtradas].sort((a, b) => {
      const va = valor(a, col) || '', vb = valor(b, col) || '';
      const na = numeroDeTexto(va), nb = numeroDeTexto(vb);
      if (na !== null && nb !== null) return (na - nb) * dir;
      return va.localeCompare(vb, 'es') * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsFiltro, columnasActivas, filtrosCols, esModoTransfer, joinFacturas, joinPagos, joinFacturasProv, joinPagosProv, mapasNombres, ordenRefs]);

  // Totales de la pestaña Transfer (fila TOTAL en pantalla y exportes).
  // ✅ Totales GENÉRICOS del formato activo: suma cada columna numérica
  //   (excepto TIPO DE CAMBIO) con numeroFormatoDe.
  const totalesTransfer = useMemo(() => {
    if (!columnasFormatoTabla) return null;
    const t: Record<string, number> = {};
    columnasFormatoTabla.forEach((c) => { if (c.num && c.campo !== 'tipoCambio') t[c.campo] = 0; });
    refsVisibles.forEach((op: Op) => {
      Object.keys(t).forEach((campo) => { t[campo] += numeroFormatoDe(op, campo); });
    });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnasFormatoTabla, refsVisibles, joinFacturas, joinFacturasProv]);

  // ✅ EXPORTACIÓN del rubro seleccionado (Excel y PDF con membrete).
  const exportarRefsExcel = () => {
    if (!refsFiltro) return;
    const wb = XLSX.utils.book_new();
    const cols = columnasFormatoTabla || columnasActivas;
    const valor = esModoTransfer ? valorTransfer : valorColumna;
    const filas: Record<string, string>[] = refsVisibles.map(op => {
      const fila: Record<string, string> = {};
      cols.forEach(c => { fila[c.etiqueta] = valor(op, c.campo) || (esModoTransfer ? '' : '—'); });
      return fila;
    });
    // ✅ Fila de TOTALES genérica del formato (como los SUBTOTAL del Excel).
    if (columnasFormatoTabla && totalesTransfer) {
      const filaTot: Record<string, string> = {};
      columnasFormatoTabla.forEach(c => { filaTot[c.etiqueta] = totalesTransfer[c.campo] !== undefined ? nummx(totalesTransfer[c.campo]) : ''; });
      filaTot[columnasFormatoTabla[0].etiqueta] = `TOTAL (${refsVisibles.length})`;
      filas.push(filaTot);
    }
    const nombreHoja = formatoTabla ? NOMBRE_HOJA[formatoTabla] : 'Operaciones';
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), nombreHoja);
    XLSX.writeFile(wb, `Reporte_${formatoTabla ? NOMBRE_HOJA[formatoTabla] + '_' : ''}${refsFiltro.etiqueta.replace(/[^\w]+/g, '_')}_${fechaDesde}_a_${fechaHasta}.xlsx`);
  };

  // ✅ NUEVO — EXPORTACIÓN DIRECTA DESDE EL DESGLOSE (pestaña activa).
  //   Excel: hoja RESUMEN (monedas, movimiento, trompo y rankings) + hoja de
  //   operaciones (formato Transfer si la pestaña es Transfer). PDF: tabla de
  //   operaciones con el encabezado institucional.
  const formatoDet = formatoDeLinea(tabLineaDet);
  const esTransferDet = !!formatoDet; // (histórico: ahora cubre los 3 formatos)
  const columnasFormatoDet = formatoDet ? COLUMNAS_POR_FORMATO[formatoDet] : null;
  const tituloDetalleTab = () => !detalleSel ? '' : (tabLineaDet === 'Todas' ? detalleSel.titulo : `${detalleSel.titulo} · ${tabLineaDet}`);

  const exportarDetalleExcel = () => {
    if (!detalleSel || !detalle) return;
    const wb = XLSX.utils.book_new();

    // Hoja RESUMEN
    const aoa: any[][] = [
      [tituloDetalleTab()],
      [`Periodo: ${fechaDesde} a ${fechaHasta}`],
      [],
      ['TOTAL DE OPERACIONES', detalle.ops.length],
      ['Operaciones Trompo', detalle.trompos],
      [],
      ['FACTURACIÓN POR MONEDA', 'Operaciones', 'Monto', 'Conversión MXN'],
      ['Dólares (USD)', detalle.monedas.USD.n, detalle.monedas.USD.dol, detalle.monedas.USD.conv],
      ['Pesos (MXN)', detalle.monedas.MXN.n, detalle.monedas.MXN.pes, detalle.monedas.MXN.pes],
    ];
    if (detalle.monedas.Mixta.n > 0) aoa.push(['Mixta (USD + MXN)', detalle.monedas.Mixta.n, `${detalle.monedas.Mixta.dol} USD + ${detalle.monedas.Mixta.pes} MXN`, detalle.monedas.Mixta.conv + detalle.monedas.Mixta.pes]);
    if (detalle.monedas['Sin dato'].n > 0) aoa.push(['Sin dato de moneda', detalle.monedas['Sin dato'].n]);
    aoa.push([], ['MOVIMIENTO', 'Operaciones']);
    (['Importación', 'Exportación', 'Movimiento', 'Sin clasificar'] as const).forEach((mv) => {
      if (detalle.porMovimiento[mv] > 0) aoa.push([mv, detalle.porMovimiento[mv]]);
    });
    const volcarRank = (titulo: string, datos: [string, number][]) => {
      aoa.push([], [titulo.toUpperCase(), 'Operaciones', '%']);
      datos.forEach(([nombre, cuantas]) => aoa.push([nombre, cuantas, `${((cuantas / (detalle.ops.length || 1)) * 100).toFixed(0)}%`]));
    };
    if (!detalleSel.ocultarClientes) volcarRank('Clientes', detalle.clientes);
    volcarRank('Operadores', detalle.operadores);
    volcarRank('Unidades', detalle.unidades);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'RESUMEN');

    // Hoja de operaciones (formato según pestaña)
    const cols = columnasFormatoDet || columnasActivas;
    const valor = esTransferDet ? valorTransfer : valorColumna;
    const filas: Record<string, string>[] = detalle.ops.map((op) => {
      const fila: Record<string, string> = {};
      cols.forEach((c) => { fila[c.etiqueta] = valor(op, c.campo) || (esTransferDet ? '' : '—'); });
      return fila;
    });
    if (columnasFormatoDet) {
      const t: Record<string, number> = {};
      columnasFormatoDet.forEach((c) => { if (c.num && c.campo !== 'tipoCambio') t[c.campo] = 0; });
      detalle.ops.forEach((op) => { Object.keys(t).forEach((campo) => { t[campo] += numeroFormatoDe(op, campo); }); });
      const filaTot: Record<string, string> = {};
      columnasFormatoDet.forEach((c) => { filaTot[c.etiqueta] = t[c.campo] !== undefined ? nummx(t[c.campo]) : ''; });
      filaTot[columnasFormatoDet[0].etiqueta] = `TOTAL (${detalle.ops.length})`;
      filas.push(filaTot);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), formatoDet ? NOMBRE_HOJA[formatoDet] : 'Operaciones');
    XLSX.writeFile(wb, `Desglose_${tituloDetalleTab().replace(/[^\w]+/g, '_')}_${fechaDesde}_a_${fechaHasta}.xlsx`);
  };

  const exportarDetallePDF = async () => {
    if (!detalleSel || !detalle) return;
    if (pestana === 'operativa') { alert('En Reportes operativos usa el botón Excel de la sub-pestaña.'); return; }
    setExportando(true);
    try {
      const logo = await cargarLogoDataUrl(config?.logoUrl).catch(() => null);
      const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const cols = columnasFormatoDet || columnasActivas;
      const valor = esTransferDet ? valorTransfer : valorColumna;
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; color: #111; padding: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #D84315; padding-bottom:8px; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              ${logo ? `<img src="${logo}" style="height:52px;" />` : ''}
              <div>
                <div style="font-size:17px; font-weight:bold; color:#D84315;">ROELCA INC.</div>
                <div style="font-size:13px; font-weight:bold; margin-top:2px;">Desglose — ${esc(tituloDetalleTab())}</div>
                <div style="font-size:11px; color:#555; margin-top:2px;">Periodo: ${esc(fechaDesde)} al ${esc(fechaHasta)} · ${detalle.ops.length} operación(es) · USD: ${detalle.monedas.USD.n} (${esc(nummx(detalle.monedas.USD.dol))} USD) · MXN: ${detalle.monedas.MXN.n} (${esc(nummx(detalle.monedas.MXN.pes))} MXN) · Trompo: ${detalle.trompos}</div>
              </div>
            </div>
          </div>
          <table style="border-collapse:collapse; width:100%; font-size:8px;">
            <thead>
              <tr>${cols.map(c => `<th style="background:#f2f2f2; border:1px solid #ccc; padding:4px 5px; text-align:left;">${esc(c.etiqueta.toUpperCase())}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${detalle.ops.map(op => `<tr>${cols.map(c => `<td style="border:1px solid #ddd; padding:3px 5px;">${esc(valor(op, c.campo) || (esTransferDet ? '' : '—'))}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      const cont = document.createElement('div');
      cont.innerHTML = html;
      document.body.appendChild(cont);
      try {
        const html2pdf = (await import('html2pdf.js')).default;
        await html2pdf().set({
          margin: 8,
          filename: `Desglose_${tituloDetalleTab().replace(/[^\w]+/g, '_')}_${fechaDesde}_a_${fechaHasta}.pdf`,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'letter', orientation: 'landscape' },
        }).from(cont).save();
      } finally {
        document.body.removeChild(cont);
      }
    } finally {
      setExportando(false);
    }
  };

  const exportarRefsPDF = async () => {
    if (!refsFiltro) return;
    setExportando(true);
    try {
      const logo = await cargarLogoDataUrl(config?.logoUrl).catch(() => null);
      const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; color: #111; padding: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #D84315; padding-bottom:8px; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              ${logo ? `<img src="${logo}" style="height:52px;" />` : ''}
              <div>
                <div style="font-size:17px; font-weight:bold; color:#D84315;">ROELCA INC.</div>
                <div style="font-size:13px; font-weight:bold; margin-top:2px;">Reporte de ${esc(formatoTabla ? NOMBRE_HOJA[formatoTabla] : 'Servicios')} — ${esc(refsFiltro.etiqueta)}</div>
                <div style="font-size:11px; color:#555; margin-top:2px;">Periodo: ${esc(fechaDesde)} al ${esc(fechaHasta)} · ${refsVisibles.length} operación(es)</div>
              </div>
            </div>
            <div style="font-size:11px; color:#555;">Generado: ${esc(new Date().toLocaleDateString('es-MX'))}</div>
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:9.5px;">
            <thead>
              <tr>${(columnasFormatoTabla || columnasActivas).map(c => `<th style="background:#f2f2f2; border:1px solid #ccc; padding:4px 5px; text-align:left;">${esc(c.etiqueta.toUpperCase())}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${refsVisibles.map(op => `<tr>${(columnasFormatoTabla || columnasActivas).map(c => `<td style="border:1px solid #ddd; padding:3px 5px;">${esc((esModoTransfer ? valorTransfer : valorColumna)(op, c.campo) || (esModoTransfer ? '' : '—'))}</td>`).join('')}</tr>`).join('')}
              ${columnasFormatoTabla && totalesTransfer ? `<tr>${columnasFormatoTabla.map((c, ci) => {
                const v = ci === 0 ? `TOTAL (${refsVisibles.length})` : (totalesTransfer[c.campo] !== undefined ? nummx(totalesTransfer[c.campo]) : '');
                return `<td style="border:1px solid #ccc; padding:3px 5px; background:#f2f2f2; font-weight:bold;">${esc(v)}</td>`;
              }).join('')}</tr>` : ''}
            </tbody>
          </table>
        </div>`;
      const cont = document.createElement('div');
      cont.innerHTML = html;
      document.body.appendChild(cont);
      try {
        await html2pdf().set({
          margin: 8,
          filename: `Reporte_${refsFiltro.etiqueta.replace(/[^\w]+/g, '_')}_${fechaDesde}_a_${fechaHasta}.pdf`,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'letter', orientation: 'landscape' },
        }).from(cont).save();
      } finally {
        document.body.removeChild(cont);
      }
    } finally {
      setExportando(false);
    }
  };

  // ══════════ EXPORTACIÓN ══════════
  const etiquetaRango = `${fechaDesde} a ${fechaHasta}`;
  const nombreArchivo = (base: string, ext: string) => `${base}_${fechaDesde}_a_${fechaHasta}.${ext}`;

  const exportarExcel = () => {
    if (pestana === 'operativa') { alert('En Reportes operativos usa el botón Excel de la sub-pestaña (exporta la vista activa).'); return; }
    const wb = XLSX.utils.book_new();
    if (pestana === 'tendencia') {
      const filas = tendencia.filas.map((f) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fila dinámica del reporte (columnas por mes).
        const base: any = {
          Cliente: f.cliente, Servicios: f.total, Transfer: f.transfer, 'Logística': f.logistica,
          Fletes: f.fletes, 'Monto (MXN)': f.monto, 'Promedio': f.total > 0 ? f.monto / f.total : 0,
        };
        MESES.forEach((m, i) => { base[`${m} Serv.`] = f.meses[i].servicios; base[`${m} Monto`] = f.meses[i].monto; });
        return base;
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Tendencia por Cliente');
      XLSX.writeFile(wb, nombreArchivo('Tendencia_Clientes', 'xlsx'));
    } else if (pestana === 'servicios') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(MESES.map((m, i) => ({
        Mes: m, Transfer: servicios.porMes[i].transfer, 'Logística': servicios.porMes[i].logistica,
        Fletes: servicios.porMes[i].fletes,
        Total: servicios.porMes[i].transfer + servicios.porMes[i].logistica + servicios.porMes[i].fletes,
      }))), 'Resumen Mensual');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(servicios.dias.map(([f, d]) => ({
        Fecha: f, 'Día': DIAS_SEMANA_TXT[new Date(`${f}T12:00:00`).getDay()],
        Transfer: d.transfer, 'Logística': d.logistica, Fletes: d.fletes, Total: d.transfer + d.logistica + d.fletes,
      }))), 'Por Día');
      XLSX.writeFile(wb, nombreArchivo('Estadistica_Servicios', 'xlsx'));
    } else if (pestana === 'ventas') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(MESES.map((m, i) => {
        const v = ventas.porMes[i];
        return { Mes: m, 'Fiscal Pesos': v.pes, 'Dólares': v.dol, 'TC Promedio': v.tcN > 0 ? v.tcSuma / v.tcN : 0, 'Conversión': v.conv, 'Venta Pesos': v.venta };
      })), `Ventas ${lineaVista}`);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ventas.dias.map(([f, v]) => ({
        Fecha: f, 'Fiscal Pesos': v.pes, 'Dólares': v.dol, 'TC Promedio': v.tcN > 0 ? v.tcSuma / v.tcN : 0, 'Conversión': v.conv, 'Venta Pesos': v.venta,
      }))), 'Por Día');
      XLSX.writeFile(wb, nombreArchivo(`Estadistica_Ventas_${lineaVista}`, 'xlsx'));
    } else if (pestana === 'utilidad') {
      (['Transfer', 'Logística', 'Fletes'] as Linea[]).forEach((linea) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(MESES.map((m, i) => {
          const u = utilidad[linea][i];
          return { Mes: m, Servicios: u.servicios, 'Venta (MXN)': u.venta, 'Costo Proveedor (MXN)': u.costo, 'Utilidad (MXN)': u.venta - u.costo, 'Margen %': u.venta > 0 ? ((u.venta - u.costo) / u.venta) * 100 : 0 };
        })), linea);
      });
      XLSX.writeFile(wb, nombreArchivo('Utilidad', 'xlsx'));
    } else {
      promedios.forEach((p) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(MESES.map((m, i) => ({
          Mes: m, Servicios: p.meses[i].servicios, 'Venta (MXN)': p.meses[i].venta,
          'Promedio Venta': p.meses[i].promVenta, 'Promedio Utilidad': p.meses[i].promUtilidad,
        }))), p.linea);
      });
      XLSX.writeFile(wb, nombreArchivo('Promedios', 'xlsx'));
    }
  };

  const exportarPDF = async () => {
    setExportando(true);
    try {
      const logo = await cargarLogoDataUrl(config?.logoUrl).catch(() => null);
      const esc = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let titulo = '';
      let encabezados: string[] = [];
      let filas: (string | number)[][] = [];

      if (pestana === 'tendencia') {
        titulo = `Tendencia por Cliente — ${etiquetaRango}`;
        encabezados = ['Cliente', 'Servicios', 'Transfer', 'Logística', 'Fletes', 'Monto (MXN)', 'Promedio'];
        filas = [
          ['GENERAL', tendencia.general.total, tendencia.general.transfer, tendencia.general.logistica, tendencia.general.fletes, money(tendencia.general.monto), money(tendencia.general.total > 0 ? tendencia.general.monto / tendencia.general.total : 0)],
          ...tendencia.filas.map((f) => [f.cliente, f.total, f.transfer, f.logistica, f.fletes, money(f.monto), money(f.total > 0 ? f.monto / f.total : 0)]),
        ];
      } else if (pestana === 'servicios') {
        titulo = `Estadística de Servicios — ${etiquetaRango}`;
        encabezados = ['Mes', 'Transfer', 'Logística', 'Fletes', 'Total'];
        filas = MESES.map((m, i) => [m, servicios.porMes[i].transfer, servicios.porMes[i].logistica, servicios.porMes[i].fletes, servicios.porMes[i].transfer + servicios.porMes[i].logistica + servicios.porMes[i].fletes]);
      } else if (pestana === 'ventas') {
        titulo = `Estadística de Ventas (${lineaVista}) — ${etiquetaRango}`;
        encabezados = ['Mes', 'Fiscal Pesos', 'Dólares', 'TC Prom.', 'Conversión', 'Venta Pesos'];
        filas = MESES.map((m, i) => {
          const v = ventas.porMes[i];
          return [m, money(v.pes), money(v.dol), v.tcN > 0 ? (v.tcSuma / v.tcN).toFixed(4) : '—', money(v.conv), money(v.venta)];
        });
      } else if (pestana === 'utilidad') {
        titulo = `Utilidad por Línea — ${etiquetaRango}`;
        encabezados = ['Línea', 'Servicios', 'Venta (MXN)', 'Costo Proveedor', 'Utilidad', 'Margen %'];
        filas = (['Transfer', 'Logística', 'Fletes'] as Linea[]).map((linea) => {
          const tot = utilidad[linea].reduce((a, u) => ({ venta: a.venta + u.venta, costo: a.costo + u.costo, servicios: a.servicios + u.servicios }), { venta: 0, costo: 0, servicios: 0 });
          return [linea, tot.servicios, money(tot.venta), money(tot.costo), money(tot.venta - tot.costo), tot.venta > 0 ? `${(((tot.venta - tot.costo) / tot.venta) * 100).toFixed(1)}%` : '—'];
        });
      } else {
        titulo = `Promedios por Servicio — ${etiquetaRango}`;
        encabezados = ['Línea', 'Servicios', 'Venta (MXN)', 'Prom. Venta', 'Prom. Utilidad'];
        filas = promedios.map((p) => {
          const tot = p.meses.reduce((a, m) => ({ s: a.s + m.servicios, v: a.v + m.venta, u: a.u + m.promUtilidad * m.servicios }), { s: 0, v: 0, u: 0 });
          return [p.linea, tot.s, money(tot.v), money(tot.s > 0 ? tot.v / tot.s : 0), money(tot.s > 0 ? tot.u / tot.s : 0)];
        });
      }

      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; color: #111; padding: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #D84315; padding-bottom:8px; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              ${logo ? `<img src="${logo}" style="height:52px;" />` : ''}
              <div>
                <div style="font-size:17px; font-weight:bold; color:#D84315;">ROELCA INC.</div>
                <div style="font-size:13px; font-weight:bold; margin-top:2px;">${esc(titulo)}</div>
              </div>
            </div>
            <div style="font-size:11px; color:#555;">Generado: ${esc(new Date().toLocaleDateString('es-MX'))}</div>
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:10px;">
            <thead>
              <tr>${encabezados.map((h) => `<th style="background:#f2f2f2; border:1px solid #ccc; padding:5px 6px; text-align:left;">${esc(h)}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${filas.map((fila) => `<tr>${fila.map((c) => `<td style="border:1px solid #ddd; padding:4px 6px;">${esc(c)}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      const cont = document.createElement('div');
      cont.innerHTML = html;
      document.body.appendChild(cont);
      try {
        await html2pdf().set({
          margin: 8,
          filename: nombreArchivo(`Estadisticas_${pestana}`, 'pdf'),
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'letter', orientation: 'landscape' },
        }).from(cont).save();
      } finally {
        document.body.removeChild(cont);
      }
    } finally {
      setExportando(false);
    }
  };

  // ────────────────────────────── RENDER ──────────────────────────────
  return (
    <div className="est-contenedor">
      <div className="est-encabezado">
        <h1 className="est-titulo">Estadísticas</h1>
        <div className="est-acciones">
          <div className="est-fecha-campo">
            <label>DESDE</label>
            <input type="date" className="est-fecha" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
          </div>
          <div className="est-fecha-campo">
            <label>HASTA</label>
            <input type="date" className="est-fecha" value={fechaHasta} min={fechaDesde || undefined} onChange={(e) => setFechaHasta(e.target.value)} />
          </div>
          <button className="est-btn est-btn-primario" onClick={buscar} disabled={cargando}>
            <RefreshCw size={14} /> {cargando ? 'Buscando…' : 'Buscar'}
          </button>
          {busquedaHecha && (
            <>
              <button className="est-btn" onClick={exportarExcel} disabled={cargando}>
                <Download size={14} /> Excel
              </button>
              <button className="est-btn" onClick={exportarPDF} disabled={cargando || exportando}>
                <Download size={14} /> {exportando ? 'Generando…' : 'PDF'}
              </button>
            </>
          )}
        </div>
      </div>

      {busquedaHecha && (
        <p className="est-subtitulo">{ops.length} operaciones del {etiquetaRango} (excluye canceladas) · montos con el mismo criterio de Facturación</p>
      )}

      {/* ✅ V00126: separación clara OPERATIVA vs MONETARIA */}
      <div className="est-areas">
        <button className={`est-area${area === 'operativa' ? ' activa operativa' : ''}`} onClick={() => cambiarArea('operativa')}>📦 Área Operativa <small>servicios · sin montos</small></button>
        <button className={`est-area${area === 'monetaria' ? ' activa monetaria' : ''}`} onClick={() => cambiarArea('monetaria')}>💵 Área Monetaria <small>ventas · utilidad · promedios</small></button>
      </div>
      <div className="est-tabs">
        {area === 'operativa' ? (
          <>
            <button className={`est-tab${pestana === 'operativa' ? ' activa' : ''}`} onClick={() => setPestana('operativa')}>E S (Estadística de Servicios)</button>
            <button className={`est-tab${pestana === 'servicios' ? ' activa' : ''}`} onClick={() => setPestana('servicios')}>Servicios por mes</button>
          </>
        ) : (
          <>
            <button className={`est-tab${pestana === 'tendencia' ? ' activa' : ''}`} onClick={() => setPestana('tendencia')}>Tendencia por Cliente</button>
            <button className={`est-tab${pestana === 'ventas' ? ' activa' : ''}`} onClick={() => setPestana('ventas')}>Ventas</button>
            <button className={`est-tab${pestana === 'utilidad' ? ' activa' : ''}`} onClick={() => setPestana('utilidad')}>Utilidad</button>
            <button className={`est-tab${pestana === 'promedios' ? ' activa' : ''}`} onClick={() => setPestana('promedios')}>Promedios</button>
          </>
        )}
      </div>

      {pestana === 'ventas' && (
        <div className="est-lineas">
          {(['Globales', 'Transfer', 'Logística', 'Fletes'] as const).map((l) => (
            <button key={l} className={`est-linea${lineaVista === l ? ' activa' : ''}`} onClick={() => setLineaVista(l)}>{l}</button>
          ))}
        </div>
      )}

      {!busquedaHecha && !cargando ? (
        <div className="est-vacio-inicial">
          Define tu rango de fechas y presiona <b>Buscar</b> para generar las estadísticas.
        </div>
      ) : cargando ? <p className="est-vacio">Buscando operaciones del {etiquetaRango}…</p> : (
        <div className="est-tabla-marco">
          {pestana === 'operativa' && (
            <EstadisticasOperativas
              ops={ops}
              fechaDesde={fechaDesde}
              fechaHasta={fechaHasta}
              lineaDeOp={lineaDeOp}
              esNoCobrable={(op) => { const m = montoClienteDe(op); return (m.conv || 0) <= 0 && (m.dol || 0) <= 0 && (m.pes || 0) <= 0; }}
              nombreCliente={(op) => valorColumna(op, 'clientePagaNombre')}
              onVerOps={(etiqueta, lista) => setRefsFiltro({ etiqueta, ops: lista })}
            />
          )}
          {pestana === 'tendencia' && (
            <table className="est-tabla">
              <thead>
                <tr><th>CLIENTE</th><th>SERVICIOS</th><th>TRANSFER</th><th>LOGÍSTICA</th><th>FLETES</th><th>MONTO (MXN)</th><th>PROMEDIO</th></tr>
              </thead>
              <tbody>
                <tr className="est-fila-general est-fila-clicable" title="Ver el desglose general" onClick={() => abrirDetalleCliente('__ALL__')}>
                  <td>GENERAL</td><td>{num(tendencia.general.total)}</td><td>{num(tendencia.general.transfer)}</td>
                  <td>{num(tendencia.general.logistica)}</td><td>{num(tendencia.general.fletes)}</td>
                  <td className="est-monto">{money(tendencia.general.monto)}</td>
                  <td className="est-monto">{money(tendencia.general.total > 0 ? tendencia.general.monto / tendencia.general.total : 0)}</td>
                </tr>
                {tendencia.filas.map((f) => (
                  <tr key={f.cliente} className="est-fila-clicable" title={`Ver el desglose de ${f.cliente}`} onClick={() => abrirDetalleCliente(f.cliente)}>
                    <td className="est-cliente">{f.cliente}</td><td>{num(f.total)}</td><td>{num(f.transfer)}</td>
                    <td>{num(f.logistica)}</td><td>{num(f.fletes)}</td>
                    <td className="est-monto">{money(f.monto)}</td>
                    <td>{money(f.total > 0 ? f.monto / f.total : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {pestana === 'servicios' && (
            <table className="est-tabla">
              <thead>
                <tr><th>MES</th><th>TRANSFER</th><th>LOGÍSTICA</th><th>FLETES</th><th>TOTAL</th></tr>
              </thead>
              <tbody>
                {MESES.map((m, i) => {
                  const s = servicios.porMes[i];
                  const total = s.transfer + s.logistica + s.fletes;
                  return (
                    <tr
                      key={m}
                      className={`${total === 0 ? 'est-fila-cero' : 'est-fila-clicable'}`}
                      onClick={() => { if (total > 0) abrirDetalleMes(i); }}
                      title={total > 0 ? `Ver el detalle de ${m}` : undefined}
                    >
                      <td>{m}</td>
                      {/* ✅ Clic en el número de una línea → detalle SOLO de ese rubro */}
                      <td onClick={(e) => { if (s.transfer > 0) { e.stopPropagation(); abrirDetalleMes(i, 'Transfer'); } }} className={s.transfer > 0 ? 'est-num-clicable' : ''}>{num(s.transfer)}</td>
                      <td onClick={(e) => { if (s.logistica > 0) { e.stopPropagation(); abrirDetalleMes(i, 'Logística'); } }} className={s.logistica > 0 ? 'est-num-clicable' : ''}>{num(s.logistica)}</td>
                      <td onClick={(e) => { if (s.fletes > 0) { e.stopPropagation(); abrirDetalleMes(i, 'Fletes'); } }} className={s.fletes > 0 ? 'est-num-clicable' : ''}>{num(s.fletes)}</td>
                      <td className="est-monto">{num(total)}</td>
                    </tr>
                  );
                })}
                <tr className="est-fila-general">
                  {/* ✅ NUEVO: el total del rango abre el desglose con TODO */}
                  <td className="est-celda-link" style={{ cursor: 'pointer' }} onClick={() => { setDetalleSel({ titulo: 'Total del rango', ops }); setRefsFiltro(null); }} title="Ver el desglose de todo el rango">TOTAL DEL RANGO</td>
                  <td className="est-celda-link" style={{ cursor: 'pointer' }} onClick={() => { setDetalleSel({ titulo: 'Total del rango · Transfer', ops: ops.filter((o) => lineaDeOp(o) === 'Transfer'), esLinea: true }); setRefsFiltro(null); }}>{num(servicios.porMes.reduce((a, s) => a + s.transfer, 0))}</td>
                  <td className="est-celda-link" style={{ cursor: 'pointer' }} onClick={() => { setDetalleSel({ titulo: 'Total del rango · Logística', ops: ops.filter((o) => lineaDeOp(o) === 'Logística'), esLinea: true }); setRefsFiltro(null); }}>{num(servicios.porMes.reduce((a, s) => a + s.logistica, 0))}</td>
                  <td className="est-celda-link" style={{ cursor: 'pointer' }} onClick={() => { setDetalleSel({ titulo: 'Total del rango · Fletes', ops: ops.filter((o) => lineaDeOp(o) === 'Fletes'), esLinea: true }); setRefsFiltro(null); }}>{num(servicios.porMes.reduce((a, s) => a + s.fletes, 0))}</td>
                  <td className="est-monto est-celda-link" style={{ cursor: 'pointer' }} onClick={() => { setDetalleSel({ titulo: 'Total del rango', ops }); setRefsFiltro(null); }}>{num(servicios.porMes.reduce((a, s) => a + s.transfer + s.logistica + s.fletes, 0))}</td>
                </tr>
              </tbody>
            </table>
          )}

          {pestana === 'ventas' && (
            <table className="est-tabla">
              <thead>
                <tr><th>MES</th><th>FISCAL PESOS</th><th>DÓLARES</th><th>TC PROM.</th><th>CONVERSIÓN</th><th>VENTA PESOS</th></tr>
              </thead>
              <tbody>
                {MESES.map((m, i) => {
                  const v = ventas.porMes[i];
                  return (
                    <tr key={m} className={v.venta === 0 ? 'est-fila-cero' : 'est-fila-clicable'} title={v.venta > 0 ? `Ver el desglose de ${m}` : undefined} onClick={() => { if (v.venta > 0) setDetalleSel({ titulo: `Ventas ${lineaVista} · ${m}`, ops: opsDeLinea.filter((op) => parseInt(fechaISODe(op).slice(5, 7), 10) - 1 === i) }); }}>
                      <td>{m}</td><td>{money(v.pes)}</td><td className="est-dolares">{money(v.dol)}</td>
                      <td>{v.tcN > 0 ? (v.tcSuma / v.tcN).toFixed(4) : '—'}</td>
                      <td>{money(v.conv)}</td><td className="est-monto">{money(v.venta)}</td>
                    </tr>
                  );
                })}
                <tr className="est-fila-general" style={{ cursor: 'pointer' }} title="Ver el desglose de todo lo listado"
                  onClick={() => { const base = lineaVista === 'Globales' ? ops : ops.filter((o) => lineaDeOp(o) === lineaVista); setDetalleSel({ titulo: `Ventas · Total${lineaVista === 'Globales' ? '' : ` · ${lineaVista}`}`, ops: base, esLinea: lineaVista !== 'Globales' }); setRefsFiltro(null); }}>
                  <td>TOTAL</td>
                  <td>{money(ventas.porMes.reduce((a, v) => a + v.pes, 0))}</td>
                  <td className="est-dolares">{money(ventas.porMes.reduce((a, v) => a + v.dol, 0))}</td>
                  <td>—</td>
                  <td>{money(ventas.porMes.reduce((a, v) => a + v.conv, 0))}</td>
                  <td className="est-monto">{money(ventas.porMes.reduce((a, v) => a + v.venta, 0))}</td>
                </tr>
              </tbody>
            </table>
          )}

          {pestana === 'utilidad' && (
            <table className="est-tabla">
              <thead>
                <tr><th>LÍNEA</th><th>SERVICIOS</th><th>VENTA (MXN)</th><th>COSTO PROVEEDOR</th><th>UTILIDAD</th><th>MARGEN</th></tr>
              </thead>
              <tbody>
                {(['Transfer', 'Logística', 'Fletes'] as Linea[]).map((linea) => {
                  const tot = utilidad[linea].reduce((a, u) => ({ venta: a.venta + u.venta, costo: a.costo + u.costo, servicios: a.servicios + u.servicios }), { venta: 0, costo: 0, servicios: 0 });
                  const uti = tot.venta - tot.costo;
                  return (
                    <tr key={linea} className={tot.servicios > 0 ? 'est-fila-clicable' : ''} title={tot.servicios > 0 ? `Ver las operaciones de ${linea}` : undefined} onClick={() => { if (tot.servicios > 0) setDetalleSel({ titulo: `Utilidad · ${linea} · ${etiquetaRango}`, ops: ops.filter((op) => lineaDeOp(op) === linea), esLinea: true }); }}>
                      <td>{linea}</td><td>{num(tot.servicios)}</td>
                      <td className="est-monto">{money(tot.venta)}</td>
                      <td>{money(tot.costo)}</td>
                      <td className={uti >= 0 ? 'est-monto' : 'est-negativo'}>{money(uti)}</td>
                      <td>{tot.venta > 0 ? `${((uti / tot.venta) * 100).toFixed(1)}%` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {pestana === 'promedios' && (
            <table className="est-tabla">
              <thead>
                <tr><th>LÍNEA</th><th>SERVICIOS</th><th>VENTA (MXN)</th><th>PROM. VENTA / SERVICIO</th><th>PROM. UTILIDAD / SERVICIO</th></tr>
              </thead>
              <tbody>
                {promedios.map((p) => {
                  const tot = p.meses.reduce((a, m) => ({ s: a.s + m.servicios, v: a.v + m.venta, u: a.u + m.promUtilidad * m.servicios }), { s: 0, v: 0, u: 0 });
                  return (
                    <tr key={p.linea} className={tot.s > 0 ? 'est-fila-clicable' : ''} title={tot.s > 0 ? `Ver las operaciones de ${p.linea}` : undefined} onClick={() => { if (tot.s > 0) setDetalleSel({ titulo: `Promedios · ${p.linea} · ${etiquetaRango}`, ops: ops.filter((op) => lineaDeOp(op) === p.linea), esLinea: true }); }}>
                      <td>{p.linea}</td><td>{num(tot.s)}</td>
                      <td className="est-monto">{money(tot.v)}</td>
                      <td>{money(tot.s > 0 ? tot.v / tot.s : 0)}</td>
                      <td>{money(tot.s > 0 ? tot.u / tot.s : 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ✅ DETALLE DE UN MES (Servicios) */}
      {detalleSel !== null && detalle && (
        <div className="est-overlay" onClick={() => { setDetalleSel(null); setRefsFiltro(null); }}>
          <div className="est-detalle" onClick={(e) => e.stopPropagation()}>
            <div className="est-detalle-encabezado">
              <h3>{detalleSel.titulo} — {detalle.ops.length} operación(es)</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {/* ✅ NUEVO: tabla con TODO el desglose, sin filtrar por pestaña */}
                {!detalleSel.esLinea && (
                  <button type="button" className="est-btn"
                    title="Ver todas las operaciones del desglose (sin filtrar por pestaña)"
                    onClick={() => setRefsFiltro({ etiqueta: detalleSel.titulo, ops: detalleSel.ops })}>
                    Ver todo ({detalleSel.ops.length})
                  </button>
                )}
                {/* Tabla de la pestaña activa (hereda el formato Transfer) */}
                <button type="button" className="est-btn"
                  onClick={() => abrirRefsDesdeDetalle({ etiqueta: [tabLineaDet === 'Todas' ? detalleSel.titulo : `${detalleSel.titulo} · ${tabLineaDet}`, ...filtrosDet.map((fx) => fx.etiqueta)].join(' · '), ops: detalle.ops })}>
                  Ver operaciones{tabLineaDet !== 'Todas' ? ` (${detalle.ops.length})` : ''}
                </button>
                {/* ✅ NUEVO: descarga directa desde el desglose (pestaña activa) */}
                <button type="button" className="est-btn" onClick={exportarDetalleExcel}
                  disabled={esTransferDet && cargandoJoin}
                  title={esTransferDet && cargandoJoin ? 'Cargando facturación y pagos…' : 'Descargar Excel (resumen + operaciones)'}>
                  <Download size={14} /> Excel
                </button>
                <button type="button" className="est-btn est-btn-primario" onClick={exportarDetallePDF}
                  disabled={exportando || (esTransferDet && cargandoJoin)}>
                  <Download size={14} /> {exportando ? 'Generando…' : 'PDF'}
                </button>
                <button className="est-detalle-cerrar" onClick={() => { setDetalleSel(null); setRefsFiltro(null); setFiltrosCols({}); setMenuColumnas(false); }}><X size={16} /></button>
              </div>
            </div>

            <div className="est-detalle-cuerpo">
              {(() => {
                const totalOps = detalle.ops.length || 1;
                const pctUSD = (detalle.monedas.USD.n / totalOps) * 100;
                const pctMXN = (detalle.monedas.MXN.n / totalOps) * 100;
                // ── Barras de Movimiento ──
                const movs = (['Importación', 'Exportación', 'Movimiento', 'Trompos'] as const)
                  .map((mv) => ({ mv, n: mv === 'Trompos' ? detalle.trompos : detalle.porMovimiento[mv] }));
                const maxMov = Math.max(1, ...movs.map((m) => m.n));
                const colorMov: Record<string, string> = { 'Importación': '#58a6ff', 'Exportación': '#3fb950', 'Movimiento': '#d29922', 'Trompos': '#bc8cff' };
                // ── Listas rankeadas ──
                const RankLista = ({ titulo, datos, filtrar, colorBarra }: {
                  titulo: string;
                  datos: [string, number][];
                  filtrar: (op: Op, nombre: string) => boolean;
                  colorBarra: string;
                }) => (
                  <div className="est-rep-card">
                    <span className="est-rep-titulo">{titulo} ({datos.length})</span>
                    <div className="est-rep-rank-lista">
                      {datos.map(([nombre, cuantas], idx) => {
                        const pct = (cuantas / totalOps) * 100;
                        return (
                          <button type="button" className="est-rep-rank-item" key={nombre}
                            onClick={() => agregarFiltroDet(`${titulo}: ${nombre}`, (op) => filtrar(op, nombre))}>
                            <span className={`est-rep-rank-num${idx < 3 ? ' top' : ''}`}>{idx + 1}</span>
                            <span className="est-rep-rank-info">
                              <span className="est-rep-rank-nombre">{nombre}</span>
                              <span className="est-rep-rank-barra"><i style={{ width: `${pct}%`, backgroundColor: colorBarra }} /></span>
                            </span>
                            <span className="est-rep-rank-cifra">{num(cuantas)} <small>({pct.toFixed(0)}%)</small></span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
                return (
                  <div className="est-rep">
                    {/* ✅ NUEVO — PESTAÑAS POR TIPO DE OPERACIÓN (sustituyen a la dona) */}
                    {!detalleSel.esLinea && (
                      <div className="est-refs-tabs" style={{ margin: 0 }}>
                        {(['Todas', 'Transfer', 'Logística', 'Fletes'] as const).map((t) => (
                          (t === 'Todas' || conteoLineasDet[t] > 0) && (
                            <button key={t} type="button"
                              className={`est-refs-tab${tabLineaDet === t ? ' activa' : ''}`}
                              onClick={() => setTabLineaDet(t)}>
                              {t} <small>({conteoLineasDet[t]})</small>
                            </button>
                          )
                        ))}
                        {conteoLineasDet.Otro > 0 && (
                          <button type="button" className={`est-refs-tab${tabLineaDet === 'Otro' ? ' activa' : ''}`}
                            onClick={() => setTabLineaDet('Otro')}>
                            Otro <small>({conteoLineasDet.Otro})</small>
                          </button>
                        )}
                      </div>
                    )}

                    {/* ✅ Filtros activos (clic en ✕ para quitar) */}
                    {filtrosDet.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 0 0' }}>
                        {filtrosDet.map((fx) => (
                          <span key={fx.etiqueta} style={{ background: 'rgba(216,67,21,0.14)', border: '1px solid #D84315', borderRadius: '999px', color: '#f0f6fc', fontSize: '0.74rem', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {fx.etiqueta}
                            <span role="button" style={{ cursor: 'pointer', color: '#D84315', fontWeight: 700 }} onClick={() => setFiltrosDet((prev) => prev.filter((y) => y.etiqueta !== fx.etiqueta))}>✕</span>
                          </span>
                        ))}
                        <button type="button" className="est-btn" style={{ padding: '3px 10px', fontSize: '0.72rem' }} onClick={() => setFiltrosDet([])}>Limpiar filtros</button>
                      </div>
                    )}

                    {/* ✅ MODAL — clasificar operaciones sin movimiento */}
                    {clasifAbierto && (
                      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2500, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setClasifAbierto(false)}>
                        <div style={{ width: 'min(680px, 94vw)', maxHeight: '80vh', overflowY: 'auto', background: '#161b22', border: '1px solid #30363d', borderRadius: '12px', padding: '18px' }} onClick={(e) => e.stopPropagation()}>
                          <h3 style={{ margin: '0 0 10px 0', color: '#f0f6fc', fontSize: '1rem' }}>Clasificar operaciones sin movimiento</h3>
                          {detalle.ops.filter((op) => movimientoDeOp(op) === 'Sin clasificar').length === 0 ? (
                            <p style={{ color: '#3fb950' }}>¡Todo clasificado! ✅</p>
                          ) : detalle.ops.filter((op) => movimientoDeOp(op) === 'Sin clasificar').map((op) => (
                            <div key={op.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #21262d', flexWrap: 'wrap' }}>
                              <span style={{ color: '#D84315', fontFamily: 'monospace', fontWeight: 700 }}>{op.ref || String(op.id).slice(0, 8)}</span>
                              <span style={{ color: '#8b949e', fontSize: '0.78rem', flex: 1, minWidth: '160px' }}>{fechaISODe(op)} · {String(op.clientePagaNombre || op.clienteNombre || '')} · {String(op.convenioNombre || '—')}</span>
                              {(['Importación', 'Exportación', 'Movimiento'] as const).map((mv) => (
                                <button key={mv} type="button" className="est-btn" disabled={clasifGuardando === String(op.id)}
                                  style={{ padding: '4px 10px', fontSize: '0.72rem' }}
                                  onClick={() => clasificarOp(op, mv)}>
                                  {clasifGuardando === String(op.id) ? '…' : mv}
                                </button>
                              ))}
                            </div>
                          ))}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                            <button type="button" className="est-btn" onClick={() => setClasifAbierto(false)}>Cerrar</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── FILA 1: KPIs ── */}
                    <div className="est-rep-kpis">
                      <div className="est-rep-card est-rep-kpi">
                        <span className="est-rep-titulo">Total de operaciones</span>
                        <span className="est-rep-kpi-numero">{num(detalle.ops.length)}</span>
                      </div>
                      <div className="est-rep-card est-rep-kpi">
                        <span className="est-rep-titulo">Facturación por moneda</span>
                        <div className="est-rep-monedas">
                          <button type="button" className="est-rep-moneda" disabled={detalle.monedas.USD.n === 0}
                            onClick={() => agregarFiltroDet('Moneda: USD', (op) => monedaClienteDe(op) === 'USD')}>
                            <span className="est-rep-moneda-etq">Dólares (USD)</span>
                            <span className="est-rep-moneda-valor usd">{num(detalle.monedas.USD.n)} <small>({pctUSD.toFixed(0)}%)</small></span>
                            <span className="est-rep-moneda-monto">{money(detalle.monedas.USD.dol)} USD{detalle.monedas.USD.conv > 0 ? ` ≈ ${money(detalle.monedas.USD.conv)} MXN` : ''}</span>
                          </button>
                          <button type="button" className="est-rep-moneda" disabled={detalle.monedas.MXN.n === 0}
                            onClick={() => agregarFiltroDet('Moneda: MXN', (op) => monedaClienteDe(op) === 'MXN')}>
                            <span className="est-rep-moneda-etq">Pesos (MXN)</span>
                            <span className="est-rep-moneda-valor mxn">{num(detalle.monedas.MXN.n)} <small>({pctMXN.toFixed(0)}%)</small></span>
                            <span className="est-rep-moneda-monto">{money(detalle.monedas.MXN.pes)} MXN</span>
                          </button>
                        </div>
                        {(detalle.monedas.Mixta.n > 0 || detalle.monedas['Sin dato'].n > 0) && (
                          <div className="est-rep-moneda-extra">
                            {detalle.monedas.Mixta.n > 0 && (
                              <button type="button" onClick={() => agregarFiltroDet('Moneda: Mixta', (op) => monedaClienteDe(op) === 'Mixta')}>
                                Mixta: {num(detalle.monedas.Mixta.n)}
                              </button>
                            )}
                            {detalle.monedas['Sin dato'].n > 0 && (
                              <button type="button" onClick={() => agregarFiltroDet('Moneda: Sin dato', (op) => monedaClienteDe(op) === 'Sin dato')}>
                                Sin dato: {num(detalle.monedas['Sin dato'].n)}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="est-rep-card est-rep-kpi">
                        <span className="est-rep-titulo">Operaciones Trompo</span>
                        {detalle.trompos > 0
                          ? <button type="button" className="est-rep-kpi-numero clicable" onClick={() => agregarFiltroDet('Trompo', (op) => esTrompo(op))}>{num(detalle.trompos)}</button>
                          : <span className="est-rep-kpi-numero apagado">0</span>}
                      </div>
                    </div>

                    {/* ── FILA 2: GRÁFICAS ── */}
                    <div className="est-rep-graficas">
                      <div className="est-rep-card">
                        <span className="est-rep-titulo">Movimiento</span>
                        <div className="est-rep-barras">
                          {movs.map(({ mv, n }) => {
                            const pct = (n / totalOps) * 100;
                            const alto = (n / maxMov) * 100;
                            return (
                              <button type="button" key={mv} className="est-rep-barra-col" disabled={n === 0}
                                onClick={() => mv === 'Trompos' ? agregarFiltroDet('Trompo', (op) => esTrompo(op)) : agregarFiltroDet(`Movimiento: ${mv}`, (op) => movimientoDeOp(op) === mv)}>
                                <span className="est-rep-barra-cifra">{n > 0 ? `${num(n)} (${pct.toFixed(0)}%)` : ''}</span>
                                <span className="est-rep-barra-tubo"><i style={{ height: `${alto}%`, backgroundColor: colorMov[mv] }} /></span>
                                <span className="est-rep-barra-etq">{mv}</span>
                              </button>
                            );
                          })}
                        </div>
                        {detalle.porMovimiento['Sin clasificar'] > 0 && (
                          <button type="button" className="est-rep-sinclas"
                            onClick={() => abrirRefsDesdeDetalle({ etiqueta: `${detalleSel.titulo} · Sin clasificar`, ops: detalle.ops.filter((op) => movimientoDeOp(op) === 'Sin clasificar') })}>
                            <span role="button" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setClasifAbierto(true)} title="Clasificar manualmente">Sin clasificar: {num(detalle.porMovimiento['Sin clasificar'])} · clic para clasificar</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* ── FILA 3: RANKINGS ── */}
                    {/* ✅ NUEVO — tabla por día calendario: operaciones y dinero */}
                    <div className="est-rep-card" style={{ marginBottom: '12px' }}>
                      <span className="est-rep-titulo">Por día del periodo (operaciones y dinero)</span>
                      <div style={{ maxHeight: '240px', overflowY: 'auto', marginTop: '8px' }}>
                        <table className="est-tabla" style={{ width: '100%' }}>
                          <thead><tr>
                            {([['fecha', 'FECHA', 'left'], ['n', 'OPS', 'right'], ['dol', 'USD', 'right'], ['pes', 'MXN', 'right'], ['conv', 'TOTAL (CONV MXN)', 'right']] as const).map(([col, etq, al]) => (
                              <th key={col} style={{ textAlign: al as any, cursor: 'pointer' }} title="Clic para ordenar"
                                onClick={() => setOrdenDia((prev) => prev && prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 })}>
                                {etq}{ordenDia?.col === col ? (ordenDia.dir === 1 ? ' ▲' : ' ▼') : ''}
                              </th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {(() => {
                              const porFecha = new Map<string, { n: number; dol: number; pes: number; conv: number }>();
                              detalle.ops.forEach((op) => {
                                const fch = fechaISODe(op);
                                if (!fch) return;
                                const p = porFecha.get(fch) || { n: 0, dol: 0, pes: 0, conv: 0 };
                                const m = montoClienteDe(op);
                                p.n += 1; p.dol += m.dol; p.pes += m.pes; p.conv += m.conv;
                                porFecha.set(fch, p);
                              });
                              return Array.from(porFecha.entries()).sort((a, b) => {
                                if (!ordenDia || ordenDia.col === 'fecha') return a[0].localeCompare(b[0]) * (ordenDia?.dir || 1);
                                const va = (a[1] as any)[ordenDia.col] || 0, vb = (b[1] as any)[ordenDia.col] || 0;
                                return (va - vb) * ordenDia.dir;
                              }).map(([fch, p]) => (
                                <tr key={fch} className="est-fila-clicable" onClick={() => agregarFiltroDet(`Fecha: ${fch}`, (op) => fechaISODe(op) === fch)} title="Filtrar el desglose por este día">
                                  <td>{fch} <span style={{ color: '#8b949e', fontSize: '0.72rem' }}>({['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][new Date(`${fch}T12:00:00`).getDay()]})</span></td>
                                  <td style={{ textAlign: 'right' }}>{num(p.n)}</td>
                                  <td style={{ textAlign: 'right' }}>{p.dol > 0 ? `$${nummx(p.dol)}` : '—'}</td>
                                  <td style={{ textAlign: 'right' }}>{p.pes > 0 ? `$${nummx(p.pes)}` : '—'}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{`$${nummx(p.conv)}`}</td>
                                </tr>
                              ));
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="est-rep-card" style={{ marginBottom: '12px' }}>
                      <span className="est-rep-titulo">Operaciones por día de la semana</span>
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                        {(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const).map((dnom) => (
                          <div key={dnom} role="button" onClick={() => agregarFiltroDet(`Día: ${dnom}`, (op) => { const fch = fechaISODe(op); if (!fch) return false; const d = new Date(`${fch}T12:00:00`); const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']; return !isNaN(d.getTime()) && DIAS[d.getDay()] === dnom; })} style={{ flex: '1 1 90px', textAlign: 'center', background: '#0d1117', border: '1px solid #21262d', borderRadius: '8px', padding: '8px 6px', cursor: 'pointer' }}>
                            <div style={{ color: '#8b949e', fontSize: '0.68rem', textTransform: 'uppercase' }}>{dnom}</div>
                            <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: '1.05rem' }}>{detalle.porDia[dnom] || 0}</div>
                            <div style={{ color: '#6e7681', fontSize: '0.66rem' }}>{detalle.ops.length > 0 ? `${(((detalle.porDia[dnom] || 0) / detalle.ops.length) * 100).toFixed(0)}%` : '0%'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="est-rep-listas">
                      {!detalleSel.ocultarClientes && (
                        <RankLista titulo="Clientes" datos={detalle.clientes} colorBarra="#D84315"
                          filtrar={(op, nombre) => (((String(op.clientePagaNombre || op.clienteNombre || op.clientePaga || '').trim()) || '(Sin dato)') === nombre)} />
                      )}
                      <RankLista titulo="Operadores" datos={detalle.operadores} colorBarra="#58a6ff"
                        filtrar={(op, nombre) => (((String(op.operadorNombre || op.operador || '').trim()) || '(Sin dato)') === nombre)} />
                      <RankLista titulo="Unidades" datos={detalle.unidades} colorBarra="#3fb950"
                        filtrar={(op, nombre) => (((String(op.unidadNombre || op.unidad || '').trim()) || '(Sin dato)') === nombre)} />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL INDEPENDIENTE: tabla de referencias del rubro seleccionado
          (lo abren el detalle del mes Y las filas de todas las pestañas). */}
      {refsFiltro && (
        <div className="est-overlay" onClick={() => { setRefsFiltro(null); setFiltrosCols({}); }}>
          <div className="est-detalle" onClick={(e) => e.stopPropagation()}>
            <div className="est-detalle-encabezado">
              <h3>Reporte de operaciones</h3>
              <button className="est-detalle-cerrar" onClick={() => { setRefsFiltro(null); setFiltrosCols({}); }}><X size={16} /></button>
            </div>
            <div className="est-detalle-cuerpo">
              {
                /* ✅ Vista de REFERENCIAS: tabla con columnas configurables,
                    filtros por columna y filas clicables (abren la ficha). */
                <div className="est-refs-vista">
                  <div className="est-refs-vista-encabezado">
                    <button className="est-btn" onClick={() => { setRefsFiltro(null); setFiltrosCols({}); setMenuColumnas(false); }}>← Cerrar</button>
                    <span className="est-refs-vista-titulo">{refsFiltro.etiqueta}</span>
                    <div className="est-refs-acciones">
                      {!esModoTransfer && (
                        <button className="est-btn" onClick={() => setMenuColumnas(true)}>
                          <Settings2 size={14} /> Columnas
                        </button>
                      )}
                      <button className="est-btn" onClick={exportarRefsExcel}>
                        <Download size={14} /> Excel
                      </button>
                      <button className="est-btn est-btn-primario" onClick={exportarRefsPDF} disabled={exportando}>
                        <Download size={14} /> {exportando ? 'Generando…' : 'PDF'}
                      </button>
                    </div>
                  </div>
                  {esModoTransfer && (
                    <span className={`est-refs-join-msg${cargandoJoin ? '' : ' ok'}`} style={{ margin: '6px 0 0 0', display: 'block' }}>
                      {cargandoJoin ? 'Cargando facturación y pagos…' : 'Formato Reporte de Transfer (facturación + cobranza)'}
                    </span>
                  )}

                  {(() => {
                    const columnas = columnasFormatoTabla || columnasActivas;
                    const hayFiltros = Object.values(filtrosCols).some(v => v.trim());
                    const visibles = refsVisibles;
                    return (
                      <>
                        <span className="est-refs-conteo">
                          <b>{visibles.length}</b>{hayFiltros ? ` de ${refsFiltro.ops.length}` : ''} operación(es) · haz clic en una fila para ver su detalle
                          {hayFiltros && <button className="est-btn-liga" onClick={() => setFiltrosCols({})}>Limpiar filtros</button>}
                        </span>
                        <div className="est-tabla-marco est-refs-tabla-marco">
                          <table className="est-tabla">
                            <thead>
                              <tr>{columnas.map(c => (
                                <th key={c.campo} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} title="Clic para ordenar" onClick={() => clickOrdenRefs(c.campo)}>
                                  {c.etiqueta.toUpperCase()}{ordenRefs?.col === c.campo ? (ordenRefs.dir === 1 ? ' ▲' : ' ▼') : ''}
                                </th>
                              ))}</tr>
                              {/* ✅ Fila de FILTROS por columna */}
                              <tr className="est-fila-filtros">
                                {columnas.map(c => (
                                  <th key={c.campo}>
                                    <input
                                      type="text"
                                      className="est-filtro-col"
                                      placeholder="Filtrar…"
                                      value={filtrosCols[c.campo] || ''}
                                      onChange={(e) => setFiltrosCols(prev => ({ ...prev, [c.campo]: e.target.value }))}
                                    />
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {visibles.length === 0 ? (
                                <tr><td colSpan={columnas.length} className="est-vacio">Sin operaciones con esos filtros.</td></tr>
                              ) : visibles.map((op) => {
                                const linea = lineaDeOp(op);
                                const claseLinea = linea === 'Transfer' ? 'transfer' : linea === 'Logística' ? 'logistica' : linea === 'Fletes' ? 'fletes' : 'otro';
                                const valor = esModoTransfer ? valorTransfer : valorColumna;
                                return (
                                  <tr key={op.id} className="est-fila-clicable" onClick={() => setOpFicha(op)} title={`Ver el detalle de ${op.ref || op.id}`}>
                                    {columnas.map((c: any) => (
                                      <td key={c.campo}
                                        className={(c.campo === 'ref' || c.campo === 'refRoelca') ? `est-celda-ref est-ref-${claseLinea}` : (c.num ? 'est-celda-num' : '')}>
                                        {valor(op, c.campo) || (esModoTransfer ? '' : '—')}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                              {/* ✅ Fila TOTAL del formato Transfer (como los SUBTOTAL del Excel) */}
                              {columnasFormatoTabla && totalesTransfer && visibles.length > 0 && (
                                <tr className="est-fila-general">
                                  {columnasFormatoTabla.map((c, ci) => (
                                    <td key={c.campo} className={c.num ? 'est-celda-num' : ''}>
                                      {ci === 0 ? `TOTAL (${visibles.length})` : (totalesTransfer[c.campo] !== undefined ? nummx(totalesTransfer[c.campo]) : '')}
                                    </td>
                                  ))}
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()}
                </div>
}
            </div>
          </div>
        </div>
      )}

      {/* ✅ FICHA DE LA OPERACIÓN: primero el detalle, Editar abre el formulario */}
      {opFicha && (() => {
        const linea = lineaDeOp(opFicha);
        const claseLinea = linea === 'Transfer' ? 'transfer' : linea === 'Logística' ? 'logistica' : linea === 'Fletes' ? 'fletes' : 'otro';
        const secciones: { titulo: string; campos: [string, string][] }[] = [
          { titulo: 'Servicio', campos: [
            ['Fecha de servicio', valorColumna(opFicha, 'fechaServicio') || '—'],
            ['Status', valorColumna(opFicha, 'statusNombre') || '—'],
            ['Tipo de operación', valorColumna(opFicha, 'tipoOperacionNombre') || '—'],
            // ✅ Si no se puede clasificar, se muestra '—' en vez de "Sin clasificar".
            ['Movimiento', movimientoDeOp(opFicha) === 'Sin clasificar' ? '—' : movimientoDeOp(opFicha)],
          ]},
          { titulo: 'Cliente y Convenio', campos: [
            ['Cliente', valorColumna(opFicha, 'clientePagaNombre') || '—'],
            ['Convenio', valorColumna(opFicha, 'convenioNombre') || '—'],
            ['Moneda', valorColumna(opFicha, 'monedaCobroNombre') || '—'],
          ]},
          { titulo: 'Ruta', campos: [
            ['Origen', valorColumna(opFicha, 'origen') || '—'],
            ['Destino', valorColumna(opFicha, 'destino') || '—'],
            ['Kilometraje estimado', opFicha.kilometrajeEstimado ? `${Number(opFicha.kilometrajeEstimado).toLocaleString('en-US')} km` : '—'],
          ]},
          { titulo: 'Asignación', campos: [
            ['Unidad', valorColumna(opFicha, 'unidadNombre') || '—'],
            ['Operador', valorColumna(opFicha, 'operadorNombre') || '—'],
            ['Remolque', valorColumna(opFicha, 'numeroRemolque') || '—'],
          ]},
        ];
        return (
          <div className="est-overlay" onClick={() => setOpFicha(null)}>
            <div className="est-detalle est-ficha-op" onClick={(e) => e.stopPropagation()}>
              <div className="est-detalle-encabezado">
                <h3>
                  <span className={`est-detalle-ref est-ref-${claseLinea} est-ficha-ref`}>{opFicha.ref || opFicha.id}</span>
                  <span className="est-ficha-status">{valorColumna(opFicha, 'statusNombre') || 'Sin status'}</span>
                </h3>
                <div className="est-ficha-acciones">
                  <button className="est-btn est-btn-primario" onClick={() => abrirEdicionOperacion(opFicha)} disabled={cargandoCatalogos}>
                    {cargandoCatalogos ? 'Cargando…' : 'Editar'}
                  </button>
                  <button className="est-detalle-cerrar" onClick={() => setOpFicha(null)}><X size={16} /></button>
                </div>
              </div>
              <div className="est-detalle-cuerpo">
                {secciones.map(sec => (
                  <div className="est-ficha-seccion" key={sec.titulo}>
                    <span className="est-ficha-seccion-titulo">{sec.titulo}</span>
                    <div className="est-ficha-grid">
                      {sec.campos.map(([etq, val]) => (
                        <div className="est-ficha-campo" key={etq}>
                          <span className="est-detalle-titulo">{etq}</span>
                          <span className="est-ficha-valor">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ✅ Aviso mientras cargan los catálogos del formulario */}
      {cargandoCatalogos && (
        <div className="est-overlay" style={{ zIndex: 2900 }}><div className="est-cargando-form">Abriendo el formulario de Operaciones…</div></div>
      )}

      {/* ✅ MODAL: selección de columnas de la tabla de referencias */}
      {menuColumnas && (
        <div className="est-overlay" onClick={() => setMenuColumnas(false)}>
          <div className="est-cols-modal" onClick={(e) => e.stopPropagation()}>
            <div className="est-detalle-encabezado">
              <h3>Columnas visibles</h3>
              <button className="est-detalle-cerrar" onClick={() => setMenuColumnas(false)}><X size={16} /></button>
            </div>
            <div className="est-cols-modal-cuerpo">
              {COLUMNAS_REFS.map((c) => (
                <label className="est-cols-opcion" key={c.campo}>
                  <input
                    type="checkbox"
                    checked={columnasRefs.includes(c.campo)}
                    onChange={() => setColumnasRefs(prev => prev.includes(c.campo)
                      ? (prev.length > 1 ? prev.filter(x => x !== c.campo) : prev)
                      : [...prev, c.campo])}
                  />
                  {c.etiqueta}
                </label>
              ))}
            </div>
            <div className="est-cols-modal-pie">
              <button className="est-btn est-btn-primario" onClick={() => setMenuColumnas(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ EL MISMO FORMULARIO DE OPERACIONES, para editar desde aquí */}
      {editandoOp && catalogosForm && (
        // ✅ FIX: el FormularioOperacion trae z-index 1000 y la ficha de
        //   Estadísticas 2000 — el wrapper crea un stacking context por encima
        //   para que el formulario de edición se abra DELANTE, no detrás.
        <div style={{ position: 'relative', zIndex: 3000 }}>
        <FormularioOperacion
          estado="abierto"
          initialData={editandoOp}
          onClose={() => setEditandoOp(null)}
          onMinimize={() => { /* sin minimizado dentro de Estadísticas */ }}
          onRestore={() => { /* sin minimizado dentro de Estadísticas */ }}
          catalogosCacheados={catalogosForm}
          onSave={(opNueva) => {
            // Refrescar la operación en los datos ya cargados (sin re-consultar).
            setOps((prev) => prev.map((o) => (o.id === (opNueva?.id || editandoOp.id) ? { ...o, ...opNueva } : o)));
            setOpFicha((prev: Op | null) => prev && prev.id === (opNueva?.id || editandoOp.id) ? { ...prev, ...opNueva } : prev);
            setEditandoOp(null);
          }}
        />
        </div>
      )}

      {pestana === 'utilidad' && !cargando && (
        <p className="est-nota">Nota: para Transfer (flota propia) el costo de proveedor suele ser cero; su costo real (sueldos, diésel, casetas) vive en Nómina y Diésel y puede integrarse en una siguiente fase.</p>
      )}
    </div>
  );
}

export default EstadisticasDashboard;

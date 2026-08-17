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
import { useState, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';
import { cargarLogoDataUrl } from '../../../utils/pdfGenerator';
import { useEmpresaConfig } from '../../configuracion/useEmpresaConfig';
import { Download, RefreshCw, X, Settings2 } from 'lucide-react';
import { useEstadoPersistente } from '../../../hooks/useEstadoPersistente';
import { useEtiquetas } from '../../../contexts/EtiquetasContext';
import { FormularioOperacion } from '../../operaciones/components/FormularioOperacion';
import './EstadisticasDashboard.css';

const STATUS_CANCELADO_ID = '7607f692';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

type Linea = 'Transfer' | 'Logística' | 'Fletes' | 'Otro';
type Pestana = 'tendencia' | 'servicios' | 'ventas' | 'utilidad' | 'promedios';

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
  const esDolar = nombreMoneda.includes('USD') || nombreMoneda.includes('DOLAR') || nombreMoneda.includes('DÓLAR');
  const esPeso = nombreMoneda.includes('MXN') || nombreMoneda.includes('PESO');
  if (esDolar) return { dol: subtotal, pes: 0, conv: subtotal * tc, tc };
  if (esPeso) return { dol: 0, pes: subtotal, conv: subtotal, tc };
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
  const [pestana, setPestana] = useState<Pestana>('tendencia');
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
  const [refsFiltro, setRefsFiltro] = useState<{ etiqueta: string; ops: Op[] } | null>(null);
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
    if (campo === 'unidadNombre') return String(op.unidadNombre || op.unidad || '');
    if (campo === 'operadorNombre') return String(op.operadorNombre || op.operador || '');
    if (campo === 'clientePagaNombre') return String(op.clientePagaNombre || op.clienteNombre || '');
    // ✅ Origen/Destino: el nombre denormalizado, nunca el ID.
    if (campo === 'origen') return String(op.origenNombre || op.clienteOrigenNombre || '');
    if (campo === 'destino') return String(op.destinoNombre || op.clienteDestinoNombre || '');
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

  const detalle = useMemo(() => {
    if (detalleSel === null) return null;
    const delSel = detalleSel.ops;
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
      monedas,
      unidades: contarPor(delSel, (op) => String(op.unidadNombre || op.unidad || '')),
      operadores: contarPor(delSel, (op) => String(op.operadorNombre || op.operador || '')),
      clientes: contarPor(delSel, (op) => String(op.clientePagaNombre || op.clienteNombre || op.clientePaga || '')),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalleSel]);

  // Columnas activas y filas visibles de la tabla de referencias (tabla + export).
  const columnasActivas = useMemo(() => COLUMNAS_REFS.filter(c => columnasRefs.includes(c.campo)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnasRefs]);

  const refsVisibles = useMemo(() => {
    if (!refsFiltro) return [];
    return refsFiltro.ops.filter(op =>
      columnasActivas.every(c => {
        const f = (filtrosCols[c.campo] || '').trim().toLowerCase();
        if (!f) return true;
        return valorColumna(op, c.campo).toLowerCase().includes(f);
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsFiltro, columnasActivas, filtrosCols]);

  // ✅ EXPORTACIÓN del rubro seleccionado (Excel y PDF con membrete).
  const exportarRefsExcel = () => {
    if (!refsFiltro) return;
    const wb = XLSX.utils.book_new();
    const filas = refsVisibles.map(op => {
      const fila: Record<string, string> = {};
      columnasActivas.forEach(c => { fila[c.etiqueta] = valorColumna(op, c.campo) || '—'; });
      return fila;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Operaciones');
    XLSX.writeFile(wb, `Reporte_${refsFiltro.etiqueta.replace(/[^\w]+/g, '_')}_${fechaDesde}_a_${fechaHasta}.xlsx`);
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
                <div style="font-size:13px; font-weight:bold; margin-top:2px;">Reporte de Servicios — ${esc(refsFiltro.etiqueta)}</div>
                <div style="font-size:11px; color:#555; margin-top:2px;">Periodo: ${esc(fechaDesde)} al ${esc(fechaHasta)} · ${refsVisibles.length} operación(es)</div>
              </div>
            </div>
            <div style="font-size:11px; color:#555;">Generado: ${esc(new Date().toLocaleDateString('es-MX'))}</div>
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:9.5px;">
            <thead>
              <tr>${columnasActivas.map(c => `<th style="background:#f2f2f2; border:1px solid #ccc; padding:5px 6px; text-align:left;">${esc(c.etiqueta.toUpperCase())}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${refsVisibles.map(op => `<tr>${columnasActivas.map(c => `<td style="border:1px solid #ddd; padding:4px 6px;">${esc(valorColumna(op, c.campo) || '—')}</td>`).join('')}</tr>`).join('')}
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

      <div className="est-tabs">
        <button className={`est-tab${pestana === 'tendencia' ? ' activa' : ''}`} onClick={() => setPestana('tendencia')}>Tendencia por Cliente</button>
        <button className={`est-tab${pestana === 'servicios' ? ' activa' : ''}`} onClick={() => setPestana('servicios')}>Servicios</button>
        <button className={`est-tab${pestana === 'ventas' ? ' activa' : ''}`} onClick={() => setPestana('ventas')}>Ventas</button>
        <button className={`est-tab${pestana === 'utilidad' ? ' activa' : ''}`} onClick={() => setPestana('utilidad')}>Utilidad</button>
        <button className={`est-tab${pestana === 'promedios' ? ' activa' : ''}`} onClick={() => setPestana('promedios')}>Promedios</button>
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
                  <td>TOTAL DEL RANGO</td>
                  <td>{num(servicios.porMes.reduce((a, s) => a + s.transfer, 0))}</td>
                  <td>{num(servicios.porMes.reduce((a, s) => a + s.logistica, 0))}</td>
                  <td>{num(servicios.porMes.reduce((a, s) => a + s.fletes, 0))}</td>
                  <td className="est-monto">{num(servicios.porMes.reduce((a, s) => a + s.transfer + s.logistica + s.fletes, 0))}</td>
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
                <tr className="est-fila-general">
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* ✅ NUEVO: tabla completa de las operaciones del desglose */}
                <button type="button" className="est-detalle-cerrar" style={{ width: 'auto', padding: '4px 10px', fontSize: '0.78rem' }}
                  onClick={() => setRefsFiltro({ etiqueta: detalleSel.titulo, ops: detalle.ops })}>
                  Ver operaciones
                </button>
                <button className="est-detalle-cerrar" onClick={() => { setDetalleSel(null); setRefsFiltro(null); setFiltrosCols({}); setMenuColumnas(false); }}><X size={16} /></button>
              </div>
            </div>

            <div className="est-detalle-cuerpo">
              {(
              <div className="est-detalle-grid">
                {!detalleSel.esLinea && (
                  <div className="est-detalle-seccion">
                    <span className="est-detalle-titulo">Tipo de operación</span>
                    <div className="est-detalle-lista">
                      {(['Transfer', 'Logística', 'Fletes'] as Linea[]).map((l) => {
                        const pct = detalle.ops.length > 0 ? (detalle.porLinea[l] / detalle.ops.length) * 100 : 0;
                        const claseL = l === 'Transfer' ? 'transfer' : l === 'Logística' ? 'logistica' : 'fletes';
                        return detalle.porLinea[l] > 0
                          ? (
                            <button type="button" className="est-detalle-item clicable" key={l} onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · ${l}`, ops: detalle.ops.filter((op) => lineaDeOp(op) === l) })}>
                              <span className="est-item-linea"><i className={`est-punto ${claseL}`} />{l}</span>
                              <span className="est-item-cifras"><b>{num(detalle.porLinea[l])}</b><small>{pct.toFixed(0)}%</small></span>
                              <span className="est-item-barra"><i className={claseL} style={{ '--w': `${pct}%` } as React.CSSProperties} /></span>
                            </button>
                          )
                          : <span className="est-detalle-item apagado" key={l}><span className="est-item-linea"><i className={`est-punto ${claseL}`} />{l}</span><span className="est-item-cifras"><b>0</b></span></span>;
                      })}
                      {detalle.porLinea.Otro > 0 && (
                        <button type="button" className="est-detalle-item clicable" onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · Otro`, ops: detalle.ops.filter((op) => lineaDeOp(op) === 'Otro') })}><span>Otro</span><b>{num(detalle.porLinea.Otro)}</b></button>
                      )}
                    </div>
                  </div>
                )}

                <div className="est-detalle-seccion">
                  <span className="est-detalle-titulo">Movimiento</span>
                  <div className="est-detalle-lista">
                    {(['Importación', 'Exportación', 'Movimiento', 'Sin clasificar'] as const).map((mv) => {
                      const pct = detalle.ops.length > 0 ? (detalle.porMovimiento[mv] / detalle.ops.length) * 100 : 0;
                      return (mv !== 'Sin clasificar' || detalle.porMovimiento[mv] > 0) && (
                        detalle.porMovimiento[mv] > 0
                          ? (
                            <button type="button" className="est-detalle-item clicable" key={mv} onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · ${mv}`, ops: detalle.ops.filter((op) => movimientoDeOp(op) === mv) })}>
                              <span className="est-item-linea">{mv}</span>
                              <span className="est-item-cifras"><b>{num(detalle.porMovimiento[mv])}</b><small>{pct.toFixed(0)}%</small></span>
                              <span className="est-item-barra"><i className="neutra" style={{ '--w': `${pct}%` } as React.CSSProperties} /></span>
                            </button>
                          )
                          : <span className="est-detalle-item apagado" key={mv}><span className="est-item-linea">{mv}</span><span className="est-item-cifras"><b>0</b></span></span>
                      );
                    })}
                  </div>
                </div>

                <div className="est-detalle-seccion">
                  <span className="est-detalle-titulo">Trompo</span>
                  <div className="est-detalle-lista">
                    {detalle.trompos > 0
                      ? <button type="button" className="est-detalle-item clicable" onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · Trompo`, ops: detalle.ops.filter((op) => esTrompo(op)) })}><span>Operaciones Trompo</span><b>{num(detalle.trompos)}</b></button>
                      : <span className="est-detalle-item"><span>Operaciones Trompo</span><b>0</b></span>}
                  </div>
                </div>

                {/* ✅ NUEVO — MONEDA DE FACTURACIÓN (CLIENTE): qué se factura
                    en Dólares y qué en Pesos, con conteo y montos. */}
                <div className="est-detalle-seccion">
                  <span className="est-detalle-titulo">Moneda de facturación</span>
                  <div className="est-detalle-lista">
                    {detalle.monedas.USD.n > 0 ? (
                      <button type="button" className="est-detalle-item clicable" onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · Dólares (USD)`, ops: detalle.ops.filter((op) => monedaClienteDe(op) === 'USD') })}>
                        <span className="est-item-linea"><i className="est-punto transfer" />Dólares (USD)</span>
                        <span className="est-item-cifras"><b>{num(detalle.monedas.USD.n)}</b><small>{((detalle.monedas.USD.n / detalle.ops.length) * 100).toFixed(0)}%</small></span>
                        <span style={{ display: 'block', fontSize: '0.72rem', color: '#8b949e' }}>{money(detalle.monedas.USD.dol)} USD{detalle.monedas.USD.conv > 0 ? ` ≈ ${money(detalle.monedas.USD.conv)} MXN` : ''}</span>
                        <span className="est-item-barra"><i className="transfer" style={{ '--w': `${(detalle.monedas.USD.n / detalle.ops.length) * 100}%` } as React.CSSProperties} /></span>
                      </button>
                    ) : <span className="est-detalle-item apagado"><span className="est-item-linea"><i className="est-punto transfer" />Dólares (USD)</span><span className="est-item-cifras"><b>0</b></span></span>}
                    {detalle.monedas.MXN.n > 0 ? (
                      <button type="button" className="est-detalle-item clicable" onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · Pesos (MXN)`, ops: detalle.ops.filter((op) => monedaClienteDe(op) === 'MXN') })}>
                        <span className="est-item-linea"><i className="est-punto logistica" />Pesos (MXN)</span>
                        <span className="est-item-cifras"><b>{num(detalle.monedas.MXN.n)}</b><small>{((detalle.monedas.MXN.n / detalle.ops.length) * 100).toFixed(0)}%</small></span>
                        <span style={{ display: 'block', fontSize: '0.72rem', color: '#8b949e' }}>{money(detalle.monedas.MXN.pes)} MXN</span>
                        <span className="est-item-barra"><i className="logistica" style={{ '--w': `${(detalle.monedas.MXN.n / detalle.ops.length) * 100}%` } as React.CSSProperties} /></span>
                      </button>
                    ) : <span className="est-detalle-item apagado"><span className="est-item-linea"><i className="est-punto logistica" />Pesos (MXN)</span><span className="est-item-cifras"><b>0</b></span></span>}
                    {detalle.monedas.Mixta.n > 0 && (
                      <button type="button" className="est-detalle-item clicable" onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · Moneda mixta`, ops: detalle.ops.filter((op) => monedaClienteDe(op) === 'Mixta') })}>
                        <span className="est-item-linea"><i className="est-punto fletes" />Mixta (USD + MXN)</span>
                        <span className="est-item-cifras"><b>{num(detalle.monedas.Mixta.n)}</b></span>
                        <span style={{ display: 'block', fontSize: '0.72rem', color: '#8b949e' }}>{money(detalle.monedas.Mixta.dol)} USD + {money(detalle.monedas.Mixta.pes)} MXN</span>
                      </button>
                    )}
                    {detalle.monedas['Sin dato'].n > 0 && (
                      <button type="button" className="est-detalle-item clicable" onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · Sin moneda`, ops: detalle.ops.filter((op) => monedaClienteDe(op) === 'Sin dato') })}>
                        <span>Sin dato de moneda</span><b>{num(detalle.monedas['Sin dato'].n)}</b>
                      </button>
                    )}
                  </div>
                </div>

                <div className="est-detalle-seccion">
                  <span className="est-detalle-titulo">Unidades ({detalle.unidades.length})</span>
                  <div className="est-detalle-lista">
                    {detalle.unidades.map(([nombre, cuantas]) => {
                      const pct = detalle.ops.length > 0 ? (cuantas / detalle.ops.length) * 100 : 0;
                      return (
                        <button type="button" className="est-detalle-item clicable" key={nombre} onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · Unidad ${nombre}`, ops: detalle.ops.filter((op) => ((String(op.unidadNombre || op.unidad || '').trim()) || '(Sin dato)') === nombre) })}>
                          <span className="est-item-linea">{nombre}</span>
                          <span className="est-item-cifras"><b>{num(cuantas)}</b><small>{pct.toFixed(0)}%</small></span>
                          <span className="est-item-barra"><i className="neutra" style={{ '--w': `${pct}%` } as React.CSSProperties} /></span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="est-detalle-seccion">
                  <span className="est-detalle-titulo">Operadores ({detalle.operadores.length})</span>
                  <div className="est-detalle-lista">
                    {detalle.operadores.map(([nombre, cuantas]) => {
                      const pct = detalle.ops.length > 0 ? (cuantas / detalle.ops.length) * 100 : 0;
                      return (
                        <button type="button" className="est-detalle-item clicable" key={nombre} onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · Operador ${nombre}`, ops: detalle.ops.filter((op) => ((String(op.operadorNombre || op.operador || '').trim()) || '(Sin dato)') === nombre) })}>
                          <span className="est-item-linea">{nombre}</span>
                          <span className="est-item-cifras"><b>{num(cuantas)}</b><small>{pct.toFixed(0)}%</small></span>
                          <span className="est-item-barra"><i className="neutra" style={{ '--w': `${pct}%` } as React.CSSProperties} /></span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {!detalleSel.ocultarClientes && (
                <div className="est-detalle-seccion">
                  <span className="est-detalle-titulo">Clientes ({detalle.clientes.length})</span>
                  <div className="est-detalle-lista">
                    {detalle.clientes.map(([nombre, cuantas]) => {
                      const pct = detalle.ops.length > 0 ? (cuantas / detalle.ops.length) * 100 : 0;
                      return (
                        <button type="button" className="est-detalle-item clicable" key={nombre} onClick={() => setRefsFiltro({ etiqueta: `${detalleSel.titulo} · ${nombre}`, ops: detalle.ops.filter((op) => ((String(op.clientePagaNombre || op.clienteNombre || op.clientePaga || '').trim()) || '(Sin dato)') === nombre) })}>
                          <span className="est-item-linea">{nombre}</span>
                          <span className="est-item-cifras"><b>{num(cuantas)}</b><small>{pct.toFixed(0)}%</small></span>
                          <span className="est-item-barra"><i className="neutra" style={{ '--w': `${pct}%` } as React.CSSProperties} /></span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                )}
              </div>
              )}
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
                      <button className="est-btn" onClick={() => setMenuColumnas(true)}>
                        <Settings2 size={14} /> Columnas
                      </button>
                      <button className="est-btn" onClick={exportarRefsExcel}>
                        <Download size={14} /> Excel
                      </button>
                      <button className="est-btn est-btn-primario" onClick={exportarRefsPDF} disabled={exportando}>
                        <Download size={14} /> {exportando ? 'Generando…' : 'PDF'}
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const columnas = columnasActivas;
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
                              <tr>{columnas.map(c => <th key={c.campo}>{c.etiqueta.toUpperCase()}</th>)}</tr>
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
                                return (
                                  <tr key={op.id} className="est-fila-clicable" onClick={() => setOpFicha(op)} title={`Ver el detalle de ${op.ref || op.id}`}>
                                    {columnas.map(c => (
                                      <td key={c.campo} className={c.campo === 'ref' ? `est-celda-ref est-ref-${claseLinea}` : ''}>
                                        {valorColumna(op, c.campo) || '—'}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
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
            ['Movimiento', movimientoDeOp(opFicha)],
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
        <div className="est-overlay"><div className="est-cargando-form">Abriendo el formulario de Operaciones…</div></div>
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
      )}

      {pestana === 'utilidad' && !cargando && (
        <p className="est-nota">Nota: para Transfer (flota propia) el costo de proveedor suele ser cero; su costo real (sueldos, diésel, casetas) vive en Nómina y Diésel y puede integrarse en una siguiente fase.</p>
      )}
    </div>
  );
}

export default EstadisticasDashboard;

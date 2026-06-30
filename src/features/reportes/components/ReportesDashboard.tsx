// src/features/reportes/components/ReportesDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// MÓDULO DE REPORTES (operaciones)
// ═══════════════════════════════════════════════════════════════════════
// Todos los reportes salen de la colección `operaciones`, filtrando por
// `fechaServicio` (YYYY-MM-DD) dentro del rango elegido.
//
// Reportes incluidos:
//   1. Reporte diario de Transfer        (detalle)
//   2. Reporte diario de Logística       (detalle)
//   3. Reporte diario de Fletes          (detalle)
//   4. Operaciones por semana            (matriz por día: Transfer/Cruces/Fletes/Servicios)
//   5. Promedio mensual de operaciones   (matriz por mes + Acumulado + Promedio)
//   6. Resumen por estatus               (bonus)
//   7. Resumen por cliente               (bonus)
//
// Conteo: CRUCES = Logística. SERVICIOS = Transfer + Cruces + Fletes.
//   NO COBRABLES = statusNombre con "cancel" / "no cobrable".
//   TOTAL = Servicios − No cobrables.
//   PROMEDIO MENSUAL = Acumulado ÷ (meses con datos).
//
// Export EXCEL con logo + estilo profesional (ExcelJS) y PDF con logo
// (ventana de impresión → "Guardar como PDF"). Ambos muestran el rango.
// Los reportes resuelven IDs → NOMBRES (empresas, convenios, status, tipos).
//
// IMPORTANTE: el export a Excel usa ExcelJS. Instálalo una vez con:
//   npm install exceljs
// RUTA: src/features/reportes/components/ReportesDashboard.tsx
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
// ✅ Logo de la empresa (mismo base64 que usan los PDF) para ambos exports
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';
// ✅ NUEVO: Resúmenes Diarios (Transfer / Logística / Fletes) en PDF.
import { ResumenDiarioOperaciones } from './ResumenDiarioOperaciones';

// Palabras clave (normalizadas) que marcan una operación como NO COBRABLE
const KEYWORDS_NO_COBRABLE = ['cancel', 'no cobrable'];

// ✅ NUEVO: palabras clave (normalizadas) que marcan un estatus como COMPLETADO.
//   Se usa en el filtro "Solo completados" del reporte de ventas. Si tus estatus
//   de completado se llaman distinto, agrega aquí la palabra (en minúsculas y
//   sin acentos), o usa la opción de estatus exacto del selector.
const KEYWORDS_COMPLETADO = ['complet', 'finaliz', 'entregad'];

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const norm = (s: any): string =>
  String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// ✅ NUEVO: detecta si un valor "parece" un ID (hex de catálogo o auto-id de Firestore),
//   para nunca mostrar IDs crudos cuando no se pudo resolver el nombre.
const esId = (v: any): boolean => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return /^[0-9a-f]{6,}$/i.test(s) || /^[A-Za-z0-9]{18,}$/.test(s);
};

// Parse "YYYY-MM-DD" → Date local (sin corrimiento de zona)
const parseFecha = (f: any): Date | null => {
  const s = String(f || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

// ✅ NUEVO: normaliza CUALQUIER formato de fecha guardado en `fechaServicio`
//   (ISO "YYYY-MM-DD", ISO con hora, "DD/MM/YYYY", Timestamp de Firestore,
//   epoch, etc.) a "YYYY-MM-DD". Devuelve '' si no se puede. Esto es clave:
//   antes la consulta filtraba por rango con `where` sobre TEXTO, así que solo
//   aparecían las operaciones cuya fecha ya estaba en ISO; las demás (formato
//   viejo) se perdían. Ahora se baja todo y se filtra en memoria con esto.
const normalizarFechaISO = (valor: any): string => {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'object') {
    try {
      if (typeof valor.toDate === 'function') { const d = valor.toDate(); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); }
      if (typeof valor.seconds === 'number') return new Date(valor.seconds * 1000).toISOString().slice(0, 10);
      if (valor instanceof Date && !isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
    } catch { /* sigue abajo */ }
    return '';
  }
  if (typeof valor === 'number') {
    const d = new Date(valor > 1e12 ? valor : valor * 1000);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(valor).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    const a = Number(m[1]), b = Number(m[2]);
    let dd = a, mm = b;
    if (a <= 12 && b > 12) { mm = a; dd = b; }
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
const fmtFechaCorta = (f: any): string => {
  const d = parseFecha(f);
  if (!d) return String(f || '-');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtMoneda = (v: any): string =>
  `$ ${(Number(v) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ✅ NUEVO: extrae el consecutivo de una referencia tipo "R-240626-002" → 2.
//   Toma el ÚLTIMO grupo de dígitos de la referencia. -1 si no hay.
const consecutivoDeRef = (ref: any): number => {
  const grupos = String(ref || '').match(/\d+/g);
  if (!grupos || !grupos.length) return -1;
  const n = Number(grupos[grupos.length - 1]);
  return isNaN(n) ? -1 : n;
};

// ✅ NUEVO: comparador para ordenar registros: 1º por fecha DESCENDENTE
//   (más reciente primero), 2º por consecutivo de la referencia DESCENDENTE.
const compararPorFechaYConsecutivo = (a: any, b: any): number => {
  const fa = String(a._fechaISO || a.fechaServicio || '');
  const fb = String(b._fechaISO || b.fechaServicio || '');
  if (fa !== fb) return fb.localeCompare(fa);                 // fecha desc
  return consecutivoDeRef(b.ref) - consecutivoDeRef(a.ref);   // consecutivo desc
};

// Semana del mes (lunes inicia semana), 1-based — replica la lógica de tu Excel
const semanaDelMes = (d: Date): number => {
  const primero = new Date(d.getFullYear(), d.getMonth(), 1);
  const isoWeekdayPrimero = (primero.getDay() + 6) % 7; // lunes=0 ... domingo=6
  return Math.floor((d.getDate() - 1 + isoWeekdayPrimero) / 7) + 1;
};

// ✅ NUEVO: catálogo de MÓDULOS. Cada módulo apunta a una colección de Firestore
//   y al campo que contiene la fecha para filtrar por rango. Como este dashboard
//   reúne reportes de VARIOS módulos, el selector de Módulo decide de dónde salen
//   los datos. ⚠️ AJUSTA `coleccion` y `campoFecha` al nombre REAL de tus
//   colecciones/campos en Firestore (Operaciones ya está correcto).
interface ModuloDef { id: string; nombre: string; coleccion: string; campoFecha: string; }
const MODULOS: ModuloDef[] = [
  { id: 'operaciones',             nombre: 'Operaciones (Logística)',     coleccion: 'operaciones',                campoFecha: 'fechaServicio' },
  { id: 'facturacion_clientes',    nombre: 'Facturación a Clientes',      coleccion: 'facturas_clientes',          campoFecha: 'fecha' },
  { id: 'facturacion_proveedores', nombre: 'Facturación a Proveedores',   coleccion: 'facturas_proveedores',       campoFecha: 'fecha' },
  { id: 'gastos',                  nombre: 'Gastos',                      coleccion: 'gastos',                     campoFecha: 'fecha' },
  { id: 'nomina',                  nombre: 'Nómina',                      coleccion: 'nominas',                    campoFecha: 'fecha' },
  { id: 'diesel',                  nombre: 'Diésel / Combustible',        coleccion: 'referencias_diesel',         campoFecha: 'fecha' },
];

// ✅ NUEVO: campos crudos (de la colección) que NO conviene ofrecer como columna.
const CAMPOS_OCULTOS_SIEMPRE = new Set(['id', '_fechaISO']);

// ✅ NUEVO: monedas conocidas por ID (respaldo si no están en catalogo_moneda).
const MONEDA_FALLBACK: Record<string, string> = { '7dca62b3': 'USD', 'f95d8894': 'MXN' };

// ✅ NUEVO: convierte una clave de campo ("subtotalCliente") en una etiqueta
//   legible ("Subtotal Cliente") para mostrarla como nombre de columna.
const prettyCampo = (k: string): string => {
  const s = String(k || '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : k;
};

// Prefijo para columnas que leen un campo CRUDO de la colección (para no chocar
// con las columnas "bonitas" sugeridas que ya resuelven IDs→nombres).
const RAW_PREFIX = 'raw__';

// ¿El campo parece monetario? (para formatear como $ en columnas crudas)
const esCampoMonetario = (k: string): boolean =>
  /(monto|subtotal|total|utilidad|costo|tarifa|pago|cargo|importe|precio|sueldo|combustible|conversion|dolares|pesos)/i.test(k);

interface Columna { key: string; label: string; align?: 'left' | 'right' | 'center'; defaultHidden?: boolean; }
interface ResumenItem { label: string; valor: string; }
interface ReporteResult {
  titulo: string;
  columnas: Columna[];
  filas: any[][];           // valores ya formateados para mostrar/exportar
  resumen?: ResumenItem[];
  weekendFlags?: boolean[]; // por fila (solo reporte semanal): sombrea fin de semana
}

interface Ctx {
  ops: any[];
  desde: string;
  hasta: string;
  clasificarTipo: (op: any) => 'Transfer' | 'Logística' | 'Fletes' | 'Otro';
  esNoCobrable: (op: any) => boolean;
  statusNombreDe: (op: any) => string;
  // ✅ NUEVO: predicado del filtro de estatus (true = la operación se incluye).
  pasaFiltroStatus: (op: any) => boolean;
  // ✅ NUEVO: resolución de IDs → nombres
  nombreEmpresa: (id: any, desnorm?: any) => string;
  nombreConvenio: (id: any, desnorm?: any) => string;
  // ✅ NUEVO: universo de campos crudos de la colección + lector formateado.
  camposColeccion: string[];
  valorCrudo: (op: any, campo: string) => any;
}

export const ReportesDashboard = () => {
  const hoy = new Date();
  const ini = `${hoy.getFullYear()}-01-01`;
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  const [desde, setDesde] = useState(ini);
  const [hasta, setHasta] = useState(hoyStr);
  const [moduloId, setModuloId] = useState('operaciones');
  const [reporteId, setReporteId] = useState('semanal');
  // ✅ NUEVO: filtro de estatus para el reporte de ventas.
  //   'todos' | 'completados' | 's::<NombreExactoDelEstatus>'
  const [statusFiltro, setStatusFiltro] = useState('todos');
  // ✅ NUEVO: lista de estatus disponibles (del catálogo) para el selector.
  const [statusOpciones, setStatusOpciones] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ReporteResult | null>(null);

  // ✅ NUEVO: configuración de columnas POR reporte (cuáles se ven y en qué
  //   orden). Se guarda por id de reporte para que cada reporte recuerde su
  //   propia selección. Se aplica en la tabla, el Excel y el PDF.
  type ColCfg = { key: string; label: string; align?: 'left' | 'right' | 'center'; visible: boolean };
  const [colConfigs, setColConfigs] = useState<Record<string, ColCfg[]>>({});
  const [modalColumnas, setModalColumnas] = useState(false);
  // ✅ NUEVO: modal de Resúmenes Diarios (Transfer / Logística / Fletes).
  const [mostrarResumenDiario, setMostrarResumenDiario] = useState(false);
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);
  const [filtroCol, setFiltroCol] = useState('');          // buscador dentro del modal
  const [guardandoCols, setGuardandoCols] = useState(false); // estado del botón Guardar
  const cargadosCfgRef = useRef<Set<string>>(new Set());     // cfgKeys ya leídos de Firestore

  // Caches de catálogos para resolver tipo/estatus/empresa/convenio
  const [tiposPorId, setTiposPorId] = useState<Record<string, string>>({});
  const [statusPorId, setStatusPorId] = useState<Record<string, string>>({});
  const [empresasPorId, setEmpresasPorId] = useState<Record<string, string>>({});
  const [convenioPorId, setConvenioPorId] = useState<Record<string, string>>({});
  const [remolquesPorId, setRemolquesPorId] = useState<Record<string, string>>({});
  const [unidadesPorId, setUnidadesPorId] = useState<Record<string, string>>({});
  const [operadoresPorId, setOperadoresPorId] = useState<Record<string, string>>({});
  const [monedasPorId, setMonedasPorId] = useState<Record<string, string>>({});

  const cargarCatalogos = async () => {
    if (Object.keys(tiposPorId).length > 0 && Object.keys(empresasPorId).length > 0) {
      return { t: tiposPorId, s: statusPorId, emp: empresasPorId, conv: convenioPorId, rem: remolquesPorId, uni: unidadesPorId, ope: operadoresPorId, mon: monedasPorId };
    }
    try {
      const [tSnap, sSnap, eSnap, cdSnap, tarSnap, remSnap, uniSnap, opSnap, monSnap] = await Promise.all([
        getDocs(collection(db, 'catalogo_tipo_operacion')),
        getDocs(collection(db, 'catalogo_status_servicio')),
        getDocs(collection(db, 'empresas')),
        getDocs(collection(db, 'convenios_clientes_detalles')),
        getDocs(collection(db, 'catalogo_tarifas_referencia')),
        getDocs(collection(db, 'remolques')),
        getDocs(collection(db, 'unidades')),
        getDocs(collection(db, 'empleados')),
        getDocs(collection(db, 'catalogo_moneda')),
      ]);

      const t: Record<string, string> = {};
      tSnap.docs.forEach(d => { t[d.id] = String((d.data() as any).tipo_operacion || ''); });

      const s: Record<string, string> = {};
      sSnap.docs.forEach(d => { s[d.id] = String((d.data() as any).nombre || ''); });

      const emp: Record<string, string> = {};
      eSnap.docs.forEach(d => { emp[d.id] = String((d.data() as any).nombre || ''); });

      // Remolque → "nombre placas" (igual que en el formulario de operación)
      const rem: Record<string, string> = {};
      remSnap.docs.forEach(d => {
        const r = d.data() as any;
        const txt = `${r.nombre || ''} ${r.placas || r.placa || ''}`.trim();
        if (txt) rem[d.id] = txt;
      });

      // Unidad → "unidad" o "nombre"
      const uni: Record<string, string> = {};
      uniSnap.docs.forEach(d => {
        const u = d.data() as any;
        const txt = String(u.unidad || u.nombre || '').trim();
        if (txt) uni[d.id] = txt;
      });

      // Operador (empleado) → "nombre apellido"
      const ope: Record<string, string> = {};
      opSnap.docs.forEach(d => {
        const o = d.data() as any;
        const txt = `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim() || String(o.nombre || o.nombreCompleto || '').trim();
        if (txt) ope[d.id] = txt;
      });

      // Moneda → "moneda" (USD/MXN…), con respaldo de IDs conocidos.
      const mon: Record<string, string> = { ...MONEDA_FALLBACK };
      monSnap.docs.forEach(d => {
        const m = d.data() as any;
        const txt = String(m.moneda || m.nombre || m.clave || m.codigo || '').trim();
        if (txt) mon[d.id] = txt;
      });

      // Mapa de tarifas (para nombrar convenios)
      const tarifas: Record<string, string> = {};
      tarSnap.docs.forEach(d => {
        const data = d.data() as any;
        tarifas[d.id] = String(data.descripcion || data.nombre || '');
      });

      // Convenio (detalle del cliente) → nombre de su tarifa
      const conv: Record<string, string> = {};
      cdSnap.docs.forEach(d => {
        const data = d.data() as any;
        const tarifaId = data.tipoConvenioId || data.tipo_convenio_id || data.tipoConvenio || data.tipo_convenio || data['TIPO DE CONVENIO'];
        const nombre = tarifas[String(tarifaId)] || '';
        if (nombre) conv[d.id] = nombre;
      });

      setTiposPorId(t);
      setStatusPorId(s);
      setEmpresasPorId(emp);
      setConvenioPorId(conv);
      setRemolquesPorId(rem);
      setUnidadesPorId(uni);
      setOperadoresPorId(ope);
      setMonedasPorId(mon);
      return { t, s, emp, conv, rem, uni, ope, mon };
    } catch (e) {
      console.error('Error cargando catálogos de reportes:', e);
      return { t: tiposPorId, s: statusPorId, emp: empresasPorId, conv: convenioPorId, rem: remolquesPorId, uni: unidadesPorId, ope: operadoresPorId, mon: monedasPorId };
    }
  };

  // ✅ NUEVO: carga (una vez) los nombres de estatus del catálogo para poblar el
  //   selector "Estatus a incluir". Es independiente de cargarCatalogos (que solo
  //   corre al Generar) para que el selector ya tenga opciones desde el inicio.
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'catalogo_status_servicio'));
        const nombres = snap.docs
          .map(d => String((d.data() as any).nombre || '').trim())
          .filter(Boolean);
        if (activo) setStatusOpciones(Array.from(new Set(nombres)).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })));
      } catch (e) { console.warn('No se pudieron cargar los estatus para el filtro:', e); }
    })();
    return () => { activo = false; };
  }, []);

  // ---------------- Registro de reportes ----------------
  // `soloOperaciones`: el reporte depende de la lógica de Operaciones (tipo,
  //   estatus, etc.) y solo aplica a ese módulo. El "Listado de registros" es
  //   genérico y funciona para CUALQUIER módulo.
  const reportes: { id: string; nombre: string; soloOperaciones?: boolean; build: (ctx: Ctx) => ReporteResult }[] = useMemo(() => [
    { id: 'diario_transfer', nombre: 'Reporte de ventas de Transfer', soloOperaciones: true, build: (c) => reporteDetalle(c, 'Transfer') },
    { id: 'diario_logistica', nombre: 'Reporte de ventas de Logística', soloOperaciones: true, build: (c) => reporteDetalle(c, 'Logística') },
    { id: 'diario_fletes', nombre: 'Reporte de ventas de Fletes', soloOperaciones: true, build: (c) => reporteDetalle(c, 'Fletes') },
    { id: 'semanal', nombre: 'Operaciones por semana', soloOperaciones: true, build: (c) => reporteSemanal(c) },
    { id: 'mensual', nombre: 'Promedio mensual de operaciones', soloOperaciones: true, build: (c) => reporteMensual(c) },
    { id: 'por_estatus', nombre: 'Resumen por estatus', soloOperaciones: true, build: (c) => reportePorEstatus(c) },
    { id: 'por_cliente', nombre: 'Resumen por cliente', soloOperaciones: true, build: (c) => reportePorCliente(c) },
    { id: 'listado', nombre: 'Listado de registros (todos los campos)', build: (c) => reporteListado(c) },
  ], []);

  // Reportes disponibles para el módulo elegido. Operaciones → todos.
  //   Otros módulos → solo el listado genérico.
  const reportesDelModulo = useMemo(
    () => (moduloId === 'operaciones' ? reportes : reportes.filter(r => !r.soloOperaciones)),
    [moduloId, reportes]
  );

  // ---------------- Builders ----------------
  function reporteDetalle(c: Ctx, tipo: 'Transfer' | 'Logística' | 'Fletes'): ReporteResult {
    const filtradas = c.ops
      .filter(op => c.clasificarTipo(op) === tipo)
      .filter(op => c.pasaFiltroStatus(op))
      .sort(compararPorFechaYConsecutivo);

    // Columnas "bonitas" sugeridas (resuelven IDs→nombres). Visibles por defecto.
    const columnasBase: Columna[] = [
      { key: 'fecha', label: 'Fecha' },
      { key: 'ref', label: 'Referencia' },
      { key: 'cliente', label: 'Cliente' },
      { key: 'convenio', label: 'Convenio' },
      { key: 'origen', label: 'Origen' },
      { key: 'destino', label: 'Destino' },
      { key: 'status', label: 'Estatus' },
      { key: 'subtotal', label: 'Subtotal', align: 'right' },
      { key: 'utilidad', label: 'Utilidad', align: 'right' },
    ];
    const valorBase = (op: any): any[] => [
      fmtFechaCorta(op.fechaServicio),
      op.ref || String(op.id || '').substring(0, 6),
      c.nombreEmpresa(op.clientePaga || op.clienteId, op.clienteNombre || op.nombreCliente) || '-',
      c.nombreConvenio(op.convenio, op.convenioNombre) || '-',
      c.nombreEmpresa(op.origen, op.origenNombre) || '-',
      c.nombreEmpresa(op.destino, op.destinoNombre) || '-',
      c.statusNombreDe(op) || '-',
      fmtMoneda(op.subtotalCliente),
      fmtMoneda(op.utilidadEstimada),
    ];

    // ✅ NUEVO: TODOS los demás campos crudos de la colección como columnas
    //   adicionales (ocultas por defecto). Así el usuario puede acomodarlas en
    //   el modal "Columnas" y agregar cualquier dato del registro al reporte.
    const columnasCrudas: Columna[] = c.camposColeccion.map(campo => ({
      key: `${RAW_PREFIX}${campo}`,
      label: prettyCampo(campo),
      align: esCampoMonetario(campo) ? 'right' : 'left',
      defaultHidden: true,
    }));

    const columnas: Columna[] = [...columnasBase, ...columnasCrudas];
    const filas = filtradas.map(op => [
      ...valorBase(op),
      ...c.camposColeccion.map(campo => c.valorCrudo(op, campo)),
    ]);

    const totalSub = filtradas.reduce((s, op) => s + (Number(op.subtotalCliente) || 0), 0);
    const totalUtil = filtradas.reduce((s, op) => s + (Number(op.utilidadEstimada) || 0), 0);
    return {
      titulo: `Reporte de ventas de ${tipo}`,
      columnas, filas,
      resumen: [
        { label: 'Operaciones', valor: String(filtradas.length) },
        { label: 'Subtotal', valor: fmtMoneda(totalSub) },
        { label: 'Utilidad', valor: fmtMoneda(totalUtil) },
      ],
    };
  }

  // ✅ NUEVO: reporte de LISTADO genérico para CUALQUIER módulo. Muestra TODOS
  //   los campos de la colección (el usuario elige/ordena en el modal "Columnas").
  function reporteListado(c: Ctx): ReporteResult {
    const moduloNombre = (MODULOS.find(m => m.id === moduloId) || MODULOS[0]).nombre;
    const columnas: Columna[] = c.camposColeccion.map(campo => ({
      key: `${RAW_PREFIX}${campo}`,
      label: prettyCampo(campo),
      align: esCampoMonetario(campo) ? 'right' : 'left',
    }));
    const filas = c.ops.map(op => c.camposColeccion.map(campo => c.valorCrudo(op, campo)));
    return {
      titulo: `Listado · ${moduloNombre}`,
      columnas, filas,
      resumen: [{ label: 'Registros', valor: String(c.ops.length) }],
    };
  }

  function reporteSemanal(c: Ctx): ReporteResult {
    const dDesde = parseFecha(c.desde), dHasta = parseFecha(c.hasta);
    if (!dDesde || !dHasta) return { titulo: 'Operaciones por semana', columnas: [], filas: [] };

    // Conteos por fecha (YYYY-MM-DD) y tipo
    const porFecha: Record<string, { Transfer: number; Logística: number; Fletes: number }> = {};
    c.ops.forEach(op => {
      const f = String(op.fechaServicio || '').slice(0, 10);
      if (!f) return;
      const tipo = c.clasificarTipo(op);
      if (tipo === 'Otro') return;
      (porFecha[f] = porFecha[f] || { Transfer: 0, 'Logística': 0, Fletes: 0 } as any)[tipo]++;
    });

    const columnas: Columna[] = [
      { key: 'mes', label: 'Mes' },
      { key: 'semana', label: 'Semana' },
      { key: 'dia', label: 'Día' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'transfer', label: 'Transfer', align: 'right' },
      { key: 'cruces', label: 'Cruces', align: 'right' },
      { key: 'fletes', label: 'Fletes', align: 'right' },
      { key: 'servicios', label: 'Servicios', align: 'right' },
    ];

    const filas: any[][] = [];
    const weekendFlags: boolean[] = [];
    let tT = 0, tC = 0, tF = 0;

    const cur = new Date(dDesde);
    while (cur <= dHasta) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const cnt = porFecha[key] || { Transfer: 0, 'Logística': 0, Fletes: 0 };
      const serv = cnt.Transfer + cnt['Logística'] + cnt.Fletes;
      tT += cnt.Transfer; tC += cnt['Logística']; tF += cnt.Fletes;
      const dow = cur.getDay();
      filas.push([
        MESES[cur.getMonth()].toUpperCase(),
        `Semana ${semanaDelMes(cur)}`,
        DIAS[dow],
        fmtFechaCorta(key),
        cnt.Transfer || '',
        cnt['Logística'] || '',
        cnt.Fletes || '',
        serv || '',
      ]);
      weekendFlags.push(dow === 0 || dow === 6);
      cur.setDate(cur.getDate() + 1);
    }

    return {
      titulo: 'Operaciones por semana',
      columnas, filas, weekendFlags,
      resumen: [
        { label: 'Transfer', valor: String(tT) },
        { label: 'Cruces', valor: String(tC) },
        { label: 'Fletes', valor: String(tF) },
        { label: 'Servicios', valor: String(tT + tC + tF) },
      ],
    };
  }

  function reporteMensual(c: Ctx): ReporteResult {
    const dDesde = parseFecha(c.desde), dHasta = parseFecha(c.hasta);
    if (!dDesde || !dHasta) return { titulo: 'Promedio mensual de operaciones', columnas: [], filas: [] };

    // Lista de meses del rango (YYYY-MM)
    const claves: string[] = [];
    const cur = new Date(dDesde.getFullYear(), dDesde.getMonth(), 1);
    const fin = new Date(dHasta.getFullYear(), dHasta.getMonth(), 1);
    while (cur <= fin) { claves.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`); cur.setMonth(cur.getMonth() + 1); }

    const acc: Record<string, { Transfer: number; Logística: number; Fletes: number; noCob: number }> = {};
    claves.forEach(k => { acc[k] = { Transfer: 0, 'Logística': 0, Fletes: 0, noCob: 0 }; });
    c.ops.forEach(op => {
      const f = String(op.fechaServicio || '').slice(0, 10);
      const k = f.slice(0, 7);
      if (!acc[k]) return;
      const tipo = c.clasificarTipo(op);
      if (tipo !== 'Otro') acc[k][tipo]++;
      if (c.esNoCobrable(op)) acc[k].noCob++;
    });

    const columnas: Columna[] = [
      { key: 'mes', label: 'Mes' },
      { key: 'transfer', label: 'Transfer', align: 'right' },
      { key: 'cruces', label: 'Cruces', align: 'right' },
      { key: 'fletes', label: 'Fletes', align: 'right' },
      { key: 'servicios', label: 'Servicios', align: 'right' },
      { key: 'noCob', label: 'No Cobrables', align: 'right' },
      { key: 'total', label: 'Total', align: 'right' },
      { key: 'prom', label: 'Prom. diario', align: 'right' },
    ];

    const filas: any[][] = [];
    let aT = 0, aC = 0, aF = 0, aS = 0, aN = 0, aTot = 0;
    let mesesConDatos = 0;

    claves.forEach(k => {
      const [y, m] = k.split('-').map(Number);
      const v = acc[k];
      const serv = v.Transfer + v['Logística'] + v.Fletes;
      const total = serv - v.noCob;
      const dias = new Date(y, m, 0).getDate();
      const prom = dias > 0 ? Math.round(total / dias) : 0;
      const hayDatos = serv > 0 || v.noCob > 0;
      if (hayDatos) mesesConDatos++;
      aT += v.Transfer; aC += v['Logística']; aF += v.Fletes; aS += serv; aN += v.noCob; aTot += total;
      filas.push([`${MESES[m - 1]} ${y}`, v.Transfer, v['Logística'], v.Fletes, serv, v.noCob, total, prom]);
    });

    // Acumulado
    filas.push(['ACUMULADO', aT, aC, aF, aS, aN, aTot, '']);
    // Promedio mensual = acumulado / meses con datos
    const div = mesesConDatos || 1;
    filas.push([
      'PROMEDIO MENSUAL',
      Math.round(aT / div), Math.round(aC / div), Math.round(aF / div),
      Math.round(aS / div), Math.round(aN / div), Math.round(aTot / div), '',
    ]);

    return {
      titulo: 'Promedio mensual de operaciones',
      columnas, filas,
      resumen: [
        { label: 'Servicios', valor: String(aS) },
        { label: 'No cobrables', valor: String(aN) },
        { label: 'Total', valor: String(aTot) },
        { label: 'Meses con datos', valor: String(mesesConDatos) },
      ],
    };
  }

  function reportePorEstatus(c: Ctx): ReporteResult {
    const conteo: Record<string, number> = {};
    c.ops.forEach(op => { const n = c.statusNombreDe(op) || 'Sin status'; conteo[n] = (conteo[n] || 0) + 1; });
    const filas = Object.entries(conteo)
      .sort((a, b) => b[1] - a[1])
      .map(([n, q]) => [n, q]);
    return {
      titulo: 'Resumen por estatus',
      columnas: [{ key: 'status', label: 'Estatus' }, { key: 'cant', label: 'Operaciones', align: 'right' }],
      filas,
      resumen: [{ label: 'Operaciones', valor: String(c.ops.length) }, { label: 'Estatus distintos', valor: String(filas.length) }],
    };
  }

  function reportePorCliente(c: Ctx): ReporteResult {
    const agg: Record<string, { cant: number; sub: number; util: number }> = {};
    c.ops.forEach(op => {
      const cli = c.nombreEmpresa(op.clientePaga || op.clienteId, op.clienteNombre || op.nombreCliente) || 'Sin cliente';
      const a = (agg[cli] = agg[cli] || { cant: 0, sub: 0, util: 0 });
      a.cant++; a.sub += Number(op.subtotalCliente) || 0; a.util += Number(op.utilidadEstimada) || 0;
    });
    const filas = Object.entries(agg)
      .sort((a, b) => b[1].cant - a[1].cant)
      .map(([cli, a]) => [cli, a.cant, fmtMoneda(a.sub), fmtMoneda(a.util)]);
    return {
      titulo: 'Resumen por cliente',
      columnas: [
        { key: 'cliente', label: 'Cliente' },
        { key: 'cant', label: 'Operaciones', align: 'right' },
        { key: 'sub', label: 'Subtotal', align: 'right' },
        { key: 'util', label: 'Utilidad', align: 'right' },
      ],
      filas,
      resumen: [{ label: 'Clientes', valor: String(filas.length) }, { label: 'Operaciones', valor: String(c.ops.length) }],
    };
  }

  // ---------------- Generar ----------------
  const generar = async () => {
    if (desde > hasta) { setError('El rango de fechas es inválido (desde > hasta).'); return; }
    setCargando(true); setError(null); setResultado(null);
    try {
      const cat = await cargarCatalogos();
      const tMap = (cat && cat.t) || tiposPorId;
      const sMap = (cat && cat.s) || statusPorId;
      const empMap = (cat && cat.emp) || empresasPorId;
      const convMap = (cat && cat.conv) || convenioPorId;
      const remMap = (cat && cat.rem) || remolquesPorId;
      const uniMap = (cat && cat.uni) || unidadesPorId;
      const opeMap = (cat && cat.ope) || operadoresPorId;
      const monMap = (cat && cat.mon) || monedasPorId;

      // Módulo elegido → colección + campo de fecha. Operaciones es el caso
      //   completo (resuelve tipos/estatus/nombres). Otros módulos usan el
      //   listado genérico con sus campos crudos.
      const modulo = MODULOS.find(m => m.id === moduloId) || MODULOS[0];

      // ⚠️ CLAVE: NO se filtra con where(campoFecha) porque la colección puede
      //   guardar la fecha en formatos MEZCLADOS (ISO, DD/MM/YYYY, Timestamp…) y
      //   el rango por texto solo capturaba las que ya estaban en ISO, perdiendo
      //   muchos registros. Solución: bajar TODA la colección, normalizar cada
      //   fecha a ISO en memoria y filtrar por el rango. Así salen TODOS.
      const snap = await getDocs(collection(db, modulo.coleccion));
      const opsTodas = snap.docs.map(d => {
        const data = d.data() as any;
        const iso = normalizarFechaISO(data[modulo.campoFecha]);
        return { id: d.id, ...data, [modulo.campoFecha]: iso || data[modulo.campoFecha], _fechaISO: iso };
      });
      // Filtro de rango (inclusivo) sobre la fecha YA normalizada a ISO.
      const ops = opsTodas
        .filter(op => op._fechaISO && op._fechaISO >= desde && op._fechaISO <= hasta)
        .sort(compararPorFechaYConsecutivo);

      // ✅ NUEVO: universo de campos crudos de la colección (unión de todas las
      //   claves de los documentos). Es lo que se ofrece en el modal "Columnas".
      const camposSet = new Set<string>();
      opsTodas.forEach(op => Object.keys(op).forEach(k => { if (!CAMPOS_OCULTOS_SIEMPRE.has(k)) camposSet.add(k); }));
      const camposColeccion = Array.from(camposSet).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

      const tipoTextoDe = (op: any): string => String(op.tipoOperacionNombre || tMap[String(op.tipoOperacionId)] || '');
      const clasificarTipo = (op: any): 'Transfer' | 'Logística' | 'Fletes' | 'Otro' => {
        const t = norm(tipoTextoDe(op));
        if (t.includes('transfer')) return 'Transfer';
        if (t.includes('logist')) return 'Logística';
        if (t.includes('flete')) return 'Fletes';
        return 'Otro';
      };
      const statusNombreDe = (op: any): string => {
        const desnorm = op.statusNombre;
        if (desnorm && !esId(desnorm)) return String(desnorm);
        return String(sMap[String(op.status)] || (esId(op.status) ? '' : (op.status || '')) || '');
      };
      const esNoCobrable = (op: any): boolean => {
        const s = norm(statusNombreDe(op));
        return KEYWORDS_NO_COBRABLE.some(k => s.includes(k));
      };
      // ✅ NUEVO: predicado del filtro de estatus del reporte de ventas.
      //   'todos' incluye todo; 'completados' usa KEYWORDS_COMPLETADO; 's::Nombre'
      //   incluye únicamente las operaciones cuyo estatus es ese nombre exacto.
      const pasaFiltroStatus = (op: any): boolean => {
        if (statusFiltro === 'todos') return true;
        const n = norm(statusNombreDe(op));
        if (statusFiltro === 'completados') return KEYWORDS_COMPLETADO.some(k => n.includes(k));
        if (statusFiltro.startsWith('s::')) return n === norm(statusFiltro.slice(3));
        return true;
      };
      // ✅ Resolución de IDs → nombres (nunca devuelve un ID crudo)
      const nombreEmpresa = (id: any, desnorm?: any): string => {
        if (desnorm && !esId(desnorm)) return String(desnorm);
        const k = String(id || '').trim();
        if (empMap[k]) return empMap[k];
        if (k && !esId(k)) return k;
        return '';
      };
      const nombreConvenio = (id: any, desnorm?: any): string => {
        if (desnorm && !esId(desnorm)) return String(desnorm);
        const k = String(id || '').trim();
        if (convMap[k]) return convMap[k];
        if (k && !esId(k)) return k;
        return '';
      };

      // ✅ NUEVO: resolutores por NOMBRE de campo conocido (para mostrar el
      //   nombre y NO el ID en las columnas crudas). Cada uno usa el campo
      //   "*Nombre" desnormalizado si existe, o resuelve el ID con su catálogo.
      const RESOLVERS: Record<string, (op: any) => string> = {
        clientePaga:       op => nombreEmpresa(op.clientePaga, op.clienteNombre || op.nombreCliente),
        clienteId:         op => nombreEmpresa(op.clienteId, op.clienteNombre || op.nombreCliente),
        origen:            op => nombreEmpresa(op.origen, op.origenNombre),
        destino:           op => nombreEmpresa(op.destino, op.destinoNombre),
        clienteMercancia:  op => nombreEmpresa(op.clienteMercancia, op.clienteMercanciaNombre),
        provServicios:     op => nombreEmpresa(op.provServicios, op.provServiciosNombre),
        proveedorUnidad:   op => nombreEmpresa(op.proveedorUnidad, op.proveedorUnidadNombre),
        convenio:          op => nombreConvenio(op.convenio, op.convenioNombre),
        convenioProveedor: op => String(op.convenioProveedorNombre || nombreConvenio(op.convenioProveedor)),
        status:            op => statusNombreDe(op),
        tipoOperacionId:   op => tipoTextoDe(op),
        numeroRemolque:    op => String(op.remolqueNombre || remMap[String(op.numeroRemolque || '').trim()] || (esId(op.numeroRemolque) ? '' : (op.numeroRemolque || ''))),
        unidad:            op => String(op.unidadNombre || uniMap[String(op.unidad || '').trim()] || (esId(op.unidad) ? '' : (op.unidad || ''))),
        operador:          op => String(op.operadorNombre || opeMap[String(op.operador || '').trim()] || (esId(op.operador) ? '' : (op.operador || ''))),
        facturadoEnUnidad:    op => String(op.monedaUnidadNombre || monMap[String(op.facturadoEnUnidad || '').trim()] || (esId(op.facturadoEnUnidad) ? '' : (op.facturadoEnUnidad || ''))),
        facturadoEnCobrar:    op => String(op.monedaCobroNombre || monMap[String(op.facturadoEnCobrar || '').trim()] || (esId(op.facturadoEnCobrar) ? '' : (op.facturadoEnCobrar || ''))),
        monedaConvenioCliente: op => String(monMap[String(op.monedaConvenioCliente || '').trim()] || (esId(op.monedaConvenioCliente) ? '' : (op.monedaConvenioCliente || ''))),
        monedaConvenioProv:    op => String(monMap[String(op.monedaConvenioProv || '').trim()] || (esId(op.monedaConvenioProv) ? '' : (op.monedaConvenioProv || ''))),
      };

      // ✅ NUEVO: lee un campo crudo y lo formatea. Prioriza NOMBRE sobre ID:
      //   1) resolutor específico del campo; 2) si el valor parece un ID, lo
      //   busca en los catálogos (empresas/convenios/status/tipos); 3) fechas y
      //   montos formateados. Nunca muestra un ID si puede mostrar el nombre.
      const valorCrudo = (op: any, campo: string): any => {
        if (RESOLVERS[campo]) { const r = RESOLVERS[campo](op); if (r) return r; }
        const v = op[campo];
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'object') {
          const iso = normalizarFechaISO(v);
          if (iso) return fmtFechaCorta(iso);
          if (Array.isArray(v)) return `${v.length} elemento(s)`;
          try { return JSON.stringify(v).slice(0, 80); } catch { return '[objeto]'; }
        }
        // Si el valor en sí es un ID conocido, resuélvelo a nombre.
        const sv = String(v).trim();
        if (esId(sv)) {
          const nombre = empMap[sv] || convMap[sv] || sMap[sv] || tMap[sv] || remMap[sv] || uniMap[sv] || opeMap[sv] || monMap[sv];
          if (nombre) return nombre;
        }
        if (/fecha/i.test(campo)) { const iso = normalizarFechaISO(v); return iso ? fmtFechaCorta(iso) : String(v); }
        if (typeof v === 'number' && esCampoMonetario(campo)) return fmtMoneda(v);
        return typeof v === 'number' ? v : String(v);
      };

      const ctx: Ctx = { ops, desde, hasta, clasificarTipo, esNoCobrable, statusNombreDe, pasaFiltroStatus, nombreEmpresa, nombreConvenio, camposColeccion, valorCrudo };
      const def = reportesDelModulo.find(r => r.id === reporteId) || reportesDelModulo[0];
      setResultado(def.build(ctx));
      if (ops.length === 0) setError('No hay registros en ese rango de fechas para el módulo seleccionado.');
    } catch (e: any) {
      console.error('Error generando reporte:', e);
      setError(e?.message || 'Error generando el reporte. ¿Falta un índice en Firestore para fechaServicio?');
    } finally {
      setCargando(false);
    }
  };

  // Clave de config: incluye el módulo, porque las columnas crudas dependen de
  //   la colección de cada módulo.
  const cfgKey = `${moduloId}::${reporteId}`;
  const cfgDocId = cfgKey.replace(/[^a-zA-Z0-9_]+/g, '_'); // id válido de doc Firestore

  // Fusiona una config guardada (orden + visibilidad por key) con las columnas
  //   REALES del reporte: respeta el orden guardado, conserva la visibilidad y
  //   agrega al final cualquier columna nueva que aún no estuviera guardada.
  const fusionarConfig = (reales: Columna[], guardada?: { key: string; visible: boolean }[] | null): ColCfg[] => {
    const mapReal = new Map(reales.map(c => [c.key, c]));
    const ordenadas: ColCfg[] = [];
    const usados = new Set<string>();
    (guardada || []).forEach(g => {
      const real = mapReal.get(g.key);
      if (real) { ordenadas.push({ key: real.key, label: real.label, align: real.align, visible: !!g.visible }); usados.add(real.key); }
    });
    reales.forEach(real => {
      if (!usados.has(real.key)) ordenadas.push({ key: real.key, label: real.label, align: real.align, visible: !real.defaultHidden });
    });
    return ordenadas;
  };

  // ✅ NUEVO: al obtener un resultado, carga la config GUARDADA en Firestore
  //   (compartida por todos los usuarios) y la fusiona con las columnas reales.
  //   Si no hay guardada, usa el orden por defecto. Solo lee Firestore una vez
  //   por cfgKey (cargadosCfgRef) para no recargar en cada "Generar".
  useEffect(() => {
    if (!resultado) return;
    let activo = true;
    (async () => {
      const reales = resultado.columnas;
      let guardada: { key: string; visible: boolean }[] | null = null;
      if (!cargadosCfgRef.current.has(cfgKey)) {
        try {
          const snap = await getDoc(doc(db, 'config_reportes_columnas', cfgDocId));
          if (snap.exists()) {
            const data = snap.data() as any;
            if (Array.isArray(data.columnas)) guardada = data.columnas;
          }
        } catch (e) { console.warn('No se pudo leer la config de columnas:', e); }
        cargadosCfgRef.current.add(cfgKey);
      }
      if (!activo) return;
      setColConfigs(prev => {
        // Si ya hay config local Y no vino nada nuevo de Firestore, solo agrega faltantes.
        if (prev[cfgKey] && prev[cfgKey].length && !guardada) {
          const existentes = new Set(prev[cfgKey].map(c => c.key));
          const faltantes = reales.filter(c => !existentes.has(c.key))
            .map(c => ({ key: c.key, label: c.label, align: c.align, visible: !c.defaultHidden }));
          if (faltantes.length === 0) return prev;
          return { ...prev, [cfgKey]: [...prev[cfgKey], ...faltantes] };
        }
        // Hay config de Firestore (o no había local): fusionar.
        const fuente = guardada || (prev[cfgKey] ? prev[cfgKey].map(c => ({ key: c.key, visible: c.visible })) : null);
        return { ...prev, [cfgKey]: fusionarConfig(reales, fuente) };
      });
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado, cfgKey, cfgDocId]);

  // ✅ NUEVO: "vista" = el resultado con las columnas filtradas/reordenadas según
  //   la config del reporte. Es lo que se usa para mostrar en pantalla y para
  //   exportar a Excel/PDF. Las filas se reordenan para alinear con las columnas
  //   visibles. `totalFlags` marca las filas de Acumulado/Promedio (se calcula
  //   sobre la fila ORIGINAL para no romperse al ocultar/reordenar columnas).
  const vista = useMemo(() => {
    if (!resultado) return null;
    const base = resultado.columnas;
    const keyToIdx: Record<string, number> = {};
    base.forEach((c, i) => { keyToIdx[c.key] = i; });

    const cfg = colConfigs[cfgKey];
    let columnas: Columna[] = base;
    if (cfg && cfg.length) {
      const visibles = cfg.filter(c => c.visible)
        .map(c => base.find(b => b.key === c.key))
        .filter((c): c is Columna => !!c);
      if (visibles.length > 0) columnas = visibles; // si todo está oculto, mostramos todo
    }

    const totalFlags = resultado.filas.map(f => typeof f[0] === 'string' && (f[0] === 'ACUMULADO' || f[0] === 'PROMEDIO MENSUAL'));
    const filas = resultado.filas.map(f => columnas.map(col => f[keyToIdx[col.key]]));

    return {
      titulo: resultado.titulo,
      columnas,
      filas,
      resumen: resultado.resumen,
      weekendFlags: resultado.weekendFlags,
      totalFlags,
    };
  }, [resultado, colConfigs, cfgKey]);

  // Handlers para el modal de columnas (mostrar/ocultar + reordenar arrastrando)
  const toggleColumna = (idx: number) => {
    setColConfigs(prev => {
      const lista = (prev[cfgKey] || []).map(c => ({ ...c }));
      if (!lista[idx]) return prev;
      lista[idx].visible = !lista[idx].visible;
      return { ...prev, [cfgKey]: lista };
    });
  };
  const handleColDragStart = (idx: number) => setDraggedColIndex(idx);
  const handleColDragEnter = (idx: number) => {
    if (draggedColIndex === null || draggedColIndex === idx) return;
    setColConfigs(prev => {
      const lista = (prev[cfgKey] || []).map(c => ({ ...c }));
      const movida = lista.splice(draggedColIndex, 1)[0];
      lista.splice(idx, 0, movida);
      return { ...prev, [cfgKey]: lista };
    });
    setDraggedColIndex(idx);
  };
  const colConfigActual = colConfigs[cfgKey] || [];

  // ✅ NUEVO: reordenar rápido con flechas (sube/baja una posición).
  const moverColumna = (idx: number, dir: -1 | 1) => {
    setColConfigs(prev => {
      const lista = (prev[cfgKey] || []).map(c => ({ ...c }));
      const j = idx + dir;
      if (j < 0 || j >= lista.length) return prev;
      [lista[idx], lista[j]] = [lista[j], lista[idx]];
      return { ...prev, [cfgKey]: lista };
    });
  };

  // ✅ NUEVO: guarda el orden/visibilidad en Firestore para que TODOS los
  //   usuarios vean la misma configuración de columnas de este reporte.
  const guardarConfigColumnas = async () => {
    const cfg = colConfigs[cfgKey] || [];
    setGuardandoCols(true);
    try {
      await setDoc(doc(db, 'config_reportes_columnas', cfgDocId), {
        cfgKey,
        moduloId,
        reporteId,
        columnas: cfg.map(c => ({ key: c.key, visible: c.visible })),
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Error guardando la config de columnas:', e);
      alert('No se pudo guardar la configuración de columnas. Revisa tu conexión o permisos de Firestore.');
    } finally {
      setGuardandoCols(false);
    }
  };

  // ---------------- Export ----------------
  const nombreArchivo = () => {
    const base = (resultado?.titulo || 'reporte').replace(/[^a-z0-9]+/gi, '_');
    return `${base}_${desde}_a_${hasta}`;
  };

  // Convierte "$ 1,234.00" → 1234 ; deja el resto igual
  const aNumeroMoneda = (v: any): number | null => {
    if (typeof v !== 'string') return null;
    if (!/^\s*\$\s*-?[\d,]/.test(v)) return null;
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? null : n;
  };

  // ✅ EXCEL profesional con logo (ExcelJS). Requiere: npm install exceljs
  const exportarExcel = async () => {
    if (!vista) return;
    try {
      const ExcelJS: any = (await import('exceljs')).default || (await import('exceljs'));
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Roelca Inc.';
      wb.created = new Date();
      const ws = wb.addWorksheet('Reporte', { views: [{ showGridLines: false }] });
      const nCols = vista.columnas.length;

      // Logo (col A, filas superiores)
      try {
        const b64 = LOGO_DEFAULT.includes(',') ? LOGO_DEFAULT.split(',')[1] : LOGO_DEFAULT;
        const imgId = wb.addImage({ base64: b64, extension: 'png' });
        ws.addImage(imgId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 86, height: 86 } });
      } catch (imgErr) { console.warn('No se pudo insertar el logo en Excel:', imgErr); }

      const colTitulo = Math.min(1, nCols - 1); // empieza junto al logo
      const setMerged = (row: number, text: string, font: any) => {
        ws.mergeCells(row, colTitulo + 1, row, nCols);
        const cell = ws.getCell(row, colTitulo + 1);
        cell.value = text;
        cell.font = font;
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      };
      setMerged(1, 'ROELCA INC.', { bold: true, size: 16, color: { argb: 'FFC2410C' } });
      setMerged(2, vista.titulo, { bold: true, size: 13, color: { argb: 'FF24292F' } });
      setMerged(3, `Del ${fmtFechaCorta(desde)} al ${fmtFechaCorta(hasta)}`, { size: 11, color: { argb: 'FF57606A' } });
      setMerged(4, `Generado: ${new Date().toLocaleString('es-MX')}`, { italic: true, size: 9, color: { argb: 'FF8B949E' } });
      if (vista.resumen && vista.resumen.length) {
        setMerged(5, vista.resumen.map(r => `${r.label}: ${r.valor}`).join('      '), { bold: true, size: 10, color: { argb: 'FF1F2328' } });
      }
      for (let r = 1; r <= 5; r++) ws.getRow(r).height = 19;

      const headerRow = 7;
      const thin = { style: 'thin', color: { argb: 'FFD0D7DE' } };
      const borderAll = { top: thin, left: thin, bottom: thin, right: thin };

      // Encabezados
      vista.columnas.forEach((col, i) => {
        const cell = ws.getCell(headerRow, i + 1);
        cell.value = col.label;
        cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24292F' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = borderAll;
      });
      ws.getRow(headerRow).height = 22;

      // Filas de datos
      vista.filas.forEach((f, ri) => {
        const r = headerRow + 1 + ri;
        const esTotalRow = !!(vista.totalFlags && vista.totalFlags[ri]);
        const weekend = vista.weekendFlags && vista.weekendFlags[ri];
        f.forEach((v, ci) => {
          const cell = ws.getCell(r, ci + 1);
          const num = aNumeroMoneda(v);
          if (num !== null) { cell.value = num; cell.numFmt = '"$"#,##0.00'; }
          else { cell.value = (v === '' || v == null) ? null : v; }
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.font = { size: 10, bold: esTotalRow, color: { argb: esTotalRow ? 'FF24292F' : 'FF1F2328' } };
          const fill = esTotalRow
            ? 'FFE8EEF7'
            : (weekend ? 'FFFFF6E5' : (ri % 2 ? 'FFFAFBFC' : 'FFFFFFFF'));
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
          cell.border = borderAll;
        });
      });

      // Ancho de columnas (auto aproximado)
      vista.columnas.forEach((col, i) => {
        let max = String(col.label).length;
        vista.filas.forEach(f => { const s = String(f[i] ?? ''); if (s.length > max) max = s.length; });
        ws.getColumn(i + 1).width = Math.min(Math.max(max + 2, 11), 42);
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${nombreArchivo()}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('Error exportando Excel:', e);
      alert('No se pudo exportar a Excel. Asegúrate de instalar la librería con:\n\n   npm install exceljs');
    }
  };

  // ✅ PDF profesional con logo y rango de fechas (ventana de impresión → Guardar como PDF)
  const exportarPDF = () => {
    if (!vista) return;
    const cols = vista.columnas;
    const filasHtml = vista.filas.map((f, i) => {
      const esTotalRow = !!(vista.totalFlags && vista.totalFlags[i]);
      const weekend = vista.weekendFlags && vista.weekendFlags[i];
      const bg = esTotalRow ? '#e8eef7' : (weekend ? '#fff6e5' : (i % 2 ? '#f6f8fa' : '#ffffff'));
      const fw = esTotalRow ? '700' : '400';
      const tds = f.map((v) => `<td style="padding:7px 11px;border:1px solid #d0d7de;text-align:center;font-weight:${fw};white-space:nowrap">${v === '' || v == null ? '' : String(v)}</td>`).join('');
      return `<tr style="background:${bg}">${tds}</tr>`;
    }).join('');
    const ths = cols.map(c => `<th style="padding:9px 11px;border:1px solid #24292f;background:#24292f;color:#fff;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap">${c.label}</th>`).join('');
    const resumenHtml = (vista.resumen || []).map(r =>
      `<div style="background:#fff;border:1px solid #e6eaf0;border-radius:8px;padding:8px 14px;min-width:120px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#8a94a6">${r.label}</div>
        <div style="font-size:16px;font-weight:700;color:#c2410c">${r.valor}</div>
      </div>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${vista.titulo}</title>
<style>@page{margin:14mm} body{margin:0}</style></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2328;padding:24px">
  <div style="display:flex;align-items:center;gap:16px;border-bottom:3px solid #c2410c;padding-bottom:14px;margin-bottom:18px">
    <img src="${LOGO_DEFAULT}" alt="Roelca Inc." style="height:64px;width:auto" />
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#c2410c">ROELCA INC.</div>
      <div style="font-size:22px;font-weight:800;margin:2px 0 2px;color:#1f2328">${vista.titulo}</div>
      <div style="color:#57606a;font-size:13px">Periodo: <b>${fmtFechaCorta(desde)}</b> al <b>${fmtFechaCorta(hasta)}</b></div>
    </div>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">${resumenHtml}</div>
  <table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>${ths}</tr></thead><tbody>${filasHtml}</tbody></table>
  <div style="color:#8b949e;font-size:10px;margin-top:16px;border-top:1px solid #e6eaf0;padding-top:8px">
    Roelca Inc. · Reporte generado el ${new Date().toLocaleString('es-MX')}
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print();},200);}</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Permite las ventanas emergentes para exportar a PDF.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  // ---------------- UI ----------------
  const inputEstilo: React.CSSProperties = { background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 6, padding: '8px 10px', fontSize: '0.9rem' };
  const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(180deg,#ea580c,#c2410c)', color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' };
  const btnOutline: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: '1px solid #30363d', background: 'transparent', color: '#c9d1d9', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };

  const nombreReporteActual = (reportesDelModulo.find(r => r.id === reporteId) || reportesDelModulo[0]).nombre;
  // ✅ NUEVO: el filtro de estatus solo aplica/aparece en los reportes de ventas.
  const esReporteVentas = ['diario_transfer', 'diario_logistica', 'diario_fletes'].includes(reporteId);

  return (
    <div style={{ padding: 24, width: '100%', boxSizing: 'border-box', color: '#c9d1d9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 4px', fontWeight: 'bold' }}>Reportes</h1>
      <p style={{ color: '#8b949e', margin: '0 0 20px', fontSize: '0.92rem' }}>Reportes de operaciones por rango de fechas. Exporta a Excel o PDF.</p>

      {/* ✅ Filtros en una sola barra: Módulo + Reporte + Desde + Hasta + acciones */}
      <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, padding: 18, marginBottom: 18, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 220px', minWidth: 200 }}>
          <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Módulo</label>
          <select
            value={moduloId}
            onChange={e => {
              const nuevo = e.target.value;
              setModuloId(nuevo);
              setResultado(null); setError(null);
              // Si el reporte actual no aplica al nuevo módulo, salta al primero válido.
              const validos = nuevo === 'operaciones' ? reportes : reportes.filter(r => !r.soloOperaciones);
              if (!validos.some(r => r.id === reporteId)) setReporteId(validos[0].id);
            }}
            style={{ ...inputEstilo, width: '100%' }}
          >
            {MODULOS.map(m => (<option key={m.id} value={m.id}>{m.nombre}</option>))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 260px', minWidth: 220 }}>
          <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Reporte</label>
          <select value={reporteId} onChange={e => { setReporteId(e.target.value); setResultado(null); setError(null); }} style={{ ...inputEstilo, width: '100%' }}>
            {reportesDelModulo.map(r => (<option key={r.id} value={r.id}>{r.nombre}</option>))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inputEstilo} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inputEstilo} />
        </div>
        {/* ✅ NUEVO: filtro de estatus (solo para el reporte de ventas) */}
        {esReporteVentas && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 200px', minWidth: 180 }}>
            <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Estatus a incluir</label>
            <select value={statusFiltro} onChange={e => { setStatusFiltro(e.target.value); setResultado(null); setError(null); }} style={{ ...inputEstilo, width: '100%' }}>
              <option value="todos">Todos los estatus</option>
              <option value="completados">Solo completados</option>
              {statusOpciones.length > 0 && <option disabled>──────────</option>}
              {statusOpciones.map(s => (<option key={s} value={`s::${s}`}>{s}</option>))}
            </select>
          </div>
        )}
        <button onClick={generar} disabled={cargando} style={{ ...btnPrimary, opacity: cargando ? 0.6 : 1 }}>
          {cargando ? 'Generando…' : 'Generar reporte'}
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          {/* ✅ NUEVO: abre los Resúmenes Diarios (Transfer / Logística / Fletes) */}
          <button onClick={() => setMostrarResumenDiario(true)} style={btnOutline} title="Resúmenes diarios de operaciones (Transfer / Logística / Fletes)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
            Resúmenes
          </button>
          <button onClick={() => { setFiltroCol(''); setModalColumnas(true); }} disabled={!resultado} style={{ ...btnOutline, opacity: resultado ? 1 : 0.5 }} title="Elegir y ordenar las columnas de este reporte">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
            Columnas
          </button>
          <button onClick={exportarExcel} disabled={!resultado} style={{ ...btnOutline, opacity: resultado ? 1 : 0.5 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Excel
          </button>
          <button onClick={exportarPDF} disabled={!resultado} style={{ ...btnOutline, opacity: resultado ? 1 : 0.5 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            PDF
          </button>
        </div>
      </div>

      {error && <div style={{ background: 'rgba(248,81,73,.08)', border: '1px solid rgba(248,81,73,.3)', color: '#ff9b94', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: '0.88rem' }}>{error}</div>}

      {resultado && vista && (
        <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <img src={LOGO_DEFAULT} alt="Roelca Inc." style={{ height: 40, width: 'auto' }} />
              <div>
                <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: '1.05rem' }}>{vista.titulo}</div>
                <div style={{ color: '#8b949e', fontSize: '0.8rem' }}>Del {fmtFechaCorta(desde)} al {fmtFechaCorta(hasta)}</div>
              </div>
            </div>
            {vista.resumen && (
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {vista.resumen.map((r, i) => (
                  <div key={i} style={{ textAlign: 'right' }}>
                    <div style={{ color: '#8b949e', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>{r.label}</div>
                    <div style={{ color: '#fb923c', fontWeight: 700, fontSize: '1.1rem' }}>{r.valor}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  {vista.columnas.map(c => (
                    <th key={c.key} style={{ padding: '12px 14px', background: '#161b22', color: '#8b949e', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', textAlign: c.align || 'left', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vista.filas.length === 0 ? (
                  <tr><td colSpan={vista.columnas.length} style={{ padding: 30, textAlign: 'center', color: '#8b949e' }}>Sin datos.</td></tr>
                ) : vista.filas.map((f, i) => {
                  const esTotalRow = !!(vista.totalFlags && vista.totalFlags[i]);
                  const weekend = vista.weekendFlags && vista.weekendFlags[i];
                  const bg = esTotalRow ? '#161b22' : (weekend ? 'rgba(210,153,34,.07)' : 'transparent');
                  return (
                    <tr key={i} style={{ background: bg, borderBottom: '1px solid #21262d' }}>
                      {f.map((v, j) => (
                        <td key={j} style={{ padding: '10px 14px', textAlign: vista.columnas[j]?.align || 'left', color: esTotalRow ? '#f0f6fc' : '#c9d1d9', fontWeight: esTotalRow ? 700 : 400, whiteSpace: 'nowrap' }}>
                          {v === '' || v == null ? '' : String(v)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!resultado && !error && !cargando && (
        <div style={{ background: '#0d1117', border: '1px dashed #30363d', borderRadius: 12, padding: 40, textAlign: 'center', color: '#6e7681' }}>
          Reporte seleccionado: <b style={{ color: '#fb923c' }}>{nombreReporteActual}</b>. Elige el rango de fechas y pulsa <b style={{ color: '#fb923c' }}>Generar reporte</b>.
        </div>
      )}

      {/* ✅ NUEVO: modal para elegir y ordenar columnas del reporte actual */}
      {modalColumnas && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setModalColumnas(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }}
        >
          <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, width: 'min(460px, 96vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: '1.05rem' }}>Configurar columnas</div>
                <div style={{ color: '#7d8590', fontSize: '0.78rem', marginTop: 2 }}>{nombreReporteActual}</div>
              </div>
              <button onClick={() => setModalColumnas(false)} title="Cerrar" style={{ background: 'transparent', border: '1px solid #2d333b', color: '#8b949e', width: 34, height: 34, borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

          <div style={{ padding: '10px 12px 4px', color: '#7d8590', fontSize: '0.76rem' }}>
            Marca las columnas a incluir y ordénalas con las flechas <span style={{ color: '#fb923c' }}>▲▼</span> (o arrastrando). Pulsa <b style={{ color: '#fb923c' }}>Guardar para todos</b> para que el orden quede fijo y lo vean los demás usuarios.
          </div>

          {/* Buscador de columnas (útil cuando hay muchos campos) */}
          <div style={{ padding: '6px 12px 8px' }}>
            <input
              type="text"
              value={filtroCol}
              onChange={e => setFiltroCol(e.target.value)}
              placeholder="Buscar columna…"
              style={{ ...inputEstilo, width: '100%', boxSizing: 'border-box' }}
            />
          </div>

            <div style={{ overflowY: 'auto', padding: '0 12px 12px' }}>
              {colConfigActual
                .map((col, idx) => ({ col, idx }))
                .filter(({ col }) => !filtroCol || norm(col.label).includes(norm(filtroCol)))
                .map(({ col, idx }) => (
                <div
                  key={col.key}
                  draggable
                  onDragStart={() => handleColDragStart(idx)}
                  onDragEnter={() => handleColDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 6,
                    background: draggedColIndex === idx ? '#161b22' : '#0b0f16',
                    border: '1px solid #21262d', borderRadius: 8,
                  }}
                >
                  {/* Flechas rápidas */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button type="button" title="Subir" onClick={() => moverColumna(idx, -1)} disabled={idx === 0}
                      style={{ background: 'transparent', border: '1px solid #2d333b', color: idx === 0 ? '#3a414b' : '#8b949e', borderRadius: 5, width: 24, height: 18, cursor: idx === 0 ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button type="button" title="Bajar" onClick={() => moverColumna(idx, 1)} disabled={idx === colConfigActual.length - 1}
                      style={{ background: 'transparent', border: '1px solid #2d333b', color: idx === colConfigActual.length - 1 ? '#3a414b' : '#8b949e', borderRadius: 5, width: 24, height: 18, cursor: idx === colConfigActual.length - 1 ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                  </div>
                  <span style={{ color: '#6e7681', cursor: 'grab', fontSize: '1rem', lineHeight: 1 }} title="Arrastrar para reordenar">⠿</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={col.visible} onChange={() => toggleColumna(idx)} style={{ width: 16, height: 16, accentColor: '#ea580c', cursor: 'pointer' }} />
                    <span style={{ color: col.visible ? '#e6edf3' : '#6e7681', fontSize: '0.9rem', fontWeight: 500 }}>{col.label}</span>
                  </label>
                  <span style={{ color: '#6e7681', fontSize: '0.7rem' }}>{idx + 1}</span>
                </div>
              ))}
              {colConfigActual.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#6e7681', fontSize: '0.85rem' }}>Genera un reporte para configurar sus columnas.</div>
              )}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => setColConfigs(prev => ({ ...prev, [cfgKey]: colConfigActual.map(c => ({ ...c, visible: true })) }))}
                style={{ ...btnOutline, padding: '9px 14px' }}
              >
                Mostrar todas
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setModalColumnas(false)} style={{ ...btnOutline, padding: '9px 14px' }}>Cerrar</button>
                <button onClick={async () => { await guardarConfigColumnas(); setModalColumnas(false); }} disabled={guardandoCols} style={{ ...btnPrimary, padding: '9px 18px', opacity: guardandoCols ? 0.6 : 1 }}>
                  {guardandoCols ? 'Guardando…' : 'Guardar para todos'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO: modal de Resúmenes Diarios (Transfer / Logística / Fletes) */}
      {mostrarResumenDiario && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setMostrarResumenDiario(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(1, 4, 9, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1700, padding: 16 }}
        >
          <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, width: 1180, maxWidth: '97%', maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
              <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: '1.05rem' }}>Resúmenes Diarios de Operaciones</div>
              <button onClick={() => setMostrarResumenDiario(false)} title="Cerrar" style={{ background: 'transparent', border: '1px solid #30363d', color: '#8b949e', width: 36, height: 36, borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <ResumenDiarioOperaciones />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportesDashboard;
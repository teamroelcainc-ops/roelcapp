// src/features/operaciones/components/OperacionesDashboard.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { notificarOperacionGuardada } from '../../../utils/operacionesBus';
import { FormularioOperacion } from './FormularioOperacion';
// ✅ NUEVO: Resúmenes Diarios (Transfer / Logística / Fletes) en PDF.
import { ResumenDiarioOperaciones } from '../../reportes/components/ResumenDiarioOperaciones';
import { collection, doc, writeBatch, query, getDocs, limit, where, startAfter, orderBy } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase'; 
import { registrarLog } from '../../../utils/logger';
import { sincronizarNombresOperaciones as sincronizarNombresUtil } from '../../../utils/sincronizarNombresOperaciones';
import { obtenerBotonesHorarioDinamicos, resolverCascadaStatus } from '../config/statusRules';
import { generarSolicitudRetiroPDF, generarInstruccionesServicioPDF, generarCheckListPDF, generarPruebaEntregaPDF, generarCartaInstruccionesPDF, setLogoPdf } from '../../../utils/pdfGenerator'; 
import * as XLSX from 'xlsx';
import { useEmpresaConfig } from '../../configuracion/useEmpresaConfig';
import './OperacionesDashboard.css';
import { ahoraLocalISOCorto } from '../../../utils/fechaHoraLocal';

// ✅ NUEVO: fecha y hora legibles para la auditoría de referencias.
const fmtFechaAuditoria = (iso: any): string => {
  try {
    const d = new Date(String(iso));
    if (isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(iso || ''); }
};

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

const TAMANO_PAGINA = 50;

const DIA_MS = 24 * 60 * 60 * 1000;
const CATALOGOS_TTL_MS: Record<string, number> = {
  statusServicio: 7 * DIA_MS, tiposOperacion: 7 * DIA_MS, embalajes: 7 * DIA_MS,
  catalogoMoneda: 7 * DIA_MS, tarifas: 7 * DIA_MS,
  empresas: DIA_MS, remolques: DIA_MS, unidades: DIA_MS, empleados: DIA_MS,
  unidades_proveedor: DIA_MS, proveedores_unidad: DIA_MS,
  conveniosProv: DIA_MS, catalogoConvProvDetalles: DIA_MS,
  catalogoConvClientes: DIA_MS, catalogoConvDetalles: DIA_MS, catalogoTC: DIA_MS,
};
const TTL_DEFAULT = DIA_MS;
// ✅ v2: se sube la versión de la clave para INVALIDAR cualquier caché vieja
// (incluidas las que quedaron VACÍAS cuando un bloqueador cortó la llamada a
// Firestore). Con v2, las cachés v1 dañadas se ignoran y todo se baja de nuevo.
const claveCacheCatalogo = (alias: string) => `cat_v2__${alias}`;
const leerCacheCatalogo = (alias: string): { ts: number; data: any[] } | null => {
  try {
    const raw = localStorage.getItem(claveCacheCatalogo(alias));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && Array.isArray(obj.data) ? obj : null;
  } catch { return null; }
};
// ✅ NO guardar un catálogo VACÍO. Si una descarga vuelve con 0 documentos
// (p. ej. la bloqueó una extensión), NO se cachea, para que se reintente en la
// siguiente carga en lugar de quedarse pegado mostrando IDs para siempre.
const escribirCacheCatalogo = (alias: string, data: any[]) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return;
    localStorage.setItem(claveCacheCatalogo(alias), JSON.stringify({ ts: Date.now(), data }));
  } catch {}
};
// ✅ Una caché VACÍA NO se considera vigente → fuerza re-descarga.
const cacheVigente = (alias: string): boolean => {
  const obj = leerCacheCatalogo(alias);
  if (!obj || !Array.isArray(obj.data) || obj.data.length === 0) return false;
  const ttl = CATALOGOS_TTL_MS[alias] ?? TTL_DEFAULT;
  return (Date.now() - (obj.ts || 0)) < ttl;
};

// ✅ NUEVO: ordena nombres de status por su número inicial (1, 3, 4.1, 5, 6,
//    8.1, 8.2, 9, 10.1, 10.3, 10.5, 11, 11.2, 12.1, 13.1, 16, 18, 19) y, dentro
//    del mismo número, alfabéticamente. Los que no inician con número van al
//    final, ordenados alfabéticamente. Todo en orden ascendente.
const compararStatusPorNumero = (a: string, b: string): number => {
  const parse = (s: string): number[] | null => {
    const m = String(s ?? '').trim().match(/^(\d+(?:\.\d+)*)/);
    return m ? m[1].split('.').map((n) => parseInt(n, 10)) : null;
  };
  const na = parse(a);
  const nb = parse(b);
  if (na && nb) {
    const len = Math.max(na.length, nb.length);
    for (let i = 0; i < len; i++) {
      const da = na[i] ?? 0;
      const db = nb[i] ?? 0;
      if (da !== db) return da - db;
    }
    return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
  }
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
};

// ✅ NUEVO: quita las claves cuyo valor sea `undefined` de un objeto antes de
//    escribirlo en Firestore. Firestore RECHAZA cualquier campo `undefined`
//    (lanza "Unsupported field value: undefined") y eso aborta el batch.commit
//    completo → es una de las causas típicas de "Se revirtió el cambio".
const limpiarUndefined = (obj: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  Object.keys(obj).forEach((k) => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
};


// ✅ Color por TIPO DE OPERACIÓN: Transfer → naranja, Logística → azul,
//   Fletes → verde. Cualquier otro tipo conserva el color neutro.
const colorTipoOperacion = (nombre: any): string => {
  const n = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (n.includes('transfer')) return '#fb923c';
  // ✅ V00177: 'flete' se evalúa ANTES que 'logist' — "Logistica Fletes"
  //   contiene ambas palabras y debe pintarse VERDE (línea de fletes).
  if (n.includes('flete')) return '#3fb950';
  if (n.includes('logist')) return '#58a6ff';
  return '#c9d1d9';
};

const COLUMNAS_BASE = [
  { id: 'ref', label: '# Referencia', visible: true },
  { id: 'fechaServicio', label: 'Fecha Servicio', visible: true },
  { id: 'fechaCita', label: 'Fecha Cita', visible: false },
  { id: 'tipoOperacion', label: 'Tipo de Operación', visible: true },
  { id: 'status', label: 'Status', visible: true },
  // ✅ # Remolque y Unidad al lado de Status (reubicadas a petición).
  { id: 'remolque', label: '# Remolque', visible: true },
  { id: 'unidad', label: 'Unidad Roelca', visible: true },
  // ✅ Tráfico después de la Unidad (visible, a petición).
  { id: 'trafico', label: 'Tráfico', visible: true },
  // ✅ Convenio después de la Unidad (reubicado a petición).
  { id: 'convenioTarifa', label: 'Convenio Cliente (Tarifa)', visible: true },
  { id: 'cliente', label: 'Cliente (Paga)', visible: true },
  { id: 'refCliente', label: 'Ref. Cliente', visible: false },
  { id: 'facturadoEnCobrar', label: 'Moneda Cobro', visible: false },
  { id: 'montoConvenioCliente', label: 'Monto Convenio (Cliente)', visible: false },
  { id: 'cargosAdicionales', label: 'Cargos Adic. (Cliente)', visible: true },
  { id: 'subtotal', label: 'Subtotal Cliente', visible: true },
  { id: 'tipoCambioAprobado', label: 'Tipo Cambio', visible: false },
  { id: 'dolaresCliente', label: 'Dólares (Cliente)', visible: false },
  { id: 'pesosCliente', label: 'Pesos (Cliente)', visible: false },
  { id: 'conversionCliente', label: 'Conversión Ingreso', visible: false },
  { id: 'origen', label: 'Origen', visible: false },
  { id: 'destino', label: 'Destino', visible: false },
  { id: 'proveedor', label: 'Proveedor de Unidad', visible: true },
  { id: 'unidadProveedor', label: 'Unidad Externa', visible: false },
  { id: 'operadorProveedor', label: 'Operador Externo', visible: false },
  { id: 'convenioProv', label: 'Convenio Prov.', visible: true },
  { id: 'facturadoEnUnidad', label: 'Moneda Prov.', visible: false },
  { id: 'monedaConvenioProv', label: 'Moneda Conv. Prov.', visible: false },
  { id: 'totalAPagarProv', label: 'Monto Base Prov.', visible: false },
  { id: 'cargosAdicionalesProv', label: 'Cargos Adic. Prov.', visible: false },
  { id: 'subtotalProv', label: 'Subtotal Prov.', visible: false },
  { id: 'dolaresProv', label: 'Dólares Prov.', visible: false },
  { id: 'pesosProv', label: 'Pesos Prov.', visible: false },
  { id: 'conversionProv', label: 'Conversión Gasto', visible: false },
  { id: 'operador', label: 'Operador Roelca', visible: false },
  { id: 'sueldoOperador', label: 'Sueldo Operador', visible: false },
  { id: 'sueldoExtra', label: 'Sueldo Extra', visible: false },
  { id: 'sueldoTotal', label: 'Sueldo Total', visible: false },
  { id: 'combustible', label: 'Combustible', visible: false },
  { id: 'combustibleExtra', label: 'Combustible Extra', visible: false },
  { id: 'combustibleTotal', label: 'Combustible Total', visible: false },
  { id: 'clienteMercancia', label: 'Cliente Mercancía', visible: false },
  { id: 'descripcionMercancia', label: 'Desc. Mercancía', visible: false },
  { id: 'cantidad', label: 'Cantidad', visible: false },
  { id: 'embalaje', label: 'Embalaje', visible: false },
  { id: 'pesoKg', label: 'Peso (Kg)', visible: false },
  { id: 'numDoda', label: '# DODA', visible: false },
  { id: 'fechaEmisionDoda', label: 'Fecha DODA', visible: false },
  { id: 'numeroEntrys', label: '# Entrys', visible: false },
  { id: 'cantEntrys', label: 'Cant. Entrys', visible: false },
  { id: 'numManifiesto', label: '# Manifiesto', visible: false },
  { id: 'provServicios', label: 'Prov. Servicios', visible: false },
  { id: 'montoManifiesto', label: 'Costo Manifiesto', visible: false },
  { id: 'totalGastos', label: 'Total Gastos', visible: false },
  { id: 'utilidadEstimada', label: 'Utilidad Estimada', visible: false },
  { id: 'observacionesEjecutivo', label: 'Obs. Ejecutivo', visible: false },
  { id: 'observacionesUnidad', label: 'Obs. Unidad', visible: false },
  { id: 'observacionesCobrar', label: 'Obs. Cobro', visible: false }
];

const OperacionesDashboard = () => {
  const { config: empresaConfig } = useEmpresaConfig();

  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [operacionEditando, setOperacionEditando] = useState<any | null>(null);
  // ✅ V00141: si una notificación de acceso aprobado pidió abrir un registro, ábrelo
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem('roelca_abrir_registro');
        if (!raw) return;
        const ped = JSON.parse(raw);
        if (ped?.modulo !== 'operaciones' || !ped?.docId) return;
        if (Date.now() - Number(ped.ts || 0) > 10 * 60000) { localStorage.removeItem('roelca_abrir_registro'); return; }
        localStorage.removeItem('roelca_abrir_registro');
        const snap = await getDocs(query(collection(db, 'operaciones'), where('__name__', '==', String(ped.docId)), limit(1)));
        if (!snap.empty) {
          const op = { id: snap.docs[0].id, ...(snap.docs[0].data() as any) };
          await cargarCatalogosSiEsNecesario();
          setOperacionEditando(op);
          setOperacionViendo(null);
          setEstadoFormulario('abierto');
        }
      } catch { /* noop */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(true);
  const [operacionViendo, setOperacionViendo] = useState<any | null>(null);
  // ✅ NUEVO: modal de auditoría de la referencia (solo lectura).
  const [mostrarAuditoria, setMostrarAuditoria] = useState(false);
  // ✅ NUEVO: mapa uid → nombre para mostrar SIEMPRE el nombre del usuario en la
  //   auditoría (las referencias viejas guardaron el UID; aquí se traduce).
  const [nombresUsuarios, setNombresUsuarios] = useState<Record<string, string>>({});
  const cargarNombresAuditoria = async () => {
    if (Object.keys(nombresUsuarios).length > 0) return;
    try {
      const snapU = await getDocs(collection(db, 'usuarios'));
      const mapa: Record<string, string> = {};
      snapU.docs.forEach((d: any) => {
        const u: any = d.data() || {};
        mapa[d.id] = String(u.nombre || u.email || d.id);
      });
      setNombresUsuarios(mapa);
    } catch (e) { console.error('No se pudieron cargar los nombres de usuarios:', e); }
  };
  const nombreAuditor = (v: any, porDefecto: string = 'Desconocido'): string => {
    const t = String(v || '').trim();
    if (!t) return porDefecto;
    return nombresUsuarios[t] || t;
  };
  
  const [hayMasOperaciones, setHayMasOperaciones] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);

  const [modalHorarios, setModalHorarios] = useState<'cerrado' | 'registrar' | 'historial'>('cerrado');
  const [historialList, setHistorialList] = useState<any[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  const [nuevoStatus, setNuevoStatus] = useState('');
  const [nuevaFechaHora, setNuevaFechaHora] = useState('');
  
  const [guardandoStatusRapido, setGuardandoStatusRapido] = useState<string | null>(null);
  const [ultimoStatusGuardado, setUltimoStatusGuardado] = useState<string | null>(null);
  
  const [botonesDisponibles, setBotonesDisponibles] = useState<string[]>([]);
  const [catalogosGlobales, setCatalogosGlobales] = useState<any>({});

  const [busqueda, setBusqueda] = useState('');

  // ✅ NUEVO (Fix 1): filtros por columna (Tipo Operación, Status, Unidad Roelca, Remolque).
  // ✅ NUEVO: los filtros ahora viven en un drawer lateral derecho.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [filtroTipoOperacion, setFiltroTipoOperacion] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroUnidad, setFiltroUnidad] = useState('');
  const [filtroRemolque, setFiltroRemolque] = useState('');


  const [paginaActual, setPaginaActual] = useState(1);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  const [modalColumnas, setModalColumnas] = useState(false);
  // ✅ NUEVO: controla el modal de Resúmenes Diarios (Transfer/Logística/Fletes).
  const [mostrarResumenDiario, setMostrarResumenDiario] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));

  // ✅ NUEVO: ordenamiento por columna al hacer clic en el encabezado.
  //   1er clic = ascendente (▲), 2do clic = descendente (▼), 3er clic = orden original.
  const [ordenColumna, setOrdenColumna] = useState<string | null>(null);
  const [ordenDireccion, setOrdenDireccion] = useState<'asc' | 'desc' | null>(null);
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  const mapaStatus = useMemo(() => {
    const lista = (catalogosGlobales.statusServicio || []) as any[];
    const porId: Record<string, { id: string; nombre: string }> = {};
    const porNombre: Record<string, { id: string; nombre: string }> = {};
    // ✅ NUEVO: índice por descripción — operaciones guardadas con el bug que
    //    escribía la DESCRIPCIÓN del catálogo en statusNombre se curan en pantalla.
    const porDescripcion: Record<string, { id: string; nombre: string }> = {};
    lista.forEach(s => {
      const entry = { id: String(s.id || ''), nombre: String(s.nombre || s.id || '') };
      if (entry.id) porId[entry.id] = entry;
      if (entry.nombre) porNombre[entry.nombre.trim().toLowerCase()] = entry;
      const desc = String(s.descripcion || '').trim().toLowerCase();
      if (desc) porDescripcion[desc] = entry;
    });
    return { porId, porNombre, porDescripcion };
  }, [catalogosGlobales.statusServicio]);

  // ✅ NUEVO: lista de status ORDENADA (numérico → alfabético, ascendente) para
  //    el desplegable del modal "Registrar Movimiento".
  const statusServicioOrdenado = useMemo(() => {
    const lista = (catalogosGlobales.statusServicio || []) as any[];
    return [...lista]
      .filter((s: any) => s && s.nombre)
      .sort((a: any, b: any) => compararStatusPorNumero(String(a.nombre), String(b.nombre)));
  }, [catalogosGlobales.statusServicio]);

  const resolverStatus = (valor: string | null | undefined): { id: string; nombre: string } => {
    if (!valor) return { id: '', nombre: '' };
    const v = String(valor).trim();
    if (mapaStatus.porId[v]) return mapaStatus.porId[v];
    const porNom = mapaStatus.porNombre[v.toLowerCase()];
    if (porNom) return porNom;
    const porDesc = mapaStatus.porDescripcion[v.toLowerCase()];
    if (porDesc) return porDesc;
    return { id: v, nombre: v };
  };

  const COLECCIONES_CATALOGOS: Record<string, string> = {
    statusServicio:            'catalogo_status_servicio',
    tiposOperacion:            'catalogo_tipo_operacion',
    embalajes:                 'catalogo_embalaje',
    catalogoMoneda:            'catalogo_moneda',
    tarifas:                   'catalogo_tarifas_referencia',
    empresas:                  'empresas',
    remolques:                 'remolques',
    unidades:                  'unidades',
    empleados:                 'empleados',
    unidades_proveedor:        'unidades_proveedor',
    proveedores_unidad:        'proveedores_unidad',
    conveniosProv:             'convenios_proveedores',
    catalogoConvProvDetalles:  'convenios_proveedores_detalles',
    catalogoConvClientes:      'convenios_clientes',
    catalogoConvDetalles:      'convenios_clientes_detalles',
    catalogoTC:                'tipo_cambio',
    // ✅ Las EMPRESAS guardan solo direccionId; los datos estructurados de la
    //   dirección (calle, colonia, C.P., ciudad) viven en esta colección.
    direcciones:               'direcciones',
  };

  const catalogosEnVueloRef = useRef<Set<string>>(new Set());

  // ✅ `soloAlias` permite cargar SOLO ciertos catálogos. Al abrir el dashboard
  //    cargamos únicamente lo mínimo (status), y los catálogos pesados (empresas,
  //    unidades, empleados, convenios, tarifas…) se cargan bajo demanda al abrir
  //    el formulario o generar un PDF. Esto reduce mucho el consumo de lecturas.
  const cargarCatalogosSiEsNecesario = async (soloAlias?: string[]) => {
    const entradas = soloAlias
      ? Object.entries(COLECCIONES_CATALOGOS).filter(([alias]) => soloAlias.includes(alias))
      : Object.entries(COLECCIONES_CATALOGOS);
    const pendientes = entradas
      .filter(([alias]) => !cacheVigente(alias) && !catalogosEnVueloRef.current.has(alias))
      .map(([alias, col]) => ({ alias, col }));
    if (pendientes.length === 0) return;
    pendientes.forEach(p => catalogosEnVueloRef.current.add(p.alias));
    await Promise.all(pendientes.map(async ({ alias, col }) => {
      try {
        const snap = await getDocs(collection(db, col));
        const data = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        escribirCacheCatalogo(alias, data);
        setCatalogosGlobales((prev: any) => ({ ...prev, [alias]: data }));
      } catch (e) {
        console.error(`Error cargando catálogo "${col}":`, e);
      } finally {
        catalogosEnVueloRef.current.delete(alias);
      }
    }));
  };

  const hidratarCatalogosDesdeCache = () => {
    const inicial: any = {};
    Object.keys(COLECCIONES_CATALOGOS).forEach(alias => {
      const c = leerCacheCatalogo(alias);
      if (c && Array.isArray(c.data)) inicial[alias] = c.data;
    });
    if (Object.keys(inicial).length) {
      setCatalogosGlobales((prev: any) => ({ ...prev, ...inicial }));
    }
  };

  // ✅ Cursor robusto de paginación: guardamos el ÚLTIMO documento (snapshot),
  //    no solo su fecha, para no depender de que exista el campo `fechaServicio`.
  const ultimoDocRef = useRef<any>(null);

  const IDS_STATUS_EXCLUIDOS = ['7607f692', 'f557b751', 'c2d57403'];
  const esOperacionActiva = (op: any): boolean => {
    const statusId = String(op.status || '').trim();
    return !IDS_STATUS_EXCLUIDOS.includes(statusId);
  };

  const descargarOperaciones = async () => {
    setCargandoOperaciones(true);
    try {
      let docs: any[] = [];
      let metodo = 'directa (not-in)';
      let exito = false;

      try {
        const q1 = query(
          collection(db, 'operaciones'),
          where('status', 'not-in', IDS_STATUS_EXCLUIDOS),
          limit(TAMANO_PAGINA)
        );
        const snap1 = await getDocs(q1);
        docs = snap1.docs;
        exito = true;
      } catch (errNotIn) {
        console.warn('[Operaciones] La consulta not-in falló; uso respaldo sin filtro:', errNotIn);
      }

      if (!exito) {
        metodo = 'respaldo (sin filtro, filtra en memoria)';
        const q2 = query(collection(db, 'operaciones'), limit(2000));
        const snap2 = await getDocs(q2);
        docs = snap2.docs;
      }

      ultimoDocRef.current = docs.length ? docs[docs.length - 1] : null;

      // ✅ _docId = ID REAL del documento en Firestore. Se conserva aparte porque
      //    algunos registros (legacy/migrados) traen un campo `id` interno que
      //    sobrescribe a d.id en el spread; ese campo NO sirve para update/delete.
      const opDataRaw = docs.map((d: any) => ({ id: d.id, ...d.data(), _docId: d.id }));
      const operacionesActivas = opDataRaw.filter(esOperacionActiva);

      console.log(
        `[Operaciones v3] método: ${metodo} | crudas: ${opDataRaw.length} | activas: ${operacionesActivas.length}`
      );

      setOperacionesGlobales(operacionesActivas);
      setHayMasOperaciones(exito && docs.length === TAMANO_PAGINA);
    } catch (e: any) {
      console.error("Error al cargar operaciones:", e);
      const msg = String(e?.message || e?.code || e || '').toLowerCase();
      if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('429')) {
        alert("Cuota de lecturas de Firestore agotada.\n\nEl plan gratuito permite 50,000 lecturas/día y entre varias personas se agota. Se reinicia a las 2 AM (hora México).\n\nRecomendación: activa el plan Blaze en Firebase Console.");
      } else if (msg.includes('index')) {
        alert("Falta un índice en Firestore para esta consulta. Abre la consola del navegador (F12); el error de Firebase trae un enlace para crear el índice con un clic.");
      } else {
        alert("Hubo un problema al cargar las operaciones. Verifica tu conexión.");
      }
    }
    setCargandoOperaciones(false);
  };

  // ✅ MODIFICADO (V00114) — SINCRONIZAR NOMBRES: ahora usa la utilidad
  //   compartida `sincronizarNombresOperaciones` (misma que Servicios
  //   Completados y Cancelados). Re-resuelve las operaciones cargadas contra
  //   los catálogos actuales y reescribe SOLO nombres (nunca montos, tarifas,
  //   monedas ni tipos de cambio).
  const [sincronizandoNombres, setSincronizandoNombres] = useState(false);
  // ✅ V00132: SINCRONIZAR MONEDAS — recorre TODAS las operaciones de la BD y
  //   fuerza que "Facturado En" (cliente y proveedor) sea SÍ O SÍ la moneda que
  //   la empresa tiene guardada HOY en la tabla Empresas. Solo escribe donde
  //   hay diferencia; reporta cuántas cambió y cuáles empresas no tienen moneda.
  const [sincronizandoMonedas, setSincronizandoMonedas] = useState(false);
  // ✅ V00162: REPARAR CONSECUTIVOS de un día — cierra brincos y duplicados YA
  //   guardados (los creados por la función vieja o por borrados). Renumera las
  //   operaciones de cada (prefijo, fecha) en 1..N por orden de creación,
  //   actualiza ref/refConsecutivo SOLO donde cambia y re-sincroniza el contador.
  //   Es seguro para Facturación/Pagos: los dashboards resuelven la ref VIVA de
  //   cada operación por su id (refDeOp); los PDF ya emitidos conservan el texto viejo.
  const [reparandoConsec, setReparandoConsec] = useState(false);
  const repararConsecutivos = async () => {
    if (reparandoConsec) return;
    const hoy = new Date();
    const defFecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const fecha = window.prompt('Fecha de SERVICIO a reparar (AAAA-MM-DD).\nSe renumeran los folios de ese día en 1..N por orden de creación, cerrando brincos y duplicados:', defFecha);
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha.trim())) { if (fecha !== null) alert('Fecha inválida. Usa el formato AAAA-MM-DD.'); return; }
    const f = fecha.trim();
    const [aa, mm, dd] = f.split('-');
    const ddmmyy = `${dd}${mm}${aa.slice(2)}`;
    setReparandoConsec(true);
    try {
      const snap = await getDocs(query(collection(db, 'operaciones'), where('fechaServicio', '==', f)));
      const porPrefijo = new Map<string, any[]>();
      snap.docs.forEach((d) => {
        const x: any = d.data();
        const ref = String(x.ref || '');
        const m = ref.match(/^([A-ZÑ0-9.]+)-(\d{6})-(\d+)/i);
        const prefijo = String(x.refPrefijo || '').split('-')[0] || (m ? m[1].toUpperCase() : '');
        if (!prefijo) return; // sin ref ni prefijo: no se toca
        if (!porPrefijo.has(prefijo)) porPrefijo.set(prefijo, []);
        porPrefijo.get(prefijo)!.push({ id: d.id, ref, num: m ? Number(m[3]) || 0 : Number(x.refConsecutivo) || 0, createdAt: String(x.createdAt || x.creadoEn || '') });
      });
      if (porPrefijo.size === 0) { alert(`No hay operaciones con fecha de servicio ${f}.`); return; }

      const resumen: string[] = [];
      let totalCambios = 0;
      let batch = writeBatch(db);
      let enBatch = 0;
      const flush = async () => { if (enBatch > 0) { await batch.commit(); batch = writeBatch(db); enBatch = 0; } };

      for (const [prefijo, lista] of porPrefijo.entries()) {
        // Orden estable: por fecha de creación; respaldo por número actual.
        lista.sort((a, b) => (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) ? a.createdAt.localeCompare(b.createdAt) : (a.num - b.num));
        const cambios: string[] = [];
        lista.forEach((op, i) => {
          const asignado = i + 1;
          const nuevoRef = `${prefijo}-${ddmmyy}-${String(asignado).padStart(3, '0')}`;
          if (op.ref !== nuevoRef) {
            batch.update(doc(db, 'operaciones', op.id), { ref: nuevoRef, refPrefijo: `${prefijo}-${ddmmyy}`, refConsecutivo: asignado });
            enBatch++; totalCambios++;
            cambios.push(`${op.ref || '(sin ref)'} → ${nuevoRef}`);
          }
        });
        // Contador re-sincronizado con la realidad compactada.
        batch.set(doc(db, 'counters', `operaciones_${prefijo}_${ddmmyy}`), { count: lista.length, prefijo, fecha: ddmmyy, syncAt: new Date().toISOString(), reparadoManual: true }, { merge: true });
        enBatch++;
        if (enBatch >= 380) await flush();
        resumen.push(`${prefijo}: ${lista.length} op(s), ${cambios.length} renumerada(s)${cambios.length ? `\n   · ${cambios.slice(0, 12).join('\n   · ')}${cambios.length > 12 ? `\n   · … y ${cambios.length - 12} más` : ''}` : ''}`);
      }
      const seguir = window.confirm(`Reparación de consecutivos — ${f}:\n\n${resumen.join('\n')}\n\n${totalCambios === 0 ? 'Todo está en orden; solo se re-sincronizan los contadores.' : `Se renumerarán ${totalCambios} operación(es) y se re-sincronizan los contadores.`}\n\n¿Aplicar?`);
      if (!seguir) { setReparandoConsec(false); return; }
      await flush();
      notificarOperacionGuardada('reparar-consecutivos', {}, 'reparar-consecutivos');
      await registrarLog('Operaciones', 'Edición', `Reparó los consecutivos del ${f}: ${totalCambios} operación(es) renumeradas (${Array.from(porPrefijo.keys()).join(', ')}).`);
      alert(`Consecutivos del ${f} reparados. ✅\n\n${totalCambios} operación(es) renumeradas; contadores re-sincronizados.\nNota: los PDF/remisiones ya emitidos conservan el folio anterior en su texto.`);
    } catch (e: any) {
      alert(`No se pudo reparar: ${e?.message || e}`);
    } finally { setReparandoConsec(false); }
  };

  const sincronizarMonedasOperaciones = async () => {
    if (sincronizandoMonedas) return;
    if (!window.confirm(
      'Se revisarán TODAS las operaciones de la base de datos y se les colocará, tanto en el lado del CLIENTE (Facturado En) como en el del PROVEEDOR, ' +
      'la moneda que cada empresa tiene guardada actualmente en la tabla Empresas.\n\n' +
      'Solo se escriben las operaciones donde la moneda sea distinta; montos y tarifas no se tocan.\n\n¿Continuar?'
    )) return;
    setSincronizandoMonedas(true);
    try {
      const [snapMon, snapEmp] = await Promise.all([
        getDocs(collection(db, 'catalogo_moneda')),
        getDocs(collection(db, 'empresas')),
      ]);
      const monedasCat = snapMon.docs.map((d) => ({ id: d.id, moneda: String((d.data() as any).moneda || '') }));
      const resolver = (raw: string): string => {
        const v = String(raw || '').trim();
        if (!v) return '';
        if (monedasCat.some((m) => m.id === v)) return v;
        const up = v.toUpperCase();
        const porTexto = monedasCat.find((m) => { const n = m.moneda.toUpperCase(); return n === up || (!!n && (n.includes(up) || up.includes(n))); });
        if (porTexto) return porTexto.id;
        if (up.includes('USD') || up.includes('DOLAR') || up.includes('DÓLAR')) return ID_USD;
        if (up.includes('MXN') || up.includes('PESO')) return ID_MXN;
        return '';
      };
      const monedaEmpresa: Record<string, string> = {};
      const nombreEmpresa: Record<string, string> = {};
      snapEmp.docs.forEach((d) => {
        const e: any = d.data();
        monedaEmpresa[d.id] = resolver(String(e.moneda ?? e.monedaId ?? e.monedaRef ?? ''));
        nombreEmpresa[d.id] = String(e.nombre || e.empresa || d.id);
      });

      let revisadas = 0, cambiadasCli = 0, cambiadasProv = 0, opsEscritas = 0;
      const sinMoneda = new Set<string>();
      const cambiosLocales: Record<string, any> = {};
      let batch = writeBatch(db);
      let enBatch = 0;
      const flush = async () => { if (enBatch > 0) { await batch.commit(); batch = writeBatch(db); enBatch = 0; } };

      let cursor: any = null;
      for (;;) {
        const cons: any[] = [orderBy('__name__'), limit(500)];
        if (cursor) cons.push(startAfter(cursor));
        const snap = await getDocs(query(collection(db, 'operaciones'), ...cons));
        if (snap.empty) break;
        cursor = snap.docs[snap.docs.length - 1];
        for (const d of snap.docs) {
          const op: any = d.data();
          revisadas++;
          const upd: Record<string, string> = {};
          const cliId = String(op.clientePaga || '');
          if (cliId) {
            const monCli = monedaEmpresa[cliId];
            if (!monCli) sinMoneda.add(nombreEmpresa[cliId] || cliId);
            else if (String(op.facturadoEnCobrar || '') !== monCli) { upd.facturadoEnCobrar = monCli; cambiadasCli++; }
          }
          const provId = String(op.proveedorUnidad || '');
          if (provId) {
            const monProv = monedaEmpresa[provId];
            if (!monProv) sinMoneda.add(nombreEmpresa[provId] || provId);
            else if (String(op.facturadoEnUnidad || '') !== monProv) { upd.facturadoEnUnidad = monProv; cambiadasProv++; }
          }
          if (Object.keys(upd).length) {
            batch.update(d.ref, upd);
            cambiosLocales[d.id] = upd;
            opsEscritas++; enBatch++;
            if (enBatch >= 400) await flush();
          }
        }
        if (snap.docs.length < 500) break;
      }
      await flush();

      if (opsEscritas > 0) {
        setOperacionesGlobales((prev) => prev.map((o: any) => cambiosLocales[String(o.id)] ? { ...o, ...cambiosLocales[String(o.id)] } : o));
        // Un solo aviso al bus: invalida las cachés de Facturación/Pagos.
        const primero = Object.keys(cambiosLocales)[0];
        notificarOperacionGuardada(primero, cambiosLocales[primero], 'sincronizar-monedas');
      }
      alert(
        `Sincronización de monedas completada. ✅\n\n` +
        `Operaciones revisadas: ${revisadas}\n` +
        `Operaciones actualizadas: ${opsEscritas} (cliente: ${cambiadasCli} · proveedor: ${cambiadasProv})` +
        (sinMoneda.size ? `\n\n⚠ Empresas SIN moneda en la tabla Empresas (no se tocaron sus operaciones):\n· ${Array.from(sinMoneda).slice(0, 15).join('\n· ')}${sinMoneda.size > 15 ? `\n… y ${sinMoneda.size - 15} más` : ''}` : '')
      );
      await registrarLog('Operaciones', 'Edición', `Sincronizó monedas desde Empresas: ${opsEscritas} operación(es) actualizadas (cliente ${cambiadasCli}, proveedor ${cambiadasProv}) de ${revisadas} revisadas.`);
    } catch (e: any) {
      console.error('sincronizarMonedasOperaciones:', e);
      alert('La sincronización de monedas no terminó completa.\n\nDetalle: ' + (e?.message || e?.code || 'desconocido') + '\n\nPuedes volver a ejecutarla; continúa donde hizo falta.');
    }
    setSincronizandoMonedas(false);
  };

  const sincronizarNombresOperaciones = async () => {
    if (sincronizandoNombres || operacionesGlobales.length === 0) return;
    const confirmado = window.confirm(
      `Se revisarán las ${operacionesGlobales.length} operaciones cargadas y se actualizarán los nombres ` +
      `(tipo de operación, status, empresas y carga) que quedaron viejos tras renombrar en Catálogos.\n\n` +
      `Solo se corrigen NOMBRES; los montos y tarifas guardados no se tocan.\n\n¿Continuar?`
    );
    if (!confirmado) return;
    setSincronizandoNombres(true);
    try {
      const { cambiosPorId, corregidos } = await sincronizarNombresUtil(operacionesGlobales, 'Operaciones');
      if (corregidos > 0) {
        setOperacionesGlobales((prev) => prev.map((o: any) =>
          cambiosPorId[String(o.id)] ? { ...o, ...cambiosPorId[String(o.id)] } : o));
      }
      alert(corregidos > 0
        ? `Sincronización completada. ✅\n\nSe actualizaron ${corregidos} operación(es) con los nombres actuales de los catálogos.`
        : 'Sincronización completada. ✅\n\nLas operaciones cargadas ya tenían los nombres al día.');
    } catch (e: any) {
      console.error('Error sincronizando nombres de operaciones:', e);
      alert('La sincronización no terminó completa.\n\nDetalle técnico: ' + (e?.message || e?.code || 'desconocido') + '\n\nPuedes volver a ejecutarla: lo ya corregido no se repite.');
    }
    setSincronizandoNombres(false);
  };

  const actualizarOperaciones = async () => {
    if (cargandoOperaciones || cargandoMas) return;
    ultimoDocRef.current = null;
    setHayMasOperaciones(true);
    setPaginaActual(1);
    await descargarOperaciones();
  };

  const cargarMasOperaciones = async () => {
    if (!hayMasOperaciones || cargandoMas || operacionesGlobales.length === 0) return;
    setCargandoMas(true);
    try {
      const cursor = ultimoDocRef.current;

      const constraints: any[] = [where('status', 'not-in', IDS_STATUS_EXCLUIDOS)];
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(TAMANO_PAGINA));

      const snap = await getDocs(query(collection(db, 'operaciones'), ...constraints));
      const docs = snap.docs;

      if (docs.length) ultimoDocRef.current = docs[docs.length - 1];

      const nuevasRaw = docs.map((d: any) => ({ id: d.id, ...d.data(), _docId: d.id }));
      const nuevasFiltradas = nuevasRaw.filter(esOperacionActiva);

      setOperacionesGlobales(prev => {
        const idsPrev = new Set(prev.map((o: any) => String(o.id)));
        const sinDuplicar = nuevasFiltradas.filter((o: any) => !idsPrev.has(String(o.id)));
        return [...prev, ...sinDuplicar];
      });
      setHayMasOperaciones(docs.length === TAMANO_PAGINA);
    } catch (e) {
      console.error("Error al cargar más operaciones:", e);
      alert("No se pudieron cargar más operaciones.");
    }
    setCargandoMas(false);
  };

  useEffect(() => {
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('cat_v1__')) { localStorage.removeItem(k); return; }
        if (k.startsWith('cat_v2__')) {
          try {
            const obj = JSON.parse(localStorage.getItem(k) || '{}');
            if (!obj || !Array.isArray(obj.data) || obj.data.length === 0) localStorage.removeItem(k);
          } catch { localStorage.removeItem(k); }
        }
      });
    } catch {}

    // Hidrata TODO lo que ya esté en caché local (localStorage) sin costo de
    // lecturas, y desde Firestore SOLO baja el catálogo de status (necesario
    // para los botones de "siguiente paso" y el modal de registrar movimiento).
    // La tabla se pinta con los nombres ya guardados en cada operación.
    hidratarCatalogosDesdeCache();
    cargarCatalogosSiEsNecesario(['statusServicio']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    descargarOperaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const b64 = empresaConfig?.logoBase64;
    setLogoPdf(b64 && b64.startsWith('data:') ? b64 : '');
  }, [empresaConfig?.logoBase64]);

  useEffect(() => { setPaginaActual(1); }, [busqueda, filtroTipoOperacion, filtroStatus, filtroUnidad, filtroRemolque]);

  useEffect(() => {
    const cargarBotones = async () => {
      if (operacionViendo) {
        let op = operacionViendo;
        if (!op.statusNombre && op.status) {
          const resuelto = resolverStatus(op.status);
          if (resuelto.nombre && resuelto.nombre !== resuelto.id) {
            op = { ...op, statusNombre: resuelto.nombre };
          }
        }
        const botones = await obtenerBotonesHorarioDinamicos(op);
        setBotonesDisponibles(botones || []);
      } else {
        setBotonesDisponibles([]);
      }
    };
    cargarBotones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionViendo, mapaStatus]);

  const handleNuevo = async () => { 
    await cargarCatalogosSiEsNecesario();
    setOperacionEditando(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const editarOperacion = async (operacion: any) => { 
    await cargarCatalogosSiEsNecesario();
    setOperacionEditando(operacion); 
    setOperacionViendo(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const eliminarOperacion = async (op: any) => {
    if (!op) return;
    // ✅ Borra por el ID REAL de Firestore (_docId); si no existe, cae al id.
    const docId = op._docId || op.id;
    if (!docId) return;
    if (window.confirm('¿Estás seguro de eliminar este registro permanentemente?')) {
      try {
        await eliminarRegistro('operaciones', docId); 
        setOperacionesGlobales(prev => prev.filter((o: any) => String(o.id) !== String(op.id)));
        setOperacionViendo(null);
      } catch (error: any) {
        console.error("Error al eliminar:", error);
        alert("Hubo un error al intentar eliminar el registro.\n\nDetalle técnico: " + (error?.message || error?.code || 'desconocido'));
      }
    }
  };
  
  const mostrarDato = (dato: any) => (dato && dato !== '' ? dato : '-');
  
  const formatearFechaHora = (isoString: string | undefined | null) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  
  const mostrarMoneda = (val: string | null | undefined) => {
    if (val === ID_USD) return 'USD';
    if (val === ID_MXN) return 'MXN';
    return val || '-';
  };

  // ✅ Muestra ÚNICAMENTE el nombre desnormalizado ya guardado en la operación.
  //    NO consulta otras colecciones (reduce lecturas de Firestore) y NUNCA
  //    muestra un ID: si no hay nombre guardado, devuelve '-'. Para monedas cae
  //    a la conversión ID→USD/MXN, que es local (sin catálogo).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mostrarDatoMapeado = (id: string | null | undefined, catalogo: keyof typeof catalogosGlobales, _campoRetorno: string = 'nombre', valorDesnormalizado?: string) => {
    const v = valorDesnormalizado != null ? String(valorDesnormalizado).trim() : '';
    if (v && v !== '-' && v !== String(id ?? '').trim()) return String(valorDesnormalizado);
    if ((catalogo === 'catalogoMoneda' || catalogo === 'catalogo_moneda') && id) {
      const m = mostrarMoneda(id);
      if (m && m !== '-') return m;
    }
    return '-';
  };

  // ✅ Solo nombre desnormalizado (convenioNombre). Sin lecturas de catálogos.
  const obtenerNombreConvenioCliente = (id: string, valorDesnormalizado?: string) => {
    const v = valorDesnormalizado != null ? String(valorDesnormalizado).trim() : '';
    if (v && v !== '-' && v !== String(id ?? '').trim()) return String(valorDesnormalizado);
    return '-';
  };

  // ✅ Solo nombre desnormalizado (convenioProveedorNombre). Sin lecturas.
  const obtenerNombreConvenioProv = (id: string, valorDesnormalizado?: string) => {
    const v = valorDesnormalizado != null ? String(valorDesnormalizado).trim() : '';
    if (v && v !== '-' && v !== String(id ?? '').trim()) return String(valorDesnormalizado);
    return '-';
  };

  const formatoMoneda = (monto: any) => {
    if (!monto) return '$ 0.00';
    return `$ ${parseFloat(monto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const resolverRemolqueParaPDF = (): { nombre: string; placa: string } => {
    const lista: any[] = Array.isArray(catalogosGlobales.remolques) ? catalogosGlobales.remolques : [];
    const ref = operacionViendo?.numeroRemolque;
    const combinado = String(operacionViendo?.remolqueNombre || ref || '').trim();
    const primerToken = combinado.split(/\s+/)[0] || '';

    let obj = ref ? lista.find((r: any) => String(r.id).trim() === String(ref).trim()) : undefined;
    if (!obj && ref) obj = lista.find((r: any) => String(r.nombre || '').trim() === String(ref).trim());
    if (!obj && primerToken) obj = lista.find((r: any) => String(r.nombre || '').trim() === primerToken);
    if (!obj && combinado) {
      obj = lista.find((r: any) => `${r.nombre || ''} ${r.placas || r.placa || ''}`.trim() === combinado);
    }

    let nombre = obj?.nombre ? String(obj.nombre).trim() : '';
    let placa = (obj?.placa || obj?.placas) ? String(obj?.placa || obj?.placas).trim() : '';

    if (!nombre || !placa) {
      const partes = combinado.split(/\s+/).filter(Boolean);
      if (!nombre) nombre = partes[0] || '';
      if (!placa && partes.length > 1) placa = partes.slice(1).join(' ');
    }

    if (!placa) placa = String(operacionViendo?.remolquePlaca || operacionViendo?.remolquePlacas || '').trim();

    return { nombre: nombre || 'N/A', placa: placa || 'N/A' };
  };

  const resolverUnidadParaPDF = (): { nombre: string; placa: string } => {
    const refUnidad = operacionViendo?.unidad;
    const listaU: any[] = Array.isArray(catalogosGlobales.unidades) ? catalogosGlobales.unidades : [];
    const uObj = refUnidad ? listaU.find((u: any) => String(u.id).trim() === String(refUnidad).trim()) : undefined;

    let nombre = String(
      operacionViendo?.unidadNombre ||
      (uObj ? (uObj.unidad || uObj.numeroEconomico || uObj.numeroUnidad || uObj.nombre || uObj.economico) : '') ||
      ''
    ).trim();
    let placa = String(
      operacionViendo?.unidadPlacas ||
      operacionViendo?.unidadPlaca ||
      (uObj ? (uObj.placas || uObj.placa) : '') ||
      ''
    ).trim();

    if (!nombre && operacionViendo?.unidadProveedor) {
      const listaP: any[] = Array.isArray(catalogosGlobales.unidades_proveedor) ? catalogosGlobales.unidades_proveedor : [];
      const pObj = listaP.find((u: any) => String(u.id).trim() === String(operacionViendo.unidadProveedor).trim());
      if (pObj) {
        nombre = String(pObj.numeroUnidad || pObj.numeroEconomico || pObj.unidad || pObj.nombre || '').trim();
        if (!placa) placa = String(pObj.placas || pObj.placa || '').trim();
      }
    }

    return { nombre: nombre || 'N/A', placa: placa || 'N/A' };
  };

  const resolverOperadorParaPDF = (): string => {
    if (operacionViendo?.operadorNombre) return String(operacionViendo.operadorNombre).trim();
    const mapeado = mostrarDatoMapeado(operacionViendo?.operador, 'empleados');
    if (mapeado && mapeado !== '-' && mapeado !== operacionViendo?.operador) return String(mapeado).trim();
    if (operacionViendo?.operadorProveedor) {
      const listaP: any[] = Array.isArray(catalogosGlobales.proveedores_unidad) ? catalogosGlobales.proveedores_unidad : [];
      const oObj = listaP.find((o: any) => String(o.id).trim() === String(operacionViendo.operadorProveedor).trim());
      if (oObj) return String(oObj.nombre || oObj.firstName || '').trim() || 'N/A';
    }
    return 'N/A';
  };

  // ✅ Detecta si la operación es Logística o Fletes (para vaciar unidad/operador
  //    en los documentos: en esos casos los asigna el proveedor externo).
  const esLogisticaOFletesActual = (): boolean => {
    const t = String(
      operacionViendo?.tipoOperacionNombre ||
      mostrarDatoMapeado(operacionViendo?.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', operacionViendo?.tipoOperacionNombre) ||
      ''
    ).toLowerCase();
    return t.includes('logistica') || t.includes('logística') || t.includes('flete');
  };

  const abrirRegistroHorario = () => {
    // ✅ FIX: hora local real del dispositivo (o de la zona fija configurada),
    //    sin el truco de tzOffset que dependía del UTC.
    const localISOTime = ahoraLocalISOCorto();
    setNuevaFechaHora(localISOTime);
    setNuevoStatus(botonesDisponibles[0] || ''); 
    setModalHorarios('registrar');
  };

  const verHistorial = async () => {
    setModalHorarios('historial');
    setCargandoHorarios(true);
    try {
      const dbQuery = query(collection(db, 'horarios'), where('operacionId', '==', operacionViendo.id));
      const snap = await getDocs(dbQuery);
      const data = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
      data.sort((a: any, b: any) => new Date(b.fechaHora).getTime() - new Date(a.fechaHora).getTime());
      setHistorialList(data);
    } catch (e) {}
    setCargandoHorarios(false);
  };

  const guardarHorario = async () => {
    if (!nuevoStatus || !nuevaFechaHora) return alert("Completa la fecha y el estatus.");
    setCargandoHorarios(true);
    try {
      const { id: statusId, nombre: statusNombreResuelto } = resolverStatus(nuevoStatus);

      const batch = writeBatch(db);
      const horarioRef = doc(collection(db, 'horarios'));
      batch.set(horarioRef, limpiarUndefined({
        operacionId: operacionViendo.id,
        status: statusId,
        statusNombre: statusNombreResuelto,
        fechaHora: nuevaFechaHora,
        registradoEn: new Date().toISOString()
      }));
      const opRef = doc(db, 'operaciones', String(operacionViendo._docId || operacionViendo.id));
      batch.update(opRef, limpiarUndefined({ status: statusId, statusNombre: statusNombreResuelto }));

      await batch.commit();
      notificarOperacionGuardada(String(operacionViendo._docId || operacionViendo.id), { ...operacionViendo, status: statusId, statusNombre: statusNombreResuelto }, 'operaciones-status'); // ✅ V00126

      const operacionActualizada = {
        ...operacionViendo,
        status: statusId,
        statusNombre: statusNombreResuelto
      };
      setOperacionViendo(operacionActualizada);
      setOperacionesGlobales(prev => prev.map((op: any) =>
        op.id === operacionViendo.id ? operacionActualizada : op
      ));

      alert('Horario registrado y Estatus actualizado.');
      setModalHorarios('cerrado');
    } catch (e: any) {
      console.error('Error guardarHorario:', e);
      alert("Error al actualizar la base de datos.\n\nDetalle técnico: " + (e?.message || e?.code || 'desconocido'));
    }
    setCargandoHorarios(false);
  };

  const registrarStatusRapido = async (statusNombre: string) => {
    if (!operacionViendo || !statusNombre) return;
    if (guardandoStatusRapido) return;

    const _normalizar = (s: string) =>
      String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (_normalizar(statusNombre).includes('cancel')) {
      const refOp = operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'esta operación';
      const confirmado = window.confirm(
        `¿Seguro que deseas CANCELAR la operación ${refOp}?\n\n` +
        `Se registrará el status "${statusNombre}" y la referencia quedará cancelada.`
      );
      if (!confirmado) return;
    }

    setGuardandoStatusRapido(statusNombre);

    const operacionPrevia = operacionViendo;
    const operacionesPrevias = operacionesGlobales;
    const botonesPrevios = botonesDisponibles;

    try {
      let opParaCascada = operacionViendo;
      if (!opParaCascada.statusNombre && opParaCascada.status) {
        const r = resolverStatus(opParaCascada.status);
        opParaCascada = { ...opParaCascada, statusNombre: r.nombre };
      }

      const cadenaStatus = await resolverCascadaStatus(statusNombre, opParaCascada);
      const cadenaResuelta = cadenaStatus.map(resolverStatus);
      const statusFinal = cadenaResuelta[cadenaResuelta.length - 1];

      // ✅ Validación defensiva: si por alguna razón no se resolvió un status
      //    final válido, no intentamos el commit (evita escribir basura/undefined).
      if (!statusFinal || !statusFinal.id) {
        setGuardandoStatusRapido(null);
        alert(`No se pudo resolver el status "${statusNombre}". Revisa la configuración de la cascada de estatus.`);
        return;
      }

      const operacionActualizada = {
        ...operacionViendo,
        status: statusFinal.id,
        statusNombre: statusFinal.nombre
      };
      setOperacionViendo(operacionActualizada);
      setOperacionesGlobales(prev => prev.map((op: any) =>
        op.id === operacionViendo.id ? operacionActualizada : op
      ));

      obtenerBotonesHorarioDinamicos(operacionActualizada)
        .then(botones => setBotonesDisponibles(botones || []))
        .catch(() => {});

      // ✅ FIX: hora local consistente (ver src/utils/fechaHoraLocal.ts).
      const fechaHoraLocal = ahoraLocalISOCorto();
      const registradoEn = new Date().toISOString();

      (async () => {
        try {
          const batch = writeBatch(db);

          cadenaResuelta.forEach((statusPaso, idx) => {
            const horarioRef = doc(collection(db, 'horarios'));
            // ✅ limpiarUndefined: Firestore RECHAZA campos `undefined` y eso
            //    aborta TODO el batch (causa típica de "Se revirtió el cambio").
            batch.set(horarioRef, limpiarUndefined({
              operacionId: operacionViendo.id,
              status: statusPaso.id,
              statusNombre: statusPaso.nombre,
              fechaHora: fechaHoraLocal,
              registradoEn: registradoEn,
              ordenCascada: idx,
              esAutomatico: idx > 0,
            }));
          });

          const opRef = doc(db, 'operaciones', String(operacionViendo._docId || operacionViendo.id));
          batch.update(opRef, limpiarUndefined({
            status: statusFinal.id,
            statusNombre: statusFinal.nombre
          }));

          await batch.commit();
          notificarOperacionGuardada(String(operacionViendo._docId || operacionViendo.id), { ...operacionViendo, status: statusFinal.id, statusNombre: statusFinal.nombre }, 'operaciones-status'); // ✅ V00126

          setGuardandoStatusRapido(null);
          setUltimoStatusGuardado(statusNombre);
          setTimeout(() => setUltimoStatusGuardado(null), 1500);
        } catch (e: any) {
          console.error("Error al registrar status:", e);
          setOperacionViendo(operacionPrevia);
          setOperacionesGlobales(operacionesPrevias);
          setBotonesDisponibles(botonesPrevios);
          setGuardandoStatusRapido(null);

          // ✅ MEJORADO: en lugar de un mensaje genérico, mostramos la CAUSA real
          //    (código + mensaje de Firebase) para poder diagnosticar el problema.
          const code = String(e?.code || '').toLowerCase();
          const msg = String(e?.message || e?.code || e || '').toLowerCase();
          const detalle = e?.message || e?.code || 'desconocido';

          if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('429')) {
            alert(
              "Cuota de Firestore agotada.\n\n" +
              "Tu proyecto superó el límite gratuito diario. La cuota se reinicia a las 2 AM (hora México).\n\n" +
              "Recomendación: activa el plan Blaze en Firebase Console para evitar este límite."
            );
          } else if (code.includes('permission-denied') || msg.includes('permission') || msg.includes('insufficient') || msg.includes('missing or insufficient')) {
            alert(
              "Permiso denegado por Firestore.\n\n" +
              "Tu usuario no tiene permiso para actualizar el estatus (escribir en 'operaciones' y/o 'horarios').\n\n" +
              "Revisa las reglas de seguridad de Firestore para esas colecciones.\n\n" +
              "Detalle técnico: " + detalle
            );
          } else if (code.includes('not-found') || msg.includes('no document to update') || msg.includes('not-found')) {
            alert(
              "La operación que intentas actualizar ya no existe en la base de datos (pudo eliminarse).\n\n" +
              "Detalle técnico: " + detalle
            );
          } else if (code.includes('invalid-argument') || msg.includes('invalid') || msg.includes('undefined') || msg.includes('unsupported field value')) {
            alert(
              "Hubo un dato inválido al guardar el estatus (un campo vacío o con formato no permitido).\n\n" +
              "Detalle técnico: " + detalle
            );
          } else {
            alert(
              "Error al guardar el status. Se revirtió el cambio.\n\n" +
              "Detalle técnico: " + detalle
            );
          }
        }
      })();
    } catch (e: any) {
      console.error("Error resolviendo cascada:", e);
      setGuardandoStatusRapido(null);
      alert("Error al procesar el cambio de status. Intenta de nuevo.\n\nDetalle técnico: " + (e?.message || e?.code || 'desconocido'));
    }
  };

  const handleOperacionGuardada = () => {
    // ✅ NUEVO: el formulario refresca las cachés cat_v2 (incluye clientes,
    //   proveedores y bodegas recién creados) — se re-hidratan EN MEMORIA para
    //   que la tabla y los documentos PDF los muestren al instante.
    hidratarCatalogosDesdeCache();
    descargarOperaciones();
    setEstadoFormulario('cerrado');
    setOperacionEditando(null);
  };

  const handleDescargarSolicitudRetiro = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origen = mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueRes = resolverRemolqueParaPDF();
    const unidadRes = resolverUnidadParaPDF();
    const operadorRes = resolverOperadorParaPDF();

    generarSolicitudRetiroPDF({
      bodegaNombre: origen,
      tipoMovimiento: operacionViendo.trafico || 'N/A',
      remolqueNombre: remolqueRes.nombre,
      remolquePlacas: remolqueRes.placa,
      clienteMercancia: operacionViendo.clienteMercanciaNombre || mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      unidadNombre: unidadRes.nombre,
      unidadPlacas: unidadRes.placa,
      empleadoNombre: operadorRes,
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
    });
  };

  const handleDescargarInstruccionesServicio = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueRes = resolverRemolqueParaPDF();
    const unidadRes = resolverUnidadParaPDF();
    const operadorRes = resolverOperadorParaPDF();

    // ✅ CAMBIO 1: si la operación es Logística o Fletes, la Unidad y el Operador
    //    van VACÍOS en el documento (los asigna el proveedor externo).
    const esLogFlete = esLogisticaOFletesActual();

    // ✅ CAMBIO 2: en el campo "Tipo de Operación" del documento va el CONVENIO
    //    (tarifa del cliente), no el tipo de operación como tal.
    const convenioCliente = obtenerNombreConvenioCliente(operacionViendo.convenio, operacionViendo.convenioNombre);

    generarInstruccionesServicioPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'N/A',
      fecha: operacionViendo.fechaServicio || '',
      unidadNombre: esLogFlete ? '' : unidadRes.nombre,
      empleadoNombre: esLogFlete ? '' : operadorRes,
      remolqueNombre: remolqueRes.nombre,
      remolquePlacas: remolqueRes.placa,
      tipoOperacion: (convenioCliente && convenioCliente !== '-') ? convenioCliente : '',
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      clienteMercancia: operacionViendo.clienteMercanciaNombre || mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
    });
  };

  const handleDescargarCheckList = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);
    const unidadRes = resolverUnidadParaPDF();
    const empNombre = resolverOperadorParaPDF();
    const uniNombre = unidadRes.nombre;
    const uniPlacas = unidadRes.placa;

    generarCheckListPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fecha: operacionViendo.fechaServicio || '',
      cliente: operacionViendo.clienteMercanciaNombre || mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      remolque: operacionViendo.remolqueNombre || (remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A'),
      proveedor: operacionViendo.proveedorUnidadNombre || mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas'),
      tractorInfo: `${uniNombre} / ${uniPlacas} / ${empNombre}`,
      numeroPedimento: operacionViendo.numDoda || 'N/A',
      prefileEntrys: String(operacionViendo.cantEntrys || '0'),
      entryReferencia: operacionViendo.numeroEntrys || 'N/A',
      manifiesto: operacionViendo.numManifiesto || 'N/A',
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      operadorNombre: empNombre,
      supervisor: operacionViendo.observacionesEjecutivo || 'Despacho',
    });
  };

  const handleDescargarPruebaEntrega = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);
    const empNombre = resolverOperadorParaPDF();

    generarPruebaEntregaPDF({
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fechaServicio: operacionViendo.fechaServicio || 'N/A',
      fechaCita: operacionViendo.fechaCita ? new Date(operacionViendo.fechaCita).toLocaleString('es-MX') : 'N/A',
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: datosDireccionEmpresa(origenObj).direccion,
      origenCP: datosDireccionEmpresa(origenObj).cp,
      origenCiudad: datosDireccionEmpresa(origenObj).ciudad,
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: datosDireccionEmpresa(destinoObj).direccion,
      destinoCP: datosDireccionEmpresa(destinoObj).cp,
      destinoCiudad: datosDireccionEmpresa(destinoObj).ciudad,
      tipoServicio: `${operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion')} ${operacionViendo.trafico || ''}`,
      tipoUnidad: remolqueObj ? (remolqueObj.tipo || remolqueObj.descripcion || 'Remolque') : 'N/A',
      numeroEconomico: operacionViendo.remolqueNombre || (remolqueObj ? remolqueObj.nombre : 'N/A'),
      placas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      operador: empNombre,
      descripcionMercancia: operacionViendo.descripcionMercancia || 'N/A'
    });
  };

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ (Direcciones para PDFs) Las empresas guardan `direccionId` que apunta a
  //   la colección `direcciones`. Este helper arma { direccion, colonia, cp,
  //   ciudad } desde el registro estructurado y, si no existe, PARSEA el texto
  //   libre de emp.direccion ("Calle #x, Col. Y, C.P. Z, Ciudad, ...").
  // ═══════════════════════════════════════════════════════════════════════
  // ✅ Parser de una dirección en TEXTO libre ("Calle #x, Col. Y, C.P. Z,
  //   Municipio, Estado, País") → partes separadas. Se usa como respaldo.
  const parsearDireccionTexto = (texto: string) => {
    const partes = String(texto || '').split(',').map(x => x.trim()).filter(Boolean);
    const mCol = String(texto || '').match(/col(?:onia)?\.?\s*([^,]+)/i);
    const mCP = String(texto || '').match(/c\.?\s*p\.?\s*:?\s*(\d{4,6})/i) || String(texto || '').match(/(?:^|[\s,])(\d{5})(?![\d-])/);
    const esPais = (t: string) => /^(m[e\u00e9]xico|estados unidos|usa|eua|united states)$/i.test(t.trim());
    const esCPtxt = (t: string) => /c\.?\s*p\.?/i.test(t) || /^\d{5}$/.test(t.trim());
    const esColTxt = (t: string) => /^col(?:onia)?\.?\s/i.test(t.trim());
    const candidatas = partes.slice(1).filter(t => !esPais(t) && !esCPtxt(t) && !esColTxt(t));
    return {
      direccion: partes[0] || String(texto || '').trim(),
      colonia: mCol ? mCol[1].trim() : '',
      cp: mCP ? mCP[1] : '',
      municipio: candidatas.length >= 2 ? candidatas[candidatas.length - 2] : '',
      estado: candidatas.length >= 1 ? candidatas[candidatas.length - 1] : '',
      pais: partes.find(t => esPais(t)) || '',
    };
  };

  // ✅ Desglose de la dirección de una empresa para los PDFs.
  //   Orden de resolución:
  //   1. Registro del catálogo `direcciones` por direccionId (o por coincidencia
  //      de texto con direccionCompleta, por si el id quedó desactualizado).
  //   2. Campos estructurados del registro (calleNombre, coloniaNombre, ...);
  //      lo que falte se completa parseando su direccionCompleta.
  //   3. Sin registro: se parsea el texto guardado en la empresa.
  //   `completa` SIEMPRE trae la dirección de facturación en una línea.
  const datosDireccionEmpresa = (emp: any, listaDirecciones?: any[]) => {
    const vacio = { direccion: 'N/A', colonia: 'N/A', cp: 'N/A', ciudad: 'N/A', municipio: 'N/A', estado: 'N/A', pais: 'N/A', completa: 'N/A' };
    if (!emp) return vacio;
    const v = (x: any) => String(x ?? '').trim();
    const lista = (Array.isArray(listaDirecciones) && listaDirecciones.length > 0) ? listaDirecciones : (catalogosGlobales.direcciones || []);
    const textoEmp = v(emp.direccion) || v(emp.direccionLabel);
    let dir = lista.find((d: any) => String(d.id) === String(emp.direccionId)) || null;
    if (!dir && textoEmp) {
      dir = lista.find((d: any) => v(d.direccionCompleta) && v(d.direccionCompleta).toLowerCase() === textoEmp.toLowerCase()) || null;
    }
    const completa = v(dir?.direccionCompleta) || textoEmp;
    if (dir) {
      const respaldo = parsearDireccionTexto(completa);
      const calleLinea = [v(dir.calleNombre), v(dir.numExterior) ? `#${v(dir.numExterior)}` : '', v(dir.numInterior) ? `Int. ${v(dir.numInterior)}` : ''].filter(Boolean).join(' ');
      const municipio = v(dir.municipioNombre) || respaldo.municipio;
      const estadoDir = v(dir.estadoNombre) || respaldo.estado;
      return {
        direccion: calleLinea || respaldo.direccion || 'N/A',
        colonia: v(dir.coloniaNombre) || respaldo.colonia || 'N/A',
        cp: v(dir.cpNombre) || respaldo.cp || 'N/A',
        municipio: municipio || 'N/A',
        estado: estadoDir || 'N/A',
        pais: v(dir.paisNombre) || respaldo.pais || 'N/A',
        ciudad: [municipio, estadoDir].filter(Boolean).join(', ') || 'N/A',
        completa: completa || 'N/A',
      };
    }
    if (!textoEmp) return vacio;
    const r = parsearDireccionTexto(textoEmp);
    return {
      direccion: r.direccion || 'N/A',
      colonia: r.colonia || 'N/A',
      cp: r.cp || 'N/A',
      municipio: r.municipio || 'N/A',
      estado: r.estado || 'N/A',
      pais: r.pais || 'N/A',
      ciudad: [r.municipio, r.estado].filter(Boolean).join(', ') || 'N/A',
      completa: textoEmp,
    };
  };

  // ✅ Garantiza el catálogo de direcciones FRESCO dentro del mismo clic
  //   (setCatalogosGlobales es asíncrono y el closure no ve el estado nuevo).
  const obtenerDireccionesFrescas = async (): Promise<any[]> => {
    const actual = catalogosGlobales.direcciones;
    if (Array.isArray(actual) && actual.length > 0) return actual;
    try {
      const snap = await getDocs(collection(db, 'direcciones'));
      const data = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      setCatalogosGlobales((prev: any) => ({ ...prev, direcciones: data }));
      return data;
    } catch (e) {
      console.error('[PDF] No se pudo leer el catálogo de direcciones:', e);
      return [];
    }
  };

  const handleDescargarCartaInstrucciones = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);
    const empNombre = resolverOperadorParaPDF();
    const listaDirs = await obtenerDireccionesFrescas();
    const dirOrigen = datosDireccionEmpresa(origenObj, listaDirs);
    const dirDestino = datosDireccionEmpresa(destinoObj, listaDirs);

    generarCartaInstruccionesPDF({
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fechaServicio: operacionViendo.fechaServicio || 'N/A',
      fechaCita: operacionViendo.fechaCita ? new Date(operacionViendo.fechaCita).toLocaleString('es-MX') : 'N/A',
      tipoServicio: operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion'),
      trafico: operacionViendo.trafico || '',
      tipoUnidad: remolqueObj ? (remolqueObj.tipo || remolqueObj.descripcion || 'Remolque') : 'N/A',
      numeroEconomico: operacionViendo.remolqueNombre || (remolqueObj ? remolqueObj.nombre : 'N/A'),
      placas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      operador: empNombre,
      descripcionMercancia: operacionViendo.descripcionMercancia || 'N/A',
      // ✅ Direcciones REALES desde la colección `empresas`/`direcciones`.
      // ✅ La línea roja bajo ORIGEN muestra la dirección de facturación COMPLETA.
      origenCiudad: dirOrigen.completa,
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: dirOrigen.direccion, origenColonia: dirOrigen.colonia, origenCP: dirOrigen.cp,
      origenMunicipio: dirOrigen.municipio, origenEstado: dirOrigen.estado, origenPais: dirOrigen.pais,
      destinoCiudad: dirDestino.completa,
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: dirDestino.direccion, destinoColonia: dirDestino.colonia, destinoCP: dirDestino.cp,
      destinoMunicipio: dirDestino.municipio, destinoEstado: dirDestino.estado, destinoPais: dirDestino.pais,
    });
  };

  const obtenerConsecutivoRef = (op: any): number => {
    const ref = String(op?.ref || '');
    const m = ref.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  };

  const fechaOrdenOp = (valor: any): number => {
    if (valor == null || valor === '') return 0;
    if (typeof valor === 'object') {
      if (typeof valor.toDate === 'function') { const d = valor.toDate(); return isNaN(d.getTime()) ? 0 : d.getTime(); }
      if (typeof valor.seconds === 'number') return valor.seconds * 1000;
      if (valor instanceof Date) return isNaN(valor.getTime()) ? 0 : valor.getTime();
      return 0;
    }
    if (typeof valor === 'number') return valor;
    const s = String(valor).trim();
    if (!s) return 0;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); return isNaN(d.getTime()) ? 0 : d.getTime(); }
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) { let y = Number(m[3]); if (y < 100) y += 2000; const d = new Date(y, Number(m[2]) - 1, Number(m[1])); return isNaN(d.getTime()) ? 0 : d.getTime(); }
    const d = new Date(s); return isNaN(d.getTime()) ? 0 : d.getTime();
  };

  const valorTextoColumna = (op: any, colId: string): string => {
    switch (colId) {
      case 'ref': return String(op.ref || op.id?.substring(0, 6) || '');
      case 'fechaServicio': return String(op.fechaServicio || '');
      case 'fechaCita': return formatearFechaHora(op.fechaCita);
      case 'tipoOperacion': return String(mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre));
      case 'status': {
        // ✅ El catálogo por ID tiene prioridad: siempre muestra el NOMBRE oficial
        //    aunque statusNombre haya quedado guardado con la descripción larga.
        const porId = mapaStatus.porId[String(op.status || '').trim()];
        if (porId?.nombre) return porId.nombre;
        const den = String(op.statusNombre || '').trim();
        if (den) return resolverStatus(den).nombre || den;
        return resolverStatus(op.status).nombre || '-';
      }
      case 'trafico': return String(op.trafico || '');
      case 'cliente': return String(mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente));
      case 'convenioTarifa': return String(obtenerNombreConvenioCliente(op.convenio, op.convenioNombre));
      case 'refCliente': return String(op.refCliente || '');
      case 'facturadoEnCobrar': return String(mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre));
      case 'montoConvenioCliente': return String(op.montoConvenioCliente ?? '');
      case 'cargosAdicionales': return String(op.cargosAdicionales ?? '');
      case 'subtotal': return String(op.subtotalCliente ?? '');
      case 'tipoCambioAprobado': return String(op.tipoCambioAprobado ?? '');
      case 'dolaresCliente': return String(op.dolaresCliente ?? '');
      case 'pesosCliente': return String(op.pesosCliente ?? '');
      case 'conversionCliente': return String(op.conversionCliente ?? '');
      case 'origen': return String(mostrarDatoMapeado(op.origen, 'empresas', 'nombre', op.origenNombre));
      case 'destino': return String(mostrarDatoMapeado(op.destino, 'empresas', 'nombre', op.destinoNombre));
      case 'remolque': return String(mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre));
      case 'proveedor': return String(mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre));
      case 'unidadProveedor': return String(op.unidadProveedor || '');
      case 'operadorProveedor': return String(op.operadorProveedor || '');
      case 'convenioProv': return String(obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre));
      case 'facturadoEnUnidad': return String(mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre));
      case 'monedaConvenioProv': return String(mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre));
      case 'totalAPagarProv': return String(op.totalAPagarProv ?? '');
      case 'cargosAdicionalesProv': return String(op.cargosAdicionalesProv ?? '');
      case 'subtotalProv': return String(op.subtotalProv ?? '');
      case 'dolaresProv': return String(op.dolaresProv ?? '');
      case 'pesosProv': return String(op.pesosProv ?? '');
      case 'conversionProv': return String(op.conversionProv ?? '');
      case 'unidad': return String(mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre));
      case 'operador': return String(mostrarDatoMapeado(op.operador, 'empleados', 'nombre', op.operadorNombre));
      case 'sueldoOperador': return String(op.sueldoOperador ?? '');
      case 'sueldoExtra': return String(op.sueldoExtra ?? '');
      case 'sueldoTotal': return String(op.sueldoTotal ?? '');
      case 'combustible': return String(op.combustible ?? '');
      case 'combustibleExtra': return String(op.combustibleExtra ?? '');
      case 'combustibleTotal': return String(op.combustibleTotal ?? '');
      case 'clienteMercancia': return String(mostrarDatoMapeado(op.clienteMercancia, 'empresas', 'nombre', op.clienteMercanciaNombre));
      case 'descripcionMercancia': return String(op.descripcionMercancia || '');
      case 'cantidad': return String(op.cantidad ?? '');
      case 'embalaje': return String(mostrarDatoMapeado(op.embalaje, 'embalajes', 'nombre', op.embalajeNombre));
      case 'pesoKg': return String(op.pesoKg ?? '');
      case 'numDoda': return String(op.numDoda || '');
      case 'fechaEmisionDoda': return String(op.fechaEmisionDoda || '');
      case 'numeroEntrys': return String(op.numeroEntrys || '');
      case 'cantEntrys': return String(op.cantEntrys ?? '');
      case 'numManifiesto': return String(op.numManifiesto || '');
      case 'provServicios': return String(mostrarDatoMapeado(op.provServicios, 'empresas', 'nombre', op.provServiciosNombre));
      case 'montoManifiesto': return String(op.montoManifiesto ?? '');
      case 'totalGastos': return String(op.totalGastos ?? '');
      case 'utilidadEstimada': return String(op.utilidadEstimada ?? '');
      case 'observacionesEjecutivo': return String(op.observacionesEjecutivo || '');
      case 'observacionesUnidad': return String(op.observacionesUnidad || '');
      case 'observacionesCobrar': return String(op.observacionesCobrar || '');
      default: return '';
    }
  };

  const construirOpcionesFiltro = (colId: string): string[] => {
    const set = new Set<string>();
    operacionesGlobales.forEach(op => {
      const v = valorTextoColumna(op, colId);
      if (v && v !== '-' && v.trim() !== '') set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));
  };
  const opcionesTipoOperacion = useMemo(() => construirOpcionesFiltro('tipoOperacion'), [operacionesGlobales, catalogosGlobales]);
  const opcionesStatus = useMemo(() => construirOpcionesFiltro('status'), [operacionesGlobales, catalogosGlobales]);
  const opcionesUnidad = useMemo(() => construirOpcionesFiltro('unidad'), [operacionesGlobales, catalogosGlobales]);
  const opcionesRemolque = useMemo(() => construirOpcionesFiltro('remolque'), [operacionesGlobales, catalogosGlobales]);
  const hayFiltrosActivos = !!(filtroTipoOperacion || filtroStatus || filtroUnidad || filtroRemolque);
  const limpiarFiltros = () => { setFiltroTipoOperacion(''); setFiltroStatus(''); setFiltroUnidad(''); setFiltroRemolque(''); };

  const operacionesFiltradas = useMemo(() => {
    const b = busqueda.trim().toLowerCase();
    const tokens = b.split(/\s+/).filter(Boolean);

    let base = operacionesGlobales;
    if (filtroTipoOperacion) base = base.filter(op => valorTextoColumna(op, 'tipoOperacion') === filtroTipoOperacion);
    if (filtroStatus)   base = base.filter(op => valorTextoColumna(op, 'status')   === filtroStatus);
    if (filtroUnidad)   base = base.filter(op => valorTextoColumna(op, 'unidad')   === filtroUnidad);
    if (filtroRemolque) base = base.filter(op => valorTextoColumna(op, 'remolque') === filtroRemolque);

    const filtradas = tokens.length === 0
      ? [...base]
      : base.filter(op => {
          const textoFila = columnasTabla
            .map(col => valorTextoColumna(op, col.id))
            .join(' ')
            .toLowerCase();
          return tokens.every(t => textoFila.includes(t));
        });

    return filtradas.sort((a: any, b2: any) => {
      const ta = fechaOrdenOp(a.fechaServicio);
      const tb = fechaOrdenOp(b2.fechaServicio);
      if (ta !== tb) return tb - ta;
      return obtenerConsecutivoRef(b2) - obtenerConsecutivoRef(a);
    });
  }, [busqueda, operacionesGlobales, catalogosGlobales, columnasTabla, filtroTipoOperacion, filtroStatus, filtroUnidad, filtroRemolque]);

  // ✅ NUEVO: valor de una celda para ORDENAR. Reusa valorTextoColumna, pero las
  //   fechas se convierten a un valor cronológico real (timestamp) para que el
  //   orden no dependa del formato en que se guardó la fecha.
  const valorOrdenColumna = (op: any, colId: string): string => {
    if (colId === 'fechaServicio') {
      const t = fechaOrdenOp(op.fechaServicio);
      return t ? String(t) : '';
    }
    if (colId === 'fechaCita') {
      const t = fechaOrdenOp(op.fechaCita);
      return t ? String(t) : '';
    }
    const v = valorTextoColumna(op, colId);
    return v === '-' ? '' : v;
  };

  // ✅ NUEVO: comparador tolerante — numérico cuando ambos valores son números
  //   (montos, cantidades, timestamps) y alfabético con colación española en
  //   el resto. Los valores vacíos siempre van al final.
  const compararValoresOrden = (va: string, vb: string): number => {
    const na = Number(va);
    const nb = Number(vb);
    if (va.trim() !== '' && vb.trim() !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    return va.localeCompare(vb, 'es', { numeric: true, sensitivity: 'base' });
  };

  // ✅ NUEVO: ciclo de ordenamiento del encabezado: asc → desc → original.
  const manejarOrdenColumna = (colId: string) => {
    if (ordenColumna !== colId) {
      setOrdenColumna(colId);
      setOrdenDireccion('asc');
    } else if (ordenDireccion === 'asc') {
      setOrdenDireccion('desc');
    } else {
      setOrdenColumna(null);
      setOrdenDireccion(null);
    }
    setPaginaActual(1);
  };

  // ✅ NUEVO: lista final que ve la tabla. Sin columna de orden activa se respeta
  //   el orden original (fecha desc + consecutivo) de operacionesFiltradas.
  const operacionesOrdenadas = useMemo(() => {
    if (!ordenColumna || !ordenDireccion) return operacionesFiltradas;
    const dir = ordenDireccion === 'asc' ? 1 : -1;
    return [...operacionesFiltradas].sort((a: any, b2: any) => {
      const va = valorOrdenColumna(a, ordenColumna);
      const vb = valorOrdenColumna(b2, ordenColumna);
      const vaVacio = va.trim() === '';
      const vbVacio = vb.trim() === '';
      if (vaVacio && vbVacio) return 0;
      if (vaVacio) return 1;   // vacíos siempre al final
      if (vbVacio) return -1;
      return compararValoresOrden(va, vb) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesFiltradas, ordenColumna, ordenDireccion, catalogosGlobales]);

  const totalPaginas = Math.ceil(operacionesOrdenadas.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const operacionesEnPantalla = operacionesOrdenadas.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedColIndex(index);
  };

  const handleDragEnter = (index: number) => {
    if (draggedColIndex === null || draggedColIndex === index) return;
    const nuevasColumnas = [...columnasTabla];
    const colMovida = nuevasColumnas.splice(draggedColIndex, 1)[0];
    nuevasColumnas.splice(index, 0, colMovida);
    setDraggedColIndex(index);
    setColumnasTabla(nuevasColumnas);
  };

  const toggleColumnaVisible = (index: number) => {
    const nuevas = [...columnasTabla];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasTabla(nuevas);
  };

  const renderCellContent = (op: any, colId: string) => {
    switch (colId) {
      // ✅ Referencia coloreada por tipo de operación (Fletes verde / Logística azul / Transfer naranja)
      case 'ref': return <span className="font-mono" style={{ color: colorTipoOperacion(mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)), fontWeight: 'bold' }}>{op.ref || op.id?.substring(0,6)}</span>;
      case 'fechaServicio': return <span className="od-x1">{mostrarDato(op.fechaServicio)}</span>;
      case 'fechaCita': return <span className="od-x1">{formatearFechaHora(op.fechaCita)}</span>;
      case 'tipoOperacion': {
        const nombreTipoOp = mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre);
        return <span style={{ color: colorTipoOperacion(nombreTipoOp), fontWeight: 'bold' }}>{nombreTipoOp}</span>;
      }
      case 'status': {
        // ✅ Respaldo doble: primero el catálogo (por id, con statusNombre como
        //   alterno) y, si no resuelve, resolverStatus acepta id O nombre
        //   (operaciones migradas o guardadas con el nombre en el campo status).
        let nombreStatus = mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre);
        if (!nombreStatus || nombreStatus === '-') {
          nombreStatus = resolverStatus(op.status || op.statusNombre).nombre || '-';
        }
        return <span style={{ color: nombreStatus === '-' ? '#8b949e' : '#10b981', fontWeight: 'bold' }}>{nombreStatus}</span>;
      }
      case 'trafico': return <span className="od-x1">{mostrarDato(op.trafico)}</span>;
      case 'cliente': return <span className="od-x2">{mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente)}</span>;
      case 'convenioTarifa': return <span className="od-x3" title={obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}>{obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}</span>;
      case 'refCliente': return <span className="od-x1">{mostrarDato(op.refCliente)}</span>;
      case 'facturadoEnCobrar': return <span className="od-x1">{mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre)}</span>;
      case 'montoConvenioCliente': return <span className="od-x1">{formatoMoneda(op.montoConvenioCliente)}</span>;
      case 'cargosAdicionales': return <span className="od-x1">{formatoMoneda(op.cargosAdicionales)}</span>;
      case 'subtotal': return <span className="od-x4">{formatoMoneda(op.subtotalCliente)}</span>;
      case 'tipoCambioAprobado': return <span className="od-x1">{mostrarDato(op.tipoCambioAprobado)}</span>;
      case 'dolaresCliente': return <span className="od-x5">{formatoMoneda(op.dolaresCliente)}</span>;
      case 'pesosCliente': return <span className="od-x6">{formatoMoneda(op.pesosCliente)}</span>;
      case 'conversionCliente': return <span className="od-x7">{formatoMoneda(op.conversionCliente)}</span>;
      case 'origen': return <span className="od-x1">{mostrarDatoMapeado(op.origen, 'empresas', 'nombre', op.origenNombre)}</span>;
      case 'destino': return <span className="od-x1">{mostrarDatoMapeado(op.destino, 'empresas', 'nombre', op.destinoNombre)}</span>;
      case 'remolque': return <span className="od-x1">{mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre)}</span>;
      case 'proveedor': return <span className="od-x8" title={op.proveedorUnidadNombre || op.proveedorUnidad}>{mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre)}</span>;
      case 'unidadProveedor': return <span className="od-x1">{mostrarDato(op.unidadProveedor)}</span>;
      case 'operadorProveedor': return <span className="od-x1">{mostrarDato(op.operadorProveedor)}</span>;
      case 'convenioProv': return <span className="od-x8" title={obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre)}>{obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre)}</span>;
      case 'facturadoEnUnidad': return <span className="od-x1">{mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre)}</span>;
      case 'monedaConvenioProv': return <span className="od-x1">{mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre)}</span>;
      case 'totalAPagarProv': return <span className="od-x1">{formatoMoneda(op.totalAPagarProv)}</span>;
      case 'cargosAdicionalesProv': return <span className="od-x1">{formatoMoneda(op.cargosAdicionalesProv)}</span>;
      case 'subtotalProv': return <span className="od-x4">{formatoMoneda(op.subtotalProv)}</span>;
      case 'dolaresProv': return <span className="od-x6">{formatoMoneda(op.dolaresProv)}</span>;
      case 'pesosProv': return <span className="od-x6">{formatoMoneda(op.pesosProv)}</span>;
      case 'conversionProv': return <span className="od-x9">{formatoMoneda(op.conversionProv)}</span>;
      case 'unidad': return <span className="od-x1">{mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre)}</span>;
      case 'operador': return <span className="od-x1">{mostrarDatoMapeado(op.operador, 'empleados', 'nombre', op.operadorNombre)}</span>;
      case 'sueldoOperador': return <span className="od-x1">{formatoMoneda(op.sueldoOperador)}</span>;
      case 'sueldoExtra': return <span className="od-x1">{formatoMoneda(op.sueldoExtra)}</span>;
      case 'sueldoTotal': return <span className="od-x4">{formatoMoneda(op.sueldoTotal)}</span>;
      case 'combustible': return <span className="od-x1">{formatoMoneda(op.combustible)}</span>;
      case 'combustibleExtra': return <span className="od-x1">{formatoMoneda(op.combustibleExtra)}</span>;
      case 'combustibleTotal': return <span className="od-x4">{formatoMoneda(op.combustibleTotal)}</span>;
      case 'clienteMercancia': return <span className="od-x1">{mostrarDatoMapeado(op.clienteMercancia, 'empresas', 'nombre', op.clienteMercanciaNombre)}</span>;
      case 'descripcionMercancia': return <span className="od-x1">{mostrarDato(op.descripcionMercancia)}</span>;
      case 'cantidad': return <span className="od-x1">{mostrarDato(op.cantidad)}</span>;
      case 'embalaje': return <span className="od-x1">{mostrarDatoMapeado(op.embalaje, 'embalajes', 'nombre', op.embalajeNombre)}</span>;
      case 'pesoKg': return <span className="od-x1">{mostrarDato(op.pesoKg)}</span>;
      case 'numDoda': return <span className="od-x1">{mostrarDato(op.numDoda)}</span>;
      case 'fechaEmisionDoda': return <span className="od-x1">{mostrarDato(op.fechaEmisionDoda)}</span>;
      case 'numeroEntrys': return <span className="od-x1">{mostrarDato(op.numeroEntrys)}</span>;
      case 'cantEntrys': return <span className="od-x1">{mostrarDato(op.cantEntrys)}</span>;
      case 'numManifiesto': return <span className="od-x1">{mostrarDato(op.numManifiesto)}</span>;
      case 'provServicios': return <span className="od-x1">{mostrarDatoMapeado(op.provServicios, 'empresas', 'nombre', op.provServiciosNombre)}</span>;
      case 'montoManifiesto': return <span className="od-x1">{formatoMoneda(op.montoManifiesto)}</span>;
      case 'totalGastos': return <span className="od-x10">{formatoMoneda(op.totalGastos)}</span>;
      case 'utilidadEstimada': return <span className="od-x11">{formatoMoneda(op.utilidadEstimada)}</span>;
      case 'observacionesEjecutivo': return <span className="od-x12">{mostrarDato(op.observacionesEjecutivo)}</span>;
      case 'observacionesUnidad': return <span className="od-x12">{mostrarDato(op.observacionesUnidad)}</span>;
      case 'observacionesCobrar': return <span className="od-x12">{mostrarDato(op.observacionesCobrar)}</span>;
      default: return '-';
    }
  };

  const exportarExcel = async () => {
    if (operacionesOrdenadas.length === 0) return alert("No hay datos para exportar.");
    const columnasVisibles = columnasTabla.filter(c => c.visible);
    // La exportación usa los nombres ya guardados en cada operación (sin lecturas).

    const datosExcel = operacionesOrdenadas.map(op => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        let val: any = '-';
        switch (col.id) {
          case 'ref': val = op.ref || op.id?.substring(0,6) || ''; break;
          case 'fechaServicio': val = op.fechaServicio || ''; break;
          case 'fechaCita': val = formatearFechaHora(op.fechaCita); break;
          case 'tipoOperacion': val = mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre); break;
          case 'status': { const nSt = mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre); val = (nSt && nSt !== '-') ? nSt : (resolverStatus(op.status || op.statusNombre).nombre || '-'); break; } 
          case 'trafico': val = op.trafico || ''; break;
          case 'cliente': val = mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente); break;
          case 'convenioTarifa': val = obtenerNombreConvenioCliente(op.convenio, op.convenioNombre); break;
          case 'refCliente': val = op.refCliente || ''; break;
          case 'facturadoEnCobrar': val = mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre); break;
          case 'montoConvenioCliente': val = Number(op.montoConvenioCliente) || 0; break;
          case 'cargosAdicionales': val = Number(op.cargosAdicionales) || 0; break;
          case 'subtotal': val = Number(op.subtotalCliente) || 0; break;
          case 'tipoCambioAprobado': val = op.tipoCambioAprobado || ''; break;
          case 'dolaresCliente': val = Number(op.dolaresCliente) || 0; break;
          case 'pesosCliente': val = Number(op.pesosCliente) || 0; break;
          case 'conversionCliente': val = Number(op.conversionCliente) || 0; break;
          case 'origen': val = mostrarDatoMapeado(op.origen, 'empresas', 'nombre', op.origenNombre); break;
          case 'destino': val = mostrarDatoMapeado(op.destino, 'empresas', 'nombre', op.destinoNombre); break;
          case 'remolque': val = mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre); break;
          case 'proveedor': val = mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre); break;
          case 'unidadProveedor': val = op.unidadProveedor || ''; break;
          case 'operadorProveedor': val = op.operadorProveedor || ''; break;
          case 'convenioProv': val = obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre); break;
          case 'facturadoEnUnidad': val = mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre); break;
          case 'monedaConvenioProv': val = mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre); break;
          case 'totalAPagarProv': val = Number(op.totalAPagarProv) || 0; break;
          case 'cargosAdicionalesProv': val = Number(op.cargosAdicionalesProv) || 0; break;
          case 'subtotalProv': val = Number(op.subtotalProv) || 0; break;
          case 'dolaresProv': val = Number(op.dolaresProv) || 0; break;
          case 'pesosProv': val = Number(op.pesosProv) || 0; break;
          case 'conversionProv': val = Number(op.conversionProv) || 0; break;
          case 'unidad': val = mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre); break;
          case 'operador': val = mostrarDatoMapeado(op.operador, 'empleados', 'nombre', op.operadorNombre); break;
          case 'sueldoOperador': val = Number(op.sueldoOperador) || 0; break;
          case 'sueldoExtra': val = Number(op.sueldoExtra) || 0; break;
          case 'sueldoTotal': val = Number(op.sueldoTotal) || 0; break;
          case 'combustible': val = Number(op.combustible) || 0; break;
          case 'combustibleExtra': val = Number(op.combustibleExtra) || 0; break;
          case 'combustibleTotal': val = Number(op.combustibleTotal) || 0; break;
          case 'clienteMercancia': val = mostrarDatoMapeado(op.clienteMercancia, 'empresas', 'nombre', op.clienteMercanciaNombre); break;
          case 'descripcionMercancia': val = op.descripcionMercancia || ''; break;
          case 'cantidad': val = op.cantidad || ''; break;
          case 'embalaje': val = mostrarDatoMapeado(op.embalaje, 'embalajes', 'nombre', op.embalajeNombre); break;
          case 'pesoKg': val = op.pesoKg || ''; break;
          case 'numDoda': val = op.numDoda || ''; break;
          case 'fechaEmisionDoda': val = op.fechaEmisionDoda || ''; break;
          case 'numeroEntrys': val = op.numeroEntrys || ''; break;
          case 'cantEntrys': val = op.cantEntrys || ''; break;
          case 'numManifiesto': val = op.numManifiesto || ''; break;
          case 'provServicios': val = mostrarDatoMapeado(op.provServicios, 'empresas', 'nombre', op.provServiciosNombre); break;
          case 'montoManifiesto': val = Number(op.montoManifiesto) || 0; break;
          case 'totalGastos': val = Number(op.totalGastos) || 0; break;
          case 'utilidadEstimada': val = Number(op.utilidadEstimada) || 0; break;
          case 'observacionesEjecutivo': val = op.observacionesEjecutivo || ''; break;
          case 'observacionesUnidad': val = op.observacionesUnidad || ''; break;
          case 'observacionesCobrar': val = op.observacionesCobrar || ''; break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Operaciones Activas');
    XLSX.writeFile(workbook, `Operaciones_Activas_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabsDetalle = [{ id: 'general', label: 'Información General' }, { id: 'pedimento', label: 'Pedimento y CT' }, { id: 'manifiestos', label: "Entry's y Manifiestos" }, { id: 'unidad', label: 'Unidad y Operador' }, { id: 'cobrar', label: 'Por Cobrar' }];

  const evalTipoOpText = String(operacionViendo?.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo?.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', operacionViendo?.tipoOperacionNombre) || '').toLowerCase();
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsRoelca = String(operacionViendo?.proveedorUnidadNombre || operacionViendo?.proveedorUnidad || '').toLowerCase().includes('roelca');
  
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  const evalTipoOpId = String(operacionViendo?.tipoOperacionId || '').trim();
  // ✅ Fletes (ID 3e5b0035): además de Check List y Solicitud de Retiro, ahora
  //    también se muestran "Carta de Instrucciones" (carta) y "Prueba de
  //    Entrega" (prueba). Ambos se generan con el logo mediante los generadores
  //    ya existentes (generarCartaInstruccionesPDF / generarPruebaEntregaPDF).
  const DOCS_POR_TIPO: Record<string, string[]> = {
    '3e5b0035': ['checklist', 'solicitud', 'carta', 'prueba', 'instrucciones'],
  };
  const docsPermitidos = DOCS_POR_TIPO[evalTipoOpId] || null;
  const puedeMostrarDoc = (doc: string) => !docsPermitidos || docsPermitidos.includes(doc);

  const refOperacionViendo = operacionViendo ? (operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'Operacion') : '';

  const btnSecondaryActionStyle = { background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', gap: '8px', fontWeight: 'bold', transition: 'background 0.2s', fontSize: '0.85rem' };
  const btnDocStyle = { background: 'transparent', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '6px', fontSize: '0.85rem', transition: 'all 0.2s' };

  return (
    <div className="module-container od-x13">
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioOperacion 
          estado={estadoFormulario} initialData={operacionEditando}
          onClose={() => { hidratarCatalogosDesdeCache(); setEstadoFormulario('cerrado'); setOperacionEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} onRestore={() => setEstadoFormulario('abierto')}
          catalogosCacheados={catalogosGlobales} 
          onSave={handleOperacionGuardada}
        />
      )}

     <div className="od-x14">
        <div className="od-x15">
          <h1 className="module-title od-x16">
            Operaciones Activas
          </h1>
        </div>

        <div className="od-x17">
          <div className="od-x18">
            <div className="od-x19">
              <svg className="od-x20" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input className="od-x21" type="text" placeholder="Buscar en todas las columnas..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
          </div>
          <div className="od-x22">
            <button className="btn btn-outline" onClick={actualizarOperaciones} disabled={cargandoOperaciones || cargandoMas} style={{ fontSize: '0.9rem', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: (cargandoOperaciones || cargandoMas) ? 'wait' : 'pointer' }} title="Actualizar operaciones (vuelve a leer la colección desde Firestore)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: cargandoOperaciones ? 'spin 1s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              <span>{cargandoOperaciones ? 'Actualizando...' : 'Actualizar'}</span>
            </button>
            {/* ✅ NUEVO (V00113): re-resuelve los nombres guardados en cada
                operación contra los catálogos actuales (repara renombres) */}
            <button className="btn btn-outline" onClick={sincronizarNombresOperaciones} disabled={sincronizandoNombres || cargandoOperaciones} style={{ fontSize: '0.9rem', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: sincronizandoNombres ? 'wait' : 'pointer' }} title="Sincronizar nombres: actualiza registro por registro los nombres (tipo de operación, status, empresas, carga) que quedaron viejos tras renombrar en Catálogos">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
              <span>{sincronizandoNombres ? 'Sincronizando...' : 'Sincronizar nombres'}</span>
            </button>
            {/* ✅ V00132: forzar la moneda de Empresas en TODAS las operaciones */}
            <button className="btn btn-outline od-btn-monedas" onClick={sincronizarMonedasOperaciones} disabled={sincronizandoMonedas || cargandoOperaciones} title="Coloca en TODAS las operaciones (cliente y proveedor) la moneda que cada empresa tiene guardada en la tabla Empresas">
              <span>{sincronizandoMonedas ? '⏳ Actualizando monedas…' : '⟳ Actualizar monedas'}</span>
            </button>
            {/* ✅ V00162: cierra brincos/duplicados de folios ya guardados */}
            <button type="button" className="btn btn-outline od-btn-reparar" disabled={reparandoConsec} onClick={repararConsecutivos} title="Renumera los folios de un día en 1..N por orden de creación: cierra brincos (006 → 024) y duplicados que dejó la numeración vieja, y re-sincroniza los contadores">
              <span>{reparandoConsec ? '⏳ Reparando…' : '🔢 Reparar consecutivos'}</span>
            </button>
            <button className="btn btn-outline od-x23" onClick={() => setModalColumnas(true)} title="Configurar Columnas">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg></button>
            <button className="btn btn-outline od-x24" onClick={exportarExcel} title="Exportar a Excel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button className="btn btn-outline od-x23" onClick={() => setMostrarResumenDiario(true)} title="Resúmenes diarios (Transfer / Logística / Fletes) en PDF">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="13" y2="17"></line></svg>
              <span>Resúmenes</span>
            </button>
            <button className="btn btn-primary od-x25" onClick={handleNuevo}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="od-x26">
          {/* ✅ Los filtros viven en el drawer derecho; aquí solo el acceso. */}
          <button className="od-btn-filtros" onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            Filtros
            {hayFiltrosActivos && (
              <span className="od-badge-filtros">{[filtroTipoOperacion, filtroStatus, filtroUnidad, filtroRemolque].filter(Boolean).length}</span>
            )}
          </button>
          {hayFiltrosActivos && (
            <button className="od-x28" onClick={limpiarFiltros} title="Quitar todos los filtros">
              ✕ Limpiar filtros
            </button>
          )}
          {hayFiltrosActivos && (
            <span className="od-x29">
              {operacionesFiltradas.length} {operacionesFiltradas.length === 1 ? 'resultado' : 'resultados'}
            </span>
          )}
        </div>

        <div className="content-body od-x30">
          <div className="table-container od-x31">
            {cargandoOperaciones ? (
              <div className="od-x32">Cargando operaciones activas...</div>
            ) : (
              <table className="data-table od-x33">
                <thead className="od-x34">
                  <tr>
                    <th className="od-x35">
                      Acciones
                    </th>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <th
                        key={`th_${col.id}`}
                        onClick={() => manejarOrdenColumna(col.id)}
                        title={ordenColumna === col.id ? (ordenDireccion === 'asc' ? 'Clic: ordenar descendente' : 'Clic: quitar ordenamiento') : 'Clic: ordenar ascendente'}
                        style={{ padding: '16px', color: ordenColumna === col.id ? '#f0f6fc' : '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d', cursor: 'pointer', userSelect: 'none' }}
                      >
                        {col.label}
                        {ordenColumna === col.id && (
                          <span className="od-x36">
                            {ordenDireccion === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {operacionesEnPantalla.length === 0 ? (
                    <tr><td className="od-x37" colSpan={columnasTabla.length + 1}>Sin resultados.</td></tr>
                  ) : (
                    operacionesEnPantalla.map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                        <td className="od-x38" onClick={(e: any) => e.stopPropagation()}>
                          <div className="actions-cell od-x39">
                            <button className="od-x40" type="button" title="Editar Operación"
                              onClick={(e) => { e.stopPropagation(); editarOperacion(op); }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            </button>
                            <button className="od-x41" type="button" title="Eliminar Operación"
                              onClick={(e) => { e.stopPropagation(); eliminarOperacion(op); }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        {columnasTabla.filter(c => c.visible).map(col => (
                          <td className="od-x42" key={`cell_${op.id}_${col.id}`}>
                            {renderCellContent(op, col.id)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {operacionesFiltradas.length > 0 && !cargandoOperaciones && (
            <div className="od-x43">
              <div className="od-x44">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesFiltradas.length)} de {operacionesFiltradas.length} operaciones activas
                {hayMasOperaciones && <span className="od-x45">(hay más en el servidor)</span>}
              </div>
              <div className="od-x46">
                {hayMasOperaciones && (
                  <button
                    onClick={cargarMasOperaciones}
                    disabled={cargandoMas}
                    style={{ padding: '6px 14px', backgroundColor: cargandoMas ? '#0d1117' : '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: cargandoMas ? 'wait' : 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    title="Descargar 50 operaciones más desde Firestore"
                  >
                    {cargandoMas ? 'Cargando...' : '+ Cargar más (50)'}
                  </button>
                )}
                <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                <span className="od-x47">{paginaActual} / {totalPaginas || 1}</span>
                <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalColumnas && (
        <div className="modal-overlay od-x48">
          <div className="od-x49">
            <div className="od-x50">
              <h3 className="od-x51">Configurar Columnas</h3>
              <button className="od-x52" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="od-x53">Arrastra los campos para reordenarlos. Desmarca los que desees ocultar de la tabla principal y del reporte de Excel.</p>
            <ul className="od-x54">
              {columnasTabla.map((col, idx) => (
                <li key={col.id} draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab', transition: 'background-color 0.2s' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="od-x55" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="od-x56">
              <button className="od-x57" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* NUEVO: Modal de Resúmenes Diarios (Transfer / Logística / Fletes) */}
      {mostrarResumenDiario && (
        <div className="modal-overlay od-x58">
          <div className="od-x59">
            <div className="od-x60">
              <h3 className="od-x61">Resúmenes Diarios de Operaciones</h3>
              <button className="od-x62" onClick={() => setMostrarResumenDiario(false)} title="Cerrar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="od-x63">
              <ResumenDiarioOperaciones />
            </div>
          </div>
        </div>
      )}

      {operacionViendo && (
        <div className="modal-overlay od-x64">
          <div className="form-card detail-card od-x65">
            
           <div className="form-header od-x66">
              <div className="od-x67">
                <div>
                 <h2 className="od-x68">Detalle de Operación</h2>
                  <div className="od-x69">
                    <span className="od-x70">
                      {operacionViendo.ref || operacionViendo.id?.substring(0,6)}
                    </span>
                    <span className="od-x71">
                      {valorTextoColumna(operacionViendo, 'status')}
                    </span>
                  </div>
                </div>
                <div className="od-x72">
                  <button onClick={verHistorial} title="Ver Bitácora (Historial)" style={btnSecondaryActionStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#30363d'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21262d'}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    Bitácora
                  </button>
                  <div className="od-x73"></div>
                  <button className="od-x74" onClick={() => setOperacionViendo(null)} onMouseEnter={(e) => e.currentTarget.style.color = '#f0f6fc'} onMouseLeave={(e) => e.currentTarget.style.color = '#8b949e'}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              </div>

              <div className="od-x75">
                <span className="od-x76">SIGUIENTE PASO</span>
                {botonesDisponibles.length > 0 ? (
                  <>
                    {botonesDisponibles.map((botonStr: string) => {
                      const esExitoso = ultimoStatusGuardado === botonStr;
                      return (
                        <button key={botonStr} onClick={() => registrarStatusRapido(botonStr)} disabled={guardandoStatusRapido !== null} className="status-pill"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '6px 18px 6px 6px', borderRadius: '999px', border: 'none',
                            background: esExitoso ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
                            color: '#fff', cursor: guardandoStatusRapido && !esExitoso ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.9rem',
                            boxShadow: esExitoso ? '0 4px 14px rgba(16, 185, 129, 0.4)' : '0 4px 14px rgba(234, 88, 12, 0.35)',
                            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                            opacity: guardandoStatusRapido && !esExitoso && guardandoStatusRapido !== botonStr ? 0.4 : 1, position: 'relative', overflow: 'hidden' }}
                          title={`Marcar como: ${botonStr}`}>
                          <span className="od-x77">
                            {esExitoso ? (
                              <svg className="od-x78" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            )}
                          </span>
                          <span className="od-x79">{botonStr}</span>
                        </button>
                      );
                    })}
                    <button onClick={abrirRegistroHorario} className="status-circle-btn od-x80"
                      title="Registrar con fecha/hora distinta (retroactivo)">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    <span className="od-x81">
                      No hay transiciones automáticas configuradas.
                    </span>
                    <button onClick={abrirRegistroHorario} className="status-pill od-x82"
                      title="Registrar status manualmente">
                      <span className="od-x83">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </span>
                      Registrar Status
                    </button>
                  </>
                )}
              </div>

              <div className="od-x84">
                <span className="od-x85">GENERAR DOCUMENTOS:</span>
                {(docsPermitidos ? puedeMostrarDoc('carta') : evalIsFletes) && (
                  <button onClick={handleDescargarCartaInstrucciones} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Carta Instrucciones
                  </button>
                )}
                {(docsPermitidos ? puedeMostrarDoc('prueba') : evalIsFletes) && (
                  <button onClick={handleDescargarPruebaEntrega} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Prueba Entrega
                  </button>
                )}
                {puedeMostrarDoc('checklist') && (
                  <button onClick={handleDescargarCheckList} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Check List
                  </button>
                )}
                {puedeMostrarDoc('solicitud') && (
                  <button onClick={handleDescargarSolicitudRetiro} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Solicitud Retiro
                  </button>
                )}
                {puedeMostrarDoc('instrucciones') && (
                  <button onClick={handleDescargarInstruccionesServicio} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Instrucciones Serv.
                  </button>
                )}
              </div>
            </div>
            
            <div className="od-x86">
              {tabsDetalle.map(tab => (
                <button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)}
                  style={{ padding: '12px 16px', background: 'none', border: 'none',
                    borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent',
                    color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer',
                    fontWeight: pestañaDetalleActiva === tab.id ? '600' : 'normal', fontSize: '0.95rem', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="detail-content od-x87">
              
              {pestañaDetalleActiva === 'general' && (
                <div className="od-x88">
                  <div>
                    <span className="od-x89">Tipo de Operación</span>
                    <span className="od-x90">{mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', operacionViendo.tipoOperacionNombre)}</span>
                  </div>
                  <div>
                    <span className="od-x89">Fecha de Servicio / Status</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.fechaServicio)} <span className="od-x91">|</span> <span className="od-x11">{mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}</span></span>
                  </div>
                  {evalIsFletes ? (
                     <div>
                       <span className="od-x89">Fecha de Cita</span>
                       <span className="od-x90">{formatearFechaHora(operacionViendo.fechaCita)}</span>
                     </div>
                  ) : (<div></div>)}
                  <div className="od-x92"><hr className="od-x93" /></div>
                  <div>
                    <span className="od-x94">Cliente (Paga)</span>
                    <span className="od-x90">{mostrarDatoMapeado(operacionViendo.clientePaga || operacionViendo.clienteId, 'empresas', 'nombre', operacionViendo.clienteNombre || operacionViendo.nombreCliente)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Convenio (Tarifa)</span>
                    <span className="od-x90">{obtenerNombreConvenioCliente(operacionViendo.convenio, operacionViendo.convenioNombre)}</span> 
                  </div>
                  <div>
                    <span className="od-x94"># de Remolque</span>
                    <span className="od-x90">{mostrarDatoMapeado(operacionViendo.numeroRemolque, 'remolques', 'nombre', operacionViendo.remolqueNombre)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Ref Cliente</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.refCliente)}</span>
                  </div>
                  <div>
                    <span className="od-x95">Origen</span>
                    <span className="od-x90">{mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre)}</span>
                  </div>
                  <div>
                    <span className="od-x95">Destino</span>
                    <span className="od-x90">{mostrarDatoMapeado(operacionViendo.destino, 'empresas', 'nombre', operacionViendo.destinoNombre)}</span></div>
                  <div className="od-x96">
                    <span className="od-x94">Observaciones Ejecutivo</span>
                    <div className="od-x97">
                      {mostrarDato(operacionViendo.observacionesEjecutivo)}
                    </div>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'pedimento' && (
                <div className="od-x88">
                  <div className="od-x98">
                    <span className="od-x94">Cliente (Mercancía)</span>
                    <span className="od-x90">{mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas', 'nombre', operacionViendo.clienteMercanciaNombre)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Descripción de la Mercancía</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.descripcionMercancia)}</span>
                  </div>
                  <div className="od-x92"><hr className="od-x93" /></div>
                  <div>
                    <span className="od-x94">Cantidad (Enteros)</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.cantidad)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Embalaje</span>
                    <span className="od-x90">{mostrarDatoMapeado(operacionViendo.embalaje, 'embalajes', 'nombre', operacionViendo.embalajeNombre)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Peso (Kg) Decimales</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.pesoKg)}</span>
                  </div>
                  <div className="od-x92"><hr className="od-x93" /></div>
                  <div>
                    <span className="od-x94"># DODA</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.numDoda)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Fecha de Emisión (DODA)</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.fechaEmisionDoda)}</span>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'manifiestos' && (
                <div className="od-x88">
                  <div>
                    <span className="od-x94"># de Entry's</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.numeroEntrys)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Cantidad de Entry's</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.cantEntrys)}</span>
                  </div>
                  <div className="od-x92"><hr className="od-x93" /></div>
                  <div>
                    <span className="od-x94"># Manifiesto</span>
                    <span className="od-x90">{mostrarDato(operacionViendo.numManifiesto)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Proveedor de Servicios</span>
                    <span className="od-x90">{mostrarDatoMapeado(operacionViendo.provServicios, 'empresas', 'nombre', operacionViendo.provServiciosNombre)}</span>
                  </div>
                  <div>
                    <span className="od-x94">Costo Manifiesto ($)</span>
                    <span className="od-x99">{formatoMoneda(operacionViendo.montoManifiesto)}</span>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'unidad' && (
                <div className="od-x100">
                  <div className="od-x101">
                    <div className="od-x92">
                      <span className="od-x94">Proveedor de Transporte</span>
                      <span className="od-x102">{mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas', 'nombre', operacionViendo.proveedorUnidadNombre)}</span>
                    </div>
                  </div>

                  <div className="od-x103">
                    <div className="od-x104">
                      <div>
                        <span className="od-x94">Facturado En:</span>
                        <span className="od-x90">{mostrarMoneda(operacionViendo.facturadoEnUnidad)}</span>
                      </div>
                      <div>
                        <span className="od-x94">Convenio Proveedor</span>
                        <span className="od-x90">{obtenerNombreConvenioProv(operacionViendo.convenioProveedor, operacionViendo.convenioProveedorNombre)}</span>
                      </div>
                      <div>
                        <span className="od-x94">Moneda del Convenio (Base)</span>
                        <span className="od-x90">{mostrarMoneda(operacionViendo.monedaConvenioProv)}</span>
                      </div>
                    </div>
                    <div className="od-x105">
                      <div>
                        <span className="od-x94">Monto a Pagar (Base)</span>
                        <span className="od-x90">{formatoMoneda(operacionViendo.totalAPagarProv)}</span>
                      </div>
                      <div>
                        <span className="od-x94">Costos Adicionales</span>
                        <span className="od-x90">{formatoMoneda(operacionViendo.cargosAdicionalesProv)}</span>
                      </div>
                      <div>
                        <span className="od-x89">Subtotal (Convenio + Costos)</span>
                        <span className="od-x106">{formatoMoneda(operacionViendo.subtotalProv)}</span>
                      </div>
                    </div>
                    <div className="od-x107">
                      <div>
                        <span className="od-x94">Dólares</span>
                        <span className="od-x108">{formatoMoneda(operacionViendo.dolaresProv)}</span>
                      </div>
                      <div>
                        <span className="od-x94">Pesos</span>
                        <span className="od-x108">{formatoMoneda(operacionViendo.pesosProv)}</span>
                      </div>
                      <div>
                        <span className="od-x109">Conversión Final (Gasto)</span>
                        <span className="od-x110">{formatoMoneda(operacionViendo.conversionProv)}</span>
                      </div>
                    </div>
                  </div>

                  {showDetailInternalFleet && (
                    <div className="od-x101">
                      <div className="od-x92"><h4 className="od-x111">Flota Operativa (Roelca)</h4></div>
                      <div>
                        <span className="od-x94">Unidad Asignada</span>
                        <span className="od-x90">{mostrarDatoMapeado(operacionViendo.unidad, 'unidades', 'unidad', operacionViendo.unidadNombre)}</span>
                      </div>
                      <div className="od-x98">
                        <span className="od-x94">Operador Asignado</span>
                        <span className="od-x90">{mostrarDatoMapeado(operacionViendo.operador, 'empleados', 'nombre', operacionViendo.operadorNombre)}</span>
                      </div>
                      <div className="od-x92"><hr className="od-x112" /></div>
                      <div>
                        <span className="od-x94">Sueldo del Operador</span>
                        <span className="od-x90">{formatoMoneda(operacionViendo.sueldoOperador)}</span>
                      </div>
                      <div>
                        <span className="od-x94">Sueldo Extra</span>
                        <span className="od-x90">{formatoMoneda(operacionViendo.sueldoExtra)}</span>
                      </div>
                      <div>
                        <span className="od-x89">Sueldo Total</span>
                        <span className="od-x113">{formatoMoneda(operacionViendo.sueldoTotal)}</span>
                      </div>
                      <div className="od-x92"><hr className="od-x112" /></div>
                      <div>
                        <span className="od-x94">Combustible</span>
                        <span className="od-x90">{formatoMoneda(operacionViendo.combustible)}</span>
                      </div>
                      <div>
                        <span className="od-x94">Combustible Extra</span>
                        <span className="od-x90">{formatoMoneda(operacionViendo.combustibleExtra)}</span>
                      </div>
                      <div>
                        <span className="od-x89">Total Combustible</span>
                        <span className="od-x106">{formatoMoneda(operacionViendo.combustibleTotal)}</span>
                      </div>
                    </div>
                  )}

                  {showDetailExternalFleet && (
                    <div className="od-x101">
                      <div className="od-x92"><h4 className="od-x114">Flota Externa (Proveedor)</h4></div>
                      <div>
                        <span className="od-x95">Unidad Externa</span>
                        <span className="od-x90">{mostrarDato(operacionViendo.unidadProveedor)}</span>
                      </div>
                      <div className="od-x98">
                        <span className="od-x95">Operador Externo</span>
                        <span className="od-x90">{mostrarDato(operacionViendo.operadorProveedor)}</span>
                      </div>
                    </div>
                  )}

                  {/* Observaciones ARRIBA del bloque de gastos (a petición) */}
                  <div className="od-x115">
                    <span className="od-x116">Observaciones (Unidad / Proveedor)</span>
                    <div className="od-x117">
                      {mostrarDato(operacionViendo.observacionesUnidad)}
                    </div>
                  </div>

                  <div className="od-x118">
                    <div className="od-x119">
                      <div className="od-x120">Total Gastos [Sueldos + Manifiesto]</div>
                      <div className="od-x121">{formatoMoneda(operacionViendo.totalGastos)}</div>
                    </div>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'cobrar' && (
                <div className="od-x100">
                  <div className="od-x101">
                    <div>
                      <span className="od-x94">Facturado En:</span>
                      <span className="od-x90">{mostrarMoneda(operacionViendo.facturadoEnCobrar)}</span>
                    </div>
                    <div>
                      <span className="od-x94">Moneda Convenio (Cliente)</span>
                      <span className="od-x90">{mostrarMoneda(operacionViendo.monedaConvenioCliente)}</span>
                    </div>
                    <div>
                      <span className="od-x94">Convenio Seleccionado (Base)</span>
                      <span className="od-x90">{formatoMoneda(operacionViendo.montoConvenioCliente)}</span>
                    </div>
                    <div>
                      <span className="od-x94">Cargos Adicionales</span>
                      <span className="od-x90">{formatoMoneda(operacionViendo.cargosAdicionales)}</span>
                    </div>
                    <div>
                      <span className="od-x89">Subtotal (Convenio + Cargos)</span>
                      <span className="od-x122">{formatoMoneda(operacionViendo.subtotalCliente)}</span>
                    </div>
                    <div>
                      <span className="od-x94">Tipo de Cambio del Día</span>
                      <span className="od-x90">{mostrarDato(operacionViendo.tipoCambioAprobado)}</span>
                    </div>
                  </div>

                  <div className="od-x123">
                    <div>
                      <span className="od-x94">Dólares (Cliente)</span>
                      <span className="od-x124">{formatoMoneda(operacionViendo.dolaresCliente)}</span>
                    </div>
                    <div>
                      <span className="od-x94">Pesos (Cliente)</span>
                      <span className="od-x108">{formatoMoneda(operacionViendo.pesosCliente)}</span>
                    </div>
                    <div>
                      <span className="od-x89">Conversión Final (Ingreso)</span>
                      <span className="od-x125">{formatoMoneda(operacionViendo.conversionCliente)}</span>
                    </div>
                  </div>

                  <div className="od-x126">
                    <span className="od-x127">Utilidad Estimada de la Operación (Ingreso - Gasto)</span>
                    <span className="od-x128">{formatoMoneda(operacionViendo.utilidadEstimada)}</span>
                  </div>

                  <div className="od-x115">
                    <span className="od-x116">Observaciones (Facturación / Cobro)</span>
                    <div className="od-x117">
                      {mostrarDato(operacionViendo.observacionesCobrar)}
                    </div>
                  </div>
                </div>
              )}

              {/* Auditoría de la referencia: botón que abre el detalle en un modal */}
              <div className="od-x129">
                <button className="od-x130" onClick={() => { setMostrarAuditoria(true); cargarNombresAuditoria(); }} title="Ver quién creó la referencia, cuándo, y el detalle de cada edición">
                  Ver auditoría
                  <span className="od-x131">{(operacionViendo.historialEdiciones || []).length}</span>
                </button>
              </div>

              {/* Modal de auditoría (solo lectura) */}
              {mostrarAuditoria && (
                <div className="od-x132" onClick={() => setMostrarAuditoria(false)}>
                  <div className="od-x133" onClick={(e) => e.stopPropagation()}>
                    <div className="od-x134">
                      <h3 className="od-x61">Auditoría de la referencia <span className="od-x135">{operacionViendo.ref || ''}</span></h3>
                      <button className="od-x52" onClick={() => setMostrarAuditoria(false)}>✕</button>
                    </div>
                    <div className="od-x136">
                      <div className="od-x137">
                        <span className="od-x138">Creación</span>
                        <span className="od-x139">
                          Creada por <b className="od-x140">{nombreAuditor(operacionViendo.creadoPor, 'Sin registro')}</b>
                          {operacionViendo.creadoEn ? <> el <b className="od-x1">{fmtFechaAuditoria(operacionViendo.creadoEn)}</b></> : null}
                        </span>
                      </div>
                      <div className="od-x141">
                        <span className="od-x142">EDICIONES REGISTRADAS:</span>
                        <span className="od-x143">{(operacionViendo.historialEdiciones || []).length}</span>
                      </div>
                      {(operacionViendo.historialEdiciones || []).slice().reverse().map((h: any, i: number) => (
                        <details className="od-x144" key={i} open={i === 0}>
                          <summary className="od-x145">
                            <b className="od-x1">{nombreAuditor(h.usuario)}</b> · {fmtFechaAuditoria(h.fecha)} · <b className="od-x146">{(h.cambios || []).length}</b> {(h.cambios || []).length === 1 ? 'cambio' : 'cambios'}
                          </summary>
                          <ul className="od-x147">
                            {(h.cambios || []).map((c: any, j: number) => (<li key={j}>{String(c)}</li>))}
                          </ul>
                        </details>
                      ))}
                      {(operacionViendo.historialEdiciones || []).length === 0 && (
                        <span className="od-x148">Sin ediciones desde su creación.</span>
                      )}
                    </div>
                    <div className="od-x149">
                      <button className="od-x150" onClick={() => setMostrarAuditoria(false)}>Cerrar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="form-actions detail-actions od-x151">
              <button onClick={() => setOperacionViendo(null)} className="btn btn-outline od-x152">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {modalHorarios === 'registrar' && operacionViendo && (
        <div className="modal-overlay od-x153">
          <div className="od-x154">
            <div className="od-x155">
              <h3 className="od-x51">Registrar Movimiento</h3>
              <button className="od-x52" onClick={() => setModalHorarios('cerrado')}>✕</button>
            </div>
            <div className="od-x156">
              <div>
                <label className="od-x157">Estatus</label>
                <select className="od-x158" value={nuevoStatus} onChange={(e) => setNuevoStatus(e.target.value)}>
                  <option value="">Selecciona un estatus...</option>
                  {(statusServicioOrdenado.length > 0
                    ? statusServicioOrdenado.map((s: any) => String(s.nombre))
                    : botonesDisponibles
                  ).map((nombre: string) => (
                    <option key={nombre} value={nombre}>{nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="od-x157">Fecha y Hora</label>
                <input className="od-x159" type="datetime-local" value={nuevaFechaHora} onChange={(e) => setNuevaFechaHora(e.target.value)} />
              </div>
            </div>
            <div className="od-x160">
              <button onClick={() => setModalHorarios('cerrado')} className="btn btn-outline od-x161">Cancelar</button>
              <button onClick={guardarHorario} disabled={cargandoHorarios} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '6px', cursor: cargandoHorarios ? 'wait' : 'pointer', fontWeight: 'bold' }}>
                {cargandoHorarios ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalHorarios === 'historial' && operacionViendo && (
        <div className="modal-overlay od-x153">
          <div className="od-x162">
            <div className="od-x163">
              <div>
                <h3 className="od-x51">Bitácora de la Operación</h3>
                <span className="od-x164">{refOperacionViendo}</span>
              </div>
              <button className="od-x52" onClick={() => setModalHorarios('cerrado')}>✕</button>
            </div>
            <div className="od-x165">
              {cargandoHorarios ? (
                <div className="od-x166">Cargando bitácora...</div>
              ) : historialList.length === 0 ? (
                <div className="od-x166">No hay movimientos registrados.</div>
              ) : (
                <div className="od-x167">
                  {historialList.map((h: any) => (
                    <div className="od-x168" key={h.id}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: h.esAutomatico ? '#8b949e' : '#10b981', flexShrink: 0 }}></div>
                      <div className="od-x169">
                        <div className="od-x170">
                          {h.statusNombre || resolverStatus(h.status).nombre || h.status}
                          {h.esAutomatico && <span className="od-x171">(automático)</span>}
                        </div>
                        <div className="od-x172">{formatearFechaHora(h.fechaHora)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="od-x173">
              <button onClick={() => setModalHorarios('cerrado')} className="btn btn-outline od-x174">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pop { 0% { transform: scale(0); } 70% { transform: scale(1.2); } 100% { transform: scale(1); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .status-pill:hover { transform: translateY(-1px); filter: brightness(1.08); }
        .status-pill:active { transform: translateY(0); }
        .status-circle-btn:hover { background: #30363d !important; color: #f0f6fc !important; border-color: #484f58 !important; }
      `}</style>
      {/* ✅ DRAWER LATERAL DE FILTROS (patrón estándar de la app) */}
      {drawerFiltrosAbierto && (
        <div className="od-drawer-overlay" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="od-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="od-drawer-encabezado">
              <h3>Filtros · Operaciones Activas</h3>
              <button className="od-drawer-cerrar" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="od-drawer-cuerpo">
              <div className="od-drawer-campo">
                <label>TIPO DE OPERACIÓN</label>
                <select value={filtroTipoOperacion} onChange={(e) => setFiltroTipoOperacion(e.target.value)}>
                  <option value="">Todos</option>
                  {opcionesTipoOperacion.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="od-drawer-campo">
                <label>STATUS</label>
                <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                  <option value="">Todos</option>
                  {opcionesStatus.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="od-drawer-campo">
                <label>UNIDAD ROELCA</label>
                <select value={filtroUnidad} onChange={(e) => setFiltroUnidad(e.target.value)}>
                  <option value="">Todas</option>
                  {opcionesUnidad.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="od-drawer-campo">
                <label>REMOLQUE</label>
                <select value={filtroRemolque} onChange={(e) => setFiltroRemolque(e.target.value)}>
                  <option value="">Todos</option>
                  {opcionesRemolque.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <p className="od-drawer-nota">Los filtros se aplican al instante sobre la tabla.</p>
            </div>

            <div className="od-drawer-pie">
              <button className="od-drawer-btn-limpiar" onClick={limpiarFiltros}>Limpiar</button>
              <button className="od-drawer-btn-aplicar" onClick={() => setDrawerFiltrosAbierto(false)}>Aplicar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default OperacionesDashboard;
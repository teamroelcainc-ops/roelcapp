// src/features/operaciones/components/ServiciosCancelados.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, getDocs, orderBy, limit, where, doc, writeBatch, startAfter } from 'firebase/firestore';
import { db, auth } from '../../../config/firebase';
import { obtenerCacheMemoria, guardarCacheMemoria, limpiarCacheMemoria } from '../../../utils/cacheMemoria';
import * as XLSX from 'xlsx';
// ✅ NUEVO: historial de actividad (colección historial_actividad)
import { registrarLog } from '../../../utils/logger';
import { generarSolicitudRetiroPDF, generarInstruccionesServicioPDF, generarCheckListPDF, generarPruebaEntregaPDF, generarCartaInstruccionesPDF, setLogoPdf } from '../../../utils/pdfGenerator';
// ✅ NUEVO: reglas de status (botones dinámicos + cascada) — igual que Operaciones Activas
import { obtenerBotonesHorarioDinamicos, resolverCascadaStatus } from '../config/statusRules';
// ✅ NUEVO: visor y subida de documentos ligados a la operación
import { TIPOS_DOCUMENTO_OPERACION, FormularioOperacion } from './FormularioOperacion';
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
// ✅ logo + nombre de la empresa removidos de esta vista (se quitó EmpresaBrand)
import { useEmpresaConfig } from '../../configuracion/useEmpresaConfig';
import './ServiciosCancelados.css';
import { almacenSesion } from '../../../utils/cacheMemoria';

// ✅ NUEVO: fecha y hora legibles para la auditoría de referencias.
const fmtFechaAuditoria = (iso: any): string => {
  try {
    const d = new Date(String(iso));
    if (isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(iso || ''); }
};


// ✅ Color por TIPO DE OPERACIÓN: Transfer → naranja, Logística → azul,
//   Fletes → verde. Cualquier otro tipo conserva el color neutro.
const colorTipoOperacion = (nombre: any): string => {
  const n = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (n.includes('transfer')) return '#fb923c';
  if (n.includes('logist')) return '#58a6ff';
  if (n.includes('flete')) return '#3fb950';
  return '#c9d1d9';
};

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// ID hex del status "Cancelado" en catalogo_status_servicio
// ✅ NUEVO: utilidad para el Historial de Actividad (historial_actividad).
//   Nunca debe romper el flujo principal: los llamados a registrarLog van con .catch.
const describirFiltrosLog = (f: { fechaInicio: string; fechaFin: string; cliente?: string; clienteNombre?: string; remolque?: string; remolqueNombre?: string; referencia?: string; busqueda?: string }): string => {
  const partes: string[] = [`Fechas: ${f.fechaInicio} a ${f.fechaFin}`];
  if (f.cliente) partes.push(`Cliente: ${f.clienteNombre || f.cliente}`);
  if (f.remolque) partes.push(`Remolque: ${f.remolqueNombre || f.remolque}`);
  if (f.referencia && f.referencia.trim()) partes.push(`# Referencia: "${f.referencia.trim()}"`);
  if (f.busqueda && f.busqueda.trim()) partes.push(`Filtro general: "${f.busqueda.trim()}"`);
  return partes.join(' | ');
};

// ✅ NUEVO: el último filtro buscado se guarda POR USUARIO en localStorage y se
//   restaura (con búsqueda automática) al volver a entrar al módulo.
const FILTROS_STORAGE_PREFIX = 'roelca_canceladas_filtros_v1_';
const claveFiltrosGuardados = () => FILTROS_STORAGE_PREFIX + (auth.currentUser?.uid || 'anon');

// ✅ NUEVO: columnas de la tabla (única fuente para encabezados, ordenamiento y Excel).
const COLUMNAS_TABLA_CANCELADOS = [
  { id: 'ref', label: '# Ref' },
  { id: 'fecha', label: 'Fecha' },
  { id: 'tipoOperacion', label: 'Tipo de Operación' },
  { id: 'status', label: 'Status' },
  { id: 'convenio', label: 'Convenio (Tarifa)' },
  { id: 'remolque', label: '# Remolque' },
  { id: 'proveedor', label: 'Proveedor' },
  { id: 'unidad', label: 'Unidad' },
  { id: 'cliente', label: 'Cliente (Paga)' },
  { id: 'subtotal', label: 'Subtotal' },
];

// ✅ NUEVO: la selección y el ORDEN de columnas del Excel se recuerdan POR USUARIO.
const EXPORT_STORAGE_PREFIX = 'roelca_canceladas_export_v1_';
const claveExportGuardado = () => EXPORT_STORAGE_PREFIX + (auth.currentUser?.uid || 'anon');

const STATUS_CANCELADO_ID = '7607f692';
// ID del tipo de empresa "Cliente (Paga)" para el buscador de clientes
const ID_TIPO_CLIENTE_PAGA = '7eec9cbb';
// Tamaño de cada página al traer las canceladas por cursor
const TAMANIO_PAGINA = 150;

// ✅ NUEVO: normaliza CUALQUIER formato de fecha a "YYYY-MM-DD" para poder filtrar
//   por rango en memoria sin importar si el registro guardó Timestamp, ISO con hora
//   o "DD/MM/YYYY". Devuelve '' si no se puede interpretar.
const normalizarFechaISO = (valor: any): string => {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'object') {
    try {
      if (typeof valor.toDate === 'function') return valor.toDate().toISOString().split('T')[0];
      if (typeof valor.seconds === 'number') return new Date(valor.seconds * 1000).toISOString().split('T')[0];
      if (valor instanceof Date && !isNaN(valor.getTime())) return valor.toISOString().split('T')[0];
    } catch { /* sigue abajo */ }
  }
  const s = String(valor).trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    const y = dmy[3];
    let dd = a, mm = b;
    if (a <= 12 && b > 12) { mm = a; dd = b; }
    if (mm < 1 || mm > 12) return '';
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return '';
};

const ServiciosCancelados = () => {
  // ✅ NUEVO: logo de la empresa para los PDFs generados desde este módulo
  const { config: empresaConfig } = useEmpresaConfig();

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(false);
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
  // ✅ NUEVO: mensaje de error real de carga (distinto a "no hay canceladas")
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [modalHorarios, setModalHorarios] = useState<'cerrado' | 'registrar' | 'historial'>('cerrado');
  const [historialList, setHistorialList] = useState<any[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  // ✅ NUEVO: edición de horario/status (igual que Operaciones Activas)
  const [nuevoStatus, setNuevoStatus] = useState('');
  const [nuevaFechaHora, setNuevaFechaHora] = useState('');
  const [botonesDisponibles, setBotonesDisponibles] = useState<string[]>([]);
  const [guardandoStatusRapido, setGuardandoStatusRapido] = useState<string | null>(null);
  const [ultimoStatusGuardado, setUltimoStatusGuardado] = useState<string | null>(null);
  // ✅ NUEVO: control del visor de documentos y del modal de subida
  const [mostrarDocumentos, setMostrarDocumentos] = useState(false);
  const [mostrarSubirDocOp, setMostrarSubirDocOp] = useState(false);
  // ✅ NUEVO: edición vía FormularioOperacion completo (igual que Activos/Completados)
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [operacionEditando, setOperacionEditando] = useState<any | null>(null);

  const [catalogosGlobales, setCatalogosGlobales] = useState<any>({});
  const [busqueda, setBusqueda] = useState('');

  // ✅ MODIFICADO: el rango de fechas y los demás campos son TODOS filtros OPCIONALES
  //    que se aplican en memoria. La carga base trae todas las operaciones canceladas.
  const [filterFechaInicio, setFilterFechaInicio] = useState('');
  const [filterFechaFin, setFilterFechaFin] = useState('');
  const [filterCliente, setFilterCliente] = useState('');
  const [filterRemolque, setFilterRemolque] = useState('');
  // ✅ NUEVO: filtro por # DE REFERENCIA (busca en las referencias ya guardadas).
  //   ⚠️ Regla: # referencia y # remolque SOLO funcionan con un rango de fechas.
  const [filterReferencia, setFilterReferencia] = useState('');

  // ✅ NUEVO: buscador autocompletado de cliente (igual que Servicios Completados)
  const [textoBuscarCliente, setTextoBuscarCliente] = useState('');
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);

  // ✅ NUEVO: buscador autocompletado de remolque (antes era un desplegable)
  const [textoBuscarRemolque, setTextoBuscarRemolque] = useState('');
  const [mostrarSugerenciasRemolque, setMostrarSugerenciasRemolque] = useState(false);

  const [paginaActual, setPaginaActual] = useState(1);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ✅ NUEVO: ordenamiento por columna al hacer clic en el encabezado.
  //   1er clic = ascendente (▲), 2do clic = descendente (▼), 3er clic = orden original.
  const [ordenColumna, setOrdenColumna] = useState<string | null>(null);
  const [ordenDireccion, setOrdenDireccion] = useState<'asc' | 'desc' | null>(null);

  // ✅ NUEVO: los filtros de la barra superior YA NO se aplican en vivo — se
  //   "congelan" aquí al presionar el botón BUSCAR y la tabla solo muestra
  //   resultados cuando este snapshot existe. El rango de fechas es obligatorio.
  const [filtrosAplicados, setFiltrosAplicados] = useState<{
    fechaInicio: string;
    fechaFin: string;
    cliente: string;
    clienteNombre: string;
    remolque: string;
    remolqueNombre: string;
    referencia: string;
    busqueda: string;
  } | null>(null);

  // ✅ NUEVO: sidebar FLOTANTE del lado DERECHO donde viven TODOS los filtros.
  //   Cerrado por defecto; se abre con el botón "Filtros" de la barra superior.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);

  // ✅ NUEVO: modal de exportación a Excel con columnas seleccionables y ordenables.
  const [modalExportar, setModalExportar] = useState(false);
  const [columnasExport, setColumnasExport] = useState<{ id: string; label: string; visible: boolean }[]>([]);
  const dragExportIdx = useRef<number | null>(null);

  // ✅ NUEVO: evita re-descargar todas las canceladas en cada búsqueda — la
  //   descarga por status trae TODO el conjunto y los filtros van en memoria.
  const yaDescargado = useRef(false);

  // ✅ NUEVO: resolución bidireccional ID ↔ Nombre de catalogo_status_servicio.
  const mapaStatus = useMemo(() => {
    const lista = (catalogosGlobales.statusServicio || []) as any[];
    const porId: Record<string, { id: string; nombre: string }> = {};
    const porNombre: Record<string, { id: string; nombre: string }> = {};
    lista.forEach((s: any) => {
      const entry = { id: String(s.id || ''), nombre: String(s.nombre || s.id || '') };
      if (entry.id) porId[entry.id] = entry;
      if (entry.nombre) porNombre[entry.nombre.trim().toLowerCase()] = entry;
    });
    return { porId, porNombre };
  }, [catalogosGlobales.statusServicio]);

  const resolverStatus = (valor: string | null | undefined): { id: string; nombre: string } => {
    if (!valor) return { id: '', nombre: '' };
    const v = String(valor).trim();
    if (mapaStatus.porId[v]) return mapaStatus.porId[v];
    const porNom = mapaStatus.porNombre[v.toLowerCase()];
    if (porNom) return porNom;
    return { id: v, nombre: v };
  };

  // ✅ MODIFICADO: CARGA por STATUS (todas las canceladas, status === 7607f692).
  //    Se pagina por cursor ordenando por documento (__name__) para NO depender de
  //    un índice de fechaServicio ni del formato en que se guardó la fecha (que es
  //    justo lo que dejaba la tabla vacía). El rango de fechas se aplica luego en
  //    memoria sobre lo descargado.
  // ✅ VELOCIDAD: dataset cacheado EN MEMORIA 10 min — al volver al módulo o
  //   re-buscar, la tabla y los filtros responden al instante sin re-descargar.
  const CACHE_MEM_CANCELADOS = 'cancelados_ops_v1';
  const CACHE_MEM_TTL = 10 * 60 * 1000;

  const descargarOperaciones = async (opciones: { forzar?: boolean } = {}) => {
    if (!opciones.forzar) {
      const enCache = obtenerCacheMemoria<(Record<string, unknown> & { id: string })[]>(CACHE_MEM_CANCELADOS, CACHE_MEM_TTL);
      if (enCache) { setOperacionesGlobales(enCache); return; }
    } else {
      limpiarCacheMemoria(CACHE_MEM_CANCELADOS);
    }
    setCargandoOperaciones(true);
    setErrorCarga(null);
    try {
      const acumulado: any[] = [];
      let cursor: any = null;

      for (let pagina = 0; pagina < 60; pagina++) {
        const constraints: any[] = [where('status', '==', STATUS_CANCELADO_ID), orderBy('__name__')];
        if (cursor) constraints.push(startAfter(cursor));
        constraints.push(limit(TAMANIO_PAGINA));

        const snap = await getDocs(query(collection(db, 'operaciones'), ...constraints));
        if (snap.empty) break;
        snap.docs.forEach((d: any) => acumulado.push({ id: d.id, ...d.data() }));
        cursor = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < TAMANIO_PAGINA) break;
      }

      acumulado.sort((a, b) => normalizarFechaISO(b.fechaServicio).localeCompare(normalizarFechaISO(a.fechaServicio)));
      console.log(`[FIREBASE READ] Descargadas ${acumulado.length} operaciones canceladas.`);
      guardarCacheMemoria(CACHE_MEM_CANCELADOS, acumulado);
      setOperacionesGlobales(acumulado);
    } catch (e: any) {
      console.error("Error al cargar operaciones canceladas:", e);
      setOperacionesGlobales([]);
      const msg = String(e?.message || e?.code || e || '').toLowerCase();
      if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('429')) {
        setErrorCarga('Se agotó la cuota de lecturas de Firestore. Se reinicia a las 2 AM (hora México). Considera activar el plan Blaze.');
      } else {
        setErrorCarga('Hubo un problema al cargar las operaciones canceladas. Verifica tu conexión e inténtalo de nuevo.');
      }
    }
    setCargandoOperaciones(false);
  };

  // ✅ CARGA LIGERA: solo lo que necesitan los buscadores de la barra (Cliente y
  //    Remolque) y los botones de status. NO baja los catálogos pesados de PDF
  //    (tarifas, convenios, unidades, empleados, etc.). Reduce mucho las lecturas
  //    al abrir la vista. La tabla se pinta con los nombres ya guardados.
  const cargarCatalogosFiltros = async () => {
    if (Object.keys(catalogosGlobales).length > 0) return;
    // Si existe la caché COMPLETA en sesión, úsala (gratis) y listo.
    const cacheCatStr = almacenSesion.getItem('roelca_catalogos_v2');
    if (cacheCatStr) { setCatalogosGlobales(JSON.parse(cacheCatStr)); return; }
    try {
      const [empSnap, remSnap, statusSnap] = await Promise.all([
        getDocs(collection(db, 'empresas')),
        getDocs(collection(db, 'remolques')),
        getDocs(collection(db, 'catalogo_status_servicio')),
      ]);
      setCatalogosGlobales((prev: any) => ({
        ...prev,
        empresas: empSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
        remolques: remSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
        statusServicio: statusSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      }));
    } catch (e) {
      console.error('Error cargando catálogos de filtros:', e);
    }
  };

  // ✅ 2. CARGA COMPLETA DE CATÁLOGOS (solo cuando se generan PDFs).
  //    El marcador de "set completo" es `tarifas`: si ya está, no repetimos.
  const cargarCatalogosSiEsNecesario = async () => {
    if (catalogosGlobales.tarifas) return;

    const cacheCatStr = almacenSesion.getItem('roelca_catalogos_v2');
    if (cacheCatStr) {
      setCatalogosGlobales(JSON.parse(cacheCatStr));
      return;
    }

    console.warn(`[FIREBASE READ] Descargando catálogos pesados por primera vez...`);
    const [empSnap, opSnap, embSnap, remSnap, tarSnap, convProvSnap, convProvDetSnap, tcSnap, convCliSnap, convDetSnap, uniSnap, operSnap, statusSnap, uniProvSnap, opeProvSnap] = await Promise.all([
      getDocs(collection(db, 'empresas')),
      getDocs(collection(db, 'catalogo_tipo_operacion')),
      getDocs(collection(db, 'catalogo_embalaje')),
      getDocs(collection(db, 'remolques')),
      getDocs(collection(db, 'catalogo_tarifas_referencia')),
      getDocs(collection(db, 'convenios_proveedores')),
      getDocs(collection(db, 'convenios_proveedores_detalles')),
      getDocs(collection(db, 'tipo_cambio')),
      getDocs(collection(db, 'convenios_clientes')),
      getDocs(collection(db, 'convenios_clientes_detalles')),
      getDocs(collection(db, 'unidades')),
      getDocs(collection(db, 'empleados')),
      getDocs(collection(db, 'catalogo_status_servicio')),
      getDocs(collection(db, 'unidades_proveedor')),
      getDocs(collection(db, 'proveedores_unidad'))
    ]);

    const catGuardados = {
      empresas: empSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      tiposOperacion: opSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      embalajes: embSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      remolques: remSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      tarifas: tarSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      conveniosProv: convProvSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      catalogoConvProvDetalles: convProvDetSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      catalogoTC: tcSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      catalogoConvClientes: convCliSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      catalogoConvDetalles: convDetSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      unidades: uniSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      empleados: operSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      statusServicio: statusSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      unidades_proveedor: uniProvSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      proveedores_unidad: opeProvSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    };

    almacenSesion.setItem('roelca_catalogos_v2', JSON.stringify(catGuardados));
    setCatalogosGlobales(catGuardados);
  };

  // ✅ NUEVO: re-sincroniza los catálogos EN MEMORIA con lo más fresco disponible.
  //   FormularioOperacion actualiza la caché de sesión (roelca_catalogos_v2) y las
  //   cachés locales cat_v2__ al crear clientes/proveedores/bodegas; sin este paso
  //   los registros nuevos no aparecían en la tabla ni en los documentos PDF hasta
  //   recargar la página.
  const resincronizarCatalogosDesdeCache = () => {
    try {
      const cacheCatStr = almacenSesion.getItem('roelca_catalogos_v2');
      if (cacheCatStr) {
        const cache = JSON.parse(cacheCatStr);
        setCatalogosGlobales((prev: any) => ({ ...prev, ...cache }));
      }
      // Las colecciones con alta rápida desde el formulario siempre quedan más
      // frescas en cat_v2__ (el formulario las re-descarga al abrir y al crear).
      ['empresas', 'remolques', 'unidades', 'empleados'].forEach((alias) => {
        const raw = localStorage.getItem(`cat_v2__${alias}`);
        if (!raw) return;
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.data) && obj.data.length > 0) {
          setCatalogosGlobales((prev: any) => ({ ...prev, [alias]: obj.data }));
        }
      });
    } catch { /* caché corrupta: ignorar */ }
  };

  // ✅ Al montar solo cargamos los catálogos LIGEROS (para poblar los buscadores
  //    de Cliente y Remolque y el status). Los pesados se cargan bajo demanda al
  //    generar un PDF. Los registros NO se cargan hasta definir el rango de fechas.
  useEffect(() => {
    cargarCatalogosFiltros();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ MODIFICADO: ya NO se descarga automáticamente al cambiar las fechas.
  //   La descarga y la aplicación de filtros ocurren SOLO al presionar BUSCAR.
  //   El rango de fechas (inicio + fin) es el requisito mínimo del botón.
  //   La carga sigue siendo por status 7607f692 (una sola descarga por sesión).
  // ✅ NUEVO: los filtros de # referencia y # remolque requieren rango de fechas.
  const rangoFechasListo = !!(filterFechaInicio && filterFechaFin);

  const ejecutarBusqueda = () => {
    if (!filterFechaInicio || !filterFechaFin) {
      alert('Selecciona Fecha Inicio y Fecha Fin para buscar.');
      return;
    }
    const snapshot = {
      fechaInicio: filterFechaInicio,
      fechaFin: filterFechaFin,
      cliente: filterCliente,
      clienteNombre: nombreClienteSeleccionado,
      remolque: filterRemolque,
      remolqueNombre: nombreRemolqueSeleccionado,
      referencia: filterReferencia,
      busqueda,
    };
    setFiltrosAplicados(snapshot);
    setPaginaActual(1);
    setDrawerFiltrosAbierto(false);
    // ✅ NUEVO: recuerda el último filtro de ESTE usuario para restaurarlo después.
    try { localStorage.setItem(claveFiltrosGuardados(), JSON.stringify(snapshot)); } catch { /* almacenamiento lleno: ignorar */ }
    if (!yaDescargado.current) {
      yaDescargado.current = true;
      descargarOperaciones();
    }
    // ✅ HISTORIAL: deja constancia de la búsqueda y de los filtros usados.
    registrarLog('Servicios Cancelados', 'Búsqueda', `Buscó operaciones canceladas con filtros → ${describirFiltrosLog(snapshot)}`).catch(() => { });
  };

  // ✅ MODIFICADO: Limpiar borra los campos del panel Y quita el filtro aplicado
  //   (la tabla vuelve al estado inicial) además del filtro recordado del usuario.
  const limpiarFiltrosPanel = () => {
    setFilterFechaInicio('');
    setFilterFechaFin('');
    setFilterCliente('');
    setTextoBuscarCliente('');
    setFilterRemolque('');
    setTextoBuscarRemolque('');
    setFilterReferencia('');
    setBusqueda('');
    setFiltrosAplicados(null);
    setPaginaActual(1);
    try { localStorage.removeItem(claveFiltrosGuardados()); } catch { /* ignorar */ }
  };

  // ✅ NUEVO: al entrar al módulo se restaura el último filtro buscado por este
  //   usuario y se ejecuta la búsqueda automáticamente (sin registrar log, ya
  //   que no es una búsqueda nueva sino la restauración de la anterior).
  useEffect(() => {
    try {
      const str = localStorage.getItem(claveFiltrosGuardados());
      if (!str) return;
      const f = JSON.parse(str);
      if (!f?.fechaInicio || !f?.fechaFin) return;
      setFilterFechaInicio(f.fechaInicio);
      setFilterFechaFin(f.fechaFin);
      setFilterCliente(f.cliente || '');
      setFilterRemolque(f.remolque || '');
      setFilterReferencia(f.referencia || '');
      setBusqueda(f.busqueda || '');
      setFiltrosAplicados({
        fechaInicio: f.fechaInicio,
        fechaFin: f.fechaFin,
        cliente: f.cliente || '',
        clienteNombre: f.clienteNombre || '',
        remolque: f.remolque || '',
        remolqueNombre: f.remolqueNombre || '',
        referencia: f.referencia || '',
        busqueda: f.busqueda || '',
      });
      if (!yaDescargado.current) {
        yaDescargado.current = true;
        descargarOperaciones();
      }
    } catch { /* filtro guardado corrupto: ignorar */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ NUEVO: cuántos filtros están definidos en el panel (para el contador del botón).
  const contadorFiltrosActivos = [filterFechaInicio || filterFechaFin, filterCliente, filterRemolque, filterReferencia.trim(), busqueda.trim()].filter(Boolean).length;

  // ✅ NUEVO: chips con el resumen del último criterio buscado.
  const resumenFiltrosChips = useMemo(() => {
    if (!filtrosAplicados) return [] as string[];
    const chips: string[] = [`📅 ${filtrosAplicados.fechaInicio} → ${filtrosAplicados.fechaFin}`];
    if (filtrosAplicados.cliente) chips.push(`Cliente: ${filtrosAplicados.clienteNombre || filtrosAplicados.cliente}`);
    if (filtrosAplicados.remolque) chips.push(`Remolque: ${filtrosAplicados.remolqueNombre || filtrosAplicados.remolque}`);
    if ((filtrosAplicados.referencia || '').trim()) chips.push(`# Referencia: "${filtrosAplicados.referencia.trim()}"`);
    if (filtrosAplicados.busqueda.trim()) chips.push(`Ref: "${filtrosAplicados.busqueda.trim()}"`);
    return chips;
  }, [filtrosAplicados]);

  // ✅ Logo para los PDF: si en la config hay un logo en base64 (data:...), úsalo;
  // si no, dejamos el global vacío para que el generador use el logo INCRUSTADO por
  // defecto. NO leemos la URL de Storage, para no provocar errores de CORS.
  useEffect(() => {
    const b64 = empresaConfig?.logoBase64;
    setLogoPdf(b64 && b64.startsWith('data:') ? b64 : '');
  }, [empresaConfig?.logoBase64]);

  useEffect(() => {
    setPaginaActual(1);
  }, [filtrosAplicados]);

  // ✅ NUEVO: cargar los botones de "Siguiente Paso" para la operación abierta.
  // Como en este módulo los catálogos son perezosos, primero garantizamos que
  // catalogo_status_servicio esté cargado (para resolver nombres ↔ IDs).
  useEffect(() => {
    const cargarBotones = async () => {
      if (operacionViendo) {
        await cargarCatalogosFiltros();
        let op = operacionViendo;
        if (!op.statusNombre && op.status) {
          const resuelto = resolverStatus(op.status);
          if (resuelto.nombre && resuelto.nombre !== resuelto.id) op = { ...op, statusNombre: resuelto.nombre };
        }
        const botones = await obtenerBotonesHorarioDinamicos(op);
        setBotonesDisponibles(botones || []);
      } else {
        setBotonesDisponibles([]);
      }
    };
    cargarBotones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionViendo, catalogosGlobales.statusServicio]);

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
  //    NO consulta otras colecciones (reduce lecturas) y NUNCA muestra un ID:
  //    si no hay nombre guardado, devuelve '-'. Para monedas cae a la conversión
  //    local ID→USD/MXN (sin catálogo).
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

  const verHistorial = async () => {
    setModalHorarios('historial');
    setCargandoHorarios(true);
    try {
      const q = query(collection(db, 'horarios'), where('operacionId', '==', operacionViendo.id));
      const snap = await getDocs(q);
      const data = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
      data.sort((a: any, b: any) => new Date(b.fechaHora).getTime() - new Date(a.fechaHora).getTime());
      setHistorialList(data);
    } catch (e) {
      console.error(e);
    }
    setCargandoHorarios(false);
  };

  // ✅ NUEVO: abrir el modal de registro retroactivo (fecha/hora personalizada)
  const abrirRegistroHorario = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
    setNuevaFechaHora(localISOTime);
    setNuevoStatus(botonesDisponibles[0] || '');
    setModalHorarios('registrar');
  };

  // ✅ NUEVO: refleja el cambio de status en memoria (este módulo no usa caché de ops).
  const aplicarStatusEnMemoria = (opId: string, statusId: string, statusNombre: string) => {
    setOperacionesGlobales(prev => prev.map((o: any) => (o.id === opId ? { ...o, status: statusId, statusNombre } : o)));
    setOperacionViendo((prev: any) => (prev && prev.id === opId ? { ...prev, status: statusId, statusNombre } : prev));
  };

  // ✅ NUEVO: guardar movimiento retroactivo (resuelve nombre → ID hex).
  const guardarHorario = async () => {
    if (!operacionViendo) return;
    if (!nuevoStatus || !nuevaFechaHora) return alert('Completa la fecha y el estatus.');
    setCargandoHorarios(true);
    try {
      const { id: statusId, nombre: statusNombreResuelto } = resolverStatus(nuevoStatus);
      const batch = writeBatch(db);
      const horarioRef = doc(collection(db, 'horarios'));
      batch.set(horarioRef, {
        operacionId: operacionViendo.id,
        status: statusId,
        statusNombre: statusNombreResuelto,
        fechaHora: nuevaFechaHora,
        registradoEn: new Date().toISOString()
      });
      const opRef = doc(db, 'operaciones', String(operacionViendo.id));
      batch.update(opRef, { status: statusId, statusNombre: statusNombreResuelto });
      await batch.commit();

      // ✅ HISTORIAL: cambio de status con el valor anterior y el nuevo.
      const refLogH = operacionViendo.ref || operacionViendo.id?.substring(0, 6) || operacionViendo.id;
      const statusAnteriorH = operacionViendo.statusNombre || operacionViendo.status || '(sin status)';
      registrarLog('Servicios Cancelados', 'Edición', `Cambió el status de la operación ${refLogH}: "${statusAnteriorH}" → "${statusNombreResuelto}" (horario del evento: ${nuevaFechaHora})`).catch(() => { });

      aplicarStatusEnMemoria(operacionViendo.id, statusId, statusNombreResuelto);
      alert('Horario registrado y Estatus actualizado.');
      setModalHorarios('cerrado');
    } catch (e) {
      console.error('[ServiciosCancelados] Error guardarHorario:', e);
      alert('Error al actualizar la base de datos.');
    }
    setCargandoHorarios(false);
  };

  // ✅ NUEVO: registrar status rápido (con cascada) — igual que Operaciones Activas.
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

      // Optimista: refleja en pantalla de inmediato
      aplicarStatusEnMemoria(operacionViendo.id, statusFinal.id, statusFinal.nombre);

      obtenerBotonesHorarioDinamicos({ ...operacionViendo, status: statusFinal.id, statusNombre: statusFinal.nombre })
        .then(botones => setBotonesDisponibles(botones || []))
        .catch(() => { });

      const now = new Date();
      const tzOffset = now.getTimezoneOffset() * 60000;
      const fechaHoraLocal = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
      const registradoEn = new Date().toISOString();

      const batch = writeBatch(db);
      cadenaResuelta.forEach((statusPaso, idx) => {
        const horarioRef = doc(collection(db, 'horarios'));
        batch.set(horarioRef, {
          operacionId: operacionViendo.id,
          status: statusPaso.id,
          statusNombre: statusPaso.nombre,
          fechaHora: fechaHoraLocal,
          registradoEn,
          ordenCascada: idx,
          esAutomatico: idx > 0,
        });
      });
      const opRef = doc(db, 'operaciones', String(operacionViendo.id));
      batch.update(opRef, { status: statusFinal.id, statusNombre: statusFinal.nombre });
      await batch.commit();

      // ✅ HISTORIAL: status rápido (incluye la cascada de status automáticos).
      const refLogR = operacionViendo.ref || operacionViendo.id?.substring(0, 6) || operacionViendo.id;
      const statusAnteriorR = operacionPrevia.statusNombre || operacionPrevia.status || '(sin status)';
      const cascadaTxt = cadenaResuelta.length > 1 ? ` (cascada: ${cadenaResuelta.map(c => c.nombre).join(' → ')})` : '';
      registrarLog('Servicios Cancelados', 'Edición', `Cambió el status de la operación ${refLogR}: "${statusAnteriorR}" → "${statusFinal.nombre}"${cascadaTxt}`).catch(() => { });

      setGuardandoStatusRapido(null);
      setUltimoStatusGuardado(statusNombre);
      setTimeout(() => setUltimoStatusGuardado(null), 1500);
    } catch (e: any) {
      console.error('[ServiciosCancelados] Error al registrar status:', e);
      // Revertir el cambio optimista
      setOperacionViendo(operacionPrevia);
      setOperacionesGlobales(operacionesPrevias);
      setBotonesDisponibles(botonesPrevios);
      setGuardandoStatusRapido(null);
      alert('Error al guardar el status. Se revirtió el cambio.');
    }
  };

  // ✅ PDFs: Descargan catálogos solo si se solicita generar documento
  const handleDescargarSolicitudRetiro = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origen = mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor ? (catalogosGlobales.unidades_proveedor?.find((u: any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o: any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    generarSolicitudRetiroPDF({
      bodegaNombre: origen,
      tipoMovimiento: operacionViendo.trafico || 'N/A',
      remolqueNombre: operacionViendo.remolquePlaca || operacionViendo.remolqueNombre || (remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A'),
      remolquePlacas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      clienteMercancia: operacionViendo.clienteMercanciaNombre || mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      unidadNombre: operacionViendo.unidadNombre || (unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal),
      unidadPlacas: unidadObj ? (unidadObj.placa || 'N/A') : 'N/A',
      empleadoNombre: operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal),
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
    });
  };

  const handleDescargarInstruccionesServicio = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor
      ? (catalogosGlobales.unidades_proveedor?.find((u: any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o: any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    generarInstruccionesServicioPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'N/A',
      fecha: operacionViendo.fechaServicio || '',
      unidadNombre: operacionViendo.unidadNombre || (unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal),
      empleadoNombre: operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal),
      remolqueNombre: operacionViendo.remolqueNombre || (remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A'),
      remolquePlacas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      tipoOperacion: operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion'),
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
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor
      ? (catalogosGlobales.unidades_proveedor?.find((u: any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o: any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);
    const uniNombre = operacionViendo.unidadNombre || (unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal);
    const uniPlacas = unidadObj ? (unidadObj.placa || 'N/A') : 'N/A';

    generarCheckListPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'S/R',
      fecha: operacionViendo.fechaServicio || '',
      cliente: operacionViendo.clienteNombre || mostrarDatoMapeado(operacionViendo.clientePaga, 'empresas'),
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

    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o: any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);

    generarPruebaEntregaPDF({
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'S/R',
      fechaServicio: operacionViendo.fechaServicio || 'N/A',
      fechaCita: operacionViendo.fechaCita ? new Date(operacionViendo.fechaCita).toLocaleString('es-MX') : 'N/A',
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      origenCP: origenObj ? (origenObj.cp || origenObj.codigoPostal || 'N/A') : 'N/A',
      origenCiudad: origenObj ? (origenObj.ciudad || origenObj.estado || 'N/A') : 'N/A',
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      destinoCP: destinoObj ? (destinoObj.cp || destinoObj.codigoPostal || 'N/A') : 'N/A',
      destinoCiudad: destinoObj ? (destinoObj.ciudad || destinoObj.estado || 'N/A') : 'N/A',
      tipoServicio: `${operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion')} ${operacionViendo.trafico || ''}`,
      tipoUnidad: remolqueObj ? (remolqueObj.tipo || remolqueObj.descripcion || 'Remolque') : 'N/A',
      numeroEconomico: operacionViendo.remolqueNombre || (remolqueObj ? remolqueObj.nombre : 'N/A'),
      placas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      operador: empNombre,
      descripcionMercancia: operacionViendo.descripcionMercancia || 'N/A'
    });
  };

  const handleDescargarCartaInstrucciones = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o: any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);

    generarCartaInstruccionesPDF({
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'S/R',
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'S/R',
      fechaServicio: operacionViendo.fechaServicio || 'N/A',
      fechaCita: operacionViendo.fechaCita ? new Date(operacionViendo.fechaCita).toLocaleString('es-MX') : 'N/A',
      tipoServicio: operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion'),
      trafico: operacionViendo.trafico || '',
      tipoUnidad: remolqueObj ? (remolqueObj.tipo || remolqueObj.descripcion || 'Remolque') : 'N/A',
      numeroEconomico: operacionViendo.remolqueNombre || (remolqueObj ? remolqueObj.nombre : 'N/A'),
      placas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      operador: empNombre,
      descripcionMercancia: operacionViendo.descripcionMercancia || 'N/A',
      origenCiudad: origenObj ? (origenObj.ciudad || origenObj.estado || 'N/A') : 'N/A',
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      origenColonia: origenObj ? (origenObj.colonia || 'N/A') : 'N/A',
      origenCP: origenObj ? (origenObj.cp || origenObj.codigoPostal || 'N/A') : 'N/A',
      destinoCiudad: destinoObj ? (destinoObj.ciudad || destinoObj.estado || 'N/A') : 'N/A',
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      destinoColonia: destinoObj ? (destinoObj.colonia || 'N/A') : 'N/A',
      destinoCP: destinoObj ? (destinoObj.cp || destinoObj.codigoPostal || 'N/A') : 'N/A',
    });
  };

  // ✅ NUEVO: lista de clientes "Paga" para el buscador (empresas con tipo 7eec9cbb)
  const clientesFiltradosBuscador = useMemo(() => {
    if (!catalogosGlobales.empresas) return [];
    const esClientePaga = (emp: any) => {
      const tipos = emp?.tiposEmpresa;
      if (Array.isArray(tipos)) return tipos.some((t: any) => String(t).trim() === ID_TIPO_CLIENTE_PAGA);
      if (typeof tipos === 'string') return tipos.includes(ID_TIPO_CLIENTE_PAGA);
      if (tipos && typeof tipos === 'object') return Object.values(tipos).some((v: any) => String(v).trim() === ID_TIPO_CLIENTE_PAGA);
      return false;
    };
    const clientes = catalogosGlobales.empresas
      .filter(esClientePaga)
      .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
    if (!textoBuscarCliente.trim()) return clientes.slice(0, 30);
    const q = textoBuscarCliente.toLowerCase().trim();
    return clientes.filter((c: any) =>
      String(c.nombre || '').toLowerCase().includes(q) ||
      String(c.rfc || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [catalogosGlobales.empresas, textoBuscarCliente]);

  const nombreClienteSeleccionado = useMemo(() => {
    if (!filterCliente || !catalogosGlobales.empresas) return '';
    const cli = catalogosGlobales.empresas.find((e: any) => e.id === filterCliente);
    return cli?.nombre || filterCliente;
  }, [filterCliente, catalogosGlobales.empresas]);

  // ✅ NUEVO: lista de remolques para el buscador (antes era un <select>)
  const etiquetaRemolque = (r: any) => `${r?.nombre || ''} ${r?.placas || r?.placa || ''}`.trim();

  const remolquesFiltradosBuscador = useMemo(() => {
    const lista = (catalogosGlobales.remolques || []) as any[];
    const ordenada = [...lista].sort((a: any, b: any) => etiquetaRemolque(a).localeCompare(etiquetaRemolque(b), 'es', { sensitivity: 'base' }));
    if (!textoBuscarRemolque.trim()) return ordenada.slice(0, 30);
    const q = textoBuscarRemolque.toLowerCase().trim();
    return ordenada.filter((r: any) => etiquetaRemolque(r).toLowerCase().includes(q)).slice(0, 30);
  }, [catalogosGlobales.remolques, textoBuscarRemolque]);

  const nombreRemolqueSeleccionado = useMemo(() => {
    if (!filterRemolque || !catalogosGlobales.remolques) return '';
    const r = catalogosGlobales.remolques.find((x: any) => x.id === filterRemolque);
    return r ? etiquetaRemolque(r) : filterRemolque;
  }, [filterRemolque, catalogosGlobales.remolques]);

  // ✅ MODIFICADO: TODOS los filtros son opcionales y se aplican en memoria sobre
  //   las canceladas ya descargadas. El rango de fechas usa la fecha NORMALIZADA
  //   para tolerar formatos legacy (Timestamp / DD-MM-YYYY / ISO con hora).
  // ✅ MODIFICADO: la tabla se filtra con el SNAPSHOT de filtros congelado al
  //   presionar BUSCAR (filtrosAplicados), no con los campos en vivo de la barra.
  //   El rango de fechas es obligatorio; el resto sigue siendo opcional.
  const operacionesFiltradas = useMemo(() => {
    if (!filtrosAplicados) return [];
    const b = filtrosAplicados.busqueda.toLowerCase();
    const ini = filtrosAplicados.fechaInicio;
    const fin = filtrosAplicados.fechaFin;
    const fCliente = filtrosAplicados.cliente;
    const fRemolque = filtrosAplicados.remolque;
    const fRemolqueNombre = filtrosAplicados.remolqueNombre;
    const fReferencia = (filtrosAplicados.referencia || '').trim().toLowerCase();

    return operacionesGlobales.filter(op => {
      // Rango de fechas (obligatorio)
      {
        const f = normalizarFechaISO(op.fechaServicio);
        if (!f || f < ini || f > fin) return false;
      }

      // Cliente (opcional)
      if (fCliente && String(op.clientePaga || op.clienteId || '') !== fCliente) return false;

      // Remolque (opcional) — por ID o por nombre desnormalizado
      if (fRemolque) {
        const coincideRem =
          String(op.numeroRemolque || '') === fRemolque ||
          (fRemolqueNombre && String(op.remolqueNombre || '').toLowerCase().includes(fRemolqueNombre.toLowerCase()));
        if (!coincideRem) return false;
      }

      // ✅ NUEVO: # de referencia (opcional) — coincidencia parcial en las
      //   referencias YA GUARDADAS dentro del rango de fechas aplicado arriba.
      if (fReferencia) {
        const textoRef = `${op.ref || ''} ${op.numReferencia || ''} ${op.referencia || ''}`.toLowerCase();
        if (!textoRef.includes(fReferencia)) return false;
      }

      // Búsqueda general (opcional)
      if (b) {
        const match = (
          String(op.ref || op.id || '').toLowerCase().includes(b) ||
          String(op.fechaServicio || '').toLowerCase().includes(b) ||
          String(op.clienteNombre || op.nombreCliente || '').toLowerCase().includes(b) ||
          String(op.tipoOperacionNombre || op.tipoServicio || '').toLowerCase().includes(b) ||
          String(op.trafico || '').toLowerCase().includes(b) ||
          String(op.statusNombre || op.status || '').toLowerCase().includes(b)
        );
        if (!match) return false;
      }

      return true;
    });
  }, [filtrosAplicados, operacionesGlobales]);

  // ✅ NUEVO: valor de una celda para ORDENAR. Espeja lo que se pinta en cada
  //   columna; la fecha usa el valor ISO normalizado para orden cronológico.
  const valorOrdenColumna = (op: any, colId: string): string => {
    const limpiar = (v: any): string => {
      const t = String(v ?? '').trim();
      return t === '-' ? '' : t;
    };
    switch (colId) {
      case 'ref': return limpiar(op.ref || op.id?.substring(0, 6));
      case 'fecha': return limpiar(normalizarFechaISO(op.fechaServicio));
      case 'tipoOperacion': return limpiar(mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre));
      case 'status': return limpiar(mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre));
      case 'convenio': return limpiar(obtenerNombreConvenioCliente(op.convenio, op.convenioNombre));
      case 'remolque': return limpiar(mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre));
      case 'proveedor': return limpiar(mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre));
      case 'unidad': return limpiar(mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre));
      case 'cliente': return limpiar(mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente));
      case 'subtotal': return limpiar(op.subtotalCliente);
      default: return '';
    }
  };

  // ✅ NUEVO: comparador tolerante — numérico cuando ambos valores son números
  //   (Subtotal) y alfabético con colación española en el resto.
  const compararValoresOrden = (va: string, vb: string): number => {
    const na = Number(va);
    const nb = Number(vb);
    if (va !== '' && vb !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    return va.localeCompare(vb, 'es', { numeric: true, sensitivity: 'base' });
  };

  // ✅ NUEVO: por defecto el Excel usa las columnas de la tabla en su orden.
  const columnasExportPorDefecto = () =>
    COLUMNAS_TABLA_CANCELADOS.map(c => ({ id: c.id, label: c.label, visible: true }));

  // ✅ NUEVO: abre el modal restaurando la última configuración guardada del
  //   usuario (tolerante a columnas nuevas: se agregan al final desmarcadas).
  const abrirModalExportar = () => {
    if (operacionesOrdenadas.length === 0) {
      alert('No hay datos para exportar. Realiza una búsqueda primero.');
      return;
    }
    try {
      const str = localStorage.getItem(claveExportGuardado());
      if (str) {
        const guardadas = JSON.parse(str) as { id: string; visible: boolean }[];
        const porId = new Map(COLUMNAS_TABLA_CANCELADOS.map(c => [c.id, c] as const));
        const lista: { id: string; label: string; visible: boolean }[] = [];
        guardadas.forEach(g => {
          const c = porId.get(g.id);
          if (c) { lista.push({ id: c.id, label: c.label, visible: !!g.visible }); porId.delete(g.id); }
        });
        porId.forEach(c => lista.push({ id: c.id, label: c.label, visible: false }));
        setColumnasExport(lista);
      } else {
        setColumnasExport(columnasExportPorDefecto());
      }
    } catch { setColumnasExport(columnasExportPorDefecto()); }
    setModalExportar(true);
  };

  // ✅ NUEVO: mover una columna con las flechas ▲▼.
  const moverColumnaExport = (idx: number, delta: number) => {
    setColumnasExport(prev => {
      const j = idx + delta;
      if (j < 0 || j >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });
  };

  // ✅ NUEVO: soltar una columna arrastrada sobre la posición destino.
  const soltarColumnaExport = (destino: number) => {
    const origen = dragExportIdx.current;
    dragExportIdx.current = null;
    if (origen === null || origen === destino) return;
    setColumnasExport(prev => {
      const arr = [...prev];
      const [item] = arr.splice(origen, 1);
      arr.splice(destino, 0, item);
      return arr;
    });
  };

  // ✅ NUEVO: valor de cada celda para el Excel. Usa los catálogos (nombres
  //   canónicos, evita variantes como "Dolares"/"Dólares"), fecha normalizada
  //   a AAAA-MM-DD y Subtotal como número real.
  const valorExcelColumna = (op: any, colId: string): any => {
    switch (colId) {
      case 'ref': return op.ref || op.id?.substring(0, 6) || '';
      case 'fecha': return normalizarFechaISO(op.fechaServicio) || op.fechaServicio || '';
      case 'tipoOperacion': return mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre);
      case 'status': return mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre);
      case 'convenio': return obtenerNombreConvenioCliente(op.convenio, op.convenioNombre);
      case 'remolque': return mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre);
      case 'proveedor': return mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre);
      case 'unidad': return mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre);
      case 'cliente': return mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente);
      case 'subtotal': return Number(op.subtotalCliente) || 0;
      default: return '';
    }
  };

  // ✅ NUEVO: exportación a Excel de las canceladas con el orden elegido.
  const exportarExcel = async () => {
    if (operacionesOrdenadas.length === 0) return alert('No hay datos para exportar.');
    const columnasVisibles = columnasExport.filter(c => c.visible);
    if (columnasVisibles.length === 0) return alert('Selecciona al menos una columna para exportar.');

    await cargarCatalogosSiEsNecesario();

    const datosExcel = operacionesOrdenadas.map((op: any) => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        const v = valorExcelColumna(op, col.id);
        fila[col.label] = v === '-' ? '' : v;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Cancelados');
    XLSX.writeFile(workbook, `Servicios_Cancelados_${new Date().toISOString().split('T')[0]}.xlsx`);

    // ✅ NUEVO: recuerda la selección/orden de columnas de ESTE usuario y cierra el modal.
    try { localStorage.setItem(claveExportGuardado(), JSON.stringify(columnasExport.map(c => ({ id: c.id, visible: c.visible })))); } catch { /* ignorar */ }
    setModalExportar(false);
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

  // ✅ NUEVO: lista final que ve la tabla. Sin columna de orden activa se
  //   respeta el orden original (fecha de servicio descendente).
  const operacionesOrdenadas = useMemo(() => {
    if (!ordenColumna || !ordenDireccion) return operacionesFiltradas;
    const dir = ordenDireccion === 'asc' ? 1 : -1;
    return [...operacionesFiltradas].sort((a: any, b2: any) => {
      const va = valorOrdenColumna(a, ordenColumna);
      const vb = valorOrdenColumna(b2, ordenColumna);
      if (va === '' && vb === '') return 0;
      if (va === '') return 1;   // vacíos siempre al final
      if (vb === '') return -1;
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

  // ✅ NUEVO: abrir el FormularioOperacion completo para editar (igual que Activos/Completados)
  const abrirEdicion = (op: any) => {
    setOperacionEditando(op);
    setEstadoFormulario('abierto');
  };

  // ✅ NUEVO: tras guardar, cerrar el formulario y refrescar la lista (si hay rango activo)
  const handleOperacionGuardada = () => {
    // ✅ NUEVO: refleja al instante los catálogos recién creados desde el formulario.
    resincronizarCatalogosDesdeCache();
    setEstadoFormulario('cerrado');
    setOperacionEditando(null);
    setOperacionViendo(null);
    if (filtrosAplicados) descargarOperaciones({ forzar: true });
  };

  const tabsDetalle = [{ id: 'general', label: 'Información General' }, { id: 'pedimento', label: 'Pedimento y CT' }, { id: 'manifiestos', label: "Entry's y Manifiestos" }, { id: 'unidad', label: 'Unidad y Operador' }, { id: 'cobrar', label: 'Por Cobrar' }];

  const evalTipoOpText = String(operacionViendo?.tipoOperacionNombre || operacionViendo?.tipoOperacionId || '').toLowerCase();
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsRoelca = String(operacionViendo?.proveedorUnidadNombre || operacionViendo?.proveedorUnidad || '').toLowerCase().includes('roelca');

  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  // ✅ Referencia legible de la operación en curso (carpeta de Storage)
  const refOperacionViendo = operacionViendo ? (operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'Operacion') : '';

  return (
    <div className="module-container sc-x1">

      {/* ✅ NUEVO: FormularioOperacion COMPLETO para editar (igual que Activos/Completados) */}
      {estadoFormulario !== 'cerrado' && (
        <FormularioOperacion
          estado={estadoFormulario}
          initialData={operacionEditando}
          onClose={() => { resincronizarCatalogosDesdeCache(); setEstadoFormulario('cerrado'); setOperacionEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')}
          onRestore={() => setEstadoFormulario('abierto')}
          catalogosCacheados={catalogosGlobales}
          onSave={handleOperacionGuardada}
        />
      )}

      <div className="sc-x2">
        <div className="sc-x3">
          <h1 className="module-title sc-x4">Servicios Cancelados</h1>
        </div>

        {/* ✅ NUEVO: sidebar FLOTANTE de filtros — anclado al lado DERECHO de la
              pantalla, con fondo oscurecido; se abre con el botón Filtros. */}
        {drawerFiltrosAbierto && (
          <>
            <div className="sc-x5" onClick={() => setDrawerFiltrosAbierto(false)} />
            <aside className="sc-x6">
              <div className="sc-x7">
                <div className="sc-x8">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                  <span className="sc-x9">Filtros</span>
                </div>
                <button className="sc-x10" onClick={() => setDrawerFiltrosAbierto(false)} title="Cerrar filtros">✕</button>
              </div>

              <div className="sc-x11">

                {/* Fecha Inicio (requerida para mostrar registros) */}
                <div className="sc-x12">
                  <label className="sc-x13">FECHA INICIO *</label>
                  <input className="sc-x14" type="date" value={filterFechaInicio} onChange={(e) => setFilterFechaInicio(e.target.value)} />
                </div>

                {/* Fecha Fin (requerida para mostrar registros) */}
                <div className="sc-x12">
                  <label className="sc-x13">FECHA FIN *</label>
                  <input className="sc-x14" type="date" value={filterFechaFin} min={filterFechaInicio || undefined} onChange={(e) => setFilterFechaFin(e.target.value)} />
                </div>

                {/* ✅ NUEVO: filtro por # DE REFERENCIA (busca en las referencias ya
              guardadas dentro del rango). Requiere rango de fechas. */}
                <div className="sc-x12">
                  <label className="sc-x15"># REFERENCIA (requiere rango de fechas)</label>
                  <input
                    type="text"
                    placeholder={rangoFechasListo ? 'Ej. TR-220726-016 (acepta parcial)' : 'Coloca un rango de fechas primero'}
                    value={filterReferencia}
                    onChange={(e) => setFilterReferencia(e.target.value)}
                    disabled={!rangoFechasListo}
                    title={rangoFechasListo ? 'Busca en los números de referencia ya guardados dentro del rango de fechas' : 'Este filtro solo funciona con un rango de fechas (inicio y fin)'}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box', opacity: rangoFechasListo ? 1 : 0.45, cursor: rangoFechasListo ? 'text' : 'not-allowed' }}
                  />
                  {!rangoFechasListo && (
                    <div className="sc-x16">⚠️ Requiere Fecha Inicio y Fecha Fin.</div>
                  )}
                </div>

                {/* Cliente que paga (buscador con autocompletado) */}
                <div className="sc-x17">
                  <label className="sc-x15">CLIENTE QUE PAGA (opcional)</label>

                  {filterCliente ? (
                    <div className="sc-x18">
                      <span className="sc-x19">
                        {nombreClienteSeleccionado}
                      </span>
                      <button className="sc-x20"
                        onClick={() => { setFilterCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); }}
                        title="Cambiar cliente"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <input className="sc-x21"
                      type="text"
                      placeholder="Buscar cliente por nombre o RFC..."
                      value={textoBuscarCliente}
                      onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
                      onFocus={() => setMostrarSugerenciasCliente(true)}
                      onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
                    />
                  )}

                  {!filterCliente && mostrarSugerenciasCliente && (
                    <div className="sc-x22">
                      {clientesFiltradosBuscador.length === 0 ? (
                        <div className="sc-x23">
                          {textoBuscarCliente.trim() ? 'Sin coincidencias' : 'No hay clientes (tipo Cliente-Paga) cargados'}
                        </div>
                      ) : (
                        <>
                          <div className="sc-x24">
                            {clientesFiltradosBuscador.length} {clientesFiltradosBuscador.length === 1 ? 'cliente' : 'clientes'}{textoBuscarCliente.trim() ? '' : ' (primeros 30)'}
                          </div>
                          {clientesFiltradosBuscador.map((cli: any) => (
                            <div className="sc-x25"
                              key={cli.id}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setFilterCliente(cli.id); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <div className="sc-x26">{cli.nombre || cli.id}</div>
                              {cli.rfc && <div className="sc-x27">{cli.rfc}</div>}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Remolque (buscador con autocompletado) */}
                <div className="sc-x17">
                  <label className="sc-x15"># REMOLQUE (requiere rango de fechas)</label>

                  {filterRemolque ? (
                    <div className="sc-x18">
                      <span className="sc-x19">
                        {nombreRemolqueSeleccionado}
                      </span>
                      <button className="sc-x20"
                        onClick={() => { setFilterRemolque(''); setTextoBuscarRemolque(''); setMostrarSugerenciasRemolque(false); }}
                        title="Cambiar remolque"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder={rangoFechasListo ? 'Buscar remolque por nombre o placa...' : 'Coloca un rango de fechas primero'}
                      value={textoBuscarRemolque}
                      onChange={(e) => { setTextoBuscarRemolque(e.target.value); setMostrarSugerenciasRemolque(true); }}
                      onFocus={() => setMostrarSugerenciasRemolque(true)}
                      onBlur={() => setTimeout(() => setMostrarSugerenciasRemolque(false), 180)}
                      disabled={!rangoFechasListo}
                      title={rangoFechasListo ? 'Busca en los números de remolque ya guardados dentro del rango de fechas' : 'Este filtro solo funciona con un rango de fechas (inicio y fin)'}
                      style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box', opacity: rangoFechasListo ? 1 : 0.45, cursor: rangoFechasListo ? 'text' : 'not-allowed' }}
                    />
                  )}

                  {!rangoFechasListo && !filterRemolque && (
                    <div className="sc-x16">⚠️ Requiere Fecha Inicio y Fecha Fin.</div>
                  )}

                  {rangoFechasListo && !filterRemolque && mostrarSugerenciasRemolque && (
                    <div className="sc-x22">
                      {remolquesFiltradosBuscador.length === 0 ? (
                        <div className="sc-x23">
                          {textoBuscarRemolque.trim() ? 'Sin coincidencias' : 'No hay remolques cargados'}
                        </div>
                      ) : (
                        <>
                          <div className="sc-x24">
                            {remolquesFiltradosBuscador.length} {remolquesFiltradosBuscador.length === 1 ? 'remolque' : 'remolques'}{textoBuscarRemolque.trim() ? '' : ' (primeros 30)'}
                          </div>
                          {remolquesFiltradosBuscador.map((rem: any) => (
                            <div className="sc-x25"
                              key={rem.id}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setFilterRemolque(rem.id); setTextoBuscarRemolque(''); setMostrarSugerenciasRemolque(false); }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <div className="sc-x26">{etiquetaRemolque(rem) || rem.id}</div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Filtro general (opcional) */}
                <div className="sc-x12">
                  <label className="sc-x15">FILTRO GENERAL (opcional)</label>
                  <input className="sc-x21" type="text" placeholder="Buscar por Ref..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                </div>
              </div>

              <div className="sc-x28">
                <button className="sc-x29"
                  onClick={limpiarFiltrosPanel}
                >
                  Limpiar
                </button>
                <button
                  onClick={ejecutarBusqueda}
                  disabled={cargandoOperaciones}
                  title={(!filterFechaInicio || !filterFechaFin) ? 'Selecciona Fecha Inicio y Fecha Fin para buscar' : 'Buscar con los filtros seleccionados'}
                  style={{ flex: 2, padding: '11px', backgroundColor: (!filterFechaInicio || !filterFechaFin) ? '#21262d' : '#ef4444', color: (!filterFechaInicio || !filterFechaFin) ? '#8b949e' : '#f0f6fc', border: '1px solid ' + ((!filterFechaInicio || !filterFechaFin) ? '#30363d' : '#ef4444'), borderRadius: '6px', cursor: cargandoOperaciones ? 'wait' : 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  Buscar
                </button>
              </div>
            </aside>
          </>
        )}

        {/* ✅ NUEVO: modal para ELEGIR Y ORDENAR las columnas del Excel.
            Arrastrando ⋮⋮ (o con las flechas) se cambia el orden; el checkbox
            incluye/excluye la columna. Por defecto usa las columnas de la tabla. */}
        {modalExportar && (
          <>
            <div className="sc-x30" onClick={() => setModalExportar(false)} />
            <div className="sc-x31">
              <div className="sc-x7">
                <div className="sc-x8">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span className="sc-x9">Exportar a Excel</span>
                  <span className="sc-x32">({columnasExport.filter(c => c.visible).length} columnas)</span>
                </div>
                <button className="sc-x10" onClick={() => setModalExportar(false)} title="Cerrar">✕</button>
              </div>

              <div className="sc-x33">
                Arrastra <span className="sc-x34">⋮⋮</span> o usa las flechas para cambiar el orden. Marca las columnas que quieres incluir.
              </div>

              <div className="sc-x35">
                {columnasExport.map((c, idx) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => { dragExportIdx.current = idx; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => soltarColumnaExport(idx)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', marginBottom: '4px', backgroundColor: c.visible ? '#0d1117' : 'rgba(13, 17, 23, 0.5)', border: '1px solid #21262d', borderRadius: '6px', cursor: 'grab', opacity: c.visible ? 1 : 0.55 }}
                  >
                    <span className="sc-x36" title="Arrastrar para reordenar">⋮⋮</span>
                    <input className="sc-x37"
                      type="checkbox"
                      checked={c.visible}
                      onChange={() => setColumnasExport(prev => prev.map((x, i) => (i === idx ? { ...x, visible: !x.visible } : x)))}
                    />
                    <span style={{ flex: 1, color: c.visible ? '#c9d1d9' : '#8b949e', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                    <button onClick={() => moverColumnaExport(idx, -1)} disabled={idx === 0} title="Subir" style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '4px', color: idx === 0 ? '#30363d' : '#8b949e', cursor: idx === 0 ? 'default' : 'pointer', padding: '2px 7px', fontSize: '0.7rem' }}>▲</button>
                    <button onClick={() => moverColumnaExport(idx, 1)} disabled={idx === columnasExport.length - 1} title="Bajar" style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '4px', color: idx === columnasExport.length - 1 ? '#30363d' : '#8b949e', cursor: idx === columnasExport.length - 1 ? 'default' : 'pointer', padding: '2px 7px', fontSize: '0.7rem' }}>▼</button>
                  </div>
                ))}
              </div>

              <div className="sc-x38">
                <button className="sc-x39"
                  onClick={() => setColumnasExport(columnasExportPorDefecto())}
                  title="Restablecer con las columnas visibles de la tabla, en su orden actual"
                >
                  Columnas de la tabla
                </button>
                <div className="sc-x40" />
                <button className="sc-x41" onClick={() => setModalExportar(false)}>Cancelar</button>
                <button className="sc-x42"
                  onClick={exportarExcel}
                >
                  Exportar
                </button>
              </div>
            </div>
          </>
        )}

        {/* Barra de filtros. Todos los filtros son OPCIONALES y se aplican en memoria. */}
        {/* ✅ NUEVO: barra compacta — los filtros viven en un panel lateral
            izquierdo; aquí solo queda el botón Filtros y el resumen de la
            última búsqueda. */}
        <div className="sc-x43">
          <button
            onClick={() => setDrawerFiltrosAbierto(v => !v)}
            title={drawerFiltrosAbierto ? 'Ocultar el panel de filtros' : 'Mostrar el panel de filtros'}
            style={{ padding: '9px 16px', backgroundColor: drawerFiltrosAbierto ? '#ef4444' : 'transparent', color: drawerFiltrosAbierto ? '#f0f6fc' : '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, fontSize: '0.85rem' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            Filtros
            {contadorFiltrosActivos > 0 && (
              <span className="sc-x44">{contadorFiltrosActivos}</span>
            )}
          </button>

          {filtrosAplicados ? (
            <div className="sc-x45">
              {resumenFiltrosChips.map((chip, i) => (
                <span className="sc-x46" key={`chip_${i}`}>{chip}</span>
              ))}
            </div>
          ) : (
            <span className="sc-x47">Presiona Filtros para definir el rango de fechas y buscar.</span>
          )}

          <button className="btn btn-outline sc-x48" onClick={abrirModalExportar} title="Exportar a Excel (elegir y ordenar columnas)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </div>

        <div className="content-body sc-x49">
          {!filtrosAplicados ? (
            <div className="sc-x50">
              <div className="sc-x51">Realiza una búsqueda</div>
              <div className="sc-x52">Define <span className="sc-x53">Fecha Inicio</span> y <span className="sc-x53">Fecha Fin</span> y presiona <span className="sc-x54">Buscar</span> para ver las operaciones canceladas.</div>
            </div>
          ) : cargandoOperaciones ? (
            <div className="sc-x55">Cargando operaciones canceladas...</div>
          ) : errorCarga ? (
            <div className="sc-x56">
              <div className="sc-x57">No se pudieron cargar las operaciones</div>
              <div className="sc-x58">{errorCarga}</div>
              <button className="sc-x59" onClick={() => descargarOperaciones({ forzar: true })}>Reintentar</button>
            </div>
          ) : operacionesFiltradas.length === 0 ? (
            <div className="sc-x50">
              <div className="sc-x51">Sin resultados</div>
              <div className="sc-x52">
                {operacionesGlobales.length === 0
                  ? 'No hay operaciones canceladas registradas.'
                  : 'No hay operaciones canceladas que coincidan con los filtros seleccionados.'}
              </div>
            </div>
          ) : (
            <>
              <div className="table-container sc-x60">
                <table className="data-table sc-x61">
                  <thead className="sc-x62">
                    <tr>
                      <th className="sc-x63">Acciones</th>
                      {/* ✅ NUEVO: encabezados clicables para ordenar (asc ▲ / desc ▼ / original) */}
                      {COLUMNAS_TABLA_CANCELADOS.map(col => (
                        <th
                          key={`th_${col.id}`}
                          onClick={() => manejarOrdenColumna(col.id)}
                          title={ordenColumna === col.id ? (ordenDireccion === 'asc' ? 'Clic: ordenar descendente' : 'Clic: quitar ordenamiento') : 'Clic: ordenar ascendente'}
                          style={{ padding: '16px', color: ordenColumna === col.id ? '#f0f6fc' : '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d', cursor: 'pointer', userSelect: 'none' }}
                        >
                          {col.label}
                          {ordenColumna === col.id && (
                            <span className="sc-x64">
                              {ordenDireccion === 'asc' ? '▲' : '▼'}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {operacionesEnPantalla.length === 0 ? (<tr><td className="sc-x65" colSpan={11}>Sin resultados para tu búsqueda.</td></tr>) : (
                      operacionesEnPantalla.map((op: any) => (
                        <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                          <td className="sc-x66" onClick={(e: any) => e.stopPropagation()}>
                            <div className="actions-cell sc-x67">
                              <button className="sc-x68"
                                type="button"
                                title="Ver Detalles"
                                onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setPestañaDetalleActiva('general'); }}
                                onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                                onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                              </button>
                              <button className="sc-x69"
                                type="button"
                                title="Editar Operación"
                                onClick={(e) => { e.stopPropagation(); abrirEdicion(op); }}
                                onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(88, 166, 255, 0.1)'}
                                onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                              </button>
                              <button className="sc-x70"
                                type="button"
                                title="Ver Documentos"
                                onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setMostrarDocumentos(true); }}
                                onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.1)'}
                                onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: '16px', color: colorTipoOperacion(mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)), fontWeight: 'bold', fontFamily: 'monospace' }}>{op.ref || op.id?.substring(0, 6)}</td>
                          <td className="sc-x71">{op.fechaServicio}</td>
                          <td style={{ padding: '16px', color: colorTipoOperacion(mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)), fontWeight: 'bold' }}>{mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)}</td>
                          <td className="sc-x72">{mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre)}</td>
                          <td className="sc-x71">{obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}</td>
                          <td className="sc-x71">{mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre)}</td>
                          <td className="sc-x71">{mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre)}</td>
                          <td className="sc-x71">{mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre)}</td>
                          <td className="sc-x73">{mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente)}</td>
                          <td className="sc-x71">{formatoMoneda(op.subtotalCliente)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {operacionesOrdenadas.length > 0 && (
                <div className="sc-x74">
                  <div className="sc-x52">Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesOrdenadas.length)} de {operacionesOrdenadas.length} operaciones canceladas</div>
                  <div className="sc-x75">
                    <button
                      title="Página Anterior"
                      onClick={irPaginaAnterior}
                      disabled={paginaActual === 1}
                      style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <span className="sc-x76">{paginaActual} / {totalPaginas || 1}</span>
                    <button
                      title="Página Siguiente"
                      onClick={irPaginaSiguiente}
                      disabled={paginaActual === totalPaginas || totalPaginas === 0}
                      style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {operacionViendo && (
        <div className="modal-overlay sc-x77">
          <div className="form-card detail-card sc-x78">
            <div className="form-header sc-x79">
              <h2 className="sc-x80">
                <span>Detalle de Servicio Cancelado</span>
                <span className="sc-x53">{operacionViendo.ref || operacionViendo.id?.substring(0, 6)}</span>
                <span className="sc-x81">
                  {mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}
                </span>
              </h2>
              <div className="sc-x82">

                {evalIsFletes && (
                  <>
                    <button className="sc-x83" onClick={handleDescargarCartaInstrucciones} title="Descargar Carta de Instrucciones">
                      Carta Instrucciones
                    </button>
                    <button className="sc-x83" onClick={handleDescargarPruebaEntrega} title="Descargar Prueba de Entrega">
                      Prueba Entrega
                    </button>
                  </>
                )}

                <button className="sc-x83" onClick={handleDescargarCheckList} title="Descargar Check List">
                  Check List
                </button>
                <button className="sc-x83" onClick={handleDescargarSolicitudRetiro} title="Descargar Solicitud de Retiro">
                  Solicitud
                </button>
                <button className="sc-x83" onClick={handleDescargarInstruccionesServicio} title="Descargar Instrucciones de Servicio">
                  Instrucciones
                </button>

                <button className="sc-x84" onClick={() => abrirEdicion(operacionViendo)} title="Editar Operación">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  Editar
                </button>
                <button className="sc-x85" onClick={() => setMostrarDocumentos(true)} title="Ver / Subir Documentos">Documentos</button>
                <button className="sc-x83" onClick={verHistorial}>Bitácora</button>
                <button onClick={() => setOperacionViendo(null)} className="btn-window close sc-x86">✕</button>
              </div>
            </div>
            {/* ✅ NUEVO: SIGUIENTE PASO — editar status/horario igual que Operaciones Activas */}
            <div className="sc-x87">
              <span className="sc-x88">SIGUIENTE PASO</span>
              {botonesDisponibles.length > 0 ? (
                <>
                  {botonesDisponibles.map((botonStr: string) => {
                    const esExitoso = ultimoStatusGuardado === botonStr;
                    return (
                      <button key={botonStr} onClick={() => registrarStatusRapido(botonStr)} disabled={guardandoStatusRapido !== null} className="status-pill"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '6px 18px 6px 6px', borderRadius: '999px', border: 'none',
                          background: esExitoso ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
                          color: '#fff', cursor: guardandoStatusRapido && !esExitoso ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.9rem',
                          boxShadow: esExitoso ? '0 4px 14px rgba(16, 185, 129, 0.4)' : '0 4px 14px rgba(234, 88, 12, 0.35)',
                          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                          opacity: guardandoStatusRapido && !esExitoso && guardandoStatusRapido !== botonStr ? 0.4 : 1, position: 'relative', overflow: 'hidden'
                        }}
                        title={`Marcar como: ${botonStr}`}>
                        <span className="sc-x89">
                          {esExitoso ? (
                            <svg className="sc-x90" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                          )}
                        </span>
                        <span className="sc-x91">{botonStr}</span>
                      </button>
                    );
                  })}
                  <button onClick={abrirRegistroHorario} className="status-circle-btn sc-x92"
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
                  <span className="sc-x93">
                    No hay transiciones automáticas configuradas.
                  </span>
                  <button onClick={abrirRegistroHorario} className="status-pill sc-x94"
                    title="Registrar status manualmente">
                    <span className="sc-x95">
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
            <div className="sc-x96">
              {tabsDetalle.map(tab => (<button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)} style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer' }}>{tab.label}</button>))}
            </div>
            <div className="detail-content sc-x97">
              {pestañaDetalleActiva === 'general' && (
                <div className="sc-x98"><div><span className="sc-x99">Tipo</span><span>{mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', operacionViendo.tipoOperacionNombre)}</span></div>
                  <div><span className="sc-x99">Fecha / Status</span><span>{mostrarDato(operacionViendo.fechaServicio)} | <span className="sc-x53">{mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}</span></span></div>
                  {evalIsFletes && (<div><span className="sc-x99">Fecha de Cita</span><span>{formatearFechaHora(operacionViendo.fechaCita)}</span></div>)}
                  <div className="sc-x100"><hr className="sc-x101" /></div>
                  <div><span className="sc-x102">Cliente (Paga)</span><span>{mostrarDatoMapeado(operacionViendo.clientePaga || operacionViendo.clienteId, 'empresas', 'nombre', operacionViendo.clienteNombre || operacionViendo.nombreCliente)}</span></div>
                  <div><span className="sc-x102">Convenio (Tarifa)</span><span>{obtenerNombreConvenioCliente(operacionViendo.convenio, operacionViendo.convenioNombre)}</span></div>
                  <div><span className="sc-x102"># de Remolque</span><span>{mostrarDatoMapeado(operacionViendo.numeroRemolque, 'remolques', 'nombre', operacionViendo.remolqueNombre)}</span></div>
                  <div><span className="sc-x102">Ref Cliente</span><span>{mostrarDato(operacionViendo.refCliente)}</span></div>
                  <div><span className="sc-x103">Origen</span><span>{mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre)}</span></div>
                  <div><span className="sc-x103">Destino</span><span>{mostrarDatoMapeado(operacionViendo.destino, 'empresas', 'nombre', operacionViendo.destinoNombre)}</span></div>
                  <div className="sc-x104"><span className="sc-x102">Observaciones Ejecutivo</span><div className="sc-x105">{mostrarDato(operacionViendo.observacionesEjecutivo)}</div></div>
                </div>
              )}
              {pestañaDetalleActiva === 'pedimento' && (
                <div className="sc-x98">
                  <div className="sc-x106"><span className="sc-x102">Cliente (Mercancía)</span><span>{operacionViendo.clienteMercanciaNombre || operacionViendo.clienteMercancia || '-'}</span></div>
                  <div><span className="sc-x102">Descripción de la Mercancía</span><span>{mostrarDato(operacionViendo.descripcionMercancia)}</span></div>
                  <div className="sc-x100"><hr className="sc-x101" /></div>
                  <div><span className="sc-x102">Cantidad</span><span>{mostrarDato(operacionViendo.cantidad)}</span></div>
                  <div><span className="sc-x102">Embalaje</span><span>{operacionViendo.embalajeNombre || operacionViendo.embalaje || '-'}</span></div>
                  <div><span className="sc-x102">Peso (Kg)</span><span>{mostrarDato(operacionViendo.pesoKg)}</span></div>
                  <div className="sc-x100"><hr className="sc-x101" /></div>
                  <div><span className="sc-x102"># DODA</span><span>{mostrarDato(operacionViendo.numDoda)}</span></div>
                  <div><span className="sc-x102">Fecha DODA</span><span>{mostrarDato(operacionViendo.fechaEmisionDoda)}</span></div>
                </div>
              )}
              {pestañaDetalleActiva === 'manifiestos' && (
                <div className="sc-x98">
                  <div><span className="sc-x102"># de Entry's</span><span>{mostrarDato(operacionViendo.numeroEntrys)}</span></div>
                  <div><span className="sc-x102">Cant. Entry's</span><span>{mostrarDato(operacionViendo.cantEntrys)}</span></div>
                  <div className="sc-x100"><hr className="sc-x101" /></div>
                  <div><span className="sc-x102"># Manifiesto</span><span>{mostrarDato(operacionViendo.numManifiesto)}</span></div>
                  <div><span className="sc-x102">Prov. Servicios</span><span>{operacionViendo.provServiciosNombre || operacionViendo.provServicios || '-'}</span></div>
                  <div><span className="sc-x102">Costo Manifiesto</span><span>{formatoMoneda(operacionViendo.montoManifiesto)}</span></div>
                </div>
              )}
              {pestañaDetalleActiva === 'unidad' && (
                <div className="sc-x98">
                  <div className="sc-x100"><span className="sc-x102">Prov. Transporte</span><span className="sc-x107">{mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas', 'nombre', operacionViendo.proveedorUnidadNombre)}</span></div>
                  <div className="sc-x108">
                    <div className="sc-x109">
                      <div><span className="sc-x102">Facturado En:</span><span>{mostrarMoneda(operacionViendo.facturadoEnUnidad)}</span></div>
                      <div><span className="sc-x102">Convenio Proveedor</span><span>{obtenerNombreConvenioProv(operacionViendo.convenioProveedor, operacionViendo.convenioProveedorNombre)}</span></div>
                      <div><span className="sc-x102">Moneda Base</span><span>{mostrarMoneda(operacionViendo.monedaConvenioProv)}</span></div>
                    </div>
                    <div className="sc-x110">
                      <div><span className="sc-x102">Monto (Base)</span><span>{formatoMoneda(operacionViendo.totalAPagarProv)}</span></div>
                      <div><span className="sc-x102">Costos Adicionales</span><span>{formatoMoneda(operacionViendo.cargosAdicionalesProv)}</span></div>
                      <div><span className="sc-x99">Subtotal</span><span className="sc-x111">{formatoMoneda(operacionViendo.subtotalProv)}</span></div>
                    </div>
                    <div className="sc-x110">
                      <div><span className="sc-x102">Dólares</span><span className="sc-x112">{formatoMoneda(operacionViendo.dolaresProv)}</span></div>
                      <div><span className="sc-x102">Pesos</span><span className="sc-x112">{formatoMoneda(operacionViendo.pesosProv)}</span></div>
                      <div><span className="sc-x113">Conversión Final</span><span className="sc-x114">{formatoMoneda(operacionViendo.conversionProv)}</span></div>
                    </div>
                  </div>
                  {showDetailInternalFleet && (
                    <div className="sc-x115">
                      <div className="sc-x100"><h4 className="sc-x116">Flota Operativa (Roelca)</h4></div>
                      <div><span className="sc-x102">Unidad Asignada</span><span>{mostrarDatoMapeado(operacionViendo.unidad, 'unidades', 'unidad', operacionViendo.unidadNombre)}</span></div>
                      <div className="sc-x106"><span className="sc-x102">Operador Asignado</span><span>{mostrarDatoMapeado(operacionViendo.operador, 'empleados', 'nombre', operacionViendo.operadorNombre)}</span></div>
                      <div className="sc-x100"><hr className="sc-x117" /></div>
                      <div><span className="sc-x102">Sueldo Operador</span><span>{formatoMoneda(operacionViendo.sueldoOperador)}</span></div>
                      <div><span className="sc-x102">Sueldo Extra</span><span>{formatoMoneda(operacionViendo.sueldoExtra)}</span></div>
                      <div><span className="sc-x99">Sueldo Total</span><span className="sc-x118">{formatoMoneda(operacionViendo.sueldoTotal)}</span></div>
                      <div className="sc-x100"><hr className="sc-x117" /></div>
                      <div><span className="sc-x102">Combustible</span><span>{formatoMoneda(operacionViendo.combustible)}</span></div>
                      <div><span className="sc-x102">Combustible Extra</span><span>{formatoMoneda(operacionViendo.combustibleExtra)}</span></div>
                      <div><span className="sc-x99">Total Combustible</span><span className="sc-x111">{formatoMoneda(operacionViendo.combustibleTotal)}</span></div>
                    </div>
                  )}
                  {showDetailExternalFleet && (
                    <div className="sc-x115">
                      <div className="sc-x100"><h4 className="sc-x119">Flota Externa (Proveedor)</h4></div>
                      <div><span className="sc-x103">Unidad Externa</span><span>{mostrarDato(operacionViendo.unidadProveedor)}</span></div>
                      <div className="sc-x106"><span className="sc-x103">Operador Externo</span><span>{mostrarDato(operacionViendo.operadorProveedor)}</span></div>
                    </div>
                  )}
                  {/* ✅ Observaciones ARRIBA del bloque de gastos (a petición) */}
                  <div className="sc-x120">
                    <span className="sc-x102">Observaciones (Unidad / Proveedor)</span>
                    <div className="sc-x121">{mostrarDato(operacionViendo.observacionesUnidad)}</div>
                  </div>
                  <div className="sc-x122">
                    <div className="sc-x123">Total Gastos [Sueldos + Manifiesto]</div>
                    <div className="sc-x124">{formatoMoneda(operacionViendo.totalGastos)}</div>
                  </div>
                </div>
              )}
              {pestañaDetalleActiva === 'cobrar' && (
                <div className="sc-x98">
                  <div><span className="sc-x102">Facturado En:</span><span>{mostrarMoneda(operacionViendo.facturadoEnCobrar)}</span></div>
                  <div><span className="sc-x102">Moneda Convenio</span><span>{mostrarMoneda(operacionViendo.monedaConvenioCliente)}</span></div>
                  <div><span className="sc-x102">Convenio (Base)</span><span>{formatoMoneda(operacionViendo.montoConvenioCliente)}</span></div>
                  <div><span className="sc-x102">Cargos Adicionales</span><span>{formatoMoneda(operacionViendo.cargosAdicionales)}</span></div>
                  <div><span className="sc-x99">Subtotal</span><span className="sc-x125">{formatoMoneda(operacionViendo.subtotalCliente)}</span></div>
                  <div><span className="sc-x102">Tipo de Cambio del Día</span><span>{mostrarDato(operacionViendo.tipoCambioAprobado)}</span></div>
                  <div className="sc-x100"><hr className="sc-x101" /></div>
                  <div><span className="sc-x102">Dólares (Cliente)</span><span className="sc-x126">{formatoMoneda(operacionViendo.dolaresCliente)}</span></div>
                  <div><span className="sc-x102">Pesos (Cliente)</span><span className="sc-x112">{formatoMoneda(operacionViendo.pesosCliente)}</span></div>
                  <div><span className="sc-x99">Conversión Final</span><span className="sc-x127">{formatoMoneda(operacionViendo.conversionCliente)}</span></div>
                  <div className="sc-x128">
                    <span className="sc-x129">Utilidad Estimada de la Operación</span>
                    <span className="sc-x130">{formatoMoneda(operacionViendo.utilidadEstimada)}</span>
                  </div>
                  <div className="sc-x120">
                    <span className="sc-x102">Observaciones (Cobro)</span>
                    <div className="sc-x131">{mostrarDato(operacionViendo.observacionesCobrar)}</div>
                  </div>
                </div>
              )}

              {/* ✅ Auditoría de la referencia: botón que abre el detalle en un modal */}
              <div className="sc-x132">
                <button className="sc-x133" onClick={() => { setMostrarAuditoria(true); cargarNombresAuditoria(); }} title="Ver quién creó la referencia, cuándo, y el detalle de cada edición">
                  🕓 Ver auditoría
                  <span className="sc-x134">{(operacionViendo.historialEdiciones || []).length}</span>
                </button>
              </div>

              {/* ✅ Modal de auditoría (solo lectura) */}
              {mostrarAuditoria && (
                <div className="sc-x135" onClick={() => setMostrarAuditoria(false)}>
                  <div className="sc-x136" onClick={(e) => e.stopPropagation()}>
                    <div className="sc-x137">
                      <h3 className="sc-x138">🕓 Auditoría de la referencia <span className="sc-x139">{operacionViendo.ref || ''}</span></h3>
                      <button className="sc-x140" onClick={() => setMostrarAuditoria(false)}>✕</button>
                    </div>
                    <div className="sc-x141">
                      <div className="sc-x142">
                        <span className="sc-x143">Creación</span>
                        <span className="sc-x144">
                          Creada por <b className="sc-x145">{nombreAuditor(operacionViendo.creadoPor, 'Sin registro')}</b>
                          {operacionViendo.creadoEn ? <> el <b className="sc-x34">{fmtFechaAuditoria(operacionViendo.creadoEn)}</b></> : null}
                        </span>
                      </div>
                      <div className="sc-x8">
                        <span className="sc-x146">EDICIONES REGISTRADAS:</span>
                        <span className="sc-x147">{(operacionViendo.historialEdiciones || []).length}</span>
                      </div>
                      {(operacionViendo.historialEdiciones || []).slice().reverse().map((h: any, i: number) => (
                        <details className="sc-x148" key={i} open={i === 0}>
                          <summary className="sc-x149">
                            <b className="sc-x34">{nombreAuditor(h.usuario)}</b> · {fmtFechaAuditoria(h.fecha)} · <b className="sc-x150">{(h.cambios || []).length}</b> {(h.cambios || []).length === 1 ? 'cambio' : 'cambios'}
                          </summary>
                          <ul className="sc-x151">
                            {(h.cambios || []).map((c: any, j: number) => (<li key={j}>{String(c)}</li>))}
                          </ul>
                        </details>
                      ))}
                      {(operacionViendo.historialEdiciones || []).length === 0 && (
                        <span className="sc-x152">Sin ediciones desde su creación.</span>
                      )}
                    </div>
                    <div className="sc-x153">
                      <button className="sc-x154" onClick={() => setMostrarAuditoria(false)}>Cerrar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="form-actions sc-x155">
              <button onClick={() => setOperacionViendo(null)} className="btn btn-outline">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Visor de documentos de la operación cancelada */}
      {mostrarDocumentos && operacionViendo && (
        <div className="modal-overlay sc-x156">
          <div className="form-card sc-x157">
            <div className="form-header sc-x158">
              <div>
                <h2 className="sc-x159">Documentos de la Operación</h2>
                <p className="sc-x160">
                  Referencia: <span className="sc-x161">{refOperacionViendo}</span>
                </p>
              </div>
              <div className="sc-x162">
                <button className="sc-x163"
                  type="button"
                  onClick={() => setMostrarSubirDocOp(true)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Subir Documento
                </button>
                <button className="sc-x164" onClick={() => setMostrarDocumentos(false)} title="Cerrar">✕</button>
              </div>
            </div>
            <div className="sc-x165">
              <DocumentosLista coleccionOrigen="operaciones" registroId={operacionViendo.id} />
            </div>
            <div className="sc-x166">
              <button onClick={() => setMostrarDocumentos(false)} className="btn btn-outline sc-x167">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Subida de documentos ligada a la operación */}
      {operacionViendo && (
        <DocumentoUploadModal
          isOpen={mostrarSubirDocOp && !!operacionViendo}
          onClose={() => setMostrarSubirDocOp(false)}
          coleccionOrigen="operaciones"
          registroId={operacionViendo.id}
          registroNombre={refOperacionViendo}
          tiposDocumento={TIPOS_DOCUMENTO_OPERACION}
        />
      )}

      {/* ✅ Registro retroactivo de movimiento (fecha/hora personalizada) */}
      {modalHorarios === 'registrar' && (
        <div className="modal-overlay sc-x168">
          <div className="form-card sc-x169">
            <div className="form-header sc-x170">
              <h2 className="sc-x171">Registrar Movimiento (Fecha Personalizada)</h2>
              <button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button>
            </div>
            <div className="sc-x172">
              <p className="sc-x173">
                Usa este formulario solo si necesitas registrar un movimiento con una fecha y hora distinta a la actual.
              </p>
              <div className="form-group">
                <label className="form-label sc-x174">Fecha y Hora</label>
                <input type="datetime-local" className="form-control" value={nuevaFechaHora} onChange={e => setNuevaFechaHora(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label sc-x174">Estatus / Hito</label>
                <select className="form-control" value={nuevoStatus} onChange={e => setNuevoStatus(e.target.value)}>
                  <option value="">-- Selecciona un status --</option>
                  {botonesDisponibles.length > 0 ? (
                    botonesDisponibles.map((botonStr: string) => (
                      <option key={botonStr} value={botonStr}>{botonStr}</option>
                    ))
                  ) : (
                    (catalogosGlobales.statusServicio || [])
                      .filter((s: any) => s.nombre)
                      .map((s: any) => (
                        <option key={s.id} value={s.nombre}>{s.nombre}</option>
                      ))
                  )}
                </select>
              </div>
              <button onClick={guardarHorario} disabled={cargandoHorarios} className="btn btn-primary sc-x175">
                {cargandoHorarios ? 'Actualizando...' : 'Guardar y Actualizar Operación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalHorarios === 'historial' && (
        <div className="modal-overlay sc-x168">
          <div className="form-card sc-x176">
            <div className="form-header"><h2>Bitácora de Movimientos</h2><button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button></div>
            <div className="sc-x177">
              {cargandoHorarios ? (<div>Descargando...</div>) : (
                <table className="sc-x178">
                  <thead><tr className="sc-x174"><th className="sc-x179">Fecha y Hora</th><th className="sc-x179">Estatus</th></tr></thead>
                  <tbody>{historialList.map((h: any) => (<tr className="sc-x180" key={h.id}><td className="sc-x181">{new Date(h.fechaHora).toLocaleString('es-MX')}</td><td className="sc-x182">{mostrarDatoMapeado(h.status, 'statusServicio', 'nombre', h.statusNombre)}</td></tr>))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes pop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .status-pill { transform: translateY(0); }
        .status-pill:not(:disabled):hover {
          transform: translateY(-2px);
          filter: brightness(1.08);
          box-shadow: 0 8px 20px rgba(234, 88, 12, 0.5) !important;
        }
        .status-pill:not(:disabled):active { transform: translateY(0); filter: brightness(0.95); }
        .status-circle-btn:hover {
          background: #30363d !important;
          color: #ea580c !important;
          border-color: #ea580c !important;
          transform: scale(1.08);
        }
      `}</style>
    </div>
  );
};
export default ServiciosCancelados;
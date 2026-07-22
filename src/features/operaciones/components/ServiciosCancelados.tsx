// src/features/operaciones/components/ServiciosCancelados.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, getDocs, orderBy, limit, where, doc, writeBatch, startAfter } from 'firebase/firestore';
import { db, auth } from '../../../config/firebase'; 
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
const describirFiltrosLog = (f: { fechaInicio: string; fechaFin: string; cliente?: string; clienteNombre?: string; remolque?: string; remolqueNombre?: string; busqueda?: string }): string => {
  const partes: string[] = [`Fechas: ${f.fechaInicio} a ${f.fechaFin}`];
  if (f.cliente) partes.push(`Cliente: ${f.clienteNombre || f.cliente}`);
  if (f.remolque) partes.push(`Remolque: ${f.remolqueNombre || f.remolque}`);
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
  const descargarOperaciones = async () => {
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
    const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v2');
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

    const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v2');
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
    
    sessionStorage.setItem('roelca_catalogos_v2', JSON.stringify(catGuardados));
    setCatalogosGlobales(catGuardados);
  };

  // ✅ NUEVO: re-sincroniza los catálogos EN MEMORIA con lo más fresco disponible.
  //   FormularioOperacion actualiza la caché de sesión (roelca_catalogos_v2) y las
  //   cachés locales cat_v2__ al crear clientes/proveedores/bodegas; sin este paso
  //   los registros nuevos no aparecían en la tabla ni en los documentos PDF hasta
  //   recargar la página.
  const resincronizarCatalogosDesdeCache = () => {
    try {
      const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v2');
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
    registrarLog('Servicios Cancelados', 'Búsqueda', `Buscó operaciones canceladas con filtros → ${describirFiltrosLog(snapshot)}`).catch(() => {});
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
      setBusqueda(f.busqueda || '');
      setFiltrosAplicados({
        fechaInicio: f.fechaInicio,
        fechaFin: f.fechaFin,
        cliente: f.cliente || '',
        clienteNombre: f.clienteNombre || '',
        remolque: f.remolque || '',
        remolqueNombre: f.remolqueNombre || '',
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
  const contadorFiltrosActivos = [filterFechaInicio || filterFechaFin, filterCliente, filterRemolque, busqueda.trim()].filter(Boolean).length;

  // ✅ NUEVO: chips con el resumen del último criterio buscado.
  const resumenFiltrosChips = useMemo(() => {
    if (!filtrosAplicados) return [] as string[];
    const chips: string[] = [`📅 ${filtrosAplicados.fechaInicio} → ${filtrosAplicados.fechaFin}`];
    if (filtrosAplicados.cliente) chips.push(`Cliente: ${filtrosAplicados.clienteNombre || filtrosAplicados.cliente}`);
    if (filtrosAplicados.remolque) chips.push(`Remolque: ${filtrosAplicados.remolqueNombre || filtrosAplicados.remolque}`);
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
      registrarLog('Servicios Cancelados', 'Edición', `Cambió el status de la operación ${refLogH}: "${statusAnteriorH}" → "${statusNombreResuelto}" (horario del evento: ${nuevaFechaHora})`).catch(() => {});

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
        .catch(() => {});

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
      registrarLog('Servicios Cancelados', 'Edición', `Cambió el status de la operación ${refLogR}: "${statusAnteriorR}" → "${statusFinal.nombre}"${cascadaTxt}`).catch(() => {});

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

    const unidadProvVal = operacionViendo.unidadProveedor? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

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
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    generarInstruccionesServicioPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'N/A',
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
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);
    const uniNombre = operacionViendo.unidadNombre || (unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal);
    const uniPlacas = unidadObj ? (unidadObj.placa || 'N/A') : 'N/A';

    generarCheckListPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
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
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);

    generarPruebaEntregaPDF({
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
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
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);

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
    if (filtrosAplicados) descargarOperaciones();
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
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>

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

     <div style={{ width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '0 0 24px 0' }}>
          <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#ef4444', margin: 0, fontWeight: 'bold' }}>Servicios Cancelados</h1>
        </div>

          {/* ✅ NUEVO: sidebar FLOTANTE de filtros — anclado al lado DERECHO de la
              pantalla, con fondo oscurecido; se abre con el botón Filtros. */}
          {drawerFiltrosAbierto && (
            <>
              <div onClick={() => setDrawerFiltrosAbierto(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(1, 4, 9, 0.65)', zIndex: 1200, animation: 'fadeIn 0.2s ease' }} />
              <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '360px', maxWidth: '92vw', backgroundColor: '#161b22', borderLeft: '1px solid #30363d', zIndex: 1201, display: 'flex', flexDirection: 'column', boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.55)', animation: 'fadeIn 0.2s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                  <span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '0.95rem' }}>Filtros</span>
                </div>
                <button onClick={() => setDrawerFiltrosAbierto(false)} title="Cerrar filtros" style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '4px' }}>✕</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Fecha Inicio (requerida para mostrar registros) */}
          <div style={{ width: '100%' }}>
            <label style={{ display: 'block', color: '#ef4444', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>FECHA INICIO *</label>
            <input type="date" value={filterFechaInicio} onChange={(e) => setFilterFechaInicio(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #ef4444', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
          </div>

          {/* Fecha Fin (requerida para mostrar registros) */}
          <div style={{ width: '100%' }}>
            <label style={{ display: 'block', color: '#ef4444', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>FECHA FIN *</label>
            <input type="date" value={filterFechaFin} min={filterFechaInicio || undefined} onChange={(e) => setFilterFechaFin(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #ef4444', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
          </div>

          {/* Cliente que paga (buscador con autocompletado) */}
          <div style={{ width: '100%', position: 'relative' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>CLIENTE QUE PAGA (opcional)</label>

            {filterCliente ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #ef4444', borderRadius: '6px', minHeight: '20px' }}>
                <span style={{ color: '#ef4444', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {nombreClienteSeleccionado}
                </span>
                <button
                  onClick={() => { setFilterCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); }}
                  title="Cambiar cliente"
                  style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <input
                type="text"
                placeholder="Buscar cliente por nombre o RFC..."
                value={textoBuscarCliente}
                onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
                onFocus={() => setMostrarSugerenciasCliente(true)}
                onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
                style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }}
              />
            )}

            {!filterCliente && mostrarSugerenciasCliente && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', maxHeight: '320px', overflowY: 'auto', zIndex: 100, marginTop: '4px', boxShadow: '0 6px 16px rgba(0,0,0,0.5)' }}>
                {clientesFiltradosBuscador.length === 0 ? (
                  <div style={{ padding: '14px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>
                    {textoBuscarCliente.trim() ? 'Sin coincidencias' : 'No hay clientes (tipo Cliente-Paga) cargados'}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '6px 12px', fontSize: '0.7rem', color: '#8b949e', borderBottom: '1px solid #21262d', backgroundColor: '#161b22' }}>
                      {clientesFiltradosBuscador.length} {clientesFiltradosBuscador.length === 1 ? 'cliente' : 'clientes'}{textoBuscarCliente.trim() ? '' : ' (primeros 30)'}
                    </div>
                    {clientesFiltradosBuscador.map((cli: any) => (
                      <div
                        key={cli.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setFilterCliente(cli.id); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); }}
                        style={{ padding: '10px 12px', cursor: 'pointer', color: '#c9d1d9', fontSize: '0.88rem', borderBottom: '1px solid #21262d', transition: 'background-color 0.15s' }}
                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div style={{ fontWeight: '500' }}>{cli.nombre || cli.id}</div>
                        {cli.rfc && <div style={{ color: '#8b949e', fontSize: '0.75rem', marginTop: '2px' }}>{cli.rfc}</div>}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Remolque (buscador con autocompletado) */}
          <div style={{ width: '100%', position: 'relative' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>REMOLQUE (opcional)</label>

            {filterRemolque ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #ef4444', borderRadius: '6px', minHeight: '20px' }}>
                <span style={{ color: '#ef4444', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {nombreRemolqueSeleccionado}
                </span>
                <button
                  onClick={() => { setFilterRemolque(''); setTextoBuscarRemolque(''); setMostrarSugerenciasRemolque(false); }}
                  title="Cambiar remolque"
                  style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <input
                type="text"
                placeholder="Buscar remolque por nombre o placa..."
                value={textoBuscarRemolque}
                onChange={(e) => { setTextoBuscarRemolque(e.target.value); setMostrarSugerenciasRemolque(true); }}
                onFocus={() => setMostrarSugerenciasRemolque(true)}
                onBlur={() => setTimeout(() => setMostrarSugerenciasRemolque(false), 180)}
                style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }}
              />
            )}

            {!filterRemolque && mostrarSugerenciasRemolque && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', maxHeight: '320px', overflowY: 'auto', zIndex: 100, marginTop: '4px', boxShadow: '0 6px 16px rgba(0,0,0,0.5)' }}>
                {remolquesFiltradosBuscador.length === 0 ? (
                  <div style={{ padding: '14px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>
                    {textoBuscarRemolque.trim() ? 'Sin coincidencias' : 'No hay remolques cargados'}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '6px 12px', fontSize: '0.7rem', color: '#8b949e', borderBottom: '1px solid #21262d', backgroundColor: '#161b22' }}>
                      {remolquesFiltradosBuscador.length} {remolquesFiltradosBuscador.length === 1 ? 'remolque' : 'remolques'}{textoBuscarRemolque.trim() ? '' : ' (primeros 30)'}
                    </div>
                    {remolquesFiltradosBuscador.map((rem: any) => (
                      <div
                        key={rem.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setFilterRemolque(rem.id); setTextoBuscarRemolque(''); setMostrarSugerenciasRemolque(false); }}
                        style={{ padding: '10px 12px', cursor: 'pointer', color: '#c9d1d9', fontSize: '0.88rem', borderBottom: '1px solid #21262d', transition: 'background-color 0.15s' }}
                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div style={{ fontWeight: '500' }}>{etiquetaRemolque(rem) || rem.id}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Filtro general (opcional) */}
          <div style={{ width: '100%' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>FILTRO GENERAL (opcional)</label>
            <input type="text" placeholder="Buscar por Ref..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
          </div>
              </div>

              <div style={{ padding: '12px 16px', borderTop: '1px solid #30363d', display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button
                  onClick={limpiarFiltrosPanel}
                  style={{ flex: 1, padding: '11px', backgroundColor: 'transparent', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
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
            <div onClick={() => setModalExportar(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(1, 4, 9, 0.65)', zIndex: 1300, animation: 'fadeIn 0.2s ease' }} />
            <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '480px', maxWidth: '94vw', maxHeight: '86vh', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '10px', zIndex: 1301, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'fadeIn 0.2s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '0.95rem' }}>Exportar a Excel</span>
                  <span style={{ color: '#8b949e', fontSize: '0.78rem' }}>({columnasExport.filter(c => c.visible).length} columnas)</span>
                </div>
                <button onClick={() => setModalExportar(false)} title="Cerrar" style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '4px' }}>✕</button>
              </div>

              <div style={{ padding: '10px 16px', color: '#8b949e', fontSize: '0.78rem', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
                Arrastra <span style={{ color: '#c9d1d9' }}>⋮⋮</span> o usa las flechas para cambiar el orden. Marca las columnas que quieres incluir.
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
                {columnasExport.map((c, idx) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => { dragExportIdx.current = idx; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => soltarColumnaExport(idx)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', marginBottom: '4px', backgroundColor: c.visible ? '#0d1117' : 'rgba(13, 17, 23, 0.5)', border: '1px solid #21262d', borderRadius: '6px', cursor: 'grab', opacity: c.visible ? 1 : 0.55 }}
                  >
                    <span title="Arrastrar para reordenar" style={{ color: '#484f58', fontSize: '0.85rem', letterSpacing: '-2px', userSelect: 'none' }}>⋮⋮</span>
                    <input
                      type="checkbox"
                      checked={c.visible}
                      onChange={() => setColumnasExport(prev => prev.map((x, i) => (i === idx ? { ...x, visible: !x.visible } : x)))}
                      style={{ accentColor: '#ef4444', cursor: 'pointer', width: '15px', height: '15px', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1, color: c.visible ? '#c9d1d9' : '#8b949e', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                    <button onClick={() => moverColumnaExport(idx, -1)} disabled={idx === 0} title="Subir" style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '4px', color: idx === 0 ? '#30363d' : '#8b949e', cursor: idx === 0 ? 'default' : 'pointer', padding: '2px 7px', fontSize: '0.7rem' }}>▲</button>
                    <button onClick={() => moverColumnaExport(idx, 1)} disabled={idx === columnasExport.length - 1} title="Bajar" style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '4px', color: idx === columnasExport.length - 1 ? '#30363d' : '#8b949e', cursor: idx === columnasExport.length - 1 ? 'default' : 'pointer', padding: '2px 7px', fontSize: '0.7rem' }}>▼</button>
                  </div>
                ))}
              </div>

              <div style={{ padding: '12px 16px', borderTop: '1px solid #30363d', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={() => setColumnasExport(columnasExportPorDefecto())}
                  title="Restablecer con las columnas visibles de la tabla, en su orden actual"
                  style={{ padding: '9px 12px', backgroundColor: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Columnas de la tabla
                </button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setModalExportar(false)} style={{ padding: '9px 14px', backgroundColor: 'transparent', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Cancelar</button>
                <button
                  onClick={exportarExcel}
                  style={{ padding: '9px 16px', backgroundColor: '#ef4444', color: '#f0f6fc', border: '1px solid #ef4444', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '20px', width: '100%', backgroundColor: '#161b22', padding: '12px 16px', borderRadius: '8px', border: '1px solid #30363d' }}>
          <button
            onClick={() => setDrawerFiltrosAbierto(v => !v)}
            title={drawerFiltrosAbierto ? 'Ocultar el panel de filtros' : 'Mostrar el panel de filtros'}
            style={{ padding: '9px 16px', backgroundColor: drawerFiltrosAbierto ? '#ef4444' : 'transparent', color: drawerFiltrosAbierto ? '#f0f6fc' : '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, fontSize: '0.85rem' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            Filtros
            {contadorFiltrosActivos > 0 && (
              <span style={{ backgroundColor: '#f0f6fc', color: '#ef4444', borderRadius: '999px', padding: '1px 8px', fontSize: '0.75rem', fontWeight: 'bold' }}>{contadorFiltrosActivos}</span>
            )}
          </button>

          {filtrosAplicados ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', flex: 1, minWidth: '200px' }}>
              {resumenFiltrosChips.map((chip, i) => (
                <span key={`chip_${i}`} style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5', padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{chip}</span>
              ))}
            </div>
          ) : (
            <span style={{ color: '#8b949e', fontSize: '0.82rem', flex: 1, minWidth: '200px' }}>Presiona Filtros para definir el rango de fechas y buscar.</span>
          )}

          <button className="btn btn-outline" onClick={abrirModalExportar} style={{ padding: '10px 12px', marginLeft: 'auto', flexShrink: 0 }} title="Exportar a Excel (elegir y ordenar columnas)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          {!filtrosAplicados ? (
            <div style={{ border: '1px dashed #30363d', borderRadius: '8px', padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '6px' }}>Realiza una búsqueda</div>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Define <span style={{ color: '#ef4444' }}>Fecha Inicio</span> y <span style={{ color: '#ef4444' }}>Fecha Fin</span> y presiona <span style={{ color: '#ef4444', fontWeight: 'bold' }}>Buscar</span> para ver las operaciones canceladas.</div>
            </div>
          ) : cargandoOperaciones ? (
            <div style={{ border: '1px solid #30363d', borderRadius: '8px', padding: '60px 24px', textAlign: 'center', color: '#8b949e' }}>Cargando operaciones canceladas...</div>
          ) : errorCarga ? (
            <div style={{ border: '1px solid rgba(248,81,73,0.4)', backgroundColor: 'rgba(248,81,73,0.06)', borderRadius: '8px', padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ color: '#f85149', fontWeight: 'bold', fontSize: '1.05rem', marginBottom: '8px' }}>No se pudieron cargar las operaciones</div>
              <div style={{ color: '#8b949e', fontSize: '0.9rem', maxWidth: '520px', margin: '0 auto 16px' }}>{errorCarga}</div>
              <button onClick={() => descargarOperaciones()} style={{ padding: '8px 18px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>Reintentar</button>
            </div>
          ) : operacionesFiltradas.length === 0 ? (
            <div style={{ border: '1px dashed #30363d', borderRadius: '8px', padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '6px' }}>Sin resultados</div>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                {operacionesGlobales.length === 0
                  ? 'No hay operaciones canceladas registradas.'
                  : 'No hay operaciones canceladas que coincidan con los filtros seleccionados.'}
              </div>
            </div>
          ) : (
          <>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
              <table className="data-table" style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
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
                          <span style={{ marginLeft: '6px', color: '#ef4444', fontSize: '0.7rem' }}>
                            {ordenDireccion === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {operacionesEnPantalla.length === 0 ? (<tr><td colSpan={11} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Sin resultados para tu búsqueda.</td></tr>) : (
                    operacionesEnPantalla.map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                        <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button 
                              type="button" 
                              title="Ver Detalles"
                              onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setPestañaDetalleActiva('general'); }}
                              style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button 
                              type="button" 
                              title="Editar Operación"
                              onClick={(e) => { e.stopPropagation(); abrirEdicion(op); }}
                              style={{ background: 'transparent', border: '1px solid #58a6ff', borderRadius: '4px', color: '#58a6ff', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(88, 166, 255, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button 
                              type="button" 
                              title="Ver Documentos"
                              onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setMostrarDocumentos(true); }}
                              style={{ background: 'transparent', border: '1px solid #fb923c', borderRadius: '4px', color: '#fb923c', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '16px', color: colorTipoOperacion(mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)), fontWeight: 'bold', fontFamily: 'monospace' }}>{op.ref || op.id?.substring(0,6)}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.fechaServicio}</td>
                        <td style={{ padding: '16px', color: colorTipoOperacion(mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)), fontWeight: 'bold' }}>{mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)}</td>
                        <td style={{ padding: '16px', color: '#ef4444', fontWeight: 'bold' }}>{mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre)}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre)}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre)}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre)}</td>
                        <td style={{ padding: '16px', color: '#f0f6fc', fontWeight: '500' }}>{mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente)}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{formatoMoneda(op.subtotalCliente)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
          </div>
          {operacionesOrdenadas.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesOrdenadas.length)} de {operacionesOrdenadas.length} operaciones canceladas</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
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
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
          <div className="form-card detail-card" style={{ maxWidth: '1100px', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            <div className="form-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: 'none' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <span>Detalle de Servicio Cancelado</span>
                <span style={{ color: '#ef4444' }}>{operacionViendo.ref || operacionViendo.id?.substring(0,6)}</span>
                <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', border: '1px solid rgba(239, 68, 68, 0.3)', fontWeight: 'bold' }}>
                  {mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}
                </span>
              </h2>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                
                {evalIsFletes && (
                  <>
                    <button onClick={handleDescargarCartaInstrucciones} title="Descargar Carta de Instrucciones" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                      Carta Instrucciones
                    </button>
                    <button onClick={handleDescargarPruebaEntrega} title="Descargar Prueba de Entrega" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                      Prueba Entrega
                    </button>
                  </>
                )}

                <button onClick={handleDescargarCheckList} title="Descargar Check List" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                  Check List
                </button>
                <button onClick={handleDescargarSolicitudRetiro} title="Descargar Solicitud de Retiro" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                  Solicitud
                </button>
                <button onClick={handleDescargarInstruccionesServicio} title="Descargar Instrucciones de Servicio" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                  Instrucciones
                </button>

                <button onClick={() => abrirEdicion(operacionViendo)} title="Editar Operación" style={{ background: '#21262d', border: '1px solid rgba(88, 166, 255, 0.4)', color: '#58a6ff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  Editar
                </button>
                <button onClick={() => setMostrarDocumentos(true)} title="Ver / Subir Documentos" style={{ background: '#21262d', border: '1px solid rgba(251, 146, 60, 0.4)', color: '#fb923c', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>Documentos</button>
                <button onClick={verHistorial} style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>Bitácora</button>
                <button onClick={() => setOperacionViendo(null)} className="btn-window close" style={{ padding: '6px', borderRadius: '50%' }}>✕</button>
              </div>
            </div>
            {/* ✅ NUEVO: SIGUIENTE PASO — editar status/horario igual que Operaciones Activas */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 24px', borderTop: '1px solid #30363d', flexWrap: 'wrap' }}>
              <span style={{ color: '#8b949e', fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '1px', marginRight: '4px' }}>SIGUIENTE PASO</span>
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
                        <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {esExitoso ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'pop 0.3s ease-out' }}>
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                          )}
                        </span>
                        <span style={{ whiteSpace: 'nowrap' }}>{botonStr}</span>
                      </button>
                    );
                  })}
                  <button onClick={abrirRegistroHorario} className="status-circle-btn"
                    style={{ width: 36, height: 36, borderRadius: '50%', background: '#21262d', border: '1px solid #30363d', color: '#8b949e',
                      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', flexShrink: 0 }}
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
                  <span style={{ color: '#8b949e', fontSize: '0.85rem', fontStyle: 'italic', marginRight: '8px' }}>
                    No hay transiciones automáticas configuradas.
                  </span>
                  <button onClick={abrirRegistroHorario} className="status-pill"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '6px 18px 6px 6px', borderRadius: '999px', border: 'none',
                      background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                      boxShadow: '0 4px 14px rgba(234, 88, 12, 0.35)', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}
                    title="Registrar status manualmente">
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
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
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px', overflowX: 'auto' }}>
              {tabsDetalle.map(tab => (<button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)} style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer' }}>{tab.label}</button>))}
            </div>
            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {pestañaDetalleActiva === 'general' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}><div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Tipo</span><span>{mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', operacionViendo.tipoOperacionNombre)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Fecha / Status</span><span>{mostrarDato(operacionViendo.fechaServicio)} | <span style={{color: '#ef4444'}}>{mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}</span></span></div>
                  {evalIsFletes && (<div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Fecha de Cita</span><span>{formatearFechaHora(operacionViendo.fechaCita)}</span></div>)}
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cliente (Paga)</span><span>{mostrarDatoMapeado(operacionViendo.clientePaga || operacionViendo.clienteId, 'empresas', 'nombre', operacionViendo.clienteNombre || operacionViendo.nombreCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Convenio (Tarifa)</span><span>{obtenerNombreConvenioCliente(operacionViendo.convenio, operacionViendo.convenioNombre)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># de Remolque</span><span>{mostrarDatoMapeado(operacionViendo.numeroRemolque, 'remolques', 'nombre', operacionViendo.remolqueNombre)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Ref Cliente</span><span>{mostrarDato(operacionViendo.refCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Origen</span><span>{mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Destino</span><span>{mostrarDatoMapeado(operacionViendo.destino, 'empresas', 'nombre', operacionViendo.destinoNombre)}</span></div>
                  <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Observaciones Ejecutivo</span><div style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>{mostrarDato(operacionViendo.observacionesEjecutivo)}</div></div>
                </div>
              )}
              {pestañaDetalleActiva === 'pedimento' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cliente (Mercancía)</span><span>{operacionViendo.clienteMercanciaNombre || operacionViendo.clienteMercancia || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Descripción de la Mercancía</span><span>{mostrarDato(operacionViendo.descripcionMercancia)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cantidad</span><span>{mostrarDato(operacionViendo.cantidad)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Embalaje</span><span>{operacionViendo.embalajeNombre || operacionViendo.embalaje || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Peso (Kg)</span><span>{mostrarDato(operacionViendo.pesoKg)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># DODA</span><span>{mostrarDato(operacionViendo.numDoda)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Fecha DODA</span><span>{mostrarDato(operacionViendo.fechaEmisionDoda)}</span></div>
                </div>
              )}
              {pestañaDetalleActiva === 'manifiestos' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># de Entry's</span><span>{mostrarDato(operacionViendo.numeroEntrys)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cant. Entry's</span><span>{mostrarDato(operacionViendo.cantEntrys)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># Manifiesto</span><span>{mostrarDato(operacionViendo.numManifiesto)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Prov. Servicios</span><span>{operacionViendo.provServiciosNombre || operacionViendo.provServicios || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Costo Manifiesto</span><span>{formatoMoneda(operacionViendo.montoManifiesto)}</span></div>
                </div>
              )}
              {pestañaDetalleActiva === 'unidad' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div style={{ gridColumn: 'span 3' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Prov. Transporte</span><span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem' }}>{mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas', 'nombre', operacionViendo.proveedorUnidadNombre)}</span></div>
                  <div style={{ gridColumn: 'span 3', backgroundColor: '#161b22', padding: '20px', borderRadius: '12px', border: '1px solid #30363d' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '16px' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Facturado En:</span><span>{mostrarMoneda(operacionViendo.facturadoEnUnidad)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Convenio Proveedor</span><span>{obtenerNombreConvenioProv(operacionViendo.convenioProveedor, operacionViendo.convenioProveedorNombre)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Moneda Base</span><span>{mostrarMoneda(operacionViendo.monedaConvenioProv)}</span></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Monto (Base)</span><span>{formatoMoneda(operacionViendo.totalAPagarProv)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Costos Adicionales</span><span>{formatoMoneda(operacionViendo.cargosAdicionalesProv)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Subtotal</span><span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.subtotalProv)}</span></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Dólares</span><span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.dolaresProv)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Pesos</span><span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.pesosProv)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#f85149', fontWeight: 'bold' }}>Conversión Final</span><span style={{ color: '#f85149', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.conversionProv)}</span></div>
                    </div>
                  </div>
                  {showDetailInternalFleet && (
                    <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#f0f6fc', margin: '0' }}>Flota Operativa (Roelca)</h4></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Unidad Asignada</span><span>{mostrarDatoMapeado(operacionViendo.unidad, 'unidades', 'unidad', operacionViendo.unidadNombre)}</span></div>
                      <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Operador Asignado</span><span>{mostrarDatoMapeado(operacionViendo.operador, 'empleados', 'nombre', operacionViendo.operadorNombre)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Sueldo Operador</span><span>{formatoMoneda(operacionViendo.sueldoOperador)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Sueldo Extra</span><span>{formatoMoneda(operacionViendo.sueldoExtra)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Sueldo Total</span><span style={{ color: '#f0f6fc', fontWeight: 'bold', backgroundColor: '#161b22', padding: '6px 10px', borderRadius: '4px', border: '1px solid #30363d' }}>{formatoMoneda(operacionViendo.sueldoTotal)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Combustible</span><span>{formatoMoneda(operacionViendo.combustible)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Combustible Extra</span><span>{formatoMoneda(operacionViendo.combustibleExtra)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Total Combustible</span><span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.combustibleTotal)}</span></div>
                    </div>
                  )}
                  {showDetailExternalFleet && (
                    <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#58a6ff', margin: '0' }}>Flota Externa (Proveedor)</h4></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Unidad Externa</span><span>{mostrarDato(operacionViendo.unidadProveedor)}</span></div>
                      <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Operador Externo</span><span>{mostrarDato(operacionViendo.operadorProveedor)}</span></div>
                    </div>
                  )}
                  {/* ✅ Observaciones ARRIBA del bloque de gastos (a petición) */}
                  <div style={{ gridColumn: 'span 3', marginTop: '24px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Observaciones (Unidad / Proveedor)</span>
                    <div style={{ color: '#c9d1d9', fontWeight: '500', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>{mostrarDato(operacionViendo.observacionesUnidad)}</div>
                  </div>
                  <div style={{ gridColumn: 'span 3', marginTop: '20px', backgroundColor: '#0d1117', border: '1px solid #f85149', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: '#8b949e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Gastos [Sueldos + Manifiesto]</div>
                    <div style={{ color: '#f85149', fontSize: '2rem', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.totalGastos)}</div>
                  </div>
                </div>
              )}
              {pestañaDetalleActiva === 'cobrar' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Facturado En:</span><span>{mostrarMoneda(operacionViendo.facturadoEnCobrar)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Moneda Convenio</span><span>{mostrarMoneda(operacionViendo.monedaConvenioCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Convenio (Base)</span><span>{formatoMoneda(operacionViendo.montoConvenioCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cargos Adicionales</span><span>{formatoMoneda(operacionViendo.cargosAdicionales)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Subtotal</span><span style={{ color: '#c9d1d9', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.subtotalCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Tipo de Cambio del Día</span><span>{mostrarDato(operacionViendo.tipoCambioAprobado)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Dólares (Cliente)</span><span style={{ color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.dolaresCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Pesos (Cliente)</span><span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.pesosCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Conversión Final</span><span style={{ color: '#D84315', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.conversionCliente)}</span></div>
                  <div style={{ gridColumn: 'span 3', marginTop: '24px', backgroundColor: '#0d1117', border: '1px solid #10b981', padding: '24px', borderRadius: '12px', textAlign: 'center' }}>
                    <span style={{ display: 'block', fontSize: '0.9rem', color: '#8b949e', textTransform: 'uppercase' }}>Utilidad Estimada de la Operación</span>
                    <span style={{ fontSize: '2.5rem', color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.utilidadEstimada)}</span>
                  </div>
                  <div style={{ gridColumn: 'span 3', marginTop: '24px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Observaciones (Cobro)</span>
                    <div style={{ color: '#c9d1d9', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>{mostrarDato(operacionViendo.observacionesCobrar)}</div>
                  </div>
                </div>
              )}

              {/* ✅ Auditoría de la referencia: botón que abre el detalle en un modal */}
              <div style={{ margin: '24px 24px 12px', display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => { setMostrarAuditoria(true); cargarNombresAuditoria(); }} title="Ver quién creó la referencia, cuándo, y el detalle de cada edición"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>
                  🕓 Ver auditoría
                  <span style={{ backgroundColor: '#f59e0b', color: '#0d1117', borderRadius: '10px', padding: '1px 8px', fontSize: '0.72rem', fontWeight: 'bold' }}>{(operacionViendo.historialEdiciones || []).length}</span>
                </button>
              </div>

              {/* ✅ Modal de auditoría (solo lectura) */}
              {mostrarAuditoria && (
                <div onClick={() => setMostrarAuditoria(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 1450, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
                  <div onClick={(e) => e.stopPropagation()} style={{ width: '620px', maxWidth: '94%', maxHeight: '82vh', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #30363d' }}>
                      <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.05rem' }}>🕓 Auditoría de la referencia <span style={{ color: '#D84315', fontSize: '0.85rem', marginLeft: '8px' }}>{operacionViendo.ref || ''}</span></h3>
                      <button onClick={() => setMostrarAuditoria(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                    </div>
                    <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold', textTransform: 'uppercase' }}>Creación</span>
                        <span style={{ color: '#c9d1d9', fontSize: '0.9rem' }}>
                          Creada por <b style={{ color: '#58a6ff' }}>{nombreAuditor(operacionViendo.creadoPor, 'Sin registro')}</b>
                          {operacionViendo.creadoEn ? <> el <b style={{ color: '#c9d1d9' }}>{fmtFechaAuditoria(operacionViendo.creadoEn)}</b></> : null}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#8b949e', fontSize: '0.82rem', fontWeight: 'bold' }}>EDICIONES REGISTRADAS:</span>
                        <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>{(operacionViendo.historialEdiciones || []).length}</span>
                      </div>
                      {(operacionViendo.historialEdiciones || []).slice().reverse().map((h: any, i: number) => (
                        <details key={i} open={i === 0} style={{ border: '1px solid #21262d', borderRadius: '8px', padding: '10px 14px', backgroundColor: '#010409' }}>
                          <summary style={{ cursor: 'pointer', color: '#8b949e', fontSize: '0.85rem' }}>
                            <b style={{ color: '#c9d1d9' }}>{nombreAuditor(h.usuario)}</b> · {fmtFechaAuditoria(h.fecha)} · <b style={{ color: '#f59e0b' }}>{(h.cambios || []).length}</b> {(h.cambios || []).length === 1 ? 'cambio' : 'cambios'}
                          </summary>
                          <ul style={{ margin: '10px 0 2px 18px', padding: 0, color: '#8b949e', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {(h.cambios || []).map((c: any, j: number) => (<li key={j}>{String(c)}</li>))}
                          </ul>
                        </details>
                      ))}
                      {(operacionViendo.historialEdiciones || []).length === 0 && (
                        <span style={{ color: '#6e7681', fontSize: '0.85rem' }}>Sin ediciones desde su creación.</span>
                      )}
                    </div>
                    <div style={{ padding: '12px 20px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => setMostrarAuditoria(false)} style={{ padding: '9px 24px', background: 'none', color: '#8b949e', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Cerrar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="form-actions" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d' }}>
              <button onClick={() => setOperacionViendo(null)} className="btn btn-outline">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Visor de documentos de la operación cancelada */}
      {mostrarDocumentos && operacionViendo && (
        <div className="modal-overlay" style={{ zIndex: 2100 }}>
          <div className="form-card" style={{ maxWidth: '760px', width: '95%', maxHeight: '88vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#f0f6fc' }}>Documentos de la Operación</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#8b949e' }}>
                  Referencia: <span style={{ color: '#fb923c', fontWeight: 600 }}>{refOperacionViendo}</span>
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setMostrarSubirDocOp(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Subir Documento
                </button>
                <button onClick={() => setMostrarDocumentos(false)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1 }} title="Cerrar">✕</button>
              </div>
            </div>
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <DocumentosLista coleccionOrigen="operaciones" registroId={operacionViendo.id} />
            </div>
            <div style={{ padding: '14px 24px', borderTop: '1px solid #30363d', textAlign: 'right', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
              <button onClick={() => setMostrarDocumentos(false)} className="btn btn-outline" style={{ padding: '10px 24px', borderRadius: '6px' }}>Cerrar</button>
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
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="form-card" style={{ maxWidth: '450px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '20px 24px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#f0f6fc' }}>Registrar Movimiento (Fecha Personalizada)</h2>
              <button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '16px' }}>
                Usa este formulario solo si necesitas registrar un movimiento con una fecha y hora distinta a la actual.
              </p>
              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e' }}>Fecha y Hora</label>
                <input type="datetime-local" className="form-control" value={nuevaFechaHora} onChange={e => setNuevaFechaHora(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e' }}>Estatus / Hito</label>
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
              <button onClick={guardarHorario} disabled={cargandoHorarios} className="btn btn-primary" style={{ width: '100%', marginTop: '24px', padding: '12px', borderRadius: '6px', fontWeight: 'bold' }}>
                {cargandoHorarios ? 'Actualizando...' : 'Guardar y Actualizar Operación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalHorarios === 'historial' && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="form-card" style={{ maxWidth: '650px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
            <div className="form-header"><h2>Bitácora de Movimientos</h2><button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button></div>
            <div style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
              {cargandoHorarios ? (<div>Descargando...</div>) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ color: '#8b949e' }}><th style={{ textAlign: 'left' }}>Fecha y Hora</th><th style={{ textAlign: 'left' }}>Estatus</th></tr></thead>
                  <tbody>{historialList.map((h: any) => (<tr key={h.id} style={{ borderBottom: '1px solid #21262d' }}><td style={{ padding: '12px' }}>{new Date(h.fechaHora).toLocaleString('es-MX')}</td><td style={{ padding: '12px', color: '#ef4444' }}>{mostrarDatoMapeado(h.status, 'statusServicio', 'nombre', h.statusNombre)}</td></tr>))}</tbody>
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
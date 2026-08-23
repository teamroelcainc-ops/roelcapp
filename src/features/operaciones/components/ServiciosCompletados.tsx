import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, getDocs, onSnapshot, orderBy, limit, where, startAfter, documentId, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../../../config/firebase'; 
import { obtenerCacheMemoria, guardarCacheMemoria, limpiarCacheMemoria } from '../../../utils/cacheMemoria';
// ✅ NUEVO: historial de actividad (colección historial_actividad)
import { registrarLog } from '../../../utils/logger';
import { sincronizarNombresOperaciones } from '../../../utils/sincronizarNombresOperaciones';
import { generarSolicitudRetiroPDF, generarInstruccionesServicioPDF, generarCheckListPDF, generarPruebaEntregaPDF, generarCartaInstruccionesPDF } from '../../../utils/pdfGenerator'; 
import * as XLSX from 'xlsx';
// ✅ NUEVO: reglas de status (botones dinámicos + cascada) — igual que Operaciones Activas
import { obtenerBotonesHorarioDinamicos, resolverCascadaStatus } from '../config/statusRules';
// ✅ NUEVO: visor y subida de documentos ligados a la operación
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import { FormularioOperacion, TIPOS_DOCUMENTO_OPERACION } from './FormularioOperacion';
import './ServiciosCompletados.css';
import { almacenSesion } from '../../../utils/cacheMemoria';
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


// ✅ Color por TIPO DE OPERACIÓN: Transfer → naranja, Logística → azul,
//   Fletes → verde. Cualquier otro tipo conserva el color neutro.
const colorTipoOperacion = (nombre: any): string => {
  const n = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (n.includes('transfer')) return '#fb923c';
  if (n.includes('logist')) return '#58a6ff';
  if (n.includes('flete')) return '#3fb950';
  return '#c9d1d9';
};

// ✅ NUEVO: utilidades para el Historial de Actividad (historial_actividad).
//   Nunca deben romper el flujo principal: los llamados a registrarLog van con .catch.
const truncarValorLog = (v: any): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '(vacío)';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
};

const describirCambiosLog = (nuevo: any, anterior: any, etiquetas: Record<string, string> = {}): string => {
  const cmp = (x: any) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? ''));
  const cambios: string[] = [];
  Object.keys(nuevo || {}).forEach((k) => {
    const a = anterior ? anterior[k] : undefined;
    if (cmp(a) === cmp(nuevo[k])) return;
    cambios.push(`${etiquetas[k] || k}: "${truncarValorLog(a)}" → "${truncarValorLog(nuevo[k])}"`);
  });
  if (cambios.length === 0) return 'sin cambios de valor detectados';
  const visibles = cambios.slice(0, 15);
  const resto = cambios.length - visibles.length;
  return visibles.join(' | ') + (resto > 0 ? ` | ...y ${resto} campos más` : '');
};

const describirFiltrosLog = (f: { fechaInicio: string; fechaFin: string; cliente?: string; clienteNombre?: string; tipoOperacion?: string; remolque?: string; remolqueNombre?: string; operador?: string; operadorNombre?: string; referencia?: string; busqueda?: string }): string => {
  const partes: string[] = [`Fechas: ${f.fechaInicio} a ${f.fechaFin}`];
  if (f.cliente) partes.push(`Cliente: ${f.clienteNombre || f.cliente}`);
  if (f.tipoOperacion) partes.push(`Tipo de operación: ${f.tipoOperacion}`);
  if (f.remolque) partes.push(`Remolque: ${f.remolqueNombre || f.remolque}`);
  if (f.operador) partes.push(`Operador: ${f.operadorNombre || f.operador}`);
  if (f.referencia && f.referencia.trim()) partes.push(`# Referencia: "${f.referencia.trim()}"`);
  if (f.busqueda && f.busqueda.trim()) partes.push(`Filtro general: "${f.busqueda.trim()}"`);
  return partes.join(' | ');
};

const COLUMNAS_BASE = [
  { id: 'ref', label: '# Referencia', visible: true },
  { id: 'fechaServicio', label: 'Fecha Servicio', visible: true },
  { id: 'fechaCita', label: 'Fecha Cita', visible: false },
  { id: 'tipoOperacion', label: 'Tipo de Operación', visible: true },
  { id: 'status', label: 'Status', visible: true },
  // ✅ NUEVO: conexiones con los demás módulos (vienen desnormalizadas en la operación)
  { id: 'refDiesel', label: 'Ref. Diesel', visible: true },
  { id: 'refNomina', label: 'Ref. Nómina', visible: true },
  { id: 'invoiceCliente', label: 'Invoice Cliente', visible: true },
  { id: 'invoiceProveedor', label: 'Invoice Proveedor', visible: true },
  { id: 'trafico', label: 'Tráfico', visible: false },
  { id: 'cliente', label: 'Cliente (Paga)', visible: true },
  { id: 'convenioTarifa', label: 'Convenio Cliente (Tarifa)', visible: true },
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
  { id: 'remolque', label: '# Remolque', visible: true },
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
  { id: 'unidad', label: 'Unidad Roelca', visible: true },
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

// ✅ Status que se muestran en esta vista — SOLO estos 2 IDs hex.
const STATUS_COMPLETADOS_VALORES = ['c2d57403', 'f557b751'];
// ID del tipo de empresa "Cliente (Paga)" para el buscador
const ID_TIPO_CLIENTE_PAGA = '7eec9cbb';
// ✅ NUEVO: tamaño de página para descarga incremental
const TAMANIO_PAGINA = 100;
// ✅ NUEVO: tamaño de bloque al descargar TODOS los completados por status.
const TAMANIO_BLOQUE_STATUS = 500;
// ✅ NUEVO: TTL del caché en sessionStorage (5 minutos)
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_PREFIX = 'roelca_completadas_';
// ✅ NUEVO: clave ÚNICA de caché. Ahora descargamos TODOS los completados (ambos
//   status) una sola vez y filtramos fecha/cliente en memoria, así que la caché
//   NO depende del rango de fechas ni del cliente.
const CACHE_KEY_TODOS = CACHE_PREFIX + 'all_v3';

// ✅ NUEVO: clave para PERSISTIR la configuración de columnas (orden + visibles)
//   en localStorage, para que NO se pierda al recargar la página.
const COLUMNAS_STORAGE_KEY = 'roelca_completadas_columnas_v1';

// ✅ NUEVO: el último filtro buscado se guarda POR USUARIO en localStorage y se
//   restaura (con búsqueda automática) al volver a entrar al módulo.
const FILTROS_STORAGE_PREFIX = 'roelca_completadas_filtros_v1_';
const claveFiltrosGuardados = () => FILTROS_STORAGE_PREFIX + (auth.currentUser?.uid || 'anon');

// ✅ NUEVO: la selección y el ORDEN de columnas del Excel se recuerdan POR USUARIO.
const EXPORT_STORAGE_PREFIX = 'roelca_completadas_export_v1_';
const claveExportGuardado = () => EXPORT_STORAGE_PREFIX + (auth.currentUser?.uid || 'anon');

// ✅ NUEVO: normaliza nombres de moneda inconsistentes en la base
//   ("Dolares" / "Dólares" / "DOLARES" → "Dólares"; "pesos" → "Pesos").
const normalizarMoneda = (txt: any): string => {
  const t = String(txt ?? '').trim();
  if (!t || t === '-') return t;
  const plano = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (plano.includes('dolar')) return 'Dólares';
  if (plano.includes('peso')) return 'Pesos';
  return t;
};

// ✅ NUEVO: carga la configuración guardada y la reconcilia con COLUMNAS_BASE:
//   · respeta el ORDEN y la VISIBILIDAD guardados,
//   · si en el código se agregaron columnas nuevas (que no estaban guardadas),
//     se añaden al final con su valor por defecto,
//   · si una columna guardada ya no existe en el código, se descarta.
//   Así nunca se rompe aunque el catálogo de columnas cambie en una actualización.
const cargarColumnasGuardadas = (): typeof COLUMNAS_BASE => {
  const base = COLUMNAS_BASE.map(c => ({ ...c }));
  try {
    const raw = localStorage.getItem(COLUMNAS_STORAGE_KEY);
    if (!raw) return base;
    const guardadas = JSON.parse(raw);
    if (!Array.isArray(guardadas)) return base;

    const basePorId = new Map(base.map(c => [c.id, c]));
    const resultado: typeof COLUMNAS_BASE = [];
    const yaAgregados = new Set<string>();

    // 1) Primero, en el ORDEN guardado (solo las que siguen existiendo).
    guardadas.forEach((g: any) => {
      const def = basePorId.get(g?.id);
      if (def && !yaAgregados.has(def.id)) {
        resultado.push({ ...def, visible: typeof g.visible === 'boolean' ? g.visible : def.visible });
        yaAgregados.add(def.id);
      }
    });

    // 2) Columnas nuevas del código que no estaban guardadas: al final.
    base.forEach(c => {
      if (!yaAgregados.has(c.id)) {
        resultado.push({ ...c });
        yaAgregados.add(c.id);
      }
    });

    return resultado;
  } catch {
    return base;
  }
};

// ✅ NUEVO: normaliza CUALQUIER formato de fecha de servicio a "YYYY-MM-DD".
//   Los registros migrados/viejos pueden guardar la fecha como Timestamp de
//   Firestore, objeto Date, número epoch o texto "DD/MM/YYYY" / "MM/DD/YYYY".
//   Sin esta normalización, el filtro por rango fallaba y no mostraba nada.
const normalizarFechaServicioISO = (valor: any): string => {
  if (valor === null || valor === undefined || valor === '') return '';

  // Timestamp de Firestore u objeto con toDate()/seconds.
  if (typeof valor === 'object') {
    try {
      if (typeof valor.toDate === 'function') return valor.toDate().toISOString().split('T')[0];
      if (typeof valor.seconds === 'number') return new Date(valor.seconds * 1000).toISOString().split('T')[0];
      if (valor instanceof Date && !isNaN(valor.getTime())) return valor.toISOString().split('T')[0];
    } catch { /* sigue abajo */ }
  }

  const s = String(valor).trim();
  if (!s) return '';

  // Ya viene en ISO ("2026-06-25" o "2026-06-25T10:30:00").
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Formatos con barras o guiones: DD/MM/YYYY (latino) o MM/DD/YYYY.
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) {
    let a = parseInt(dmy[1], 10);
    let b = parseInt(dmy[2], 10);
    const y = dmy[3];
    let dd = a, mm = b;            // Por defecto se asume DD/MM (formato latino).
    if (a <= 12 && b > 12) { mm = a; dd = b; }   // Si el 2º > 12 era MM/DD.
    if (mm < 1 || mm > 12) return s;             // Formato no reconocible.
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  // Número epoch (ms o s).
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const d = new Date(n > 1e12 ? n : n * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  // Último intento: que lo resuelva el motor de fechas del navegador.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return s;
};

// ✅ NUEVO: prop opcional para conectar la edición con el formulario existente del padre.
interface ServiciosCompletadosProps {
  onEditar?: (operacion: any) => void;
}

const ServiciosCompletados: React.FC<ServiciosCompletadosProps> = ({ onEditar }) => {
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(false);
  // ✅ NUEVO (V00114) — Sincronizar nombres (solo NOMBRES; nunca montos):
  //   re-resuelve las operaciones completadas cargadas contra los catálogos
  //   actuales usando la utilidad compartida.
  const [sincronizandoNombres, setSincronizandoNombres] = useState(false);
  const sincronizarNombres = async () => {
    if (sincronizandoNombres || operacionesGlobales.length === 0) return;
    const ok = window.confirm(
      `Se revisarán las ${operacionesGlobales.length} operaciones completadas cargadas y se actualizarán los nombres ` +
      `(tipo de operación, status, empresas y carga) que quedaron viejos tras renombrar en Catálogos.\n\n` +
      `Solo se corrigen NOMBRES; los montos y tarifas guardados no se tocan.\n\n¿Continuar?`
    );
    if (!ok) return;
    setSincronizandoNombres(true);
    try {
      const { cambiosPorId, corregidos } = await sincronizarNombresOperaciones(operacionesGlobales, 'Servicios Completados');
      if (corregidos > 0) {
        setOperacionesGlobales(prev => prev.map((o: any) =>
          cambiosPorId[String(o.id)] ? { ...o, ...cambiosPorId[String(o.id)] } : o));
      }
      alert(corregidos > 0
        ? `Sincronización completada. ✅\n\nSe actualizaron ${corregidos} operación(es).`
        : 'Sincronización completada. ✅\n\nLas operaciones cargadas ya tenían los nombres al día.');
    } catch (e: any) {
      console.error('Error sincronizando nombres:', e);
      alert('La sincronización no terminó completa.\n\nDetalle técnico: ' + (e?.message || e?.code || 'desconocido'));
    }
    setSincronizandoNombres(false);
  };
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

  const [modalHorarios, setModalHorarios] = useState<'cerrado' | 'registrar' | 'historial'>('cerrado');
  const [historialList, setHistorialList] = useState<any[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);

  // ✅ NUEVO: edición de horario/status (igual que Operaciones Activas)
  const [nuevoStatus, setNuevoStatus] = useState('');
  const [nuevaFechaHora, setNuevaFechaHora] = useState('');
  const [botonesDisponibles, setBotonesDisponibles] = useState<string[]>([]);
  const [guardandoStatusRapido, setGuardandoStatusRapido] = useState<string | null>(null);
  const [ultimoStatusGuardado, setUltimoStatusGuardado] = useState<string | null>(null);

  // ✅ NUEVO: visor/subida de documentos de la operación
  const [mostrarDocumentos, setMostrarDocumentos] = useState(false);
  const [mostrarSubirDocOp, setMostrarSubirDocOp] = useState(false);
  // ✅ NUEVO: operación a la que se sube un documento DIRECTO desde la fila.
  const [opSubirDocs, setOpSubirDocs] = useState<any | null>(null);
  
  const [catalogosGlobales, setCatalogosGlobales] = useState<any>({});
  const [busqueda, setBusqueda] = useState('');

  // ✅ MODIFICADO: el filtro PRINCIPAL ahora es el rango de fechas (inicio/fin).
  const [filterFechaInicio, setFilterFechaInicio] = useState('');
  const [filterFechaFin, setFilterFechaFin] = useState('');
  const [filterRemolque, setFilterRemolque] = useState('');
  const [filterCliente, setFilterCliente] = useState('');
  // ✅ NUEVO: filtro por # DE REFERENCIA (busca en las referencias ya guardadas).
  //   ⚠️ Regla: # referencia y # remolque SOLO funcionan con un rango de fechas.
  const [filterReferencia, setFilterReferencia] = useState('');
  // ✅ NUEVO: filtro por tipo de operación (Transfer / Logística / Fletes).
  const [filterTipoOperacion, setFilterTipoOperacion] = useState('');

  const [paginaActual, setPaginaActual] = useState(1);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(cargarColumnasGuardadas);

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
    tipoOperacion: string;
    remolque: string;
    remolqueNombre: string;
    operador: string;
    operadorNombre: string;
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
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);
  // ✅ NUEVO: buscador dentro del modal "Configurar Columnas".
  const [busquedaColumnas, setBusquedaColumnas] = useState('');

  // ✅ NUEVO: paginación incremental (ya no se usa: se descargan todos por status).
  const [hayMasOperaciones, setHayMasOperaciones] = useState(false);
  const [cargandoMas] = useState(false);

  // ✅ NUEVO: buscador autocompletado de cliente
  const [textoBuscarCliente, setTextoBuscarCliente] = useState('');
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);

  // ✅ NUEVO: buscador autocompletado de remolque (reemplaza el desplegable)
  const [textoBuscarRemolque, setTextoBuscarRemolque] = useState('');
  const [mostrarSugerenciasRemolque, setMostrarSugerenciasRemolque] = useState(false);
  // ✅ NUEVO: filtro por OPERADOR (tipo búsqueda, igual que cliente/remolque).
  const [filterOperador, setFilterOperador] = useState(''); // id del empleado
  const [textoBuscarOperador, setTextoBuscarOperador] = useState('');
  const [mostrarSugerenciasOperador, setMostrarSugerenciasOperador] = useState(false);
  // Normalizador de texto (sin acentos/mayúsculas) y etiqueta del empleado.
  const normalizarTxtOperador = (s: any): string =>
    String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const etiquetaOperador = (emp: any) =>
    `${emp?.firstName || ''} ${emp?.lastNamePaternal || ''} ${emp?.lastNameMaternal || emp?.lastNameMaterno || ''}`.replace(/\s+/g, ' ').trim();

  // ✅ NUEVO: editor integrado (fallback cuando NO se pasa la prop onEditar)
  const [operacionEditando, setOperacionEditando] = useState<any | null>(null);
  const [formEdicion, setFormEdicion] = useState<any>({});
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [pestañaEdicionActiva, setPestañaEdicionActiva] = useState<string>('general');

  // ✅ NUEVO: estado del FormularioOperacion COMPLETO (mismo que Operaciones Activas).
  //   Al editar se abre este formulario en lugar del editor rápido reducido.
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');

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

  // ───────────────────────────────────────────────────────────────────────────
  // ✅ NUEVO: helpers de status y de CONEXIONES con los demás módulos.
  // ───────────────────────────────────────────────────────────────────────────
  const nombreStatusOp = (op: any): string => {
    const r = resolverStatus(op?.status);
    return String(r.nombre || op?.statusNombre || op?.status || '');
  };
  // Una operación completada es "Falso" si su status contiene la palabra "falso".
  const esFalso = (op: any): boolean => nombreStatusOp(op).toLowerCase().includes('falso');

  const tieneDiesel = (op: any): boolean => !!(op?.referenciaDieselConsecutivo || op?.referenciaDieselId);
  const tieneNomina = (op: any): boolean => !!(op?.referenciaNominaConsecutivo || op?.referenciaNominaId);
  const facturadoCliente = (op: any): boolean => !!(op?.facturaClienteInvoice || op?.facturaClienteId || op?.facturado);
  const facturadoProveedor = (op: any): boolean => !!(op?.facturaProveedorFolio || op?.facturaProveedorId || op?.facturadoProveedor);

  // Píldora reutilizable para mostrar una conexión (ref / invoice) en la tabla.
  const chipConexion = (texto: string, color: string) => (
    <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 'bold', color, border: `1px solid ${color}`, backgroundColor: `${color}1a`, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{texto}</span>
  );

  // ✅ MODIFICADO: clave de caché ÚNICA (todos los completados). Filtramos en memoria.
  const claveCacheActual = () => CACHE_KEY_TODOS;

  // ✅ REESCRITO: descarga TODOS los servicios completados (status c2d57403 y
  //   f557b751) paginando por status. NO depende de índices compuestos ni del
  //   formato de fechaServicio. La fecha y el cliente se filtran EN MEMORIA
  //   (ver operacionesFiltradas) usando normalizarFechaServicioISO.
  //
  //   Por qué: los registros migrados guardan fechaServicio en formatos que la
  //   consulta por rango de Firestore no reconoce (devolvía 0). Al traer todos
  //   los completados y filtrar la fecha en memoria, siempre aparecen.
  const descargarOperaciones = async (
    fechaInicio: string,
    fechaFin: string,
    _clienteId: string,
    opciones: { ignorarCache?: boolean } = {}
  ) => {
    setHayMasOperaciones(false);

    // Se mantiene el requisito de elegir rango para mostrar la tabla.
    if (!fechaInicio || !fechaFin) {
      setOperacionesGlobales([]);
      return;
    }

    // [0] Caché (mismo dataset completo para cualquier rango/cliente).
    //     ✅ VELOCIDAD: primero MEMORIA (sin límite de cuota — el sessionStorage
    //     falla en silencio cuando el dataset excede ~5MB y por eso cada
    //     búsqueda volvía a descargar todo). Luego sessionStorage como respaldo.
    if (!opciones.ignorarCache) {
      const enMemoria = obtenerCacheMemoria<(Record<string, unknown> & { id: string })[]>(CACHE_KEY_TODOS, CACHE_TTL_MS);
      if (enMemoria) {
        setOperacionesGlobales(enMemoria);
        setHayMasOperaciones(false);
        return;
      }
      try {
        const cacheStr = almacenSesion.getItem(CACHE_KEY_TODOS);
        if (cacheStr) {
          const cache = JSON.parse(cacheStr);
          if (cache && Date.now() - cache.ts < CACHE_TTL_MS && Array.isArray(cache.ops)) {
            guardarCacheMemoria(CACHE_KEY_TODOS, cache.ops);
            setOperacionesGlobales(cache.ops);
            setHayMasOperaciones(false);
            return;
          }
        }
      } catch { /* caché corrupto: ignorar */ }
    }

    setCargandoOperaciones(true);

    const todas: any[] = [];
    const vistos = new Set<string>();

    try {
      // Por cada status permitido, paginamos por documentId hasta traerlos todos.
      for (const statusVal of STATUS_COMPLETADOS_VALORES) {
        let cursor: any = null;
        let intentoSimple = false;

        for (let pagina = 0; pagina < 60; pagina++) {
          let snap;
          try {
            const partes: any[] = [where('status', '==', statusVal), orderBy(documentId()), limit(TAMANIO_BLOQUE_STATUS)];
            if (cursor) partes.splice(2, 0, startAfter(cursor));
            snap = await getDocs(query(collection(db, 'operaciones'), ...partes));
          } catch (errPag) {
            // Si orderBy(documentId) fallara por índice, traemos un bloque grande
            // sin paginar (último recurso) y salimos del bucle de este status.
            console.warn('[ServiciosCompletados] Paginación por documentId no disponible; uso bloque simple.', errPag);
            intentoSimple = true;
            break;
          }

          snap.docs.forEach((d: any) => {
            const id = d.id;
            if (!vistos.has(id)) { vistos.add(id); const data = d.data(); todas.push({ id, ...data, _fechaISO: normalizarFechaServicioISO(data.fechaServicio) }); }
          });

          if (snap.docs.length < TAMANIO_BLOQUE_STATUS) break;     // ya no hay más
          cursor = snap.docs[snap.docs.length - 1];
        }

        if (intentoSimple) {
          const snapSimple = await getDocs(query(
            collection(db, 'operaciones'),
            where('status', '==', statusVal),
            limit(8000)
          ));
          snapSimple.docs.forEach((d: any) => {
            const id = d.id;
            if (!vistos.has(id)) { vistos.add(id); const data = d.data(); todas.push({ id, ...data, _fechaISO: normalizarFechaServicioISO(data.fechaServicio) }); }
          });
        }
      }

      // Seguridad: dejar ESTRICTAMENTE solo los 2 status permitidos.
      const soloCompletados = todas.filter((op: any) =>
        STATUS_COMPLETADOS_VALORES.includes(String(op.status || '').trim())
      );

      // Orden por fecha (normalizada) descendente, desempatando por consecutivo.
      soloCompletados.sort((a: any, b: any) => {
        const fa = a._fechaISO || '';
        const fb = b._fechaISO || '';
        if (fa !== fb) return fb.localeCompare(fa);
        return obtenerConsecutivoRef(b) - obtenerConsecutivoRef(a);
      });

      setOperacionesGlobales(soloCompletados);
      setHayMasOperaciones(false);

      guardarCacheMemoria(CACHE_KEY_TODOS, soloCompletados);
      try {
        almacenSesion.setItem(CACHE_KEY_TODOS, JSON.stringify({ ts: Date.now(), ops: soloCompletados }));
      } catch { /* cuota agotada: ignorar (la memoria ya lo tiene) */ }

      console.log(`[ServiciosCompletados v3] descargados ${soloCompletados.length} completados (status ${STATUS_COMPLETADOS_VALORES.join(' / ')}). Filtro de fecha aplicado en memoria.`);
    } catch (e: any) {
      console.error('[ServiciosCompletados] Error al descargar completados:', e);
      alert(`No se pudieron cargar las operaciones completadas.\n\nDetalle: ${e?.message || e}`);
    }

    setCargandoOperaciones(false);
  };

  // ✅ MODIFICADO: ya no se usa (se descargan todos por status). Se deja como
  //   no-op por compatibilidad con el botón "Cargar más" (que ya no se muestra).
  const cargarMasOperaciones = async () => {
    return;
  };

  // ✅ Catálogos en tiempo real vía onSnapshot.
  const COLECCIONES_CATALOGOS: Record<string, string> = {
    empresas: 'empresas',
    tiposOperacion: 'catalogo_tipo_operacion',
    embalajes: 'catalogo_embalaje',
    remolques: 'remolques',
    tarifas: 'catalogo_tarifas_referencia',
    conveniosProv: 'convenios_proveedores',
    catalogoConvProvDetalles: 'convenios_proveedores_detalles',
    catalogoTC: 'tipo_cambio',
    catalogoConvClientes: 'convenios_clientes',
    catalogoConvDetalles: 'convenios_clientes_detalles',
    unidades: 'unidades',
    empleados: 'empleados',
    statusServicio: 'catalogo_status_servicio',
    unidades_proveedor: 'unidades_proveedor',
    proveedores_unidad: 'proveedores_unidad',
    catalogoMoneda: 'catalogo_moneda',
  };

  const suscribirCatalogosEnVivo = () => {
    return Object.entries(COLECCIONES_CATALOGOS).map(([alias, coleccion]) =>
      onSnapshot(
        collection(db, coleccion),
        (snap) => {
          const data = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          setCatalogosGlobales((prev: any) => ({ ...prev, [alias]: data }));
        },
        (error) => console.error(`Error escuchando catálogo "${coleccion}":`, error)
      )
    );
  };

  // Se conserva como no-op para no tocar los puntos donde se invocaba antes.
  const cargarCatalogosSiEsNecesario = async () => {};

  useEffect(() => {
    const unsubscribers = suscribirCatalogosEnVivo();
    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  // ✅ OPTIMIZACIÓN: el conjunto descargado (TODOS los completados) NO depende de
  //   los filtros — fecha, cliente, tipo y remolque se aplican en memoria. Por eso
  //   sólo descargamos UNA vez por sesión: en cuanto hay un rango de fechas válido.
  //   Cambiar cualquier filtro después es instantáneo (no vuelve a consultar la BD).
  const yaDescargado = useRef(false);

  // ✅ MODIFICADO: ya NO se descarga automáticamente al cambiar las fechas.
  //   La descarga y la aplicación de filtros ocurren SOLO al presionar BUSCAR.
  //   El rango de fechas (inicio + fin) es el requisito mínimo del botón.
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
      tipoOperacion: filterTipoOperacion,
      remolque: filterRemolque,
      remolqueNombre: nombreRemolqueSeleccionado,
      operador: filterOperador,
      operadorNombre: nombreOperadorSeleccionado,
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
      descargarOperaciones(filterFechaInicio, filterFechaFin, filterCliente);
    }
    // ✅ HISTORIAL: deja constancia de la búsqueda y de los filtros usados.
    registrarLog('Servicios Completados', 'Búsqueda', `Buscó operaciones completadas con filtros → ${describirFiltrosLog(snapshot)}`).catch(() => {});
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
    setFilterOperador('');
    setTextoBuscarOperador('');
    setFilterReferencia('');
    setFilterTipoOperacion('');
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
      setFilterTipoOperacion(f.tipoOperacion || '');
      setFilterRemolque(f.remolque || '');
      setFilterOperador(f.operador || '');
      setFilterReferencia(f.referencia || '');
      setBusqueda(f.busqueda || '');
      setFiltrosAplicados({
        fechaInicio: f.fechaInicio,
        fechaFin: f.fechaFin,
        cliente: f.cliente || '',
        clienteNombre: f.clienteNombre || '',
        tipoOperacion: f.tipoOperacion || '',
        remolque: f.remolque || '',
        remolqueNombre: f.remolqueNombre || '',
        operador: f.operador || '',
        operadorNombre: f.operadorNombre || '',
        referencia: f.referencia || '',
        busqueda: f.busqueda || '',
      });
      if (!yaDescargado.current) {
        yaDescargado.current = true;
        descargarOperaciones(f.fechaInicio, f.fechaFin, f.cliente || '');
      }
    } catch { /* filtro guardado corrupto: ignorar */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ NUEVO: cuántos filtros están definidos en el panel (para el contador del botón).
  const contadorFiltrosActivos = [filterFechaInicio || filterFechaFin, filterCliente, filterRemolque, filterOperador, filterReferencia.trim(), filterTipoOperacion, busqueda.trim()].filter(Boolean).length;

  // ✅ NUEVO: chips con el resumen del último criterio buscado.
  const resumenFiltrosChips = useMemo(() => {
    if (!filtrosAplicados) return [] as string[];
    const chips: string[] = [`${filtrosAplicados.fechaInicio} → ${filtrosAplicados.fechaFin}`];
    if (filtrosAplicados.cliente) chips.push(`Cliente: ${filtrosAplicados.clienteNombre || filtrosAplicados.cliente}`);
    if (filtrosAplicados.tipoOperacion) chips.push(`Tipo: ${filtrosAplicados.tipoOperacion}`);
    if (filtrosAplicados.remolque) chips.push(`Remolque: ${filtrosAplicados.remolqueNombre || filtrosAplicados.remolque}`);
    if (filtrosAplicados.operador) chips.push(`Operador: ${filtrosAplicados.operadorNombre || filtrosAplicados.operador}`);
    if ((filtrosAplicados.referencia || '').trim()) chips.push(`# Referencia: "${filtrosAplicados.referencia.trim()}"`);
    if (filtrosAplicados.busqueda.trim()) chips.push(`Ref: "${filtrosAplicados.busqueda.trim()}"`);
    return chips;
  }, [filtrosAplicados]);

  // ✅ NUEVO: fuerza una recarga desde Firestore (ignora caché). Para el botón "Actualizar".
  const refrescarDatos = () => {
    if (!filtrosAplicados) {
      alert('Primero realiza una búsqueda con Fecha Inicio y Fecha Fin.');
      return;
    }
    limpiarCacheMemoria(CACHE_KEY_TODOS);
    try { almacenSesion.removeItem(CACHE_KEY_TODOS); } catch { /* ignorar */ }
    yaDescargado.current = true;
    descargarOperaciones(filtrosAplicados.fechaInicio, filtrosAplicados.fechaFin, filtrosAplicados.cliente, { ignorarCache: true });
  };

  useEffect(() => { setPaginaActual(1); }, [filtrosAplicados]);

  // ✅ NUEVO: cada vez que cambian las columnas (orden o visibilidad), se guardan
  //   en localStorage para que la configuración se mantenga al recargar la página.
  useEffect(() => {
    try {
      localStorage.setItem(
        COLUMNAS_STORAGE_KEY,
        JSON.stringify(columnasTabla.map(c => ({ id: c.id, visible: c.visible })))
      );
    } catch { /* almacenamiento lleno o no disponible: ignorar */ }
  }, [columnasTabla]);

  useEffect(() => {
    const cargarBotones = async () => {
      if (operacionViendo) {
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
  }, [operacionViendo, mapaStatus]);

  const mostrarDato = (text: any) => (text && text !== '' ? text : '-');
  
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

  const abrirRegistroHorario = () => {
    // ✅ FIX: hora local real del dispositivo (o de la zona fija configurada),
    //    sin el truco de tzOffset que dependía del UTC.
    const localISOTime = ahoraLocalISOCorto();
    setNuevaFechaHora(localISOTime);
    setNuevoStatus(botonesDisponibles[0] || '');
    setModalHorarios('registrar');
  };

  const aplicarStatusEnMemoria = (opId: string, statusId: string, statusNombre: string) => {
    setOperacionesGlobales(prev => {
      const next = prev.map((o: any) => (o.id === opId ? { ...o, status: statusId, statusNombre } : o));
      if (filtrosAplicados) {
        guardarCacheMemoria(claveCacheActual(), next);
        try { almacenSesion.setItem(claveCacheActual(), JSON.stringify({ ts: Date.now(), ops: next })); } catch { /* ignorar */ }
      }
      return next;
    });
    setOperacionViendo((prev: any) => (prev && prev.id === opId ? { ...prev, status: statusId, statusNombre } : prev));
  };

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
      registrarLog('Servicios Completados', 'Edición', `Cambió el status de la operación ${refLogH}: "${statusAnteriorH}" → "${statusNombreResuelto}" (horario del evento: ${nuevaFechaHora})`).catch(() => {});

      aplicarStatusEnMemoria(operacionViendo.id, statusId, statusNombreResuelto);
      alert('Horario registrado y Estatus actualizado.');
      setModalHorarios('cerrado');
    } catch (e) {
      console.error('[ServiciosCompletados] Error guardarHorario:', e);
      alert('Error al actualizar la base de datos.');
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

      aplicarStatusEnMemoria(operacionViendo.id, statusFinal.id, statusFinal.nombre);

      obtenerBotonesHorarioDinamicos({ ...operacionViendo, status: statusFinal.id, statusNombre: statusFinal.nombre })
        .then(botones => setBotonesDisponibles(botones || []))
        .catch(() => {});

      // ✅ FIX: hora local consistente (ver src/utils/fechaHoraLocal.ts).
      const fechaHoraLocal = ahoraLocalISOCorto();
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
      registrarLog('Servicios Completados', 'Edición', `Cambió el status de la operación ${refLogR}: "${statusAnteriorR}" → "${statusFinal.nombre}"${cascadaTxt}`).catch(() => {});

      setGuardandoStatusRapido(null);
      setUltimoStatusGuardado(statusNombre);
      setTimeout(() => setUltimoStatusGuardado(null), 1500);
    } catch (e: any) {
      console.error('[ServiciosCompletados] Error al registrar status:', e);
      setOperacionViendo(operacionPrevia);
      setOperacionesGlobales(operacionesPrevias);
      setBotonesDisponibles(botonesPrevios);
      setGuardandoStatusRapido(null);
      alert('Error al guardar el status. Se revirtió el cambio.');
    }
  };

  const handleDescSolicitudRetiro = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origen = mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor 
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
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
    const tipoOpNombre = operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion');

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
      tipoServicio: `${tipoOpNombre} ${operacionViendo.trafico || ''}`,
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
      origenCiudad: 'N/A', 
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: 'N/A', origenColonia: 'N/A', origenCP: 'N/A',
      destinoCiudad: 'N/A', 
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: 'N/A', destinoColonia: 'N/A', destinoCP: 'N/A',
    });
  };

  const handleEditarOperacion = (op: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!op) return;
    if (onEditar) {
      onEditar(op);
      return;
    }
    setOperacionViendo(null);
    setOperacionEditando(op);
    setEstadoFormulario('abierto');
  };

  const handleOperacionGuardada = () => {
    if (filtrosAplicados) {
      descargarOperaciones(filtrosAplicados.fechaInicio, filtrosAplicados.fechaFin, filtrosAplicados.cliente, { ignorarCache: true });
    }
    setEstadoFormulario('cerrado');
    setOperacionEditando(null);
  };

  const actualizarCampoEdicion = (campo: string, valor: any) => {
    setFormEdicion((prev: any) => {
      const next = { ...prev, [campo]: valor };
      const num = (v: any) => Number(v) || 0;
      if (campo === 'montoConvenioCliente' || campo === 'cargosAdicionales') {
        next.subtotalCliente = num(next.montoConvenioCliente) + num(next.cargosAdicionales);
      }
      if (campo === 'totalAPagarProv' || campo === 'cargosAdicionalesProv') {
        next.subtotalProv = num(next.totalAPagarProv) + num(next.cargosAdicionalesProv);
      }
      if (campo === 'sueldoOperador' || campo === 'sueldoExtra') {
        next.sueldoTotal = num(next.sueldoOperador) + num(next.sueldoExtra);
      }
      if (campo === 'combustible' || campo === 'combustibleExtra') {
        next.combustibleTotal = num(next.combustible) + num(next.combustibleExtra);
      }
      return next;
    });
  };

  const guardarEdicion = async () => {
    if (!operacionEditando?.id) return;
    setGuardandoEdicion(true);
    try {
      const camposEditables = [
        'refCliente', 'fechaServicio', 'fechaCita', 'trafico', 'observacionesEjecutivo',
        'clienteMercanciaNombre', 'descripcionMercancia', 'cantidad', 'embalajeNombre', 'pesoKg',
        'numDoda', 'fechaEmisionDoda',
        'numeroEntrys', 'cantEntrys', 'numManifiesto', 'provServiciosNombre', 'montoManifiesto',
        'totalAPagarProv', 'cargosAdicionalesProv', 'subtotalProv',
        'sueldoOperador', 'sueldoExtra', 'sueldoTotal',
        'combustible', 'combustibleExtra', 'combustibleTotal',
        'unidadProveedor', 'operadorProveedor', 'observacionesUnidad',
        'montoConvenioCliente', 'cargosAdicionales', 'subtotalCliente',
        'tipoCambioAprobado', 'observacionesCobrar'
      ];

      const payload: any = {};
      camposEditables.forEach((c) => {
        if (formEdicion[c] !== undefined) payload[c] = formEdicion[c];
      });

      await updateDoc(doc(db, 'operaciones', operacionEditando.id), payload);

      // ✅ HISTORIAL: qué campos cambió, valores anterior → nuevo.
      const refLog = operacionEditando.ref || operacionEditando.id?.substring(0, 6) || operacionEditando.id;
      registrarLog('Servicios Completados', 'Edición', `Editó la operación ${refLog}. Cambios → ${describirCambiosLog(payload, operacionEditando)}`).catch(() => {});

      const aplicar = (o: any) => (o.id === operacionEditando.id ? { ...o, ...payload } : o);
      const nuevasGlobales = operacionesGlobales.map(aplicar);
      setOperacionesGlobales(nuevasGlobales);
      if (operacionViendo?.id === operacionEditando.id) {
        setOperacionViendo({ ...operacionViendo, ...payload });
      }

      if (filtrosAplicados) {
        try {
          almacenSesion.setItem(
            claveCacheActual(),
            JSON.stringify({ ts: Date.now(), ops: nuevasGlobales })
          );
        } catch { /* ignorar */ }
      }

      setOperacionEditando(null);
      setFormEdicion({});
    } catch (err: any) {
      console.error('[ServiciosCompletados] Error al guardar la edición:', err);
      alert(`No se pudieron guardar los cambios.\n\nDetalle: ${err?.message || err}`);
    }
    setGuardandoEdicion(false);
  };

  const handleEliminarOperacion = async (op: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!op?.id) return;

    const refTxt = op.ref || op.id?.substring(0, 6) || op.id;
    const confirmar = window.confirm(
      `¿Eliminar permanentemente la operación ${refTxt}?\n\nEsta acción NO se puede deshacer.`
    );
    if (!confirmar) return;

    try {
      await deleteDoc(doc(db, 'operaciones', op.id));

      // ✅ HISTORIAL: constancia de la eliminación con los datos clave del registro.
      registrarLog('Servicios Completados', 'Eliminación', `Eliminó la operación ${refTxt} (Fecha servicio: ${truncarValorLog(op.fechaServicio)}, Cliente: ${truncarValorLog(op.clienteNombre || op.nombreCliente || op.clientePaga)}, Status: ${truncarValorLog(op.statusNombre || op.status)})`).catch(() => {});

      const restantes = operacionesGlobales.filter((o: any) => o.id !== op.id);
      setOperacionesGlobales(restantes);
      if (operacionViendo?.id === op.id) setOperacionViendo(null);
      if (filtrosAplicados) {
        try {
          almacenSesion.setItem(
            claveCacheActual(),
            JSON.stringify({ ts: Date.now(), ops: restantes })
          );
        } catch { /* cuota agotada: ignorar */ }
      }
    } catch (err: any) {
      console.error('[ServiciosCompletados] Error al eliminar la operación:', err);
      alert(`No se pudo eliminar la operación.\n\nDetalle: ${err?.message || err}`);
    }
  };

  const obtenerConsecutivoRef = (op: any): number => {
    const ref = String(op?.ref || '');
    const m = ref.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  };

  // ✅ NUEVO: clasifica el tipo de operación (transfer / fletes / logistica) a
  //   partir del nombre desnormalizado o del catálogo. Se usa en el filtro nuevo.
  const tipoOpTexto = (op: any): string => String(
    op?.tipoOperacionNombre ||
    mostrarDatoMapeado(op?.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op?.tipoOperacionNombre) ||
    ''
  ).toLowerCase();

  const coincideTipoOperacion = (op: any, filtro: string): boolean => {
    if (!filtro) return true;
    const t = tipoOpTexto(op);
    if (filtro === 'transfer') return t.includes('transfer');
    if (filtro === 'fletes') return t.includes('flete');
    if (filtro === 'logistica') return t.includes('logistica') || t.includes('logística');
    return true;
  };

  // ✅ MODIFICADO: el filtro de RANGO DE FECHAS ahora se aplica AQUÍ, en memoria,
  //   usando normalizarFechaServicioISO. Así funciona aunque fechaServicio venga
  //   como Timestamp, "DD/MM/YYYY", etc. (antes el filtro fallaba y salía vacío).
  // ✅ MODIFICADO: la tabla se filtra con el SNAPSHOT de filtros congelado al
  //   presionar BUSCAR (filtrosAplicados), no con los campos en vivo de la barra.
  const operacionesFiltradas = useMemo(() => {
    if (!filtrosAplicados) return [];
    const { fechaInicio: fIni, fechaFin: fFin, cliente: fCliente, tipoOperacion: fTipoOp, remolque: fRemolque, operador: fOperador, referencia: fReferencia, busqueda: fBusqueda } = filtrosAplicados;

    let filtradas = operacionesGlobales;

    // Filtro por rango de fechas (robusto a distintos formatos).
    //   Usa _fechaISO precalculado en la descarga; si viniera de un caché antiguo
    //   sin ese campo, cae a normalizar al vuelo.
    filtradas = filtradas.filter(op => {
      const f = op._fechaISO != null ? op._fechaISO : normalizarFechaServicioISO(op.fechaServicio);
      if (!f) return false;
      return f >= fIni && f <= fFin;
    });

    if (fCliente) {
      filtradas = filtradas.filter(op => String(op.clientePaga || op.clienteId || '') === fCliente);
    }

    // ✅ NUEVO: filtro por tipo de operación (Transfer / Logística / Fletes).
    if (fTipoOp) {
      filtradas = filtradas.filter(op => coincideTipoOperacion(op, fTipoOp));
    }

    if (fRemolque) {
      filtradas = filtradas.filter(op => String(op.numeroRemolque || '') === fRemolque || String(op.remolqueNombre || '').toLowerCase().includes(fRemolque.toLowerCase()));
    }

    // ✅ NUEVO: filtro por # DE REFERENCIA. Busca coincidencia (parcial) en las
    //   referencias YA GUARDADAS dentro del rango de fechas aplicado arriba.
    if ((fReferencia || '').trim()) {
      const r = fReferencia.trim().toLowerCase();
      filtradas = filtradas.filter(op =>
        `${op.ref || ''} ${op.numReferencia || ''} ${op.referencia || ''}`.toLowerCase().includes(r)
      );
    }

    // ✅ NUEVO: filtro por OPERADOR. Cruza por ID del empleado (op.operador /
    //   op.operadorId) y, como respaldo, por nombre normalizado con tolerancia
    //   al apellido materno (las operaciones pueden traer el nombre completo).
    if (fOperador) {
      const empSel = (catalogosGlobales.empleados || []).find((x: any) => String(x.id) === String(fOperador));
      const nombreSel = normalizarTxtOperador(empSel ? `${empSel.firstName || ''} ${empSel.lastNamePaternal || ''}` : '');
      const nombreSelCompleto = normalizarTxtOperador(empSel ? `${empSel.firstName || ''} ${empSel.lastNamePaternal || ''} ${empSel.lastNameMaternal || empSel.lastNameMaterno || ''}` : '');
      filtradas = filtradas.filter(op => {
        const idsOp = [op.operador, op.operadorId].map(v => String(v || '')).filter(Boolean);
        if (idsOp.includes(String(fOperador))) return true;
        const n = normalizarTxtOperador(op.operadorNombre);
        if (!n || !nombreSel) return false;
        return n === nombreSel || (nombreSelCompleto && n === nombreSelCompleto) || n.startsWith(nombreSel + ' ') || nombreSel.startsWith(n + ' ');
      });
    }

    if (fBusqueda.trim()) {
      const b = fBusqueda.toLowerCase();
      filtradas = filtradas.filter(op => {
        return (
          String(op.ref || op.id || '').toLowerCase().includes(b) ||
          String(op.fechaServicio || '').toLowerCase().includes(b) ||
          String(op.clienteNombre || op.nombreCliente || '').toLowerCase().includes(b) ||
          String(op.tipoOperacionNombre || op.tipoServicio || '').toLowerCase().includes(b) ||
          String(op.trafico || '').toLowerCase().includes(b) ||
          String(op.statusNombre || op.status || '').toLowerCase().includes(b)
        );
      });
    }

    return [...filtradas].sort((a: any, b2: any) => {
      const fa = a._fechaISO != null ? a._fechaISO : normalizarFechaServicioISO(a.fechaServicio);
      const fb = b2._fechaISO != null ? b2._fechaISO : normalizarFechaServicioISO(b2.fechaServicio);
      if (fa !== fb) return fb.localeCompare(fa);
      return obtenerConsecutivoRef(b2) - obtenerConsecutivoRef(a);
    });
  }, [filtrosAplicados, operacionesGlobales, catalogosGlobales]);

  // ✅ NUEVO: valor de una celda para ORDENAR. Espeja renderCellContent pero
  //   devuelve texto plano; las fechas usan el valor ISO normalizado para que
  //   el orden sea cronológico sin importar el formato guardado.
  const valorOrdenColumna = (op: any, colId: string): string => {
    const limpiar = (v: any): string => {
      const s = String(v ?? '').trim();
      return s === '-' ? '' : s;
    };
    switch (colId) {
      case 'ref': return limpiar(op.ref || op.id?.substring(0, 6));
      case 'fechaServicio': return limpiar(op._fechaISO != null ? op._fechaISO : normalizarFechaServicioISO(op.fechaServicio));
      case 'fechaCita': return limpiar(op.fechaCita);
      case 'tipoOperacion': return limpiar(mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre));
      case 'status': return limpiar(mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre));
      case 'refDiesel': return limpiar(op.referenciaDieselConsecutivo);
      case 'refNomina': return limpiar(op.referenciaNominaConsecutivo);
      case 'invoiceCliente': return limpiar((op.facturaClienteInvoice || op.facturado) ? (op.facturaClienteInvoice || 'Facturada') : '');
      case 'invoiceProveedor': return limpiar((op.facturaProveedorFolio || op.facturadoProveedor) ? (op.facturaProveedorFolio || 'Facturada') : '');
      case 'trafico': return limpiar(op.trafico);
      case 'cliente': return limpiar(mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente));
      case 'convenioTarifa': return limpiar(obtenerNombreConvenioCliente(op.convenio, op.convenioNombre));
      case 'refCliente': return limpiar(op.refCliente);
      case 'facturadoEnCobrar': return limpiar(mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre));
      case 'montoConvenioCliente': return limpiar(op.montoConvenioCliente);
      case 'cargosAdicionales': return limpiar(op.cargosAdicionales);
      case 'subtotal': return limpiar(op.subtotalCliente);
      case 'tipoCambioAprobado': return limpiar(op.tipoCambioAprobado);
      case 'dolaresCliente': return limpiar(op.dolaresCliente);
      case 'pesosCliente': return limpiar(op.pesosCliente);
      case 'conversionCliente': return limpiar(op.conversionCliente);
      case 'origen': return limpiar(mostrarDatoMapeado(op.origen, 'empresas', 'nombre', op.origenNombre));
      case 'destino': return limpiar(mostrarDatoMapeado(op.destino, 'empresas', 'nombre', op.destinoNombre));
      case 'remolque': return limpiar(mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre));
      case 'proveedor': return limpiar(mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre));
      case 'unidadProveedor': return limpiar(mostrarDatoMapeado(op.unidadProveedor, 'unidades_proveedor', 'numeroUnidad', op.unidadProveedorNombre));
      case 'operadorProveedor': return limpiar(mostrarDatoMapeado(op.operadorProveedor, 'proveedores_unidad', 'nombre', op.operadorProveedorNombre));
      case 'convenioProv': return limpiar(obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre));
      case 'facturadoEnUnidad': return limpiar(mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre));
      case 'monedaConvenioProv': return limpiar(mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre));
      case 'totalAPagarProv': return limpiar(op.totalAPagarProv);
      case 'cargosAdicionalesProv': return limpiar(op.cargosAdicionalesProv);
      case 'subtotalProv': return limpiar(op.subtotalProv);
      case 'dolaresProv': return limpiar(op.dolaresProv);
      case 'pesosProv': return limpiar(op.pesosProv);
      case 'conversionProv': return limpiar(op.conversionProv);
      case 'unidad': return limpiar(mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre));
      case 'operador': return limpiar(mostrarDatoMapeado(op.operador, 'empleados', 'nombre', op.operadorNombre));
      case 'sueldoOperador': return limpiar(op.sueldoOperador);
      case 'sueldoExtra': return limpiar(op.sueldoExtra);
      case 'sueldoTotal': return limpiar(op.sueldoTotal);
      case 'combustible': return limpiar(op.combustible);
      case 'combustibleExtra': return limpiar(op.combustibleExtra);
      case 'combustibleTotal': return limpiar(op.combustibleTotal);
      case 'clienteMercancia': return limpiar(mostrarDatoMapeado(op.clienteMercancia, 'empresas', 'nombre', op.clienteMercanciaNombre));
      case 'descripcionMercancia': return limpiar(op.descripcionMercancia);
      case 'cantidad': return limpiar(op.cantidad);
      case 'embalaje': return limpiar(mostrarDatoMapeado(op.embalaje, 'embalajes', 'clave', op.embalajeNombre));
      case 'pesoKg': return limpiar(op.pesoKg);
      case 'numDoda': return limpiar(op.numDoda);
      case 'fechaEmisionDoda': return limpiar(op.fechaEmisionDoda);
      case 'numeroEntrys': return limpiar(op.numeroEntrys);
      case 'cantEntrys': return limpiar(op.cantEntrys);
      case 'numManifiesto': return limpiar(op.numManifiesto);
      case 'provServicios': return limpiar(mostrarDatoMapeado(op.provServicios, 'empresas', 'nombre', op.provServiciosNombre));
      case 'montoManifiesto': return limpiar(op.montoManifiesto);
      case 'totalGastos': return limpiar(op.totalGastos);
      case 'utilidadEstimada': return limpiar(op.utilidadEstimada);
      case 'observacionesEjecutivo': return limpiar(op.observacionesEjecutivo);
      case 'observacionesUnidad': return limpiar(op.observacionesUnidad);
      case 'observacionesCobrar': return limpiar(op.observacionesCobrar);
      default: return '';
    }
  };

  // ✅ NUEVO: comparador tolerante — numérico cuando ambos valores son números
  //   (montos, cantidades) y alfabético con colación española en el resto.
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
      const vaVacio = va === '';
      const vbVacio = vb === '';
      if (vaVacio && vbVacio) return 0;
      if (vaVacio) return 1;   // vacíos siempre al final
      if (vbVacio) return -1;
      return compararValoresOrden(va, vb) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesFiltradas, ordenColumna, ordenDireccion, catalogosGlobales]);

  const resumenServicios = useMemo(() => {
    const base = operacionesFiltradas;
    const total = base.length;
    let falsos = 0, factCliente = 0, factProveedor = 0, conDiesel = 0, conNomina = 0;
    base.forEach((op: any) => {
      if (esFalso(op)) falsos++;
      if (facturadoCliente(op)) factCliente++;
      if (facturadoProveedor(op)) factProveedor++;
      if (tieneDiesel(op)) conDiesel++;
      if (tieneNomina(op)) conNomina++;
    });
    const completados = total - falsos;
    return {
      total, completados, falsos,
      factCliente, pendCliente: total - factCliente,
      factProveedor, pendProveedor: total - factProveedor,
      conDiesel, conNomina,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesFiltradas, mapaStatus]);

  const totalPaginas = Math.ceil(operacionesOrdenadas.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const operacionesEnPantalla = operacionesOrdenadas.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

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

  // ✅ NUEVO: lista filtrada de remolques para el buscador (nombre o placa).
  const etiquetaRemolque = (rem: any) => `${rem?.nombre || ''} ${rem?.placas || rem?.placa || ''}`.trim();

  // ✅ NUEVO (filtro operador): buscador de empleados para las sugerencias.
  const operadoresFiltradosBuscador = useMemo(() => {
    const lista = (catalogosGlobales.empleados || []) as any[];
    const ordenados = lista
      .filter((e: any) => etiquetaOperador(e))
      .sort((a: any, b: any) => etiquetaOperador(a).localeCompare(etiquetaOperador(b), 'es', { sensitivity: 'base' }));
    if (!textoBuscarOperador.trim()) return ordenados.slice(0, 30);
    const q = normalizarTxtOperador(textoBuscarOperador);
    return ordenados.filter((e: any) => normalizarTxtOperador(etiquetaOperador(e)).includes(q)).slice(0, 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogosGlobales.empleados, textoBuscarOperador]);

  const nombreOperadorSeleccionado = useMemo(() => {
    if (!filterOperador || !catalogosGlobales.empleados) return '';
    const e = (catalogosGlobales.empleados as any[]).find((x: any) => String(x.id) === String(filterOperador));
    return e ? (etiquetaOperador(e) || filterOperador) : filterOperador;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterOperador, catalogosGlobales.empleados]);

  const remolquesFiltradosBuscador = useMemo(() => {
    const lista = (catalogosGlobales.remolques || []) as any[];
    const ordenados = [...lista].sort((a: any, b: any) =>
      etiquetaRemolque(a).localeCompare(etiquetaRemolque(b), 'es', { sensitivity: 'base' })
    );
    if (!textoBuscarRemolque.trim()) return ordenados.slice(0, 30);
    const q = textoBuscarRemolque.toLowerCase().trim();
    return ordenados.filter((r: any) => etiquetaRemolque(r).toLowerCase().includes(q)).slice(0, 30);
  }, [catalogosGlobales.remolques, textoBuscarRemolque]);

  const nombreRemolqueSeleccionado = useMemo(() => {
    if (!filterRemolque || !catalogosGlobales.remolques) return '';
    const r = catalogosGlobales.remolques.find((x: any) => x.id === filterRemolque);
    return r ? (etiquetaRemolque(r) || filterRemolque) : filterRemolque;
  }, [filterRemolque, catalogosGlobales.remolques]);

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
      case 'fechaServicio': return <span className="sc-x1">{mostrarDato(op.fechaServicio)}</span>;
      case 'fechaCita': return <span className="sc-x1">{formatearFechaHora(op.fechaCita)}</span>;
      case 'tipoOperacion': {
        const nombreTipoOp = mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre);
        return <span style={{ color: colorTipoOperacion(nombreTipoOp), fontWeight: 'bold' }}>{nombreTipoOp}</span>;
      }
      case 'status': return <span className="sc-x2">{mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre)}</span>;
      case 'refDiesel': return op.referenciaDieselConsecutivo ? chipConexion(op.referenciaDieselConsecutivo, '#f59e0b') : <span className="sc-x3">-</span>;
      case 'refNomina': return op.referenciaNominaConsecutivo ? chipConexion(op.referenciaNominaConsecutivo, '#a371f7') : <span className="sc-x3">-</span>;
      case 'invoiceCliente': return (op.facturaClienteInvoice || op.facturado) ? chipConexion(op.facturaClienteInvoice || 'Facturada', '#10b981') : <span className="sc-x3">-</span>;
      case 'invoiceProveedor': return (op.facturaProveedorFolio || op.facturadoProveedor) ? chipConexion(op.facturaProveedorFolio || 'Facturada', '#58a6ff') : <span className="sc-x3">-</span>;
      case 'trafico': return <span className="sc-x1">{mostrarDato(op.trafico)}</span>;
      case 'cliente': return <span className="sc-x4">{mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente)}</span>;
      case 'convenioTarifa': return <span className="sc-x5" title={obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}>{obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}</span>;
      case 'refCliente': return <span className="sc-x1">{mostrarDato(op.refCliente)}</span>;
      case 'facturadoEnCobrar': return <span className="sc-x1">{mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre)}</span>;
      case 'montoConvenioCliente': return <span className="sc-x1">{formatoMoneda(op.montoConvenioCliente)}</span>;
      case 'cargosAdicionales': return <span className="sc-x1">{formatoMoneda(op.cargosAdicionales)}</span>;
      case 'subtotal': return <span className="sc-x6">{formatoMoneda(op.subtotalCliente)}</span>;
      case 'tipoCambioAprobado': return <span className="sc-x1">{mostrarDato(op.tipoCambioAprobado)}</span>;
      case 'dolaresCliente': return <span className="sc-x7">{formatoMoneda(op.dolaresCliente)}</span>;
      case 'pesosCliente': return <span className="sc-x8">{formatoMoneda(op.pesosCliente)}</span>;
      case 'conversionCliente': return <span className="sc-x9">{formatoMoneda(op.conversionCliente)}</span>;
      case 'origen': return <span className="sc-x1">{mostrarDatoMapeado(op.origen, 'empresas', 'nombre', op.origenNombre)}</span>;
      case 'destino': return <span className="sc-x1">{mostrarDatoMapeado(op.destino, 'empresas', 'nombre', op.destinoNombre)}</span>;
      case 'remolque': return <span className="sc-x1">{mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre)}</span>;
      case 'proveedor': return <span className="sc-x10" title={op.proveedorUnidadNombre || op.proveedorUnidad}>{mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre)}</span>;
      case 'unidadProveedor': return <span className="sc-x1">{mostrarDatoMapeado(op.unidadProveedor, 'unidades_proveedor', 'numeroUnidad', op.unidadProveedorNombre)}</span>;
      case 'operadorProveedor': return <span className="sc-x1">{mostrarDatoMapeado(op.operadorProveedor, 'proveedores_unidad', 'nombre', op.operadorProveedorNombre)}</span>;
      case 'convenioProv': return <span className="sc-x10" title={obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre)}>{obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre)}</span>;
      case 'facturadoEnUnidad': return <span className="sc-x1">{mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre)}</span>;
      case 'monedaConvenioProv': return <span className="sc-x1">{mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre)}</span>;
      case 'totalAPagarProv': return <span className="sc-x1">{formatoMoneda(op.totalAPagarProv)}</span>;
      case 'cargosAdicionalesProv': return <span className="sc-x1">{formatoMoneda(op.cargosAdicionalesProv)}</span>;
      case 'subtotalProv': return <span className="sc-x6">{formatoMoneda(op.subtotalProv)}</span>;
      case 'dolaresProv': return <span className="sc-x8">{formatoMoneda(op.dolaresProv)}</span>;
      case 'pesosProv': return <span className="sc-x8">{formatoMoneda(op.pesosProv)}</span>;
      case 'conversionProv': return <span className="sc-x11">{formatoMoneda(op.conversionProv)}</span>;
      case 'unidad': return <span className="sc-x1">{mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre)}</span>;
      case 'operador': return <span className="sc-x1">{mostrarDatoMapeado(op.operador, 'empleados', 'nombre', op.operadorNombre)}</span>;
      case 'sueldoOperador': return <span className="sc-x1">{formatoMoneda(op.sueldoOperador)}</span>;
      case 'sueldoExtra': return <span className="sc-x1">{formatoMoneda(op.sueldoExtra)}</span>;
      case 'sueldoTotal': return <span className="sc-x6">{formatoMoneda(op.sueldoTotal)}</span>;
      case 'combustible': return <span className="sc-x1">{formatoMoneda(op.combustible)}</span>;
      case 'combustibleExtra': return <span className="sc-x1">{formatoMoneda(op.combustibleExtra)}</span>;
      case 'combustibleTotal': return <span className="sc-x6">{formatoMoneda(op.combustibleTotal)}</span>;
      case 'clienteMercancia': return <span className="sc-x1">{mostrarDatoMapeado(op.clienteMercancia, 'empresas', 'nombre', op.clienteMercanciaNombre)}</span>;
      case 'descripcionMercancia': return <span className="sc-x1">{mostrarDato(op.descripcionMercancia)}</span>;
      case 'cantidad': return <span className="sc-x1">{mostrarDato(op.cantidad)}</span>;
      case 'embalaje': return <span className="sc-x1">{mostrarDatoMapeado(op.embalaje, 'embalajes', 'clave', op.embalajeNombre)}</span>;
      case 'pesoKg': return <span className="sc-x1">{mostrarDato(op.pesoKg)}</span>;
      case 'numDoda': return <span className="sc-x1">{mostrarDato(op.numDoda)}</span>;
      case 'fechaEmisionDoda': return <span className="sc-x1">{mostrarDato(op.fechaEmisionDoda)}</span>;
      case 'numeroEntrys': return <span className="sc-x1">{mostrarDato(op.numeroEntrys)}</span>;
      case 'cantEntrys': return <span className="sc-x1">{mostrarDato(op.cantEntrys)}</span>;
      case 'numManifiesto': return <span className="sc-x1">{mostrarDato(op.numManifiesto)}</span>;
      case 'provServicios': return <span className="sc-x1">{mostrarDatoMapeado(op.provServicios, 'empresas', 'nombre', op.provServiciosNombre)}</span>;
      case 'montoManifiesto': return <span className="sc-x1">{formatoMoneda(op.montoManifiesto)}</span>;
      case 'totalGastos': return <span className="sc-x12">{formatoMoneda(op.totalGastos)}</span>;
      case 'utilidadEstimada': return <span className="sc-x2">{formatoMoneda(op.utilidadEstimada)}</span>;
      case 'observacionesEjecutivo': return <span className="sc-x13">{mostrarDato(op.observacionesEjecutivo)}</span>;
      case 'observacionesUnidad': return <span className="sc-x13">{mostrarDato(op.observacionesUnidad)}</span>;
      case 'observacionesCobrar': return <span className="sc-x13">{mostrarDato(op.observacionesCobrar)}</span>;
      default: return '-';
    }
  };

  // ✅ NUEVO: por defecto el Excel usa las columnas VISIBLES de la tabla en su
  //   orden actual; las ocultas quedan listadas al final, desmarcadas.
  const columnasExportPorDefecto = () => {
    const visibles = columnasTabla.filter(c => c.visible).map(c => ({ id: c.id, label: c.label, visible: true }));
    const ocultas = columnasTabla.filter(c => !c.visible).map(c => ({ id: c.id, label: c.label, visible: false }));
    return [...visibles, ...ocultas];
  };

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
        const porId = new Map(columnasTabla.map(c => [c.id, c] as const));
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

  const exportarExcel = async () => {
    if (operacionesOrdenadas.length === 0) return alert("No hay datos para exportar.");

    // ✅ MODIFICADO: usa la selección y el ORDEN elegidos en el modal.
    const columnasVisibles = columnasExport.filter(c => c.visible);
    if (columnasVisibles.length === 0) return alert('Selecciona al menos una columna para exportar.');

    await cargarCatalogosSiEsNecesario();

    const datosExcel = operacionesOrdenadas.map(op => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        let val: any = '-';
        switch (col.id) {
          case 'ref': val = op.ref || op.id?.substring(0,6) || ''; break;
          case 'fechaServicio': val = (op._fechaISO != null ? op._fechaISO : normalizarFechaServicioISO(op.fechaServicio)) || op.fechaServicio || ''; break;
          case 'fechaCita': val = formatearFechaHora(op.fechaCita); break;
          case 'tipoOperacion': val = mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre); break;
          case 'status': val = mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre); break; 
          case 'refDiesel': val = op.referenciaDieselConsecutivo || ''; break;
          case 'refNomina': val = op.referenciaNominaConsecutivo || ''; break;
          case 'invoiceCliente': val = op.facturaClienteInvoice || (op.facturado ? 'Facturada' : ''); break;
          case 'invoiceProveedor': val = op.facturaProveedorFolio || (op.facturadoProveedor ? 'Facturada' : ''); break;
          case 'trafico': val = op.trafico || ''; break;
          case 'cliente': val = mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente); break;
          case 'convenioTarifa': val = obtenerNombreConvenioCliente(op.convenio, op.convenioNombre); break;
          case 'refCliente': val = op.refCliente || ''; break;
          case 'facturadoEnCobrar': val = normalizarMoneda(mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre)); break;
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
          case 'unidadProveedor': val = mostrarDatoMapeado(op.unidadProveedor, 'unidades_proveedor', 'numeroUnidad', op.unidadProveedorNombre); break;
          case 'operadorProveedor': val = mostrarDatoMapeado(op.operadorProveedor, 'proveedores_unidad', 'nombre', op.operadorProveedorNombre); break;
          case 'convenioProv': val = obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre); break;
          case 'facturadoEnUnidad': val = normalizarMoneda(mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre)); break;
          case 'monedaConvenioProv': val = normalizarMoneda(mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre)); break;
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
          case 'embalaje': val = mostrarDatoMapeado(op.embalaje, 'embalajes', 'clave', op.embalajeNombre); break;
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
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Completados');
    XLSX.writeFile(workbook, `Servicios_Completados_${new Date().toISOString().split('T')[0]}.xlsx`);

    // ✅ NUEVO: recuerda la selección/orden de columnas de ESTE usuario y cierra el modal.
    try { localStorage.setItem(claveExportGuardado(), JSON.stringify(columnasExport.map(c => ({ id: c.id, visible: c.visible })))); } catch { /* ignorar */ }
    setModalExportar(false);
  };

  const tabsDetalle = [{ id: 'general', label: 'Información General' }, { id: 'pedimento', label: 'Pedimento y CT' }, { id: 'manifiestos', label: "Entry's y Manifiestos" }, { id: 'unidad', label: 'Unidad y Operador' }, { id: 'cobrar', label: 'Por Cobrar' }];

  const evalTipoOpText = String(operacionViendo?.tipoOperacionNombre || operacionViendo?.tipoOperacionId || '').toLowerCase();
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsRoelca = String(operacionViendo?.proveedorUnidadNombre || operacionViendo?.proveedorUnidad || '').toLowerCase().includes('roelca');
  
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  const refOperacionViendo = operacionViendo ? (operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'Operacion') : '';

  const btnSecondaryActionStyle = { background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', gap: '8px', fontWeight: 'bold', transition: 'background 0.2s', fontSize: '0.85rem' };
  const btnDocStyle = { background: 'transparent', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '6px', fontSize: '0.85rem', transition: 'all 0.2s' };

  // ✅ MODIFICADO: tarjetas de resumen COMPACTAS (menos alto, tipografía menor,
  //   más tarjetas por fila) para que el resumen no domine la pantalla.
  const cardResumenStyle: React.CSSProperties = { backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 };
  const cardLabelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const cardValueStyle: React.CSSProperties = { fontSize: '1.05rem', fontWeight: 'bold', lineHeight: 1.15 };

  return (
    <div className="module-container sc-x14">

      {estadoFormulario !== 'cerrado' && (
        <FormularioOperacion
          estado={estadoFormulario}
          initialData={operacionEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setOperacionEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')}
          onRestore={() => setEstadoFormulario('abierto')}
          catalogosCacheados={catalogosGlobales}
          onSave={handleOperacionGuardada}
        />
      )}

      <div className="sc-x15">
        <h1 className="module-title sc-x16">
          ✓ Servicios Completados
        </h1>

          {/* NUEVO: sidebar FLOTANTE de filtros — anclado al lado DERECHO de la
              pantalla, con fondo oscurecido; se abre con el botón Filtros. */}
          {drawerFiltrosAbierto && (
            <>
              <div className="sc-x17" onClick={() => setDrawerFiltrosAbierto(false)} />
              <aside className="sc-x18">
              <div className="sc-x19">
                <div className="sc-x20">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                  <span className="sc-x21">Filtros</span>
                </div>
                <button className="sc-x22" onClick={() => setDrawerFiltrosAbierto(false)} title="Cerrar filtros">✕</button>
              </div>

              <div className="sc-x23">

          <div className="sc-x24">
            <label className="sc-x25">FECHA INICIO ★</label>
            <input className="sc-x26" type="date" value={filterFechaInicio} onChange={(e) => setFilterFechaInicio(e.target.value)} />
          </div>

          <div className="sc-x24">
            <label className="sc-x25">FECHA FIN ★</label>
            <input className="sc-x26" type="date" value={filterFechaFin} min={filterFechaInicio || undefined} onChange={(e) => setFilterFechaFin(e.target.value)} />
          </div>

          {/* NUEVO: filtro por # DE REFERENCIA (busca en las referencias ya
              guardadas dentro del rango). Requiere rango de fechas. */}
          <div className="sc-x24">
            <label className="sc-x27"># REFERENCIA (requiere rango de fechas)</label>
            <div className="sc-x28">
              <svg className="sc-x29" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input
                type="text"
                placeholder={rangoFechasListo ? 'Ej. TR-220726-016 (acepta parcial)' : 'Coloca un rango de fechas primero'}
                value={filterReferencia}
                onChange={(e) => setFilterReferencia(e.target.value)}
                disabled={!rangoFechasListo}
                title={rangoFechasListo ? 'Busca en los números de referencia ya guardados dentro del rango de fechas' : 'Este filtro solo funciona con un rango de fechas (inicio y fin)'}
                style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box', opacity: rangoFechasListo ? 1 : 0.45, cursor: rangoFechasListo ? 'text' : 'not-allowed' }}
              />
            </div>
            {!rangoFechasListo && (
              <div className="sc-x30">Requiere Fecha Inicio y Fecha Fin.</div>
            )}
          </div>

          <div className="sc-x31">
            <label className="sc-x27">CLIENTE QUE PAGA (opcional)</label>

            {filterCliente ? (
              <div className="sc-x32">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                <span className="sc-x33">
                  {nombreClienteSeleccionado}
                </span>
                <button className="sc-x34"
                  onClick={() => { setFilterCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); }}
                  title="Cambiar cliente"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="sc-x28">
                <svg className="sc-x35" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="sc-x36"
                  type="text"
                  placeholder="Buscar cliente por nombre o RFC..."
                  value={textoBuscarCliente}
                  onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
                  onFocus={() => setMostrarSugerenciasCliente(true)}
                  onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
                />
              </div>
            )}

            {!filterCliente && mostrarSugerenciasCliente && (
              <div className="sc-x37">
                {clientesFiltradosBuscador.length === 0 ? (
                  <div className="sc-x38">
                    {textoBuscarCliente.trim() ? 'Sin coincidencias' : 'No hay clientes (tipo Cliente-Paga) cargados'}
                  </div>
                ) : (
                  <>
                    <div className="sc-x39">
                      {clientesFiltradosBuscador.length} {clientesFiltradosBuscador.length === 1 ? 'cliente' : 'clientes'}{textoBuscarCliente.trim() ? '' : ' (primeros 30)'}
                    </div>
                    {clientesFiltradosBuscador.map((cli: any) => (
                      <div className="sc-x40"
                        key={cli.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFilterCliente(cli.id);
                          setTextoBuscarCliente('');
                          setMostrarSugerenciasCliente(false);
                        }}
                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div className="sc-x41">{cli.nombre || cli.id}</div>
                        {cli.rfc && <div className="sc-x42">{cli.rfc}</div>}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="sc-x31">
            <label className="sc-x27"># REMOLQUE (requiere rango de fechas)</label>

            {filterRemolque ? (
              <div className="sc-x43">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                <span className="sc-x44">
                  {nombreRemolqueSeleccionado}
                </span>
                <button className="sc-x34"
                  onClick={() => { setFilterRemolque(''); setTextoBuscarRemolque(''); setMostrarSugerenciasRemolque(false); }}
                  title="Quitar remolque"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="sc-x28">
                <svg className="sc-x29" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input
                  type="text"
                  placeholder={rangoFechasListo ? 'Buscar remolque por nombre o placa...' : 'Coloca un rango de fechas primero'}
                  value={textoBuscarRemolque}
                  onChange={(e) => { setTextoBuscarRemolque(e.target.value); setMostrarSugerenciasRemolque(true); }}
                  onFocus={() => setMostrarSugerenciasRemolque(true)}
                  onBlur={() => setTimeout(() => setMostrarSugerenciasRemolque(false), 180)}
                  disabled={!rangoFechasListo}
                  title={rangoFechasListo ? 'Busca en los números de remolque ya guardados dentro del rango de fechas' : 'Este filtro solo funciona con un rango de fechas (inicio y fin)'}
                  style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box', opacity: rangoFechasListo ? 1 : 0.45, cursor: rangoFechasListo ? 'text' : 'not-allowed' }}
                />
              </div>
            )}

            {!rangoFechasListo && !filterRemolque && (
              <div className="sc-x30">Requiere Fecha Inicio y Fecha Fin.</div>
            )}

            {rangoFechasListo && !filterRemolque && mostrarSugerenciasRemolque && (
              <div className="sc-x37">
                {remolquesFiltradosBuscador.length === 0 ? (
                  <div className="sc-x38">
                    {textoBuscarRemolque.trim() ? 'Sin coincidencias' : 'No hay remolques cargados'}
                  </div>
                ) : (
                  <>
                    <div className="sc-x39">
                      {remolquesFiltradosBuscador.length} {remolquesFiltradosBuscador.length === 1 ? 'remolque' : 'remolques'}{textoBuscarRemolque.trim() ? '' : ' (primeros 30)'}
                    </div>
                    {remolquesFiltradosBuscador.map((rem: any) => (
                      <div className="sc-x40"
                        key={rem.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFilterRemolque(rem.id);
                          setTextoBuscarRemolque('');
                          setMostrarSugerenciasRemolque(false);
                        }}
                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div className="sc-x41">{etiquetaRemolque(rem) || rem.id}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* NUEVO: filtro por OPERADOR (búsqueda con sugerencias) */}
          <div className="sc-x31">
            <label className="sc-x27">OPERADOR (opcional)</label>

            {filterOperador ? (
              <div className="sc-x43">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                <span className="sc-x44">
                  {nombreOperadorSeleccionado}
                </span>
                <button className="sc-x34"
                  onClick={() => { setFilterOperador(''); setTextoBuscarOperador(''); setMostrarSugerenciasOperador(false); }}
                  title="Quitar operador"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="sc-x28">
                <svg className="sc-x29" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="sc-x45"
                  type="text"
                  placeholder="Buscar operador por nombre..."
                  value={textoBuscarOperador}
                  onChange={(e) => { setTextoBuscarOperador(e.target.value); setMostrarSugerenciasOperador(true); }}
                  onFocus={() => setMostrarSugerenciasOperador(true)}
                  onBlur={() => setTimeout(() => setMostrarSugerenciasOperador(false), 180)}
                />
              </div>
            )}

            {!filterOperador && mostrarSugerenciasOperador && (
              <div className="sc-x37">
                {operadoresFiltradosBuscador.length === 0 ? (
                  <div className="sc-x38">
                    {textoBuscarOperador.trim() ? 'Sin coincidencias' : 'No hay operadores cargados'}
                  </div>
                ) : (
                  <>
                    <div className="sc-x39">
                      {operadoresFiltradosBuscador.length} {operadoresFiltradosBuscador.length === 1 ? 'operador' : 'operadores'}{textoBuscarOperador.trim() ? '' : ' (primeros 30)'}
                    </div>
                    {operadoresFiltradosBuscador.map((emp: any) => (
                      <div className="sc-x40"
                        key={emp.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFilterOperador(String(emp.id));
                          setTextoBuscarOperador('');
                          setMostrarSugerenciasOperador(false);
                        }}
                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div className="sc-x41">{etiquetaOperador(emp) || emp.id}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* NUEVO: filtro por TIPO DE OPERACIÓN (Transfer / Logística / Fletes) */}
          <div className="sc-x24">
            <label className="sc-x27">TIPO DE OPERACIÓN (opcional)</label>
            <select className="sc-x46"
              value={filterTipoOperacion}
              onChange={(e) => setFilterTipoOperacion(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="transfer">Transfer</option>
              <option value="logistica">Logística</option>
              <option value="fletes">Fletes</option>
            </select>
          </div>

          <div className="sc-x24">
            <label className="sc-x27">FILTRO GENERAL (opcional)</label>
            <div className="sc-x28">
              <svg className="sc-x47" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input className="sc-x48" type="text" placeholder="Buscar por Ref..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
          </div>
              </div>

              <div className="sc-x49">
                <button className="sc-x50"
                  onClick={limpiarFiltrosPanel}
                >
                  Limpiar
                </button>
                <button
                  onClick={ejecutarBusqueda}
                  disabled={cargandoOperaciones}
                  title={(!filterFechaInicio || !filterFechaFin) ? 'Selecciona Fecha Inicio y Fecha Fin para buscar' : 'Buscar con los filtros seleccionados'}
                  style={{ flex: 2, padding: '11px', backgroundColor: (!filterFechaInicio || !filterFechaFin) ? '#21262d' : '#10b981', color: (!filterFechaInicio || !filterFechaFin) ? '#8b949e' : '#0d1117', border: '1px solid ' + ((!filterFechaInicio || !filterFechaFin) ? '#30363d' : '#10b981'), borderRadius: '6px', cursor: cargandoOperaciones ? 'wait' : 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  Buscar
                </button>
              </div>
              </aside>
            </>
          )}

        {/* NUEVO: modal para ELEGIR Y ORDENAR las columnas del Excel.
            Arrastrando ⋮⋮ (o con las flechas) se cambia el orden; el checkbox
            incluye/excluye la columna. Por defecto usa las columnas de la tabla. */}
        {modalExportar && (
          <>
            <div className="sc-x51" onClick={() => setModalExportar(false)} />
            <div className="sc-x52">
              <div className="sc-x19">
                <div className="sc-x20">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span className="sc-x21">Exportar a Excel</span>
                  <span className="sc-x53">({columnasExport.filter(c => c.visible).length} columnas)</span>
                </div>
                <button className="sc-x22" onClick={() => setModalExportar(false)} title="Cerrar">✕</button>
              </div>

              <div className="sc-x54">
                Arrastra <span className="sc-x1">⋮⋮</span> o usa las flechas para cambiar el orden. Marca las columnas que quieres incluir.
              </div>

              <div className="sc-x55">
                {columnasExport.map((c, idx) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => { dragExportIdx.current = idx; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => soltarColumnaExport(idx)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', marginBottom: '4px', backgroundColor: c.visible ? '#0d1117' : 'rgba(13, 17, 23, 0.5)', border: '1px solid #21262d', borderRadius: '6px', cursor: 'grab', opacity: c.visible ? 1 : 0.55 }}
                  >
                    <span className="sc-x56" title="Arrastrar para reordenar">⋮⋮</span>
                    <input className="sc-x57"
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

              <div className="sc-x58">
                <button className="sc-x59"
                  onClick={() => setColumnasExport(columnasExportPorDefecto())}
                  title="Restablecer con las columnas visibles de la tabla, en su orden actual"
                >
                  Columnas de la tabla
                </button>
                <div className="sc-x60" />
                <button className="sc-x61" onClick={() => setModalExportar(false)}>Cancelar</button>
                <button className="sc-x62"
                  onClick={exportarExcel}
                >
                  Exportar
                </button>
              </div>
            </div>
          </>
        )}


        {/* NUEVO: barra compacta — los filtros viven en un panel lateral
            izquierdo; aquí solo queda el botón Filtros, el resumen de la última
            búsqueda y las acciones de la tabla. */}
        <div className="sc-x63">
          <button
            onClick={() => setDrawerFiltrosAbierto(v => !v)}
            title={drawerFiltrosAbierto ? 'Ocultar el panel de filtros' : 'Mostrar el panel de filtros'}
            style={{ padding: '9px 16px', backgroundColor: drawerFiltrosAbierto ? '#10b981' : 'transparent', color: drawerFiltrosAbierto ? '#0d1117' : '#10b981', border: '1px solid #10b981', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, fontSize: '0.85rem' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            Filtros
            {contadorFiltrosActivos > 0 && (
              <span className="sc-x64">{contadorFiltrosActivos}</span>
            )}
          </button>

          {filtrosAplicados ? (
            <div className="sc-x65">
              {resumenFiltrosChips.map((chip, i) => (
                <span className="sc-x66" key={`chip_${i}`}>{chip}</span>
              ))}
            </div>
          ) : (
            <span className="sc-x67">Presiona Filtros para definir el rango de fechas y buscar.</span>
          )}

          <div className="sc-x68">
            <button className="btn btn-outline" onClick={refrescarDatos} disabled={cargandoOperaciones} style={{ padding: '10px 12px', cursor: cargandoOperaciones ? 'wait' : 'pointer' }} title="Actualizar (recargar desde la base de datos)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
            {/* ✅ NUEVO (V00114): sincronizar nombres contra catálogos actuales */}
            <button className="btn btn-outline" onClick={sincronizarNombres} disabled={sincronizandoNombres || operacionesGlobales.length === 0} style={{ padding: '10px 12px', cursor: sincronizandoNombres ? 'wait' : 'pointer', opacity: (sincronizandoNombres || operacionesGlobales.length === 0) ? 0.6 : 1 }} title="Sincronizar nombres: actualiza registro por registro los nombres que quedaron viejos tras renombrar en Catálogos (no toca montos)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
            </button>
            <button className="btn btn-outline sc-x69" onClick={() => setModalColumnas(true)} title="Configurar Columnas">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button className="btn btn-outline sc-x69" onClick={abrirModalExportar} title="Exportar a Excel (elegir y ordenar columnas)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>
        </div>


        {filtrosAplicados && (
          <div className="sc-x70">
            <div className="sc-x71">
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Servicios (rango)</span>
                <span style={{ ...cardValueStyle, color: '#f0f6fc' }}>{resumenServicios.total}</span>
              </div>
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Completados</span>
                <span style={{ ...cardValueStyle, color: '#10b981' }}>{resumenServicios.completados}</span>
              </div>
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Falsos</span>
                <span style={{ ...cardValueStyle, color: '#f85149' }}>{resumenServicios.falsos}</span>
              </div>
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Cargaron Diésel</span>
                <span style={{ ...cardValueStyle, color: '#f59e0b' }}>{resumenServicios.conDiesel}</span>
              </div>
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Pagados Nómina</span>
                <span style={{ ...cardValueStyle, color: '#a371f7' }}>{resumenServicios.conNomina}</span>
              </div>
            </div>

            <div className="sc-x72">
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Facturados Cliente</span>
                <span style={{ ...cardValueStyle, color: '#10b981' }}>{resumenServicios.factCliente}</span>
              </div>
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Pendientes Cliente</span>
                <span style={{ ...cardValueStyle, color: '#f59e0b' }}>{resumenServicios.pendCliente}</span>
              </div>
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Facturados Proveedor</span>
                <span style={{ ...cardValueStyle, color: '#58a6ff' }}>{resumenServicios.factProveedor}</span>
              </div>
              <div style={cardResumenStyle}>
                <span style={cardLabelStyle}>Pendientes Proveedor</span>
                <span style={{ ...cardValueStyle, color: '#f59e0b' }}>{resumenServicios.pendProveedor}</span>
              </div>
            </div>

          </div>
        )}

        <div className="content-body sc-x73">
          <div className="table-container sc-x74">
            {cargandoOperaciones ? (
              <div className="sc-x75">
                Cargando operaciones completadas...
              </div>
            ) : (
              <table className="data-table sc-x76">
                <thead className="sc-x77">
                  <tr>
                    <th className="sc-x78">
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
                          <span className="sc-x79">
                            {ordenDireccion === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!filtrosAplicados ? (
                    <tr>
                      <td className="sc-x80" colSpan={columnasTabla.length + 1}>
                        Selecciona <strong className="sc-x7">Fecha Inicio</strong> y <strong className="sc-x7">Fecha Fin</strong> y presiona <strong className="sc-x7">Buscar</strong> para ver las operaciones completadas.
                      </td>
                    </tr>
                  ) : operacionesEnPantalla.length === 0 ? (
                    <tr>
                      <td className="sc-x81" colSpan={columnasTabla.length + 1}>
                        Sin resultados para el rango de fechas y los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    operacionesEnPantalla.map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                        <td className="sc-x82" onClick={(e: any) => e.stopPropagation()}>
                          <div className="actions-cell sc-x83">
                            <button className="sc-x84" type="button" title="Ver Detalles"
                              onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setPestañaDetalleActiva('general'); }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button className="sc-x85" type="button" title="Editar"
                              onClick={(e) => handleEditarOperacion(op, e)} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(88, 166, 255, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            {/* ✅ NUEVO: subir documento directo desde la fila (sin abrir la ficha) */}
                            <button className="sc-x85" type="button" title="Subir documento"
                              style={{ color: '#fb923c' }}
                              onClick={(e) => { e.stopPropagation(); setOpSubirDocs(op); setMostrarSubirDocOp(true); }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            </button>
                            <button className="sc-x86" type="button" title="Eliminar"
                              onClick={(e) => handleEliminarOperacion(op, e)} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(248, 81, 73, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        {columnasTabla.filter(c => c.visible).map(col => (
                          <td className="sc-x87" key={`cell_${op.id}_${col.id}`}>
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

          {operacionesOrdenadas.length > 0 && !cargandoOperaciones && (
            <div className="sc-x88">
              <div className="sc-x89">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesOrdenadas.length)} de {operacionesOrdenadas.length} operaciones completadas
                {hayMasOperaciones && <span className="sc-x90">(hay más disponibles)</span>}
              </div>
              <div className="sc-x91">
                {hayMasOperaciones && (
                  <button
                    onClick={cargarMasOperaciones}
                    disabled={cargandoMas}
                    style={{ padding: '6px 14px', backgroundColor: cargandoMas ? '#0d1117' : '#D84315', color: cargandoMas ? '#484f58' : '#fff', border: '1px solid #D84315', borderRadius: '6px', cursor: cargandoMas ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                    title="Descargar el siguiente bloque de operaciones del rango"
                  >
                    {cargandoMas ? 'Cargando...' : `+ Cargar más (${TAMANIO_PAGINA})`}
                  </button>
                )}
                <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                <span className="sc-x92">{paginaActual} / {totalPaginas || 1}</span>
                <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalColumnas && (
        <div className="modal-overlay sc-x93">
          <div className="sc-x94">
            <div className="sc-x95">
              <h3 className="sc-x96">Configurar Columnas</h3>
              <button className="sc-x97" onClick={() => { setModalColumnas(false); setBusquedaColumnas(''); }}>✕</button>
            </div>
            <p className="sc-x98">Arrastra los campos para reordenarlos. Desmarca los que desees ocultar de la tabla principal y del reporte de Excel.</p>

            {/* NUEVO: buscador de columnas por nombre */}
            <div className="sc-x99">
              <svg className="sc-x47" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input className="sc-x100"
                type="text"
                value={busquedaColumnas}
                onChange={(e) => setBusquedaColumnas(e.target.value)}
                placeholder="Buscar columna por nombre..."
              />
              {busquedaColumnas && (
                <button className="sc-x101"
                  onClick={() => setBusquedaColumnas('')}
                  title="Limpiar búsqueda"
                >
                  ✕
                </button>
              )}
            </div>

            <ul className="sc-x102">
              {columnasTabla.map((col, idx) => {
                // Se conserva el índice real (idx) para que arrastrar y marcar/desmarcar
                // sigan funcionando; solo ocultamos los que no coinciden con la búsqueda.
                if (busquedaColumnas.trim() && !col.label.toLowerCase().includes(busquedaColumnas.trim().toLowerCase())) {
                  return null;
                }
                return (
                  <li 
                    key={col.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={() => setDraggedColIndex(null)}
                    onDragOver={(e) => e.preventDefault()}
                    style={{ 
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', 
                      backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', 
                      border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab',
                      transition: 'background-color 0.2s'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    <input className="sc-x103" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                    <span style={{ color: col.visible ? '#c9d1d9' : '#8b949e', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                  </li>
                );
              })}
            </ul>

            {busquedaColumnas.trim() && !columnasTabla.some(c => c.label.toLowerCase().includes(busquedaColumnas.trim().toLowerCase())) && (
              <div className="sc-x104">
                No hay columnas que coincidan con "{busquedaColumnas}".
              </div>
            )}

            <div className="sc-x105">
              <button className="sc-x106" onClick={() => { setModalColumnas(false); setBusquedaColumnas(''); }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {operacionViendo && (
        <div className="modal-overlay sc-x107">
          <div className="form-card detail-card sc-x108">
            
            <div className="form-header sc-x109">
              <div className="sc-x110">
                <div>
                  <h2 className="sc-x111">
                    Detalle de Operación Completada
                  </h2>
                  <div className="sc-x112">
                    <span className="sc-x113">
                      {operacionViendo.ref || operacionViendo.id?.substring(0,6)}
                    </span>
                    <span className="sc-x114">
                      {mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}
                    </span>
                  </div>
                </div>
                
                <div className="sc-x115">
                  <button onClick={() => setMostrarDocumentos(true)} title="Ver / Subir Documentos" style={{ ...btnSecondaryActionStyle, color: '#fb923c', borderColor: 'rgba(251, 146, 60, 0.4)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                    Documentos
                  </button>
                  <button onClick={verHistorial} title="Ver Bitácora (Historial)" style={btnSecondaryActionStyle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    Bitácora
                  </button>
                  <button onClick={() => handleEditarOperacion(operacionViendo)} title="Editar Operación" style={{ ...btnSecondaryActionStyle, border: '1px solid #58a6ff', color: '#58a6ff' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Editar
                  </button>
                  <button onClick={() => handleEliminarOperacion(operacionViendo)} title="Eliminar Operación" style={{ ...btnSecondaryActionStyle, border: '1px solid #f85149', color: '#f85149' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    Eliminar
                  </button>
                  <div className="sc-x116"></div>
                  <button className="sc-x117" onClick={() => setOperacionViendo(null)}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              </div>

              <div className="sc-x118">
                <span className="sc-x119">CONEXIONES</span>
                <span className="sc-x53">Diésel:</span>
                {operacionViendo.referenciaDieselConsecutivo ? chipConexion(operacionViendo.referenciaDieselConsecutivo, '#f59e0b') : <span className="sc-x120">Sin cargar</span>}
                <span className="sc-x121">Nómina:</span>
                {operacionViendo.referenciaNominaConsecutivo ? chipConexion(operacionViendo.referenciaNominaConsecutivo, '#a371f7') : <span className="sc-x120">Sin pagar</span>}
                <span className="sc-x121">Factura Cliente:</span>
                {(operacionViendo.facturaClienteInvoice || operacionViendo.facturado) ? chipConexion(operacionViendo.facturaClienteInvoice || 'Facturada', '#10b981') : <span className="sc-x120">Pendiente</span>}
                <span className="sc-x121">Factura Proveedor:</span>
                {(operacionViendo.facturaProveedorFolio || operacionViendo.facturadoProveedor) ? chipConexion(operacionViendo.facturaProveedorFolio || 'Facturada', '#58a6ff') : <span className="sc-x120">Pendiente</span>}
              </div>

              <div className="sc-x122">
                <span className="sc-x119">SIGUIENTE PASO</span>
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
                          <span className="sc-x123">
                            {esExitoso ? (
                              <svg className="sc-x124" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            )}
                          </span>
                          <span className="sc-x125">{botonStr}</span>
                        </button>
                      );
                    })}
                    <button onClick={abrirRegistroHorario} className="status-circle-btn sc-x126"
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
                    <span className="sc-x127">
                      No hay transiciones automáticas configuradas.
                    </span>
                    <button onClick={abrirRegistroHorario} className="status-pill sc-x128"
                      title="Registrar status manualmente">
                      <span className="sc-x129">
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

              <div className="sc-x130">
                <span className="sc-x131">GENERAR DOCUMENTOS:</span>
                
                {evalIsFletes && (
                  <>
                    <button onClick={handleDescargarCartaInstrucciones} style={btnDocStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                      Carta Instrucciones
                    </button>
                    <button onClick={handleDescargarPruebaEntrega} style={btnDocStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                      Prueba Entrega
                    </button>
                  </>
                )}

                <button onClick={handleDescargarCheckList} style={btnDocStyle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  Check List
                </button>
                <button onClick={handleDescSolicitudRetiro} style={btnDocStyle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  Solicitud Retiro
                </button>
                <button onClick={handleDescargarInstruccionesServicio} style={btnDocStyle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  Instrucciones Serv.
                </button>
              </div>

            </div>
            
            <div className="sc-x132">
              {tabsDetalle.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setPestañaDetalleActiva(tab.id)}
                  style={{
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent',
                    color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e',
                    cursor: 'pointer',
                    fontWeight: pestañaDetalleActiva === tab.id ? '600' : 'normal',
                    fontSize: '0.95rem',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="detail-content sc-x133">
              
              {pestañaDetalleActiva === 'general' && (
                <div className="sc-x134">
                  <div>
                    <span className="sc-x135">Tipo de Operación</span>
                    <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', operacionViendo.tipoOperacionNombre)}</span>
                  </div>
                  <div>
                    <span className="sc-x135">Fecha de Servicio / Status</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.fechaServicio)} <span className="sc-x137">|</span> <span className="sc-x2">{mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}</span></span>
                  </div>
                  
                  {evalIsFletes ? (
                     <div>
                       <span className="sc-x135">Fecha de Cita</span>
                       <span className="sc-x136">{formatearFechaHora(operacionViendo.fechaCita)}</span>
                     </div>
                  ) : (
                    <div></div> 
                  )}

                  <div className="sc-x138"><hr className="sc-x139" /></div>

                  <div>
                    <span className="sc-x140">Cliente (Paga)</span>
                    <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.clientePaga || operacionViendo.clienteId, 'empresas', 'nombre', operacionViendo.clienteNombre || operacionViendo.nombreCliente)}</span>
                  </div>
                  <div>
                    <span className="sc-x140">Convenio (Tarifa)</span>
                    <span className="sc-x136">{obtenerNombreConvenioCliente(operacionViendo.convenio, operacionViendo.convenioNombre)}</span> 
                  </div>
                  <div>
                    <span className="sc-x140"># de Remolque</span>
                    <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.numeroRemolque, 'remolques', 'nombre', operacionViendo.remolqueNombre || operacionViendo.remolquePlaca)}</span>
                  </div>
                  
                  <div>
                    <span className="sc-x140">Ref Cliente</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.refCliente)}</span>
                  </div>
                  <div>
                    <span className="sc-x141">Origen</span>
                    <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre)}</span>
                  </div>
                  <div>
                    <span className="sc-x141">Destino</span>
                    <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.destino, 'empresas', 'nombre', operacionViendo.destinoNombre)}</span>
                  </div>
                  <div className="sc-x142">
                    <span className="sc-x140">Observaciones Ejecutivo</span>
                    <div className="sc-x143">
                      {mostrarDato(operacionViendo.observacionesEjecutivo)}
                    </div>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'pedimento' && (
                <div className="sc-x134">
                  <div className="sc-x144">
                    <span className="sc-x140">Cliente (Mercancía)</span>
                    <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas', 'nombre', operacionViendo.clienteMercanciaNombre)}</span>
                  </div>
                  <div>
                    <span className="sc-x140">Descripción de la Mercancía</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.descripcionMercancia)}</span>
                  </div>
                  <div className="sc-x138"><hr className="sc-x139" /></div>
                  <div>
                    <span className="sc-x140">Cantidad (Enteros)</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.cantidad)}</span>
                  </div>
                  <div>
                    <span className="sc-x140">Embalaje</span>
                    <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.embalaje, 'embalajes', 'clave', operacionViendo.embalajeNombre)}</span>
                  </div>
                  <div>
                    <span className="sc-x140">Peso (Kg) Decimales</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.pesoKg)}</span>
                  </div>
                  <div className="sc-x138"><hr className="sc-x139" /></div>
                  <div>
                    <span className="sc-x140"># DODA</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.numDoda)}</span>
                  </div>
                  <div>
                    <span className="sc-x140">Fecha de Emisión (DODA)</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.fechaEmisionDoda)}</span>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'manifiestos' && (
                <div className="sc-x134">
                  <div>
                    <span className="sc-x140"># de Entry's</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.numeroEntrys)}</span>
                  </div>
                  <div>
                    <span className="sc-x140">Cantidad de Entry's</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.cantEntrys)}</span>
                  </div>
                  <div className="sc-x138"><hr className="sc-x139" /></div>
                  
                  <div>
                    <span className="sc-x140"># Manifiesto</span>
                    <span className="sc-x136">{mostrarDato(operacionViendo.numManifiesto)}</span>
                  </div>
                  <div>
                    <span className="sc-x140">Proveedor de Servicios</span>
                    <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.provServicios, 'empresas', 'nombre', operacionViendo.provServiciosNombre)}</span>
                  </div>
                  <div>
                    <span className="sc-x140">Costo Manifiesto ($)</span>
                    <span className="sc-x145">{formatoMoneda(operacionViendo.montoManifiesto)}</span>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'unidad' && (
                <div className="sc-x146">
                  <div className="sc-x147">
                    <div className="sc-x138">
                      <span className="sc-x140">Proveedor de Transporte</span>
                      <span className="sc-x148">{mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas', 'nombre', operacionViendo.proveedorUnidadNombre)}</span>
                    </div>
                  </div>

                  <div className="sc-x149">
                    <div className="sc-x150">
                      <div>
                        <span className="sc-x140">Facturado En:</span>
                        <span className="sc-x136">{mostrarMoneda(operacionViendo.facturadoEnUnidad)}</span>
                      </div>
                      <div>
                        <span className="sc-x140">Convenio Proveedor</span>
                        <span className="sc-x136">{obtenerNombreConvenioProv(operacionViendo.convenioProveedor, operacionViendo.convenioProveedorNombre)}</span>
                      </div>
                      <div>
                        <span className="sc-x140">Moneda del Convenio (Base)</span>
                        <span className="sc-x136">{mostrarMoneda(operacionViendo.monedaConvenioProv)}</span>
                      </div>
                    </div>
                    
                    <div className="sc-x151">
                      <div>
                        <span className="sc-x140">Monto a Pagar (Base)</span>
                        <span className="sc-x136">{formatoMoneda(operacionViendo.totalAPagarProv)}</span>
                      </div>
                      <div>
                        <span className="sc-x140">Costos Adicionales</span>
                        <span className="sc-x136">{formatoMoneda(operacionViendo.cargosAdicionalesProv)}</span>
                      </div>
                      <div>
                        <span className="sc-x135">Subtotal (Convenio + Costos)</span>
                        <span className="sc-x152">{formatoMoneda(operacionViendo.subtotalProv)}</span>
                      </div>
                    </div>

                    <div className="sc-x153">
                      <div>
                        <span className="sc-x140">Dólares</span>
                        <span className="sc-x154">{formatoMoneda(operacionViendo.dolaresProv)}</span>
                      </div>
                      <div>
                        <span className="sc-x140">Pesos</span>
                        <span className="sc-x154">{formatoMoneda(operacionViendo.pesosProv)}</span>
                      </div>
                      <div>
                        <span className="sc-x155">Conversión Final (Gasto)</span>
                        <span className="sc-x156">{formatoMoneda(operacionViendo.conversionProv)}</span>
                      </div>
                    </div>
                  </div>

                  {showDetailInternalFleet && (
                    <div className="sc-x147">
                      <div className="sc-x138"><h4 className="sc-x157">Flota Operativa (Roelca)</h4></div>
                      <div>
                        <span className="sc-x140">Unidad Asignada</span>
                        <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.unidad, 'unidades', 'unidad', operacionViendo.unidadNombre)}</span>
                      </div>
                      <div className="sc-x144">
                        <span className="sc-x140">Operador Asignado</span>
                        <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.operador, 'empleados', 'nombre', operacionViendo.operadorNombre)}</span>
                      </div>
                      
                      <div className="sc-x138"><hr className="sc-x158" /></div>

                      <div>
                        <span className="sc-x140">Sueldo del Operador</span>
                        <span className="sc-x136">{formatoMoneda(operacionViendo.sueldoOperador)}</span>
                      </div>
                      <div>
                        <span className="sc-x140">Sueldo Extra</span>
                        <span className="sc-x136">{formatoMoneda(operacionViendo.sueldoExtra)}</span>
                      </div>
                      <div>
                        <span className="sc-x135">Sueldo Total</span>
                        <span className="sc-x159">{formatoMoneda(operacionViendo.sueldoTotal)}</span>
                      </div>

                      <div className="sc-x138"><hr className="sc-x158" /></div>

                      <div>
                        <span className="sc-x140">Combustible</span>
                        <span className="sc-x136">{formatoMoneda(operacionViendo.combustible)}</span>
                      </div>
                      <div>
                        <span className="sc-x140">Combustible Extra</span>
                        <span className="sc-x136">{formatoMoneda(operacionViendo.combustibleExtra)}</span>
                      </div>
                      <div>
                        <span className="sc-x135">Total Combustible</span>
                        <span className="sc-x152">{formatoMoneda(operacionViendo.combustibleTotal)}</span>
                      </div>
                    </div>
                  )}

                  {showDetailExternalFleet && (
                    <div className="sc-x147">
                      <div className="sc-x138"><h4 className="sc-x160">Flota Externa (Proveedor)</h4></div>
                      <div>
                        <span className="sc-x141">Unidad Externa</span>
                        <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.unidadProveedor, 'unidades_proveedor', 'numeroUnidad', operacionViendo.unidadProveedorNombre)}</span>
                      </div>
                      <div className="sc-x144">
                        <span className="sc-x141">Operador Externo</span>
                        <span className="sc-x136">{mostrarDatoMapeado(operacionViendo.operadorProveedor, 'proveedores_unidad', 'nombre', operacionViendo.operadorProveedorNombre)}</span>
                      </div>
                    </div>
                  )}

                  {/* Observaciones ARRIBA del bloque de gastos (a petición) */}
                  <div className="sc-x161">
                    <span className="sc-x162">Observaciones (Unidad / Proveedor)</span>
                    <div className="sc-x163">
                      {mostrarDato(operacionViendo.observacionesUnidad)}
                    </div>
                  </div>

                  <div className="sc-x164">
                    <div className="sc-x165">
                      <div className="sc-x166">Total Gastos [Sueldos + Manifiesto]</div>
                      <div className="sc-x167">{formatoMoneda(operacionViendo.totalGastos)}</div>
                    </div>
                  </div>

                </div>
              )}

              {pestañaDetalleActiva === 'cobrar' && (
                <div className="sc-x146">
                  <div className="sc-x147">
                    <div>
                      <span className="sc-x140">Facturado En:</span>
                      <span className="sc-x136">{mostrarMoneda(operacionViendo.facturadoEnCobrar)}</span>
                    </div>
                    <div>
                      <span className="sc-x140">Moneda Convenio (Cliente)</span>
                      <span className="sc-x136">{mostrarMoneda(operacionViendo.monedaConvenioCliente)}</span>
                    </div>
                    <div>
                      <span className="sc-x140">Convenio Seleccionado (Base)</span>
                      <span className="sc-x136">{formatoMoneda(operacionViendo.montoConvenioCliente)}</span>
                    </div>
                    <div>
                      <span className="sc-x140">Cargos Adicionales</span>
                      <span className="sc-x136">{formatoMoneda(operacionViendo.cargosAdicionales)}</span>
                    </div>
                    <div>
                      <span className="sc-x135">Subtotal (Convenio + Cargos)</span>
                      <span className="sc-x168">{formatoMoneda(operacionViendo.subtotalCliente)}</span>
                    </div>
                    <div>
                      <span className="sc-x140">Tipo de Cambio del Día</span>
                      <span className="sc-x136">{mostrarDato(operacionViendo.tipoCambioAprobado)}</span>
                    </div>
                  </div>

                  <div className="sc-x169">
                    <div>
                      <span className="sc-x140">Dólares (Cliente)</span>
                      <span className="sc-x170">{formatoMoneda(operacionViendo.dolaresCliente)}</span>
                    </div>
                    <div>
                      <span className="sc-x140">Pesos (Cliente)</span>
                      <span className="sc-x154">{formatoMoneda(operacionViendo.pesosCliente)}</span>
                    </div>
                    <div>
                      <span className="sc-x135">Conversión Final (Ingreso)</span>
                      <span className="sc-x171">{formatoMoneda(operacionViendo.conversionCliente)}</span>
                    </div>
                  </div>

                  <div className="sc-x172">
                    <span className="sc-x173">Utilidad Estimada de la Operación (Ingreso - Gasto)</span>
                    <span className="sc-x174">{formatoMoneda(operacionViendo.utilidadEstimada)}</span>
                  </div>

                  <div className="sc-x161">
                    <span className="sc-x162">Observaciones (Facturación / Cobro)</span>
                    <div className="sc-x163">
                      {mostrarDato(operacionViendo.observacionesCobrar)}
                    </div>
                  </div>

                </div>
              )}


              {/* Auditoría de la referencia: botón que abre el detalle en un modal */}
              <div className="sc-x175">
                <button className="sc-x176" onClick={() => { setMostrarAuditoria(true); cargarNombresAuditoria(); }} title="Ver quién creó la referencia, cuándo, y el detalle de cada edición">
                  Ver auditoría
                  <span className="sc-x177">{(operacionViendo.historialEdiciones || []).length}</span>
                </button>
              </div>

              {/* Modal de auditoría (solo lectura) */}
              {mostrarAuditoria && (
                <div className="sc-x178" onClick={() => setMostrarAuditoria(false)}>
                  <div className="sc-x179" onClick={(e) => e.stopPropagation()}>
                    <div className="sc-x180">
                      <h3 className="sc-x181">Auditoría de la referencia <span className="sc-x182">{operacionViendo.ref || ''}</span></h3>
                      <button className="sc-x97" onClick={() => setMostrarAuditoria(false)}>✕</button>
                    </div>
                    <div className="sc-x183">
                      <div className="sc-x184">
                        <span className="sc-x185">Creación</span>
                        <span className="sc-x186">
                          Creada por <b className="sc-x187">{nombreAuditor(operacionViendo.creadoPor, 'Sin registro')}</b>
                          {operacionViendo.creadoEn ? <> el <b className="sc-x1">{fmtFechaAuditoria(operacionViendo.creadoEn)}</b></> : null}
                        </span>
                      </div>
                      <div className="sc-x20">
                        <span className="sc-x188">EDICIONES REGISTRADAS:</span>
                        <span className="sc-x189">{(operacionViendo.historialEdiciones || []).length}</span>
                      </div>
                      {(operacionViendo.historialEdiciones || []).slice().reverse().map((h: any, i: number) => (
                        <details className="sc-x190" key={i} open={i === 0}>
                          <summary className="sc-x191">
                            <b className="sc-x1">{nombreAuditor(h.usuario)}</b> · {fmtFechaAuditoria(h.fecha)} · <b className="sc-x192">{(h.cambios || []).length}</b> {(h.cambios || []).length === 1 ? 'cambio' : 'cambios'}
                          </summary>
                          <ul className="sc-x193">
                            {(h.cambios || []).map((c: any, j: number) => (<li key={j}>{String(c)}</li>))}
                          </ul>
                        </details>
                      ))}
                      {(operacionViendo.historialEdiciones || []).length === 0 && (
                        <span className="sc-x194">Sin ediciones desde su creación.</span>
                      )}
                    </div>
                    <div className="sc-x195">
                      <button className="sc-x196" onClick={() => setMostrarAuditoria(false)}>Cerrar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="form-actions detail-actions sc-x197">
              <button onClick={() => setOperacionViendo(null)} className="btn btn-outline sc-x198">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* Editor integrado DESHABILITADO: ahora "Editar" abre el FormularioOperacion completo */}
      {false && operacionEditando && (
        <div className="modal-overlay sc-x199">
          <div className="form-card sc-x200">

            <div className="form-header sc-x201">
              <div className="sc-x110">
                <div>
                  <h2 className="sc-x202">Editar Operación</h2>
                  <div className="sc-x203">
                    {operacionEditando.ref || operacionEditando.id?.substring(0,6)}
                  </div>
                </div>
                <button className="sc-x204" onClick={() => { setOperacionEditando(null); setFormEdicion({}); }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <div className="sc-x205">
                Editor rápido: los campos relacionados a catálogos (Cliente, Convenio, Origen/Destino, Remolque, Proveedor, Monedas) y las conversiones por tipo de cambio se gestionan en "Operaciones Activas".
              </div>
            </div>

            <div className="sc-x206">
              {tabsDetalle.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setPestañaEdicionActiva(tab.id)}
                  style={{
                    padding: '12px 16px', background: 'none', border: 'none',
                    borderBottom: pestañaEdicionActiva === tab.id ? '2px solid #58a6ff' : '2px solid transparent',
                    color: pestañaEdicionActiva === tab.id ? '#f0f6fc' : '#8b949e',
                    cursor: 'pointer', fontWeight: pestañaEdicionActiva === tab.id ? '600' : 'normal',
                    fontSize: '0.9rem', whiteSpace: 'nowrap'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="sc-x207">
              {(() => {
                const lblStyle: any = { display: 'block', fontSize: '0.75rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '6px' };
                const inputStyle: any = { width: '100%', padding: '9px 10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' };
                const roStyle: any = { ...inputStyle, backgroundColor: '#161b22', color: '#8b949e' };
                const gridStyle: any = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' };

                const campoTexto = (campo: string, label: string, span = 1, type = 'text') => (
                  <div style={{ gridColumn: `span ${span}` }}>
                    <label style={lblStyle}>{label}</label>
                    <input type={type} value={formEdicion[campo] ?? ''} onChange={(e) => actualizarCampoEdicion(campo, e.target.value)} style={inputStyle} />
                  </div>
                );
                const campoNum = (campo: string, label: string, span = 1) => (
                  <div style={{ gridColumn: `span ${span}` }}>
                    <label style={lblStyle}>{label}</label>
                    <input type="number" step="0.01" value={formEdicion[campo] ?? ''} onChange={(e) => actualizarCampoEdicion(campo, e.target.value)} style={inputStyle} />
                  </div>
                );
                const campoRO = (campo: string, label: string, span = 1) => (
                  <div style={{ gridColumn: `span ${span}` }}>
                    <label style={lblStyle}>{label} (calculado)</label>
                    <input type="text" value={formatoMoneda(formEdicion[campo])} readOnly style={roStyle} />
                  </div>
                );
                const campoArea = (campo: string, label: string) => (
                  <div className="sc-x138">
                    <label style={lblStyle}>{label}</label>
                    <textarea value={formEdicion[campo] ?? ''} onChange={(e) => actualizarCampoEdicion(campo, e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>
                );

                if (pestañaEdicionActiva === 'general') {
                  return (
                    <div style={gridStyle}>
                      {campoTexto('refCliente', 'Ref. Cliente')}
                      {campoTexto('fechaServicio', 'Fecha de Servicio', 1, 'date')}
                      {campoTexto('trafico', 'Tráfico')}
                      {campoTexto('fechaCita', 'Fecha de Cita', 1, 'datetime-local')}
                      {campoArea('observacionesEjecutivo', 'Observaciones Ejecutivo')}
                    </div>
                  );
                }
                if (pestañaEdicionActiva === 'pedimento') {
                  return (
                    <div style={gridStyle}>
                      {campoTexto('clienteMercanciaNombre', 'Cliente (Mercancía)', 2)}
                      {campoTexto('descripcionMercancia', 'Descripción Mercancía')}
                      {campoTexto('cantidad', 'Cantidad (Enteros)')}
                      {campoTexto('embalajeNombre', 'Embalaje')}
                      {campoTexto('pesoKg', 'Peso (Kg)')}
                      {campoTexto('numDoda', '# DODA')}
                      {campoTexto('fechaEmisionDoda', 'Fecha Emisión DODA', 1, 'date')}
                    </div>
                  );
                }
                if (pestañaEdicionActiva === 'manifiestos') {
                  return (
                    <div style={gridStyle}>
                      {campoTexto('numeroEntrys', "# de Entry's")}
                      {campoTexto('cantEntrys', "Cantidad de Entry's")}
                      {campoTexto('numManifiesto', '# Manifiesto')}
                      {campoTexto('provServiciosNombre', 'Proveedor de Servicios', 2)}
                      {campoNum('montoManifiesto', 'Costo Manifiesto ($)')}
                    </div>
                  );
                }
                if (pestañaEdicionActiva === 'unidad') {
                  return (
                    <div style={gridStyle}>
                      {campoNum('totalAPagarProv', 'Monto a Pagar (Base)')}
                      {campoNum('cargosAdicionalesProv', 'Costos Adicionales')}
                      {campoRO('subtotalProv', 'Subtotal Prov.')}
                      {campoNum('sueldoOperador', 'Sueldo Operador')}
                      {campoNum('sueldoExtra', 'Sueldo Extra')}
                      {campoRO('sueldoTotal', 'Sueldo Total')}
                      {campoNum('combustible', 'Combustible')}
                      {campoNum('combustibleExtra', 'Combustible Extra')}
                      {campoRO('combustibleTotal', 'Total Combustible')}
                      {campoTexto('unidadProveedor', 'Unidad Externa')}
                      {campoTexto('operadorProveedor', 'Operador Externo', 2)}
                      {campoArea('observacionesUnidad', 'Observaciones (Unidad / Proveedor)')}
                    </div>
                  );
                }
                if (pestañaEdicionActiva === 'cobrar') {
                  return (
                    <div style={gridStyle}>
                      {campoNum('montoConvenioCliente', 'Convenio Seleccionado (Base)')}
                      {campoNum('cargosAdicionales', 'Cargos Adicionales')}
                      {campoRO('subtotalCliente', 'Subtotal Cliente')}
                      {campoTexto('tipoCambioAprobado', 'Tipo de Cambio del Día')}
                      <div></div><div></div>
                      {campoArea('observacionesCobrar', 'Observaciones (Facturación / Cobro)')}
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <div className="sc-x208">
              <button onClick={() => { setOperacionEditando(null); setFormEdicion({}); }} className="btn btn-outline sc-x209" disabled={guardandoEdicion}>Cancelar</button>
              <button
                onClick={guardarEdicion}
                disabled={guardandoEdicion}
                style={{ padding: '10px 28px', borderRadius: '6px', border: 'none', backgroundColor: guardandoEdicion ? '#0d1117' : '#238636', color: guardandoEdicion ? '#484f58' : '#fff', fontWeight: 'bold', cursor: guardandoEdicion ? 'not-allowed' : 'pointer' }}
              >
                {guardandoEdicion ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalHorarios === 'historial' && (
        <div className="modal-overlay sc-x210">
          <div className="form-card sc-x211">
            <div className="form-header sc-x212">
              <h2 className="sc-x213">Bitácora de Movimientos</h2>
              <button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button>
            </div>
            <div className="sc-x214">
              {cargandoHorarios ? (
                <div className="sc-x215">Descargando historial...</div>
              ) : (
                <table className="data-table sc-x216">
                  <thead className="sc-x217">
                    <tr>
                      <th className="sc-x218">Fecha y Hora</th>
                      <th className="sc-x218">Estatus Marcado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historialList.length === 0 ? (
                      <tr><td className="sc-x219" colSpan={2}>Sin movimientos registrados.</td></tr>
                    ) : (
                      historialList.map((h: any) => (
                        <tr className="sc-x220" key={h.id}>
                          <td className="sc-x221">{new Date(h.fechaHora).toLocaleString('es-MX')}</td>
                          <td className="sc-x222">{mostrarDatoMapeado(h.status, 'statusServicio', 'nombre')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
            <div className="sc-x223">
              <button onClick={() => setModalHorarios('cerrado')} className="btn btn-outline sc-x209">Cerrar Historial</button>
            </div>
          </div>
        </div>
      )}

      {modalHorarios === 'registrar' && (
        <div className="modal-overlay sc-x210">
          <div className="form-card sc-x224">
            <div className="form-header sc-x212">
              <h2 className="sc-x213">Registrar Movimiento (Fecha Personalizada)</h2>
              <button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button>
            </div>
            <div className="sc-x225">
              <p className="sc-x98">
                Usa este formulario solo si necesitas registrar un movimiento con una fecha y hora distinta a la actual.
              </p>
              <div className="form-group">
                <label className="form-label sc-x3">Fecha y Hora</label>
                <input type="datetime-local" className="form-control" value={nuevaFechaHora} onChange={e => setNuevaFechaHora(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label sc-x3">Estatus / Hito</label>
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
              <button onClick={guardarHorario} disabled={cargandoHorarios} className="btn btn-primary sc-x226">
                {cargandoHorarios ? 'Actualizando...' : 'Guardar y Actualizar Operación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mostrarDocumentos && operacionViendo && (
        <div className="modal-overlay sc-x227">
          <div className="form-card sc-x228">
            <div className="form-header sc-x229">
              <div>
                <h2 className="sc-x230">Documentos de la Operación</h2>
                <p className="sc-x231">
                  Referencia: <span className="sc-x232">{refOperacionViendo}</span>
                </p>
              </div>
              <div className="sc-x233">
                <button className="sc-x234"
                  type="button"
                  onClick={() => setMostrarSubirDocOp(true)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Subir Documento
                </button>
                <button className="sc-x235" onClick={() => setMostrarDocumentos(false)} title="Cerrar">✕</button>
              </div>
            </div>
            <div className="sc-x236">
              <DocumentosLista coleccionOrigen="operaciones" registroId={operacionViendo.id} />
            </div>
            <div className="sc-x237">
              <button onClick={() => setMostrarDocumentos(false)} className="btn btn-outline sc-x209">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO: el modal funciona desde la ficha O directo desde la fila */}
      {(opSubirDocs || operacionViendo) && (() => {
        const objetivo = opSubirDocs || operacionViendo;
        return (
          <DocumentoUploadModal
            isOpen={mostrarSubirDocOp}
            onClose={() => { setMostrarSubirDocOp(false); setOpSubirDocs(null); }}
            coleccionOrigen="operaciones"
            registroId={objetivo.id}
            registroNombre={opSubirDocs ? (opSubirDocs.ref || String(opSubirDocs.id || '').substring(0, 6)) : refOperacionViendo}
            tiposDocumento={TIPOS_DOCUMENTO_OPERACION}
          />
        );
      })()}

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

export default ServiciosCompletados;
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, getCountFromServer, onSnapshot, orderBy, limit, where, startAfter, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import { generarSolicitudRetiroPDF, generarInstruccionesServicioPDF, generarCheckListPDF, generarPruebaEntregaPDF, generarCartaInstruccionesPDF } from '../../../utils/pdfGenerator'; 
import * as XLSX from 'xlsx';
// ✅ NUEVO: reglas de status (botones dinámicos + cascada) — igual que Operaciones Activas
import { obtenerBotonesHorarioDinamicos, resolverCascadaStatus } from '../config/statusRules';
// ✅ NUEVO: visor y subida de documentos ligados a la operación
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import { TIPOS_DOCUMENTO_OPERACION } from './FormularioOperacion';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

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

// ✅ Status considerados "Completado" — sólo los 2 IDs hex (estricto)
const STATUS_COMPLETADOS_VALORES = ['f557b751', 'c2d57403'];
// ID del tipo de empresa "Cliente (Paga)" para el buscador
const ID_TIPO_CLIENTE_PAGA = '7eec9cbb';
// ✅ NUEVO: tamaño de página para descarga incremental
const TAMANIO_PAGINA = 100;
// ✅ NUEVO: TTL del caché en sessionStorage (5 minutos)
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_PREFIX = 'roelca_completadas_';

// ✅ NUEVO: prop opcional para conectar la edición con el formulario existente del padre.
interface ServiciosCompletadosProps {
  onEditar?: (operacion: any) => void;
}

const ServiciosCompletados: React.FC<ServiciosCompletadosProps> = ({ onEditar }) => {
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(false);
  const [operacionViendo, setOperacionViendo] = useState<any | null>(null);

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
  
  const [catalogosGlobales, setCatalogosGlobales] = useState<any>({});
  const [busqueda, setBusqueda] = useState('');

  // ✅ MODIFICADO: el filtro PRINCIPAL ahora es el rango de fechas (inicio/fin).
  const [filterFechaInicio, setFilterFechaInicio] = useState('');
  const [filterFechaFin, setFilterFechaFin] = useState('');
  const [filterRemolque, setFilterRemolque] = useState('');
  const [filterCliente, setFilterCliente] = useState('');

  const [paginaActual, setPaginaActual] = useState(1);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // ✅ NUEVO: paginación incremental (chunks de Firestore con startAfter)
  const [lastDocSnap, setLastDocSnap] = useState<any | null>(null);
  const [hayMasOperaciones, setHayMasOperaciones] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);

  // ✅ NUEVO: buscador autocompletado de cliente
  const [textoBuscarCliente, setTextoBuscarCliente] = useState('');
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);

  // ✅ NUEVO: editor integrado (fallback cuando NO se pasa la prop onEditar)
  const [operacionEditando, setOperacionEditando] = useState<any | null>(null);
  const [formEdicion, setFormEdicion] = useState<any>({});
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [pestañaEdicionActiva, setPestañaEdicionActiva] = useState<string>('general');

  // ✅ NUEVO: conteos EXACTOS desde el servidor (getCountFromServer).
  //   No descargan documentos (≈1 lectura c/u), así que dan el total real
  //   aunque la tabla solo tenga 100/500 operaciones cargadas.
  //   - "Rango": respeta Fecha Inicio/Fin + Cliente seleccionados.
  //   - "Global": TODA la base de completados, sin ningún filtro.
  const [conteosServidor, setConteosServidor] = useState<{
    completados: number | null;   // completados reales (sin falsos)
    falsos: number | null;
    total: number | null;         // completados + falsos
    cargando: boolean;
    error: string | null;
    alcance: 'rango' | 'global' | null;
  }>({ completados: null, falsos: null, total: null, cargando: false, error: null, alcance: null });

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
  //   Las conexiones (diésel, nómina, factura cliente/proveedor) ya vienen
  //   desnormalizadas en el propio documento de la operación cuando se asignan
  //   en sus módulos, así que NO requieren lecturas extra a Firestore:
  //     · Diésel    → referenciaDieselConsecutivo / referenciaDieselId
  //     · Nómina    → referenciaNominaConsecutivo / referenciaNominaId
  //     · Cliente   → facturaClienteInvoice / facturaClienteId / facturado
  //     · Proveedor → facturaProveedorFolio / facturaProveedorId / facturadoProveedor
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

  // ✅ NUEVO: clave de caché basada en el RANGO DE FECHAS + cliente (opcional).
  const claveCacheActual = () =>
    CACHE_PREFIX + `${filterFechaInicio}_${filterFechaFin}_${filterCliente || 'all'}`;

  // ✅ MODIFICADO: el filtro PRINCIPAL ahora es el RANGO DE FECHAS (inicio y fin).
  // El cliente es OPCIONAL (si se elige, se agrega como filtro dentro de la query).
  //
  // Estrategia de carga (en orden):
  //   0) Caché válido en sessionStorage (< 5 min) por rango+cliente → usarlo.
  //   1) Query óptima: where(status, in, [...]) [+ where(clientePaga)] +
  //      where(fechaServicio >= inicio) + where(fechaServicio <= fin) +
  //      orderBy(fechaServicio) + limit(100). Requiere índice compuesto.
  //   2) Fallback 1: misma query SIN orderBy (ordena en memoria).
  //   3) Fallback 2: SOLO rango de fechaServicio + limit(500) (un solo campo,
  //      no requiere índice compuesto) y filtra status/cliente en memoria.
  const descargarOperaciones = async (
    fechaInicio: string,
    fechaFin: string,
    clienteId: string,
    opciones: { ignorarCache?: boolean } = {}
  ) => {
    // Reset paginación al cargar de cero
    setLastDocSnap(null);
    setHayMasOperaciones(false);

    // Sin rango de fechas completo no se descarga nada (es el filtro principal)
    if (!fechaInicio || !fechaFin) {
      setOperacionesGlobales([]);
      return;
    }

    const cacheKey = CACHE_PREFIX + `${fechaInicio}_${fechaFin}_${clienteId || 'all'}`;

    // [0] Intentar caché en sessionStorage
    if (!opciones.ignorarCache) {
      try {
        const cacheStr = sessionStorage.getItem(cacheKey);
        if (cacheStr) {
          const cache = JSON.parse(cacheStr);
          if (cache && Date.now() - cache.ts < CACHE_TTL_MS && Array.isArray(cache.ops)) {
            setOperacionesGlobales(cache.ops);
            setHayMasOperaciones(false);
            return;
          }
        }
      } catch { /* caché corrupto: ignorar */ }
    }

    setCargandoOperaciones(true);

    // Límite superior inclusivo aunque fechaServicio traiga hora (ej. "2026-06-20T10:30")
    const finInclusivo = fechaFin + '\uf8ff';

    const filtrarLegacy = (ops: any[]) => ops.filter((op: any) => {
      const statusOk = STATUS_COMPLETADOS_VALORES.includes(String(op.status || '').trim());
      const clienteOk = !clienteId || String(op.clientePaga || op.clienteId || '') === clienteId;
      const f = String(op.fechaServicio || '');
      const fechaOk = f >= fechaInicio && f <= finInclusivo;
      return statusOk && clienteOk && fechaOk;
    });

    let opsFinal: any[] = [];
    let lastSnapFinal: any = null;
    let hayMasFinal = false;
    let exito = false;

    try {
      // [1] Query óptima: status(in) [+ cliente] + rango fechaServicio + orderBy + limit
      const constraints1: any[] = [where('status', 'in', STATUS_COMPLETADOS_VALORES)];
      if (clienteId) constraints1.push(where('clientePaga', '==', clienteId));
      constraints1.push(where('fechaServicio', '>=', fechaInicio));
      constraints1.push(where('fechaServicio', '<=', finInclusivo));
      constraints1.push(orderBy('fechaServicio', 'desc'));
      constraints1.push(limit(TAMANIO_PAGINA));

      const q1 = query(collection(db, 'operaciones'), ...constraints1);
      const snap = await getDocs(q1);
      opsFinal = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      lastSnapFinal = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
      hayMasFinal = snap.docs.length === TAMANIO_PAGINA;
      exito = true;
    } catch (e1: any) {
      const msg1 = String(e1?.message || e1?.code || e1 || '');
      const esIndice1 = msg1.toLowerCase().includes('index') || msg1.toLowerCase().includes('failed-precondition');
      if (esIndice1) {
        console.warn('[ServiciosCompletados] Query óptima falló (falta índice). Crea el índice con:', msg1);
        try {
          // [2] Fallback 1: misma query SIN orderBy (ordena en memoria)
          const constraints2: any[] = [where('status', 'in', STATUS_COMPLETADOS_VALORES)];
          if (clienteId) constraints2.push(where('clientePaga', '==', clienteId));
          constraints2.push(where('fechaServicio', '>=', fechaInicio));
          constraints2.push(where('fechaServicio', '<=', finInclusivo));
          constraints2.push(limit(TAMANIO_PAGINA * 3));

          const q2 = query(collection(db, 'operaciones'), ...constraints2);
          const snap2 = await getDocs(q2);
          opsFinal = snap2.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          opsFinal.sort((a: any, b: any) =>
            String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || ''))
          );
          // Sin cursor: no se puede paginar correctamente
          lastSnapFinal = null;
          hayMasFinal = false;
          exito = true;
          console.warn('[ServiciosCompletados] Usando Fallback 1 (sin orderBy). Crea el índice para mejor rendimiento.');
        } catch (e2: any) {
          const msg2 = String(e2?.message || e2 || '');
          console.warn('[ServiciosCompletados] Fallback 1 falló, probando legacy:', msg2);
          try {
            // [3] Fallback 2: SOLO rango de fechaServicio (un campo → sin índice compuesto)
            const q3 = query(
              collection(db, 'operaciones'),
              where('fechaServicio', '>=', fechaInicio),
              where('fechaServicio', '<=', finInclusivo),
              limit(500)
            );
            const snap3 = await getDocs(q3);
            const todas = snap3.docs.map((d: any) => ({ id: d.id, ...d.data() }));
            opsFinal = filtrarLegacy(todas);
            opsFinal.sort((a: any, b: any) =>
              String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || ''))
            );
            lastSnapFinal = null;
            hayMasFinal = false;
            exito = true;
            console.warn('[ServiciosCompletados] Usando Fallback 2 (rango simple, filtra en memoria).');
          } catch (e3: any) {
            console.error('[ServiciosCompletados] Todos los intentos fallaron:', e3);
            alert(`No se pudieron cargar las operaciones.\n\nDetalle: ${e3?.message || e3}`);
          }
        }
      } else {
        console.error('[ServiciosCompletados] Error inesperado:', e1);
        alert(`Hubo un problema al cargar las operaciones.\n\nDetalle: ${msg1}`);
      }
    }

    if (exito) {
      setOperacionesGlobales(opsFinal);
      setLastDocSnap(lastSnapFinal);
      setHayMasOperaciones(hayMasFinal);
      // Guardar en caché (los snapshots NO son serializables, sólo los datos)
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), ops: opsFinal }));
      } catch { /* cuota agotada: ignorar */ }
    }

    setCargandoOperaciones(false);
  };

  // ✅ NUEVO: descarga el siguiente chunk de operaciones (paginación incremental).
  // Sólo funciona si la query óptima funcionó (necesita lastDocSnap).
  const cargarMasOperaciones = async () => {
    if (!filterFechaInicio || !filterFechaFin || !lastDocSnap || cargandoMas || cargandoOperaciones) return;
    setCargandoMas(true);
    try {
      const finInclusivo = filterFechaFin + '\uf8ff';
      const constraints: any[] = [where('status', 'in', STATUS_COMPLETADOS_VALORES)];
      if (filterCliente) constraints.push(where('clientePaga', '==', filterCliente));
      constraints.push(where('fechaServicio', '>=', filterFechaInicio));
      constraints.push(where('fechaServicio', '<=', finInclusivo));
      constraints.push(orderBy('fechaServicio', 'desc'));
      constraints.push(startAfter(lastDocSnap));
      constraints.push(limit(TAMANIO_PAGINA));

      const qMas = query(collection(db, 'operaciones'), ...constraints);
      const snap = await getDocs(qMas);
      const nuevas = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      const setCompleto = [...operacionesGlobales, ...nuevas];
      setOperacionesGlobales(setCompleto);
      setLastDocSnap(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null);
      setHayMasOperaciones(snap.docs.length === TAMANIO_PAGINA);
      // Actualizar caché con el conjunto acumulado
      try {
        sessionStorage.setItem(
          claveCacheActual(),
          JSON.stringify({ ts: Date.now(), ops: setCompleto })
        );
      } catch { /* ignorar */ }
    } catch (e: any) {
      console.error('[ServiciosCompletados] Error al cargar más:', e);
      alert(`No se pudieron cargar más operaciones.\n\nDetalle: ${e?.message || e}`);
    }
    setCargandoMas(false);
  };

  // ✅ Catálogos en tiempo real vía onSnapshot: cualquier cambio hecho en otra
  // pantalla (p.ej. tipo de cambio, convenios, empresas) se refleja aquí al
  // instante, sin depender del caché en sessionStorage que antes podía quedar
  // desactualizado durante toda la sesión.
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

  // Se conserva como no-op para no tocar los puntos donde se invocaba antes
  // de abrir formularios/modales: los catálogos ya quedan suscritos al montar.
  const cargarCatalogosSiEsNecesario = async () => {};

  // ✅ Al montar nos suscribimos a los catálogos en vivo.
  // Las operaciones se cargarán cuando el usuario elija un cliente.
  useEffect(() => {
    const unsubscribers = suscribirCatalogosEnVivo();
    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  // ✅ NUEVO: el RANGO DE FECHAS (inicio + fin) es el filtro PRINCIPAL.
  // Cuando ambas fechas están definidas se ejecuta la query (cliente opcional incluido).
  // Si falta alguna fecha, se limpia la tabla.
  useEffect(() => {
    if (filterFechaInicio && filterFechaFin) {
      descargarOperaciones(filterFechaInicio, filterFechaFin, filterCliente);
    } else {
      setOperacionesGlobales([]);
      setLastDocSnap(null);
      setHayMasOperaciones(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFechaInicio, filterFechaFin, filterCliente]);

  useEffect(() => { setPaginaActual(1); }, [busqueda, filterFechaInicio, filterFechaFin, filterRemolque, filterCliente]);

  // ✅ NUEVO: cargar los botones de "Siguiente Paso" para la operación abierta.
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

  const mostrarDatoMapeado = (id: string | null | undefined, catalogo: keyof typeof catalogosGlobales, campoRetorno: string = 'nombre', valorDesnormalizado?: string) => {
    if (valorDesnormalizado && valorDesnormalizado.trim() !== '' && valorDesnormalizado !== '-' && String(valorDesnormalizado).trim() !== String(id).trim()) {
      if (catalogo === 'statusServicio' && valorDesnormalizado.length > 30) {
      } else {
        return valorDesnormalizado; 
      }
    }

    if (!id) return '-';
    if (!catalogosGlobales[catalogo] || !Array.isArray(catalogosGlobales[catalogo])) return id;
    
    const elementoEncontrado = catalogosGlobales[catalogo].find((item: any) => String(item.id).trim() === String(id).trim() || String(item.nombre).trim() === String(id).trim());
    if (!elementoEncontrado) return id;

    if (catalogo === 'empleados') {
      return `${elementoEncontrado.firstName || ''} ${elementoEncontrado.lastNamePaternal || ''}`.trim() || id;
    }
    if (catalogo === 'remolques') {
      return `${elementoEncontrado.nombre || ''} ${elementoEncontrado.placas || elementoEncontrado.placa || ''}`.trim() || id;
    }
    if (catalogo === 'unidades') {
      return elementoEncontrado.unidad || elementoEncontrado.nombre || id;
    }
    if (catalogo === 'catalogoMoneda' || catalogo === 'catalogo_moneda') {
      return elementoEncontrado.moneda || id;
    }
    if (catalogo === 'statusServicio') {
      return elementoEncontrado.nombre || id;
    }
    if (catalogo === 'tiposOperacion') {
      return elementoEncontrado.tipo_operacion || id;
    }

    return elementoEncontrado[campoRetorno] || elementoEncontrado.nombre || id;
  };

  const obtenerNombreConvenioCliente = (id: string, valorDesnormalizado?: string) => {
    if (valorDesnormalizado && valorDesnormalizado.trim() !== '' && valorDesnormalizado !== '-' && String(valorDesnormalizado).trim() !== String(id).trim()) return valorDesnormalizado;
    if (!id) return '-';
    const detalle = catalogosGlobales.catalogoConvDetalles?.find((d:any) => String(d.id).trim() === String(id).trim());
    if (detalle) {
        const tarifaId = detalle.tipoConvenioId || detalle.tipo_convenio_id || detalle.tipoConvenio || detalle.tipo_convenio || detalle['TIPO DE CONVENIO'];
        const tObj = catalogosGlobales.tarifas?.find((t:any) => String(t.id).trim() === String(tarifaId).trim());
        return tObj?.descripcion || tObj?.nombre || id;
    }
    return id;
  };

  const obtenerNombreConvenioProv = (id: string, valorDesnormalizado?: string) => {
    if (valorDesnormalizado && valorDesnormalizado.trim() !== '' && valorDesnormalizado !== '-' && String(valorDesnormalizado).trim() !== String(id).trim()) return valorDesnormalizado;
    if (!id) return '-';
    const detalle = catalogosGlobales.catalogoConvProvDetalles?.find((d:any) => String(d.id).trim() === String(id).trim());
    if (detalle) {
        const tarifaId = detalle.tipoConvenioId || detalle.tipo_convenio || detalle.tarifaId || detalle['TIPO DE CONVENIO'];
        const tObj = catalogosGlobales.tarifas?.find((t:any) => String(t.id).trim() === String(tarifaId).trim());
        return tObj?.descripcion || tObj?.nombre || detalle.tipoConvenioNombre || id;
    }
    return id;
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

  // ✅ NUEVO: refleja el cambio de status en memoria + caché (clave por rango+cliente).
  const aplicarStatusEnMemoria = (opId: string, statusId: string, statusNombre: string) => {
    setOperacionesGlobales(prev => {
      const next = prev.map((o: any) => (o.id === opId ? { ...o, status: statusId, statusNombre } : o));
      if (filterFechaInicio && filterFechaFin) {
        try { sessionStorage.setItem(claveCacheActual(), JSON.stringify({ ts: Date.now(), ops: next })); } catch { /* ignorar */ }
      }
      return next;
    });
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

      aplicarStatusEnMemoria(operacionViendo.id, statusId, statusNombreResuelto);
      alert('Horario registrado y Estatus actualizado.');
      setModalHorarios('cerrado');
    } catch (e) {
      console.error('[ServiciosCompletados] Error guardarHorario:', e);
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

      setGuardandoStatusRapido(null);
      setUltimoStatusGuardado(statusNombre);
      setTimeout(() => setUltimoStatusGuardado(null), 1500);
    } catch (e: any) {
      console.error('[ServiciosCompletados] Error al registrar status:', e);
      // Revertir el cambio optimista
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

  // ✅ MODIFICADO: editar — si el padre pasa onEditar, delega ahí (su formulario).
  // Si NO, abre el editor integrado de este módulo.
  const handleEditarOperacion = (op: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!op) return;
    if (onEditar) {
      onEditar(op);
      return;
    }
    // Abrir editor integrado: copiamos la operación al formulario
    setOperacionEditando(op);
    setFormEdicion({ ...op });
    setPestañaEdicionActiva('general');
  };

  // ✅ NUEVO: actualiza un campo del formulario de edición.
  // Recalcula los totales que la propia UI define por fórmula (subtotales, sueldo, combustible).
  const actualizarCampoEdicion = (campo: string, valor: any) => {
    setFormEdicion((prev: any) => {
      const next = { ...prev, [campo]: valor };
      const num = (v: any) => Number(v) || 0;

      // Subtotal Cliente = Monto Convenio + Cargos Adicionales
      if (campo === 'montoConvenioCliente' || campo === 'cargosAdicionales') {
        next.subtotalCliente = num(next.montoConvenioCliente) + num(next.cargosAdicionales);
      }
      // Subtotal Prov = Monto Base + Cargos Adicionales Prov
      if (campo === 'totalAPagarProv' || campo === 'cargosAdicionalesProv') {
        next.subtotalProv = num(next.totalAPagarProv) + num(next.cargosAdicionalesProv);
      }
      // Sueldo Total = Sueldo Operador + Sueldo Extra
      if (campo === 'sueldoOperador' || campo === 'sueldoExtra') {
        next.sueldoTotal = num(next.sueldoOperador) + num(next.sueldoExtra);
      }
      // Combustible Total = Combustible + Combustible Extra
      if (campo === 'combustible' || campo === 'combustibleExtra') {
        next.combustibleTotal = num(next.combustible) + num(next.combustibleExtra);
      }
      return next;
    });
  };

  // ✅ NUEVO: guardar los cambios del editor integrado en Firestore.
  const guardarEdicion = async () => {
    if (!operacionEditando?.id) return;
    setGuardandoEdicion(true);
    try {
      // Sólo enviamos los campos editables (evitamos sobrescribir todo el documento).
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

      // Reflejar los cambios en memoria
      const aplicar = (o: any) => (o.id === operacionEditando.id ? { ...o, ...payload } : o);
      const nuevasGlobales = operacionesGlobales.map(aplicar);
      setOperacionesGlobales(nuevasGlobales);
      if (operacionViendo?.id === operacionEditando.id) {
        setOperacionViendo({ ...operacionViendo, ...payload });
      }

      // Actualizar caché (clave por rango de fechas + cliente)
      if (filterFechaInicio && filterFechaFin) {
        try {
          sessionStorage.setItem(
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

  // ✅ NUEVO: eliminar — borra el documento en Firestore y limpia estado/caché.
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

      // Quitar de los estados en memoria
      const restantes = operacionesGlobales.filter((o: any) => o.id !== op.id);
      setOperacionesGlobales(restantes);

      // Cerrar la ficha si era la que estaba abierta
      if (operacionViendo?.id === op.id) setOperacionViendo(null);

      // Actualizar el caché (clave por rango de fechas + cliente)
      if (filterFechaInicio && filterFechaFin) {
        try {
          sessionStorage.setItem(
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

  const forzarRecarga = () => {
    sessionStorage.removeItem('roelca_catalogos_v2');
    // ✅ NUEVO: limpiar también el caché de operaciones completadas
    try {
      const keys = Object.keys(sessionStorage);
      keys.forEach(k => { if (k.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(k); });
    } catch { /* ignorar */ }
    window.location.reload();
  };

  // ✅ MODIFICADO: el filtro PRINCIPAL es el rango de fechas.
  //   • Sin rango completo (inicio + fin) → vacío (mensaje guía).
  //   • Con rango → parte de lo descargado y aplica filtros OPCIONALES en memoria
  //     (cliente defensivo, remolque y búsqueda general).
  const operacionesFiltradas = useMemo(() => {
    if (!filterFechaInicio || !filterFechaFin) return [];

    let filtradas = operacionesGlobales;

    // Cliente (opcional) — defensivo, por si el fallback no lo filtró en la query
    if (filterCliente) {
      filtradas = filtradas.filter(op => String(op.clientePaga || op.clienteId || '') === filterCliente);
    }

    if (filterRemolque) {
      filtradas = filtradas.filter(op => String(op.numeroRemolque || '') === filterRemolque || String(op.remolqueNombre || '').toLowerCase().includes(filterRemolque.toLowerCase()));
    }

    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
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

    return filtradas;
  }, [busqueda, operacionesGlobales, filterFechaInicio, filterFechaFin, filterRemolque, filterCliente]);

  // ───────────────────────────────────────────────────────────────────────────
  // ✅ NUEVO: RESUMEN de conteos del rango/filtro actual.
  //   Respeta el rango de fechas + cliente/remolque/búsqueda activos (lo mismo
  //   que muestra la tabla). Cuenta: Completados vs Falsos, facturados y
  //   pendientes (cliente y proveedor), con diésel cargado y pagados en nómina.
  // ───────────────────────────────────────────────────────────────────────────
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

  const totalPaginas = Math.ceil(operacionesFiltradas.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const operacionesEnPantalla = operacionesFiltradas.slice(indicePrimerRegistro, indiceUltimoRegistro);

  // ───────────────────────────────────────────────────────────────────────────
  // ✅ NUEVO: TOTALES EXACTOS desde el servidor con getCountFromServer().
  //   Cuenta TODOS los documentos que cumplen el filtro SIN descargarlos
  //   (cuesta ≈1 lectura por consulta), así que da el número real aunque la
  //   tabla solo tenga cargadas 100/500 operaciones.
  //
  //   alcance = 'rango'  → respeta Fecha Inicio/Fin + Cliente seleccionados.
  //   alcance = 'global' → toda la base de completados, SIN ningún filtro.
  //
  //   Los "Falsos" se cuentan por el ID de status cuyo nombre contiene "falso"
  //   (resuelto desde el catálogo). Completados reales = total − falsos.
  // ───────────────────────────────────────────────────────────────────────────
  const idStatusFalso = useMemo(() => {
    const lista = (catalogosGlobales.statusServicio || []) as any[];
    const found = lista.find((s: any) => String(s.nombre || '').toLowerCase().includes('falso'));
    return found ? String(found.id) : '';
  }, [catalogosGlobales.statusServicio]);

  const calcularTotalesServidor = async (alcance: 'rango' | 'global') => {
    if (alcance === 'rango' && (!filterFechaInicio || !filterFechaFin)) {
      alert('Selecciona Fecha Inicio y Fecha Fin para los totales del rango.');
      return;
    }
    setConteosServidor(prev => ({ ...prev, cargando: true, error: null, alcance }));
    try {
      const col = collection(db, 'operaciones');

      // Restricciones base según alcance
      const baseConstraints: any[] = [];
      if (alcance === 'rango') {
        if (filterCliente) baseConstraints.push(where('clientePaga', '==', filterCliente));
        baseConstraints.push(where('fechaServicio', '>=', filterFechaInicio));
        baseConstraints.push(where('fechaServicio', '<=', filterFechaFin + '\uf8ff'));
      }

      // 1) TOTAL de completados (los 2 IDs hex)
      const qTotal = query(col, where('status', 'in', STATUS_COMPLETADOS_VALORES), ...baseConstraints);
      const snapTotal = await getCountFromServer(qTotal);
      const total = snapTotal.data().count;

      // 2) FALSOS (status == idStatusFalso). Si no se resolvió el ID, lo dejamos null.
      let falsos: number | null = null;
      if (idStatusFalso) {
        const qFalsos = query(col, where('status', '==', idStatusFalso), ...baseConstraints);
        const snapFalsos = await getCountFromServer(qFalsos);
        falsos = snapFalsos.data().count;
      }

      const completados = falsos !== null ? total - falsos : total;
      setConteosServidor({ completados, falsos, total, cargando: false, error: null, alcance });
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      console.error('[ServiciosCompletados] Error en conteo de servidor:', e);
      setConteosServidor(prev => ({
        ...prev,
        cargando: false,
        error: msg.toLowerCase().includes('index')
          ? 'Falta un índice en Firestore para este conteo. Revisa la consola para el enlace de creación.'
          : (msg || 'No se pudo calcular el total.'),
      }));
    }
  };

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  // ✅ NUEVO: lista de clientes Paga (filtra empresas por tiposEmpresa que incluya 7eec9cbb)
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

  // ✅ NUEVO: nombre del cliente actualmente seleccionado (para mostrar el chip)
  const nombreClienteSeleccionado = useMemo(() => {
    if (!filterCliente || !catalogosGlobales.empresas) return '';
    const cli = catalogosGlobales.empresas.find((e: any) => e.id === filterCliente);
    return cli?.nombre || filterCliente;
  }, [filterCliente, catalogosGlobales.empresas]);

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
      case 'ref': return <span className="font-mono" style={{ color: '#10b981', fontWeight: 'bold' }}>{op.ref || op.id?.substring(0,6)}</span>;
      case 'fechaServicio': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.fechaServicio)}</span>;
      case 'fechaCita': return <span style={{ color: '#c9d1d9' }}>{formatearFechaHora(op.fechaCita)}</span>;
      case 'tipoOperacion': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)}</span>;
      case 'status': return <span style={{ color: '#10b981', fontWeight: 'bold' }}>{mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre)}</span>;
      // ✅ NUEVO: conexiones (ref. diésel, ref. nómina, invoice cliente/proveedor)
      case 'refDiesel': return op.referenciaDieselConsecutivo ? chipConexion(op.referenciaDieselConsecutivo, '#f59e0b') : <span style={{ color: '#8b949e' }}>-</span>;
      case 'refNomina': return op.referenciaNominaConsecutivo ? chipConexion(op.referenciaNominaConsecutivo, '#a371f7') : <span style={{ color: '#8b949e' }}>-</span>;
      case 'invoiceCliente': return (op.facturaClienteInvoice || op.facturado) ? chipConexion(op.facturaClienteInvoice || 'Facturada', '#10b981') : <span style={{ color: '#8b949e' }}>-</span>;
      case 'invoiceProveedor': return (op.facturaProveedorFolio || op.facturadoProveedor) ? chipConexion(op.facturaProveedorFolio || 'Facturada', '#58a6ff') : <span style={{ color: '#8b949e' }}>-</span>;
      case 'trafico': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.trafico)}</span>;
      case 'cliente': return <span style={{ color: '#f0f6fc', fontWeight: '500' }}>{mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente)}</span>;
      case 'convenioTarifa': return <span style={{ color: '#c9d1d9', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}>{obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}</span>;
      case 'refCliente': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.refCliente)}</span>;
      case 'facturadoEnCobrar': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre)}</span>;
      case 'montoConvenioCliente': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.montoConvenioCliente)}</span>;
      case 'cargosAdicionales': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.cargosAdicionales)}</span>;
      case 'subtotal': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(op.subtotalCliente)}</span>;
      case 'tipoCambioAprobado': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.tipoCambioAprobado)}</span>;
      case 'dolaresCliente': return <span style={{ color: '#10b981' }}>{formatoMoneda(op.dolaresCliente)}</span>;
      case 'pesosCliente': return <span style={{ color: '#3b82f6' }}>{formatoMoneda(op.pesosCliente)}</span>;
      case 'conversionCliente': return <span style={{ color: '#D84315' }}>{formatoMoneda(op.conversionCliente)}</span>;
      case 'origen': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.origen, 'empresas', 'nombre', op.origenNombre)}</span>;
      case 'destino': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.destino, 'empresas', 'nombre', op.destinoNombre)}</span>;
      case 'remolque': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre)}</span>;
      case 'proveedor': return <span style={{ color: '#c9d1d9', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={op.proveedorUnidadNombre || op.proveedorUnidad}>{mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre)}</span>;
      case 'unidadProveedor': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.unidadProveedor)}</span>;
      case 'operadorProveedor': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.operadorProveedor)}</span>;
      case 'convenioProv': return <span style={{ color: '#c9d1d9', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre)}>{obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre)}</span>;
      case 'facturadoEnUnidad': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre)}</span>;
      case 'monedaConvenioProv': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre)}</span>;
      case 'totalAPagarProv': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.totalAPagarProv)}</span>;
      case 'cargosAdicionalesProv': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.cargosAdicionalesProv)}</span>;
      case 'subtotalProv': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(op.subtotalProv)}</span>;
      case 'dolaresProv': return <span style={{ color: '#3b82f6' }}>{formatoMoneda(op.dolaresProv)}</span>;
      case 'pesosProv': return <span style={{ color: '#3b82f6' }}>{formatoMoneda(op.pesosProv)}</span>;
      case 'conversionProv': return <span style={{ color: '#f85149' }}>{formatoMoneda(op.conversionProv)}</span>;
      case 'unidad': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre)}</span>;
      case 'operador': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.operador, 'empleados', 'nombre', op.operadorNombre)}</span>;
      case 'sueldoOperador': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.sueldoOperador)}</span>;
      case 'sueldoExtra': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.sueldoExtra)}</span>;
      case 'sueldoTotal': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(op.sueldoTotal)}</span>;
      case 'combustible': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.combustible)}</span>;
      case 'combustibleExtra': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.combustibleExtra)}</span>;
      case 'combustibleTotal': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(op.combustibleTotal)}</span>;
      case 'clienteMercancia': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.clienteMercancia, 'empresas', 'nombre', op.clienteMercanciaNombre)}</span>;
      case 'descripcionMercancia': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.descripcionMercancia)}</span>;
      case 'cantidad': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.cantidad)}</span>;
      case 'embalaje': return <span style={{ color: '#c9d1d9' }}>{op.embalajeNombre || op.embalaje || '-'}</span>;
      case 'pesoKg': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.pesoKg)}</span>;
      case 'numDoda': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.numDoda)}</span>;
      case 'fechaEmisionDoda': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.fechaEmisionDoda)}</span>;
      case 'numeroEntrys': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.numeroEntrys)}</span>;
      case 'cantEntrys': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.cantEntrys)}</span>;
      case 'numManifiesto': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.numManifiesto)}</span>;
      case 'provServicios': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.provServicios, 'empresas', 'nombre', op.provServiciosNombre)}</span>;
      case 'montoManifiesto': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.montoManifiesto)}</span>;
      case 'totalGastos': return <span style={{ color: '#f85149', fontWeight: 'bold' }}>{formatoMoneda(op.totalGastos)}</span>;
      case 'utilidadEstimada': return <span style={{ color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(op.utilidadEstimada)}</span>;
      case 'observacionesEjecutivo': return <span style={{ color: '#8b949e', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mostrarDato(op.observacionesEjecutivo)}</span>;
      case 'observacionesUnidad': return <span style={{ color: '#8b949e', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mostrarDato(op.observacionesUnidad)}</span>;
      case 'observacionesCobrar': return <span style={{ color: '#8b949e', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mostrarDato(op.observacionesCobrar)}</span>;
      default: return '-';
    }
  };

  const exportarExcel = async () => {
    if (operacionesFiltradas.length === 0) return alert("No hay datos para exportar.");
    
    const columnasVisibles = columnasTabla.filter(c => c.visible);
    
    await cargarCatalogosSiEsNecesario();

    const datosExcel = operacionesFiltradas.map(op => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        let val: any = '-';
        switch (col.id) {
          case 'ref': val = op.ref || op.id?.substring(0,6) || ''; break;
          case 'fechaServicio': val = op.fechaServicio || ''; break;
          case 'fechaCita': val = formatearFechaHora(op.fechaCita); break;
          case 'tipoOperacion': val = mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre); break;
          case 'status': val = mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre); break; 
          // ✅ NUEVO: conexiones en el Excel
          case 'refDiesel': val = op.referenciaDieselConsecutivo || ''; break;
          case 'refNomina': val = op.referenciaNominaConsecutivo || ''; break;
          case 'invoiceCliente': val = op.facturaClienteInvoice || (op.facturado ? 'Facturada' : ''); break;
          case 'invoiceProveedor': val = op.facturaProveedorFolio || (op.facturadoProveedor ? 'Facturada' : ''); break;
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
          case 'embalaje': val = op.embalajeNombre || op.embalaje || ''; break;
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
  };

  const tabsDetalle = [{ id: 'general', label: 'Información General' }, { id: 'pedimento', label: 'Pedimento y CT' }, { id: 'manifiestos', label: "Entry's y Manifiestos" }, { id: 'unidad', label: 'Unidad y Operador' }, { id: 'cobrar', label: 'Por Cobrar' }];

  const evalTipoOpText = String(operacionViendo?.tipoOperacionNombre || operacionViendo?.tipoOperacionId || '').toLowerCase();
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsRoelca = String(operacionViendo?.proveedorUnidadNombre || operacionViendo?.proveedorUnidad || '').toLowerCase().includes('roelca');
  
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  // ✅ Referencia legible de la operación en curso (carpeta de Storage de documentos)
  const refOperacionViendo = operacionViendo ? (operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'Operacion') : '';

  const btnSecondaryActionStyle = { background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', gap: '8px', fontWeight: 'bold', transition: 'background 0.2s', fontSize: '0.85rem' };
  const btnDocStyle = { background: 'transparent', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '6px', fontSize: '0.85rem', transition: 'all 0.2s' };

  // ✅ NUEVO: estilos de las tarjetas de resumen.
  const cardResumenStyle: React.CSSProperties = { backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '4px' };
  const cardLabelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.72rem', fontWeight: 'bold', textTransform: 'uppercase' };
  const cardValueStyle: React.CSSProperties = { fontSize: '1.6rem', fontWeight: 'bold', lineHeight: 1.1 };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', margin: '0 auto' }}>
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#10b981', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          ✓ Servicios Completados
        </h1>

        {/* ✅ MODIFICADO: el filtro PRINCIPAL ahora es el RANGO DE FECHAS
            (Fecha Inicio + Fecha Fin). Cliente, Remolque y el filtro general
            son OPCIONALES. La query se dispara cuando ambas fechas están puestas. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
          {/* ✅ PRINCIPAL: Fecha Inicio */}
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ display: 'block', color: '#10b981', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>FECHA INICIO ★</label>
            <input type="date" value={filterFechaInicio} onChange={(e) => setFilterFechaInicio(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9' }} />
          </div>

          {/* ✅ PRINCIPAL: Fecha Fin */}
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ display: 'block', color: '#10b981', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>FECHA FIN ★</label>
            <input type="date" value={filterFechaFin} min={filterFechaInicio || undefined} onChange={(e) => setFilterFechaFin(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9' }} />
          </div>

          <div style={{ flex: '1 1 280px', position: 'relative' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>CLIENTE QUE PAGA (opcional)</label>

            {filterCliente ? (
              // ✅ Cliente seleccionado: mostrar chip con X para limpiar
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #10b981', borderRadius: '6px', minHeight: '20px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                <span style={{ color: '#10b981', fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
              // ✅ Sin cliente: input de búsqueda con autocompletado
              <div style={{ position: 'relative' }}>
                <svg style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#10b981' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input
                  type="text"
                  placeholder="Buscar cliente por nombre o RFC..."
                  value={textoBuscarCliente}
                  onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
                  onFocus={() => setMostrarSugerenciasCliente(true)}
                  onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)}
                  style={{ width: '100%', padding: '10px 10px 10px 32px', backgroundColor: '#0d1117', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
              </div>
            )}

            {!filterCliente && mostrarSugerenciasCliente && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                backgroundColor: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: '6px',
                maxHeight: '320px',
                overflowY: 'auto',
                zIndex: 100,
                marginTop: '4px',
                boxShadow: '0 6px 16px rgba(0,0,0,0.5)'
              }}>
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
                        onClick={() => {
                          setFilterCliente(cli.id);
                          setTextoBuscarCliente('');
                          setMostrarSugerenciasCliente(false);
                        }}
                        style={{
                          padding: '10px 12px',
                          cursor: 'pointer',
                          color: '#c9d1d9',
                          fontSize: '0.88rem',
                          borderBottom: '1px solid #21262d',
                          transition: 'background-color 0.15s'
                        }}
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

          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>REMOLQUE (opcional)</label>
            <select value={filterRemolque} onChange={(e) => setFilterRemolque(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}>
              <option value="">Seleccionar Remolque...</option>
              {catalogosGlobales.remolques?.map((rem: any) => (
                <option key={rem.id} value={rem.id}>{`${rem.nombre || ''} ${rem.placas || rem.placa || ''}`.trim()}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>FILTRO GENERAL (opcional)</label>
            <div style={{ position: 'relative' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder="Buscar por Ref..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px 10px 10px 36px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-end', marginLeft: 'auto', paddingBottom: '2px' }}>
            <button className="btn btn-outline" onClick={() => setModalColumnas(true)} style={{ padding: '10px 12px' }} title="Configurar Columnas">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button className="btn btn-outline" onClick={forzarRecarga} style={{ padding: '10px 12px' }} title="Recargar Catálogos">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 0 20.49 15"></path></svg>
            </button>
            <button className="btn btn-outline" onClick={exportarExcel} style={{ padding: '10px 12px' }} title="Exportar a Excel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>
        </div>

        {/* ✅ NUEVO: TARJETAS DE RESUMEN (conteos del rango/filtro actual).
            Status (Completados / Falsos), Diésel y Nómina; y la fila de
            facturación (cliente y proveedor: facturados y pendientes). */}
        {(filterFechaInicio && filterFechaFin) && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginTop: '12px' }}>
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

            {hayMasOperaciones && (
              <div style={{ marginTop: '8px', color: '#fb923c', fontSize: '0.78rem' }}>
                ⚠ Hay más operaciones en este rango sin descargar (usa "+ Cargar más" abajo). Los conteos de arriba reflejan solo lo descargado hasta ahora.
              </div>
            )}

            {/* ✅ NUEVO: TOTALES EXACTOS desde el servidor (cuenta toda la base sin descargarla) */}
            <div style={{ marginTop: '14px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                <span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '0.9rem' }}>Totales exactos (servidor)</span>
                <span style={{ color: '#8b949e', fontSize: '0.78rem', flex: '1 1 200px' }}>
                  Cuenta TODA la base sin importar el límite de descarga. No descarga operaciones.
                </span>
                <button
                  onClick={() => calcularTotalesServidor('rango')}
                  disabled={conteosServidor.cargando}
                  style={{ padding: '8px 14px', backgroundColor: conteosServidor.cargando ? '#0d1117' : '#238636', color: conteosServidor.cargando ? '#484f58' : '#fff', border: 'none', borderRadius: '6px', cursor: conteosServidor.cargando ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}
                  title="Cuenta exactamente los completados del rango/cliente seleccionado"
                >
                  Σ Total del rango
                </button>
                <button
                  onClick={() => calcularTotalesServidor('global')}
                  disabled={conteosServidor.cargando}
                  style={{ padding: '8px 14px', backgroundColor: conteosServidor.cargando ? '#0d1117' : '#1f6feb', color: conteosServidor.cargando ? '#484f58' : '#fff', border: 'none', borderRadius: '6px', cursor: conteosServidor.cargando ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}
                  title="Cuenta TODA la base de completados, sin fechas ni cliente"
                >
                  Σ Total global (sin filtros)
                </button>
              </div>

              {conteosServidor.cargando && (
                <div style={{ marginTop: '12px', color: '#8b949e', fontSize: '0.85rem' }}>Contando en el servidor...</div>
              )}

              {conteosServidor.error && !conteosServidor.cargando && (
                <div style={{ marginTop: '12px', color: '#f85149', fontSize: '0.82rem' }}>{conteosServidor.error}</div>
              )}

              {!conteosServidor.cargando && !conteosServidor.error && conteosServidor.total !== null && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ color: '#8b949e', fontSize: '0.75rem', marginBottom: '8px' }}>
                    Resultado: <span style={{ color: '#fb923c', fontWeight: 'bold' }}>{conteosServidor.alcance === 'global' ? 'TODA la base (sin filtros)' : 'Rango / cliente seleccionado'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                    <div style={cardResumenStyle}>
                      <span style={cardLabelStyle}>Total (real)</span>
                      <span style={{ ...cardValueStyle, color: '#f0f6fc' }}>{conteosServidor.total}</span>
                    </div>
                    <div style={cardResumenStyle}>
                      <span style={cardLabelStyle}>Completados (real)</span>
                      <span style={{ ...cardValueStyle, color: '#10b981' }}>{conteosServidor.completados}</span>
                    </div>
                    <div style={cardResumenStyle}>
                      <span style={cardLabelStyle}>Falsos (real)</span>
                      <span style={{ ...cardValueStyle, color: '#f85149' }}>{conteosServidor.falsos !== null ? conteosServidor.falsos : 'N/D'}</span>
                    </div>
                  </div>
                  {conteosServidor.falsos === null && (
                    <div style={{ marginTop: '8px', color: '#fb923c', fontSize: '0.78rem' }}>
                      ⚠ No se encontró un status llamado "Falso" en el catálogo, por eso no se separan los falsos. El "Total" sí es exacto.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            {cargandoOperaciones ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>
                Cargando operaciones completadas...
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px', width: '150px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
                      Acciones
                    </th>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <th key={`th_${col.id}`} style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(!filterFechaInicio || !filterFechaFin) ? (
                    <tr>
                      <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e', fontWeight: '500' }}>
                        Selecciona <strong style={{ color: '#10b981' }}>Fecha Inicio</strong> y <strong style={{ color: '#10b981' }}>Fecha Fin</strong> para buscar las operaciones completadas.
                      </td>
                    </tr>
                  ) : operacionesEnPantalla.length === 0 ? (
                    <tr>
                      <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                        Sin resultados para el rango de fechas y los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    operacionesEnPantalla.map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                        <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div className="actions-cell" style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button 
                              type="button" 
                              title="Ver Detalles"
                              onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setPestañaDetalleActiva('general'); }} 
                              style={{ background: 'transparent', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button 
                              type="button" 
                              title="Editar"
                              onClick={(e) => handleEditarOperacion(op, e)} 
                              style={{ background: 'transparent', border: '1px solid #58a6ff', borderRadius: '4px', color: '#58a6ff', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(88, 166, 255, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button 
                              type="button" 
                              title="Eliminar"
                              onClick={(e) => handleEliminarOperacion(op, e)} 
                              style={{ background: 'transparent', border: '1px solid #f85149', borderRadius: '4px', color: '#f85149', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(248, 81, 73, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        {columnasTabla.filter(c => c.visible).map(col => (
                          <td key={`cell_${op.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesFiltradas.length)} de {operacionesFiltradas.length} operaciones completadas
                {hayMasOperaciones && <span style={{ color: '#fb923c', marginLeft: '8px' }}>(hay más disponibles)</span>}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* ✅ NUEVO: botón Cargar más (paginación por rango de fechas) */}
                {hayMasOperaciones && (
                  <button
                    onClick={cargarMasOperaciones}
                    disabled={cargandoMas}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: cargandoMas ? '#0d1117' : '#D84315',
                      color: cargandoMas ? '#484f58' : '#fff',
                      border: '1px solid #D84315',
                      borderRadius: '6px',
                      cursor: cargandoMas ? 'not-allowed' : 'pointer',
                      fontWeight: 'bold',
                      fontSize: '0.85rem'
                    }}
                    title="Descargar el siguiente bloque de operaciones del rango"
                  >
                    {cargandoMas ? 'Cargando...' : `+ Cargar más (${TAMANIO_PAGINA})`}
                  </button>
                )}
                <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '1000px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '24px' }}>Arrastra los campos para reordenarlos. Desmarca los que desees ocultar de la tabla principal y del reporte de Excel.</p>
            
            <ul style={{ 
              listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', 
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' 
            }}>
              {columnasTabla.map((col, idx) => (
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
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={() => setModalColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {operacionViendo && (
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
          <div className="form-card detail-card" style={{ maxWidth: '1100px', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            
            <div className="form-header" style={{ padding: '24px 32px 16px 32px', borderBottom: 'none', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.6rem', fontWeight: 600, letterSpacing: '-0.5px' }}>
                    Detalle de Operación Completada
                  </h2>
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1.1rem', letterSpacing: '0.5px' }}>
                      {operacionViendo.ref || operacionViendo.id?.substring(0,6)}
                    </span>
                    <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 'bold' }}>
                      {mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}
                    </span>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
                  <div style={{ width: '1px', height: '24px', backgroundColor: '#30363d', margin: '0 8px' }}></div>
                  <button onClick={() => setOperacionViendo(null)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', transition: '0.2s' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              </div>

              {/* ✅ NUEVO: chips de CONEXIONES de la operación (diésel, nómina, facturas) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingBottom: '4px' }}>
                <span style={{ color: '#8b949e', fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '1px', marginRight: '4px' }}>CONEXIONES</span>
                <span style={{ color: '#8b949e', fontSize: '0.78rem' }}>Diésel:</span>
                {operacionViendo.referenciaDieselConsecutivo ? chipConexion(operacionViendo.referenciaDieselConsecutivo, '#f59e0b') : <span style={{ color: '#484f58', fontSize: '0.8rem' }}>Sin cargar</span>}
                <span style={{ color: '#8b949e', fontSize: '0.78rem', marginLeft: '8px' }}>Nómina:</span>
                {operacionViendo.referenciaNominaConsecutivo ? chipConexion(operacionViendo.referenciaNominaConsecutivo, '#a371f7') : <span style={{ color: '#484f58', fontSize: '0.8rem' }}>Sin pagar</span>}
                <span style={{ color: '#8b949e', fontSize: '0.78rem', marginLeft: '8px' }}>Factura Cliente:</span>
                {(operacionViendo.facturaClienteInvoice || operacionViendo.facturado) ? chipConexion(operacionViendo.facturaClienteInvoice || 'Facturada', '#10b981') : <span style={{ color: '#484f58', fontSize: '0.8rem' }}>Pendiente</span>}
                <span style={{ color: '#8b949e', fontSize: '0.78rem', marginLeft: '8px' }}>Factura Proveedor:</span>
                {(operacionViendo.facturaProveedorFolio || operacionViendo.facturadoProveedor) ? chipConexion(operacionViendo.facturaProveedorFolio || 'Facturada', '#58a6ff') : <span style={{ color: '#484f58', fontSize: '0.8rem' }}>Pendiente</span>}
              </div>

              {/* ✅ NUEVO: SIGUIENTE PASO — editar status/horario igual que Operaciones Activas */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 0 10px 0', borderTop: '1px solid #30363d', flexWrap: 'wrap' }}>
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

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderTop: '1px solid #30363d', marginTop: '4px', flexWrap: 'wrap' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', fontWeight: 'bold', letterSpacing: '0.5px', marginRight: '8px' }}>GENERAR DOCUMENTOS:</span>
                
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
            
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 32px', overflowX: 'auto', flexShrink: 0 }}>
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

            <div className="detail-content" style={{ padding: '24px 32px', overflowY: 'auto', flex: 1 }}>
              
              {pestañaDetalleActiva === 'general' && (
                <div style={{ animation: 'fadeIn 0.2s ease', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Tipo de Operación</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.tipoOperacionNombre || operacionViendo.tipoOperacionId || '-'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Servicio / Status</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.fechaServicio)} <span style={{color: '#30363d', margin: '0 8px'}}>|</span> <span style={{color: '#10b981', fontWeight: 'bold'}}>{operacionViendo.statusNombre || operacionViendo.status || '-'}</span></span>
                  </div>
                  
                  {evalIsFletes ? (
                     <div>
                       <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Cita</span>
                       <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatearFechaHora(operacionViendo.fechaCita)}</span>
                     </div>
                  ) : (
                    <div></div> 
                  )}

                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>

                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Paga)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.clienteNombre || operacionViendo.nombreCliente || operacionViendo.clientePaga)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio (Tarifa)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.convenioNombre || operacionViendo.convenio || '-'}</span> 
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Remolque</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.remolquePlaca || operacionViendo.numeroRemolque || '-'}</span>
                  </div>
                  
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Ref Cliente</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.refCliente)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Origen</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.origenNombre || operacionViendo.origen || '-'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Destino</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.destinoNombre || operacionViendo.destino || '-'}</span>
                  </div>
                  <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Observaciones Ejecutivo</span>
                    <div style={{ color: '#c9d1d9', fontWeight: '500', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>
                      {mostrarDato(operacionViendo.observacionesEjecutivo)}
                    </div>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'pedimento' && (
                <div style={{ animation: 'fadeIn 0.2s ease', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Mercancía)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.clienteMercanciaNombre || operacionViendo.clienteMercancia || '-'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Descripción de la Mercancía</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.descripcionMercancia)}</span>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cantidad (Enteros)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.cantidad)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Embalaje</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.embalajeNombre || operacionViendo.embalaje || '-'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Peso (Kg) Decimales</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.pesoKg)}</span>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># DODA</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.numDoda)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Emisión (DODA)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.fechaEmisionDoda)}</span>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'manifiestos' && (
                <div style={{ animation: 'fadeIn 0.2s ease', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Entry's</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.numeroEntrys)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cantidad de Entry's</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.cantEntrys)}</span>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># Manifiesto</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.numManifiesto)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Proveedor de Servicios</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.provServiciosNombre || operacionViendo.provServicios || '-'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Costo Manifiesto ($)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: 'bold', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.montoManifiesto)}</span>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'unidad' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                    <div style={{ gridColumn: 'span 3' }}>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Proveedor de Transporte</span>
                      <span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem' }}>{operacionViendo.proveedorUnidadNombre || operacionViendo.proveedorUnidad || '-'}</span>
                    </div>
                  </div>

                  <div style={{ backgroundColor: '#161b22', padding: '20px', borderRadius: '12px', border: '1px solid #30363d', marginBottom: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '16px' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Facturado En:</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarMoneda(operacionViendo.facturadoEnUnidad)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio Proveedor</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.convenioProveedorNombre || operacionViendo.convenioProveedor || '-'}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Moneda del Convenio (Base)</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarMoneda(operacionViendo.monedaConvenioProv)}</span>
                      </div>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d', marginBottom: '16px' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Monto a Pagar (Base)</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.totalAPagarProv)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Costos Adicionales</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.cargosAdicionalesProv)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Subtotal (Convenio + Costos)</span>
                        <span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.subtotalProv)}</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Dólares</span>
                        <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.dolaresProv)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Pesos</span>
                        <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.pesosProv)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#f85149', fontWeight: 'bold', marginBottom: '4px' }}>Conversión Final (Gasto)</span>
                        <span style={{ color: '#f85149', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.conversionProv)}</span>
                      </div>
                    </div>
                  </div>

                  {showDetailInternalFleet && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                      <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#f0f6fc', margin: '0 0 8px 0' }}>Flota Operativa (Roelca)</h4></div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Unidad Asignada</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.unidadNombre || operacionViendo.unidad || '-'}</span>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Operador Asignado</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.operadorNombre || operacionViendo.operador || '-'}</span>
                      </div>
                      
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo del Operador</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.sueldoOperador)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo Extra</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.sueldoExtra)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo Total</span>
                        <span style={{ color: '#f0f6fc', fontWeight: 'bold', backgroundColor: '#161b22', padding: '6px 10px', borderRadius: '4px', border: '1px solid #30363d', display: 'inline-block' }}>{formatoMoneda(operacionViendo.sueldoTotal)}</span>
                      </div>

                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>

                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Combustible</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.combustible)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Combustible Extra</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.combustibleExtra)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Total Combustible</span>
                        <span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.combustibleTotal)}</span>
                      </div>
                    </div>
                  )}

                  {showDetailExternalFleet && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                      <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#58a6ff', margin: '0 0 8px 0' }}>Flota Externa (Proveedor)</h4></div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Unidad Externa</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.unidadProveedor)}</span>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Operador Externo</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.operadorProveedor)}</span>
                      </div>
                    </div>
                  )}

                  <div style={{ gridColumn: 'span 3', marginTop: '20px' }}>
                    <div style={{ backgroundColor: '#0d1117', border: '1px solid #f85149', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ color: '#8b949e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Total Gastos [Sueldos + Manifiesto]</div>
                      <div style={{ color: '#f85149', fontSize: '2rem', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.totalGastos)}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: '24px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '8px' }}>Observaciones (Unidad / Proveedor)</span>
                    <div style={{ color: '#c9d1d9', fontWeight: '500', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>
                      {mostrarDato(operacionViendo.observacionesUnidad)}
                    </div>
                  </div>

                </div>
              )}

              {pestañaDetalleActiva === 'cobrar' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Facturado En:</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarMoneda(operacionViendo.facturadoEnCobrar)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Moneda Convenio (Cliente)</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarMoneda(operacionViendo.monedaConvenioCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio Seleccionado (Base)</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.montoConvenioCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cargos Adicionales</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.cargosAdicionales)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Subtotal (Convenio + Cargos)</span>
                      <span style={{ color: '#c9d1d9', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.subtotalCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Tipo de Cambio del Día</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.tipoCambioAprobado)}</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingBottom: '24px', borderBottom: '1px solid #30363d' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Dólares (Cliente)</span>
                      <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.dolaresCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Pesos (Cliente)</span>
                      <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.pesosCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Conversión Final (Ingreso)</span>
                      <span style={{ color: '#D84315', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.conversionCliente)}</span>
                    </div>
                  </div>

                  <div style={{ marginTop: '24px', padding: '24px', backgroundColor: '#0d1117', border: '1px solid #10b981', borderRadius: '12px', textAlign: 'center' }}>
                    <span style={{ display: 'block', fontSize: '0.9rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Utilidad Estimada de la Operación (Ingreso - Gasto)</span>
                    <span style={{ fontSize: '2.5rem', color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.utilidadEstimada)}</span>
                  </div>

                  <div style={{ marginTop: '24px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '8px' }}>Observaciones (Facturación / Cobro)</span>
                    <div style={{ color: '#c9d1d9', fontWeight: '500', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>
                      {mostrarDato(operacionViendo.observacionesCobrar)}
                    </div>
                  </div>

                </div>
              )}

            </div>

            <div className="form-actions detail-actions" style={{ padding: '16px 32px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', flexShrink: 0 }}>
              <button onClick={() => setOperacionViendo(null)} className="btn btn-outline" style={{ padding: '10px 32px', borderRadius: '6px' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO: Editor integrado (sólo se usa si NO se pasó la prop onEditar) */}
      {operacionEditando && (
        <div className="modal-overlay" style={{ zIndex: 1600 }}>
          <div className="form-card" style={{ maxWidth: '1000px', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #58a6ff', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>

            <div className="form-header" style={{ padding: '20px 28px 12px 28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem', fontWeight: 600 }}>Editar Operación</h2>
                  <div style={{ marginTop: '6px', color: '#58a6ff', fontWeight: 'bold', fontSize: '1.05rem' }}>
                    {operacionEditando.ref || operacionEditando.id?.substring(0,6)}
                  </div>
                </div>
                <button onClick={() => { setOperacionEditando(null); setFormEdicion({}); }} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '6px' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#fb923c' }}>
                Editor rápido: los campos relacionados a catálogos (Cliente, Convenio, Origen/Destino, Remolque, Proveedor, Monedas) y las conversiones por tipo de cambio se gestionan en "Operaciones Activas".
              </div>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 28px', overflowX: 'auto', flexShrink: 0 }}>
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

            <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1 }}>
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
                  <div style={{ gridColumn: 'span 3' }}>
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

            <div style={{ padding: '16px 28px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', flexShrink: 0 }}>
              <button onClick={() => { setOperacionEditando(null); setFormEdicion({}); }} className="btn btn-outline" style={{ padding: '10px 24px', borderRadius: '6px' }} disabled={guardandoEdicion}>Cancelar</button>
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
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="form-card" style={{ maxWidth: '650px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '20px 24px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#f0f6fc' }}>Bitácora de Movimientos</h2>
              <button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button>
            </div>
            <div style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
              {cargandoHorarios ? (
                <div style={{ textAlign: 'center', color: '#8b949e', padding: '20px' }}>Descargando historial...</div>
              ) : (
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ backgroundColor: '#161b22', color: '#8b949e' }}>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #30363d' }}>Fecha y Hora</th>
                      <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #30363d' }}>Estatus Marcado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historialList.length === 0 ? (
                      <tr><td colSpan={2} style={{ textAlign: 'center', padding: '20px', color: '#8b949e' }}>Sin movimientos registrados.</td></tr>
                    ) : (
                      historialList.map((h: any) => (
                        <tr key={h.id} style={{ borderBottom: '1px solid #21262d' }}>
                          <td style={{ padding: '16px 12px', color: '#c9d1d9' }}>{new Date(h.fechaHora).toLocaleString('es-MX')}</td>
                          <td style={{ padding: '16px 12px', color: '#10b981', fontWeight: 'bold' }}>{mostrarDatoMapeado(h.status, 'statusServicio', 'nombre')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', textAlign: 'right', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
              <button onClick={() => setModalHorarios('cerrado')} className="btn btn-outline" style={{ padding: '10px 24px', borderRadius: '6px' }}>Cerrar Historial</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO: Registro retroactivo de movimiento (fecha/hora personalizada) */}
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

      {/* ✅ NUEVO: Visor de documentos de la operación */}
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

      {/* ✅ NUEVO: Subida de documentos ligada a la operación */}
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
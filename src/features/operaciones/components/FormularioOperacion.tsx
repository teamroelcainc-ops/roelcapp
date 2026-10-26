import { useState, useEffect, useEffectEvent, useMemo, useCallback, useRef, cloneElement, Fragment, memo } from 'react';
import { createPortal } from 'react-dom'; // ✅ V00264: el formulario vive en document.body
import { doc, getDoc, updateDoc, collection, getDocs, addDoc, query, where, limit, orderBy, arrayUnion } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';
import { prefijoTipoOperacion } from '../../../utils/generarReferencia';
import { db, auth } from '../../../config/firebase';
// ✅ V00439 (Fase 3.6): catálogos, permisos y constantes desde la capa compartida.
import { idReal, obtenerCatalogo, useCatalogos } from '../../../shared/data/catalogos';
import type { DocCatalogo } from '../../../shared/data/catalogos';
import { usePermisoRol } from '../../../shared/data/sesion';
import { ContextoModuloEscuchando, ContextoModuloVivoActivo, useModuloEscuchando, useModuloVivoActivo } from '../../../utils/moduloVivoContexto';
import { ID_MXN, ID_USD, STATUS_CANCELADO, TIPO_EMPRESA } from '../../../shared/dominio/constantes';
import { esUSD, monedaCanonica } from '../../../shared/dominio/moneda';
import { DocumentosLista } from '../../documentos/DocumentosLista'; // ✅ V00341: consultar los documentos guardados
import { EditorTarifaOrigenDestino } from './EditorTarifaOrigenDestino'; // ✅ V00224
import { puedeClave } from '../../../utils/permisos'; // ✅ V00224
import { claveConsecutivo } from '../../../utils/claveConsecutivo'; // ✅ V00428
import { CambioSueldoOperador, HistorialCambiosSueldo } from './CambioSueldoOperador'; // ✅ V00433
import { useUsuarioStore } from '../../../stores/useUsuarioStore';
import { guardarOperacionSegura, nuevoIdEnvioOperacion } from '../services/operacionesService';
import { conReintentos } from '../services/reintentosCallable'; // ✅ V00463
// ✅ AUTORIZACIONES: interceptar guardado cuando la acción/campo lo requiere.
import { cargarConfigModulo, evaluarAutorizacion, camposModificadosDe, obtenerUsuarioAut, MODULOS_AUTORIZABLES } from '../../autorizaciones/autorizaciones';
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos';
import { ModalAccesoCampo } from '../../autorizaciones/ModalAccesoCampo';
// ✅ NUEVO: historial de actividad (colección historial_actividad)
import { registrarLog } from '../../../utils/logger';
import { puenteSegunFlujo, calcularStatusDinamico, idDocFlujo, leerFlujoFresco } from '../config/statusRules';
import { obtenerFlags } from '../../../shared/data/flags';
import { usosEnCache } from '../../../shared/data/consultas';
import { obtenerFilaTipoCambioDeFecha } from '../services/tipoCambioPorFecha'; // ✅ V00438 (Fase 2.9)
import { CATALOGOS_FORMULARIO_BASE, CATALOGOS_FORMULARIO_EXTRA } from '../services/catalogosFormulario'; // ✅ V00447
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';

import { FormularioEmpresa } from '../../empresas/components/FormularioEmpresa';
import { FormularioRemolque } from '../../remolques/components/FormularioRemolque';
import { FormularioUnidad } from '../../unidades/components/FormularioUnidad';
import { EmployeeForm } from '../../empleados/components/EmployeeForm';
import { CostosAdicionalesDashboard } from '../../costosAdicionales/CostosAdicionalesDashboard';
import './FormularioOperacion.css';
import { notificarOperacionGuardada } from '../../../utils/operacionesBus';
import { esOperacionPrueba, PREFIJO_PRUEBA } from '../../../utils/operacionPrueba';
import { EditorDetalleConvenioModal } from './EditorDetalleConvenioModal';
import { AlertaDocumentos } from '../../documentos/AlertaDocumentos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { FormularioConfigurable } from '../../formularios/FormularioConfigurable';
import { validarFormularioConfigurable } from '../../formularios/configFormularios';
import { ajusteSueldoPorStatus } from '../../../utils/sueldoFalso';
import { cargarCtxCobroPuente, nombresAduana, normPuente } from '../../../utils/puenteColombia';
import { avisarCrucePuente } from '../../puentes/services/crucePuente'; // ✅ V00470
import { aduanaDeOperacionCtx, casetaDeElegido, casetaPrevista, casetasDeFlujo, cobroAlCambiarStatus, disparoCobroPuente, esAduanaColombia, puenteYaCobrado } from '../../../shared/dominio/cobroPuente'; // ✅ V00465 · V00469 · V00470 · V00473
import { aFechaISO } from '../../../shared/dominio/fechas';
import { mismaAduana, reglaPuenteDelPaso } from '../../../shared/dominio/flujos';
import type { CtxCobroPuente, EventoStatusPuente } from '../../../shared/dominio/cobroPuente';
import TagPuenteUnidad from '../../puentes/components/TagPuenteUnidad';
import { grupoTagDeNombres, grupoTagDeTrafico } from '../../puentes/services/tagPuente';
import { abrirEdicion, useEdicionAbierta } from '../../../shared/utils/edicionesAbiertas'; // ✅ V00438
import { CAMPOS_CANONICOS, normalizarNumerosOperacion } from '../../../shared/dominio/operacionCanonica';
import { quitarCamposAjenos } from '../services/camposAjenos'; // ✅ V00451
// ✅ V00444 (Fase 8.3): piezas sin estado del formulario, en archivos propios.
import { describirCambiosLog, describirCamposCapturadosLog, listaCambiosAuditoria } from '../services/auditoriaLog';
import { colorTipoOperacion, formatearDireccionPorPais, normalizarTxtDir, paisDeDireccion } from './formulario/direcciones';
import { buscarTCAplicable, buscarTCDeFecha, normalizarFechaISO, tcParaOperacionGuardada } from './formulario/tipoCambioFila';
import { facturadaCliente, facturadaProveedor } from '../../../shared/dominio/operacionCanonica'; // ✅ V00462
import AvisoTipoCambio from './formulario/AvisoTipoCambio'; // ✅ V00461
import { adjuntosDeCampo, archivosDeCampo, referenciaDeOperacion, subirDocumentosOperacion, TIPOS_DOCUMENTO_OPERACION } from './formulario/documentosOperacion';
import type { Adjunto } from '../../../shared/archivos/adjuntos'; // ✅ V00451: varios archivos por documento
import { BotonAgregar, CampoArchivo } from './formulario/CampoArchivo';
import { claveRefCliente, describirOp, etiquetaEstado } from '../services/refClienteDuplicado'; // ✅ V00450
import type { OpRefResumen } from '../services/refClienteDuplicado';
import { buscarRefCliente } from '../services/refClienteDuplicadoServidor'; // ✅ V00450
import { avisar } from '../../../shared/data/avisos'; // ✅ V00450
import {
  IconAlert, IconArrowRight, IconBriefcase, IconCalendar, IconCheck, IconClipboard, IconDollar, IconEdit, IconFileText,
  IconMapPin, IconMinimize, IconPackage, IconReceipt, IconRoute, IconSave, IconTrendingUp, IconTruck, IconUsers, IconX,
} from './formulario/iconos';
export { TIPOS_DOCUMENTO_OPERACION } from './formulario/documentosOperacion';

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: any;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  catalogosCacheados: any;
  onSave?: (opNueva: any) => void; 
}

type TabType = 'general' | 'pedimento' | 'manifiesto' | 'unidad' | 'cobrar';

const TODAS_LAS_PESTANAS: TabType[] = ['general', 'pedimento', 'manifiesto', 'unidad', 'cobrar'];

const CAMPO_TAB_MAP: Record<string, TabType> = {
  tipoOperacionId: 'general', fechaServicio: 'general', fechaCita: 'general',
  clientePaga: 'general', convenio: 'general', numeroRemolque: 'general',
  refCliente: 'general', origen: 'general', destino: 'general', kilometrajeEstimado: 'general', observacionesEjecutivo: 'general',

  clienteMercancia: 'pedimento', descripcionMercancia: 'pedimento', cantidad: 'pedimento',
  embalaje: 'pedimento', pesoKg: 'pedimento', numDoda: 'pedimento', fechaEmisionDoda: 'pedimento',
  pdfCartaPorte: 'pedimento', pdfDoda: 'pedimento',

  numeroEntrys: 'manifiesto', cantEntrys: 'manifiesto', pdfsEntrys: 'manifiesto',
  numManifiesto: 'manifiesto', provServicios: 'manifiesto', montoManifiesto: 'manifiesto', pdfManifiesto: 'manifiesto',

  proveedorUnidad: 'unidad', facturadoEnUnidad: 'unidad', convenioProveedor: 'unidad',
  totalAPagarProv: 'unidad', cargosAdicionalesProv: 'unidad', unidad: 'unidad', operador: 'unidad',
  sueldoOperador: 'unidad', sueldoExtra: 'unidad', combustible: 'unidad', combustibleExtra: 'unidad',
  unidadProveedor: 'unidad', operadorProveedor: 'unidad', observacionesUnidad: 'unidad',

  facturadoEnCobrar: 'cobrar', montoConvenioCliente: 'cobrar', cargosAdicionales: 'cobrar',
  tipoCambioAprobado: 'cobrar', observacionesCobrar: 'cobrar',
};

// ✅ V00439 (Fase 3.6): ID_USD / ID_MXN vienen de shared/dominio/constantes.
const ID_GASTO_SUELDO = '25b772d3';

const TIPO_OP_PROVEEDOR_FIJO = '8ec24dfe';
const PROVEEDOR_FIJO_ID = '349123';

// ✅ (Origen/Destino — regla AppSheet restaurada)
//   Tipos de operación cuyo Origen/Destino se filtra por país según el tráfico:
//     8ec24dfe y 24da3608  → Exportación: Origen MX / Destino USA;
//                            Importación: Origen USA / Destino MX;
//                            Movimiento: sin filtro.
//   Tipo 3e5b0035 → sin filtro (todas las direcciones).
//   Tipos con TrompoExpo/TrompoImpo = true → misma regla por país en su tráfico.
const TIPOS_OP_FILTRO_PAIS = ['8ec24dfe', '24da3608'];
const TIPO_OP_SIN_FILTRO_PAIS = '3e5b0035';
const esTrueAppSheet = (v: any): boolean => v === true || String(v ?? '').trim().toLowerCase() === 'true';

// ✅ Envuelve un input de dinero y le antepone el símbolo "$" dentro del campo.
const ConSimboloMoneda = ({ children, style, className }: { children: any; style?: any; className?: string }) => (
  <div className={className} style={{ position: 'relative', ...(style || {}) }}>
    <span className="fo-x1">$</span>
    {cloneElement(children, { style: { ...((children.props as any)?.style || {}), paddingLeft: '24px' } })}
  </div>
);

const COSTO_MANIFIESTO_DEFAULT = 8.52;
// ✅ (Proveedor de Servicios / Manifiesto) El buscador solo muestra empresas con
//   tiposEmpresa que contenga 11894dfd Y tiposServicio que contenga alguno de
//   los dos servicios permitidos. Solo el servicio 42afffd3 coloca el costo
//   por defecto del manifiesto; cualquier otro coloca 0.
const TIPOS_SERVICIO_PROV_MANIFIESTO = ['42afffd3', '7e70a3f7'];
const TIPO_SERVICIO_CON_COSTO_MANIFIESTO = '42afffd3';
// ✅ V00439 (Fase 3.6): el tipo de empresa Proveedor (Servicios) viene de shared/dominio/constantes.
// ✅ V00465: el puente automático lo elige casetaPrevista (convenio y su tarifa; Colombia y
//   tráfico de respaldo), por nombre del catálogo: ya no usa los ids fijos de Caseta AVI y
//   Caseta Puente III (PUENTE_IMPORTACION_ID / PUENTE_EXPORTACION_ID, que se quitaron de constantes).

// ✅ V00252: TIPO_EMP_CLIENTE_PAGA ('Cliente (Paga)') y TIPO_EMP_PROV_TRANSPORTE
//   ('Proveedor (Transporte)') se retiraron: el buscador de la operación ya no
//   exige el tipo de empresa — basta con estar en su tarifario o tener convenio.
const TIPO_EMP_CLIENTE_MERCANCIA = 'Cliente (Mercancía)';
const TIPO_EMP_ORIGEN_DESTINO    = 'Origen / Destino';
const TIPO_EMP_PROV_SERVICIOS    = 'Proveedor (Servicios)';

const normClave = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

const tipoTarifarioCache = new Map<string, any>();

// ✅ V00258: catálogo Cargada/Vacía para resolver el estado_carga de
//   la tarifa (que puede venir como ID) al NOMBRE exacto del catálogo antes de
//   guardarlo en la operación (caso reportado: convenio Hazmat con carga
//   "Cargado" — la operación debe guardar el C/V que dicta el convenio).
// ✅ V00439 (Fase 3.6): sale del listener compartido de catálogos (antes un
//   getDocs por sesión guardado en una promesa del módulo).
const obtenerMapaCargaVacia = async (): Promise<Map<string, string>> => {
  const mapa = new Map<string, string>();
  (await obtenerCatalogo('catalogo_carga_vacia')).forEach((x) => {
    const nombre = String(x.nombre || x.estado_carga || '').trim();
    if (!nombre) return;
    mapa.set(idReal(x), nombre);
    mapa.set(nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(), nombre);
  });
  return mapa;
};
const resolverNombreCarga = async (valor: unknown): Promise<string> => {
  const v = String(valor ?? '').trim();
  if (!v) return 'N/A';
  // ✅ V00448: sin catálogo (sin red ni caché) se queda el valor tal cual, como antes.
  const mapa = await obtenerMapaCargaVacia().catch((e: unknown) => { console.warn('[carga] sin catálogo:', e); return new Map<string, string>(); });
  return mapa.get(v) || mapa.get(v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()) || v;
};
const traficoCache = new Map<string, string>();

// ✅ V00439 (Fase 3.6): fila de catálogo tal como la lee este archivo (campos legacy uno
//   por uno, sin tipo canónico todavía). Antes cada lista era un useState<any[]>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- datos de catálogo dinámicos (mismo criterio del archivo).
type FilaCatalogo = any;

type CatalogoCreable =
  | { tipo: 'empresa'; tipoEmpresaPreseleccionado: string; coleccion: 'empresas' }
  | { tipo: 'remolque'; coleccion: 'remolques' }
  | { tipo: 'unidad'; coleccion: 'unidades' }
  | { tipo: 'empleado'; coleccion: 'empleados' };

const FormularioOperacionBase = ({ estado, initialData, onClose, onMinimize, onRestore, catalogosCacheados, onSave }: FormProps) => {
  // ✅ V00438 (Fase 2.10): mientras el formulario está abierto, una versión nueva
  //   de la app no recarga la página (se recarga al cerrarlo).
  useEdicionAbierta();
  const [pestañaActiva, setPestañaActiva] = useState<TabType>('general');
  const [cargando, setCargando] = useState(false);
  const [mostrarCostosAdic, setMostrarCostosAdic] = useState<false | 'cliente' | 'proveedor'>(false);
  // ✅ V00126: editar el detalle del convenio elegido (moneda/tarifa) sin salir de Operaciones
  const [detalleConvenioEdit, setDetalleConvenioEdit] = useState<{ tipo: 'cliente' | 'proveedor'; detalleId: string } | null>(null);
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false);

  const [mostrarConveniosCliente, setMostrarConveniosCliente] = useState(false);
  const [detalleConvEditando, setDetalleConvEditando] = useState<any | null>(null);
  const [guardandoDetalleConv, setGuardandoDetalleConv] = useState(false);

  const [mostrarConveniosProveedor, setMostrarConveniosProveedor] = useState(false);
  const [detalleConvProvEditando, setDetalleConvProvEditando] = useState<any | null>(null);
  const [guardandoDetalleConvProv, setGuardandoDetalleConvProv] = useState(false);

  // ✅ V00439 (Fase 3.6): permiso "EDITAR REF" desde la sesión (antes releía usuarios/{uid}
  //   y TODA la colección roles; además .includes('ADMIN') contaba 'ADMINISTRATIVO' como admin).
  const puedeEditarRef = usePermisoRol('EDITAR REF', 'contiene');

  // ✅ AUTORIZACIONES: config del módulo 'operaciones' y usuario actual.
  const [configAut, setConfigAut] = useState<any>(undefined); // undefined = aún cargando
  const [usuarioAut, setUsuarioAut] = useState<any>(null);
  useEffect(() => {
    cargarConfigModulo('operaciones').then(setConfigAut).catch(() => setConfigAut(null));
    obtenerUsuarioAut().then(setUsuarioAut).catch(() => {});
  }, []);

  // ✅ Bloqueo proactivo en la UI: campos que autorizaciones marca como
  //    controlados para los roles del usuario actual. Admin nunca se bloquea.
  //    (El guardado sigue validando TODO como respaldo.)
  // ✅ V00141: hook central (config + accesos temporales aprobados + modal de solicitud)
  const autHook = useAutorizacionesCampos('operaciones');
  const campoBloqueadoAut = (k: string) => autHook.campoBloqueado(k);
  // ✅ V00382: el hook conoce el registro abierto → "Agregar libre" (soloEditar)
  //   funciona también en Operaciones: al CREAR o con el campo vacío queda libre.
  const { setValoresActuales: setValoresAut } = autHook;
  useEffect(() => { setValoresAut((initialData || {}) as Record<string, unknown>); }, [initialData, setValoresAut]);
  // clic sobre un campo bloqueado → modal "No tienes acceso…" con Solicitar autorización
  const clicCampoBloqueado = (k: string) => autHook.abrirSolicitudAcceso(k, { docId: String(initialData?.id || ''), referencia: String((formData as any).ref || initialData?.ref || '') });
  const [referencia, setReferencia] = useState('');

  const [statusPreview, setStatusPreview] = useState<string>('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const [camposSiguienteStatus, setCamposSiguienteStatus] = useState<{ campo: string; etiqueta: string; cumplido: boolean }[]>([]);
  const [nombreSiguienteAuto, setNombreSiguienteAuto] = useState<string>('');

  const [modalCatalogo, setModalCatalogo] = useState<{
    catalogo: CatalogoCreable;
    idsPrevios: Set<string>;
    onCreado: (nuevoId: string, registro: any) => void;
  } | null>(null);

  // ✅ V00439 (Fase 3.6): CATÁLOGOS desde la capa compartida (src/shared/data/catalogos):
  //   un listener por colección para toda la app, siempre en vivo. Antes, al abrir:
  //   9 getDocs + 6 onSnapshot propios, copias en localStorage (cat_v2__) y
  //   catalogosCacheados como base. Ya no hay copias locales que parchar después de
  //   escribir (crear empresa, editar un detalle de convenio): el listener trae el cambio.
  //   `base` = lo que el formulario necesita para pintarse (antes lo entregaba el padre).
  // ✅ V00447: las listas viven en services/catalogosFormulario.ts (Operaciones Activas las
  //   abre en segundo plano al arrancar para que el formulario no espere).
  const { datos: base, listo: catalogosBaseListos } = useCatalogos(CATALOGOS_FORMULARIO_BASE);
  const { datos: cat } = useCatalogos(CATALOGOS_FORMULARIO_EXTRA);
  const empresasLocal: FilaCatalogo[] = base.empresas;
  const remolquesLocal: FilaCatalogo[] = base.remolques;
  const unidadesLocal: FilaCatalogo[] = base.unidades;
  const empleadosLocalState: FilaCatalogo[] = base.empleados;
  const tarifasLocal: FilaCatalogo[] = cat.tarifas;
  const embalajesLocal: FilaCatalogo[] = cat.embalajes;
  const convClientesLocal: FilaCatalogo[] = cat.catalogoConvClientes;
  const convDetallesLocal: FilaCatalogo[] = cat.catalogoConvDetalles;
  const convProvLocal: FilaCatalogo[] = cat.conveniosProv;
  const convProvDetallesLocal: FilaCatalogo[] = cat.catalogoConvProvDetalles;
  const gastosIncluidosLocal: FilaCatalogo[] = cat.tarifasGastosIncluidos;
  const rendimientoLocal: FilaCatalogo[] = cat.tarifasRendimiento;
  const tiposGastosLocal: FilaCatalogo[] = cat.tiposGastos;
  // ✅ V00202: tarifarios de clientes — sus clientes también aparecen en la operación.
  const tarifariosLocal: FilaCatalogo[] = cat.catalogoTarifarios;
  // ✅ V00211: tarifarios de PROVEEDORES — sus proveedores también aparecen.
  const tarifariosProvLocal: FilaCatalogo[] = cat.catalogoTarifariosProv;
  // ✅ V00313: tarifa ALTERNA elegida en el modal (convenios con varios montos).
  //   El efecto que trae el monto vigente la respeta mientras siga elegido ese convenio.
  const montoAltCliRef = useRef<{ id: string; monto: number } | null>(null);
  const montoAltProvRef = useRef<{ id: string; monto: number } | null>(null);
  const [convMontosAbierto, setConvMontosAbierto] = useState('');

  // ✅ V00439 (Fase 3.6): solo el T.C. sigue llegando de catalogosCacheados (ver
  //   catalogoTCResuelto); lo demás sale de la capa compartida.
  const tiposOperacion: FilaCatalogo[] = base.tiposOperacion;
  const statusServicio: FilaCatalogo[] = base.statusServicio;
  const catalogoMoneda: FilaCatalogo[] = base.catalogoMoneda;
  const unidadesProveedor: FilaCatalogo[] = base.unidadesProveedor;
  const proveedoresUnidad: FilaCatalogo[] = base.proveedoresUnidad;

  const empresas = empresasLocal;
  const remolques = remolquesLocal;
  const unidades = unidadesLocal;
  const empleados = empleadosLocalState;
  const tarifas = tarifasLocal;
  // ✅ V00388: ADUANA de cada convenio (tarifa de referencia → catálogo de aduanas)
  const [mapaAduanas, setMapaAduanas] = useState<Map<string, string>>(new Map());
  useEffect(() => { nombresAduana().then(setMapaAduanas).catch(() => {}); }, []);
  const aduanaDeConv = (conv: { tarifaBaseId?: unknown } | null | undefined): string => {
    const tb = String(conv?.tarifaBaseId ?? '').trim();
    if (!tb) return '';
    const t = (tarifas || []).find((x: { id?: unknown }) => String(x.id) === tb) as { aduana?: unknown } | undefined;
    const v = String(t?.aduana ?? '').trim();
    return v ? (mapaAduanas.get(v) || v) : '';
  };
  const conveniosProv = convProvLocal;
  const catalogoConvProvDetalles = convProvDetallesLocal;
  const catalogoConvClientes = convClientesLocal;
  const catalogoConvDetalles = convDetallesLocal;

  const catalogoTrafico: FilaCatalogo[] = cat.catalogoTrafico; // ✅ V00439 (Fase 3.6)

  // ✅ FIX TIPO DE CAMBIO: resuelve el catálogo de TC venga como venga en
  //   catalogosCacheados (a veces la clave no es exactamente `catalogoTC`).
  // ✅ V00439 (Fase 3.6): tipo_cambio crece un renglón por día y aquí solo hace falta el
  //   de una fecha: sin él en catalogosCacheados se consulta esa fecha (obtenerFilaTipoCambioDeFecha).
  const catalogoTCResuelto = useMemo(() => {
    const catalogoTC = catalogosCacheados?.catalogoTC ?? [];
    if (Array.isArray(catalogoTC) && catalogoTC.length) return catalogoTC;
    return (
      catalogosCacheados?.tipoCambio
      || catalogosCacheados?.tipo_cambio
      || catalogosCacheados?.catalogo_tipo_cambio
      || catalogosCacheados?.catalogoTipoCambio
      || catalogosCacheados?.tiposCambio
      || catalogosCacheados?.tipos_cambio
      || catalogosCacheados?.tc
      || catalogosCacheados?.catalogoTC
      || catalogoTC
      || []
    );
  }, [catalogosCacheados]);

  const listaEmpleadosLocal: any[] = empleados;
  const listaUniProvLocal: any[] = unidadesProveedor;
  const listaOpeProvLocal: any[] = proveedoresUnidad;
  const listaMonedasLocal: any[] = catalogoMoneda;

  // ✅ V00129: ACTUALIZAR MONEDA — relee la empresa en Firestore y ajusta
  //   "Facturado En" de este registro a la moneda actual de la tabla Empresas
  //   (útil cuando la moneda del cliente/proveedor cambió después de crear la operación).
  const [actualizandoMoneda, setActualizandoMoneda] = useState<'' | 'cliente' | 'proveedor'>('');
  const actualizarMonedaDesdeEmpresa = async (lado: 'cliente' | 'proveedor') => {
    const empresaId = String(lado === 'cliente' ? formData.clientePaga : formData.proveedorUnidad || '');
    if (!empresaId) { alert(lado === 'cliente' ? 'Primero selecciona el Cliente (Paga).' : 'Primero selecciona el Proveedor de Transporte.'); return; }
    setActualizandoMoneda(lado);
    try {
      const snapE = await getDoc(doc(db, 'empresas', empresaId));
      const emp: any = snapE.exists() ? { id: snapE.id, ...snapE.data() } : (empresas || []).find((e: any) => String(e.id) === empresaId);
      const monId = emp ? resolverMonedaIdDeEmpresa(emp) : '';
      if (!monId) { alert('Esta empresa no tiene moneda registrada en la tabla Empresas. Asígnala en el módulo Empresas y vuelve a intentar.'); return; }
      const nombre = listaMonedasLocal.find((m: any) => String(m.id) === monId)?.moneda || monId;
      if (lado === 'cliente') setFormData(prev => ({ ...prev, facturadoEnCobrar: monId }));
      else setFormData(prev => ({ ...prev, facturadoEnUnidad: monId }));
      alert(`Facturado En actualizado a "${nombre}" (moneda actual de la empresa).\n\nRecuerda presionar Guardar para que quede en la operación.`);
    } catch (e: any) {
      alert(`No se pudo leer la empresa: ${e?.message || String(e)}`);
    } finally { setActualizandoMoneda(''); }
  };

  const resolverMonedaIdDeEmpresa = (emp: any): string => {
    if (!emp) return '';
    const raw = String(emp.moneda ?? emp.monedaId ?? emp.monedaRef ?? '').trim();
    if (!raw) return '';
    if (listaMonedasLocal.some((m: any) => String(m.id) === raw)) return raw;
    const up = raw.toUpperCase();
    const porTexto = listaMonedasLocal.find((m: any) => {
      const nom = String(m.moneda || '').toUpperCase();
      return nom === up || (!!nom && (nom.includes(up) || up.includes(nom)));
    });
    if (porTexto) return String(porTexto.id);
    if (up.includes('USD') || up.includes('DOLAR') || up.includes('DÓLAR') || up === 'US') return ID_USD;
    if (up.includes('MXN') || up.includes('PESO') || up === 'MX') return ID_MXN;
    return '';
  };

  // ✅ V00130: opciones de moneda para "Facturado En" — SALEN DEL CATÁLOGO de
  //   Monedas (más los ids canónicos por compatibilidad). Antes el <select> solo
  //   tenía los dos ids fijos; si la empresa guardaba OTRO id del catálogo, el
  //   navegador no encontraba la opción y seguía mostrando la selección anterior
  //   ("Actualizar moneda" avisaba Dólares pero se veía Pesos).
  const opcionesFacturadoEn = (): Array<{ id: string; nombre: string }> => {
    const out: Array<{ id: string; nombre: string }> = [];
    const vistos = new Set<string>();
    (listaMonedasLocal || []).forEach((m: any) => { const id = String(m.id); if (!vistos.has(id)) { vistos.add(id); out.push({ id, nombre: String(m.moneda || id) }); } });
    if (!vistos.has(ID_USD)) out.push({ id: ID_USD, nombre: 'Dólares' });
    if (!vistos.has(ID_MXN)) out.push({ id: ID_MXN, nombre: 'Pesos' });
    return out;
  };

  const nombreMoneda = (monedaId: any) =>
    listaMonedasLocal.find((m:any) => String(m.id) === String(monedaId))?.moneda || '';
  const fmtMoney = (n: number) => `$${(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // ✅ V00202: etiqueta = Consecutivo - Convenio - Moneda de cotización - Monto
  const consecutivoConvenio = (c: any) => String(c.consecutivo || (String(c.id || '').startsWith('CONV-') ? c.id : '') || '').trim();
  // ✅ V00248: la descripción guardada puede venir ya encabezada por su
  //   consecutivo (CONV-###) o, en registros viejos, por el del tarifario
  //   (TARI-/TARP-). Se limpian esos prefijos para no duplicarlos.
  const sinPrefijoConsecutivo = (texto: any, cons: string) => {
    let t = String(texto || '').trim();
    if (cons && t.toUpperCase().startsWith(cons.toUpperCase())) t = t.slice(cons.length).replace(/^\s*-\s*/, '');
    t = t.replace(/^(CONV|TARI|TARP)-\d+\s*-\s*/i, '');
    return t.trim();
  };
  const etiquetaConvenioCliente = (c: any) => {
    const cons = consecutivoConvenio(c);
    const desc = sinPrefijoConsecutivo(c.descripcion, cons);
    return `${desc} - ${fmtMoney(c.tarifaMonto)}`; // ✅ V00314: solo el NOMBRE (sin CONV-###)
  };
  // ✅ V00211: etiqueta = Consecutivo - Convenio - Moneda de cotización - Monto
  const etiquetaConvenioProveedor = (c: any) => {
    const cons = consecutivoConvenio(c);
    const desc = sinPrefijoConsecutivo(c.tipoConvenioNombre, cons);
    return `${desc} - ${fmtMoney(c.tarifaMonto)}`; // ✅ V00314: solo el NOMBRE (sin CONV-###)
  };

  const [tipoCambioDia, setTipoCambioDia] = useState<number | null>(null);
  // ✅ V00461: ¿el usuario cambió la Fecha de Servicio? Solo entonces una operación GUARDADA toma el T.C. de otra fecha.
  const fechaServicioTocada = useRef(false);
  // ✅ V00462: ¿el usuario escribió el T.C. a mano en esta sesión? Entonces no se corrige solo.
  const tcEditadoAMano = useRef(false);
  // ✅ V00465: el usuario eligió el puente (o su monto) a mano → la asignación automática ya no lo cambia.
  const puenteElegidoAMano = useRef(false);
  const puenteAutoId = useRef(''); // el último que puso la asignación automática
  // ✅ V00463: id del envío de esta captura nueva; el mismo en cada "Guardar" hasta que se guarda
  //   (crearOperacion no duplica si un intento anterior sí llegó). Se limpia al guardar o cancelar.
  const clienteOpIdRef = useRef<string | null>(null);
  const [fechaTCDia, setFechaTCDia] = useState(''); // ✅ V00461: día al que pertenece tipoCambioDia (sábado/domingo → viernes)
  const [buscandoTC, setBuscandoTC] = useState(false);

  const [searchOrigen, setSearchOrigen] = useState('');
  const [showDropdownOrigen, setShowDropdownOrigen] = useState(false);
  const [searchDestino, setSearchDestino] = useState('');
  const [showDropdownDestino, setShowDropdownDestino] = useState(false);
  const [searchClientePaga, setSearchClientePaga] = useState('');
  const [showDropdownClientePaga, setShowDropdownClientePaga] = useState(false);
  const [searchRemolque, setSearchRemolque] = useState('');
  const [showDropdownRemolque, setShowDropdownRemolque] = useState(false);
  const [searchClienteMercancia, setSearchClienteMercancia] = useState('');
  const [showDropdownClienteMercancia, setShowDropdownClienteMercancia] = useState(false);
  const [searchProvServicios, setSearchProvServicios] = useState('');
  const [showDropdownProvServicios, setShowDropdownProvServicios] = useState(false);
  const [searchProvTransporte, setSearchProvTransporte] = useState('');
  const [showDropdownProvTransporte, setShowDropdownProvTransporte] = useState(false);
  const [searchUnidad, setSearchUnidad] = useState('');

  const [showDropdownUnidad, setShowDropdownUnidad] = useState(false);
  const [searchOperador, setSearchOperador] = useState('');
  const [showDropdownOperador, setShowDropdownOperador] = useState(false);
  const [searchUnidadProveedor, setSearchUnidadProveedor] = useState('');
  const [showDropdownUnidadProveedor, setShowDropdownUnidadProveedor] = useState(false);
  const [searchOperadorProveedor, setSearchOperadorProveedor] = useState('');
  const [showDropdownOperadorProveedor, setShowDropdownOperadorProveedor] = useState(false);
  const [searchConvenio, setSearchConvenio] = useState('');
  // ✅ V00271: retirado — el convenio se elige en el modal, ya no hay dropdown de búsqueda.
  const [searchConvenioProveedor, setSearchConvenioProveedor] = useState('');
  // ✅ V00271: retirado — el convenio se elige en el modal, ya no hay dropdown de búsqueda.


  // ✅ V00380: operación de PRUEBA (no factura, no paga, no entra a estadísticas/reportes)
  const [esPrueba, setEsPrueba] = useState<boolean>(() => esOperacionPrueba(initialData));

  const [formData, setFormData] = useState({
    tipoServicio: '', trafico: '', carga: '',
    tipoOperacionId: '',
    fechaServicio: hoyLocalISO(),
    fechaCita: '',
    clientePaga: '', convenio: '', convenioNombre: '', numeroRemolque: '', refCliente: '',
    origen: '', destino: '', kilometrajeEstimado: '', observacionesEjecutivo: '',
    clienteMercancia: '', descripcionMercancia: '', cantidad: '', embalaje: '',
    pesoKg: '', numDoda: '', fechaEmisionDoda: '',
    pdfCartaPorte: [] as Adjunto[], pdfDoda: [] as Adjunto[], // ✅ V00451: varios archivos (se suben al guardar)
    numeroEntrys: '', cantEntrys: 0, numManifiesto: '', provServicios: '', montoManifiesto: 0,
    pdfManifiesto: [] as Adjunto[], pdfsEntrys: [] as (Adjunto[] | null)[], // ✅ V00451: por Entry, su lista (null = sin archivos)
    proveedorUnidad: '', facturadoEnUnidad: '', convenioProveedor: '', monedaConvenioProv: '',
    totalAPagarProv: 0, cargosAdicionalesProv: 0, subtotalProv: 0, 
    dolaresProv: 0, pesosProv: 0, conversionProv: 0,
    unidad: '', operador: '', sueldoOperador: 0, sueldoExtra: 0, sueldoTotal: 0, 
    combustible: 0, combustibleExtra: 0, combustibleTotal: 0,
    sueldoExtraNotas: '', combustibleExtraNotas: '',
    puenteId: '', puenteNombre: '', puenteMonto: 0,
    unidadProveedor: '', operadorProveedor: '', observacionesUnidad: '', observacionesCobrar: '',
    totalGastos: 0,
    facturadoEnCobrar: '', monedaConvenioCliente: '', montoConvenioCliente: 0,
    cargosAdicionales: 0, subtotalCliente: 0,
    dolaresCliente: 0, pesosCliente: 0, conversionCliente: 0,
    utilidadEstimada: 0, tipoCambioAprobado: 0
  });

  // ✅ V00465: catálogos del cobro del puente (los que el formulario ya tiene; sin lecturas nuevas).
  const ctxPuente = useMemo((): CtxCobroPuente => ({
    detalles: new Map((convDetallesLocal || []).map((d: DocCatalogo) => [idReal(d), d] as const)),
    tarifas: new Map((tarifasLocal || []).map((d: DocCatalogo) => [idReal(d), d] as const)),
    gastosIncluidos: gastosIncluidosLocal || [],
    tiposGasto: new Map((tiposGastosLocal || []).map((d: DocCatalogo) => [idReal(d), d] as const)),
    aduanas: mapaAduanas,
  }), [convDetallesLocal, tarifasLocal, gastosIncluidosLocal, tiposGastosLocal, mapaAduanas]);
  // ✅ V00469: ADUANA de la operación para elegir su flujo de estatus (Reglas de Estatus por
  //   aduana). Con el mismo convenio guardado manda la del servidor (aduanaNombre, V00258); si no,
  //   el segmento del nombre del convenio que sea una aduana del catálogo, o la de su tarifa.
  const aduanaForm = useMemo((): string => {
    const guardados = (initialData as Record<string, unknown> | undefined) || {};
    const guardada = String(guardados.aduanaNombre || '').trim();
    if (guardada && String(guardados.convenio || '') === String(formData.convenio || '')) return guardada;
    const nombres = Array.from(mapaAduanas.values()).filter(Boolean);
    const segmentos = String(formData.convenioNombre || '').split(' - ').map(normPuente).filter(Boolean);
    for (let i = segmentos.length - 1; i >= 0; i--) {
      const m = nombres.find((n) => normPuente(n) === segmentos[i]);
      if (m) return m;
    }
    return aduanaDeOperacionCtx(ctxPuente, { convenio: formData.convenio }) || guardada;
  }, [initialData, formData.convenio, formData.convenioNombre, mapaAduanas, ctxPuente]);

  // ✅ V00450: REF CLIENTE DUPLICADA — al salir del campo (y al abrir una operación que ya la
  //   trae) se busca la Ref en TODAS las operaciones. Solo avisa: no impide guardar; la
  //   operación irá a la pestaña Revisión de Operaciones / Facturación.
  const [refClienteDup, setRefClienteDup] = useState<{ clave: string; otras: OpRefResumen[] }>({ clave: '', otras: [] });
  const consultaRefClienteRef = useRef(0); // la última consulta manda (respuestas fuera de orden)
  const refClienteAvisadaRef = useRef(''); // una notificación por Ref, no en cada salida del campo
  const refClienteYaRevisada = (clave: string): boolean => !!clave && claveRefCliente(initialData?.refClienteRevisado) === clave;
  const verificarRefClienteDuplicada = async (valor: string, silencioso: boolean): Promise<void> => {
    const clave = claveRefCliente(valor);
    const n = ++consultaRefClienteRef.current;
    if (!clave) { setRefClienteDup({ clave: '', otras: [] }); return; }
    try {
      const otras = await buscarRefCliente(valor, { id: String(initialData?._docId || initialData?.id || ''), ref: String(initialData?.ref || '') });
      if (n !== consultaRefClienteRef.current) return;
      setRefClienteDup({ clave, otras });
      if (!silencioso && otras.length > 0 && !refClienteYaRevisada(clave) && refClienteAvisadaRef.current !== clave) {
        refClienteAvisadaRef.current = clave;
        const lista = otras.slice(0, 3).map(describirOp).join(', ') + (otras.length > 3 ? ` y ${otras.length - 3} más` : '');
        avisar({
          tipo: 'alerta',
          titulo: 'REF Cliente duplicada',
          texto: `La Ref Cliente "${valor.trim()}" ya existe en ${lista}. Puedes guardar, pero la operación irá a la pestaña Revisión.`,
        });
      }
    } catch (e) {
      console.warn('[REF Cliente] No se pudo verificar la Ref Cliente:', e); // nunca frena la captura
    }
  };
  const verificarRefAlAbrir = useEffectEvent(() => {
    if (initialData?.refCliente) void verificarRefClienteDuplicada(String(initialData.refCliente), true);
  });
  useEffect(() => verificarRefAlAbrir(), []);
  const claveRefActual = claveRefCliente(formData.refCliente);
  const dupRefVisible = refClienteDup.clave !== '' && refClienteDup.clave === claveRefActual && refClienteDup.otras.length > 0;

  // ✅ NUEVO — INFO DE LA UNIDAD SELECCIONADA: al elegir unidad se consulta su
  //   ÚLTIMO SERVICIO (operación más reciente) y la ÚLTIMA REFERENCIA DE
  //   DIESEL donde cargó, y se muestran debajo del campo.
  const [infoUnidad, setInfoUnidad] = useState<{ ultimaOpRef?: string; ultimaOpFecha?: string; dieselConsecutivo?: string; dieselFecha?: string; dieselGalones?: number } | null>(null);
  const [cargandoInfoUnidad, setCargandoInfoUnidad] = useState(false);

  const cargarInfoUnidad = useEffectEvent(() => {
    const uid = String(formData.unidad || '').trim();
    if (!uid) { setInfoUnidad(null); return; }
    let cancelado = false;
    (async () => {
      setCargandoInfoUnidad(true);
      try {
        // Último servicio: operaciones de la unidad (campo `unidad` y respaldo
        // `unidadId` en registros viejos), la más reciente por fechaServicio.
        // ✅ V00443 (Fase 7.8): con `consultasCanonicas`, solo las 2 más recientes por el canónico
        //   (unidadId + fechaServicioISO; 2 por si una es la que se edita) en lugar de hasta 600.
        const canon = (await obtenerFlags()).consultasCanonicas;
        const [s1, s2, sd] = await Promise.all([
          canon
            ? getDocs(query(collection(db, 'operaciones'), where('unidadId', '==', uid), orderBy('fechaServicioISO', 'desc'), limit(2)))
            : getDocs(query(collection(db, 'operaciones'), where('unidad', '==', uid), limit(300))),
          canon ? Promise.resolve(null) : getDocs(query(collection(db, 'operaciones'), where('unidadId', '==', uid), limit(300))),
          getDocs(query(collection(db, 'referencias_diesel'), where('unidadId', '==', uid), limit(300))),
        ]);
        const opsMap = new Map<string, any>();
        [...s1.docs, ...(s2?.docs ?? [])].forEach((d) => opsMap.set(d.id, { id: d.id, ...(d.data() as any) }));
        const ops = Array.from(opsMap.values())
          .filter((o: any) => !initialData?.id || o.id !== initialData.id) // sin contar la que se edita
          .sort((a: any, b: any) => (canon
            ? String(b.fechaServicioISO || '').localeCompare(String(a.fechaServicioISO || ''))
            : String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || ''))));
        const ultimaOp = ops[0] || null;

        const refsDiesel = sd.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
          .sort((a: any, b: any) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
        const ultimaDiesel = refsDiesel[0] || null;

        if (!cancelado) {
          setInfoUnidad({
            ultimaOpRef: ultimaOp?.ref || '',
            ultimaOpFecha: ultimaOp?.fechaServicio || '',
            dieselConsecutivo: ultimaDiesel?.consecutivo || '',
            dieselFecha: ultimaDiesel?.fecha || '',
            dieselGalones: Number(ultimaDiesel?.galonesCargados || ultimaDiesel?.galonesAutorizados || 0),
          });
        }
      } catch (e) {
        console.warn('No se pudo cargar el historial de la unidad:', e);
        if (!cancelado) setInfoUnidad(null);
      }
      if (!cancelado) setCargandoInfoUnidad(false);
    })();
    return () => { cancelado = true; };
  });
  useEffect(() => cargarInfoUnidad(), [formData.unidad]);


  const abrirCreacion = useCallback((
    catalogo: CatalogoCreable,
    onCreado: (nuevoId: string, registro: any) => void
  ) => {
    const listaActual =
      catalogo.coleccion === 'empresas' ? empresasLocal :
      catalogo.coleccion === 'remolques' ? remolquesLocal :
      catalogo.coleccion === 'unidades' ? unidadesLocal :
      empleadosLocalState;
    const idsPrevios = new Set(listaActual.map((r: any) => String(r.id)));
    setModalCatalogo({ catalogo, idsPrevios, onCreado });
  }, [empresasLocal, remolquesLocal, unidadesLocal, empleadosLocalState]);

  // ✅ V00439 (Fase 3.6): tras crear un registro ya no se relee la colección completa ni
  //   se copia a localStorage/almacenSesion: el listener compartido trae el registro nuevo
  //   (al instante con la escritura local) y las listas del formulario lo ven solas. Se
  //   consulta la lista viva unas veces por si el modal cerró antes de que llegara.
  const cerrarCreacion = useCallback(async () => {
    if (!modalCatalogo) return;
    const { catalogo, idsPrevios, onCreado } = modalCatalogo;

    setModalCatalogo(null);

    try {
      let nuevos: DocCatalogo[] = [];

      for (let intento = 0; intento < 4; intento++) {
        const docs = await obtenerCatalogo(catalogo.coleccion);
        nuevos = docs.filter((d) => !idsPrevios.has(String(d.id)));
        if (nuevos.length > 0) break;
        await new Promise((r) => setTimeout(r, 300));
      }

      if (nuevos.length >= 1) {
        const elegido = nuevos[nuevos.length - 1];
        onCreado(String(elegido.id), elegido);
      }
    } catch (e) {
      console.error('Error recargando catálogo tras crear:', e);
    }
  }, [modalCatalogo]);

  const nombreCortoEmpresa = (e: any): string => String(
    e?.nombreCorto ?? e?.nombre_corto ?? e?.nombrecorto ?? e?.shortName ?? e?.alias ?? ''
  ).trim();
  const nombreEmpresaMostrar = (e: any): string =>
    nombreCortoEmpresa(e) || e?.nombre || e?.empresa || e?.razonSocial || '';

  // ✅ V00271: RAZÓN SOCIAL — en Cliente (Paga) y Proveedor de Transporte se
  //   muestra el nombre completo (razón social), no el nombre corto (relación
  //   con Empresas: `nombre` es la razón social; nombreCorto es solo alias).
  const razonSocialEmpresa = (e: any): string =>
    // ✅ V00354: el campo razonSocial capturado en la ficha (V00343) tiene
    //   prioridad sobre el nombre — así "Global Textile" sale con su razón social.
    String(e?.razonSocial || e?.nombre || e?.empresa || '').trim() || nombreCortoEmpresa(e);

  const labelEmpresa = (e: any) => nombreEmpresaMostrar(e);
  const labelRemolque = (r: any) => `${r?.nombre || ''} ${r?.placas || r?.placa || ''}`.trim();
  const labelUnidad = (u: any) => u?.unidad || u?.nombre || '';
  const labelEmpleado = (o: any) => `${o?.firstName || ''} ${o?.lastNamePaternal || ''}`.trim();

  // ✅ V00355: al marcar Verde (o el estatus "🌉" del flujo, o Completado de respaldo) la
  //   operación guarda la TARIFA del puente. Solo se coloca una vez (no se pisa).
  // ✅ V00469: con la regla COMPARTIDA (cobroAlCambiarStatus, la del servidor y de Operaciones
  //   Activas) y los catálogos confirmados por el servidor (cargarCtxCobroPuente). La copia que
  //   tenía el formulario leía la tarifa solo de tarifaBaseId, con aduana Colombia podía cobrar
  //   una caseta de Nuevo Laredo, tomaba "hoy" en UTC y un 0 dejaba la operación sin cobrar.
  // ✅ V00470: se calcula SIEMPRE (también con la bandera cobroPuenteEnServidor): la ventana "Esta
  //   unidad cruzó el puente…" necesita el puente y el monto. Con la bandera no se guarda (ver handleSubmit).
  const camposSaldoPuente = async (statusFinal: string, statusNombreSP?: string): Promise<Record<string, unknown>> => {
    // ✅ V00369: el peaje SOLO aplica a Transfer, o Logística de Cruces con proveedor Roelca (mostrarPuente).
    if (!mostrarPuente) return {};
    try {
      const guardados = (initialData as Record<string, unknown> | undefined) || {};
      const nombre = String(statusNombreSP || '');
      const op: Record<string, unknown> = {
        ...guardados, tipoServicio: formData.tipoServicio, tipoOperacionId: formData.tipoOperacionId, trafico: formData.trafico,
        carga: formData.carga ?? guardados.carga, convenio: formData.convenio, convenioNombre: formData.convenioNombre ?? guardados.convenioNombre,
        aduanaNombre: aduanaForm, tipoOperacionNombre: tipoOpTextNormalizado, proveedorUnidadNombre: searchProvTransporte,
      };
      if (puenteYaCobrado(op)) return {};
      // ✅ V00469: como el servidor, solo al CAMBIAR DE ESTATUS (o si se corrige el convenio, el tipo de
      //   operación o el proveedor). Guardar otro campo de una operación que ya está en Verde no la cobra
      //   con la fecha de hoy.
      const cambioStatus = String(statusFinal || '') !== String(guardados.status || '');
      const cambioDatos = !!initialData && (['convenio', 'tipoOperacionId', 'proveedorUnidad'] as const)
        .some((c) => String(guardados[c] ?? '') !== String(formData[c] ?? ''));
      if (!cambioStatus && !cambioDatos) return {};
      // ✅ V00377: la REGLA DE ESTATUS del flujo manda — el estatus marcado con "🌉" dispara; los verdes, solo sin regla.
      const reglaFlujo = await puenteSegunFlujo(op, nombre); // ✅ V00473: la regla 🌉 y el puente elegido en ese paso
      const ev: EventoStatusPuente = {
        statusId: statusFinal, statusNombre: nombre, fechaEvento: '', flagFlujo: reglaFlujo.flag, reglaPuente: reglaFlujo.regla,
        hoy: hoyLocalISO(), fechaServicioISO: aFechaISO(formData.fechaServicio) || '',
      };
      if (!disparoCobroPuente(ev)) return {};
      const campos = cobroAlCambiarStatus(await cargarCtxCobroPuente(), op, ev);
      if (Object.keys(campos).length === 0) return {};
      // ✅ V00469: la copia del formulario pudo quedar vieja (Operaciones Activas, Referencias de
      //   Puentes o el servidor cobraron mientras estaba abierto): se confirma con el documento.
      const idDoc = String(guardados._docId || guardados.id || '');
      if (idDoc) {
        const actual = await getDoc(doc(db, 'operaciones', idDoc));
        const d = actual.exists() ? (actual.data() as Record<string, unknown>) : {};
        if (puenteYaCobrado(d)) return {};
        if (Number(d.saldoPuentePiso) > 0) for (const k of Object.keys(campos)) if (k.startsWith('saldoPuentePiso')) delete campos[k];
      }
      return campos;
    } catch (e) { console.warn('Saldo de puente al completar:', e); return {}; }
  };

  // ✅ V00439 (Fase 3.6): índice de flujos desde el catálogo compartido config_flujos_operacion
  //   (antes getDocs de la colección al abrir; ahora en vivo).
  const flujosIndex = useMemo(() => cat.flujos.map((x) => ({
    id: idReal(x), tipoServicio: String(x.tipoServicio || ''), trafico: String(x.trafico || ''), carga: String(x.carga || ''),
    aduana: String(x.aduana || ''), // ✅ V00469
  })), [cat.flujos]);

  // ✅ V00470: el flujo que le toca a la operación, calculado una vez por cambio (lo usa también la
  //   tarjeta Caseta / Puente para decir en qué estatus se cobra). buildConfigId lo devuelve.
  const flujoResuelto = useMemo(() => {
    const tipoOpText = tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || 'N/A';
    const traficoTxt = formData.trafico || 'N/A';
    const cargaTxt = formData.carga || 'N/A';

    const idCrudo = `${tipoOpText}_${traficoTxt}_${cargaTxt}`;

    // ✅ V00405: flujo exacto; si no hay, uno del mismo servicio con tráfico y/o
    //   carga COMODÍN (guardados sin elegir) — siempre el más específico.
    // ✅ V00469: primero entre los flujos de la ADUANA de la operación; si no hay, entre los
    //   generales (sin aduana). Los de otra aduana no se usan (igual que buscarFlujo).
    const esComodin = (v: unknown) => { const n = normClave(v); return !n || n === 'todos' || n === 'n/a'; };
    const elegir = (lista: typeof flujosIndex) => lista.find(f =>
      normClave(f.tipoServicio) === normClave(tipoOpText) &&
      normClave(f.trafico) === normClave(traficoTxt) &&
      normClave(f.carga) === normClave(cargaTxt)
    ) || lista
      .filter(f => normClave(f.tipoServicio) === normClave(tipoOpText) &&
        (esComodin(f.trafico) || normClave(f.trafico) === normClave(traficoTxt)) &&
        (esComodin(f.carga) || normClave(f.carga) === normClave(cargaTxt)))
      .sort((x, y) => (Number(!esComodin(y.trafico)) * 2 + Number(!esComodin(y.carga))) - (Number(!esComodin(x.trafico)) * 2 + Number(!esComodin(x.carga))))[0];
    const esGeneral = (f: { aduana: string }) => !f.aduana.trim() || normClave(f.aduana) === 'todas';
    const match = (aduanaForm ? elegir(flujosIndex.filter(f => !esGeneral(f) && mismaAduana(f.aduana, aduanaForm))) : undefined)
      || elegir(flujosIndex.filter(esGeneral));

    return { idGenerado: match ? match.id : idCrudo, porIndice: !!match };
  }, [tiposOperacion, formData.tipoOperacionId, formData.trafico, formData.carga, flujosIndex, aduanaForm]);
  const buildConfigId = useCallback(() => {
    console.log('🔑 configId generado:', flujoResuelto.idGenerado, flujoResuelto.porIndice ? '(resuelto por índice)' : '(crudo)');
    return flujoResuelto.idGenerado;
  }, [flujoResuelto]);
  // ✅ V00470: en qué estatus se cobra el puente según Reglas de Estatus: los pasos con 🌉 del flujo
  //   de la operación; [] = el flujo no marca ninguno (se cobra en los Verde).
  const flujoDocForm = useMemo(
    () => (flujoResuelto.porIndice ? cat.flujos.find((x) => idReal(x) === flujoResuelto.idGenerado) : undefined),
    [flujoResuelto, cat.flujos],
  );
  const pasosQueCobranPuente = useMemo((): string[] => {
    const nodos = Array.isArray(flujoDocForm?.flujo) ? (flujoDocForm.flujo as Record<string, unknown>[]) : [];
    return nodos.filter((n) => !!n.descuentaPuente).map((n) => String(n.nombreStatus || '').trim()).filter(Boolean);
  }, [flujoDocForm]);
  // ✅ V00473: el puente que eligieron en Reglas de Estatus para el (primer) paso que cobra.
  const reglaPuenteForm = useMemo(
    () => (flujoDocForm && pasosQueCobranPuente[0] ? reglaPuenteDelPaso(flujoDocForm, pasosQueCobranPuente[0]) : null),
    [flujoDocForm, pasosQueCobranPuente],
  );

  const statusPrevioParaCalculo = (): string | undefined => {
    if (!initialData) return undefined;
    const tipoCambiado = String(formData.tipoOperacionId || '') !== String(initialData.tipoOperacionId || '');
    return tipoCambiado ? undefined : initialData?.status;
  };

  // ✅ NUEVO: nombre del status GUARDADO de la operación, siempre visible al editar.
  //    Resuelve por id -> nombre del catálogo; si statusNombre quedó guardado con la
  //    DESCRIPCIÓN (bug previo), la mapea de regreso al nombre correcto.
  const statusActualGuardado = useMemo(() => {
    if (!initialData) return '';
    const lista: any[] = statusServicio || [];
    const idOp = String(initialData.status || '').trim();
    const porId = lista.find((st: any) => String(st.id || '').trim() === idOp);
    if (porId?.nombre) return String(porId.nombre);
    const den = String(initialData.statusNombre || '').trim();
    if (den) {
      const porNombre = lista.find((st: any) => String(st.nombre || '').trim().toLowerCase() === den.toLowerCase());
      if (porNombre?.nombre) return String(porNombre.nombre);
      const porDescripcion = lista.find((st: any) => String(st.descripcion || '').trim() === den);
      if (porDescripcion?.nombre) return String(porDescripcion.nombre);
    }
    const idComoNombre = lista.find((st: any) => String(st.nombre || '').trim().toLowerCase() === idOp.toLowerCase());
    if (idComoNombre?.nombre) return String(idComoNombre.nombre);
    return den || idOp;
  }, [initialData, statusServicio]);

  // ✅ V00439 (Fase 3.6): pestañas visibles y campos obligatorios del flujo salen del
  //   catálogo compartido (antes un getDoc por combinación guardado en estado).
  const configFormularioFlujo = useMemo(() => {
    const configId = buildConfigId();
    if (!configId || configId.includes('N/A') || configId === '__' || !formData.tipoOperacionId) return null;
    return cat.flujos.find((f) => idReal(f) === idDocFlujo(configId)) ?? null;
  }, [buildConfigId, formData.tipoOperacionId, cat.flujos]);
  const pestanasVisiblesConfig = Array.isArray(configFormularioFlujo?.pestanasVisibles) ? configFormularioFlujo.pestanasVisibles as TabType[] : null;
  const camposObligatoriosConfig = Array.isArray(configFormularioFlujo?.camposObligatorios) ? configFormularioFlujo.camposObligatorios as string[] : null;

  const pestanasVisibles = useMemo<TabType[]>(
    () => (pestanasVisiblesConfig === null ? TODAS_LAS_PESTANAS : pestanasVisiblesConfig),
    [pestanasVisiblesConfig]
  );

  useEffect(() => {
    if (pestanasVisibles.length > 0 && !pestanasVisibles.includes(pestañaActiva)) {
      setPestañaActiva(pestanasVisibles[0]);
    }
  }, [pestanasVisibles, pestañaActiva]);

  // ✅ V00438 (Fase 2.6): el estatus calculado solo depende de tipo/tráfico/carga (arman el
  //   configId) y de QUÉ campos están llenos (los camposRequeridos del flujo son configurables,
  //   cualquier campo puede contar). Antes se recalculaba en cada pausa al teclear.
  const claveStatusPreview = useMemo(() => {
    const llenos = Object.entries(formData as Record<string, unknown>)
      .filter(([, valor]) => valor !== undefined && valor !== null && String(valor).trim() !== '')
      .map(([campo]) => campo)
      .sort();
    return JSON.stringify([formData.tipoOperacionId, formData.trafico, formData.carga, aduanaForm, llenos]); // ✅ V00469: la aduana elige el flujo
  }, [formData, aduanaForm]);

  // ✅ V00438 (Fase 2.6): el flujo se lee FRESCO una vez por formulario abierto (y por
  //   combinación servicio/tráfico/carga) y se reutiliza en cada recálculo de la vista
  //   previa. Así un cambio en "Reglas de Estatus" se ve al abrir el siguiente formulario
  //   y teclear ya no lee Firestore.
  const flujosDelFormularioRef = useRef(new Map<string, Promise<DocumentData | null>>());
  const leerFlujoDelFormulario = useCallback((id: string): Promise<DocumentData | null> => {
    const mapa = flujosDelFormularioRef.current;
    let p = mapa.get(id);
    if (!p) {
      p = leerFlujoFresco(id).catch((e: unknown) => { mapa.delete(id); throw e; });
      mapa.set(id, p);
    }
    return p;
  }, []);

  // ✅ V00438 (Fase 2.6): Effect Event — al disparar el debounce lee el formData más reciente.
  const actualizarStatusPreview = useEffectEvent(async () => {
    const configId = buildConfigId();

    if (!configId || configId.includes('N/A') || configId === '__' || !formData.tipoOperacionId) {
      setStatusPreview('');
      setStatusError('Para conocer el Estatus de la operación, primero selecciona el Tipo de Operación, un Cliente y un Convenio válido.');
      setCamposSiguienteStatus([]);
      setNombreSiguienteAuto('');
      return;
    }

    try {
      const statusCalculado = await calcularStatusDinamico(configId, formData, statusPrevioParaCalculo(), { leerFlujo: leerFlujoDelFormulario });
      const statusObj = statusServicio?.find((s:any) => s.id === statusCalculado);
      setStatusPreview(statusObj?.nombre || statusObj?.descripcion || statusCalculado);
      setStatusError(null);

      await calcularCamposSiguienteAuto(configId, statusCalculado);
    } catch (error: any) {
      setStatusPreview('');
      setCamposSiguienteStatus([]);
      setNombreSiguienteAuto('');
      const msjLimpio = error.message.replace('BLOQUEO: ', '').replace('', '');
      setStatusError(msjLimpio);
      // ✅ Aunque el cálculo dinámico falle, al EDITAR se arma el checklist
      //    del siguiente status partiendo del status GUARDADO de la operación,
      //    para que "qué falta para avanzar" siempre esté visible.
      if (initialData && statusActualGuardado) {
        try { await calcularCamposSiguienteAuto(configId, statusActualGuardado); } catch { /* sin flujo configurado */ }
      }
    }
  });

  useEffect(() => {
    const timerId = setTimeout(() => { void actualizarStatusPreview(); }, 800);
    return () => clearTimeout(timerId);
  }, [claveStatusPreview, initialData, tiposOperacion, statusServicio, flujosIndex]);

  const etiquetaCampo = (campo: string): string => {
    const mapa: Record<string, string> = {
      clientePaga: 'Cliente (Paga)', convenio: 'Convenio', numeroRemolque: '# de Remolque',
      refCliente: 'Ref Cliente', origen: 'Origen', destino: 'Destino',
      clienteMercancia: 'Cliente (Mercancía)', descripcionMercancia: 'Descripción Mercancía',
      cantidad: 'Cantidad', embalaje: 'Embalaje', pesoKg: 'Peso (Kg)', numDoda: '# DODA',
      fechaEmisionDoda: 'Fecha Emisión DODA', pdfCartaPorte: 'PDF Carta Porte', pdfDoda: 'PDF DODA',
      numeroEntrys: "# de Entry's", cantEntrys: "Cantidad de Entry's", numManifiesto: '# Manifiesto',
      provServicios: 'Proveedor de Servicios', montoManifiesto: 'Costo Manifiesto', pdfManifiesto: 'PDF Manifiesto',
      proveedorUnidad: 'Proveedor de Transporte', facturadoEnUnidad: 'Facturado En (Unidad)',
      convenioProveedor: 'Convenio Proveedor', totalAPagarProv: 'Monto a Pagar Proveedor',
      unidad: 'Unidad', operador: 'Operador', sueldoOperador: 'Sueldo Operador',
      combustible: 'Combustible', unidadProveedor: 'Unidad del Proveedor', operadorProveedor: 'Operador del Proveedor',
      facturadoEnCobrar: 'Facturado En (Cobrar)', montoConvenioCliente: 'Monto Convenio Cliente',
      fechaServicio: 'Fecha de Servicio', fechaCita: 'Fecha de Cita',
    };
    return mapa[campo] || campo;
  };

  const camposObligatoriosFaltantes = useMemo(() => {
    const lista = camposObligatoriosConfig || [];
    if (lista.length === 0) return [] as { campo: string; etiqueta: string }[];

    const esVacio = (valor: any): boolean => {
      if (valor === undefined || valor === null) return true;
      if (Array.isArray(valor)) return valor.length === 0 || valor.every((v: any) => !v);
      return String(valor).trim() === '';
    };

    return lista
      .filter(campo => {
        const tab = CAMPO_TAB_MAP[campo];
        return !tab || pestanasVisibles.includes(tab);
      })
      .filter(campo => esVacio((formData as any)[campo]))
      .map(campo => ({ campo, etiqueta: etiquetaCampo(campo) }));
  }, [camposObligatoriosConfig, pestanasVisibles, formData]);

  const camposObligatoriosFaltantesSet = useMemo(
    () => new Set(camposObligatoriosFaltantes.map(f => f.campo)),
    [camposObligatoriosFaltantes]
  );

  const claseSiFalta = (campoId: string): string =>
    camposObligatoriosFaltantesSet.has(campoId) ? ' campo-obligatorio-faltante' : '';

  const calcularCamposSiguienteAuto = async (configId: string, statusActual: string) => {
    try {
      // ✅ V00438 (Fase 2.6): el mismo documento de flujo de este formulario.
      const datosFlujo = await leerFlujoDelFormulario(configId);
      if (!datosFlujo || !datosFlujo.flujo) { setCamposSiguienteStatus([]); setNombreSiguienteAuto(''); return; }
      const reglas = datosFlujo.flujo as any[];

      const norm = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
      const reglaActual = reglas.find(r => r.nombreStatus === statusActual) || reglas.find(r => norm(r.nombreStatus) === norm(statusActual));
      if (!reglaActual) { setCamposSiguienteStatus([]); setNombreSiguienteAuto(''); return; }

      const idsSiguientes: string[] = reglaActual.opcionesSiguientes || [];
      const siguienteAuto = idsSiguientes
        .map(id => reglas.find(r => r.id === id))
        .filter((r: any) => r && r.tipoMecanismo === 'automatico')
        .sort((a: any, b: any) => a.orden - b.orden)[0];

      if (!siguienteAuto) { setCamposSiguienteStatus([]); setNombreSiguienteAuto(''); return; }

      const campos: string[] = siguienteAuto.camposRequeridos || [];
      const lista = campos.map((campo: string) => {
        const valor = (formData as any)[campo];
        const cumplido = valor !== undefined && valor !== null && String(valor).trim() !== '';
        return { campo, etiqueta: etiquetaCampo(campo), cumplido };
      });
      setNombreSiguienteAuto(siguienteAuto.nombreStatus || '');
      setCamposSiguienteStatus(lista);
    } catch {
      setCamposSiguienteStatus([]);
      setNombreSiguienteAuto('');
    }
  };

  useEffect(() => {
    const sOp = Number(formData.sueldoOperador) || 0;
    const sExt = Number(formData.sueldoExtra) || 0;
    setFormData(prev => ({ ...prev, sueldoTotal: sOp + sExt }));
  }, [formData.sueldoOperador, formData.sueldoExtra]);

  useEffect(() => {if (formData.tipoOperacionId !== TIPO_OP_PROVEEDOR_FIJO) return;
    if (formData.proveedorUnidad === PROVEEDOR_FIJO_ID) return;
    const prov = empresas.find((e: any) => String(e.id) === PROVEEDOR_FIJO_ID);
    setFormData(prev => ({
      ...prev,
      proveedorUnidad: PROVEEDOR_FIJO_ID,
      convenioProveedor: '',
      facturadoEnUnidad: resolverMonedaIdDeEmpresa(prov) || prev.facturadoEnUnidad,
    }));
    if (prov) setSearchProvTransporte(prov.nombre || '');
  }, [formData.tipoOperacionId, empresas]);

  useEffect(() => {
    // ✅ Combustible siempre en números ENTEROS.
    const cBase = Math.round(Number(formData.combustible) || 0);
    const cExt = Math.round(Number(formData.combustibleExtra) || 0);
    setFormData(prev => ({ ...prev, combustibleTotal: cBase + cExt }));
  }, [formData.combustible, formData.combustibleExtra]);

  useEffect(() => {
    const manifiesto = Number(formData.montoManifiesto) || 0;
    const sueldo = Number(formData.sueldoTotal) || 0;
    setFormData(prev => ({ ...prev, totalGastos: manifiesto + sueldo }));
  }, [formData.montoManifiesto, formData.sueldoTotal]);

  // ✅ V00439 (Fase 3.6): los catálogos ahora llegan EN VIVO. Si este paso dependiera de
  //   las listas, cualquier cambio en Empresas/Unidades/Empleados (de otro usuario)
  //   volvería a cargar initialData y borraría lo capturado. Se aplica al abrir y una vez
  //   más cuando los catálogos base terminan de llegar (como antes al refrescarlos).
  const aplicarDatosIniciales = useEffectEvent(() => {
    if (initialData && empresas && remolques) {
      const safeInitialData = {
        ...initialData,
        fechaServicio: normalizarFechaISO(initialData.fechaServicio),
        fechaEmisionDoda: normalizarFechaISO(initialData.fechaEmisionDoda),
        fechaCita: initialData.fechaCita || '',
        pdfsEntrys: initialData.pdfsEntrys || [],
        numeroEntrys: initialData.numeroEntrys || '', 
        cantEntrys: Number(initialData.cantEntrys) || 0,
        montoManifiesto: Number(initialData.montoManifiesto) || 0, 
        totalAPagarProv: Number(initialData.totalAPagarProv) || 0,
        cargosAdicionalesProv: Number(initialData.cargosAdicionalesProv) || 0,
        cargosAdicionales: Number(initialData.cargosAdicionales) || 0,
        sueldoOperador: Number(initialData.sueldoOperador) || 0, 
        sueldoExtra: Number(initialData.sueldoExtra) || 0,        
        combustible: Math.round(Number(initialData.combustible) || 0),        
        combustibleExtra: Math.round(Number(initialData.combustibleExtra) || 0),  
        unidadProveedor: initialData.unidadProveedor || '',
        operadorProveedor: initialData.operadorProveedor || '',
        sueldoExtraNotas: initialData.sueldoExtraNotas || '',
        combustibleExtraNotas: initialData.combustibleExtraNotas || '',
        observacionesUnidad: initialData.observacionesUnidad || '',
        observacionesCobrar: initialData.observacionesCobrar || '',     
        totalGastos: Number(initialData.totalGastos) || 0,
        puenteId: initialData.puenteId || initialData.puente || '',
        puenteNombre: initialData.puenteNombre || '',
        puenteMonto: Number(initialData.puenteMonto) || 0,
      };

      setFormData(prev => ({ ...prev, ...safeInitialData }));
      fechaServicioTocada.current = false; // ✅ V00461: el formulario se reusa (minimizado) al abrir otra operación
      tcEditadoAMano.current = false; // ✅ V00462
      clienteOpIdRef.current = null; // ✅ V00463
      puenteElegidoAMano.current = false; // ✅ V00465
      puenteAutoId.current = '';

      const getNombreEmpresa = (id: string) => {
        if (!id) return '';
        const item = empresas.find((e: any) => e.id === id);
        return item ? (nombreEmpresaMostrar(item) || id) : id;
      };
      // ✅ V00354: razón social por id (para Cliente Mercancía y afines).
      const getRazonSocialEmpresa = (id: string) => {
        if (!id) return '';
        const item = empresas.find((e: { id?: string }) => e.id === id);
        return item ? razonSocialEmpresa(item) : '';
      };
      const getNombreRemolque = (id: string) => {
        if (!id) return '';
        const item = remolques.find((r: any) => r.id === id);
        return item ? `${item.nombre || ''} ${item.placas || item.placa || ''}`.trim() : id;
      };
      const getNombreOperador = (id: string) => {
        if (!id) return '';
        const item = listaEmpleadosLocal.find((e: any) => e.id === id);
        return item ? `${item.firstName || ''} ${item.lastNamePaternal || ''}`.trim() : id;
      };
      const getNombreUnidad = (id: string) => {
        if (!id) return '';
        const item = unidades.find((u: any) => u.id === id);
        return item ? item.unidad || item.nombre : id;
      };

      const remIdGuardado = String(
        initialData.numeroRemolque || initialData.remolque || initialData.remolqueId || initialData.numero_remolque || ''
      ).trim();

      setSearchClientePaga(initialData.clienteNombre || getNombreEmpresa(initialData.clientePaga));
      setSearchOrigen(initialData.origenNombre || getNombreEmpresa(initialData.origen));
      setSearchDestino(initialData.destinoNombre || getNombreEmpresa(initialData.destino));
      setSearchClienteMercancia(getRazonSocialEmpresa(initialData.clienteMercancia) || initialData.clienteMercanciaNombre || getNombreEmpresa(initialData.clienteMercancia)); // ✅ V00354
      setSearchProvServicios(initialData.provServiciosNombre || getNombreEmpresa(initialData.provServicios));
      setSearchProvTransporte(initialData.proveedorUnidadNombre || getNombreEmpresa(initialData.proveedorUnidad));
      setSearchRemolque(initialData.remolqueNombre || getNombreRemolque(remIdGuardado) || initialData.remolquePlaca || ''); 
      setSearchUnidad(initialData.unidadNombre || getNombreUnidad(initialData.unidad));
      setSearchOperador(initialData.operadorNombre || getNombreOperador(initialData.operador));

      const uProv = listaUniProvLocal.find((e: any) => e.id === initialData.unidadProveedor);
      setSearchUnidadProveedor(initialData.unidadProveedorNombre || (uProv ? (uProv.numeroUnidad || uProv.numero_unidad || uProv.unidad || uProv.placas) : initialData.unidadProveedor || ''));
      const opProv = listaOpeProvLocal.find((e: any) => e.id === initialData.operadorProveedor);
      setSearchOperadorProveedor(initialData.operadorProveedorNombre || (opProv ? (opProv.nombre || opProv.nombres || opProv.nombreCompleto) : initialData.operadorProveedor || ''));
      setSearchConvenio(''); // ✅ V00239: la arma el efecto desde la lista de convenios
      setSearchConvenioProveedor(''); // ✅ V00239: se arma desde la lista de convenios
      setReferencia(initialData.ref || (initialData as any).referencia || '');
    }
  });
  useEffect(() => { aplicarDatosIniciales(); }, [initialData, catalogosBaseListos]);

  // ✅ FIX TIPO DE CAMBIO: al colocar la fecha busca el TC de forma TOLERANTE al
  //   formato (Timestamp/ISO/DD-MM-YYYY, etc.). Si no está en memoria lo trae
  //   DIRECTO de Firestore y lo autocompleta.
  // ✅ V00439 (Fase 3.6): el catálogo de T.C. del padre ahora llega EN VIVO; el efecto
  //   depende del T.C. de ESA fecha (no de la lista entera) para no pisar un ajuste
  //   manual cada vez que cambia otro renglón de tipo_cambio.
  // ✅ V00461: el que le toca a la fecha (sábado/domingo sin registro → el del viernes). Valor y día
  //   por separado (primitivos) para que el efecto solo corra si cambian, no con cada renglón nuevo.
  const tcAplicableCatalogo = useMemo(
    () => buscarTCAplicable(catalogoTCResuelto, normalizarFechaISO(formData.fechaServicio)),
    [catalogoTCResuelto, formData.fechaServicio],
  );
  const tcCatalogoDeFecha = tcAplicableCatalogo?.valor ?? null;
  const fechaTCCatalogo = tcAplicableCatalogo?.fecha ?? '';
  // ✅ V00461: el T.C. de la operación es el de SU fecha de servicio.
  //   · Antes, al abrir una operación guardada, este efecto corría primero con la fecha por
  //     defecto del formulario (HOY) y le ponía el T.C. de hoy, que se quedaba al cargar su
  //     fecha. Ahora una operación guardada solo mira su propia fecha hasta que el usuario la cambia.
  //   · Nueva o con la fecha cambiada: el T.C. de esa fecha, o 0 si aún no hay registro (antes
  //     se quedaba el de la fecha anterior y se mostraba como "oficial"). Si el usuario vuelve a
  //     la fecha original de una guardada, regresa su T.C. guardado.
  //   · ✅ V00462 · Guardada en su fecha: el T.C. pasa al oficial de su fecha también al abrirla
  //     (traiga 0 u otro; se guarda al Guardar). No se cambia solo si ya está facturada (sería
  //     cambiar una factura emitida: AvisoTipoCambio lo marca) ni si se escribió a mano aquí.
  useEffect(() => {
    if (!formData.fechaServicio) return;

    const objetivoISO = normalizarFechaISO(formData.fechaServicio);
    const fechaInicialISO = normalizarFechaISO(initialData?.fechaServicio);
    // Fecha por defecto (hoy) antes de que lleguen los datos de la operación: no es la suya.
    if (initialData && !fechaServicioTocada.current && objetivoISO !== fechaInicialISO) return;
    const sigueLaFecha = !initialData || fechaServicioTocada.current;

    let cancelado = false;
    setBuscandoTC(true);

    (async () => {
      if (!objetivoISO) { if (!cancelado) { setTipoCambioDia(null); setFechaTCDia(''); setBuscandoTC(false); } return; }

      let tcEncontrado = tcCatalogoDeFecha;
      let fechaDelTC = fechaTCCatalogo;

      if (tcEncontrado === null) {
        try {
          // ✅ V00438 (Fase 2.9): una consulta por fecha (limit 1) en vez de la colección completa.
          const fila = await obtenerFilaTipoCambioDeFecha(objetivoISO);
          if (!cancelado && fila) { tcEncontrado = buscarTCDeFecha([fila], objetivoISO); fechaDelTC = objetivoISO; }
        } catch { /* noop */ }
      }

      if (cancelado) return;

      setTipoCambioDia(tcEncontrado);
      setFechaTCDia(tcEncontrado !== null ? fechaDelTC : '');

      const facturada = !!initialData && (facturadaCliente(initialData) || facturadaProveedor(initialData));
      if (sigueLaFecha) {
        // De vuelta en su fecha original: el oficial, o el que traía si no hay oficial o ya está facturada.
        const tcGuardado = Number(initialData?.tipoCambioAprobado) || 0;
        const esSuFecha = !!initialData && objetivoISO === fechaInicialISO;
        const tc = esSuFecha && tcGuardado > 0 && (tcEncontrado === null || facturada) ? tcGuardado : (tcEncontrado ?? 0);
        setFormData(prev => ({ ...prev, tipoCambioAprobado: tc }));
      } else if (tcEncontrado !== null) {
        const oficial = tcEncontrado;
        setFormData(prev => {
          const nuevo = tcParaOperacionGuardada({ actual: Number(prev.tipoCambioAprobado) || 0, oficial, facturada, editadoAMano: tcEditadoAMano.current });
          return nuevo === null ? prev : { ...prev, tipoCambioAprobado: nuevo };
        });
      }
      setBuscandoTC(false);
    })();

    return () => { cancelado = true; setBuscandoTC(false); };
    // ✅ V00461: catalogosBaseListos → corre junto con la segunda carga de initialData (que trae su T.C. 0 otra vez).
  }, [formData.fechaServicio, tcCatalogoDeFecha, fechaTCCatalogo, initialData, catalogosBaseListos]);

  const refMaestroDetalle = (d: any): string => String(
    d.convenioId ?? d.convenio ?? d.id_convenio ?? d.convenioClienteId ?? d.convenioProveedorId ??
    d.maestroId ?? d.padreId ?? d.convenio_id ?? ''
  ).trim();
  const ownerClienteDetalle = (d: any): string => String(
    d.clienteId ?? d.cliente ?? d.id_cliente ?? d.clientePaga ?? d.empresaId ?? ''
  ).trim();
  const ownerProvDetalle = (d: any): string => String(
    d.proveedorId ?? d.proveedor ?? d.id_proveedor ?? d.empresaId ?? ''
  ).trim();
  const montoDetalle = (d: any): number => Number(
    d.tarifa ?? d.monto ?? d.precio ?? d.importe ?? d.costo ?? d.montoConvenio ?? d.monto_convenio ??
    d.tarifaMonto ?? d.valor ?? 0
  ) || 0;

  // ✅ V00439 (Fase 3.6): con Empresas EN VIVO, los convenios dependen del cliente/proveedor
  //   ya resuelto (id, o por nombre si aún no hay id) y no de la lista completa: un cambio
  //   en OTRA empresa no recalcula los convenios ni vuelve a aplicar monto/sueldo/combustible.
  const clientePagaIdResuelto = useMemo(() => {
    let clientId = formData.clientePaga;
    if (!clientId && searchClientePaga && empresas) {
      const emp = empresas.find((e: any) => e.nombre?.toLowerCase().trim() === searchClientePaga.toLowerCase().trim());
      if (emp) clientId = emp.id;
    }
    return String(clientId || '').trim();
  }, [formData.clientePaga, searchClientePaga, empresas]);

  const proveedorIdResuelto = useMemo(() => {
    let provId = formData.proveedorUnidad;
    if (!provId && searchProvTransporte && empresas) {
      const prov = empresas.find((e: any) => e.nombre?.toLowerCase().trim() === searchProvTransporte.toLowerCase().trim());
      if (prov) provId = prov.id;
    }
    return String(provId || '').trim();
  }, [formData.proveedorUnidad, searchProvTransporte, empresas]);

  const listaConveniosCliente = useMemo(() => {
    const clientId = clientePagaIdResuelto;
    if (!clientId || !catalogoConvClientes || !catalogoConvDetalles) {
      const convId = String(initialData?.convenio || '').trim();
      if (initialData && convId) {
        return [{
          id: convId,
          tarifaBaseId: '',
          descripcion: initialData.convenioNombre || 'Convenio guardado',
          monedaMaestro: initialData.monedaConvenioCliente || ID_USD,
          tarifaMonto: Number(initialData.montoConvenioCliente) || 0,
        }];
      }
      return [];
    }
    const cid = String(clientId).trim();

    // ✅ V00272: # de TARIFARIO del detalle — los detalles viejos/importados no
    //   traen tarifarioId; se resuelve por la relación tarifario.convenioId →
    //   maestro del detalle, y como último respaldo el tarifario aprobado del
    //   cliente cuando tiene uno solo.
    const tariPorConvenioId = new Map<string, string>();
    const tariPorConsecConvenio = new Map<string, string>(); // ✅ V00281: tarifas[] del tarifario → CONV
    const consecPorTariId = new Map<string, string>(); // ✅ V00313: id del doc → TARI-###
    const tarisDelCliente: string[] = [];
    (tarifariosLocal || []).forEach((t: { consecutivo?: unknown; id?: unknown; convenioId?: unknown; clienteId?: unknown; proveedorId?: unknown; status?: unknown; tarifas?: unknown }) => {
      const consec = String(t.consecutivo || t.id || '').trim();
      if (!consec) return;
      consecPorTariId.set(String(t.id || '').trim(), consec); // ✅ V00313
      consecPorTariId.set(consec, consec); // ✅ V00313: si ya viene como TARI-### queda igual
      const convId = String(t.convenioId || '').trim();
      if (convId && !tariPorConvenioId.has(convId)) tariPorConvenioId.set(convId, consec);
      // ✅ V00281: la relación MÁS DIRECTA — cada tarifario guarda sus tarifas
      //   con el consecutivo CONV-### que se les asignó al crearlo.
      (Array.isArray(t.tarifas) ? t.tarifas : []).forEach((lt) => {
        const cc = String((lt as Record<string, unknown>)?.consecutivo || '').trim();
        if (cc && !tariPorConsecConvenio.has(cc)) tariPorConsecConvenio.set(cc, consec);
        const kc = claveConsecutivo(cc); // ✅ V00428: "CONV-173" = "173" = 173
        if (kc && !tariPorConsecConvenio.has(`#${kc}`)) tariPorConsecConvenio.set(`#${kc}`, consec);
      });
      if (String(t.clienteId || '').trim() === cid && String(t.status || '').trim() === 'Aprobado') tarisDelCliente.push(consec);
    });
    const resolverTariDetalle = (d: { tarifarioId?: unknown; tarifario_id?: unknown; tarifario?: unknown; convenioId?: unknown; consecutivo?: unknown }, maestroId: unknown): string => {
      const directo = String(d?.tarifarioId || d?.tarifario_id || d?.tarifario || '').trim();
      if (directo) return consecPorTariId.get(directo) || directo; // ✅ V00313: el FK guarda el ID del doc — se muestra su TARI-###
      const porConsec = tariPorConsecConvenio.get(String(d?.consecutivo || '').trim()) // ✅ V00281
        || tariPorConsecConvenio.get(`#${claveConsecutivo(d?.consecutivo)}`); // ✅ V00428: por número
      if (porConsec) return porConsec;
      const porMaestro = tariPorConvenioId.get(String(d?.convenioId || maestroId || '').trim());
      if (porMaestro) return porMaestro;
      return tarisDelCliente.length === 1 ? tarisDelCliente[0] : '';
    };

    const maestros = catalogoConvClientes.filter((c: any) => String(
      c.clienteId ?? c.cliente ?? c.id_cliente ?? c.clientePaga ?? c.empresaId ?? c.empresa ?? ''
    ).trim() === cid);
    const maestroIds = new Set<string>();
    maestros.forEach((m: any) => {
      if (m.id != null) maestroIds.add(String(m.id).trim());
      const nc = String(m.numeroConvenio ?? '').trim(); if (nc) maestroIds.add(nc);
      const nm = String(m.numero ?? '').trim(); if (nm) maestroIds.add(nm);
    });

    const union = new Map<string, any>();
    catalogoConvDetalles.forEach((d: any) => {
      const ref = refMaestroDetalle(d);
      const directo = ownerClienteDetalle(d);
      if ((ref && maestroIds.has(ref)) || (directo && directo === cid)) {
        union.set(String(d.id), d);
      }
    });
    // ✅ V00428: EL TARIFARIO DEL CLIENTE TAMBIÉN ES FUENTE. Antes solo se
    //   ofrecían los detalles cuyo convenioId apuntaba a un convenio maestro
    //   VIVO del cliente; si el maestro se unió/borró (o el detalle quedó
    //   colgado de otro), la línea seguía en el tarifario pero NO salía aquí
    //   (caso Trompo de C.H. Robinson). Ahora también entran:
    //   (a) los detalles que alguna línea de un tarifario del cliente referencia
    //       por su consecutivo (comparado por NÚMERO: CONV-173 = 173), y
    //   (b) los detalles cuyo tarifarioId es un tarifario del cliente.
    //   El STATUS de la línea manda sobre el del detalle (regla V00202).
    const statusPorLinea = new Map<string, string>();
    {
      type DetConv = { id?: unknown; consecutivo?: unknown; tarifarioId?: unknown };
      const porId = new Map<string, DetConv>();
      const porNumero = new Map<string, DetConv>();
      (catalogoConvDetalles as DetConv[]).forEach((d) => {
        porId.set(String(d.id).trim(), d);
        const k = claveConsecutivo(d.consecutivo || d.id);
        if (k && !porNumero.has(k)) porNumero.set(k, d);
      });
      const tarisCli = (tarifariosLocal || []).filter((t: { clienteId?: unknown; status?: unknown }) =>
        String(t.clienteId || '').trim() === cid && !['Inactivo', 'Cancelado'].includes(String(t.status || '').trim()));
      const idsTarisCli = new Set<string>();
      tarisCli.forEach((t: { id?: unknown; consecutivo?: unknown; tarifas?: unknown }) => {
        idsTarisCli.add(String(t.id || '').trim());
        if (String(t.consecutivo || '').trim()) idsTarisCli.add(String(t.consecutivo).trim());
        (Array.isArray(t.tarifas) ? t.tarifas : []).forEach((lt: Record<string, unknown>) => {
          const cc = String(lt?.consecutivo || '').trim();
          if (!cc) return;
          const det = porId.get(cc) || porNumero.get(claveConsecutivo(cc));
          if (!det) return;
          union.set(String(det.id), det);
          const stL = String(lt?.status || '').trim();
          if (stL) statusPorLinea.set(String(det.id), stL);
        });
      });
      (catalogoConvDetalles as DetConv[]).forEach((d) => {
        if (idsTarisCli.has(String(d.tarifarioId || '').trim())) union.set(String(d.id), d);
      });
    }
    const detallesAsociados = Array.from(union.values());

    let lista = detallesAsociados.map((d: any) => {
      const tarifaId = d.tipoConvenioId || d.tipo_convenio_id || d.tipoConvenio || d.tipo_convenio || d.tarifaId || d.tarifa_id || d['TIPO DE CONVENIO'];
      const tObj = tarifas?.find((t: any) => String(t.id).trim() === String(tarifaId).trim());
      const ref = refMaestroDetalle(d);
      const maestroAsociado = maestros.find((m: any) =>
        String(m.id).trim() === ref ||
        String(m.numeroConvenio ?? '').trim() === ref ||
        String(m.numero ?? '').trim() === ref
      );
      const nombreTarifa = tObj?.descripcion || tObj?.nombre || tObj?.tarifa || tObj?.concepto || tObj?.tipo;
      const nombreFinal = d.tipoConvenioNombre || nombreTarifa || (tarifaId ? `Tarifa (${tarifaId})` : 'Sin Asignar');
      return {
        ...d,
        // ✅ V00249: manda el NOMBRE DE LA TARIFA (Cruce de Importación - Caja -
        //   Vacío…), que es lo que distingue un convenio de otro del mismo
        //   cliente; la descripción calculada es igual para todos y agrupaba
        //   varios convenios en una sola opción.
        id: d.id, tarifaBaseId: tarifaId, descripcion: nombreFinal,
        // ✅ V00313: montos alternos del convenio (V00304) — habilitan el desplegable Tarifa A/B.
        montosAlt: (Array.isArray(d.montos) ? d.montos.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0) : []),
        tarifarioConsec: resolverTariDetalle(d, maestroAsociado?.id), // ✅ V00272: # de tarifario resuelto
        statusDetalle: statusPorLinea.get(String(d.id)) || String(d.status || ''), // ✅ V00214 · V00428: la línea del tarifario manda
        // ✅ V00126: la moneda del DETALLE manda (se resuelve a id de catálogo aunque venga como texto "Pesos"/"Dólares")
        monedaMaestro: resolverMonedaIdDeEmpresa({ moneda: d.moneda }) || maestroAsociado?.monedaId || maestroAsociado?.moneda || ID_USD,
        tarifaMonto: montoDetalle(d),
      };
    });

    // ✅ V00214: los detalles con status Inactivo o Cancelado NO se ofrecen.
    lista = lista.filter((c: any) => {
      const st = String(c.statusDetalle || '').trim();
      return st !== 'Inactivo' && st !== 'Cancelado';
    });

    const convGuardadoId = String(initialData?.convenio || '').trim();
    if (initialData && convGuardadoId && !lista.some((c: any) => String(c.id) === convGuardadoId)) {
      const detReal = (catalogoConvDetalles || []).find((d: any) => String(d.id) === convGuardadoId);
      const tarifaId = detReal ? (detReal.tipoConvenioId || detReal.tipo_convenio_id || detReal.tipoConvenio || detReal.tipo_convenio || detReal.tarifaId || detReal.tarifa_id || detReal['TIPO DE CONVENIO']) : '';
      lista.push({
        ...(detReal || {}),
        id: convGuardadoId,
        tarifaBaseId: tarifaId,
        descripcion: initialData.convenioNombre || (detReal as any)?.tipoConvenioNombre || 'Convenio guardado',
        monedaMaestro: initialData.monedaConvenioCliente || resolverMonedaIdDeEmpresa({ moneda: (detReal as any)?.moneda }) || ID_USD,
        tarifaMonto: Number(initialData.montoConvenioCliente ?? montoDetalle(detReal || {})) || 0,
      });
    }

    // ✅ V00428: orden por # de convenio (como en el tarifario)
    const numDe = (c: { consecutivo?: unknown; id?: unknown }) => Number(claveConsecutivo(c.consecutivo || c.id)) || Number.MAX_SAFE_INTEGER;
    lista.sort((a: { consecutivo?: unknown; id?: unknown }, b: { consecutivo?: unknown; id?: unknown }) => numDe(a) - numDe(b));
    return lista;
  }, [clientePagaIdResuelto, catalogoConvClientes, catalogoConvDetalles, tarifas, initialData, tarifariosLocal]); // ✅ V00272 · V00439

  const listaConveniosProveedor = useMemo(() => {
    const provId = proveedorIdResuelto; // ✅ V00439 (Fase 3.6)
    if (!provId || !conveniosProv || !Array.isArray(conveniosProv)) {
      const convProvId = String(initialData?.convenioProveedor || '').trim();
      if (initialData && convProvId) {
        return [{
          id: convProvId,
          tarifaBaseId: '',
          tipoConvenioNombre: initialData.convenioProveedorNombre || 'Convenio guardado',
          monedaBase: initialData.monedaConvenioProv || ID_USD,
          tarifaMonto: Number(initialData.totalAPagarProv) || 0,
        }];
      }
      return [];
    }
    const pid = String(provId).trim();

    // ✅ V00272: # de TARIFARIO (TARP) del detalle — mismas fuentes que el
    //   lado cliente: tarifarioId directo → tarifario.convenioId → único
    //   tarifario aprobado del proveedor.
    const tariPorConvenioIdProv = new Map<string, string>();
    const tariPorConsecConvenioProv = new Map<string, string>(); // ✅ V00281
    const consecPorTariIdProv = new Map<string, string>(); // ✅ V00313: id del doc → TARP-###
    const tarisDelProveedor: string[] = [];
    (tarifariosProvLocal || []).forEach((t: { consecutivo?: unknown; id?: unknown; convenioId?: unknown; clienteId?: unknown; proveedorId?: unknown; status?: unknown; tarifas?: unknown }) => {
      const consec = String(t.consecutivo || t.id || '').trim();
      if (!consec) return;
      consecPorTariIdProv.set(String(t.id || '').trim(), consec); // ✅ V00313
      consecPorTariIdProv.set(consec, consec); // ✅ V00313
      const convId = String(t.convenioId || '').trim();
      if (convId && !tariPorConvenioIdProv.has(convId)) tariPorConvenioIdProv.set(convId, consec);
      (Array.isArray(t.tarifas) ? t.tarifas : []).forEach((lt) => {
        const cc = String((lt as Record<string, unknown>)?.consecutivo || '').trim();
        if (cc && !tariPorConsecConvenioProv.has(cc)) tariPorConsecConvenioProv.set(cc, consec);
      });
      if (String(t.proveedorId || '').trim() === pid && String(t.status || '').trim() === 'Aprobado') tarisDelProveedor.push(consec);
    });
    const resolverTariDetalleProv = (d: { tarifarioId?: unknown; tarifario_id?: unknown; tarifario?: unknown; convenioId?: unknown; consecutivo?: unknown }, maestroId: unknown): string => {
      const directo = String(d?.tarifarioId || d?.tarifario_id || d?.tarifario || '').trim();
      if (directo) return consecPorTariIdProv.get(directo) || directo; // ✅ V00313
      const porConsec = tariPorConsecConvenioProv.get(String(d?.consecutivo || '').trim()); // ✅ V00281
      if (porConsec) return porConsec;
      const porMaestro = tariPorConvenioIdProv.get(String(d?.convenioId || maestroId || '').trim());
      if (porMaestro) return porMaestro;
      return tarisDelProveedor.length === 1 ? tarisDelProveedor[0] : '';
    };

    const maestrosAsociados = conveniosProv.filter((c: any) => String(
      c.proveedorId ?? c.proveedor ?? c.id_proveedor ?? c.empresaId ?? c.empresa ?? ''
    ).trim() === pid);
    const maestroIds = new Set(maestrosAsociados.map((m: any) => String(m.id).trim()));

    const union = new Map<string, any>();
    (catalogoConvProvDetalles || []).forEach((d: any) => {
      const ref = refMaestroDetalle(d);
      const directo = ownerProvDetalle(d);
      if ((ref && maestroIds.has(ref)) || (directo && directo === pid)) {
        union.set(String(d.id), d);
      }
    });
    const detallesAsociados = Array.from(union.values());

    let lista = detallesAsociados.map((d: any) => {
      const tarifaId = d.tipoConvenioId || d.tipo_convenio || d.tipoConvenio || d.tarifaId || d.tarifa_id || d['TIPO DE CONVENIO'];
      const tObj = tarifas?.find((t: any) => String(t.id).trim() === String(tarifaId).trim());
      const ref = refMaestroDetalle(d);
      const maestroParent = maestrosAsociados.find((m: any) => String(m.id).trim() === ref);
      const nombreFinal = tObj?.descripcion || tObj?.nombre || tObj?.tarifa || tObj?.concepto || d.tipoConvenioNombre || 'Concepto sin nombre';
      return {
        ...d,
        // ✅ V00249: manda el nombre de la TARIFA (distingue los convenios).
        id: d.id, tarifaBaseId: tarifaId, tipoConvenioNombre: nombreFinal,
        // ✅ V00313: montos alternos del convenio (V00304) — desplegable Tarifa A/B.
        montosAlt: (Array.isArray(d.montos) ? d.montos.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0) : []),
        tarifarioConsec: resolverTariDetalleProv(d, maestroParent?.id), // ✅ V00272: # de tarifario (TARP) resuelto
        statusDetalle: String(d.status || ''), // ✅ V00214
        // ✅ V00126: la moneda del DETALLE manda (se resuelve a id de catálogo aunque venga como texto)
        monedaBase: resolverMonedaIdDeEmpresa({ moneda: d.moneda }) || maestroParent?.monedaId || maestroParent?.moneda || ID_USD,
        tarifaMonto: montoDetalle(d),
      };
    });

    // ✅ V00214: los detalles Inactivo/Cancelado NO se ofrecen en la operación.
    lista = lista.filter((c: any) => {
      const st = String(c.statusDetalle || '').trim();
      return st !== 'Inactivo' && st !== 'Cancelado';
    });

    const convProvGuardadoId = String(initialData?.convenioProveedor || '').trim();
    if (initialData && convProvGuardadoId && !lista.some((c: any) => String(c.id) === convProvGuardadoId)) {
      const detReal = (catalogoConvProvDetalles || []).find((d: any) => String(d.id) === convProvGuardadoId);
      const tarifaId = detReal ? (detReal.tipoConvenioId || detReal.tipo_convenio || detReal.tipoConvenio || detReal.tarifaId || detReal.tarifa_id || detReal['TIPO DE CONVENIO']) : '';
      lista.push({
        ...(detReal || {}),
        id: convProvGuardadoId,
        tarifaBaseId: tarifaId,
        tipoConvenioNombre: initialData.convenioProveedorNombre || (detReal as any)?.tipoConvenioNombre || 'Convenio guardado',
        monedaBase: initialData.monedaConvenioProv || resolverMonedaIdDeEmpresa({ moneda: (detReal as any)?.moneda }) || ID_USD,
        tarifaMonto: Number(initialData.totalAPagarProv ?? montoDetalle(detReal || {})) || 0,
      });
    }

    return lista;
  }, [proveedorIdResuelto, conveniosProv, catalogoConvProvDetalles, tarifas, initialData, tarifariosProvLocal]); // ✅ V00272 · V00439

  const mostrarConvenioClienteGuardado = useEffectEvent(() => {
    if (!initialData) return;
    if (!formData.convenio) return;
    if (searchConvenio && searchConvenio.trim()) return;
    const conv = listaConveniosCliente.find((c: any) => String(c.id) === String(formData.convenio));
    const nombre = conv ? etiquetaConvenioCliente(conv) : (initialData.convenioNombre || '');
    if (nombre) setSearchConvenio(nombre);
  });
  useEffect(() => mostrarConvenioClienteGuardado(), [initialData, formData.convenio, searchConvenio, listaConveniosCliente]);

  const mostrarConvenioProveedorGuardado = useEffectEvent(() => {
    if (!initialData) return;
    if (!formData.convenioProveedor) return;
    if (searchConvenioProveedor && searchConvenioProveedor.trim()) return;
    const conv = listaConveniosProveedor.find((c: any) => String(c.id) === String(formData.convenioProveedor));
    const nombre = conv ? etiquetaConvenioProveedor(conv) : (initialData.convenioProveedorNombre || '');
    if (nombre) setSearchConvenioProveedor(nombre);
  });
  useEffect(() => mostrarConvenioProveedorGuardado(), [initialData, formData.convenioProveedor, searchConvenioProveedor, listaConveniosProveedor]);

  const mostrarRemolqueGuardado = useEffectEvent(() => {
    if (!initialData) return;
    if (searchRemolque && searchRemolque.trim()) return;
    const remId = String(
      initialData.numeroRemolque || initialData.remolque || initialData.remolqueId || initialData.numero_remolque || ''
    ).trim();
    if (initialData.remolqueNombre) { setSearchRemolque(initialData.remolqueNombre); return; }
    if (!remId) return;
    const item = (remolques || []).find((r: any) => String(r.id) === remId);
    if (item) {
      setSearchRemolque(`${item.nombre || ''} ${item.placas || item.placa || ''}`.trim() || remId);
    } else {
      setSearchRemolque(initialData.remolquePlaca || remId);
    }
    if (!formData.numeroRemolque) setFormData(prev => ({ ...prev, numeroRemolque: remId }));
  });
  useEffect(() => mostrarRemolqueGuardado(), [initialData, remolques, searchRemolque, formData.numeroRemolque]);

  const convenioClienteMaestroId = useMemo(() => {
    if (!clientePagaIdResuelto || !catalogoConvClientes) return '';
    const maestro = catalogoConvClientes.find((c: any) => String(
      c.clienteId ?? c.cliente ?? c.id_cliente ?? c.clientePaga ?? c.empresaId ?? c.empresa ?? ''
    ).trim() === clientePagaIdResuelto);
    return maestro ? String(maestro.id) : '';
  }, [clientePagaIdResuelto, catalogoConvClientes]);

  const convenioProvMaestroId = useMemo(() => {
    if (!proveedorIdResuelto || !conveniosProv) return '';
    const maestro = conveniosProv.find((c: any) => String(
      c.proveedorId ?? c.proveedor ?? c.id_proveedor ?? c.empresaId ?? c.empresa ?? ''
    ).trim() === proveedorIdResuelto);
    return maestro ? String(maestro.id) : '';
  }, [proveedorIdResuelto, conveniosProv]);

  const sugerirConvenioProveedor = useEffectEvent(() => {
    if (!pestanasVisibles.includes('unidad')) return;
    if (!formData.convenio) return;

    const _tipoTxt = (tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '').toLowerCase();
    const _isTransfer = _tipoTxt.includes('transfer');
    const _isLog = _tipoTxt.includes('logistica') || _tipoTxt.includes('logística');
    const _isFle = _tipoTxt.includes('fletes') || _tipoTxt.includes('flete');
    const _isRoelcaProv = searchProvTransporte.toLowerCase().includes('roelca');
    if (_isTransfer || ((_isLog || _isFle) && _isRoelcaProv)) return;

    if (formData.convenioProveedor) return;

    const convCliente = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
    if (!convCliente) return;
    const tarifaCliente = String(convCliente.tarifaBaseId ?? '').trim();
    if (!tarifaCliente) return;

    if (!(formData.proveedorUnidad || searchProvTransporte)) return;

    const convProvMatch = listaConveniosProveedor.find(
      (c: any) => String(c.tarifaBaseId ?? '').trim() === tarifaCliente
    );

    if (convProvMatch) {
      setFormData(prev => ({
        ...prev,
        convenioProveedor: convProvMatch.id,
        monedaConvenioProv: convProvMatch.monedaBase,
        totalAPagarProv: convProvMatch.tarifaMonto,
      }));
      setSearchConvenioProveedor(convProvMatch.tipoConvenioNombre);
    }
  });
  useEffect(() => sugerirConvenioProveedor(), [pestanasVisibles, formData.convenio, formData.convenioProveedor, formData.proveedorUnidad, searchProvTransporte, listaConveniosCliente, listaConveniosProveedor]);

  const resolverNombreTrafico = useCallback(async (movRaw: any): Promise<string> => {
    const valor = String(movRaw || '').trim();
    if (!valor) return 'N/A';

    if (traficoCache.has(valor)) return traficoCache.get(valor)!;

    const enMemoria = catalogoTrafico.find((t: any) => String(t.id) === valor);
    if (enMemoria) {
      const nombre = enMemoria.nombre || valor;
      traficoCache.set(valor, nombre);
      return nombre;
    }

    try {
      const snap = await getDoc(doc(db, 'catalogo_trafico', valor));
      if (snap.exists()) {
        const nombre = snap.data().nombre || valor;
        traficoCache.set(valor, nombre);
        return nombre;
      }
    } catch { /* noop */ }

    traficoCache.set(valor, valor);
    return valor;
  }, [catalogoTrafico]);

  // ✅ V00406: TROMPO → el Sueldo Operador es $0 (si hace falta un monto, va en
  //   Costos Adicionales). Solo se aplica solo en operaciones NUEVAS o al cambiar
  //   el convenio; las operaciones viejas con sueldo se corrigen con el botón
  //   "Actualizar sueldo" para que no cambien sin querer.
  const esTrompoOp = (() => {
    const conv = listaConveniosCliente.find((c: { id?: unknown }) => String(c.id) === String(formData.convenio)) as { descripcion?: unknown; nombre?: unknown } | undefined;
    const txt = `${String(formData.carga || '')} ${String(conv?.descripcion || conv?.nombre || '')}`;
    return txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('trompo');
  })();
  // ✅ V00434: TROMPO de ROELCA (Cliente Paga = Roelca) = NO COBRABLE → el
  //   monto de cobro es $0 (el resumen diario lo pone en "Otros no cobrables").
  const esClientePagaRoelca = (() => {
    const emp = (empresas || []).find((e: { id?: unknown }) => String(e.id) === String(formData.clientePaga || '')) as { nombre?: unknown; razonSocial?: unknown; nombreCorto?: unknown } | undefined;
    const txt = `${searchClientePaga || ''} ${String(emp?.nombre || '')} ${String(emp?.razonSocial || '')} ${String(emp?.nombreCorto || '')}`;
    return txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('roelca');
  })();
  const trompoNoCobrable = esTrompoOp && esClientePagaRoelca;
  useEffect(() => {
    if (!trompoNoCobrable) return;
    if (Number(formData.montoConvenioCliente) !== 0) setFormData(prev => ({ ...prev, montoConvenioCliente: 0 }));
  }, [trompoNoCobrable, formData.montoConvenioCliente]);
  const sueldoManualForm = (formData as { sueldoManual?: unknown }).sueldoManual === true; // ✅ V00433
  useEffect(() => {
    if (initialData || !esTrompoOp) return;
    if (sueldoManualForm) return; // ✅ V00433: cambio manual con motivo
    if (Number(formData.sueldoOperador) !== 0) setFormData(prev => ({ ...prev, sueldoOperador: 0, sueldoMitadAplicada: false }));
  }, [esTrompoOp, formData.sueldoOperador, initialData, sueldoManualForm]);

  // ✅ V00387: con el estatus en FALSO el Sueldo Operador se muestra (y guarda) a la mitad
  useEffect(() => {
    if (!statusPreview) return;
    setFormData(prev => {
      const aj = ajusteSueldoPorStatus(prev as Record<string, unknown>, statusPreview);
      return Object.keys(aj).length ? { ...prev, ...aj } : prev;
    });
  }, [statusPreview, formData.sueldoOperador]);

  // ✅ V00386: al CAMBIAR el convenio (también en una operación ya guardada) o al
  //   pulsar "↻ Actualizar convenio", se traen TODOS los datos ligados a él:
  //   monto y moneda, sueldo del operador, combustible, tipo de servicio,
  //   tráfico y carga. Los refs guardan para qué convenio ya se aplicó, así el
  //   usuario puede ajustar a mano después sin que se le sobrescriba.
  const convMontoAplicadoRef = useRef<string>(String(initialData?.convenio || ''));
  const convSueldoAplicadoRef = useRef<string>(String(initialData?.convenio || ''));
  const [refrescoConvenio, setRefrescoConvenio] = useState(0);
  useEffect(() => {
    convMontoAplicadoRef.current = String(initialData?.convenio || '');
    convSueldoAplicadoRef.current = String(initialData?.convenio || '');
  }, [initialData]);
  const valoresTarifaDeConvenio = (convId: string): { sueldo: number | null; combustible: number | null } => {
    const convCliente = listaConveniosCliente.find((c) => String(c.id) === String(convId));
    const tarifaBase = String(convCliente?.tarifaBaseId ?? '').trim();
    if (!tarifaBase) return { sueldo: null, combustible: null };
    const filaSueldo = gastosIncluidosLocal.find((g) => {
      const ref = String(
        g.tarifa_referencia_id ?? g.tarifaReferenciaId ?? g.tarifa_referencia ?? g.tarifaReferencia ??
        g.ID_SERVICES ?? g.id_services ?? g.idServices ?? g.tarifaId ?? ''
      ).trim();
      const gastoId = String(g.gasto ?? g.gastoId ?? g.gasto_id ?? '').trim();
      return ref === tarifaBase && gastoId === ID_GASTO_SUELDO;
    });
    const sueldo = filaSueldo ? Number(filaSueldo.monto ?? filaSueldo.importe ?? filaSueldo.cantidad ?? filaSueldo.valor ?? 0) : null;
    const filaRend = rendimientoLocal.find((r) => {
      const ref = String(r.ID_SERVICES ?? r.id_services ?? r.idServices ?? r.tarifa_referencia_id ?? r.tarifaId ?? '').trim();
      return ref === tarifaBase;
    });
    const combustible = filaRend ? Number(filaRend.Quantity ?? filaRend.quantity ?? filaRend.QUANTITY ?? filaRend.cantidad ?? 0) : null;
    return {
      sueldo: sueldo !== null && !isNaN(sueldo) ? sueldo : null,
      combustible: combustible !== null && !isNaN(combustible) ? Math.round(combustible) : null,
    };
  };

  useEffect(() => {
    const resolverFlujo = async () => {
      if (!formData.convenio) return;
      try {
        const detalleElegido = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
        if (!detalleElegido) return;
        // ✅ V00313: si en el modal se eligió una tarifa alterna (A/B) de ESTE
        //   convenio, se respeta; si no, manda el monto vigente del detalle.
        const alt = montoAltCliRef.current;
        const montoUsar = alt && alt.id === String(detalleElegido.id) && (detalleElegido.montosAlt || []).includes(alt.monto) ? alt.monto : detalleElegido.tarifaMonto;
        setFormData(prev => ({ ...prev, monedaConvenioCliente: detalleElegido.monedaMaestro, montoConvenioCliente: montoUsar }));
        const tarifaObj = tarifas?.find((t: any) => t.id === detalleElegido.tarifaBaseId);
        if (!tarifaObj) return;
        const tipoOpId = String(tarifaObj.tipo_operacion);
        let tipoData = tipoTarifarioCache.get(tipoOpId);
        if (!tipoData) {
          const tipoRef = doc(db, 'catalogo_tipos_tarifarios', tipoOpId);
          const tipoSnap = await getDoc(tipoRef);
          if (tipoSnap.exists()) { tipoData = tipoSnap.data(); tipoTarifarioCache.set(tipoOpId, tipoData); }
        }
        if (tipoData) {
          const nombreTrafico = await resolverNombreTrafico(tipoData.movimiento);
          const nombreCarga = await resolverNombreCarga(tarifaObj.estado_carga); // ✅ V00258
          setFormData(prev => ({
            ...prev,
            tipoServicio: tipoData.descripcion || 'N/A',
            trafico: nombreTrafico,
            carga: nombreCarga
          }));
        }
      } catch (error) { console.error('Error resolviendo flujo:', error); }
    };
    if (!initialData) { resolverFlujo(); return; }
    // ✅ V00386: operación YA GUARDADA — si el convenio cambió (o se pidió
    //   actualizar), se traen monto, moneda, servicio, tráfico y carga.
    const conv = String(formData.convenio || '');
    if (!conv || conv === convMontoAplicadoRef.current) return;
    if (!listaConveniosCliente.some((c) => String(c.id) === conv)) return; // lista aún cargando
    convMontoAplicadoRef.current = conv;
    resolverFlujo();
  }, [formData.convenio, listaConveniosCliente, tarifas, initialData, resolverNombreTrafico, refrescoConvenio]);

  const derivarDatosDelConvenio = useEffectEvent(() => {
    if (!initialData) return;
    if (!formData.convenio) return;

    // ✅ Si el usuario CAMBIÓ el convenio respecto al que traía la operación,
    //   tráfico / carga / tipo de servicio se RE-DERIVAN y sobrescriben (antes
    //   solo se rellenaban cuando venían vacíos, y al cambiar el convenio se
    //   quedaban los valores del convenio anterior). Si el convenio no cambió,
    //   se conserva el comportamiento de solo completar faltantes.
    const convenioCambiado = String(formData.convenio) !== String(initialData.convenio || '');

    const traficoOk = formData.trafico && formData.trafico !== 'N/A';
    const cargaOk = formData.carga && formData.carga !== 'N/A';
    if (!convenioCambiado && traficoOk && cargaOk) return;

    let cancelado = false;
    (async () => {
      const detalle = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
      if (!detalle) return;
      const tarifaObj = tarifas?.find((t: any) => String(t.id) === String(detalle.tarifaBaseId));
      if (!tarifaObj) return;

      const tipoOpId = String(tarifaObj.tipo_operacion);
      let tipoData = tipoTarifarioCache.get(tipoOpId);
      if (!tipoData) {
        try {
          const tipoSnap = await getDoc(doc(db, 'catalogo_tipos_tarifarios', tipoOpId));
          if (tipoSnap.exists()) { tipoData = tipoSnap.data(); tipoTarifarioCache.set(tipoOpId, tipoData); }
        } catch { /* noop */ }
      }
      if (cancelado || !tipoData) return;

      const nombreTrafico = await resolverNombreTrafico(tipoData.movimiento);
      const nombreCargaConvenio = await resolverNombreCarga(tarifaObj.estado_carga); // ✅ V00258
      if (cancelado) return;

      setFormData(prev => {
        const nuevoTipo = convenioCambiado
          ? (tipoData.descripcion || 'N/A')
          : (prev.tipoServicio || tipoData.descripcion || 'N/A');
        const nuevoTrafico = convenioCambiado
          ? nombreTrafico
          : ((prev.trafico && prev.trafico !== 'N/A') ? prev.trafico : nombreTrafico);
        const nuevaCarga = convenioCambiado
          ? nombreCargaConvenio
          : ((prev.carga && prev.carga !== 'N/A') ? prev.carga : nombreCargaConvenio); // ✅ V00258
        // Guard anti-bucle: si nada cambia, no se dispara otro render.
        if (prev.tipoServicio === nuevoTipo && prev.trafico === nuevoTrafico && prev.carga === nuevaCarga) return prev;
        return { ...prev, tipoServicio: nuevoTipo, trafico: nuevoTrafico, carga: nuevaCarga };
      });
    })();

    return () => { cancelado = true; };
  });
  useEffect(() => derivarDatosDelConvenio(), [initialData, formData.convenio, formData.trafico, formData.carga, listaConveniosCliente, tarifas, resolverNombreTrafico]);

  useEffect(() => {
    if (!formData.convenio) return;
    // ✅ V00386: en una operación guardada solo cuando el convenio cambió
    //   (o se pulsó "↻ Actualizar convenio"); una vez por convenio.
    if (initialData && String(formData.convenio) === convSueldoAplicadoRef.current) return;

    const convCliente = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
    if (!convCliente) return;
    const tarifaBase = String(convCliente.tarifaBaseId ?? '').trim();
    if (!tarifaBase) return;
    if (initialData && (gastosIncluidosLocal.length === 0 || rendimientoLocal.length === 0)) return; // catálogos aún cargando

    const filaSueldo = gastosIncluidosLocal.find((g: any) => {
      const ref = String(
        g.tarifa_referencia_id ?? g.tarifaReferenciaId ?? g.tarifa_referencia ?? g.tarifaReferencia ??
        g.ID_SERVICES ?? g.id_services ?? g.idServices ?? g.tarifaId ?? ''
      ).trim();
      const gastoId = String(g.gasto ?? g.gastoId ?? g.gasto_id ?? '').trim();
      return ref === tarifaBase && gastoId === ID_GASTO_SUELDO;
    });
    const sueldo = filaSueldo ? Number(filaSueldo.monto ?? filaSueldo.importe ?? filaSueldo.cantidad ?? filaSueldo.valor ?? 0) : null;

    const filaRend = rendimientoLocal.find((r: any) => {
      const ref = String(r.ID_SERVICES ?? r.id_services ?? r.idServices ?? r.tarifa_referencia_id ?? r.tarifaId ?? '').trim();
      return ref === tarifaBase;
    });
    const combustible = filaRend ? Number(filaRend.Quantity ?? filaRend.quantity ?? filaRend.QUANTITY ?? filaRend.cantidad ?? 0) : null;

    if (initialData) convSueldoAplicadoRef.current = String(formData.convenio);
    if ((sueldo === null || isNaN(sueldo)) && (combustible === null || isNaN(combustible))) return;

    setFormData(prev => ({
      ...prev,
      ...(sueldo !== null && !isNaN(sueldo) && (prev as { sueldoManual?: unknown }).sueldoManual !== true ? { sueldoOperador: esTrompoOp ? 0 : sueldo, sueldoMitadAplicada: false } : {}), // ✅ V00387 · V00406: trompo = $0 · V00433: respeta el cambio manual con motivo
      ...(combustible !== null && !isNaN(combustible) ? { combustible: Math.round(combustible) } : {}),
    }));
  }, [formData.convenio, listaConveniosCliente, gastosIncluidosLocal, rendimientoLocal, initialData, refrescoConvenio, esTrompoOp]);

  // ✅ Desglose Dólares/Pesos/Conversión considerando la MONEDA DEL CONVENIO y
  //   la MONEDA DE LA FACTURA (pueden ser distintas):
  //   - Convenio USD + Factura USD: Dólares = monto; Conversión = monto × TC.
  //   - Convenio USD + Factura MXN: se CONVIERTE → Pesos = monto × TC y
  //     Conversión = monto × TC (el monto en dólares NUNCA va en pesos directo).
  //   - Convenio MXN + Factura MXN: Pesos = monto; Conversión = monto directo.
  //   - Convenio MXN + Factura USD: Dólares = monto ÷ TC; Conversión = monto (ya es MXN).
  //   Si la moneda del convenio no se identifica, se usa la de la factura (regla anterior).
  // ✅ V00439 (Fase 3.6): moneda con la regla compartida (monedaCanonica: ID, código o
  //   nombre) y, si es otro ID del catálogo de Monedas, por el nombre de ese registro.
  const monedaDe = (v: unknown) => monedaCanonica(v) ?? monedaCanonica(listaMonedasLocal.find((m: { id?: unknown }) => String(m.id) === String(v ?? ''))?.moneda);
  const esMonedaUSD = (v: unknown) => monedaDe(v) === 'USD';
  const esMonedaMXN = (v: unknown) => monedaDe(v) === 'MXN';
  const desglosarPorMonedas = (subtotal: number, tc: number, monConvenio: any, monFactura: any) => {
    let dol = 0, pes = 0, conv = 0;
    const convUSD = esMonedaUSD(monConvenio), convMXN = esMonedaMXN(monConvenio);
    const factUSD = esMonedaUSD(monFactura), factMXN = esMonedaMXN(monFactura);
    const cUSD = convUSD || (!convMXN && factUSD);
    const cMXN = convMXN || (!convUSD && factMXN);
    if (cUSD && factMXN) { dol = 0; pes = subtotal * tc; conv = subtotal * tc; }
    else if (cUSD) { dol = subtotal; pes = 0; conv = subtotal * tc; }
    else if (cMXN && factUSD) { dol = tc > 0 ? subtotal / tc : 0; pes = 0; conv = subtotal; }
    else if (cMXN) { dol = 0; pes = subtotal; conv = subtotal; }
    return { dol, pes, conv };
  };

  // ✅ V00126: MONTO DEL CONVENIO EXPRESADO EN LA MONEDA DE LA FACTURA.
  //   - Convenio USD + Factura MXN → monto × TC
  //   - Convenio MXN + Factura USD → monto ÷ TC
  //   - Misma moneda (o no identificada) → monto sin cambios
  //   Sin redondeo: el valor se guarda y muestra tal cual resulta de la operación.
  const convertirAMonedaFactura = (monto: number, tc: number, monConvenio: any, monFactura: any): { monto: number; convertido: boolean; sinTC: boolean } => {
    const m = Number(monto) || 0;
    const convUSD = esMonedaUSD(monConvenio), convMXN = esMonedaMXN(monConvenio);
    const factUSD = esMonedaUSD(monFactura), factMXN = esMonedaMXN(monFactura);
    // ✅ V00388: el monto convertido se muestra a 2 decimales (antes 2567,9500000000003)
    const dos = (v: number) => Math.round(v * 100) / 100;
    if (convUSD && factMXN) return { monto: tc > 0 ? dos(m * tc) : 0, convertido: true, sinTC: !(tc > 0) };
    if (convMXN && factUSD) return { monto: tc > 0 ? dos(m / tc) : 0, convertido: true, sinTC: !(tc > 0) };
    return { monto: m, convertido: false, sinTC: false };
  };

  const recalcularConversionProveedor = useEffectEvent(() => {
    const tc = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0; 
    const subtotal = Number(formData.totalAPagarProv || 0) + Number(formData.cargosAdicionalesProv || 0);
    // ✅ CORREGIDO: si la moneda del convenio del PROVEEDOR quedó VACÍA, se toma
    //   la del convenio elegido y, en último término, USD (igual que el lado del
    //   cliente). Antes, con la moneda vacía y el pago facturado en Pesos, el
    //   desglose caía al caso "pesos" y NO multiplicaba por el TC: "Pesos (Prov)"
    //   y "Conversión (MXN)" quedaban con el monto en dólares sin convertir.
    let monConvProv: any = formData.monedaConvenioProv;
    if (!monConvProv) {
      const detConvProv = listaConveniosProveedor.find((c: any) => String(c.id) === String(formData.convenioProveedor || ''));
      monConvProv = detConvProv?.monedaBase || ID_USD;
    }
    // ✅ V00126: el monto del convenio se convierte a la moneda de la factura ANTES de sumar cargos.
    const montoFactProv = convertirAMonedaFactura(Number(formData.totalAPagarProv || 0), tc, monConvProv, formData.facturadoEnUnidad).monto;
    // ✅ V00243: mismo criterio para el cargo adicional del proveedor.
    const cargosFactProv = r2(convertirAMonedaFactura(Number(formData.cargosAdicionalesProv || 0), tc, monConvProv, formData.facturadoEnUnidad).monto);
    const subtotalFact = r2(r2(montoFactProv) + cargosFactProv); // ✅ V00244
    const monFactProv = formData.facturadoEnUnidad || monConvProv;
    const { dol, pes, conv } = desglosarPorMonedas(subtotalFact, tc, monFactProv, monFactProv);
    void subtotal;
    setFormData(prev => ({ ...prev, subtotalProv: subtotalFact, dolaresProv: r2(dol), pesosProv: r2(pes), conversionProv: r2(conv) })); // ✅ V00244
  });
  useEffect(() => recalcularConversionProveedor(), [formData.facturadoEnUnidad, formData.monedaConvenioProv, formData.totalAPagarProv, formData.cargosAdicionalesProv, tipoCambioDia, formData.tipoCambioAprobado, formData.convenioProveedor, listaConveniosProveedor, listaMonedasLocal]);

  const recalcularConversionCliente = useEffectEvent(() => {
    const tc = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0; 
    const subtotal = Number(formData.montoConvenioCliente || 0) + Number(formData.cargosAdicionales || 0);
    // ✅ CORREGIDO: si la moneda del convenio quedó VACÍA (el detalle no se pudo
    //   cargar al capturar), se toma la del convenio elegido y, en último término,
    //   USD (el estándar de los convenios). Antes, con la moneda vacía y la
    //   facturación en Pesos, el desglose caía al caso "pesos" y NO multiplicaba
    //   por el TC: "Pesos (Cliente)" y "Conversión Cliente (MXN)" quedaban con el
    //   monto en dólares sin convertir.
    let monConvCli: any = formData.monedaConvenioCliente;
    if (!monConvCli) {
      const detConv = listaConveniosCliente.find((c: any) => String(c.id) === String(formData.convenio || ''));
      monConvCli = detConv?.monedaMaestro || ID_USD;
    }
    // ✅ V00126: el monto del convenio se convierte a la moneda de la factura ANTES de sumar cargos
    //   (Convenio USD facturado en Pesos → 120 × TC, sin redondear).
    const montoFactCli = convertirAMonedaFactura(Number(formData.montoConvenioCliente || 0), tc, monConvCli, formData.facturadoEnCobrar).monto;
    // ✅ V00243: el CARGO ADICIONAL se captura en la moneda del convenio, así
    //   que también se convierte a la moneda de la factura (convenio USD +
    //   factura en Pesos → cargo × TC) antes de sumarlo al total.
    const cargosFactCli = r2(convertirAMonedaFactura(Number(formData.cargosAdicionales || 0), tc, monConvCli, formData.facturadoEnCobrar).monto);
    const subtotalFact = r2(r2(montoFactCli) + cargosFactCli); // ✅ V00244
    const monFactCli = formData.facturadoEnCobrar || monConvCli;
    const { dol, pes, conv } = desglosarPorMonedas(subtotalFact, tc, monFactCli, monFactCli);
    void subtotal;
    const utilidad = r2(r2(conv) - Number(formData.conversionProv || 0)); // ✅ V00244
    setFormData(prev => ({ ...prev, subtotalCliente: subtotalFact, dolaresCliente: r2(dol), pesosCliente: r2(pes), conversionCliente: r2(conv), utilidadEstimada: utilidad })); // ✅ V00244
  });
  useEffect(() => recalcularConversionCliente(), [formData.facturadoEnCobrar, formData.monedaConvenioCliente, formData.montoConvenioCliente, formData.cargosAdicionales, tipoCambioDia, formData.conversionProv, formData.tipoCambioAprobado, formData.convenio, listaConveniosCliente, listaMonedasLocal]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'fechaServicio') { fechaServicioTocada.current = true; tcEditadoAMano.current = false; } // ✅ V00461 · V00462
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // ✅ V00451: cada documento guarda su LISTA de archivos nuevos (AdjuntosArchivos). Un Entry sin
  //   archivos queda en null, así la revisión de obligatorios lo sigue viendo vacío.
  const handleAdjuntosChange = (field: 'pdfCartaPorte' | 'pdfDoda' | 'pdfManifiesto', lista: Adjunto[]) => {
    setFormData(prev => ({ ...prev, [field]: lista }));
  };
  const handleAdjuntosEntry = (index: number, lista: Adjunto[]) => {
    setFormData(prev => {
      const arr = [...(prev.pdfsEntrys || [])];
      arr[index] = lista.length > 0 ? lista : null;
      return { ...prev, pdfsEntrys: arr };
    });
  };

  // ✅ Helper: los campos de tipos pueden venir como arreglo de IDs o como texto.
  const contieneId = (campo: any, id: string): boolean => {
    if (!campo) return false;
    if (Array.isArray(campo)) return campo.map((x: any) => String(x)).includes(id);
    return String(campo).includes(id);
  };
  // ✅ Los filtros aceptan el ID del catálogo O el nombre del tipo, porque en la
  //   base conviven registros guardados en ambos formatos. Así, un cliente de
  //   mercancía recién creado desde este formulario aparece de inmediato.
  // ✅ V00126: en Cliente (Paga) solo se listan las empresas que TIENEN convenio
  //   (se conserva siempre la del registro que se está editando).
  // ✅ V00212: en Operaciones SOLO se pueden elegir clientes con TARIFARIO
  //   APROBADO (los convenios ya viven como tarifarios tras la migración).
  //   Se conserva el ya guardado en la operación para no romper ediciones.
  const idsClientesConConvenio = useMemo(() => {
    const set = new Set<string>();
    // Tarifarios APROBADOS.
    (tarifariosLocal || []).forEach((t: any) => {
      if (String(t.status || '').trim() !== 'Aprobado') return;
      const id = String(t.clienteId ?? '').trim();
      if (id) set.add(id);
    });
    // ✅ V00218: y también los que tengan al menos un DETALLE de convenio
    //   ACTIVO (status distinto de Inactivo/Cancelado).
    (catalogoConvDetalles || []).forEach((d: any) => {
      const st = String(d.status || 'Aprobado').trim();
      if (st === 'Inactivo' || st === 'Cancelado') return;
      const id = ownerClienteDetalle(d);
      if (id) set.add(id);
    });
    return set;
  }, [tarifariosLocal, catalogoConvDetalles]);
  // ✅ V00252: NOMBRES de clientes con tarifario aprobado — respaldo para
  //   cuando el clienteId guardado en el tarifario no coincide con el doc de
  //   empresas (datos migrados o recreados).
  const nombresClientesConTarifario = useMemo(() => {
    const set = new Set<string>();
    (tarifariosLocal || []).forEach((t: { status?: unknown; clienteNombre?: unknown }) => {
      if (String(t.status || '').trim() !== 'Aprobado') return;
      const n = String(t.clienteNombre ?? '').trim().toLowerCase();
      if (n) set.add(n);
    });
    return set;
  }, [tarifariosLocal]);
  // ✅ V00252: REGLA — todo cliente agregado en su tarifario (o con detalle de
  //   convenio activo) aparece en la operación, tenga o no marcado el tipo
  //   "Cliente (Paga)" en Empresas. Antes se exigían AMBAS cosas y clientes
  //   con tarifario aprobado (p. ej. Transportes Roal) no salían.
  const filClientesPaga = useMemo(() => empresas?.filter((e:any) =>
    idsClientesConConvenio.has(String(e.id)) ||
    nombresClientesConTarifario.has(String(e.nombre || '').trim().toLowerCase()) ||
    String(e.id) === String(initialData?.clientePaga || '')
  ) || [], [empresas, idsClientesConConvenio, nombresClientesConTarifario, initialData?.clientePaga]);
  const filClientesMercancia = useMemo(() => empresas?.filter((e:any) => (contieneId(e.tiposEmpresa, '51246232') || contieneId(e.tiposEmpresa, TIPO_EMP_CLIENTE_MERCANCIA)) && e.status === 'Activa') || [], [empresas]);
  // ✅ Solo empresas con tiposEmpresa 11894dfd (o su nombre) Y tiposServicio 42afffd3 o 7e70a3f7.
  const filProveedoresServicios = useMemo(() => empresas?.filter((e:any) =>
    (contieneId(e.tiposEmpresa, TIPO_EMPRESA.proveedorServicios) || contieneId(e.tiposEmpresa, TIPO_EMP_PROV_SERVICIOS)) &&
    TIPOS_SERVICIO_PROV_MANIFIESTO.some(idServ => contieneId(e.tiposServicio, idServ))
  ) || [], [empresas]);
  // ✅ Costo del manifiesto automático según el tipo de servicio del proveedor:
  //   42afffd3 -> costo por defecto ($8.52); cualquier otro -> 0.
  const montoManifiestoDeProveedor = (emp: any): number =>
    contieneId(emp?.tiposServicio, TIPO_SERVICIO_CON_COSTO_MANIFIESTO) ? COSTO_MANIFIESTO_DEFAULT : 0;
  const filOrigenesDestinos = useMemo(() => empresas?.filter((e:any) => (contieneId(e.tiposEmpresa, TIPO_EMPRESA.bodega) || contieneId(e.tiposEmpresa, TIPO_EMP_ORIGEN_DESTINO)) && e.status === 'Activa') || [], [empresas]);

  // ✅ Catálogo de DIRECCIONES por id (las empresas guardan direccionId).
  // ✅ V00439 (Fase 3.6): sale del catálogo compartido (antes getDocs al abrir el formulario).
  const mapaDirecciones = useMemo(() => {
    const m: Record<string, FilaCatalogo> = {};
    cat.direcciones.forEach((d) => { m[idReal(d)] = d; });
    return m;
  }, [cat.direcciones]);

  const direccionDeEmpresaOD = (e: any) => mapaDirecciones[String(e?.direccionId || '')] || null;
  const direccionFormateadaOD = (e: any) => formatearDireccionPorPais(direccionDeEmpresaOD(e), e?.direccion || e?.direccionLabel || '');
  const paisDeEmpresaOD = (e: any) => paisDeDireccion(direccionDeEmpresaOD(e), e?.direccion || e?.direccionLabel || '');
  // ✅ V00214: municipio guardado en el catálogo de Direcciones (solo lectura).
  const municipioDeEmpresaOD = (id: unknown): string => {
    const emp = (empresas || []).find((e: any) => String(e.id) === String(id || ''));
    if (!emp) return '';
    const dir = direccionDeEmpresaOD(emp);
    return String(dir?.municipioNombre || dir?.municipio || dir?.ciudad || dir?.city || '');
  };
  // ✅ V00126: en Proveedor de Transporte solo se listan los que TIENEN convenio
  //   (se conserva siempre el del registro que se está editando y la flota propia forzada).
  // ✅ V00212: mismo criterio para proveedores — tarifario APROBADO.
  const idsProveedoresConConvenio = useMemo(() => {
    const set = new Set<string>();
    (tarifariosProvLocal || []).forEach((t: any) => {
      if (String(t.status || '').trim() !== 'Aprobado') return;
      const id = String(t.proveedorId ?? '').trim();
      if (id) set.add(id);
    });
    // ✅ V00218: y los que tengan al menos un DETALLE de convenio ACTIVO.
    (catalogoConvProvDetalles || []).forEach((d: any) => {
      const st = String(d.status || 'Aprobado').trim();
      if (st === 'Inactivo' || st === 'Cancelado') return;
      const id = ownerProvDetalle(d);
      if (id) set.add(id);
    });
    return set;
  }, [tarifariosProvLocal, catalogoConvProvDetalles]);


  // ✅ V00252: misma regla del lado proveedor — todo proveedor agregado en su
  //   tarifario (o con detalle activo) aparece en la operación, tenga o no el
  //   tipo "Proveedor (Transporte)" o status Activa en Empresas. Respaldo por
  //   nombre para tarifarios cuyo proveedorId no coincida con Empresas.
  const nombresProveedoresConTarifario = useMemo(() => {
    const set = new Set<string>();
    (tarifariosProvLocal || []).forEach((t: { status?: unknown; proveedorNombre?: unknown }) => {
      if (String(t.status || '').trim() !== 'Aprobado') return;
      const n = String(t.proveedorNombre ?? '').trim().toLowerCase();
      if (n) set.add(n);
    });
    return set;
  }, [tarifariosProvLocal]);
  const filProveedoresTransporte = useMemo(() => empresas?.filter((e:any) =>
    idsProveedoresConConvenio.has(String(e.id)) ||
    nombresProveedoresConTarifario.has(String(e.nombre || '').trim().toLowerCase()) ||
    String(e.id) === String(initialData?.proveedorUnidad || '') || String(e.id) === String(formData.proveedorUnidad || '')
  ) || [], [empresas, idsProveedoresConConvenio, nombresProveedoresConTarifario, initialData?.proveedorUnidad, formData.proveedorUnidad]);

  const sOrigen = (searchOrigen || '').toLowerCase();
  const sDestino = (searchDestino || '').toLowerCase();
  const sClientePaga = (searchClientePaga || '').toLowerCase();
  const sRemolque = (searchRemolque || '').toLowerCase();
  const sClienteMerc = (searchClienteMercancia || '').toLowerCase();
  const sProvServicios = (searchProvServicios || '').toLowerCase();
  const sProvTransp = (searchProvTransporte || '').toLowerCase();
  const sUnidad = (searchUnidad || '').toLowerCase();
  const sOperador = (searchOperador || '').toLowerCase();
  const sUnidadProv = (searchUnidadProveedor || '').toLowerCase();
  const sOperadorProv = (searchOperadorProveedor || '').toLowerCase();

  const empresaCoincide = (e:any, q:string) =>
    nombreEmpresaMostrar(e).toLowerCase().includes(q) || (e.nombre || '').toLowerCase().includes(q) || String(e.razonSocial || '').toLowerCase().includes(q); // ✅ V00389

  // ✅ RESTAURADO (regla AppSheet): Origen y Destino se filtran por PAÍS según
  //   el tráfico y el tipo de operación, replicando el IFS(...) original:
  //   · Tipos 8ec24dfe / 24da3608:
  //       Exportación → Origen: México          / Destino: Estados Unidos.
  //       Importación → Origen: Estados Unidos  / Destino: México.
  //       Movimiento  → sin filtro (todas).
  //   · Tipo 3e5b0035 → sin filtro (todas).
  //   · Cualquier tipo con TrompoExpo=true (en Exportación) o TrompoImpo=true
  //     (en Importación) aplica la misma regla por país.
  //   · Si ninguna regla aplica (p. ej. aún no se elige tráfico/tipo), se
  //     muestran todas para no dejar el buscador vacío. Los resultados se
  //     ordenan alfabéticamente por nombre (ORDERBY(..., [nombre]) de AppSheet).
  const paisRequeridoOD = useMemo((): { origen: 'USA' | 'MX' | ''; destino: 'USA' | 'MX' | '' } => {
    const tipoId = String(formData.tipoOperacionId || '');
    const tipoOp: any = tiposOperacion?.find((op: any) => String(op.id) === tipoId) || {};
    const trompoExpo = esTrueAppSheet(tipoOp.TrompoExpo ?? tipoOp.trompoExpo ?? tipoOp.trompo_expo);
    const trompoImpo = esTrueAppSheet(tipoOp.TrompoImpo ?? tipoOp.trompoImpo ?? tipoOp.trompo_impo);
    const traf = normalizarTxtDir(formData.trafico);
    const esExpo = traf.includes('expo');
    const esImpo = traf.includes('impo');
    if (TIPOS_OP_FILTRO_PAIS.includes(tipoId)) {
      if (esExpo) return { origen: 'MX', destino: 'USA' };
      if (esImpo) return { origen: 'USA', destino: 'MX' };
      return { origen: '', destino: '' }; // Movimiento u otro tráfico → todas
    }
    if (tipoId === TIPO_OP_SIN_FILTRO_PAIS) return { origen: '', destino: '' };
    if (esExpo && trompoExpo) return { origen: 'MX', destino: 'USA' };
    if (esImpo && trompoImpo) return { origen: 'USA', destino: 'MX' };
    return { origen: '', destino: '' };
  }, [formData.tipoOperacionId, formData.trafico, tiposOperacion]);

  const coincideOD = (e: any, q: string) =>
    empresaCoincide(e, q) || (e.direccion || '').toLowerCase().includes(q) || direccionFormateadaOD(e).toLowerCase().includes(q);
  const filtraPorPaisOD = (lista: any[], pais: 'USA' | 'MX' | '') =>
    pais ? lista.filter((e: any) => paisDeEmpresaOD(e) === pais) : lista;
  const ordenaPorNombreOD = (lista: any[]) =>
    [...lista].sort((a: any, b: any) => nombreEmpresaMostrar(a).localeCompare(nombreEmpresaMostrar(b), 'es', { sensitivity: 'base' }));
  const resultadosOrigen = ordenaPorNombreOD(filtraPorPaisOD(filOrigenesDestinos.filter((e:any) => coincideOD(e, sOrigen)), paisRequeridoOD.origen));
  const resultadosDestino = ordenaPorNombreOD(filtraPorPaisOD(filOrigenesDestinos.filter((e:any) => coincideOD(e, sDestino)), paisRequeridoOD.destino));
  // ✅ V00314: en Cliente (Paga) SOLO se ofrecen clientes con registros en el
  //   Tarifario de Clientes (así no salen empresas duplicadas sin tarifario).
  const clientesConTarifario = useMemo(() => {
    const setIds = new Set<string>();
    (tarifariosLocal || []).forEach((t: { clienteId?: unknown }) => { const cid = String(t.clienteId || '').trim(); if (cid) setIds.add(cid); });
    return setIds;
  }, [tarifariosLocal]);
  const resultadosClientePaga = filClientesPaga.filter((e:any) => {
    if (!empresaCoincide(e, sClientePaga)) return false;
    if (String(e.id) === String(initialData?.clientePaga || '')) return true; // el guardado siempre se ofrece
    if (clientesConTarifario.has(String(e.id))) return true; // tiene registros en el tarifario
    // Respaldo legacy (tarifarios que referencian por NOMBRE): solo si NINGUNA
    // empresa homónima tiene el tarifario por id — así no salen duplicadas.
    const nom = String(e.nombre || '').trim().toLowerCase();
    const homonimaConTarifario = filClientesPaga.some((o: { id?: unknown; nombre?: unknown }) => String(o.id) !== String(e.id) && String(o.nombre || '').trim().toLowerCase() === nom && clientesConTarifario.has(String(o.id)));
    return !homonimaConTarifario;
  });
  const resultadosRemolque = remolques?.filter((e:any) => `${e.nombre || ''} ${e.placas || e.placa || ''}`.toLowerCase().trim().includes(sRemolque)) || [];
  const resultadosClienteMercancia = filClientesMercancia.filter((e:any) => empresaCoincide(e, sClienteMerc));
  const resultadosProvServicios = filProveedoresServicios.filter((e:any) => empresaCoincide(e, sProvServicios));
  const resultadosProvTransporte = filProveedoresTransporte.filter((e:any) => empresaCoincide(e, sProvTransp));
  const resultadosUnidad = unidades?.filter((u:any) => (u.unidad || '').toLowerCase().includes(sUnidad)) || [];
  const resultadosOperador = listaEmpleadosLocal.filter((o:any) => `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim().toLowerCase().includes(sOperador));
  const resultadosUnidadProveedor = listaUniProvLocal.filter((u:any) => String(u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || '').toLowerCase().includes(sUnidadProv));
  const resultadosOperadorProveedor = listaOpeProvLocal.filter((o:any) => String(o.nombre || o.nombres || o.nombreCompleto || '').toLowerCase().includes(sOperadorProv));
  // ✅ V00214: en la operación se ofrece UN convenio por concepto. Si ese
  //   concepto tiene varias tarifas (mismo servicio, montos distintos), la
  //   tarifa se elige en un modal.
  const [modalTarifas, setModalTarifas] = useState<{ tipo: 'cliente' | 'proveedor'; nombre: string; opciones: any[] } | null>(null);
  // ✅ V00244: los importes se redondean a 2 decimales — el punto flotante
  //   dejaba colas como 2630,6910000000003.
  const r2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

  // ✅ V00242: trae el MONTO VIGENTE del convenio elegido (por si cambió en
  //   Convenio de Clientes/Proveedores después de capturar la operación).
  const actualizarMontoConvenio = (lado: 'cliente' | 'proveedor') => {
    if (lado === 'cliente') {
      const c = listaConveniosCliente.find((x: any) => String(x.id) === String(formData.convenio || ''));
      if (!c) { alert('Elige primero el convenio del cliente.'); return; }
      // ✅ V00386: trae TODO lo ligado al convenio (no solo el monto)
      const nuevo = Number(c.tarifaMonto) || 0;
      const actual = Number(formData.montoConvenioCliente) || 0;
      const v0 = valoresTarifaDeConvenio(String(c.id));
      const v = { ...v0, sueldo: v0.sueldo !== null && esTrompoOp ? 0 : v0.sueldo }; // ✅ V00406: trompo = $0
      const cambios: string[] = [];
      if (nuevo !== actual) cambios.push(`Monto: ${fmtMoney(actual)} → ${fmtMoney(nuevo)}`);
      if (v.sueldo !== null && v.sueldo !== (Number(formData.sueldoOperador) || 0)) cambios.push(`Sueldo del operador: ${fmtMoney(Number(formData.sueldoOperador) || 0)} → ${fmtMoney(v.sueldo)}`);
      if (v.combustible !== null && v.combustible !== Math.round(Number(formData.combustible) || 0)) cambios.push(`Combustible: ${Math.round(Number(formData.combustible) || 0)} → ${v.combustible}`);
      const resumen = cambios.length ? cambios.map((x) => `· ${x}`).join('\n') : '· Monto, sueldo y combustible ya están al día';
      if (!window.confirm(`Actualizar la operación con los datos vigentes del convenio?\n\n${resumen}\n· Tipo de servicio, tráfico y carga se vuelven a tomar del convenio\n\nLos totales y la facturación se recalculan solos.`)) return;
      montoAltCliRef.current = null; // ✅ V00313: traer el vigente deshace la tarifa alterna
      setFormData(prev => ({
        ...prev,
        montoConvenioCliente: nuevo,
        monedaConvenioCliente: c.monedaMaestro || prev.monedaConvenioCliente,
        ...(v.sueldo !== null ? { sueldoOperador: v.sueldo, sueldoMitadAplicada: false } : {}), // ✅ V00387
        ...(v.combustible !== null ? { combustible: v.combustible } : {}),
      }));
      // vuelve a derivar servicio / tráfico / carga del convenio
      convMontoAplicadoRef.current = '';
      convSueldoAplicadoRef.current = String(c.id); // sueldo y combustible ya se aplicaron arriba
      setRefrescoConvenio((n) => n + 1);
    } else {
      const c = listaConveniosProveedor.find((x: any) => String(x.id) === String(formData.convenioProveedor || ''));
      if (!c) { alert('Elige primero el convenio del proveedor.'); return; }
      const nuevo = Number(c.tarifaMonto) || 0;
      const actual = Number(formData.totalAPagarProv) || 0;
      if (nuevo === actual) { alert(`El monto ya está al día: ${fmtMoney(actual)}`); return; }
      if (!window.confirm(`Actualizar el monto del proveedor de ${fmtMoney(actual)} a ${fmtMoney(nuevo)}?`)) return;
      setFormData(prev => ({ ...prev, totalAPagarProv: nuevo, monedaConvenioProv: c.monedaBase || prev.monedaConvenioProv }));
    }
  };

  // ✅ V00224: editor de origen/destino de las tarifas (solo fletes + permiso).
  const [editorTarifaOD, setEditorTarifaOD] = useState(false);
  // ✅ V00271: retirado — el convenio se elige en el modal, ya no hay dropdown de búsqueda.
  const consecutivoDe = (c: any) => String(c?.consecutivo || (String(c?.id || '').startsWith('CONV-') ? c.id : '') || '').trim();

  // ✅ V00271: retirado — el convenio se elige en el modal, ya no hay dropdown de búsqueda.
  // ✅ V00271: retirado — el convenio se elige en el modal, ya no hay dropdown de búsqueda.

  const convClienteSel = listaConveniosCliente.find((c:any) => c.id === formData.convenio);
  const convProvSelObj = listaConveniosProveedor.find((c:any) => c.id === formData.convenioProveedor);
  const tarifaIdCliente = String(convClienteSel?.tarifaBaseId || '').trim();
  const tarifaIdProveedor = String(convProvSelObj?.tarifaBaseId || '').trim();
  const montoCliente = Number(convClienteSel?.tarifaMonto || 0);
  // ✅ V00126: Subtotal mostrado en la MONEDA DE LA FACTURA (sin redondeo)
  const tcVigente = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0;
  const monConvCliActual = formData.monedaConvenioCliente || convClienteSel?.monedaMaestro;
  const monConvProvActual = formData.monedaConvenioProv || convProvSelObj?.monedaBase;
  const subtotalClienteFact = convertirAMonedaFactura(Number(formData.montoConvenioCliente || 0), tcVigente, monConvCliActual, formData.facturadoEnCobrar);
  const subtotalProvFact = convertirAMonedaFactura(Number(formData.totalAPagarProv || 0), tcVigente, monConvProvActual, formData.facturadoEnUnidad);
  const leyendaConversion = (r: { convertido: boolean; sinTC: boolean }, monto: number, monConv: any) =>
    !r.convertido ? '' : r.sinTC ? `⚠ Falta el Tipo de Cambio del día para convertir ${fmtMoney(monto)} ${nombreMoneda(monConv)}` : `${fmtMoney(monto)} ${nombreMoneda(monConv)} × TC ${tcVigente}`;
  const montoProveedor = Number(convProvSelObj?.tarifaMonto || 0);
  const monedaClienteId = convClienteSel?.monedaMaestro;
  const monedaProveedorId = convProvSelObj?.monedaBase;
  const tarifasCoinciden = !!tarifaIdCliente && tarifaIdCliente === tarifaIdProveedor;

  // ✅ Color de los montos según la moneda de facturación:
  //   Dólares → azul (#58a6ff)   ·   Pesos → verde (#3fb950).
  const colorPorMonedaId = (idMoneda: any): string | undefined => {
    const n = String(nombreMoneda(idMoneda) || '').toUpperCase();
    if (n.includes('USD') || n.includes('DOLAR') || n.includes('DÓLAR')) return '#58a6ff';
    if (n.includes('MXN') || n.includes('PESO')) return '#3fb950';
    return undefined;
  };
  const colorMonedaProv = colorPorMonedaId(formData.facturadoEnUnidad);
  const colorMonedaCliente = colorPorMonedaId(formData.facturadoEnCobrar);

  const nombreTarifaPorId = (tarifaId: any): string => {
    const id = String(tarifaId || '').trim();
    if (!id) return '';
    const t = (tarifas || []).find((x: any) => String(x.id).trim() === id);
    return t?.descripcion || t?.nombre || t?.tarifa || t?.concepto || '';
  };
  const nombreTarifaCli = convClienteSel?.descripcion || nombreTarifaPorId(tarifaIdCliente);
  const nombreTarifaProv = convProvSelObj?.tipoConvenioNombre || nombreTarifaPorId(tarifaIdProveedor);


  const tipoOpTextNormalizado = (tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '').toLowerCase();
  const isTransfer = tipoOpTextNormalizado.includes('transfer');
  const isLogistica = tipoOpTextNormalizado.includes('logistica') || tipoOpTextNormalizado.includes('logística');
  const isFletes = tipoOpTextNormalizado.includes('fletes') || tipoOpTextNormalizado.includes('flete');
  const isRoelca = searchProvTransporte.toLowerCase().includes('roelca');
  const proveedorForzado = formData.tipoOperacionId === TIPO_OP_PROVEEDOR_FIJO;
  const showInternalFleet = isTransfer || ((isLogistica || isFletes) && isRoelca);
  const showExternalFleet = (isLogistica || isFletes) && !isRoelca;
  const esFlotaPropiaRoelca = showInternalFleet;

  // ✅ V00490: "Facturado en" = la moneda de la empresa en Empresas (Cliente que paga / Proveedor de
  //   transporte) y NO se cambia en la operación: pedido de Omaf ("no puede tener otra moneda"; la V00132
  //   la había dejado editable). El precio del convenio sigue en su moneda y se convierte con el TC.
  //   Si la empresa no tiene moneda, se elige a mano como antes. Una operación guardada con otra moneda
  //   toma la de su empresa al abrirla (se queda al guardar).
  const monedaDeEmpresaId = (empresaId: unknown): string => {
    const id = String(empresaId ?? '').trim();
    if (!id) return '';
    const emp = (empresas || []).find((e) => String(e.id) === id);
    return emp ? resolverMonedaIdDeEmpresa(emp) : '';
  };
  const monedaFijaCliente = monedaDeEmpresaId(formData.clientePaga);
  const monedaFijaProveedor = esFlotaPropiaRoelca ? '' : monedaDeEmpresaId(formData.proveedorUnidad);
  const monedaFijaDe = (campo: string): string => (campo === 'facturadoEnCobrar' ? monedaFijaCliente : campo === 'facturadoEnUnidad' ? monedaFijaProveedor : '');
  useEffect(() => {
    if (monedaFijaCliente && formData.facturadoEnCobrar !== monedaFijaCliente) setFormData(prev => ({ ...prev, facturadoEnCobrar: monedaFijaCliente }));
  }, [monedaFijaCliente, formData.facturadoEnCobrar]);
  useEffect(() => {
    if (monedaFijaProveedor && formData.facturadoEnUnidad !== monedaFijaProveedor) setFormData(prev => ({ ...prev, facturadoEnUnidad: monedaFijaProveedor }));
  }, [monedaFijaProveedor, formData.facturadoEnUnidad]);

  // ✅ Puente: se muestra SOLO en Transfer, o en Logística de CRUCES cuando el
  //    Proveedor de Transporte es Roelca. En Fletes (aunque sea Roelca) o en
  //    Logística con proveedor externo NO. (Regla V00369)
  const isMovimientos = tipoOpTextNormalizado.includes('movimiento'); // ✅ V00371: Movimientos exento
  const mostrarPuente = (isTransfer || (isLogistica && !isFletes && isRoelca)) && !isMovimientos;
  // ✅ V00364: la TARJETA Caseta/Puente se enseñaba solo cuando la operación ya
  //   marcó Verde MX o Verde USA (o el peaje ya se cobró). La lógica interna
  //   (mostrarPuente) no cambia: el puente se sigue precalculando y NO se pierde al guardar sin verde.
  // ✅ V00465: también en cuanto se pone la UNIDAD (ya se sabe qué puente le toca y con qué TAG).
  const puenteVisible = mostrarPuente && (!!String(formData.unidad || '').trim() || (() => {
    const st = String((initialData as Record<string, unknown> | undefined)?.statusNombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const evento = String((initialData as Record<string, unknown> | undefined)?.saldoPuenteEvento || '');
    const cobrado = Number((initialData as Record<string, unknown> | undefined)?.saldoPuente) > 0;
    return st.includes('verde') || !!evento || cobrado;
  })());
  // Opciones de puente desde catalogo_tipos_gastos (categoria_gasto === "Puente").
  const opcionesPuente = (tiposGastosLocal || []).filter(
    (g: any) => String(g.categoria_gasto || '').trim().toLowerCase() === 'puente'
  );

  // ✅ V00465: el PUENTE QUE CORRESPONDE por el CONVENIO y su TARIFA, con la misma regla con
  //   la que se cobra (casetaPrevista): la caseta de los gastos incluidos de la tarifa con el
  //   monto del vínculo (p. ej. Caseta Puente III $144); sin caseta en la tarifa → aduana
  //   Colombia (Caseta Mx Colombia / Trompo Colombia) → por tráfico (importación → Caseta AVI,
  //   exportación → Caseta Puente III). Antes solo se veía el tráfico.
  //   Los catálogos ya están cargados en el formulario: no hay lecturas nuevas.
  //   (ctxPuente se arma arriba, junto a formData: también lo usa la aduana del flujo, V00469.)
  const puentePrevisto = useMemo(
    () => (mostrarPuente ? casetaPrevista(ctxPuente, { convenio: formData.convenio, carga: formData.carga, convenioNombre: formData.convenioNombre, trafico: formData.trafico }, '', reglaPuenteForm) : null), // ✅ V00473: + el elegido en Reglas de Estatus
    [mostrarPuente, ctxPuente, formData.convenio, formData.carga, formData.convenioNombre, formData.trafico, reglaPuenteForm],
  );

  // ✅ (Caseta/Puente automático) El listado del select sigue mostrando TODOS los puentes y el
  //   usuario puede cambiarlo a mano. ✅ V00465: se elige el puente previsto (arriba) y se vuelve a
  //   elegir si cambia el convenio o el tráfico, salvo que el usuario ya lo haya cambiado a mano;
  //   no pisa el puente ya guardado al editar una operación existente.
  //   Si la operación ya se COBRÓ (saldoPuente), el puente es el cobrado: el TAG y el select
  //   dicen lo mismo que la ficha (grupoTagDeOperacion: el cobrado manda).
  const datosGuardados = (initialData as Record<string, unknown> | undefined) || {};
  const puenteCobrado = Number(datosGuardados.saldoPuente) > 0 && String(datosGuardados.saldoPuentePuente || '').trim()
    ? { nombre: String(datosGuardados.saldoPuentePuente), monto: Number(datosGuardados.saldoPuente), piso: Number(datosGuardados.saldoPuentePiso) > 0 ? String(datosGuardados.saldoPuentePisoPuente || '') : '' }
    : null;
  // ✅ V00470: aduana Colombia = DOS cobros (como en Reglas de Estatus): la caseta (arriba) y el PUENTE
  //   (Puente Mx Colombia, monto del catálogo). Se muestra aparte, solo informativo.
  const pisoColombia = ((): { nombre: string; monto: number } | null => {
    if (!mostrarPuente) return null;
    if (puenteCobrado?.piso) return { nombre: puenteCobrado.piso, monto: Number(datosGuardados.saldoPuentePiso) || 0 };
    if (puenteCobrado || !esAduanaColombia(aduanaForm)) return null;
    // ✅ V00473: el puente elegido en un flujo de Colombia de Reglas de Estatus; si no, el del catálogo.
    const elegido = reglaPuenteForm && esAduanaColombia(reglaPuenteForm.aduanaFlujo) ? casetaDeElegido(ctxPuente, reglaPuenteForm.piso) : null;
    if (elegido) return { nombre: elegido.nombre, monto: elegido.monto };
    const l = casetasDeFlujo(ctxPuente.tiposGasto, { aduana: aduanaForm, carga: formData.carga })[1];
    return l && l.monto !== null ? { nombre: l.nombre, monto: l.monto } : null;
  })();
  const asignarPuenteAutomatico = useEffectEvent(() => {
    if (!mostrarPuente || puenteElegidoAMano.current) return;
    // Una operación guardada con puente lo conserva (se lee de initialData, no de formData:
    // al reusar el formulario minimizado, formData aún puede traer la operación anterior).
    if (String(datosGuardados.puenteId || datosGuardados.puente || '').trim()) return;
    if (initialData && formData.puenteId && formData.puenteId !== puenteAutoId.current) return;
    const objetivo = puenteCobrado
      ? (() => {
          const row = opcionesPuente.find((g: DocCatalogo) => normPuente(g.nombre_gasto) === normPuente(puenteCobrado.nombre));
          return row ? { id: String(row.id), nombre: puenteCobrado.nombre, monto: puenteCobrado.monto } : null;
        })()
      : puentePrevisto
        ? (() => {
            const row = opcionesPuente.find((g: DocCatalogo) => idReal(g) === puentePrevisto.gastoId || String(g.id) === puentePrevisto.gastoId);
            return { id: row ? String(row.id) : puentePrevisto.gastoId, nombre: puentePrevisto.nombre, monto: puentePrevisto.monto };
          })()
        : null;
    if (!objetivo) return;
    if (formData.puenteId === objetivo.id && Number(formData.puenteMonto) === objetivo.monto) return;
    puenteAutoId.current = objetivo.id;
    setFormData(prev => ({ ...prev, puenteId: objetivo.id, puenteNombre: objetivo.nombre, puenteMonto: objetivo.monto }));
  });
  useEffect(() => asignarPuenteAutomatico(), [puentePrevisto, puenteCobrado?.nombre, puenteCobrado?.monto, formData.puenteId, mostrarPuente, opcionesPuente.length, initialData]);

  const usuarioActualCancel = useUsuarioStore((s) => s.usuario);

  // ✅ V00438 (Fase 2.10): el guardado completo (incluidas las subidas de documentos que
  //   siguen a onSave, cuando el formulario ya pudo cerrarse) cuenta como edición en
  //   curso: una versión nueva de la app no recarga la página a la mitad.
  const handleSubmit = async (e: React.FormEvent) => {
    const liberar = abrirEdicion();
    try {
      await guardarFormulario(e);
    } finally {
      liberar();
    }
  };

  const guardarFormulario = async (e: React.FormEvent) => {
    if (!validarFormularioConfigurable('operaciones')) { e?.preventDefault?.(); return; } // ✅ V00385: campos obligatorios (Autorizaciones / editor)
    e.preventDefault();

    // ✅ CANCELACIÓN CONTROLADA: si la operación pasa a Cancelado, se exige
    //   una observación del motivo y se registra QUIÉN la canceló y cuándo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- status vive fuera del tipo del formulario (mismo criterio del archivo).
    const statusNuevo = String((formData as any).status || '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- initialData sin tipo canónico (mismo criterio del archivo).
    const statusPrevio = String((initialData as any)?.status || '');
    let datosCancelacion: Record<string, string> | null = null;
    if (statusNuevo === STATUS_CANCELADO && statusPrevio !== STATUS_CANCELADO) { // ✅ V00439 (Fase 3.6): ID desde constantes
      let motivo = '';
      while (!motivo.trim()) {
        const respuesta = window.prompt('Para CANCELAR esta referencia escribe el motivo de la cancelación (obligatorio):', '');
        if (respuesta === null) { return; } // el usuario desistió: no se guarda nada
        motivo = respuesta;
      }
      datosCancelacion = {
        observacionCancelacion: motivo.trim(),
        canceladoPor: String(usuarioActualCancel?.nombre || usuarioActualCancel?.email || usuarioActualCancel?.id || 'Desconocido'),
        canceladoPorUid: String(usuarioActualCancel?.id || ''),
        fechaCancelacion: new Date().toISOString(),
      };
    }

    setCargando(true);
    try {
      const configId = buildConfigId();
      let statusCalculado: string;
      try {
        statusCalculado = await calcularStatusDinamico(configId, formData, statusPrevioParaCalculo());
      } catch (errStatus) {
        console.warn('No se pudo calcular el status para el flujo actual; se usa un valor de respaldo.', errStatus);
        statusCalculado = String((initialData as any)?.status || (formData as any).status || '');
      }
      // ✅ Si aun así quedó vacío (operación NUEVA con flujo sin configurar),
      //   se asigna el status INICIAL del catálogo (el que empieza con "1")
      //   para que la operación nunca quede sin status en la tabla.
      if (!statusCalculado) {
        const statusInicial = (statusServicio || []).find((st: any) =>
          /^\s*1(?![\d.])|^\s*1\.\s*/.test(String(st.nombre || st.descripcion || '')));
        if (statusInicial) {
          statusCalculado = statusInicial.id;
          console.warn('[Status] Operación sin flujo calculable; se asignó el status inicial:', statusInicial.nombre || statusInicial.descripcion);
        }
      }
      const detalleDoc = listaConveniosCliente.find((c:any) => c.id === formData.convenio);
      const { pdfCartaPorte, pdfDoda, pdfManifiesto, pdfsEntrys, ...datosLimpios } = formData;
      const tipoOpObj = tiposOperacion.find((t:any) => t.id === formData.tipoOperacionId);
      const statusObj = statusServicio?.find((s:any) => s.id === statusCalculado);
      const monedaCobroObj = listaMonedasLocal.find((m:any) => m.id === formData.facturadoEnCobrar);
      const monedaUnidadObj = listaMonedasLocal.find((m:any) => m.id === formData.facturadoEnUnidad);
      const convProvObj = listaConveniosProveedor.find((c:any) => c.id === formData.convenioProveedor);
      const monedaConvProvObj = listaMonedasLocal.find((m:any) => m.id === formData.monedaConvenioProv);
      const embalajeObj = (embalajesLocal || []).find((em:any) => String(em.id) === String(formData.embalaje));
      const embalajeNombreResuelto = embalajeObj
        ? String(embalajeObj.clave ?? embalajeObj.embalaje ?? embalajeObj.nombre ?? embalajeObj.descripcion ?? embalajeObj.tipo ?? '').trim()
        : ((initialData as any)?.embalajeNombre || '');

      let resolvedClientePaga = formData.clientePaga;
      if (!resolvedClientePaga && searchClientePaga) { const f = filClientesPaga.find((x:any) => x.nombre?.toLowerCase() === searchClientePaga.toLowerCase()); if (f) resolvedClientePaga = f.id; }
      let resolvedOrigen = formData.origen;
      if (!resolvedOrigen && searchOrigen) { const f = filOrigenesDestinos.find((x:any) => x.nombre?.toLowerCase() === searchOrigen.toLowerCase()); if (f) resolvedOrigen = f.id; }
      let resolvedDestino = formData.destino;
      if (!resolvedDestino && searchDestino) { const f = filOrigenesDestinos.find((x:any) => x.nombre?.toLowerCase() === searchDestino.toLowerCase()); if (f) resolvedDestino = f.id; }
      let resolvedRemolque = formData.numeroRemolque;
      if (!resolvedRemolque && searchRemolque) { const f = remolques.find((x:any) => `${x.nombre || ''} ${x.placas || x.placa || ''}`.trim().toLowerCase() === searchRemolque.toLowerCase()); if (f) resolvedRemolque = f.id; }
      let resolvedClienteMercancia = formData.clienteMercancia;
      if (!resolvedClienteMercancia && searchClienteMercancia) { const sM = searchClienteMercancia.toLowerCase(); const f = filClientesMercancia.find((x:any) => x.nombre?.toLowerCase() === sM || String(x.razonSocial || '').toLowerCase() === sM); if (f) resolvedClienteMercancia = f.id; } // ✅ V00354
      let resolvedProvServicios = formData.provServicios;
      if (!resolvedProvServicios && searchProvServicios) { const f = filProveedoresServicios.find((x:any) => x.nombre?.toLowerCase() === searchProvServicios.toLowerCase()); if (f) resolvedProvServicios = f.id; }
      let resolvedProvTransporte = formData.proveedorUnidad;
      if (!resolvedProvTransporte && searchProvTransporte) { const f = filProveedoresTransporte.find((x:any) => x.nombre?.toLowerCase() === searchProvTransporte.toLowerCase()); if (f) resolvedProvTransporte = f.id; }
      let resolvedUnidad = formData.unidad;
      if (!resolvedUnidad && searchUnidad) { const f = unidades.find((x:any) => (x.unidad || x.nombre)?.toLowerCase() === searchUnidad.toLowerCase()); if (f) resolvedUnidad = f.id; }
      let resolvedOperador = formData.operador;
      if (!resolvedOperador && searchOperador) { const f = listaEmpleadosLocal.find((x:any) => `${x.firstName || ''} ${x.lastNamePaternal || ''}`.trim().toLowerCase() === searchOperador.toLowerCase()); if (f) resolvedOperador = f.id; }
      let resolvedUnidadProv = formData.unidadProveedor;
      if (!resolvedUnidadProv && searchUnidadProveedor) { const f = listaUniProvLocal.find((x:any) => String(x.numeroUnidad || x.numero_unidad || x.unidad || x.placas || x.placa || '').toLowerCase() === searchUnidadProveedor.toLowerCase()); if (f) resolvedUnidadProv = f.id; }
      let resolvedOperadorProv = formData.operadorProveedor;
      if (!resolvedOperadorProv && searchOperadorProveedor) { const f = listaOpeProvLocal.find((x:any) => String(x.nombre || x.nombres || x.nombreCompleto || '').toLowerCase() === searchOperadorProveedor.toLowerCase()); if (f) resolvedOperadorProv = f.id; }

      // ✅ V00355/V00367: saldo del puente al marcar Verde (o completar). ✅ V00469: aparte del payload;
      //   se agrega DESPUÉS de quitar los campos ajenos (los saldoPuente… de la copia ya no se guardan).
      const cobroPuenteCalculado = await camposSaldoPuente(statusCalculado, statusObj?.nombre || statusObj?.descripcion || '');
      // ✅ V00441 (Fase 5.7): con la bandera, el peaje lo cobra el servidor (trigger operacionEscrita).
      const cobroPuenteForm = (await obtenerFlags()).cobroPuenteEnServidor ? {} : cobroPuenteCalculado;
      const operacionData: any = { 
        ...datosLimpios, 
        ...(trompoNoCobrable ? { montoConvenioCliente: 0, noCobrable: true, motivoNoCobrable: 'Trompo de Roelca' } : {}), // ✅ V00434
        ...(esPrueba ? { esPrueba: true } : {}), // ✅ V00380
        clientePaga: resolvedClientePaga, origen: resolvedOrigen, destino: resolvedDestino,
        numeroRemolque: resolvedRemolque, clienteMercancia: resolvedClienteMercancia,
        provServicios: resolvedProvServicios, proveedorUnidad: resolvedProvTransporte,
        unidad: resolvedUnidad, operador: resolvedOperador,
        unidadProveedor: resolvedUnidadProv, operadorProveedor: resolvedOperadorProv,
        convenioNombre: detalleDoc?.descripcion || formData.convenioNombre || 'Sin descripción', 
        status: statusCalculado || 'Pendiente',
        // ✅ FIX: se guarda el NOMBRE del status (la descripción larga del catálogo
        //    solo es texto de ayuda y estaba filtrándose a la tabla del dashboard)
        statusNombre: statusObj?.nombre || statusObj?.descripcion || statusCalculado || 'Pendiente',
        ...ajusteSueldoPorStatus({ ...formData, ...datosLimpios }, statusObj?.nombre || statusObj?.descripcion || statusCalculado || ''), // ✅ V00387: Falso = sueldo a la mitad
        clienteNombre: searchClientePaga || '', origenNombre: searchOrigen || '',
        destinoNombre: searchDestino || '', remolqueNombre: searchRemolque || '',clienteMercanciaNombre: searchClienteMercancia || '', provServiciosNombre: searchProvServicios || '',
        proveedorUnidadNombre: searchProvTransporte || '', unidadNombre: searchUnidad || '',
        operadorNombre: searchOperador || '', tipoOperacionNombre: tipoOpObj?.tipo_operacion || '',
        monedaCobroNombre: monedaCobroObj?.moneda || '', monedaUnidadNombre: monedaUnidadObj?.moneda || '',
        convenioProveedorNombre: convProvObj?.tipoConvenioNombre || '',
        embalajeNombre: embalajeNombreResuelto,
        monedaConvProvNombre: monedaConvProvObj?.moneda || ''
      };

      if (esFlotaPropiaRoelca) {
        operacionData.convenioProveedor = '';
        operacionData.convenioProveedorNombre = '';
        operacionData.monedaConvenioProv = '';
        operacionData.monedaConvProvNombre = '';
        operacionData.totalAPagarProv = 0;
        operacionData.cargosAdicionalesProv = 0;
        operacionData.subtotalProv = 0;
        operacionData.dolaresProv = 0;
        operacionData.pesosProv = 0;
        operacionData.conversionProv = 0;
      }

      if (!mostrarPuente) {
        operacionData.puenteId = '';
        operacionData.puenteNombre = '';
        operacionData.puenteMonto = 0;
      }

      Object.keys(operacionData).forEach(key => { if (operacionData[key] === undefined) delete operacionData[key]; });
      // ✅ V00440 (Fase 4.6): montos y cantidades se guardan como NÚMERO (los inputs
      //   entregan texto: '1250.50' → 1250.5). Un campo vacío se queda vacío.
      Object.assign(operacionData, normalizarNumerosOperacion(operacionData));
      // ✅ V00440 (Fase 4.4): los campos canónicos (estadoGrupo, *Id, empresasIds…) los
      //   escribe SOLO el servidor. El formulario trae una copia del documento que pudo
      //   quedar vieja mientras estaba abierto; guardarla regresaría valores anteriores.
      for (const campo of CAMPOS_CANONICOS) if (campo !== 'esPrueba') delete operacionData[campo];
      // ✅ V00451: tampoco los que escriben otros módulos (facturación, nómina, diésel, puentes…):
      //   guardar la copia vieja regresaba a "Pendiente" una operación ya facturada.
      quitarCamposAjenos(operacionData);
      // ✅ V00469: el cobro del puente que calculó el formulario (si hubo) sí se guarda.
      Object.assign(operacionData, cobroPuenteForm);

      if (initialData && puedeEditarRef && referencia.trim() && referencia.trim() !== String((initialData as any).ref || '')) {
        operacionData.ref = referencia.trim();
      }

      // ── ✅ AUTORIZACIONES (modelo de bloqueo directo): si la acción o algún
      //    campo modificado está controlado para los roles del usuario (y no
      //    es Admin), el guardado se RECHAZA. Los roles no seleccionados en el
      //    configurador editan libremente. No se crean solicitudes.
      //    El formulario NO se cierra: el usuario puede revertir los campos
      //    bloqueados y guardar el resto de su captura. ──
      const etiquetasCamposAut: Record<string, string> = {};
      (MODULOS_AUTORIZABLES.find(m => m.clave === 'operaciones')?.campos || []).forEach(c => { etiquetasCamposAut[c.key] = c.label; });
      const accionAut: 'crear' | 'editar' = initialData ? 'editar' : 'crear';
      // ✅ V00382: solo cuentan los campos que el USUARIO pudo cambiar:
      //   · diff normalizado (0 = vacío, 1500 = "1500.00", fechas, acentos…);
      //   · fuera 'status' (lo mueve el flujo de Reglas de Estatus, no el usuario);
      //   · fuera los campos que en pantalla están BLOQUEADOS para él (solo lectura):
      //     si cambiaron fue por un recálculo automático (convenio, TC, Empresas);
      //   · fuera los campos con acceso temporal aprobado.
      const AUT_AUTOMATICOS = ['status'];
      const AUT_BLOQUEABLES_UI = ['facturadoEnCobrar', 'facturadoEnUnidad', 'sueldoOperador', 'combustible', 'montoConvenioCliente', 'tipoCambioAprobado'];
      const camposCambiadosAut = initialData
        ? camposModificadosDe(operacionData, initialData as Record<string, unknown>).filter((k) =>
            !AUT_AUTOMATICOS.includes(k) &&
            !(AUT_BLOQUEABLES_UI.includes(k) && (campoBloqueadoAut(k) || !!monedaFijaDe(k))) && // ✅ V00490: la moneda de la empresa no la cambió el usuario
            !autHook.accesoVigente(k))
        : [];
      const usuarioA = usuarioAut || await obtenerUsuarioAut();
      const configA = configAut !== undefined ? configAut : await cargarConfigModulo('operaciones');
      const evalAut = evaluarAutorizacion(configA, accionAut, usuarioA, camposCambiadosAut, etiquetasCamposAut, (initialData || null) as Record<string, unknown> | null);
      if (evalAut.requiere) {
        alert(`No tienes permiso para realizar esta modificación:\n\n${evalAut.motivos.join('\n')}\n\nRevierte esos campos para poder guardar el resto de los cambios.`);
        return;
      }

      // ── ✅ NUEVO (auditoría NO editable): quién y a qué hora creó la
      //    referencia, y bitácora embebida de cada edición con sus cambios.
      //    Estos campos NO existen en el formulario: en cada edición se
      //    preservan desde el registro original, por lo que nadie puede
      //    modificarlos desde la interfaz. ──
      // El nombre se resuelve desde el perfil del usuario (colección `usuarios`),
      //   nunca el UID: si lo que trae la autorización es el UID, se busca el
      //   nombre real o el correo como respaldo.
      let nombreAuditoria = '';
      try {
        const uidA = auth.currentUser?.uid || '';
        const candidatos = [(usuarioA as any)?.nombre, (usuarioA as any)?.nombreCompleto, (usuarioA as any)?.email];
        nombreAuditoria = String(candidatos.find((v: any) => v && String(v).trim() && String(v).trim() !== uidA) || '');
        if (!nombreAuditoria && uidA) {
          const snapU = await getDoc(doc(db, 'usuarios', uidA));
          const dU: any = snapU.exists() ? snapU.data() : {};
          nombreAuditoria = String(dU.nombre || dU.nombreCompleto || dU.displayName || dU.email || '');
        }
        if (!nombreAuditoria) nombreAuditoria = String(auth.currentUser?.displayName || auth.currentUser?.email || 'Desconocido');
      } catch {
        nombreAuditoria = String(auth.currentUser?.displayName || auth.currentUser?.email || 'Desconocido');
      }
      const ahoraAuditoria = new Date().toISOString();
      if (initialData) {
        // ✅ V00440: la comparación usa los números ya normalizados de ambos lados
        //   ('1250.50' guardado vs 1250.5 nuevo NO es un cambio).
        const cambiosAud = listaCambiosAuditoria(operacionData, normalizarNumerosOperacion(initialData as Record<string, unknown>) as any, etiquetasCamposAut);
        (operacionData as any).creadoPor = (initialData as any).creadoPor || '';
        (operacionData as any).creadoEn = (initialData as any).creadoEn || '';
        if (cambiosAud.length > 0) {
          (operacionData as any).historialEdiciones = [
            ...((Array.isArray((initialData as any).historialEdiciones) ? (initialData as any).historialEdiciones : [])),
            { fecha: ahoraAuditoria, usuario: nombreAuditoria, cambios: cambiosAud },
          ];
        }
      } else {
        (operacionData as any).creadoPor = nombreAuditoria;
        (operacionData as any).creadoEn = ahoraAuditoria;
        (operacionData as any).historialEdiciones = [];
      }

      let idGuardado = '';
      let refGuardado = '';
      if (initialData) {
        if (datosCancelacion) Object.assign(operacionData, datosCancelacion);

        // ✅ V00163 — CAMBIO DE LÍNEA = NUEVA REFERENCIA, pero ahora ATÓMICA:
        //   el número lo asigna la Cloud Function renumerarOperacion (máximo real
        //   + 1 dentro de una transacción), NUNCA el cliente. La versión anterior
        //   consultaba orderBy('ref') desc aquí mismo: el orden alfabético con
        //   refs sin ceros ("TR-…-9" > "TR-…-024") producía brincos y duplicados.
        let renumerarPendiente: { prefijo: string; ddmmyy: string } | null = null;
        try {
          const refActual = String((initialData as any).ref || '');
          const matchRef = refActual.match(/^([A-ZÑ0-9.]{1,6})-(\d{6})-(\d+)$/);
          const tipoNuevoNombre = tiposOperacion?.find((t: any) => t.id === formData.tipoOperacionId)?.tipo_operacion || '';
          const prefijoNuevo = (esPrueba ? PREFIJO_PRUEBA : '') + prefijoTipoOperacion(tipoNuevoNombre); // ✅ V00380: la prueba conserva PR.
          if (matchRef && tipoNuevoNombre && prefijoNuevo !== matchRef[1]) {
            renumerarPendiente = { prefijo: prefijoNuevo, ddmmyy: matchRef[2] }; // conserva la fecha de la referencia
          }
        } catch (eRef) {
          console.warn('No se pudo evaluar el cambio de línea:', eRef);
        }
        // La ref NUNCA viaja en el update: la posee el backend.
        delete (operacionData as any).ref;

        // ✅ V00451: al ID REAL del documento (registros viejos traen un campo `id` distinto), y la
        //   bitácora se AGREGA (arrayUnion): la copia del formulario no pisa entradas de otros.
        const idDocReal = String((initialData as { _docId?: unknown })._docId || initialData.id);
        const historialNuevo = Array.isArray(operacionData.historialEdiciones) ? operacionData.historialEdiciones : null;
        const entradaHistorial = historialNuevo && historialNuevo.length ? historialNuevo[historialNuevo.length - 1] : null;
        const payloadFirestore: Record<string, unknown> = { ...operacionData };
        const previasHistorial = Array.isArray(initialData.historialEdiciones) ? initialData.historialEdiciones.length : 0;
        if (entradaHistorial && historialNuevo && historialNuevo.length > previasHistorial) {
          payloadFirestore.historialEdiciones = arrayUnion(entradaHistorial);
        } else {
          delete payloadFirestore.historialEdiciones;
        }
        await updateDoc(doc(db, 'operaciones', idDocReal), payloadFirestore);
        idGuardado = String(initialData.id); // documentos y avisos: el id con el que la conoce la lista (como siempre)
        if (renumerarPendiente) {
          try {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const fn = httpsCallable(getFunctions(undefined, 'us-central1'), 'renumerarOperacion');
            // ✅ V00463: con reintentos ante fallos de conexión (no cambia una operación que ya está en la línea).
            const { valor: rRes } = await conReintentos(() => fn({ operacionId: idDocReal, ...renumerarPendiente })); // ✅ V00451: el documento REAL
            const rData = (rRes?.data ?? null) as { ref?: unknown; version?: unknown } | null;
            const nuevaRef = String(rData?.ref || '');
            if (nuevaRef) {
              (operacionData as any).ref = nuevaRef;
              console.info(`[consecutivo] renumerada por cambio de línea → ${nuevaRef} · función=${String(rData?.version || 'v1/desconocida (¡desplegar!)')}`);
            }
          } catch (eRen: any) {
            alert(`La operación se guardó, pero NO se pudo renumerar a la nueva línea (${eRen?.message || eRen}). Conserva su referencia anterior; reintenta guardando de nuevo.`);
          }
        }
        // ✅ V00126: avisa a Facturación/Pagos. ✅ V00451: sin los campos de otros módulos de la copia
        //   del formulario (la de Facturación es la vigente; la del formulario pudo quedar vieja).
        notificarOperacionGuardada(idGuardado, { ...quitarCamposAjenos({ ...(initialData as any), ...operacionData }), ...cobroPuenteForm }); // ✅ V00469: con el cobro nuevo
        refGuardado = referenciaDeOperacion(idGuardado, operacionData.ref || (initialData as any).ref);
        if (onSave) onSave({ id: initialData.id, ...operacionData });
      } else {
        if (!clienteOpIdRef.current) clienteOpIdRef.current = nuevoIdEnvioOperacion(); // ✅ V00463
        const resultado = await guardarOperacionSegura(operacionData, { clienteOpId: clienteOpIdRef.current });
        const nuevoId = (typeof resultado === 'object' && resultado?.id) ? resultado.id : Date.now().toString();
        idGuardado = String(nuevoId);
        notificarOperacionGuardada(idGuardado, { ...operacionData, ref: (resultado as any)?.ref || operacionData.ref }); // ✅ V00126: avisa a Facturación/Pagos
        refGuardado = referenciaDeOperacion(idGuardado, (resultado as any)?.ref || operacionData.ref);
        if (onSave) onSave({ id: nuevoId, ...operacionData });
      }

      // ── ✅ HISTORIAL DE ACTIVIDAD: constancia de quién guardó, qué campos
      //    capturó (creación) o qué campos cambió con anterior → nuevo (edición)
      //    y cuándo. El usuario y la fecha los resuelve registrarLog. ──
      try {
        if (initialData) {
          registrarLog('Operaciones', 'Edición', `Editó la operación ${refGuardado}. Cambios → ${describirCambiosLog(operacionData, normalizarNumerosOperacion(initialData as Record<string, unknown>) as any, etiquetasCamposAut)}`).catch(() => {});
        } else {
          registrarLog('Operaciones', 'Creación', `Creó la operación ${refGuardado} con los campos → ${describirCamposCapturadosLog(operacionData, etiquetasCamposAut)}`).catch(() => {});
        }
      } catch { /* el log nunca debe romper el guardado */ }
      // ✅ V00470: al marcar el Verde (o el estatus con 🌉), "Esta unidad cruzó el puente…".
      avisarCrucePuente({ unidadNombre: searchUnidad, ref: refGuardado }, cobroPuenteCalculado);

      // ✅ V00451: varios archivos por documento (sin límite). El primero conserva el id y el nombre
      //   de siempre; los demás, "Carta Porte (2)"… Se avisa cuáles fallaron.
      const archivosPorCampo: { files: File[]; campo: string; sufijo?: string }[] = [];
      const agregarCampo = (valor: unknown, campo: string, sufijo?: string) => {
        const files = archivosDeCampo(valor);
        if (files.length > 0) archivosPorCampo.push({ files, campo, sufijo });
      };
      agregarCampo(pdfCartaPorte, 'Carta Porte');
      agregarCampo(pdfDoda, 'DODA');
      agregarCampo(pdfManifiesto, 'Manifiesto');
      (pdfsEntrys || []).forEach((lista: unknown, i: number) => agregarCampo(lista, "Entry's", String(i + 1)));

      const totalDocs = archivosPorCampo.reduce((n, a) => n + a.files.length, 0);
      let subidos = 0;
      const fallidos: string[] = [];
      for (const a of archivosPorCampo) {
        const r = await subirDocumentosOperacion(a.files, idGuardado, refGuardado, a.campo, a.sufijo);
        subidos += r.subidos;
        fallidos.push(...r.errores);
      }

      const resumenDocs = totalDocs > 0
        ? `\n\nDocumentos subidos a "${refGuardado}": ${subidos}/${totalDocs}${fallidos.length ? `\nNo se pudieron subir:\n• ${fallidos.join('\n• ')}\nSúbelos desde "Documentos guardados de esta operación".` : ''}`
        : '';
      alert(`Operación ${initialData ? 'actualizada' : 'guardada'} correctamente.${resumenDocs}`);
      clienteOpIdRef.current = null; // ✅ V00463: hasta aquí, por si algo falla después de crearla (no duplica)
      onClose();
    } catch (error: any) {
      console.error('Error al guardar operación:', error);
      alert(error?.message || 'Error al guardar');
    } finally { setCargando(false); }
  };

  const handleCancelarConfirmado = () => {
    const ok = window.confirm('¿Seguro que deseas cancelar esta operación? Se perderán los datos que no hayas guardado.');
    if (ok) { clienteOpIdRef.current = null; onClose(); } // ✅ V00463
  };

  const tipoOpNombreResumen = tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '';
  const convenioNombreResumen = listaConveniosCliente.find((c: any) => c.id === formData.convenio)?.descripcion || '';
  const tcResumen = formData.tipoCambioAprobado || tipoCambioDia;
  // ✅ V00461: T.C. oficial de la fecha de servicio y aviso si la operación trae otro (en General y en Cobrar).
  //   "Usar el oficial" respeta el bloqueo de Autorizaciones del campo.
  // ✅ V00462: `traia` = el T.C. guardado (si la fecha es la original) para decir que se corrigió al abrir.
  const enSuFechaOriginal = !!initialData && normalizarFechaISO(formData.fechaServicio) === normalizarFechaISO(initialData.fechaServicio);
  const avisoTC = (
    <AvisoTipoCambio buscando={buscandoTC} fechaISO={normalizarFechaISO(formData.fechaServicio)} oficial={tipoCambioDia} fechaDelOficial={fechaTCDia} deOperacion={Number(formData.tipoCambioAprobado) || 0}
      traia={enSuFechaOriginal ? Number(initialData?.tipoCambioAprobado) || 0 : 0}
      facturada={!!initialData && (facturadaCliente(initialData) || facturadaProveedor(initialData))}
      onUsarOficial={campoBloqueadoAut('tipoCambioAprobado') || tipoCambioDia === null ? undefined : () => { tcEditadoAMano.current = false; setFormData(prev => ({ ...prev, tipoCambioAprobado: tipoCambioDia })); }} />
  );

  const fmtFecha = (f: string) => { if (!f) return ''; try { return new Date(f).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return f; } };

  const opcionesTarifasRef = useMemo(() => {
    return (tarifas || [])
      .map((t: any) => ({ id: String(t.id), nombre: t.descripcion || t.nombre || t.tarifa || t.concepto || String(t.id) }))
      .sort((a: any, b: any) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' }));
  }, [tarifas]);

  const costoPorTarifa = useMemo(() => {
    const m: Record<string, number> = {};
    const tomar = (arr: any[]) => (arr || []).forEach((d: any) => {
      const tid = String(d.tipoConvenioId ?? d.tipo_convenio_id ?? d.tipoConvenio ?? d.tipo_convenio ?? d.tarifaId ?? d.tarifa_id ?? '').trim();
      if (!tid) return;
      const monto = montoDetalle(d);
      if (monto > 0 && m[tid] === undefined) m[tid] = monto;
    });
    tomar(catalogoConvDetalles);
    tomar(catalogoConvProvDetalles);
    return m;
  }, [catalogoConvDetalles, catalogoConvProvDetalles]);

  const [usoTarifaMap, setUsoTarifaMap] = useState<Record<string, number>>({});
  const usoTarifaCargadoRef = useRef(false);

  const cargarUsoTarifas = useCallback(async () => {
    if (usoTarifaCargadoRef.current) return;
    if (!((catalogoConvDetalles && catalogoConvDetalles.length) || (catalogoConvProvDetalles && catalogoConvProvDetalles.length))) return;
    usoTarifaCargadoRef.current = true;
    try {
      const detCli = new Map<string, string>();
      (catalogoConvDetalles || []).forEach((d: any) => {
        const tid = String(d.tipoConvenioId ?? d.tipo_convenio_id ?? d.tipoConvenio ?? d.tipo_convenio ?? d.tarifaId ?? d.tarifa_id ?? '').trim();
        if (tid) detCli.set(String(d.id), tid);
      });
      const detProv = new Map<string, string>();
      (catalogoConvProvDetalles || []).forEach((d: any) => {
        const tid = String(d.tipoConvenioId ?? d.tipo_convenio_id ?? d.tipoConvenio ?? d.tipo_convenio ?? d.tarifaId ?? d.tarifa_id ?? '').trim();
        if (tid) detProv.set(String(d.id), tid);
      });
      // ✅ V00443 (Fase 7.8): con `consultasCanonicas`, los contadores usos/convenio* (una lectura por
      //   detalle usado) en lugar de TODAS las operaciones. Diferencia: una operación cuyo convenio de
      //   cliente y de proveedor apuntan a la MISMA tarifa cuenta dos veces (antes una).
      if ((await obtenerFlags()).consultasCanonicas) {
        const [usosCli, usosProv] = await Promise.all([usosEnCache('convenioCliente'), usosEnCache('convenioProveedor')]);
        const conteoCanon: Record<string, number> = {};
        const sumar = (usos: Map<string, { usoOps: number }>, det: Map<string, string>) => usos.forEach((u, idDet) => {
          const tid = det.get(idDet);
          if (tid) conteoCanon[tid] = (conteoCanon[tid] || 0) + u.usoOps;
        });
        sumar(usosCli, detCli);
        sumar(usosProv, detProv);
        setUsoTarifaMap(conteoCanon);
        return;
      }
      const snap = await getDocs(collection(db, 'operaciones'));
      const conteo: Record<string, number> = {};
      snap.docs.forEach((docu: any) => {
        const op = docu.data() || {};
        const tarifasOp = new Set<string>();
        const cCli = String(op.convenio ?? '').trim();
        if (cCli && detCli.has(cCli)) tarifasOp.add(detCli.get(cCli) as string);
        const cProv = String(op.convenioProveedor ?? '').trim();
        if (cProv && detProv.has(cProv)) tarifasOp.add(detProv.get(cProv) as string);
        tarifasOp.forEach((tid) => { conteo[tid] = (conteo[tid] || 0) + 1; });
      });
      setUsoTarifaMap(conteo);
    } catch (e) {
      console.error('Error contando uso de tarifas en operaciones:', e);
      usoTarifaCargadoRef.current = false;
    }
  }, [catalogoConvDetalles, catalogoConvProvDetalles]);

  const etiquetaOpcionTarifa = (o: any): string => {
    const partes: string[] = [o.nombre, `ID: ${o.id}`];
    const costo = costoPorTarifa[o.id];
    if (costo !== undefined) partes.push(fmtMoney(costo));
    const uso = usoTarifaMap[o.id] || 0;
    partes.push(`${uso} op${uso === 1 ? '' : 's'}`);
    return partes.join('  ·  ');
  };

  useEffect(() => {
    if (mostrarConveniosCliente || mostrarConveniosProveedor || detalleConvEditando || detalleConvProvEditando) {
      cargarUsoTarifas();
    }
  }, [mostrarConveniosCliente, mostrarConveniosProveedor, detalleConvEditando, detalleConvProvEditando, cargarUsoTarifas]);

  // ✅ V00439 (Fase 3.6): sin releer convenios_clientes_detalles al guardar: el listener
  //   compartido trae el cambio (antes getDocs + copia en localStorage).

  const abrirEditorConvenio = (c: any) => {
    setDetalleConvEditando({
      id: c.id,
      tipoConvenioId: c.tipoConvenioId ?? c.tarifaBaseId ?? '',
      tipoConvenioNombre: c.tipoConvenioNombre ?? c.descripcion ?? '',
      origenNombre: c.origenNombre ?? c.origen ?? '',
      destinoNombre: c.destinoNombre ?? c.destino ?? '',
      tarifa: c.tarifa ?? '',
      costo: c.costo ?? '',
      venta: c.venta ?? '',
    });
  };

  // ✅ V00272: abrirNuevoConvenioCliente retirado — el alta/baja de convenios vive en los módulos de Convenios.

  const guardarDetalleConvenio = async () => {
    if (!detalleConvEditando) return;
    if (!String(detalleConvEditando.tipoConvenioId || '').trim()) { alert('Elige la TARIFA del catálogo — un convenio no puede quedar sin tarifa.'); return; } // ✅ V00429
    setGuardandoDetalleConv(true);
    try {
      const numOrUndef = (v: any) => (v === '' || v === null || v === undefined) ? undefined : Number(v);
      const payload: any = {
        tipoConvenioId: detalleConvEditando.tipoConvenioId || '',
        tipoConvenioNombre: detalleConvEditando.tipoConvenioNombre || '',
      };
      const t = numOrUndef(detalleConvEditando.tarifa);
      if (t !== undefined) payload.tarifa = t;

      if (detalleConvEditando.esNuevo) {
        if (!clientePagaIdResuelto) { alert('Selecciona un Cliente (Paga) válido antes de agregar el convenio.'); setGuardandoDetalleConv(false); return; }
        payload.clienteId = clientePagaIdResuelto;
        if (convenioClienteMaestroId) payload.convenioId = convenioClienteMaestroId;
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'convenios_clientes_detalles'), payload);
      } else {
        await updateDoc(doc(db, 'convenios_clientes_detalles', String(detalleConvEditando.id)), payload);
      }
      setDetalleConvEditando(null);
    } catch (e) {
      console.error('Error guardando detalle de convenio:', e);
      alert('No se pudo guardar el convenio. Revisa tu conexión.');
    } finally {
      setGuardandoDetalleConv(false);
    }
  };

  // ✅ V00272: eliminarDetalleConvenio retirado — el alta/baja de convenios vive en los módulos de Convenios.

  // ✅ V00439 (Fase 3.6): igual para convenios_proveedores_detalles (listener compartido).

  const abrirEditorConvenioProv = (c: any) => {
    setDetalleConvProvEditando({
      id: c.id,
      tipoConvenioId: c.tipoConvenioId ?? c.tarifaBaseId ?? '',
      tipoConvenioNombre: c.tipoConvenioNombre ?? '',
      tarifa: c.tarifa ?? '',
      costo: c.costo ?? '',
      venta: c.venta ?? '',
    });
  };

  // ✅ V00272: abrirNuevoConvenioProv retirado — el alta/baja de convenios vive en los módulos de Convenios.

  const guardarDetalleConvenioProv = async () => {
    if (!detalleConvProvEditando) return;
    setGuardandoDetalleConvProv(true);
    try {
      const numOrUndef = (v: any) => (v === '' || v === null || v === undefined) ? undefined : Number(v);
      const payload: any = {
        tipoConvenioId: detalleConvProvEditando.tipoConvenioId || '',
        tipoConvenioNombre: detalleConvProvEditando.tipoConvenioNombre || '',
      };
      const t = numOrUndef(detalleConvProvEditando.tarifa);
      if (t !== undefined) payload.tarifa = t;

      if (detalleConvProvEditando.esNuevo) {
        if (!proveedorIdResuelto) { alert('Selecciona un Proveedor de Transporte válido antes de agregar el convenio.'); setGuardandoDetalleConvProv(false); return; }
        payload.proveedorId = proveedorIdResuelto;
        if (convenioProvMaestroId) payload.convenioId = convenioProvMaestroId;
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'convenios_proveedores_detalles'), payload);
      } else {
        await updateDoc(doc(db, 'convenios_proveedores_detalles', String(detalleConvProvEditando.id)), payload);
      }
      setDetalleConvProvEditando(null);
    } catch (e) {
      console.error('Error guardando detalle de convenio de proveedor:', e);
      alert('No se pudo guardar el convenio. Revisa tu conexión.');
    } finally {
      setGuardandoDetalleConvProv(false);
    }
  };

  // ✅ V00272: eliminarDetalleConvenioProv retirado — el alta/baja de convenios vive en los módulos de Convenios.


  const idOperacion = (initialData as any)?.id || '';
  const referenciaOperacion = referenciaDeOperacion(idOperacion, (initialData as any)?.ref);

  // ✅ V00439 (Fase 3.6): espera los catálogos base de la capa compartida (antes, que el padre
  //   entregara catalogosCacheados.empresas).
  if (!catalogosBaseListos) return createPortal(<div className={`modal-overlay`}><div className="form-card fo-x6">Cargando catálogos de Roelca...</div></div>, document.body); // ✅ V00264

  // ✅ V00264: el formulario (abierto O minimizado) se monta con un PORTAL en
  //   document.body. Así, con los módulos "vivos" (que se ocultan con
  //   display:none al navegar), la operación MINIMIZADA sigue visible como
  //   píldora flotante EN CUALQUIER MÓDULO y se puede restaurar donde sea —
  //   el overlay abierto también se ve encima del módulo que esté en pantalla.
  return createPortal(
    <div
      className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}
      style={
        estado === 'minimizado'
          ? { padding: 0, background: 'transparent', pointerEvents: 'none', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, margin: 0 }
          : { padding: 0, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, margin: 0 }
      }
    >
      <style>{`
        .campo-badge { display: inline-block; font-family: monospace; font-size: 0.62rem; font-weight: 400; color: #6e7681; background: rgba(110,118,129,0.14); padding: 1px 5px; border-radius: 4px; margin-left: 6px; vertical-align: middle; letter-spacing: 0; }
        .roelca-form-shell { width: 100%; height: 100%; max-width: 100%; background-color: #0a0d14; border-radius: 0; display: flex; overflow: hidden; box-shadow: none; border: none; }
        .roelca-form-left { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; background-color: #0a0d14; }
        .roelca-form-right { width: 400px; background-color: #0d1117; border-left: 1px solid #1f2733; display: flex; flex-direction: column; flex-shrink: 0; }
        .roelca-form-header { padding: 20px 32px; border-bottom: 1px solid #1f2733; display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0; background-color: #0d1117; }
        .roelca-form-header h2 { margin: 0; font-size: 1.4rem; font-weight: 700; color: #f0f6fc; letter-spacing: -0.2px; }
        .roelca-form-header p { margin: 4px 0 0 0; font-size: 0.82rem; color: #7d8590; font-weight: 400; }
        .roelca-window-btn { background: transparent; border: 1px solid #2d333b; color: #8b949e; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s ease; }
        .roelca-window-btn:hover { background-color: #1f2733; color: #c9d1d9; border-color: #3d444d; }
        .roelca-window-btn.danger:hover { color: #f85149; border-color: rgba(248,81,73,0.4); background-color: rgba(248,81,73,0.08); }
        .roelca-tabs { display: flex; gap: 2px; padding: 0 32px; border-bottom: 1px solid #1f2733; background-color: #0d1117; flex-shrink: 0; overflow-x: auto; white-space: nowrap; }
        .roelca-tabs::-webkit-scrollbar { height: 0; }
        .roelca-tab { display: inline-flex; align-items: center; gap: 8px; padding: 15px 20px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #7d8590; font-weight: 500; font-size: 0.9rem; cursor: pointer; transition: all 0.15s ease; margin-bottom: -1px; letter-spacing: 0.1px; }
        .roelca-tab:hover { color: #c9d1d9; }
        .roelca-tab.active { color: #fb923c; border-bottom-color: #fb923c; font-weight: 600; }
        .roelca-scroll { flex: 1; overflow-y: auto; padding: 28px 32px; background-color: #0a0d14; }
        .roelca-scroll::-webkit-scrollbar { width: 8px; }
        .roelca-scroll::-webkit-scrollbar-track { background: transparent; }
        .roelca-scroll::-webkit-scrollbar-thumb { background: #21262d; border-radius: 4px; }
        .roelca-scroll::-webkit-scrollbar-thumb:hover { background: #2d333b; }
        .roelca-card { background-color: #0d1117; border: 1px solid #1f2733; border-radius: 12px; padding: 24px 26px; margin-bottom: 18px; transition: border-color 0.2s ease; max-width: 1100px; }
        .roelca-card:hover { border-color: #2d333b; }
        .roelca-card-header { display: flex; align-items: center; gap: 12px; margin: 0 0 20px 0; padding-bottom: 14px; border-bottom: 1px solid #1f2733; }
        .roelca-card-icon { width: 36px; height: 36px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background-color: rgba(251, 146, 60, 0.08); color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.18); }
        .roelca-card-title { margin: 0; font-size: 0.98rem; font-weight: 600; color: #e6edf3; letter-spacing: 0.1px; }
        .roelca-sidebar-section { padding: 16px 18px; background-color: #161b22; border: 1px solid #1f2733; border-radius: 10px; margin-bottom: 12px; transition: border-color 0.2s ease; }
        .roelca-sidebar-section:hover { border-color: #2d333b; }
        .roelca-sidebar-label { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 0.68rem; color: #7d8590; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; }
        .roelca-sidebar-icon { width: 26px; height: 26px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background-color: rgba(251, 146, 60, 0.08); color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.15); }
        .roelca-sidebar-value { color: #e6edf3; font-weight: 600; font-size: 0.92rem; word-break: break-word; line-height: 1.35; }
        .roelca-sidebar-muted { color: #6e7681; font-size: 0.85rem; font-weight: 400; }
        .roelca-sidebar-secondary { color: #8b949e; font-size: 0.8rem; margin-top: 5px; font-weight: 400; }
        .roelca-route-line { display: flex; align-items: center; gap: 8px; color: #8b949e; font-size: 0.8rem; margin-top: 8px; }
        .roelca-chip { display: inline-flex; align-items: center; padding: 3px 9px; background-color: #1f2733; border: 1px solid #2d333b; border-radius: 12px; font-size: 0.7rem; color: #c9d1d9; font-weight: 500; letter-spacing: 0.2px; }
        .roelca-money-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 0.85rem; }
        .roelca-money-row .lbl { color: #8b949e; font-weight: 400; }
        .roelca-money-row .val { color: #e6edf3; font-weight: 600; }
        .roelca-utility-box { margin-top: 10px; padding: 16px 18px; background: linear-gradient(135deg, rgba(63, 185, 80, 0.08), rgba(63, 185, 80, 0.02)); border: 1px solid rgba(63, 185, 80, 0.3); border-radius: 10px; }
        .roelca-utility-box.negative { background: linear-gradient(135deg, rgba(248, 81, 73, 0.08), rgba(248, 81, 73, 0.02)); border-color: rgba(248, 81, 73, 0.3); }
        .roelca-utility-label { font-size: 0.68rem; color: #7d8590; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
        .roelca-utility-value { font-size: 1.75rem; font-weight: 700; line-height: 1.1; color: #3fb950; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
        .roelca-utility-box.negative .roelca-utility-value { color: #f85149; }
        .roelca-form-footer { padding: 20px; border-top: 1px solid #1f2733; background-color: #0d1117; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
        .roelca-btn-primary { width: 100%; padding: 14px 18px; background: linear-gradient(180deg, #ea580c, #c2410c); color: white; border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center; gap: 8px; letter-spacing: 0.2px; box-shadow: 0 2px 4px rgba(234, 88, 12, 0.15), 0 4px 12px rgba(0,0,0,0.2); }
        .roelca-btn-primary:hover:not(:disabled) { background: linear-gradient(180deg, #f97316, #ea580c); transform: translateY(-1px); }
        .roelca-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .roelca-btn-outline { width: 100%; padding: 13px 18px; background: transparent; color: #c9d1d9; border: 1px solid #2d333b; border-radius: 9px; font-size: 0.88rem; font-weight: 500; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
        .roelca-btn-outline:hover { background-color: #1f2733; border-color: #3d444d; }
        .status-badge-ok { display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px; border-radius: 20px; background-color: rgba(63, 185, 80, 0.1); color: #3fb950; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; border: 1px solid rgba(63, 185, 80, 0.25); }
        .status-badge-error { display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px; border-radius: 20px; background-color: rgba(248, 81, 73, 0.1); color: #f85149; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; border: 1px solid rgba(248, 81, 73, 0.25); }
        .status-preview-card { padding: 14px 16px; background: linear-gradient(135deg, rgba(63, 185, 80, 0.06), rgba(63, 185, 80, 0.02)); border: 1px solid rgba(63, 185, 80, 0.25); border-radius: 10px; margin-bottom: 14px; }
        .status-error-card { padding: 14px 16px; background: linear-gradient(135deg, rgba(248, 81, 73, 0.06), rgba(248, 81, 73, 0.02)); border: 1px solid rgba(248, 81, 73, 0.25); border-radius: 10px; margin-bottom: 14px; }
        .roelca-lookup-row { display: flex; gap: 8px; align-items: flex-start; }
        .roelca-lookup-row > .roelca-lookup-input { flex: 1; min-width: 0; position: relative; }
        .campo-obligatorio-faltante, .campo-obligatorio-faltante:focus { border-color: #f85149 !important; background-color: rgba(248, 81, 73, 0.06) !important; box-shadow: 0 0 0 1px rgba(248, 81, 73, 0.35) !important; }
        @media (max-width: 1024px) { .roelca-form-shell { flex-direction: column; } .roelca-form-right { width: 100%; border-left: none; border-top: 1px solid #1f2733; max-height: 40vh; } }
      `}</style>

      <div className="roelca-form-shell" style={{ display: estado === 'minimizado' ? 'none' : 'flex' }}>
        <div className="roelca-form-left">
          <div className="roelca-form-header">
            <div>
              <h2>{initialData ? `Editar Operación ${initialData.ref || initialData.id?.substring(0,6)}` : 'Nueva Operación'}</h2>
              <p>{initialData ? 'Modifica los datos y guarda los cambios' : 'Completa el formulario para registrar una nueva operación'}</p>
            </div>
            <div className="fo-x7">
              {/* ✅ V00380: operación de PRUEBA — se elige al crear; su referencia lleva PR. */}
              {initialData ? (
                esPrueba && <span className="fo-prueba fo-prueba--fija" title="Operación de prueba: no entra a Facturación, Pagos, Nómina, Estadísticas, Reportes ni Saldos de Puentes">🧪 PRUEBA</span>
              ) : (
                <button
                  type="button"
                  className={`fo-prueba${esPrueba ? ' fo-prueba--activa' : ''}`}
                  onClick={() => setEsPrueba(v => !v)}
                  aria-pressed={esPrueba}
                  title={esPrueba ? 'Se guardará como PRUEBA (referencia PR.…). Clic para volver a operación real.' : 'Marcar como operación de prueba: no afecta Facturación, Pagos, Nómina, Estadísticas, Reportes ni Saldos de Puentes'}
                >
                  🧪 Prueba{esPrueba ? ' ✓' : ''}
                </button>
              )}
              <button type="button" onClick={() => { if (!idOperacion) { alert('Guarda la operación primero para poder adjuntarle documentos.'); return; } setMostrarSubirDoc(true); }} className="roelca-window-btn" title={idOperacion ? 'Subir documentos de la operación' : 'Guarda la operación primero'} style={{ width: 'auto', padding: '0 12px', gap: '6px', color: idOperacion ? '#fb923c' : '#6e7681', borderColor: idOperacion ? 'rgba(251,146,60,0.4)' : '#2d333b' }}>
                <IconFileText size={15} /> <span className="fo-x8">Documentos</span>
              </button>
              <button type="button" onClick={onMinimize} className="roelca-window-btn" title="Minimizar"><IconMinimize size={16} /></button>
              <button type="button" onClick={handleCancelarConfirmado} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
          </div>

          <div className="roelca-tabs">
            {pestanasVisibles.includes('general') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'general' ? 'active' : ''}`} onClick={() => setPestañaActiva('general')}><IconBriefcase size={15} /> Información General</button>)}
            {pestanasVisibles.includes('pedimento') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'pedimento' ? 'active' : ''}`} onClick={() => setPestañaActiva('pedimento')}><IconFileText size={15} /> Pedimento y CT</button>)}
            {pestanasVisibles.includes('manifiesto') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'manifiesto' ? 'active' : ''}`} onClick={() => setPestañaActiva('manifiesto')}><IconClipboard size={15} /> Entry's y Manifiestos</button>)}
            {pestanasVisibles.includes('unidad') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'unidad' ? 'active' : ''}`} onClick={() => setPestañaActiva('unidad')}><IconTruck size={15} /> Unidad y Operador</button>)}
            {pestanasVisibles.includes('cobrar') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'cobrar' ? 'active' : ''}`} onClick={() => setPestañaActiva('cobrar')}><IconDollar size={15} /> Por Cobrar</button>)}
          </div>

          <FormularioConfigurable modulo="operaciones">{/* ✅ V00385 */}
          <form className="fo-x9" onSubmit={handleSubmit}>
            <div className="roelca-scroll">
              {pestañaActiva === 'general' && pestanasVisibles.includes('general') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconBriefcase /></div><h3 className="roelca-card-title">Tipo de Servicio y Fechas</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label orange">Referencia <span className="campo-badge">ref</span></label>
                        {initialData ? (
                          <input type="text" name="referencia" className="form-control" value={referencia} onChange={(e) => setReferencia(e.target.value)} readOnly={!puedeEditarRef} title={puedeEditarRef ? 'Tienes permiso para corregir la referencia' : 'No tienes permiso para editar la referencia'} style={{ color: colorTipoOperacion(tiposOperacion?.find((op:any) => op.id === formData.tipoOperacionId)?.tipo_operacion), fontWeight: 'bold', ...(puedeEditarRef ? { borderColor: '#fb923c' } : { opacity: 0.65, cursor: 'not-allowed' }) }} />
                        ) : (
                          <input type="text" className="form-control fo-x10" value="Se generará al guardar" readOnly />
                        )}
                      </div>
                      <div className="form-group"><label className="form-label orange">Tipo de Operación <span className="campo-badge">tipoOperacionId</span></label><select name="tipoOperacionId" className={`form-control${claseSiFalta('tipoOperacionId')}`} value={formData.tipoOperacionId || ''} onChange={handleChange} required style={{ color: formData.tipoOperacionId ? colorTipoOperacion(tiposOperacion?.find((op:any) => op.id === formData.tipoOperacionId)?.tipo_operacion) : undefined, fontWeight: formData.tipoOperacionId ? 'bold' : undefined }}><option value="">-- Seleccionar --</option>{tiposOperacion?.map((op:any) => <option key={op.id} value={op.id} style={{ color: colorTipoOperacion(op.tipo_operacion), fontWeight: 'bold' }}>{op.tipo_operacion}</option>)}</select></div>
                      <div className="form-group"><label className="form-label orange">Fecha de Servicio <span className="campo-badge">fechaServicio</span></label><input type="date" name="fechaServicio" className={`form-control${claseSiFalta('fechaServicio')}`} value={formData.fechaServicio || ''} onChange={handleChange} required />{avisoTC}</div>
                      {isFletes && (<div className="form-group"><label className="form-label orange">Fecha de Cita <span className="campo-badge">fechaCita</span></label><input type="datetime-local" name="fechaCita" className={`form-control${claseSiFalta('fechaCita')}`} value={formData.fechaCita || ''} onChange={handleChange} /></div>)}
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconUsers /></div><h3 className="roelca-card-title">Cliente y Convenio</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Cliente (Paga) <span className="campo-badge">clientePaga</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('clientePaga')}`} placeholder="Escriba para buscar cliente..." required={!formData.clientePaga && !searchClientePaga} value={searchClientePaga} onChange={e => { setSearchClientePaga(e.target.value); setShowDropdownClientePaga(true); if (formData.clientePaga) setFormData(prev => ({ ...prev, clientePaga: '', convenio: '' })); }} onFocus={() => setShowDropdownClientePaga(true)} onBlur={() => setTimeout(() => setShowDropdownClientePaga(false), 200)} />
                            {showDropdownClientePaga && searchClientePaga && (
                              <div className="fo-x12">
                                {resultadosClientePaga.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosClientePaga.map((c:any) => (
                                  <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); const monedaDefault = resolverMonedaIdDeEmpresa(c); setFormData(prev => ({ ...prev, clientePaga: c.id, convenio: '', facturadoEnCobrar: monedaDefault })); setSearchClientePaga(razonSocialEmpresa(c)); setSearchConvenio(''); setShowDropdownClientePaga(false); }}>
                                    <div className="fo-x15">{razonSocialEmpresa(c)}</div>{/* ✅ V00271: razón social */}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* ✅ V00252: se retiró el botón "+" de alta rápida (los clientes y proveedores se dan de alta en Empresas / sus tarifarios). */}
                        </div>
                        {/* ✅ V00136: alerta de documentos DEBAJO del campo (no empuja el input) */}
                        {formData.clientePaga && <AlertaDocumentos coleccionOrigen="empresas" registroId={String(formData.clientePaga)} registroNombre={searchClientePaga} etiqueta="Cliente" />}
                      </div>
                      <div className="form-group">
                        <div className="fo-x16">
                          <label className="form-label fo-x17">Convenio (Tarifa) <span className="campo-badge">convenio</span></label>
                          {(formData.clientePaga || searchClientePaga) && (
                            <button className="fo-x18" type="button" onClick={() => setMostrarConveniosCliente(true)} title="Ver y editar los convenios (tarifas) de este cliente">
                              <IconReceipt size={12} /> Ver / editar ({listaConveniosCliente.length})
                            </button>
                          )}
                          {/* ✅ V00126: editar la MONEDA/tarifa del detalle elegido, directo desde aquí */}
                          {formData.convenio && <button className="fo-x18 fo-btn-det" type="button" onClick={() => setDetalleConvenioEdit({ tipo: 'cliente', detalleId: String(formData.convenio) })} title="Ver y editar el detalle del convenio elegido">▤ Detalle del convenio</button>}
                          {/* ✅ V00242: trae el monto vigente del convenio */}
                          {formData.convenio && <button className="fo-x18 fo-btn-actualizar" type="button" onClick={() => actualizarMontoConvenio('cliente')} title="Traer los datos vigentes del convenio: monto, moneda, sueldo del operador, combustible, servicio, tráfico y carga">↻ Actualizar convenio</button>}
                          {/* ✅ V00224: origen/destino de las tarifas (solo fletes y con permiso) */}
                          {isFletes && puedeClave('editarTarifaOrigenDestino') && (
                            <button className="fo-x18 fo-btn-tarifa-od" type="button" onClick={() => setEditorTarifaOD(true)} title="Asignar el origen y destino de las tarifas de esta operación">✎ Origen/Destino</button>
                          )}
                        </div>
                        <div className="fo-x19">
                          {/* ✅ V00271: el convenio YA NO se busca aquí — se ELIGE en el modal
                              "Convenios del Cliente" (clic en el campo o en Ver/editar); el
                              campo solo muestra el convenio seleccionado. */}
                          <input type="text" className={`form-control fo-campo-convenio${claseSiFalta('convenio')}`} placeholder={listaConveniosCliente.length === 0 ? 'Este cliente no tiene convenios' : 'Presiona aquí para elegir el convenio…'} required={!formData.convenio} disabled={listaConveniosCliente.length === 0} value={searchConvenio} readOnly onClick={() => { if (listaConveniosCliente.length > 0) setMostrarConveniosCliente(true); }} title="El convenio se elige desde la lista de convenios del cliente (clic para abrirla)" />
                        </div>
                        {listaConveniosCliente.length === 0 && searchClientePaga && <small className="fo-x21">Este cliente no tiene convenios asignados</small>}
                      </div>
                      <div className="form-group">
                        <label className="form-label">Importación / Exportación <span className="campo-badge">trafico</span></label>
                        <input type="text" className="form-control fo-x22" value={(formData.trafico && formData.trafico !== 'N/A') ? formData.trafico : ''} readOnly placeholder="Se define por el convenio" title="Se asigna automáticamente según el convenio (no editable)" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Cargada / Vacía <span className="campo-badge">carga</span></label>
                        <input type="text" className="form-control fo-x22" value={(formData.carga && formData.carga !== 'N/A') ? formData.carga : ''} readOnly placeholder="Se define por el convenio" title="Se asigna automáticamente según el convenio (no editable)" />
                      </div>
                      <div className="form-group">
                        <label className="form-label"># de Remolque <span className="campo-badge">numeroRemolque</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('numeroRemolque')}`} placeholder="Buscar remolque..." value={searchRemolque} onChange={e => { setSearchRemolque(e.target.value); setShowDropdownRemolque(true); if (formData.numeroRemolque) setFormData(prev => ({ ...prev, numeroRemolque: '' })); }} onFocus={() => setShowDropdownRemolque(true)} onBlur={() => setTimeout(() => setShowDropdownRemolque(false), 200)} />
                            {showDropdownRemolque && searchRemolque && (<div className="fo-x12">{resultadosRemolque.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosRemolque.map((r:any) => (<div className="fo-x14" key={r.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, numeroRemolque: r.id })); setSearchRemolque(labelRemolque(r)); setShowDropdownRemolque(false); }}><div className="fo-x15">{labelRemolque(r)}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Remolque" onClick={() => abrirCreacion({ tipo: 'remolque', coleccion: 'remolques' }, (id, reg) => { setFormData(prev => ({ ...prev, numeroRemolque: id })); setSearchRemolque(labelRemolque(reg)); })} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Ref Cliente <span className="campo-badge">refCliente</span></label><input type="text" name="refCliente" className={`form-control${claseSiFalta('refCliente')}${dupRefVisible && !refClienteYaRevisada(claveRefActual) ? ' fo-ref-dup-input' : ''}`} value={formData.refCliente || ''} onChange={handleChange} onBlur={(e) => { void verificarRefClienteDuplicada(e.target.value, false); }} />
                        {/* ✅ V00450: aviso de Ref Cliente duplicada */}
                        {dupRefVisible && (
                          <div className={`fo-ref-dup${refClienteYaRevisada(claveRefActual) ? ' fo-ref-dup--revisada' : ''}`} role="alert">
                            {refClienteYaRevisada(claveRefActual)
                              ? <>Esta Ref Cliente también está en otra(s) operación(es); ya se marcó como <b>No es duplicado</b>:</>
                              : <><b>⚠️ Ref Cliente duplicada.</b> Ya existe en:</>}
                            <ul className="fo-ref-dup-lista">
                              {refClienteDup.otras.slice(0, 5).map((o) => (
                                <li key={o.id}><b>{o.ref || 'sin ref'}</b>{o.clienteNombre ? ` · ${o.clienteNombre}` : ''} · {etiquetaEstado(o)}</li>
                              ))}
                              {refClienteDup.otras.length > 5 && <li>y {refClienteDup.otras.length - 5} más</li>}
                            </ul>
                            {!refClienteYaRevisada(claveRefActual) && <span>Puedes guardar; la operación irá a la pestaña <b>Revisión</b>.</span>}
                          </div>
                        )}
                      </div>
                      {/* ✅ V00470: ADUANA debajo de Cargada / Vacía (solo Transfer, como en Reglas de Estatus): la del
                          convenio (la que guarda el servidor, o la del nombre del convenio / su tarifa). Elige el flujo de estatus. */}
                      {isTransfer && !normPuente(formData.trafico).includes('movimiento') && ( // ✅ V00474: los movimientos no cruzan aduana
                        <div className="form-group">
                          <label className="form-label">Aduana <span className="campo-badge">aduanaNombre</span></label>
                          <input type="text" className="form-control fo-x22" value={aduanaForm} readOnly placeholder="Se define por el convenio" title="Se asigna automáticamente según el convenio (no editable)" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconRoute /></div><h3 className="roelca-card-title">Ruta y Observaciones</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label orange">Origen <span className="campo-badge">origen</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('origen')}`} placeholder="Buscar origen..." value={searchOrigen} onChange={e => { setSearchOrigen(e.target.value); setShowDropdownOrigen(true); }} onFocus={() => setShowDropdownOrigen(true)} onBlur={() => setTimeout(() => setShowDropdownOrigen(false), 200)} />
                            {showDropdownOrigen && searchOrigen && (<div className="fo-x12">{resultadosOrigen.map((o:any) => (<div className="fo-x14" key={o.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, origen: o.id })); setSearchOrigen(nombreEmpresaMostrar(o)); setShowDropdownOrigen(false); }}><div className="fo-x23">{nombreEmpresaMostrar(o)}{paisDeEmpresaOD(o) && <span style={{ fontSize: '0.65rem', fontWeight: 'bold', padding: '1px 6px', borderRadius: '999px', border: `1px solid ${paisDeEmpresaOD(o) === 'USA' ? '#3b82f6' : '#3fb950'}`, backgroundColor: paisDeEmpresaOD(o) === 'USA' ? 'rgba(59,130,246,0.15)' : 'rgba(63,185,80,0.15)', color: paisDeEmpresaOD(o) === 'USA' ? '#3b82f6' : '#3fb950' }}>{paisDeEmpresaOD(o) === 'USA' ? 'EE.UU.' : 'MX'}</span>}</div><div style={{ fontSize: '0.8rem', fontWeight: 500, color: paisDeEmpresaOD(o) === 'USA' ? '#3b82f6' : paisDeEmpresaOD(o) === 'MX' ? '#3fb950' : '#8b949e' }}>{direccionFormateadaOD(o)}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Origen/Destino" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_ORIGEN_DESTINO }, (id, reg) => { setFormData(prev => ({ ...prev, origen: id })); setSearchOrigen(labelEmpresa(reg)); })} />
                        </div>
                        {/* ✅ V00214: municipio del catálogo (no editable) */}
                        {formData.origen && (
                          <div className="fo-municipio">
                            <span className="fo-municipio-lbl">Municipio</span>
                            <input type="text" className="form-control fo-municipio-input" value={municipioDeEmpresaOD(formData.origen) || '—'} readOnly disabled />
                          </div>
                        )}
                        {/* ✅ V00136: alerta de documentos del origen/destino */}
                        {formData.origen && <AlertaDocumentos coleccionOrigen="empresas" registroId={String(formData.origen)} registroNombre={searchOrigen} etiqueta="Origen" />}
                      </div>
                      <div className="form-group">
                        <label className="form-label orange">Destino <span className="campo-badge">destino</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('destino')}`} placeholder="Buscar destino..." value={searchDestino} onChange={e => { setSearchDestino(e.target.value); setShowDropdownDestino(true); }} onFocus={() => setShowDropdownDestino(true)} onBlur={() => setTimeout(() => setShowDropdownDestino(false), 200)} />
                            {showDropdownDestino && searchDestino && (<div className="fo-x12">{resultadosDestino.map((d:any) => (<div className="fo-x14" key={d.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, destino: d.id })); setSearchDestino(nombreEmpresaMostrar(d)); setShowDropdownDestino(false); }}><div className="fo-x23">{nombreEmpresaMostrar(d)}{paisDeEmpresaOD(d) && <span style={{ fontSize: '0.65rem', fontWeight: 'bold', padding: '1px 6px', borderRadius: '999px', border: `1px solid ${paisDeEmpresaOD(d) === 'USA' ? '#3b82f6' : '#3fb950'}`, backgroundColor: paisDeEmpresaOD(d) === 'USA' ? 'rgba(59,130,246,0.15)' : 'rgba(63,185,80,0.15)', color: paisDeEmpresaOD(d) === 'USA' ? '#3b82f6' : '#3fb950' }}>{paisDeEmpresaOD(d) === 'USA' ? 'EE.UU.' : 'MX'}</span>}</div><div style={{ fontSize: '0.8rem', fontWeight: 500, color: paisDeEmpresaOD(d) === 'USA' ? '#3b82f6' : paisDeEmpresaOD(d) === 'MX' ? '#3fb950' : '#8b949e' }}>{direccionFormateadaOD(d)}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Origen/Destino" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_ORIGEN_DESTINO }, (id, reg) => { setFormData(prev => ({ ...prev, destino: id })); setSearchDestino(labelEmpresa(reg)); })} />
                        </div>
                        {/* ✅ V00136: alerta de documentos del origen/destino */}
                        {/* ✅ V00214: municipio del catálogo (no editable) */}
                        {formData.destino && (
                          <div className="fo-municipio">
                            <span className="fo-municipio-lbl">Municipio</span>
                            <input type="text" className="form-control fo-municipio-input" value={municipioDeEmpresaOD(formData.destino) || '—'} readOnly disabled />
                          </div>
                        )}
                        {formData.destino && <AlertaDocumentos coleccionOrigen="empresas" registroId={String(formData.destino)} registroNombre={searchDestino} etiqueta="Destino" />}
                      </div>
                      {/* ✅ NUEVO: kilometraje estimado del viaje (junto a Destino) */}
                      <div className="form-group">
                        <label className="form-label">Kilometraje Estimado <span className="campo-badge">kilometrajeEstimado</span></label>
                        <input type="number" min="0" step="1" name="kilometrajeEstimado" className={`form-control${claseSiFalta('kilometrajeEstimado')}`} value={formData.kilometrajeEstimado ?? ''} onChange={handleChange} placeholder="km" />
                      </div>
                      <div className="form-group fo-x24"><label className="form-label">Observaciones Ejecutivo <span className="campo-badge">observacionesEjecutivo</span></label><input type="text" name="observacionesEjecutivo" className={`form-control${claseSiFalta('observacionesEjecutivo')}`} value={formData.observacionesEjecutivo || ''} onChange={handleChange} /></div>
                    </div>
                  </div>
                </>
              )}

              {pestañaActiva === 'pedimento' && pestanasVisibles.includes('pedimento') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconPackage /></div><h3 className="roelca-card-title">Cliente y Mercancía</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Cliente (Mercancía) <span className="campo-badge">clienteMercancia</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('clienteMercancia')}`} placeholder="Buscar cliente de mercancía..." value={searchClienteMercancia} onChange={e => { setSearchClienteMercancia(e.target.value); setShowDropdownClienteMercancia(true); if (formData.clienteMercancia) setFormData(prev => ({ ...prev, clienteMercancia: '' })); }} onFocus={() => setShowDropdownClienteMercancia(true)} onBlur={() => setTimeout(() => setShowDropdownClienteMercancia(false), 200)} />
                            {showDropdownClienteMercancia && searchClienteMercancia && (
                              <div className="fo-x12">
                                {resultadosClienteMercancia.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosClienteMercancia.map((c:any) => (
                                  <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, clienteMercancia: c.id })); setSearchClienteMercancia(razonSocialEmpresa(c)); setShowDropdownClienteMercancia(false); }}>{/* ✅ V00354: razón social */}
                                    <div className="fo-x15">{razonSocialEmpresa(c)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <BotonAgregar title="Agregar nuevo Cliente (Mercancía)" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_CLIENTE_MERCANCIA }, (id, reg) => { setFormData(prev => ({ ...prev, clienteMercancia: id })); setSearchClienteMercancia(razonSocialEmpresa(reg)); })} />{/* ✅ V00282: alta rápida de vuelta SOLO en Cliente (Mercancía) */}
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Descripción de Mercancía <span className="campo-badge">descripcionMercancia</span></label><input type="text" name="descripcionMercancia" className={`form-control${claseSiFalta('descripcionMercancia')}`} value={formData.descripcionMercancia || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Cantidad <span className="campo-badge">cantidad</span></label><input type="text" name="cantidad" className={`form-control${claseSiFalta('cantidad')}`} value={formData.cantidad || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Embalaje <span className="campo-badge">embalaje</span></label><select name="embalaje" className={`form-control${claseSiFalta('embalaje')}`} value={formData.embalaje || ''} onChange={handleChange}><option value="">-- Seleccionar --</option>{(embalajesLocal || []).map((em:any) => ({ id: String(em.id), texto: String(em.clave ?? em.Clave ?? em.CLAVE ?? em.embalaje ?? em.nombre ?? em.descripcion ?? em.tipo ?? '').trim() })).filter((o:any) => o.texto !== '').sort((a:any, b:any) => a.texto.localeCompare(b.texto, 'es', { sensitivity: 'base' })).map((o:any) => <option key={o.id} value={o.id}>{o.texto}</option>)}</select></div>
                      <div className="form-group"><label className="form-label">Peso (Kg) <span className="campo-badge">pesoKg</span></label><input type="number" name="pesoKg" className={`form-control${claseSiFalta('pesoKg')}`} value={formData.pesoKg || ''} onChange={handleChange} /></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconFileText /></div><h3 className="roelca-card-title">Documentación (Carta Porte / DODA)</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># DODA <span className="campo-badge">numDoda</span></label><input type="text" name="numDoda" className={`form-control${claseSiFalta('numDoda')}`} value={formData.numDoda || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Fecha Emisión DODA <span className="campo-badge">fechaEmisionDoda</span></label><input type="date" name="fechaEmisionDoda" className={`form-control${claseSiFalta('fechaEmisionDoda')}`} value={formData.fechaEmisionDoda || ''} onChange={handleChange} /></div>
                      <CampoArchivo label="PDF Carta Porte" adjuntos={adjuntosDeCampo(formData.pdfCartaPorte)} resaltar={camposObligatoriosFaltantesSet.has('pdfCartaPorte')} onCambiar={(l) => handleAdjuntosChange('pdfCartaPorte', l)} />
                      <CampoArchivo label="PDF DODA" adjuntos={adjuntosDeCampo(formData.pdfDoda)} resaltar={camposObligatoriosFaltantesSet.has('pdfDoda')} onCambiar={(l) => handleAdjuntosChange('pdfDoda', l)} />
                    </div>
                  </div>
                  {/* ✅ V00341: los documentos YA GUARDADOS de esta operación —
                      aquí mismo se consultan, abren y administran. Los PDF de
                      arriba se suben AL GUARDAR la operación. */}
                  {idOperacion && (
                    <div className="roelca-card">
                      <div className="roelca-card-header"><div className="roelca-card-icon"><IconFileText /></div><h3 className="roelca-card-title">Documentos guardados de esta operación</h3></div>
                      <DocumentosLista coleccionOrigen="operaciones" registroId={idOperacion} />
                    </div>
                  )}
                </>
              )}

              {pestañaActiva === 'manifiesto' && pestanasVisibles.includes('manifiesto') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconClipboard /></div><h3 className="roelca-card-title">Entry's</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># de Entry's <span className="campo-badge">numeroEntrys</span></label><input type="text" name="numeroEntrys" className={`form-control${claseSiFalta('numeroEntrys')}`} value={formData.numeroEntrys || ''} onChange={handleChange} /></div>
                      <div className="form-group">
                        <label className="form-label">Cantidad de Entry's <span className="campo-badge">cantEntrys</span></label>
                        <input type="number" min={0} name="cantEntrys" className={`form-control${claseSiFalta('cantEntrys')}`} value={formData.cantEntrys || 0} onChange={(e) => { const n = Math.max(0, parseInt(e.target.value || '0', 10) || 0); setFormData(prev => { const arr = [...(prev.pdfsEntrys || [])]; arr.length = n; return { ...prev, cantEntrys: n, pdfsEntrys: arr }; }); }} />
                      </div>
                    </div>
                    {Number(formData.cantEntrys) > 0 && (
                      <div className="form-grid fo-x25">
                        {Array.from({ length: Number(formData.cantEntrys) }).map((_, i) => (
                          <CampoArchivo key={i} label={`PDF Entry #${i + 1}`} adjuntos={adjuntosDeCampo(formData.pdfsEntrys?.[i])} onCambiar={(l) => handleAdjuntosEntry(i, l)} />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconReceipt /></div><h3 className="roelca-card-title">Manifiesto</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># Manifiesto <span className="campo-badge">numManifiesto</span></label><input type="text" name="numManifiesto" className={`form-control${claseSiFalta('numManifiesto')}`} value={formData.numManifiesto || ''} onChange={handleChange} /></div>
                      <div className="form-group">
                        <label className="form-label">Proveedor de Servicios <span className="campo-badge">provServicios</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('provServicios')}`} placeholder="Buscar proveedor de servicios..." value={searchProvServicios} onChange={e => { setSearchProvServicios(e.target.value); setShowDropdownProvServicios(true); if (formData.provServicios) setFormData(prev => ({ ...prev, provServicios: '' })); }} onFocus={() => setShowDropdownProvServicios(true)} onBlur={() => setTimeout(() => setShowDropdownProvServicios(false), 200)} />
                            {showDropdownProvServicios && searchProvServicios && (
                              <div className="fo-x12">
                                {resultadosProvServicios.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosProvServicios.map((c:any) => (
                                  <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, provServicios: c.id, montoManifiesto: montoManifiestoDeProveedor(c) })); setSearchProvServicios(nombreEmpresaMostrar(c)); setShowDropdownProvServicios(false); }}>
                                    <div className="fo-x15">{nombreEmpresaMostrar(c)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* ✅ V00252: se retiró el botón "+" de alta rápida (los clientes y proveedores se dan de alta en Empresas / sus tarifarios). */}
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Costo Manifiesto <span className="campo-badge">montoManifiesto</span></label>
                        <ConSimboloMoneda><input type="number" step="0.01" name="montoManifiesto" className={`form-control${claseSiFalta('montoManifiesto')}`} value={formData.montoManifiesto || 0} onChange={handleChange} /></ConSimboloMoneda>
                        <small className="fo-x21">Costo por defecto: ${COSTO_MANIFIESTO_DEFAULT.toFixed(2)}</small>
                      </div>
                      <CampoArchivo label="PDF Manifiesto" adjuntos={adjuntosDeCampo(formData.pdfManifiesto)} resaltar={camposObligatoriosFaltantesSet.has('pdfManifiesto')} onCambiar={(l) => handleAdjuntosChange('pdfManifiesto', l)} />
                    </div>
                  </div>
                </>
              )}

              {pestañaActiva === 'unidad' && pestanasVisibles.includes('unidad') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconTruck /></div><h3 className="roelca-card-title">Proveedor de Transporte</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Proveedor de Transporte <span className="campo-badge">proveedorUnidad</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('proveedorUnidad')}`} placeholder="Buscar proveedor de transporte..." value={searchProvTransporte} disabled={proveedorForzado} onChange={e => { setSearchProvTransporte(e.target.value); setShowDropdownProvTransporte(true); if (formData.proveedorUnidad) setFormData(prev => ({ ...prev, proveedorUnidad: '', convenioProveedor: '' })); }} onFocus={() => setShowDropdownProvTransporte(true)} onBlur={() => setTimeout(() => setShowDropdownProvTransporte(false), 200)} style={proveedorForzado ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} />
                            {showDropdownProvTransporte && searchProvTransporte && !proveedorForzado && (
                              <div className="fo-x12">
                                {resultadosProvTransporte.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosProvTransporte.map((c:any) => (
                                  <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); const monedaDefault = resolverMonedaIdDeEmpresa(c); setFormData(prev => ({ ...prev, proveedorUnidad: c.id, convenioProveedor: '', facturadoEnUnidad: monedaDefault || prev.facturadoEnUnidad })); setSearchProvTransporte(razonSocialEmpresa(c)); setSearchConvenioProveedor(''); setShowDropdownProvTransporte(false); }}>
                                    {/* ✅ V00389: se busca y se ve por NOMBRE CORTO; al elegirlo queda la RAZÓN SOCIAL */}
                                    <div className="fo-x15">{nombreCortoEmpresa(c) || razonSocialEmpresa(c)}</div>
                                    {nombreCortoEmpresa(c) && nombreCortoEmpresa(c).toLowerCase() !== razonSocialEmpresa(c).toLowerCase() && <div className="fo-prov-razon">{razonSocialEmpresa(c)}</div>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* ✅ V00252: se retiró el botón "+" de alta rápida (los clientes y proveedores se dan de alta en Empresas / sus tarifarios). */}
                        </div>
                        {/* ✅ V00136: alerta de documentos DEBAJO del campo (no empuja el input) */}
                        {formData.proveedorUnidad && <AlertaDocumentos coleccionOrigen="empresas" registroId={String(formData.proveedorUnidad)} registroNombre={searchProvTransporte} etiqueta="Proveedor" />}
                      </div>

                      {!esFlotaPropiaRoelca && (
                      <div className="form-group">
                        <div className="fo-x16">
                          <label className="form-label fo-x17">Convenio Proveedor <span className="campo-badge">convenioProveedor</span></label>
                          {(formData.proveedorUnidad || searchProvTransporte) && (
                            <button className="fo-x18" type="button" onClick={() => setMostrarConveniosProveedor(true)} title="Ver y editar los convenios (tarifas) de este proveedor">
                              <IconReceipt size={12} /> Ver / editar ({listaConveniosProveedor.length})
                            </button>
                          )}
                          {/* ✅ V00126: editar la MONEDA/tarifa del detalle elegido, directo desde aquí */}
                          {formData.convenioProveedor && <button className="fo-x18 fo-btn-det" type="button" onClick={() => setDetalleConvenioEdit({ tipo: 'proveedor', detalleId: String(formData.convenioProveedor) })} title="Ver y editar el detalle del convenio elegido">▤ Detalle del convenio</button>}
                          {/* ✅ V00242 */}
                          {formData.convenioProveedor && <button className="fo-x18 fo-btn-actualizar" type="button" onClick={() => actualizarMontoConvenio('proveedor')} title="Traer el monto actual del convenio del proveedor">↻ Actualizar monto</button>}
                        </div>
                        <div className="fo-x19">
                          {/* ✅ V00271: igual que el cliente — el convenio se ELIGE en el modal */}
                          <input type="text" className={`form-control fo-campo-convenio${claseSiFalta('convenioProveedor')}`} placeholder={listaConveniosProveedor.length === 0 ? 'Este proveedor no tiene convenios' : 'Presiona aquí para elegir el convenio…'} disabled={listaConveniosProveedor.length === 0} value={searchConvenioProveedor} readOnly onClick={() => { if (listaConveniosProveedor.length > 0) setMostrarConveniosProveedor(true); }} title="El convenio se elige desde la lista de convenios del proveedor (clic para abrirla)" />
                        </div>
                        {listaConveniosProveedor.length === 0 && searchProvTransporte && <small className="fo-x21">Este proveedor no tiene convenios asignados</small>}
                      </div>
                      )}

                      {!esFlotaPropiaRoelca && (
                      <div className="form-group">
                        <label className="form-label">Facturado En <span className="campo-badge">facturadoEnUnidad</span></label>
                        {/* ✅ V00129: re-sincronizar con la moneda actual de la empresa */}
                        <button type="button" className="fo-btn-act-moneda" disabled={actualizandoMoneda === 'proveedor'} onClick={() => actualizarMonedaDesdeEmpresa('proveedor')} title="Vuelve a leer la moneda del proveedor en la tabla Empresas y la aplica a este registro">{actualizandoMoneda === 'proveedor' ? '⏳…' : '⟳ Actualizar moneda'}</button>
                        {/* ✅ CAMBIO: ahora EDITABLE — se precarga del proveedor,
                            pero puedes corregir en qué moneda se factura. */}
                        {/* ✅ V00132: EDITABLE otra vez a petición — se precarga de la empresa (y "⟳ Actualizar moneda" la re-sincroniza), pero aquí puedes corregirla para esta operación */}
                        {/* ✅ V00490: fija a la moneda de la empresa; solo se elige si la empresa no tiene moneda */}
                        <div onMouseDownCapture={() => campoBloqueadoAut('facturadoEnUnidad') && clicCampoBloqueado('facturadoEnUnidad')}><select disabled={campoBloqueadoAut('facturadoEnUnidad') || !!monedaFijaProveedor} title={monedaFijaProveedor ? 'Es la moneda del proveedor en Empresas; no se cambia aquí' : campoBloqueadoAut('facturadoEnUnidad') ? 'La moneda viene de la tabla Empresas y está bloqueada por Autorizaciones para tu rol (usa ⟳ Actualizar moneda para re-sincronizarla)' : 'El proveedor no tiene moneda en Empresas: elígela aquí'} style={campoBloqueadoAut('facturadoEnUnidad') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} className="form-control fo-moneda-fija" value={formData.facturadoEnUnidad || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, facturadoEnUnidad: e.target.value }))}
                          >
                          <option value="">— Sin definir —</option>
                          {opcionesFacturadoEn().map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                        </select></div>
                      </div>
                      )}
                    </div>
                  </div>

                  {showInternalFleet && (
                    <div className="roelca-card">
                      <div className="roelca-card-header"><div className="roelca-card-icon"><IconTruck /></div><h3 className="roelca-card-title">Flota Interna (Roelca)</h3></div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label className="form-label">Unidad <span className="campo-badge">unidad</span></label>
                          <div className="roelca-lookup-row">
                            <div className="roelca-lookup-input">
                              <input type="text" className={`form-control${claseSiFalta('unidad')}`} placeholder="Buscar unidad..." value={searchUnidad} onChange={e => { setSearchUnidad(e.target.value); setShowDropdownUnidad(true); if (formData.unidad) setFormData(prev => ({ ...prev, unidad: '' })); }} onFocus={() => setShowDropdownUnidad(true)} onBlur={() => setTimeout(() => setShowDropdownUnidad(false), 200)} />
                              {showDropdownUnidad && searchUnidad && (
                                <div className="fo-x12">
                                  {resultadosUnidad.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosUnidad.map((u:any) => (
                                    <div className="fo-x14" key={u.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, unidad: u.id })); setSearchUnidad(labelUnidad(u)); setShowDropdownUnidad(false); }}>
                                      <div className="fo-x15">{labelUnidad(u)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <BotonAgregar title="Agregar nueva Unidad" onClick={() => abrirCreacion({ tipo: 'unidad', coleccion: 'unidades' }, (id, reg) => { setFormData(prev => ({ ...prev, unidad: id })); setSearchUnidad(labelUnidad(reg)); })} />
                          </div>
                          {/* ✅ V00136: alerta de documentos DEBAJO del campo (no empuja el input) */}
                          {formData.unidad && <AlertaDocumentos coleccionOrigen="unidades" registroId={String(formData.unidad)} registroNombre={searchUnidad} etiqueta="Unidad" />}
                          {/* ✅ NUEVO: último servicio y última carga de diesel de la unidad */}
                          {formData.unidad && (
                            <div style={{ marginTop: '6px', fontSize: '0.75rem', lineHeight: 1.6, color: '#8b949e' }}>
                              {cargandoInfoUnidad ? (
                                <span>Consultando historial de la unidad…</span>
                              ) : infoUnidad ? (
                                <>
                                  <span style={{ display: 'block' }}>
                                    {/* ✅ V00213: sin fecha — la referencia ya la lleva */}
                                    Último servicio: {infoUnidad.ultimaOpRef
                                      ? <b style={{ color: '#58a6ff' }}>{infoUnidad.ultimaOpRef}</b>
                                      : <span>sin servicios previos</span>}
                                  </span>
                                  <span style={{ display: 'block' }}>
                                    {/* ✅ V00213: sin fecha — el consecutivo del diesel ya la lleva */}
                                    Última carga diesel: {infoUnidad.dieselConsecutivo
                                      ? <><b style={{ color: '#D84315' }}>{infoUnidad.dieselConsecutivo}</b>{infoUnidad.dieselGalones ? ` · ${infoUnidad.dieselGalones.toFixed(2)} gal` : ''}</>
                                      : <span>sin recargas registradas</span>}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          )}
                        </div>
                        <div className="form-group">
                          <label className="form-label">Operador <span className="campo-badge">operador</span></label>
                          <div className="roelca-lookup-row">
                            <div className="roelca-lookup-input">
                              <input type="text" className={`form-control${claseSiFalta('operador')}`} placeholder="Buscar operador..." value={searchOperador} onChange={e => { setSearchOperador(e.target.value); setShowDropdownOperador(true); if (formData.operador) setFormData(prev => ({ ...prev, operador: '' })); }} onFocus={() => setShowDropdownOperador(true)} onBlur={() => setTimeout(() => setShowDropdownOperador(false), 200)} />
                              {showDropdownOperador && searchOperador && (
                                <div className="fo-x12">
                                  {resultadosOperador.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosOperador.map((o:any) => (
                                    <div className="fo-x14" key={o.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, operador: o.id })); setSearchOperador(labelEmpleado(o)); setShowDropdownOperador(false); }}>
                                      <div className="fo-x15">{labelEmpleado(o)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <BotonAgregar title="Agregar nuevo Operador" onClick={() => abrirCreacion({ tipo: 'empleado', coleccion: 'empleados' }, (id, reg) => { setFormData(prev => ({ ...prev, operador: id })); setSearchOperador(labelEmpleado(reg)); })} />
                          </div>
                          {/* ✅ V00136: alerta de documentos DEBAJO del campo (no empuja el input) */}
                          {formData.operador && <AlertaDocumentos coleccionOrigen="empleados" registroId={String(formData.operador)} registroNombre={searchOperador} etiqueta="Operador" />}
                        </div>
                        {/* Sueldo/Combustible base: BLOQUEADOS (vienen del tarifario de rendimientos). Los totales son calculados. */}
                        <div className="form-group"><label className="form-label">Sueldo Operador <span className="campo-badge">sueldoOperador</span></label><ConSimboloMoneda><input type="number" className="form-control fo-sueldo-fijo" value={formData.sueldoOperador || 0} readOnly onClick={() => campoBloqueadoAut('sueldoOperador') && clicCampoBloqueado('sueldoOperador')} title={campoBloqueadoAut('sueldoOperador') ? 'Bloqueado por autorizaciones para tu rol' : 'Se toma del tarifario de rendimientos; para cambiarlo usa "✎ Cambiar sueldo" (pide el motivo)'} /></ConSimboloMoneda>
                          {/* ✅ V00433: el sueldo solo se cambia a mano CON MOTIVO (queda en el detalle de la operación) */}
                          <CambioSueldoOperador
                            op={{ ...(initialData || {}), ...formData, id: (initialData as { id?: unknown } | undefined)?.id, _docId: (initialData as { _docId?: unknown } | undefined)?._docId }}
                            modulo="Operaciones (formulario)" modo="formulario" deshabilitado={campoBloqueadoAut('sueldoOperador')}
                            onGuardado={(campos) => setFormData(prev => ({ ...prev, ...campos }))} />
                          <HistorialCambiosSueldo cambios={(formData as { cambiosSueldo?: unknown }).cambiosSueldo ?? (initialData as { cambiosSueldo?: unknown } | undefined)?.cambiosSueldo} />
                          {/* ✅ V00406: trompo viejo con sueldo → se corrige solo al presionar */}
                          {/* ✅ V00408: visible aunque el campo esté bloqueado por autorizaciones (es la regla del trompo, no una edición libre) */}
                          {esTrompoOp && Number(formData.sueldoOperador) > 0 && (
                            <button type="button" className="fo-btn-trompo" title="Trompo: el sueldo del operador es $0; si hace falta un monto, agrégalo en Costos Adicionales"
                              onClick={() => { if (window.confirm(`Esta operación es TROMPO. ¿Poner el Sueldo Operador en $0? (antes ${fmtMoney(Number(formData.sueldoOperador) || 0)})\n\nSi hace falta un monto, agrégalo en Costos Adicionales.`)) setFormData(prev => ({ ...prev, sueldoOperador: 0, sueldoMitadAplicada: false })); }}>
                              Actualizar sueldo (Trompo = $0)
                            </button>
                          )}
                        </div>
                        <div className="form-group"><label className="form-label">Sueldo Extra <span className="campo-badge">sueldoExtra</span></label><ConSimboloMoneda><input type="number" step="0.01" name="sueldoExtra" className="form-control" value={formData.sueldoExtra || 0} onChange={handleChange} /></ConSimboloMoneda></div>
                        <div className="form-group"><label className="form-label">Sueldo Total <span className="campo-badge">sueldoTotal</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x22" value={formData.sueldoTotal || 0} readOnly /></ConSimboloMoneda></div>
                        {/* Notas del Sueldo Extra: solo aparecen cuando el extra es distinto de 0. */}
                        {Number(formData.sueldoExtra) !== 0 && (
                          <div className="form-group fo-x24"><label className="form-label fo-x26">Notas del Sueldo Extra <span className="campo-badge">sueldoExtraNotas</span></label><input type="text" name="sueldoExtraNotas" className="form-control" placeholder="Motivo del sueldo extra..." value={formData.sueldoExtraNotas || ''} onChange={handleChange} /></div>
                        )}
                        <div className="form-group"><label className="form-label">Combustible <span className="campo-badge">combustible</span></label><input type="number" step="1" className="form-control" value={Math.round(Number(formData.combustible) || 0)} readOnly={campoBloqueadoAut('combustible')} onClick={() => campoBloqueadoAut('combustible') && clicCampoBloqueado('combustible')} onChange={e => setFormData(prev => ({ ...prev, combustible: Number(e.target.value) || 0 }))} title={campoBloqueadoAut('combustible') ? 'Bloqueado por autorizaciones para tu rol' : 'Se toma del tarifario de rendimientos; puedes ajustarlo manualmente'} style={campoBloqueadoAut('combustible') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} /></div>
                        <div className="form-group"><label className="form-label">Combustible Extra <span className="campo-badge">combustibleExtra</span></label><input type="number" step="1" className="form-control" value={Math.round(Number(formData.combustibleExtra) || 0)} onChange={(e) => setFormData(prev => ({ ...prev, combustibleExtra: Math.round(Number(e.target.value) || 0) }))} /></div>
                        <div className="form-group"><label className="form-label">Combustible Total <span className="campo-badge">combustibleTotal</span></label><input type="number" step="1" className="form-control fo-x22" value={Math.round(Number(formData.combustibleTotal) || 0)} readOnly /></div>
                        {/* Notas del Combustible Extra: solo aparecen cuando el extra es distinto de 0. */}
                        {Number(formData.combustibleExtra) !== 0 && (
                          <div className="form-group fo-x24"><label className="form-label fo-x26">Notas del Combustible Extra <span className="campo-badge">combustibleExtraNotas</span></label><input type="text" name="combustibleExtraNotas" className="form-control" placeholder="Motivo del combustible extra..." value={formData.combustibleExtraNotas || ''} onChange={handleChange} /></div>
                        )}
                      </div>
                    </div>
                  )}

                  {showExternalFleet && (
                    <div className="roelca-card">
                      <div className="roelca-card-header"><div className="roelca-card-icon"><IconTruck /></div><h3 className="roelca-card-title">Flota Externa (Proveedor)</h3></div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label className="form-label">Unidad del Proveedor <span className="campo-badge">unidadProveedor</span></label>
                          <div className="fo-x19">
                            <input type="text" className={`form-control${claseSiFalta('unidadProveedor')}`} placeholder="Buscar/escribir unidad del proveedor..." value={searchUnidadProveedor} onChange={e => { setSearchUnidadProveedor(e.target.value); setShowDropdownUnidadProveedor(true); setFormData(prev => ({ ...prev, unidadProveedor: e.target.value })); }} onFocus={() => setShowDropdownUnidadProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownUnidadProveedor(false), 200)} />
                            {showDropdownUnidadProveedor && searchUnidadProveedor && resultadosUnidadProveedor.length > 0 && (
                              <div className="fo-x12">
                                {resultadosUnidadProveedor.map((u:any) => { const txt = String(u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || ''); return (
                                  <div className="fo-x14" key={u.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, unidadProveedor: u.id })); setSearchUnidadProveedor(txt); setShowDropdownUnidadProveedor(false); }}>
                                    <div className="fo-x15">{txt}</div>
                                  </div>
                                ); })}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Operador del Proveedor <span className="campo-badge">operadorProveedor</span></label>
                          <div className="fo-x19">
                            <input type="text" className={`form-control${claseSiFalta('operadorProveedor')}`} placeholder="Buscar/escribir operador del proveedor..." value={searchOperadorProveedor} onChange={e => { setSearchOperadorProveedor(e.target.value); setShowDropdownOperadorProveedor(true); setFormData(prev => ({ ...prev, operadorProveedor: e.target.value })); }} onFocus={() => setShowDropdownOperadorProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownOperadorProveedor(false), 200)} />
                            {showDropdownOperadorProveedor && searchOperadorProveedor && resultadosOperadorProveedor.length > 0 && (
                              <div className="fo-x12">
                                {resultadosOperadorProveedor.map((o:any) => { const txt = String(o.nombre || o.nombres || o.nombreCompleto || ''); return (
                                  <div className="fo-x14" key={o.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, operadorProveedor: o.id })); setSearchOperadorProveedor(txt); setShowDropdownOperadorProveedor(false); }}>
                                    <div className="fo-x15">{txt}</div>
                                  </div>
                                ); })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!esFlotaPropiaRoelca && (
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconDollar /></div><h3 className="roelca-card-title">Pago al Proveedor</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label">Monto a Pagar Proveedor <span className="campo-badge">totalAPagarProv</span>
                        {/* ✅ V00245: mismo botón que en el cliente */}
                        {formData.convenioProveedor && <button type="button" className="fo-btn-act-moneda fo-btn-actualizar" onClick={() => actualizarMontoConvenio('proveedor')} title="Traer el monto actual del convenio del proveedor">↻ Actualizar monto</button>}
                      </label><ConSimboloMoneda><input type="number" step="0.01" name="totalAPagarProv" className={`form-control${claseSiFalta('totalAPagarProv')}`} value={formData.totalAPagarProv || 0} onChange={handleChange} style={{ color: colorMonedaProv, fontWeight: colorMonedaProv ? 600 : undefined }} /></ConSimboloMoneda>{subtotalProvFact.convertido && <small className={subtotalProvFact.sinTC ? 'fo-conv-alerta' : 'fo-conv-ok'}>{/* ✅ V00126 */}Subtotal en moneda de factura: {fmtMoney(subtotalProvFact.monto)} {nombreMoneda(formData.facturadoEnUnidad)} · {leyendaConversion(subtotalProvFact, Number(formData.totalAPagarProv || 0), monConvProvActual)}</small>}</div>
                      {/* ✅ NUEVO: moneda del monto del proveedor, visible y corregible. */}
                      <div className="form-group">
                        <label className="form-label">Moneda del Monto <span className="campo-badge">monedaConvenioProv</span></label>
                        <select
                          className="form-control"
                          value={esMonedaMXN(formData.monedaConvenioProv) ? ID_MXN : ID_USD}
                          onChange={e => setFormData(prev => ({ ...prev, monedaConvenioProv: e.target.value }))}
                          title="Moneda en la que está capturado el Monto a Pagar Proveedor. Se toma del convenio; corrígela si el convenio la trae mal."
                        >
                          <option value={ID_USD}>Dólares</option>
                          <option value={ID_MXN}>Pesos</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Cargos Adicionales (Prov) <span className="campo-badge">cargosAdicionalesProv</span></label>
                        <div className="roelca-lookup-row">
                          <ConSimboloMoneda className="fo-x27"><input type="number" step="0.01" name="cargosAdicionalesProv" className={`form-control${claseSiFalta('cargosAdicionalesProv')}`} value={formData.cargosAdicionalesProv || 0} onChange={handleChange} style={{ color: colorMonedaProv, fontWeight: colorMonedaProv ? 600 : undefined }} /></ConSimboloMoneda>
                          <BotonAgregar title="Administrar costos adicionales del PROVEEDOR de esta operación" onClick={() => { if (!initialData?.id && !(formData as any).id) { alert('Guarda la operación primero; los costos adicionales se ligan a la operación ya guardada.'); return; } setMostrarCostosAdic('proveedor'); }} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Subtotal Proveedor <span className="campo-badge">subtotalProv</span></label><ConSimboloMoneda><input type="number" className="form-control" value={formData.subtotalProv || 0} readOnly style={{ opacity: 0.9, color: colorMonedaProv, fontWeight: colorMonedaProv ? 600 : undefined }} /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Dólares (Prov) <span className="campo-badge">dolaresProv</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x28" value={Number(formData.dolaresProv || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Pesos (Prov) <span className="campo-badge">pesosProv</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.pesosProv || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Conversión (MXN) <span className="campo-badge">conversionProv</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.conversionProv || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                    </div>
                  </div>
                  )}


                  {puenteVisible && (
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconDollar /></div><h3 className="roelca-card-title">Caseta / Puente</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Puente <span className="campo-badge">puenteId</span></label>
                        <select name="puenteId" className="form-control" value={formData.puenteId || ''} onChange={(e) => {
                          puenteElegidoAMano.current = true; // ✅ V00465
                          const id = e.target.value;
                          const row = opcionesPuente.find((g:any) => String(g.id) === id);
                          const importe = row ? (Number(row.Importe ?? row.importe ?? 0) || 0) : 0;
                          setFormData(prev => ({ ...prev, puenteId: id, puenteNombre: row ? String(row.nombre_gasto || '') : '', puenteMonto: id ? importe : 0 }));
                        }}>
                          <option value="">-- Seleccionar --</option>
                          {opcionesPuente.map((g:any) => <option key={g.id} value={g.id}>{g.nombre_gasto}</option>)}
                          {formData.puenteId && !opcionesPuente.some((g:any) => String(g.id) === String(formData.puenteId)) && (<option value={formData.puenteId}>{formData.puenteNombre || formData.puenteId}</option>)}
                        </select>
                        {/* ✅ V00465: el TAG de la unidad para este puente */}
                        <TagPuenteUnidad unidadId={formData.unidad} grupo={(puenteCobrado ? grupoTagDeNombres(puenteCobrado.nombre, puenteCobrado.piso) : '') || grupoTagDeNombres(formData.puenteNombre) || grupoTagDeTrafico(formData.trafico)} />
                        {puenteCobrado ? (
                          <small className="fo-puente-origen">Cobrado: {puenteCobrado.nombre} · {fmtMoney(puenteCobrado.monto)}</small>
                        ) : (
                          <>
                            {puentePrevisto && String(formData.puenteNombre || '') === puentePrevisto.nombre && Number(formData.puenteMonto) === puentePrevisto.monto && (
                              <small className="fo-puente-origen">{puentePrevisto.origen === 'tarifa' ? 'Del convenio (gastos incluidos de su tarifa)' : puentePrevisto.origen === 'regla' ? 'De Reglas de Estatus: el puente elegido para ese estatus' : puentePrevisto.origen === 'colombia' ? 'De Reglas de Estatus: aduana Colombia (la tarifa no trae caseta)' : 'De Reglas de Estatus: por el tráfico (la tarifa del convenio no trae caseta)'}</small>
                            )}
                            {/* ✅ V00470: cuándo se cobra, según Reglas de Estatus */}
                            <small className="fo-puente-origen">
                              {pasosQueCobranPuente.length > 0 ? `Se cobra al marcar ${pasosQueCobranPuente.join(' o ')} (Reglas de Estatus).` : 'Se cobra al marcar el Verde (el flujo no tiene un paso con 🌉).'}
                            </small>
                          </>
                        )}
                      </div>
                      <div className="form-group"><label className="form-label">Puente Monto <span className="campo-badge">puenteMonto</span></label><ConSimboloMoneda><input type="number" className="form-control" value={formData.puenteMonto || 0} readOnly={campoBloqueadoAut('puenteMonto')} onClick={() => campoBloqueadoAut('puenteMonto') && clicCampoBloqueado('puenteMonto')} onChange={e => { puenteElegidoAMano.current = true; setFormData(prev => ({ ...prev, puenteMonto: Number(e.target.value) || 0 })); }} title={campoBloqueadoAut('puenteMonto') ? 'Bloqueado por autorizaciones para tu rol' : 'Se toma del catálogo (Importe); puedes ajustarlo manualmente'} style={campoBloqueadoAut('puenteMonto') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} /></ConSimboloMoneda></div>
                      {pisoColombia && (
                        <div className="form-group">
                          <label className="form-label">Puente Colombia <span className="campo-badge">saldoPuentePiso</span></label>
                          <input type="text" className="form-control fo-x22" value={`${pisoColombia.nombre} · ${fmtMoney(pisoColombia.monto)}`} readOnly title="Aduana Colombia: además de la caseta se cobra el puente (catálogo Tipos de Gastos). Solo informativo." />
                          <small className="fo-puente-origen">{puenteCobrado?.piso ? 'Cobrado' : 'Aduana Colombia: se cobra junto con la caseta'}</small>
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </>
              )}

              {pestañaActiva === 'cobrar' && pestanasVisibles.includes('cobrar') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconDollar /></div><h3 className="roelca-card-title">Facturación al Cliente</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Facturado En <span className="campo-badge">facturadoEnCobrar</span></label>
                        {/* ✅ V00129: re-sincronizar con la moneda actual de la empresa */}
                        <button type="button" className="fo-btn-act-moneda" disabled={actualizandoMoneda === 'cliente'} onClick={() => actualizarMonedaDesdeEmpresa('cliente')} title="Vuelve a leer la moneda del cliente en la tabla Empresas y la aplica a este registro">{actualizandoMoneda === 'cliente' ? '⏳…' : '⟳ Actualizar moneda'}</button>
                        {/* ✅ CAMBIO: ahora EDITABLE — se precarga del cliente,
                            pero puedes corregir en qué moneda se factura. */}
                        {/* ✅ V00132: EDITABLE otra vez a petición — se precarga de la empresa (y "⟳ Actualizar moneda" la re-sincroniza), pero aquí puedes corregirla para esta operación */}
                        {/* ✅ V00490: fija a la moneda de la empresa; solo se elige si la empresa no tiene moneda */}
                        <div onMouseDownCapture={() => campoBloqueadoAut('facturadoEnCobrar') && clicCampoBloqueado('facturadoEnCobrar')}><select disabled={campoBloqueadoAut('facturadoEnCobrar') || !!monedaFijaCliente} title={monedaFijaCliente ? 'Es la moneda del cliente en Empresas; no se cambia aquí' : campoBloqueadoAut('facturadoEnCobrar') ? 'La moneda viene de la tabla Empresas y está bloqueada por Autorizaciones para tu rol (usa ⟳ Actualizar moneda para re-sincronizarla)' : 'El cliente no tiene moneda en Empresas: elígela aquí'} style={campoBloqueadoAut('facturadoEnCobrar') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} className="form-control fo-moneda-fija" value={formData.facturadoEnCobrar || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, facturadoEnCobrar: e.target.value }))}
                          >
                          <option value="">— Sin definir —</option>
                          {opcionesFacturadoEn().map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                        </select></div>
                      </div>
                      <div className="form-group"><label className="form-label">Subtotal <span className="campo-badge">montoConvenioCliente</span>
                        {/* ✅ V00243: traer el monto vigente del convenio, aquí mismo */}
                        {formData.convenio && <button type="button" className="fo-btn-act-moneda fo-btn-actualizar" onClick={() => actualizarMontoConvenio('cliente')} title="Traer los datos vigentes del convenio: monto, moneda, sueldo del operador, combustible, servicio, tráfico y carga">↻ Actualizar convenio</button>}
                      </label><ConSimboloMoneda><input type="number" step="any" className="form-control" value={subtotalClienteFact.convertido ? subtotalClienteFact.monto : (formData.montoConvenioCliente || 0)} readOnly={campoBloqueadoAut('montoConvenioCliente') || subtotalClienteFact.convertido} onChange={e => setFormData(prev => ({ ...prev, montoConvenioCliente: Number(e.target.value) || 0 }))} title={campoBloqueadoAut('montoConvenioCliente') ? 'Bloqueado por autorizaciones para tu rol' : subtotalClienteFact.convertido ? leyendaConversion(subtotalClienteFact, Number(formData.montoConvenioCliente || 0), monConvCliActual) : 'Se toma del convenio (tarifario) del cliente; puedes ajustarlo manualmente'} style={{ color: colorMonedaCliente, fontWeight: colorMonedaCliente ? 600 : undefined, ...(campoBloqueadoAut('montoConvenioCliente') ? { opacity: 0.65, cursor: 'not-allowed' } : {}) }} /></ConSimboloMoneda>{subtotalClienteFact.convertido && <small className={subtotalClienteFact.sinTC ? 'fo-conv-alerta' : 'fo-conv-ok'}>{leyendaConversion(subtotalClienteFact, Number(formData.montoConvenioCliente || 0), monConvCliActual)}</small>}</div>
                      {trompoNoCobrable && <div className="fo-aviso-no-cobrable">🚫 Trompo de Roelca: NO COBRABLE — el monto de cobro queda en $0 y en el resumen diario va en "Otros no cobrables".</div>}{/* ✅ V00434 */}
                      {/* ✅ V00126: se eliminó el selector "Moneda del Monto"; la moneda del monto viene del detalle del convenio (monedaConvenioCliente se sigue guardando). */}
                      <div className="form-group">
                        <label className="form-label">Cargos Adicionales <span className="campo-badge">cargosAdicionales</span></label>
                        <div className="roelca-lookup-row">
                          <ConSimboloMoneda className="fo-x27"><input type="number" step="0.01" name="cargosAdicionales" className={`form-control${claseSiFalta('cargosAdicionales')}`} value={formData.cargosAdicionales || 0} onChange={handleChange} style={{ color: colorMonedaCliente, fontWeight: colorMonedaCliente ? 600 : undefined }} /></ConSimboloMoneda>
                          <BotonAgregar title="Administrar costos adicionales del CLIENTE de esta operación" onClick={() => { if (!initialData?.id && !(formData as any).id) { alert('Guarda la operación primero; los costos adicionales se ligan a la operación ya guardada.'); return; } setMostrarCostosAdic('cliente'); }} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Total <span className="campo-badge">subtotalCliente</span></label><ConSimboloMoneda><input type="number" className="form-control" value={formData.subtotalCliente || 0} readOnly style={{ opacity: 0.9, color: colorMonedaCliente, fontWeight: colorMonedaCliente ? 600 : undefined }} /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Tipo de Cambio <span className="campo-badge">tipoCambioAprobado</span></label><ConSimboloMoneda><input type="number" step="0.0001" className="form-control" value={formData.tipoCambioAprobado || 0} readOnly={campoBloqueadoAut('tipoCambioAprobado')} onChange={e => { tcEditadoAMano.current = true; setFormData(prev => ({ ...prev, tipoCambioAprobado: Number(e.target.value) || 0 })); }} title={campoBloqueadoAut('tipoCambioAprobado') ? 'Bloqueado por autorizaciones para tu rol' : 'Se toma del TC oficial de la fecha de servicio; puedes ajustarlo manualmente'} style={campoBloqueadoAut('tipoCambioAprobado') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} /></ConSimboloMoneda>{avisoTC}</div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconTrendingUp /></div><h3 className="roelca-card-title">Conversión y Utilidad</h3></div>
                    <div className="form-grid">
                      
                      <div className="form-group"><label className="form-label">Dólares (Cliente) <span className="campo-badge">dolaresCliente</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x28" value={Number(formData.dolaresCliente || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Pesos (Cliente) <span className="campo-badge">pesosCliente</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.pesosCliente || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Conversión Cliente (MXN) <span className="campo-badge">conversionCliente</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.conversionCliente || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      {!esFlotaPropiaRoelca && (
                        <div className="form-group"><label className="form-label">Conversión Proveedor (MXN) <span className="campo-badge">conversionProv</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.conversionProv || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      )}
                      <div className="form-group">
                        <label className="form-label">Utilidad Estimada (MXN) <span className="campo-badge">utilidadEstimada</span></label>
                        <ConSimboloMoneda><input type="number" className="form-control" value={Number(formData.utilidadEstimada || 0).toFixed(2)} readOnly style={{ opacity: 0.95, color: Number(formData.utilidadEstimada) >= 0 ? '#3fb950' : '#f85149', fontWeight: 700 }} /></ConSimboloMoneda>
                      </div>
                      <div className="form-group fo-x24"><label className="form-label">Observaciones Cobranza <span className="campo-badge">observacionesCobrar</span></label><textarea name="observacionesCobrar" className="form-control" rows={2} value={formData.observacionesCobrar || ''} onChange={handleChange} /></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </form>
          </FormularioConfigurable>
        </div>

        <aside className="roelca-form-right">
          <div className="roelca-scroll fo-x30">
            {initialData && statusActualGuardado && (
              <div className="status-preview-card fo-x31">
                <div className="fo-x32">
                  <span className="status-badge-ok fo-x33"><IconCheck size={12} /> Status de la operación</span>
                </div>
                <div className="fo-x34">{statusActualGuardado}</div>
                {nombreSiguienteAuto && camposSiguienteStatus.length > 0 && (
                  <div className="fo-x35">
                    <div className="fo-x36">
                      Para avanzar a "{nombreSiguienteAuto}":
                    </div>
                    {camposSiguienteStatus.map((c) => (
                      <div key={c.campo} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: c.cumplido ? '#3fb950' : '#8b949e', padding: '2px 0' }}>
                        <span className="fo-x37">{c.cumplido ? <IconCheck size={12} /> : <IconArrowRight size={12} />}</span>
                        {c.etiqueta}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {statusError ? (
              (!initialData || camposSiguienteStatus.length === 0) && (
                <div className="status-error-card">
                  <div className="fo-x32">
                    <span className="status-badge-error"><IconAlert size={12} /> Estatus</span>
                  </div>
                  <div className="fo-x38">{statusError}</div>
                </div>
              )
            ) : statusPreview && !initialData ? (
              <div className="status-preview-card">
                <div className="fo-x32">
                  <span className="status-badge-ok"><IconCheck size={12} /> Estatus calculado</span>
                </div>
                <div className="fo-x34">{statusPreview}</div>
                {nombreSiguienteAuto && camposSiguienteStatus.length > 0 && (
                  <div className="fo-x39">
                    <div className="fo-x36">
                      Para avanzar a "{nombreSiguienteAuto}":
                    </div>
                    {camposSiguienteStatus.map((c) => (
                      <div key={c.campo} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: c.cumplido ? '#3fb950' : '#8b949e', padding: '2px 0' }}>
                        <span className="fo-x37">{c.cumplido ? <IconCheck size={12} /> : <IconArrowRight size={12} />}</span>
                        {c.etiqueta}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {(tarifaIdCliente || tarifaIdProveedor) && (
              <div className="roelca-sidebar-section">
                <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconReceipt size={13} /></span> Tarifa (Convenio)</div>
                <div className="roelca-money-row fo-x40">
                  <span className="lbl">Cliente</span>
                  <span className="val fo-x41">
                    {nombreTarifaCli || '—'}
                    {tarifaIdCliente && <span className="fo-x42">ID: {tarifaIdCliente}</span>}
                  </span>
                </div>
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row fo-x40">
                    <span className="lbl">Proveedor</span>
                    <span className="val fo-x41">
                      {nombreTarifaProv || '—'}
                      {tarifaIdProveedor && <span className="fo-x42">ID: {tarifaIdProveedor}</span>}
                    </span>
                  </div>
                )}
                <div className="roelca-money-row"><span className="lbl">Monto Cliente</span><span className="val">{fmtMoney(montoCliente)}{nombreMoneda(monedaClienteId) ? ` ${nombreMoneda(monedaClienteId)}` : ''}</span></div>
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row"><span className="lbl">Monto Proveedor</span><span className="val">{fmtMoney(montoProveedor)}{nombreMoneda(monedaProveedorId) ? ` ${nombreMoneda(monedaProveedorId)}` : ''}</span></div>
                )}
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row fo-x43">
                    <span className="lbl">¿Tarifas coinciden?</span>
                    <span className="val" style={{ color: tarifasCoinciden ? '#3fb950' : '#fb923c' }}>{tarifaIdCliente && tarifaIdProveedor ? (tarifasCoinciden ? '✓ Sí' : '✕ No') : '—'}</span>
                  </div>
                )}
              </div>
            )}

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconUsers size={13} /></span> Cliente y Ruta</div>
              <div className="roelca-sidebar-value">{searchClientePaga || <span className="roelca-sidebar-muted">Sin cliente</span>}</div>
              {convenioNombreResumen && <div className="roelca-sidebar-secondary">Convenio: {convenioNombreResumen}</div>}
              <div className="roelca-route-line"><IconMapPin size={13} /> {searchOrigen || '—'} <IconArrowRight size={12} /> {searchDestino || '—'}</div>
            </div>

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconBriefcase size={13} /></span> Servicio</div>
              <div className="roelca-sidebar-value">{tipoOpNombreResumen || <span className="roelca-sidebar-muted">Sin tipo de operación</span>}</div>
              <div className="fo-x44">
                {formData.trafico && formData.trafico !== 'N/A' && <span className="roelca-chip">{formData.trafico}</span>}
                {formData.carga && formData.carga !== 'N/A' && <span className="roelca-chip">{formData.carga}</span>}
                {aduanaDeConv(convClienteSel) && <span className="roelca-chip" title="Aduana de la tarifa del convenio">Aduana {aduanaDeConv(convClienteSel)}</span>}{/* ✅ V00388 */}
                {searchProvTransporte && <span className="roelca-chip">{searchProvTransporte}</span>}
              </div>
            </div>

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconCalendar size={13} /></span> Fechas y Tipo de Cambio</div>
              <div className="roelca-money-row"><span className="lbl">Servicio</span><span className="val">{fmtFecha(formData.fechaServicio) || '—'}</span></div>
              {isFletes && <div className="roelca-money-row"><span className="lbl">Cita</span><span className="val">{formData.fechaCita ? fmtFecha(formData.fechaCita) : '—'}</span></div>}
              <div className="roelca-money-row"><span className="lbl">Tipo de Cambio</span><span className="val" style={{ color: tcResumen ? '#3fb950' : '#f85149' }}>{tcResumen ? `$${tcResumen}` : 'Sin registro'}</span></div>
            </div>

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconTrendingUp size={13} /></span> Financiero</div>
              <div className="roelca-money-row"><span className="lbl">Total</span><span className="val">{fmtMoney(formData.subtotalCliente)}</span></div>
              {!esFlotaPropiaRoelca && (
                <div className="roelca-money-row"><span className="lbl">Subtotal Proveedor</span><span className="val">{fmtMoney(formData.subtotalProv)}</span></div>
              )}
              <div className="roelca-money-row"><span className="lbl">Total Gastos</span><span className="val">{fmtMoney(formData.totalGastos)}</span></div>
              <div className={`roelca-utility-box ${Number(formData.utilidadEstimada) < 0 ? 'negative' : ''}`}>
                <div className="roelca-utility-label">Utilidad Estimada (MXN)</div>
                <div className="roelca-utility-value">{fmtMoney(formData.utilidadEstimada)}</div>
              </div>
            </div>
          </div>

          <div className="roelca-form-footer">
            <button type="button" onClick={handleSubmit} className="roelca-btn-primary" disabled={cargando}>
              <IconSave size={16} /> {cargando ? 'Guardando…' : (initialData ? 'Guardar Cambios' : 'Guardar Operación')}
            </button>
            <button type="button" onClick={handleCancelarConfirmado} className="roelca-btn-outline">
              <IconX size={15} /> Cancelar
            </button>
          </div>
        </aside>
      </div>

      {estado === 'minimizado' && (() => {
        // ✅ V00337: la píldora minimizada muestra lo YA capturado — referencia,
        //   cliente, remolque, fecha de servicio y tipo de operación.
        const fd = formData as Record<string, unknown>;
        const refPild = String(fd.ref || initialData?.ref || '');
        const datos = [
          searchClientePaga || String(fd.clientePagaNombre || initialData?.clientePagaNombre || ''),
          String(fd.numeroRemolqueNombre || initialData?.numeroRemolqueNombre || fd.numeroRemolque || ''),
          String(fd.fechaServicio || ''),
          String(fd.tipoOperacionNombre || initialData?.tipoOperacionNombre || ''),
        ].map(x => x.trim()).filter(Boolean);
        return (
          <div className="fo-x45" onClick={onRestore} title="Clic para restaurar la operación">
            <span className="fo-x26"><IconBriefcase size={18} /></span>
            <div className="fo-x46b">
              <div className="fo-x46">{refPild ? `✎ ${refPild}` : (initialData ? `Editar ${initialData.id?.substring(0, 6) || ''}` : 'Nueva Operación')}</div>
              {datos.length > 0 && <div className="fo-x46c">{datos.join(' · ')}</div>}
            </div>
            <span className="fo-x21"><IconArrowRight size={15} /></span>
          </div>
        );
      })()}

      {modalCatalogo && modalCatalogo.catalogo.tipo === 'empresa' && (
        <FormularioEmpresa estado="abierto" registros={empresasLocal} tipoEmpresaPreseleccionado={modalCatalogo.catalogo.tipoEmpresaPreseleccionado} onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
      )}
      {modalCatalogo && modalCatalogo.catalogo.tipo === 'remolque' && (
        <FormularioRemolque estado="abierto" onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
      )}
      {modalCatalogo && modalCatalogo.catalogo.tipo === 'unidad' && (
        <FormularioUnidad estado="abierto" onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
      )}
      {modalCatalogo && modalCatalogo.catalogo.tipo === 'empleado' && (
        <EmployeeForm estado="abierto" onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
      )}

      {/* ✅ V00141: modal de acceso a campo bloqueado */}
      <ModalAccesoCampo aut={autHook} />
      {/* ✅ V00224: editor de origen/destino de las tarifas de la operación */}
      {editorTarifaOD && (
        <EditorTarifaOrigenDestino
          refOperacion={String(initialData?.ref || '')}
          detalleClienteId={String(formData.convenio || '')}
          detalleProveedorId={String(formData.convenioProveedor || '')}
          onCerrar={() => setEditorTarifaOD(false)}
        />
      )}

      {/* ✅ V00214: MODAL — elegir la tarifa cuando el concepto tiene varias */}
      {modalTarifas && (
        <div className="modal-overlay" onClick={() => setModalTarifas(null)}>
          <div className="fo-modal-tarifas" onClick={(e) => e.stopPropagation()}>
            <div className="fo-modal-tarifas-head">
              <div>
                <h3 className="fo-modal-tarifas-tit">Elige la tarifa</h3>
                <p className="fo-modal-tarifas-sub">{modalTarifas.nombre} · {modalTarifas.tipo === 'cliente' ? 'Cliente' : 'Proveedor'}</p>
              </div>
              <button type="button" className="fo-modal-tarifas-x" onClick={() => setModalTarifas(null)}>✕</button>
            </div>
            <div className="fo-modal-tarifas-lista">
              {modalTarifas.opciones.map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  className="fo-tarifa-opcion"
                  onClick={() => {
                    if (modalTarifas.tipo === 'cliente') {
                      setFormData(prev => ({ ...prev, convenio: c.id }));
                      setSearchConvenio(etiquetaConvenioCliente(c));
                    } else {
                      setFormData(prev => ({ ...prev, convenioProveedor: c.id, monedaConvenioProv: c.monedaBase, totalAPagarProv: c.tarifaMonto }));
                      setSearchConvenioProveedor(etiquetaConvenioProveedor(c));
                    }
                    setModalTarifas(null);
                  }}
                >
                  <span className="fo-tarifa-cons">{consecutivoDe(c) || '—'}</span>
                  <span className="fo-tarifa-monto">{fmtMoney(c.tarifaMonto)}</span>
                  <span className="fo-tarifa-mon">{nombreMoneda(modalTarifas.tipo === 'cliente' ? c.monedaMaestro : c.monedaBase)}</span>
                  {aduanaDeConv(c) && <span className="fo-chip-aduana" title="Aduana de la tarifa">{aduanaDeConv(c)}</span>}{/* ✅ V00388 */}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {detalleConvenioEdit && (
        <EditorDetalleConvenioModal
          tipo={detalleConvenioEdit.tipo}
          detalleId={detalleConvenioEdit.detalleId}
          monedas={listaMonedasLocal}
          onClose={() => setDetalleConvenioEdit(null)}
          onGuardado={(det) => {
            const monId = resolverMonedaIdDeEmpresa({ moneda: det.moneda });
            // ✅ V00439 (Fase 3.6): el detalle editado llega por el listener compartido (sin parchar copia local).
            if (detalleConvenioEdit.tipo === 'cliente') {
              setFormData(prev => ({ ...prev, montoConvenioCliente: det.tarifa, monedaConvenioCliente: monId || prev.monedaConvenioCliente }));
              setSearchConvenio('');
            } else {
              setFormData(prev => ({ ...prev, totalAPagarProv: det.tarifa, monedaConvenioProv: monId || prev.monedaConvenioProv }));
              setSearchConvenioProveedor('');
            }
            setDetalleConvenioEdit(null);
          }}
        />
      )}
      {mostrarCostosAdic && (
        <div className="modal-overlay fo-x47">
          <CostosAdicionalesDashboard
            /* ✅ V00126: abre DIRECTO en esta operación (antes mostraba la lista para elegir una) */
            operacionFija={{ id: String(initialData?.id || (formData as any).id || ''), ref: (formData as any).ref || initialData?.ref || '', clienteNombre: searchClientePaga || (formData as any).clientePagaNombre || '', proveedorUnidadNombre: searchProvTransporte || (formData as any).proveedorUnidadNombre || '', fechaServicio: formData.fechaServicio, convenio: formData.convenio, convenioProveedor: formData.convenioProveedor, tipoCambioAprobado: formData.tipoCambioAprobado, utilidadEstimada: formData.utilidadEstimada }}
            soloTipo={mostrarCostosAdic === 'cliente' || mostrarCostosAdic === 'proveedor' ? mostrarCostosAdic : undefined}
            onCerrar={() => setMostrarCostosAdic(false)}
            /* ✅ V00126: la firma correcta es un objeto { cargosAdicionales, cargosAdicionalesProv } */
            onCostosActualizados={(cambios) => { const c = Number(cambios?.cargosAdicionales); const p = Number(cambios?.cargosAdicionalesProv); setFormData(prev => ({ ...prev, ...(Number.isFinite(c) ? { cargosAdicionales: c } : {}), ...(Number.isFinite(p) ? { cargosAdicionalesProv: p } : {}) })); }}
          />
        </div>
      )}

      {mostrarSubirDoc && idOperacion && (
        <DocumentoUploadModal isOpen={true} coleccionOrigen="operaciones" registroId={idOperacion} registroNombre={referenciaOperacion} tiposDocumento={TIPOS_DOCUMENTO_OPERACION} onClose={() => setMostrarSubirDoc(false)} />
      )}

      {mostrarConveniosCliente && (
        <div className="modal-overlay fo-x47" onMouseDown={(e) => { if (e.target === e.currentTarget) setMostrarConveniosCliente(false); }}>
          <div className="form-card fo-x48">
            <div className="fo-x49">
              <div>
                <h3 className="fo-x50">Convenios del Cliente</h3>
                <p className="fo-x51">{searchClientePaga || 'Cliente'} · {listaConveniosCliente.length} convenio(s)</p>
              </div>
              <div className="fo-x7">
                {/* ✅ V00272: se retiró "+ Nuevo" — los convenios se dan de alta en Convenio de Clientes */}
                <button type="button" onClick={() => setMostrarConveniosCliente(false)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
              </div>
            </div>
            <div className="fo-x53">
              {listaConveniosCliente.length === 0 ? (
                <div className="fo-x54">Este cliente no tiene convenios.</div>
              ) : (
                <table className="fo-x55">
                  <thead>
                    <tr className="fo-x56">
                      <th className="fo-x57 fo-col-num">#</th>{/* ✅ V00429: conteo */}
                      <th className="fo-x57"># Tarifario</th>{/* ✅ V00271 */}
                      <th className="fo-x57"># Convenio</th>{/* ✅ V00271 */}
                      <th className="fo-x57">Tarifa</th>
                      <th className="fo-x58">Cotizado en</th>{/* ✅ V00281 */}
                      <th className="fo-x58">Monto</th>
                      <th className="fo-x58">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaConveniosCliente.map((c:any, iConv: number) => (
                      <Fragment key={c.id}>{/* ✅ V00313: fila + subfilas de tarifas alternas */}
                      <tr
                        className={`fo-x59 fo-fila-convenio${String(formData.convenio) === String(c.id) ? ' fo-fila-convenio--elegido' : ''}`}
                        title="Clic para usar este convenio en la operación"
                        onClick={() => { /* ✅ V00271: clic en la fila = SELECCIONAR el convenio */
                          montoAltCliRef.current = null; /* ✅ V00313: fila principal = monto vigente */
                          setFormData(prev => ({ ...prev, convenio: String(c.id) }));
                          setSearchConvenio(etiquetaConvenioCliente(c));
                          setMostrarConveniosCliente(false);
                        }}
                      >
                        <td className="fo-x60 fo-col-num">{iConv + 1}</td>{/* ✅ V00429 */}
                        <td className="fo-x60 fo-col-consec">{String(c.tarifarioConsec || c.tarifarioId || '—')}</td>{/* ✅ V00272 */}
                        <td className="fo-x60 fo-col-consec">{String(c.consecutivo || c.id || '—')}</td>
                        <td className="fo-x60">{c.descripcion}{aduanaDeConv(c) && <span className="fo-chip-aduana" title="Aduana de la tarifa">{aduanaDeConv(c)}</span>}</td>
                        <td className="fo-x61"><span className={`fo-chip-moneda${esUSD(c.monedaMaestro) ? ' fo-chip-moneda--usd' : ' fo-chip-moneda--mxn'}`}>{esUSD(c.monedaMaestro) ? 'USD' : 'MXN'}</span></td>{/* ✅ V00281 */}
                        <td className="fo-x61">
                          {fmtMoney(c.tarifaMonto)}
                          {(c.montosAlt || []).length > 1 && (
                            <button type="button" className="fo-btn-montos" title="Este convenio tiene varias tarifas — desplegar para elegir cuál usar" onClick={(e) => { e.stopPropagation(); setConvMontosAbierto((prev) => prev === `cli_${c.id}` ? '' : `cli_${c.id}`); }}>
                              {convMontosAbierto === `cli_${c.id}` ? '▾' : '▸'} {(c.montosAlt || []).length}
                            </button>
                          )}
                        </td>
                        <td className="fo-x62" onClick={(e) => e.stopPropagation()}>
                          <button className="fo-x63" type="button" onClick={() => abrirEditorConvenio(c)} title="Editar"><IconEdit size={13} /></button>
                          {/* ✅ V00272: se retiró Eliminar — los convenios se administran en Convenio de Clientes */}
                        </td>
                      </tr>
                      {convMontosAbierto === `cli_${c.id}` && (c.montosAlt || []).map((m: number, i: number) => (
                        <tr key={`${c.id}_m${i}`} className={`fo-x59 fo-fila-monto${String(formData.convenio) === String(c.id) && Number(formData.montoConvenioCliente) === m ? ' fo-fila-convenio--elegido' : ''}`} title="Clic para usar el convenio con ESTA tarifa" onClick={() => { /* ✅ V00313 */
                          montoAltCliRef.current = m === Number(c.tarifaMonto) ? null : { id: String(c.id), monto: m };
                          setFormData(prev => ({ ...prev, convenio: String(c.id), monedaConvenioCliente: c.monedaMaestro, montoConvenioCliente: m }));
                          setSearchConvenio(etiquetaConvenioCliente(c));
                          setMostrarConveniosCliente(false);
                        }}>
                          <td className="fo-x60" />
                          <td className="fo-x60" />
                          <td className="fo-x60 fo-col-consec fo-sub-tarifa">↳ Tarifa {String.fromCharCode(65 + i)}</td>
                          <td className="fo-x60">{c.descripcion}{aduanaDeConv(c) && <span className="fo-chip-aduana" title="Aduana de la tarifa">{aduanaDeConv(c)}</span>}</td>
                          <td className="fo-x61"><span className={`fo-chip-moneda${esUSD(c.monedaMaestro) ? ' fo-chip-moneda--usd' : ' fo-chip-moneda--mxn'}`}>{esUSD(c.monedaMaestro) ? 'USD' : 'MXN'}</span></td>
                          <td className="fo-x61">{fmtMoney(m)}{m === Number(c.tarifaMonto) ? <span className="fo-vigente-tag">vigente</span> : null}</td>
                          <td className="fo-x62" />
                        </tr>
                      ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {detalleConvEditando && (
        <div className="modal-overlay fo-x65" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetalleConvEditando(null); }}>
          <div className="form-card fo-x66">
            <div className="fo-x49">
              <h3 className="fo-x67">{detalleConvEditando.esNuevo ? 'Nuevo Convenio (Cliente)' : 'Editar Convenio (Cliente)'}</h3>
              <button type="button" onClick={() => setDetalleConvEditando(null)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
            <div className="fo-x68">
              <div className="form-group">
                <label className="form-label">Tarifa (catálogo)</label>
                <select className="form-control" value={detalleConvEditando.tipoConvenioId || ''} onChange={(e) => { const id = e.target.value; const op = opcionesTarifasRef.find((o:any) => o.id === id); setDetalleConvEditando((prev:any) => ({ ...prev, tipoConvenioId: id, tipoConvenioNombre: op?.nombre || prev.tipoConvenioNombre })); }}>
                  <option value="">-- Seleccionar tarifa --</option>
                  {opcionesTarifasRef.map((o:any) => <option key={o.id} value={o.id}>{etiquetaOpcionTarifa(o)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Nombre del convenio</label>
                <input type="text" className="form-control" value={detalleConvEditando.tipoConvenioNombre || ''} onChange={(e) => setDetalleConvEditando((prev:any) => ({ ...prev, tipoConvenioNombre: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Monto / Tarifa</label>
                <input type="number" step="0.01" className="form-control" value={detalleConvEditando.tarifa ?? ''} onChange={(e) => setDetalleConvEditando((prev:any) => ({ ...prev, tarifa: e.target.value }))} />
              </div>
            </div>
            <div className="fo-x69">
              <button type="button" onClick={() => setDetalleConvEditando(null)} className="roelca-btn-outline fo-x70">Cancelar</button>
              <button type="button" onClick={guardarDetalleConvenio} className="roelca-btn-primary fo-x71" disabled={guardandoDetalleConv}>{guardandoDetalleConv ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {mostrarConveniosProveedor && (
        <div className="modal-overlay fo-x47" onMouseDown={(e) => { if (e.target === e.currentTarget) setMostrarConveniosProveedor(false); }}>
          <div className="form-card fo-x48">
            <div className="fo-x49">
              <div>
                <h3 className="fo-x50">Convenios del Proveedor</h3>
                <p className="fo-x51">{searchProvTransporte || 'Proveedor'} · {listaConveniosProveedor.length} convenio(s)</p>
              </div>
              <div className="fo-x7">
                {/* ✅ V00272: se retiró "+ Nuevo" — los convenios se dan de alta en Convenio de Proveedores */}
                <button type="button" onClick={() => setMostrarConveniosProveedor(false)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
              </div>
            </div>
            <div className="fo-x53">
              {listaConveniosProveedor.length === 0 ? (
                <div className="fo-x54">Este proveedor no tiene convenios.</div>
              ) : (
                <table className="fo-x55">
                  <thead>
                    <tr className="fo-x56">
                      <th className="fo-x57 fo-col-num">#</th>{/* ✅ V00429: conteo */}
                      <th className="fo-x57"># Tarifario</th>{/* ✅ V00271 */}
                      <th className="fo-x57"># Convenio</th>{/* ✅ V00271 */}
                      <th className="fo-x57">Tarifa</th>
                      <th className="fo-x58">Cotizado en</th>{/* ✅ V00281 */}
                      <th className="fo-x58">Monto</th>
                      <th className="fo-x58">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaConveniosProveedor.map((c:any, iConv: number) => (
                      <Fragment key={c.id}>{/* ✅ V00313: fila + subfilas de tarifas alternas */}
                      <tr
                        className={`fo-x59 fo-fila-convenio${String(formData.convenioProveedor) === String(c.id) ? ' fo-fila-convenio--elegido' : ''}`}
                        title="Clic para usar este convenio en la operación"
                        onClick={() => { /* ✅ V00271: clic en la fila = SELECCIONAR el convenio */
                          montoAltProvRef.current = null; /* ✅ V00313 */
                          setFormData(prev => ({ ...prev, convenioProveedor: String(c.id) }));
                          setSearchConvenioProveedor(String(c.tipoConvenioNombre || c.descripcion || c.consecutivo || c.id));
                          setMostrarConveniosProveedor(false);
                        }}
                      >
                        <td className="fo-x60 fo-col-num">{iConv + 1}</td>{/* ✅ V00429 */}
                        <td className="fo-x60 fo-col-consec">{String(c.tarifarioConsec || c.tarifarioId || '—')}</td>{/* ✅ V00272 */}
                        <td className="fo-x60 fo-col-consec">{String(c.consecutivo || c.id || '—')}</td>{/* ✅ V00271 */}
                        <td className="fo-x60">{c.tipoConvenioNombre}</td>
                        <td className="fo-x61"><span className={`fo-chip-moneda${esUSD(c.monedaBase) ? ' fo-chip-moneda--usd' : ' fo-chip-moneda--mxn'}`}>{esUSD(c.monedaBase) ? 'USD' : 'MXN'}</span></td>{/* ✅ V00281 */}
                        <td className="fo-x61">
                          {fmtMoney(c.tarifaMonto)}
                          {(c.montosAlt || []).length > 1 && (
                            <button type="button" className="fo-btn-montos" title="Este convenio tiene varias tarifas — desplegar para elegir cuál usar" onClick={(e) => { e.stopPropagation(); setConvMontosAbierto((prev) => prev === `prov_${c.id}` ? '' : `prov_${c.id}`); }}>
                              {convMontosAbierto === `prov_${c.id}` ? '▾' : '▸'} {(c.montosAlt || []).length}
                            </button>
                          )}
                        </td>
                        <td className="fo-x62" onClick={(e) => e.stopPropagation()}>
                          <button className="fo-x63" type="button" onClick={() => abrirEditorConvenioProv(c)} title="Editar"><IconEdit size={13} /></button>
                          {/* ✅ V00272: se retiró Eliminar — los convenios se administran en Convenio de Proveedores */}
                        </td>
                      </tr>
                      {convMontosAbierto === `prov_${c.id}` && (c.montosAlt || []).map((m: number, i: number) => (
                        <tr key={`${c.id}_m${i}`} className={`fo-x59 fo-fila-monto${String(formData.convenioProveedor) === String(c.id) && Number(formData.totalAPagarProv) === m ? ' fo-fila-convenio--elegido' : ''}`} title="Clic para usar el convenio con ESTA tarifa" onClick={() => { /* ✅ V00313 */
                          montoAltProvRef.current = m === Number(c.tarifaMonto) ? null : { id: String(c.id), monto: m };
                          setFormData(prev => ({ ...prev, convenioProveedor: String(c.id), monedaConvenioProv: c.monedaBase, totalAPagarProv: m }));
                          setSearchConvenioProveedor(String(c.tipoConvenioNombre || c.descripcion || c.consecutivo || c.id));
                          setMostrarConveniosProveedor(false);
                        }}>
                          <td className="fo-x60" />
                          <td className="fo-x60" />
                          <td className="fo-x60 fo-col-consec fo-sub-tarifa">↳ Tarifa {String.fromCharCode(65 + i)}</td>
                          <td className="fo-x60">{c.tipoConvenioNombre}</td>
                          <td className="fo-x61"><span className={`fo-chip-moneda${esUSD(c.monedaBase) ? ' fo-chip-moneda--usd' : ' fo-chip-moneda--mxn'}`}>{esUSD(c.monedaBase) ? 'USD' : 'MXN'}</span></td>
                          <td className="fo-x61">{fmtMoney(m)}{m === Number(c.tarifaMonto) ? <span className="fo-vigente-tag">vigente</span> : null}</td>
                          <td className="fo-x62" />
                        </tr>
                      ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {detalleConvProvEditando && (
        <div className="modal-overlay fo-x65" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetalleConvProvEditando(null); }}>
          <div className="form-card fo-x66">
            <div className="fo-x49">
              <h3 className="fo-x67">{detalleConvProvEditando.esNuevo ? 'Nuevo Convenio (Proveedor)' : 'Editar Convenio (Proveedor)'}</h3>
              <button type="button" onClick={() => setDetalleConvProvEditando(null)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
            <div className="fo-x68">
              <div className="form-group">
                <label className="form-label">Tarifa (catálogo)</label>
                <select className="form-control" value={detalleConvProvEditando.tipoConvenioId || ''} onChange={(e) => { const id = e.target.value; const op = opcionesTarifasRef.find((o:any) => o.id === id); setDetalleConvProvEditando((prev:any) => ({ ...prev, tipoConvenioId: id, tipoConvenioNombre: op?.nombre || prev.tipoConvenioNombre })); }}>
                  <option value="">-- Seleccionar tarifa --</option>
                  {opcionesTarifasRef.map((o:any) => <option key={o.id} value={o.id}>{etiquetaOpcionTarifa(o)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Nombre del convenio</label>
                <input type="text" className="form-control" value={detalleConvProvEditando.tipoConvenioNombre || ''} onChange={(e) => setDetalleConvProvEditando((prev:any) => ({ ...prev, tipoConvenioNombre: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Monto / Tarifa</label>
                <input type="number" step="0.01" className="form-control" value={detalleConvProvEditando.tarifa ?? ''} onChange={(e) => setDetalleConvProvEditando((prev:any) => ({ ...prev, tarifa: e.target.value }))} />
              </div>
            </div>
            <div className="fo-x69">
              <button type="button" onClick={() => setDetalleConvProvEditando(null)} className="roelca-btn-outline fo-x70">Cancelar</button>
              <button type="button" onClick={guardarDetalleConvenioProv} className="roelca-btn-primary fo-x71" disabled={guardandoDetalleConvProv}>{guardandoDetalleConvProv ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

// ✅ V00439 (Fase 3.6): el formulario vive en un portal: ABIERTO se ve aunque su módulo
//   esté oculto por MantenerVivo (p. ej. restaurado desde la píldora en otro módulo).
//   Mientras está abierto sus catálogos compartidos siguen en vivo (como sus listeners
//   propios de antes); minimizado, siguen la visibilidad de su módulo.
function FormularioOperacionVisible(props: FormProps) {
  const moduloVisible = useModuloVivoActivo();
  const moduloEscuchando = useModuloEscuchando(); // ✅ V00446
  const abierto = props.estado === 'abierto';
  return (
    <ContextoModuloEscuchando.Provider value={moduloEscuchando || abierto}>
      <ContextoModuloVivoActivo.Provider value={moduloVisible || abierto}>
        <FormularioOperacionBase {...props} />
      </ContextoModuloVivoActivo.Provider>
    </ContextoModuloEscuchando.Provider>
  );
}

// ✅ V00438 (Fase 2.3): memo — no se vuelve a renderizar cuando el tablero padre se
//   re-renderiza con las mismas props (los padres pasan props estables).
export const FormularioOperacion = memo(FormularioOperacionVisible);

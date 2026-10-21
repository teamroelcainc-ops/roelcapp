// src/shared/dominio/constantes.ts
// ---------------------------------------------------------------------------
// ✅ V00436 — IDs de catálogo y nombres de colección en UN SOLO LUGAR.
//
// Esta carpeta (src/shared/dominio) es lógica PURA (sin Firebase, sin React)
// que comparten la web y las Cloud Functions. functions/src/dominio es una
// COPIA generada por scripts/sincronizar-dominio.mjs: se edita aquí, nunca allá.
// La app móvil (roelca-movil/src/lib/constantes.ts) repite estos mismos valores.
//
// Antes, el ID de USD estaba escrito a mano en 21 archivos y los de status en 9.
// ---------------------------------------------------------------------------

/** Monedas (colección catalogo_moneda). */
export const ID_USD = '7dca62b3';
export const ID_MXN = 'f95d8894';

/** Status de "Servicio Completado" (dos registros en catalogo_status_servicio). */
export const STATUS_COMPLETADOS: readonly string[] = ['c2d57403', 'f557b751'];
/** Status "Cancelado". */
export const STATUS_CANCELADO = '7607f692';
/** Status que ya no son operaciones activas por ID (los "Falso" se reconocen por nombre). */
export const STATUS_FINALES: readonly string[] = [...STATUS_COMPLETADOS, STATUS_CANCELADO];

/** Tipos de empresa (catalogo_tipo_empresa). */
export const TIPO_EMPRESA = {
  clientePaga: '7eec9cbb',
  proveedorUnidad: 'ca21ab07',
  proveedorServicios: '11894dfd',
  bodega: '6e7af5ab',
} as const;

/** Grupo de estado de una operación (campo canónico `estadoGrupo`, Fase 4). */
export type EstadoGrupo = 'activa' | 'completada' | 'cancelada' | 'falso';

/** Versión del esquema canónico de `operaciones` (Fase 4). */
export const ESQUEMA_OPERACION_VERSION = 2;

/** Colecciones de Firestore (nombres reales). */
export const COL = {
  operaciones: 'operaciones',
  horarios: 'horarios',
  empresas: 'empresas',
  empleados: 'empleados',
  usuarios: 'usuarios',
  roles: 'roles',
  facturasClientes: 'facturas_clientes',
  facturasProveedores: 'facturas_proveedores',
  pagos: 'pagos',
  referenciasNomina: 'referencias_nomina',
  referenciasDiesel: 'referencias_diesel',
  saldosDiesel: 'saldos_diesel',
  saldosPuentes: 'saldos_puentes',
  tipoCambio: 'tipo_cambio',
  conveniosClientes: 'convenios_clientes',
  conveniosProveedores: 'convenios_proveedores',
  conveniosClientesDetalles: 'convenios_clientes_detalles',
  conveniosProveedoresDetalles: 'convenios_proveedores_detalles',
  tarifarioClientes: 'tarifario_clientes',
  tarifarioProveedores: 'tarifario_proveedores',
  statusServicio: 'catalogo_status_servicio',
  flujosOperacion: 'config_flujos_operacion',
  configuracion: 'configuracion',
  papelera: 'papelera_reciclaje',
  historialActividad: 'historial_actividad',
  solicitudesAutorizacion: 'solicitudes_autorizacion',
  configAutorizaciones: 'config_autorizaciones',
  rastreo: 'rastreo_operaciones',
  meta: 'meta',
  contadores: 'contadores',
} as const;

/** Documento con las banderas de la refactorización (configuracion/flags). */
export const DOC_FLAGS = 'flags';
/** Documento con las versiones de los catálogos (meta/versionesCatalogos). */
export const DOC_VERSIONES_CATALOGOS = 'versionesCatalogos';

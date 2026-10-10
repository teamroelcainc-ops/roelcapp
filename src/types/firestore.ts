// src/types/firestore.ts
// ---------------------------------------------------------------------------
// ✅ V00439 (Fase 3.1) — TIPOS de los documentos de Firestore (fuente única).
//
// Reflejan la base RELACIONAL simulada: cada relación guarda el ID (llave
// foránea, con tipo de marca para no confundir un id de empresa con uno de
// convenio) y una copia `*Nombre` para pintar tablas. Los campos marcados como
// "legado" existen en documentos viejos y se normalizan al leer con los
// convertidores de src/shared/data/convertidores.ts; el código nuevo usa los
// canónicos. Montos en la moneda indicada; los campos *Centavos son enteros.
//
// Lo que no está aquí sigue llegando como Record<string, unknown> (el formulario
// de operación tiene más de 200 campos configurables).
// ---------------------------------------------------------------------------
import type { EstadoGrupo } from '../shared/dominio/constantes';
import type { Moneda } from '../shared/dominio/moneda';

// ── Tipos de marca ──────────────────────────────────────────────────────────
declare const marca: unique symbol;
/** string con marca: un EmpresaId no se puede pasar donde se espera un ConvenioId. */
export type Id<M extends string> = string & { readonly [marca]: M };
export type OperacionId = Id<'operacion'>;
export type EmpresaId = Id<'empresa'>;
export type EmpleadoId = Id<'empleado'>;
export type ConvenioDetalleId = Id<'convenioDetalle'>;
export type ConvenioId = Id<'convenio'>;
export type TarifarioId = Id<'tarifario'>;
export type FacturaId = Id<'factura'>;
export type PagoId = Id<'pago'>;
export type NominaId = Id<'nomina'>;
export type StatusId = Id<'status'>;
export type UnidadId = Id<'unidad'>;
export type UsuarioId = Id<'usuario'>;

/** 'AAAA-MM-DD' validada por aFechaISO (src/shared/dominio/fechas.ts). */
export type FechaISO = string & { readonly [marca]: 'fechaISO' };
/** Entero de centavos (evita sumar flotantes). */
export type Centavos = number & { readonly [marca]: 'centavos' };

export type { Moneda, EstadoGrupo };

/** Todo documento leído por la capa de datos trae su id. */
export interface ConId<I extends string = string> { id: I }

// ── Operaciones ─────────────────────────────────────────────────────────────
export interface OperacionDoc extends ConId<OperacionId> {
  ref?: string;
  refPrefijo?: string;
  refConsecutivo?: number;
  /** Legado: ISO, Timestamp o d/m/aaaa (AppSheet). Para consultar usa fechaServicioISO. */
  fechaServicio?: unknown;
  /** Canónico (Fase 4): siempre 'AAAA-MM-DD'. */
  fechaServicioISO?: FechaISO;
  status?: StatusId;
  statusNombre?: string;
  /** Canónico (Fase 4): grupo de estado para consultar activas/completadas/canceladas. */
  estadoGrupo?: EstadoGrupo;
  clientePaga?: EmpresaId;
  clientePagaNombre?: string;
  clienteMercancia?: EmpresaId;
  clienteMercanciaNombre?: string;
  proveedorUnidad?: EmpresaId;
  proveedorUnidadNombre?: string;
  /** Canónico (Fase 4): todas las empresas que participan (array-contains). */
  empresasIds?: EmpresaId[];
  convenio?: ConvenioDetalleId;
  convenioNombre?: string;
  convenioProveedor?: ConvenioDetalleId;
  convenioProveedorNombre?: string;
  operador?: EmpleadoId;
  operadorNombre?: string;
  unidad?: UnidadId;
  tipoOperacionId?: string;
  tipoOperacionNombre?: string;
  trafico?: string;
  carga?: string;
  aduanaNombre?: string;
  // Dinero del lado cliente (moneda del convenio → moneda de facturación)
  montoConvenioCliente?: number;
  cargosAdicionales?: number;
  monedaConvenioCliente?: string;
  facturadoEnCobrar?: string;
  monedaCobroNombre?: string;
  // Dinero del lado proveedor
  totalAPagarProv?: number;
  cargosAdicionalesProv?: number;
  monedaConvenioProv?: string;
  facturadoEnUnidad?: string;
  monedaUnidadNombre?: string;
  tipoCambioAprobado?: number;
  tipoCambioDia?: number;
  sueldoOperador?: number;
  // Relaciones con documentos de dinero
  facturaClienteId?: FacturaId;
  facturaProveedorId?: FacturaId;
  referenciaNominaId?: NominaId;
  /** Canónico (Fase 4): pendientes de facturar por lado. */
  porFacturarCliente?: boolean;
  porFacturarProveedor?: boolean;
  esquemaVersion?: number;
  esPrueba?: boolean;
  createdAt?: string;
  creadoPor?: UsuarioId;
}

// ── Empresas ────────────────────────────────────────────────────────────────
export interface EmpresaDoc extends ConId<EmpresaId> {
  nombre?: string;
  razonSocial?: string;
  rfcTaxId?: string;
  tiposEmpresa?: string[];
  /** ID de catalogo_moneda (algunas guardan el nombre: legado). */
  moneda?: string;
  creditoDias?: number;
  status?: string;
  /** Contadores mantenidos por el servidor (Fase 6.5). */
  usoOps?: number;
  ultimoUsoISO?: FechaISO;
}

// ── Facturas, renglones y aplicaciones de pago ─────────────────────────────
export interface RenglonFacturaLegado {
  id: string;
  monto?: number;
  subtotalBase?: number;
  dol?: number;
  pes?: number;
  convenioNombre?: string;
  refCliente?: string;
}

export interface FacturaDoc extends ConId<FacturaId> {
  invoice?: string;
  fecha?: string;
  clienteId?: EmpresaId;
  clienteNombre?: string;
  proveedorId?: EmpresaId;
  proveedorNombre?: string;
  /** Moneda de emisión (manda sobre la de la empresa, regla V00265). */
  monedaFacturacion?: string;
  operacionesIds?: OperacionId[];
  /** Legado: copia de cada operación facturada (Fase 5 → subcolección renglones). */
  operacionesGuardadas?: RenglonFacturaLegado[];
  /** Total en pesos (conversión). */
  subtotalFactura?: number;
  /** Total en la moneda de la factura. */
  subtotalMonedaFactura?: number;
  montoPagado?: number;
  saldoPendiente?: number;
  statusPago?: 'PAGADA' | 'PARCIAL' | '';
  // Agregados canónicos que mantiene el servidor (Fase 5)
  totalCentavos?: Centavos;
  totalManualCentavos?: Centavos;
  montoPagadoCentavos?: Centavos;
  saldoCentavos?: Centavos;
  saldoAFavorCentavos?: Centavos;
  abierta?: boolean;
}

/** facturas_x/{id}/renglones/{opId} (Fase 5). */
export interface RenglonFacturaDoc extends ConId<OperacionId> {
  ref?: string;
  moneda: Moneda;
  montoCentavos: Centavos;
  conversionMxnCentavos: Centavos;
  convenioNombre?: string;
  refCliente?: string;
}

/** facturas_x/{id}/aplicaciones/{pagoId} (Fase 5). */
export interface AplicacionPagoDoc extends ConId<PagoId> {
  aplicadoCentavos: Centavos;
  fecha: FechaISO;
  numeroPago?: string;
}

// ── Pagos ───────────────────────────────────────────────────────────────────
export interface PagoAplicadoLegado {
  facturaId: FacturaId;
  invoice?: string;
  aplicado: number;
  total?: number;
  saldoAnterior?: number;
  saldoNuevo?: number;
}

export interface PagoDoc extends ConId<PagoId> {
  tipo: 'cliente' | 'proveedor' | 'mtto';
  numeroPago?: string;
  fecha?: string;
  /** Canónico (Fase 4): la empresa del pago. Legado: entidadId o clienteId/proveedorId. */
  empresaId?: EmpresaId;
  entidadId?: EmpresaId;
  clienteId?: EmpresaId;
  proveedorId?: EmpresaId;
  entidadNombre?: string;
  monto?: number;
  montoAplicado?: number;
  saldoAFavor?: number;
  facturas?: PagoAplicadoLegado[];
}

// ── Convenios y tarifarios ──────────────────────────────────────────────────
export interface ConvenioDetalleDoc extends ConId<ConvenioDetalleId> {
  consecutivo?: string;
  convenioId?: ConvenioId;
  tarifarioId?: TarifarioId;
  clienteId?: EmpresaId;
  proveedorId?: EmpresaId;
  tipoConvenioId?: string;
  tipoConvenioNombre?: string;
  descripcionConvenio?: string;
  tarifa?: number;
  montos?: number[];
  /** 'Dólares' / 'Pesos' (legado) o ID del catálogo. */
  moneda?: string;
  status?: string;
  origen?: string;
  origenNombre?: string;
  destino?: string;
  destinoNombre?: string;
  tarifaBaseId?: string;
  /** Contador mantenido por el servidor (Fase 6.5). */
  usoOps?: number;
}

export interface LineaTarifario {
  consecutivo?: string;
  tarifaReferenciaId?: string;
  descripcion?: string;
  tarifa?: number;
  cotizadoEn?: string;
  status?: string;
  origen?: string;
  destino?: string;
}

export interface TarifarioDoc extends ConId<TarifarioId> {
  consecutivo?: string;
  clienteId?: EmpresaId;
  clienteNombre?: string;
  proveedorId?: EmpresaId;
  proveedorNombre?: string;
  moneda?: string;
  status?: 'Pendiente' | 'Aprobado' | 'Inactivo' | 'Cancelado' | string;
  convenioId?: ConvenioId;
  /** Proyección de convenios_*_detalles (la fuente es el detalle, Fase 6.3). */
  tarifas?: LineaTarifario[];
}

// ── Nómina ──────────────────────────────────────────────────────────────────
export interface NominaDoc extends ConId<NominaId> {
  folio?: string;
  fechaPago?: string;
  operadorId?: EmpleadoId;
  operadorNombre?: string;
  operacionesIds?: OperacionId[];
  total?: number;
}

// ── Usuarios, roles y catálogos pequeños ───────────────────────────────────
export interface UsuarioDoc extends ConId<UsuarioId> {
  nombre?: string;
  email?: string;
  roles?: string[];
  rol?: string;
  activo?: boolean;
  tipoUsuario?: 'cliente' | string;
  colaboradorId?: EmpleadoId;
  modulosExtra?: string[];
  empresasClienteIds?: EmpresaId[];
}

export interface RolDoc extends ConId {
  nombre: string;
  modulosPermitidos?: string[];
  requiereIPOficina?: boolean;
}

export interface StatusServicioDoc extends ConId<StatusId> {
  nombre?: string;
  descripcion?: string;
  orden?: number;
}

export interface MonedaDoc extends ConId {
  moneda?: string;
  nombre?: string;
}

export interface TipoCambioDoc extends ConId {
  /** 'AAAA-MM-DD' (registros viejos pueden traer otro formato). */
  fecha?: string;
  valor?: number;
}

// ── Mapa colección → tipo de documento ─────────────────────────────────────
export interface Esquema {
  operaciones: OperacionDoc;
  empresas: EmpresaDoc;
  facturas_clientes: FacturaDoc;
  facturas_proveedores: FacturaDoc;
  pagos: PagoDoc;
  convenios_clientes_detalles: ConvenioDetalleDoc;
  convenios_proveedores_detalles: ConvenioDetalleDoc;
  tarifario_clientes: TarifarioDoc;
  tarifario_proveedores: TarifarioDoc;
  referencias_nomina: NominaDoc;
  usuarios: UsuarioDoc;
  roles: RolDoc;
  catalogo_status_servicio: StatusServicioDoc;
  catalogo_moneda: MonedaDoc;
  tipo_cambio: TipoCambioDoc;
}

export type ColeccionTipada = keyof Esquema;

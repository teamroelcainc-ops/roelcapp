// src/features/buscador/services/resultados.ts
// ---------------------------------------------------------------------------
// ✅ V00502 — BUSCADOR GLOBAL: de documentos a RESULTADOS (puro, sin Firebase ni React).
// Cada resultado dice qué mostrar (título, detalle, fecha, monto, estado) y a dónde lleva
// (módulo + id con el que ESE módulo encuentra el registro; ver aperturas.ts).
// ---------------------------------------------------------------------------
import { idReal } from '../../../shared/data/coleccionesVivas';
import { monedaDeFactura, totalNativoFactura } from '../../../shared/dominio/dinero';
import { aFechaISO, fechaServicioDeOperacion } from '../../../shared/dominio/fechas';
import { monedaCanonica } from '../../../shared/dominio/moneda';
import { estadoGrupoDe } from '../../../shared/dominio/operacionCanonica';
import { mejores } from './coincidencias';

export type Doc = Record<string, unknown> & { id: string; _docId?: string };

export type GrupoResultado = 'operaciones' | 'facturas' | 'pagos' | 'empresas' | 'convenios' | 'empleados' | 'unidades' | 'remolques';
export type TonoEstado = 'abierto' | 'cerrado' | 'alerta' | 'neutro';

export interface DestinoResultado { modulo: string; id: string; tipo?: string }

export interface ResultadoBusqueda {
  /** Única en toda la lista. */
  clave: string;
  grupo: GrupoResultado;
  titulo: string;
  detalle: string;
  fecha?: string;
  monto?: string;
  estado?: { texto: string; tono: TonoEstado };
  puntaje: number;
  destino: DestinoResultado;
}

/** Nombre de cada grupo en la lista, en el orden en que se muestran. */
export const GRUPOS: readonly { grupo: GrupoResultado; titulo: string }[] = [
  { grupo: 'operaciones', titulo: 'Operaciones' },
  { grupo: 'facturas', titulo: 'Facturas' },
  { grupo: 'pagos', titulo: 'Pagos' },
  { grupo: 'empresas', titulo: 'Empresas' },
  { grupo: 'convenios', titulo: 'Convenios' },
  { grupo: 'empleados', titulo: 'Empleados' },
  { grupo: 'unidades', titulo: 'Unidades' },
  { grupo: 'remolques', titulo: 'Remolques' },
];

/** Máximo de resultados por grupo (los mejores). */
export const MAX_POR_GRUPO = 6;

// Texto normalizado de cada registro, por tipo (se calcula una vez por objeto; ver `mejores`).
const cache = (): WeakMap<object, string[]> => new WeakMap();
const C = { fac: cache(), pago: cache(), emp: cache(), conv: cache(), col: cache(), uni: cache(), unip: cache(), rem: cache() };

const t = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const unir = (partes: readonly unknown[], sep = ' · '): string => partes.map(t).filter(Boolean).join(sep);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** "$1,234.50 USD" (sin moneda reconocida, solo el número). */
export const fmtMonto = (monto: unknown, moneda: unknown): string => {
  const n = num(monto);
  const m = monedaCanonica(moneda);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${m ? ` ${m}` : ''}`;
};

/** Texto guardado de un nombre, si no es el mismo ID (las copias *Nombre a veces guardan el id). */
const nombre = (guardado: unknown, id?: unknown): string => {
  const g = t(guardado);
  return g && g !== '-' && g !== t(id) ? g : '';
};

// ── Operaciones ─────────────────────────────────────────────────────────────
const MODULO_POR_ESTADO = { activa: 'operaciones', completada: 'serviciosCompletados', falso: 'serviciosCompletados', cancelada: 'serviciosCancelados' } as const;
const ETIQUETA_ESTADO = { activa: 'Activa', completada: 'Completada', falso: 'En falso', cancelada: 'Cancelada' } as const;
const TONO_ESTADO = { activa: 'abierto', completada: 'cerrado', falso: 'alerta', cancelada: 'alerta' } as const;

/** Nombre de cada status del catálogo (id → nombre): manda sobre la copia guardada en la operación. */
export type NombresStatus = ReadonlyMap<string, string>;

// Mismo criterio que Operaciones Activas (esOperacionActiva): el nombre del catálogo decide si el id no es uno de los fijos.
const grupoDe = (op: Doc, nombres?: NombresStatus) => estadoGrupoDe({ status: op.status, statusNombre: op.statusNombre }, nombres?.get(t(op.status)));

/** Módulo (pestaña de Operaciones) donde se abre la operación, según su status. */
export const moduloDeOperacion = (op: Doc, nombres?: NombresStatus): string => MODULO_POR_ESTADO[grupoDe(op, nombres)];

export const resultadosOperaciones = (docs: readonly Doc[], consulta: string, nombresStatus?: NombresStatus): ResultadoBusqueda[] => {
  const vistos = new Set<string>();
  const unicos = docs.filter((d) => { const id = idReal(d); if (vistos.has(id)) return false; vistos.add(id); return true; });
  return mejores(unicos, (d) => [d.ref || d.id, d.refCliente, d.remolqueNombre, d.clienteNombre || d.clientePagaNombre], consulta, MAX_POR_GRUPO)
    .map(({ item: d, puntaje }) => {
      const grupo = grupoDe(d, nombresStatus);
      return {
        clave: `op:${idReal(d)}`,
        grupo: 'operaciones',
        titulo: t(d.ref) || idReal(d).slice(0, 6),
        detalle: unir([
          nombre(d.clienteNombre) || nombre(d.clientePagaNombre),
          t(d.refCliente) && `Ref. cliente ${t(d.refCliente)}`,
          nombre(d.remolqueNombre) && `Remolque ${nombre(d.remolqueNombre)}`,
          nombre(d.tipoOperacionNombre, d.tipoOperacionId),
        ]),
        fecha: fechaServicioDeOperacion(d) || undefined,
        estado: { texto: nombresStatus?.get(t(d.status)) || nombre(d.statusNombre, d.status) || ETIQUETA_ESTADO[grupo], tono: TONO_ESTADO[grupo] },
        puntaje,
        destino: { modulo: MODULO_POR_ESTADO[grupo], id: idReal(d) },
      };
    });
};

// ── Facturas ────────────────────────────────────────────────────────────────
const invoiceDe = (d: Doc): string => t(d.invoice) || t(d.numeroInvoice) || t(d.numInvoice) || t(d.folio) || d.id;

const estadoFactura = (d: Doc): { texto: string; tono: TonoEstado } => {
  const status = t(d.statusFactura);
  if (status.toLowerCase().includes('cancel')) return { texto: 'Cancelada', tono: 'alerta' };
  const pago = t(d.statusPago).toUpperCase();
  const saldo = num(d.saldoPendiente);
  if (pago === 'PAGADA' || (num(d.montoPagado) > 0.009 && saldo <= 0.009)) return { texto: 'Pagada', tono: 'cerrado' };
  if (pago === 'PARCIAL' || num(d.montoPagado) > 0.009) return { texto: 'Parcial', tono: 'abierto' };
  return { texto: status && status !== 'Facturado' ? status : 'Abierta', tono: 'abierto' };
};

/**
 * Facturas de un lado. Facturación agrupa los documentos con el mismo invoice y la misma empresa
 * en una sola fila: aquí también sale una vez por grupo. El id es el que usa Facturación (`doc.id`).
 */
export const resultadosFacturas = (docs: readonly Doc[], lado: 'cliente' | 'proveedor', consulta: string): ResultadoBusqueda[] => {
  const campoEntidad = lado === 'cliente' ? 'clienteId' : 'proveedorId';
  const vistos = new Set<string>();
  const unicas = docs.filter((d) => {
    const k = `${invoiceDe(d).toLowerCase()}__${t(d[campoEntidad])}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const entidad = (d: Doc): string => (lado === 'cliente' ? t(d.clienteNombre) || t(d.cliente) : t(d.proveedorNombre) || t(d.proveedor));
  const moneda = (d: Doc): unknown => (lado === 'proveedor' ? monedaCanonica(d.monedaProveedor) ?? monedaDeFactura(d) : monedaDeFactura(d));
  return mejores(unicas, (d) => [invoiceDe(d), entidad(d), totalNativoFactura(d).toFixed(2), d.facturaCcp], consulta, MAX_POR_GRUPO, C.fac)
    .map(({ item: d, puntaje }) => ({
      clave: `fac:${lado}:${d.id}`,
      grupo: 'facturas',
      titulo: `${lado === 'cliente' ? 'Invoice' : 'Factura de proveedor'} ${invoiceDe(d)}`,
      detalle: unir([entidad(d), lado === 'proveedor' ? 'Proveedor' : '']),
      fecha: aFechaISO(d.fecha) || undefined,
      monto: fmtMonto(totalNativoFactura(d), moneda(d)),
      estado: estadoFactura(d),
      puntaje,
      destino: { modulo: lado === 'cliente' ? 'facturacionClientes' : 'facturacionProveedores', id: d.id },
    }));
};

// ── Pagos ───────────────────────────────────────────────────────────────────
const NOMBRE_TIPO_PAGO: Record<string, string> = { cliente: 'de cliente', proveedor: 'a proveedor', mtto: 'de MTTO' };

/** Pagos de una pestaña de Pagos (cliente, proveedor o mtto). */
export const resultadosPagos = (docs: readonly Doc[], tipo: 'cliente' | 'proveedor' | 'mtto', consulta: string): ResultadoBusqueda[] => {
  const invoices = (d: Doc): string => (Array.isArray(d.facturas) ? (d.facturas as unknown[]).map((f) => t((f as { invoice?: unknown } | null)?.invoice)).filter(Boolean).join(', ') : '');
  return mejores(docs, (d) => [d.numeroPago, d.entidadNombre, d.referencia, invoices(d), num(d.monto).toFixed(2), d.metodoPago], consulta, MAX_POR_GRUPO, C.pago)
    .map(({ item: d, puntaje }) => ({
      clave: `pago:${tipo}:${idReal(d)}`,
      grupo: 'pagos',
      titulo: `Pago ${t(d.numeroPago) || idReal(d).slice(0, 6)}`,
      detalle: unir([t(d.entidadNombre), `Pago ${NOMBRE_TIPO_PAGO[tipo]}`, invoices(d) && `Facturas ${invoices(d)}`]),
      fecha: aFechaISO(d.fecha) || undefined,
      monto: fmtMonto(d.monto, d.moneda),
      puntaje,
      destino: { modulo: 'pagos', id: idReal(d), tipo },
    }));
};

// ── Catálogos ───────────────────────────────────────────────────────────────
const activo = (v: unknown): { texto: string; tono: TonoEstado } | undefined => {
  if (v === true) return undefined;
  if (v === false) return { texto: 'Inactivo', tono: 'neutro' };
  return undefined;
};

export const resultadosEmpresas = (docs: readonly Doc[], consulta: string): ResultadoBusqueda[] =>
  mejores(docs, (d) => [d.nombre, d.nombreCorto, d.razonSocial, d.rfcTaxId, d.numCliente], consulta, MAX_POR_GRUPO, C.emp)
    .map(({ item: d, puntaje }) => {
      const status = t(d.status);
      return {
        clave: `emp:${d.id}`,
        grupo: 'empresas',
        titulo: t(d.nombre) || t(d.razonSocial) || d.id,
        detalle: unir([t(d.razonSocial) !== t(d.nombre) ? d.razonSocial : '', d.rfcTaxId, t(d.numCliente) && `Cliente #${t(d.numCliente)}`]),
        estado: status && status !== 'Activa' ? { texto: status, tono: 'neutro' } : undefined,
        puntaje,
        destino: { modulo: 'empresas', id: d.id },
      };
    });

/** Convenios (cada tarifa del convenio, como las filas de "Convenio de Clientes/Proveedores"). */
export const resultadosConvenios = (detalles: readonly Doc[], maestros: readonly Doc[], lado: 'clientes' | 'proveedores', consulta: string): ResultadoBusqueda[] => {
  const campoEntidad = lado === 'clientes' ? 'clienteNombre' : 'proveedorNombre';
  const porId = new Map(maestros.map((m) => [idReal(m), m]));
  const entidad = (d: Doc): string => t(porId.get(t(d.convenioId))?.[campoEntidad]) || t(d[campoEntidad]);
  const numero = (d: Doc): string => t(porId.get(t(d.convenioId))?.numeroConvenio);
  return mejores(detalles, (d) => [d.consecutivo || numero(d), entidad(d), d.origenNombre, d.destinoNombre, d.tipoConvenioNombre, numero(d)], consulta, MAX_POR_GRUPO)
    .map(({ item: d, puntaje }) => {
      const costo = d.costo !== undefined && d.costo !== null && d.costo !== '' ? d.costo : d.tarifa;
      const ruta = unir([d.origenNombre, d.destinoNombre], ' → ');
      return {
        clave: `conv:${lado}:${idReal(d)}`,
        grupo: 'convenios',
        titulo: `${lado === 'clientes' ? 'Convenio' : 'Convenio de proveedor'} ${t(d.consecutivo) || numero(d) || idReal(d).slice(0, 6)}`,
        detalle: unir([entidad(d), ruta, d.tipoConvenioNombre]),
        monto: costo !== undefined && costo !== null && costo !== '' ? fmtMonto(costo, d.moneda) : undefined,
        estado: t(d.status) && t(d.status) !== 'Aprobado' ? { texto: t(d.status), tono: 'neutro' } : undefined,
        puntaje,
        destino: { modulo: lado === 'clientes' ? 'detallesConvenioClientes' : 'detallesConvenioProveedores', id: idReal(d) },
      };
    });
};

export const resultadosEmpleados = (docs: readonly Doc[], consulta: string): ResultadoBusqueda[] => {
  const completo = (d: Doc): string => unir([d.firstName, d.lastNamePaternal, d.lastNameMaternal], ' ');
  return mejores(docs, (d) => [completo(d), d.alias, d.employeeId, d.cargoNombre], consulta, MAX_POR_GRUPO, C.col)
    .map(({ item: d, puntaje }) => ({
      clave: `col:${d.id}`,
      grupo: 'empleados',
      titulo: completo(d) || t(d.alias) || t(d.employeeId) || d.id,
      detalle: unir([d.employeeId, t(d.alias) && `"${t(d.alias)}"`, d.cargoNombre, d.departamentoNombre]),
      estado: activo(d.activo),
      puntaje,
      destino: { modulo: 'colaboradores', id: d.id },
    }));
};

export const resultadosUnidades = (propias: readonly Doc[], deProveedor: readonly Doc[], consulta: string): ResultadoBusqueda[] => {
  const a = mejores(propias, (d) => [d.unidad, d.placas, d.serie, d.marca, d.modelo, d.tipoUnidadNombre], consulta, MAX_POR_GRUPO, C.uni)
    .map(({ item: d, puntaje }): ResultadoBusqueda => ({
      clave: `uni:${d.id}`,
      grupo: 'unidades',
      titulo: `Unidad ${t(d.unidad) || d.id}`,
      detalle: unir([t(d.placas) && `Placas ${t(d.placas)}`, unir([d.marca, d.modelo], ' '), d.tipoUnidadNombre]),
      estado: activo(d.activo),
      puntaje,
      destino: { modulo: 'unidades', id: d.id },
    }));
  const b = mejores(deProveedor, (d) => [d.numeroUnidad, d.placas, d.numeroSerie, d.proveedorNombre], consulta, MAX_POR_GRUPO, C.unip)
    .map(({ item: d, puntaje }): ResultadoBusqueda => ({
      clave: `unip:${d.id}`,
      grupo: 'unidades',
      titulo: `Unidad de proveedor ${t(d.numeroUnidad) || d.id}`,
      detalle: unir([t(d.placas) && `Placas ${t(d.placas)}`, d.proveedorNombre]),
      puntaje,
      destino: { modulo: 'unidadesProveedor', id: d.id },
    }));
  return [...a, ...b].sort((x, y) => y.puntaje - x.puntaje).slice(0, MAX_POR_GRUPO);
};

export const resultadosRemolques = (docs: readonly Doc[], consulta: string): ResultadoBusqueda[] =>
  mejores(docs, (d) => [d.nombre, d.placas, d.serie, d.tipoNombre, d.propietarioNombre], consulta, MAX_POR_GRUPO, C.rem)
    .map(({ item: d, puntaje }) => ({
      clave: `rem:${d.id}`,
      grupo: 'remolques',
      titulo: `Remolque ${t(d.nombre) || d.id}`,
      detalle: unir([t(d.placas) && `Placas ${t(d.placas)}`, d.tipoNombre, d.propietarioNombre]),
      puntaje,
      destino: { modulo: 'remolques', id: d.id },
    }));

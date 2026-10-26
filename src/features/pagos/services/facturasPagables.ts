// src/features/pagos/services/facturasPagables.ts
// ---------------------------------------------------------------------------
// ✅ V00452 — FACTURAS PAGABLES (modal "Registrar Pago", edición de pagos y reportes de Pagos).
// Lógica PURA (probada): de los documentos de factura (o de gastos MTTO) a la lista que muestra
// Pagos. Antes vivía dentro de PagosDashboard y se recalculaba al abrir el modal:
//   · la moneda de la empresa se buscaba RECORRIENDO el catálogo de empresas (find + nombre
//     normalizado) por CADA factura: miles de facturas × miles de empresas en cada apertura;
//     ahora es un índice (Map) que se arma una vez por catálogo;
//   · los documentos se descargaban completos en cada apertura (8–10 s); ahora llegan de un
//     listener compartido (hooks/useFacturasPagables.ts) y esto solo los convierte.
// ---------------------------------------------------------------------------
import { monedaCanonica } from '../../../shared/dominio/moneda';
import { totalNativoFactura as totalNativoFacturaUnica } from '../../../shared/dominio/dinero';
import { totalNativoFactura } from './aplicarPagos';

export type TipoPago = 'cliente' | 'proveedor' | 'mtto';

export interface FacturaPagable {
  id: string;
  invoice: string;
  fecha: string;          // ISO o dd/mm — se ordena normalizada
  entidadId: string;
  entidadNombre: string;
  total: number;
  montoPagado: number;
  saldo: number;
  moneda: string;
  /** Documento completo (status, CCP, operaciones…). */
  raw?: Record<string, unknown>;
}

type Datos = Record<string, unknown>;
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// ✅ FIX DUPLICADOS FANTASMA: las facturas guardan el nombre de la entidad como texto y algunas
//   traen diferencias invisibles (espacio al final, doble espacio, acentos o mayúsculas). Para
//   agrupar, comparar y filtrar se usa SIEMPRE esta clave normalizada.
export const claveEntidad = (s: unknown): string =>
  texto(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

// Normaliza fechas dd/mm/aaaa o ISO a una clave ordenable AAAA-MM-DD.
export const claveFecha = (f: string): string => {
  const s = String(f || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s;
};

/** Moneda de la EMPRESA (tabla Empresas) de un registro con entidadId/clienteId/proveedorId/empresaId o nombre. */
export type MonedaEmpresa = (p: Datos) => string;

/**
 * ✅ V00452: índice de la moneda de cada empresa, por id y por nombre (mismo resultado que el
 * `find` de antes: primero el id; si no hay id o no se encuentra, el nombre sin mayúsculas ni
 * espacios alrededor; la primera empresa que coincide gana).
 */
export const crearMonedaEmpresa = (empresas: readonly Datos[], monedas: readonly Datos[]): MonedaEmpresa => {
  const monedaPorId = new Map<string, string>();
  monedas.forEach((m) => { const id = texto(m.id); if (id && !monedaPorId.has(id)) monedaPorId.set(id, texto(m.moneda)); });
  const deEmpresa = (e: Datos): string => {
    const m = texto(e.monedaId || e.moneda);
    if (!m) return '';
    return monedaPorId.get(m) || (m.length < 12 ? m : '') || '';
  };
  const norm = (t: unknown) => texto(t).trim().toLowerCase();
  const porId = new Map<string, string>();
  const porNombre = new Map<string, string>();
  empresas.forEach((e) => {
    const id = texto(e.id);
    if (id && !porId.has(id)) porId.set(id, deEmpresa(e));
    const nombre = norm(e.nombre || e.empresa || e.razonSocial);
    if (!porNombre.has(nombre)) porNombre.set(nombre, deEmpresa(e));
  });
  return (p) => {
    const id = texto(p.entidadId || p.clienteId || p.proveedorId || p.empresaId);
    if (id && porId.has(id)) return porId.get(id) ?? '';
    return porNombre.get(norm(p.entidadNombre)) ?? '';
  };
};

/**
 * Moneda canónica ('USD'/'MXN') de un documento de factura. ✅ V00496: manda la de la FACTURA (desde la
 * V00495 una factura emitida no cambia de moneda sola; antes mandaba la de la empresa, V00148, y una
 * factura en Pesos de una empresa que pasó a Dólares se mostraba y se cobraba en Dólares con su total en
 * Pesos). Si la factura no trae una moneda reconocible, la de la empresa; si tampoco, el primer texto.
 */
export const monedaDeFactura = (raw: Datos, monedaEmpresa: MonedaEmpresa): string => {
  const candidatos = [raw.monedaFacturacion, raw.monedaProveedor, raw.moneda, raw.monedaId];
  for (const c of candidatos) {
    const canon = monedaCanonica(c);
    if (canon) return canon;
  }
  const canonEmp = monedaCanonica(monedaEmpresa({
    entidadId: raw.clienteId || raw.proveedorId || raw.entidadId || '',
    entidadNombre: raw.clienteNombre || raw.proveedorNombre || raw.entidadNombre || '',
  }));
  if (canonEmp) return canonEmp;
  for (const c of candidatos) {
    const s = texto(c).trim();
    if (s) return s;
  }
  return '';
};

/**
 * ✅ V00496: saldo abierto por moneda. Desde la V00495 una empresa puede tener facturas emitidas en las dos
 * monedas (las de antes de cambiar la moneda de la empresa no cambian): no se suman Pesos con Dólares.
 */
export const saldosPorMoneda = (facturas: readonly { saldo: number; moneda: string }[]): { moneda: string; saldo: number }[] => {
  const centavos = new Map<string, number>();
  facturas.forEach((f) => { if (f.saldo > 0.009) centavos.set(f.moneda || '', (centavos.get(f.moneda || '') ?? 0) + Math.round(f.saldo * 100)); });
  return Array.from(centavos, ([moneda, c]) => ({ moneda, saldo: c / 100 })).sort((a, b) => a.moneda.localeCompare(b.moneda));
};

// Mismo criterio que Facturación: sin campo/vacío => 'Facturado'. Solo se excluyen las canceladas
// y las marcadas explícitamente como 'No Facturado'.
export const esFacturaCobrable = (raw: Datos): boolean => {
  const s = String(raw.statusFactura || 'Facturado').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!s) return true;
  if (s.includes('cancel')) return false;
  if (s.startsWith('no ')) return false; // "No Facturado"
  return true;
};

export interface OpcionesMapeo {
  /** Con `dineroPorServidor`: la regla ÚNICA de total (la que valida el servidor). */
  reglaUnica: boolean;
  monedaEmpresa: MonedaEmpresa;
}

/** Un documento de factura → FacturaPagable (total en la MONEDA de la factura, no la conversión). */
export const mapearFacturaPagable = (id: string, raw: Datos, tipo: TipoPago, o: OpcionesMapeo): FacturaPagable => {
  const total = o.reglaUnica ? totalNativoFacturaUnica(raw) : totalNativoFactura(raw);
  const pagado = Number(raw.montoPagado) || 0;
  return {
    id,
    invoice: texto(raw.invoice || raw.folio || id),
    fecha: texto(raw.fecha || raw.fechaFactura || ''),
    entidadId: texto((tipo === 'cliente' ? raw.clienteId : raw.proveedorId) || ''),
    entidadNombre: texto((tipo === 'cliente' ? (raw.clienteNombre || raw.cliente) : (raw.proveedorNombre || raw.proveedor)) || 'Sin nombre'),
    total,
    montoPagado: pagado,
    saldo: Math.max(0, total - pagado),
    moneda: monedaDeFactura(raw, o.monedaEmpresa),
    raw,
  };
};

/** Documento tal como llega del listener compartido ({ id, ...datos } con `_docId` = id real). */
export interface DocFactura { id: string; readonly _docId?: string; [campo: string]: unknown }

/**
 * Facturas pagables de los documentos de una colección de facturas: cobrables y con total
 * (los documentos secundarios de un folio repetido traen subtotal 0). Las pagadas SÍ van
 * (Pagos las muestra bloqueadas o las filtra según la pantalla).
 */
export const facturasPagablesDe = (docs: readonly DocFactura[], tipo: TipoPago, o: OpcionesMapeo): FacturaPagable[] => {
  const salida: FacturaPagable[] = [];
  for (const x of docs) {
    const idReal = String(x._docId ?? x.id);
    // `raw` como `d.data()`: sin el `id` que agrega el listener cuando el documento no lo guarda.
    let raw: Datos;
    if (x.id !== idReal) raw = x;
    else { raw = { ...x }; delete raw.id; }
    if (!esFacturaCobrable(raw)) continue;
    const f = mapearFacturaPagable(idReal, raw, tipo, o);
    if (f.total > 0) salida.push(f);
  }
  return salida;
};

// ✅ V00126: TOTAL FINAL de un gasto MTTO = el mismo que muestra el formulario de Gastos: total
//   guardado, o importe + IVA − RET IVA − RET ISR.
export const totalGastoMtto = (g: Datos): number => {
  const guardado = Number(g.total);
  if (Number.isFinite(guardado) && guardado > 0) return guardado;
  return (Number(g.importe) || 0) + (Number(g.ivaMonto) || 0) - (Number(g.retIva) || 0) - (Number(g.retIsr) || 0);
};

/** Lo mínimo de un pago que hace falta para el saldo de MTTO. */
export interface PagoAplicado { tipo?: string; facturas?: readonly { facturaId?: unknown; aplicado?: unknown }[] }

/**
 * ✅ MTTO: los "pendientes" son los GRUPOS POR INVOICE de gastos_mtto (agrupados por proveedor).
 * El saldo se DERIVA de los pagos tipo mtto (no se tocan los documentos de gastos).
 */
export const facturasMtto = (gastos: readonly DocFactura[], pagos: readonly PagoAplicado[]): FacturaPagable[] => {
  interface Grupo { invoice: string; total: number; fecha: string; entidad: string; gastos: Datos[] }
  const grupos = new Map<string, Grupo>();
  gastos.forEach((g) => {
    const inv = texto(g.invoice).trim();
    if (!inv) return; // sin invoice no es pagable por grupo
    const clave = inv.toLowerCase();
    const prev = grupos.get(clave) ?? { invoice: inv, total: 0, fecha: '', entidad: '', gastos: [] };
    prev.total += totalGastoMtto(g);
    const fg = texto(g.fecha || g.fechaGasto).slice(0, 10);
    if (fg > prev.fecha) prev.fecha = fg;
    if (!prev.entidad) prev.entidad = texto(g.proveedorNombre || g.proveedor).trim() || 'VARIOS';
    prev.gastos.push(g);
    grupos.set(clave, prev);
  });
  const pagadoPor = new Map<string, number>();
  pagos.filter((p) => p.tipo === 'mtto').forEach((p) => {
    (Array.isArray(p.facturas) ? p.facturas : []).forEach((fa) => {
      const id = texto(fa.facturaId);
      pagadoPor.set(id, (pagadoPor.get(id) ?? 0) + (Number(fa.aplicado) || 0));
    });
  });
  return Array.from(grupos.entries()).map(([clave, gr]) => {
    const id = `MTTO__${clave}`;
    const pagado = pagadoPor.get(id) ?? 0;
    return {
      id,
      invoice: gr.invoice,
      fecha: gr.fecha,
      entidadId: '',
      total: gr.total,
      montoPagado: pagado,
      saldo: Math.max(0, gr.total - pagado),
      moneda: 'MXN',
      entidadNombre: gr.entidad,
      raw: { gastos: gr.gastos, operacionesIds: [] },
    };
  });
};

// src/features/facturacion/services/documentoFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00514 — EL DOCUMENTO CONTRA LA FACTURA (lógica pura). Compara lo que se leyó del PDF o del XML
// de una factura (leerFacturaPdf.ts / leerCfdi.ts) contra lo que dice la app: el formulario de
// Generar Factura (las operaciones seleccionadas) o una factura ya registrada (Documentos de la
// factura). Revisa:
//   · el número de factura / invoice;
//   · el cliente (RFC; los extranjeros por Tax ID o por nombre; los Invoice de Roelca Inc por nombre);
//   · la moneda;
//   · las operaciones: las referencias del documento contra las de la factura;
//   · el costo de cada operación, al centavo, con la MISMA regla con que se factura (importeEn);
//   · el subtotal (la app maneja subtotales: el IVA y las retenciones los controla el SIT).
// Solo AVISA (regla del usuario, 29-oct): no impide guardar.
// ---------------------------------------------------------------------------
import { monedaCanonica } from '../../../shared/dominio/moneda';
import { montoOperacion, totalNativoDeOperaciones } from '../../../shared/dominio/dinero';
import { aCentavos, r2 } from '../../../shared/dominio/numeros';
import type { ClienteCotejo } from './cotejoCfdi';
import { claveNombre, importeEn, mismoNombre, RFC_GENERICOS, soloAlfanumerico } from './cotejoCfdi';
import type { Cfdi } from './leerCfdi';
import { esRefOperacion, normalizarRef } from './leerCfdi';
import type { DocumentoFactura } from './leerFacturaPdf';

type Datos = Record<string, unknown>;
type Moneda = 'USD' | 'MXN' | '';

/** Una operación de la factura: su referencia y lo que cobra la app en la moneda de la factura. */
export interface OpEsperada { ref: string; importe: number | null; tc: number }

/** Lo que dice la app de la factura con la que se compara el documento. */
export interface FacturaEsperada {
  folio: string;
  cliente: ClienteCotejo | null;
  moneda: Moneda;
  ops: OpEsperada[];
  /** ✅ V00519: el monto de la factura en la app, en su moneda (null = no se sabe). Se compara con el TOTAL
   *  del documento; si la app lleva el subtotal (sin impuestos), también cuenta como bien. */
  monto: number | null;
}

export type NivelHallazgo = 'ok' | 'error' | 'aviso' | 'info';
export type CampoHallazgo = 'folio' | 'cliente' | 'moneda' | 'operaciones' | 'importes' | 'subtotal' | 'total';
export interface Hallazgo { campo: CampoHallazgo; nivel: NivelHallazgo; texto: string }

/** ✅ V00519: la diferencia del documento contra la factura (documento − app), en la moneda de la factura. */
export interface DiferenciaDocumento {
  /** Con qué se comparó: el total del documento o su subtotal (el que está más cerca de la app). */
  base: 'total' | 'subtotal';
  documento: number;
  app: number;
  monto: number;
}
/** ✅ V00519: un concepto cuyo costo no concuerda (para proponer en qué operación va la diferencia). */
export interface DiferenciaOp { refs: string[]; documento: number; app: number; monto: number }

export interface RevisionDocumento {
  coincide: boolean;
  hallazgos: Hallazgo[];
  /** null = el monto coincide (o no se pudo comparar). */
  diferencia: DiferenciaDocumento | null;
  difOps: DiferenciaOp[];
}

const txt = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conMoneda = (n: number, m: Moneda): string => `${dinero(n)}${m ? ` ${m}` : ''}`;
const listaRefs = (refs: readonly string[]): string => (refs.length <= 6 ? refs.join(', ') : `${refs.slice(0, 6).join(', ')} y ${refs.length - 6} más`);
const conPunto = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);
const mismoFolio = (a: string, b: string): boolean => soloAlfanumerico(a) !== '' && soloAlfanumerico(a) === soloAlfanumerico(b);
const monedaDe = (v: unknown): Moneda => { const m = monedaCanonica(v); return m === 'USD' || m === 'MXN' ? m : ''; };

/** El XML (CFDI) en la misma forma que un PDF leído. */
export const documentoDeCfdi = (c: Cfdi): DocumentoFactura => ({
  formato: 'xml', folio: c.folio, fecha: c.fecha, clienteNombre: c.receptorNombre, clienteRfc: c.receptorRfc, clienteTaxId: c.receptorTaxId,
  moneda: c.moneda, subtotal: c.subtotal, total: c.total,
  conceptos: c.conceptos.map((k) => ({ refs: k.refs, importe: k.importe, descripcion: k.descripcion, tc: k.tcDescripcion })),
});

// ── Lo esperado ───────────────────────────────────────────────────────────
/** Una operación de la lista (Generar Factura), con lo que cobra la app en la moneda de la factura. */
export const opEsperadaDeOperacion = (op: Datos, moneda: Moneda): OpEsperada => ({
  ref: normalizarRef(txt(op.numReferencia) || txt(op.referencia) || txt(op.ref)),
  importe: moneda ? importeEn(moneda, op) : null,
  tc: montoOperacion(op, 'cliente').tc,
});

/**
 * Las operaciones de una factura YA registrada: sus renglones guardados (con lo que se facturó) y,
 * si la factura solo lista referencias (las de AppSheet), esas referencias sin importe.
 */
export const opsEsperadasDeFactura = (f: Datos, moneda: Moneda): OpEsperada[] => {
  const porRef = new Map<string, OpEsperada>();
  lista(f.operacionesGuardadas).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const ref = normalizarRef(txt((r as Datos).ref));
    if (!ref || porRef.has(ref)) return;
    porRef.set(ref, { ref, importe: moneda ? r2(totalNativoDeOperaciones(moneda, [r])) : null, tc: 0 });
  });
  lista(f.operaciones).map(txt).filter(esRefOperacion).forEach((x) => { // ✅ V00519: también las viejas
    const ref = normalizarRef(x);
    if (!porRef.has(ref)) porRef.set(ref, { ref, importe: null, tc: 0 });
  });
  return Array.from(porRef.values());
};

export const monedaEsperada = (v: unknown): Moneda => monedaDe(v);

// ── Comparación ───────────────────────────────────────────────────────────
const comparaCliente = (d: DocumentoFactura, c: ClienteCotejo): boolean => {
  const rfcApp = soloAlfanumerico(c.rfc);
  const rfcDoc = soloAlfanumerico(d.clienteRfc);
  if (rfcDoc && !RFC_GENERICOS.has(rfcDoc) && rfcApp && !RFC_GENERICOS.has(rfcApp)) return rfcDoc === rfcApp;
  const tax = soloAlfanumerico(d.clienteTaxId);
  if (tax && rfcApp && !RFC_GENERICOS.has(rfcApp) && (rfcApp === tax || rfcApp.includes(tax))) return true;
  if (mismoNombre(d.clienteNombre, c.nombre)) return true;
  // "Landstar Transportation Logistics" ~ "LANDSTAR TRANSPORTATION LOGISTICS INC": la clave de uno contiene la del otro.
  const a = claveNombre(d.clienteNombre);
  const b = claveNombre(c.nombre);
  return a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a));
};

const describeClienteDoc = (d: DocumentoFactura): string => {
  const id = [d.clienteRfc && !RFC_GENERICOS.has(soloAlfanumerico(d.clienteRfc)) ? d.clienteRfc : '', d.clienteTaxId ? `Tax ID ${d.clienteTaxId}` : ''].filter(Boolean).join(' / ');
  return `${d.clienteNombre || '(sin nombre)'}${id ? ` (${id})` : ''}`;
};

export const compararDocumentoFactura = (d: DocumentoFactura, e: FacturaEsperada): RevisionDocumento => {
  const h: Hallazgo[] = [];
  const moneda: Moneda = e.moneda || d.moneda;

  // Número de factura
  if (!d.folio) h.push({ campo: 'folio', nivel: 'aviso', texto: 'No se encontró el número de factura en el documento.' });
  else if (!txt(e.folio)) h.push({ campo: 'folio', nivel: 'error', texto: `El documento es la factura ${d.folio} y el formulario no tiene número de invoice.` });
  else if (!mismoFolio(d.folio, e.folio)) h.push({ campo: 'folio', nivel: 'error', texto: `El número no es el mismo: el documento es la factura ${d.folio} y en el formulario dice ${txt(e.folio)}.` });
  else h.push({ campo: 'folio', nivel: 'ok', texto: conPunto(`Número de factura: ${d.folio}`) });

  // Cliente
  if (!e.cliente) h.push({ campo: 'cliente', nivel: 'aviso', texto: 'La factura todavía no tiene cliente para comparar.' });
  else if (!d.clienteNombre && !d.clienteRfc) h.push({ campo: 'cliente', nivel: 'aviso', texto: 'No se encontró el cliente en el documento.' });
  else if (!comparaCliente(d, e.cliente)) {
    h.push({ campo: 'cliente', nivel: 'error', texto: conPunto(`El cliente no es el mismo: el documento es para ${describeClienteDoc(d)} y la factura es de ${e.cliente.nombre}${e.cliente.rfc ? ` (${e.cliente.rfc})` : ''}`) });
  } else h.push({ campo: 'cliente', nivel: 'ok', texto: conPunto(`Cliente: ${e.cliente.nombre}`) });

  // Moneda
  if (d.moneda && e.moneda && d.moneda !== e.moneda) h.push({ campo: 'moneda', nivel: 'error', texto: `La moneda no es la misma: el documento está en ${d.moneda} y la factura en ${e.moneda}.` });

  // Operaciones
  const refsDoc = [...new Set(d.conceptos.flatMap((c) => c.refs))];
  const refsApp = [...new Set(e.ops.map((o) => o.ref).filter(Boolean))];
  const enApp = new Set(refsApp);
  const enDoc = new Set(refsDoc);
  const sobran = refsDoc.filter((r) => !enApp.has(r));
  const faltan = refsApp.filter((r) => !enDoc.has(r));
  if (refsDoc.length === 0) {
    h.push({ campo: 'operaciones', nivel: 'aviso', texto: 'El documento no trae números de referencia de operación: no se pueden comparar las operaciones.' });
  } else if (sobran.length || faltan.length) {
    const partes = [
      sobran.length ? `el documento trae ${listaRefs(sobran)}, que no ${sobran.length === 1 ? 'está' : 'están'} en la factura` : '',
      faltan.length ? `la factura tiene ${listaRefs(faltan)}, que no ${faltan.length === 1 ? 'está' : 'están'} en el documento` : '',
    ].filter(Boolean);
    h.push({ campo: 'operaciones', nivel: 'error', texto: `Esas no son las operaciones que van en esa factura: ${partes.join('; ')}.` });
  } else {
    h.push({ campo: 'operaciones', nivel: 'ok', texto: `Operaciones: ${refsDoc.length === 1 ? 'la del documento es la de' : `las ${refsDoc.length} del documento son las de`} la factura.` });
  }

  // Subtotal del documento (o la suma de sus conceptos) y, si trae impuestos, cuánto pesan (total / subtotal).
  const subDoc = d.subtotal ?? (d.conceptos.every((c) => c.importe !== null) && d.conceptos.length ? r2(d.conceptos.reduce((s, c) => s + (c.importe ?? 0), 0)) : null);
  const factor = d.total !== null && subDoc !== null && subDoc > 0 && aCentavos(d.total) !== aCentavos(subDoc) ? d.total / subDoc : 1;

  // Costo de cada operación (conceptos cuyas referencias están en la factura). ✅ V00519: el concepto
  // del documento va sin impuestos; si la app lleva el importe con impuestos, también coincide.
  const porRef = new Map(e.ops.map((o) => [o.ref, o] as const));
  const difs: string[] = [];
  const difOps: DiferenciaOp[] = [];
  let comparados = 0;
  d.conceptos.forEach((c) => {
    if (c.importe === null || c.refs.length === 0) return;
    const ops = c.refs.map((r) => porRef.get(r));
    if (ops.some((o) => !o || o.importe === null)) return;
    comparados++;
    const app = r2(ops.reduce((s, o) => s + (o?.importe ?? 0), 0));
    const conImpuestos = r2(c.importe * factor);
    if (aCentavos(app) === aCentavos(c.importe) || (factor !== 1 && aCentavos(app) === aCentavos(conImpuestos))) return;
    const docRef = factor !== 1 && Math.abs(conImpuestos - app) < Math.abs(c.importe - app) ? conImpuestos : c.importe;
    const dif = r2(docRef - app);
    difOps.push({ refs: c.refs, documento: docRef, app, monto: dif });
    const tcOp = ops[0]?.tc ?? 0;
    const pista = moneda === 'MXN' && c.tc > 0 && tcOp > 0 && Math.abs(c.tc - tcOp) > 0.00005 ? ` El documento usa TC ${c.tc} y la operación ${tcOp}.` : '';
    difs.push(`${c.refs.join(' + ')}: el documento cobra ${conMoneda(docRef, moneda)}${docRef !== c.importe ? ' con impuestos' : ''} y la factura ${dinero(app)} (diferencia ${dif > 0 ? '+' : ''}${dinero(dif)}).${pista}`);
  });
  if (difs.length) difs.forEach((t) => h.push({ campo: 'importes', nivel: 'error', texto: `El costo no concuerda: ${t}` }));
  else if (comparados > 0) h.push({ campo: 'importes', nivel: 'ok', texto: `Costo de cada operación: ${comparados === 1 ? 'coincide' : `coinciden las ${comparados}`}.` });

  // ✅ V00519: el monto de la factura se compara con el TOTAL del documento; si la app lleva el subtotal
  // (sin impuestos), también está bien. Si no coincide ninguno, la diferencia es contra el más cercano.
  const mDoc = d.moneda || moneda;
  const bases = ([['total', d.total], ['subtotal', subDoc]] as const)
    .flatMap(([base, v]) => (v === null ? [] : [{ base, v }]))
    .filter((x, i, a) => a.findIndex((y) => aCentavos(y.v) === aCentavos(x.v)) === i);
  let diferencia: DiferenciaDocumento | null = null;
  if (bases.length === 0) h.push({ campo: 'total', nivel: 'aviso', texto: 'No se encontró el total en el documento.' });
  else if (e.monto === null) h.push({ campo: 'total', nivel: 'aviso', texto: `El documento dice total ${conMoneda(bases[0].v, mDoc)}; la factura no tiene monto para comparar.` });
  else {
    const app = e.monto;
    const igual = bases.find((b) => aCentavos(b.v) === aCentavos(app));
    if (igual?.base === 'total') h.push({ campo: 'total', nivel: 'ok', texto: `Total: ${conMoneda(igual.v, moneda)}.` });
    else if (igual) {
      h.push({ campo: 'total', nivel: 'ok', texto: `Subtotal: ${conMoneda(igual.v, moneda)}. La factura de la app no lleva los impuestos; el documento con impuestos da ${conMoneda(d.total ?? igual.v, mDoc)}.` });
    } else {
      const cerca = bases.reduce((a, b) => (Math.abs(b.v - app) < Math.abs(a.v - app) ? b : a));
      const dif = r2(cerca.v - app);
      diferencia = { base: cerca.base, documento: cerca.v, app, monto: dif };
      h.push({ campo: 'total', nivel: 'error', texto: `${cerca.base === 'total' ? 'Ese total' : 'Ese subtotal'} no concuerda con la factura: el documento dice ${conMoneda(cerca.v, mDoc)} y la factura ${conMoneda(app, moneda)} (diferencia ${dif > 0 ? '+' : ''}${dinero(dif)}).` });
    }
  }

  return { coincide: !h.some((x) => x.nivel === 'error'), hallazgos: h, diferencia, difOps };
};

// src/features/facturacion/services/leerFacturaPdf.ts
// ---------------------------------------------------------------------------
// ✅ V00514 — LEER UNA FACTURA EN PDF (lógica pura). Recibe el texto del PDF como lo entrega pdf.js
// (cada pedazo de texto con su posición: services/textoPdf.ts) y saca lo que se compara con el
// formulario de facturación: número de factura, cliente, moneda, cada concepto con sus referencias
// de operación y su importe, subtotal y total. Dos formatos (los de los PDF reales del 29-oct):
//   · CFDI del SIT ("FACTURA ELECTRONICA (CFDI)"): SERIE Y FOLIO, NOMBRE O RAZÓN SOCIAL + RFC
//     (los extranjeros traen "(Id. trib: …)"), MONEDA, conceptos con clave SAT, SUBTOTAL / TOTAL.
//     Un concepto puede juntar dos referencias ("TR-221026-006 // FL-201026-001") con un importe.
//   · Invoice de Roelca Inc (Laredo, TX): INVOICE #, BILL TO, renglones DATE / REF# / … / AMOUNT,
//     SUBTOTAL / TOTAL. En dólares.
// Lo que no sea de ninguno de los dos: solo las referencias, el subtotal y el total que se encuentren.
// ---------------------------------------------------------------------------
import { normalizarRef } from './leerCfdi';

/** Un pedazo de texto de una página del PDF (x, y en puntos; y crece hacia arriba). */
export interface ItemPdf { s: string; x: number; y: number; w: number }

interface Celda { x: number; fin: number; s: string }
export interface LineaPdf { y: number; celdas: Celda[]; texto: string }

export type FormatoFactura = 'sit' | 'invoice' | 'otro';

export interface ConceptoDocumento {
  refs: string[];
  /** null = no se encontró el importe del concepto. */
  importe: number | null;
  descripcion: string;
  /** TC escrito en la descripción ("TC 18.4200" o "TC: 18.6670"); 0 si no trae. */
  tc: number;
}

/** Lo que se leyó de una factura (PDF o XML), en la misma forma para comparar. */
export interface DocumentoFactura {
  formato: FormatoFactura | 'xml';
  /** Serie + folio ("F1072") o número de invoice ("39838"); '' si no se encontró. */
  folio: string;
  /** AAAA-MM-DD ('' si no). */
  fecha: string;
  clienteNombre: string;
  clienteRfc: string;
  clienteTaxId: string;
  moneda: 'USD' | 'MXN' | '';
  subtotal: number | null;
  total: number | null;
  conceptos: ConceptoDocumento[];
}

export type LecturaDocumento = { ok: true; doc: DocumentoFactura } | { ok: false; error: string };

const REF_RE = /\b(TR|LO|FL|RE)-(\d{6})-(\d{1,3})\b/gi;
const TC_RE = /\bTC:?\s*(\d+(?:\.\d+)?)/i;
const DINERO_RE = /^\$?\s*-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\$?\s*-?\d+(?:\.\d+)?$/;

const sinAcentos = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const esDinero = (s: string): boolean => DINERO_RE.test(s.trim());
const aNumero = (s: string): number => Number(s.replace(/[$,\s]/g, ''));
export const refsDe = (texto: string): string[] => [...new Set([...texto.matchAll(REF_RE)].map((m) => normalizarRef(m[0])))];

// ── Texto de la página en renglones ─────────────────────────────────────────
/** Junta los pedazos en renglones (misma altura) y celdas (pedazos pegados), de arriba abajo. */
export const lineasDeItems = (items: readonly ItemPdf[], tolerancia = 2): LineaPdf[] => {
  const conTexto = items.filter((i) => i.s.trim() !== '');
  const porY = [...conTexto].sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos: ItemPdf[][] = [];
  porY.forEach((it) => {
    const g = grupos[grupos.length - 1];
    if (g && Math.abs(g[0].y - it.y) <= tolerancia) g.push(it); else grupos.push([it]);
  });
  return grupos.map((g) => {
    const orden = [...g].sort((a, b) => a.x - b.x);
    const celdas: Celda[] = [];
    orden.forEach((it) => {
      const ultima = celdas[celdas.length - 1];
      if (ultima && it.x - ultima.fin < 1.5) { ultima.s += (it.x - ultima.fin > 0.4 ? ' ' : '') + it.s; ultima.fin = Math.max(ultima.fin, it.x + it.w); }
      else celdas.push({ x: it.x, fin: it.x + it.w, s: it.s });
    });
    celdas.forEach((c) => { c.s = c.s.replace(/\s+/g, ' ').trim(); });
    return { y: g[0].y, celdas: celdas.filter((c) => c.s), texto: celdas.map((c) => c.s).join('  ') };
  });
};

// ── Ayudas para buscar valores ─────────────────────────────────────────────
const indiceCelda = (l: LineaPdf, etiqueta: string): number => {
  const e = sinAcentos(etiqueta);
  return l.celdas.findIndex((c) => sinAcentos(c.s).startsWith(e));
};

/** Valor a la derecha de una etiqueta ("SERIE Y FOLIO:  F1072"), en la misma celda o la siguiente. */
const valorDe = (lineas: readonly LineaPdf[], etiqueta: string, desde = 0, hasta = lineas.length): string => {
  for (let i = desde; i < hasta; i++) {
    const l = lineas[i];
    const k = indiceCelda(l, etiqueta);
    if (k < 0) continue;
    const resto = l.celdas[k].s.slice(etiqueta.length).trim();
    if (resto) return resto;
    if (l.celdas[k + 1]) return l.celdas[k + 1].s;
  }
  return '';
};

const indiceLinea = (lineas: readonly LineaPdf[], prueba: (l: LineaPdf) => boolean, desde = 0): number => {
  for (let i = desde; i < lineas.length; i++) if (prueba(lineas[i])) return i;
  return -1;
};
const contiene = (texto: string) => (l: LineaPdf): boolean => sinAcentos(l.texto).includes(sinAcentos(texto));

/** Número de dinero a la derecha de una etiqueta que es una celda completa ("SUBTOTAL:" → 135,000.00). */
const montoDe = (lineas: readonly LineaPdf[], etiquetas: readonly string[]): number | null => {
  const quieren = etiquetas.map(sinAcentos);
  for (let i = lineas.length - 1; i >= 0; i--) {
    const l = lineas[i];
    const k = l.celdas.findIndex((c) => quieren.includes(sinAcentos(c.s).replace(/\s+/g, ' ')));
    if (k < 0) continue;
    const num = l.celdas.slice(k + 1).find((c) => esDinero(c.s));
    if (num) return aNumero(num.s);
  }
  return null;
};

const fechaDMA = (s: string): string => {
  const m = /(\d{2})[-/](\d{2})[-/](\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const fechaMDA = (s: string): string => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
};

const monedaDeTexto = (s: string): DocumentoFactura['moneda'] => {
  const t = sinAcentos(s);
  if (/\(MXN\)|\bMXN\b|PESOS/.test(t)) return 'MXN';
  if (/\(USD\)|\bUSD\b|DOLARES|DOLLARS/.test(t)) return 'USD';
  return '';
};

const conceptoDe = (textos: readonly string[], importe: number | null): ConceptoDocumento => {
  const todo = textos.join(' ');
  return { refs: refsDe(todo), importe, descripcion: todo.replace(/\s+/g, ' ').trim(), tc: Number(TC_RE.exec(todo)?.[1] ?? 0) || 0 };
};

// ── CFDI del SIT ──────────────────────────────────────────────────────────
const leerSit = (lineas: readonly LineaPdf[]): DocumentoFactura => {
  const iCliente = indiceLinea(lineas, (l) => l.celdas.some((c) => sinAcentos(c.s) === 'CLIENTE'));
  const iConceptos = indiceLinea(lineas, (l) => l.celdas.some((c) => sinAcentos(c.s) === 'CONCEPTOS'));
  const nombreCompleto = valorDe(lineas, 'NOMBRE O RAZÓN SOCIAL:');
  const taxId = /\(Id\.?\s*trib:?\s*([^)]+)\)/i.exec(nombreCompleto)?.[1]?.trim() ?? '';
  const rfc = valorDe(lineas, 'RFC:', Math.max(iCliente, 0), iConceptos > 0 ? iConceptos : lineas.length).split(/\s+/)[0] ?? '';

  // Conceptos: del encabezado (DESCRIPCIÓN … IMPORTE) a "INFORMACIÓN ADICIONAL".
  const iEncabezado = indiceLinea(lineas, (l) => contiene('DESCRIPCION')(l) && contiene('IMPORTE')(l), Math.max(iConceptos, 0));
  const iFin = indiceLinea(lineas, contiene('INFORMACION ADICIONAL'), Math.max(iEncabezado, 0));
  const cuerpo = lineas.slice(iEncabezado + 1, iFin > 0 ? iFin : lineas.length);
  const conceptos: ConceptoDocumento[] = [];
  let actual: { textos: string[]; importe: number | null } | null = null;
  const cerrar = () => { if (actual) conceptos.push(conceptoDe(actual.textos, actual.importe)); };
  cuerpo.forEach((l) => {
    const primera = l.celdas[0]?.s ?? '';
    if (/^\d{8}$/.test(primera)) { // clave SAT del producto: empieza un concepto
      cerrar();
      const dinero = l.celdas.filter((c) => esDinero(c.s));
      const importe = dinero.length ? aNumero(dinero[dinero.length - 1].s) : null;
      // descripción = celdas que no son clave, cantidad, unidad, dinero ni impuesto
      const textos = l.celdas.slice(1).filter((c) => !esDinero(c.s) && !/^[A-Z]\d{2}$/.test(c.s) && !/^Objeto imp/i.test(c.s)).map((c) => c.s);
      actual = { textos, importe };
      return;
    }
    if (!actual) return;
    // renglones de la descripción (sin el desglose del IVA: "IVA (002) 0.00", "Tasa 0.160000")
    actual.textos.push(...l.celdas.filter((c) => !/^(IVA|Tasa|Cuota|Exento)\b/i.test(c.s) && !esDinero(c.s)).map((c) => c.s));
  });
  cerrar();

  // Moneda: el renglón debajo de "MONEDA:" ("Pesos (MXN)" / "Dólares (USD)"), si no la cantidad con letra.
  const iMoneda = indiceLinea(lineas, (l) => indiceCelda(l, 'MONEDA:') >= 0);
  const moneda = (iMoneda >= 0 ? monedaDeTexto(lineas.slice(iMoneda, iMoneda + 3).map((l) => l.texto).join(' ')) : '')
    || monedaDeTexto(valorDe(lineas, 'CANTIDAD CON LETRA:'));

  return {
    formato: 'sit',
    folio: valorDe(lineas, 'SERIE Y FOLIO:').replace(/\s+/g, ''),
    fecha: fechaDMA(valorDe(lineas, 'FECHA EMISIÓN:')),
    clienteNombre: nombreCompleto.replace(/\(Id\.?\s*trib:?[^)]*\)/i, '').trim(),
    clienteRfc: rfc.toUpperCase(),
    clienteTaxId: taxId,
    moneda,
    subtotal: montoDe(lineas, ['SUBTOTAL:', 'SUBTOTAL']),
    total: montoDe(lineas, ['TOTAL:', 'TOTAL']),
    conceptos,
  };
};

// ── Invoice de Roelca Inc ─────────────────────────────────────────────────
/** Celda de la línea `l` que queda debajo (misma columna) de la celda `x` del encabezado. */
const celdaBajo = (l: LineaPdf | undefined, x: number): string => {
  if (!l) return '';
  let mejor: Celda | null = null;
  l.celdas.forEach((c) => { if (Math.abs(c.x - x) < 25 && (!mejor || Math.abs(c.x - x) < Math.abs(mejor.x - x))) mejor = c; });
  return (mejor as Celda | null)?.s ?? '';
};

const leerInvoice = (lineas: readonly LineaPdf[]): DocumentoFactura => {
  const iEnc = indiceLinea(lineas, (l) => indiceCelda(l, 'INVOICE #') >= 0);
  const enc = lineas[iEnc];
  const xNum = enc ? enc.celdas[indiceCelda(enc, 'INVOICE #')].x : 0;
  const kFecha = enc ? enc.celdas.findIndex((c) => sinAcentos(c.s) === 'DATE') : -1;
  const folio = enc ? celdaBajo(lineas[iEnc + 1], xNum) : '';
  const fecha = enc && kFecha >= 0 ? fechaMDA(celdaBajo(lineas[iEnc + 1], enc.celdas[kFecha].x)) : '';

  const iBill = indiceLinea(lineas, contiene('BILL TO'));
  const clienteNombre = iBill >= 0 ? (lineas[iBill + 1]?.celdas[0]?.s ?? '') : '';

  // Renglones: del encabezado DATE / REF# / … / AMOUNT a SUBTOTAL; cada uno empieza con una fecha.
  const iTabla = indiceLinea(lineas, (l) => contiene('AMOUNT')(l) && (contiene('REF#')(l) || contiene('DESCRIPTION')(l)));
  const iSub = indiceLinea(lineas, (l) => l.celdas.some((c) => sinAcentos(c.s) === 'SUBTOTAL'), Math.max(iTabla, 0));
  const cuerpo = iTabla >= 0 ? lineas.slice(iTabla + 1, iSub > 0 ? iSub : lineas.length) : [];
  const conceptos: ConceptoDocumento[] = [];
  let actual: { textos: string[]; importe: number | null } | null = null;
  const cerrar = () => { if (actual) conceptos.push(conceptoDe(actual.textos, actual.importe)); };
  cuerpo.forEach((l) => {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(l.celdas[0]?.s ?? '') && l.celdas.length >= 3) {
      cerrar();
      const ultima = l.celdas[l.celdas.length - 1];
      actual = { textos: l.celdas.slice(1, -1).filter((c) => !esDinero(c.s)).map((c) => c.s), importe: esDinero(ultima.s) ? aNumero(ultima.s) : null };
      return;
    }
    if (actual) actual.textos.push(...l.celdas.map((c) => c.s));
  });
  cerrar();

  return {
    formato: 'invoice',
    folio: folio.replace(/\s+/g, ''),
    fecha,
    clienteNombre,
    clienteRfc: '',
    clienteTaxId: '',
    moneda: 'USD',
    subtotal: montoDe(lineas, ['SUBTOTAL']),
    total: montoDe(lineas, ['TOTAL']),
    conceptos,
  };
};

// ── Cualquier otro PDF ────────────────────────────────────────────────────
const leerOtro = (lineas: readonly LineaPdf[]): DocumentoFactura => {
  const todo = lineas.map((l) => l.texto).join('\n');
  const refs = refsDe(todo);
  return {
    formato: 'otro', folio: '', fecha: '', clienteNombre: '', clienteRfc: '', clienteTaxId: '',
    moneda: monedaDeTexto(todo),
    subtotal: montoDe(lineas, ['SUBTOTAL:', 'SUBTOTAL', 'SUB-TOTAL']),
    total: montoDe(lineas, ['TOTAL:', 'TOTAL']),
    conceptos: refs.length ? [{ refs, importe: null, descripcion: '', tc: 0 }] : [],
  };
};

/** Lee una factura de las páginas de texto de su PDF. */
export const leerFacturaPdf = (paginas: readonly (readonly ItemPdf[])[]): LecturaDocumento => {
  const lineas = paginas.flatMap((p) => lineasDeItems(p));
  if (lineas.length === 0) return { ok: false, error: 'El PDF no trae texto (¿es una imagen escaneada?): no se puede revisar.' };
  const texto = sinAcentos(lineas.map((l) => l.texto).join('\n'));
  if (texto.includes('FACTURA ELECTRONICA (CFDI)') || texto.includes('SERIE Y FOLIO')) return { ok: true, doc: leerSit(lineas) };
  if (texto.includes('INVOICE #') && texto.includes('BILL TO')) return { ok: true, doc: leerInvoice(lineas) };
  const doc = leerOtro(lineas);
  if (doc.conceptos.length === 0 && doc.subtotal === null && doc.total === null) {
    return { ok: false, error: 'No parece una factura: no trae referencias de operación ni subtotal.' };
  }
  return { ok: true, doc };
};

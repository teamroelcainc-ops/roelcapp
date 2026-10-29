// src/features/facturacion/services/leerCfdi.ts
// ---------------------------------------------------------------------------
// ✅ V00513 — LEER EL XML DE UNA FACTURA FISCAL (CFDI 4.0 del SIT).
// El XML es el dato oficial timbrado ante el SAT: de aquí salen folio, fecha,
// cliente (RFC), moneda, tipo de cambio, UUID, subtotal y CADA concepto con su
// importe. Las referencias van en la descripción de cada concepto (una por
// renglón: "IMPORTACION CAJA POR LAREDO CARGADA TR-271026-026 27/10/2026 CAJA
// ETX53269 REF 568917117 …"), así que cada referencia trae su propio importe.
// Usa DOMParser (navegador); no depende de ninguna librería.
// ---------------------------------------------------------------------------

export interface ConceptoCfdi {
  descripcion: string;
  importe: number;
  /** Referencias de operación encontradas en la descripción (normalizadas: TR-271026-026). */
  refs: string[];
  caja: string;
  refCliente: string;
  /** Tipo de cambio escrito en la descripción ("TC 18.4200"), 0 si no trae. */
  tcDescripcion: number;
}

export interface Cfdi {
  /** Serie + folio, como se guarda en la app ("I8663"). */
  folio: string;
  serie: string;
  numero: string;
  /** AAAA-MM-DD */
  fecha: string;
  /** 'I' ingreso, 'E' egreso (nota de crédito), 'P' pago… */
  tipo: string;
  moneda: 'USD' | 'MXN' | '';
  tipoCambio: number;
  subtotal: number;
  total: number;
  uuid: string;
  emisorRfc: string;
  receptorNombre: string;
  receptorRfc: string;
  /** Tax ID del extranjero (RFC genérico XEXX010101000). */
  receptorTaxId: string;
  conceptos: ConceptoCfdi[];
}

export type ResultadoLectura =
  | { ok: true; cfdi: Cfdi }
  | { ok: false; error: string };

// ✅ V00519: también las referencias VIEJAS (AppSheet), sin guion después del tipo: "TR46028-05".
const PATRON_REF = '\\b(?:(TR|LO|FL|RE)-(\\d{6})-(\\d{1,3})|(?:TR|LO|FL|RE)\\d{4,5}-\\d{1,3})\\b';
/** Expresión nueva en cada uso (lleva la bandera g: no se comparte su lastIndex). */
export const refsRegex = (): RegExp => new RegExp(PATRON_REF, 'gi');
const REF_RE = refsRegex();

/** ¿Es una referencia de operación (nueva "TR-271026-026" o vieja "TR46028-05")? */
export const esRefOperacion = (v: string): boolean => new RegExp(`^\\s*${PATRON_REF}\\s*$`, 'i').test(v);

/** "tr-271026-26" → "TR-271026-026" (la app guarda ambas formas); las viejas, en mayúsculas. */
export const normalizarRef = (ref: string): string => {
  const m = /^\s*(TR|LO|FL|RE)-(\d{6})-(\d{1,3})\s*$/i.exec(ref);
  return m ? `${m[1].toUpperCase()}-${m[2]}-${m[3].padStart(3, '0')}` : ref.trim().toUpperCase();
};

const numero = (v: string | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Datos que vienen escritos en la descripción de un concepto. */
export const datosDeDescripcion = (descripcion: string): Omit<ConceptoCfdi, 'descripcion' | 'importe'> => {
  const texto = descripcion.replace(/\s+/g, ' ').trim();
  const refs = [...new Set([...texto.matchAll(REF_RE)].map((m) => normalizarRef(m[0])))];
  // Caja y Ref Cliente se buscan DESPUÉS de la primera referencia: antes va el nombre del servicio
  // ("IMPORTACION CAJA POR LAREDO…").
  const primera = texto.search(REF_RE);
  const resto = primera >= 0 ? texto.slice(primera) : texto;
  const caja = /\bCAJA\s+(\S+)/i.exec(resto)?.[1] ?? '';
  const refCliente = /\bREF\s+(\S+)/i.exec(resto)?.[1] ?? '';
  const tcDescripcion = numero(/\bTC:?\s*(\d+(?:\.\d+)?)/i.exec(resto)?.[1] ?? null); // ✅ V00514: también "TC: 18.6670"
  return { refs, caja, refCliente, tcDescripcion };
};

const monedaDe = (v: string | null): Cfdi['moneda'] => {
  const t = String(v ?? '').trim().toUpperCase();
  return t === 'USD' || t === 'MXN' ? t : '';
};

/** Primer elemento con ese nombre local (sin importar el prefijo cfdi:/tfd:). */
const elemento = (raiz: Document | Element, nombre: string): Element | null => raiz.getElementsByTagNameNS('*', nombre)[0] ?? null;

/** Lee el texto de un XML de CFDI. No lanza: si algo falta, devuelve el motivo. */
export const leerCfdi = (xml: string): ResultadoLectura => {
  let docXml: Document;
  try {
    docXml = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return { ok: false, error: 'El archivo no es un XML válido.' };
  }
  if (docXml.getElementsByTagName('parsererror').length > 0) return { ok: false, error: 'El archivo no es un XML válido.' };
  const comp = elemento(docXml, 'Comprobante');
  if (!comp) return { ok: false, error: 'No es una factura del SAT (no trae cfdi:Comprobante).' };

  const serie = (comp.getAttribute('Serie') ?? '').trim();
  const numeroFolio = (comp.getAttribute('Folio') ?? '').trim();
  if (!numeroFolio) return { ok: false, error: 'La factura no trae folio.' };
  const emisor = elemento(comp, 'Emisor');
  const receptor = elemento(comp, 'Receptor');
  const timbre = elemento(comp, 'TimbreFiscalDigital');

  const conceptos: ConceptoCfdi[] = [...comp.getElementsByTagNameNS('*', 'Concepto')].map((c) => {
    const descripcion = (c.getAttribute('Descripcion') ?? '').trim();
    return { descripcion, importe: numero(c.getAttribute('Importe')), ...datosDeDescripcion(descripcion) };
  });

  return {
    ok: true,
    cfdi: {
      folio: `${serie}${numeroFolio}`,
      serie,
      numero: numeroFolio,
      fecha: (comp.getAttribute('Fecha') ?? '').slice(0, 10),
      tipo: (comp.getAttribute('TipoDeComprobante') ?? '').trim().toUpperCase(),
      moneda: monedaDe(comp.getAttribute('Moneda')),
      tipoCambio: numero(comp.getAttribute('TipoCambio')),
      subtotal: numero(comp.getAttribute('SubTotal')),
      total: numero(comp.getAttribute('Total')),
      uuid: (timbre?.getAttribute('UUID') ?? '').trim().toUpperCase(),
      emisorRfc: (emisor?.getAttribute('Rfc') ?? '').trim().toUpperCase(),
      receptorNombre: (receptor?.getAttribute('Nombre') ?? '').trim(),
      receptorRfc: (receptor?.getAttribute('Rfc') ?? '').trim().toUpperCase(),
      receptorTaxId: (receptor?.getAttribute('NumRegIdTrib') ?? '').trim(),
      conceptos,
    },
  };
};

// src/features/facturacion/services/leerDocumentoFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00514 — Lee un archivo de factura que se está subiendo (PDF o XML) y lo deja en la forma que
// se compara con la factura (documentoFactura.ts). Cada archivo se lee UNA vez (caché por archivo):
// cambiar el número de invoice o la selección solo vuelve a comparar, no a leer.
// ---------------------------------------------------------------------------
import { documentoDeCfdi } from './documentoFactura';
import { leerCfdi } from './leerCfdi';
import { leerFacturaPdf } from './leerFacturaPdf';
import type { LecturaDocumento } from './leerFacturaPdf';
import { esPdfNombre, esXmlNombre } from './parearPdfXml';
import { itemsDePdf } from './textoPdf';

const cache = new WeakMap<File, Promise<LecturaDocumento>>();

/** ¿Es un archivo que se puede revisar contra la factura? */
export const esDocumentoRevisable = (f: File): boolean => esPdfNombre(f.name, f.type) || esXmlNombre(f.name, f.type);

const leer = async (f: File): Promise<LecturaDocumento> => {
  try {
    if (esXmlNombre(f.name, f.type)) {
      const r = leerCfdi(await f.text());
      return r.ok ? { ok: true, doc: documentoDeCfdi(r.cfdi) } : { ok: false, error: r.error };
    }
    return leerFacturaPdf(await itemsDePdf(f));
  } catch (e) {
    console.error('[Facturación] No se pudo leer el documento de la factura:', e);
    return { ok: false, error: 'No se pudo leer el archivo (¿está dañado o protegido con contraseña?).' };
  }
};

export const leerDocumentoFactura = (f: File): Promise<LecturaDocumento> => {
  const hit = cache.get(f);
  if (hit) return hit;
  const p = leer(f);
  cache.set(f, p);
  return p;
};

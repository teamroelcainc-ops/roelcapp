// src/features/facturacion/services/parearPdfXml.ts
// ---------------------------------------------------------------------------
// ✅ V00513 — Junta cada PDF (la factura para verla) con su XML (los datos) en "Subir XML".
// El SIT los nombra igual ("ROE180119IV4-I8663.pdf" / ".xml"). En orden:
//   1) mismo nombre sin extensión (sin importar mayúsculas ni el " (1)" que agrega el navegador);
//   2) el nombre del PDF trae el UUID del XML;
//   3) el nombre del PDF trae el folio del XML (I8663) como palabra completa.
// Cada PDF se usa una sola vez. Puro.
// ---------------------------------------------------------------------------

export interface XmlParaParear { clave: string; nombre: string; folio: string; uuid: string }
export interface PdfParaParear { clave: string; nombre: string }

export interface Pareo {
  /** clave del XML → clave de su PDF. */
  pdfDeXml: Map<string, string>;
  /** PDF que no se juntaron con ningún XML. */
  pdfSueltos: string[];
}

export const esPdfNombre = (nombre: string, tipo = ''): boolean => /\.pdf$/i.test(nombre) || tipo === 'application/pdf';
export const esXmlNombre = (nombre: string, tipo = ''): boolean => /\.xml$/i.test(nombre) || /xml/i.test(tipo);

/** "ROE180119IV4-I8663 (1).PDF" → "roe180119iv4-i8663". */
export const baseNombre = (nombre: string): string =>
  nombre.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').trim().toLowerCase();

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const parearPdfXml = (xmls: readonly XmlParaParear[], pdfs: readonly PdfParaParear[]): Pareo => {
  const pdfDeXml = new Map<string, string>();
  const usados = new Set<string>();
  const libres = () => pdfs.filter((p) => !usados.has(p.clave));
  const reglas: ((x: XmlParaParear, p: PdfParaParear) => boolean)[] = [
    (x, p) => baseNombre(x.nombre) === baseNombre(p.nombre),
    (x, p) => !!x.uuid && p.nombre.toUpperCase().includes(x.uuid.toUpperCase()),
    (x, p) => !!x.folio && new RegExp(`(^|[^A-Z0-9])${escapar(x.folio)}($|[^0-9])`, 'i').test(p.nombre.replace(/\.[^.]+$/, '')),
  ];
  for (const regla of reglas) {
    for (const x of xmls) {
      if (pdfDeXml.has(x.clave)) continue;
      const p = libres().find((c) => regla(x, c));
      if (p) { pdfDeXml.set(x.clave, p.clave); usados.add(p.clave); }
    }
  }
  return { pdfDeXml, pdfSueltos: libres().map((p) => p.clave) };
};

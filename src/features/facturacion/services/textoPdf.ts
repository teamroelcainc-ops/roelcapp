// src/features/facturacion/services/textoPdf.ts
// ---------------------------------------------------------------------------
// ✅ V00514 — TEXTO DE UN PDF en el navegador, con pdf.js (pdfjs-dist, de Mozilla). La librería y
// su worker se descargan SOLO la primera vez que se revisa un PDF (import dinámico): no pesan en la
// carga de la app. Devuelve cada pedazo de texto con su posición (lo lee leerFacturaPdf.ts).
// ---------------------------------------------------------------------------
import { cargarPdfjs } from '../../../shared/utils/pdf';
import type { ItemPdf } from './leerFacturaPdf';

/** Páginas que se leen como máximo (una factura cabe en una o dos). */
const MAX_PAGINAS = 10;

export const itemsDePdf = async (archivo: Blob): Promise<ItemPdf[][]> => {
  const pdfjs = await cargarPdfjs(); // ✅ V00534: el cargador único de pdf.js (shared/utils/pdf.ts)
  const data = new Uint8Array(await archivo.arrayBuffer());
  const tarea = pdfjs.getDocument({ data });
  const doc = await tarea.promise;
  try {
    const paginas: ItemPdf[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGINAS); n++) {
      const pagina = await doc.getPage(n);
      const contenido = await pagina.getTextContent();
      paginas.push(contenido.items.flatMap((i) => ('str' in i ? [{ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }] : [])));
    }
    return paginas;
  } finally {
    void tarea.destroy(); // libera el worker y la memoria del documento
  }
};

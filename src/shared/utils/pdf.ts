// src/shared/utils/pdf.ts
// ---------------------------------------------------------------------------
// ✅ V00534 — EL ÚNICO LUGAR QUE CARGA LAS LIBRERÍAS DE PDF. `html2pdf.js` (~274 KB gz con jsPDF y
// html2canvas) para GENERAR y `pdfjs-dist` para LEER se descargan con import() al generar o leer el
// primer PDF, no con la pantalla. La promesa se guarda; si falla (sin conexión), se reintenta la
// próxima vez.
// ---------------------------------------------------------------------------
type Html2Pdf = typeof import('html2pdf.js').default;
type Pdfjs = typeof import('pdfjs-dist');

const unaVez = <T,>(cargar: () => Promise<T>): (() => Promise<T>) => {
  let enCurso: Promise<T> | null = null;
  return () => {
    enCurso ??= cargar().catch((error: unknown) => {
      enCurso = null;
      throw error;
    });
    return enCurso;
  };
};

/** html2pdf: `const html2pdf = await cargarHtml2pdf();` justo antes de `html2pdf().set(…)`. */
export const cargarHtml2pdf = unaVez<Html2Pdf>(async () => (await import('html2pdf.js')).default);

/** pdf.js con su worker configurado (para leer el texto de un PDF). */
export const cargarPdfjs = unaVez<Pdfjs>(async () => {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
});

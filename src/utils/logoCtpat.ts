// src/utils/logoCtpat.ts
// ---------------------------------------------------------------------------
// ✅ V00251: el logo CTPAT del pie de los tarifarios ahora es el archivo del
//   propio proyecto `public/ctat.png` (petición de Jesús), servido en /ctat.png.
//   Al ser un recurso del MISMO origen, html2canvas lo captura sin problema
//   (useCORS) y exportarPDF ya espera a que la imagen decodifique antes de
//   generar el PDF. Para cambiar el logo basta con reemplazar public/ctat.png.
//   (V00250 traía una recreación en base64; se retiró a favor del oficial.)
// ---------------------------------------------------------------------------
export const LOGO_CTPAT_SRC = '/ctat.png';

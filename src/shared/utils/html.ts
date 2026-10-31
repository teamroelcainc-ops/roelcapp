// src/shared/utils/html.ts
// ---------------------------------------------------------------------------
// ✅ V00534 — Escapar texto para HTML crudo (plantillas de PDF, ventanas de impresión). Antes vivía en
// utils/pdfGenerator.ts junto con el logo en base64 y todas las plantillas: importarlo solo para
// escapar metía ~115 KB gz en la pantalla. pdfGenerator.ts lo reexporta para no romper imports.
// ✅ V00448: sin escapar, un `<img onerror=…>` capturado en una descripción se ejecutaba.
// ---------------------------------------------------------------------------

/** Texto capturado → HTML seguro (& < > " '). */
export const escaparHTML = (texto: unknown): string => String(texto ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

/** Copia de los datos de un PDF con todos sus textos escapados. */
export const escaparTextos = <T extends object>(datos: T): T =>
  Object.fromEntries(Object.entries(datos).map(([clave, valor]) => [clave, typeof valor === 'string' ? escaparHTML(valor) : valor])) as T;

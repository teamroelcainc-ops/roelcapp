// src/features/facturacion/services/leerDocumentoFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00514 — Lee un archivo de factura que se está subiendo (PDF o XML) y lo deja en la forma que
// se compara con la factura (documentoFactura.ts). Cada archivo se lee UNA vez (caché por archivo):
// cambiar el número de invoice o la selección solo vuelve a comparar, no a leer.
// ✅ V00516: también un documento YA GUARDADO en Storage (botón "Analizar documento" de la Ficha de
// Factura): se descarga con su URL y se lee una vez por URL. Un fallo de descarga no se guarda en
// la caché (al volver a analizar se reintenta). La descarga necesita que el bucket permita leer
// desde la app (CORS, cors.json del repo): si no, el mensaje lo dice.
// ---------------------------------------------------------------------------
import type { ArchivoGuardado } from '../../../shared/archivos/adjuntos';
import { esImagen } from '../../../shared/archivos/adjuntos';
import { documentoDeCfdi } from './documentoFactura';
import { leerCfdi } from './leerCfdi';
import { leerFacturaPdf } from './leerFacturaPdf';
import type { LecturaDocumento } from './leerFacturaPdf';
import { esPdfNombre, esXmlNombre } from './parearPdfXml';
import { itemsDePdf } from './textoPdf';

const cache = new WeakMap<File, Promise<LecturaDocumento>>();

/** ¿Es un archivo que se puede revisar contra la factura? */
export const esDocumentoRevisable = (f: File): boolean => esPdfNombre(f.name, f.type) || esXmlNombre(f.name, f.type);

const deXml = (texto: string): LecturaDocumento => {
  const r = leerCfdi(texto);
  return r.ok ? { ok: true, doc: documentoDeCfdi(r.cfdi) } : { ok: false, error: r.error };
};

const leer = async (f: File): Promise<LecturaDocumento> => {
  try {
    if (esXmlNombre(f.name, f.type)) return deXml(await f.text());
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

// ── ✅ V00516: documentos ya guardados ─────────────────────────────────────
/** ¿Vale la pena descargarlo para revisarlo? Las imágenes no se pueden leer (solo PDF y XML). */
export const esGuardadoRevisable = (a: ArchivoGuardado): boolean => !!a.url && !esImagen(a.nombre || a.url, a.tipo ?? '');

/** Qué es el archivo por su CONTENIDO (los registros viejos no traen tipo ni extensión). */
export const tipoPorContenido = (inicio: string): 'pdf' | 'xml' | 'otro' => {
  const t = inicio.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('%PDF')) return 'pdf';
  if (t.startsWith('<')) return 'xml';
  return 'otro';
};

class DescargaFallida extends Error {
  readonly estado: number;
  constructor(estado: number) { super(`HTTP ${estado}`); this.name = 'DescargaFallida'; this.estado = estado; }
}

export const mensajeDescarga = (e: unknown): string => {
  if (e instanceof DescargaFallida) {
    return e.estado === 403 || e.estado === 404
      ? 'El documento ya no está en el almacenamiento o su enlace ya no es válido: vuelve a subirlo en Agregar o cambiar.'
      : `No se pudo descargar el documento (el almacenamiento respondió ${e.estado}). Intenta de nuevo.`;
  }
  return 'No se pudo descargar el documento guardado. Revisa tu conexión e intenta de nuevo; si pasa con todos los documentos, falta permitir que la app lea el almacenamiento (CORS, ver CAMBIOS-V00516.md).';
};

const descargar = async (a: ArchivoGuardado): Promise<Blob> => {
  const r = await fetch(a.url);
  if (!r.ok) throw new DescargaFallida(r.status);
  return r.blob();
};

const leerDescargado = async (b: Blob): Promise<LecturaDocumento> => {
  try {
    const tipo = tipoPorContenido(await b.slice(0, 64).text());
    if (tipo === 'xml') return deXml(await b.text());
    if (tipo === 'pdf') return leerFacturaPdf(await itemsDePdf(b));
    return { ok: false, error: 'No es un PDF ni un XML: solo esos se pueden revisar (las imágenes no se pueden leer).' };
  } catch (e) {
    console.error('[Facturación] No se pudo leer el documento guardado:', e);
    return { ok: false, error: 'No se pudo leer el archivo (¿está dañado o protegido con contraseña?).' };
  }
};

const cacheGuardados = new Map<string, Promise<LecturaDocumento>>();

/** Descarga y lee un documento guardado (una vez por URL; si la descarga falla, se reintenta la próxima vez). */
export const leerDocumentoGuardado = (a: ArchivoGuardado): Promise<LecturaDocumento> => {
  const hit = cacheGuardados.get(a.url);
  if (hit) return hit;
  const p = descargar(a).then(leerDescargado, (e: unknown): LecturaDocumento => {
    console.error('[Facturación] No se pudo descargar el documento guardado:', e);
    cacheGuardados.delete(a.url);
    return { ok: false, error: mensajeDescarga(e) };
  });
  cacheGuardados.set(a.url, p);
  return p;
};

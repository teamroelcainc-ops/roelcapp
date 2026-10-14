// src/features/documentos/expediente.ts
// ---------------------------------------------------------------------------
// ✅ V00451 — EXPEDIENTES (colección `documentos`) SIN LÍMITE DE ARCHIVOS.
// Lógica PURA (sin Firebase) del modal "Subir Documento" y de la lista de documentos:
//   · Un documento de Firestore por archivo (como siempre). El primero de un tipo usa el id
//     canónico `${col}__${registroId}__${subcarpeta}`; los demás, un id con sufijo único.
//   · En el modal, la lista de AdjuntosArchivos = los documentos YA guardados de ese tipo +
//     los archivos nuevos. Lo que el usuario hace (agregar, Reemplazar, ×) se traduce a
//     `CambiosExpediente` y se aplica al guardar (planGuardado).
// La parte que toca Storage/Firestore está en expedienteServicio.ts.
// ---------------------------------------------------------------------------
import type { Adjunto } from '../../shared/archivos/adjuntos';

/** Un documento de la colección `documentos` (los campos que leen la lista, alertas y reportes). */
export interface DocumentoExpediente {
  id: string;
  coleccionOrigen: string;
  registroId: string;
  registroNombre: string;
  tipoDocumento: string;
  carpeta: string;
  subcarpeta: string;
  nombreArchivo: string;
  path: string;
  url: string;
  vence: boolean;
  fechaExpedicion: string;
  fechaVencimiento: string;
  observaciones: string;
  subidoPor: string;
  createdAt: string;
  porClasificar: boolean;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Documento de Firestore → DocumentoExpediente (campos faltantes vacíos). */
export const comoDocumentoExpediente = (id: string, d: Record<string, unknown>): DocumentoExpediente => ({
  id,
  coleccionOrigen: texto(d.coleccionOrigen),
  registroId: texto(d.registroId),
  registroNombre: texto(d.registroNombre),
  tipoDocumento: texto(d.tipoDocumento),
  carpeta: texto(d.carpeta),
  subcarpeta: texto(d.subcarpeta),
  nombreArchivo: texto(d.nombreArchivo),
  path: texto(d.path),
  url: texto(d.url),
  vence: !!d.vence,
  fechaExpedicion: texto(d.fechaExpedicion),
  fechaVencimiento: texto(d.fechaVencimiento),
  observaciones: texto(d.observaciones),
  subidoPor: texto(d.subidoPor),
  createdAt: texto(d.createdAt),
  porClasificar: d.porClasificar === true,
});

// Quita caracteres no válidos para rutas de Storage.
export const sanitizarRuta = (s: string): string =>
  String(s || '').trim().replace(/[/\\:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();
// Subcarpeta = nombre del documento sin el prefijo numérico ("16. " -> "Contrato Laboral").
export const nombreSubcarpetaDoc = (label: string): string => sanitizarRuta(String(label).replace(/^\d+\.\s*/, ''));
// Normaliza texto para comparar (sin acentos, minúsculas, espacios simples).
export const normTexto = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Id del documento canónico (el primero) de un tipo, como siempre. */
export const idCanonicoDocumento = (coleccionOrigen: string, registroId: string, subcarpeta: string): string =>
  sanitizarRuta(`${coleccionOrigen}__${registroId}__${subcarpeta}`).replace(/\s+/g, '_');

const SUFIJO_NUMERO = /\s*\((\d+)\)\s*$/;
/** Clave de un tipo para comparar: sin "(2)", sin prefijo numérico, sin acentos. */
const claveTipo = (s: string): string => normTexto(nombreSubcarpetaDoc(String(s || '').replace(SUFIJO_NUMERO, '')));

/** ¿El documento es del tipo elegido? (por su tipo — también "Tipo (2)" — o por su subcarpeta). */
export const esDelTipo = (d: Pick<DocumentoExpediente, 'tipoDocumento' | 'subcarpeta'>, tipo: string): boolean => {
  const clave = claveTipo(tipo);
  if (!clave) return false;
  return claveTipo(d.tipoDocumento) === clave || (!!d.subcarpeta && claveTipo(d.subcarpeta) === clave);
};

/** "Tipo" cuenta como 1; "Tipo (3)" como 3. */
const numeroDeEtiqueta = (etiqueta: string): number => {
  const m = SUFIJO_NUMERO.exec(etiqueta);
  return m ? Number(m[1]) || 1 : 1;
};

/**
 * Tipo de documento de cada archivo nuevo: el primero toma el nombre del tipo si va al id canónico
 * y ningún documento de ese tipo lo usa ya; los demás "Tipo (n)", siguiendo el número más alto que
 * ya existe (como la Carga Masiva).
 */
export const etiquetasNuevos = (tipo: string, existentes: readonly string[], cantidad: number, primeroCanonico: boolean): string[] => {
  let n = existentes.reduce((m, e) => Math.max(m, numeroDeEtiqueta(e)), 0);
  const nombreLibre = primeroCanonico && !existentes.some((e) => !SUFIJO_NUMERO.test(e));
  return Array.from({ length: cantidad }, (_, i) => {
    if (i === 0 && nombreLibre) { n = Math.max(n, 1); return tipo; }
    n = Math.max(n, 1) + 1;
    return `${tipo} (${n})`;
  });
};

const extensionDe = (nombre: string): string => {
  const p = nombre.lastIndexOf('.');
  return p > 0 ? nombre.slice(p) : '';
};
const sinExtension = (nombre: string): string => {
  const p = nombre.lastIndexOf('.');
  return p > 0 ? nombre.slice(0, p) : nombre;
};

/** Nombre de un archivo nuevo: el del tipo ("Contrato.pdf") si es el canónico; si no, el original. */
export const nombreArchivoNuevo = (subcarpeta: string, archivo: string, canonico: boolean): string =>
  canonico ? `${subcarpeta}${extensionDe(archivo)}` : archivo;

/** Al reemplazar: si el nombre era el del tipo ("Carta Porte.pdf") se conserva con la extensión nueva; si no, el del archivo nuevo. */
export const nombreTrasReemplazo = (d: Pick<DocumentoExpediente, 'nombreArchivo' | 'subcarpeta' | 'tipoDocumento'>, archivoNuevo: string): string => {
  const base = sinExtension(d.nombreArchivo);
  const delTipo = !!base && [d.subcarpeta, nombreSubcarpetaDoc(d.subcarpeta), d.tipoDocumento, nombreSubcarpetaDoc(d.tipoDocumento)]
    .some((t) => !!t && normTexto(t) === normTexto(base));
  return delTipo ? `${base}${extensionDe(archivoNuevo)}` : archivoNuevo;
};

/** Carpeta de Storage de un documento: la de su archivo actual o, si no la tiene, la del esquema de siempre. */
export const carpetaStorageDe = (d: Pick<DocumentoExpediente, 'path' | 'coleccionOrigen' | 'carpeta' | 'registroNombre' | 'registroId' | 'subcarpeta' | 'tipoDocumento'>): string => {
  const corte = d.path.lastIndexOf('/');
  if (corte > 0) return d.path.slice(0, corte);
  const carpeta = d.carpeta || sanitizarRuta(d.registroNombre) || sanitizarRuta(d.registroId) || 'sin_nombre';
  const sub = sanitizarRuta(d.subcarpeta) || nombreSubcarpetaDoc(d.tipoDocumento) || 'Otros';
  return `${sanitizarRuta(d.coleccionOrigen) || 'documentos'}/${carpeta}/${sub}`;
};

/** ¿Otro documento apunta al mismo archivo de Storage? (entonces no se borra el archivo) */
export const pathCompartido = (d: Pick<DocumentoExpediente, 'id' | 'path'>, todos: readonly Pick<DocumentoExpediente, 'id' | 'path'>[]): boolean =>
  !!d.path && todos.some((o) => o.id !== d.id && o.path === d.path);

// ── Lista del modal: guardados + cambios pendientes ────────────────────────
export interface CambiosExpediente {
  /** Ids de documentos guardados que se borran al guardar. */
  quitados: string[];
  /** Id de documento guardado → archivo nuevo que lo sustituye. */
  reemplazos: Record<string, Adjunto>;
  /** Archivos nuevos (un documento nuevo cada uno). */
  nuevos: Adjunto[];
}

export const SIN_CAMBIOS: CambiosExpediente = { quitados: [], reemplazos: {}, nuevos: [] };

const PREFIJO = 'doc:';
const idDeClave = (clave: string): string | null => (clave.startsWith(PREFIJO) ? clave.slice(PREFIJO.length) : null);

/** Un documento guardado como renglón de AdjuntosArchivos (clave = id del documento). */
export const adjuntoDeDocumento = (d: DocumentoExpediente): Adjunto => ({
  clave: `${PREFIJO}${d.id}`,
  estado: 'guardado',
  archivo: {
    url: d.url,
    nombre: d.nombreArchivo || d.tipoDocumento || 'Documento',
    ...(d.path ? { path: d.path } : {}),
    ...(d.createdAt ? { fecha: d.createdAt.slice(0, 10) } : {}),
    ...(d.subidoPor ? { por: d.subidoPor } : {}),
  },
});

/** Lo que muestra el modal: los guardados del tipo (o su reemplazo) y después los nuevos. */
export const listaVisible = (guardados: readonly DocumentoExpediente[], c: CambiosExpediente): Adjunto[] => [
  ...guardados.filter((d) => !c.quitados.includes(d.id)).map((d) => c.reemplazos[d.id] ?? adjuntoDeDocumento(d)),
  ...c.nuevos,
];

/**
 * Traduce un cambio de AdjuntosArchivos (agregar al final, Reemplazar en su lugar, × quitar) a
 * cambios pendientes. Quitar el archivo que REEMPLAZABA a uno guardado cancela el reemplazo
 * (vuelve el guardado): un documento guardado solo se borra con su propia × (que pide confirmación).
 */
export const aplicarCambioLista = (c: CambiosExpediente, prev: readonly Adjunto[], next: readonly Adjunto[]): CambiosExpediente => {
  const reemplazos: Record<string, Adjunto> = { ...c.reemplazos };
  const quitados = [...c.quitados];
  let nuevos = [...c.nuevos];
  const docDeReemplazo = (clave: string): string | undefined => Object.keys(reemplazos).find((id) => reemplazos[id].clave === clave);

  if (prev.length === next.length) {
    prev.forEach((p, i) => {
      const n = next[i];
      if (p.clave === n.clave) return;
      const idDoc = idDeClave(p.clave) ?? docDeReemplazo(p.clave);
      if (idDoc) reemplazos[idDoc] = n;
      else nuevos = nuevos.map((x) => (x.clave === p.clave ? n : x));
    });
    return { quitados, reemplazos, nuevos };
  }

  const enNext = new Set(next.map((a) => a.clave));
  const enPrev = new Set(prev.map((a) => a.clave));
  for (const p of prev) {
    if (enNext.has(p.clave)) continue;
    const idDoc = idDeClave(p.clave);
    if (idDoc) { if (!quitados.includes(idDoc)) quitados.push(idDoc); continue; }
    const idReemplazado = docDeReemplazo(p.clave);
    if (idReemplazado) { delete reemplazos[idReemplazado]; continue; }
    nuevos = nuevos.filter((x) => x.clave !== p.clave);
  }
  for (const n of next) if (!enPrev.has(n.clave) && n.estado === 'nuevo') nuevos.push(n);
  return { quitados, reemplazos, nuevos };
};

/** Al cambiar de tipo: los archivos elegidos se conservan como nuevos; quitar/reemplazar se descartan. */
export const cambiosAlCambiarTipo = (c: CambiosExpediente): CambiosExpediente => ({
  quitados: [],
  reemplazos: {},
  nuevos: [...Object.values(c.reemplazos), ...c.nuevos],
});

export interface PlanGuardado {
  quitar: DocumentoExpediente[];
  reemplazar: { doc: DocumentoExpediente; adjunto: Adjunto; file: File }[];
  nuevos: { adjunto: Adjunto; file: File }[];
}

/** Qué hacer al guardar (solo con documentos del tipo que se está viendo). */
export const planGuardado = (guardados: readonly DocumentoExpediente[], c: CambiosExpediente): PlanGuardado => ({
  quitar: guardados.filter((d) => c.quitados.includes(d.id)),
  reemplazar: guardados.flatMap((d) => {
    const a = c.reemplazos[d.id];
    return a && a.estado === 'nuevo' && !c.quitados.includes(d.id) ? [{ doc: d, adjunto: a, file: a.file }] : [];
  }),
  nuevos: c.nuevos.flatMap((a) => (a.estado === 'nuevo' ? [{ adjunto: a, file: a.file }] : [])),
});

export const totalPlan = (p: PlanGuardado): number => p.quitar.length + p.reemplazar.length + p.nuevos.length;

export const mensajeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

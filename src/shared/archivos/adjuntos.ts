// src/shared/archivos/adjuntos.ts
// ---------------------------------------------------------------------------
// ✅ V00451 — ADJUNTOS: la misma lógica de carga de archivos en toda la app
// (Pagos, Facturación, Tarifarios, MTTO, Diésel, Herramientas, expedientes…).
//   · Un adjunto es un archivo YA GUARDADO (url en Storage) o uno NUEVO (File
//     elegido, todavía sin subir). La pantalla guarda la lista al confirmar.
//   · subirAdjuntos: sube los nuevos a una carpeta y devuelve la lista final en
//     el mismo orden (los guardados se conservan tal cual).
//   · Campos de un documento: una lista (`campoLista`) + los campos de UN archivo
//     de siempre (el primero), para lo que todavía lee uno solo (portal de
//     clientes, app móvil, aprobación del tarifario…).
// La parte que toca Storage está en subirAdjuntos; lo demás es puro (probado).
// ---------------------------------------------------------------------------

export interface ArchivoGuardado {
  url: string;
  nombre: string;
  /** Ruta en Storage (para reemplazar o borrar). Los registros viejos no la tienen. */
  path?: string;
  tamano?: number;
  tipo?: string;
  /** AAAA-MM-DD */
  fecha?: string;
  por?: string;
}

export type Adjunto =
  | { clave: string; estado: 'guardado'; archivo: ArchivoGuardado }
  | { clave: string; estado: 'nuevo'; file: File };

/** Tipos de archivo aceptados por una carga. ✅ V00530: 'factura' = PDF, imagen o XML (el CFDI). */
export type TiposAdjunto = 'pdf-imagen' | 'imagen' | 'cualquiera' | 'factura';

export const MAX_MB_ADJUNTO = 20;
export const MAX_ADJUNTOS = 10;
/** Expedientes (colaboradores, empresas, unidades, operaciones): sin límite de archivos. */
export const SIN_LIMITE = Number.POSITIVE_INFINITY;

export const ACCEPT_TIPOS: Record<TiposAdjunto, string> = {
  'pdf-imagen': 'application/pdf,image/*',
  imagen: 'image/*',
  cualquiera: '',
  factura: 'application/pdf,image/*,.xml,text/xml,application/xml',
};

export const esPdf = (nombre: string, tipo = ''): boolean =>
  tipo === 'application/pdf' || /^data:application\/pdf[;,]/i.test(nombre) || /\.pdf($|\?)/i.test(nombre);
export const esImagen = (nombre: string, tipo = ''): boolean =>
  tipo.startsWith('image/') || /^data:image\//i.test(nombre) || /\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)($|\?)/i.test(nombre);

/** ✅ V00530: el XML de una factura (CFDI). */
export const esXml = (nombre: string, tipo = ''): boolean => /\.xml($|\?)/i.test(nombre) || /(^|\/)xml$/i.test(tipo);

/**
 * ✅ V00531: URL para abrir un archivo guardado en otra pestaña. Los guardados en base64 (`data:`, legado)
 * no se pueden abrir directo (el navegador lo bloquea): se pasan a un `blob:` que se libera al minuto.
 */
export const urlParaPestana = (url: string): string => {
  if (!url.startsWith('data:')) return url;
  const coma = url.indexOf(',');
  const cabeza = url.slice(0, coma);
  const cuerpo = url.slice(coma + 1);
  const tipo = /^data:([^;,]+)/i.exec(cabeza)?.[1] || 'application/octet-stream';
  const bin = /;base64/i.test(cabeza) ? atob(cuerpo) : decodeURIComponent(cuerpo);
  const blob = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: tipo });
  const local = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(local), 60_000);
  return local;
};

/** Tipo de un `data:` URL (fotos guardadas en base64); '' si no es uno. */
export const tipoDeDataUrl = (url: string): string => /^data:([^;,]+)[;,]/i.exec(url)?.[1] ?? '';

export const tamanoLegible = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Mensaje si el archivo no se acepta; '' si está bien. */
export const validarArchivo = (f: Pick<File, 'name' | 'type' | 'size'>, tipos: TiposAdjunto = 'pdf-imagen', maxMb = MAX_MB_ADJUNTO): string => {
  if (tipos === 'pdf-imagen' && !esPdf(f.name, f.type) && !esImagen(f.name, f.type)) return `"${f.name}" no es PDF ni imagen.`;
  if (tipos === 'imagen' && !esImagen(f.name, f.type)) return `"${f.name}" no es una imagen.`;
  if (tipos === 'factura' && !esPdf(f.name, f.type) && !esImagen(f.name, f.type) && !esXml(f.name, f.type)) return `"${f.name}" no es PDF, XML ni imagen.`;
  if (f.size > maxMb * 1024 * 1024) return `"${f.name}" pesa ${tamanoLegible(f.size)}; el máximo es ${maxMb} MB.`;
  return '';
};

let siguiente = 0;
const nuevaClave = (): string => `adj-${Date.now().toString(36)}-${(siguiente++).toString(36)}`;

export const adjuntoNuevo = (file: File): Adjunto => ({ clave: nuevaClave(), estado: 'nuevo', file });
export const adjuntoGuardado = (archivo: ArchivoGuardado): Adjunto => ({ clave: archivo.url || nuevaClave(), estado: 'guardado', archivo });
/** ✅ V00451: si dos guardados traen la misma URL (datos viejos), cada uno con su propia clave. */
export const desdeGuardados = (lista: readonly ArchivoGuardado[]): Adjunto[] => {
  const vistas = new Set<string>();
  return lista.map((archivo) => {
    const a = adjuntoGuardado(archivo);
    const clave = vistas.has(a.clave) ? nuevaClave() : a.clave;
    vistas.add(clave);
    return { ...a, clave };
  });
};

export const nuevosDe = (adjuntos: readonly Adjunto[]): File[] =>
  adjuntos.flatMap((a) => (a.estado === 'nuevo' ? [a.file] : []));
export const guardadosDe = (adjuntos: readonly Adjunto[]): ArchivoGuardado[] =>
  adjuntos.flatMap((a) => (a.estado === 'guardado' ? [a.archivo] : []));
export const hayNuevos = (adjuntos: readonly Adjunto[]): boolean => adjuntos.some((a) => a.estado === 'nuevo');

/** ¿Cambió la lista respecto a lo guardado? (nuevos, quitados o reordenados) */
export const cambioAdjuntos = (adjuntos: readonly Adjunto[], antes: readonly ArchivoGuardado[]): boolean => {
  if (hayNuevos(adjuntos)) return true;
  const ahora = guardadosDe(adjuntos).map((a) => a.url);
  return ahora.length !== antes.length || ahora.some((u, i) => u !== antes[i]?.url);
};

/** Nombre seguro para Storage (sin espacios ni caracteres raros), con el nombre original legible. */
export const nombreSeguro = (nombre: string): string =>
  nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(-120) || 'archivo';

const texto = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v));

const comoArchivo = (v: unknown): ArchivoGuardado | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const url = texto(o.url);
  if (!url) return null;
  return {
    url,
    nombre: texto(o.nombre) || 'Archivo',
    ...(texto(o.path) ? { path: texto(o.path) } : {}),
    ...(Number(o.tamano) > 0 ? { tamano: Number(o.tamano) } : {}),
    ...(texto(o.tipo) ? { tipo: texto(o.tipo) } : {}),
    ...(texto(o.fecha) ? { fecha: texto(o.fecha) } : {}),
    ...(texto(o.por) ? { por: texto(o.por) } : {}),
  };
};

/** Nombres de los campos de UN archivo de siempre (el primero de la lista). */
export interface CamposLegado {
  url: string;
  nombre?: string;
  fecha?: string;
  por?: string;
}

/**
 * Lista de archivos de un documento: la lista nueva (`campoLista`) o, si no la tiene, el archivo
 * único de siempre (`legado`). Acepta listas de objetos ({url, nombre…}) o de URLs sueltas.
 */
export const archivosDeDocumento = (datos: Record<string, unknown> | null | undefined, campoLista: string, legado?: CamposLegado): ArchivoGuardado[] => {
  if (!datos) return [];
  const lista = datos[campoLista];
  if (Array.isArray(lista)) {
    const r = lista
      .map((x) => (typeof x === 'string' ? (x ? { url: x, nombre: 'Archivo' } : null) : comoArchivo(x)))
      .filter((x): x is ArchivoGuardado => !!x);
    if (r.length) return r;
  }
  if (!legado) return [];
  const url = texto(datos[legado.url]);
  if (!url) return [];
  return [{
    url,
    nombre: (legado.nombre && texto(datos[legado.nombre])) || 'Archivo',
    ...(legado.fecha && texto(datos[legado.fecha]) ? { fecha: texto(datos[legado.fecha]).slice(0, 10) } : {}),
    ...(legado.por && texto(datos[legado.por]) ? { por: texto(datos[legado.por]) } : {}),
  }];
};

/** Campos a escribir: la lista + el primero en los campos de siempre (vacíos si no queda ninguno). */
export const camposDeArchivos = (lista: readonly ArchivoGuardado[], campoLista: string, legado?: CamposLegado): Record<string, unknown> => {
  const primero = lista[0];
  const r: Record<string, unknown> = { [campoLista]: lista.map((a) => ({ ...a })) };
  if (legado) {
    r[legado.url] = primero?.url ?? '';
    if (legado.nombre) r[legado.nombre] = primero?.nombre ?? '';
    if (legado.fecha) r[legado.fecha] = primero?.fecha ?? '';
    if (legado.por) r[legado.por] = primero?.por ?? '';
  }
  return r;
};

/** Texto corto para tablas: "factura.pdf" o "factura.pdf (+2)". */
export const resumenArchivos = (lista: readonly ArchivoGuardado[]): string =>
  lista.length === 0 ? '' : lista.length === 1 ? lista[0].nombre : `${lista[0].nombre} (+${lista.length - 1})`;

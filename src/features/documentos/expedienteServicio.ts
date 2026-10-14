// src/features/documentos/expedienteServicio.ts
// ---------------------------------------------------------------------------
// ✅ V00451 — Storage + Firestore de los EXPEDIENTES (colección `documentos`), sin límite de
// archivos por tipo. Un documento por archivo. Cada archivo se sube con un nombre ÚNICO (no
// pisa al anterior; CLAUDE.md "si el archivo cambia, súbelo con un nombre nuevo"), así que al
// reemplazar o quitar se puede borrar el archivo viejo sin tocar el nuevo.
// Borrar en Storage es "si se puede" (best-effort): el registro manda.
// ---------------------------------------------------------------------------
import { collection, deleteDoc, doc, getDocs, limit, query, runTransaction, setDoc, updateDoc, where } from 'firebase/firestore';
import { deleteObject, ref as storageRef } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import { subirArchivo } from '../../shared/archivos/subirAdjuntos';
import type { ArchivoGuardado } from '../../shared/archivos/adjuntos';
import {
  carpetaStorageDe, comoDocumentoExpediente, etiquetasNuevos, idCanonicoDocumento, mensajeError, nombreArchivoNuevo,
  nombreTrasReemplazo, pathCompartido, sanitizarRuta,
} from './expediente';
import type { CambiosExpediente, DocumentoExpediente, PlanGuardado } from './expediente';

/** Documentos de un registro (una igualdad: no requiere índice compuesto), filtrados por colección en el cliente. */
export async function leerDocumentosDeRegistro(registroId: string, coleccionOrigen: string): Promise<DocumentoExpediente[]> {
  const snap = await getDocs(query(collection(db, 'documentos'), where('registroId', '==', registroId)));
  return snap.docs
    .map((d) => comoDocumentoExpediente(d.id, d.data() as Record<string, unknown>))
    .filter((d) => !coleccionOrigen || d.coleccionOrigen === coleccionOrigen)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Borra un archivo de Storage si se puede; un fallo solo se anota en consola. Se llama cuando el
 * documento YA no apunta a él: si OTRO documento (de cualquier registro) todavía lo usa, no se borra
 * (cargas anteriores armaban la ruta con el NOMBRE del registro: dos registros con el mismo nombre
 * compartían archivo). Si no se puede saber, tampoco se borra.
 */
async function borrarArchivoSeguro(path: string): Promise<void> {
  if (!path) return;
  try {
    const usos = await getDocs(query(collection(db, 'documentos'), where('path', '==', path), limit(1)));
    if (!usos.empty) return;
  } catch (e) {
    console.warn('[Documentos] No se pudo revisar si otro documento usa el archivo; no se borra:', path, e);
    return;
  }
  try { await deleteObject(storageRef(storage, path)); }
  catch (e) { console.warn('[Documentos] No se pudo borrar el archivo de Storage:', path, e); }
}

/** El mismo File con otro nombre (para el nombre en Storage); no copia los datos. */
const conNombre = (file: File, nombre: string): File =>
  nombre === file.name ? file : new File([file], nombre, { type: file.type, lastModified: file.lastModified });

/** Sube un archivo del expediente a `carpeta` con nombre único. */
const subirArchivoExpediente = (carpeta: string, file: File, nombre: string, indice = 0): Promise<ArchivoGuardado> =>
  subirArchivo(carpeta, conNombre(file, nombre), indice);

/**
 * Crea el documento de un archivo nuevo. Con `idPreferido` (el canónico) solo lo toma si sigue
 * libre (transacción); si ya existe, usa `idAlterno`. Devuelve el id usado.
 */
async function crearDocumentoExpediente(datos: Record<string, unknown>, idPreferido: string | null, idAlterno: string): Promise<string> {
  if (!idPreferido) {
    await setDoc(doc(db, 'documentos', idAlterno), datos);
    return idAlterno;
  }
  return runTransaction(db, async (tx) => {
    const canonico = doc(db, 'documentos', idPreferido);
    const existe = (await tx.get(canonico)).exists();
    const destino = existe ? doc(db, 'documentos', idAlterno) : canonico;
    tx.set(destino, datos);
    return destino.id;
  });
}

/**
 * Reemplaza el archivo de UN documento: sube el nuevo a la misma carpeta (nombre único), actualiza
 * el documento (url, path, nombreArchivo, subidoPor, updatedAt + `extra`) y borra el archivo viejo
 * (si `borrarAnterior`). Si falla la escritura, se borra lo recién subido.
 */
export async function reemplazarArchivoDocumento(
  d: DocumentoExpediente,
  file: File,
  opciones: { borrarAnterior: boolean; extra?: Record<string, unknown> },
): Promise<void> {
  const nombre = nombreTrasReemplazo(d, file.name);
  const subido = await subirArchivoExpediente(carpetaStorageDe(d), file, nombre);
  try {
    await updateDoc(doc(db, 'documentos', d.id), {
      url: subido.url,
      path: subido.path ?? '',
      nombreArchivo: nombre,
      subidoPor: subido.por ?? '',
      updatedAt: new Date().toISOString(),
      ...(opciones.extra ?? {}),
    });
  } catch (e) {
    await borrarArchivoSeguro(subido.path ?? '');
    throw e;
  }
  if (opciones.borrarAnterior && d.path && d.path !== subido.path) await borrarArchivoSeguro(d.path);
}

/** Borra el documento y, si `borrarArchivo`, su archivo de Storage (best-effort). */
export async function eliminarDocumentoExpediente(d: DocumentoExpediente, borrarArchivo: boolean): Promise<void> {
  await deleteDoc(doc(db, 'documentos', d.id));
  if (borrarArchivo) await borrarArchivoSeguro(d.path);
}

/** Sube un archivo NUEVO y crea su documento; si la escritura falla, borra lo subido. */
export async function agregarArchivoExpediente(p: {
  carpetaStorage: string; file: File; nombre: string; indice: number;
  datos: Record<string, unknown>; idPreferido: string | null; idAlterno: string;
}): Promise<void> {
  const subido = await subirArchivoExpediente(p.carpetaStorage, p.file, p.nombre, p.indice);
  try {
    await crearDocumentoExpediente({
      ...p.datos,
      nombreArchivo: p.nombre,
      path: subido.path ?? '',
      url: subido.url,
      subidoPor: subido.por ?? '', // ✅ V00283: quién subió el documento
      createdAt: new Date().toISOString(),
    }, p.idPreferido, p.idAlterno);
  } catch (e) {
    await borrarArchivoSeguro(subido.path ?? '');
    throw e;
  }
}

export interface ContextoExpediente {
  coleccionOrigen: string;
  registroId: string;
  registroNombre: string;
  /** Tipo elegido (como en el catálogo, p. ej. "16. Contrato Laboral"). */
  tipoDocumento: string;
  /** Carpeta del registro y del tipo (sanitizadas). */
  carpeta: string;
  subcarpeta: string;
  vence: boolean;
  fechaExpedicion: string;
  fechaVencimiento: string;
  observaciones: string;
}

export interface ResultadoExpediente {
  quitados: number;
  reemplazados: number;
  subidos: number;
  errores: string[];
  /** Lo que falló, para reintentar con "Guardar" otra vez. */
  pendientes: CambiosExpediente;
}

/**
 * Aplica los cambios del modal: 1) quita, 2) reemplaza, 3) sube los nuevos (el primero toma el id
 * canónico si está libre). Cada paso por separado: un fallo no detiene los demás y se informa.
 * `todos` = todos los documentos del registro (para no borrar un archivo que otro documento usa).
 */
export async function guardarCambiosExpediente(
  ctx: ContextoExpediente,
  plan: PlanGuardado,
  delTipo: readonly DocumentoExpediente[],
  todos: readonly DocumentoExpediente[],
  alAvanzar: (hechas: number) => void,
): Promise<ResultadoExpediente> {
  const r: ResultadoExpediente = { quitados: 0, reemplazados: 0, subidos: 0, errores: [], pendientes: { quitados: [], reemplazos: {}, nuevos: [] } };
  const fechas = {
    vence: ctx.vence,
    fechaExpedicion: ctx.vence ? ctx.fechaExpedicion : '',
    fechaVencimiento: ctx.vence ? ctx.fechaVencimiento : '',
  };
  let hechas = 0;
  const avanzar = () => { hechas += 1; alAvanzar(hechas); };
  const nombreDe = (d: DocumentoExpediente) => d.nombreArchivo || d.tipoDocumento || 'Documento';

  for (const d of plan.quitar) {
    try {
      await eliminarDocumentoExpediente(d, !pathCompartido(d, todos));
      r.quitados += 1;
    } catch (e) {
      console.error('[Documentos] No se pudo quitar:', d.id, e);
      r.errores.push(`Quitar "${nombreDe(d)}": ${mensajeError(e)}`);
      r.pendientes.quitados.push(d.id);
    }
    avanzar();
  }

  for (const x of plan.reemplazar) {
    try {
      // Fechas como al subir; las observaciones solo si se escribieron (no se borran las que había).
      await reemplazarArchivoDocumento(x.doc, x.file, {
        borrarAnterior: !pathCompartido(x.doc, todos),
        // Un tipo que no vence no borra las fechas que ya tenía el documento.
        extra: { ...(ctx.vence ? fechas : {}), ...(ctx.observaciones.trim() ? { observaciones: ctx.observaciones } : {}) },
      });
      r.reemplazados += 1;
    } catch (e) {
      console.error('[Documentos] No se pudo reemplazar:', x.doc.id, e);
      r.errores.push(`Reemplazar "${nombreDe(x.doc)}" por "${x.file.name}": ${mensajeError(e)}`);
      r.pendientes.reemplazos[x.doc.id] = x.adjunto;
    }
    avanzar();
  }

  const quitadosOk = new Set(plan.quitar.map((d) => d.id).filter((id) => !r.pendientes.quitados.includes(id)));
  const idCanonico = idCanonicoDocumento(ctx.coleccionOrigen, ctx.registroId, ctx.subcarpeta);
  const canonicoLibre = !todos.some((d) => d.id === idCanonico && !quitadosOk.has(d.id));
  const etiquetas = etiquetasNuevos(
    ctx.tipoDocumento,
    delTipo.filter((d) => !quitadosOk.has(d.id)).map((d) => d.tipoDocumento),
    plan.nuevos.length,
    canonicoLibre,
  );
  const carpetaStorage = `${sanitizarRuta(ctx.coleccionOrigen)}/${ctx.carpeta}/${ctx.subcarpeta}`;
  const sello = Date.now();
  for (let i = 0; i < plan.nuevos.length; i++) {
    const { adjunto, file } = plan.nuevos[i];
    const canonico = i === 0 && canonicoLibre;
    try {
      await agregarArchivoExpediente({
        carpetaStorage,
        file,
        nombre: nombreArchivoNuevo(ctx.subcarpeta, file.name, etiquetas[i] === ctx.tipoDocumento),
        indice: i,
        idPreferido: canonico ? idCanonico : null,
        idAlterno: `${idCanonico}__${sello}_${i}`,
        datos: {
          coleccionOrigen: ctx.coleccionOrigen,
          registroId: ctx.registroId,
          registroNombre: ctx.registroNombre || '',
          tipoDocumento: etiquetas[i],
          carpeta: ctx.carpeta,
          subcarpeta: ctx.subcarpeta,
          ...fechas,
          observaciones: ctx.observaciones || '',
        },
      });
      r.subidos += 1;
    } catch (e) {
      console.error('[Documentos] No se pudo subir:', file.name, e);
      r.errores.push(`Subir "${file.name}": ${mensajeError(e)}`);
      r.pendientes.nuevos.push(adjunto);
    }
    avanzar();
  }
  return r;
}

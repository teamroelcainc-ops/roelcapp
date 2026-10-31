// src/shared/archivos/subirAdjuntos.ts
// ✅ V00451: sube los adjuntos NUEVOS a una carpeta de Storage y devuelve la lista final (en el
//   mismo orden; los ya guardados se conservan). Cada archivo con un nombre único (no pisa al
//   anterior) y caché larga (CLAUDE.md: "si el archivo cambia, súbelo con un nombre nuevo").
import { auth, cargarStorage } from '../../config/firebase'; // ✅ V00534: Storage se carga al subir
import { hoyLocalISO } from '../../utils/fechaHoraLocal';
import { nombreSeguro } from './adjuntos';
import type { Adjunto, ArchivoGuardado } from './adjuntos';

export async function subirArchivo(carpeta: string, file: File, indice = 0): Promise<ArchivoGuardado> {
  const path = `${carpeta.replace(/\/+$/, '')}/${Date.now()}_${indice}_${nombreSeguro(file.name)}`;
  const { storage, ref: storageRef, uploadBytes, getDownloadURL } = await cargarStorage();
  const destino = storageRef(storage, path);
  await uploadBytes(destino, file, {
    ...(file.type ? { contentType: file.type } : {}),
    cacheControl: 'public, max-age=31536000',
  });
  const url = await getDownloadURL(destino);
  return {
    url,
    nombre: file.name,
    path,
    tamano: file.size,
    ...(file.type ? { tipo: file.type } : {}),
    fecha: hoyLocalISO(),
    por: auth.currentUser?.email || '',
  };
}

export async function subirAdjuntos(adjuntos: readonly Adjunto[], carpeta: string): Promise<ArchivoGuardado[]> {
  const resultado: ArchivoGuardado[] = [];
  let i = 0;
  for (const a of adjuntos) {
    if (a.estado === 'guardado') resultado.push(a.archivo);
    else resultado.push(await subirArchivo(carpeta, a.file, i++));
  }
  return resultado;
}

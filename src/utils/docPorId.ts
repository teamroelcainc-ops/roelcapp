// src/utils/docPorId.ts
// ✅ V00419: lee UN documento por id directo de Firestore. Se usa como respaldo
//   en los PDF cuando el catálogo en memoria todavía no está cargado (el estado de
//   React no se actualiza dentro del mismo clic y los datos salían como N/A).
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- documentos de catálogo sin esquema fijo (mismo trato que los catálogos en memoria)
export type DocLibre = { id: string; [campo: string]: any };

export const docPorId = async (coleccion: string, id: unknown): Promise<DocLibre | null> => {
  const clave = String(id ?? '').trim();
  if (!clave) return null;
  try {
    const s = await getDoc(doc(db, coleccion, clave));
    return s.exists() ? ({ id: s.id, ...s.data() }) : null;
  } catch {
    return null;
  }
};

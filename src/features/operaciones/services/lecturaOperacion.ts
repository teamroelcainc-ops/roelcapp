// src/features/operaciones/services/lecturaOperacion.ts
// ---------------------------------------------------------------------------
// ✅ V00528 — Leer la operación que se va a abrir en el formulario, empezando ANTES del clic.
// Al pasar el mouse por "✎ Editar" se empieza a leer del servidor (1 lectura); el editor
// (EditorOperacionEmbebido) toma esa lectura si empezó hace menos de VIGENCIA_MS y la usa UNA
// sola vez: la siguiente apertura vuelve a leer. Así el formulario abre sin esperar la ida y
// vuelta al servidor y sigue mostrando la versión más reciente (la de hace unos segundos).
// ---------------------------------------------------------------------------
import { doc, getDoc } from 'firebase/firestore';
import type { DocumentSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';

const VIGENCIA_MS = 8_000;
const enCamino = new Map<string, { en: number; lectura: Promise<DocumentSnapshot> }>();

const leer = (id: string): Promise<DocumentSnapshot> => getDoc(doc(db, 'operaciones', id));

/** Empieza a leer la operación (el mouse está sobre su ✎ Editar). Una lectura por operación cada VIGENCIA_MS. */
export const precargarOperacion = (id: string): void => {
  if (!id) return;
  const previa = enCamino.get(id);
  if (previa && Date.now() - previa.en < VIGENCIA_MS) return;
  const lectura = leer(id);
  // Si falla, se olvida: el editor vuelve a leer al abrirse (y muestra el error si sigue fallando).
  lectura.catch(() => { if (enCamino.get(id)?.lectura === lectura) enCamino.delete(id); });
  enCamino.set(id, { en: Date.now(), lectura });
};

/** La operación para el formulario: la lectura que ya va en camino (reciente) o una nueva. */
export const leerOperacionParaEditar = (id: string): Promise<DocumentSnapshot> => {
  const previa = enCamino.get(id);
  enCamino.delete(id);
  if (previa && Date.now() - previa.en < VIGENCIA_MS) return previa.lectura.catch(() => leer(id));
  return leer(id);
};

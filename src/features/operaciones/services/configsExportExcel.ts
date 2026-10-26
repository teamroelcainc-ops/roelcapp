// src/features/operaciones/services/configsExportExcel.ts
// ---------------------------------------------------------------------------
// ✅ V00498 — CONFIGURACIONES GUARDADAS DEL EXCEL (colección config_export_excel, compartidas entre
// usuarios; V00338). Antes dentro de ServiciosCompletados.tsx; ahora las usan también el "Excel de
// operaciones" de Operaciones (con la misma clave: las mismas configuraciones). Más la última
// selección de columnas de cada usuario (localStorage, solo una conveniencia).
// ---------------------------------------------------------------------------
import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';

export interface ColumnaGuardada { id: string; visible: boolean }
export interface ConfigExcel { id: string; nombre: string; columnas: ColumnaGuardada[] }
export interface ColumnaElegible { id: string; label: string; visible: boolean }

const COLECCION = 'config_export_excel';

const columnasDe = (v: unknown): ColumnaGuardada[] =>
  (Array.isArray(v) ? v : []).flatMap((c): ColumnaGuardada[] => {
    const x = c as { id?: unknown; visible?: unknown } | null;
    return x && typeof x.id === 'string' ? [{ id: x.id, visible: !!x.visible }] : [];
  });

export async function listarConfigsExcel(modulo: string): Promise<ConfigExcel[]> {
  const snap = await getDocs(query(collection(db, COLECCION), where('modulo', '==', modulo)));
  return snap.docs
    .map((d) => { const x = d.data(); return { id: d.id, nombre: String(x.nombre || ''), columnas: columnasDe(x.columnas) }; })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Guarda (o actualiza, con `id`) una configuración; devuelve su id. */
export async function guardarConfigExcel(modulo: string, nombre: string, columnas: readonly ColumnaGuardada[], id?: string): Promise<string> {
  const lista = columnas.map((c) => ({ id: c.id, visible: c.visible }));
  if (id) {
    await updateDoc(doc(db, COLECCION, id), { nombre, columnas: lista });
    return id;
  }
  const ref = await addDoc(collection(db, COLECCION), { modulo, nombre, columnas: lista, creadoEn: new Date().toISOString() });
  return ref.id;
}

export const borrarConfigExcel = (id: string): Promise<void> => deleteDoc(doc(db, COLECCION, id));

/** Puro: aplica una lista guardada sobre las columnas reales (respeta el orden guardado; lo nuevo va al final, desmarcado). */
export const columnasDesdeGuardadas = (guardadas: readonly ColumnaGuardada[], disponibles: readonly { id: string; label: string }[]): ColumnaElegible[] => {
  const porId = new Map(disponibles.map((c) => [c.id, c] as const));
  const lista: ColumnaElegible[] = [];
  guardadas.forEach((g) => {
    const c = porId.get(g.id);
    if (c) { lista.push({ id: c.id, label: c.label, visible: !!g.visible }); porId.delete(g.id); }
  });
  porId.forEach((c) => lista.push({ id: c.id, label: c.label, visible: false }));
  return lista;
};

/** Clave por usuario de la última selección de columnas (localStorage). */
export const claveUltimaSeleccion = (prefijo: string): string => prefijo + (auth.currentUser?.uid || 'anon');

export const leerUltimaSeleccion = (clave: string): ColumnaGuardada[] | null => {
  try {
    const str = localStorage.getItem(clave);
    return str ? columnasDe(JSON.parse(str)) : null;
  } catch { return null; }
};

export const guardarUltimaSeleccion = (clave: string, columnas: readonly ColumnaGuardada[]): void => {
  try { localStorage.setItem(clave, JSON.stringify(columnas.map((c) => ({ id: c.id, visible: c.visible })))); } catch { /* sin localStorage */ }
};

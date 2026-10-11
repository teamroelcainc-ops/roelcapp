// src/features/operaciones/hooks/useOperacionesActivas.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.1) — HOOK DE DATOS de Operaciones Activas (antes, ~150 líneas
// dentro de OperacionesDashboard). Mismo comportamiento:
//   · con `consultasCanonicas` (Fase 7.1): estadoGrupo == 'activa', de la más
//     reciente, 50 por página con cursor; sin respaldo de "leer todo".
//   · sin la bandera: `status not-in` finales de 50 en 50 (respaldo: 2,000 sin
//     filtro si la consulta not-in falla), filtrando en memoria con `esActiva`.
// "Cargar más" sigue el MISMO camino con el que se cargó la lista.
// La lista la siguen modificando el tablero (status en vivo, guardados); por eso
// el hook entrega también `setOperaciones`.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { collection, getDocs, limit, query, startAfter, where } from 'firebase/firestore';
import type { DocumentData, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { obtenerFlags } from '../../../shared/data/flags';
import { paginaOperaciones } from '../../../shared/data/consultas';
import type { Cursor } from '../../../shared/data/consultas';
import { idReal } from '../../../shared/data/catalogos';
import { STATUS_FINALES } from '../../../shared/dominio/constantes';

export const TAMANO_PAGINA_ACTIVAS = 50;

/** Lo mínimo que el hook necesita de una operación (el tablero usa más campos). */
export interface OperacionActivaBase {
  id: string;
  _docId: string;
  status?: unknown;
  statusNombre?: unknown;
  [campo: string]: unknown;
}

export interface OperacionesActivas<T> {
  operaciones: T[];
  setOperaciones: Dispatch<SetStateAction<T[]>>;
  cargando: boolean;
  cargandoMas: boolean;
  hayMas: boolean;
  /** Vuelve a leer la primera página (después de guardar, por ejemplo). */
  descargar: () => Promise<void>;
  /** "Actualizar": reinicia la paginación y vuelve a leer. */
  actualizar: () => Promise<void>;
  cargarMas: () => Promise<void>;
}

/** Documento → operación como la usaba el tablero: { id, ...datos, _docId } (`_docId` = id REAL). */
const deDoc = <T>(d: QueryDocumentSnapshot<DocumentData>): T => ({ id: d.id, ...d.data(), _docId: d.id }) as unknown as T;

const mensajeError = (e: unknown): string => {
  const msg = String((e as { message?: unknown; code?: unknown })?.message || (e as { code?: unknown })?.code || e || '').toLowerCase();
  if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('429')) {
    return 'Cuota de lecturas de Firestore agotada.\n\nEl plan gratuito permite 50,000 lecturas/día y entre varias personas se agota. Se reinicia a las 2 AM (hora México).\n\nRecomendación: activa el plan Blaze en Firebase Console.';
  }
  if (msg.includes('index')) {
    return 'Falta un índice en Firestore para esta consulta. Abre la consola del navegador (F12); el error de Firebase trae un enlace para crear el índice con un clic.';
  }
  return 'Hubo un problema al cargar las operaciones. Verifica tu conexión.';
};

/**
 * @param esActiva regla de "sigue activa" del tablero (usa el catálogo de status); se lee la versión
 *   vigente en cada carga.
 */
export function useOperacionesActivas<T extends OperacionActivaBase>(esActiva: (op: T) => boolean): OperacionesActivas<T> {
  const [operaciones, setOperaciones] = useState<T[]>([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hayMas, setHayMas] = useState(true);
  // Cursor robusto: el ÚLTIMO documento (snapshot), no su fecha.
  const ultimoDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const cursorCanonicoRef = useRef<Cursor>(null);
  const modoCanonicoRef = useRef(false);

  const descargar = async (): Promise<void> => {
    setCargando(true);
    // La bandera se ESPERA (al montar puede no haber llegado todavía).
    modoCanonicoRef.current = (await obtenerFlags()).consultasCanonicas;
    if (modoCanonicoRef.current) {
      try {
        const p = await paginaOperaciones({ estados: ['activa'] }, TAMANO_PAGINA_ACTIVAS);
        cursorCanonicoRef.current = p.cursor;
        setOperaciones(p.docs.map((d) => ({ ...d, _docId: idReal(d) }) as unknown as T).filter(esActiva));
        setHayMas(p.hayMas);
      } catch (e: unknown) {
        console.error('Error al cargar operaciones activas:', e);
        alert(`No se pudieron cargar las operaciones activas.\n\nDetalle: ${String((e as { message?: string })?.message || e)}`);
      }
      setCargando(false);
      return;
    }
    try {
      let docs: QueryDocumentSnapshot<DocumentData>[] = [];
      let metodo = 'directa (not-in)';
      let exito = false;
      try {
        const snap1 = await getDocs(query(collection(db, 'operaciones'), where('status', 'not-in', STATUS_FINALES), limit(TAMANO_PAGINA_ACTIVAS)));
        docs = snap1.docs;
        exito = true;
      } catch (errNotIn) {
        console.warn('[Operaciones] La consulta not-in falló; uso respaldo sin filtro:', errNotIn);
      }
      if (!exito) {
        metodo = 'respaldo (sin filtro, filtra en memoria)';
        const snap2 = await getDocs(query(collection(db, 'operaciones'), limit(2000)));
        docs = snap2.docs;
      }
      ultimoDocRef.current = docs.length ? docs[docs.length - 1] : null;
      // _docId = ID REAL del documento: algunos registros (legacy/migrados) traen un campo `id`
      // interno que sobrescribe a d.id en el spread; ese campo NO sirve para update/delete.
      const crudas = docs.map((d) => deDoc<T>(d));
      const activas = crudas.filter(esActiva);
      console.log(`[Operaciones v3] método: ${metodo} | crudas: ${crudas.length} | activas: ${activas.length}`);
      setOperaciones(activas);
      setHayMas(exito && docs.length === TAMANO_PAGINA_ACTIVAS);
    } catch (e: unknown) {
      console.error('Error al cargar operaciones:', e);
      alert(mensajeError(e));
    }
    setCargando(false);
  };

  const actualizar = async (): Promise<void> => {
    if (cargando || cargandoMas) return;
    ultimoDocRef.current = null;
    setHayMas(true);
    await descargar();
  };

  const cargarMas = async (): Promise<void> => {
    if (!hayMas || cargandoMas || operaciones.length === 0) return;
    setCargandoMas(true);
    // Sin duplicar las que ya están (por `id`, como antes).
    const agregar = (nuevas: T[]) => setOperaciones((prev) => {
      const idsPrev = new Set(prev.map((o) => String(o.id)));
      return [...prev, ...nuevas.filter((o) => !idsPrev.has(String(o.id)))];
    });
    if (modoCanonicoRef.current) {
      try {
        const p = await paginaOperaciones({ estados: ['activa'] }, TAMANO_PAGINA_ACTIVAS, cursorCanonicoRef.current);
        cursorCanonicoRef.current = p.cursor;
        agregar(p.docs.map((d) => ({ ...d, _docId: idReal(d) }) as unknown as T).filter(esActiva));
        setHayMas(p.hayMas);
      } catch (e: unknown) {
        console.error('Error al cargar más operaciones:', e);
        alert('No se pudieron cargar más operaciones.');
      }
      setCargandoMas(false);
      return;
    }
    try {
      const filtros: QueryConstraint[] = [where('status', 'not-in', STATUS_FINALES)];
      if (ultimoDocRef.current) filtros.push(startAfter(ultimoDocRef.current));
      filtros.push(limit(TAMANO_PAGINA_ACTIVAS));
      const snap = await getDocs(query(collection(db, 'operaciones'), ...filtros));
      if (snap.docs.length) ultimoDocRef.current = snap.docs[snap.docs.length - 1];
      agregar(snap.docs.map((d) => deDoc<T>(d)).filter(esActiva));
      setHayMas(snap.docs.length === TAMANO_PAGINA_ACTIVAS);
    } catch (e) {
      console.error('Error al cargar más operaciones:', e);
      alert('No se pudieron cargar más operaciones.');
    }
    setCargandoMas(false);
  };

  // Primera carga al montar (como antes: una vez). ✅ V00447: también en modo desarrollo
  //   (React monta dos veces los efectos y se pedían las operaciones dos veces).
  const descargarAlMontar = useRef(descargar);
  const yaMontadoRef = useRef(false);
  useEffect(() => {
    if (yaMontadoRef.current) return;
    yaMontadoRef.current = true;
    void descargarAlMontar.current();
  }, []);

  return { operaciones, setOperaciones, cargando, cargandoMas, hayMas, descargar, actualizar, cargarMas };
}

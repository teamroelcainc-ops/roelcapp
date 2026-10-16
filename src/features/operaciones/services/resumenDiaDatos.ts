// src/features/operaciones/services/resumenDiaDatos.ts
// ✅ V00456: lecturas del RESUMEN DEL DÍA (una consulta acotada por indicador).
//   · Operaciones del día: fecha de servicio de HOY (la tarjeta y la pestaña
//     "Completadas hoy" usan la MISMA consulta y la misma regla).
//   · Últimos tipos de cambio y capturas de diesel (modales de sus tarjetas).
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';

type Datos = Record<string, unknown>;
export type DocResumen = Datos & { id: string; _docId: string };

const aDoc = (d: { id: string; data: () => Datos }): DocResumen => ({ id: d.id, ...d.data(), _docId: d.id });

/** Operaciones con fecha de servicio de `hoy` (AAAA-MM-DD), en cualquier status. */
export const leerOperacionesDeHoy = async (hoy: string): Promise<DocResumen[]> =>
  (await getDocs(query(collection(db, 'operaciones'), where('fechaServicio', '==', hoy)))).docs.map(aDoc);

/** Claves de TanStack Query de los modales (se invalidan al capturar TC o diesel). */
export const CLAVE_ULTIMOS_TC = ['resumen-dia', 'tipo_cambio'] as const;
export const CLAVE_ULTIMOS_DIESEL = ['resumen-dia', 'combustibles'] as const;

/** Los `n` tipos de cambio más recientes hasta `hoy` (fecha AAAA-MM-DD, igual que la tarjeta). */
export const leerUltimosTipoCambio = async (hoy: string, n = 30): Promise<DocResumen[]> =>
  (await getDocs(query(collection(db, 'tipo_cambio'), where('fecha', '<=', hoy), orderBy('fecha', 'desc'), limit(n)))).docs.map(aDoc);

/** Las `n` capturas de diesel más recientes. */
export const leerUltimosDiesel = async (n = 40): Promise<DocResumen[]> =>
  (await getDocs(query(collection(db, 'combustibles'), orderBy('fecha', 'desc'), limit(n)))).docs.map(aDoc);

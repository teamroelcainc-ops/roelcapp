// src/features/conveniosDetalles/consecutivos.ts
// ---------------------------------------------------------------------------
// ✅ V00199 — CONSECUTIVO ÚNICO E IRREPETIBLE para los detalles del convenio
//   (clientes). Todas las rutas que crean detalles (aprobar un tarifario,
//   guardar un convenio en el formulario) piden aquí su rango de números:
//   · Se reserva con una TRANSACCIÓN sobre el contador
//     `contadores/convenios_clientes_detalles` → dos usuarios al mismo tiempo
//     jamás reciben el mismo número y no se brincan consecutivos.
//   · La primera vez, el contador se siembra con el consecutivo más alto que
//     ya exista en la colección (los CONV-### asignados por la migración).
//   · La CLAVE (id del documento) del detalle nuevo ES su consecutivo, con lo
//     que la irrepetibilidad queda garantizada por Firestore mismo.
// ✅ V00203: el mecanismo se generaliza — también sirve para el consecutivo
//   TAR-### de los tarifarios (contador contadores/tarifario_clientes).
// ---------------------------------------------------------------------------
import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../../config/firebase';

const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Máximo consecutivo ya usado en una colección (semilla del contador). */
const semillaDesdeColeccion = async (coleccion: string, prefijo: string): Promise<number> => {
  const snap = await getDocs(collection(db, coleccion));
  return snap.docs.reduce((max, d) => {
    const x = d.data() as Record<string, unknown>;
    const porCampo = parseInt(String(x.consecutivo || '').replace(/\D/g, ''), 10) || 0;
    const porId = parseInt(String(d.id).replace(/\D/g, ''), 10) || 0;
    return Math.max(max, porCampo, String(d.id).startsWith(prefijo) ? porId : 0);
  }, 0);
};

/** Reserva atómica de `cantidad` consecutivos en la colección dada. */
const reservarConsecutivos = async (coleccion: string, prefijo: string, cantidad: number): Promise<string[]> => {
  if (cantidad <= 0) return [];
  const semilla = await semillaDesdeColeccion(coleccion, prefijo);
  const contador = doc(db, 'contadores', coleccion);
  const inicio = await runTransaction(db, async (tx) => {
    const c = await tx.get(contador);
    const guardado = c.exists() ? Number((c.data() as Record<string, unknown>).ultimo) || 0 : 0;
    const ultimo = Math.max(guardado, semilla);
    tx.set(contador, { ultimo: ultimo + cantidad, actualizadoEl: new Date().toISOString() }, { merge: true });
    return ultimo + 1;
  });
  return Array.from({ length: cantidad }, (_, i) => `${prefijo}${pad3(inicio + i)}`);
};

/**
 * Reserva `cantidad` consecutivos seguidos (CONV-006, CONV-007, …) de forma
 * atómica y los regresa en orden. Nunca repite ni brinca números.
 */
export const reservarConsecutivosDetalle = (cantidad: number): Promise<string[]> =>
  reservarConsecutivos('convenios_clientes_detalles', 'CONV-', cantidad);

/** ✅ V00203: consecutivo TAR-### del TARIFARIO — único, irrepetible, +1. */
export const reservarConsecutivosTarifario = (cantidad: number): Promise<string[]> =>
  reservarConsecutivos('tarifario_clientes', 'TAR-', cantidad);

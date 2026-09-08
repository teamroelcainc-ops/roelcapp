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
// ---------------------------------------------------------------------------
import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../../config/firebase';

const COL_DETALLES = 'convenios_clientes_detalles';
const DOC_CONTADOR = doc(db, 'contadores', COL_DETALLES);

const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Máximo consecutivo ya usado en la colección (semilla del contador). */
const semillaDesdeColeccion = async (): Promise<number> => {
  const snap = await getDocs(collection(db, COL_DETALLES));
  return snap.docs.reduce((max, d) => {
    const x = d.data() as Record<string, unknown>;
    const porCampo = parseInt(String(x.consecutivo || '').replace(/\D/g, ''), 10) || 0;
    const porId = parseInt(String(d.id).replace(/\D/g, ''), 10) || 0;
    return Math.max(max, porCampo, String(d.id).startsWith('CONV-') ? porId : 0);
  }, 0);
};

/**
 * Reserva `cantidad` consecutivos seguidos (CONV-006, CONV-007, …) de forma
 * atómica y los regresa en orden. Nunca repite ni brinca números.
 */
export const reservarConsecutivosDetalle = async (cantidad: number): Promise<string[]> => {
  if (cantidad <= 0) return [];
  const semilla = await semillaDesdeColeccion();
  const inicio = await runTransaction(db, async (tx) => {
    const c = await tx.get(DOC_CONTADOR);
    const guardado = c.exists() ? Number((c.data() as Record<string, unknown>).ultimo) || 0 : 0;
    const ultimo = Math.max(guardado, semilla);
    tx.set(DOC_CONTADOR, { ultimo: ultimo + cantidad, actualizadoEl: new Date().toISOString() }, { merge: true });
    return ultimo + 1;
  });
  return Array.from({ length: cantidad }, (_, i) => `CONV-${pad3(inicio + i)}`);
};

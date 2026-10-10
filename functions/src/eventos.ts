/**
 * ✅ V00442 (Fase 6.4) — Reintentos e idempotencia de los triggers.
 * ------------------------------------------------------------------------------
 * · OPCIONES_TRIGGER: `retry: true`. Si un trigger falla (red, contención), Cloud
 *   Functions lo vuelve a correr en lugar de perder el cambio en silencio.
 * · conReintento(): registra el error con el id del evento y lo RELANZA (para que
 *   se reintente). Un evento de más de 24 h se descarta con un error en el log
 *   (alerta: métrica de registros "[reintentos]" en Cloud Monitoring), para que un
 *   error permanente no se reintente 7 días. (24 h y no minutos: una importación
 *   grande puede entregar eventos con retraso la PRIMERA vez y esos sí se procesan.)
 * · unaVezPorEvento(): para escrituras que NO son idempotentes (increment()): guarda
 *   el id del evento en eventos_procesados/{id} dentro de la misma transacción; un
 *   reintento del mismo evento no vuelve a sumar. TTL de 7 días en `expiraEn`
 *   (política TTL declarada en firestore.indexes.json).
 * Los demás triggers RECALCULAN (no suman) y, para que un reintento TARDÍO no
 * regrese datos viejos, releen el documento ACTUAL (o escriben con precondición o en
 * transacción) en lugar de usar la copia del evento.
 * ------------------------------------------------------------------------------
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';

if (getApps().length === 0) initializeApp();

export const OPCIONES_TRIGGER = { region: 'us-central1', retry: true } as const;
export const COL_EVENTOS = 'eventos_procesados';
const MAX_EDAD_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface EventoMin { id: string; time: string }

/** Corre el cuerpo de un trigger: error → log + relanzar (reintento); evento viejo → se descarta con error. */
export const conReintento = async (nombre: string, event: EventoMin, cuerpo: () => Promise<void>, ahora = Date.now()): Promise<void> => {
  const edad = ahora - Date.parse(event.time);
  if (Number.isFinite(edad) && edad > MAX_EDAD_MS) {
    logger.error(`[reintentos] ${nombre}: evento ${event.id} DESCARTADO tras ${Math.round(edad / 60000)} min de reintentos`);
    return;
  }
  try {
    await cuerpo();
  } catch (e) {
    logger.error(`[reintentos] ${nombre}: fallo en el evento ${event.id} (se reintenta)`, e);
    throw e;
  }
};

/**
 * Ejecuta `cuerpo` una sola vez por evento, en transacción. `cuerpo` debe hacer
 * TODAS sus lecturas antes de escribir (regla de las transacciones de Firestore).
 * Devuelve false si el evento ya se había procesado.
 */
export const unaVezPorEvento = async (db: Firestore, eventId: string, cuerpo: (tx: Transaction) => Promise<void>): Promise<boolean> => {
  const ref = db.collection(COL_EVENTOS).doc(eventId.replace(/\//g, '_'));
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    await cuerpo(tx);
    tx.set(ref, { creadoEn: Timestamp.now(), expiraEn: Timestamp.fromMillis(Date.now() + TTL_MS) });
    return true;
  });
};

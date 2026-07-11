/**
 * Cloud Function: crearOperacion  (versión alineada a tu operacionesService actual)
 * ------------------------------------------------------------------------------
 * Asigna el consecutivo en el BACKEND, de forma ATÓMICA, para eliminar los
 * duplicados/brincos que ocurrían al generarlo en el cliente.
 *
 * Compatible con lo que ya tienes:
 *   · Contador:  counters/operaciones_<PREFIJO>_<DDMMYY>   (campo numérico "count")
 *   · Formato:   <PREFIJO>-<DDMMYY>-<NNN>   (ej. TR-270626-001)
 *   · Campos:    refPrefijo = "<PREFIJO>-<DDMMYY>",  refConsecutivo = <NNN>,
 *                createdAt  = ISO string (igual que antes).
 *
 * El PREFIJO (TR/LO/FL/OP) y la clave de fecha (DDMMYY) los calcula el CLIENTE
 * con tus utilidades actuales y los envía; así el criterio es idéntico al de hoy
 * y esta función sólo se encarga del número atómico.
 *
 * Seguridad anti-repetidos (todo DENTRO de una sola transacción):
 *   1) Lee el contador "count".
 *   2) Calcula el "piso real" = máximo refConsecutivo ya existente para ese
 *      (prefijo, fecha). Si el contador viniera por detrás, se autocorrige.
 *   3) asignado = max(count, pisoReal) + 1  → nunca repite ni baja.
 *   4) Escribe contador + operación de forma atómica.
 * Idempotencia opcional (clienteOpId): un reintento de red no crea duplicados.
 *
 * Ubicación: functions/src/index.ts
 * Deploy:    firebase deploy --only functions:crearOperacion
 * ------------------------------------------------------------------------------
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

export const crearOperacion = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para crear una operación.');
  }

  const data = request.data || {};
  const operacion = data.operacion;
  if (!operacion || typeof operacion !== 'object') {
    throw new HttpsError('invalid-argument', 'Falta el objeto "operacion".');
  }

  // Prefijo y clave de fecha: los calcula el cliente con tus utilidades actuales.
  const prefijo = String(data.prefijo || 'OP').toUpperCase();
  const ddmmyy = String(data.ddmmyy || '');
  if (!/^\d{6}$/.test(ddmmyy)) {
    throw new HttpsError('invalid-argument', 'Falta o es inválida la clave de fecha (ddmmyy).');
  }

  const refPrefijo = `${prefijo}-${ddmmyy}`;                                  // ej. TR-010726
  const counterRef = db.collection('counters').doc(`operaciones_${prefijo}_${ddmmyy}`);
  const clienteOpId = data.clienteOpId ? String(data.clienteOpId) : null;

  try {
    const resultado = await db.runTransaction(async (tx) => {
      // ===================== LECTURAS (todas primero) =====================

      // Idempotencia: si este envío ya se procesó, devolvemos lo existente.
      let idempRef: DocumentReference | null = null;
      if (clienteOpId) {
        idempRef = db.collection('operaciones_idempotencia').doc(clienteOpId);
        const idempSnap = await tx.get(idempRef);
        if (idempSnap.exists) {
          const prev = idempSnap.data() as any;
          return { id: prev.operacionId, ref: prev.ref, yaExistia: true };
        }
      }

      // Contador actual del (prefijo, fecha).
      const counterSnap = await tx.get(counterRef);
      const count = counterSnap.exists ? (Number((counterSnap.data() as any).count) || 0) : 0;

      // Piso real: máximo refConsecutivo YA existente para este (prefijo, fecha).
      // Si el contador viene por detrás de la realidad, esto lo corrige.
      const existentesSnap = await tx.get(
        db.collection('operaciones').where('refPrefijo', '==', refPrefijo)
      );
      let pisoReal = 0;
      existentesSnap.forEach((d) => {
        const n = Number((d.data() as any).refConsecutivo) || 0;
        if (n > pisoReal) pisoReal = n;
      });

      // El consecutivo nunca baja ni se repite.
      const asignado = Math.max(count, pisoReal) + 1;
      const ref = `${prefijo}-${ddmmyy}-${String(asignado).padStart(3, '0')}`;
      const ahoraISO = new Date().toISOString();

      // ===================== ESCRITURAS =====================

      tx.set(counterRef, { count: asignado, prefijo, fecha: ddmmyy }, { merge: true });

      const nuevoRef = db.collection('operaciones').doc();
      const limpio: any = { ...operacion };
      delete limpio.id; // nunca confiar en un id del cliente

      tx.set(nuevoRef, {
        ...limpio,
        ref,
        refPrefijo,
        refConsecutivo: asignado,
        creadoPor: uid,
        createdAt: ahoraISO,
      });

      if (idempRef) {
        tx.set(idempRef, { operacionId: nuevoRef.id, ref, creadoPor: uid, createdAt: ahoraISO });
      }

      return { id: nuevoRef.id, ref, yaExistia: false };
    });

    return { success: true, ...resultado };
  } catch (err: any) {
    console.error('Error creando operación:', err);
    throw new HttpsError('internal', err?.message || 'No se pudo crear la operación.');
  }
});
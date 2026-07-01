/**
 * Cloud Function: crearOperacion
 * ------------------------------------------------------------------
 * Asigna el consecutivo de forma ATÓMICA en el backend, eliminando los
 * duplicados que ocurren al generarlo en el cliente (condición de carrera).
 *
 * Cómo funciona:
 *  - Usa una transacción de Firestore sobre un documento "contador" por
 *    prefijo+día (p.ej. contadores_operaciones/TR-010726). La transacción
 *    reintenta sola si hay conflicto => nunca entrega el mismo número dos veces.
 *  - Idempotencia opcional (clienteOpId): si un reintento de red vuelve a
 *    llamar con el mismo id, devuelve la operación ya creada en vez de duplicar.
 *
 * Ubicación sugerida: functions/src/index.ts  (o impórtalo desde ahí)
 * Requiere: plan Blaze (las Cloud Functions necesitan facturación activa).
 *
 * Deploy:
 *   cd functions && npm install
 *   firebase deploy --only functions:crearOperacion
 * ------------------------------------------------------------------
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

// Deriva el prefijo (TR/LO/FL) desde el nombre del tipo de operación.
// Solo se usa si el cliente NO manda un prefijo explícito.
function derivarPrefijo(tipoNombre: string): string {
  const t = String(tipoNombre || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (t.includes('transfer')) return 'TR';
  if (t.includes('logistic')) return 'LO';
  if (t.includes('flete')) return 'FL';
  return 'OP';
}

// Convierte "YYYY-MM-DD" a "DDMMYY". Si no viene fecha válida, usa hoy.
function fechaClaveDDMMYY(fechaServicio?: string): string {
  const m = String(fechaServicio || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

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

  // Prefijo y clave de fecha: se respetan los que mande el cliente si vienen;
  // si no, se derivan aquí para conservar el formato TR/LO/FL-DDMMYY-###.
  const prefijo = String(data.prefijo || derivarPrefijo(operacion.tipoOperacionNombre)).toUpperCase();
  const fechaClave = String(data.fechaClave || fechaClaveDDMMYY(operacion.fechaServicio));

  // ⚙️ Alcance del consecutivo. Por defecto: UNO POR PREFIJO POR DÍA.
  //    Si quieres un consecutivo GLOBAL por día (compartido entre TR/LO/FL),
  //    cambia por:  const counterId = fechaClave;
  const counterId = `${prefijo}-${fechaClave}`;

  // Idempotencia opcional: id único por envío del cliente.
  const clienteOpId = data.clienteOpId ? String(data.clienteOpId) : null;

  try {
    const resultado = await db.runTransaction(async (tx) => {
      // 1) TODAS LAS LECTURAS PRIMERO (regla de las transacciones).
      let idempRef: DocumentReference | null = null;
      if (clienteOpId) {
        idempRef = db.collection('operaciones_idempotencia').doc(clienteOpId);
        const idempSnap = await tx.get(idempRef);
        if (idempSnap.exists) {
          const prev = idempSnap.data() as any;
          // Ya se creó antes con este mismo id: devolvemos lo existente.
          return { id: prev.operacionId, ref: prev.ref, yaExistia: true };
        }
      }

      const counterRef = db.collection('contadores_operaciones').doc(counterId);
      const counterSnap = await tx.get(counterRef);
      const ultimo = counterSnap.exists ? ((counterSnap.data() as any).ultimo || 0) : 0;
      const siguiente = ultimo + 1;

      // 2) AHORA LAS ESCRITURAS.
      const nuevoRef = db.collection('operaciones').doc();
      const ref = `${prefijo}-${fechaClave}-${String(siguiente).padStart(3, '0')}`;

      tx.set(counterRef, {
        ultimo: siguiente,
        prefijo,
        fechaClave,
        actualizadoEn: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Nunca confiar en un "id" que venga del cliente.
      const limpio: any = { ...operacion };
      delete limpio.id;

      tx.set(nuevoRef, {
        ...limpio,
        ref,
        refPrefijo: prefijo,
        refConsecutivo: siguiente,
        creadoPor: uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (idempRef) {
        tx.set(idempRef, {
          operacionId: nuevoRef.id,
          ref,
          creadoPor: uid,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      return { id: nuevoRef.id, ref, yaExistia: false };
    });

    return resultado;
  } catch (err: any) {
    console.error('Error creando operación:', err);
    throw new HttpsError('internal', err?.message || 'No se pudo crear la operación.');
  }
});
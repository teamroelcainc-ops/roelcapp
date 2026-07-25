/**
 * Cloud Function: crearOperacion  (v2 — corrige SALTOS y DUPLICADOS)
 * ------------------------------------------------------------------------------
 * Asigna el consecutivo en el BACKEND, de forma ATÓMICA.
 *
 * ▶ POR QUÉ FALLABA LA VERSIÓN ANTERIOR:
 *
 *   1) DUPLICADOS — el "piso real" solo leía el campo refConsecutivo:
 *        where('refPrefijo', '==', refPrefijo)
 *      Las operaciones LEGACY (migradas de AppSheet o creadas por versiones
 *      viejas del cliente) tienen ref = "TR-220726-017" pero NO tienen los
 *      campos refPrefijo/refConsecutivo → eran INVISIBLES para la consulta.
 *      Si además el contador venía atrasado, se asignaba un número YA usado.
 *
 *   2) SALTOS — se tomaba max(contador, pisoReal) + 1. Cuando el contador
 *      quedaba ADELANTADO de la realidad (contadores inflados por el flujo
 *      viejo del cliente que incrementaba y luego fallaba al guardar, o por
 *      borrar la última operación del día), el brinco quedaba PERMANENTE:
 *      cada operación nueva lo arrastraba.
 *
 * ▶ CÓMO SE CORRIGE AQUÍ:
 *
 *   · El número asignado sale SIEMPRE de la REALIDAD: se leen las operaciones
 *     existentes del (prefijo, fecha) con DOS consultas (unión):
 *       a) where('refPrefijo', '==', refPrefijo)          → registros nuevos
 *       b) where('ref', '>=', 'PR-DDMMYY-') rango de ref  → registros legacy
 *     y de cada documento se toma el máximo entre refConsecutivo y el número
 *     parseado del final del ref. asignado = máximoReal + 1.
 *       → No puede duplicar: ve TODOS los folios ya guardados.
 *       → No puede saltar: siempre es exactamente el siguiente al mayor real.
 *
 *   · El CONTADOR ya no decide el número; queda como ANCLA DE SERIALIZACIÓN:
 *     leerlo y escribirlo dentro de la transacción obliga a que dos creaciones
 *     simultáneas entren en conflicto → la segunda se reintenta, vuelve a leer
 *     la realidad (ya con la operación de la primera) y toma el siguiente.
 *     También se guarda como caché de diagnóstico.
 *
 *   · Las consultas usan .select('ref', 'refConsecutivo') → se leen solo esos
 *     dos campos (menos payload y menos costo dentro de la transacción).
 *
 *   · maxAttempts: 10 y error 'aborted' diferenciado → si hay mucha contención
 *     el cliente recibe un código reintentable en lugar de 'internal'.
 *
 *   · Se eliminan los valores `undefined` del payload (Firestore Admin los
 *     rechaza y abortaría el commit completo).
 *
 * ▶ IMPORTANTE (fuera de esta función):
 *   · TODAS las creaciones deben pasar por esta función. Una pestaña vieja del
 *     navegador que todavía genere el folio en el CLIENTE puede duplicar sin
 *     que el backend pueda evitarlo (esta versión al menos se auto-corrige en
 *     la siguiente creación gracias a la consulta por rango de ref).
 *   · Enviar SIEMPRE clienteOpId (idempotencia): un reintento de red tras un
 *     timeout NO vuelve a crear la operación (es la otra fuente típica de
 *     "operaciones dobles" con dos folios seguidos).
 *
 * Compatible con lo que ya tienes:
 *   · Contador:  counters/operaciones_<PREFIJO>_<DDMMYY>   (campo "count")
 *   · Formato:   <PREFIJO>-<DDMMYY>-<NNN>   (ej. TR-270626-001)
 *   · Campos:    refPrefijo, refConsecutivo, creadoPor, createdAt (ISO string)
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

/** Extrae el número final de un ref "PR-DDMMYY-NNN" (tolera sin padding). */
const consecutivoDesdeRef = (ref: unknown): number => {
  const m = String(ref || '').match(/-(\d+)\s*$/);
  return m ? Number(m[1]) || 0 : 0;
};

/** Quita claves con valor undefined (Firestore Admin las rechaza). */
const sinUndefined = (obj: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  Object.keys(obj || {}).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
};

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

  // Prefijo y clave de fecha: los calcula el cliente con las utilidades actuales.
  const prefijo = String(data.prefijo || 'OP').toUpperCase();
  const ddmmyy = String(data.ddmmyy || '');
  if (!/^\d{6}$/.test(ddmmyy)) {
    throw new HttpsError('invalid-argument', 'Falta o es inválida la clave de fecha (ddmmyy).');
  }

  const refPrefijo = `${prefijo}-${ddmmyy}`; // ej. TR-010726
  const counterRef = db.collection('counters').doc(`operaciones_${prefijo}_${ddmmyy}`);
  const clienteOpId = data.clienteOpId ? String(data.clienteOpId) : null;

  try {
    const resultado = await db.runTransaction(
      async (tx) => {
        // ===================== LECTURAS (todas primero) =====================

        // [1] Idempotencia: si este envío ya se procesó, devolvemos lo existente.
        let idempRef: DocumentReference | null = null;
        if (clienteOpId) {
          idempRef = db.collection('operaciones_idempotencia').doc(clienteOpId);
          const idempSnap = await tx.get(idempRef);
          if (idempSnap.exists) {
            const prev = idempSnap.data() as any;
            return { id: prev.operacionId, ref: prev.ref, yaExistia: true };
          }
        }

        // [2] Contador: SOLO como ancla de serialización + diagnóstico.
        //     (Leerlo y escribirlo fuerza el conflicto entre dos creaciones
        //     simultáneas; la que pierde se reintenta y vuelve a leer todo.)
        const counterSnap = await tx.get(counterRef);
        const count = counterSnap.exists ? Number((counterSnap.data() as any).count) || 0 : 0;

        // [3] REALIDAD: máximo consecutivo YA GUARDADO para este (prefijo, fecha).
        //     Unión de DOS consultas para no dejar registros invisibles:
        //       a) por campo estructurado refPrefijo (registros nuevos)
        //       b) por RANGO del string ref (registros legacy/migrados que no
        //          tienen refPrefijo/refConsecutivo — la causa de los duplicados)
        //     Con .select() solo se leen los 2 campos necesarios.
        const [porPrefijoSnap, porRefSnap] = await Promise.all([
          tx.get(
            db
              .collection('operaciones')
              .where('refPrefijo', '==', refPrefijo)
              .select('ref', 'refConsecutivo')
          ),
          tx.get(
            db
              .collection('operaciones')
              .where('ref', '>=', `${refPrefijo}-`)
              .where('ref', '<=', `${refPrefijo}-\uf8ff`)
              .select('ref', 'refConsecutivo')
          ),
        ]);

        let maximoReal = 0;
        const acumularMaximo = (d: { data: () => any }) => {
          const dd = d.data() as any;
          const porCampo = Number(dd.refConsecutivo) || 0;
          const porRef = consecutivoDesdeRef(dd.ref);
          const n = Math.max(porCampo, porRef);
          if (n > maximoReal) maximoReal = n;
        };
        porPrefijoSnap.forEach(acumularMaximo);
        porRefSnap.forEach(acumularMaximo);

        // [4] El siguiente número es EXACTAMENTE el mayor real + 1.
        //     → nunca duplica (vio todos los folios) y nunca salta (aunque el
        //       contador esté inflado, la realidad manda y el brinco se cura).
        const asignado = maximoReal + 1;

        if (count !== maximoReal) {
          // Divergencia contador ↔ realidad: se auto-corrige, solo se deja rastro.
          console.warn(
            `[crearOperacion] contador (${count}) ≠ realidad (${maximoReal}) para ${refPrefijo}. ` +
              `Se asigna ${asignado} con base en la realidad y se re-sincroniza el contador.`
          );
        }

        const ref = `${prefijo}-${ddmmyy}-${String(asignado).padStart(3, '0')}`;
        const ahoraISO = new Date().toISOString();

        // ===================== ESCRITURAS =====================

        // Contador re-sincronizado con la realidad (ancla de serialización).
        tx.set(counterRef, { count: asignado, prefijo, fecha: ddmmyy, syncAt: ahoraISO }, { merge: true });

        const nuevoRef = db.collection('operaciones').doc();
        const limpio: any = sinUndefined({ ...operacion });
        // Nunca confiar en campos de control enviados por el cliente.
        delete limpio.id;
        delete limpio._docId;
        delete limpio.ref;
        delete limpio.refPrefijo;
        delete limpio.refConsecutivo;
        delete limpio.creadoPor;
        delete limpio.createdAt;

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
      },
      { maxAttempts: 10 } // ✅ más reintentos ante contención (default: 5)
    );

    return { success: true, ...resultado };
  } catch (err: any) {
    console.error('Error creando operación:', err);
    // ✅ Contención agotada (ABORTED, gRPC code 10): código reintentable para
    //    que el cliente pueda volver a llamar (con el MISMO clienteOpId).
    const code = err?.code;
    if (code === 10 || String(code).toUpperCase() === 'ABORTED') {
      throw new HttpsError(
        'aborted',
        'Demasiadas creaciones simultáneas. Reintenta en unos segundos (usa el mismo clienteOpId).'
      );
    }
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err?.message || 'No se pudo crear la operación.');
  }
});
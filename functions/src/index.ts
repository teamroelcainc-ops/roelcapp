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
import { z } from 'zod';
import { exigirPersonal, EXIGIR_APP_CHECK } from './acceso'; // ✅ V00435 · V00437: claims + App Check
import { CATALOGO_ADUANAS, CATALOGO_CV, catalogoServidor, contextoServidor } from './canonico';
import { banderaServidor } from './flags';
import { CAMPOS_CANONICOS, camposCanonicos, derivarDesdeConvenio } from './dominio/operacionCanonica.js';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

// ✅ Marcador para confirmar QUÉ versión está desplegada:
//   · aparece en los logs de cada invocación: [crearOperacion v2.1]
//   · viaja en la respuesta: { version: 'v2.1' }
const FN_VERSION = 'v2.2'; // ✅ V00440: + campos canónicos (bandera canonicosEnServidor)

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

// ✅ V00437 (Fase 1.5): validación del payload con zod. La operación tiene cientos
//   de campos opcionales: se validan los de control y los tipos de los campos
//   relacionales y de dinero; el resto pasa tal cual (passthrough).
const texto = z.string().max(2000);
const montoLibre = z.union([z.number().finite(), z.string().max(40)]).nullable().optional();
const relacion = texto.nullable().optional();
const esquemaOperacion = z.object({
  status: relacion,
  statusNombre: relacion,
  clientePaga: relacion,
  clienteMercancia: relacion,
  proveedorUnidad: relacion,
  convenio: relacion,
  operador: relacion,
  fechaServicio: z.union([z.string().max(40), z.null()]).optional(),
  montoConvenioCliente: montoLibre,
  totalAPagarProv: montoLibre,
  cargosAdicionales: montoLibre,
  cargosAdicionalesProv: montoLibre,
  sueldoOperador: montoLibre,
}).passthrough();
const esquemaCrear = z.object({
  operacion: esquemaOperacion,
  prefijo: z.string().trim().toUpperCase().regex(/^[A-ZÑ0-9.]{1,6}$/, 'Prefijo inválido').default('OP'),
  ddmmyy: z.string().regex(/^\d{6}$/, 'Falta o es inválida la clave de fecha (ddmmyy).'),
  clienteOpId: z.string().max(120).optional().nullable(),
});

export const crearOperacion = onCall({ region: 'us-central1', enforceAppCheck: EXIGIR_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para crear una operación.');
  }
  await exigirPersonal(uid); // ✅ V00435: los usuarios de CLIENTE no crean operaciones

  const valido = esquemaCrear.safeParse(request.data || {});
  if (!valido.success) {
    throw new HttpsError('invalid-argument', valido.error.issues.map((i) => `${i.path.join('.') || 'datos'}: ${i.message}`).join('; '));
  }
  const data = valido.data;
  const operacion = data.operacion;

  // Prefijo y clave de fecha: los calcula el cliente con las utilidades actuales.
  const prefijo = data.prefijo;
  const ddmmyy = data.ddmmyy;

  const refPrefijo = `${prefijo}-${ddmmyy}`; // ej. TR-010726
  const counterRef = db.collection('counters').doc(`operaciones_${prefijo}_${ddmmyy}`);
  const clienteOpId = data.clienteOpId ? String(data.clienteOpId) : null;

  console.log(`[crearOperacion ${FN_VERSION}] prefijo=${refPrefijo} clienteOpId=${clienteOpId || '(sin id)'}`);
  // ✅ V00440 (Fase 4.4): con la bandera, la operación nace con sus campos
  //   canónicos y su C/V/Aduana derivados (el trigger ya no tiene nada que escribir).
  //   Los catálogos se leen ANTES de la transacción (caché de 5 min).
  //   Si algo de eso falla, la operación se crea igual (el trigger lo completa).
  let ctxCanonico: Awaited<ReturnType<typeof contextoServidor>> | null = null;
  let catCV: Awaited<ReturnType<typeof catalogoServidor>> | null = null;
  let catAdu: Awaited<ReturnType<typeof catalogoServidor>> | null = null;
  try {
    if (await banderaServidor('canonicosEnServidor')) {
      [ctxCanonico, catCV, catAdu] = await Promise.all([contextoServidor(), catalogoServidor(...CATALOGO_CV), catalogoServidor(...CATALOGO_ADUANAS)]);
    }
  } catch (e) {
    console.error('[crearOperacion] No se pudieron preparar los campos canónicos; los completará el trigger.', e);
    ctxCanonico = null; catCV = null; catAdu = null;
  }
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
        // ✅ V00440: los campos canónicos los calcula SOLO el servidor (una copia de
        //   otra operación no debe arrastrar su estadoGrupo, empresasIds, etc.).
        //   `esPrueba` NO se quita: lo marca el formulario y es su propio origen.
        for (const campo of CAMPOS_CANONICOS) if (campo !== 'esPrueba') delete limpio[campo];

        const base = {
          ...limpio,
          ref,
          refPrefijo,
          refConsecutivo: asignado,
          creadoPor: uid,
          createdAt: ahoraISO,
        };
        const derivados = catCV && catAdu ? derivarDesdeConvenio(base, catCV, catAdu) : {};
        const canon = ctxCanonico ? camposCanonicos({ ...base, ...derivados }, ctxCanonico).campos : {};
        tx.set(nuevoRef, { ...base, ...derivados, ...canon });

        if (idempRef) {
          tx.set(idempRef, { operacionId: nuevoRef.id, ref, creadoPor: uid, createdAt: ahoraISO });
        }

        return { id: nuevoRef.id, ref, yaExistia: false };
      },
      { maxAttempts: 10 } // ✅ más reintentos ante contención (default: 5)
    );

    return { success: true, version: FN_VERSION, ...resultado };
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

/**
 * ✅ v2.1: renumerarOperacion — cambia la LÍNEA (prefijo) de una operación ya
 * guardada asignando el siguiente consecutivo REAL de la nueva línea, con la
 * MISMA transacción atómica que crearOperacion (máximo real + 1: no duplica,
 * no salta). Sustituye la regeneración que el cliente hacía con una consulta
 * lexicográfica sin transacción (fuente de brincos como 006 → 024).
 */
export const renumerarOperacion = onCall({ region: 'us-central1', enforceAppCheck: EXIGIR_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  await exigirPersonal(uid); // ✅ V00435
  const operacionId = String(request.data?.operacionId || '');
  const prefijo = String(request.data?.prefijo || '').toUpperCase();
  const ddmmyy = String(request.data?.ddmmyy || '');
  if (!operacionId) throw new HttpsError('invalid-argument', 'Falta operacionId.');
  if (!/^[A-ZÑ0-9.]{1,6}$/.test(prefijo)) throw new HttpsError('invalid-argument', 'Prefijo inválido.');
  if (!/^\d{6}$/.test(ddmmyy)) throw new HttpsError('invalid-argument', 'ddmmyy inválido.');

  const refPrefijo = `${prefijo}-${ddmmyy}`;
  const counterRef = db.collection('counters').doc(`operaciones_${prefijo}_${ddmmyy}`);
  const opRef = db.collection('operaciones').doc(operacionId);
  console.log(`[renumerarOperacion ${FN_VERSION}] op=${operacionId} → ${refPrefijo}`);

  try {
    const out = await db.runTransaction(async (tx) => {
      const opSnap = await tx.get(opRef);
      if (!opSnap.exists) throw new HttpsError('not-found', 'La operación no existe.');
      const actual = opSnap.data() as any;
      if (String(actual.refPrefijo || '') === refPrefijo && Number(actual.refConsecutivo) > 0) {
        return { ref: String(actual.ref || ''), sinCambio: true }; // ya está en esa línea
      }
      const counterSnap = await tx.get(counterRef);
      void counterSnap; // ancla de serialización
      const [porPrefijoSnap, porRefSnap] = await Promise.all([
        tx.get(db.collection('operaciones').where('refPrefijo', '==', refPrefijo).select('ref', 'refConsecutivo')),
        tx.get(db.collection('operaciones').where('ref', '>=', `${refPrefijo}-`).where('ref', '<=', `${refPrefijo}-\uf8ff`).select('ref', 'refConsecutivo')),
      ]);
      let maximoReal = 0;
      const acumular = (d: { data: () => any }) => {
        const dd = d.data() as any;
        const n = Math.max(Number(dd.refConsecutivo) || 0, consecutivoDesdeRef(dd.ref));
        if (n > maximoReal) maximoReal = n;
      };
      porPrefijoSnap.forEach(acumular);
      porRefSnap.forEach(acumular);
      const asignado = maximoReal + 1;
      const ref = `${prefijo}-${ddmmyy}-${String(asignado).padStart(3, '0')}`;
      tx.set(counterRef, { count: asignado, prefijo, fecha: ddmmyy, syncAt: new Date().toISOString() }, { merge: true });
      tx.update(opRef, { ref, refPrefijo, refConsecutivo: asignado });
      return { ref, sinCambio: false };
    }, { maxAttempts: 10 });
    return { success: true, version: FN_VERSION, ...out };
  } catch (err: any) {
    console.error('Error renumerando operación:', err);
    if (err instanceof HttpsError) throw err;
    const code = err?.code;
    if (code === 10 || String(code).toUpperCase() === 'ABORTED') {
      throw new HttpsError('aborted', 'Contención al renumerar; reintenta en unos segundos.');
    }
    throw new HttpsError('internal', err?.message || 'No se pudo renumerar la operación.');
  }
});

// ✅ V00266: MOTOR RELACIONAL — cascadas automáticas y verificador de integridad.
export * from './relacional';

// ✅ V00435: PORTAL DE CLIENTES (app móvil) — única puerta de datos del cliente.
export * from './portalClientes';

// ✅ V00437 (Fase 1): claims de acceso, alta/baja de usuarios y borrado con papelera.
export * from './usuarios';
export * from './papelera';

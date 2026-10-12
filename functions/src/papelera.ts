/**
 * ✅ V00437 (Fase 1.6) — eliminarConPapelera (callable).
 * ------------------------------------------------------------------------------
 * Borrado ATÓMICO con copia a la papelera: en una sola transacción se lee el
 * documento, se copia a `papelera_reciclaje` (quién, cuándo, motivo) y se borra.
 * Antes eran tres pasos sueltos en el navegador (getDoc → addDoc → deleteDoc):
 * si fallaba el tercero quedaba copia sin borrar; si fallaba el segundo… se borraba
 * sin copia en versiones viejas.
 *
 * Reglas del servidor (no dependen del navegador):
 *   · Solo personal. Colecciones de seguridad (usuarios, roles, configuración,
 *     autorizaciones, bitácoras, papelera, meta, contadores) NO se borran por aquí.
 *   · pagos no se borran por aquí (se revierten en Pagos, que devuelve los saldos).
 *   · facturas tampoco (V00448): se borran en Facturación, que desliga sus operaciones.
 *   · Una factura con pagos aplicados no se borra.
 * La revisión de la regla "Borrar" de Autorizaciones se sigue haciendo en el
 * navegador antes de llamar (src/config/firebase.ts → eliminarRegistro).
 * La web la usa cuando la bandera `eliminarPorServidor` está encendida.
 * ------------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { exigirPersonal, EXIGIR_APP_CHECK } from './acceso.js';
import { COL } from './dominio/constantes.js';

if (getApps().length === 0) initializeApp();

/** Colecciones que nunca se borran con esta función. */
export const COLECCIONES_NO_BORRABLES = new Set<string>([
  COL.usuarios, COL.roles, COL.configuracion, COL.configAutorizaciones,
  COL.historialActividad, COL.papelera, COL.meta, COL.contadores, 'counters',
  'historial_cambios', 'operaciones_idempotencia', COL.pagos,
  // ✅ V00448: las facturas se borran desde Facturación (desliga sus operaciones);
  // los saldos, contadores de uso y eventos los mantiene el servidor.
  COL.facturasClientes, COL.facturasProveedores, 'saldos_corrientes', 'usos', 'eventos_procesados',
]);

const esquema = z.object({
  coleccion: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/, 'Nombre de colección inválido'),
  id: z.string().min(1).max(200).refine((s) => !s.includes('/'), 'Id inválido'),
  motivo: z.string().trim().min(1, 'La nota de eliminación es obligatoria').max(1000),
  modulo: z.string().max(120).optional(),
  etiqueta: z.string().max(300).optional(),
});

export const eliminarConPapelera = onCall({ region: 'us-central1', enforceAppCheck: EXIGIR_APP_CHECK }, async (request) => {
  await exigirPersonal(request.auth?.uid);
  const parsed = esquema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', parsed.error.issues.map((i) => i.message).join('; '));
  const { coleccion, id, motivo, modulo, etiqueta } = parsed.data;
  if (COLECCIONES_NO_BORRABLES.has(coleccion)) {
    throw new HttpsError('permission-denied', `Los registros de "${coleccion}" no se eliminan desde aquí.`);
  }
  const db = getFirestore();
  const ref = db.collection(coleccion).doc(id);
  const quien = String(request.auth?.token?.email ?? request.auth?.uid ?? 'Sistema');

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'El registro ya no existe (otro usuario lo eliminó).');
    const datos = snap.data() as Record<string, unknown>;
    if ((coleccion === COL.facturasClientes || coleccion === COL.facturasProveedores) && (Number(datos.montoPagado) || 0) > 0.009) {
      throw new HttpsError('failed-precondition', 'Esta factura tiene pagos aplicados. Revierte los pagos en Pagos antes de eliminarla.');
    }
    tx.set(db.collection(COL.papelera).doc(), {
      coleccion,
      registroId: id,
      datos,
      motivo,
      modulo: modulo || coleccion,
      etiqueta: etiqueta || '',
      eliminadoPor: quien,
      eliminadoEn: new Date().toISOString(),
    });
    tx.delete(ref);
  });
  logger.info(`[papelera] ${quien} eliminó ${coleccion}/${id}`);
  return { ok: true };
});

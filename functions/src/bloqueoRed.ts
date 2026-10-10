/**
 * ✅ V00437 (Fase 1.7) — Red de la oficina en el SERVIDOR (función bloqueante).
 * ------------------------------------------------------------------------------
 * Hoy la revisión de "Requiere red de la oficina" corre en el navegador
 * (src/features/auth/services/acceso.ts): se puede saltar con las herramientas
 * del navegador. La forma robusta es una función BLOQUEANTE de inicio de sesión,
 * que ve la IP real de la petición (event.ipAddress) antes de emitir el token.
 *
 * ⚠ Requiere Firebase Authentication con Identity Platform (plan Blaze, en la
 *   consola: Authentication → Configuración → "Actualizar a Identity Platform").
 *   Sin eso el deploy de esta función falla, por eso NO se exporta desde index.ts.
 *   Para activarla: actualizar a Identity Platform y agregar en index.ts
 *     export * from './bloqueoRed';
 *   y desplegar: firebase deploy --only functions:bloqueoRedOficina
 * ------------------------------------------------------------------------------
 */
import { beforeUserSignedIn, HttpsError } from 'firebase-functions/v2/identity';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp();

export const bloqueoRedOficina = beforeUserSignedIn({ region: 'us-central1' }, async (event) => {
  const uid = event.data?.uid;
  if (!uid) return;
  const db = getFirestore();
  const perfil = (await db.doc(`usuarios/${uid}`).get()).data() as Record<string, unknown> | undefined;
  if (!perfil) return; // sin perfil: lo bloquean las reglas y la app (no hay nada que comparar aquí)
  const roles = (Array.isArray(perfil.roles) ? perfil.roles : []).map((r) => String(r)).filter(Boolean).slice(0, 30);
  if (roles.length === 0) return;
  const snapRoles = await db.collection('roles').where('nombre', 'in', roles).get();
  const exige = snapRoles.docs.some((d) => d.get('requiereIPOficina') === true);
  if (!exige) return;
  const seguridad = (await db.doc('configuracion/seguridad').get()).data() ?? {};
  const ipOficina = String(seguridad.ipOficina || seguridad.ipOficial || '').trim();
  if (ipOficina && event.ipAddress !== ipOficina) {
    throw new HttpsError('permission-denied', 'ACCESO DENEGADO. Tu rol solo permite iniciar sesión desde la red de la oficina de Roelca Inc.');
  }
});

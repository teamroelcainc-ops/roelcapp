/**
 * ✅ V00435 — Control de acceso de las Cloud Functions "callable".
 * ------------------------------------------------------------------------------
 * Las callables escriben con permisos de ADMIN (no pasan por las reglas de
 * Firestore). Mientras todas las cuentas eran del personal bastaba con revisar
 * que hubiera sesión; con los usuarios de CLIENTE de la app móvil ya no:
 * cada callable de uso interno debe exigir que quien llama sea PERSONAL.
 *
 * Personal = tiene documento en `usuarios`, no está desactivado y no es cliente.
 * ------------------------------------------------------------------------------
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp();

const norm = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export const exigirPersonal = async (uid: string | undefined): Promise<void> => {
  if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  const snap = await getFirestore().doc(`usuarios/${uid}`).get();
  const u = snap.data() as Record<string, unknown> | undefined;
  if (!snap.exists || !u || u.activo === false || norm(u.tipoUsuario) === 'cliente') {
    throw new HttpsError('permission-denied', 'Esta acción es solo para el personal de Roelca.');
  }
};

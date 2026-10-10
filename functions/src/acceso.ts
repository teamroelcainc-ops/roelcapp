/**
 * ✅ V00435 / V00437 — Control de acceso de las Cloud Functions.
 * ------------------------------------------------------------------------------
 * Las callables escriben con permisos de ADMIN (no pasan por las reglas de
 * Firestore): cada una debe revisar QUIÉN llama antes de hacer nada.
 *
 * Fuente de verdad del acceso: el documento `usuarios/{uid}`.
 *   · personal = tiene documento, no está desactivado (activo !== false) y no es cliente.
 *   · admin    = personal con el rol 'ADMIN' (comparación exacta, sin distinguir mayúsculas).
 *   · cliente  = tipoUsuario 'cliente' (solo app móvil, por portalCliente).
 *
 * ✅ V00437 (Fase 1): esos tres datos viajan además como CUSTOM CLAIMS en el token
 * (los pone el trigger `usuarioEscrito`, functions/src/usuarios.ts) para que las
 * REGLAS de lectura no lean el perfil en cada consulta. Las callables, en cambio,
 * siempre leen el documento. Un usuario SIN documento nunca tiene acceso.
 * ------------------------------------------------------------------------------
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { normalizarTexto } from './dominio/texto.js';

if (getApps().length === 0) initializeApp();

export interface ClaimsRoelca {
  personal: boolean;
  admin: boolean;
  cliente: boolean;
}

/** Claims que corresponden a un documento de `usuarios` (o null si no existe). Pura. */
export const claimsDePerfil = (perfil: Record<string, unknown> | null | undefined): ClaimsRoelca => {
  if (!perfil) return { personal: false, admin: false, cliente: false };
  const cliente = normalizarTexto(perfil.tipoUsuario) === 'cliente';
  const activo = perfil.activo !== false;
  const personal = activo && !cliente;
  const roles: unknown[] = Array.isArray(perfil.roles) ? perfil.roles : (perfil.rol ? [perfil.rol] : []);
  const admin = personal && roles.some((r) => String(r ?? '').trim().toUpperCase() === 'ADMIN');
  return { personal, admin, cliente: cliente && activo };
};

const claimsDelDocumento = async (uid: string): Promise<ClaimsRoelca> => {
  const snap = await getFirestore().doc(`usuarios/${uid}`).get();
  return claimsDePerfil(snap.exists ? (snap.data() as Record<string, unknown>) : null);
};

/**
 * Exige que quien llama sea PERSONAL de Roelca. Lee SIEMPRE el documento (no
 * confía en el claim): las callables escriben con permisos de admin, así que un
 * usuario dado de baja no debe poder usarlas ni un minuto más. Es 1 lectura por
 * llamada; las reglas de lectura sí usan el claim para no cobrar en cada consulta.
 */
export const exigirPersonal = async (uid: string | undefined): Promise<void> => {
  if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  const c = await claimsDelDocumento(uid);
  if (!c.personal) throw new HttpsError('permission-denied', 'Esta acción es solo para el personal de Roelca.');
};

/**
 * Exige que quien llama sea ADMINISTRADOR. Siempre lee el documento (no confía
 * en el claim): quitarle el rol ADMIN a alguien surte efecto al instante.
 */
export const exigirAdmin = async (uid: string | undefined): Promise<void> => {
  if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  const c = await claimsDelDocumento(uid);
  if (!c.admin) throw new HttpsError('permission-denied', 'Esta acción es solo para administradores.');
};

/**
 * ✅ V00437: App Check. Mientras no se active (ENFORCE_APP_CHECK=true en
 * functions/.env), las callables aceptan llamadas sin token de App Check.
 * Primero se activa App Check en la consola en modo MONITOREO y se revisa
 * que el tráfico legítimo trae token; después se enciende esta variable.
 */
export const EXIGIR_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';

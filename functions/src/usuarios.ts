/**
 * ✅ V00437 (Fase 1) — USUARIOS: claims de acceso y alta/baja desde el servidor.
 * ------------------------------------------------------------------------------
 * 1) usuarioEscrito (trigger): cada vez que cambia `usuarios/{uid}` se recalculan
 *    sus custom claims {personal, admin, cliente}. Si el documento se borra, el
 *    usuario se queda SIN claims (sin acceso). Al cambiar, deja la marca
 *    `claimsActualizadosEn` para que la web refresque su token al instante.
 *    Las reglas de Firestore impiden que un usuario se edite sus propios roles,
 *    así que solo un administrador puede subir los claims de alguien.
 *
 * 2) sincronizarClaims (callable, solo admin): recorre TODOS los usuarios y fija
 *    sus claims. Se corre UNA vez después de desplegar (backfill) y antes de
 *    publicar las reglas nuevas.
 *
 * 3) gestionarUsuario (callable, solo admin): crea, deshabilita, habilita o
 *    elimina usuarios en Firebase Auth con el Admin SDK. Reemplaza el truco de la
 *    "app secundaria" del navegador (bandera usuariosPorServidor).
 *    "Eliminar" deshabilita la cuenta de Auth (no se puede volver a entrar) y
 *    borra su documento; la cuenta queda para auditoría.
 * ------------------------------------------------------------------------------
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { claimsDePerfil, exigirAdmin, EXIGIR_APP_CHECK } from './acceso.js';
import type { ClaimsRoelca } from './acceso.js';
import { conReintento, OPCIONES_TRIGGER } from './eventos.js';

if (getApps().length === 0) initializeApp();

const mismosClaims = (a: Record<string, unknown> | undefined, b: ClaimsRoelca): boolean =>
  !!a && a.personal === b.personal && a.admin === b.admin && a.cliente === b.cliente;

/** Fija los claims de un usuario si cambiaron. Devuelve true si escribió. */
const aplicarClaims = async (uid: string, perfil: Record<string, unknown> | null): Promise<boolean> => {
  const deseados = claimsDePerfil(perfil);
  let actuales: Record<string, unknown> | undefined;
  try {
    actuales = (await getAuth().getUser(uid)).customClaims;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/user-not-found') return false; // documento sin cuenta de Auth: nada que hacer
    throw e;
  }
  if (mismosClaims(actuales, deseados)) return false;
  await getAuth().setCustomUserClaims(uid, { ...(actuales ?? {}), ...deseados });
  // Perdió el acceso de personal (baja, desactivado o pasó a cliente): se cierran
  // sus sesiones. Su token actual vale ≤1 h para LEER; escribir ya no puede
  // (las reglas exigen que el perfil exista y las callables leen el documento).
  if (actuales?.personal === true && !deseados.personal) await getAuth().revokeRefreshTokens(uid);
  return true;
};

export const usuarioEscrito = onDocumentWritten({ document: 'usuarios/{uid}', ...OPCIONES_TRIGGER }, (event) => conReintento('usuarioEscrito', event, async () => {
  const uid = event.params.uid;
  const despues = event.data?.after;
  // ✅ V00442 (6.4): el perfil ACTUAL, no la copia del evento: con reintentos, un evento
  //   viejo que se reintenta tarde no debe regresar permisos que ya se quitaron (o al revés).
  const actual = despues ? await despues.ref.get() : null;
  const perfil = actual?.exists ? (actual.data() as Record<string, unknown>) : null;
  try {
    const cambio = await aplicarClaims(uid, perfil);
    if (cambio && despues?.exists) {
      // Marca para que la web refresque el token (App.tsx escucha el perfil propio).
      await despues.ref.update({ claimsActualizadosEn: FieldValue.serverTimestamp() });
    }
    if (cambio) logger.info(`[usuarios] claims de ${uid} actualizados`, claimsDePerfil(perfil));
  } catch (e) {
    logger.error(`[usuarios] no se pudieron fijar los claims de ${uid}`, e);
    throw e; // reintento automático (retry) si está habilitado en la consola
  }
}));

export const sincronizarClaims = onCall({ region: 'us-central1', timeoutSeconds: 540, enforceAppCheck: EXIGIR_APP_CHECK }, async (request) => {
  await exigirAdmin(request.auth?.uid);
  const snap = await getFirestore().collection('usuarios').get();
  let actualizados = 0;
  const errores: string[] = [];
  for (const d of snap.docs) {
    try {
      if (await aplicarClaims(d.id, d.data() as Record<string, unknown>)) {
        actualizados += 1;
        await d.ref.update({ claimsActualizadosEn: FieldValue.serverTimestamp() });
      }
    } catch (e) {
      errores.push(`${d.id}: ${(e as Error).message}`);
    }
  }
  // Cuentas de Firebase Auth SIN documento en `usuarios`: desde la V00437 ya no
  // entran (antes entraban como admin). Se reportan para darles perfil o borrarlas.
  const conPerfil = new Set(snap.docs.map((d) => d.id));
  const cuentasSinPerfil: string[] = [];
  let pagina: string | undefined;
  do {
    const lista = await getAuth().listUsers(1000, pagina);
    lista.users.forEach((u) => { if (!conPerfil.has(u.uid)) cuentasSinPerfil.push(`${u.email || '(sin correo)'} · ${u.uid}${u.disabled ? ' · deshabilitada' : ''}`); });
    pagina = lista.pageToken;
  } while (pagina);
  logger.info(`[usuarios] sincronizarClaims: ${actualizados}/${snap.size} actualizados por ${request.auth?.uid}; ${cuentasSinPerfil.length} cuenta(s) sin perfil`);
  return { revisados: snap.size, actualizados, errores: errores.slice(0, 50), cuentasSinPerfil: cuentasSinPerfil.slice(0, 200) };
});

// ── gestionarUsuario ─────────────────────────────────────────────────────────
const esquemaGestion = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('crear'),
    email: z.string().trim().email(),
    password: z.string().min(6).max(128),
    perfil: z.record(z.string(), z.unknown()),
  }),
  z.object({ accion: z.literal('deshabilitar'), uid: z.string().min(1) }),
  z.object({ accion: z.literal('habilitar'), uid: z.string().min(1) }),
  z.object({ accion: z.literal('eliminar'), uid: z.string().min(1) }),
]);

/** Campos del perfil que el cliente NO puede fijar al crear (los controla el servidor). */
const CAMPOS_PROTEGIDOS = ['claimsActualizadosEn', 'uid', 'id'];

export const gestionarUsuario = onCall({ region: 'us-central1', enforceAppCheck: EXIGIR_APP_CHECK }, async (request) => {
  await exigirAdmin(request.auth?.uid);
  const parsed = esquemaGestion.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', `Datos inválidos: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const datos = parsed.data;
  const auth = getAuth();
  const db = getFirestore();
  const quien = request.auth?.uid ?? '';

  switch (datos.accion) {
    case 'crear': {
      let uid: string;
      try {
        uid = (await auth.createUser({ email: datos.email, password: datos.password })).uid;
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Ya existe un usuario con ese correo.');
        throw new HttpsError('internal', (e as Error).message);
      }
      const perfil: Record<string, unknown> = { ...datos.perfil };
      CAMPOS_PROTEGIDOS.forEach((k) => delete perfil[k]);
      await db.doc(`usuarios/${uid}`).set({ ...perfil, email: datos.email, creadoPor: quien, createdAt: new Date().toISOString() });
      // El trigger usuarioEscrito fija los claims.
      logger.info(`[usuarios] ${quien} creó ${datos.email} (${uid})`);
      return { uid };
    }
    case 'deshabilitar':
    case 'habilitar': {
      const disabled = datos.accion === 'deshabilitar';
      await auth.updateUser(datos.uid, { disabled });
      if (disabled) await auth.revokeRefreshTokens(datos.uid);
      await db.doc(`usuarios/${datos.uid}`).set({ activo: !disabled }, { merge: true });
      logger.info(`[usuarios] ${quien} ${datos.accion} ${datos.uid}`);
      return { uid: datos.uid };
    }
    case 'eliminar': {
      if (datos.uid === quien) throw new HttpsError('failed-precondition', 'No puedes eliminar tu propio usuario.');
      try {
        await auth.updateUser(datos.uid, { disabled: true });
        await auth.revokeRefreshTokens(datos.uid);
      } catch (e) {
        if ((e as { code?: string }).code !== 'auth/user-not-found') throw new HttpsError('internal', (e as Error).message);
      }
      await db.doc(`usuarios/${datos.uid}`).delete();
      logger.info(`[usuarios] ${quien} eliminó (deshabilitó en Auth) ${datos.uid}`);
      return { uid: datos.uid };
    }
  }
});

// src/features/auth/services/acceso.ts
// ---------------------------------------------------------------------------
// ✅ V00437 (Fase 1.1 / 1.7) — ¿Este usuario puede entrar al sistema web?
//
// 1) Perfil: sin documento en `usuarios`, desactivado o de CLIENTE → NO entra.
//    Antes, una cuenta de Auth sin documento entraba como ADMIN ("bypass"): un
//    usuario dado de baja (se le borraba el documento) o cualquiera que creara
//    una cuenta con la API key pública tenía acceso total.
// 2) Red de la oficina: si alguno de sus roles tiene "Requiere IP de oficina",
//    su IP pública debe ser la de configuracion/seguridad. Se unificaron los dos
//    nombres que existían (`ipOficina` del login y `ipOficial` del reloj
//    checador) y las dos colecciones de roles (`roles`, la que edita la app, y
//    `catalogo_roles`, la vieja). Se revisa al iniciar sesión Y al restaurar una
//    sesión guardada (antes solo en el login interactivo).
// ---------------------------------------------------------------------------
import { collection, doc, getDoc, getDocs, getDocsFromCache, query, where } from 'firebase/firestore';
import type { Query, QuerySnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { COL } from '../../../shared/dominio/constantes';
import type { VeredictoPerfil } from './reglasAcceso';

export { evaluarPerfil, MENSAJE_ACCESO, esAdminPorRoles } from './reglasAcceso';
export type { VeredictoPerfil };

const rolesDe = (perfil: Record<string, unknown>): string[] => {
  const roles = Array.isArray(perfil.roles) ? perfil.roles : (perfil.rol ? [perfil.rol] : []);
  return roles.map((r) => String(r ?? '').trim()).filter(Boolean);
};

/** ✅ V00447: identifica la revisión de red por usuario Y roles: si cambian los roles, se revisa otra vez. */
export const claveRevisionRed = (uid: string, perfil: Record<string, unknown>): string =>
  `${uid}|${[...rolesDe(perfil)].sort().join(',')}`;

/** Documentos de los roles del usuario en las dos colecciones de roles (todas las consultas a la vez). */
const leerRoles = async (roles: string[], leer: (q: Query) => Promise<QuerySnapshot>): Promise<QuerySnapshot[]> => {
  const consultas: Promise<QuerySnapshot>[] = [];
  for (const coleccion of [COL.roles, 'catalogo_roles']) {
    for (let i = 0; i < roles.length; i += 30) {
      consultas.push(leer(query(collection(db, coleccion), where('nombre', 'in', roles.slice(i, i + 30)))));
    }
  }
  return Promise.all(consultas);
};
const exigeOficina = (snaps: QuerySnapshot[]): boolean => snaps.some((s) => s.docs.some((d) => d.get('requiereIPOficina') === true));

/** ¿Alguno de los roles del usuario exige estar en la red de la oficina? (servidor) */
const rolesExigenOficina = async (roles: string[]): Promise<boolean> =>
  roles.length > 0 && exigeOficina(await leerRoles(roles, getDocs));

/**
 * ✅ V00447 (arranque): lo mismo, pero con la caché local (IndexedDB), sin esperar a la red.
 * true = la caché dice que NINGÚN rol exige la red de la oficina → la app puede abrir ya y el
 * veredicto definitivo (servidor) llega en segundo plano. false = algún rol la exige, o la caché
 * no conoce TODOS los roles (primera vez en este navegador, rol nuevo): hay que esperar la revisión completa.
 */
export const redLibreSegunCache = async (perfil: Record<string, unknown>): Promise<boolean> => {
  const roles = rolesDe(perfil);
  if (roles.length === 0) return true;
  try {
    const snaps = await leerRoles(roles, getDocsFromCache);
    const conocidos = new Set(snaps.flatMap((s) => s.docs.map((d) => String(d.get('nombre') ?? '').trim())));
    if (roles.some((r) => !conocidos.has(r))) return false; // algún rol no está guardado en este navegador
    return !exigeOficina(snaps);
  } catch {
    return false;
  }
};

/** IP de la oficina configurada (un solo valor aunque esté guardado con el nombre viejo). */
export const leerIpOficina = async (): Promise<string> => {
  const snap = await getDoc(doc(db, COL.configuracion, 'seguridad'));
  const d = snap.exists() ? snap.data() : {};
  return String(d.ipOficina || d.ipOficial || '').trim();
};

export type ResultadoRed = { permitido: true } | { permitido: false; motivo: string; ipDetectada?: string };

/**
 * Revisa la red de la oficina para el perfil dado. Si ningún rol lo exige o no
 * hay IP configurada, permite. Si no se puede averiguar la IP pública (bloqueador
 * de anuncios), NO permite: es la misma decisión que tenía el login.
 */
export const verificarRedOficina = async (perfil: Record<string, unknown>): Promise<ResultadoRed> => {
  if (!(await rolesExigenOficina(rolesDe(perfil)))) return { permitido: true };
  const ipOficina = await leerIpOficina();
  if (!ipOficina) return { permitido: true };
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const { ip } = (await r.json()) as { ip?: string };
    if (String(ip || '').trim() === ipOficina) return { permitido: true };
    return {
      permitido: false,
      ipDetectada: String(ip || ''),
      motivo: 'ACCESO DENEGADO. Por medidas de seguridad, tu rol solo permite iniciar sesión desde la red WiFi de la oficina de Roelca Inc.',
    };
  } catch {
    return { permitido: false, motivo: 'No pudimos verificar la seguridad de tu red. Desactiva tu bloqueador de anuncios (AdBlock) e intenta de nuevo.' };
  }
};

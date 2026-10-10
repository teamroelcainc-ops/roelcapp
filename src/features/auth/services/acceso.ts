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
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { COL } from '../../../shared/dominio/constantes';
import type { VeredictoPerfil } from './reglasAcceso';

export { evaluarPerfil, MENSAJE_ACCESO, esAdminPorRoles } from './reglasAcceso';
export type { VeredictoPerfil };

const rolesDe = (perfil: Record<string, unknown>): string[] => {
  const roles = Array.isArray(perfil.roles) ? perfil.roles : (perfil.rol ? [perfil.rol] : []);
  return roles.map((r) => String(r ?? '').trim()).filter(Boolean);
};

/** ¿Alguno de los roles del usuario exige estar en la red de la oficina? */
const rolesExigenOficina = async (roles: string[]): Promise<boolean> => {
  if (roles.length === 0) return false;
  for (const coleccion of [COL.roles, 'catalogo_roles']) {
    for (let i = 0; i < roles.length; i += 30) {
      const tanda = roles.slice(i, i + 30);
      const snap = await getDocs(query(collection(db, coleccion), where('nombre', 'in', tanda)));
      if (snap.docs.some((d) => d.get('requiereIPOficina') === true)) return true;
    }
  }
  return false;
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

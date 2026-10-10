// src/shared/data/sesion.ts
// ---------------------------------------------------------------------------
// ✅ V00439 (Fase 3.7) — permisos del usuario de la sesión SIN leer Firestore.
// App.tsx publica en useUsuarioStore el usuario, sus roles efectivos (con la
// vista previa "Ver como" ya resuelta) y el catálogo de roles en vivo. Antes
// varios módulos volvían a leer usuarios/{uid} y TODA la colección roles para
// saber un permiso (Operaciones, el formulario, Autorizaciones, formularios…).
// ---------------------------------------------------------------------------
import { useUsuarioStore } from '../../stores/useUsuarioStore';
import { esAdminPorRoles } from '../../features/auth/services/reglasAcceso';
import { normalizarTexto } from '../dominio/texto';
import { idReal } from './coleccionesVivas';
import type { DocCatalogo } from './catalogos';

export type ModoPermiso = 'exacto' | 'contiene';

const coincide = (permisoRol: unknown, permiso: string, modo: ModoPermiso): boolean => {
  const a = normalizarTexto(permisoRol);
  const b = normalizarTexto(permiso);
  return modo === 'exacto' ? a === b : a.includes(b);
};

/** Pura: ¿alguno de `roles` tiene `permiso` en sus modulosPermitidos? Admin siempre. */
export const rolesTienenPermiso = (
  roles: readonly string[], rolesCatalogo: readonly DocCatalogo[], permiso: string, modo: ModoPermiso = 'exacto',
): boolean => {
  if (esAdminPorRoles(roles)) return true;
  const mios = new Set(roles.map((r) => normalizarTexto(r)));
  return rolesCatalogo.some((rol) => {
    const esMio = mios.has(normalizarTexto(rol.nombre)) || mios.has(normalizarTexto(idReal(rol)));
    if (!esMio) return false;
    const permisos = Array.isArray(rol.modulosPermitidos) ? rol.modulosPermitidos : [];
    return permisos.some((p) => coincide(p, permiso, modo));
  });
};

/** Lectura inmediata (fuera de React). */
export const tienePermisoRol = (permiso: string, modo: ModoPermiso = 'exacto'): boolean => {
  const { rolesEfectivos, rolesCatalogo } = useUsuarioStore.getState();
  return rolesTienenPermiso(rolesEfectivos, rolesCatalogo, permiso, modo);
};

/** Hook: ¿el usuario tiene el permiso? Se actualiza si cambian sus roles o el catálogo. */
export function usePermisoRol(permiso: string, modo: ModoPermiso = 'exacto'): boolean {
  const roles = useUsuarioStore((s) => s.rolesEfectivos);
  const catalogo = useUsuarioStore((s) => s.rolesCatalogo);
  return rolesTienenPermiso(roles, catalogo, permiso, modo);
}

/** Hook: ¿roles efectivos de administrador? */
export function useEsAdmin(): boolean {
  return esAdminPorRoles(useUsuarioStore((s) => s.rolesEfectivos));
}

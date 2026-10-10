// src/features/auth/services/reglasAcceso.ts
// ✅ V00437 (Fase 1.1) — reglas PURAS de acceso al sistema web (sin Firebase),
// separadas para poder probarlas. Las usa acceso.ts, App.tsx y Login.tsx.
import { normalizarTexto } from '../../../shared/dominio/texto';

export type VeredictoPerfil = 'ok' | 'sin-perfil' | 'inactivo' | 'cliente';

/** Veredicto de acceso a partir del documento usuarios/{uid} (null si no existe). Pura. */
export const evaluarPerfil = (perfil: Record<string, unknown> | null | undefined): VeredictoPerfil => {
  if (!perfil) return 'sin-perfil';
  if (normalizarTexto(perfil.tipoUsuario) === 'cliente') return 'cliente';
  if (perfil.activo === false) return 'inactivo';
  return 'ok';
};

export const MENSAJE_ACCESO: Record<Exclude<VeredictoPerfil, 'ok'>, string> = {
  'sin-perfil': 'Tu cuenta no tiene un perfil de usuario en Roelca. Pide a un administrador que te dé acceso.',
  inactivo: 'Tu usuario está desactivado. Comunícate con un administrador de Roelca.',
  cliente: 'Este usuario es de CLIENTE: entra desde la app móvil de Roelca.',
};

/** ¿Es administrador? Comparación EXACTA del rol 'ADMIN' (sin distinguir mayúsculas). */
export const esAdminPorRoles = (roles: unknown): boolean =>
  Array.isArray(roles) && roles.some((r) => String(r ?? '').trim().toUpperCase() === 'ADMIN');

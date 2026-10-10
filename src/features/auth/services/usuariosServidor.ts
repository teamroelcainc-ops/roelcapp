// src/features/auth/services/usuariosServidor.ts
// ✅ V00437 (Fase 1.2 / 1.3) — alta/baja de usuarios y claims por el servidor.
// La web los usa con la bandera `usuariosPorServidor` (ver PLAN-REFACTOR.md).
import { llamarCallable } from '../../../shared/data/callables';

export type GestionUsuario =
  | { accion: 'crear'; email: string; password: string; perfil: Record<string, unknown> }
  | { accion: 'deshabilitar' | 'habilitar' | 'eliminar'; uid: string };

export const gestionarUsuarioServidor = (datos: GestionUsuario): Promise<{ uid: string }> =>
  llamarCallable<{ uid: string }>('gestionarUsuario', datos);

export interface ResultadoSincronizarClaims { revisados: number; actualizados: number; errores: string[]; cuentasSinPerfil?: string[] }

/** Backfill: fija los claims de acceso de TODOS los usuarios (solo admin). */
export const sincronizarClaimsServidor = (): Promise<ResultadoSincronizarClaims> =>
  llamarCallable<ResultadoSincronizarClaims>('sincronizarClaims', {});

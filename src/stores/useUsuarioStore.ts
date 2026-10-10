// src/stores/useUsuarioStore.ts
// Estado global de CLIENTE con Zustand: el usuario de la sesión y sus roles
// efectivos. Evita el "prop drilling" de usuarioActual por todo el árbol:
// cualquier vista puede leerlo con useUsuarioStore(s => s.usuario).
// App.tsx lo alimenta al resolver la autenticación (fuente única de verdad).
// ✅ V00439 (Fase 3.7): también el catálogo de roles y si los roles efectivos
//   son de una vista previa ("Ver como"). Los módulos ya no vuelven a leer
//   usuarios/{uid} ni la colección roles: usan src/shared/data/sesion.ts.
import { create } from 'zustand';
import type { DocCatalogo } from '../shared/data/catalogos';

export interface UsuarioSesion {
  id: string;
  nombre?: string;
  email?: string;
  rol?: string;
  roles?: string[];
  /** Vínculo explícito con su registro de Colaboradores (empleados). */
  colaboradorId?: string;
  /** Horario de trabajo semanal (para el Reloj Checador y sus alertas). */
  horarioTrabajo?: import('../utils/horarioTrabajo').HorarioTrabajo;
  /** Permiso especial para editar la app (Autorizaciones). */
  puedeEditarApp?: boolean;
}

interface UsuarioStore {
  usuario: UsuarioSesion | null;
  rolesEfectivos: string[];
  /** true si rolesEfectivos vienen de "Ver como" (solo posible para un admin real). */
  vistaPrevia: boolean;
  /** Catálogo de roles (colección `roles`), en vivo desde App.tsx. */
  rolesCatalogo: DocCatalogo[];
  setUsuario: (usuario: UsuarioSesion | null) => void;
  setRolesEfectivos: (roles: string[], vistaPrevia?: boolean) => void;
  setRolesCatalogo: (roles: DocCatalogo[]) => void;
  limpiar: () => void;
}

export const useUsuarioStore = create<UsuarioStore>((set) => ({
  usuario: null,
  rolesEfectivos: [],
  vistaPrevia: false,
  rolesCatalogo: [],
  setUsuario: (usuario) => set({ usuario }),
  setRolesEfectivos: (rolesEfectivos, vistaPrevia = false) => set({ rolesEfectivos, vistaPrevia }),
  setRolesCatalogo: (rolesCatalogo) => set({ rolesCatalogo }),
  limpiar: () => set({ usuario: null, rolesEfectivos: [], vistaPrevia: false, rolesCatalogo: [] }),
}));

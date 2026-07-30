// src/stores/useUsuarioStore.ts
// Estado global de CLIENTE con Zustand: el usuario de la sesión y sus roles
// efectivos. Evita el "prop drilling" de usuarioActual por todo el árbol:
// cualquier vista puede leerlo con useUsuarioStore(s => s.usuario).
// App.tsx lo alimenta al resolver la autenticación (fuente única de verdad).
import { create } from 'zustand';

export interface UsuarioSesion {
  id: string;
  nombre?: string;
  email?: string;
  rol?: string;
  roles?: string[];
  /** Vínculo explícito con su registro de Colaboradores (empleados). */
  colaboradorId?: string;
}

interface UsuarioStore {
  usuario: UsuarioSesion | null;
  rolesEfectivos: string[];
  setUsuario: (usuario: UsuarioSesion | null) => void;
  setRolesEfectivos: (roles: string[]) => void;
  limpiar: () => void;
}

export const useUsuarioStore = create<UsuarioStore>((set) => ({
  usuario: null,
  rolesEfectivos: [],
  setUsuario: (usuario) => set({ usuario }),
  setRolesEfectivos: (rolesEfectivos) => set({ rolesEfectivos }),
  limpiar: () => set({ usuario: null, rolesEfectivos: [] }),
}));

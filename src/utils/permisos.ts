// src/utils/permisos.ts
// ---------------------------------------------------------------------------
// ✅ V00224 — Registro compartido de permisos del rol.
//   App.tsx calcula las claves permitidas (rol + vistas extra + "Ver como") y
//   las publica aquí; cualquier componente puede consultarlas sin tener que
//   recibirlas por props a través de media docena de niveles.
// ---------------------------------------------------------------------------
let CLAVES: Set<string> = new Set();
const suscriptores = new Set<() => void>();

/** Llamado por App cada vez que cambian los permisos efectivos. */
export const publicarClavesPermitidas = (claves: Set<string>): void => {
  CLAVES = new Set(claves);
  suscriptores.forEach((fn) => { try { fn(); } catch { /* noop */ } });
};

/** ¿El usuario tiene este permiso? (Admin/acceso total ya viene resuelto en App.) */
export const puedeClave = (clave: string): boolean => CLAVES.has(clave);

/** Suscripción opcional para re-renderizar cuando cambien los permisos. */
export const alCambiarPermisos = (fn: () => void): (() => void) => {
  suscriptores.add(fn);
  return () => { suscriptores.delete(fn); };
};

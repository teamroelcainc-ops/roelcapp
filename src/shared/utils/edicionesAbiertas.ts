// src/shared/utils/edicionesAbiertas.ts
// ---------------------------------------------------------------------------
// ✅ V00438 (Fase 2.10) — ¿Hay un formulario abierto con trabajo sin guardar?
// Cuando se publica una versión nueva, la app se recargaba sola en cuanto el
// service worker nuevo tomaba el control (V00284) y se perdía lo capturado en un
// formulario abierto. Ahora la recarga ESPERA a que se cierren los formularios
// registrados aquí (FormularioOperacion lo registra mientras está montado).
// ---------------------------------------------------------------------------
import { useEffect } from 'react';

const abiertas = new Set<symbol>();
const alVaciarse = new Set<() => void>();
const oyentes = new Set<() => void>();
const avisar = (): void => { oyentes.forEach((f) => f()); };

/** Para la UI: se avisa cuando cambia el estado (ediciones abiertas o recarga en espera). */
export const suscribirEdiciones = (f: () => void): (() => void) => {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
};

export const hayEdicionesAbiertas = (): boolean => abiertas.size > 0;

/** Ejecuta `fn` en cuanto no quede ningún formulario abierto (de inmediato si ya no hay). */
export const cuandoNoHayaEdiciones = (fn: () => void): void => {
  if (abiertas.size === 0) { fn(); return; }
  alVaciarse.add(fn);
  avisar();
};

const vaciarSiSigueLibre = (): void => {
  if (abiertas.size !== 0 || alVaciarse.size === 0) return;
  const pendientes = Array.from(alVaciarse);
  alVaciarse.clear();
  avisar();
  pendientes.forEach((f) => f());
};

/**
 * Marca una edición/guardado en curso. Devuelve la función para liberarla.
 * Úsala también alrededor de un GUARDADO: el formulario puede cerrarse antes de
 * que terminen las escrituras o subidas de archivos que siguen a onSave.
 */
export const abrirEdicion = (): (() => void) => {
  const id = Symbol('edicion');
  abiertas.add(id);
  avisar();
  let liberada = false;
  return () => {
    if (liberada) return;
    liberada = true;
    abiertas.delete(id);
    avisar();
    // Pequeña espera: si se abre otro formulario o empieza otro guardado enseguida, no se recarga.
    if (abiertas.size === 0) setTimeout(vaciarSiSigueLibre, 1500);
  };
};

export const hayRecargaEnEspera = (): boolean => alVaciarse.size > 0 && abiertas.size > 0;

/** Marca un formulario como abierto mientras `activa` sea true. */
export function useEdicionAbierta(activa = true): void {
  useEffect(() => (activa ? abrirEdicion() : undefined), [activa]);
}

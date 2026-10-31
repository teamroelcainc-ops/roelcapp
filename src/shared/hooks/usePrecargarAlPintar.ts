// src/shared/hooks/usePrecargarAlPintar.ts
// ---------------------------------------------------------------------------
// ✅ V00534 — Precarga en segundo plano DESPUÉS de pintar. Una pantalla que abre formularios o modales
// grandes con lazy() los empieza a bajar cuando el navegador queda libre (requestIdleCallback, con un
// tope de espera), no al abrirse: la pantalla pinta primero y el formulario ya está listo al dar clic.
// Corre una sola vez por montaje (los módulos de MantenerVivo se montan una vez por sesión).
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent } from 'react';

/** Espera máxima para que el navegador quede libre antes de precargar igual. */
export const ESPERA_MAXIMA_MS = 3000;

/** Programa `tarea` para cuando el navegador quede libre; devuelve cómo cancelarla. */
export const alQuedarLibre = (tarea: () => void, esperaMaximaMs = ESPERA_MAXIMA_MS): (() => void) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(tarea, { timeout: esperaMaximaMs });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(tarea, Math.min(esperaMaximaMs, 1500));
  return () => clearTimeout(id);
};

/** Llama cada precarga (`() => void import(...)`) una vez, cuando el navegador quede libre después de pintar. */
export const usePrecargarAlPintar = (...precargas: ReadonlyArray<() => void>): void => {
  const precargar = useEffectEvent(() => {
    precargas.forEach((precarga) => {
      try {
        precarga();
      } catch (error) {
        console.error('[precarga] no se pudo precargar:', error);
      }
    });
  });
  useEffect(() => alQuedarLibre(() => precargar()), []);
};

// src/utils/lazyWithRetry.ts
import { lazy, memo, type ComponentType } from 'react';
import { cuandoNoHayaEdiciones } from '../shared/utils/edicionesAbiertas';

type Factory<T extends ComponentType<any>> = () => Promise<{ default: T }>;

/**
 * Igual que React.lazy, pero tolerante a redeploys.
 *
 * Problema que resuelve:
 *   Tras un nuevo build, los chunks cambian de hash
 *   (RemolquesDashboard-OLD.js → RemolquesDashboard-NEW.js). Si el
 *   navegador tiene en caché el index.html viejo, intenta importar el
 *   hash viejo, que ya no existe; Cloudflare devuelve index.html
 *   (text/html) y el navegador lanza:
 *     "Failed to fetch dynamically imported module"
 *     "Expected a JavaScript module but server responded with text/html"
 *
 * Solución:
 *   Si la importación falla, recargamos la página UNA sola vez para
 *   obtener el index.html nuevo (con los hashes correctos). Usamos una
 *   bandera en sessionStorage para no caer en un bucle de recargas: si
 *   tras recargar vuelve a fallar, dejamos propagar el error real.
 */
// ✅ V00438 (Fase 2.1): el componente perezoso va envuelto en memo. App.tsx
//   re-renderiza seguido (notificaciones, roles, menú) y los módulos que
//   MantenerVivo deja montados se re-renderizaban todos con cada render. Sin
//   props (o con props primitivas) memo los salta.
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: Factory<T>,
  nombreChunk?: string
) {
  return memo(lazy(async () => {
    const clave = `lazyReload:${nombreChunk || factory.toString().slice(0, 80)}`;

    try {
      const modulo = await factory();
      // Importó bien → limpiamos la bandera para futuros redeploys.
      try { window.sessionStorage.removeItem(clave); } catch { /* noop */ }
      return modulo;
    } catch (error) {
      let yaRecargo = false;
      try { yaRecargo = window.sessionStorage.getItem(clave) === '1'; } catch { /* noop */ }

      if (!yaRecargo) {
        try { window.sessionStorage.setItem(clave, '1'); } catch { /* noop */ }
        // Recarga forzada: trae el index.html y los assets nuevos.
        // ✅ V00438: si hay un formulario abierto, espera a que se cierre.
        cuandoNoHayaEdiciones(() => window.location.reload());
        // Promesa que nunca resuelve: la página se está recargando.
        return new Promise<{ default: T }>(() => { /* never resolves */ });
      }

      // Segundo intento también falló → error real (evitamos bucle infinito).
      throw error;
    }
  }));
}
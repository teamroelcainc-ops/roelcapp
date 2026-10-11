// src/utils/moduloVivoContexto.ts
// ✅ V00264: contexto del keep-alive en archivo propio (regla de Fast Refresh:
//   los archivos de componentes solo exportan componentes).
import { createContext, useContext } from 'react';

/** true = el módulo envuelto es el que se ve en pantalla ahora mismo. */
export const ContextoModuloVivoActivo = createContext(true);
export const useModuloVivoActivo = (): boolean => useContext(ContextoModuloVivoActivo);

/**
 * ✅ V00446: true mientras el módulo se ve y hasta MINUTOS_GRACIA_ESCUCHA después de
 * ocultarse. Para los listeners de los módulos: ir a otro módulo y volver pronto ya no
 * cierra y reabre la escucha (antes cada regreso volvía a cargar y repintar todo).
 * Para "¿es el módulo que se ve?" (buscador global, avisos) usa useModuloVivoActivo.
 */
// ✅ V00447: 10 → 30 min. Un listener cerrado y reabierto antes de 30 min más solo cobra
//   los cambios (token de reanudación de Firestore); así ir y volver en la misma hora no
//   vuelve a bajar el módulo completo.
export const MINUTOS_GRACIA_ESCUCHA = 30;
export const ContextoModuloEscuchando = createContext(true);
export const useModuloEscuchando = (): boolean => useContext(ContextoModuloEscuchando);


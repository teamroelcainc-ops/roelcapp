// src/utils/moduloVivoContexto.ts
// ✅ V00264: contexto del keep-alive en archivo propio (regla de Fast Refresh:
//   los archivos de componentes solo exportan componentes).
import { createContext, useContext } from 'react';

/** true = el módulo envuelto es el que se ve en pantalla ahora mismo. */
export const ContextoModuloVivoActivo = createContext(true);
export const useModuloVivoActivo = (): boolean => useContext(ContextoModuloVivoActivo);

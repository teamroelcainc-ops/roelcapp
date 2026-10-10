// src/features/operaciones/hooks/useHandlerEstable.ts
// ---------------------------------------------------------------------------
// ✅ V00438 (Fase 2.3b): handler con identidad ESTABLE que siempre ejecuta la
//   versión más reciente de `fn`. Sirve para pasar callbacks a un hijo
//   memoizado (memo(FormularioOperacion)) cuando el handler usa funciones del
//   módulo que se recrean en cada render (descargarOperaciones, etc.): con
//   useCallback habría que estabilizar toda esa cadena.
//   Solo para eventos/efectos: NO llamarlo durante el render.
// ---------------------------------------------------------------------------
import { useCallback, useLayoutEffect, useRef } from 'react';

export function useHandlerEstable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: A) => ref.current(...args), []);
}

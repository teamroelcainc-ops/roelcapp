// src/utils/busquedaGlobal.ts
// ---------------------------------------------------------------------------
// ✅ V00263: BUSCADOR GLOBAL del topbar — "filtrar la página en la que estoy".
//   El input del header EMITE el texto y el módulo activo se registra como
//   RECEPTOR con el hook useBusquedaGlobal, conectándolo a su propio buscador.
//   Si el módulo montado no tiene búsqueda, no hay receptor y el campo del
//   header se deshabilita solo — así no rompe nada del diseño ni del flujo.
//   Al cambiar de módulo, el receptor anterior se da de baja y el header
//   limpia el texto.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from 'react';

type Receptor = { fn: (texto: string) => void; etiqueta: string };

let receptorActual: Receptor | null = null;
const oyentesEstado = new Set<() => void>();

const avisar = () => { oyentesEstado.forEach((f) => { try { f(); } catch { /* oyente caído */ } }); };

/** Registra el receptor del módulo activo. Devuelve la función para darse de baja. */
export const registrarReceptorBusqueda = (fn: (texto: string) => void, etiqueta: string): (() => void) => {
  const r: Receptor = { fn, etiqueta };
  receptorActual = r;
  avisar();
  return () => {
    if (receptorActual === r) { receptorActual = null; avisar(); }
  };
};

/** ¿El módulo activo acepta búsqueda? (habilita/deshabilita el input del header) */
export const hayReceptorBusqueda = (): boolean => receptorActual !== null;

/** Qué se busca en el módulo activo (para el placeholder del header). */
export const etiquetaReceptorBusqueda = (): string => receptorActual?.etiqueta || '';

/** El header manda el texto al módulo activo. */
export const emitirBusquedaGlobal = (texto: string): void => {
  if (receptorActual) { try { receptorActual.fn(texto); } catch (e) { console.warn('El receptor de búsqueda falló:', e); } }
};

/** El header se suscribe para saber cuándo cambia el receptor (módulo). */
export const suscribirReceptorBusqueda = (f: () => void): (() => void) => {
  oyentesEstado.add(f);
  return () => { oyentesEstado.delete(f); };
};

/** Hook para los dashboards: conecta el buscador global a su búsqueda local.
 *  Uso: useBusquedaGlobal((t) => setTextoBuscar(t), 'facturas'); */
export const useBusquedaGlobal = (onTexto: (texto: string) => void, etiqueta: string): void => {
  const ref = useRef(onTexto);
  useEffect(() => { ref.current = onTexto; }); // siempre la versión más reciente
  useEffect(() => registrarReceptorBusqueda((t) => ref.current(t), etiqueta), [etiqueta]);
};

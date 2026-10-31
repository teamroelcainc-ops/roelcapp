// src/shared/hooks/useFichaViva.ts
// ---------------------------------------------------------------------------
// ✅ V00536 — FICHA QUE SIGUE A SU LISTA. Antes cada ficha (Facturación, Pagos, Operaciones) era una
// copia guardada en useState al abrirla: si la lista cambiaba (el listener de facturas, un aviso del
// bus), la ficha abierta seguía mostrando lo de antes hasta cerrarla.
//
// Ahora la ficha se vuelve a buscar en su lista (`buscar`, por id) y, cuando la fila de la lista cambia,
// se muestra la fila (sobre la copia, que conserva lo que solo tiene la ficha). Mientras la fila no
// cambie, se ve lo último que se puso con `setFicha`: las pantallas lo usan para mostrar al instante
// lo que acaban de guardar. Mismo API que useState: `setFicha(x)` o `setFicha((actual) => …)`.
//
// `buscar` debe ser estable (useCallback) y cambiar cuando cambie la lista en la que busca.
// ---------------------------------------------------------------------------
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

interface EstadoFicha<T> {
  /** Lo último que se puso con setFicha. */
  ficha: T | null;
  /** La fila de la lista en ese momento (para saber si cambió después). */
  base: T | null | undefined;
}

/** Lo que se muestra: la fila de la lista si cambió desde el último setFicha, si no la copia. */
export const fichaActual = <T extends object>(estado: EstadoFicha<T>, buscar: (ficha: T) => T | null | undefined): T | null => {
  if (!estado.ficha) return null;
  const fila = buscar(estado.ficha);
  return fila && fila !== estado.base ? { ...estado.ficha, ...fila } : estado.ficha;
};

export const useFichaViva = <T extends object>(buscar: (ficha: T) => T | null | undefined): [T | null, Dispatch<SetStateAction<T | null>>] => {
  const [estado, setEstado] = useState<EstadoFicha<T>>({ ficha: null, base: null });
  const buscarRef = useRef(buscar);
  useLayoutEffect(() => { buscarRef.current = buscar; });
  const ficha = useMemo(() => fichaActual(estado, buscar), [estado, buscar]);
  const setFicha = useCallback<Dispatch<SetStateAction<T | null>>>((valor) => {
    setEstado((prev) => {
      const actual = fichaActual(prev, buscarRef.current);
      const nueva = typeof valor === 'function' ? (valor as (x: T | null) => T | null)(actual) : valor;
      if (nueva === actual && nueva === prev.ficha) return prev;
      return { ficha: nueva, base: nueva ? buscarRef.current(nueva) : null };
    });
  }, []);
  return [ficha, setFicha];
};

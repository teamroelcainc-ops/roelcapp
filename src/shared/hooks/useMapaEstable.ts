// src/shared/hooks/useMapaEstable.ts
// ---------------------------------------------------------------------------
// ✅ V00447 — Mismo OBJETO mientras el CONTENIDO del mapa no cambie.
// Los catálogos llegan en vivo: cuando cambia un remolque, una unidad o un
// empleado en algo que no es su nombre (status, kilometraje…), el mapa id → nombre
// se vuelve a armar igual. Con este hook los cálculos pesados que dependen del mapa
// (Facturación: ordenar y filtrar hasta 20 mil operaciones) no se repiten.
// Patrón de React "guardar información de renders anteriores" (setState en render).
// ---------------------------------------------------------------------------
import { useState } from 'react';

type Mapa = Readonly<Record<string, string>>;

export const mismoContenido = (a: Mapa, b: Mapa): boolean => {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
};

export function useMapaEstable<M extends Mapa>(mapa: M): M {
  const [estable, setEstable] = useState(mapa);
  const igual = mismoContenido(estable, mapa);
  if (!igual) setEstable(mapa);
  return igual ? estable : mapa;
}

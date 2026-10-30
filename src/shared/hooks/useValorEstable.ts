// src/shared/hooks/useValorEstable.ts
// ---------------------------------------------------------------------------
// ✅ V00529 — El mismo OBJETO mientras su CONTENIDO no cambie (según `igual`). Como useMapaEstable
// (V00447), pero para cualquier valor: p. ej. el índice operación → factura de Facturación, que se
// vuelve a armar con CADA cambio de una factura aunque sus operaciones sigan igual, y obligaba a
// repetir los cálculos pesados que dependen de él (revisión de Ref Cliente, cotejo de CFDI) al
// presionar Actualizar factura. Patrón de React "guardar información de renders anteriores".
// ---------------------------------------------------------------------------
import { useState } from 'react';

export function useValorEstable<T>(valor: T, igual: (a: T, b: T) => boolean): T {
  const [estable, setEstable] = useState(valor);
  const mismo = estable === valor || igual(estable, valor);
  if (!mismo) setEstable(valor);
  return mismo ? estable : valor;
}

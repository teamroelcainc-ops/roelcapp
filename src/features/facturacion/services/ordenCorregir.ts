// src/features/facturacion/services/ordenCorregir.ts
// ---------------------------------------------------------------------------
// ✅ V00530 — Ordenar la tabla de Corregir por columna: un clic, ascendente; otro, descendente; otro,
// como estaba (el orden de la revisión: las más nuevas primero). Lógica pura, sin React.
// ---------------------------------------------------------------------------
import type { MotivoCuadre } from './cuadreFactura';

export type ColumnaCorregir = 'invoice' | 'fecha' | 'cliente' | 'moneda' | 'referencias' | 'suma' | 'total' | 'diferencia' | 'motivo';
export interface OrdenCorregir { col: ColumnaCorregir; dir: 'asc' | 'desc' }

/** Lo que el orden necesita de cada fila (FilaCorregirVista lo cumple). */
export interface FilaOrdenable {
  invoice: string;
  fecha: string;
  cliente: string;
  moneda: string;
  refs: readonly { ref: string }[];
  cuadre: { suma: number; total: number; diferencia: number; motivo: MotivoCuadre };
}

/** El orden después de un clic en la columna: ascendente → descendente → como estaba (null). */
export const siguienteOrden = (actual: OrdenCorregir | null, col: ColumnaCorregir): OrdenCorregir | null => {
  if (!actual || actual.col !== col) return { col, dir: 'asc' };
  return actual.dir === 'asc' ? { col, dir: 'desc' } : null;
};

const texto = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

const valor = (f: FilaOrdenable, col: ColumnaCorregir, textoMotivo: (m: MotivoCuadre) => string): string | number => {
  switch (col) {
    case 'invoice': return f.invoice;
    case 'fecha': return f.fecha;
    case 'cliente': return f.cliente;
    case 'moneda': return f.moneda;
    case 'referencias': return f.refs[0]?.ref ?? '';
    case 'suma': return f.cuadre.suma;
    case 'total': return f.cuadre.total;
    case 'diferencia': return f.cuadre.diferencia;
    case 'motivo': return textoMotivo(f.cuadre.motivo);
  }
};

/** Las filas en ese orden (null = como llegaron). Los vacíos van al final en los dos sentidos; empate → como llegaron. */
export const ordenarFilasCorregir = <T extends FilaOrdenable>(filas: readonly T[], orden: OrdenCorregir | null, textoMotivo: (m: MotivoCuadre) => string): T[] => {
  if (!orden) return [...filas];
  const signo = orden.dir === 'asc' ? 1 : -1;
  return filas
    .map((f, i) => ({ f, i, v: valor(f, orden.col, textoMotivo) }))
    .sort((a, b) => {
      const vacioA = a.v === '';
      const vacioB = b.v === '';
      if (vacioA !== vacioB) return vacioA ? 1 : -1;
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : texto.compare(String(a.v), String(b.v));
      return c !== 0 ? c * signo : a.i - b.i;
    })
    .map((x) => x.f);
};

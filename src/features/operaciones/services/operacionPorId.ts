// src/features/operaciones/services/operacionPorId.ts
// ✅ V00502 — una operación por su id, lista para la FICHA (buscador global → Activas, Completadas,
// Canceladas): { id, ...datos } como en las listas (un `id` guardado gana) + `_docId` con el id REAL,
// enumerable para que no se pierda al copiar el objeto. null si ya no existe.
import { idReal } from '../../../shared/data/coleccionesVivas';
import { porIds } from '../../../shared/data/consultas';
import { avisar } from '../../../shared/data/avisos';

export type OperacionLeida = Record<string, unknown> & { id: string; _docId: string };

export async function operacionPorId(id: string): Promise<OperacionLeida | null> {
  const [d] = await porIds('operaciones', [id]);
  return d ? { ...d, _docId: idReal(d) } : null;
}

/** Lee la operación y se la da a `abrir`; si no existe o falla, avisa (sin abrir nada). */
export const abrirOperacionPorId = (id: string, abrir: (op: OperacionLeida) => void): void => {
  operacionPorId(id)
    .then((op) => {
      if (op) abrir(op);
      else avisar({ titulo: 'Operación no encontrada', texto: 'La operación ya no existe (pudo eliminarse).', tipo: 'alerta' });
    })
    .catch((e: unknown) => {
      console.error('No se pudo abrir la operación:', e);
      avisar({ titulo: 'No se pudo abrir la operación', texto: String((e as Error)?.message || e), tipo: 'alerta' });
    });
};

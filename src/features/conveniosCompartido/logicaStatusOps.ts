// src/features/conveniosCompartido/logicaStatusOps.ts
// ✅ V00429 — lógica del status de las operaciones (nombres del catálogo,
//   familia de color y conteo por status). Los componentes viven en
//   StatusOperaciones.tsx.
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';

export interface OpConStatus {
  id?: string;
  ref: string;
  fecha?: string;
  statusNombre: string;
  tipo?: string;
  monto?: string;
}

let cacheStatus: Promise<Map<string, string>> | null = null;
/** id → nombre del catálogo de status (se lee una sola vez por sesión). */
export const cargarNombresStatus = (): Promise<Map<string, string>> => {
  if (!cacheStatus) {
    cacheStatus = getDocs(collection(db, 'catalogo_status_servicio'))
      .then((snap) => new Map(snap.docs.map((d) => [d.id, String((d.data() as Record<string, unknown>).nombre || d.id)])))
      .catch(() => { cacheStatus = null; return new Map<string, string>(); });
  }
  return cacheStatus;
};

/** Nombre legible del status de una operación. */
export const nombreStatusOp = (op: Record<string, unknown>, mapa: Map<string, string>): string => {
  const crudo = String(op.status ?? op.estatus ?? '').trim();
  return (crudo && mapa.get(crudo)) || String(op.statusNombre || '').trim() || crudo || 'Sin status';
};

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Familia de color del status (estado finito → clase modificadora). */
export const familiaStatus = (nombre: string): 'completado' | 'cancelado' | 'falso' | 'curso' | 'sin' => {
  const n = sinAcentos(nombre);
  if (!n || n === 'sin status') return 'sin';
  if (n.includes('cancel')) return 'cancelado';
  if (n.includes('falso')) return 'falso';
  if (n.includes('complet') || n.includes('finaliz') || n.includes('entregad')) return 'completado';
  return 'curso';
};

/** Agrupa por nombre de status, ordenado de más a menos operaciones. */
export const conteoPorStatus = (ops: OpConStatus[]): { nombre: string; n: number }[] => {
  const m = new Map<string, number>();
  ops.forEach((o) => m.set(o.statusNombre || 'Sin status', (m.get(o.statusNombre || 'Sin status') || 0) + 1));
  return Array.from(m.entries()).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'));
};

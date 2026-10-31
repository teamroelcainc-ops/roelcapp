// @vitest-environment jsdom
// ✅ V00536 — Editar factura (camino sin servidor): el folio nuevo llega a sus operaciones.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const escrito = vi.hoisted(() => ({ updates: [] as [string, Record<string, unknown>][], commits: 0 }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  writeBatch: () => ({ update: (ref: string, datos: Record<string, unknown>) => escrito.updates.push([ref, datos]), commit: async () => { escrito.commits += 1; } }),
}));
vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../shared/data/consultas', () => ({
  porIds: vi.fn(async (_col: string, ids: readonly string[]) => ids.map((id) => {
    const d = { id, facturaClienteId: id === 'o3' ? 'OTRA' : 'F1', facturaClienteInvoice: id === 'o2' ? 'A-2' : 'A-1' };
    Object.defineProperty(d, '_docId', { value: id, enumerable: false });
    return d;
  })),
}));

import { escribirFolioEnOperaciones } from './folioEnOperaciones';
import { suscribirOperacionGuardada } from '../../../utils/operacionesBus';

describe('escribirFolioEnOperaciones', () => {
  beforeEach(() => { escrito.updates = []; escrito.commits = 0; });
  it('escribe el folio en las ligadas que lo tienen distinto y avisa al bus', async () => {
    const avisos: string[] = [];
    const baja = suscribirOperacionGuardada((d) => avisos.push(`${d.id}:${String(d.data.facturaClienteInvoice)}`));
    const n = await escribirFolioEnOperaciones('cliente', 'A-2', [{ id: 'F1', datos: { operacionesIds: ['o1', 'o2', 'o3'] } }]);
    baja();
    expect(n).toBe(1);
    expect(escrito.updates).toEqual([['operaciones/o1', { facturaClienteInvoice: 'A-2' }]]);
    expect(escrito.commits).toBe(1);
    expect(avisos).toEqual(['o1:A-2']);
  });
  it('sin operaciones no lee ni escribe', async () => {
    expect(await escribirFolioEnOperaciones('cliente', 'A-2', [{ id: 'F1', datos: {} }])).toBe(0);
    expect(escrito.commits).toBe(0);
  });
});

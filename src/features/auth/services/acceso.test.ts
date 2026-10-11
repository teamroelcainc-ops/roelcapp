// ✅ V00447 — revisión de la red de la oficina desde la caché local (arranque sin esperas).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const guardados: Record<string, { nombre: string; requiereIPOficina?: boolean }[]> = {};
vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, col: string) => ({ col }),
  where: (_c: string, _op: string, valores: string[]) => ({ valores }),
  query: (ref: { col: string }, w: { valores: string[] }) => ({ col: ref.col, valores: w.valores }),
  getDocsFromCache: async (q: { col: string; valores: string[] }) => {
    const docs = (guardados[q.col] ?? []).filter((r) => q.valores.includes(r.nombre))
      .map((r) => ({ get: (k: string) => (r as Record<string, unknown>)[k] }));
    return { docs, empty: docs.length === 0 };
  },
  getDocs: async () => ({ docs: [], empty: true }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  doc: () => ({}),
}));

const { claveRevisionRed, redLibreSegunCache } = await import('./acceso');

beforeEach(() => {
  guardados.roles = [{ nombre: 'Operaciones' }, { nombre: 'Caseta', requiereIPOficina: true }];
  guardados.catalogo_roles = [];
});

describe('redLibreSegunCache', () => {
  it('libre si la caché conoce todos los roles y ninguno exige la oficina', async () => {
    expect(await redLibreSegunCache({ roles: ['Operaciones'] })).toBe(true);
    expect(await redLibreSegunCache({ roles: [] })).toBe(true);
  });
  it('no libre si algún rol exige la oficina', async () => {
    expect(await redLibreSegunCache({ roles: ['Operaciones', 'Caseta'] })).toBe(false);
  });
  it('no libre si la caché no conoce alguno de los roles (rol nuevo o primera vez)', async () => {
    expect(await redLibreSegunCache({ roles: ['Operaciones', 'Rol Nuevo'] })).toBe(false);
  });
  it('la clave de la revisión cambia si cambian los roles', () => {
    expect(claveRevisionRed('u1', { roles: ['B', 'A'] })).toBe(claveRevisionRed('u1', { roles: ['A', 'B'] }));
    expect(claveRevisionRed('u1', { roles: ['A'] })).not.toBe(claveRevisionRed('u1', { roles: ['A', 'Caseta'] }));
  });
});

// @vitest-environment jsdom
// ✅ V00539 — D2 se renumera con el máximo real de su línea; F3 relee antes de escribir.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bd = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), escritos: [] as [string, Record<string, unknown>][] }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  collection: (_db: unknown, col: string) => col,
  where: (campo: string, op: string, valor: string) => ({ campo, op, valor }),
  query: (col: string, ...filtros: { campo: string; op: string; valor: string }[]) => ({ col, filtros }),
  getDocs: async (q: { col: string; filtros: { campo: string; op: string; valor: string }[] }) => ({
    docs: Array.from(bd.docs.entries()).filter(([k, d]) => k.startsWith(`${q.col}/`) && q.filtros.every((f) => {
      const v = String(d[f.campo] ?? '');
      return f.op === '==' ? v === f.valor : f.op === '>=' ? v >= f.valor : v <= f.valor;
    })).map(([, d]) => ({ data: () => d })),
  }),
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    get: async (ref: string) => ({ exists: () => bd.docs.has(ref), data: () => bd.docs.get(ref) }),
    update: (ref: string, datos: Record<string, unknown>) => { bd.escritos.push([ref, datos]); },
    set: (ref: string, datos: Record<string, unknown>) => { bd.escritos.push([ref, datos]); },
  }),
}));
vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../utils/logger', () => ({ registrarLog: vi.fn(async () => {}) }));

import { aplicarCorregirF3, aplicarRenumerarD2 } from './correccionesD2F3Datos';
import type { PlanD2, PlanF3 } from './revisionDatos';

const d2 = (opId: string, motivo = ''): PlanD2 => ({ opId, ref: 'TR-270426-022', cliente: 'C', fecha: '', seQueda: '', prefijo: 'TR', ddmmyy: '270426', motivo });

describe('correccionesD2F3Datos', () => {
  beforeEach(() => {
    bd.escritos = [];
    bd.docs = new Map<string, Record<string, unknown>>([
      ['operaciones/a', { ref: 'TR-270426-022', refPrefijo: 'TR-270426', refConsecutivo: 22 }],
      ['operaciones/b', { ref: 'TR-270426-022' }],
      ['operaciones/c', { ref: 'TR-270426-030' }],
      ['operaciones/o1', { facturaClienteInvoice: 'I-1' }],
      ['operaciones/o2', { facturaClienteInvoice: 'Z' }],
      ['facturas_clientes/F1', { invoice: 'I1', operacionesIds: ['o1'] }],
      ['counters/operaciones_TR_270426', { count: 25 }],
    ]);
  });
  it('D2: el consecutivo es el máximo real de la línea + 1 (aunque el contador diga menos); las de motivo no se tocan', async () => {
    const r = await aplicarRenumerarD2([d2('b'), d2('x', 'a mano')], 'AHORA', () => {});
    expect(r).toMatchObject({ hechas: 1, error: '' });
    expect(bd.escritos[0]).toEqual(['operaciones/b', expect.objectContaining({ ref: 'TR-270426-031', refConsecutivo: 31, refAnterior: 'TR-270426-022' })]);
    expect(bd.escritos[1]).toEqual(['counters/operaciones_TR_270426', expect.objectContaining({ count: 31 })]);
  });
  it('D2: si su referencia cambió desde la prueba, no se toca', async () => {
    bd.docs.set('operaciones/b', { ref: 'TR-270426-040' });
    const r = await aplicarRenumerarD2([d2('b')], 'AHORA', () => {});
    expect(r.hechas).toBe(0);
    expect(r.omitidas[0].motivo).toMatch(/cambió/);
    expect(bd.escritos).toEqual([]);
  });
  it('F3: liga a la factura que la lista y libera la que ninguna lista', async () => {
    const plan = (opId: string, invoice: string, accion: PlanF3['accion']): PlanF3 => ({ opId, ref: opId, cliente: '', invoice, accion, facturaId: 'F1', folio: 'I1', motivo: '', facturaIdAntes: '', facturadoAntes: false });
    const r = await aplicarCorregirF3([plan('o1', 'I-1', 'ligar'), plan('o2', 'Z', 'liberar')], 'AHORA', () => {});
    expect(r.hechas).toBe(2);
    expect(bd.escritos).toEqual([
      ['operaciones/o1', expect.objectContaining({ facturaClienteInvoice: 'I1', facturado: true })],
      ['operaciones/o2', expect.objectContaining({ facturaClienteInvoice: '', facturado: false })],
    ]);
  });
});

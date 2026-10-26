// ✅ V00451 — antes de facturar se pregunta al servidor (operaciones ya facturadas, factura existente).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Doc = { id: string; data: Record<string, unknown> };
const operaciones: Doc[] = [];
const facturas: Doc[] = [];
vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, nombre: string) => ({ nombre }),
  documentId: () => '__id__',
  where: (campo: string, op: string, valor: unknown) => ({ campo, op, valor }),
  query: (c: { nombre: string }, w: { campo: string; op: string; valor: unknown }) => ({ ...c, ...w }),
  getDocs: async (q: { nombre: string; campo: string; op: string; valor: unknown[] }) => {
    const fuente = q.nombre === 'operaciones' ? operaciones : facturas;
    const vals = q.valor as unknown[];
    const ds = fuente.filter((d) => {
      if (q.campo === '__id__') return vals.includes(d.id);
      if (q.op === 'array-contains-any') return (d.data[q.campo] as unknown[] ?? []).some((x) => vals.includes(x));
      return vals.includes(d.data[q.campo]);
    });
    return { docs: ds.map((d) => ({ id: d.id, data: () => d.data })) };
  },
}));

import { decidirLiberacion, facturaDeOperacion, facturaExistenteFresca, operacionesYaFacturadas, planLiberarAlEliminar, variantesFolio } from './facturarSeguro';

beforeEach(() => { operaciones.length = 0; facturas.length = 0; });

describe('facturaDeOperacion', () => {
  it('cliente y proveedor', () => {
    expect(facturaDeOperacion('cliente', { facturaClienteId: 'F1', facturaClienteInvoice: 'A-1' })).toEqual({ facturaId: 'F1', folio: 'A-1', marcada: true });
    expect(facturaDeOperacion('cliente', { facturado: false, facturaClienteId: null }).marcada).toBe(false);
    expect(facturaDeOperacion('cliente', { facturado: true }).marcada).toBe(true);
    expect(facturaDeOperacion('proveedor', { facturaProveedorFolio: 'P-9' }).marcada).toBe(true);
    expect(facturaDeOperacion('proveedor', { facturaClienteId: 'F1' }).marcada).toBe(false);
  });
});

describe('operacionesYaFacturadas', () => {
  const op = (id: string) => ({ idLista: id, idReal: id, ref: `LO-${id}` });
  it('por los campos de la operación en el servidor', async () => {
    operaciones.push({ id: 'a', data: { facturaClienteId: 'F1', facturaClienteInvoice: 'INV-1' } }, { id: 'b', data: {} });
    const r = await operacionesYaFacturadas('cliente', [op('a'), op('b')]);
    expect(r).toEqual([{ idLista: 'a', ref: 'LO-a', folio: 'INV-1', facturaId: 'F1' }]);
  });
  it('por una factura que la tiene en operacionesIds aunque la operación perdió sus campos', async () => {
    operaciones.push({ id: 'a', data: { facturado: false } });
    facturas.push({ id: 'F7', data: { invoice: 'INV-7', operacionesIds: ['x', 'a'] } });
    const r = await operacionesYaFacturadas('cliente', [op('a')]);
    expect(r[0]).toMatchObject({ idLista: 'a', facturaId: 'F7', folio: 'INV-7' });
  });
  it('agregar a la MISMA factura existente no cuenta', async () => {
    operaciones.push({ id: 'a', data: { facturaClienteId: 'F1' } });
    facturas.push({ id: 'F1', data: { invoice: 'INV-1', operacionesIds: ['a'] } });
    expect(await operacionesYaFacturadas('cliente', [op('a')], 'F1')).toEqual([]);
  });
});

describe('facturaExistenteFresca', () => {
  it('encuentra el folio sin importar mayúsculas y solo de esa empresa (la más antigua)', async () => {
    facturas.push({ id: 'F2', data: { invoice: 'inv-5', clienteId: 'C1', createdAt: '2026-10-02' } });
    facturas.push({ id: 'F1', data: { invoice: 'INV-5', clienteId: 'C1', createdAt: '2026-10-01' } });
    facturas.push({ id: 'F3', data: { invoice: 'INV-5', clienteId: 'OTRO' } });
    expect((await facturaExistenteFresca('cliente', ' INV-5 ', 'C1'))?.id).toBe('F1');
    expect(await facturaExistenteFresca('cliente', 'INV-9', 'C1')).toBeNull();
  });
});

describe('variantesFolio', () => {
  it('captura, sin espacios, con espacio al final, mayúsculas, minúsculas y Primera mayúscula', () => {
    expect(variantesFolio(' inv-srv-2 ')).toEqual([' inv-srv-2 ', 'inv-srv-2', 'inv-srv-2 ', 'INV-SRV-2', 'Inv-srv-2', 'Inv-Srv-2', 'INV-SRV-2 ']);
    expect(variantesFolio('INV-SRV-2')).toContain('Inv-Srv-2');
  });
  it('un número sin ceros a la izquierda también como número', () => {
    expect(variantesFolio('4521')).toContain(4521);
    expect(variantesFolio('04521')).not.toContain(4521);
  });
  it('nunca pasa de 30 (tope de `in`)', () => {
    expect(variantesFolio('Ab Cd').length).toBeLessThanOrEqual(30);
    expect(variantesFolio('   ')).toEqual([]);
  });
});

// ✅ V00494: borrar una factura no "desfactura" operaciones que siguen en otra.
describe('decidirLiberacion / planLiberarAlEliminar', () => {
  const op = (id: string, datos: Record<string, unknown> | null) => ({ idLista: id, idReal: id, datos });
  const borradas = new Set(['B']);
  it('libera la que apunta a la borrada y no está en otra', () => {
    expect(decidirLiberacion('cliente', [op('a', { facturaClienteId: 'B', facturado: true })], borradas, [])).toEqual([{ idLista: 'a', idReal: 'a', accion: 'liberar' }]);
  });
  it('si sigue en otra factura (la buena), se liga a esa en vez de liberarla', () => {
    const otras = [{ id: 'A', invoice: 'INV-1', operacionesIds: ['a'] }];
    expect(decidirLiberacion('cliente', [op('a', { facturaClienteId: 'B' })], borradas, otras)).toEqual([{ idLista: 'a', idReal: 'a', accion: 'ligar', facturaId: 'A', folio: 'INV-1' }]);
    expect(decidirLiberacion('cliente', [op('a', { facturaClienteId: 'A' })], borradas, otras)).toEqual([{ idLista: 'a', idReal: 'a', accion: 'dejar' }]);
  });
  it('apunta a otra factura viva: no se toca; operación borrada: nada', () => {
    expect(decidirLiberacion('cliente', [op('a', { facturaClienteId: 'Z' }), op('b', null)], borradas, [])).toEqual([{ idLista: 'a', idReal: 'a', accion: 'dejar' }]);
  });
  it('prefiere una no cancelada', () => {
    const otras = [{ id: 'C', invoice: 'X', statusFactura: 'Cancelado', operacionesIds: ['a'] }, { id: 'D', invoice: 'Y', operacionesIds: ['a'] }];
    expect(decidirLiberacion('proveedor', [op('a', {})], borradas, otras)[0]).toMatchObject({ accion: 'ligar', facturaId: 'D' });
  });
  it('busca en el servidor y en la lista cargada (importadas con operacionesIds en texto ya normalizadas)', async () => {
    operaciones.push({ id: 'a', data: { facturaClienteId: 'B' } }, { id: 'b', data: { facturaClienteId: 'B' } }, { id: 'c', data: {} });
    facturas.push({ id: 'B', data: { invoice: 'DUP', operacionesIds: ['a', 'b', 'c'] } }, { id: 'A', data: { invoice: 'INV-1', operacionesIds: ['a'] } });
    const cargadas = [{ id: 'IMP', invoice: 'VIEJA', operacionesIds: ['b'] }];
    const r = await planLiberarAlEliminar('cliente', [{ idLista: 'a', idReal: 'a' }, { idLista: 'b', idReal: 'b' }, { idLista: 'c', idReal: 'c' }], borradas, cargadas);
    expect(r).toEqual([
      { idLista: 'a', idReal: 'a', accion: 'ligar', facturaId: 'A', folio: 'INV-1' },
      { idLista: 'b', idReal: 'b', accion: 'ligar', facturaId: 'IMP', folio: 'VIEJA' },
      { idLista: 'c', idReal: 'c', accion: 'liberar' },
    ]);
  });
});

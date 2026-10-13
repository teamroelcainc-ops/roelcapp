// ✅ V00450 — REF CLIENTE: lo consultado se corrige al guardar/cancelar en la sesión, las consultas
//   en camino se comparten, y "No es duplicado" informa las que no se pudieron marcar.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const docs: { id: string; data: Record<string, unknown> }[] = [];
const consultas: unknown[][] = [];
const falla = new Set<string>();
vi.mock('../../../config/firebase', () => ({ db: {}, auth: { currentUser: { email: 'yo@roelca.com' } } }));
vi.mock('../../../utils/logger', () => ({ registrarLog: vi.fn(async () => undefined) }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: (_c: unknown, w: { valores: unknown[] }) => w,
  where: (_campo: string, _op: string, valores: unknown[]) => ({ valores }),
  doc: (_db: unknown, _col: string, id: string) => ({ id }),
  getDocs: async (q: { valores: unknown[] }) => {
    consultas.push(q.valores);
    const ds = docs.filter((d) => q.valores.includes(d.data.refCliente));
    return { docs: ds.map((d) => ({ id: d.id, data: () => d.data })) };
  },
  updateDoc: async (r: { id: string }) => { if (falla.has(r.id)) throw new Error('sin permiso'); },
}));

import {
  buscarRefCliente, marcarNoDuplicado, olvidarRefsConsultadas, operacionGuardadaEnRefs, quitarOperacionDeRefs,
  resultadosRefCliente, verificarRefsEnServidor,
} from './refClienteDuplicadoServidor';
import { STATUS_CANCELADO } from '../../../shared/dominio/constantes';

const ids = (clave: string) => (resultadosRefCliente().get(clave) ?? []).map((r) => r.id).sort();

beforeEach(() => {
  docs.length = 0; consultas.length = 0; falla.clear();
  olvidarRefsConsultadas();
  docs.push({ id: 'a', data: { ref: 'TR-A', refCliente: 'PO1', status: 'x' } });
  docs.push({ id: 'b', data: { ref: 'TR-B', refCliente: 'po 1', status: 'x' } });
});

describe('servidor de Ref Cliente', () => {
  it('busca las variantes y agrupa por clave', async () => {
    await verificarRefsEnServidor(['po1']);
    expect(ids('PO1')).toEqual(['a', 'b']);
  });
  it('una Ref ya consultada no se vuelve a pedir (5 min) y una en camino se espera', async () => {
    const p1 = verificarRefsEnServidor(['PO1']);
    const p2 = buscarRefCliente('PO1', { id: 'a' });
    await p1;
    expect(await p2).toHaveLength(1);
    await verificarRefsEnServidor(['PO1']);
    expect(consultas).toHaveLength(1);
  });
  it('guardar/cancelar en la sesión corrige lo consultado al momento', async () => {
    await verificarRefsEnServidor(['PO1']);
    operacionGuardadaEnRefs('b', { ref: 'TR-B', refCliente: 'po 1', status: STATUS_CANCELADO });
    expect(ids('PO1')).toEqual(['a']);
    operacionGuardadaEnRefs('c', { ref: 'TR-C', refCliente: 'PO 1', status: 'x' });
    expect(ids('PO1')).toEqual(['a', 'c']);
    operacionGuardadaEnRefs('c', { ref: 'TR-C', refCliente: 'OTRA-9', status: 'x' });
    expect(ids('PO1')).toEqual(['a']);
    operacionGuardadaEnRefs('a', { moneda: 'USD' }); // aviso parcial: no cambia nada
    expect(ids('PO1')).toEqual(['a']);
    quitarOperacionDeRefs('a');
    expect(ids('PO1')).toEqual([]);
  });
  it('el formulario excluye la operación que se edita (por ID; por folio solo si es único)', async () => {
    expect((await buscarRefCliente('PO1', { id: 'a' })).map((r) => r.id)).toEqual(['b']);
    expect((await buscarRefCliente('PO1', { id: 'idViejo', ref: 'TR-A' })).map((r) => r.id)).toEqual(['b']);
    expect((await buscarRefCliente('PO1', {})).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
  it('"No es duplicado" informa las que no se pudieron marcar', async () => {
    await verificarRefsEnServidor(['PO1']);
    falla.add('b');
    const { hechas, fallidas } = await marcarNoDuplicado('PO1', resultadosRefCliente().get('PO1') ?? [], 'Operaciones');
    expect(hechas.map((r) => r.id)).toEqual(['a']);
    expect(fallidas.map((r) => r.id)).toEqual(['b']);
    expect((resultadosRefCliente().get('PO1') ?? []).find((r) => r.id === 'a')?.revisada).toBe(true);
  });
});

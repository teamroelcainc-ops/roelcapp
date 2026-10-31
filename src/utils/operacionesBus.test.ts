// @vitest-environment jsdom
// ✅ V00536 — Bus de operaciones: a quién llega cada aviso y qué hace con cada lista.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardarCacheMemoria, obtenerCacheMemoria } from './cacheMemoria';
import {
  aplicarAvisoEnLista, avisoTraeCampo, CAMPO_ELIMINADA, esDeLosIds, idsDelAviso, notificarCambiosOperacion, notificarOperacionEliminada,
  notificarOperacionesGuardadas, notificarOperacionGuardada, sinIds, suscribirOperacionGuardada,
} from './operacionesBus';
import type { OperacionGuardadaDetalle, ReglaLista } from './operacionesBus';
import { reglaFacturables } from '../features/facturacion/services/reglaFacturables';

type Fila = { id: string; _docId?: string } & Record<string, unknown>;
const aviso = (id: string, data: Record<string, unknown>, campos?: string[]): OperacionGuardadaDetalle => ({ id, data, ...(campos ? { campos } : {}) });
const COMPLETADO = 'c2d57403';
const regla = reglaFacturables([COMPLETADO]);

describe('encontrar la fila del aviso', () => {
  it('por el id del documento o por el `id` guardado (operaciones importadas)', () => {
    const ids = idsDelAviso(aviso('DOC1', { id: 'IMP-7', _docId: 'DOC1' }));
    expect(ids).toEqual(['DOC1', 'IMP-7']);
    expect(esDeLosIds({ id: 'IMP-7' }, ids)).toBe(true);
    expect(esDeLosIds({ id: 'X', _docId: 'DOC1' }, ids)).toBe(true);
    expect(esDeLosIds({ id: 'X', _docId: 'Y' }, ids)).toBe(false);
    expect(esDeLosIds(null, ids)).toBe(false);
  });
  it('avisoTraeCampo: si dice qué cambió, solo cuenta eso', () => {
    expect(avisoTraeCampo(aviso('a', { status: 'x', ref: 'r' }), 'status')).toBe(true);
    expect(avisoTraeCampo(aviso('a', { status: 'x', ref: 'r' }, ['ref']), 'status')).toBe(false);
  });
  it('sinIds quita id y _docId', () => {
    expect(sinIds({ id: 1, _docId: 2, a: 3 })).toEqual({ a: 3 });
  });
});

describe('aplicarAvisoEnLista', () => {
  const lista: Fila[] = [{ id: 'A', _docId: 'A', status: COMPLETADO, monto: 1 }, { id: 'IMP-2', _docId: 'B', status: COMPLETADO, monto: 2 }];
  it('actualiza solo lo que cambió y la fila conserva su id', () => {
    const r = aplicarAvisoEnLista(lista, aviso('B', { id: 'OTRO', monto: 20, viejo: 'no' }, ['monto']), regla);
    expect(r[1]).toEqual({ id: 'IMP-2', _docId: 'B', status: COMPLETADO, monto: 20 });
    expect(r[0]).toBe(lista[0]);
  });
  it('un aviso SIN status no saca la fila (Diferencia en cargos, Sincronizar monedas)', () => {
    const r = aplicarAvisoEnLista(lista, aviso('A', { cargosAdicionales: 5 }, ['cargosAdicionales']), regla);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ cargosAdicionales: 5 });
  });
  it('con status que ya no pertenece, sale; con status que pertenece, se queda', () => {
    expect(aplicarAvisoEnLista(lista, aviso('A', { status: 'activo' }, ['status']), regla).map((o) => o.id)).toEqual(['IMP-2']);
    expect(aplicarAvisoEnLista(lista, aviso('A', { status: COMPLETADO }, ['status']), regla)).toHaveLength(2);
  });
  it('entra una nueva solo con la operación completa y status que pertenece', () => {
    const completa = aplicarAvisoEnLista(lista, aviso('N', { ref: 'TR-1', status: COMPLETADO }, ['status']), regla);
    expect(completa[0]).toEqual({ id: 'N', ref: 'TR-1', status: COMPLETADO, _docId: 'N' });
    expect(aplicarAvisoEnLista(lista, aviso('N', { status: COMPLETADO }, ['status']), regla)).toBe(lista); // solo lo que cambió
    expect(aplicarAvisoEnLista(lista, aviso('N', { ref: 'TR-1', status: 'activo' }), regla)).toBe(lista);
    expect(aplicarAvisoEnLista(lista, aviso('N', { ref: 'TR-1', monto: 3 }), regla)).toBe(lista); // sin status no se decide
  });
  it('sin regla: actualiza y nunca agrega ni saca por status', () => {
    expect(aplicarAvisoEnLista(lista, aviso('A', { status: 'activo' }))[0]).toMatchObject({ status: 'activo' });
    expect(aplicarAvisoEnLista(lista, aviso('N', { ref: 'x', status: COMPLETADO }))).toBe(lista);
  });
  it('regla con `agregar` que dice que no: no entra', () => {
    const r: ReglaLista = { ...regla, agregar: () => false };
    expect(aplicarAvisoEnLista(lista, aviso('N', { ref: 'x', status: COMPLETADO }), r)).toBe(lista);
  });
  it('una eliminada sale de la lista', () => {
    expect(aplicarAvisoEnLista(lista, aviso('B', { [CAMPO_ELIMINADA]: true }, [CAMPO_ELIMINADA])).map((o) => o.id)).toEqual(['A']);
    expect(aplicarAvisoEnLista(lista, aviso('Z', { [CAMPO_ELIMINADA]: true }))).toBe(lista);
  });
});

describe('notificar', () => {
  afterEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it('cada aviso llega a quien escucha, con los campos que cambiaron', () => {
    const recibidos: OperacionGuardadaDetalle[] = [];
    const baja = suscribirOperacionGuardada((d) => recibidos.push(d));
    notificarCambiosOperacion('o1', { sueldoTotal: 5 }, 'nomina');
    notificarOperacionesGuardadas([['o2', { a: 1 }], ['o3', { b: 2 }]], 'lote');
    notificarOperacionEliminada('o4', 'completados');
    baja();
    notificarOperacionGuardada('o5', {}, 'x');
    expect(recibidos.map((d) => [d.id, d.origen, d.campos])).toEqual([
      ['o1', 'nomina', ['sueldoTotal']], ['o2', 'lote', ['a']], ['o3', 'lote', ['b']], ['o4', 'completados', [CAMPO_ELIMINADA]],
    ]);
  });
  it('las operaciones de prueba no llegan', () => {
    const cb = vi.fn();
    const baja = suscribirOperacionGuardada(cb);
    notificarOperacionGuardada('p', { esPrueba: true });
    baja();
    expect(cb).not.toHaveBeenCalled();
  });
  it('invalida las cachés de Completados y Cancelados, pero no los filtros guardados', () => {
    guardarCacheMemoria('roelca_completadas_canon_2026-10-01_2026-10-31', [1]);
    guardarCacheMemoria('cancelados_ops_v1', [1]);
    guardarCacheMemoria('otra_cache', [1]);
    sessionStorage.setItem('roelca_completadas_rango_a_b', '{}');
    localStorage.setItem('roelca_completadas_filtros_v1_u', '{"x":1}');
    notificarOperacionGuardada('o1', { a: 1 });
    expect(obtenerCacheMemoria('roelca_completadas_canon_2026-10-01_2026-10-31', 60000)).toBeNull();
    expect(obtenerCacheMemoria('cancelados_ops_v1', 60000)).toBeNull();
    expect(obtenerCacheMemoria('otra_cache', 60000)).toEqual([1]);
    expect(sessionStorage.getItem('roelca_completadas_rango_a_b')).toBeNull();
    expect(localStorage.getItem('roelca_completadas_filtros_v1_u')).toBe('{"x":1}');
  });
});

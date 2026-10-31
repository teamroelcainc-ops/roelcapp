// @vitest-environment jsdom
// ✅ V00536 — useFichaViva: la ficha abierta sigue a su lista.
import { act, renderHook } from '@testing-library/react';
import { useCallback } from 'react';
import { describe, expect, it } from 'vitest';
import { fichaActual, useFichaViva } from './useFichaViva';

type F = { id: string; monto?: number; nota?: string; soloFicha?: boolean; n?: number };
const useFichaDeLista = (lista: F[]) => {
  const buscar = useCallback((f: F) => lista.find((x) => x.id === f.id), [lista]);
  return useFichaViva<F>(buscar);
};

describe('useFichaViva', () => {
  it('abre, muestra lo último puesto y cierra', () => {
    const lista: F[] = [{ id: 'a', monto: 1 }];
    const { result } = renderHook(({ l }) => useFichaDeLista(l), { initialProps: { l: lista } });
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]({ ...lista[0], soloFicha: true }));
    expect(result.current[0]).toEqual({ id: 'a', monto: 1, soloFicha: true });
    act(() => result.current[1]((prev) => (prev ? { ...prev, nota: 'guardada' } : prev)));
    expect(result.current[0]).toMatchObject({ nota: 'guardada' });
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
  });
  it('cuando su fila de la lista cambia, la ficha la muestra (y conserva lo que solo tiene la ficha)', () => {
    const a: F = { id: 'a', monto: 1 };
    const { result, rerender } = renderHook(({ l }) => useFichaDeLista(l), { initialProps: { l: [a, { id: 'b' }] } });
    act(() => result.current[1]({ ...a, soloFicha: true }));
    rerender({ l: [a, { id: 'b', monto: 9 }] }); // cambia OTRA fila: la ficha sigue igual
    expect(result.current[0]).toEqual({ id: 'a', monto: 1, soloFicha: true });
    rerender({ l: [{ id: 'a', monto: 5 }, { id: 'b', monto: 9 }] });
    expect(result.current[0]).toEqual({ id: 'a', monto: 5, soloFicha: true });
    // Una actualización local se aplica sobre lo más nuevo.
    act(() => result.current[1]((prev) => (prev ? { ...prev, nota: 'x' } : prev)));
    expect(result.current[0]).toEqual({ id: 'a', monto: 5, soloFicha: true, nota: 'x' });
  });
  it('si la fila ya no está en la lista, se queda como estaba', () => {
    const a: F = { id: 'a', monto: 1 };
    const { result, rerender } = renderHook(({ l }) => useFichaDeLista(l), { initialProps: { l: [a] } });
    act(() => result.current[1](a));
    rerender({ l: [] });
    expect(result.current[0]).toEqual(a);
  });
  it('fichaActual (pura)', () => {
    const base: F = { id: 'a', monto: 1 };
    expect(fichaActual({ ficha: null, base: null }, () => base)).toBeNull();
    expect(fichaActual({ ficha: base, base }, () => base)).toBe(base);
    expect(fichaActual<F>({ ficha: { ...base, n: 1 }, base }, () => ({ id: 'a', monto: 2 }))).toEqual({ id: 'a', monto: 2, n: 1 });
  });
});

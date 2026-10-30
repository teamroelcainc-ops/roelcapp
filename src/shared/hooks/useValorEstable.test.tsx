// @vitest-environment jsdom
// ✅ V00529 — useValorEstable: mismo objeto mientras el contenido no cambie.
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useValorEstable } from './useValorEstable';

const igual = (a: Map<string, string>, b: Map<string, string>) => a.size === b.size && Array.from(a).every(([k, v]) => b.get(k) === v);

describe('useValorEstable', () => {
  it('conserva el objeto si el contenido es el mismo y toma el nuevo si cambió', () => {
    const primero = new Map([['a', '1']]);
    const { result, rerender } = renderHook(({ v }) => useValorEstable(v, igual), { initialProps: { v: primero } });
    expect(result.current).toBe(primero);
    rerender({ v: new Map([['a', '1']]) });
    expect(result.current).toBe(primero);
    const otro = new Map([['a', '2']]);
    rerender({ v: otro });
    expect(result.current).toBe(otro);
  });
});

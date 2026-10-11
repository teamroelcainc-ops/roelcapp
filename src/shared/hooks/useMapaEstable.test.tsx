// @vitest-environment jsdom
// ✅ V00447 — useMapaEstable: mismo objeto mientras el contenido no cambie.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { mismoContenido, useMapaEstable } from './useMapaEstable';

describe('useMapaEstable', () => {
  it('conserva el objeto si el contenido es igual y lo cambia si cambia', () => {
    const vistos: Record<string, string>[] = [];
    function Sonda({ mapa }: { mapa: Record<string, string> }) {
      vistos.push(useMapaEstable(mapa));
      return null;
    }
    const { rerender } = render(<Sonda mapa={{ a: 'Uno', b: 'Dos' }} />);
    rerender(<Sonda mapa={{ a: 'Uno', b: 'Dos' }} />);
    expect(vistos.at(-1)).toBe(vistos[0]);
    rerender(<Sonda mapa={{ a: 'Uno', b: 'Tres' }} />);
    expect(vistos.at(-1)).not.toBe(vistos[0]);
    expect(vistos.at(-1)).toEqual({ a: 'Uno', b: 'Tres' });
  });

  it('mismoContenido compara llaves y valores', () => {
    expect(mismoContenido({ a: '1' }, { a: '1' })).toBe(true);
    expect(mismoContenido({ a: '1' }, { a: '1', b: '2' })).toBe(false);
    expect(mismoContenido({ a: '1' }, { a: '2' })).toBe(false);
  });
});

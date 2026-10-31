// @vitest-environment jsdom
// ✅ V00534 — Precarga en segundo plano después de pintar.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { alQuedarLibre, usePrecargarAlPintar } from './usePrecargarAlPintar';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('alQuedarLibre', () => {
  it('sin requestIdleCallback usa un temporizador y se puede cancelar', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const tarea = vi.fn();
    alQuedarLibre(tarea);
    vi.advanceTimersByTime(1500);
    expect(tarea).toHaveBeenCalledTimes(1);
    const otra = vi.fn();
    const cancelar = alQuedarLibre(otra);
    cancelar();
    vi.advanceTimersByTime(5000);
    expect(otra).not.toHaveBeenCalled();
  });
  it('con requestIdleCallback le pasa la espera máxima', () => {
    const ric = vi.fn(() => 7);
    const cic = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    vi.stubGlobal('cancelIdleCallback', cic);
    const cancelar = alQuedarLibre(() => undefined, 1234);
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 1234 });
    cancelar();
    expect(cic).toHaveBeenCalledWith(7);
  });
});

describe('usePrecargarAlPintar', () => {
  const Pantalla = ({ precargas }: { precargas: (() => void)[] }) => {
    usePrecargarAlPintar(...precargas);
    return <p>pantalla</p>;
  };
  it('llama cada precarga una vez después de pintar, aunque la pantalla se repinte', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const a = vi.fn();
    const b = vi.fn(() => { throw new Error('falló'); });
    const c = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender, getByText } = render(<Pantalla precargas={[a, b, c]} />);
    expect(getByText('pantalla')).toBeTruthy();
    expect(a).not.toHaveBeenCalled();
    rerender(<Pantalla precargas={[a, b, c]} />);
    vi.advanceTimersByTime(2000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1); // una precarga que falla no detiene las demás
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

// @vitest-environment jsdom
// ✅ V00446 — MantenerVivo: al ocultar un módulo sus listeners siguen escuchando
//   MINUTOS_GRACIA_ESCUCHA; después se cierran. Al volver antes, nunca se cerraron.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MantenerVivo } from './mantenerVivo';
import { MINUTOS_GRACIA_ESCUCHA, useModuloEscuchando, useModuloVivoActivo } from './moduloVivoContexto';

const vistos: { visible: boolean; escuchando: boolean }[] = [];
function Sonda() {
  vistos.push({ visible: useModuloVivoActivo(), escuchando: useModuloEscuchando() });
  return null;
}

beforeEach(() => { vi.useFakeTimers(); vistos.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('MantenerVivo', () => {
  it('oculto sigue escuchando durante la gracia y luego deja de escuchar', () => {
    const ui = (activo: boolean) => <MantenerVivo activo={activo}><Sonda /></MantenerVivo>;
    const { rerender } = render(ui(true));
    expect(vistos.at(-1)).toEqual({ visible: true, escuchando: true });
    rerender(ui(false));
    expect(vistos.at(-1)).toEqual({ visible: false, escuchando: true });
    act(() => { vi.advanceTimersByTime(MINUTOS_GRACIA_ESCUCHA * 60 * 1000 - 1000); });
    expect(vistos.at(-1)?.escuchando).toBe(true);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(vistos.at(-1)).toEqual({ visible: false, escuchando: false });
    rerender(ui(true));
    expect(vistos.at(-1)).toEqual({ visible: true, escuchando: true });
  });

  it('volver antes de la gracia no deja de escuchar en ningún momento', () => {
    const ui = (activo: boolean) => <MantenerVivo activo={activo}><Sonda /></MantenerVivo>;
    const { rerender } = render(ui(true));
    rerender(ui(false));
    act(() => { vi.advanceTimersByTime(60_000); });
    rerender(ui(true));
    act(() => { vi.advanceTimersByTime(MINUTOS_GRACIA_ESCUCHA * 60 * 1000 * 2); });
    expect(vistos.every((v) => v.escuchando)).toBe(true);
  });

  it('✅ V00447 siempreEscuchando: el módulo de inicio no deja de escuchar al ocultarse', () => {
    const ui = (activo: boolean) => <MantenerVivo activo={activo} siempreEscuchando><Sonda /></MantenerVivo>;
    const { rerender } = render(ui(true));
    rerender(ui(false));
    act(() => { vi.advanceTimersByTime(MINUTOS_GRACIA_ESCUCHA * 60 * 1000 * 3); });
    expect(vistos.at(-1)).toEqual({ visible: false, escuchando: true });
  });
});

// @vitest-environment jsdom
// ✅ V00452 — confirmación del servidor para quien la pide (Pagos: "Guardar" con saldos al día) y reintento.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

type Snap = { docs: { id: string; data: () => Record<string, unknown> }[]; metadata: { fromCache: boolean }; docChanges: () => unknown[] };
const abiertos = new Map<string, { next: (s: Snap) => void; error: (e: Error) => void }>();
let aperturas = 0;

vi.mock('../../config/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, col: string) => ({ col }),
  onSnapshot: (ref: { col: string }, _opciones: unknown, next: (s: Snap) => void, error: (e: Error) => void) => {
    aperturas += 1;
    abiertos.set(ref.col, { next, error });
    return () => { abiertos.delete(ref.col); };
  },
}));

const snap = (filas: Record<string, unknown>[], fromCache = false, cambios = filas.length || 1): Snap => ({
  docs: filas.map((f, i) => ({ id: String(f.id ?? i), data: () => f })),
  metadata: { fromCache },
  docChanges: () => new Array(cambios).fill(null),
});

const { collection } = await import('firebase/firestore');
const vivas = await import('./coleccionesVivas');
const { VENTANA_AVISO_MS, useColeccionViva, reiniciarVivas, reintentarVivo } = vivas;

function Vista({ clave, avisar, alRender }: { clave: string; avisar: boolean; alRender: (delServidor: boolean, error: string | null) => void }) {
  const e = useColeccionViva(clave, () => collection({} as never, clave) as never, { avisarConfirmacion: avisar });
  alRender(e.delServidor, e.error);
  return null;
}

beforeEach(() => { vi.useFakeTimers(); reiniciarVivas(); aperturas = 0; abiertos.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('confirmación del servidor sin cambios', () => {
  it('quien la pide la recibe: caché → servidor sin cambios = al día', () => {
    const vistos: boolean[] = [];
    render(<Vista clave="facturas" avisar alRender={(d) => vistos.push(d)} />);
    act(() => { abiertos.get('facturas')?.next(snap([{ id: 'a' }], true)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(vistos.at(-1)).toBe(false);
    act(() => { abiertos.get('facturas')?.next(snap([{ id: 'a' }], false, 0)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(vistos.at(-1)).toBe(true);
  });
  it('sin pedirla, sigue sin repintar (catálogos, V00446)', () => {
    const vistos: boolean[] = [];
    render(<Vista clave="otra" avisar={false} alRender={(d) => vistos.push(d)} />);
    act(() => { abiertos.get('otra')?.next(snap([{ id: 'a' }], true)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    const pintadas = vistos.length;
    act(() => { abiertos.get('otra')?.next(snap([{ id: 'a' }], false, 0)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(vistos.length).toBe(pintadas);
  });
  it('si el servidor ya había confirmado antes de pedirla, se publica al suscribirse', () => {
    render(<Vista clave="previa" avisar={false} alRender={() => {}} />);
    act(() => { abiertos.get('previa')?.next(snap([{ id: 'a' }], true)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    act(() => { abiertos.get('previa')?.next(snap([{ id: 'a' }], false, 0)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    const vistos: boolean[] = [];
    render(<Vista clave="previa" avisar alRender={(d) => vistos.push(d)} />);
    act(() => { vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(vistos.at(-1)).toBe(true);
  });
});

describe('reintentarVivo', () => {
  it('vuelve a abrir un listener que murió por un error', () => {
    const errores: (string | null)[] = [];
    render(<Vista clave="rota" avisar alRender={(_d, e) => errores.push(e)} />);
    expect(aperturas).toBe(1);
    act(() => { abiertos.get('rota')?.error(new Error('sin red')); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(errores.at(-1)).toBe('sin red');
    act(() => { reintentarVivo('rota'); });
    expect(aperturas).toBe(2);
    act(() => { abiertos.get('rota')?.next(snap([{ id: 'a' }], false)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(errores.at(-1)).toBe(null);
  });
});

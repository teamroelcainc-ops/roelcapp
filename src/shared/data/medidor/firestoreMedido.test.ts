// Prueba del medidor de lecturas: el conteo de onSnapshot y getDocs (SDK simulado).
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Snap = { metadata: { fromCache: boolean }; size: number; docChanges: () => unknown[] };
let ultimoNext: ((s: Snap) => void) | null = null;

vi.mock('@firebase/firestore', () => ({
  getDocs: vi.fn(async () => ({ metadata: { fromCache: false }, size: 7 })),
  getDoc: vi.fn(async () => ({ metadata: { fromCache: false } })),
  onSnapshot: vi.fn((_q: unknown, next: (s: Snap) => void) => {
    ultimoNext = next;
    return () => { ultimoNext = null; };
  }),
}));

const tablaDe = (): Record<string, number> => {
  const filas: Record<string, number> = {};
  const espia = vi.spyOn(console, 'table').mockImplementation((datos: unknown) => {
    for (const f of datos as { clave?: string; accion?: string; lecturas: number }[]) {
      filas[f.clave ?? f.accion ?? '?'] = f.lecturas;
    }
  });
  window.__lecturas?.acciones();
  espia.mockRestore();
  return filas;
};

describe('medidor de lecturas', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
  });

  it('cobra el primer snapshot del servidor completo y luego solo los cambios', async () => {
    const m = await import('./firestoreMedido');
    window.__lecturas?.reiniciar();
    window.__lecturas?.marcar('prueba');
    const recibidos: number[] = [];
    const cancelar = m.onSnapshot({ type: 'collection', path: 'empresas' } as never, (s: Snap) => recibidos.push(s.size));
    ultimoNext?.({ metadata: { fromCache: true }, size: 50, docChanges: () => [] });
    ultimoNext?.({ metadata: { fromCache: false }, size: 52, docChanges: () => [1, 2] });
    ultimoNext?.({ metadata: { fromCache: false }, size: 52, docChanges: () => [1] });
    expect(recibidos).toEqual([50, 52, 52]);
    expect(tablaDe().prueba).toBe(52 + 1);
    cancelar();
    expect(ultimoNext).toBeNull();
  });

  it('getDocs cuenta los documentos devueltos', async () => {
    const m = await import('./firestoreMedido');
    window.__lecturas?.reiniciar();
    window.__lecturas?.marcar('getDocs');
    await m.getDocs({ type: 'collection', path: 'operaciones' } as never);
    expect(tablaDe().getDocs).toBe(7);
  });
});

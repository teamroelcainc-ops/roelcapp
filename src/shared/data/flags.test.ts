// ✅ V00448 — banderas: al cerrar sesión se vuelve a esperar la primera lectura.
import { describe, expect, it, vi } from 'vitest';

let entregar: ((s: { exists: () => boolean; data: () => Record<string, unknown> }) => void) | null = null;
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  onSnapshot: (_ref: unknown, next: (s: unknown) => void) => { entregar = next as typeof entregar; return () => { entregar = null; }; },
}));

const flags = await import('./flags');

describe('flags', () => {
  it('después de detenerFlags, obtenerFlags espera la lectura de la nueva sesión', async () => {
    flags.iniciarFlags();
    entregar?.({ exists: () => true, data: () => ({ consultasCanonicas: true }) });
    expect((await flags.obtenerFlags()).consultasCanonicas).toBe(true);

    flags.detenerFlags(); // cierre de sesión
    const p = flags.obtenerFlags(); // nueva sesión: vuelve a escuchar y espera
    let resuelta = false;
    void p.then(() => { resuelta = true; });
    await Promise.resolve();
    expect(resuelta).toBe(false);
    entregar?.({ exists: () => true, data: () => ({ consultasCanonicas: false, dineroPorServidor: true }) });
    const f = await p;
    expect(f.consultasCanonicas).toBe(false);
    expect(f.dineroPorServidor).toBe(true);
    flags.detenerFlags();
  });
});

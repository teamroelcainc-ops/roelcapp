// @vitest-environment jsdom
// ✅ V00438 — el listener se cierra cuando el módulo deja de escuchar y se reabre al volver.
// ✅ V00446 — "escuchar" = ContextoModuloEscuchando (MantenerVivo lo deja encendido unos
//   minutos después de ocultar el módulo; ver mantenerVivo.test.tsx).
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ContextoModuloEscuchando } from '../../utils/moduloVivoContexto';

const cancelaciones: string[] = [];
const suscripciones: string[] = [];
vi.mock('firebase/firestore', () => ({
  onSnapshot: vi.fn((o: { id: string }, next: (s: unknown) => void) => {
    suscripciones.push(o.id);
    next({ size: 1 });
    return () => { cancelaciones.push(o.id); };
  }),
}));

const { useSnapshotSoloVisible } = await import('./useSnapshotSoloVisible');

function Prueba({ clave, alCambiar }: { clave: string | null; alCambiar: (s: unknown) => void }) {
  useSnapshotSoloVisible(clave, () => ({ id: clave } as never), alCambiar);
  return null;
}

describe('useSnapshotSoloVisible', () => {
  it('escucha solo mientras el módulo escucha', () => {
    const recibidos: unknown[] = [];
    const ui = (escuchando: boolean, clave: string | null) => (
      <ContextoModuloEscuchando.Provider value={escuchando}>
        <Prueba clave={clave} alCambiar={(s) => recibidos.push(s)} />
      </ContextoModuloEscuchando.Provider>
    );
    const { rerender, unmount } = render(ui(true, 'a'));
    expect(suscripciones).toEqual(['a']);
    rerender(ui(false, 'a'));
    expect(cancelaciones).toEqual(['a']);
    rerender(ui(true, 'a'));
    expect(suscripciones).toEqual(['a', 'a']);
    rerender(ui(true, 'b'));
    expect(cancelaciones).toEqual(['a', 'a']);
    expect(suscripciones).toEqual(['a', 'a', 'b']);
    rerender(ui(true, null));
    expect(cancelaciones).toEqual(['a', 'a', 'b']);
    unmount();
    expect(recibidos.length).toBe(3);
  });
});

// @vitest-environment jsdom
// ✅ V00497 — Facturación en vivo: orden, parche local de lo recién escrito y descarte con la versión nueva del listener.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const estado = vi.hoisted(() => ({
  vivo: { datos: [] as Record<string, unknown>[], listo: false, delServidor: false, error: null as string | null },
  avisos: [] as unknown[],
  claves: [] as (string | null)[],
}));
vi.mock('../../../shared/data/coleccionesVivas', () => ({
  useColeccionViva: (clave: string | null) => { estado.claves.push(clave); return estado.vivo; },
  reintentarVivo: vi.fn(),
}));
vi.mock('../../../shared/data/avisos', () => ({ avisar: (a: unknown) => { estado.avisos.push(a); } }));
vi.mock('../../pagos/hooks/useFacturasPagables', () => ({
  consultaFacturasPagables: (lado: string) => ({ clave: `pagos:facturas_${lado === 'cliente' ? 'clientes' : 'proveedores'}`, crear: () => null }),
}));

const { useFacturasEnVivo } = await import('./useFacturasEnVivo');
const normalizar = (raw: Record<string, unknown>) => ({ ...raw });

describe('useFacturasEnVivo', () => {
  it('usa la clave compartida, ordena por fecha y aplica/descarta el parche', () => {
    estado.vivo = { datos: [{ id: 'A', fecha: '2026-01-01' }, { id: 'S', fecha: '' }, { id: 'B', fecha: '2026-02-01' }], listo: true, delServidor: true, error: null };
    const { result, rerender } = renderHook(() => useFacturasEnVivo('cliente', normalizar));
    expect(estado.claves.at(-1)).toBe('pagos:facturas_clientes');
    expect(result.current.facturas.map((f) => f.id)).toEqual(['B', 'A', 'S']);
    expect(result.current.cargando).toBe(false);

    // Lo recién escrito se ve al instante…
    act(() => result.current.setFacturas((prev) => prev.filter((f) => f.id !== 'A')));
    expect(result.current.facturas.map((f) => f.id)).toEqual(['B', 'S']);
    act(() => result.current.setFacturas((prev) => [{ id: 'N', fecha: '2026-03-01' }, ...prev]));
    expect(result.current.facturas.map((f) => f.id)).toEqual(['N', 'B', 'S']);

    // El listener ya traía la factura nueva (escritura local) y el parche la vuelve a agregar: una sola fila.
    act(() => result.current.setFacturas((prev) => [{ id: 'N', fecha: '2026-03-01', nota: 'parche' }, ...prev]));
    expect(result.current.facturas.map((f) => f.id)).toEqual(['N', 'B', 'S']);
    expect(result.current.facturas[0]).toMatchObject({ nota: 'parche' });

    // …y la siguiente versión del listener manda (trae lo que de verdad quedó guardado).
    estado.vivo = { ...estado.vivo, datos: [{ id: 'B', fecha: '2026-02-01' }, { id: 'N', fecha: '2026-03-01' }] };
    rerender();
    expect(result.current.facturas.map((f) => f.id)).toEqual(['N', 'B']);
  });

  it('cargando hasta que el servidor confirma (la caché puede ser parcial); un error se avisa una sola vez', () => {
    estado.vivo = { datos: [], listo: false, delServidor: false, error: null };
    const { result, rerender } = renderHook(() => useFacturasEnVivo('proveedor', normalizar));
    expect(result.current.cargando).toBe(true);
    estado.vivo = { datos: [{ id: 'A', fecha: '2026-01-01' }], listo: true, delServidor: false, error: null }; // solo la caché
    rerender();
    expect(result.current.cargando).toBe(true);
    estado.vivo = { ...estado.vivo, delServidor: true };
    rerender();
    expect(result.current.cargando).toBe(false);
    expect(estado.claves.at(-1)).toBe('pagos:facturas_proveedores');
    estado.avisos.length = 0;
    estado.vivo = { datos: [], listo: true, delServidor: false, error: 'permission-denied' };
    rerender();
    rerender();
    expect(estado.avisos).toHaveLength(1);
    expect(result.current.cargando).toBe(false); // con error no se queda "Cargando…" para siempre
  });
});

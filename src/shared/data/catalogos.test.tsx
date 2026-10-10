// @vitest-environment jsdom
// ✅ V00439 — catálogos compartidos: un listener por colección, permanencia y obtenerCatalogo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

type Snap = { docs: { id: string; data: () => Record<string, unknown> }[]; metadata: { fromCache: boolean }; docChanges: () => unknown[] };
const abiertos = new Map<string, { next: (s: Snap) => void; error: (e: Error) => void }>();
let aperturas = 0;
let cierres = 0;

vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, col: string) => ({ col }),
  onSnapshot: (ref: { col: string }, _opciones: unknown, next: (s: Snap) => void, error: (e: Error) => void) => {
    aperturas += 1;
    abiertos.set(ref.col, { next, error });
    return () => { cierres += 1; abiertos.delete(ref.col); };
  },
}));

const snap = (filas: Record<string, unknown>[], fromCache = false, cambios = filas.length || 1): Snap => ({
  docs: filas.map((f, i) => ({ id: String(f.docId ?? f.id ?? i), data: () => f })),
  metadata: { fromCache },
  docChanges: () => new Array(cambios).fill(null),
});

const mod = await import('./catalogos');

function UnCatalogo({ alRender }: { alRender: (n: number, listo: boolean) => void }) {
  const { datos, listo } = mod.useCatalogo('empresas');
  alRender(datos.length, listo);
  return null;
}

function Varios({ alRender }: { alRender: (n: number) => void }) {
  // Mapa inline a propósito: no debe re-suscribir en cada render.
  const { datos } = mod.useCatalogos({ empresas: 'empresas', monedas: 'catalogo_moneda' });
  alRender(datos.empresas.length + datos.monedas.length);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  mod.reiniciarCatalogos();
  aperturas = 0;
  cierres = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('catálogos compartidos', () => {
  it('dos vistas del mismo catálogo comparten UN listener', () => {
    const vistos: number[] = [];
    const ui = render(<><UnCatalogo alRender={(n) => vistos.push(n)} /><UnCatalogo alRender={(n) => vistos.push(n)} /></>);
    expect(aperturas).toBe(1);
    act(() => { abiertos.get('empresas')?.next(snap([{ id: 'a' }, { id: 'b' }], true)); });
    expect(vistos.at(-1)).toBe(2);
    ui.unmount();
    expect(cierres).toBe(0); // permanece abierto
    act(() => { vi.advanceTimersByTime(mod.MINUTOS_PERMANENCIA * 60 * 1000 + 1); });
    expect(cierres).toBe(1);
  });

  it('volver antes de la permanencia no reabre el listener', () => {
    const a = render(<UnCatalogo alRender={() => {}} />);
    a.unmount();
    act(() => { vi.advanceTimersByTime(60_000); });
    render(<UnCatalogo alRender={() => {}} />);
    expect(aperturas).toBe(1);
    expect(cierres).toBe(0);
  });

  it('useCatalogos con mapa inline no re-suscribe en cada render', () => {
    const vistos: number[] = [];
    const ui = render(<Varios alRender={(n) => vistos.push(n)} />);
    expect(aperturas).toBe(2);
    act(() => { abiertos.get('empresas')?.next(snap([{ id: 'a' }])); });
    act(() => { abiertos.get('catalogo_moneda')?.next(snap([{ id: 'u' }, { id: 'm' }])); });
    ui.rerender(<Varios alRender={(n) => vistos.push(n)} />);
    expect(aperturas).toBe(2);
    expect(vistos.at(-1)).toBe(3);
  });

  it('obtenerCatalogo espera al servidor y no se queda con la caché local', async () => {
    const p = mod.obtenerCatalogo('catalogo_tipos_gastos');
    act(() => { abiertos.get('catalogo_tipos_gastos')?.next(snap([{ id: 'viejo' }], true)); });
    act(() => { abiertos.get('catalogo_tipos_gastos')?.next(snap([{ id: 'x' }, { id: 'y' }], false)); });
    await expect(p).resolves.toHaveLength(2);
  });

  it('la confirmación del servidor SIN cambios (solo metadatos) basta para obtenerCatalogo', async () => {
    const p = mod.obtenerCatalogo('catalogo_moneda');
    act(() => { abiertos.get('catalogo_moneda')?.next(snap([{ id: 'u' }], true)); });
    act(() => { abiertos.get('catalogo_moneda')?.next(snap([{ id: 'u' }], false, 0)); });
    await expect(p).resolves.toHaveLength(1);
  });

  it('_docId es el id real del documento y no se copia con spread', () => {
    let fila: Record<string, unknown> | undefined;
    render(<UnCatalogo alRender={() => { fila = mod.estadoCatalogo('empresas').datos[0]; }} />);
    act(() => { abiertos.get('empresas')?.next(snap([{ docId: 'DOC1', id: 'APPSHEET9', nombre: 'X' }])); });
    expect(mod.estadoCatalogo('empresas').datos[0].id).toBe('APPSHEET9');
    expect(mod.estadoCatalogo('empresas').datos[0]._docId).toBe('DOC1');
    expect({ ...mod.estadoCatalogo('empresas').datos[0] }).not.toHaveProperty('_docId');
    expect(mod.idReal(mod.estadoCatalogo('empresas').datos[0])).toBe('DOC1');
    void fila;
  });

  it('un error del listener permite reabrirlo después', () => {
    const a = render(<UnCatalogo alRender={() => {}} />);
    act(() => { abiertos.get('empresas')?.error(new Error('permiso')); });
    a.unmount();
    render(<UnCatalogo alRender={() => {}} />);
    expect(aperturas).toBe(2);
  });
});

// @vitest-environment jsdom
// ✅ V00439 — catálogos compartidos: un listener por colección, permanencia y obtenerCatalogo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

type Snap = { docs: { id: string; data: () => Record<string, unknown> }[]; metadata: { fromCache: boolean }; docChanges: () => unknown[] };
const abiertos = new Map<string, { next: (s: Snap) => void; error: (e: Error) => void }>();
let aperturas = 0;
let cierres = 0;

vi.mock('../../config/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
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
const { VENTANA_AVISO_MS } = await import('./coleccionesVivas');
const { ContextoModuloVivoActivo } = await import('../../utils/moduloVivoContexto');

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
    act(() => { abiertos.get('empresas')?.next(snap([{ id: 'a' }, { id: 'b' }], true)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(vistos.at(-1)).toBe(2);
    ui.unmount();
    // ✅ V00446: un catálogo queda abierto toda la sesión (no se cierra por tiempo)…
    act(() => { vi.advanceTimersByTime(mod.MINUTOS_PERMANENCIA * 60 * 1000 * 4); });
    expect(cierres).toBe(0);
    // …y se cierra al cerrar sesión.
    act(() => { mod.reiniciarCatalogos(); });
    expect(cierres).toBe(1);
  });

  it('los avisos se agrupan: dos catálogos seguidos = un solo repintado', () => {
    let pintadas = 0;
    render(<Varios alRender={() => { pintadas += 1; }} />);
    const antes = pintadas;
    act(() => {
      abiertos.get('empresas')?.next(snap([{ id: 'a' }]));
      abiertos.get('catalogo_moneda')?.next(snap([{ id: 'u' }, { id: 'm' }]));
      vi.advanceTimersByTime(VENTANA_AVISO_MS);
    });
    expect(pintadas - antes).toBe(1);
  });

  it('la confirmación del servidor sin cambios no repinta', () => {
    let pintadas = 0;
    render(<UnCatalogo alRender={() => { pintadas += 1; }} />);
    act(() => { abiertos.get('empresas')?.next(snap([{ id: 'a' }], true)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    const antes = pintadas;
    act(() => { abiertos.get('empresas')?.next(snap([{ id: 'a' }], false, 0)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(pintadas).toBe(antes);
  });

  it('un módulo oculto no se repinta; al volver a verse toma lo más reciente', () => {
    const vistos: number[] = [];
    const ui = (visible: boolean) => (
      <ContextoModuloVivoActivo.Provider value={visible}><UnCatalogo alRender={(n) => vistos.push(n)} /></ContextoModuloVivoActivo.Provider>
    );
    const { rerender } = render(ui(true));
    act(() => { abiertos.get('empresas')?.next(snap([{ id: 'a' }])); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    rerender(ui(false));
    const pintadasOculto = vistos.length;
    act(() => { abiertos.get('empresas')?.next(snap([{ id: 'a' }, { id: 'b' }, { id: 'c' }])); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    expect(vistos.length).toBe(pintadasOculto);
    rerender(ui(true));
    expect(vistos.at(-1)).toBe(3);
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

  it('obtenerCatalogo devuelve en cuanto hay datos (caché local) sin esperar al servidor', async () => {
    const p = mod.obtenerCatalogo('catalogo_tipos_gastos');
    act(() => { abiertos.get('catalogo_tipos_gastos')?.next(snap([{ id: 'cache' }], true)); });
    await expect(p).resolves.toHaveLength(1);
    // Ya abierto: la siguiente llamada es inmediata.
    await expect(mod.obtenerCatalogo('catalogo_tipos_gastos')).resolves.toHaveLength(1);
    expect(aperturas).toBe(1);
  });

  it('obtenerCatalogo fresco espera al servidor y no se queda con la caché local', async () => {
    const p = mod.obtenerCatalogo('catalogo_tipos_gastos', { fresco: true });
    act(() => { abiertos.get('catalogo_tipos_gastos')?.next(snap([{ id: 'viejo' }], true)); });
    act(() => { abiertos.get('catalogo_tipos_gastos')?.next(snap([{ id: 'x' }, { id: 'y' }], false)); });
    await expect(p).resolves.toHaveLength(2);
  });

  it('la confirmación del servidor SIN cambios (solo metadatos) basta para obtenerCatalogo fresco', async () => {
    const p = mod.obtenerCatalogo('catalogo_moneda', { fresco: true });
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

  it('✅ V00447 precalentarCatalogos abre los catálogos de uno en uno y se salta los que ya están', async () => {
    render(<UnCatalogo alRender={() => {}} />);
    act(() => { abiertos.get('empresas')?.next(snap([{ id: 'a' }], true)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    const antes = aperturas;
    mod.precalentarCatalogos(['empresas', 'catalogo_moneda', 'remolques']);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(aperturas - antes).toBe(1); // empresas ya estaba: solo abre monedas
    expect(abiertos.has('catalogo_moneda')).toBe(true);
    expect(abiertos.has('remolques')).toBe(false);
    await act(async () => { abiertos.get('catalogo_moneda')?.next(snap([{ id: 'm' }], true)); vi.advanceTimersByTime(VENTANA_AVISO_MS); });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(abiertos.has('remolques')).toBe(true);
    expect(aperturas - antes).toBe(2);
  });
});

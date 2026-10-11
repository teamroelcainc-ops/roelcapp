// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ✅ V00446 — MEDICIÓN DE REPINTADOS (no corre con `npm test`): `npm run medir:render`.
// Monta los módulos pesados con un Firebase falso que sirve catálogos de tamaño real
// (caché local primero y confirmación del servidor después, como el SDK) y cuenta cuántas
// veces se repinta cada módulo y cuánto tarda: al arrancar, cuando cambia una empresa,
// estando oculto y al volver. Sirve para comparar antes/después de un cambio; los
// milisegundos de jsdom no son los del navegador, la cantidad de repintados sí.
// ---------------------------------------------------------------------------
import { afterEach, beforeAll, describe, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Profiler, Suspense, useEffect, useState } from 'react';
import type { ComponentType } from 'react';

const h = vi.hoisted(() => {
  const TAM: Record<string, number> = {
    empresas: 2000, direcciones: 2000, convenios_clientes_detalles: 3000, convenios_proveedores_detalles: 1500,
    convenios_clientes: 600, convenios_proveedores: 300, tarifario_clientes: 300, tarifario_proveedores: 150,
    tipo_cambio: 2500, remolques: 500, unidades: 120, empleados: 300, unidades_proveedor: 400, proveedores_unidad: 200,
    catalogo_status_servicio: 40, catalogo_tipo_operacion: 12, catalogo_tarifas_referencia: 400, catalogo_moneda: 3,
    catalogo_embalaje: 30, config_flujos_operacion: 60, roles: 15,
  };
  const docsDe = (col: string, version = 0) => Array.from({ length: TAM[col] ?? 10 }, (_, i) => ({
    id: `${col}_${i}`,
    data: () => ({
      nombre: `${col} ${i} v${version}`, descripcion: `desc ${i}`, status: 'Activo', tipo_operacion: `Tipo ${i}`,
      ...(col.startsWith('tarifario') ? { tarifas: Array.from({ length: 20 }, (_, j) => ({ descripcion: `t${j}`, monto: j })) } : {}),
    }),
  }));
  const oyentes = new Map<string, ((s: unknown) => void)[]>();
  const conteo = { listeners: 0, getDocs: 0 };
  const snap = (docs: { id: string; data: () => unknown }[], fromCache: boolean, cambios: number) => ({
    docs, empty: docs.length === 0, size: docs.length, forEach: (f: (d: unknown) => void) => docs.forEach(f),
    docChanges: () => new Array(cambios).fill(null), id: 'x', exists: () => false, data: () => undefined,
    metadata: { fromCache, hasPendingWrites: false },
  });
  return { TAM, docsDe, oyentes, conteo, snap };
});

const falso = () => {
  const ref = (path: string) => ({ id: path, path, withConverter() { return this; } });
  const especificos: Record<string, unknown> = {
    collection: (_db: unknown, ...p: unknown[]) => ref(p.map(String).join('/')),
    doc: (_db: unknown, ...p: unknown[]) => ref(p.map(String).join('/')),
    getDocs: async () => { h.conteo.getDocs += 1; await new Promise((r) => setTimeout(r, 20)); return h.snap(Array.from({ length: 50 }, (_, i) => ({ id: `op${i}`, data: () => ({ ref: `RFT-${i}`, status: 'x' }) })), false, 50); },
    getDoc: async () => h.snap([], false, 0),
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    onSnapshot: (r: { path?: string }, ...args: unknown[]) => {
      h.conteo.listeners += 1;
      const cb = args.find((a) => typeof a === 'function') as (s: unknown) => void;
      const col = String(r?.path || '');
      const lista = h.oyentes.get(col) ?? [];
      lista.push(cb); h.oyentes.set(col, lista);
      const docs = h.docsDe(col);
      // Caché local (IndexedDB) primero y la confirmación del servidor después, como el SDK.
      const t1 = setTimeout(() => cb(h.snap(docs, true, docs.length)), 5 + Math.random() * 40);
      const t2 = setTimeout(() => cb(h.snap(docs, false, 0)), 120 + Math.random() * 200);
      return () => { clearTimeout(t1); clearTimeout(t2); h.oyentes.set(col, (h.oyentes.get(col) ?? []).filter((f) => f !== cb)); };
    },
    writeBatch: () => ({ set() {}, update() {}, delete() {}, commit: async () => {} }),
    getAuth: () => ({ currentUser: null, onAuthStateChanged: () => () => {} }),
  };
  return new Proxy({}, {
    has: () => true,
    get: (_t, k) => {
      if (k === '__esModule') return true;
      if (k === 'then' || typeof k === 'symbol') return undefined;
      if (k in especificos) return especificos[k];
      return () => ref('falso');
    },
  });
};
vi.mock('firebase/app', () => falso());
vi.mock('firebase/firestore', () => falso());
vi.mock('firebase/auth', () => falso());
vi.mock('firebase/storage', () => falso());
vi.mock('firebase/functions', () => falso());

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  g.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => { cleanup(); });

const esperar = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const medir = async (nombre: string, cargar: () => Promise<Record<string, unknown>>, exportado: string) => {
  const { ContextoModuloVivoActivo } = await import('../utils/moduloVivoContexto');
  const Modulo = (await cargar())[exportado] as ComponentType;
  const stats = { commits: 0, ms: 0 };
  const tomar = () => { const r = { ...stats }; stats.commits = 0; stats.ms = 0; return r; };
  const control: { setVisible: (v: boolean) => void } = { setVisible: () => {} };
  const Caja = () => {
    const [visible, sv] = useState(true);
    useEffect(() => { control.setVisible = sv; }, [sv]);
    return (
      <ContextoModuloVivoActivo.Provider value={visible}>
        <Profiler id="m" onRender={(_id, _fase, dur) => { stats.commits += 1; stats.ms += dur; }}>
          <Suspense fallback={null}><Modulo /></Suspense>
        </Profiler>
      </ContextoModuloVivoActivo.Provider>
    );
  };
  h.conteo.listeners = 0;
  const t0 = performance.now();
  await act(async () => { render(<Caja />); });
  await esperar(600);
  const arranque = { ...tomar(), muro: Math.round(performance.now() - t0), listeners: h.conteo.listeners };
  // Un usuario cambia UNA empresa: el listener de empresas entrega el catálogo con 1 cambio.
  await act(async () => { (h.oyentes.get('empresas') ?? []).forEach((cb) => cb(h.snap(h.docsDe('empresas', 1), false, 1))); });
  await esperar(50);
  const cambioEmpresa = tomar();
  // Se va a otro módulo y vuelve.
  h.conteo.listeners = 0;
  await act(async () => { control.setVisible(false); });
  await esperar(50);
  const ocultar = tomar();
  await act(async () => { (h.oyentes.get('empresas') ?? []).forEach((cb) => cb(h.snap(h.docsDe('empresas', 2), false, 1))); });
  await esperar(50);
  const cambioOculto = tomar();
  await act(async () => { control.setVisible(true); });
  await esperar(600);
  const volver = { ...tomar(), listenersNuevos: h.conteo.listeners };
  console.log(`MEDICION ${nombre} ${JSON.stringify({ arranque, cambioEmpresa, ocultar, cambioOculto, volver })}`);
};

describe('medición', () => {
  it('Operaciones', async () => { await medir('Operaciones', () => import('../features/operaciones/components/OperacionesDashboard'), 'default'); }, 60000);
  it('Completados', async () => { await medir('Completados', () => import('../features/operaciones/components/ServiciosCompletados'), 'default'); }, 60000);
  it('FacturacionClientes', async () => { await medir('FacturacionClientes', () => import('../features/facturacion/components/FacturacionClientesDashboard'), 'FacturacionClientesDashboard'); }, 60000);
  it('Empresas', async () => { await medir('Empresas', () => import('../features/empresas/components/EmpresasDashboard'), 'default'); }, 60000);
});

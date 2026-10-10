// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ✅ V00445 — PRUEBA DE HUMO: cada módulo de la app se monta sin romperse, con
// TODAS las banderas apagadas (lo que corre hoy) y con TODAS encendidas (los
// caminos nuevos). Firebase es el falso de ./firebaseFalso (contesta "sin datos").
// No prueba la lógica de cada pantalla: atrapa los errores que tiran la pantalla
// completa al abrirla (p. ej. V00445: "Cannot access 'statusServicioOrdenado'
// before initialization" en Operaciones, que tsc y eslint no ven).
// ---------------------------------------------------------------------------
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Component, Suspense } from 'react';
import type { ComponentType, ReactNode } from 'react';

import { estadoFalso } from './firebaseFalso';
import { detenerFlags, iniciarFlags, obtenerFlags } from '../shared/data/flags';

vi.mock('firebase/app', async () => (await import('./firebaseFalso')).moduloFalso());
vi.mock('firebase/firestore', async () => (await import('./firebaseFalso')).moduloFalso());
vi.mock('firebase/auth', async () => (await import('./firebaseFalso')).moduloFalso());
vi.mock('firebase/storage', async () => (await import('./firebaseFalso')).moduloFalso());
vi.mock('firebase/functions', async () => (await import('./firebaseFalso')).moduloFalso());
vi.mock('firebase/app-check', async () => (await import('./firebaseFalso')).moduloFalso());

// ── Entorno del navegador que jsdom no trae ────────────────────────────────
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  g.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  }
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockImplementation(() => false);
});
afterEach(() => { cleanup(); });

// ── Atrapa el error de render (React lo reporta, no lo lanza) ──────────────
class Atrapa extends Component<{ alFallar: (e: Error) => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { this.props.alFallar(error); }
  render() { return this.state.error ? null : this.props.children; }
}

const montar = async (Modulo: ComponentType<Record<string, unknown>>, props: Record<string, unknown> = {}) => {
  const errores: Error[] = [];
  await act(async () => {
    render(<Atrapa alFallar={(e) => errores.push(e)}><Suspense fallback={null}><Modulo {...props} /></Suspense></Atrapa>);
  });
  // Deja correr las cargas iniciales (efectos, escuchas falsas, promesas).
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return errores;
};

type Cargador = () => Promise<Record<string, unknown>>;
const MODULOS: [string, Cargador, string, Record<string, unknown>?][] = [
  ['Operaciones Activas', () => import('../features/operaciones/components/OperacionesDashboard'), 'default'],
  ['Servicios Completados', () => import('../features/operaciones/components/ServiciosCompletados'), 'default'],
  ['Servicios Cancelados', () => import('../features/operaciones/components/ServiciosCancelados'), 'default'],
  ['Mis Operaciones', () => import('../features/misOperaciones/components/MisOperacionesDashboard'), 'default'],
  ['Facturación Clientes', () => import('../features/facturacion/components/FacturacionClientesDashboard'), 'FacturacionClientesDashboard'],
  ['Facturación Proveedores', () => import('../features/facturacion/components/FacturacionProveedoresDashboard'), 'FacturacionProveedoresDashboard'],
  ['Pagos', () => import('../features/pagos/components/PagosDashboard'), 'default'],
  ['Empresas', () => import('../features/empresas/components/EmpresasDashboard'), 'default'],
  ['Detalles de Convenio (clientes)', () => import('../features/conveniosDetalles/components/DetallesConvenioDashboard'), 'default', { tipo: 'clientes' }],
  ['Detalles de Convenio (proveedores)', () => import('../features/conveniosDetalles/components/DetallesConvenioDashboard'), 'default', { tipo: 'proveedores' }],
  ['Convenios Clientes', () => import('../features/conveniosClientes/components/ConveniosClientesDashboard'), 'default'],
  ['Convenios Proveedores', () => import('../features/conveniosProveedores/components/ConveniosProveedoresDashboard'), 'ConveniosProveedoresDashboard'],
  ['Tarifario Clientes', () => import('../features/tarifarioClientes/components/TarifarioClientesDashboard'), 'default'],
  ['Tarifario Proveedores', () => import('../features/tarifarioProveedores/components/TarifarioProveedoresDashboard'), 'TarifarioProveedoresDashboard'],
  ['Reportes', () => import('../features/reportes/components/ReportesDashboard'), 'ReportesDashboard'],
  ['Estadísticas', () => import('../features/estadisticas/components/EstadisticasDashboard'), 'EstadisticasDashboard'],
  ['Saldos de Puentes', () => import('../features/saldosPuentes/components/SaldosPuentesDashboard'), 'SaldosPuentesDashboard'],
  ['Referencias de Puentes', () => import('../features/puentes/components/ReferenciasPuentesDashboard'), 'ReferenciasPuentesDashboard'],
  ['Referencias del Diésel', () => import('../features/diesel/components/ReferenciasDieselDashboard'), 'ReferenciasDieselDashboard'],
  ['Referencias de Nómina', () => import('../features/nominas/components/ReferenciasNominaDashboard'), 'ReferenciasNominaDashboard'],
  ['Catálogos', () => import('../features/catalogos/components/CatalogosDashboard'), 'default'],
  ['Papelera', () => import('../features/papelera/components/PapeleraDashboard'), 'default'],
  ['MTTO', () => import('../features/gastos/components/mtto/MttoDashboard'), 'default'],
  ['Panel de Control', () => import('../features/panelControl/PanelControlDashboard'), 'PanelControlDashboard'],
  ['Tablero (CRM)', () => import('../features/tablero/TableroOperacionesDashboard'), 'TableroOperacionesDashboard'],
  ['Unidades', () => import('../features/unidades/components/UnidadesDashboard'), 'default'],
  ['Remolques', () => import('../features/remolques/components/RemolquesDashboard'), 'default'],
  ['Empleados', () => import('../features/empleados/components/EmpleadosDashboard'), 'EmpleadosDashboard'],
  ['Usuarios', () => import('../usuarios/components/UsuariosDashboard'), 'UsuariosDashboard'],
  ['Roles', () => import('../usuarios/components/RolesDashboard'), 'RolesDashboard'],
  ['Importación', () => import('../features/importacion/components/DataImportView'), 'default'],
];

const probar = async (cargar: Cargador, exportado: string, props?: Record<string, unknown>) => {
  const m = await cargar();
  const Modulo = m[exportado] as ComponentType<Record<string, unknown>>;
  expect(Modulo, `no existe el export "${exportado}"`).toBeTypeOf('function');
  const errores = await montar(Modulo, props);
  expect(errores.map((e) => `${e.name}: ${e.message}`)).toEqual([]);
};

// Primero con las banderas apagadas (el documento no existe): así arrancan hoy.
describe('cada módulo se monta sin romperse (banderas apagadas)', () => {
  it.each(MODULOS)('%s', async (_nombre, cargar, exportado, props) => { await probar(cargar, exportado, props); }, 30000);
});

// Después con TODAS las banderas encendidas (consultas acotadas, dinero por servidor…).
describe('cada módulo se monta sin romperse (banderas encendidas)', () => {
  beforeAll(async () => {
    estadoFalso.flags = {
      usuariosPorServidor: true, eliminarPorServidor: true, canonicosEnServidor: true, dineroPorServidor: true,
      cobroPuenteEnServidor: true, saldosCorrientes: true, propagacionEnServidor: true, consultasCanonicas: true,
    };
    detenerFlags(); // la primera parte ya escuchaba el documento (sin banderas)
    iniciarFlags();
    await new Promise((r) => setTimeout(r, 20));
    expect((await obtenerFlags()).consultasCanonicas).toBe(true);
  });
  it.each(MODULOS)('%s', async (_nombre, cargar, exportado, props) => { await probar(cargar, exportado, props); }, 30000);
});

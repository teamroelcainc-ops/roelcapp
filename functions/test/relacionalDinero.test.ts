// ✅ V00441 — con la bandera APAGADA los triggers de dinero calculan EXACTAMENTE lo de la
// V00440 (saldo desde los renglones; conversión "espejo" que acepta el ID de moneda en
// monedaCobroNombre). Con la bandera, la regla única.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Datos = Record<string, unknown>;

const estado = vi.hoisted(() => ({ banderas: {} as Record<string, boolean>, actualizaciones: [] as { path: string; datos: Datos }[], facturas: [] as { id: string; datos: Datos }[] }));

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      where: () => ({
        get: async () => ({
          empty: estado.facturas.length === 0,
          docs: estado.facturas.map((f) => ({ id: f.id, data: () => f.datos, ref: { update: async (datos: Datos) => { estado.actualizaciones.push({ path: f.id, datos }); } } })),
        }),
      }),
    }),
  }),
}));
vi.mock('firebase-functions/v2', () => ({ logger: { error: () => {}, info: () => {} } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_o: unknown, fn: unknown) => fn, onDocumentUpdated: (_o: unknown, fn: unknown) => fn }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_o: unknown, fn: unknown) => fn, HttpsError: class extends Error {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_o: unknown, fn: unknown) => fn }));
vi.mock('../src/acceso', () => ({ exigirAdmin: async () => {}, EXIGIR_APP_CHECK: false }));
vi.mock('../src/canonico', () => ({
  CATALOGO_ADUANAS: [], CATALOGO_CV: [], cambiosCanonicos: () => ({}), catalogoServidor: async () => ({ porId: new Map() }),
  contextoServidor: async () => ({}), invalidarCatalogoServidor: () => {},
}));
vi.mock('../src/flags', () => ({ banderaServidor: async (n: string) => estado.banderas[n] === true }));
vi.mock('../src/proyecciones.js', () => ({ proyectarRenglones: async () => 0, borrarRenglones: async () => 0 }));
vi.mock('../src/puentesYDiesel.js', () => ({ cambiosCobroPuente: async () => ({}) }));

const mod = await import('../src/relacional');
type Trigger = (e: unknown) => Promise<void>;

const eventoFactura = (datos: Datos) => {
  const actualizado: Datos[] = [];
  const despues = { exists: true, id: 'F1', data: () => datos, updateTime: {}, ref: { update: async (c: Datos) => { actualizado.push(c); } } };
  return { evento: { params: { facId: 'F1' }, data: { before: { exists: false }, after: despues } }, actualizado };
};

beforeEach(() => { estado.banderas = {}; estado.actualizaciones = []; estado.facturas = []; });

describe('saldo de la factura (facturaClienteMontoCambiado)', () => {
  // Factura en USD cuyo subtotalMonedaFactura quedó con la conversión (18,000) pero sus renglones suman 1,000.
  const fac = { invoice: 'A-1', monedaFacturacion: 'USD', subtotalMonedaFactura: 18000, montoPagado: 1000, saldoPendiente: 0, statusPago: 'PAGADA', operacionesGuardadas: [{ id: 'o1', dol: 1000, monto: 18000 }] };
  it('bandera apagada: igual que antes (desde los renglones) — no mueve el saldo', async () => {
    const { evento, actualizado } = eventoFactura(fac);
    await (mod.facturaClienteMontoCambiado as unknown as Trigger)(evento);
    expect(actualizado).toEqual([]);
  });
  it('bandera apagada: un total manual que quedó de cuando estuvo encendida sí se respeta', async () => {
    const { evento, actualizado } = eventoFactura({ ...fac, totalManualCentavos: 150000 });
    await (mod.facturaClienteMontoCambiado as unknown as Trigger)(evento);
    expect(actualizado[0]).toMatchObject({ saldoPendiente: 500, statusPago: 'PARCIAL' });
  });
  it('bandera encendida: regla única (primero el total guardado) y agregados', async () => {
    estado.banderas.dineroPorServidor = true;
    const { evento, actualizado } = eventoFactura(fac);
    await (mod.facturaClienteMontoCambiado as unknown as Trigger)(evento);
    expect(actualizado[0]).toMatchObject({ saldoPendiente: 17000, statusPago: 'PARCIAL', esquemaDinero: 2, totalCentavos: 1800000 });
  });
});

describe('cascada operación → factura (operacionMontoCambiado)', () => {
  const opAntes = { montoConvenioCliente: 100, monedaConvenioCliente: '7dca62b3', facturadoEnCobrar: '', monedaCobroNombre: 'f95d8894', tipoCambioAprobado: 18 };
  const correr = async () => {
    estado.facturas = [{ id: 'F1', datos: { monedaFacturacion: 'MXN', operacionesIds: ['o1'], operacionesGuardadas: [{ id: 'o1', monto: 1, subtotalBase: 1, dol: 0, pes: 1 }] } }];
    await (mod.operacionMontoCambiado as unknown as Trigger)({ params: { opId: 'o1' }, data: { before: { data: () => opAntes }, after: { data: () => ({ ...opAntes, montoConvenioCliente: 200 }) } } });
    return estado.actualizaciones[0]?.datos.operacionesGuardadas as Datos[] | undefined;
  };
  it('bandera apagada: el ID de moneda en monedaCobroNombre cuenta como pesos (convierte × TC), como antes', async () => {
    expect((await correr())?.[0]).toMatchObject({ monto: 3600, pes: 3600 });
  });
});

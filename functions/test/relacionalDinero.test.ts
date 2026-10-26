// ✅ V00441 — con la bandera APAGADA los triggers de dinero calculan EXACTAMENTE lo de la
// V00440 (saldo desde los renglones; conversión "espejo" que acepta el ID de moneda en
// monedaCobroNombre). Con la bandera, la regla única.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Datos = Record<string, unknown>;

const estado = vi.hoisted(() => ({ banderas: {} as Record<string, boolean>, actualizaciones: [] as { path: string; datos: Datos }[], docs: new Map<string, Record<string, unknown>>() }));

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => {
  type Ref = { path: string; id: string };
  const ref = (path: string): Ref => ({ path, id: path.split('/').pop() as string });
  const snap = (r: Ref) => ({ id: r.id, exists: estado.docs.has(r.path), data: () => estado.docs.get(r.path) });
  return {
    getFirestore: () => ({
      collection: (col: string) => ({
        doc: (id: string) => ref(`${col}/${id}`),
        where: (campo: string, _op: string, valor: unknown) => ({
          select: () => ({
            get: async () => {
              const docs = Array.from(estado.docs.entries())
                .filter(([p, d]) => p.startsWith(`${col}/`) && Array.isArray(d[campo]) && (d[campo] as unknown[]).includes(valor))
                .map(([p]) => ({ id: p.split('/').pop(), ref: ref(p) }));
              return { empty: docs.length === 0, docs };
            },
          }),
        }),
      }),
      runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({
        getAll: async (...refs: Ref[]) => refs.map(snap),
        get: async (r: Ref) => snap(r),
        update: (r: Ref, datos: Datos) => { estado.actualizaciones.push({ path: r.path, datos }); estado.docs.set(r.path, { ...estado.docs.get(r.path), ...datos }); },
      }),
    }),
  };
});
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
vi.mock('../src/usos.js', () => ({ actualizarUsos: async () => 0 }));
vi.mock('../src/propagacion.js', () => ({ propagarSiCambioNombre: async () => 0, OPCIONES_PROPAGACION: {} }));

const mod = await import('../src/relacional');
type Trigger = (e: unknown) => Promise<void>;

const eventoFactura = (datos: Datos) => {
  const actualizado: Datos[] = [];
  const despues = { exists: true, id: 'F1', data: () => datos, updateTime: {}, ref: { update: async (c: Datos) => { actualizado.push(c); } } };
  return { evento: { id: 'e1', time: new Date().toISOString(), params: { facId: 'F1' }, data: { before: { exists: false }, after: despues } }, actualizado };
};

beforeEach(() => { estado.banderas = {}; estado.actualizaciones = []; estado.docs.clear(); });

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

describe('cascada operación → factura (dentro de operacionEscrita desde la V00442)', () => {
  const opAntes = { montoConvenioCliente: 100, monedaConvenioCliente: '7dca62b3', facturadoEnCobrar: '', monedaCobroNombre: 'f95d8894', tipoCambioAprobado: 18 };
  const correr = async () => {
    estado.docs.set('facturas_clientes/F1', { monedaFacturacion: 'MXN', operacionesIds: ['o1'], operacionesGuardadas: [{ id: 'o1', monto: 1, subtotalBase: 1, dol: 0, pes: 1 }] });
    const despues = { ...opAntes, montoConvenioCliente: 200 };
    estado.docs.set('operaciones/o1', despues); // la cascada lee la operación ACTUAL
    await (mod.operacionEscrita as unknown as Trigger)({
      id: 'e2', time: new Date().toISOString(), params: { opId: 'o1' },
      data: { before: { exists: true, data: () => opAntes }, after: { exists: true, data: () => despues, updateTime: {}, ref: { update: async () => {} } } },
    });
    return estado.actualizaciones[0]?.datos.operacionesGuardadas as Datos[] | undefined;
  };
  it('bandera apagada: el ID de moneda en monedaCobroNombre cuenta como pesos (convierte × TC), como antes', async () => {
    expect((await correr())?.[0]).toMatchObject({ monto: 3600, pes: 3600 });
  });
});

describe('✅ V00489 — cascada con la moneda de factura de una sola fuente', () => {
  const correrCon = async (antes: Datos, despues: Datos) => {
    estado.actualizaciones.length = 0;
    estado.docs.set('facturas_clientes/F1', { monedaFacturacion: 'MXN', operacionesIds: ['o1'], operacionesGuardadas: [{ id: 'o1', monto: 801373.63, subtotalBase: 46082.97, dol: 46082.97, pes: 0 }] });
    estado.docs.set('operaciones/o1', despues);
    await (mod.operacionEscrita as unknown as Trigger)({
      id: 'e3', time: new Date().toISOString(), params: { opId: 'o1' },
      data: { before: { exists: true, data: () => antes }, after: { exists: true, data: () => despues, updateTime: {}, ref: { update: async () => {} } } },
    });
    return estado.actualizaciones[0]?.datos.operacionesGuardadas as Datos[] | undefined;
  };
  const ID_MXN_PRUEBA = 'f95d8894'; // ID_MXN del catálogo
  const base = { montoConvenioCliente: 2650, cargosAdicionales: 0, tipoCambioAprobado: 17.3898, monedaConvenioCliente: '' };
  it('ID Pesos con el nombre copiado en "Dólares": no multiplica dos veces por el TC', async () => {
    const antes = { ...base, facturadoEnCobrar: '', monedaCobroNombre: 'Dólares', conversionCliente: 46082.97 };
    const despues = { ...antes, facturadoEnCobrar: ID_MXN_PRUEBA }; // la regla de antes daba 801,373.63
    expect((await correrCon(antes, despues))?.[0]).toMatchObject({ monto: 46082.97, pes: 46082.97, dol: 0 });
  });
  it('corregir solo la conversión guardada (convenio sin moneda) actualiza el renglón de la factura', async () => {
    const antes = { ...base, facturadoEnCobrar: ID_MXN_PRUEBA, monedaCobroNombre: 'Dólares', conversionCliente: 46082.97 };
    const despues = { ...antes, conversionCliente: 2650, pesosCliente: 2650, subtotalCliente: 2650 };
    expect((await correrCon(antes, despues))?.[0]).toMatchObject({ monto: 2650, pes: 2650, dol: 0 });
  });
});

describe('operacionEscrita: sale sin calcular si solo cambiaron sus propios campos', () => {
  it('soloCamposPropios', () => {
    expect(mod.soloCamposPropios({ a: 1, estadoGrupo: 'activa' }, { a: 1, estadoGrupo: 'completada', empresasIds: ['x'] })).toBe(true);
    expect(mod.soloCamposPropios({ a: 1 }, { a: 2, estadoGrupo: 'activa' })).toBe(false);
    expect(mod.soloCamposPropios({ esPrueba: false }, { esPrueba: true })).toBe(false); // lo marca el usuario
  });
  it('facturas: un documento adjunto o la escritura del propio trigger no cuentan como dinero', () => {
    const f = { montoPagado: 1, subtotalMonedaFactura: 10 };
    expect(mod.cambioDeDinero(f, { ...f, docFacturaUrl: 'u', saldoCentavos: 900, abierta: true })).toBe(false);
    expect(mod.cambioDeDinero(f, { ...f, statusFactura: 'Cancelada' })).toBe(true);
    expect(mod.cambioDeDinero(f, { ...f, montoPagado: 2 })).toBe(true);
  });
});


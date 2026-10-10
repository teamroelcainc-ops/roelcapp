// ✅ V00441 (Fase 5) — callables de dinero contra un Firestore falso con transacciones:
// lecturas dentro de la transacción, escrituras del plan, búsqueda por folio,
// idempotencia del pago y reversión. (La prueba de concurrencia real va en el
// emulador: firebase-tests/dinero.emulador.test.ts.)
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Datos = Record<string, unknown>;

const falso = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  let contador = 0;
  type Filtro = [string, string, unknown];
  const ref = (ruta: string) => {
    const partes = ruta.split('/');
    return {
      id: partes[partes.length - 1], path: ruta,
      collection: (sub: string) => coleccion(`${ruta}/${sub}`),
      get: async () => snap(ruta),
    };
  };
  const coincide = (d: Record<string, unknown>, [campo, op, valor]: Filtro): boolean => {
    const v = d[campo];
    if (op === '==') return v === valor;
    if (op === 'in') return (valor as unknown[]).includes(v);
    if (op === 'array-contains') return Array.isArray(v) && v.includes(valor);
    return false;
  };
  const consulta = (ruta: string, filtros: Filtro[]) => ({
    __consulta: true, ruta, filtros,
    where: (c: string, op: string, v: unknown) => consulta(ruta, [...filtros, [c, op, v]]),
  });
  const coleccion = (ruta: string) => ({
    doc: (id?: string) => ref(`${ruta}/${id ?? `auto${++contador}`}`),
    where: (c: string, op: string, v: unknown) => consulta(ruta, [[c, op, v]]),
  });
  const snap = (path: string) => {
    const d = docs.get(path);
    return { id: path.split('/').pop() as string, exists: d !== undefined, data: () => (d ? { ...d } : undefined) };
  };
  const ejecutarConsulta = (q: { ruta: string; filtros: Filtro[] }) => {
    const prefijo = `${q.ruta}/`;
    const resultado = Array.from(docs.entries())
      .filter(([p, d]) => p.startsWith(prefijo) && !p.slice(prefijo.length).includes('/') && q.filtros.every((f) => coincide(d, f)))
      .map(([p, d]) => ({ id: p.split('/').pop() as string, data: () => ({ ...d }) }));
    return { docs: resultado, empty: resultado.length === 0, size: resultado.length };
  };
  const db = {
    collection: (nombre: string) => coleccion(nombre),
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const pendientes: (() => void)[] = [];
      const tx = {
        get: async (x: { path?: string; __consulta?: boolean; ruta: string; filtros: Filtro[] }) => (x.__consulta ? ejecutarConsulta(x) : snap(x.path as string)),
        getAll: async (...refs: { path: string }[]) => refs.map((r) => snap(r.path)),
        set: (r: { path: string }, datos: Record<string, unknown>, op?: { merge?: boolean }) => {
          pendientes.push(() => docs.set(r.path, op?.merge ? { ...(docs.get(r.path) ?? {}), ...datos } : { ...datos }));
        },
        update: (r: { path: string }, datos: Record<string, unknown>) => {
          pendientes.push(() => { if (!docs.has(r.path)) throw new Error(`NOT_FOUND ${r.path}`); docs.set(r.path, { ...docs.get(r.path), ...datos }); });
        },
        delete: (r: { path: string }) => { pendientes.push(() => docs.delete(r.path)); },
      };
      const r = await fn(tx);
      pendientes.forEach((p) => p());
      return r;
    },
  };
  return { docs, db };
});

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => falso.db }));
vi.mock('firebase-functions/v2', () => ({ logger: { error: () => {}, info: () => {} } }));
vi.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error { constructor(readonly code: string, mensaje: string) { super(mensaje); } }
  return { HttpsError, onCall: (_o: unknown, fn: unknown) => fn };
});
vi.mock('../src/acceso.js', () => ({ exigirPersonal: async () => {}, EXIGIR_APP_CHECK: false }));
vi.mock('../src/flags.js', () => ({ banderaServidor: async () => true, banderaServidorFresca: async () => true }));
vi.mock('../src/canonico.js', () => ({ catalogoServidor: async () => ({ porId: new Map([['r1', 'CAJA 1']]) }) }));

const mod = await import('../src/dinero');
type Llamable = (req: { auth?: { uid: string }; data: unknown }) => Promise<Datos>;
const llamar = (fn: unknown, data: unknown) => (fn as Llamable)({ auth: { uid: 'u1' }, data });

const op = (extra: Datos = {}): Datos => ({
  ref: 'TR-1', clientePaga: 'EMP1', montoConvenioCliente: 100, monedaConvenioCliente: 'USD', facturadoEnCobrar: '7dca62b3', tipoCambioAprobado: 18, numeroRemolque: 'r1', ...extra,
});

beforeEach(() => {
  falso.docs.clear();
  falso.docs.set('usuarios/u1', { nombre: 'Omar' });
  falso.docs.set('operaciones/o1', op());
  falso.docs.set('operaciones/o2', op({ ref: 'TR-2' }));
});

describe('callables de dinero', () => {
  it('facturar crea la factura determinista, liga las operaciones y traduce el remolque', async () => {
    const r = await llamar(mod.facturarOperaciones, { lado: 'cliente', empresaId: 'EMP1', empresaNombre: 'Acme', invoice: 'A-100', fecha: '2026-10-10', moneda: 'USD', operacionesIds: ['o1', 'o2'] });
    expect(r).toMatchObject({ ok: true, facturaId: 'EMP1_a-100', fusionada: false });
    expect(falso.docs.get('facturas_clientes/EMP1_a-100')).toMatchObject({ subtotalMonedaFactura: 200, remolques: ['CAJA 1'], operacionesIds: ['o1', 'o2'] });
    expect(falso.docs.get('operaciones/o1')).toMatchObject({ facturaClienteId: 'EMP1_a-100', facturado: true });
  });

  it('el mismo folio en otra captura se fusiona (búsqueda sin mayúsculas)', async () => {
    falso.docs.set('facturas_clientes/VIEJA', { invoice: 'a-100', clienteId: 'EMP1', monedaFacturacion: 'USD', operacionesIds: ['o1'], operacionesGuardadas: [{ id: 'o1', ref: 'TR-1', dol: 100, monto: 1800, subtotalBase: 100 }], subtotalMonedaFactura: 100, subtotalFactura: 1800 });
    falso.docs.set('operaciones/o1', op({ facturaClienteId: 'VIEJA' }));
    const r = await llamar(mod.facturarOperaciones, { lado: 'cliente', empresaId: 'EMP1', invoice: 'a-100', moneda: 'USD', operacionesIds: ['o2'] });
    expect(r).toMatchObject({ facturaId: 'VIEJA', fusionada: true });
    expect(falso.docs.get('facturas_clientes/VIEJA')).toMatchObject({ operacionesIds: ['o1', 'o2'], subtotalMonedaFactura: 200 });
  });

  it('los errores de negocio llegan como failed-precondition con el mensaje para el usuario', async () => {
    falso.docs.set('operaciones/o1', op({ facturaClienteId: 'OTRA', facturaClienteInvoice: 'Z-1' }));
    await expect(llamar(mod.facturarOperaciones, { lado: 'cliente', empresaId: 'EMP1', invoice: 'A-1', moneda: 'USD', operacionesIds: ['o1'] }))
      .rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringContaining('ya está en la factura Z-1') });
  });

  it('quitar la última operación borra la factura y libera la operación', async () => {
    await llamar(mod.facturarOperaciones, { lado: 'cliente', empresaId: 'EMP1', invoice: 'B-1', moneda: 'USD', operacionesIds: ['o1'] });
    await llamar(mod.quitarOperacionFactura, { lado: 'cliente', operacionId: 'o1' });
    expect(falso.docs.has('facturas_clientes/EMP1_b-1')).toBe(false);
    expect(falso.docs.get('operaciones/o1')).toMatchObject({ facturaClienteId: null, facturado: false });
  });

  it('registrar un pago dos veces (reintento) lo aplica una sola vez; eliminarlo revierte', async () => {
    falso.docs.set('facturas_clientes/F1', { invoice: 'A-1', monedaFacturacion: 'USD', subtotalMonedaFactura: 1000, montoPagado: 0 });
    const pago = {
      tipo: 'cliente', pagoId: 'P1', numeroPago: 'PAGO-1', fecha: '2026-10-10', entidadId: 'EMP1', entidadNombre: 'Acme', monto: 400,
      aplicacion: [{ facturaId: 'F1', invoice: 'A-1', aplicado: 400 }],
    };
    await llamar(mod.registrarPago, pago);
    const segunda = await llamar(mod.registrarPago, pago);
    expect(segunda).toMatchObject({ yaExistia: true });
    expect(falso.docs.get('facturas_clientes/F1')).toMatchObject({ montoPagado: 400, saldoPendiente: 600, statusPago: 'PARCIAL', pagosIds: ['P1'] });
    expect(falso.docs.get('pagos/P1')).toMatchObject({ creadoPor: 'Omar', montoAplicado: 400 });
    await llamar(mod.eliminarPago, { pagoId: 'P1' });
    expect(falso.docs.has('pagos/P1')).toBe(false);
    expect(falso.docs.get('facturas_clientes/F1')).toMatchObject({ montoPagado: 0, saldoPendiente: 1000, statusPago: '', pagosIds: [] });
  });

  it('un folio con otras mayúsculas encuentra la factura por su ID determinista (no duplica)', async () => {
    falso.docs.set('facturas_clientes/EMP1_fa-100', { invoice: 'Fa-100', clienteId: 'EMP1', monedaFacturacion: 'USD', operacionesIds: ['o1'], operacionesGuardadas: [{ id: 'o1', ref: 'TR-1', dol: 100, monto: 1800 }], subtotalMonedaFactura: 100 });
    falso.docs.set('operaciones/o1', op({ facturaClienteId: 'EMP1_fa-100' }));
    const r = await llamar(mod.facturarOperaciones, { lado: 'cliente', empresaId: 'EMP1', invoice: 'FA-100', moneda: 'USD', operacionesIds: ['o2'] });
    expect(r).toMatchObject({ facturaId: 'EMP1_fa-100', fusionada: true });
    expect(Array.from(falso.docs.keys()).filter((k) => k.startsWith('facturas_clientes/'))).toEqual(['facturas_clientes/EMP1_fa-100']);
  });

  it('quitar encuentra la factura importada (IDs en texto) por el apuntador de la operación', async () => {
    falso.docs.set('facturas_clientes/CSV1', { invoice: 'C-1', clienteId: 'EMP1', operacionesIds: 'o1,o2', operaciones: 'TR-1,TR-2', subtotalMonedaFactura: 0 });
    falso.docs.set('operaciones/o1', op({ facturaClienteId: 'CSV1', facturaClienteInvoice: 'C-1', facturado: true }));
    await llamar(mod.quitarOperacionFactura, { lado: 'cliente', operacionId: 'o1' });
    expect(falso.docs.get('facturas_clientes/CSV1')).toMatchObject({ operacionesIds: ['o2'] });
    expect(falso.docs.get('operaciones/o1')).toMatchObject({ facturaClienteId: null, facturado: false });
  });

  it('editar un pago devuelve el pago como quedó', async () => {
    falso.docs.set('facturas_clientes/F1', { invoice: 'A-1', monedaFacturacion: 'USD', subtotalMonedaFactura: 1000, montoPagado: 0 });
    await llamar(mod.registrarPago, { tipo: 'cliente', pagoId: 'P2', numeroPago: 'PAGO-2', fecha: '2026-10-10', monto: 100, aplicacion: [{ facturaId: 'F1', invoice: 'A-1', aplicado: 100 }] });
    const r = await llamar(mod.editarPago, { pagoId: 'P2', fecha: '2026-10-11', numeroPago: 'PAGO-2B' });
    expect(r.pago).toMatchObject({ id: 'P2', numeroPago: 'PAGO-2B', fecha: '2026-10-11', monto: 100 });
  });

  it('valida el payload con zod', async () => {
    await expect(llamar(mod.registrarPago, { tipo: 'otro' })).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

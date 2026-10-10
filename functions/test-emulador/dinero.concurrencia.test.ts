// ✅ V00441 (Fase 5) — PRUEBA DE CONCURRENCIA en el emulador (regla global 4 del plan).
// Llama a las callables de verdad (transacciones del Admin SDK contra el emulador):
//   · 10 pagos simultáneos de 200 sobre una factura de 1,000 → entran exactamente 5;
//     el saldo nunca queda negativo ni se pierde un pago.
//   · la misma operación facturada a la vez en dos folios → solo una gana.
// Correr: npm --prefix functions run test:emulador
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getFirestore } from 'firebase-admin/firestore';

const hayEmulador = !!process.env.FIRESTORE_EMULATOR_HOST;

vi.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error { constructor(readonly code: string, mensaje: string) { super(mensaje); } }
  return { HttpsError, onCall: (_o: unknown, fn: unknown) => fn };
});
vi.mock('../src/acceso.js', () => ({ exigirPersonal: async () => {}, EXIGIR_APP_CHECK: false }));
vi.mock('../src/flags.js', () => ({ banderaServidor: async () => true }));

type Llamable = (req: { auth?: { uid: string }; data: unknown }) => Promise<Record<string, unknown>>;

describe.skipIf(!hayEmulador)('dinero con transacciones reales (emulador)', () => {
  let mod: typeof import('../src/dinero');
  const llamar = (fn: unknown, data: unknown) => (fn as Llamable)({ auth: { uid: 'u1' }, data });

  beforeAll(async () => {
    process.env.GCLOUD_PROJECT ??= 'demo-roelca';
    mod = await import('../src/dinero');
    const db = getFirestore();
    await db.doc('usuarios/u1').set({ nombre: 'Prueba' });
  });

  it('10 pagos simultáneos sobre la misma factura: entran solo los que caben en el saldo', async () => {
    const db = getFirestore();
    await db.doc('facturas_clientes/FC1').set({ invoice: 'C-1', clienteId: 'E1', monedaFacturacion: 'USD', subtotalMonedaFactura: 1000, montoPagado: 0 });
    const pagos = Array.from({ length: 10 }, (_, i) => llamar(mod.registrarPago, {
      tipo: 'cliente', pagoId: `PC${i}`, numeroPago: `P-${i}`, fecha: '2026-10-10', entidadId: 'E1', entidadNombre: 'Prueba', monto: 200,
      aplicacion: [{ facturaId: 'FC1', invoice: 'C-1', aplicado: 200 }],
    }));
    const resultados = await Promise.allSettled(pagos);
    const ok = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(5);
    const fac = (await db.doc('facturas_clientes/FC1').get()).data() as Record<string, unknown>;
    expect(fac).toMatchObject({ montoPagado: 1000, saldoPendiente: 0, statusPago: 'PAGADA' });
    expect((fac.pagosIds as string[]).length).toBe(5);
    const guardados = await db.collection('pagos').where('numeroPago', 'in', Array.from({ length: 10 }, (_, i) => `P-${i}`)).get();
    expect(guardados.size).toBe(5);
  });

  it('la misma operación facturada a la vez en dos folios: solo una factura la contiene', async () => {
    const db = getFirestore();
    await db.doc('operaciones/OPX').set({ ref: 'TR-X', clientePaga: 'E2', montoConvenioCliente: 100, monedaConvenioCliente: 'USD', facturadoEnCobrar: '7dca62b3', tipoCambioAprobado: 18 });
    const intento = (folio: string) => llamar(mod.facturarOperaciones, { lado: 'cliente', empresaId: 'E2', invoice: folio, moneda: 'USD', operacionesIds: ['OPX'] });
    const r = await Promise.allSettled([intento('X-1'), intento('X-2')]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
    const con = await db.collection('facturas_clientes').where('operacionesIds', 'array-contains', 'OPX').get();
    expect(con.size).toBe(1);
  });
});

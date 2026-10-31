// @vitest-environment jsdom
// ✅ V00538 — Tomar lo de la factura: se relee cada operación y su factura al escribir.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';

const bd = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), escritos: [] as [string, Record<string, unknown>][] }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    get: async (ref: string) => ({ exists: () => bd.docs.has(ref), data: () => bd.docs.get(ref) }),
    update: (ref: string, datos: Record<string, unknown>) => { bd.escritos.push([ref, datos]); },
  }),
}));
vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../utils/logger', () => ({ registrarLog: vi.fn(async () => {}) }));
vi.mock('../../../shared/data/consultas', () => ({
  porIds: vi.fn(async (col: string, ids: readonly string[]) => ids.filter((id) => bd.docs.has(`${col}/${id}`)).map((id) => {
    const d = { id, ...bd.docs.get(`${col}/${id}`) };
    Object.defineProperty(d, '_docId', { value: id, enumerable: false });
    return d;
  })),
}));
vi.mock('./corregirMonedaConvenioDatos', async () => {
  const { indexarConvenios } = await import('./corregirMonedaConvenio');
  return { leerConvenios: async () => ({ cliente: { ...indexarConvenios([{ id: 'det-usd', moneda: ID_USD }], []), monedaEmpresa: new Map([['emp61', 'MXN']]) }, proveedor: indexarConvenios([], []) }) };
});

import { aplicarTomarDeFactura, prepararTomarDeFactura } from './tomarDeFacturaDatos';
import { suscribirOperacionGuardada } from '../../../utils/operacionesBus';

const op = {
  ref: 'LO-130126-6', clientePaga: 'emp61', convenio: 'det-usd', montoConvenioCliente: 130, cargosAdicionales: 0, monedaConvenioCliente: ID_USD,
  facturadoEnCobrar: ID_USD, monedaCobroNombre: 'Dólares', tipoCambioAprobado: 17.91,
  subtotalCliente: 130, dolaresCliente: 130, pesosCliente: 0, conversionCliente: 2328.3, facturaClienteId: 'F1', facturaClienteInvoice: 'I1', facturado: true,
};
const factura = { invoice: 'I1', monedaFacturacion: ID_MXN, operacionesGuardadas: [{ id: 'o1', monto: 2328.3 }, { id: 'o2', monto: 2328.3 }] };

describe('tomarDeFacturaDatos', () => {
  beforeEach(() => {
    bd.escritos = [];
    bd.docs = new Map<string, Record<string, unknown>>([['operaciones/o1', { ...op }], ['operaciones/o2', { ...op }], ['facturas_clientes/F1', factura]]);
  });
  it('prepara con lo de hoy y escribe las que siguen cuadrando; avisa al bus', async () => {
    const prep = await prepararTomarDeFactura(['o1', 'o2']);
    expect(prep.planes.map((p) => p.estado)).toEqual(['corregir', 'corregir']);
    // Entre la prueba y aplicar, alguien cambió el monto de o2: ya no cuadra con su factura.
    bd.docs.set('operaciones/o2', { ...op, conversionCliente: 999, montoConvenioCliente: 50 });
    const avisos: string[] = [];
    const baja = suscribirOperacionGuardada((d) => avisos.push(d.id));
    const r = await aplicarTomarDeFactura(prep, 'AHORA', () => {});
    baja();
    expect(r.hechas).toBe(1);
    expect(r.omitidas).toEqual([expect.objectContaining({ id: 'o2', motivo: expect.stringMatching(/^Cambió desde la prueba/) })]);
    expect(bd.escritos).toEqual([['operaciones/o1', expect.objectContaining({ facturadoEnCobrar: ID_MXN, pesosCliente: 2328.3, montosDeFacturaEn: 'AHORA' })]]);
    expect(avisos).toEqual(['o1']);
  });
});

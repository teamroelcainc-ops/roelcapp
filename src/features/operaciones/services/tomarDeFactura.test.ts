// ✅ V00538 — D1/D4 facturadas: la factura emitida manda (solo si cuadra con lo facturado).
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { indexarConvenios } from './corregirMonedaConvenio';
import type { CatalogoConvenios } from './corregirMonedaConvenio';
import { filasPruebaTomarDeFactura, MOTIVO_SIN_FACTURAR, planTomarDeFactura, renglonDeOperacion, respaldoTomarDeFactura } from './tomarDeFactura';

const cat: CatalogoConvenios = {
  cliente: { ...indexarConvenios([{ id: 'det-usd', moneda: ID_USD }], []), monedaEmpresa: new Map([['emp61', 'MXN' as const]]) },
  proveedor: indexarConvenios([], []),
};
// LO-130126-6 (Caro-Kar, cliente en Pesos): convenio 130 USD, TC 17.91, guardada "Facturado en" Dólares.
const op = {
  ref: 'LO-130126-6', clientePaga: 'emp61', convenio: 'det-usd', montoConvenioCliente: 130, cargosAdicionales: 0, monedaConvenioCliente: ID_USD,
  facturadoEnCobrar: ID_USD, monedaCobroNombre: 'Dólares', tipoCambioAprobado: 17.91,
  subtotalCliente: 130, dolaresCliente: 130, pesosCliente: 0, conversionCliente: 2328.3, conversionProv: 1000, utilidadEstimada: 1328.3,
  facturaClienteId: 'F1', facturaClienteInvoice: 'I8368', facturado: true,
};
const factura = (extra: Record<string, unknown> = {}) => ({ invoice: 'I8368', monedaFacturacion: ID_MXN, operacionesGuardadas: [{ id: 'o1', ref: 'LO-130126-6', monto: 2328.3 }], ...extra });

describe('tomar lo de la factura (D1/D4 facturadas)', () => {
  it('cuadra con su factura (Pesos, $2,328.30): toma "Facturado en" Pesos y el desglose de la regla', () => {
    const p = planTomarDeFactura('o1', op, factura(), cat);
    expect(p.estado).toBe('corregir');
    expect(p.datos).toEqual({ facturadoEnCobrar: ID_MXN, monedaCobroNombre: 'Pesos', subtotalCliente: 2328.3, dolaresCliente: 0, pesosCliente: 2328.3 });
    expect(p).toMatchObject({ facturado: 2328.3, monedaFactura: 'Pesos', invoice: 'I8368', facturaId: 'F1' });
  });
  it('la factura está en otra moneda que la empresa: a mano', () => {
    const p = planTomarDeFactura('o1', op, factura({ monedaFacturacion: ID_USD }), cat);
    expect(p.estado).toBe('manual');
    expect(p.motivo).toMatch(/La factura está en Dólares y la empresa factura en Pesos/);
    expect(p.datos).toBeNull();
  });
  it('lo facturado no sale de su convenio y TC: a mano, con los dos montos', () => {
    const p = planTomarDeFactura('o1', op, factura({ operacionesGuardadas: [{ id: 'o1', monto: 2000 }] }), cat);
    expect(p.estado).toBe('manual');
    expect(p.motivo).toMatch(/Se facturó 2000.00 Pesos y con su convenio y TC da 2328.30/);
  });
  it('sin facturar, sin factura, factura sin moneda o sin su renglón: a mano', () => {
    expect(planTomarDeFactura('o1', { ...op, facturaClienteId: '', facturaClienteInvoice: '', facturado: false }, factura(), cat).motivo).toBe(MOTIVO_SIN_FACTURAR);
    expect(planTomarDeFactura('o1', op, null, cat).motivo).toMatch(/Su factura no existe/);
    expect(planTomarDeFactura('o1', op, factura({ monedaFacturacion: '' }), cat).motivo).toMatch(/no tiene moneda/);
    expect(planTomarDeFactura('o1', op, factura({ operacionesGuardadas: [{ id: 'otra', ref: 'X', monto: 1 }] }), cat).motivo).toMatch(/no tiene el renglón/);
  });
  it('el renglón se encuentra por id del documento, `id` guardado o referencia', () => {
    const f = factura({ operacionesGuardadas: [{ id: 'APP-9', ref: 'otra', monto: 1 }, { id: '', ref: 'lo-130126-6', monto: 2 }] });
    expect(renglonDeOperacion(f, 'o1', { ...op, id: 'APP-9' })?.monto).toBe(1);
    expect(renglonDeOperacion(f, 'o1', op)?.monto).toBe(2);
  });
  it('prueba y respaldo', () => {
    const planes = [planTomarDeFactura('o1', op, factura(), cat), planTomarDeFactura('o2', op, null, cat)];
    const filas = filasPruebaTomarDeFactura(planes);
    expect(filas[0]).toMatchObject({ 'Acción': 'Se corrige con lo de la factura', 'facturadoEnCobrar antes': ID_USD, 'facturadoEnCobrar después': ID_MXN, 'conversionCliente después': '2328.3' });
    expect(filas[1]).toMatchObject({ 'Acción': 'No se toca (a mano)' });
    expect(respaldoTomarDeFactura(planes, 'hoy', 'u').operaciones).toEqual([{ id: 'o1', ref: 'LO-130126-6', campos: expect.objectContaining({ facturadoEnCobrar: ID_USD, dolaresCliente: 130 }) }]);
  });
});

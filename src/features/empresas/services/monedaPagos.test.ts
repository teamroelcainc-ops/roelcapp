// ✅ V00496 — Moneda de la empresa → pagos: no se separa un pago de la moneda de sus facturas emitidas.
import { describe, expect, it } from 'vitest';
import { coleccionFacturasDePago, facturaEnOtraMoneda, facturasDelPago, facturaTomaMoneda, monedaFinalDeFactura, pagoTomaMoneda } from './monedaPagos';
import type { Moneda } from '../../../shared/dominio/moneda';

const facturas: Record<string, Moneda | null> = {
  'facturas_clientes/emitidaMXN': 'MXN',
  'facturas_clientes/emitidaUSD': 'USD',
  'facturas_proveedores/p1': 'USD',
};
const final = (col: string, id: string): Moneda | null | undefined => facturas[`${col}/${id}`];

describe('monedaPagos', () => {
  it('colección y facturas del pago', () => {
    expect([coleccionFacturasDePago('cliente'), coleccionFacturasDePago('Proveedor'), coleccionFacturasDePago('mtto')]).toEqual(['facturas_clientes', 'facturas_proveedores', null]);
    expect(facturasDelPago({ facturas: [{ facturaId: 'a' }, { facturaId: 'a' }, { facturaId: '' }, null, { facturaId: 'b' }] })).toEqual(['a', 'b']);
  });
  it('factura emitida en otra moneda: se queda; borrador: la nueva', () => {
    expect(facturaTomaMoneda({ statusFactura: 'Facturado' }, true)).toBe(false);
    expect(facturaTomaMoneda({}, true)).toBe(false); // sin status = Facturado
    expect(facturaTomaMoneda({ statusFactura: 'No Facturado' }, true)).toBe(true);
    expect(facturaTomaMoneda({ statusFactura: 'No Facturado' }, false)).toBe(false);
    expect(monedaFinalDeFactura({ moneda: 'MXN' }, 'USD', false)).toBe('MXN');
    expect(monedaFinalDeFactura({ moneda: 'MXN' }, 'USD', true)).toBe('USD');
  });
  it('la moneda que se lee es la de monedaFacturacion (Editar factura), aunque moneda/monedaId digan otra', () => {
    // Propagada antes a USD y luego editada a mano a Pesos: no está "en la moneda nueva".
    const editada = { statusFactura: 'Facturado', monedaFacturacion: 'Pesos', moneda: 'USD', monedaId: 'ID-USD' };
    expect(facturaEnOtraMoneda(editada, 'USD', 'ID-USD')).toBe(true);
    expect(monedaFinalDeFactura(editada, 'USD', facturaTomaMoneda(editada, true))).toBe('MXN');
    expect(facturaEnOtraMoneda({ monedaFacturacion: 'Dólares', moneda: 'USD', monedaId: 'ID-USD' }, 'USD', 'ID-USD')).toBe(false);
  });
  it('el pago solo cambia si todas sus facturas quedan en la moneda nueva', () => {
    expect(pagoTomaMoneda({ tipo: 'cliente', facturas: [{ facturaId: 'emitidaMXN' }] }, 'USD', final)).toBe(false);
    expect(pagoTomaMoneda({ tipo: 'cliente', facturas: [{ facturaId: 'emitidaUSD' }, { facturaId: 'emitidaMXN' }] }, 'USD', final)).toBe(false);
    expect(pagoTomaMoneda({ tipo: 'cliente', facturas: [{ facturaId: 'emitidaUSD' }] }, 'USD', final)).toBe(true);
    expect(pagoTomaMoneda({ tipo: 'proveedor', facturas: [{ facturaId: 'p1' }] }, 'USD', final)).toBe(true);
    expect(pagoTomaMoneda({ tipo: 'cliente', facturas: [{ facturaId: 'no-existe' }] }, 'USD', final)).toBe(false);
  });
  it('sin facturas aplicadas o de MTTO: sigue la moneda de la empresa', () => {
    expect(pagoTomaMoneda({ tipo: 'cliente', facturas: [] }, 'USD', final)).toBe(true);
    expect(pagoTomaMoneda({ tipo: 'mtto', facturas: [{ facturaId: 'x' }] }, 'USD', final)).toBe(true);
  });
});

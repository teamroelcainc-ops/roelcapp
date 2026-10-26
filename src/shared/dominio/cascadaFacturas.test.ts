// ✅ V00494 — la cascada a las facturas solo recalcula importes cuando cambia dinero.
import { describe, expect, it } from 'vitest';
import { cambioParaFacturas, valorCongelado } from './cascadaFacturas';

const base = {
  montoConvenioCliente: 130, cargosAdicionales: 0, facturadoEnCobrar: 'mxn', monedaConvenioCliente: 'usd', tipoCambioAprobado: 17.91,
  conversionCliente: 2328.3, convenioNombre: 'CONV A', refCliente: 'PO-1', monedaCobroNombre: 'Pesos', tipoCambioDia: 17.9,
  totalAPagarProv: 100, conversionProv: 1791, convenioProveedorNombre: 'PROV A', monedaUnidadNombre: 'Pesos',
};

describe('cambioParaFacturas', () => {
  it('un monto o una entrada de dinero → recalcula ese lado', () => {
    expect(cambioParaFacturas(base, { ...base, montoConvenioCliente: 150 })).toEqual({ cliente: 'dinero', proveedor: null });
    expect(cambioParaFacturas(base, { ...base, tipoCambioAprobado: 18 })).toEqual({ cliente: 'dinero', proveedor: 'dinero' });
    expect(cambioParaFacturas(base, { ...base, conversionProv: 1800 })).toEqual({ cliente: null, proveedor: 'dinero' });
  });
  it('solo el nombre del convenio o la Ref Cliente → solo texto (no se tocan importes)', () => {
    expect(cambioParaFacturas(base, { ...base, convenioNombre: 'CONV B' })).toEqual({ cliente: 'texto', proveedor: null });
    expect(cambioParaFacturas(base, { ...base, refCliente: 'PO-2' }).cliente).toBe('texto');
    expect(cambioParaFacturas(base, { ...base, convenioProveedorNombre: 'PROV B' })).toEqual({ cliente: null, proveedor: 'texto' });
  });
  it('copias de nombres de moneda, tipoCambioDia o el mismo monto en otro formato → nada', () => {
    expect(cambioParaFacturas(base, { ...base, monedaCobroNombre: 'MXN', monedaUnidadNombre: 'MXN', tipoCambioDia: 18.3 })).toEqual({ cliente: null, proveedor: null });
    expect(cambioParaFacturas(base, { ...base, conversionCliente: '2328.30', cargosAdicionales: '' })).toEqual({ cliente: null, proveedor: null });
  });
});

// ✅ V00495: una factura emitida no cambia de valor sola.
describe('valorCongelado', () => {
  it('Facturado, sin status, Cancelado u otro: congelada; solo el borrador No Facturado sigue a sus operaciones', () => {
    expect(['Facturado', '', undefined, 'Cancelado', 'Pagada'].map(valorCongelado)).toEqual([true, true, true, true, true]);
    expect(['No Facturado', 'no  facturado', 'NO FACTURADO'].map(valorCongelado)).toEqual([false, false, false]);
  });
});

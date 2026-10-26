// ✅ V00494 — una operación facturada no recalcula sola sus montos.
import { describe, expect, it } from 'vitest';
import { conservarMontosGuardados, facturadaDeLado, mismoDato, montosARestaurar } from './montosCongelados';

const op = {
  facturaClienteId: 'F1', montoConvenioCliente: '130.00', cargosAdicionales: 0, tipoCambioAprobado: 17.91,
  facturadoEnCobrar: 'usd-id', monedaConvenioCliente: 'usd-id', totalAPagarProv: 100, facturadoEnUnidad: 'mxn-id',
};

describe('montos congelados', () => {
  it('mismoDato: texto y número, vacío = 0', () => {
    expect(mismoDato('1250.50', 1250.5)).toBe(true);
    expect(mismoDato('', 0)).toBe(true);
    expect(mismoDato(undefined, 0)).toBe(true);
    expect(mismoDato('usd-id', 'mxn-id')).toBe(false);
    expect(mismoDato(17.91, 17.9)).toBe(false);
  });
  it('facturada del cliente y sin cambios en sus entradas → se conservan los montos', () => {
    expect(conservarMontosGuardados('cliente', { ...op, montoConvenioCliente: 130 }, op)).toBe(true);
  });
  it('si alguien cambia a mano una entrada, sí se recalcula', () => {
    expect(conservarMontosGuardados('cliente', { ...op, montoConvenioCliente: 150 }, op)).toBe(false);
    expect(conservarMontosGuardados('cliente', { ...op, facturadoEnCobrar: 'mxn-id' }, op)).toBe(false);
    expect(conservarMontosGuardados('cliente', { ...op, tipoCambioAprobado: 18.2 }, op)).toBe(false);
  });
  it('regresa los montos guardados si un cálculo previo los cambió', () => {
    const guardada = { ...op, subtotalCliente: 2328.3, dolaresCliente: 0, pesosCliente: 2328.3, conversionCliente: '2328.30' };
    expect(montosARestaurar('cliente', guardada, guardada)).toBeNull();
    expect(montosARestaurar('cliente', { ...guardada, subtotalCliente: 0, pesosCliente: 0, conversionCliente: 0 }, guardada))
      .toEqual({ subtotalCliente: 2328.3, dolaresCliente: 0, pesosCliente: 2328.3, conversionCliente: 2328.3 });
  });
  it('sin facturar (o nueva) se recalcula como siempre; cada lado por su factura', () => {
    expect(conservarMontosGuardados('cliente', op, { ...op, facturaClienteId: '' })).toBe(false);
    expect(conservarMontosGuardados('cliente', op, null)).toBe(false);
    expect(facturadaDeLado('proveedor', op)).toBe(false);
    expect(conservarMontosGuardados('proveedor', op, { ...op, facturaProveedorFolio: 'P-1' })).toBe(true);
  });
});

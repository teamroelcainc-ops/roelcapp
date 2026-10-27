// ✅ V00503 — Validación del Excel de operaciones: ok / error y su motivo (lado cliente).
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD, STATUS_CANCELADO } from '../../../shared/dominio/constantes';
import type { Moneda } from '../../../shared/dominio/moneda';
import { MOTIVO_CANCELADA, empresaClienteDe, textoMonedaEmpresa, validarOperacionExcel } from './validacionExcel';

/** eU factura en Dólares, eM en Pesos; eX está en Empresas pero sin moneda. */
const MONEDAS = new Map<string, Moneda>([['eU', 'USD'], ['eM', 'MXN']]);
const TC = 18.5;
const base = (extra: Record<string, unknown>) => ({ status: 's3', clientePaga: 'eU', convenio: 'cv1', montoConvenioCliente: 100, cargosAdicionales: 0, tipoCambioDia: TC, ...extra });

// Los cuatro casos de la regla (convenio · cobro), con los montos bien guardados.
const usdUsd = base({ monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD, dolaresCliente: 100, pesosCliente: 0, conversionCliente: 1850 });
const usdMxn = base({ clientePaga: 'eM', monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_MXN, dolaresCliente: 0, pesosCliente: 1850, conversionCliente: 1850 });
const mxnMxn = base({ clientePaga: 'eM', montoConvenioCliente: 2000, monedaConvenioCliente: ID_MXN, facturadoEnCobrar: ID_MXN, pesosCliente: 2000, conversionCliente: 2000 });
const mxnUsd = base({ montoConvenioCliente: 1850, monedaConvenioCliente: ID_MXN, facturadoEnCobrar: ID_USD, dolaresCliente: 100, conversionCliente: 1850 });

describe('validarOperacionExcel', () => {
  it('los cuatro casos de la regla, bien guardados → ok', () => {
    [usdUsd, usdMxn, mxnMxn, mxnUsd].forEach((op) => expect(validarOperacionExcel(op, MONEDAS)).toEqual({ estado: 'ok', motivos: [] }));
  });

  it('montos que no cuadran: dice cuál y cuánto debe ser', () => {
    const sinTC = { ...usdMxn, pesosCliente: 100, conversionCliente: 100 }; // convenio en dólares sin multiplicar por el TC
    expect(validarOperacionExcel(sinTC, MONEDAS)).toEqual({
      estado: 'error',
      motivos: ['Montos que no cuadran (convenio en Dólares, cobro en Pesos): Pesos 100.00, debe ser 1,850.00; Conversión 100.00, debe ser 1,850.00'],
    });
    const conversionSinTC = { ...usdUsd, conversionCliente: 100 };
    expect(validarOperacionExcel(conversionSinTC, MONEDAS).motivos).toEqual(['Montos que no cuadran (convenio en Dólares, cobro en Dólares): Conversión 100.00, debe ser 1,850.00']);
  });

  it('un centavo de redondeo se acepta; dos no', () => {
    expect(validarOperacionExcel({ ...usdUsd, conversionCliente: 1850.01 }, MONEDAS).estado).toBe('ok');
    expect(validarOperacionExcel({ ...usdUsd, conversionCliente: 1850.02 }, MONEDAS).estado).toBe('error');
  });

  it('moneda distinta a la empresa: lo dice, y los montos se revisan con la moneda de la empresa', () => {
    const cobroEnDolares = { ...usdUsd, clientePaga: 'eM' }; // la empresa factura en Pesos
    const r = validarOperacionExcel(cobroEnDolares, MONEDAS);
    expect(r.estado).toBe('error');
    expect(r.motivos[0]).toBe('Moneda distinta a la empresa: cobro en Dólares, la empresa factura en Pesos');
    expect(r.motivos[1]).toBe('Montos que no cuadran (convenio en Dólares, cobro en Pesos): Dólares 100.00, debe ser 0.00; Pesos 0.00, debe ser 1,850.00');
  });

  it('faltan datos: cliente, convenio, monto, moneda de cobro', () => {
    expect(validarOperacionExcel({ status: 's3' }, MONEDAS)).toEqual({
      estado: 'error', motivos: ['Faltan datos: cliente que paga, convenio, monto del convenio, moneda de cobro'],
    });
  });

  it('falta el tipo de cambio cuando la regla lo usa (y entonces no se revisan montos)', () => {
    const sinTC = { ...usdUsd, tipoCambioDia: 0 };
    expect(validarOperacionExcel(sinTC, MONEDAS).motivos).toEqual(['Faltan datos: tipo de cambio']);
    // Pesos con convenio en pesos no lo necesita.
    expect(validarOperacionExcel({ ...mxnMxn, tipoCambioDia: 0 }, MONEDAS).estado).toBe('ok');
  });

  it('la empresa no tiene moneda en Empresas: falta, y los montos se revisan con la moneda de cobro', () => {
    expect(validarOperacionExcel({ ...usdUsd, clientePaga: 'eX' }, MONEDAS).motivos).toEqual(['Faltan datos: moneda de la empresa en Empresas']);
    expect(validarOperacionExcel({ ...usdUsd, clientePaga: 'eX', conversionCliente: 100 }, MONEDAS).motivos[1]).toMatch(/^Montos que no cuadran/);
  });

  it('sin moneda del convenio: se usa la deducida de la conversión; si no se puede, falta', () => {
    expect(validarOperacionExcel({ ...usdUsd, monedaConvenioCliente: '' }, MONEDAS).estado).toBe('ok');
    expect(validarOperacionExcel({ ...usdUsd, monedaConvenioCliente: '', conversionCliente: 0, dolaresCliente: 0 }, MONEDAS).motivos)
      .toEqual(['Faltan datos: moneda del convenio']);
  });

  it('acepta los mismos campos que el servidor (clienteId, convenioId) y el TC aprobado antes que el del día', () => {
    const otrosCampos = { ...usdUsd, clientePaga: '', clienteId: 'eU', convenio: '', convenioId: 'cv1' };
    expect(validarOperacionExcel(otrosCampos, MONEDAS).estado).toBe('ok');
    expect(validarOperacionExcel({ ...usdUsd, tipoCambioAprobado: 20, tipoCambioDia: TC }, MONEDAS).motivos)
      .toEqual(['Montos que no cuadran (convenio en Dólares, cobro en Dólares): Conversión 1,850.00, debe ser 2,000.00']);
  });

  it('las canceladas no se revisan', () => {
    expect(validarOperacionExcel({ status: STATUS_CANCELADO }, MONEDAS)).toEqual({ estado: 'ok', motivos: [MOTIVO_CANCELADA] });
  });
});

describe('moneda de la empresa', () => {
  it('el primer id que está en Empresas; texto Dólares / Pesos / Sin moneda / -', () => {
    expect(empresaClienteDe({ clientePaga: 'eX', clientePagaId: 'eM' }, MONEDAS)).toEqual({ id: 'eM', moneda: 'MXN' });
    expect(textoMonedaEmpresa({ clientePaga: 'eU' }, MONEDAS)).toBe('Dólares');
    expect(textoMonedaEmpresa({ clientePaga: 'eM' }, MONEDAS)).toBe('Pesos');
    expect(textoMonedaEmpresa({ clientePaga: 'eX' }, MONEDAS)).toBe('Sin moneda');
    expect(textoMonedaEmpresa({}, MONEDAS)).toBe('-');
  });
});

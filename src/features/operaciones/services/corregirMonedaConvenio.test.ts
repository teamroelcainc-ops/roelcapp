// ✅ V00487 — Corregir monedas de convenio: qué moneda le toca a cada operación sin ella.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { indexarConvenios, MOTIVO_SIN_DATOS, monedaDelConvenio, resumirOperaciones, revisarOperacion } from './corregirMonedaConvenio';
import type { CatalogoConvenios } from './corregirMonedaConvenio';

const cat: CatalogoConvenios = {
  cliente: indexarConvenios(
    [{ id: 'det-usd', moneda: 'Dólares', convenioId: 'M1' }, { id: 'det-sin', convenioId: 'M2' }, { id: 'det-mxn', moneda: ID_MXN }],
    [{ id: 'M1', monedaId: ID_USD }, { id: 'x', numeroConvenio: 'M2', moneda: 'Pesos' }],
  ),
  proveedor: indexarConvenios([{ id: 'dp', moneda: ID_USD }], []),
};

// LO-050626-002 (Juan Carlos Quintanar): convenio 115 sin moneda, facturado en pesos, TC 17.2888.
const quintanar = {
  ref: 'LO-050626-002', convenio: 'det-usd', montoConvenioCliente: 115, cargosAdicionales: 0, monedaConvenioCliente: '',
  facturadoEnCobrar: ID_MXN, tipoCambioAprobado: 17.2888, subtotalCliente: 115, dolaresCliente: 0, pesosCliente: 1988.21,
  conversionCliente: 1988.21, conversionProv: 1037.33, utilidadEstimada: 950.88,
};

describe('moneda del convenio', () => {
  it('la del detalle; si no trae, la de su maestro (por id o por número)', () => {
    expect(monedaDelConvenio({ convenio: 'det-usd' }, 'cliente', cat)).toBe('USD');
    expect(monedaDelConvenio({ convenio: 'det-sin' }, 'cliente', cat)).toBe('MXN');
    expect(monedaDelConvenio({ convenio: 'det-mxn' }, 'cliente', cat)).toBe('MXN');
    expect(monedaDelConvenio({ convenio: 'no-existe' }, 'cliente', cat)).toBeNull();
    expect(monedaDelConvenio({ convenioProveedor: 'dp' }, 'proveedor', cat)).toBe('USD');
  });
});

describe('revisar una operación', () => {
  it('Quintanar: convenio y conversión dicen Dólares → se guarda la moneda y el subtotal en pesos', () => {
    const r = revisarOperacion('o1', quintanar, cat);
    expect(r?.estado).toBe('corregir');
    expect(r?.cambios).toEqual([{ lado: 'cliente', moneda: 'USD', fuente: 'ambas', subtotalAntes: 115, subtotalDespues: 1988.21, monedaFactura: 'MXN', convAntes: 1988.21, convDespues: 1988.21, cambiaFactura: false }]);
    // La conversión ya estaba bien: solo cambian la moneda y el subtotal (115 → 1,988.21, como lo guarda el formulario).
    expect(r?.datos).toEqual({ monedaConvenioCliente: ID_USD, subtotalCliente: 1988.21 });
  });
  it('solo con el convenio (sin conversión guardada): se calcula la conversión y la utilidad', () => {
    const op = { ...quintanar, conversionCliente: 0, pesosCliente: 0, utilidadEstimada: 0 };
    const r = revisarOperacion('o1', op, cat);
    // sin conversión guardada la V00486 no podía deducir: Facturación tomaba $115; ahora $1,988.21
    expect(r?.cambios[0]).toMatchObject({ fuente: 'convenio', convAntes: 0, convDespues: 1988.21, cambiaFactura: true });
    expect(r?.datos).toMatchObject({ monedaConvenioCliente: ID_USD, pesosCliente: 1988.21, conversionCliente: 1988.21, utilidadEstimada: 950.88 });
  });
  it('solo con la conversión guardada (convenio sin moneda): la deducida', () => {
    const r = revisarOperacion('o1', { ...quintanar, convenio: '' }, cat);
    expect(r?.cambios[0]).toMatchObject({ moneda: 'USD', fuente: 'conversion' });
  });
  it('convenio y conversión no coinciden: a revisar, sin escribir', () => {
    // conversión que quedó sin multiplicar por el TC (115 = el convenio) con un convenio en dólares
    const r = revisarOperacion('o1', { ...quintanar, conversionCliente: 115, pesosCliente: 115 }, cat);
    expect(r?.estado).toBe('revisar');
    expect(r?.datos).toBeNull();
    expect(r?.avisos[0].motivo).toMatch(/Dólares.*Pesos/);
  });
  it('sin convenio ni conversión: se salta; ya con moneda o sin monto: nada que hacer', () => {
    const sin = revisarOperacion('o1', { ...quintanar, convenio: '', conversionCliente: 0 }, cat);
    expect([sin?.estado, sin?.avisos[0].motivo]).toEqual(['sinDatos', MOTIVO_SIN_DATOS]);
    expect(revisarOperacion('o1', { ...quintanar, monedaConvenioCliente: ID_USD }, cat)).toBeNull();
    expect(revisarOperacion('o1', { montoConvenioCliente: 0, totalAPagarProv: 0 }, cat)).toBeNull();
  });
  it('sin tipo de cambio: se guarda solo la moneda (los montos se quedan)', () => {
    const r = revisarOperacion('o1', { ...quintanar, tipoCambioAprobado: 0 }, cat);
    expect(r?.datos).toEqual({ monedaConvenioCliente: ID_USD });
  });
  it('proveedor: mismo criterio con sus campos', () => {
    const op = { ref: 'X', convenioProveedor: 'dp', totalAPagarProv: 60, facturadoEnUnidad: ID_MXN, tipoCambioAprobado: 17.2888, conversionProv: 0, conversionCliente: 1988.21 };
    const r = revisarOperacion('o2', op, cat);
    expect(r?.datos).toMatchObject({ monedaConvenioProv: ID_USD, conversionProv: 1037.33, pesosProv: 1037.33, utilidadEstimada: 950.88 });
  });
});

describe('resumen', () => {
  it('cuenta las que se corrigen, las de revisar y las sin datos; y cuántas cambian de monto', () => {
    const rs = [
      revisarOperacion('a', quintanar, cat),
      revisarOperacion('b', { ...quintanar, conversionCliente: 0, pesosCliente: 0 }, cat),
      revisarOperacion('c', { ...quintanar, conversionCliente: 115 }, cat),
      revisarOperacion('d', { ...quintanar, convenio: '', conversionCliente: 0 }, cat),
    ].filter((r) => r !== null);
    const res = resumirOperaciones(rs, 10);
    expect([res.corregir.length, res.revisar.length, res.sinDatos.length, res.leidas, res.cambianMonto]).toEqual([2, 1, 1, 10, 1]);
  });
});

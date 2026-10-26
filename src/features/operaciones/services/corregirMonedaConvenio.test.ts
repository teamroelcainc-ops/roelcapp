// ✅ V00487 — Corregir monedas de convenio: qué moneda le toca a cada operación sin ella.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { facturaContradice, indexarConvenios, MOTIVO_FACTURADA_OP, MOTIVO_SIN_DATOS, monedaDelConvenio, monedaEmpresaDelLado, resumirOperaciones, revisarOperacion } from './corregirMonedaConvenio';
import type { Moneda } from '../../../shared/dominio/moneda';
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
    expect(r?.cambios).toEqual([{ lado: 'cliente', moneda: 'USD', fuente: 'ambas', facturadoAntes: 'MXN', facturadoDespues: 'MXN', subtotalAntes: 115, subtotalDespues: 1988.21, monedaFactura: 'MXN', convAntes: 1988.21, convDespues: 1988.21, cambiaFactura: false }]);
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

describe('✅ V00489 — "Facturado en" con dos monedas (ID y nombre copiado)', () => {
  // Montos que la regla de antes pudo dejar guardados: convenio 2,650 USD, ID Pesos, nombre "Dólares", TC 17.3898.
  const doble = {
    ref: 'TR-110626-011', montoConvenioCliente: 2650, cargosAdicionales: 0, monedaConvenioCliente: ID_USD,
    facturadoEnCobrar: ID_MXN, monedaCobroNombre: 'Dólares', tipoCambioAprobado: 17.3898,
    subtotalCliente: 46082.97, dolaresCliente: 46082.97, pesosCliente: 0, conversionCliente: 801373.63, conversionProv: 1000, utilidadEstimada: 800373.63,
  };
  it('detecta la contradicción solo si las dos se reconocen y son distintas', () => {
    expect(facturaContradice(doble, 'cliente')).toBe(true);
    expect(facturaContradice({ ...doble, monedaCobroNombre: 'Pesos' }, 'cliente')).toBe(false);
    expect(facturaContradice({ ...doble, monedaCobroNombre: '' }, 'cliente')).toBe(false);
    expect(facturaContradice({ facturadoEnUnidad: ID_USD, monedaUnidadNombre: 'Pesos' }, 'proveedor')).toBe(true);
  });
  it('ya con moneda del convenio: recalcula los montos con la moneda del ID (y la utilidad)', () => {
    const r = revisarOperacion('o1', doble, cat);
    expect(r?.estado).toBe('corregir');
    expect(r?.cambios[0]).toMatchObject({ lado: 'cliente', moneda: 'USD', fuente: 'guardada', subtotalDespues: 46082.97, monedaFactura: 'MXN', convAntes: 801373.63, convDespues: 46082.97 });
    // ✅ V00490: también la copia del nombre, para que ya no se contradigan
    expect(r?.datos).toEqual({ monedaCobroNombre: 'Pesos', dolaresCliente: 0, pesosCliente: 46082.97, conversionCliente: 46082.97, utilidadEstimada: 45082.97 });
  });
  it('si los montos ya cuadran con la regla (el formulario usa el ID), solo se corrige la copia del nombre', () => {
    const bien = { ...doble, dolaresCliente: 0, pesosCliente: 46082.97, conversionCliente: 46082.97 };
    expect(revisarOperacion('o1', bien, cat)?.datos).toEqual({ monedaCobroNombre: 'Pesos' });
    expect(revisarOperacion('o1', { ...bien, monedaCobroNombre: 'Pesos' }, cat)).toBeNull();
  });
});

describe('✅ V00490 — "Facturado en" = la moneda de su empresa', () => {
  const conEmpresas = (cliente: Record<string, Moneda>, proveedor: Record<string, Moneda> = {}): CatalogoConvenios => ({
    cliente: { ...cat.cliente, monedaEmpresa: new Map(Object.entries(cliente)) },
    proveedor: { ...cat.proveedor, monedaEmpresa: new Map(Object.entries(proveedor)) },
  });
  // LO-130126-6 (Caro-Kar, cliente en Pesos): convenio 130 USD, TC 17.91, facturado en Dólares → $2,328.30.
  const caroKar = {
    ref: 'LO-130126-6', clientePaga: 'emp61', convenio: 'det-usd', montoConvenioCliente: 130, cargosAdicionales: 0, monedaConvenioCliente: ID_USD,
    facturadoEnCobrar: ID_USD, monedaCobroNombre: 'Dólares', tipoCambioAprobado: 17.91,
    subtotalCliente: 130, dolaresCliente: 130, pesosCliente: 0, conversionCliente: 2328.3, conversionProv: 1000, utilidadEstimada: 1328.3,
  };
  it('moneda de la empresa por su id (clientePaga o clientePagaId; proveedorUnidad o proveedorUnidadId)', () => {
    const c = conEmpresas({ emp61: 'MXN' }, { prov1: 'USD' });
    expect(monedaEmpresaDelLado(caroKar, 'cliente', c)).toBe('MXN');
    expect(monedaEmpresaDelLado({ clientePagaId: 'emp61' }, 'cliente', c)).toBe('MXN');
    expect(monedaEmpresaDelLado({ proveedorUnidadId: 'prov1' }, 'proveedor', c)).toBe('USD');
    expect(monedaEmpresaDelLado({ clientePaga: 'otra' }, 'cliente', c)).toBeNull();
    expect(monedaEmpresaDelLado(caroKar, 'cliente', cat)).toBeNull(); // sin el índice de empresas
  });
  it('cliente en Pesos con convenio en dólares: Facturado en Pesos, el precio sigue en USD y la Conversión no cambia', () => {
    const r = revisarOperacion('o1', caroKar, conEmpresas({ emp61: 'MXN' }));
    expect(r?.estado).toBe('corregir');
    expect(r?.cambios[0]).toMatchObject({ moneda: 'USD', fuente: 'guardada', facturadoAntes: 'USD', facturadoDespues: 'MXN', subtotalDespues: 2328.3, convDespues: 2328.3, cambiaFactura: true });
    expect(r?.datos).toEqual({ facturadoEnCobrar: ID_MXN, monedaCobroNombre: 'Pesos', subtotalCliente: 2328.3, dolaresCliente: 0, pesosCliente: 2328.3 });
    expect(resumirOperaciones([r!], 1).cambianFacturado).toBe(1);
  });
  // ✅ V00495: una operación ya facturada no se corrige en bloque (su factura solo cambia a mano, 1 x 1).
  it('ya facturada de ese lado: se lista para revisar, sin cambios', () => {
    const r = revisarOperacion('o1', { ...caroKar, facturaClienteId: 'f1', facturaClienteInvoice: 'A1' }, conEmpresas({ emp61: 'MXN' }));
    expect(r).toMatchObject({ estado: 'revisar', cambios: [], datos: null });
    expect(r?.avisos).toEqual([{ lado: 'cliente', motivo: MOTIVO_FACTURADA_OP }]);
    expect(revisarOperacion('o1', { ...caroKar, facturado: true }, conEmpresas({ emp61: 'MXN' }))?.cambios).toEqual([]);
  });
  it('ya en la moneda de su empresa: nada que hacer', () => {
    const bien = { ...caroKar, facturadoEnCobrar: ID_MXN, monedaCobroNombre: 'Pesos', subtotalCliente: 2328.3, dolaresCliente: 0, pesosCliente: 2328.3 };
    expect(revisarOperacion('o1', bien, conEmpresas({ emp61: 'MXN' }))).toBeNull();
  });
  it('sin saber la moneda del convenio no se toca "Facturado en" (movería el monto)', () => {
    const sinConvenio = { ...caroKar, monedaConvenioCliente: '', convenio: '', conversionCliente: 0 };
    const r = revisarOperacion('o1', sinConvenio, conEmpresas({ emp61: 'MXN' }));
    expect([r?.estado, r?.datos]).toEqual(['sinDatos', null]);
  });
  it('sin monto: solo "Facturado en"; empresa sin moneda: no se toca', () => {
    const sinMonto = { ...caroKar, montoConvenioCliente: 0, monedaConvenioCliente: '' };
    expect(revisarOperacion('o1', sinMonto, conEmpresas({ emp61: 'MXN' }))?.datos).toEqual({ facturadoEnCobrar: ID_MXN, monedaCobroNombre: 'Pesos' });
    expect(revisarOperacion('o1', caroKar, conEmpresas({}))).toBeNull();
  });
  it('proveedor en Dólares con convenio en pesos: Facturado en Dólares (÷ TC), la Conversión queda igual', () => {
    const op = { ref: 'X', proveedorUnidad: 'prov1', totalAPagarProv: 1791, monedaConvenioProv: ID_MXN, facturadoEnUnidad: ID_MXN, monedaUnidadNombre: 'Pesos',
      tipoCambioAprobado: 17.91, subtotalProv: 1791, pesosProv: 1791, dolaresProv: 0, conversionProv: 1791 };
    const r = revisarOperacion('o2', op, conEmpresas({}, { prov1: 'USD' }));
    expect(r?.datos).toEqual({ facturadoEnUnidad: ID_USD, monedaUnidadNombre: 'Dólares', subtotalProv: 100, dolaresProv: 100, pesosProv: 0 });
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

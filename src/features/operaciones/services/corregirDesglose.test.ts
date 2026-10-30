// ✅ V00532 — Corregir desglose: Total, Dólares y Pesos en la moneda de su "Facturado en" (la Conversión no cambia).
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { filasPruebaDesglose, mismoCambio, motivoAlAplicar, respaldoDesglose, revisarDesglose, revisarDesgloseLado } from './corregirDesglose';

type Datos = Record<string, unknown>;
// TR-221026-023 (la captura): $120 Dólares facturado en Pesos, TC 18.6425; el desglose quedó en dólares.
const tr023 = (extra: Datos = {}): Datos => ({
  ref: 'TR-221026-023', clientePagaNombre: 'Roal Business Solutions', facturaClienteId: 'fE4542', facturaClienteInvoice: 'E4542',
  montoConvenioCliente: 120, cargosAdicionales: 0, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_MXN, tipoCambioAprobado: 18.6425,
  subtotalCliente: 120, dolaresCliente: 120, pesosCliente: 0, conversionCliente: 2237.1,
  ...extra,
});

describe('revisarDesgloseLado', () => {
  it('TR-221026-023: Total y Pesos pasan a 2,237.10 y Dólares a 0; la Conversión no cambia', () => {
    const r = revisarDesgloseLado(tr023(), 'cliente');
    expect(r).not.toBe('otraConversion');
    expect(r).not.toBeNull();
    if (!r || r === 'otraConversion') return;
    expect(r.propios).toEqual({ subtotalCliente: 2237.1, dolaresCliente: 0, pesosCliente: 2237.1 });
    expect(r.cambio).toMatchObject({
      lado: 'cliente', facturadoEn: 'MXN', conv: 2237.1, facturada: true, factura: 'E4542', empresa: 'Roal Business Solutions',
      antes: { total: 120, dol: 120, pes: 0 }, despues: { total: 2237.1, dol: 0, pes: 2237.1 },
    });
  });
  it('al revés: convenio en Pesos facturado en Dólares con el desglose en pesos', () => {
    const op = { montoConvenioCliente: 1864.25, cargosAdicionales: 0, monedaConvenioCliente: ID_MXN, facturadoEnCobrar: ID_USD, tipoCambioAprobado: 18.6425,
      subtotalCliente: 1864.25, dolaresCliente: 0, pesosCliente: 1864.25, conversionCliente: 1864.25 };
    const r = revisarDesgloseLado(op, 'cliente');
    if (!r || r === 'otraConversion') throw new Error('debía corregirse');
    expect(r.propios).toEqual({ subtotalCliente: 100, dolaresCliente: 100, pesosCliente: 0 });
  });
  it('con cargos: el total incluye los cargos convertidos', () => {
    const r = revisarDesgloseLado(tr023({ cargosAdicionales: 10, conversionCliente: 2423.53 }), 'cliente');
    if (!r || r === 'otraConversion') throw new Error('debía corregirse');
    expect(r.cambio.despues).toEqual({ total: 2423.53, dol: 0, pes: 2423.53 });
  });
  it('bien guardada: nada que hacer', () => {
    expect(revisarDesgloseLado(tr023({ subtotalCliente: 2237.1, dolaresCliente: 0, pesosCliente: 2237.1 }), 'cliente')).toBeNull();
    expect(revisarDesgloseLado(tr023({ subtotalCliente: '2237.10', dolaresCliente: '', pesosCliente: '2237.1' }), 'cliente')).toBeNull();
  });
  it('si la Conversión guardada no es la de la regla, no se toca (otro problema)', () => {
    expect(revisarDesgloseLado(tr023({ conversionCliente: 120 }), 'cliente')).toBe('otraConversion');
    expect(revisarDesgloseLado(tr023({ conversionCliente: 0 }), 'cliente')).toBe('otraConversion');
  });
  it('sin monto, sin Facturado en o sin tipo de cambio: no se revisa', () => {
    expect(revisarDesgloseLado(tr023({ montoConvenioCliente: 0 }), 'cliente')).toBeNull();
    expect(revisarDesgloseLado(tr023({ facturadoEnCobrar: '', monedaCobroNombre: '' }), 'cliente')).toBeNull();
    expect(revisarDesgloseLado(tr023({ tipoCambioAprobado: 0 }), 'cliente')).toBeNull();
  });
  it('proveedor: sus propios campos', () => {
    const op = { proveedorUnidadNombre: 'Transportes X', facturaProveedorFolio: 'P-77', totalAPagarProv: 80, cargosAdicionalesProv: 0, monedaConvenioProv: ID_USD, facturadoEnUnidad: ID_MXN,
      tipoCambioAprobado: 18.5, subtotalProv: 80, dolaresProv: 80, pesosProv: 0, conversionProv: 1480 };
    const r = revisarDesgloseLado(op, 'proveedor');
    if (!r || r === 'otraConversion') throw new Error('debía corregirse');
    expect(r.propios).toEqual({ subtotalProv: 1480, dolaresProv: 0, pesosProv: 1480 });
    expect(r.cambio).toMatchObject({ facturada: true, factura: 'P-77', empresa: 'Transportes X' });
  });
});

describe('revisarDesglose', () => {
  it('junta los dos lados y cuenta los de otra conversión', () => {
    const op = tr023({ totalAPagarProv: 80, monedaConvenioProv: ID_USD, facturadoEnUnidad: ID_USD, subtotalProv: 80, dolaresProv: 80, pesosProv: 0, conversionProv: 999 });
    const r = revisarDesglose('op1', op);
    expect(r.otraConversion).toEqual(['proveedor']);
    expect(r.revision).toMatchObject({ id: 'op1', ref: 'TR-221026-023', datos: { subtotalCliente: 2237.1, dolaresCliente: 0, pesosCliente: 2237.1 } });
    expect(r.revision?.cambios).toHaveLength(1);
  });
  it('nada que corregir → revision null', () => {
    expect(revisarDesglose('op2', tr023({ subtotalCliente: 2237.1, dolaresCliente: 0, pesosCliente: 2237.1 })).revision).toBeNull();
  });
});

describe('prueba y respaldo', () => {
  const r = revisarDesglose('op1', tr023()).revision;
  if (!r) throw new Error('debía corregirse');
  it('una fila por lado con lo de antes y lo de después', () => {
    expect(filasPruebaDesglose([r])).toEqual([{
      Referencia: 'TR-221026-023', Lado: 'Cliente', Empresa: 'Roal Business Solutions', 'Facturado en': 'Pesos',
      'Total antes': 120, 'Total después': 2237.1, 'Dólares antes': 120, 'Dólares después': 0, 'Pesos antes': 0, 'Pesos después': 2237.1,
      'Conversión MXN (no cambia)': 2237.1, Facturada: 'Sí (E4542)',
    }]);
  });
  it('el respaldo guarda los tres campos como estaban', () => {
    const j = respaldoDesglose([r], '2026-10-30T10:00:00Z', 'omar');
    expect(j).toMatchObject({ tipo: 'respaldo-corregir-desglose', por: 'omar' });
    expect(j.operaciones).toEqual([{ id: 'op1', ref: 'TR-221026-023', antes: { subtotalCliente: 120, dolaresCliente: 120, pesosCliente: 0 }, despues: r.datos }]);
  });
  it('mismoCambio tolera medio centavo', () => {
    expect(mismoCambio({ total: 1, dol: 1, pes: 0 }, { total: 1.004, dol: 1, pes: 0 })).toBe(true);
    expect(mismoCambio({ total: 1, dol: 1, pes: 0 }, { total: 1.01, dol: 1, pes: 0 })).toBe(false);
  });
});

describe('motivoAlAplicar', () => {
  const plan = revisarDesglose('op1', tr023()).revision;
  if (!plan) throw new Error('debía corregirse');
  it('igual que en la prueba → se escribe', () => {
    expect(motivoAlAplicar(tr023(), plan)).toBe('');
  });
  it('ya no existe, ya la corrigieron o cambió desde la prueba → no se escribe', () => {
    expect(motivoAlAplicar(null, plan)).toBe('La operación ya no existe');
    expect(motivoAlAplicar(tr023({ subtotalCliente: 2237.1, dolaresCliente: 0, pesosCliente: 2237.1 }), plan)).toMatch(/Ya está bien/);
    expect(motivoAlAplicar(tr023({ tipoCambioAprobado: 18.7, conversionCliente: 2244 }), plan)).toMatch(/Cambió desde la prueba/);
    expect(motivoAlAplicar(tr023({ conversionCliente: 999 }), plan)).toMatch(/Cambió desde la prueba/);
  });
});

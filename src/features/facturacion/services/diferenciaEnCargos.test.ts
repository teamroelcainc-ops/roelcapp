// ✅ V00519 — La diferencia del documento en los costos adicionales de las operaciones (y en la factura).
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { ErrorDinero } from '../../../shared/dominio/dinero';
import { cargoEnMonedaConvenio, opsDeFactura, planDiferenciaEnCargos } from './diferenciaEnCargos';
import type { DatosDiferenciaCargos } from './diferenciaEnCargos';

const opUSD = (extra: Record<string, unknown> = {}) => ({
  ref: 'TR-271026-014', montoConvenioCliente: 70, cargosAdicionales: 0, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD, tipoCambioDia: 18.6525, conversionProv: 500, ...extra,
});
const factura = (extra: Record<string, unknown> = {}) => ({
  invoice: 'I8663', statusFactura: 'Facturado', monedaFacturacion: 'USD', subtotalMonedaFactura: 270, subtotalFactura: 5036.18,
  operacionesIds: ['a', 'b'],
  operacionesGuardadas: [
    { id: 'a', ref: 'TR-271026-026', dol: 200, pes: 0, monto: 3730.5, subtotalBase: 200 },
    { id: 'b', ref: 'TR-271026-014', dol: 70, pes: 0, monto: 1305.68, subtotalBase: 70 },
  ],
  ...extra,
});
const datos = (extra: Partial<DatosDiferenciaCargos> = {}): DatosDiferenciaCargos => ({
  folio: 'I8663', moneda: 'USD', asignaciones: [{ opId: 'b', ref: 'TR-271026-014', monto: 5 }], nota: 'Diferencia con la factura I8663', ahoraISO: 'T', usuario: 'yo', ...extra,
});

describe('cargoEnMonedaConvenio', () => {
  it('misma moneda: lo mismo; convenio en dólares y factura en pesos: entre el T.C.', () => {
    expect(cargoEnMonedaConvenio(opUSD(), 'USD', 5)).toBe(5);
    const enPesos = opUSD({ facturadoEnCobrar: ID_MXN });
    const x = cargoEnMonedaConvenio(enPesos, 'MXN', 93.26) as number;
    expect(x).toBeCloseTo(5, 2);
    // Convenio en pesos y factura en dólares: por el T.C. (93.26 o 93.27 dan los mismos 5.00 USD al redondear).
    const x2 = cargoEnMonedaConvenio(opUSD({ monedaConvenioCliente: ID_MXN, facturadoEnCobrar: ID_USD, montoConvenioCliente: 1300 }), 'USD', 5) as number;
    expect(Math.abs(x2 - 93.26)).toBeLessThanOrEqual(0.011);
  });
  it('sin tipo de cambio no se puede convertir', () => {
    expect(cargoEnMonedaConvenio(opUSD({ facturadoEnCobrar: ID_MXN, tipoCambioDia: 0 }), 'MXN', 93.26)).toBeNull();
  });
});

describe('planDiferenciaEnCargos', () => {
  it('suma la diferencia a los costos adicionales de la operación, con su observación, y al total de la factura', () => {
    const p = planDiferenciaEnCargos(datos(), { id: 'f1', datos: factura() }, [{ id: 'b', datos: opUSD({ cargosAdicionalesNotas: 'Demora' }) }]);
    expect(p.ops).toHaveLength(1);
    expect(p.ops[0]).toMatchObject({ id: 'b', cargosAntes: 0, cargosDespues: 5, cobroAntes: 70, cobroDespues: 75 });
    expect(p.ops[0].datos).toMatchObject({
      cargosAdicionales: 5, cargosAdicionalesNotas: 'Demora\nDiferencia con la factura I8663', dolaresCliente: 75, pesosCliente: 0,
      diferenciaFacturaAplicada: { factura: 'I8663', monto: 5, moneda: 'USD', en: 'T', por: 'yo' },
    });
    expect(p.totalAntes).toBe(270);
    expect(p.totalDespues).toBe(275);
    expect(p.datosFactura).toMatchObject({ subtotalMonedaFactura: 275, saldoPendiente: 275, editadoEn: 'T' });
    expect((p.datosFactura.operacionesGuardadas as { id: string; dol: number }[]).map((r) => [r.id, r.dol])).toEqual([['a', 200], ['b', 75]]);
  });
  it('una factura que ya traía impuestos en su total: se le suma la diferencia (no se recalcula sin ellos)', () => {
    const p = planDiferenciaEnCargos(datos(), { id: 'f1', datos: factura({ subtotalMonedaFactura: 313.2, totalManualCentavos: 31320 }) }, [{ id: 'b', datos: opUSD() }]);
    expect(p.totalDespues).toBe(318.2);
    expect(p.datosFactura).toMatchObject({ subtotalMonedaFactura: 318.2, totalManualCentavos: 31820 });
  });
  it('pagada: el saldo y el status de pago; no puede quedar debajo de lo pagado', () => {
    const p = planDiferenciaEnCargos(datos(), { id: 'f1', datos: factura({ montoPagado: 270, saldoPendiente: 0, statusPago: 'PAGADA' }) }, [{ id: 'b', datos: opUSD() }]);
    expect(p.datosFactura).toMatchObject({ saldoPendiente: 5, statusPago: 'PARCIAL' });
    expect(() => planDiferenciaEnCargos(datos({ asignaciones: [{ opId: 'b', ref: 'TR-271026-014', monto: -5 }] }), { id: 'f1', datos: factura({ montoPagado: 270 }) }, [{ id: 'b', datos: opUSD() }]))
      .toThrow(/quedaría por debajo de lo ya pagado/);
  });
  it('no se hace: factura cancelada, sin montos, sin observación, operación que ya no está en la factura o no existe', () => {
    const ops = [{ id: 'b', datos: opUSD() }];
    expect(() => planDiferenciaEnCargos(datos(), { id: 'f1', datos: factura({ statusFactura: 'Cancelada' }) }, ops)).toThrow(ErrorDinero);
    expect(() => planDiferenciaEnCargos(datos({ asignaciones: [{ opId: 'b', ref: 'x', monto: 0 }] }), { id: 'f1', datos: factura() }, ops)).toThrow(/Escribe cuánto/);
    expect(() => planDiferenciaEnCargos(datos({ nota: ' ' }), { id: 'f1', datos: factura() }, ops)).toThrow(/observación/);
    expect(() => planDiferenciaEnCargos(datos({ asignaciones: [{ opId: 'z', ref: 'TR-Z', monto: 5 }] }), { id: 'f1', datos: factura() }, [{ id: 'z', datos: opUSD() }])).toThrow(/ya no está en la factura/);
    expect(() => planDiferenciaEnCargos(datos(), { id: 'f1', datos: factura() }, [])).toThrow(/ya no existe/);
  });
  it('las operaciones de la factura: con su id real y su cobro en la moneda de la factura', () => {
    expect(opsDeFactura(factura(), 'USD')).toEqual([{ opId: 'a', ref: 'TR-271026-026', importe: 200 }, { opId: 'b', ref: 'TR-271026-014', importe: 70 }]);
    expect(opsDeFactura({ operaciones: ['TR46028-05'] }, 'USD')).toEqual([]); // solo la referencia: sin id
  });
});

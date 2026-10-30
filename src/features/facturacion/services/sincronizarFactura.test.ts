// ✅ V00520 — Poner la factura al día con sus operaciones (Actualizar en Editar factura).
import { describe, expect, it } from 'vitest';
import { ID_USD } from '../../../shared/dominio/constantes';
import { opsDesfasadas, planSincronizarFactura } from './sincronizarFactura';

const op = (monto: number, extra: Record<string, unknown> = {}) => ({ montoConvenioCliente: monto, cargosAdicionales: 0, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD, tipoCambioDia: 18.5, ...extra });
const factura = (extra: Record<string, unknown> = {}) => ({
  monedaFacturacion: 'USD', subtotalMonedaFactura: 270, subtotalFactura: 4995,
  operacionesGuardadas: [{ id: 'a', ref: 'TR-1', dol: 200, pes: 0, monto: 3700, subtotalBase: 200 }, { id: 'b', ref: 'TR-2', dol: 70, pes: 0, monto: 1295, subtotalBase: 70 }],
  ...extra,
});

describe('poner la factura al día', () => {
  it('dice qué operación cambió de costo', () => {
    expect(opsDesfasadas(factura(), [{ id: 'a', datos: op(200) }, { id: 'b', datos: op(70, { cargosAdicionales: 5 }) }], 'USD'))
      .toEqual([{ opId: 'b', ref: 'TR-2', antes: 70, ahora: 75 }]);
  });
  it('al día: nada que escribir', () => {
    expect(planSincronizarFactura(factura(), [{ id: 'a', datos: op(200) }, { id: 'b', datos: op(70) }], 'USD', 'T', 'yo')).toBeNull();
  });
  it('el renglón toma el costo de hoy y el total sube la misma diferencia (respeta un total con IVA)', () => {
    const p = planSincronizarFactura(factura({ subtotalMonedaFactura: 313.2, totalManualCentavos: 31320, montoPagado: 313.2, statusPago: 'PAGADA' }),
      [{ id: 'a', datos: op(200) }, { id: 'b', datos: op(70, { cargosAdicionales: 5 }) }], 'USD', 'T', 'yo');
    expect(p?.modo).toBe('diferencia');
    expect(p?.totalAntes).toBe(313.2);
    expect(p?.totalDespues).toBe(318.2);
    expect(p?.datosFactura).toMatchObject({ subtotalMonedaFactura: 318.2, totalManualCentavos: 31820, saldoPendiente: 5, statusPago: 'PARCIAL', subtotalFactura: 5087.5 });
    expect((p?.datosFactura.operacionesGuardadas as { id: string; dol: number }[]).map((r) => [r.id, r.dol])).toEqual([['a', 200], ['b', 75]]);
  });
  it('sin lo que cobró cada operación (solo ids, o renglones en 0) no se compara: no suma el total dos veces', () => {
    const ops = [{ id: 'a', datos: op(200) }, { id: 'b', datos: op(70) }];
    expect(opsDesfasadas(factura({ operacionesGuardadas: undefined, operacionesIds: ['a', 'b'] }), ops, 'USD')).toEqual([]);
    expect(planSincronizarFactura(factura({ operacionesGuardadas: [{ id: 'a', ref: 'TR-1', monto: 0 }, { id: 'b', ref: 'TR-2', monto: 0 }] }), ops, 'USD', 'T', 'yo')).toBeNull();
  });
  it('✅ V00527: si el total YA incluía lo de hoy (39802: renglón $140 sin los $250 de cargos, total $390), solo cambia el renglón', () => {
    const fac = { monedaFacturacion: 'USD', subtotalMonedaFactura: 390, subtotalFactura: 7215, operacionesGuardadas: [{ id: 'a', ref: 'TR-241026-005', dol: 140, pes: 0, monto: 2618.07, subtotalBase: 140 }] };
    const p = planSincronizarFactura(fac, [{ id: 'a', datos: op(140, { cargosAdicionales: 250 }) }], 'USD', 'T', 'yo');
    expect(p).toMatchObject({ modo: 'yaIncluido', totalAntes: 390, totalDespues: 390 });
    expect(p?.datosFactura).toMatchObject({ subtotalMonedaFactura: 390 });
    expect(p?.datosFactura).not.toHaveProperty('subtotalFactura');
    expect((p?.datosFactura.operacionesGuardadas as { dol: number; subtotalBase: number }[])[0]).toMatchObject({ dol: 390, subtotalBase: 140 });
  });
  it('✅ V00527: si no cuadraba antes ni cuadra con lo de hoy, guarda los importes de hoy y NO toca el total', () => {
    const fac = { monedaFacturacion: 'USD', subtotalMonedaFactura: 500, operacionesGuardadas: [{ id: 'a', ref: 'TR-1', dol: 140, pes: 0, monto: 2590, subtotalBase: 140 }] };
    const p = planSincronizarFactura(fac, [{ id: 'a', datos: op(140, { cargosAdicionales: 250 }) }], 'USD', 'T', 'yo');
    expect(p).toMatchObject({ modo: 'soloImportes', totalAntes: 500, totalDespues: 500 });
  });
  it('no puede quedar por debajo de lo pagado', () => {
    expect(() => planSincronizarFactura(factura({ montoPagado: 270 }), [{ id: 'a', datos: op(200) }, { id: 'b', datos: op(60) }], 'USD', 'T', 'yo')).toThrow(/por debajo de lo ya pagado/);
  });
});

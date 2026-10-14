// Pruebas de la lógica pura de totales de factura (✅ Fase 1.8 c, d).
import { describe, expect, it, vi } from 'vitest';
import { ID_USD } from '../../../shared/dominio/constantes';
import {
  tienePagosAplicados,
  totalNativoDeOperaciones,
  totalNativoFactura,
  totalesTrasCambioDeOps,
  totalDeFilaFactura,
  totalGuardadoDeDocumento,
} from './totalesFactura';

describe('totalNativoFactura', () => {
  it('usa el subtotalMonedaFactura guardado cuando existe', () => {
    expect(totalNativoFactura({ monedaFacturacion: 'USD', subtotalMonedaFactura: 500, operacionesGuardadas: [{ dol: 10 }] })).toBe(500);
  });

  it('USD: suma dólares; las operaciones sin `dol` cuentan su subtotalBase', () => {
    const ops = [{ dol: 100, subtotalBase: 90 }, { monto: 2000, subtotalBase: 40 }];
    expect(totalNativoFactura({ monedaFacturacion: 'Dólares', operacionesGuardadas: ops })).toBe(140);
    expect(totalNativoFactura({ monedaId: ID_USD, monedaFacturacion: 'N/A', operacionesGuardadas: ops })).toBe(140);
  });

  it('MXN: suma la conversión (monto)', () => {
    expect(totalNativoFactura({ monedaProveedor: 'Pesos', operacionesGuardadas: [{ monto: 1000.1, dol: 50 }, { monto: 0.2 }] })).toBe(1000.3);
  });

  it('sin operaciones con monto cae a subtotalFactura', () => {
    expect(totalNativoFactura({ monedaFacturacion: 'MXN', subtotalFactura: 750, operacionesGuardadas: [{ monto: 0, subtotalBase: 0 }] })).toBe(750);
  });

  it('totalNativoDeOperaciones con moneda desconocida usa subtotalBase', () => {
    expect(totalNativoDeOperaciones('N/A', [{ subtotalBase: 10, monto: 99 }, { subtotalBase: 5 }])).toBe(15);
  });
});

describe('totalesTrasCambioDeOps', () => {
  const filaA = { dol: 400, monto: 7200, subtotalBase: 400 };
  const filaB = { dol: 500, monto: 9000, subtotalBase: 500 };

  it('factura normal (las filas reproducen el total): el nuevo total es la suma de las filas', () => {
    const fac = { id: 'f1', monedaFacturacion: 'USD', subtotalMonedaFactura: 900, subtotalFactura: 16200, operacionesGuardadas: [filaA, filaB] };
    expect(totalesTrasCambioDeOps(fac, [filaA])).toEqual({ ok: true, total: 400, campos: { subtotalMonedaFactura: 400, subtotalFactura: 7200 } });
  });

  it('filas de relleno en 0 (importada) + agregar operación: suma solo la nueva al total guardado', () => {
    const relleno = [{ id: 'a', monto: 0, subtotalBase: 0 }, { id: 'b', monto: 0, subtotalBase: 0 }];
    const fac = { id: 'imp', monedaFacturacion: 'USD', subtotalFactura: 5000, montoPagado: 5000, operacionesGuardadas: relleno };
    const r = totalesTrasCambioDeOps(fac, [...relleno, { id: 'c', dol: 300, monto: 300, subtotalBase: 280 }]);
    expect(r).toEqual({ ok: true, total: 5300, campos: { subtotalMonedaFactura: 5300, subtotalFactura: 5300, saldoPendiente: 300, statusPago: 'PARCIAL' } });
    // quitar una fila de relleno deja el total igual
    expect(totalesTrasCambioDeOps(fac, [relleno[0]])).toMatchObject({ ok: true, campos: { subtotalMonedaFactura: 5000, subtotalFactura: 5000 } });
  });

  it('total capturado a mano + quitar operación: resta solo esa operación', () => {
    const fac = { id: 'man', monedaFacturacion: 'USD', subtotalMonedaFactura: 1000, subtotalFactura: 18000, operacionesGuardadas: [filaA, filaB] };
    expect(totalesTrasCambioDeOps(fac, [filaB])).toEqual({ ok: true, total: 600, campos: { subtotalMonedaFactura: 600, subtotalFactura: 10800 } });
  });

  it('nunca escribe 0 encima de un total positivo si quedan operaciones', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fac = { id: 'man2', monedaFacturacion: 'USD', subtotalMonedaFactura: 300, subtotalFactura: 16200, operacionesGuardadas: [filaA, filaB] };
    const r = totalesTrasCambioDeOps(fac, [filaA]);
    expect(r.ok && r.campos.subtotalMonedaFactura).toBe(300);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('man2'));
    aviso.mockRestore();
  });

  it('con pagos ajusta saldo y status', () => {
    const r = totalesTrasCambioDeOps({ monedaFacturacion: 'USD', montoPagado: 100 }, [{ dol: 150 }]);
    expect(r.ok && r.campos).toMatchObject({ saldoPendiente: 50, statusPago: 'PARCIAL' });
  });

  it('rechaza cuando el NUEVO total queda por debajo de lo pagado', () => {
    const fac = { monedaFacturacion: 'USD', montoPagado: 600, subtotalMonedaFactura: 900, operacionesGuardadas: [filaA, filaB] };
    expect(totalesTrasCambioDeOps(fac, [filaA])).toEqual({ ok: false, total: 400, pagado: 600 });
  });
});

describe('tienePagosAplicados', () => {
  it('por monto pagado o por status de pago', () => {
    expect(tienePagosAplicados({ montoPagado: 0.004 })).toBe(false);
    expect(tienePagosAplicados({ montoPagado: 12 })).toBe(true);
    expect(tienePagosAplicados({ statusPago: 'parcial' })).toBe(true);
    expect(tienePagosAplicados(null)).toBe(false);
  });
});

// ✅ V00451: total de una fila del Historial con varios documentos del mismo folio.
describe('totalDeFilaFactura', () => {
  const regla = (d: unknown) => totalNativoFactura(d);
  const renglones = [{ id: 'op1', dol: 500, subtotalBase: 500 }];
  it('un solo documento: la regla de siempre', () => {
    expect(totalDeFilaFactura({ subtotalMonedaFactura: 1500, __groupDocs: [{}] }, regla)).toBe(1500);
  });
  it('el documento puesto en 0 al editar el grupo NO suma sus renglones', () => {
    const a = { subtotalMonedaFactura: 1500, totalManualCentavos: 150000, moneda: ID_USD };
    const b = { subtotalMonedaFactura: 0, totalManualCentavos: 0, moneda: ID_USD, operacionesGuardadas: renglones };
    expect(totalDeFilaFactura({ __groupDocs: [a, b] }, regla)).toBe(1500);
    // guardar sin cambiar nada no lo infla
    expect(totalDeFilaFactura({ __groupDocs: [{ ...a }, { ...b }] }, regla)).toBe(1500);
  });
  it('dos documentos con su propio total se suman', () => {
    expect(totalDeFilaFactura({ __groupDocs: [{ subtotalMonedaFactura: 1500 }, { subtotalMonedaFactura: 500 }] }, regla)).toBe(2000);
  });
  it('sin subtotalMonedaFactura usa los renglones', () => {
    expect(totalGuardadoDeDocumento({ moneda: ID_USD, operacionesGuardadas: renglones }, regla)).toBe(500);
  });
  it('el capturado a mano manda', () => {
    expect(totalGuardadoDeDocumento({ subtotalMonedaFactura: 10, totalManualCentavos: 12345 }, regla)).toBe(123.45);
  });
});

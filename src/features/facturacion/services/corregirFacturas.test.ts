// ✅ V00482 — Corregir monedas y montos: moneda de la empresa y total de sus operaciones.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { MOTIVO_CANCELADA, MOTIVO_SIN_MONEDA, MOTIVO_SIN_OPERACIONES, MOTIVO_TOTAL_MANUAL, resumirRevision, revisarFactura } from './corregirFacturas';

const AHORA = '2026-10-24T12:00:00.000Z';
// Operación cobrada en dólares: convenio USD 95, TC 18.50 → Dólares (Cliente) 95, Conversión 1,757.50.
const opUsd = (id: string, monto = 95) => ({
  id, datos: { montoConvenioCliente: monto, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD, tipoCambioAprobado: 18.5, cargosAdicionales: 0 },
});
// Operación cobrada en pesos: 1,000 → Pesos (Cliente) 1,000 = Conversión 1,000.
const opMxn = (id: string) => ({ id, datos: { montoConvenioCliente: 1000, monedaConvenioCliente: ID_MXN, facturadoEnCobrar: ID_MXN, tipoCambioAprobado: 18.5 } });
const factura = (datos: Record<string, unknown>) => ({ id: 'f1', datos: { invoice: 'A5746', statusFactura: 'Facturado', operacionesIds: ['o1', 'o2'], ...datos } });

describe('revisar una factura', () => {
  it('en Dólares: la moneda de la empresa y la suma de Dólares (Cliente)', () => {
    const r = revisarFactura('cliente', factura({ monedaFacturacion: 'MXN', subtotalMonedaFactura: 3515 }), [opUsd('o1'), opUsd('o2')], 'USD', 'Torve', AHORA, 'Omar');
    expect(r.estado).toBe('corregir');
    expect([r.monedaAntes, r.monedaNueva, r.totalAntes, r.totalNuevo]).toEqual(['MXN', 'USD', 3515, 190]);
    expect(r.datos).toMatchObject({ monedaFacturacion: 'USD', monedaId: ID_USD, subtotalMonedaFactura: 190, subtotalFactura: 3515, saldoPendiente: 190, totalManualCentavos: 0 });
  });
  it('en Pesos: la Conversión Final (pesos directos + dólares × TC)', () => {
    const r = revisarFactura('cliente', factura({ monedaFacturacion: 'USD', subtotalMonedaFactura: 95 }), [opUsd('o1'), opMxn('o2')], 'MXN', 'Temm', AHORA, 'Omar');
    expect(r.totalNuevo).toBe(2757.5);
    expect(r.datos).toMatchObject({ monedaFacturacion: 'MXN', monedaId: ID_MXN });
  });
  it('proveedores escriben monedaProveedor', () => {
    const op = (id: string) => ({ id, datos: { totalAPagarProv: 50, monedaConvenioProv: ID_USD, facturadoEnUnidad: ID_USD, tipoCambioAprobado: 18 } });
    const r = revisarFactura('proveedor', factura({ monedaProveedor: 'MXN' }), [op('o1'), op('o2')], 'USD', 'Prov', AHORA, 'Omar');
    expect(r.datos).toMatchObject({ monedaProveedor: 'USD', subtotalMonedaFactura: 100 });
  });
  it('ya correcta: no se escribe', () => {
    const r = revisarFactura('cliente', factura({ monedaFacturacion: 'USD', subtotalMonedaFactura: 190 }), [opUsd('o1'), opUsd('o2')], 'USD', 'Torve', AHORA, 'Omar');
    expect([r.estado, r.datos]).toEqual(['bien', null]);
  });
  it('con pagos también se corrige: el saldo se recalcula con lo pagado (V00483)', () => {
    const ops = [opUsd('o1'), opUsd('o2')]; // total nuevo 190
    const parcial = revisarFactura('cliente', factura({ monedaFacturacion: 'MXN', montoPagado: 100, statusPago: 'PARCIAL' }), ops, 'USD', '', AHORA, '');
    expect([parcial.estado, parcial.pagado, parcial.pagadoDeMas]).toEqual(['corregir', 100, 0]);
    expect(parcial.datos).toMatchObject({ subtotalMonedaFactura: 190, saldoPendiente: 90, statusPago: 'PARCIAL' });
    const pagada = revisarFactura('cliente', factura({ monedaFacturacion: 'USD', subtotalMonedaFactura: 150, montoPagado: 190 }), ops, 'USD', '', AHORA, '');
    expect(pagada.datos).toMatchObject({ saldoPendiente: 0, statusPago: 'PAGADA' });
    // lo pagado pasa del total nuevo: PAGADA, saldo 0 y se marca la diferencia
    const deMas = revisarFactura('cliente', factura({ monedaFacturacion: 'USD', subtotalMonedaFactura: 300, montoPagado: 300 }), ops, 'USD', '', AHORA, '');
    expect([deMas.estado, deMas.pagadoDeMas]).toEqual(['corregir', 110]);
    expect(deMas.datos).toMatchObject({ subtotalMonedaFactura: 190, saldoPendiente: 0, statusPago: 'PAGADA' });
    // PAGADA importada sin montoPagado: su estado de pago no se toca
    const vieja = revisarFactura('cliente', factura({ monedaFacturacion: 'MXN', statusPago: 'PAGADA' }), ops, 'USD', '', AHORA, '');
    expect(vieja.estado).toBe('corregir');
    expect(vieja.datos && 'saldoPendiente' in vieja.datos).toBe(false);
    expect(vieja.datos && 'statusPago' in vieja.datos).toBe(false);
  });
  it('se saltan: cancelada, sin moneda, sin operaciones y recálculo en $0', () => {
    const ops = [opUsd('o1'), opUsd('o2')];
    expect(revisarFactura('cliente', factura({ statusFactura: 'Cancelado' }), ops, 'USD', '', AHORA, '').motivo).toBe(MOTIVO_CANCELADA);
    expect(revisarFactura('cliente', factura({}), ops, null, '', AHORA, '').motivo).toBe(MOTIVO_SIN_MONEDA);
    expect(revisarFactura('cliente', factura({ operacionesIds: [] }), ops, 'USD', '', AHORA, '').motivo).toBe(MOTIVO_SIN_OPERACIONES);
    // ✅ V00494: el total capturado a mano no se pisa.
    expect(revisarFactura('cliente', factura({ totalManualCentavos: 123456, subtotalMonedaFactura: 1234.56 }), ops, 'USD', '', AHORA, '')).toMatchObject({ estado: 'omitida', motivo: MOTIVO_TOTAL_MANUAL });
    const enCero = revisarFactura('cliente', factura({}), [opUsd('o1', 0), opUsd('o2', 0)], 'USD', '', AHORA, '');
    expect([enCero.estado, enCero.motivo]).toEqual(['omitida', 'El recálculo dio $0.00 — revisa las operaciones (montos de convenio y tipo de cambio).']);
    expect(revisarFactura('cliente', factura({}), [], 'USD', '', AHORA, '').motivo).toBe('No se encontraron las operaciones de la factura.');
  });
});

describe('resumen', () => {
  it('cuenta las que se corrigen, las que ya están bien y las saltadas por motivo', () => {
    const ops = [opUsd('o1'), opUsd('o2')];
    const r = resumirRevision([
      revisarFactura('cliente', factura({ monedaFacturacion: 'MXN' }), ops, 'USD', '', AHORA, ''),
      revisarFactura('cliente', factura({ monedaFacturacion: 'USD', subtotalMonedaFactura: 190 }), ops, 'USD', '', AHORA, ''),
      revisarFactura('cliente', factura({ montoPagado: 5 }), ops, 'USD', '', AHORA, ''),
      revisarFactura('cliente', factura({ montoPagado: 500 }), ops, 'USD', '', AHORA, ''),
      revisarFactura('cliente', factura({ statusFactura: 'Cancelado' }), ops, 'USD', '', AHORA, ''),
      revisarFactura('cliente', factura({}), ops, null, '', AHORA, ''),
      revisarFactura('cliente', factura({}), ops, null, '', AHORA, ''),
    ]);
    expect([r.corregir.length, r.bien, r.omitidas.length, r.conPagos, r.deMas]).toEqual([3, 1, 3, 2, 1]);
    expect(r.porMotivo).toEqual([{ motivo: MOTIVO_SIN_MONEDA, n: 2 }, { motivo: MOTIVO_CANCELADA, n: 1 }]);
  });
});

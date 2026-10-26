// ✅ V00493 — Estadísticas toma los montos de Facturación (mismas reglas que el Historial).
import { describe, expect, it } from 'vitest';
import { costoPorOperacion, operacionesConFactura, renglonesFacturados, repartirCentavos } from './montosFacturados';
import type { OpcionesFacturado } from './montosFacturados';
import { normalizarFacturaDe } from '../../facturacion/services/normalizarFactura';
import { totalNativoFactura } from '../../../shared/dominio/dinero';
import { monedaCanonica } from '../../../shared/dominio/moneda';

const cli = (raw: Record<string, unknown>) => normalizarFacturaDe(raw, 'cliente');
const opciones = (o: Partial<OpcionesFacturado> = {}): OpcionesFacturado => ({
  lado: 'cliente', desde: '2026-01-01', hasta: '2026-12-31', totalDoc: totalNativoFactura,
  monedaDe: (f) => monedaCanonica(f.monedaFacturacion), ...o,
});
const suma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('repartirCentavos', () => {
  it('reparte en proporción y la suma da exacto el total', () => {
    expect(repartirCentavos(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(repartirCentavos(30000, [100, 200])).toEqual([10000, 20000]);
  });
  it('sin pesos positivos reparte en partes iguales', () => {
    expect(repartirCentavos(1001, [0, 0])).toEqual([501, 500]);
  });
});

describe('renglonesFacturados', () => {
  it('factura en pesos: cada operación con su conversión; total = el de la factura', () => {
    const r = renglonesFacturados([cli({ id: 'F1', invoice: 'A1', fecha: '2026-03-02', clienteId: 'E1', monedaFacturacion: 'MXN', subtotalMonedaFactura: 1000,
      operacionesGuardadas: [{ id: 'o1', ref: 'R1', monto: 400 }, { id: 'o2', ref: 'R2', monto: 600 }] })], opciones());
    expect(r.renglones.map((x) => [x.opId, x.pes, x.dol, x.conv])).toEqual([['o1', 400, 0, 400], ['o2', 600, 0, 600]]);
    expect([r.totalMXN, r.totalUSD, r.facturas]).toEqual([1000, 0, 1]);
  });

  it('factura en dólares: dólares de cada renglón y su conversión con el TC de la operación', () => {
    const r = renglonesFacturados([cli({ id: 'F2', invoice: 'A2', fecha: '2026-01-13', clienteId: 'E1', monedaFacturacion: 'Dólares', subtotalMonedaFactura: 285,
      operacionesGuardadas: [{ id: 'oA', monto: 2328.3, dol: 130 }, { id: 'oC', monto: 2783.6, dol: 155 }] })], opciones());
    expect(r.renglones.map((x) => [x.dol, x.pes, x.conv])).toEqual([[130, 0, 2328.3], [155, 0, 2783.6]]);
    expect(r.totalUSD).toBe(285);
  });

  it('un total capturado a mano se reparte entre sus operaciones (no se usan los renglones)', () => {
    const r = renglonesFacturados([cli({ id: 'F3', invoice: 'A3', fecha: '2026-02-01', monedaFacturacion: 'USD', totalManualCentavos: 30000,
      operacionesGuardadas: [{ id: 'a', dol: 100, monto: 1800 }, { id: 'b', dol: 100, monto: 1800 }] })], opciones());
    expect(r.renglones.map((x) => x.dol)).toEqual([150, 150]);
    expect(r.renglones.map((x) => x.conv)).toEqual([2700, 2700]);
  });

  it('al centavo: la suma de los renglones es el total de la factura', () => {
    const r = renglonesFacturados([cli({ id: 'F4', invoice: 'A4', fecha: '2026-02-01', monedaFacturacion: 'MXN', subtotalMonedaFactura: 100,
      operacionesGuardadas: [{ id: 'a', monto: 1 }, { id: 'b', monto: 1 }, { id: 'c', monto: 1 }] })], opciones());
    expect(r.renglones.map((x) => x.pes)).toEqual([33.34, 33.33, 33.33]);
    expect(suma(r.renglones.map((x) => x.pes))).toBe(100);
  });

  it('por FECHA DE FACTURA (cualquier formato); sin fecha no entra; canceladas no suman', () => {
    const r = renglonesFacturados([
      cli({ id: 'dentro', invoice: 'B1', fecha: '15/01/2026', monedaFacturacion: 'MXN', subtotalMonedaFactura: 10, operacionesGuardadas: [{ id: 'x', monto: 10 }] }),
      cli({ id: 'fuera', invoice: 'B2', fecha: '2025-12-31', monedaFacturacion: 'MXN', subtotalMonedaFactura: 20, operacionesGuardadas: [{ id: 'y', monto: 20 }] }),
      cli({ id: 'sinFecha', invoice: 'B3', monedaFacturacion: 'MXN', subtotalMonedaFactura: 30, operacionesGuardadas: [{ id: 'z', monto: 30 }] }),
      cli({ id: 'cancel', invoice: 'B4', fecha: '2026-01-20', statusFactura: 'Cancelado', monedaFacturacion: 'MXN', subtotalMonedaFactura: 40, operacionesGuardadas: [{ id: 'w', monto: 40 }] }),
    ], opciones());
    expect(r.renglones.map((x) => [x.opId, x.fecha])).toEqual([['x', '2026-01-15']]);
    expect([r.totalMXN, r.canceladas, r.facturas]).toEqual([10, 1, 1]);
  });

  it('varios documentos con el mismo folio: el total de la fila del Historial, repartido entre todas sus operaciones', () => {
    const r = renglonesFacturados([
      cli({ id: 'd1', invoice: 'C1', clienteId: 'E1', fecha: '2026-04-01', monedaFacturacion: 'MXN', subtotalMonedaFactura: 500, operacionesGuardadas: [{ id: 'p', monto: 200 }] }),
      cli({ id: 'd2', invoice: 'C1', clienteId: 'E1', fecha: '2026-04-02', monedaFacturacion: 'MXN', subtotalMonedaFactura: 0, operacionesGuardadas: [{ id: 'q', monto: 300 }] }),
    ], opciones());
    expect(r.renglones.map((x) => [x.opId, x.pes, x.fecha])).toEqual([['p', 200, '2026-04-02'], ['q', 300, '2026-04-02']]);
    expect([r.totalMXN, r.facturas]).toEqual([500, 1]);
  });

  it('si un documento del folio está cancelado, la fila completa sale como cancelada (igual que el Historial)', () => {
    const r = renglonesFacturados([
      cli({ id: 'd1', invoice: 'C2', fecha: '2026-04-01', monedaFacturacion: 'MXN', subtotalMonedaFactura: 50, operacionesGuardadas: [{ id: 'p', monto: 50 }] }),
      cli({ id: 'd2', invoice: 'C2', fecha: '2026-04-01', statusFactura: 'Cancelado', monedaFacturacion: 'MXN', subtotalMonedaFactura: 50, operacionesGuardadas: [{ id: 'q', monto: 50 }] }),
    ], opciones());
    expect([r.renglones.length, r.canceladas]).toEqual([0, 1]);
  });

  it('sin moneda reconocible no suma (como en las tarjetas) y se cuenta aparte', () => {
    const r = renglonesFacturados([cli({ id: 'F5', invoice: 'D1', fecha: '2026-05-01', subtotalMonedaFactura: 77, operacionesGuardadas: [{ id: 'a', subtotalBase: 77 }] })], opciones());
    expect([r.renglones.length, r.sinMoneda.facturas, r.sinMoneda.total]).toEqual([0, 1, 77]);
  });

  it('factura importada sin renglones: el total se reparte en partes iguales entre sus operaciones', () => {
    const r = renglonesFacturados([cli({ id: 'F6', invoice: 'E1', fecha: '2026-06-01', monedaFacturacion: 'MXN', total: 90, operacionesIds: 'o1, o2, o3', operaciones: 'R1,R2,R3' })], opciones());
    expect(r.renglones.map((x) => [x.opId, x.ref, x.pes])).toEqual([['o1', 'R1', 30], ['o2', 'R2', 30], ['o3', 'R3', 30]]);
  });

  it('dólares sin datos para el TC en el renglón: usa el TC de respaldo de la operación', () => {
    const r = renglonesFacturados([cli({ id: 'F7', invoice: 'G1', fecha: '2026-06-01', monedaFacturacion: 'USD', subtotalMonedaFactura: 100, operacionesGuardadas: [{ id: 'a', dol: 100 }] })],
      opciones({ tcDe: (id) => (id === 'a' ? 18.5 : 0) }));
    expect(r.renglones.map((x) => [x.dol, x.tc, x.conv])).toEqual([[100, 18.5, 1850]]);
  });
});

describe('operacionesConFactura y costoPorOperacion', () => {
  it('solo cuentan las facturas no canceladas', () => {
    const ids = operacionesConFactura([
      cli({ id: 'a', operacionesGuardadas: [{ id: 'o1' }] }),
      cli({ id: 'b', statusFactura: 'Cancelado', operacionesGuardadas: [{ id: 'o2' }] }),
    ]);
    expect([...ids]).toEqual(['o1']);
  });
  it('suma el costo en pesos de cada operación', () => {
    const prov = renglonesFacturados([
      normalizarFacturaDe({ id: 'p1', invoice: 'P1', fecha: '2026-01-05', monedaProveedor: 'MXN', subtotalMonedaFactura: 100, operacionesGuardadas: [{ id: 'o1', monto: 100 }] }, 'proveedor'),
      normalizarFacturaDe({ id: 'p2', invoice: 'P2', fecha: '2026-02-05', monedaProveedor: 'USD', subtotalMonedaFactura: 10, operacionesGuardadas: [{ id: 'o1', dol: 10, monto: 180 }] }, 'proveedor'),
    ], opciones({ lado: 'proveedor', desde: '', hasta: '', monedaDe: (f) => monedaCanonica(f.monedaProveedor) }));
    expect(costoPorOperacion(prov.renglones).get('o1')).toBe(280);
  });
});

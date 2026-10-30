// ✅ V00526 — Reporte por facturar: agrupado por cliente, en la moneda del cliente, con sus sumas.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { armarReporte } from './reportePorFacturar';
import type { DatosOperacionReporte } from './reportePorFacturar';

const usd = (id: string, ref: string, monto: number, extra: Record<string, unknown> = {}) => ({
  id, ref, montoConvenioCliente: monto, facturadoEnCobrar: ID_USD, monedaConvenioCliente: ID_USD, tipoCambioAprobado: 18.42, fechaServicioISO: '2026-10-28', ...extra,
});
const mxn = (id: string, ref: string, monto: number) => ({ ...usd(id, ref, monto), facturadoEnCobrar: ID_MXN });

const CLIENTES: Record<string, { cliente: string; monedaCliente: 'USD' | 'MXN' | null }> = {
  chr: { cliente: 'C.H. Robinson', monedaCliente: 'USD' },
  temm: { cliente: 'Temm Truck', monedaCliente: 'MXN' },
  nuevo: { cliente: 'Cliente Nuevo', monedaCliente: null },
};
const datosDe = (op: Record<string, unknown>): DatosOperacionReporte => {
  const id = String(op.cli);
  return { clienteId: id, ...CLIENTES[id], monedaOperacion: op.facturadoEnCobrar === ID_MXN ? 'MXN' : 'USD', caja: String(op.caja ?? ''), convenio: 'Cruce' };
};

describe('armarReporte', () => {
  it('agrupa por cliente (orden alfabético), ordena por referencia y suma en la moneda del cliente', () => {
    const r = armarReporte([
      { ...mxn('t2', 'TR-211026-24', 140), cli: 'temm', caja: 'CG130' },
      { ...usd('c1', 'TR-271026-26', 150), cli: 'chr', refCliente: '568917117' },
      { ...mxn('t1', 'LO-211026-8', 170), cli: 'temm', caja: 'RP116' },
      { ...usd('c2', 'TR-271026-10', 50), cli: 'chr', refCliente: 'N/A' },
    ], datosDe);
    expect(r.grupos.map((g) => [g.cliente, g.moneda, g.subtotal, g.filas.map((f) => f.ref)])).toEqual([
      ['C.H. Robinson', 'USD', 200, ['TR-271026-010', 'TR-271026-026']],
      ['Temm Truck', 'MXN', 5710.2, ['LO-211026-008', 'TR-211026-024']],
    ]);
    expect(r.totales).toEqual({ USD: 200, MXN: 5710.2 });
    expect(r.referencias).toBe(4);
    const c1 = r.grupos[0].filas[1];
    expect([c1.refCliente, c1.fecha]).toEqual(['568917117', '28/10/2026']);
    expect(r.grupos[0].filas[0].refCliente).toBe(''); // N/A no se imprime
    expect(r.grupos[1].filas[0].lineas).toEqual(['LO-211026-008', '28/10/2026', 'CAJA RP116', 'TC 18.4200']);
  });

  it('cliente sin moneda en Empresas: usa la de la operación y lo marca', () => {
    const r = armarReporte([{ ...usd('n1', 'TR-011026-1', 99), cli: 'nuevo' }], datosDe);
    expect(r.grupos[0]).toMatchObject({ moneda: 'USD', sinMonedaCliente: true, subtotal: 99 });
  });
});

describe('libroReportePorFacturar', () => {
  it('genera el Excel con encabezados, filas, totales por cliente y total general', async () => {
    const { libroReportePorFacturar } = await import('./reportePorFacturar');
    const ExcelJS = (await import('exceljs')).default;
    const r = armarReporte([
      { ...mxn('t1', 'LO-211026-8', 170), cli: 'temm', caja: 'RP116' },
      { ...usd('c1', 'TR-271026-26', 150), cli: 'chr', refCliente: '568917117' },
    ], datosDe);
    const buf = await libroReportePorFacturar(r, 'Todo lo pendiente', '29/10/2026');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buf);
    const hoja = libro.getWorksheet('Por facturar');
    expect(hoja?.getRow(4).getCell(7).value).toBe('Datos para la Factura');
    expect(hoja?.getRow(4).getCell(9).value).toBe('Total (sin IVA)'); // ✅ V00527: el total de la operación, no el subtotal
    expect(hoja?.getRow(5).getCell(2).value).toBe('TR-271026-026');
    expect(hoja?.getRow(5).getCell(3).value).toBe('568917117');
    expect(hoja?.getRow(6).getCell(1).value).toBe('Total C.H. Robinson · 1 referencia');
    expect(hoja?.getRow(8).getCell(9).value).toBe(3131.4);
  });
});

describe('✅ V00527: el importe es el TOTAL de la operación (con cargos adicionales)', () => {
  it('subtotal $140 + cargos $250 → $390', () => {
    const r = armarReporte([{ ...usd('g1', 'TR-241026-5', 140), cargosAdicionales: 250, cli: 'chr' }], datosDe);
    expect(r.grupos[0].filas[0].importe).toBe(390);
    expect(r.totales.USD).toBe(390);
  });
});

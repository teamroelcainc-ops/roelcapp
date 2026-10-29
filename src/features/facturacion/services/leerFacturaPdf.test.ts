// ✅ V00514 — Lectura de facturas en PDF con el texto que entrega pdf.js de cinco PDF reales del 29-oct
// (CFDI del SIT en pesos y dólares, e Invoice de Roelca Inc), con los clientes y operadores cambiados.
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/facturasPdf.json';
import { leerFacturaPdf, lineasDeItems, refsDe } from './leerFacturaPdf';
import type { ItemPdf } from './leerFacturaPdf';

const pdf = fixture as Record<string, ItemPdf[][]>;
const leer = (n: string) => { const r = leerFacturaPdf(pdf[n]); if (!r.ok) throw new Error(r.error); return r.doc; };

describe('leerFacturaPdf', () => {
  it('CFDI del SIT en pesos con IVA: un concepto con dos referencias', () => {
    expect(leer('sit-F1072-mxn-iva')).toMatchObject({
      formato: 'sit', folio: 'F1072', fecha: '2026-10-27', clienteNombre: 'CLIENTE NACIONAL UNO', clienteRfc: 'CNU820506AB1',
      moneda: 'MXN', subtotal: 135000, total: 156600,
      conceptos: [{ refs: ['TR-221026-006', 'FL-201026-001'], importe: 135000 }],
    });
  });
  it('CFDI en pesos convertido: el TC escrito con dos puntos', () => {
    expect(leer('sit-A5756-mxn-tc')).toMatchObject({ folio: 'A5756', moneda: 'MXN', subtotal: 2053.37, conceptos: [{ refs: ['LO-261026-001'], importe: 2053.37, tc: 18.667 }] });
  });
  it('CFDI en dólares a un extranjero: RFC genérico y Tax ID; tres conceptos', () => {
    const d = leer('sit-I8663-usd-3');
    expect(d).toMatchObject({ folio: 'I8663', clienteNombre: 'CLIENTE EXTRANJERO,INC.', clienteRfc: 'XEXX010101000', clienteTaxId: '123456789', moneda: 'USD', subtotal: 275, total: 275 });
    expect(d.conceptos.map((c) => [c.refs.join(), c.importe])).toEqual([['TR-271026-026', 150], ['TR-271026-010', 50], ['TR-271026-014', 75]]);
    expect(leer('sit-I8664-usd')).toMatchObject({ folio: 'I8664', subtotal: 320, conceptos: [{ refs: ['TR-271026-002'], importe: 320 }] });
  });
  it('Invoice de Roelca Inc: número, Bill To, renglones y totales', () => {
    expect(leer('invoice-39838-usd')).toMatchObject({
      formato: 'invoice', folio: '39838', fecha: '2026-10-28', clienteNombre: 'Cliente Americano Logistics', moneda: 'USD',
      subtotal: 210, total: 210, conceptos: [{ refs: ['TR-271026-006'], importe: 210 }],
    });
  });
  it('renglones por altura y celdas por cercanía', () => {
    const l = lineasDeItems([{ s: 'F1072', x: 428, y: 743, w: 17 }, { s: 'SERIE Y FOLIO:', x: 353, y: 743.5, w: 45 }, { s: 'otra', x: 10, y: 700, w: 10 }]);
    expect(l.map((x) => x.texto)).toEqual(['SERIE Y FOLIO:  F1072', 'otra']);
  });
  it('sin texto o sin datos de factura: lo dice', () => {
    expect(leerFacturaPdf([[]])).toEqual({ ok: false, error: expect.stringContaining('no trae texto') });
    expect(leerFacturaPdf([[{ s: 'Hola', x: 1, y: 1, w: 5 }]])).toEqual({ ok: false, error: expect.stringContaining('No parece una factura') });
    expect(refsDe('tr-271026-26 y LO-261026-001')).toEqual(['TR-271026-026', 'LO-261026-001']);
  });
});

// ✅ V00514 — El documento (PDF / XML) contra la factura del formulario.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import fixture from './__fixtures__/facturasPdf.json';
import { compararDocumentoFactura, documentoDeCfdi, opEsperadaDeOperacion, opsEsperadasDeFactura } from './documentoFactura';
import type { FacturaEsperada } from './documentoFactura';
import { leerFacturaPdf } from './leerFacturaPdf';
import type { ItemPdf } from './leerFacturaPdf';

const doc = (n: string) => { const r = leerFacturaPdf((fixture as Record<string, ItemPdf[][]>)[n]); if (!r.ok) throw new Error(r.error); return r.doc; };
const extranjero = { nombre: 'Cliente Extranjero, Inc.', rfc: '123456789', moneda: 'USD' as const };
const I8663: FacturaEsperada = {
  folio: 'I8663', cliente: extranjero, moneda: 'USD', subtotal: 275,
  ops: [{ ref: 'TR-271026-026', importe: 150, tc: 0 }, { ref: 'TR-271026-010', importe: 50, tc: 0 }, { ref: 'TR-271026-014', importe: 75, tc: 0 }],
};
const errores = (e: FacturaEsperada, n = 'sit-I8663-usd-3') => compararDocumentoFactura(doc(n), e).hallazgos.filter((h) => h.nivel === 'error').map((h) => h.texto);

describe('compararDocumentoFactura', () => {
  it('coincide: número, cliente (por Tax ID), operaciones, costos y subtotal', () => {
    const r = compararDocumentoFactura(doc('sit-I8663-usd-3'), I8663);
    expect(r.coincide).toBe(true);
    expect(r.hallazgos.map((h) => h.campo)).toEqual(['folio', 'cliente', 'operaciones', 'importes', 'subtotal']);
  });
  it('otro número, otro cliente, otra moneda', () => {
    expect(errores({ ...I8663, folio: 'I8662' })).toEqual(['El número no es el mismo: el documento es la factura I8663 y en el formulario dice I8662.']);
    expect(errores({ ...I8663, folio: '' })[0]).toContain('el formulario no tiene número de invoice');
    expect(errores({ ...I8663, cliente: { nombre: 'Otra Empresa SA', rfc: 'OEM010101AAA', moneda: 'USD' } })[0])
      .toBe('El cliente no es el mismo: el documento es para CLIENTE EXTRANJERO,INC. (Tax ID 123456789) y la factura es de Otra Empresa SA (OEM010101AAA).');
    expect(errores({ ...I8663, moneda: 'MXN' })).toContain('La moneda no es la misma: el documento está en USD y la factura en MXN.');
  });
  it('esas no son las operaciones: sobran y faltan', () => {
    const e = { ...I8663, ops: [I8663.ops[0], I8663.ops[1], { ref: 'TR-271026-099', importe: 75, tc: 0 }] };
    expect(errores(e)).toContain('Esas no son las operaciones que van en esa factura: el documento trae TR-271026-014, que no está en la factura; la factura tiene TR-271026-099, que no está en el documento.');
  });
  it('costo de una operación y subtotal distintos', () => {
    const e = { ...I8663, subtotal: 270, ops: [I8663.ops[0], { ...I8663.ops[1], importe: 45 }, I8663.ops[2]] };
    expect(errores(e)).toEqual([
      'El costo no concuerda: TR-271026-010: el documento cobra 50.00 USD y la factura 45.00 (diferencia +5.00).',
      'Ese subtotal no concuerda con la factura: el documento dice 275.00 USD y la factura 270.00 USD (diferencia +5.00).',
    ]);
  });
  it('dos referencias en un concepto se suman; con IVA compara el subtotal y avisa el total', () => {
    const r = compararDocumentoFactura(doc('sit-F1072-mxn-iva'), {
      folio: 'F1072', cliente: { nombre: 'CLIENTE NACIONAL UNO SA DE CV', rfc: 'CNU820506AB1', moneda: 'MXN' }, moneda: 'MXN', subtotal: 135000,
      ops: [{ ref: 'TR-221026-006', importe: 100000, tc: 0 }, { ref: 'FL-201026-001', importe: 35000, tc: 0 }],
    });
    expect(r.coincide).toBe(true);
    expect(r.hallazgos.find((h) => h.campo === 'total')?.texto).toContain('Total con impuestos: 156,600.00 MXN');
  });
  it('en pesos con otro TC lo dice; el Invoice de Roelca Inc compara el cliente por nombre', () => {
    const a = errores({ folio: 'A5756', cliente: { nombre: 'Cliente Nacional Dos', rfc: 'CND040604XY2', moneda: 'MXN' }, moneda: 'MXN', subtotal: 2051.5, ops: [{ ref: 'LO-261026-001', importe: 2051.5, tc: 18.65 }] }, 'sit-A5756-mxn-tc');
    expect(a[0]).toBe('El costo no concuerda: LO-261026-001: el documento cobra 2,053.37 MXN y la factura 2,051.50 (diferencia +1.87). El documento usa TC 18.667 y la operación 18.65.');
    const inv = compararDocumentoFactura(doc('invoice-39838-usd'), { folio: '39838', cliente: { nombre: 'CLIENTE AMERICANO LOGISTICS INC', rfc: '', moneda: 'USD' }, moneda: 'USD', subtotal: 210, ops: [{ ref: 'TR-271026-006', importe: 210, tc: 0 }] });
    expect(inv.coincide).toBe(true);
    expect(errores({ folio: '39838', cliente: { nombre: 'Otro Cliente', rfc: '', moneda: 'USD' }, moneda: 'USD', subtotal: 210, ops: [{ ref: 'TR-271026-006', importe: 210, tc: 0 }] }, 'invoice-39838-usd')[0]).toContain('El cliente no es el mismo');
  });
  it('lo esperado: de las operaciones seleccionadas y de una factura registrada', () => {
    const op = { ref: 'tr-271026-26', montoConvenioCliente: 150, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD, tipoCambioDia: 18 };
    expect(opEsperadaDeOperacion(op, 'USD')).toEqual({ ref: 'TR-271026-026', importe: 150, tc: 18 });
    expect(opEsperadaDeOperacion({ ...op, facturadoEnCobrar: ID_MXN }, 'MXN').importe).toBe(2700);
    expect(opsEsperadasDeFactura({ operacionesGuardadas: [{ id: 'a', ref: 'TR-271026-026', monto: 2700, dol: 150, pes: 0, subtotalBase: 150 }], operaciones: ['TR-271026-010', 'basura'] }, 'USD'))
      .toEqual([{ ref: 'TR-271026-026', importe: 150, tc: 0 }, { ref: 'TR-271026-010', importe: null, tc: 0 }]);
  });
  it('el XML entra en la misma forma', () => {
    const d = documentoDeCfdi({ folio: 'I1', serie: 'I', numero: '1', fecha: '2026-10-28', tipo: 'I', moneda: 'USD', tipoCambio: 18, subtotal: 50, total: 50, uuid: '', emisorRfc: '', receptorNombre: 'X', receptorRfc: 'XEXX010101000', receptorTaxId: '1', conceptos: [{ descripcion: 'TR-271026-010', importe: 50, refs: ['TR-271026-010'], caja: '', refCliente: '', tcDescripcion: 0 }] });
    expect(d).toMatchObject({ formato: 'xml', folio: 'I1', subtotal: 50, conceptos: [{ refs: ['TR-271026-010'], importe: 50, tc: 0 }] });
  });
});

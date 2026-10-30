// ✅ V00533 — El subtotal de la factura capturado a mano: avisos contra el documento y lo que se escribe.
import { describe, expect, it } from 'vitest';
import { ErrorDinero } from '../../../shared/dominio/dinero';
import type { DocumentoFactura } from './leerFacturaPdf';
import { avisosSubtotal, documentoParaSubtotal, planSubtotalManual } from './subtotalManual';

// La E48 de la captura: SUBTOTAL 415.00, IVA 66.40, TOTAL 481.40 USD; la factura guardó 481.40.
const doc = (extra: Partial<DocumentoFactura> = {}): DocumentoFactura => ({
  formato: 'sit', folio: 'E48', fecha: '2026-10-26', clienteNombre: 'X', clienteRfc: '', clienteTaxId: '', moneda: 'USD',
  subtotal: 415, total: 481.4, conceptos: [], ...extra,
});
const e48 = { nombre: 'E48.pdf', doc: doc() };

describe('avisosSubtotal', () => {
  it('coincide con el subtotal del documento', () => {
    expect(avisosSubtotal({ valor: '415', moneda: 'USD', documento: e48, sumaOps: 415 }))
      .toEqual([{ nivel: 'ok', texto: 'Coincide con el subtotal del documento (415.00 USD).' }]);
  });
  it('si es el TOTAL del documento (con IVA) lo dice, y que sus operaciones suman otra cosa', () => {
    expect(avisosSubtotal({ valor: '481.40', moneda: 'USD', documento: e48, sumaOps: 415 })).toEqual([
      { nivel: 'aviso', texto: 'No coincide: 481.40 es el TOTAL del documento (con impuestos). Su subtotal es 415.00 USD.' },
      { nivel: 'info', texto: 'Sus operaciones suman 415.00 USD: con este subtotal la factura saldrá en Corregir.' },
    ]);
  });
  it('otro número: la diferencia contra el subtotal', () => {
    expect(avisosSubtotal({ valor: '400', moneda: 'USD', documento: e48, sumaOps: null })[0])
      .toEqual({ nivel: 'aviso', texto: 'No coincide con el subtotal del documento: el documento dice 415.00 USD (diferencia -15.00).' });
  });
  it('sin documento solo compara con sus operaciones; vacío pide el número', () => {
    expect(avisosSubtotal({ valor: '415', moneda: 'USD', documento: null, sumaOps: 415 })).toEqual([]);
    expect(avisosSubtotal({ valor: '', moneda: 'USD', documento: e48, sumaOps: 415 })).toEqual([{ nivel: 'aviso', texto: 'Escribe el subtotal (sin IVA).' }]);
  });
  it('avisa si el documento está en otra moneda', () => {
    expect(avisosSubtotal({ valor: '415', moneda: 'MXN', documento: { nombre: 'x', doc: doc() }, sumaOps: null })[0].texto).toMatch(/está en USD y la factura en MXN/);
  });
});

describe('documentoParaSubtotal', () => {
  it('el XML antes que el PDF; sin subtotal o con error no cuenta', () => {
    const pdf = { nombre: 'a.pdf', lectura: { ok: true as const, doc: doc() } };
    const xml = { nombre: 'a.xml', lectura: { ok: true as const, doc: doc({ formato: 'xml', subtotal: 416 }) } };
    const sinSub = { nombre: 'b.pdf', lectura: { ok: true as const, doc: doc({ formato: 'otro', subtotal: null }) } };
    const error = { nombre: 'c.pdf', lectura: { ok: false as const, error: 'x' } };
    expect(documentoParaSubtotal([pdf, xml])?.nombre).toBe('a.xml');
    expect(documentoParaSubtotal([sinSub, error, pdf])?.nombre).toBe('a.pdf');
    expect(documentoParaSubtotal([sinSub, error])).toBeNull();
  });
});

describe('planSubtotalManual', () => {
  const fac = { monedaFacturacion: 'USD', subtotalMonedaFactura: 481.4, subtotalFactura: 8416.22, montoPagado: 0 };
  it('E48: 481.40 → 415.00; la conversión baja en la misma proporción y queda como capturado a mano', () => {
    expect(planSubtotalManual(fac, 415, 'T', 'omar')).toEqual({
      subtotalMonedaFactura: 415, subtotalFactura: 7255.36, totalManualCentavos: 41500, saldoPendiente: 415, editadoEn: 'T', editadoPor: 'omar',
    });
  });
  it('en pesos la conversión es el mismo número; con pagos, el saldo y el status', () => {
    expect(planSubtotalManual({ monedaFacturacion: 'MXN', subtotalMonedaFactura: 1160, subtotalFactura: 1160, montoPagado: 1000 }, 1000, 'T', 'u'))
      .toMatchObject({ subtotalMonedaFactura: 1000, subtotalFactura: 1000, saldoPendiente: 0, statusPago: 'PAGADA' });
  });
  it('no por debajo de lo pagado ni en cero', () => {
    expect(() => planSubtotalManual({ ...fac, montoPagado: 450 }, 415, 'T', 'u')).toThrow(ErrorDinero);
    expect(() => planSubtotalManual(fac, 0, 'T', 'u')).toThrow(/mayor que \$0.00/);
  });
});

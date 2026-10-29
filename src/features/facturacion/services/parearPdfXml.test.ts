// ✅ V00513 — Juntar cada PDF con su XML.
import { describe, expect, it } from 'vitest';
import { baseNombre, parearPdfXml } from './parearPdfXml';

const x = (clave: string, nombre: string, folio: string, uuid = '') => ({ clave, nombre, folio, uuid });
const p = (clave: string, nombre: string) => ({ clave, nombre });

describe('parearPdfXml', () => {
  it('mismo nombre del SIT, sin importar mayúsculas ni el (1) del navegador', () => {
    const r = parearPdfXml(
      [x('x1', 'ROE180119IV4-I8663.xml', 'I8663'), x('x2', 'ROE180119IV4-A5744.xml', 'A5744')],
      [p('p2', 'roe180119iv4-a5744 (1).PDF'), p('p1', 'ROE180119IV4-I8663.pdf')],
    );
    expect([...r.pdfDeXml]).toEqual([['x1', 'p1'], ['x2', 'p2']]);
    expect(r.pdfSueltos).toEqual([]);
  });

  it('por UUID y luego por folio como palabra completa (I866 no es I8663)', () => {
    const r = parearPdfXml(
      [x('x1', 'a.xml', 'I8663', '7E3F034C-9061'), x('x2', 'b.xml', 'I866')],
      [p('p1', 'factura 7e3f034c-9061.pdf'), p('p2', 'Factura I8663.pdf'), p('p3', 'Factura_I866.pdf')],
    );
    expect(r.pdfDeXml.get('x1')).toBe('p1');
    expect(r.pdfDeXml.get('x2')).toBe('p3');
    expect(r.pdfSueltos).toEqual(['p2']);
  });

  it('cada PDF se usa una sola vez; sin pareja queda suelto', () => {
    const r = parearPdfXml([x('x1', 'I1.xml', 'I1'), x('x2', 'I1 (1).xml', 'I1')], [p('p1', 'I1.pdf')]);
    expect(r.pdfDeXml.size).toBe(1);
    expect(parearPdfXml([], [p('p1', 'otro.pdf')]).pdfSueltos).toEqual(['p1']);
  });

  it('baseNombre', () => {
    expect(baseNombre('ROE180119IV4-I8663 (2).Pdf')).toBe('roe180119iv4-i8663');
  });
});

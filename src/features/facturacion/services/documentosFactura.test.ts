// ✅ V00451 — documentos de la factura: varios por factura, grupos con el mismo folio, píldora.
import { describe, expect, it } from 'vitest';
import {
  aplicarEscriturasDocs, camposDocsDeGrupo, camposDocsFactura, detalleError, docsDeFactura, escriturasDocsFactura,
  etiquetaPildoraDocs, idsDeFila, tituloPildoraDocs, unirDocs,
} from './documentosFactura';

const a = { url: 'u-a', nombre: 'a.pdf' };
const b = { url: 'u-b', nombre: 'b.jpg' };
const c = { url: 'u-c', nombre: 'c.pdf' };

describe('docsDeFactura', () => {
  it('lee la lista nueva o, si no la hay, el documento de siempre', () => {
    expect(docsDeFactura({ docsFactura: [a, b] })).toEqual([a, b]);
    expect(docsDeFactura({ docsFactura: [a, b, { ...a, nombre: 'otra vez.pdf' }] })).toEqual([a, b]); // la URL es la llave
    expect(docsDeFactura({ docFacturaUrl: 'u0', docFacturaNombre: 'viejo.pdf', docFacturaFecha: '2026-10-01', docFacturaPor: 'x@y' }))
      .toEqual([{ url: 'u0', nombre: 'viejo.pdf', fecha: '2026-10-01', por: 'x@y' }]);
    expect(docsDeFactura({ docsFactura: [], docFacturaUrl: '' })).toEqual([]);
    expect(docsDeFactura(null)).toEqual([]);
  });
  it('los campos guardan la lista y el PRIMERO en los campos de siempre (vacíos si no queda ninguno)', () => {
    expect(camposDocsFactura([a, b])).toEqual({ docsFactura: [a, b], docFacturaUrl: 'u-a', docFacturaNombre: 'a.pdf', docFacturaFecha: '', docFacturaPor: '' });
    expect(camposDocsFactura([])).toEqual({ docsFactura: [], docFacturaUrl: '', docFacturaNombre: '', docFacturaFecha: '', docFacturaPor: '' });
  });
});

describe('grupos con el mismo folio', () => {
  it('une sin repetir, en orden', () => {
    expect(unirDocs([a, b], [b, c], [a])).toEqual([a, b, c]);
  });
  it('la fila junta los archivos de todos los documentos del grupo (también los de siempre)', () => {
    const primero = { id: 'F1', docFacturaUrl: 'u-a', docFacturaNombre: 'a.pdf' };
    const segundo = { id: 'F2', docsFactura: [b, a] };
    expect(camposDocsDeGrupo(primero, segundo)).toMatchObject({ docsFactura: [{ url: 'u-a', nombre: 'a.pdf' }, b], docFacturaUrl: 'u-a' });
    expect(camposDocsDeGrupo({ id: 'F1' }, { id: 'F2', docsFactura: [c] })).toMatchObject({ docsFactura: [c], docFacturaUrl: 'u-c' });
    expect(camposDocsDeGrupo({ id: 'F1' }, { id: 'F2' })).toEqual({});
  });
  it('al guardar: la lista completa en el primero y vacía en los demás que tenían archivos', () => {
    const fila = {
      id: 'F1', __groupIds: ['F1', 'F2', 'F3'],
      __groupDocs: [{ id: 'F1' }, { id: 'F2', docFacturaUrl: 'u-b' }, { id: 'F3' }],
    };
    const escrituras = escriturasDocsFactura(fila, [a, b]);
    expect(escrituras.map((e) => e.id)).toEqual(['F1', 'F2']);
    expect(escrituras[0].campos).toMatchObject({ docsFactura: [a, b], docFacturaUrl: 'u-a' });
    expect(escrituras[1].campos).toMatchObject({ docsFactura: [], docFacturaUrl: 'u-a' }); // el portal lee el primero
    expect(escriturasDocsFactura(fila, [])[1].campos).toMatchObject({ docsFactura: [], docFacturaUrl: '' });
    expect(escriturasDocsFactura({ id: 'F9' }, [])).toEqual([{ id: 'F9', campos: camposDocsFactura([]) }]);
    expect(idsDeFila({ id: 'F9', __groupIds: [] })).toEqual(['F9']);
  });
  it('aplica las escrituras a la lista local sin tocar las demás facturas', () => {
    const lista = [{ id: 'F1', invoice: '1' }, { id: 'F2', invoice: '1', docFacturaUrl: 'u-b' }, { id: 'F3', invoice: '2' }];
    const nueva = aplicarEscriturasDocs(lista, escriturasDocsFactura({ id: 'F1', __groupIds: ['F1', 'F2'], __groupDocs: lista.slice(0, 2) }, [b]));
    expect(nueva[0]).toMatchObject({ id: 'F1', docsFactura: [b], docFacturaUrl: 'u-b' });
    expect(nueva[1]).toMatchObject({ id: 'F2', docsFactura: [], docFacturaUrl: 'u-b' });
    expect(nueva[2]).toBe(lista[2]);
  });
});

describe('píldora y avisos', () => {
  it('texto de la píldora', () => {
    expect(etiquetaPildoraDocs(0)).toBe('Sin doc');
    expect(etiquetaPildoraDocs(1)).toBe('Doc ✓');
    expect(etiquetaPildoraDocs(3)).toBe('Doc ✓ (3)');
    expect(tituloPildoraDocs([])).toContain('Sin el documento');
    expect(tituloPildoraDocs([{ ...a, fecha: '2026-10-14', por: 'x@y' }])).toContain('Documento cargado el 2026-10-14 por x@y');
    expect(tituloPildoraDocs([a, b])).toContain('2 documentos');
  });
  it('motivo legible del error', () => {
    expect(detalleError({ code: 'storage/unauthorized', message: 'x' })).toBe('storage/unauthorized');
    expect(detalleError(new Error('La factura ya no existe.'))).toBe('La factura ya no existe.');
    expect(detalleError('raro')).toBe('raro');
  });
});

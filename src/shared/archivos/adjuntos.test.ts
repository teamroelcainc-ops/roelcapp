// ✅ V00451 — adjuntos: validación, listas de un documento (nuevas y de siempre), cambios.
import { describe, expect, it } from 'vitest';
import {
  adjuntoGuardado, adjuntoNuevo, archivosDeDocumento, camposDeArchivos, cambioAdjuntos, esImagen, esPdf, nombreSeguro, resumenArchivos, tamanoLegible, validarArchivo, tipoDeDataUrl, desdeGuardados,
} from './adjuntos';

const archivo = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

describe('tipos y tamaño', () => {
  it('reconoce PDF e imagen por tipo o extensión (también en URLs de Storage)', () => {
    expect(esPdf('a.PDF')).toBe(true);
    expect(esPdf('https://x/o/pagos%2F1%2Fa.pdf?alt=media&token=1')).toBe(true);
    expect(esImagen('foto.jpeg')).toBe(true);
    expect(esImagen('x', 'image/png')).toBe(true);
    expect(esPdf('hoja.xlsx')).toBe(false);
  });
  it('valida según la carga (PDF/imagen, solo imagen, cualquiera) y el tope de MB', () => {
    expect(validarArchivo({ name: 'a.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 })).toBe('');
    expect(validarArchivo({ name: 'a.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 + 1 })).toContain('máximo es 20 MB');
    expect(validarArchivo({ name: 'a.xlsx', type: 'application/vnd.ms-excel', size: 1 })).toContain('no es PDF ni imagen');
    expect(validarArchivo({ name: 'a.pdf', type: 'application/pdf', size: 1 }, 'imagen')).toContain('no es una imagen');
    expect(validarArchivo({ name: 'a.xlsx', type: '', size: 1 }, 'cualquiera')).toBe('');
  });
  it('tamaño legible y nombre seguro', () => {
    expect(tamanoLegible(159 * 1024)).toBe('159 KB');
    expect(tamanoLegible(0)).toBe('');
    expect(nombreSeguro('PAGO TRANSPLACE $700.00 USD.pdf')).toBe('PAGO_TRANSPLACE_700.00_USD.pdf');
    expect(nombreSeguro('Factura señalada.pdf')).toBe('Factura_senalada.pdf');
  });
});

describe('archivos de un documento', () => {
  it('lee la lista nueva o, si no hay, el archivo único de siempre', () => {
    const legado = { url: 'docFacturaUrl', nombre: 'docFacturaNombre', fecha: 'docFacturaFecha', por: 'docFacturaPor' };
    expect(archivosDeDocumento({ docsFactura: [{ url: 'u1', nombre: 'a.pdf' }, { url: '' }] }, 'docsFactura', legado)).toEqual([{ url: 'u1', nombre: 'a.pdf' }]);
    expect(archivosDeDocumento({ docFacturaUrl: 'u0', docFacturaNombre: 'viejo.pdf', docFacturaFecha: '2026-10-01T10:00' }, 'docsFactura', legado))
      .toEqual([{ url: 'u0', nombre: 'viejo.pdf', fecha: '2026-10-01' }]);
    expect(archivosDeDocumento({ fotos: ['u1', 'u2'] }, 'fotos')).toHaveLength(2);
    expect(archivosDeDocumento({}, 'docsFactura', legado)).toEqual([]);
  });
  it('escribe la lista y el primero en los campos de siempre (vacíos si no queda ninguno)', () => {
    const legado = { url: 'pdfUrl', nombre: 'pdfNombre' };
    expect(camposDeArchivos([{ url: 'u1', nombre: 'a.pdf' }, { url: 'u2', nombre: 'b.pdf' }], 'comprobantes', legado))
      .toEqual({ comprobantes: [{ url: 'u1', nombre: 'a.pdf' }, { url: 'u2', nombre: 'b.pdf' }], pdfUrl: 'u1', pdfNombre: 'a.pdf' });
    expect(camposDeArchivos([], 'comprobantes', legado)).toEqual({ comprobantes: [], pdfUrl: '', pdfNombre: '' });
  });
  it('detecta cambios y resume', () => {
    const g = [{ url: 'u1', nombre: 'a.pdf' }, { url: 'u2', nombre: 'b.pdf' }];
    expect(cambioAdjuntos(g.map(adjuntoGuardado), g)).toBe(false);
    expect(cambioAdjuntos([adjuntoGuardado(g[0])], g)).toBe(true);
    expect(cambioAdjuntos([...g.map(adjuntoGuardado), adjuntoNuevo(archivo('c.pdf', 'application/pdf'))], g)).toBe(true);
    expect(resumenArchivos(g)).toBe('a.pdf (+1)');
  });
});

describe('V00451: fotos en base64 y URLs repetidas', () => {
  it('reconoce data: de imagen y de PDF', () => {
    expect(esImagen('data:image/jpeg;base64,AAA')).toBe(true);
    expect(esPdf('data:application/pdf;base64,AAA')).toBe(true);
    expect(tipoDeDataUrl('data:image/png;base64,AAA')).toBe('image/png');
    expect(tipoDeDataUrl('https://x/y.png')).toBe('');
  });
  it('dos guardados con la misma URL tienen claves distintas', () => {
    const l = desdeGuardados([{ url: 'u1', nombre: 'a' }, { url: 'u1', nombre: 'a' }, { url: 'u2', nombre: 'b' }]);
    expect(new Set(l.map((a) => a.clave)).size).toBe(3);
    expect(l[0].clave).toBe('u1');
  });
});

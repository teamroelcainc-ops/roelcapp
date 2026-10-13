// ✅ V00450 — comprobante del pago: tipos aceptados, tope de 20 MB y tamaño legible.
import { describe, expect, it } from 'vitest';
import { esImagen, esPdf, tamanoLegible, validarComprobante } from './comprobante';

describe('comprobante', () => {
  it('reconoce PDF e imagen por tipo o por extensión', () => {
    expect(esPdf('a.PDF')).toBe(true);
    expect(esPdf('x', 'application/pdf')).toBe(true);
    expect(esPdf('https://x/o/pagos%2F1%2Fa.pdf?alt=media&token=1')).toBe(true);
    expect(esImagen('foto.jpeg')).toBe(true);
    expect(esImagen('x', 'image/png')).toBe(true);
    expect(esPdf('hoja.xlsx')).toBe(false);
  });
  it('acepta hasta 20 MB y solo PDF o imagen', () => {
    expect(validarComprobante({ name: 'a.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 })).toBe('');
    expect(validarComprobante({ name: 'a.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 + 1 })).toContain('máximo es 20 MB');
    expect(validarComprobante({ name: 'a.xlsx', type: 'application/vnd.ms-excel', size: 10 })).toContain('no es PDF ni imagen');
  });
  it('tamaño legible', () => {
    expect(tamanoLegible(500)).toBe('500 B');
    expect(tamanoLegible(159 * 1024)).toBe('159 KB');
    expect(tamanoLegible(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});

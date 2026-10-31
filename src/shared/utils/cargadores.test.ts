// ✅ V00534 — Los cargadores únicos de librerías pesadas: una sola descarga y reintento si falla.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('xlsx');
  vi.doUnmock('exceljs');
  vi.doUnmock('html2pdf.js');
  vi.doUnmock('jszip');
});

describe('excel.ts', () => {
  it('cargarXlsx devuelve la librería y la reutiliza', async () => {
    const fabrica = vi.fn(() => ({ utils: { book_new: () => 'libro' } }));
    vi.doMock('xlsx', fabrica);
    const { cargarXlsx } = await import('./excel');
    const a = await cargarXlsx();
    const b = await cargarXlsx();
    expect(a.utils.book_new()).toBe('libro');
    expect(a).toBe(b);
    expect(fabrica).toHaveBeenCalledTimes(1);
  });
  it('cargarExcelJS toma la clase de `default` (o del módulo)', async () => {
    class Workbook { hojas = 0; }
    vi.doMock('exceljs', () => ({ default: { Workbook } }));
    const { cargarExcelJS } = await import('./excel');
    const ExcelJS = await cargarExcelJS();
    expect(new ExcelJS.Workbook()).toBeInstanceOf(Workbook);
  });
  it('si la carga falla, la siguiente vez reintenta', async () => {
    let intentos = 0;
    vi.doMock('xlsx', () => {
      intentos += 1;
      if (intentos === 1) throw new Error('sin conexión');
      return { version: 'ok' };
    });
    const { cargarXlsx } = await import('./excel');
    await expect(cargarXlsx()).rejects.toThrow();
    vi.resetModules();
    const otra = await import('./excel');
    await expect(otra.cargarXlsx()).resolves.toMatchObject({ version: 'ok' });
  });
});

describe('pdf.ts y zip.ts', () => {
  it('cargarHtml2pdf devuelve la función de html2pdf', async () => {
    const html2pdf = vi.fn();
    vi.doMock('html2pdf.js', () => ({ default: html2pdf }));
    const { cargarHtml2pdf } = await import('./pdf');
    expect(await cargarHtml2pdf()).toBe(html2pdf);
  });
  it('cargarJSZip devuelve la clase y la reutiliza', async () => {
    class JSZip {}
    vi.doMock('jszip', () => ({ default: JSZip }));
    const { cargarJSZip } = await import('./zip');
    expect(await cargarJSZip()).toBe(JSZip);
    expect(await cargarJSZip()).toBe(JSZip);
  });
});

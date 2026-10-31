// ✅ V00534 — Escapar texto para HTML crudo (util propio; pdfGenerator lo reexporta).
import { describe, expect, it } from 'vitest';
import { escaparHTML, escaparTextos } from './html';
import { escaparHTML as desdePdfGenerator } from '../../utils/pdfGenerator';

describe('escaparHTML', () => {
  it('escapa & < > " y \'', () => {
    expect(escaparHTML(`<img src="x" onerror='a()'> & más`)).toBe('&lt;img src=&quot;x&quot; onerror=&#039;a()&#039;&gt; &amp; más');
  });
  it('null y undefined → texto vacío; números → texto', () => {
    expect(escaparHTML(null)).toBe('');
    expect(escaparHTML(undefined)).toBe('');
    expect(escaparHTML(12.5)).toBe('12.5');
  });
  it('pdfGenerator reexporta el mismo', () => {
    expect(desdePdfGenerator).toBe(escaparHTML);
  });
});

describe('escaparTextos', () => {
  it('escapa solo los textos y deja lo demás igual', () => {
    const fecha = new Date(0);
    expect(escaparTextos({ a: '<b>', n: 3, f: fecha, v: undefined })).toEqual({ a: '&lt;b&gt;', n: 3, f: fecha, v: undefined });
  });
});

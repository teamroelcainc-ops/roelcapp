// ✅ V00444 (Fase 8.1) — selectores puros de Facturación (antes copiados en los dos tableros).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aplicarConfigColumnasGuardada, colorStatusFactura, fechaOrdenKey, moverIdAlInicio, pareceReferencia,
  parseFechaFactura, refNaturalKey, valorGenericoOp,
} from './selectores';

afterEach(() => { vi.useRealTimers(); });

describe('parseFechaFactura', () => {
  it('ISO y AAAA/M/D se normalizan a AAAA-MM-DD', () => {
    expect(parseFechaFactura('2026-3-7')).toBe('2026-03-07');
    expect(parseFechaFactura('2026-03-07T10:00:00Z')).toBe('2026-03-07');
    expect(parseFechaFactura('2026/3/7')).toBe('2026-03-07');
  });

  it('A/B/AAAA: día > 12 no es ambiguo', () => {
    expect(parseFechaFactura('25/03/2026')).toBe('2026-03-25');
    expect(parseFechaFactura('03/25/2026')).toBe('2026-03-25');
  });

  it('ambigua: D/M salvo que caiga en el futuro y M/D no', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00'));
    expect(parseFechaFactura('05/03/2026')).toBe('2026-03-05'); // D/M pasada
    expect(parseFechaFactura('03/05/2026')).toBe('2026-03-05'); // D/M = 3 de mayo (futuro) → M/D
  });

  it('vacío → vacío; lo que no reconoce se devuelve tal cual', () => {
    expect(parseFechaFactura(null)).toBe('');
    expect(parseFechaFactura('   ')).toBe('');
    expect(parseFechaFactura('ayer')).toBe('ayer');
  });
});

describe('fechaOrdenKey', () => {
  it('cada formato a AAAAMMDD', () => {
    expect(fechaOrdenKey('2026-3-7')).toBe('20260307');
    expect(fechaOrdenKey('2026/03/07')).toBe('20260307');
    expect(fechaOrdenKey('7/3/2026')).toBe('20260307');
    expect(fechaOrdenKey('7-3-26')).toBe('20260307');
    expect(fechaOrdenKey('')).toBe('00000000');
  });
});

describe('refNaturalKey / pareceReferencia', () => {
  it('orden natural de referencias', () => {
    const refs = ['RFT-10', 'RFT-9', 'RFT-100'].map((ref) => ({ ref }));
    expect(refs.sort((a, b) => refNaturalKey(a).localeCompare(refNaturalKey(b))).map((r) => r.ref)).toEqual(['RFT-9', 'RFT-10', 'RFT-100']);
  });

  it('un id hexadecimal de Firestore no es referencia', () => {
    expect(pareceReferencia('RFT-1234')).toBe(true);
    expect(pareceReferencia('d449e0e7a1b2')).toBe(false);
    expect(pareceReferencia('')).toBe(false);
  });
});

describe('columnas', () => {
  const base = [{ id: 'a', visible: true }, { id: 'b', visible: true }, { id: 'c', visible: false }];

  it('aplica orden y visibilidad guardados; las nuevas de la base van al final', () => {
    const r = aplicarConfigColumnasGuardada(base, [{ id: 'b', visible: false }, { id: 'a', visible: true }, { id: 'x', visible: true }]);
    expect(r.map((c) => `${c.id}:${c.visible}`)).toEqual(['b:false', 'a:true', 'c:false']);
  });

  it('sin configuración guardada: copia de la base', () => {
    const r = aplicarConfigColumnasGuardada(base, null);
    expect(r).toEqual(base);
    expect(r[0]).not.toBe(base[0]);
  });

  it('moverIdAlInicio', () => {
    expect(moverIdAlInicio(base, 'c').map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(moverIdAlInicio(base, 'a')).toBe(base);
    expect(moverIdAlInicio(base, 'zz')).toBe(base);
  });
});

describe('otros', () => {
  it('valorGenericoOp toma el primer sourceField con dato', () => {
    expect(valorGenericoOp({ a: '', b: 0, c: 3 }, { sourceField: ['a', 'b', 'c'] })).toBe(0);
    expect(valorGenericoOp({ a: 'x' }, { sourceField: 'a' })).toBe('x');
    expect(valorGenericoOp({ a: 'x' }, null)).toBe('');
  });

  it('colorStatusFactura', () => {
    expect(colorStatusFactura('Cancelado')).toBe('#f85149');
    expect(colorStatusFactura('No Facturado')).toBe('#f59e0b');
    expect(colorStatusFactura('Facturado')).toBe('#10b981');
    expect(colorStatusFactura(undefined)).toBe('#8b949e');
  });
});

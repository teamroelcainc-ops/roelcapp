// ✅ V00444 (Fase 8.1) — selectores puros de Facturación (antes copiados en los dos tableros).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aplicarConfigColumnasGuardada, colorStatusFactura, fechaFacturaISO, fechaOrdenKey, moverIdAlInicio, pareceReferencia,
  parseFechaFactura, refNaturalKey, textoFacturadoEn, valorGenericoOp,
} from './selectores';
import { ID_MXN, ID_USD } from '../../shared/dominio/constantes';

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

describe('✅ V00488 — fechas que antes quedaban fuera del filtro de fechas', () => {
  it('Timestamp de Firestore, {seconds} y Date (día local)', () => {
    const d = new Date(2026, 5, 15, 10, 30);
    expect(parseFechaFactura({ toDate: () => d })).toBe('2026-06-15');
    expect(parseFechaFactura({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 })).toBe('2026-06-15');
    expect(parseFechaFactura(d)).toBe('2026-06-15');
    expect(parseFechaFactura(`Timestamp(seconds=${Math.floor(d.getTime() / 1000)}, nanoseconds=0)`)).toBe('2026-06-15');
  });
  it('serial de Excel (número o texto) y milisegundos', () => {
    expect(parseFechaFactura(46188)).toBe('2026-06-15');
    expect(parseFechaFactura('46188')).toBe('2026-06-15');
    expect(parseFechaFactura(new Date(2026, 6, 1, 12).getTime())).toBe('2026-07-01');
  });
  it('año de 2 dígitos y meses con nombre', () => {
    expect(parseFechaFactura('15/06/26')).toBe('2026-06-15');
    expect(parseFechaFactura('15 jun 2026')).toBe('2026-06-15');
    expect(parseFechaFactura('15 de junio de 2026')).toBe('2026-06-15');
    expect(parseFechaFactura('15-Jul-26')).toBe('2026-07-15');
    expect(parseFechaFactura('Jun 15, 2026')).toBe('2026-06-15');
  });
  it('fechaFacturaISO: solo AAAA-MM-DD; lo que no se reconoce o falta → vacío', () => {
    expect(fechaFacturaISO('2026-06-15T00:00:00Z')).toBe('2026-06-15');
    expect(fechaFacturaISO('ayer')).toBe('');
    expect(fechaFacturaISO('')).toBe('');
    expect(fechaFacturaISO(undefined)).toBe('');
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

describe('✅ V00489 — textoFacturadoEn (la misma fuente que la regla de dinero)', () => {
  it('el ID manda sobre la copia del nombre', () => {
    expect(textoFacturadoEn({ facturadoEnCobrar: ID_MXN, monedaCobroNombre: 'Dólares' }, 'cliente')).toBe('Pesos');
    expect(textoFacturadoEn({ facturadoEnUnidad: ID_USD, monedaUnidadNombre: 'Pesos' }, 'proveedor')).toBe('Dólares');
  });
  it('sin ID reconocido usa el nombre; sin nada, el texto guardado o "-"', () => {
    expect(textoFacturadoEn({ facturadoEnCobrar: '', monedaCobroNombre: 'USD' }, 'cliente')).toBe('Dólares');
    expect(textoFacturadoEn({ facturadoEnCobrar: 'abc123', monedaCobroNombre: 'Euros' }, 'cliente')).toBe('Euros');
    expect(textoFacturadoEn({}, 'proveedor')).toBe('-');
  });
});

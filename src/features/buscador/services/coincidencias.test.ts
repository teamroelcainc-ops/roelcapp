// ✅ V00502 — reglas de coincidencia del buscador global.
import { describe, expect, it } from 'vitest';
import { mejores, normalizar, puntaje, variantesPrefijo } from './coincidencias';

describe('normalizar', () => {
  it('sin mayúsculas, acentos ni espacios repetidos', () => {
    expect(normalizar('  A. CASTAÑEDA   & Co. ')).toBe('a. castaneda & co.');
    expect(normalizar(null)).toBe('');
    expect(normalizar(39785)).toBe('39785');
  });
});

describe('puntaje', () => {
  it('todas las palabras deben aparecer, en cualquier campo y orden', () => {
    expect(puntaje(['Landstar Transportation Logistics', 'USD'], 'landstar')).toBeGreaterThan(0);
    expect(puntaje(['Landstar Transportation Logistics', 'USD'], 'transportation landstar')).toBeGreaterThan(0);
    expect(puntaje(['Landstar Transportation Logistics', 'USD'], 'landstar usd')).toBeGreaterThan(0);
    expect(puntaje(['Landstar Transportation Logistics'], 'landstar mxn')).toBe(0);
    expect(puntaje(['A. CASTAÑEDA & CO. INC.'], 'castaneda')).toBeGreaterThan(0);
    expect(puntaje(['x'], '   ')).toBe(0);
  });
  it('igual > empieza igual > empieza una palabra > en medio; el título pesa más', () => {
    const igual = puntaje(['TR-261026-004'], 'tr-261026-004');
    const empieza = puntaje(['TR-261026-0045'], 'tr-261026-004');
    const palabra = puntaje(['Cruce TR-261026-004'], 'tr-261026');
    const medio = puntaje(['XTR-261026'], 'tr-261026');
    expect(igual).toBeGreaterThan(empieza);
    expect(empieza).toBeGreaterThan(palabra);
    expect(palabra).toBeGreaterThan(medio);
    expect(puntaje(['Landstar', ''], 'landstar')).toBeGreaterThan(puntaje(['otro', 'Landstar'], 'landstar'));
  });
});

describe('mejores', () => {
  it('ordena por puntaje y corta en el máximo', () => {
    const lista = ['C.H. Robinson', 'Robinson Freight', 'Landstar', 'Robin'];
    expect(mejores(lista, (x) => [x], 'robinson', 2).map((r) => r.item)).toEqual(['Robinson Freight', 'C.H. Robinson']);
    expect(mejores(lista, (x) => [x], 'zzz', 5)).toEqual([]);
  });
});

describe('variantesPrefijo', () => {
  it('como se escribió, en mayúsculas y tipo título, sin repetir', () => {
    expect(variantesPrefijo('tr-2610')).toEqual(['tr-2610', 'TR-2610', 'Tr-2610']);
    expect(variantesPrefijo('TRK 44')).toEqual(['TRK 44', 'Trk 44']);
    expect(variantesPrefijo('514105')).toEqual(['514105']);
    expect(variantesPrefijo('  ')).toEqual([]);
  });
});

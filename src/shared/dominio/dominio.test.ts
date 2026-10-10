// Pruebas de la lógica pura compartida con las Cloud Functions.
import { describe, it, expect } from 'vitest';
import { monedaCanonica, esUSD, esMXN } from './moneda';
import { aFechaISO, isoADma } from './fechas';
import { aNumero, r2, aCentavos, deCentavos, sumarMontos } from './numeros';
import { normalizarTexto, pareceId } from './texto';
import { ID_MXN, ID_USD } from './constantes';

describe('monedaCanonica', () => {
  it.each([
    [ID_USD, 'USD'], ['USD', 'USD'], ['usd', 'USD'], ['Dólares', 'USD'], ['DOLARES', 'USD'], ['dls', 'USD'], ['US$', 'USD'],
    [ID_MXN, 'MXN'], ['MXN', 'MXN'], ['Pesos', 'MXN'], ['M.N.', 'MXN'], ['peso mexicano', 'MXN'],
  ])('%s → %s', (entrada, salida) => {
    expect(monedaCanonica(entrada)).toBe(salida);
  });
  it('no inventa moneda', () => {
    expect(monedaCanonica('')).toBeNull();
    expect(monedaCanonica('N/A')).toBeNull();
    expect(monedaCanonica('Euros')).toBeNull();
    expect(monedaCanonica(undefined)).toBeNull();
  });
  it('el nombre del catálogo cuenta como USD (bug de Facturación Proveedores con === "USD")', () => {
    expect(esUSD('Dolares')).toBe(true);
    expect(esMXN('Dolares')).toBe(false);
  });
});

describe('aFechaISO', () => {
  it.each([
    ['2026-10-09', '2026-10-09'],
    ['2026-10-09T15:00:00.000Z', '2026-10-09'],
    ['9/12/2025', '2025-12-09'],
    ['09/12/2025', '2025-12-09'],
    ['9-12-25', '2025-12-09'],
    ['31/02/2025', null],
    ['basura', null],
    ['', null],
  ])('%s → %s', (entrada, salida) => {
    expect(aFechaISO(entrada)).toBe(salida);
  });
  it('acepta Timestamp y Date (hora local)', () => {
    const d = new Date(2026, 0, 5, 23, 30);
    expect(aFechaISO(d)).toBe('2026-01-05');
    expect(aFechaISO({ toDate: () => d })).toBe('2026-01-05');
    expect(aFechaISO({ seconds: Math.floor(d.getTime() / 1000) })).toBe('2026-01-05');
  });
  it('isoADma', () => {
    expect(isoADma('2026-03-07')).toBe('07/03/2026');
    expect(isoADma(null)).toBe('');
  });
});

describe('números', () => {
  it('aNumero tolera strings del formulario', () => {
    expect(aNumero('1,234.50')).toBe(1234.5);
    expect(aNumero('$ 10')).toBe(10);
    expect(aNumero('')).toBe(0);
    expect(aNumero('abc')).toBe(0);
    expect(aNumero(NaN)).toBe(0);
  });
  it('centavos sin errores de flotante', () => {
    expect(r2(2630.69100000003)).toBe(2630.69);
    expect(aCentavos(0.1) + aCentavos(0.2)).toBe(30);
    expect(deCentavos(30)).toBe(0.3);
    expect(sumarMontos([0.1, 0.2, '0.3'])).toBe(0.6);
  });
});

describe('texto', () => {
  it('normaliza', () => {
    expect(normalizarTexto('  Logística   Cruces ')).toBe('logistica cruces');
  });
  it('reconoce IDs', () => {
    expect(pareceId('7dca62b3')).toBe(true);
    expect(pareceId('aB3dE5gH7jK9mN1pQ3sT')).toBe(true);
    expect(pareceId('Caro-Kar Pesos')).toBe(false);
  });
});

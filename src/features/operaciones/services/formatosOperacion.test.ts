// ✅ V00444 (Fase 8.3) — piezas puras que salieron de los tableros de operaciones y del formulario.
import { describe, expect, it } from 'vitest';
import { colorTipoOperacion, limpiarUndefined } from './formatosOperacion';
import { describirCambiosLog, describirCamposCapturadosLog, listaCambiosAuditoria, truncarValorLog } from './auditoriaLog';
import { colorTipoOperacion as colorDelFormulario, formatearDireccionPorPais, paisDeDireccion } from '../components/formulario/direcciones';
import { buscarTCDeFecha, extraerRateDeFilaTC, normalizarFechaISO, tcParaOperacionGuardada } from '../components/formulario/tipoCambioFila';
import { normalizarFechaServicioISO, normalizarMoneda } from '../components/completados/formatos';

describe('formatosOperacion', () => {
  it('colores por tipo: "Logística Fletes" es verde en las tablas y azul en el formulario (diferencia anotada)', () => {
    expect(colorTipoOperacion('Transfer')).toBe('#fb923c');
    expect(colorTipoOperacion('Logística Fletes')).toBe('#3fb950');
    expect(colorDelFormulario('Logística Fletes')).toBe('#58a6ff');
    expect(colorTipoOperacion('otro')).toBe('#c9d1d9');
  });

  it('limpiarUndefined quita solo undefined', () => {
    expect(limpiarUndefined({ a: 1, b: undefined, c: null, d: '' })).toEqual({ a: 1, c: null, d: '' });
  });
});

describe('auditoriaLog', () => {
  it('trunca y describe cambios', () => {
    expect(truncarValorLog('')).toBe('(vacío)');
    expect(truncarValorLog('x'.repeat(70))).toHaveLength(60);
    expect(describirCambiosLog({ a: 1, b: 2 }, { a: 1, b: 3 }, { b: 'Bee' })).toBe('Bee: "3" → "2"');
    expect(describirCambiosLog({ a: 1 }, { a: 1 })).toBe('sin cambios de valor detectados');
  });

  it('auditoría sin campos de control y campos capturados sin vacíos', () => {
    expect(listaCambiosAuditoria({ historialEdiciones: [1], x: 'n' }, { x: 'v' })).toEqual(['x: "v" → "n"']);
    expect(describirCamposCapturadosLog({ a: 'x', b: '', c: false, d: 0 })).toBe('a: "x" | d: "0"');
  });
});

describe('direcciones del formulario', () => {
  it('país por campo o por texto', () => {
    expect(paisDeDireccion({ pais: 'Estados Unidos' })).toBe('USA');
    expect(paisDeDireccion({}, 'Col. Centro, C.P. 88000, Nuevo Laredo, Tamaulipas')).toBe('MX');
    expect(paisDeDireccion(null)).toBe('');
  });

  it('formato MX y USA', () => {
    expect(formatearDireccionPorPais({ calle: 'Mar de las Antillas', numExterior: 947, colonia: 'La Paz', cp: '88000', ciudad: 'Nuevo Laredo', estado: 'Tamps', pais: 'México' }))
      .toBe('Mar de las Antillas #947, Col. La Paz, C.P. 88000, Nuevo Laredo, Tamps, México');
    expect(formatearDireccionPorPais({ calle: 'Main St', numero: '123', ciudad: 'Laredo', estado: 'TX', zip: '78041', pais: 'USA' }))
      .toBe('123 Main St, Laredo, TX 78041, Estados Unidos');
    expect(formatearDireccionPorPais(null, 'respaldo')).toBe('respaldo');
  });
});

describe('fechas y tipo de cambio', () => {
  it('normalizarFechaISO del formulario ("" si no se entiende) y la de Completados (deja el texto)', () => {
    expect(normalizarFechaISO('25/03/2026')).toBe('2026-03-25');
    expect(normalizarFechaISO({ seconds: 0 })).toBe('1970-01-01');
    expect(normalizarFechaISO('99/99/2026')).toBe('');
    expect(normalizarFechaServicioISO('99/99/2026')).toBe('99/99/2026');
    expect(normalizarFechaServicioISO('2026-03-25T10:00')).toBe('2026-03-25');
  });

  it('T.C. de la fila de la fecha', () => {
    const filas = [{ fecha: '2026-03-24', dof: '17.10' }, { fecha: '25/03/2026', valor: '17.25' }];
    expect(buscarTCDeFecha(filas, '2026-03-25')).toBe(17.25);
    expect(buscarTCDeFecha(filas, '2026-03-26')).toBeNull();
    expect(extraerRateDeFilaTC({ x: 'abc', y: '18.5' })).toBe(18.5);
  });

  // ✅ V00462
  it('al abrir una operación guardada su T.C. pasa al oficial de su fecha (salvo facturada o editado a mano)', () => {
    const base = { actual: 18.425, oficial: 18.4888, facturada: false, editadoAMano: false };
    expect(tcParaOperacionGuardada(base)).toBe(18.4888);
    expect(tcParaOperacionGuardada({ ...base, actual: 0 })).toBe(18.4888);
    expect(tcParaOperacionGuardada({ ...base, actual: 18.4888 })).toBeNull();
    expect(tcParaOperacionGuardada({ ...base, facturada: true })).toBeNull();
    expect(tcParaOperacionGuardada({ ...base, facturada: true, actual: 0 })).toBeNull(); // ✅ V00494: facturada nunca cambia sola
    expect(tcParaOperacionGuardada({ ...base, editadoAMano: true })).toBeNull();
    expect(tcParaOperacionGuardada({ ...base, oficial: null })).toBeNull();
  });

  it('moneda normalizada', () => {
    expect(normalizarMoneda('DOLARES')).toBe('Dólares');
    expect(normalizarMoneda('pesos mx')).toBe('Pesos');
    expect(normalizarMoneda('-')).toBe('-');
  });
});

// ✅ V00479 — análisis de clientes: estados, ops por semana, días y pausas, "Qué está cambiando".
import { describe, expect, it } from 'vitest';
import { STATUS_CANCELADO, STATUS_COMPLETADOS } from '../../../shared/dominio/constantes';
import { aOpAnalisis, analizarClientes, diaNum, fmtCambio, fmtDiaMes, operacionesDeCliente, periodoDelAnio, queEstaCambiando } from './analisisClientes';
import type { OpAnalisis } from './analisisClientes';

const PERIODO = periodoDelAnio(2026, '2026-10-21');
const iso = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
let sec = 0;
const op = (fecha: string, paga: string, extra: Partial<OpAnalisis> = {}): OpAnalisis => ({
  id: `op${++sec}`, ref: `TR-${sec}`, fecha, paga: { id: paga, nombre: `Cliente ${paga}` }, mercancia: null,
  importacion: false, exportacion: false, vacio: false, hazmat: false, falso: false, tipo: 'Transfer', trafico: '', estatus: '', unidad: '', convenio: '', ...extra,
});
/** Operaciones en los días de la semana indicados (0 = lunes) entre dos fechas. */
const serie = (cliente: string, desde: string, hasta: string, dias: number[], extra: Partial<OpAnalisis> = {}): OpAnalisis[] => {
  const r: OpAnalisis[] = [];
  for (let d = diaNum(desde); d <= diaNum(hasta); d++) if (dias.includes((new Date(d * 86400000).getUTCDay() + 6) % 7)) r.push(op(iso(d), cliente, extra));
  return r;
};
const corte3m = iso(diaNum('2026-10-21') - 13 * 7); // último día de "antes"

describe('estado de cada cliente', () => {
  const ops = [
    ...serie('estable', '2026-01-01', '2026-10-21', [0, 1, 2, 3, 4]),
    ...serie('inactivo', '2026-01-01', '2026-07-08', [0, 2, 4]),
    ...serie('nuevo', '2026-09-28', '2026-10-21', [0, 1, 2, 3, 4, 5]),
    ...serie('crece', '2026-01-01', corte3m, [1, 3]), ...serie('crece', iso(diaNum(corte3m) + 1), '2026-10-21', [0, 1, 3, 4]),
    ...serie('baja', '2026-01-01', corte3m, [0, 1, 3, 4]), ...serie('baja', iso(diaNum(corte3m) + 1), '2026-10-21', [1, 3]),
    ...serie('poco', '2026-03-02', '2026-03-13', [0]),
  ];
  const fichas = analizarClientes(ops, 'paga', PERIODO);
  const de = (id: string) => fichas.find((f) => f.id === id)!;
  it('clasifica con las reglas', () => {
    expect(Object.fromEntries(fichas.map((f) => [f.id, f.estado]))).toEqual({ estable: 'estable', inactivo: 'inactivo', nuevo: 'nuevo', crece: 'creciendo', baja: 'bajando', poco: 'ocasional' });
  });
  it('ops por semana y cambio de los últimos 3 meses', () => {
    expect(de('estable').opsSemUlt3m).toBeCloseTo(5, 0);
    expect(Math.abs(de('estable').cambio ?? 1)).toBeLessThan(0.05);
    expect(de('crece').cambio).toBeCloseTo(1, 1);
    expect(de('baja').cambio).toBeCloseTo(-0.5, 1);
    expect(de('inactivo').opsSemUlt4s).toBe(0);
  });
  it('días y pausas', () => {
    const e = de('estable');
    expect(e.diasHabilesSinOperar).toBe(0);
    expect(e.porDiaQueOpera).toBe(1);
    expect(e.pausaMasLarga).toBe(2); // fin de semana
    expect(e.sabados).toBe(0);
    expect(de('inactivo').pausaActual).toBe(diaNum('2026-10-21') - diaNum('2026-07-08'));
    expect(de('nuevo').porDiaSemana[5]).toBeGreaterThan(0);
  });
  it('trimestres hasta el corte y operaciones por mes', () => {
    expect(de('estable').trimestres.map((t) => t.etiqueta)).toEqual(['ene-mar', 'abr-jun', 'jul-sep', 'oct']);
    expect(de('estable').porMes[9]).toBe(15);
  });
  it('% del total y orden por operaciones', () => {
    expect(fichas[0].id).toBe('estable');
    expect(fichas.reduce((a, f) => a + f.pct, 0)).toBeCloseTo(1, 5);
  });
  it('Qué está cambiando: solo con 20 o más, ordenados', () => {
    const q = queEstaCambiando(fichas);
    expect(q.inactivos.map((f) => f.id)).toEqual(['inactivo']);
    expect(q.creciendo.map((f) => f.id)).toEqual(['crece']);
    expect(q.bajando.map((f) => f.id)).toEqual(['baja']);
    expect(q.nuevos.map((f) => f.id)).toEqual(['nuevo']);
  });
});

describe('operaciones', () => {
  it('de la más reciente a la primera', () => {
    const ops = [op('2026-02-01', 'x'), op('2026-05-01', 'x'), op('2026-03-01', 'y'), op('2026-05-01', 'x')];
    expect(operacionesDeCliente(ops, 'paga', 'x').map((o) => o.fecha)).toEqual(['2026-05-01', '2026-05-01', '2026-02-01']);
  });
  it('del documento: sin canceladas ni pruebas; nombre del catálogo; sin id, por nombre', () => {
    const nombre = (id: string) => (id === 'e1' ? 'C.H. Robinson Worldwide' : undefined);
    const a = aOpAnalisis({ id: 'a', ref: 'TR-1', fechaServicio: '2026-10-01', clientePaga: 'e1', clientePagaNombre: 'CH Robinson (viejo)', trafico: 'Exportación', carga: 'Vacío', status: STATUS_COMPLETADOS[1], statusNombre: '7. Falso', convenioNombre: 'Cruce Hazmat' }, nombre);
    expect(a).toMatchObject({ fecha: '2026-10-01', paga: { id: 'e1', nombre: 'C.H. Robinson Worldwide' }, exportacion: true, vacio: true, hazmat: true, falso: true });
    expect(aOpAnalisis({ id: 'b', fechaServicio: '2026-10-01', status: STATUS_CANCELADO }, nombre)).toBeNull();
    expect(aOpAnalisis({ id: 'c', ref: 'PRUEBA-1', fechaServicio: '2026-10-01', esPrueba: true }, nombre)).toBeNull();
    expect(aOpAnalisis({ id: 'd', fechaServicio: '15/10/2026', clienteMercanciaNombre: 'Vitro Automotriz' }, nombre)).toMatchObject({ fecha: '2026-10-15', paga: null, mercancia: { id: 'nombre:vitro automotriz' } });
  });
});

it('formatos', () => {
  expect(fmtCambio(-0.474)).toBe('-47%');
  expect(fmtCambio(3.27)).toBe('+327%');
  expect(fmtCambio(null)).toBe('—');
  expect(fmtDiaMes('2026-07-08')).toBe('8 jul');
});

// ✅ V00464 — reporte del puente AVI: lectura y coincidencia con las operaciones.
// ✅ V00466: las operaciones que llegan son solo las de Operaciones sin asignar.
// ✅ V00467: también Puente 3 y Puente Colombia.
import { describe, expect, it } from 'vitest';
import {
  claveUnidadDia, coincidirCruces, fechaHoraReporte, leerReportePuente, montoReporte, normalizarTag, resumenCruces, unirCruces,
  type OpParaCruce,
} from './reporteAvi';

const leerReporteAvi = (filas: unknown[][]) => {
  const r = leerReportePuente(filas);
  return { ...r, cruces: unirCruces(r.grupo ?? 'AVI', [r.cruces]) };
};

// Como lo descarga el portal (con un título arriba y un renglón de total al final).
const HOJA = [
  ['Account Activity Report'],
  [],
  ['POSTING DATE', 'TRANSACTION DATE', 'TAG #', 'LOCATION', 'DESCRIPTION', 'AMOUNT'],
  ['10/01/2026 12:48:00', '10/01/2026 12:45:04', '00202746', 'Bridge 4', 'Toll Charge', '($23.75)'],
  ['10/01/2026 18:10:00', '10/01/2026 18:06:41', '00202745', 'Bridge 4', 'Toll Charge', '($23.75)'],
  ['10/01/2026 16:28:00', '10/01/2026 16:25:20', '00169377', 'Bridge 2', 'Toll Charge', '($3.30)'],
  ['10/01/2026 19:04:00', '10/01/2026 19:01:40', '00202746', 'Bridge 4', 'Toll Charge', '($23.75)'],
  ['10/01/2026 22:14:00', '10/01/2026 22:12:43', '00202746', 'Bridge 3', 'Toll Charge', '($23.75)'],
  ['', '', '', '', 'Total', '($98.30)'],
];

const unidades = [
  { id: 'u19', nombre: 'UND.1019', tag: '00202745' },
  { id: 'u20', nombre: 'UND.1020', tag: '202746' },
];
const op = (o: Partial<OpParaCruce> & { id: string }): OpParaCruce => ({
  ref: o.id, fecha: '2026-10-01', unidad: 'u20', horas: [], monto: 23.75, puente: 'Caseta AVI', grupo: 'AVI', ...o,
});

describe('reporte AVI', () => {
  it('lee tags, montos y fechas del portal (mes/día/año)', () => {
    expect(normalizarTag('00202745')).toBe('202745');
    expect(normalizarTag(202745)).toBe('202745');
    expect(montoReporte('($23.75)')).toBe(23.75);
    expect(montoReporte(-3.3)).toBe(3.3);
    expect(fechaHoraReporte('10/01/2026 12:45:04')).toEqual({ fecha: '2026-10-01', hora: '12:45' });
    expect(fechaHoraReporte('10/1/26 7:05 PM')).toEqual({ fecha: '2026-10-01', hora: '19:05' });
    expect(fechaHoraReporte(46296.53129)).toEqual({ fecha: '2026-10-01', hora: '12:45' }); // fecha de Excel
    expect(fechaHoraReporte('Total')).toBeNull();

    const r = leerReporteAvi(HOJA);
    expect(r.grupo).toBe('AVI');
    expect(r.omitidas).toBe(1); // el total
    expect(r.cruces.map((c) => [c.hora, c.tag, c.monto])).toEqual([
      ['12:45', '202746', 23.75], ['16:25', '169377', 3.3], ['18:06', '202745', 23.75],
      ['19:01', '202746', 23.75], ['22:12', '202746', 23.75],
    ]);
    expect(leerReporteAvi([['a', 'b'], [1, 2]]).grupo).toBeNull();
  });

  it('une cada cruce con la operación de su unidad y día más cercana a la hora del Verde', () => {
    const { cruces } = leerReporteAvi(HOJA);
    const ops = [
      op({ id: 'TR-3', horas: ['21:50'] }),
      op({ id: 'TR-1', horas: ['12:30'] }),
      op({ id: 'TR-9', unidad: 'u19', monto: 0 }),
      op({ id: 'TR-OTRO-DIA', fecha: '2026-10-02' }),
    ];
    const { filas, opsSinCruce } = coincidirCruces(cruces, unidades, ops);
    const ver = filas.map((f) => [f.cruce.hora, f.unidad?.nombre ?? null, f.op?.id ?? null, f.estado]);
    expect(ver).toEqual([
      ['12:45', 'UND.1020', 'TR-1', 'coincide'],
      ['16:25', null, null, 'tagSinUnidad'],
      ['18:06', 'UND.1019', 'TR-9', 'coincide'],
      ['19:01', 'UND.1020', null, 'sinOperacion'], // 3 cruces y 2 operaciones: la de las 21:50 va con el de las 22:12
      ['22:12', 'UND.1020', 'TR-3', 'coincide'],
    ]);
    expect(filas[2].avisos).toEqual(['La operación no tiene monto de puente']);
    expect(filas[3].avisos).toEqual(['La unidad tiene 2 operaciones por asignar y 3 cruces ese día']);
    expect(opsSinCruce).toEqual([]);
    const r = resumenCruces(filas);
    expect(r).toEqual({ total: 5, coincide: 3, sinOperacion: 1, tagSinUnidad: 1, monto: 98.3 });
  });

  it('V00466: las demás operaciones de la unidad ese día (Acumulado, sin completar) se avisan en cada cruce', () => {
    const { cruces } = leerReporteAvi(HOJA);
    const otras = new Map([[claveUnidadDia('u19', '2026-10-01'), ['TR-5 (en el Acumulado)']], [claveUnidadDia('u20', '2026-10-02'), ['TR-6 (aún sin completar)']]]);
    const { filas } = coincidirCruces(cruces, unidades, [op({ id: 'TR-1', horas: ['12:30'] })], { otrasDelDia: otras });
    expect(filas.map((f) => [f.cruce.hora, f.op?.id ?? null, f.estado, f.avisos])).toEqual([
      ['12:45', 'TR-1', 'coincide', []],
      ['16:25', null, 'tagSinUnidad', []],
      ['18:06', null, 'sinOperacion', ['La unidad también tiene ese día: TR-5 (en el Acumulado)']],
      ['19:01', null, 'sinOperacion', ['La unidad tiene 1 operación por asignar y 3 cruces ese día']],
      ['22:12', null, 'sinOperacion', ['La unidad tiene 1 operación por asignar y 3 cruces ese día']],
    ]);
  });

  it('sin horas de Verde reparte por orden; avisa monto distinto y tags repetidos', () => {
    const cruces = leerReporteAvi(HOJA).cruces.filter((c) => c.tag === '202746');
    const ops = [
      op({ id: 'TR-002', monto: 20 }),
      op({ id: 'TR-001' }),
      op({ id: 'TR-004' }),
      op({ id: 'TR-005' }),
    ];
    const { filas, opsSinCruce } = coincidirCruces(cruces, [...unidades, { id: 'u99', nombre: 'UND.9999', tag: '0202746' }], ops);
    expect(filas.map((f) => f.op?.id)).toEqual(['TR-001', 'TR-002', 'TR-004']);
    expect(filas[1].avisos).toEqual([
      'El tag está en varias unidades: UND.1020, UND.9999',
      'La operación tiene $20.00 y el AVI cobró $23.75',
    ]);
    expect(opsSinCruce.map((o) => o.id)).toEqual(['TR-005']);
  });

  it('V00467: primero las operaciones de ese puente (o sin puente); las de otro puente al final y con aviso', () => {
    const cruces = leerReporteAvi(HOJA).cruces.filter((c) => c.tag === '202746');
    const p3 = op({ id: 'TR-001', monto: 144, puente: 'Caseta Puente III', grupo: 'PT3', horas: ['12:40'] });
    const { filas } = coincidirCruces(cruces.slice(0, 1), unidades, [p3, op({ id: 'TR-002', monto: 0, grupo: '', horas: ['20:00'] })]);
    expect(filas[0].op?.id).toBe('TR-002'); // la de Puente III queda fuera aunque su Verde esté más cerca
    const solo = coincidirCruces(cruces.slice(0, 1), unidades, [p3]).filas[0];
    expect(solo.op?.id).toBe('TR-001');
    expect(solo.avisos).toEqual(['La operación tiene $144.00 y el AVI cobró $23.75', 'La operación va por Caseta Puente III']);
  });
});

// Como el estado de cuenta de Comercio Mundial (REPORTE_PUENTE_240): dos hojas con días repetidos.
const HOJA_PT3 = [
  ['3041 - ROELCAINC SA DE CV '],
  ['', 'Fecha', 'Hora', 'Folio Tarjeta', 'Evento', 'Carril', 'Tpo. Veh', 'Abono', 'Importe', 'Saldo', 'T. Movimiento'],
  ['', 46168, '21:25:08', 'RECARGA ', '', '', '', 10000, 1609, 11609, 'Abono'],
  [1, 46169, '09:30:36', '9D1A330000000000', 816, 7, 'T05C', 0, 144, 11465, 'Cargo'],
  [2, 46169, '10:20:06', 'B260DE0000000000', 885, 7, 'T05C', 0, 144, 11321, 'Cargo'],
  ['', 46188, '13:19:46', '', 0, 0, 'T05C', 8992, 288, 9632, 'Cargo'],
  ['', '', '', '', '', 'SALDO A REPONER', '', 8928, 46312],
];
const HOJA1_PT3 = [
  [], ['', '', 'Plaza de Cobro', '', 'NUEVO  LAREDO'], ['', 'Puente del Comercio Mundial'],
  ['', '', '', 'Fecha', '', 'Hora', '', 'Folio Tarjeta', '', 'Evento', 'Carril', 'Tpo. Veh', 'Importe', 'T. Movimiento'],
  ['', '', '', 46168, '', '18:02:10', '', '9D1A330000000000', '', 77, 1, 'T05C', 144, 'Cargo'],
  ['', '', '', 46169, '', '09:30:36', '', '9D1A330000000000', '', 816, 7, 'T05C', 144, 'Cargo'], // repetido de la otra hoja
];
// Como el de Puente Colombia (REPORTE_PUENTE_800): cada cruce = puente ($90) + caseta ($129.60).
const serie = (iso: string, hhmm: string) => (Date.parse(`${iso}T${hhmm}:00Z`) / 86400000) + 25569;
const HOJA_PTC = [
  ['Fecha', 'Tag', '#Económico', 'Movimiento', 'Importe Trans.', 'Descuento %', 'Importe Total', 'SALDO'],
  ['SALDO ACTUAL', '', '', '', '', '', 2146, 2146],
  ['RECARGA ', '', '', '', '', '', 10000, 12056],
  [serie('2026-05-20', '08:51'), '02100030457', '1019', 'CRUCE NORMAL', 100, 10, 90, 11966],
  [serie('2026-05-20', '08:55'), '02100030457', '1019', 'CRUCE NORMAL', 144, 10, 129.6, 11836.4],
  [serie('2026-05-20', '13:47'), '02100030459', '1018', 'CRUCE NORMAL', 100, 10, 90, 11746.4],
  [serie('2026-05-20', '16:10'), '02100030459', '1018', 'CRUCE NORMAL', 144, 10, 129.6, 11616.8],
  [serie('2026-05-20', '20:00'), '02100030457', '1019', 'CRUCE NORMAL', 100, 10, 90, 11526.8],
  ['', '', '', 'SALDO ACTUAL', 812.8, 46305, '', ''],
];

describe('V00467: reportes de Puente 3 y Puente Colombia', () => {
  it('Puente 3: folio con letras, fecha + hora, solo los cargos con tag y sin repetir entre hojas', () => {
    expect(normalizarTag('9D1A330000000000', 'PT3')).toBe('9D1A33');
    expect(normalizarTag('9d1a33', 'PT3')).toBe('9D1A33');
    expect(normalizarTag('B260E00000000000', 'PT3')).toBe('B260E');
    const a = leerReportePuente(HOJA_PT3);
    const b = leerReportePuente(HOJA1_PT3);
    expect([a.grupo, b.grupo]).toEqual(['PT3', 'PT3']);
    expect(a.omitidas).toBe(3); // recarga, cargo sin folio y el saldo
    const cruces = unirCruces('PT3', [a.cruces, b.cruces]);
    expect(cruces.map((c) => [c.fecha, c.hora, c.tag, c.tagOriginal, c.monto])).toEqual([
      ['2026-05-26', '18:02', '9D1A33', '9D1A330000000000', 144],
      ['2026-05-27', '09:30', '9D1A33', '9D1A330000000000', 144],
      ['2026-05-27', '10:20', 'B260DE', 'B260DE0000000000', 144],
    ]);
  });

  it('Puente Colombia: une el cobro del puente y el de la caseta en un cruce; el que queda solo es otro cruce', () => {
    const r = leerReportePuente(HOJA_PTC);
    expect(r.grupo).toBe('PTC');
    expect(r.omitidas).toBe(3);
    const cruces = unirCruces('PTC', [r.cruces]);
    expect(cruces.map((c) => [c.hora, c.tag, c.economico, c.monto, c.cobros.map((x) => `${x.hora} $${x.monto}`)])).toEqual([
      ['08:51', '2100030457', '1019', 219.6, ['08:51 $90', '08:55 $129.6']],
      ['13:47', '2100030459', '1018', 219.6, ['13:47 $90', '16:10 $129.6']],
      ['20:00', '2100030457', '1019', 90, ['20:00 $90']],
    ]);
  });

  it('Colombia: el tag es el TAG Puente Colombia; si la unidad no lo tiene, por el # económico (con aviso)', () => {
    const cruces = unirCruces('PTC', [leerReportePuente(HOJA_PTC).cruces]);
    const unid = [{ id: 'u19', nombre: 'UND.1019', tag: '' }, { id: 'u18', nombre: 'UND.1018', tag: '02100030459' }];
    const ops = [
      { id: 'TR-1', ref: 'TR-1', fecha: '2026-05-20', unidad: 'u19', horas: ['08:40'], monto: 219.6, puente: 'Caseta Mx Colombia + Puente Mx Colombia', grupo: 'PTC' as const },
      { id: 'TR-2', ref: 'TR-2', fecha: '2026-05-20', unidad: 'u18', horas: [], monto: 129.6, puente: 'Caseta Mx Colombia', grupo: 'PTC' as const },
    ];
    const { filas } = coincidirCruces(cruces, unid, ops, { grupo: 'PTC' });
    expect(filas.map((f) => [f.unidad?.nombre ?? null, f.op?.id ?? null, f.estado, f.avisos])).toEqual([
      ['UND.1019', 'TR-1', 'coincide', ['Se tomó por el # económico 1019: UND.1019 no tiene TAG Puente Colombia']],
      ['UND.1018', 'TR-2', 'coincide', ['La operación tiene $129.60 y el Puente Colombia cobró $219.60']],
      ['UND.1019', null, 'sinOperacion', ['Se tomó por el # económico 1019: UND.1019 no tiene TAG Puente Colombia', 'La unidad tiene 1 operación por asignar y 2 cruces ese día']],
    ]);
  });

  it('las fechas en texto de México son día/mes/año', () => {
    expect(fechaHoraReporte('02/10/2026 14:05', true)).toEqual({ fecha: '2026-10-02', hora: '14:05' });
    expect(fechaHoraReporte('02/10/2026 14:05')).toEqual({ fecha: '2026-02-10', hora: '14:05' });
  });
});

// ✅ V00441 (Fase 5.7) — cobro del puente al cambiar de estatus (regla de OperacionesDashboard)
// y elección del flujo de estatus (regla de statusRules), ya como lógica pura compartida.
import { describe, expect, it } from 'vitest';
import { STATUS_COMPLETADOS } from './constantes';
import { aplicaPeaje, cobroAlCambiarStatus, cobroPuenteDeOperacion, disparoCobroPuente } from './cobroPuente';
import type { CtxCobroPuente, EventoStatusPuente } from './cobroPuente';
import { buscarFlujo, buscarFlujoPorIndice, construirConfigId, descuentaPuenteSegunFlujo, idDocFlujo } from './flujos';

type Datos = Record<string, unknown>;

const tipos: [string, Datos][] = [
  ['g-avi', { nombre_gasto: 'Caseta AVI', categoria_gasto: 'Puente', importe: 23.75, moneda: 'USD' }],
  ['g-p3', { nombre_gasto: 'Caseta Puente III', categoria_gasto: 'Puente', importe: 144, moneda: 'MXN' }],
  ['g-col', { nombre_gasto: 'Caseta Mx Colombia', categoria_gasto: 'Puente', importe: 300, moneda: 'MXN' }],
  ['g-trompo', { nombre_gasto: 'Trompo Colombia', categoria_gasto: 'Puente', importe: 350, moneda: 'MXN' }],
  ['g-piso', { nombre_gasto: 'Puente Mx Colombia', categoria_gasto: 'Puente', importe: 90, moneda: 'MXN' }],
];
const ctx = (extra: Partial<CtxCobroPuente> = {}): CtxCobroPuente => ({
  detalles: new Map([['conv-col', { tarifaBaseId: 'tar-col' }], ['conv-nl', { tarifaBaseId: 'tar-nl' }]]),
  tarifas: new Map([['tar-col', { aduana: 'adu-col' }], ['tar-nl', { aduana: 'adu-nl' }]]),
  gastosIncluidos: [],
  tiposGasto: new Map(tipos),
  aduanas: new Map([['adu-col', 'Colombia'], ['adu-nl', 'Nuevo Laredo']]),
  ...extra,
});
const transfer = (extra: Datos = {}): Datos => ({ tipoOperacionNombre: 'Transfer', trafico: 'Importación', convenio: 'conv-nl', ...extra });
const ev = (extra: Partial<EventoStatusPuente> = {}): EventoStatusPuente => ({
  statusId: 'x', statusNombre: '', fechaEvento: '', flagFlujo: null, hoy: '2026-10-10', fechaServicioISO: '2026-10-08', ...extra,
});

describe('cobro del puente al cambiar de estatus', () => {
  it('peaje solo en Transfer y Logística de Cruces de Roelca', () => {
    expect(aplicaPeaje({ tipoOperacionNombre: 'Transfer' })).toBe(true);
    expect(aplicaPeaje({ tipoOperacionNombre: 'Logística Cruces', proveedorUnidadNombre: 'ROELCA INC' })).toBe(true);
    expect(aplicaPeaje({ tipoOperacionNombre: 'Logística Cruces', proveedorUnidadNombre: 'Otro' })).toBe(false);
    expect(aplicaPeaje({ tipoOperacionNombre: 'Logística Fletes', proveedorUnidadNombre: 'Roelca' })).toBe(false);
  });

  it('qué estatus disparan, con qué evento y fecha', () => {
    expect(disparoCobroPuente(ev({ statusNombre: 'Verde USA (Importación)', fechaEvento: '2026-10-09T10:00' }))).toEqual({ evento: 'Verde USA', fecha: '2026-10-09' });
    expect(disparoCobroPuente(ev({ statusNombre: 'Verde Mx' }))).toEqual({ evento: 'Verde MX', fecha: '2026-10-10' });
    expect(disparoCobroPuente(ev({ statusId: STATUS_COMPLETADOS[0], statusNombre: 'Servicio Completado' }))).toEqual({ evento: 'Completado', fecha: '2026-10-08' });
    expect(disparoCobroPuente(ev({ statusNombre: 'En tránsito' }))).toBeNull();
    // La regla del flujo manda: el estatus "🌉" dispara y los verdes ya no.
    expect(disparoCobroPuente(ev({ statusNombre: '6. Cruce', flagFlujo: true }))).toEqual({ evento: '6. Cruce', fecha: '2026-10-10' });
    expect(disparoCobroPuente(ev({ statusNombre: 'Verde USA', flagFlujo: false }))).toBeNull();
  });

  it('importación → Caseta AVI en dólares; exportación → Puente III en pesos', () => {
    expect(cobroAlCambiarStatus(ctx(), transfer(), ev({ statusNombre: 'Verde USA', fechaEvento: '2026-10-09' }))).toEqual({
      saldoPuente: 23.75, saldoPuentePuente: 'Caseta AVI', saldoPuenteMoneda: 'Dólares', saldoPuenteFecha: '2026-10-09', saldoPuenteEvento: 'Verde USA',
    });
    expect(cobroAlCambiarStatus(ctx(), transfer({ trafico: 'Exportación' }), ev({ statusNombre: 'Verde MX' }))).toMatchObject({ saldoPuente: 144, saldoPuenteMoneda: 'Pesos' });
  });

  it('sin tráfico decide el verde marcado; sin tráfico ni verde (Completado) no cobra', () => {
    expect(cobroAlCambiarStatus(ctx(), transfer({ trafico: '' }), ev({ statusNombre: 'Verde MX' }))).toMatchObject({ saldoPuentePuente: 'Caseta Puente III' });
    expect(cobroAlCambiarStatus(ctx(), transfer({ trafico: '' }), ev({ statusId: STATUS_COMPLETADOS[0] }))).toEqual({});
  });

  it('nunca cobra dos veces ni fuera del peaje', () => {
    expect(cobroAlCambiarStatus(ctx(), transfer({ saldoPuente: 0 }), ev({ statusNombre: 'Verde USA' }))).toEqual({});
    expect(cobroAlCambiarStatus(ctx(), transfer({ tipoOperacionNombre: 'Flete' }), ev({ statusNombre: 'Verde USA' }))).toEqual({});
  });

  it('la caseta de los gastos incluidos de la tarifa manda (con su monto)', () => {
    const c = ctx({ gastosIncluidos: [{ tarifa_referencia_id: 'tar-nl', gasto: 'g-p3', monto: 150 }] });
    expect(cobroAlCambiarStatus(c, transfer(), ev({ statusNombre: 'Verde USA' }))).toMatchObject({ saldoPuente: 150, saldoPuentePuente: 'Caseta Puente III' });
  });

  it('aduana Colombia: caseta de Colombia (o trompo) + el piso del puente', () => {
    const r = cobroAlCambiarStatus(ctx(), transfer({ convenio: 'conv-col' }), ev({ statusNombre: 'Verde MX', fechaEvento: '2026-10-09' }));
    expect(r).toMatchObject({
      saldoPuente: 300, saldoPuentePuente: 'Caseta Mx Colombia', saldoPuentePiso: 90, saldoPuentePisoPuente: 'Puente Mx Colombia',
      saldoPuentePisoFecha: '2026-10-09', saldoPuentePisoEvento: 'Verde MX',
    });
    expect(cobroAlCambiarStatus(ctx(), transfer({ convenio: 'conv-col', carga: 'Trompo' }), ev({ statusNombre: 'Verde MX' }))).toMatchObject({ saldoPuente: 350 });
    // Con aduana Colombia, una caseta de la tarifa que NO es de Colombia se ignora.
    const c = ctx({ gastosIncluidos: [{ tarifa_referencia_id: 'tar-col', gasto: 'g-avi', monto: 20 }] });
    expect(cobroAlCambiarStatus(c, transfer({ convenio: 'conv-col' }), ev({ statusNombre: 'Verde MX' }))).toMatchObject({ saldoPuentePuente: 'Caseta Mx Colombia' });
  });

  it('asignar en lote (Referencias de Puentes) sigue igual', () => {
    expect(cobroPuenteDeOperacion(ctx(), transfer({ fechaServicio: '2026-10-01' }))).toMatchObject({ saldoPuente: 23.75, saldoPuenteFecha: '2026-10-01', saldoPuenteEvento: 'Asignado desde Referencias de Puentes' });
    expect(cobroPuenteDeOperacion(ctx(), transfer({ saldoPuente: 23.75, convenio: 'conv-col' }))).toMatchObject({ saldoPuentePiso: 90 });
  });
});

describe('flujo de estatus de la operación', () => {
  const flujo = (id: string, datos: Datos = {}) => ({ id: idDocFlujo(id), datos: { flujo: [], ...datos } });
  it('arma el id como el configurador', () => {
    expect(construirConfigId({ tipoOperacionNombre: 'logistica', trafico: 'importación', carga: 'cargada' })).toBe('Logística_Importación_Cargada');
    expect(construirConfigId({ tipoOperacionNombre: 'Transfer', convenioNombre: 'Transfer Exportacion Vacia' })).toBe('Transfer_Exportación_Vacía');
  });
  it('exacto → sin acentos → variante Cargada/Llena → índice tolerante', () => {
    const op = { tipoOperacionNombre: 'Transfer', trafico: 'Importación', carga: 'Cargada' };
    expect(buscarFlujo(op, [flujo('Transfer_Importación_Cargada'), flujo('Transfer_Importacion_Cargada')])?.id).toBe('Transfer_Importación_Cargada');
    expect(buscarFlujo(op, [flujo('Transfer_Importacion_Cargada')])?.id).toBe('Transfer_Importacion_Cargada');
    expect(buscarFlujo(op, [flujo('Transfer_Importación_Llena')])?.id).toBe('Transfer_Importación_Llena');
    const comodin = flujo('X1', { tipoServicio: 'transfer', trafico: '', carga: '' });
    const especifico = flujo('X2', { tipoServicio: 'Transfer', trafico: 'Importacion', carga: 'Cargado' });
    expect(buscarFlujoPorIndice(op, [comodin, especifico])).toBe('X2');
    expect(buscarFlujo({ ...op, trafico: 'Exportación' }, [comodin, especifico])?.id).toBe('X1');
    // V00407: la "/" del servicio se guarda como "／" en el id del documento.
    expect(buscarFlujo({ tipoOperacionNombre: 'Rentas (Patio / Equipo)', trafico: 'N/A', carga: 'N/A' }, [flujo('Rentas (patio / equipo)_N/A_N/A')])?.id).toBe('Rentas (patio ／ equipo)_N／A_N／A');
  });
  it('"🌉 aquí se descuenta el puente"', () => {
    const conRegla = { flujo: [{ nombreStatus: '6. Cruce', descuentaPuente: true }, { nombreStatus: 'Verde USA' }] };
    expect(descuentaPuenteSegunFlujo(conRegla, '6. cruce ')).toBe(true);
    expect(descuentaPuenteSegunFlujo(conRegla, 'Verde USA')).toBe(false);
    expect(descuentaPuenteSegunFlujo({ flujo: [{ nombreStatus: 'A' }] }, 'A')).toBeNull();
    expect(descuentaPuenteSegunFlujo(null, 'A')).toBeNull();
  });
});

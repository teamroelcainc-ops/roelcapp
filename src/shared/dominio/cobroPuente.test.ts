// ✅ V00441 (Fase 5.7) — cobro del puente al cambiar de estatus (regla de OperacionesDashboard)
// y elección del flujo de estatus (regla de statusRules), ya como lógica pura compartida.
import { describe, expect, it } from 'vitest';
import { STATUS_COMPLETADOS } from './constantes';
import { aplicaPeaje, casetaPrevista, casetasDeFlujo, cobroAlCambiarStatus, cobroEnCascada, cobroPuenteDeOperacion, disparoCobroPuente, puenteYaCobrado, tarifaDeDetalleConvenio } from './cobroPuente';
import type { CtxCobroPuente, EventoStatusPuente } from './cobroPuente';
import { buscarFlujo, buscarFlujoPorIndice, construirConfigId, descuentaPuenteSegunFlujo, esStatusAutomatico, idDocFlujo, mismaAduana, reglaPuenteDelPaso } from './flujos';

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
    expect(cobroAlCambiarStatus(ctx(), transfer({ saldoPuente: 23.75 }), ev({ statusNombre: 'Verde USA' }))).toEqual({});
    expect(cobroAlCambiarStatus(ctx(), transfer({ saldoPuente: 0, saldoPuenteManual: true }), ev({ statusNombre: 'Verde USA' }))).toEqual({});
    expect(cobroAlCambiarStatus(ctx(), transfer({ tipoOperacionNombre: 'Flete' }), ev({ statusNombre: 'Verde USA' }))).toEqual({});
  });

  it('V00469: un 0 (o vacío) no cuenta como cobrado, y una caseta sin importe no se cobra en 0', () => {
    expect(puenteYaCobrado({ saldoPuente: 0 })).toBe(false);
    expect(puenteYaCobrado({ saldoPuente: '' })).toBe(false);
    expect(puenteYaCobrado({ saldoPuente: null })).toBe(false);
    expect(puenteYaCobrado({ saldoPuente: 23.75 })).toBe(true);
    expect(cobroAlCambiarStatus(ctx(), transfer({ saldoPuente: 0 }), ev({ statusNombre: 'Verde USA' }))).toMatchObject({ saldoPuente: 23.75 });
    const sinImporte = ctx({ tiposGasto: new Map([...tipos.filter(([id]) => id !== 'g-avi'), ['g-avi', { nombre_gasto: 'Caseta AVI', categoria_gasto: 'Puente', importe: 0 }]]) });
    expect(cobroAlCambiarStatus(sinImporte, transfer(), ev({ statusNombre: 'Verde USA' }))).toEqual({});
  });

  it('V00469: en una cascada cobra el primer paso que dispara (Verde USA → En tránsito)', () => {
    const pasos = [ev({ statusId: 'v', statusNombre: 'Verde USA', fechaEvento: '2026-10-09T07:00' }), ev({ statusId: 't', statusNombre: 'En tránsito' })];
    expect(cobroEnCascada(ctx(), transfer(), pasos)).toMatchObject({ saldoPuente: 23.75, saldoPuenteEvento: 'Verde USA', saldoPuenteFecha: '2026-10-09' });
    expect(cobroEnCascada(ctx(), transfer(), [ev({ statusNombre: 'En tránsito' })])).toEqual({});
    expect(esStatusAutomatico({ flujo: [{ nombreStatus: 'En Tránsito', tipoMecanismo: 'automatico' }] }, 'en transito')).toBe(true);
    expect(esStatusAutomatico({ flujo: [{ nombreStatus: 'En Tránsito', tipoMecanismo: 'manual' }] }, 'En tránsito')).toBe(false);
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

  it('V00465: la tarifa del detalle también se lee de tipoConvenioId (así la guarda Convenios de Clientes)', () => {
    expect(tarifaDeDetalleConvenio({ tipoConvenioId: 'tar-nl' })).toBe('tar-nl');
    expect(tarifaDeDetalleConvenio({ tarifaBaseId: 'a', tipoConvenioId: 'b' })).toBe('a'); // donde ya estaba, nada cambia
    expect(tarifaDeDetalleConvenio({ tarifaBaseId: '', tipoConvenioId: 'b' })).toBe('b');
    expect(tarifaDeDetalleConvenio(undefined)).toBe('');
    const c = ctx({
      detalles: new Map([['conv-x', { tipoConvenioId: 'tar-nl' }], ['conv-cx', { tipoConvenioId: 'tar-col' }]]),
      gastosIncluidos: [{ tarifa_referencia_id: 'tar-nl', gasto: 'g-p3', monto: 150 }],
    });
    expect(cobroAlCambiarStatus(c, transfer({ convenio: 'conv-x' }), ev({ statusNombre: 'Verde USA' }))).toMatchObject({ saldoPuente: 150, saldoPuentePuente: 'Caseta Puente III' });
    expect(cobroAlCambiarStatus(c, transfer({ convenio: 'conv-cx' }), ev({ statusNombre: 'Verde MX' }))).toMatchObject({ saldoPuentePuente: 'Caseta Mx Colombia', saldoPuentePiso: 90 });
  });

  it('V00465: casetaPrevista (formulario) = la caseta con la que se va a cobrar, con su id', () => {
    const c = ctx({ gastosIncluidos: [{ tarifa_referencia_id: 'tar-nl', gasto: 'g-p3', monto: 150 }] });
    expect(casetaPrevista(c, transfer())).toEqual({ gastoId: 'g-p3', nombre: 'Caseta Puente III', monto: 150, moneda: 'MXN', origen: 'tarifa' });
    expect(casetaPrevista(ctx(), transfer())).toEqual({ gastoId: 'g-avi', nombre: 'Caseta AVI', monto: 23.75, moneda: 'USD', origen: 'trafico' });
    expect(casetaPrevista(ctx(), transfer({ trafico: 'Exportación' }))).toMatchObject({ gastoId: 'g-p3', origen: 'trafico' });
    expect(casetaPrevista(ctx(), transfer({ convenio: 'conv-col', carga: 'Trompo' }))).toMatchObject({ gastoId: 'g-trompo', monto: 350, origen: 'colombia' });
    expect(casetaPrevista(ctx(), transfer({ trafico: '' }))).toBeNull();
    expect(casetaPrevista(ctx(), transfer({ trafico: '' }), 'Verde USA')).toMatchObject({ gastoId: 'g-avi' });
  });

  it('asignar en lote (Referencias de Puentes) sigue igual', () => {
    expect(cobroPuenteDeOperacion(ctx(), transfer({ fechaServicio: '2026-10-01' }))).toMatchObject({ saldoPuente: 23.75, saldoPuenteFecha: '2026-10-01', saldoPuenteEvento: 'Asignado desde Referencias de Puentes' });
    expect(cobroPuenteDeOperacion(ctx(), transfer({ saldoPuente: 23.75, convenio: 'conv-col' }))).toMatchObject({ saldoPuentePiso: 90 });
  });

  it('V00469: asignar en lote usa la misma caseta que el cobro (Colombia no toma la de Nuevo Laredo) y convierte la fecha', () => {
    const c = ctx({ gastosIncluidos: [{ tarifa_referencia_id: 'tar-col', gasto: 'g-p3', monto: 150 }] });
    expect(cobroPuenteDeOperacion(c, transfer({ convenio: 'conv-col', fechaServicio: '8/10/2026' }))).toMatchObject({ saldoPuente: 300, saldoPuentePuente: 'Caseta Mx Colombia', saldoPuenteFecha: '2026-10-08', saldoPuentePiso: 90 });
    expect(cobroPuenteDeOperacion(ctx(), transfer({ fechaServicioISO: '2026-10-03', fechaServicio: { seconds: 1 } }))).toMatchObject({ saldoPuenteFecha: '2026-10-03' });
  });
});

describe('V00473: puente elegido en Reglas de Estatus', () => {
  const flujoCon = (nodo: Datos, aduana = '') => ({ aduana, flujo: [{ nombreStatus: 'Pendiente' }, { nombreStatus: '9.1 Verde Mx (Exportación)', descuentaPuente: true, ...nodo }] });
  it('se lee solo del paso con 🌉 y con un tipo de gasto elegido', () => {
    expect(reglaPuenteDelPaso(flujoCon({ puenteCaseta: { gastoId: 'g-avi', monto: '' } }), '9.1 Verde Mx (Exportacion)')).toEqual({ caseta: { gastoId: 'g-avi', monto: null }, piso: null, aduanaFlujo: '' });
    expect(reglaPuenteDelPaso(flujoCon({}), '9.1 Verde Mx (Exportación)')).toBeNull();
    expect(reglaPuenteDelPaso(flujoCon({ puenteCaseta: { gastoId: 'g-avi' } }), 'Pendiente')).toBeNull();
  });
  it('la tarifa manda; sin caseta en la tarifa, la elegida (con su monto) gana al tráfico', () => {
    const regla = { caseta: { gastoId: 'g-avi', monto: 25 }, piso: null, aduanaFlujo: '' };
    const ev2 = ev({ statusNombre: '9.1 Verde Mx (Exportación)', flagFlujo: true, reglaPuente: regla });
    expect(cobroAlCambiarStatus(ctx(), transfer({ trafico: 'Exportación' }), ev2)).toMatchObject({ saldoPuente: 25, saldoPuentePuente: 'Caseta AVI', saldoPuenteMoneda: 'Dólares' });
    expect(cobroAlCambiarStatus(ctx(), transfer({ trafico: 'Exportación' }), { ...ev2, reglaPuente: { ...regla, caseta: { gastoId: 'g-avi', monto: null } } })).toMatchObject({ saldoPuente: 23.75 });
    const conTarifa = ctx({ gastosIncluidos: [{ tarifa_referencia_id: 'tar-nl', gasto: 'g-p3', monto: 150 }] });
    expect(cobroAlCambiarStatus(conTarifa, transfer(), ev2)).toMatchObject({ saldoPuente: 150, saldoPuentePuente: 'Caseta Puente III' });
  });
  it('Colombia: la elegida en un flujo de Colombia (caseta y piso); la de un flujo general no se usa', () => {
    const reglaCol = { caseta: { gastoId: 'g-trompo', monto: null }, piso: { gastoId: 'g-piso', monto: 100 }, aduanaFlujo: '800 Colombia' };
    expect(cobroAlCambiarStatus(ctx(), transfer({ convenio: 'conv-col' }), ev({ statusNombre: 'Verde MX', flagFlujo: true, reglaPuente: reglaCol }))).toMatchObject({
      saldoPuente: 350, saldoPuentePuente: 'Trompo Colombia', saldoPuentePiso: 100, saldoPuentePisoPuente: 'Puente Mx Colombia',
    });
    const general = { caseta: { gastoId: 'g-p3', monto: null }, piso: null, aduanaFlujo: '' };
    expect(cobroAlCambiarStatus(ctx(), transfer({ convenio: 'conv-col' }), ev({ statusNombre: 'Verde MX', flagFlujo: true, reglaPuente: general }))).toMatchObject({
      saldoPuente: 300, saldoPuentePuente: 'Caseta Mx Colombia', saldoPuentePiso: 90,
    });
  });
});

describe('V00470: costo del puente en el Editor de Flujos', () => {
  const tg = new Map(tipos);
  it('por tráfico una caseta; sin tráfico, las dos', () => {
    expect(casetasDeFlujo(tg, { trafico: 'Exportación' })).toEqual([{ etiqueta: 'Caseta', gastoId: 'g-p3', nombre: 'Caseta Puente III', monto: 144, moneda: 'MXN' }]);
    expect(casetasDeFlujo(tg, { trafico: 'Importación' })).toEqual([{ etiqueta: 'Caseta', gastoId: 'g-avi', nombre: 'Caseta AVI', monto: 23.75, moneda: 'USD' }]);
    expect(casetasDeFlujo(tg, {}).map((l) => `${l.etiqueta}: ${l.nombre}`)).toEqual(['Importación: Caseta AVI', 'Exportación: Caseta Puente III']);
  });
  it('aduana Colombia: la caseta y el puente (trompo si la carga lo dice)', () => {
    expect(casetasDeFlujo(tg, { trafico: 'Exportación', aduana: '800 Colombia' })).toEqual([
      { etiqueta: 'Caseta', gastoId: 'g-col', nombre: 'Caseta Mx Colombia', monto: 300, moneda: 'MXN' },
      { etiqueta: 'Puente', gastoId: 'g-piso', nombre: 'Puente Mx Colombia', monto: 90, moneda: 'MXN' },
    ]);
    expect(casetasDeFlujo(tg, { aduana: 'Colombia', carga: 'Trompo' })[0]).toMatchObject({ nombre: 'Trompo Colombia', monto: 350 });
  });
  it('un tipo de gasto que no está en el catálogo sale sin monto', () => {
    expect(casetasDeFlujo(new Map(), { trafico: 'Importación' })).toEqual([{ etiqueta: 'Caseta', gastoId: '', nombre: 'Caseta AVI', monto: null, moneda: null }]);
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
  it('V00469: un flujo de la aduana de la operación gana; los de otra aduana nunca se usan', () => {
    const op = { tipoOperacionNombre: 'Transfer', trafico: 'Exportación', carga: 'Cargado', aduanaNombre: '800 Colombia' };
    const general = flujo('Transfer_Exportación_Cargado', { tipoServicio: 'Transfer', trafico: 'Exportación', carga: 'Cargado' });
    const colombia = flujo('Transfer_Exportación_Cargado_800 Colombia', { tipoServicio: 'Transfer', trafico: 'Exportación', carga: 'Cargado', aduana: '800 Colombia' });
    const nl = flujo('Transfer_Exportación_Cargado_240 Nuevo Laredo', { tipoServicio: 'Transfer', trafico: 'Exportación', carga: 'Cargado', aduana: '240 Nuevo Laredo' });
    expect(buscarFlujo(op, [general, colombia, nl])?.id).toBe('Transfer_Exportación_Cargado_800 Colombia');
    expect(buscarFlujo({ ...op, aduanaNombre: '240 Nuevo Laredo' }, [general, colombia, nl])?.id).toBe('Transfer_Exportación_Cargado_240 Nuevo Laredo');
    // Sin flujo de su aduana → el general; sin aduana → el general (nunca el de una aduana)
    expect(buscarFlujo({ ...op, aduanaNombre: 'Piedras Negras' }, [general, colombia])?.id).toBe('Transfer_Exportación_Cargado');
    expect(buscarFlujo({ ...op, aduanaNombre: '' }, [colombia, nl])).toBeNull();
    // Con carga "Todos" (comodín) en el de la aduana y el nombre sin número
    const colTodos = flujo('Transfer_Exportación_Todos_Colombia', { tipoServicio: 'Transfer', trafico: 'Exportación', carga: '', aduana: 'Colombia' });
    expect(buscarFlujo(op, [general, colTodos])?.id).toBe('Transfer_Exportación_Todos_Colombia');
    expect(mismaAduana('240 Nuevo Laredo', 'nuevo laredo')).toBe(true);
    expect(mismaAduana('800 Colombia', 'Nuevo Laredo')).toBe(false);
  });

  it('"🌉 aquí se descuenta el puente"', () => {
    const conRegla = { flujo: [{ nombreStatus: '6. Cruce', descuentaPuente: true }, { nombreStatus: 'Verde USA' }] };
    expect(descuentaPuenteSegunFlujo(conRegla, '6. cruce ')).toBe(true);
    expect(descuentaPuenteSegunFlujo(conRegla, 'Verde USA')).toBe(false);
    expect(descuentaPuenteSegunFlujo({ flujo: [{ nombreStatus: 'A' }] }, 'A')).toBeNull();
    expect(descuentaPuenteSegunFlujo(null, 'A')).toBeNull();
  });
});

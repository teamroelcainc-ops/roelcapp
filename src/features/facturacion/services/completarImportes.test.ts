// ✅ V00524 — Completar importes: el desglose por operación sin tocar el total.
import { describe, expect, it } from 'vitest';
import { ID_USD } from '../../../shared/dominio/constantes';
import { totalNativoFacturaLegado } from '../../../shared/dominio/dinero';
import { categoriaMotivo, datosCompletar, filasPruebaCompletar, idsPorLeer, planCompletarImportes, planDeDoc } from './completarImportes';
import type { DocSinImportes, PlanDoc } from './completarImportes';
import { normalizarFacturaDe } from './normalizarFactura';

const op = (ref: string, monto: number, extra: Record<string, unknown> = {}) => ({
  ref, montoConvenioCliente: monto, cargosAdicionales: 0, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD, tipoCambioDia: 18.5, convenioNombre: 'Cruce', ...extra,
});
// Como llega de AppSheet: el total y la lista de operaciones, sin renglones.
const docDe = (raw: Record<string, unknown>, extra: Partial<DocSinImportes> = {}): DocSinImportes => ({
  id: 'f1', invoice: '35539', cliente: 'Landstar', fecha: '2026-09-01', moneda: 'USD', datos: normalizarFacturaDe(raw, 'cliente'), ...extra,
});
const raw = (extra: Record<string, unknown> = {}) => ({ invoice: '35539', statusFactura: 'Facturado', monedaFacturacion: 'USD', total: 140, operacionesIds: ['a'], operaciones: ['TR-1'], ...extra });

describe('planDeDoc', () => {
  it('arma un renglón por operación con lo que cobra hoy y guarda el MISMO total (no lo tenía guardado)', () => {
    const p = planDeDoc(docDe(raw()), new Map([['a', op('TR-1', 140)]])) as PlanDoc;
    expect(p).toMatchObject({ id: 'f1', ids: ['a'], total: 140, fijarTotal: true, suma: 140, cuadra: true });
    expect(p.renglones[0]).toMatchObject({ id: 'a', ref: 'TR-1', dol: 140, convenioNombre: 'Cruce' });
    const escrito = datosCompletar(p, 'T', 'yo');
    expect(escrito).toMatchObject({ subtotalMonedaFactura: 140, importesCompletados: { en: 'T', por: 'yo', total: 140, fijoTotal: true } });
    // El total que se ve es el mismo antes y después
    const antes = totalNativoFacturaLegado(docDe(raw()).datos);
    const despues = totalNativoFacturaLegado(normalizarFacturaDe({ ...raw(), ...escrito }, 'cliente'));
    expect([antes, despues]).toEqual([140, 140]);
  });
  it('con el total ya guardado no lo toca; si no cuadra, lo dice (pasará a "no suman el total")', () => {
    const p = planDeDoc(docDe(raw({ subtotalMonedaFactura: 150 })), new Map([['a', op('TR-1', 140)]])) as PlanDoc;
    expect(p).toMatchObject({ total: 150, fijarTotal: false, suma: 140, cuadra: false });
    expect(datosCompletar(p, 'T', 'yo')).not.toHaveProperty('subtotalMonedaFactura');
  });
  it('no se completa: solo referencias, operación que no existe o en otra factura, sin moneda, sin total, ya con importes, total guardado en 0, hoy en $0', () => {
    const ops = new Map([['a', op('TR-1', 140)]]);
    const m = (d: DocSinImportes, o = ops) => (planDeDoc(d, o) as { motivo: string }).motivo;
    expect(m(docDe(raw({ operacionesIds: [], operaciones: ['TR46028-05'] })))).toMatch(/Solo guardó las referencias/);
    expect(m(docDe(raw({ operacionesIds: ['TR46028-05'] })))).toMatch(/Solo guardó las referencias/);
    expect(m(docDe(raw()), new Map())).toMatch(/No se encontró la operación a/);
    expect(m(docDe(raw()), new Map([['a', op('TR-1', 140, { facturaClienteId: 'f9', facturaClienteInvoice: 'I7777' })]]))).toMatch(/está en otra factura \(I7777\)/);
    expect(m(docDe(raw(), { moneda: null }))).toMatch(/no tiene moneda/);
    expect(m(docDe(raw({ total: 0 })))).toMatch(/no tiene total/);
    expect(m(docDe(raw({ operacionesGuardadas: [{ id: 'a', ref: 'TR-1', dol: 140, subtotalBase: 140 }] })))).toMatch(/Ya tiene sus importes al día/);
    expect(m(docDe(raw({ subtotalMonedaFactura: 0 })))).toMatch(/total guardado en \$ 0.00/);
    expect(m(docDe(raw()), new Map([['a', op('TR-1', 0)]]))).toMatch(/hoy cobran \$ 0.00/);
    expect(m(docDe(raw({ statusFactura: 'Cancelado' })))).toMatch(/cancelada/);
  });
  it('la misma factura (otro documento del mismo folio) no cuenta como "otra factura"', () => {
    const p = planDeDoc(docDe(raw()), new Map([['a', op('TR-1', 140, { facturaClienteId: 'f2', facturaClienteInvoice: '35539' })]]));
    expect('motivo' in p).toBe(false);
  });
});

describe('✅ V00527: importes viejos que con el total de hoy cuadran', () => {
  // 39802: guardó el subtotal ($140) y después se capturaron $250 de cargos; el total ya decía $390.
  const viejo = (extra: Record<string, unknown> = {}) => raw({ subtotalMonedaFactura: 390, operacionesGuardadas: [{ id: 'a', ref: 'TR-241026-005', dol: 140, subtotalBase: 140, remolque: 'D07149' }], ...extra });
  it('pone al día el renglón con el TOTAL de hoy (con cargos) y no toca el total', () => {
    const p = planDeDoc(docDe(viejo()), new Map([['a', op('TR-241026-005', 140, { cargosAdicionales: 250 })]])) as PlanDoc;
    expect(p).toMatchObject({ reemplaza: true, total: 390, fijarTotal: false, suma: 390, cuadra: true });
    expect(p.renglones[0]).toMatchObject({ id: 'a', ref: 'TR-241026-005', dol: 390, subtotalBase: 140, remolque: 'D07149' });
    expect(p.antes[0]).toMatchObject({ dol: 140 });
    expect(datosCompletar(p, 'T', 'yo')).not.toHaveProperty('subtotalMonedaFactura');
    const fila = filasPruebaCompletar({ completar: [p], omitidas: [] })[0];
    expect(fila).toMatchObject({ 'Acción': 'Se ponen al día sus importes', 'Referencias antes (en la factura)': 'TR-241026-005 $ 140.00', 'Referencias (total de hoy)': 'TR-241026-005 $ 390.00' });
  });
  it('si con lo de hoy tampoco cuadra, no se toca', () => {
    const p = planDeDoc(docDe(viejo({ subtotalMonedaFactura: 500 })), new Map([['a', op('TR-241026-005', 140, { cargosAdicionales: 250 })]]));
    expect((p as { motivo: string }).motivo).toMatch(/tampoco cuadra/);
  });
});

describe('planCompletarImportes y la prueba', () => {
  it('separa las que se completan de las que no, y la prueba trae una fila por factura', () => {
    const docs = [docDe(raw()), docDe(raw({ operacionesIds: ['b'] }), { id: 'f2', invoice: '38315' }), docDe(raw({ operacionesIds: [] }), { id: 'f3', invoice: 'X' })];
    expect(idsPorLeer(docs)).toEqual(['a', 'b']);
    const plan = planCompletarImportes(docs, new Map([['a', op('TR-1', 140)], ['b', op('TR-2', 100)]]));
    expect(plan.completar.map((p) => [p.invoice, p.cuadra])).toEqual([['35539', true], ['38315', false]]);
    expect(plan.omitidas.map((o) => o.invoice)).toEqual(['X']);
    const filas = filasPruebaCompletar(plan);
    expect(filas).toHaveLength(3);
    expect(filas[1]).toMatchObject({ 'Acción': 'Se completa', 'Total (no cambia)': 140, 'Suman hoy': 100, Diferencia: 40, 'Referencias (total de hoy)': 'TR-2 $ 100.00' });
    expect(filas[2]).toMatchObject({ 'Acción': 'No se toca', Motivo: expect.stringMatching(/Solo guardó/) });
  });
});

describe('categoriaMotivo', () => {
  it('agrupa los motivos sin lo particular de cada factura', () => {
    expect(categoriaMotivo('No se encontró la operación a1')).toBe('No se encontró una de sus operaciones');
    expect(categoriaMotivo('La operación TR-1 está en otra factura (I7777)')).toBe('Una de sus operaciones está en otra factura');
    expect(categoriaMotivo('Ya tiene sus importes (cambió desde la prueba)')).toBe('Cambió desde la prueba');
    expect(categoriaMotivo('La factura no tiene moneda')).toBe('La factura no tiene moneda');
  });
});

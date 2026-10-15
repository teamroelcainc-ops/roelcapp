// ✅ V00454 — Referencias de Puentes: la operación va al puente que tiene (el elegido a
// mano o el cobrado), sea AVI, Puente III o Colombia; el convenio ya no lo cambia.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CtxCobroPuente } from '../shared/dominio/cobroPuente';

vi.mock('../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), doc: () => ({}), getDoc: async () => ({ exists: () => false }), getDocs: async () => ({ docs: [] }),
  query: () => ({}), where: () => ({}), writeBatch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} }),
}));

type Datos = Record<string, unknown>;
const tipos: [string, Datos][] = [
  ['g-avi', { nombre_gasto: 'Caseta AVI', categoria_gasto: 'Puente', importe: 23.75, moneda: 'USD' }],
  ['g-p3', { nombre_gasto: 'Caseta Puente III', categoria_gasto: 'Puente', importe: 144, moneda: 'MXN' }],
  ['g-col', { nombre_gasto: 'Caseta Mx Colombia', categoria_gasto: 'Puente', importe: 300, moneda: 'MXN' }],
  ['g-piso', { nombre_gasto: 'Puente Mx Colombia', categoria_gasto: 'Puente', importe: 90, moneda: 'MXN' }],
];
const ctx: CtxCobroPuente = {
  detalles: new Map([['conv-col', { tarifaBaseId: 'tar-col' }]]),
  tarifas: new Map([['tar-col', { aduana: 'adu-col' }]]),
  gastosIncluidos: [],
  tiposGasto: new Map(tipos),
  aduanas: new Map([['adu-col', 'Colombia']]),
};
const cargarCtx = vi.fn(async () => ctx);
vi.mock('./puenteColombia', async () => {
  const dominio = await import('../shared/dominio/cobroPuente');
  return { ...dominio, cargarCtxCobroPuente: () => cargarCtx() };
});

const { filaDeOperacion, grupoDeFila, grupoDeNombresPuente } = await import('./historialCalculadoPuentes');

// Operación de convenio / aduana Colombia (como TR-141026-014).
const opColombia = (extra: Datos = {}): Datos => ({
  id: 'op1', ref: 'TR-141026-014', fechaServicio: '2026-10-14', tipoOperacionNombre: 'Transfer', trafico: 'Importación',
  convenio: 'conv-col', convenioNombre: 'Transfer - Cargado - Colombia', ...extra,
});

describe('grupo de puente por el puente elegido', () => {
  beforeEach(() => cargarCtx.mockClear());

  it('el nombre del puente decide el grupo', () => {
    expect(grupoDeNombresPuente('Caseta AVI')).toBe('AVI');
    expect(grupoDeNombresPuente('Caseta Puente III')).toBe('PT3');
    expect(grupoDeNombresPuente('Trompo Puente III')).toBe('PT3');
    expect(grupoDeNombresPuente('Caseta Mx Colombia', 'Puente Mx Colombia')).toBe('PTC');
    expect(grupoDeNombresPuente('Caseta Puente III', 'Puente Mx Colombia')).toBe('PTC');
    expect(grupoDeNombresPuente('CASETA ÁVI')).toBe('AVI');
  });

  it('convenio Colombia con Caseta AVI elegida → va a AVI, sin recalcular a Colombia', async () => {
    const r = await filaDeOperacion(opColombia({ saldoPuente: 23.75, saldoPuentePuente: 'Caseta AVI', saldoPuenteMoneda: 'Dólares', saldoPuenteManual: true }), '');
    expect(r?.grupo).toBe('AVI');
    expect(r?.fila).toMatchObject({ puenteNombre: 'Caseta AVI', caseta: 23.75, casetaMoneda: 'Dólares', piso: 0, puente: 23.75 });
    expect(cargarCtx).not.toHaveBeenCalled();
  });

  it('convenio Colombia con Caseta Puente III → va a Puente III', async () => {
    const r = await filaDeOperacion(opColombia({ saldoPuente: 144, saldoPuentePuente: 'Caseta Puente III', saldoPuenteMoneda: 'Pesos' }), '');
    expect(r?.grupo).toBe('PT3');
    expect(r?.fila.puenteNombre).toBe('Caseta Puente III');
  });

  it('Colombia elegida (caseta + puente) → Puente Colombia con sus dos cobros', async () => {
    const r = await filaDeOperacion(opColombia({
      saldoPuente: 300, saldoPuentePuente: 'Caseta Mx Colombia', saldoPuenteMoneda: 'Pesos',
      saldoPuentePiso: 90, saldoPuentePisoPuente: 'Puente Mx Colombia', saldoPuentePisoMoneda: 'Pesos',
    }), '');
    expect(r?.grupo).toBe('PTC');
    expect(r?.fila).toMatchObject({ puenteNombre: 'Caseta Mx Colombia + Puente Mx Colombia', caseta: 300, piso: 90, puente: 390 });
  });

  it('sin puente todavía: se calcula como siempre (aduana Colombia → Colombia)', async () => {
    const r = await filaDeOperacion(opColombia(), '');
    expect(cargarCtx).toHaveBeenCalledTimes(1);
    expect(r?.grupo).toBe('PTC');
    expect(r?.fila).toMatchObject({ puenteNombre: 'Caseta Mx Colombia + Puente Mx Colombia', caseta: 300, piso: 90 });
  });

  it('una fila guardada se juzga por su puente, no por su convenio', () => {
    expect(grupoDeFila({ puenteNombre: 'Caseta AVI', convenio: 'Transfer - Cargado - Colombia' })).toBe('AVI');
    expect(grupoDeFila({ puenteNombre: 'Caseta Mx Colombia + Puente Mx Colombia', convenio: 'Transfer - Nuevo Laredo' })).toBe('PTC');
  });
});

// ✅ V00470 — cruce de puente desde la web: el cobro del paso (regla compartida) y la ventana.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CtxCobroPuente } from '../../../shared/dominio/cobroPuente';

type Datos = Record<string, unknown>;
const ctx: CtxCobroPuente = {
  detalles: new Map([['conv-col', { tarifaBaseId: 'tar-col' }]]),
  tarifas: new Map([['tar-col', { aduana: 'adu-col' }]]),
  gastosIncluidos: [],
  tiposGasto: new Map<string, Datos>([
    ['g-avi', { nombre_gasto: 'Caseta AVI', categoria_gasto: 'Puente', importe: 23.75, moneda: 'USD' }],
    ['g-p3', { nombre_gasto: 'Caseta Puente III', categoria_gasto: 'Puente', importe: 144, moneda: 'MXN' }],
    ['g-col', { nombre_gasto: 'Caseta Mx Colombia', categoria_gasto: 'Puente', importe: 129.6, moneda: 'MXN' }],
    ['g-piso', { nombre_gasto: 'Puente Mx Colombia', categoria_gasto: 'Puente', importe: 90, moneda: 'MXN' }],
  ]),
  aduanas: new Map([['adu-col', 'Colombia']]),
};
const regla = vi.fn(async (): Promise<boolean | null> => null);
vi.mock('../../../utils/puenteColombia', () => ({ cargarCtxCobroPuente: async () => ctx }));
vi.mock('../../operaciones/config/statusRules', () => ({ statusDescuentaPuente: () => regla() }));
const ventanas: { titulo: string; parrafos: string[] }[] = [];
vi.mock('../../../shared/data/avisos', () => ({ mostrarVentana: (v: { titulo: string; parrafos: string[] }) => { ventanas.push(v); return 1; } }));

const { avisarCrucePuente, cobroPuenteDelPaso, textosCrucePuente } = await import('./crucePuente');

const transfer = (extra: Datos = {}): Datos => ({ tipoOperacionNombre: 'Transfer', trafico: 'Exportación', unidadNombre: 'T-15', ref: 'TR-211026-021', ...extra });

beforeEach(() => { ventanas.length = 0; regla.mockResolvedValue(null); });

describe('cobro del paso', () => {
  it('el Verde cobra la caseta por el tráfico; un estatus que no cobra, nada', async () => {
    expect(await cobroPuenteDelPaso(transfer(), 's1', '9.1 Verde Mx (Exportación)', '2026-10-21T09:10')).toMatchObject({ saldoPuente: 144, saldoPuentePuente: 'Caseta Puente III', saldoPuenteFecha: '2026-10-21' });
    expect(await cobroPuenteDelPaso(transfer(), 's2', '8.1 Rojo Mx')).toEqual({});
  });
  it('el estatus con 🌉 en Reglas de Estatus cobra aunque no sea Verde; el Verde sin 🌉 ya no', async () => {
    regla.mockResolvedValue(true);
    expect(await cobroPuenteDelPaso(transfer(), 's3', '6. Cruce')).toMatchObject({ saldoPuente: 144, saldoPuenteEvento: '6. Cruce' });
    regla.mockResolvedValue(false);
    expect(await cobroPuenteDelPaso(transfer(), 's1', '9.1 Verde Mx (Exportación)')).toEqual({});
  });
  it('ya cobrada o fuera del peaje: nada', async () => {
    expect(await cobroPuenteDelPaso(transfer({ saldoPuente: 144 }), 's1', 'Verde Mx')).toEqual({});
    expect(await cobroPuenteDelPaso(transfer({ tipoOperacionNombre: 'Logística Fletes' }), 's1', 'Verde Mx')).toEqual({});
  });
});

describe('ventana del cruce', () => {
  it('Nuevo Laredo: un puente y su monto', () => {
    avisarCrucePuente(transfer(), { saldoPuente: 144, saldoPuentePuente: 'Caseta Puente III', saldoPuenteMoneda: 'Pesos' });
    expect(ventanas).toEqual([{ titulo: '🌉 Cruce de puente', parrafos: [
      'Esta unidad (T-15 · TR-211026-021) cruzó el puente Caseta Puente III.',
      'Se envió el cobro a Operaciones sin asignar por el monto de $144.00 MXN.',
    ] }]);
  });
  it('Colombia: la caseta y el puente, con sus dos montos', () => {
    const t = textosCrucePuente(transfer({ convenio: 'conv-col' }), {
      saldoPuente: 129.6, saldoPuentePuente: 'Caseta Mx Colombia', saldoPuenteMoneda: 'Pesos',
      saldoPuentePiso: 90, saldoPuentePisoPuente: 'Puente Mx Colombia', saldoPuentePisoMoneda: 'Pesos',
    });
    expect(t?.parrafos).toEqual([
      'Esta unidad (T-15 · TR-211026-021) cruzó el puente Caseta Mx Colombia y Puente Mx Colombia.',
      'Se envió el cobro a Operaciones sin asignar por el monto de $129.60 MXN + $90.00 MXN.',
    ]);
  });
  it('sin cobro no abre nada', () => {
    avisarCrucePuente(transfer(), {});
    expect(ventanas).toEqual([]);
  });
});

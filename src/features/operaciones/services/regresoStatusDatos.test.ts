// ✅ V00476 — regresar el estatus: transacción con el dato actual, bitácora marcada y cobro del puente.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Datos = Record<string, unknown>;
const base: { doc: Datos | null } = { doc: null };
const escrito: { horarios: Datos[]; op: Datos | null } = { horarios: [], op: null };
const flags = { cobroPuenteEnServidor: false };
const cobro = vi.fn(async (): Promise<Datos> => ({}));
const avisos: { id: string; data: Datos; origen?: string; campos?: readonly string[] }[] = [];
const cruces: Datos[] = [];
const verdes: string[] = [];

vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../utils/logger', () => ({ registrarLog: vi.fn(async () => undefined) }));
vi.mock('../../../shared/data/flags', () => ({ obtenerFlags: async () => flags }));
vi.mock('../../../utils/operacionesBus', () => ({ notificarOperacionGuardada: (id: string, data: Datos, origen?: string, campos?: readonly string[]) => { avisos.push({ id, data, origen, campos }); } }));
vi.mock('../../../utils/historialCalculadoPuentes', () => ({ esStatusVerde: (n: unknown) => /verde/i.test(String(n)), registrarVerdeAutomatico: async (_op: Datos, n: string) => { verdes.push(n); } }));
vi.mock('../../puentes/services/crucePuente', () => ({ cobroPuenteDelPaso: () => cobro(), avisarCrucePuente: (_op: Datos, c: Datos) => { cruces.push(c); } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, col: string) => ({ col }),
  doc: (padre: { col?: string }, col?: string, id?: string) => ({ col: col ?? padre.col, id: id ?? 'nuevo' }),
  getDocs: async () => ({ docs: [] }),
  query: () => ({}),
  where: () => ({}),
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const pend: (() => void)[] = [];
    const r = await fn({
      get: async () => ({ exists: () => base.doc !== null, data: () => base.doc }),
      set: (ref: { col: string }, d: Datos) => { pend.push(() => { if (ref.col === 'horarios') escrito.horarios.push(d); }); },
      update: (_ref: unknown, d: Datos) => { pend.push(() => { escrito.op = d; }); },
    });
    pend.forEach((p) => p());
    return r;
  },
}));

const { ErrorRegreso, regresarStatusOperacion } = await import('./regresoStatusDatos');
const { ORIGEN_REGRESO_STATUS } = await import('./regresoStatus');

const FALSO = { id: 'f557b751', nombre: '7. Falso' };
const opFalso = (extra: Datos = {}): Datos => ({ id: 'op1', ref: 'TR-221026-011', status: FALSO.id, statusNombre: FALSO.nombre, sueldoOperador: 200, sueldoOperadorCompleto: 400, sueldoMitadAplicada: true, ...extra });

beforeEach(() => {
  base.doc = opFalso(); escrito.horarios = []; escrito.op = null; flags.cobroPuenteEnServidor = false;
  cobro.mockResolvedValue({}); avisos.length = 0; cruces.length = 0; verdes.length = 0;
});

describe('regresar estatus', () => {
  it('de Falso a En ruta: bitácora marcada, estatus y sueldo completo; avisa a Activas', async () => {
    const { cambios } = await regresarStatusOperacion(opFalso(), { id: 's2', nombre: '2. En ruta' }, '2026-10-22T20:00', 'Servicios Completados');
    expect(escrito.horarios).toEqual([expect.objectContaining({ operacionId: 'op1', status: 's2', statusNombre: '2. En ruta', fechaHora: '2026-10-22T20:00', regreso: true, statusAnterior: FALSO.id, statusAnteriorNombre: '7. Falso' })]);
    expect(escrito.op).toEqual({ status: 's2', statusNombre: '2. En ruta', sueldoOperador: 400, sueldoTotal: 400, sueldoMitadAplicada: false });
    expect(cambios).toEqual(escrito.op);
    expect(avisos).toEqual([expect.objectContaining({ id: 'op1', origen: ORIGEN_REGRESO_STATUS, campos: Object.keys(escrito.op ?? {}) })]);
    expect(avisos[0].data).toMatchObject({ status: 's2', _docId: 'op1', ref: 'TR-221026-011' });
  });
  it('el sueldo sale del dato ACTUAL, no de la copia de la lista', async () => {
    base.doc = opFalso({ sueldoOperador: 150, sueldoOperadorCompleto: 300 });
    await regresarStatusOperacion(opFalso(), { id: 's2', nombre: '2. En ruta' }, '2026-10-22T20:00', 'x');
    expect(escrito.op).toMatchObject({ sueldoOperador: 300 });
  });
  it('si alguien ya le cambió el estatus, no escribe nada', async () => {
    base.doc = opFalso({ status: 'c2d57403', statusNombre: '6. Servicio Completado' });
    await expect(regresarStatusOperacion(opFalso(), { id: 's2', nombre: '2. En ruta' }, '2026-10-22T20:00', 'x')).rejects.toBeInstanceOf(ErrorRegreso);
    expect(escrito.horarios).toEqual([]);
    expect(escrito.op).toBeNull();
    expect(avisos).toEqual([]);
  });
  it('a un Verde sin puente cobrado: cobra (sin la bandera) y abre la ventana del cruce', async () => {
    cobro.mockResolvedValue({ saldoPuente: 144, saldoPuentePuente: 'Caseta Puente III' });
    await regresarStatusOperacion(opFalso(), { id: 'sv', nombre: '9.1 Verde Mx' }, '2026-10-22T20:00', 'x');
    expect(escrito.op).toMatchObject({ saldoPuente: 144 });
    expect(cruces).toEqual([{ saldoPuente: 144, saldoPuentePuente: 'Caseta Puente III' }]);
    expect(verdes).toEqual(['9.1 Verde Mx']);
  });
  it('con la bandera el cobro lo escribe el servidor; ya cobrado en la base, no se cobra', async () => {
    cobro.mockResolvedValue({ saldoPuente: 144 });
    flags.cobroPuenteEnServidor = true;
    await regresarStatusOperacion(opFalso(), { id: 'sv', nombre: '9.1 Verde Mx' }, '2026-10-22T20:00', 'x');
    expect(escrito.op).not.toHaveProperty('saldoPuente');
    expect(cruces).toEqual([{ saldoPuente: 144 }]);
    flags.cobroPuenteEnServidor = false; cruces.length = 0;
    base.doc = opFalso({ saldoPuente: 120 });
    await regresarStatusOperacion(opFalso(), { id: 'sv', nombre: '9.1 Verde Mx' }, '2026-10-22T20:00', 'x');
    expect(escrito.op).not.toHaveProperty('saldoPuente');
    expect(cruces).toEqual([{}]);
  });
});

// ✅ V00441 (Fase 5.6 / 5.7) — cobro del puente en el servidor (con el horario capturado)
// y recálculo idempotente del saldo corriente de diesel, contra un Firestore falso.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Datos = Record<string, unknown>;

const falso = vi.hoisted(() => {
  const BORRAR = Symbol('borrar');
  const docs = new Map<string, Record<string, unknown>>();
  const lecturas: string[] = [];
  type Filtro = [string, unknown];
  const snap = (path: string) => {
    const d = docs.get(path);
    return { id: path.split('/').pop() as string, exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
  };
  const ejecutar = (ruta: string, filtros: Filtro[]) => {
    lecturas.push(`${ruta}?${filtros.map((f) => f.join('=')).join('&')}`);
    const prefijo = `${ruta}/`;
    const r = Array.from(docs.entries())
      .filter(([p, d]) => p.startsWith(prefijo) && !p.slice(prefijo.length).includes('/') && filtros.every(([c, v]) => d[c] === v))
      .map(([p, d]) => ({ id: p.split('/').pop() as string, data: () => structuredClone(d) }));
    return { docs: r, empty: r.length === 0, size: r.length };
  };
  const consulta = (ruta: string, filtros: Filtro[]) => ({
    __consulta: true, ruta, filtros,
    where: (c: string, _op: string, v: unknown) => consulta(ruta, [...filtros, [c, v]]),
    get: async () => ejecutar(ruta, filtros),
  });
  const ref = (path: string) => ({ path, id: path.split('/').pop(), get: async () => { lecturas.push(path); return snap(path); } });
  const fusionar = (base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(extra)) {
      if (v === BORRAR) delete out[k];
      else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = fusionar(out[k] as Record<string, unknown>, v as Record<string, unknown>);
      else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = fusionar({}, v as Record<string, unknown>);
      else out[k] = v;
    }
    return out;
  };
  const db = {
    collection: (nombre: string) => ({
      doc: (id: string) => ref(`${nombre}/${id}`),
      where: (c: string, _op: string, v: unknown) => consulta(nombre, [[c, v]]),
      get: async () => ejecutar(nombre, []),
    }),
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const pendientes: (() => void)[] = [];
      const tx = {
        get: async (x: { path?: string; __consulta?: boolean; ruta: string; filtros: Filtro[] }) => (x.__consulta ? ejecutar(x.ruta, x.filtros) : snap(x.path as string)),
        set: (r: { path: string }, datos: Record<string, unknown>, op?: { merge?: boolean }) => {
          pendientes.push(() => docs.set(r.path, op?.merge ? fusionar(docs.get(r.path) ?? {}, datos) : fusionar({}, datos)));
        },
      };
      const r = await fn(tx);
      pendientes.forEach((p) => p());
      return r;
    },
  };
  return { docs, db, lecturas, BORRAR };
});

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => falso.db, FieldValue: { delete: () => falso.BORRAR } }));
vi.mock('firebase-functions/v2', () => ({ logger: { error: () => {}, info: () => {} } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_o: unknown, fn: unknown) => fn }));
vi.mock('../src/canonico', () => ({
  CATALOGO_ADUANAS: ['catalogo_aduanas', ['aduana']],
  catalogoServidor: async () => ({ porId: new Map([['adu-nl', 'Nuevo Laredo'], ['adu-col', 'Colombia']]) }),
}));

const mod = await import('../src/puentesYDiesel');
type Trigger = (e: { params: Datos; data: { before: { exists: boolean; data: () => Datos | undefined }; after: { exists: boolean; data: () => Datos | undefined } } }) => Promise<void>;
const evento = (antes: Datos | undefined, despues: Datos | undefined) => ({
  params: { refId: 'r' },
  data: { before: { exists: !!antes, data: () => antes }, after: { exists: !!despues, data: () => despues } },
});

beforeEach(() => {
  mod.reiniciarCacheCatalogos();
  falso.docs.clear();
  falso.lecturas.length = 0;
  falso.docs.set('catalogo_tipos_gastos/g-avi', { nombre_gasto: 'Caseta AVI', categoria_gasto: 'Puente', importe: 23.75, moneda: 'USD' });
  falso.docs.set('catalogo_tipos_gastos/g-p3', { nombre_gasto: 'Caseta Puente III', categoria_gasto: 'Puente', importe: 144, moneda: 'MXN' });
  falso.docs.set('convenios_clientes_detalles/conv1', { tarifaBaseId: 'tar1' });
  falso.docs.set('catalogo_tarifas_referencia/tar1', { aduana: 'adu-nl' });
  falso.docs.set('tarifas_gastos_incluidos/v1', { tarifa_referencia_id: 'tar1', gasto: 'g-p3', monto: 150 });
});

describe('cobro del puente en el servidor', () => {
  const op = { tipoOperacionNombre: 'Transfer', trafico: 'Importación', convenio: 'conv1', fechaServicioISO: '2026-10-01' };
  it('al pasar a Verde cobra con la fecha CAPTURADA en el horario más reciente', async () => {
    falso.docs.set('horarios/h1', { operacionId: 'o1', status: 's-verde', fechaHora: '2026-10-05T08:00', registradoEn: '2026-10-05T08:01:00Z' });
    falso.docs.set('horarios/h2', { operacionId: 'o1', status: 's-verde', fechaHora: '2026-10-09T09:30', registradoEn: '2026-10-09T09:31:00Z' });
    const r = await mod.cambiosCobroPuente(falso.db as never, 'o1', { ...op, status: 's-antes' }, { ...op, status: 's-verde', statusNombre: 'Verde USA' });
    expect(r).toMatchObject({ saldoPuente: 150, saldoPuentePuente: 'Caseta Puente III', saldoPuenteFecha: '2026-10-09', saldoPuenteEvento: 'Verde USA', puenteCobradoPor: 'servidor' });
  });
  it('no lee nada si el estatus no cambió, ya se cobró o no dispara', async () => {
    expect(await mod.cambiosCobroPuente(falso.db as never, 'o1', { ...op, status: 's1' }, { ...op, status: 's1', statusNombre: 'Verde USA' })).toEqual({});
    expect(await mod.cambiosCobroPuente(falso.db as never, 'o1', { ...op, status: 's1' }, { ...op, status: 's2', statusNombre: 'Verde USA', saldoPuente: 23.75 })).toEqual({});
    expect(await mod.cambiosCobroPuente(falso.db as never, 'o1', { ...op, status: 's1' }, { ...op, status: 's2', statusNombre: 'En tránsito' })).toEqual({});
    expect(falso.lecturas.filter((l) => !l.startsWith('config_flujos_operacion'))).toEqual([]);
  });
  it('ya en Verde: si se corrige el convenio (faltaba), cobra; otras ediciones no', async () => {
    const sinConv = { ...op, convenio: '', trafico: '' };
    expect(await mod.cambiosCobroPuente(falso.db as never, 'o3', { ...sinConv, status: 'v', observaciones: 'a' }, { ...sinConv, status: 'v', statusNombre: 'Verde USA', observaciones: 'b' })).toEqual({});
    const r = await mod.cambiosCobroPuente(falso.db as never, 'o3', { ...sinConv, status: 'v' }, { ...op, status: 'v', statusNombre: 'Verde USA' });
    expect(r).toMatchObject({ saldoPuente: 150 });
  });
  it('V00465: el detalle que guarda la tarifa en tipoConvenioId (Convenios de Clientes) también cobra la caseta de la tarifa', async () => {
    falso.docs.set('convenios_clientes_detalles/conv2', { tipoConvenioId: 'tar1' });
    const op2 = { ...op, convenio: 'conv2' };
    const r = await mod.cambiosCobroPuente(falso.db as never, 'o4', { ...op2, status: 'a' }, { ...op2, status: 'b', statusNombre: 'Verde USA' });
    expect(r).toMatchObject({ saldoPuente: 150, saldoPuentePuente: 'Caseta Puente III' });
  });
  it('la regla "🌉" del flujo manda sobre el verde', async () => {
    falso.docs.set('config_flujos_operacion/Transfer_Importación_N／A', { flujo: [{ nombreStatus: '6. Cruce', descuentaPuente: true }, { nombreStatus: 'Verde USA' }] });
    expect(await mod.cambiosCobroPuente(falso.db as never, 'o2', { ...op, status: 'a' }, { ...op, status: 'b', statusNombre: 'Verde USA' })).toEqual({});
    const r = await mod.cambiosCobroPuente(falso.db as never, 'o2', { ...op, status: 'a' }, { ...op, status: 'c', statusNombre: '6. Cruce' });
    expect(r).toMatchObject({ saldoPuente: 150, saldoPuenteEvento: '6. Cruce' });
  });
  it('V00469: un saldoPuente en 0 (caseta sin importe) no bloquea el cobro; el elegido a mano sí', async () => {
    const r = await mod.cambiosCobroPuente(falso.db as never, 'o5', { ...op, status: 'a', saldoPuente: 0 }, { ...op, status: 'b', statusNombre: 'Verde USA', saldoPuente: 0 });
    expect(r).toMatchObject({ saldoPuente: 150 });
    expect(await mod.cambiosCobroPuente(falso.db as never, 'o5', { ...op, status: 'a' }, { ...op, status: 'b', statusNombre: 'Verde USA', saldoPuente: 0, saldoPuenteManual: true })).toEqual({});
  });
  it('V00469: una cascada que pasa por Verde USA y termina en un estatus automático cobra en el Verde', async () => {
    falso.docs.set('config_flujos_operacion/Transfer_Importación_N／A', { flujo: [{ nombreStatus: 'Verde USA' }, { nombreStatus: 'En tránsito', tipoMecanismo: 'automatico' }] });
    const R = new Date().toISOString();
    falso.docs.set('horarios/c0', { operacionId: 'o6', status: 's-verde', statusNombre: 'Verde USA', fechaHora: '2026-10-12T07:00', registradoEn: R, ordenCascada: 0 });
    falso.docs.set('horarios/c1', { operacionId: 'o6', status: 's-trans', statusNombre: 'En tránsito', fechaHora: '2026-10-12T07:00', registradoEn: R, ordenCascada: 1, esAutomatico: true });
    const r = await mod.cambiosCobroPuente(falso.db as never, 'o6', { ...op, status: 's-antes' }, { ...op, status: 's-trans', statusNombre: 'En tránsito' });
    expect(r).toMatchObject({ saldoPuente: 150, saldoPuenteEvento: 'Verde USA', saldoPuenteFecha: '2026-10-12' });
  });
  it('V00469: Verde MX → Completado automático cobra en el Verde (con su fecha), aunque Completado también cobre', async () => {
    falso.docs.set('config_flujos_operacion/Transfer_Importación_N／A', { flujo: [{ nombreStatus: 'Verde MX' }, { nombreStatus: 'Servicio Completado', tipoMecanismo: 'automatico' }] });
    const R = new Date().toISOString();
    const completado = 'c2d57403'; // STATUS_COMPLETADOS
    falso.docs.set('horarios/d0', { operacionId: 'o8', status: 's-vmx', statusNombre: 'Verde MX', fechaHora: '2026-10-14T18:00', registradoEn: R, ordenCascada: 0 });
    falso.docs.set('horarios/d1', { operacionId: 'o8', status: completado, statusNombre: 'Servicio Completado', fechaHora: '2026-10-14T18:00', registradoEn: R, ordenCascada: 1 });
    const r = await mod.cambiosCobroPuente(falso.db as never, 'o8', { ...op, status: 's-antes' }, { ...op, status: completado, statusNombre: 'Servicio Completado' });
    expect(r).toMatchObject({ saldoPuente: 150, saldoPuenteEvento: 'Verde MX', saldoPuenteFecha: '2026-10-14' });
  });
  it('V00469: una cascada vieja (o un horario posterior sin cascada) no se vuelve a usar', () => {
    const viejo = '2026-10-01T10:00:00Z';
    const ahora = Date.parse('2026-10-21T10:00:00Z');
    expect(mod.pasosPreviosDeCascada([{ status: 'v', registradoEn: viejo, ordenCascada: 0 }, { status: 't', registradoEn: viejo, ordenCascada: 1 }], 't', ahora)).toEqual([]);
    const reciente = '2026-10-21T09:50:00Z';
    const hs = [{ status: 'v', registradoEn: reciente, ordenCascada: 0 }, { status: 't', registradoEn: reciente, ordenCascada: 1 }];
    expect(mod.pasosPreviosDeCascada(hs, 't', ahora).map((h) => h.status)).toEqual(['v']);
    expect(mod.pasosPreviosDeCascada([...hs, { status: 't', registradoEn: '2026-10-21T09:55:00Z' }], 't', ahora)).toEqual([]);
  });
  it('V00469: a un estatus que no es automático no se le buscan pasos (sin leer horarios)', async () => {
    falso.docs.set('config_flujos_operacion/Transfer_Importación_N／A', { flujo: [{ nombreStatus: 'Verde USA' }, { nombreStatus: 'En tránsito', tipoMecanismo: 'manual' }] });
    expect(await mod.cambiosCobroPuente(falso.db as never, 'o7', { ...op, status: 'a' }, { ...op, status: 'b', statusNombre: 'En tránsito' })).toEqual({});
    expect(falso.lecturas.filter((l) => l.startsWith('horarios'))).toEqual([]);
  });
  it('V00469: pasosPreviosDeCascada toma solo el clic del último horario de ese estatus', () => {
    const hs = [
      { status: 'v', registradoEn: 'A', ordenCascada: 0 }, { status: 't', registradoEn: 'A', ordenCascada: 1 },
      { status: 'x', registradoEn: 'B', ordenCascada: 0 }, { status: 'y', registradoEn: 'B', ordenCascada: 1 }, { status: 't', registradoEn: 'B', ordenCascada: 2 },
    ];
    const ahora = Date.parse('2026-10-21T10:00:00Z');
    const conHora = hs.map((h) => ({ ...h, registradoEn: h.registradoEn === 'A' ? '2026-10-21T09:40:00Z' : '2026-10-21T09:45:00Z' }));
    expect(mod.pasosPreviosDeCascada(conHora, 't', ahora).map((h) => h.status)).toEqual(['x', 'y']);
    expect(mod.pasosPreviosDeCascada([{ status: 't', registradoEn: '2026-10-21T09:45:00Z' }], 't', ahora)).toEqual([]);
  });
});

describe('saldo corriente de diesel', () => {
  const trigger = mod.referenciaDieselEscrita as unknown as Trigger;
  const ref = (extra: Datos = {}): Datos => ({ proveedorId: 'P1', proveedorNombre: 'Gas', fecha: '2026-10-10', totalCargado: 100, ...extra });
  it('recalcula el día del proveedor y el general; repetir el evento no duplica', async () => {
    falso.docs.set('referencias_diesel/r1', ref());
    falso.docs.set('referencias_diesel/r2', ref({ totalCargado: 50.25 }));
    await trigger(evento(undefined, ref()));
    await trigger(evento(undefined, ref()));
    expect(falso.docs.get('saldos_corrientes/diesel_P1')).toMatchObject({ tipo: 'diesel', clave: 'P1', nombre: 'Gas', dias: { '2026-10-10': { c: 15025, n: 2 } } });
    expect(falso.docs.get('saldos_corrientes/diesel___todos__')).toMatchObject({ dias: { '2026-10-10': { c: 15025, n: 2 } } });
  });
  it('cambiar de fecha mueve el monto; borrar la última referencia del día quita ese día', async () => {
    falso.docs.set('referencias_diesel/r1', ref({ fecha: '2026-10-11' }));
    falso.docs.set('saldos_corrientes/diesel_P1', { tipo: 'diesel', clave: 'P1', dias: { '2026-10-10': { c: 10000, n: 1 } } });
    await trigger(evento(ref(), ref({ fecha: '2026-10-11' })));
    expect(falso.docs.get('saldos_corrientes/diesel_P1')?.dias).toEqual({ '2026-10-11': { c: 10000, n: 1 } });
    falso.docs.delete('referencias_diesel/r1');
    await trigger(evento(ref({ fecha: '2026-10-11' }), undefined));
    expect(falso.docs.get('saldos_corrientes/diesel_P1')?.dias).toEqual({});
  });
  it('cambios que no mueven el saldo (fotos) no escriben', async () => {
    await trigger(evento(ref(), ref({ fotos: ['x'] })));
    expect(falso.docs.has('saldos_corrientes/diesel_P1')).toBe(false);
  });
  it('hoy en Nuevo Laredo (no en UTC)', () => {
    expect(mod.hoyOperacion(new Date('2026-10-11T03:00:00Z'))).toBe('2026-10-10');
  });
});

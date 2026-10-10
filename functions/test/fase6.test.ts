// ✅ V00442 (Fase 6) — reintentos e idempotencia, contadores de uso y propagación de nombres,
// contra un Firestore falso (transacciones, increment y BulkWriter).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Datos = Record<string, unknown>;

const falso = vi.hoisted(() => {
  const INC = Symbol('increment');
  const docs = new Map<string, Record<string, unknown>>();
  const banderas: Record<string, boolean> = {};
  type Filtro = [string, unknown];
  const aplicar = (base: Record<string, unknown>, datos: Record<string, unknown>) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(datos)) {
      const inc = v as { [INC]?: number } | null;
      if (inc && typeof inc === 'object' && INC in inc) out[k] = (Number(out[k]) || 0) + (inc[INC] as number);
      else out[k] = v;
    }
    return out;
  };
  const snap = (path: string) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => (docs.has(path) ? { ...docs.get(path) } : undefined) });
  const ref = (path: string) => ({
    path, id: path.split('/').pop(),
    get: async () => snap(path),
    set: async (datos: Record<string, unknown>, op?: { merge?: boolean }) => { docs.set(path, aplicar(op?.merge ? (docs.get(path) ?? {}) : {}, datos)); },
  });
  const consulta = (col: string, filtros: Filtro[]) => ({
    select: () => consulta(col, filtros),
    where: (c: string, _o: string, v: unknown) => consulta(col, [...filtros, [c, v]]),
    get: async () => {
      const r = Array.from(docs.entries())
        .filter(([p, d]) => p.startsWith(`${col}/`) && !p.slice(col.length + 1).includes('/') && filtros.every(([c, v]) => d[c] === v))
        .map(([p, d]) => ({ id: p.split('/').pop(), ref: ref(p), data: () => ({ ...d }) }));
      return { docs: r, size: r.length, empty: r.length === 0 };
    },
  });
  const escrituras: { path: string; datos: Datos }[] = [];
  const db = {
    collection: (col: string) => ({ doc: (id: string) => ref(`${col}/${id}`), where: (c: string, o: string, v: unknown) => consulta(col, []).where(c, o, v) }),
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const pendientes: (() => void)[] = [];
      const tx = {
        get: async (r: { path: string }) => snap(r.path),
        set: (r: { path: string }, datos: Record<string, unknown>, op?: { merge?: boolean }) => {
          pendientes.push(() => docs.set(r.path, aplicar(op?.merge ? (docs.get(r.path) ?? {}) : {}, datos)));
        },
      };
      const res = await fn(tx);
      pendientes.forEach((p) => p());
      return res;
    },
    batch: () => {
      const ops: (() => void)[] = [];
      const creates: string[] = [];
      return {
        create: (r: { path: string }, datos: Record<string, unknown>) => { creates.push(r.path); ops.push(() => docs.set(r.path, { ...datos })); },
        set: (r: { path: string }, datos: Record<string, unknown>, op?: { merge?: boolean }) => { ops.push(() => docs.set(r.path, aplicar(op?.merge ? (docs.get(r.path) ?? {}) : {}, datos))); },
        commit: async () => {
          if (creates.some((c) => docs.has(c))) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
          ops.forEach((o) => o());
        },
      };
    },
    bulkWriter: () => ({
      update: (r: { path: string }, datos: Datos) => { escrituras.push({ path: r.path, datos }); docs.set(r.path, { ...docs.get(r.path), ...datos }); return Promise.resolve(); },
      close: async () => {},
    }),
  };
  return { INC, docs, db, banderas, escrituras };
});

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => falso.db,
  FieldValue: { increment: (n: number) => ({ [falso.INC]: n }) },
  Timestamp: { now: () => ({ ms: 0 }), fromMillis: (ms: number) => ({ ms }) },
}));
vi.mock('firebase-functions/v2', () => ({ logger: { error: () => {}, info: () => {} } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentUpdated: (_o: unknown, fn: unknown) => fn, onDocumentWritten: (_o: unknown, fn: unknown) => fn }));
vi.mock('../src/flags.js', () => ({ banderaServidor: async (n: string) => falso.banderas[n] === true }));

const eventos = await import('../src/eventos');
const usos = await import('../src/usos');
const prop = await import('../src/propagacion');

const ID_A = 'AAAAAAAAAAAAAAAAAAA1';
beforeEach(() => { falso.docs.clear(); falso.escrituras.length = 0; for (const k of Object.keys(falso.banderas)) delete falso.banderas[k]; });

describe('reintentos (6.4)', () => {
  it('relanza el error para que Cloud Functions reintente; descarta un evento de más de 24 h', async () => {
    const ahora = Date.parse('2026-10-10T12:00:00Z');
    await expect(eventos.conReintento('t', { id: 'e', time: '2026-10-10T11:59:00Z' }, async () => { throw new Error('x'); }, ahora)).rejects.toThrow('x');
    const cuerpo = vi.fn(async () => {});
    await eventos.conReintento('t', { id: 'e', time: '2026-10-10T09:00:00Z' }, cuerpo, ahora); // 3 h tarde: sí se procesa
    expect(cuerpo).toHaveBeenCalledTimes(1);
    await eventos.conReintento('t', { id: 'e', time: '2026-10-09T10:00:00Z' }, cuerpo, ahora); // > 24 h: se descarta
    expect(cuerpo).toHaveBeenCalledTimes(1);
  });
  it('unaVezPorEvento: el mismo evento no corre dos veces', async () => {
    const cuerpo = vi.fn(async () => {});
    expect(await eventos.unaVezPorEvento(falso.db as never, 'ev-1', cuerpo)).toBe(true);
    expect(await eventos.unaVezPorEvento(falso.db as never, 'ev-1', cuerpo)).toBe(false);
    expect(cuerpo).toHaveBeenCalledTimes(1);
    expect(falso.docs.get('eventos_procesados/ev-1')).toHaveProperty('expiraEn');
  });
});

describe('contadores de uso (6.5)', () => {
  const op = { clientePaga: ID_A, convenio: '054', fechaServicioISO: '2026-10-05' };
  it('crear suma (una vez aunque se reintente), borrar resta, último uso solo sube', async () => {
    await usos.actualizarUsos(falso.db as never, 'c1', undefined, op);
    await usos.actualizarUsos(falso.db as never, 'c1', undefined, op); // reintento del mismo evento
    expect(falso.docs.get(`usos/empresa_${ID_A}`)).toMatchObject({ tipo: 'empresa', refId: ID_A, usoOps: 1, ultimoUsoISO: '2026-10-05' });
    expect(falso.docs.get('usos/convenioCliente_054')).toMatchObject({ usoOps: 1 });
    await usos.actualizarUsos(falso.db as never, 'c2', undefined, { ...op, fechaServicioISO: '2026-09-01' });
    expect(falso.docs.get(`usos/empresa_${ID_A}`)).toMatchObject({ usoOps: 2, ultimoUsoISO: '2026-10-05' });
    await usos.actualizarUsos(falso.db as never, 'b1', op, undefined);
    expect(falso.docs.get(`usos/empresa_${ID_A}`)).toMatchObject({ usoOps: 1 });
  });
  it('un cambio que no toca empresas, convenios ni fecha no escribe nada', async () => {
    expect(await usos.actualizarUsos(falso.db as never, 'x', op, { ...op, observaciones: 'hola' })).toBe(0);
    expect(falso.docs.size).toBe(0);
  });
});

describe('propagación de nombres (6.2)', () => {
  beforeEach(() => {
    falso.docs.set('operaciones/o1', { clientePaga: ID_A, clientePagaNombre: 'Viejo', clienteNombre: 'Viejo' });
    falso.docs.set('operaciones/o2', { clientePagaId: ID_A, clientePaga: 'Acme (AppSheet)', clientePagaNombre: 'Viejo' });
    falso.docs.set('operaciones/o3', { clientePaga: 'OTRA', clientePagaNombre: 'Otra' });
    falso.docs.set('facturas_clientes/F1', { clienteId: ID_A, clienteNombre: 'ACME SA DE CV' });
    falso.docs.set('pagos/P1', { empresaId: ID_A, entidadNombre: 'Viejo' });
    falso.docs.set(`empresas/${ID_A}`, { nombre: 'Acme', razonSocial: 'ACME SA DE CV', nombreCorto: 'Acme Norte' });
    falso.docs.set('operaciones/o4', { origen: ID_A, origenNombre: 'Viejo' });
  });
  it('razón social o nombre corto según el destino, por el ID de siempre y el canónico', async () => {
    falso.banderas.propagacionEnServidor = true;
    const n = await prop.propagarSiCambioNombre('empresas', ID_A, { nombre: 'Acme', razonSocial: '' }, { nombre: 'Acme', razonSocial: 'ACME SA DE CV' });
    expect(n).toBe(4); // o1, o2, o4 y P1 (una escritura por documento); F1 ya estaba bien
    expect(falso.docs.get('operaciones/o1')).toMatchObject({ clientePagaNombre: 'ACME SA DE CV', clienteNombre: 'ACME SA DE CV' });
    expect(falso.docs.get('operaciones/o2')).toMatchObject({ clientePagaNombre: 'ACME SA DE CV' });
    expect(falso.docs.get('operaciones/o3')).toMatchObject({ clientePagaNombre: 'Otra' });
    expect(falso.docs.get('pagos/P1')).toMatchObject({ entidadNombre: 'ACME SA DE CV' });
    expect(falso.docs.get('operaciones/o4')).toMatchObject({ origenNombre: 'Acme Norte' }); // origen: nombre corto, como el formulario
  });
  it('usa los datos ACTUALES del maestro (un reintento tardío no regresa un nombre viejo)', async () => {
    falso.banderas.propagacionEnServidor = true;
    await prop.propagarSiCambioNombre('empresas', ID_A, { razonSocial: 'X' }, { razonSocial: 'NOMBRE INTERMEDIO' });
    expect(falso.docs.get('operaciones/o1')).toMatchObject({ clientePagaNombre: 'ACME SA DE CV' });
  });
  it('sin la bandera, o si el nombre no cambió, no escribe', async () => {
    expect(await prop.propagarSiCambioNombre('empresas', ID_A, { nombre: 'Acme' }, { nombre: 'Acme 2' })).toBe(0);
    falso.banderas.propagacionEnServidor = true;
    expect(await prop.propagarSiCambioNombre('empresas', ID_A, { nombre: 'Acme', telefono: '1' }, { nombre: 'Acme', telefono: '2' })).toBe(0);
    expect(falso.escrituras).toEqual([]);
  });
  it('status y empleados con su regla de nombre', () => {
    const status = prop.MAESTROS.find((m) => m.coleccion === 'catalogo_status_servicio');
    const empleados = prop.MAESTROS.find((m) => m.coleccion === 'empleados');
    expect(status?.nombre({ nombre: '', descripcion: 'En tránsito' })).toBe('En tránsito');
    expect(empleados?.nombre({ firstName: 'Ana', lastNamePaternal: 'Ruiz' })).toBe('Ana Ruiz');
  });
});

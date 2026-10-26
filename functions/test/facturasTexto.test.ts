// ✅ V00496 — facturas importadas con las operaciones en texto: regla pura y corrida en simulación.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { efectoEnSaldo, planFacturasTexto } from '../scripts/facturasTextoPlan';
import type { FacturaLeida, OperacionLeida } from '../scripts/facturasTextoPlan';

type Datos = Record<string, unknown>;

const falso = vi.hoisted(() => {
  const colecciones = new Map<string, Map<string, Record<string, unknown>>>();
  const filas = (nombre: string) => Array.from(colecciones.get(nombre) ?? new Map<string, Record<string, unknown>>()).sort(([a], [b]) => a.localeCompare(b));
  const docSnap = (nombre: string, id: string) => {
    const datos = colecciones.get(nombre)?.get(id);
    return { id, exists: datos !== undefined, data: () => datos, ref: { id, path: `${nombre}/${id}` }, updateTime: {} };
  };
  interface Consulta { nombre: string; limite: number; despuesDe: string | null; filtro: [string, unknown[]] | null }
  const consulta = (c: Consulta) => ({
    orderBy: () => consulta(c),
    limit: (n: number) => consulta({ ...c, limite: n }),
    startAfter: (d: { id: string }) => consulta({ ...c, despuesDe: d.id }),
    where: (campo: string, _op: string, valores: unknown[]) => consulta({ ...c, filtro: [campo, valores] }),
    doc: (id: string) => ({ id, path: `${c.nombre}/${id}`, get: async () => docSnap(c.nombre, id) }),
    get: async () => {
      const docs = filas(c.nombre)
        .filter(([id, d]) => (c.despuesDe === null || id > c.despuesDe) && (!c.filtro || c.filtro[1].includes(d[c.filtro[0]])))
        .slice(0, c.limite).map(([id]) => docSnap(c.nombre, id));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const db = {
    collection: (nombre: string) => consulta({ nombre, limite: Infinity, despuesDe: null, filtro: null }),
    getAll: async (...refs: { path: string }[]) => refs.map((r) => { const [n, id] = r.path.split('/'); return docSnap(n, id); }),
  };
  return { colecciones, db };
});

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [] }));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' }, getFirestore: () => falso.db }));

const fac = (id: string, datos: Datos): FacturaLeida => ({ id, datos });
const ops = (m: Record<string, OperacionLeida | null>) => new Map(Object.entries(m));
const OPC = { dineroPorServidor: false, incluirConSaldo: false };

describe('planFacturasTexto', () => {
  it('convierte el texto en arreglo y marca las operaciones sin marca', () => {
    const plan = planFacturasTexto('cliente', [fac('F1', { invoice: 'IMP-1', operacionesIds: 'o1, o2 ,o3' })], ops({
      o1: { docId: 'o1', datos: { ref: 'TR-1' } },
      o2: { docId: 'o2', datos: { ref: 'TR-2', facturaClienteId: 'NO-EXISTE' } },
      o3: null,
    }), OPC);
    expect(plan.facturas).toEqual([{ id: 'F1', invoice: 'IMP-1', ids: ['o1', 'o2', 'o3'], accion: 'convertir', motivo: '' }]);
    expect(plan.operaciones.map((o) => [o.idLista, o.accion, o.facturaId])).toEqual([['o1', 'marcar', 'F1'], ['o2', 'marcar', 'F1'], ['o3', 'noExiste', '']]);
    expect(plan.operaciones[0].campos).toEqual({ facturaClienteId: 'F1', facturaClienteInvoice: 'IMP-1', facturado: true });
    expect(plan.operaciones[1].motivo).toContain('ya no existe');
  });
  it('ya marcada con una factura que existe: no se toca; solo en canceladas: no se marca', () => {
    const plan = planFacturasTexto('proveedor', [
      fac('P1', { invoice: 'PI-1', operacionesIds: 'a,b' }),
      fac('P2', { invoice: 'PI-2', operacionesIds: ['zz'] }),
      fac('PC', { invoice: 'PI-C', statusFactura: 'Cancelado', operacionesIds: 'c' }),
    ], ops({ a: { docId: 'a', datos: { facturaProveedorId: 'P2' } }, b: { docId: 'b', datos: {} }, c: { docId: 'c', datos: {} } }), OPC);
    expect(plan.operaciones.map((o) => [o.idLista, o.accion])).toEqual([['a', 'yaMarcada'], ['b', 'marcar'], ['c', 'soloCanceladas']]);
    expect(plan.operaciones[1].campos).toEqual({ facturaProveedorId: 'P1', facturaProveedorFolio: 'PI-1', facturadoProveedor: true });
  });
  it('id de AppSheet distinto del documento; en dos facturas vivas: se marca con la primera y se avisa', () => {
    const plan = planFacturasTexto('cliente', [
      fac('F1', { invoice: 'IMP-1', operacionesIds: 'APP-9' }),
      fac('F2', { invoice: 'A-2', operacionesIds: ['doc9'] }),
    ], ops({ 'APP-9': { docId: 'doc9', datos: { id: 'APP-9' } } }), OPC);
    expect(plan.operaciones[0]).toMatchObject({ idLista: 'APP-9', docId: 'doc9', accion: 'marcar', facturaId: 'F1' });
    expect(plan.operaciones[0].motivo).toMatch(/REVISAR: está en 2 facturas/);
  });
  it('si reescribirla le cambiaría el saldo, queda para revisar (salvo --incluir-con-saldo)', () => {
    // Pagada por completo con un total que sus renglones no explican: el trigger viejo la dejaría en otro saldo.
    const f = fac('F1', { invoice: 'IMP-1', operacionesIds: 'o1', monedaFacturacion: 'MXN', subtotalMonedaFactura: 500, montoPagado: 100, saldoPendiente: 400, statusPago: 'PARCIAL' });
    expect(Object.keys(efectoEnSaldo(f.datos, false)).length).toBeGreaterThan(0);
    const o = ops({ o1: { docId: 'o1', datos: {} } });
    expect(planFacturasTexto('cliente', [f], o, OPC).facturas[0].accion).toBe('revisar');
    expect(planFacturasTexto('cliente', [f], o, OPC).operaciones[0]).toMatchObject({ accion: 'marcar', motivo: expect.stringContaining('revisar saldo') });
    expect(planFacturasTexto('cliente', [f], o, { ...OPC, incluirConSaldo: true }).facturas[0].accion).toBe('convertir');
  });
  it('--limite: las facturas que no se procesan siguen contando (existen y contienen operaciones)', () => {
    const facturas = [
      fac('T1', { invoice: 'IMP-1', operacionesIds: 'o1' }),
      fac('T2', { invoice: 'IMP-2', operacionesIds: 'o1' }),
    ];
    const plan = planFacturasTexto('cliente', facturas, ops({ o1: { docId: 'o1', datos: { facturaClienteId: 'T2' } } }), { ...OPC, soloEstas: new Set(['T1']) });
    expect(plan.facturas.map((f) => f.id)).toEqual(['T1']);
    expect(plan.operaciones).toMatchObject([{ idLista: 'o1', accion: 'yaMarcada', facturaId: 'T2' }]);
  });
  it('con dineroPorServidor, completar los agregados que faltan no cuenta como cambio', () => {
    const pagada = { invoice: 'IMP-2', operacionesIds: 'o1', statusPago: 'PAGADA', montoPagado: 500, saldoPendiente: 0, subtotalFactura: 500, monedaFacturacion: 'MXN' };
    expect(efectoEnSaldo(pagada, true)).toEqual({});
    expect(planFacturasTexto('cliente', [fac('F2', pagada)], ops({ o1: { docId: 'o1', datos: {} } }), { ...OPC, dineroPorServidor: true }).facturas[0].accion).toBe('convertir');
  });
  it('con dineroPorServidor también cuenta que pase a abierta (aparecería como deuda en Pagos)', () => {
    const pagadaImportada = { invoice: 'IMP-1', operacionesIds: 'o1', statusPago: 'PAGADA', subtotalFactura: 500, monedaFacturacion: 'MXN' };
    expect(efectoEnSaldo(pagadaImportada, true)).toMatchObject({ abierta: true });
    expect(planFacturasTexto('cliente', [fac('F1', pagadaImportada)], ops({ o1: { docId: 'o1', datos: {} } }), { ...OPC, dineroPorServidor: true }).facturas[0].accion).toBe('revisar');
  });
  it('texto vacío: no se toca', () => {
    expect(planFacturasTexto('cliente', [fac('F1', { operacionesIds: ' , ' })], ops({}), OPC).facturas[0].accion).toBe('vacia');
  });
});

describe('facturasTexto (simulación)', () => {
  it('reporta facturas y operaciones sin escribir nada', async () => {
    falso.colecciones.set('facturas_clientes', new Map(Object.entries({
      F1: { invoice: 'IMP-1', clienteNombre: 'Acme', operacionesIds: 'o1, APP-2' },
      F2: { invoice: 'A-2', clienteNombre: 'Acme', operacionesIds: ['o3'] },
    })));
    falso.colecciones.set('facturas_proveedores', new Map());
    falso.colecciones.set('operaciones', new Map(Object.entries({ o1: { ref: 'TR-1' }, doc2: { ref: 'TR-2', id: 'APP-2' }, o3: { ref: 'TR-3', facturaClienteId: 'F2' } })));
    falso.colecciones.set('configuracion', new Map(Object.entries({ flags: { dineroPorServidor: false } })));
    const dir = mkdtempSync(join(tmpdir(), 'facturas-texto-'));
    process.env.REPORTES_MIGRACION = dir;
    process.argv = [process.argv[0], 'facturasTexto'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { corrida } = await import('../scripts/facturasTexto');
    await corrida;
    expect(process.exitCode ?? 0).toBe(0);
    const [sub] = readdirSync(dir);
    const csv = (n: string) => readFileSync(join(dir, sub, `${n}.csv`), 'utf8').trim().split('\n').map((l) => l.slice(1, -1).split('","'));
    expect(csv('facturas').slice(1)).toEqual([['facturas_clientes', 'F1', 'IMP-1', 'Acme', '', 'o1 APP-2', 'convertir', '']]);
    expect(csv('operaciones').slice(1).map((f) => [f[1], f[2], f[4], f[5]])).toEqual([['o1', 'o1', 'marcar', 'F1'], ['APP-2', 'doc2', 'marcar', 'F1']]);
    const resumen = JSON.parse(readFileSync(join(dir, sub, 'resumen.json'), 'utf8')) as { aplicado: boolean; resumen: Record<string, Record<string, number>> };
    expect(resumen.aplicado).toBe(false);
    expect(resumen.resumen.facturas_clientes).toMatchObject({ 'facturas:convertir': 1, 'operaciones:marcar': 2 });
  });
});

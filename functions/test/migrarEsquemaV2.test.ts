// ✅ V00440 (Fase 4.3) — la migración corre de punta a punta en SIMULACIÓN contra un
// Firestore falso (el emulador real se usa en la máquina de Omaf: ver PLAN-REFACTOR.md).
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type Datos = Record<string, unknown>;

const falso = vi.hoisted(() => {
  const colecciones = new Map<string, Map<string, Record<string, unknown>>>();
  const escrituras: unknown[] = [];
  interface Consulta { nombre: string; limite: number; despuesDe: string | null }
  const instantanea = (nombre: string, id: string, datos: Record<string, unknown>) => ({
    id,
    ref: { id, parent: { id: nombre } },
    data: () => datos,
    get: (campo: string) => datos[campo],
    updateTime: { sello: 1 },
  });
  const consulta = (c: Consulta) => ({
    select: () => consulta(c),
    orderBy: () => consulta(c),
    limit: (n: number) => consulta({ ...c, limite: n }),
    startAfter: (d: { id: string }) => consulta({ ...c, despuesDe: d.id }),
    get: async () => {
      const filas = Array.from(colecciones.get(c.nombre) ?? new Map<string, Record<string, unknown>>())
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([id]) => c.despuesDe === null || id > c.despuesDe)
        .slice(0, c.limite)
        .map(([id, datos]) => instantanea(c.nombre, id, datos));
      return { docs: filas, size: filas.length, empty: filas.length === 0 };
    },
  });
  const db = {
    collection: (nombre: string) => consulta({ nombre, limite: Infinity, despuesDe: null }),
    bulkWriter: () => ({ update: (...a: unknown[]) => { escrituras.push(a); }, onWriteError: () => {}, close: async () => {} }),
  };
  return { colecciones, escrituras, db };
});

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [] }));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' }, getFirestore: () => falso.db }));

const poner = (nombre: string, docs: Record<string, Datos>): void => {
  falso.colecciones.set(nombre, new Map(Object.entries(docs)));
};

const leerCsv = (ruta: string): string[][] =>
  readFileSync(ruta, 'utf8').trim().split('\n').map((l) => l.slice(1, -1).split('","').map((c) => c.replace(/""/g, '"')));

describe('migrarEsquemaV2 (simulación)', () => {
  it('reporta cambios, pendientes y diferencias de paridad sin escribir', async () => {
    poner('empresas', { a1b2c3d4: { nombre: 'Acme' }, b1b2c3d4: { nombre: 'Bodega Norte' }, c1b2c3d4: { nombre: 'Bodega Norte' } });
    poner('empleados', { e1e2e3e4: { firstName: 'Juan', lastNamePaternal: 'Pérez' } });
    poner('unidades', { u1u2u3u4: { unidad: 'T-01' } });
    poner('catalogo_status_servicio', { c2d57403: { nombre: 'Servicio Completado' }, aaaa1111: { nombre: 'En ruta' } });
    poner('convenios_clientes_detalles', { 'CONV-054': {} });
    poner('convenios_proveedores_detalles', {});
    poner('catalogo_carga_vacia', { cv1: { nombre: 'Cargado' } });
    poner('catalogo_aduanas', { ad1: { aduana: 'Colombia' } });
    poner('facturas_clientes', { F1: { operacionesIds: ['op2'] } });
    poner('operaciones', {
      op1: { ref: 'TR-1', fechaServicio: '9/10/2026', status: 'c2d57403', statusNombre: 'Servicio Completado', clientePaga: 'Acme',
        operador: 'Juan Pérez', convenio: 'CONV-054', convenioNombre: 'Transfer - Cargado - Colombia', trafico: 'Importación' },
      op2: { ref: 'TR-2', fechaServicio: '2026-10-09', status: 'c2d57403', clientePaga: 'a1b2c3d4' },
      op3: { ref: 'TR-3', fechaServicio: '2026-10-09', status: 'aaaa1111', clientePaga: 'a1b2c3d4', destino: 'Bodega Norte' },
    });
    poner('pagos', { p1: { tipo: 'cliente', clienteId: 'a1b2c3d4' } });
    poner('referencias_nomina', { n1: { fechaPago: '10/10/2026', operadorNombre: 'Juan Pérez' } });
    poner('referencias_diesel', { d1: { unidadNombre: 'T-01', unidadId: null } });

    const dir = mkdtempSync(join(tmpdir(), 'migracion-'));
    process.env.REPORTES_MIGRACION = dir;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { corrida } = await import('../scripts/migrarEsquemaV2');
    await corrida;
    expect(process.exitCode ?? 0).toBe(0);

    const [sub] = readdirSync(dir);
    const base = join(dir, sub);
    const cambios = leerCsv(join(base, 'cambios.csv'));
    const pendientes = leerCsv(join(base, 'pendientes.csv'));
    const paridad = leerCsv(join(base, 'paridad.csv'));
    const resumen = JSON.parse(readFileSync(join(base, 'resumen.json'), 'utf8')) as { aplicado: boolean };

    expect(resumen.aplicado).toBe(false);
    expect(falso.escrituras).toEqual([]);
    const cambio = (doc: string, campo: string) => cambios.find((f) => f[1] === doc && f[3] === campo)?.[5];
    expect(cambio('op1', 'clientePagaId')).toBe('a1b2c3d4');          // nombre de AppSheet → ID
    expect(cambio('op1', 'operadorId')).toBe('e1e2e3e4');
    expect(cambio('op1', 'fechaServicioISO')).toBe('2026-10-09');
    expect(cambio('op1', 'cargaId')).toBe('cv1');
    expect(cambio('op1', 'aduanaNombre')).toBe('Colombia');           // derivado del convenio
    expect(cambio('op3', 'estadoGrupo')).toBe('activa');
    expect(cambio('p1', 'empresaId')).toBe('a1b2c3d4');
    expect(cambio('n1', 'fechaPagoISO')).toBe('2026-10-10');
    expect(cambio('n1', 'fechaPago')).toBeUndefined(); // el dato original no se toca
    expect(cambio('n1', 'operadorId')).toBe('e1e2e3e4');
    expect(cambio('d1', 'unidadId')).toBe('u1u2u3u4');
    expect(pendientes.some((f) => f[1] === 'op3' && f[3] === 'destinoId' && f[5] === 'ambiguo')).toBe(true);
    expect(cambio('op3', 'empresasIds')).toBe('["a1b2c3d4"]');
    // op2 está dentro de la factura F1 pero sin facturaClienteId: Facturación la muestra
    // como facturada y la consulta nueva la vería pendiente → se reporta.
    expect(paridad.some((f) => f[0] === 'op2' && f[2] === 'Facturación clientes (pendientes)')).toBe(true);
  });
});

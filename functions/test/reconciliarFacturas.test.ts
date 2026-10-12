// ✅ V00441 (Fase 5.9) — la reconciliación corre en SIMULACIÓN contra un Firestore falso
// y reporta, factura por factura, lo que cambiaría (punto de parada P3).
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type Datos = Record<string, unknown>;

const falso = vi.hoisted(() => {
  const colecciones = new Map<string, Map<string, Record<string, unknown>>>();
  interface Consulta { nombre: string; limite: number; despuesDe: string | null }
  const consulta = (c: Consulta) => ({
    orderBy: () => consulta(c),
    limit: (n: number) => consulta({ ...c, limite: n }),
    startAfter: (d: { id: string }) => consulta({ ...c, despuesDe: d.id }),
    get: async () => {
      const filas = Array.from(colecciones.get(c.nombre) ?? new Map<string, Record<string, unknown>>())
        .sort(([a], [b]) => a.localeCompare(b)).filter(([id]) => c.despuesDe === null || id > c.despuesDe).slice(0, c.limite)
        .map(([id, datos]) => ({ id, ref: { id, parent: { id: c.nombre } }, data: () => datos, updateTime: {} }));
      return { docs: filas, size: filas.length, empty: filas.length === 0 };
    },
  });
  return { colecciones, db: { collection: (nombre: string) => consulta({ nombre, limite: Infinity, despuesDe: null }) } };
});

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}), getApps: () => [] }));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' }, getFirestore: () => falso.db }));

const poner = (nombre: string, docs: Record<string, Datos>): void => { falso.colecciones.set(nombre, new Map(Object.entries(docs))); };
const leerCsv = (ruta: string): string[][] =>
  readFileSync(ruta, 'utf8').trim().split('\n').map((l) => l.slice(1, -1).split('","').map((c) => c.replace(/""/g, '"')));

describe('reconciliarFacturas (simulación)', () => {
  it('detecta total manual, diferencias de regla, pagado distinto del libro y saldo a favor', async () => {
    poner('facturas_clientes', {
      // Total editado a mano (1000) que no sale de sus renglones (900) y el negocio lo
      // confirmó en --manuales: se conserva como manual.
      F1: { invoice: 'A-1', clienteNombre: 'Acme', monedaFacturacion: 'USD', subtotalMonedaFactura: 1000, operacionesGuardadas: [{ id: 'o1', dol: 900, monto: 16200 }], montoPagado: 0 },
      // Moneda escrita 'M.N.': la regla anterior no la reconocía y sumaba subtotalBase.
      F2: { invoice: 'A-2', clienteNombre: 'Acme', monedaFacturacion: 'M.N.', operacionesGuardadas: [{ id: 'o2', monto: 1800, subtotalBase: 100 }], montoPagado: 100, saldoPendiente: 0, statusPago: 'PAGADA' },
      // Pagado de más (el total bajó): saldo a favor.
      F3: { invoice: 'A-3', clienteNombre: 'Acme', monedaFacturacion: 'USD', subtotalMonedaFactura: 500, montoPagado: 600, saldoPendiente: 0, statusPago: 'PAGADA' },
      // ✅ V00448: mismo caso que F1 pero SIN confirmar: solo se reporta (puede ser un total viejo).
      F4: { invoice: 'A-4', clienteNombre: 'Acme', monedaFacturacion: 'USD', subtotalMonedaFactura: 700, operacionesGuardadas: [{ id: 'o4', dol: 650, monto: 11700 }], montoPagado: 0 },
    });
    poner('facturas_proveedores', {});
    poner('pagos', {
      P1: { tipo: 'cliente', facturas: [{ facturaId: 'F2', aplicado: 150 }] },
      P2: { tipo: 'cliente', facturas: [{ facturaId: 'F3', aplicado: 600 }] },
    });

    const dir = mkdtempSync(join(tmpdir(), 'reconciliacion-'));
    process.env.REPORTES_MIGRACION = dir;
    const manuales = join(mkdtempSync(join(tmpdir(), 'manuales-')), 'manuales.txt');
    writeFileSync(manuales, 'F1\n');
    process.argv = [process.argv[0], 'reconciliarFacturas', '--manuales', manuales];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { corrida } = await import('../scripts/reconciliarFacturas');
    await corrida;
    expect(process.exitCode ?? 0).toBe(0);

    const [sub] = readdirSync(dir);
    const filas = leerCsv(join(dir, sub, 'diferencias.csv'));
    const dif = (fac: string, campo: string) => filas.find((f) => f[1] === fac && f[5] === campo);
    expect(dif('F1', 'totalManualCentavos')?.[7]).toBe('100000');
    expect(dif('F1', 'totalManualCentavos')?.[8]).toContain('confirmado');
    expect(dif('F4', 'totalManualCentavos')?.[7]).toBe('');
    expect(dif('F4', 'totalManualCentavos')?.[8]).toContain('REVISAR');
    expect(dif('F2', 'total')).toMatchObject({ 6: '100', 7: '1800' });
    expect(dif('F2', 'montoPagado')).toMatchObject({ 6: '100', 7: '150' });
    expect(dif('F2', 'saldoPendiente')?.[7]).toBe('1700');
    expect(dif('F2', 'statusPago')?.[7]).toBe('PARCIAL');
    expect(dif('F3', 'saldoAFavor')?.[7]).toBe('100');
    const resumen = JSON.parse(readFileSync(join(dir, sub, 'resumen.json'), 'utf8')) as { aplicado: boolean };
    expect(resumen.aplicado).toBe(false);
  });
});

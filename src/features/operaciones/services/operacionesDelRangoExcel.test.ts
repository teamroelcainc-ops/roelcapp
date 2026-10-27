// ✅ V00500 — Excel de operaciones: completo aunque la fecha esté guardada en otro formato.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = { consultasCanonicas: false };
const coleccion: Record<string, unknown>[] = [];
const llamadas: string[] = [];

vi.mock('../../../shared/data/flags', () => ({ obtenerFlags: async () => flags }));
vi.mock('../../../shared/data/coleccionesVivas', () => ({ idReal: (d: { id: string; _docId?: string }) => d._docId ?? d.id }));
vi.mock('../../../shared/data/consultas', () => ({
  contarOperaciones: async () => { llamadas.push('contar'); return coleccion.length; },
  recorrerOperaciones: async (alRecibir: (d: unknown[]) => void, alAvanzar?: (n: number) => void) => {
    llamadas.push('recorrer');
    for (let i = 0; i < coleccion.length; i += 2) { alRecibir(coleccion.slice(i, i + 2)); alAvanzar?.(Math.min(i + 2, coleccion.length)); }
    return coleccion.length;
  },
  todasLasOperacionesDelRango: async (campo: string, desde: string, hasta: string) => {
    llamadas.push(`rango:${campo}`);
    return coleccion.filter((o) => String(o.fechaServicioISO || '') >= desde && String(o.fechaServicioISO || '') <= hasta);
  },
}));

const { leerOperacionesDelRango } = await import('./operacionesDelRangoExcel');

beforeEach(() => { coleccion.length = 0; llamadas.length = 0; flags.consultasCanonicas = false; });

describe('leerOperacionesDelRango', () => {
  it('sin consultasCanonicas revisa todas: ISO, d/m/aaaa (AppSheet) y Timestamp; deja fuera las del otro rango y las de prueba', async () => {
    coleccion.push(
      { id: 'a', ref: 'TR-1', fechaServicio: '2026-10-26' },
      { id: 'b', ref: 'TR-2', fechaServicio: '15/03/2026' },
      { id: 'c', ref: 'TR-3', fechaServicio: { seconds: Date.UTC(2026, 0, 5, 12) / 1000, nanoseconds: 0 } },
      { id: 'd', ref: 'TR-4', fechaServicio: '20/12/2025' },
      { id: 'e', ref: 'PR.TR-5', fechaServicio: '2026-05-01' },
      { id: 'f', ref: 'TR-6', fechaServicio: '01/06/2026', fechaServicioISO: '2026-06-01' },
      { id: 'g', ref: 'TR-7' },
    );
    const avance: unknown[] = [];
    const r = await leerOperacionesDelRango('2026-01-01', '2026-10-27', (a) => avance.push(a));
    expect(r.map((o) => [o.id, o._fechaISO])).toEqual([['a', '2026-10-26'], ['f', '2026-06-01'], ['b', '2026-03-15'], ['c', '2026-01-05']]);
    expect(llamadas).toEqual(['contar', 'recorrer']);
    expect(avance[avance.length - 1]).toEqual({ leidas: 7, total: 7, enRango: 5 });
  });

  it('con consultasCanonicas (después de la migración) pide solo el rango por fechaServicioISO', async () => {
    flags.consultasCanonicas = true;
    coleccion.push({ id: 'a', ref: 'TR-1', fechaServicioISO: '2026-02-01' }, { id: 'b', ref: 'TR-2', fechaServicioISO: '2025-02-01' });
    const r = await leerOperacionesDelRango('2026-01-01', '2026-10-27');
    expect(r.map((o) => o.id)).toEqual(['a']);
    expect(llamadas).toEqual(['rango:fechaServicioISO']);
  });
});

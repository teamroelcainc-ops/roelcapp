// ✅ V00456 — reglas del Resumen del día (tarjetas de Operaciones Activas).
import { describe, expect, it } from 'vitest';
import { STATUS_CANCELADO, STATUS_COMPLETADOS } from '../../../shared/dominio/constantes';
import { contarDelDia, esCompletadaDelDia, extraerTipoCambio, filasDiesel, filasTipoCambio, mejorFechaRegistro, normalizarFechaResumen } from './resumenDia';

describe('resumen del día', () => {
  it('normaliza fechas guardadas en distintos formatos', () => {
    expect(normalizarFechaResumen('2026-10-16')).toBe('2026-10-16');
    expect(normalizarFechaResumen('2026-10-16T09:00:00Z')).toBe('2026-10-16');
    expect(normalizarFechaResumen('6/10/2026')).toBe('2026-10-06');
    expect(normalizarFechaResumen({ toDate: () => new Date(2026, 9, 1) })).toBe('2026-10-01');
    expect(normalizarFechaResumen('sin fecha')).toBe('');
    expect(mejorFechaRegistro({ a: '1/1/2025', b: '2026-10-15', c: 3 })).toBe('2026-10-15');
  });

  it('lee el tipo de cambio de los distintos campos', () => {
    expect(extraerTipoCambio({ fecha: '2026-10-16', tcDof: 18.4888 })).toBe(18.4888);
    expect(extraerTipoCambio({ valor: '$17.90' })).toBe(17.9);
    expect(extraerTipoCambio({ otro: 'x', numero: '19.1' })).toBe(19.1);
    expect(extraerTipoCambio({ nada: 'x' })).toBeNull();
  });

  it('cuenta completadas (por id o por nombre), canceladas y en proceso, con desglose por tipo', () => {
    const ops = [
      { status: STATUS_COMPLETADOS[0], tipoOperacionNombre: 'Transfer' },
      { status: 'x', statusNombre: 'Servicio Completado', tipoOperacionNombre: 'Logística Cruces' },
      { status: 'x', statusNombre: '3. Documentado', tipoOperacionNombre: 'Logística Fletes' },
      { status: STATUS_CANCELADO, statusNombre: 'Cancelado', tipoOperacionNombre: 'Renta' },
      { status: 'x', statusNombre: 'Completado', tipoOperacionNombre: 'Logística Fletes' },
    ];
    expect(contarDelDia(ops)).toEqual({ totalHoy: 5, completadasHoy: 3, canceladasHoy: 1, completadasPorTipo: { cruces: 1, transfer: 1, fletes: 1, renta: 0, otros: 0 } });
    expect(ops.filter(esCompletadaDelDia).length).toBe(3);
    expect(esCompletadaDelDia({ status: STATUS_CANCELADO, statusNombre: 'Completado' })).toBe(false);
  });

  it('tipos de cambio: del más reciente, con la variación contra el anterior', () => {
    const f = filasTipoCambio([
      { id: 'a', fecha: '2026-10-14', tcDof: 18.5 },
      { id: 'b', fecha: '2026-10-16', tcDof: 18.4888 },
      { id: 'c', fecha: '2026-10-15', tcDof: 18.4888 },
      { id: 'd', fecha: '2026-10-13', sinValor: 'x' },
    ]);
    expect(f.map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(f.map((x) => x.variacion)).toEqual([0, -0.0112, null]);
  });

  it('diesel: del más reciente y marca el más bajo de cada día', () => {
    const f = filasDiesel([
      { id: 'a', fecha: '2026-10-16', proveedor: 'Murphy', costo: 5.62, createdAt: '2026-10-16T08:00:00Z' },
      { id: 'b', fecha: '2026-10-16', proveedor: 'Pilot', costo: 5.8, createdAt: '2026-10-16T09:00:00Z' },
      { id: 'c', fecha: '2026-10-15', proveedor: 'Murphy', costo: 5.7, createdAt: '2026-10-15T08:00:00Z' },
      { id: 'd', fecha: '2026-10-15', proveedor: 'Malo', costo: 0 },
    ]);
    expect(f.map((x) => [x.id, x.masBajoDelDia])).toEqual([['b', false], ['a', true], ['c', true]]);
  });

  // ✅ V00460
  it('diesel: Murphy descuenta $0.20 por galón y el más bajo es por costo real', () => {
    const f = filasDiesel([
      { id: 'm', fecha: '2026-10-16', proveedor: 'Murphy International', costo: 5.59, createdAt: '2026-10-16T08:00:00Z' },
      { id: 'n', fecha: '2026-10-16', proveedor: 'La Noria', costo: 5.5, createdAt: '2026-10-16T09:00:00Z' },
      { id: 'v', fecha: '2026-10-01', proveedor: 'MURPHY INTERNATIONAL', costo: 5.7 },
    ]);
    expect(f.map((x) => [x.id, x.descuento, x.costoReal, x.masBajoDelDia])).toEqual([
      ['n', 0, 5.5, false], ['m', 0.2, 5.39, true], ['v', 0.2, 5.5, true],
    ]);
  });
});

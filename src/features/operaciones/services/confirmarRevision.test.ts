// ✅ V00518 — Confirmar como correctas (✓) en la Revisión de datos: D6 (canceladas con monto).
import { describe, expect, it } from 'vitest';
import { STATUS_CANCELADO, STATUS_COMPLETADOS } from '../../../shared/dominio/constantes';
import { filasPruebaConfirmar, marcaConfirmacion, motivoAlConfirmar, respaldoConfirmar } from './confirmarRevision';
import { confirmacionDe, detalleD6, revisarDatos } from './revisionDatos';
import type { OpRevision } from './revisionDatos';

const cancelada = (idDoc: string, ref: string, extra: Record<string, unknown> = {}): OpRevision => ({
  idDoc, id: idDoc, ref, fechaServicio: '2026-10-26', status: STATUS_CANCELADO, statusNombre: '19. Cancelado', clientePaga: 'e1', clienteNombre: 'Landstar',
  montoConvenioCliente: 120, dolaresCliente: 120, conversionCliente: 2240.04, ...extra,
});
const revisar = (ops: OpRevision[]) => revisarDatos({ operaciones: ops, facturas: [], monedaEmpresa: new Map([['e1', 'USD']]), reglaUnica: true });
const DETALLE = 'Cancelada con Convenio $120.00, Dólares $120.00, Conversión $2,240.04';

describe('D6 con confirmación', () => {
  it('la confirmada con el mismo detalle no se muestra y se cuenta aparte', () => {
    const r = revisar([
      cancelada('a', 'LO-1', { revisionOk: { D6: { en: 'T', por: 'yo', detalle: DETALLE } } }),
      cancelada('b', 'LO-2'),
    ]);
    expect(r.filas.filter((f) => f.codigo === 'D6').map((f) => f.ref)).toEqual(['LO-2']);
    expect(r.confirmadas).toEqual({ D6: 1 });
  });
  it('si su monto cambió después de confirmarla, vuelve a aparecer', () => {
    const r = revisar([cancelada('a', 'LO-1', { montoConvenioCliente: 150, revisionOk: { D6: { en: 'T', por: 'yo', detalle: DETALLE } } })]);
    expect(r.filas.filter((f) => f.codigo === 'D6').map((f) => f.ref)).toEqual(['LO-1']);
    expect(r.confirmadas).toEqual({});
  });
  it('lee la confirmación guardada y el detalle de D6', () => {
    expect(confirmacionDe({ revisionOk: { D6: { en: 'T', por: 'yo', detalle: 'x' } } }, 'D6')).toEqual({ en: 'T', por: 'yo', detalle: 'x' });
    expect(confirmacionDe({ revisionOk: 'basura' }, 'D6')).toBeNull();
    expect(detalleD6(cancelada('a', 'LO-1'))).toBe(DETALLE);
    expect(detalleD6(cancelada('a', 'LO-1', { status: STATUS_COMPLETADOS[0], statusNombre: '14. Servicio Completado' }))).toBe('');
  });
});

describe('escribir la confirmación', () => {
  const fila = revisar([cancelada('a', 'LO-1')]).filas.find((f) => f.codigo === 'D6')!;
  it('al escribir: no confirma la que ya no es cancelada, cambió de monto o ya no existe', () => {
    expect(motivoAlConfirmar('D6', cancelada('a', 'LO-1'), fila)).toBe('');
    expect(motivoAlConfirmar('D6', null, fila)).toBe('La operación ya no existe');
    expect(motivoAlConfirmar('D6', cancelada('a', 'LO-1', { status: STATUS_COMPLETADOS[0], statusNombre: '14. Servicio Completado' }), fila)).toBe('Ya no es de este grupo (cambió desde la revisión)');
    expect(motivoAlConfirmar('D6', cancelada('a', 'LO-1', { montoConvenioCliente: 90 }), fila)).toBe('Sus montos cambiaron desde la revisión: revisarla otra vez');
  });
  it('la marca, la prueba y el respaldo', () => {
    expect(marcaConfirmacion(fila, 'T', 'yo@roelca')).toEqual({ en: 'T', por: 'yo@roelca', detalle: DETALLE });
    expect(filasPruebaConfirmar([fila])[0]).toMatchObject({ Referencia: 'LO-1', Detalle: DETALLE });
    expect((respaldoConfirmar('D6', [fila], 'T', 'yo') as { operaciones: { id: string }[] }).operaciones.map((o) => o.id)).toEqual(['a']);
  });
});

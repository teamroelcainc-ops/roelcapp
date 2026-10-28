// ✅ V00510 — Marcar facturadas (F1): plan, prueba, respaldo y la revisión al escribir.
import { describe, expect, it } from 'vitest';
import { STATUS_CANCELADO, STATUS_COMPLETADOS } from '../../../shared/dominio/constantes';
import {
  camposMarca, facturaListaOperacion, filasPruebaF1, MOTIVO_CANCELADA, MOTIVO_VARIAS, motivoAlMarcar, planMarcarF1, respaldoF1,
} from './marcarFacturadasF1';
import type { MarcaF1 } from './revisionDatos';
import { revisarDatos } from './revisionDatos';

const marca = (ref: string, extra: Partial<MarcaF1> = {}): MarcaF1 => ({
  opId: `id-${ref}`, opAppId: '', ref, cliente: 'Landstar', status: '14. Servicio Completado', grupo: 'completada',
  facturaId: 'F-38314', invoice: '38314', statusFactura: 'Facturado', fechaFactura: '2026-07-09', facturas: 1, ...extra,
});

describe('planMarcarF1', () => {
  const plan = planMarcarF1([
    marca('LO-1'), marca('TR-2', { grupo: 'falso', status: '7. Falso' }), marca('TR-3', { grupo: 'cancelada' }),
    marca('TR-4', { facturas: 2 }), marca('TR-5', { invoice: 'N/A', statusFactura: 'No Aplica' }),
  ]);
  it('se marcan completadas, en Falso y las de facturas N/A / No Aplica; no las canceladas ni las de dos facturas', () => {
    expect(plan.marcar.map((m) => m.ref)).toEqual(['LO-1', 'TR-2', 'TR-5']);
    expect(plan.omitidas.map((o) => [o.marca.ref, o.motivo])).toEqual([['TR-3', MOTIVO_CANCELADA], ['TR-4', MOTIVO_VARIAS]]);
  });
  it('escribe lo mismo que Facturación, más la marca de la revisión', () => {
    expect(camposMarca(marca('LO-1'), '2026-10-28T20:00:00Z')).toEqual({
      facturaClienteId: 'F-38314', facturaClienteInvoice: '38314', facturado: true, facturadoPorRevision: '2026-10-28T20:00:00Z',
    });
  });
  it('Excel de prueba y respaldo', () => {
    const filas = filasPruebaF1(plan);
    expect(filas).toHaveLength(5);
    expect(filas[0]).toMatchObject({ 'Acción': 'Se marca', Referencia: 'LO-1', Factura: '38314', 'Se escribe': 'facturado: sí · Invoice: 38314' });
    expect(filas[4]).toMatchObject({ 'Acción': 'No se marca', Referencia: 'TR-4', Motivo: MOTIVO_VARIAS });
    const r = respaldoF1(plan, '2026-10-28T20:00:00Z', 'yo@roelca.com') as { operaciones: { id: string; antes: unknown }[] };
    expect(r.operaciones.map((o) => o.id)).toEqual(['id-LO-1', 'id-TR-2', 'id-TR-5']);
    expect(r.operaciones[0].antes).toEqual({ facturaClienteId: null, facturaClienteInvoice: null, facturado: false });
  });
});

describe('al escribir', () => {
  const m = marca('LO-080726-002', { opAppId: 'app1' });
  const op = { status: STATUS_COMPLETADOS[0], statusNombre: '14. Servicio Completado' };
  const fac = { statusFactura: 'Facturado', operaciones: ['LO-080726-002'] };
  it('la factura la lista por id, id de AppSheet o referencia', () => {
    expect(facturaListaOperacion({ operacionesIds: ['id-LO-080726-002'] }, m)).toBe(true);
    expect(facturaListaOperacion({ operacionesIds: ['app1'] }, m)).toBe(true);
    expect(facturaListaOperacion({ operaciones: ['lo-080726-002'] }, m)).toBe(true);
    expect(facturaListaOperacion({ operacionesGuardadas: [{ ref: 'LO-080726-002' }] }, m)).toBe(true);
    expect(facturaListaOperacion({ operaciones: ['OTRA'] }, m)).toBe(false);
  });
  it('no se toca si cambió algo desde la revisión', () => {
    expect(motivoAlMarcar(op, fac, m)).toBe('');
    expect(motivoAlMarcar({ statusFactura: 'No Aplica', ...op }, { ...fac, statusFactura: 'No Aplica' }, m)).toBe(''); // N/A es activa
    expect(motivoAlMarcar(null, fac, m)).toBe('La operación ya no existe');
    expect(motivoAlMarcar({ ...op, facturado: true }, fac, m)).toBe('Ya tiene factura o marca (se marcó mientras tanto)');
    expect(motivoAlMarcar({ status: STATUS_CANCELADO }, fac, m)).toBe(MOTIVO_CANCELADA);
    expect(motivoAlMarcar(op, null, m)).toBe('Su factura ya no existe');
    expect(motivoAlMarcar(op, { ...fac, statusFactura: 'Cancelado' }, m)).toBe('Su factura se canceló');
    expect(motivoAlMarcar(op, { statusFactura: 'Facturado', operaciones: ['OTRA'] }, m)).toBe('Su factura ya no la lista');
  });
});

describe('revisarDatos → marcasF1', () => {
  it('cada F1 con el id real de su factura, su folio y su status', () => {
    const r = revisarDatos({
      operaciones: [{ idDoc: 'o1', id: 'o1', ref: 'TR-1', status: STATUS_COMPLETADOS[0], statusNombre: '14. Servicio Completado' }],
      facturas: [{ id: 'app-f1', idDoc: 'docF1', invoice: 'N/A', statusFactura: 'No Aplica', fecha: '2026-07-09', operaciones: ['TR-1'], operacionesIds: [], operacionesGuardadas: [] }],
      monedaEmpresa: new Map(), reglaUnica: true,
    });
    expect(r.marcasF1).toEqual([expect.objectContaining({ opId: 'o1', ref: 'TR-1', facturaId: 'docF1', invoice: 'N/A', statusFactura: 'No Aplica', facturas: 1, grupo: 'completada' })]);
  });
});

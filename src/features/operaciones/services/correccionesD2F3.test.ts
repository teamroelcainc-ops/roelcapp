// ✅ V00539 — D2 (renumerar) y F3 (ligar o liberar): qué se escribe y cuándo ya no.
import { describe, expect, it } from 'vitest';
import {
  camposLiberarF3, camposLigarF3, camposRenumerar, consecutivoDeRef, facturaListaOperacionF3, filasPruebaD2, filasPruebaF3,
  motivoAlCorregirF3, motivoAlRenumerar, respaldoF3,
} from './correccionesD2F3';
import type { PlanD2, PlanF3 } from './revisionDatos';

const d2: PlanD2 = { opId: 'b', ref: 'TR-270426-022', cliente: 'C', fecha: '2026-04-27', seQueda: 'TR-270426-022 (…)', prefijo: 'TR', ddmmyy: '270426', motivo: '' };
const f3 = (accion: PlanF3['accion']): PlanF3 => ({ opId: 'o1', ref: 'TR-1', cliente: 'C', invoice: 'I-1', accion, facturaId: 'F1', folio: 'I1', motivo: '', facturaIdAntes: '', facturadoAntes: false });

describe('D2: renumerar', () => {
  it('referencia nueva en su línea, en los campos que la muestran, con la anterior', () => {
    expect(consecutivoDeRef('TR-270426-022')).toBe(22);
    expect(consecutivoDeRef('X')).toBe(0);
    expect(camposRenumerar({ ref: 'TR-270426-022', numReferencia: 'TR-270426-022' }, d2, 31, 'AHORA')).toEqual({
      ref: 'TR-270426-031', numReferencia: 'TR-270426-031', refPrefijo: 'TR-270426', refConsecutivo: 31, refAnterior: 'TR-270426-022', refRenumeradaPorRevision: 'AHORA',
    });
  });
  it('no se renumera si ya no existe, cambió su referencia o se facturó', () => {
    expect(motivoAlRenumerar(null, d2)).toMatch(/ya no existe/);
    expect(motivoAlRenumerar({ ref: 'TR-270426-040' }, d2)).toMatch(/cambió/);
    expect(motivoAlRenumerar({ ref: 'TR-270426-022', facturaClienteId: 'F' }, d2)).toMatch(/Se facturó/);
    expect(motivoAlRenumerar({ ref: 'tr-270426-022' }, d2)).toBe('');
    expect(filasPruebaD2([d2, { ...d2, opId: 'c', motivo: 'a mano' }]).map((f) => f['Acción'])).toEqual(['Se renumera', 'No se toca (a mano)']);
  });
});

describe('F3: ligar o liberar', () => {
  it('campos de ligar y liberar', () => {
    expect(camposLigarF3(f3('ligar'), 'AHORA')).toEqual({ facturaClienteId: 'F1', facturaClienteInvoice: 'I1', facturado: true, invoiceCorregidoPorRevision: 'AHORA' });
    expect(camposLiberarF3('AHORA')).toEqual({ facturaClienteId: null, facturaClienteInvoice: '', facturado: false, invoiceCorregidoPorRevision: 'AHORA' });
  });
  it('al aplicar: su Invoice no cambió y, para ligar, la factura todavía la lista', () => {
    const op = { facturaClienteInvoice: 'I-1' };
    expect(facturaListaOperacionF3({ operacionesGuardadas: [{ id: 'o1' }] }, 'o1', op)).toBe(true);
    expect(motivoAlCorregirF3(op, { operacionesIds: ['o1'] }, f3('ligar'))).toBe('');
    expect(motivoAlCorregirF3(op, { operacionesIds: [] }, f3('ligar'))).toMatch(/ya no la lista/);
    expect(motivoAlCorregirF3({ facturaClienteInvoice: 'OTRO' }, null, f3('liberar'))).toMatch(/cambió/);
    expect(motivoAlCorregirF3(op, null, f3('liberar'))).toBe('');
    expect(filasPruebaF3([f3('ligar'), f3('liberar')]).map((f) => f['Invoice nuevo'])).toEqual(['I1', '(ninguno)']);
    expect(respaldoF3([f3('ligar'), f3('manual')], 'h', 'u').operaciones).toHaveLength(1);
  });
});

// ✅ V00502 — grupos de factura (antes copiados en los dos Historiales): misma unión de siempre.
import { describe, expect, it } from 'vitest';
import { agruparFacturas, claveGrupoFactura, estadoPagoFila, filaPagada, grupoDeFactura } from './gruposFactura';

const a = { id: 'F1', invoice: 'INV-7', clienteId: 'e1', fecha: '2026-10-01', createdAt: '2026-10-02', subtotalFactura: 100, statusFactura: 'Facturado', operacionesIds: ['o1'], operacionesGuardadas: [{ id: 'o1', ref: 'TR-1' }], remolques: ['R1'] };
const b = { id: 'F2', invoice: 'inv-7 ', clienteId: 'e1', fecha: '2026-10-05', createdAt: '2026-10-01', subtotalFactura: 50, statusFactura: 'Cancelado', operacionesIds: ['o2', 'o1'], operacionesGuardadas: [{ id: 'o2', ref: 'TR-2' }], remolques: ['R2', 'R1'] };
const c = { id: 'F3', invoice: 'INV-7', clienteId: 'e2', subtotalFactura: 10 };

describe('agruparFacturas', () => {
  it('une por invoice (sin mayúsculas ni espacios) + empresa: ids, operaciones, remolques, subtotal, fecha, alta y status', () => {
    const [g, otro] = agruparFacturas([a, b, c], 'clienteId') as Record<string, unknown>[];
    expect(g).toMatchObject({
      id: 'F1', __groupIds: ['F1', 'F2'], operacionesIds: ['o1', 'o2'], remolques: ['R1', 'R2'], subtotalFactura: 150,
      fecha: '2026-10-05', createdAt: '2026-10-01', statusFactura: 'Cancelado',
    });
    expect((g.operacionesGuardadas as { id: string }[]).map((o) => o.id)).toEqual(['o1', 'o2']);
    expect((g.__groupDocs as unknown[]).length).toBe(2);
    expect(otro).toMatchObject({ id: 'F3', __groupIds: ['F3'] });
    expect(claveGrupoFactura(b, 'clienteId')).toBe('inv-7__e1');
  });
  it('grupoDeFactura: la fila completa del grupo de ese id (también si se pide por el segundo documento)', () => {
    expect(grupoDeFactura([a, b, c], 'F2', 'clienteId')).toMatchObject({ id: 'F1', __groupIds: ['F1', 'F2'] });
    expect(grupoDeFactura([a, b, c], 'F3', 'clienteId')).toMatchObject({ __groupIds: ['F3'] });
    expect(grupoDeFactura([a], 'X', 'clienteId')).toBeNull();
    expect(grupoDeFactura([{ id: 'P1', invoice: 'A', proveedorId: 'p' }, { id: 'P2', invoice: 'A', proveedorId: 'p' }], 'P1', 'proveedorId')).toMatchObject({ __groupIds: ['P1', 'P2'] });
  });
});

describe('estado de pago de la fila (✅ V00504)', () => {
  it('Pagada si todos sus documentos lo están; Parcial con algún pago; si no, Sin pagar', () => {
    const pagada = { id: 'P1', statusPago: 'PAGADA' };
    const porMonto = { id: 'P2', montoPagado: 100, saldoPendiente: 0 };
    const parcial = { id: 'P3', montoPagado: 40, saldoPendiente: 60, statusPago: 'PARCIAL' };
    const sinPago = { id: 'P4' };
    expect([pagada, porMonto, parcial, sinPago].map(estadoPagoFila)).toEqual(['Pagada', 'Pagada', 'Parcial', 'Sin pagar']);
    // Una fila de dos documentos: pagada solo si los dos lo están.
    const [g] = agruparFacturas([{ ...pagada, invoice: 'X', clienteId: 'e1' }, { ...sinPago, invoice: 'X', clienteId: 'e1' }], 'clienteId');
    expect(filaPagada(g)).toBe(false);
    expect(estadoPagoFila(g)).toBe('Sin pagar');
    const [g2] = agruparFacturas([{ ...pagada, invoice: 'Y', clienteId: 'e1' }, { ...porMonto, invoice: 'Y', clienteId: 'e1' }], 'clienteId');
    expect(estadoPagoFila(g2)).toBe('Pagada');
    const [g3] = agruparFacturas([{ ...parcial, invoice: 'Z', clienteId: 'e1' }, { ...sinPago, invoice: 'Z', clienteId: 'e1' }], 'clienteId');
    expect(estadoPagoFila(g3)).toBe('Parcial');
  });
});

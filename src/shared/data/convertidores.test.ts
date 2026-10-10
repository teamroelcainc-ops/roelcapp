// ✅ V00439 — normalización al leer.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ collection: () => ({ withConverter: (c: unknown) => c }) }));
const { normalizarDocumento } = await import('./convertidores');

describe('normalizarDocumento', () => {
  it('operaciones: números de texto y fechaServicioISO derivada sin borrar el original', () => {
    const op = normalizarDocumento('operaciones', { fechaServicio: '9/12/2025', montoConvenioCliente: '1,250.50', status: 's1' }, 'op1');
    expect(op.id).toBe('op1');
    expect(op.fechaServicio).toBe('9/12/2025');
    expect(op.fechaServicioISO).toBe('2025-12-09');
    expect(op.montoConvenioCliente).toBe(1250.5);
  });
  it('no pisa un fechaServicioISO ya guardado', () => {
    const op = normalizarDocumento('operaciones', { fechaServicio: 'basura', fechaServicioISO: '2026-01-02' }, 'x');
    expect(op.fechaServicioISO).toBe('2026-01-02');
  });
  it('genérico: números de texto', () => {
    const f = normalizarDocumento('facturas_clientes', { montoPagado: '10', invoice: 'A-1' }, 'f1');
    expect(f.montoPagado).toBe(10);
    expect(f.invoice).toBe('A-1');
  });
});

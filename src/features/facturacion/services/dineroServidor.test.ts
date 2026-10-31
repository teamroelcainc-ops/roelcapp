// @vitest-environment jsdom
// ✅ V00536 — Respuestas del servidor de dinero: se aplican por el id del documento y avisan al bus.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/data/callables', () => ({
  ErrorCallable: class extends Error {},
  llamarCallable: vi.fn(async () => ({ ok: true, facturas: {}, operaciones: { DOC1: { facturaClienteId: 'F1' }, DOC2: { facturado: false } } })),
}));

import { aplicarOperaciones, llamarDinero } from './dineroServidor';
import { suscribirOperacionGuardada } from '../../../utils/operacionesBus';
import type { OperacionGuardadaDetalle } from '../../../utils/operacionesBus';

describe('dineroServidor', () => {
  it('aplicarOperaciones busca la fila por su _docId (el `id` de las importadas es otro)', () => {
    const lista = [{ id: 'IMP-1', _docId: 'DOC1' }, { id: 'DOC2' }, { id: 'X', _docId: 'Y' }];
    const r = aplicarOperaciones(lista, { DOC1: { facturaClienteId: 'F1' }, DOC2: { facturado: false } });
    expect(r).toEqual([{ id: 'IMP-1', _docId: 'DOC1', facturaClienteId: 'F1' }, { id: 'DOC2', facturado: false }, { id: 'X', _docId: 'Y' }]);
    expect(aplicarOperaciones(lista, {})).toBe(lista);
  });
  it('llamarDinero avisa al bus cada operación que tocó el servidor', async () => {
    const avisos: OperacionGuardadaDetalle[] = [];
    const baja = suscribirOperacionGuardada((d) => avisos.push(d));
    const r = await llamarDinero('quitarOperacionFactura', { lado: 'cliente', operacionId: 'DOC1' });
    baja();
    expect(r.ok).toBe(true);
    expect(avisos.map((a) => [a.id, a.origen, a.campos])).toEqual([
      ['DOC1', 'dinero:quitarOperacionFactura', ['facturaClienteId']], ['DOC2', 'dinero:quitarOperacionFactura', ['facturado']],
    ]);
  });
});

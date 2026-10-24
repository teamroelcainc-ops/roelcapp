// ✅ V00483 — pagos de cada factura para la ficha.
import { describe, expect, it } from 'vitest';
import { indexarPagos, numerosPorFactura, pagosDeFacturas } from './pagosDeFactura';

const pagos = [
  { id: 'p1', numeroPago: 'PAG-1', fecha: '2026-10-01', metodoPago: 'Transferencia', referencia: 'SPEI 1', monto: 500, moneda: 'USD', facturas: [{ facturaId: 'f1', aplicado: 300 }, { facturaId: 'f2', aplicado: 200 }] },
  { id: 'p2', numeroPago: 'PAG-2', fecha: '15/10/2026', monto: 100, moneda: 'USD', facturas: [{ facturaId: 'f1', aplicado: 60 }, { facturaId: 'f1', aplicado: 40 }] },
  { id: 'p3', numeroPago: '', fecha: '2026-09-20', monto: 50, facturas: [{ facturaId: 'f3', aplicado: 50 }, null, { aplicado: 5 }] },
];

describe('pagos de una factura', () => {
  const mapa = indexarPagos(pagos);
  it('junta lo aplicado por factura (dos renglones del mismo pago se suman)', () => {
    expect(mapa.get('f1')?.map((p) => [p.id, p.aplicado])).toEqual([['p1', 300], ['p2', 100]]);
    expect(mapa.get('f2')?.map((p) => [p.numeroPago, p.monto, p.aplicado])).toEqual([['PAG-1', 500, 200]]);
    expect(mapa.get('f3')?.[0].numeroPago).toBe('p3'); // sin número: el id
  });
  it('una fila con varios documentos: un pago una vez, del más reciente al más viejo', () => {
    expect(pagosDeFacturas(mapa, ['f1', 'f2']).map((p) => [p.numeroPago, p.aplicado])).toEqual([['PAG-2', 100], ['PAG-1', 500]]);
    expect(pagosDeFacturas(mapa, ['nada'])).toEqual([]);
  });
  it('números de pago por factura (columna # Pago)', () => {
    expect(numerosPorFactura(mapa)).toEqual({ f1: ['PAG-1', 'PAG-2'], f2: ['PAG-1'], f3: ['p3'] });
  });
});

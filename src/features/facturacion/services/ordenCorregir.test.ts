// ✅ V00530 — Orden de la tabla de Corregir: ascendente → descendente → como estaba.
import { describe, expect, it } from 'vitest';
import { ordenarFilasCorregir, siguienteOrden } from './ordenCorregir';
import type { FilaOrdenable } from './ordenCorregir';

const fila = (invoice: string, fecha: string, cliente: string, diferencia: number, ref = ''): FilaOrdenable => ({
  invoice, fecha, cliente, moneda: 'Dólares', refs: ref ? [{ ref }] : [], cuadre: { suma: 0, total: 0, diferencia, motivo: 'diferencia' },
});
const filas = [fila('I8650', '2026-10-26', 'C.H. Robinson', -50, 'TR-231026-030'), fila('A5510', '2026-10-26', 'C.H. Robinson', 271.4, 'TR-190126-4'), fila('38339', '2026-10-25', 'Landstar', -10), fila('I8657', '2026-10-26', 'Temm Truck', 8228.22, 'LO-231026-005')];
const motivo = () => '';
const invoices = (xs: FilaOrdenable[]) => xs.map((x) => x.invoice);

describe('ordenCorregir', () => {
  it('un clic ascendente, otro descendente, otro como estaba; otra columna empieza ascendente', () => {
    const a = siguienteOrden(null, 'total');
    expect(a).toEqual({ col: 'total', dir: 'asc' });
    const b = siguienteOrden(a, 'total');
    expect(b).toEqual({ col: 'total', dir: 'desc' });
    expect(siguienteOrden(b, 'total')).toBeNull();
    expect(siguienteOrden(b, 'cliente')).toEqual({ col: 'cliente', dir: 'asc' });
  });
  it('ordena números como números y textos con números de forma natural', () => {
    expect(invoices(ordenarFilasCorregir(filas, { col: 'diferencia', dir: 'asc' }, motivo))).toEqual(['I8650', '38339', 'A5510', 'I8657']);
    expect(invoices(ordenarFilasCorregir(filas, { col: 'diferencia', dir: 'desc' }, motivo))).toEqual(['I8657', 'A5510', '38339', 'I8650']);
    expect(invoices(ordenarFilasCorregir(filas, { col: 'invoice', dir: 'asc' }, motivo))).toEqual(['38339', 'A5510', 'I8650', 'I8657']);
  });
  it('sin orden queda como llegó; empates conservan el orden; vacíos al final', () => {
    expect(invoices(ordenarFilasCorregir(filas, null, motivo))).toEqual(['I8650', 'A5510', '38339', 'I8657']);
    expect(invoices(ordenarFilasCorregir(filas, { col: 'cliente', dir: 'asc' }, motivo))).toEqual(['I8650', 'A5510', '38339', 'I8657']);
    expect(invoices(ordenarFilasCorregir(filas, { col: 'referencias', dir: 'desc' }, motivo))).toEqual(['TR-231026-030', 'TR-190126-4', 'LO-231026-005', ''].map((r) => filas.find((f) => (f.refs[0]?.ref ?? '') === r)!.invoice));
  });
});

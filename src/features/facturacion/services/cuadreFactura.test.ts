// ✅ V00522 — La suma de las operaciones de la factura contra su total.
import { describe, expect, it } from 'vitest';
import { cuadreDeFactura, facturasQueNoCuadran, sumaConHoy } from './cuadreFactura';

const renglones = [{ id: 'a', dol: 200, monto: 3700, subtotalBase: 200 }, { id: 'b', dol: 70, monto: 1295, subtotalBase: 70 }];

describe('cuadreDeFactura', () => {
  it('cuadra: el importe de cada referencia en la moneda de la factura suma el total', () => {
    expect(cuadreDeFactura(renglones, 'USD', 270)).toEqual({ importes: [200, 70], suma: 270, total: 270, diferencia: 0, motivo: 'cuadra' });
    expect(cuadreDeFactura(renglones, 'MXN', 4995).motivo).toBe('cuadra');
  });
  it('no cuadra: diferencia, el IVA (16%), sin montos por operación o sin operaciones', () => {
    expect(cuadreDeFactura(renglones, 'USD', 275)).toMatchObject({ suma: 270, diferencia: 5, motivo: 'diferencia' });
    // A5510: el total trae el IVA y sus operaciones el subtotal (415.00 × 1.16 = 481.40)
    expect(cuadreDeFactura([{ dol: 207.5 }, { dol: 207.5 }], 'USD', 481.4)).toMatchObject({ suma: 415, diferencia: 66.4, motivo: 'iva' });
    expect(cuadreDeFactura([{ id: 'a', monto: 0, subtotalBase: 0 }], 'USD', 232).motivo).toBe('sinMontos');
    expect(cuadreDeFactura([], 'USD', 100).motivo).toBe('sinOperaciones');
    expect(cuadreDeFactura([], 'USD', 0).motivo).toBe('cuadra');
  });
  it('la suma va en centavos (sin errores de punto flotante)', () => {
    expect(cuadreDeFactura([{ dol: 0.1 }, { dol: 0.2 }], 'USD', 0.3).motivo).toBe('cuadra');
  });
});

describe('facturasQueNoCuadran', () => {
  it('solo las que no cuadran, sin las canceladas, las más nuevas primero', () => {
    const filas = [
      { invoice: 'A', status: 'Facturado', fecha: '2026-10-01', total: 270 },
      { invoice: 'B', status: 'Facturado', fecha: '2026-10-05', total: 300 },
      { invoice: 'C', status: 'Cancelado', fecha: '2026-10-06', total: 999 },
      { invoice: 'D', status: 'Pagada', fecha: '2026-10-09', total: 1 },
    ];
    const r = facturasQueNoCuadran(filas, (f) => ({ renglones, moneda: 'USD', total: f.total, status: f.status, fecha: f.fecha }));
    expect(r.map((x) => [x.fila.invoice, x.cuadre.diferencia])).toEqual([['D', -269], ['B', 30]]);
  });
});

describe('sumaConHoy', () => {
  it('suma lo que cobra hoy cada operación y dice si así cuadra; si falta una, null', () => {
    expect(sumaConHoy([140], 140)).toEqual({ suma: 140, cuadra: true });
    expect(sumaConHoy([100, 50.5], 140)).toEqual({ suma: 150.5, cuadra: false });
    expect(sumaConHoy([100, undefined], 140)).toBeNull();
    expect(sumaConHoy([100, null], 140)).toBeNull();
    expect(sumaConHoy([], 140)).toBeNull();
  });
});

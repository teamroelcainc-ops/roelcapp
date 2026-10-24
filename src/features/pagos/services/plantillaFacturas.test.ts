// ✅ V00484 — plantilla de facturas a pagar: leer el Excel y marcar las Transacciones pendientes.
import { describe, expect, it } from 'vitest';
import { claveFactura, cruzarPlantilla, leerFilasPlantilla, leerMonto } from './plantillaFacturas';

describe('número de factura', () => {
  it('compara sin espacios, mayúsculas, "Factura #" ni ceros a la izquierda', () => {
    expect(claveFactura(39352)).toBe('39352');
    expect(claveFactura(' 039352 ')).toBe('39352');
    expect(claveFactura('39352.0')).toBe('39352');
    expect(claveFactura('Factura # 39352')).toBe('39352');
    expect(claveFactura('#39352')).toBe('39352');
    expect(claveFactura('inv-10001')).toBe('INV-10001');
    expect(claveFactura('A 5746')).toBe('A5746');
  });
});

describe('monto', () => {
  it('número de Excel o texto con $, comas y moneda; vacío = sin monto', () => {
    expect(leerMonto(140).monto).toBe(140);
    expect(leerMonto('$1,234.50 USD').monto).toBe(1234.5);
    expect(leerMonto('').monto).toBeNull();
    expect(Number.isNaN(leerMonto('ciento veinte').monto)).toBe(true);
  });
});

describe('leer la hoja', () => {
  it('con encabezado (en cualquier renglón de arriba) y renglones vacíos', () => {
    const filas = leerFilasPlantilla([
      ['Pagos de Transplace'],
      ['Factura', 'Monto (opcional)'],
      [39352, 140],
      ['', ''],
      ['39364', ''],
    ]);
    expect(filas).toEqual([
      { fila: 3, factura: '39352', monto: 140, montoTexto: '140' },
      { fila: 5, factura: '39364', monto: null, montoTexto: '' },
    ]);
  });
  it('sin encabezado: columna A = factura, B = monto', () => {
    expect(leerFilasPlantilla([[39352, 140]])).toEqual([{ fila: 1, factura: '39352', monto: 140, montoTexto: '140' }]);
  });
  it('encabezado sin columna Monto', () => {
    expect(leerFilasPlantilla([['#', 'Factura'], [1, 'A-1']])).toEqual([{ fila: 2, factura: 'A-1', monto: null, montoTexto: '' }]);
  });
});

describe('marcar las pendientes', () => {
  const pendientes = [
    { id: 'a', invoice: '39352', saldo: 140 },
    { id: 'b', invoice: '39364', saldo: 115.5 },
    { id: 'c', invoice: '39365', saldo: 0 },
  ];
  const conocidas = [
    { invoice: '39340', saldo: 0, entidad: 'Transplace', propia: true },
    { invoice: '50001', saldo: 90, entidad: 'Otra SA', propia: false },
  ];
  const fila = (n: number, factura: string, monto: number | null = null, montoTexto = '') => ({ fila: n, factura, monto, montoTexto });

  it('sin monto se marca; con monto solo si es igual al saldo abierto', () => {
    const r = cruzarPlantilla([fila(2, '39352'), fila(3, '39364', 115.5)], pendientes, { entidad: 'Transplace' });
    expect(r.marcar.map((f) => f.id)).toEqual(['a', 'b']);
    expect(r.avisos).toEqual([]);
    expect(r.renglones).toBe(2);
  });
  it('monto distinto: no se marca y dice el saldo', () => {
    const r = cruzarPlantilla([fila(2, '39364', 100)], pendientes, { entidad: 'Transplace' });
    expect(r.marcar).toEqual([]);
    expect(r.avisos[0].motivo).toBe('El monto $100.00 no coincide con el saldo abierto ($115.50).');
  });
  it('explica por qué no se marcó: pagada, de otra empresa, ya en el pago, no encontrada, repetida, monto inválido', () => {
    const r = cruzarPlantilla([
      fila(2, '39340'), fila(3, '50001'), fila(4, '39001'), fila(5, '777'), fila(6, '39352'), fila(7, '039352'),
      fila(8, '39364', Number.NaN, 'abc'), fila(9, '', 50, '50'), fila(10, '39365'),
    ], pendientes, { entidad: 'Transplace', conocidas, enEstePago: ['39001'] });
    expect(r.marcar.map((f) => f.id)).toEqual(['a']);
    expect(r.avisos.map((a) => [a.fila, a.motivo])).toEqual([
      [2, 'Ya está pagada.'],
      [3, 'Es de otra empresa: Otra SA.'],
      [4, 'Ya está en este pago.'],
      [5, 'No está entre las facturas con saldo de Transplace.'],
      [7, 'Repetida en el archivo (ya está en el renglón 6).'],
      [8, 'El monto "abc" no es un número.'],
      [9, 'Falta el número de factura.'],
      [10, 'No está entre las facturas con saldo de Transplace.'],
    ]);
  });
});

// ✅ V00455 — movimientos del saldo de un puente (modal de las tarjetas de Operaciones Activas)
// y el puente que viene elegido al "Actualizar saldo".
import { describe, expect, it } from 'vitest';
import { enRango, haceDias, movimientosDePuente, resumenMovimientos, type DatosMovimientos } from './movimientosPuente';
import { monedaDePuente, nombrePuenteCatalogo, puentePredeterminado, puentesDelCatalogo } from '../../puentes/services/puentesCatalogo';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esColombia = (n: string) => norm(n).includes('colombia');
const esAvi = (n: string) => norm(n).includes('avi');

const datos: DatosMovimientos = {
  refs: [
    { id: 'r1', consecutivo: 'PTC-141026-001', puenteNombre: 'Puente Colombia', fecha: '2026-10-14', hora: '08:59', automatico: true, filas: [
      { ref: 'TR-141026-001', puenteNombre: 'Caseta Mx Colombia + Puente Mx Colombia', caseta: 129.6, casetaMoneda: 'Pesos', piso: 90, pisoMoneda: 'Pesos' },
    ] },
    { id: 'r2', consecutivo: 'AVI-141026-001', puenteNombre: 'Puente AVI', fecha: '2026-10-14', hora: '09:01', automatico: true, filas: [
      { ref: 'TR-141026-029', puenteNombre: 'Caseta AVI', caseta: 23.75, casetaMoneda: 'Dólares', piso: 0, pisoMoneda: '' },
      { ref: 'Otro cruce · U-9', puenteNombre: 'Caseta AVI', caseta: 23.75, casetaMoneda: 'Dólares', piso: 0, pisoMoneda: '' },
    ] },
    // referencia vieja mezclada: solo cuenta la fila de Colombia
    { id: 'r3', consecutivo: 'PT3-101026-001', puenteNombre: 'Puente III', fecha: '2026-10-10', hora: '10:00', automatico: true, filas: [
      { ref: 'TR-101026-001', puenteNombre: 'Caseta Puente III', caseta: 144, casetaMoneda: 'Pesos', piso: 0, pisoMoneda: '' },
      { ref: 'TR-101026-002', puenteNombre: 'Caseta Mx Colombia + Puente Mx Colombia', caseta: 129.6, casetaMoneda: 'Pesos', piso: 90, pisoMoneda: 'Pesos' },
    ] },
  ],
  saldos: [
    { id: 's1', puenteId: 'g-col', puenteNombre: 'Caseta Mx Colombia', fecha: '2026-10-12', hora: '07:00', saldo: 5000, moneda: 'Pesos', registradoPor: 'Omaf' },
    { id: 's2', puenteId: 'g-piso', puenteNombre: 'Puente Mx Colombia', fecha: '2026-10-14', hora: '06:00', saldo: 900, moneda: 'Pesos', registradoPor: '' },
    { id: 's3', puenteId: 'g-avi', puenteNombre: 'Caseta AVI', fecha: '2026-10-14', hora: '06:00', saldo: 1000, moneda: 'Dólares', registradoPor: '' },
  ],
  otros: [
    { id: 'o1', consecutivo: 'PTC-091026-002', puenteNombre: 'Caseta Mx Colombia', fecha: '2026-10-09', hora: '15:00', monto: 129.6, moneda: 'Pesos', unidad: 'Particular' },
  ],
};

describe('movimientos del saldo de un puente', () => {
  const col = movimientosDePuente(datos, esColombia, (s) => esColombia(s.puenteNombre));

  it('Colombia: referencias (caseta + puente), saldos y otros cruces, del más reciente al más antiguo', () => {
    expect(col.map((m) => m.id)).toEqual(['ref:r1', 'saldo:s2', 'saldo:s1', 'ref:r3', 'otro:o1']);
    expect(col[0]).toMatchObject({ tipo: 'referencia', consecutivo: 'PTC-141026-001', operaciones: ['TR-141026-001'], montos: [{ moneda: 'Pesos', monto: 219.6 }], automatico: true });
    expect(col[2]).toMatchObject({ tipo: 'saldo', montos: [{ moneda: 'Pesos', monto: 5000 }], registradoPor: 'Omaf' });
  });

  it('una referencia mezclada cuenta solo la parte de este puente', () => {
    const r3 = col.find((m) => m.id === 'ref:r3');
    expect(r3).toMatchObject({ operaciones: ['TR-101026-002'], montos: [{ moneda: 'Pesos', monto: 219.6 }] });
  });

  it('AVI no ve lo de Colombia; los otros cruces dentro de la referencia cuentan como operación', () => {
    const avi = movimientosDePuente(datos, esAvi, (s) => esAvi(s.puenteNombre));
    expect(avi.map((m) => m.id)).toEqual(['ref:r2', 'saldo:s3']);
    expect(avi[0]).toMatchObject({ operaciones: ['TR-141026-029', 'Otro cruce · U-9'], montos: [{ moneda: 'Dólares', monto: 47.5 }] });
  });

  it('rango de fechas y totales', () => {
    const r = enRango(col, '2026-10-12', '2026-10-14');
    expect(r.map((m) => m.id)).toEqual(['ref:r1', 'saldo:s2', 'saldo:s1']);
    expect(resumenMovimientos(r)).toEqual({ abonos: [{ moneda: 'Pesos', monto: 5900 }], cargos: [{ moneda: 'Pesos', monto: 219.6 }], referencias: 1, operaciones: 1 });
    expect(enRango(col, '', '').length).toBe(col.length);
    expect(resumenMovimientos(col).referencias).toBe(3);
  });

  it('hace N días en hora local (cruza meses)', () => {
    expect(haceDias('2026-10-16', 30)).toBe('2026-09-16');
    expect(haceDias('2026-03-01', 1)).toBe('2026-02-28');
  });
});

describe('puentes del catálogo', () => {
  const tipos = [
    { id: 'g-p3', nombre_gasto: 'Caseta Puente III', categoria_gasto: 'Puente', moneda: ID_MXN },
    { id: 'g-avi', nombre_gasto: 'Caseta AVI', categoria_gasto: 'Puente', moneda: ID_USD },
    { id: 'g-diesel', nombre_gasto: 'Diesel', categoria_gasto: 'Combustible' },
    { id: 'g-col', nombre_gasto: 'Caseta Mx Colombia', categoria_gasto: 'Puente', moneda: ID_MXN },
    { id: 'g-piso', nombre_gasto: 'Puente Mx Colombia', categoria_gasto: 'Puente', moneda: ID_MXN },
  ];
  const puentes = puentesDelCatalogo(tipos);

  it('solo los de categoría Puente, por nombre', () => {
    expect(puentes.map((p) => nombrePuenteCatalogo(p))).toEqual(['Caseta AVI', 'Caseta Mx Colombia', 'Caseta Puente III', 'Puente Mx Colombia']);
    expect(monedaDePuente(ID_USD)).toBe('Dólares');
    expect(monedaDePuente(ID_MXN)).toBe('Pesos');
    expect(monedaDePuente('Euros')).toBe('Euros');
  });

  it('cada tarjeta trae su caseta elegida', () => {
    const id = (p: Record<string, unknown>) => String(p.id);
    expect(puentePredeterminado(puentes, 'avi', id)).toBe('g-avi');
    expect(puentePredeterminado(puentes, 'p3', id)).toBe('g-p3');
    expect(puentePredeterminado(puentes, 'colombia', id)).toBe('g-col');
    expect(puentePredeterminado(puentes, undefined, id)).toBe('');
    expect(puentePredeterminado([{ id: 'x', nombre_gasto: 'Caseta Puente 3', categoria_gasto: 'Puente' }], 'p3', id)).toBe('x');
    expect(puentePredeterminado([], 'avi', id)).toBe('');
  });
});

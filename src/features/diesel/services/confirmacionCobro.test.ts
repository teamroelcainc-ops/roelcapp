// ✅ V00459 — confirmar el cobro de una carga de diesel.
import { describe, expect, it } from 'vitest';
import { avisoCaptura, camposConfirmacion, capturaInicial, errorCaptura } from './confirmacionCobro';

const ref = { costoDiesel: 5.62, galonesExtras: 0, galonesAutorizados: 81, galonesCargados: 81.29, totalCargado: 81.29 * 5.62, status: 'Cargado' };

describe('confirmar cobro de diesel', () => {
  it('sin cambiar galones solo escribe descuento y cobrado (el total viejo no se toca)', () => {
    const viejaSinCosto = { fecha: '2026-09-01', totalCargado: 500, galonesCargados: 90 };
    const campos = camposConfirmacion(viejaSinCosto, { galonesCargados: '90', descuento: '', montoCobrado: '488' }, 'Ana', '2026-10-17T10:00:00Z');
    expect(campos).toEqual({ descuentoDiesel: null, montoCobrado: 488, cobroConfirmadoPor: 'Ana', cobroConfirmadoEn: '2026-10-17T10:00:00Z' });
    expect(errorCaptura(viejaSinCosto, { galonesCargados: '95', descuento: '', montoCobrado: '' })).toMatch(/no tiene costo/);
  });

  it('con galones distintos recalcula total y status con el costo de la referencia', () => {
    const campos = camposConfirmacion(ref, { galonesCargados: '80', descuento: '10.65', montoCobrado: '' }, 'Ana', 'x');
    expect(campos).toMatchObject({ galonesCargados: 80, status: 'Cargado', descuentoDiesel: 10.65, montoCobrado: null, cobroConfirmadoPor: null });
    expect(campos.totalCargado).toBeCloseTo(449.6, 2);
    expect(camposConfirmacion({ ...ref, galonesExtras: 5 }, { galonesCargados: '0', descuento: '', montoCobrado: '' }, 'Ana', 'x').status).toBe('Autorizado');
  });

  it('límites y avisos', () => {
    expect(errorCaptura(ref, { galonesCargados: '', descuento: '', montoCobrado: '' })).toMatch(/galones/);
    expect(errorCaptura(ref, { galonesCargados: '81.29', descuento: '-1', montoCobrado: '' })).toMatch(/descuento/);
    expect(errorCaptura(ref, { galonesCargados: '81.29', descuento: '500', montoCobrado: '' })).toMatch(/mayor que/);
    expect(errorCaptura(ref, { galonesCargados: '81.29', descuento: '', montoCobrado: '0' })).toMatch(/vacío/);
    expect(errorCaptura(ref, { galonesCargados: '81.29', descuento: '10.65', montoCobrado: '446.98' })).toBe('');
    expect(avisoCaptura(ref, { galonesCargados: '81.29', descuento: '446.98', montoCobrado: '' })).toMatch(/Monto cobrado/);
    expect(avisoCaptura(ref, { galonesCargados: '81.29', descuento: '', montoCobrado: '10.65' })).toMatch(/Descuento/);
    expect(avisoCaptura(ref, { galonesCargados: '81.29', descuento: '10.65', montoCobrado: '446.98' })).toBe('');
    expect(capturaInicial({ ...ref, descuentoDiesel: 10.65, montoCobrado: null })).toEqual({ galonesCargados: '81.29', descuento: '10.65', montoCobrado: '' });
  });
});

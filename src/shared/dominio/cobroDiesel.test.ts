// ✅ V00459 — cobro real de una carga de diesel (descuento de Murphy y monto cobrado).
import { describe, expect, it } from 'vitest';
import { cobroDiesel, cobroPorConfirmar, descuentoEstimadoDiesel, INICIO_DESCUENTO_MURPHY, numeroCapturado } from './cobroDiesel';
import { cargadoDiesel, cuentasDieselDesdeReferencias } from './saldosCorrientes';

const murphy = { proveedorNombre: 'Murphy International', costoDiesel: 5.62, galonesAutorizados: 81, galonesCargados: 81.29, totalCargado: 81.29 * 5.62 };

describe('cobro real de diesel', () => {
  it('las cargas anteriores al inicio y las de otros proveedores quedan EXACTO como siempre', () => {
    const vieja = { ...murphy, fecha: '2026-10-15' };
    expect(cobroDiesel(vieja).cobrado).toBe(vieja.totalCargado);
    expect(cargadoDiesel(vieja)).toBe(vieja.totalCargado);
    const noria = { ...murphy, proveedorNombre: 'La Noria', fecha: INICIO_DESCUENTO_MURPHY };
    expect(cobroDiesel(noria)).toMatchObject({ descuento: 0, cobrado: noria.totalCargado, descuentoCapturado: false, cobradoCapturado: false });
    expect(cargadoDiesel({ galonesCargados: 10, costoDiesel: 5 })).toBe(50);
  });

  it('Murphy desde el inicio: descuento estimado $0.20 × galones y cobrado = sin descuento − descuento', () => {
    const r = { ...murphy, fecha: INICIO_DESCUENTO_MURPHY };
    const c = cobroDiesel(r);
    expect(c.descuento).toBe(16.26);
    expect(c.cobrado).toBeCloseTo(456.85 - 16.26, 2);
    expect(c.difGalones).toBeCloseTo(0.29, 2);
    expect(c.difMonto).toBeCloseTo(16.26, 2);
    expect(descuentoEstimadoDiesel({ ...r, fecha: '2026-10-17T09:00:00' })).toBe(16.26);
    expect(descuentoEstimadoDiesel({ ...r, galonesCargados: 0 })).toBe(0);
    // fechas en otro formato (registros viejos): nunca reciben el estimado ni quedan "por confirmar"
    for (const fecha of ['30/09/2025', '31/12/2024', 45678, new Date(2026, 11, 1)]) {
      expect(descuentoEstimadoDiesel({ ...r, fecha })).toBe(0);
      expect(cobroPorConfirmar({ ...r, fecha })).toBe(false);
      expect(cargadoDiesel({ ...r, fecha })).toBe(r.totalCargado);
    }
  });

  it('lo capturado del reporte manda (también en cargas viejas), y 0 cuenta como capturado', () => {
    const r = { ...murphy, fecha: '2026-10-15', descuentoDiesel: 10.65, montoCobrado: 446.98 };
    expect(cobroDiesel(r)).toMatchObject({ descuento: 10.65, descuentoCapturado: true, cobrado: 446.98, cobradoCapturado: true });
    expect(cobroDiesel(r).difMonto).toBeCloseTo(456.85 - 446.98, 2);
    expect(cargadoDiesel(r)).toBe(446.98);
    // solo el descuento capturado: cobrado = sin descuento − descuento
    expect(cobroDiesel({ ...murphy, fecha: '2026-10-15', descuentoDiesel: 10.65 }).cobrado).toBeCloseTo(446.2, 2);
    expect(cobroDiesel({ ...murphy, fecha: INICIO_DESCUENTO_MURPHY, descuentoDiesel: 0 }).cobrado).toBe(murphy.totalCargado);
    expect(numeroCapturado('')).toBeNull();
    expect(numeroCapturado(null)).toBeNull();
    expect(numeroCapturado('$446.98')).toBe(446.98);
    expect(numeroCapturado('x')).toBeNull();
  });

  it('por confirmar: cargas desde el inicio con monto y sin Monto cobrado', () => {
    expect(cobroPorConfirmar({ ...murphy, fecha: INICIO_DESCUENTO_MURPHY })).toBe(true);
    expect(cobroPorConfirmar({ ...murphy, fecha: INICIO_DESCUENTO_MURPHY, montoCobrado: 440 })).toBe(false);
    expect(cobroPorConfirmar({ ...murphy, fecha: '2026-10-15' })).toBe(false);
    expect(cobroPorConfirmar({ fecha: INICIO_DESCUENTO_MURPHY, galonesCargados: 0, costoDiesel: 5 })).toBe(false);
  });

  it('el saldo descuenta lo cobrado', () => {
    const saldos = [{ id: 's', fecha: '2026-10-01', proveedorId: '__todos__', proveedorNombre: 'Todos los proveedores', saldo: 1000, moneda: 'Dólares' }];
    const refs = [{ ...murphy, fecha: '2026-10-15', montoCobrado: 446.98 }, { ...murphy, fecha: INICIO_DESCUENTO_MURPHY }];
    const [c] = cuentasDieselDesdeReferencias(saldos, refs, '2026-10-20');
    expect(c.restante).toBeCloseTo(1000 - 446.98 - (456.85 - 16.26), 2);
  });
});

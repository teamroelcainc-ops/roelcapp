// ✅ V00461 — T.C. de una fecha: por el campo `fecha`, nunca por cuándo se capturó.
import { describe, expect, it } from 'vitest';
import { fechaDeTipoCambio, mapaTipoCambio, mismoTipoCambio, operacionConvierteMoneda, revisarTipoCambioOperacion, tipoCambioAplicable, tipoCambioDeFecha, tipoCambioMueveDinero, valorDeTipoCambio } from './tipoCambio';

const filas = [
  // El del 14 y el del 15 se capturaron en la noche: su createdAt (UTC) ya es del día siguiente.
  { id: 'a', fecha: '2026-10-14', dia: 'Miércoles', tcDof: 18.5, tendencia: 'Sin cambio', createdAt: '2026-10-15T01:40:00.000Z' },
  { id: 'b', fecha: '2026-10-15', dia: 'Jueves', tcDof: 18.4888, tendencia: 'Bajó 0.0112 centavos', createdAt: '2026-10-16T01:30:00.000Z' },
  { id: 'c', fecha: '2026-10-16', dia: 'Viernes', tcDof: 18.35, createdAt: '2026-10-16T14:00:00.000Z', updatedAt: '2026-10-17T02:00:00.000Z' },
];

describe('tipo de cambio de una fecha', () => {
  it('cada día toma SU renglón aunque otro se haya capturado ese día en UTC', () => {
    expect(tipoCambioDeFecha(filas, '2026-10-14')).toBe(18.5);
    expect(tipoCambioDeFecha(filas, '2026-10-15')).toBe(18.4888);
    expect(tipoCambioDeFecha(filas, '2026-10-16')).toBe(18.35);
    expect(tipoCambioDeFecha(filas, '2026-10-17')).toBeNull();
  });

  it('reconoce fechas viejas d/m/aaaa y renglones sin fecha', () => {
    expect(tipoCambioDeFecha([{ fecha: '25/03/2026', valor: '17.25' }], '2026-03-25')).toBe(17.25);
    expect(fechaDeTipoCambio({ Fecha: '2026-03-24' })).toBe('2026-03-24');
    expect(fechaDeTipoCambio({ createdAt: '2026-03-24T10:00:00Z', tcDof: 17 })).toBe('');
    expect(tipoCambioDeFecha('no es lista', '2026-03-24')).toBeNull();
  });

  it('valor y comparación', () => {
    expect(valorDeTipoCambio({ fecha: '2026-10-16', tcDof: '$18.3500' })).toBe(18.35);
    expect(valorDeTipoCambio({ x: 'abc', y: '18.5' })).toBe(18.5);
    expect(mismoTipoCambio(18.35, '18.35001')).toBe(true);
    expect(mismoTipoCambio(18.35, 18.4888)).toBe(false);
  });

  it('revisión de la operación contra el T.C. de su fecha', () => {
    const mapa = mapaTipoCambio(filas);
    expect(revisarTipoCambioOperacion({ fechaServicio: '2026-10-15', tipoCambioAprobado: 18.4888 }, mapa).estado).toBe('ok');
    expect(revisarTipoCambioOperacion({ fechaServicioISO: '2026-10-15', tipoCambioAprobado: 18.35 }, mapa)).toEqual({ fecha: '2026-10-15', guardado: 18.35, deSuFecha: 18.4888, fechaDelTC: '2026-10-15', estado: 'distinto' });
    // Sin tipoCambioAprobado cuenta el tipoCambioDia (como dinero.ts).
    expect(revisarTipoCambioOperacion({ fechaServicio: '2026-10-15', tipoCambioDia: 18.35 }, mapa).estado).toBe('distinto');
    // Sábado 17 y domingo 18 sin registro: les toca el del viernes 16.
    expect(revisarTipoCambioOperacion({ fechaServicio: '2026-10-18', tipoCambioAprobado: 18.35 }, mapa)).toMatchObject({ deSuFecha: 18.35, fechaDelTC: '2026-10-16', estado: 'ok' });
    expect(revisarTipoCambioOperacion({ fechaServicio: '15/10/2026', tipoCambioAprobado: 0 }, mapa).estado).toBe('sinTC');
    expect(revisarTipoCambioOperacion({ fechaServicio: '2026-10-12', tipoCambioAprobado: 18 }, mapa).estado).toBe('fechaSinTC');
    expect(revisarTipoCambioOperacion({ tipoCambioAprobado: 18 }, mapa).estado).toBe('sinFecha');
  });

  it('fin de semana sin registro toma el viernes; un día hábil sin registro no toma otro día', () => {
    const buscar = (f: string) => tipoCambioDeFecha(filas, f);
    expect(tipoCambioAplicable(buscar, '2026-10-16')).toEqual({ valor: 18.35, fecha: '2026-10-16' });
    expect(tipoCambioAplicable(buscar, '2026-10-17')).toEqual({ valor: 18.35, fecha: '2026-10-16' }); // sábado
    expect(tipoCambioAplicable(buscar, '2026-10-18')).toEqual({ valor: 18.35, fecha: '2026-10-16' }); // domingo
    expect(tipoCambioAplicable(buscar, '2026-10-19')).toBeNull(); // lunes sin capturar
    expect(tipoCambioAplicable(buscar, '2026-10-13')).toBeNull(); // martes sin registro
    expect(tipoCambioAplicable(buscar, '')).toBeNull();
  });

  it('¿la operación convierte moneda?', () => {
    expect(operacionConvierteMoneda({ monedaConvenioCliente: '7dca62b3', facturadoEnCobrar: 'f95d8894' })).toBe(true);
    expect(operacionConvierteMoneda({ monedaConvenioCliente: 'USD', facturadoEnCobrar: 'USD', monedaConvenioProv: 'MXN', monedaUnidadNombre: 'Pesos' })).toBe(false);
    expect(operacionConvierteMoneda({ monedaConvenioProv: 'Pesos', facturadoEnUnidad: '7dca62b3' })).toBe(true);
    expect(tipoCambioMueveDinero({ monedaConvenioCliente: 'USD', facturadoEnCobrar: '7dca62b3' })).toBe(true); // USD→USD: su equivalente en pesos usa el T.C.
    expect(tipoCambioMueveDinero({ monedaConvenioCliente: 'MXN', facturadoEnCobrar: 'f95d8894', monedaUnidadNombre: 'Pesos' })).toBe(false);
  });
});

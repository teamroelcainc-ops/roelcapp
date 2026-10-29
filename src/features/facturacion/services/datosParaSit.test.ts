// ✅ V00513 — Datos para el SIT: descripción e importe por operación, con la regla de dinero de la app.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { conceptoSit, datosParaSit, fechaSit, textoDescripcion, textoImporte } from './datosParaSit';

const temm = {
  id: 'o1', ref: 'LO-211026-8', fechaServicioISO: '2026-10-21', refCliente: '',
  montoConvenioCliente: 170, cargosAdicionales: 0, facturadoEnCobrar: ID_MXN, monedaConvenioCliente: ID_USD, tipoCambioAprobado: 18.42,
};
const chr = {
  id: 'o2', numReferencia: 'TR-271026-026', fechaServicio: '27/10/2026', refCliente: '568917117',
  montoConvenioCliente: 150, facturadoEnCobrar: ID_USD, monedaConvenioCliente: ID_USD, tipoCambioAprobado: 18.65,
};

describe('conceptoSit', () => {
  it('convenio en dólares facturado en pesos: importe × TC y el TC en la descripción', () => {
    const c = conceptoSit(temm, 'MXN', { caja: 'RP116', convenio: 'Cruce de Importacion - Caja - Cargado' });
    expect(c.importe).toBe(3131.4);
    expect(c.tipoCambio).toBe(18.42);
    expect(textoDescripcion(c)).toBe('LO-211026-008\n21/10/2026\nCAJA RP116\nTC 18.4200');
  });
  it('misma moneda: sin TC; con Ref Cliente', () => {
    const c = conceptoSit(chr, 'USD', { caja: 'ETX53269', convenio: '' });
    expect(c.importe).toBe(150);
    expect(c.tipoCambio).toBe(0);
    expect(c.lineas).toEqual(['TR-271026-026', '27/10/2026', 'CAJA ETX53269', 'REF 568917117']);
  });
  it('convenio en pesos facturado en dólares: ÷ TC', () => {
    const op = { id: 'o3', ref: 'TR-010126-1', montoConvenioCliente: 1850, facturadoEnCobrar: ID_USD, monedaConvenioCliente: ID_MXN, tipoCambioAprobado: 18.5 };
    const c = conceptoSit(op, 'USD', { caja: '', convenio: '' });
    expect([c.importe, c.tipoCambio]).toEqual([100, 18.5]);
  });
});

describe('datosParaSit', () => {
  it('ordena por referencia y suma el subtotal al centavo (sin impuestos)', () => {
    const d = datosParaSit([
      { ...temm, id: 'b', ref: 'LO-211026-10' },
      { ...temm, id: 'a', ref: 'LO-211026-9', montoConvenioCliente: 0.1, tipoCambioAprobado: 1 },
    ], 'MXN', () => ({ caja: '', convenio: '' }));
    expect(d.conceptos.map((c) => c.ref)).toEqual(['LO-211026-009', 'LO-211026-010']);
    expect(d.subtotal).toBe(3131.5);
  });
  it('formatos', () => {
    expect(fechaSit('2026-10-21')).toBe('21/10/2026');
    expect(fechaSit('')).toBe('');
    expect(textoImporte(3131.4)).toBe('3131.40');
  });
});

// ✅ V00528 — "Actualizar factura" (Editar factura y la Ficha): la misma regla para los dos botones.
import { describe, expect, it } from 'vitest';
import { ID_USD } from '../../../shared/dominio/constantes';
import { hayQueActualizar, idsDocsFactura, planActualizarFactura, textoActualizar } from './actualizarFactura';
import { normalizarFacturaDe } from './normalizarFactura';

type Datos = Record<string, unknown>;
const op = (monto: number, extra: Datos = {}): Datos => ({ montoConvenioCliente: monto, cargosAdicionales: 0, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD, tipoCambioDia: 18.6, ...extra });
// La I8650 de la captura: TR-231026-030 guardó $100 y hoy cobra $50; el total ($200) ya es lo de hoy.
const i8650 = (extra: Datos = {}): Datos => ({
  id: 'fc1', invoice: 'I8650', monedaFacturacion: 'USD', subtotalMonedaFactura: 200, subtotalFactura: 3720,
  operacionesGuardadas: [{ id: 'a', ref: 'TR-231026-030', dol: 100, pes: 0, monto: 1860, subtotalBase: 100 }, { id: 'b', ref: 'TR-231026-031', dol: 150, pes: 0, monto: 2790, subtotalBase: 150 }],
  ...extra,
});
const hoy = new Map<string, Datos>([['a', op(50)], ['b', op(150)]]);
const opciones = { moneda: 'USD' as const, monedaVista: 'USD' as const, monedaDoc: () => 'USD' as const, cargando: false, dineroPorServidor: false };

describe('planActualizarFactura', () => {
  it('I8650: el renglón toma el total de hoy y el total de la factura no cambia (ya lo incluía)', () => {
    const p = planActualizarFactura(i8650(), hoy, opciones);
    expect(p.desfasadas).toEqual([{ opId: 'a', ref: 'TR-231026-030', antes: 100, ahora: 50 }]);
    expect(p.sincronizar).toMatchObject({ modo: 'yaIncluido', totalAntes: 200, totalDespues: 200 });
    expect(p.impedimento).toBe('');
    expect(hayQueActualizar(p)).toBe(true);
    expect(textoActualizar(p, 'Dólares')).toBe('Actualizar factura guarda el total de hoy de cada operación; el total de la factura (200.00 Dólares) no cambia: ya lo incluía.');
  });
  it('si la factura cuadraba con sus renglones, el total baja o sube la diferencia', () => {
    const p = planActualizarFactura(i8650({ subtotalMonedaFactura: 250 }), hoy, opciones);
    expect(p.sincronizar).toMatchObject({ modo: 'diferencia', totalAntes: 250, totalDespues: 200 });
    expect(textoActualizar(p, 'Dólares')).toBe('Actualizar factura toma el total de hoy de cada operación: el total pasa de 250.00 a 200.00 Dólares.');
  });
  it('al día: nada que hacer', () => {
    const p = planActualizarFactura(i8650(), new Map([['a', op(100)], ['b', op(150)]]), opciones);
    expect(p.desfasadas).toEqual([]);
    expect(hayQueActualizar(p)).toBe(false);
    expect(textoActualizar(p, 'Dólares')).toBe('');
  });
  it('mientras se leen las operaciones no decide nada (pero ya sabe si la factura no guardó importes)', () => {
    const p = planActualizarFactura(i8650(), hoy, { ...opciones, cargando: true });
    expect(p).toMatchObject({ desfasadas: [], sincronizar: null, completar: null, sinImportes: false });
    expect(hayQueActualizar(p)).toBe(false);
  });
  it('no se puede: dinero en el servidor, folio en varios registros o factura sin moneda guardada', () => {
    expect(planActualizarFactura(i8650(), hoy, { ...opciones, dineroPorServidor: true }).impedimento).toMatch(/dinero en el servidor/);
    const grupo = planActualizarFactura(i8650({ __groupIds: ['fc1', 'fc2'] }), hoy, opciones);
    expect(grupo.impedimento).toMatch(/varios registros/);
    expect(hayQueActualizar(grupo)).toBe(false);
    const sinMoneda = planActualizarFactura(i8650({ monedaFacturacion: '' }), hoy, { ...opciones, moneda: null });
    expect(sinMoneda.desfasadas).toHaveLength(1);
    expect(sinMoneda.impedimento).toMatch(/no tiene su moneda guardada/);
    expect(textoActualizar(sinMoneda, 'Dólares')).toMatch(/no tiene su moneda guardada/);
  });
  it('sin lo que cobró cada operación (AppSheet): completa con lo de hoy y el total no cambia', () => {
    const fila = { id: 'f9', ...normalizarFacturaDe({ invoice: '35539', statusFactura: 'Facturado', monedaFacturacion: 'USD', total: 200, operacionesIds: ['a', 'b'], operaciones: ['TR-1', 'TR-2'] }, 'cliente') };
    const p = planActualizarFactura(fila, hoy, opciones);
    expect(p.sinImportes).toBe(true);
    expect(p.sincronizar).toBeNull();
    expect(p.resumenCompletar).toEqual({ suma: 200, total: 200, cuadra: true });
    expect(p.completar?.completar.map((d) => d.id)).toEqual(['f9']);
    expect(hayQueActualizar(p)).toBe(true);
    expect(textoActualizar(p, 'Dólares')).toBe('Actualizar factura guarda lo que cobra hoy cada operación (suman 200.00 Dólares); el total (200.00 Dólares) no cambia.');
    expect(planActualizarFactura(fila, hoy, { ...opciones, dineroPorServidor: true }).resumenCompletar).toEqual({ motivo: expect.stringMatching(/dineroPorServidor/) });
  });
  it('los documentos de la fila: los del folio o el suyo', () => {
    expect(idsDocsFactura({ id: 'x' })).toEqual(['x']);
    expect(idsDocsFactura({ id: 'x', __groupIds: ['x', 'y'] })).toEqual(['x', 'y']);
  });
});

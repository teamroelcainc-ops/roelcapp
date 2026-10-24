// ✅ V00481 — reglas de la factura: Remisión, agregar operaciones, cancelación, moneda e importes.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { totalNativoDeOperaciones } from '../../../shared/dominio/dinero';
import {
  avisoMonedaDistinta, camposCancelacion, cancelacionDe, estaCancelada, estaFacturada, importesDeRenglones,
  monedaDeEmpresa, planCancelacion, puedeAgregarOperaciones, puedeGenerarRemision, STATUS_AL_CREAR, totalSugeridoEn, validarCancelacion,
} from './reglasFactura';

describe('status de la factura', () => {
  it('Facturado (o sin status) bloquea la Remisión y agregar operaciones; No Facturado y Cancelado no', () => {
    expect([estaFacturada('Facturado'), estaFacturada(''), estaFacturada(undefined), estaFacturada('No Facturado'), estaFacturada('Cancelado')])
      .toEqual([true, true, true, false, false]);
    expect(puedeGenerarRemision('Facturado')).toBe(false);
    expect(puedeGenerarRemision('No Facturado')).toBe(true);
    expect(puedeAgregarOperaciones('facturado')).toBe(false);
    expect(puedeAgregarOperaciones('No Facturado')).toBe(true);
  });
  it('reconoce Cancelado / Cancelada y no lo ofrece al crear', () => {
    expect([estaCancelada('Cancelado'), estaCancelada('cancelada'), estaCancelada('No Facturado')]).toEqual([true, true, false]);
    expect(STATUS_AL_CREAR).toEqual(['Facturado', 'No Facturado']);
  });
});

describe('cancelación', () => {
  it('exige nota y una factura de reemplazo distinta', () => {
    expect(validarCancelacion({ nota: ' ', reemplazo: 'B-2' }, 'A-1')).toMatch(/nota/);
    expect(validarCancelacion({ nota: 'Error en RFC', reemplazo: '' }, 'A-1')).toMatch(/reemplaza/);
    expect(validarCancelacion({ nota: 'Error en RFC', reemplazo: ' a-1 ' }, 'A-1')).toMatch(/otra/);
    expect(validarCancelacion({ nota: 'Error en RFC', reemplazo: 'B-2' }, 'A-1')).toBeNull();
  });
  it('guarda y lee los campos', () => {
    const c = camposCancelacion({ nota: ' Error en RFC ', reemplazo: ' B-2 ' }, 'Omar', '2026-10-24T10:00:00.000Z');
    expect(c).toEqual({ motivoCancelacion: 'Error en RFC', facturaReemplazo: 'B-2', canceladaEn: '2026-10-24T10:00:00.000Z', canceladaPor: 'Omar' });
    expect(cancelacionDe(c)).toEqual({ nota: 'Error en RFC', reemplazo: 'B-2', en: '2026-10-24T10:00:00.000Z', por: 'Omar' });
    expect(cancelacionDe({ statusFactura: 'Cancelado' })).toBeNull();
  });
});

describe('qué se guarda de la cancelación con el status nuevo', () => {
  const datos = { nota: 'Error en RFC', reemplazo: 'B-2' };
  const ahora = '2026-10-24T10:00:00.000Z';
  it('al cancelar se guarda todo; sin cambios no se escribe nada', () => {
    expect(planCancelacion({ statusFactura: 'Facturado' }, 'Cancelado', datos, 'Omar', ahora))
      .toEqual({ escribir: { motivoCancelacion: 'Error en RFC', facturaReemplazo: 'B-2', canceladaEn: ahora, canceladaPor: 'Omar' }, borrar: false });
    const cancelada = { statusFactura: 'Cancelado', motivoCancelacion: 'Error en RFC', facturaReemplazo: 'B-2', canceladaEn: 'x', canceladaPor: 'Ana' };
    expect(planCancelacion(cancelada, 'Cancelado', datos, 'Omar', ahora)).toEqual({ escribir: {}, borrar: false });
    expect(planCancelacion(cancelada, 'Cancelado', { nota: 'Otra', reemplazo: 'B-3' }, 'Omar', ahora))
      .toEqual({ escribir: { motivoCancelacion: 'Otra', facturaReemplazo: 'B-3' }, borrar: false });
  });
  it('al salir de Cancelado se borran; una cancelada vieja sin datos los recibe completos', () => {
    expect(planCancelacion({ statusFactura: 'Cancelado', motivoCancelacion: 'x' }, 'Facturado', null, 'Omar', ahora)).toEqual({ escribir: {}, borrar: true });
    expect(planCancelacion({ statusFactura: 'Facturado' }, 'No Facturado', null, 'Omar', ahora)).toEqual({ escribir: {}, borrar: false });
    expect(planCancelacion({ statusFactura: 'Cancelado' }, 'Cancelado', datos, 'Omar', ahora).escribir.canceladaPor).toBe('Omar');
  });
});

describe('moneda de la empresa', () => {
  it('por ID, código o nombre del catálogo', () => {
    expect(monedaDeEmpresa({ monedaRef: ID_USD }, 'monedaFacturacion')).toBe('USD');
    expect(monedaDeEmpresa({ moneda: 'Pesos' }, 'monedaFacturacion')).toBe('MXN');
    expect(monedaDeEmpresa({ monedaFacturacion: ID_MXN }, 'monedaFacturacion')).toBe('MXN');
    expect(monedaDeEmpresa({ monedaRef: 'xyz' }, 'monedaProveedor', (id) => (id === 'xyz' ? 'Dólares' : ''))).toBe('USD');
    expect(monedaDeEmpresa({ nombre: 'Sin moneda' }, 'monedaFacturacion')).toBeNull();
    // la del formulario de Empresas (moneda) le gana a la copia vieja de AppSheet (monedaRef)
    expect(monedaDeEmpresa({ moneda: ID_MXN, monedaRef: ID_USD }, 'monedaFacturacion')).toBe('MXN');
    expect(monedaDeEmpresa(undefined, 'monedaFacturacion')).toBeNull();
  });
  it('avisa solo cuando la factura quedó en otra moneda', () => {
    expect(avisoMonedaDistinta('MXN', 'USD', 'cliente')).toBe('Esta factura está en Pesos, pero el cliente factura en Dólares (Empresas).');
    expect(avisoMonedaDistinta('USD', 'USD', 'cliente')).toBeNull();
    expect(avisoMonedaDistinta(null, 'USD', 'proveedor')).toBeNull();
  });
});

describe('importe de cada operación en la moneda de la factura', () => {
  const renglones = [
    { id: 'a', monto: 1850, dol: 100, pes: 0, subtotalBase: 100 },   // en dólares, TC 18.50
    { id: 'b', monto: 3700, dol: 200, pes: 0, subtotalBase: 200 },
  ];
  it('Dólares → Dólares (Cliente); Pesos → Conversión Final', () => {
    expect(importesDeRenglones('USD', renglones)).toEqual([100, 200]);
    expect(importesDeRenglones(ID_MXN, renglones)).toEqual([1850, 3700]);
    expect(importesDeRenglones('', renglones)).toEqual([1850, 3700]);
  });
  it('la suma de los renglones es el total de la factura', () => {
    for (const mon of ['USD', 'MXN']) {
      const suma = importesDeRenglones(mon, renglones).reduce((a, b) => a + b, 0);
      expect(suma).toBe(totalNativoDeOperaciones(mon, renglones));
    }
  });
  it('total en otra moneda: dólares con dol, pesos con la conversión; sin subtotalBase', () => {
    expect(totalSugeridoEn('USD', renglones)).toBe(300);
    expect(totalSugeridoEn('MXN', renglones)).toBe(5550);
    // facturadas en pesos (sin dólares): no hay de dónde sacar el total en dólares
    expect(totalSugeridoEn('USD', [{ monto: 900, dol: 0, pes: 900, subtotalBase: 900 }])).toBe(0);
    expect(totalSugeridoEn('MXN', [{ pes: 400 }, { pes: 100 }])).toBe(500);
  });
  it('renglones viejos sin dol ni monto caen a subtotalBase', () => {
    expect(importesDeRenglones('USD', [{ subtotalBase: 50 }, { subtotalBase: 70 }])).toEqual([50, 70]);
    expect(importesDeRenglones('MXN', [{ pes: 900, monto: 0 }, { pes: 100 }])).toEqual([900, 100]);
  });
});

// ✅ V00508 — Pasar operaciones de una empresa a otra: papeles, facturadas (las tres decisiones) y cambios.
import { describe, expect, it } from 'vitest';
import {
  cambiosDeFactura, cambiosDeOperacion, cambiosDePago, facturaPaseDe, pagoPaseDe, papelesDeEmpresa, planDePase,
} from './pasarOperaciones';
import type { EntradaPase, ModoFacturadas } from './pasarOperaciones';

const ORIGEN = ['MON', 'mon-app']; // id del documento y el de AppSheet
const op = (id: string, extra: Record<string, unknown>) => ({ id, ref: `TR-${id}`, ...extra });
const prov = (id: string, extra: Record<string, unknown> = {}) => op(id, { proveedorUnidad: 'MON', ...extra });

const operaciones = [
  prov('o1'),
  op('o2', { proveedorUnidadId: 'mon-app' }), // solo el canónico, con el id de AppSheet
  prov('o3', { facturaProveedorId: 'F1' }),
  prov('o4', { facturadoProveedor: true, facturaProveedorFolio: 'a-1' }), // por folio
  prov('o5', { facturaProveedorId: 'F2' }), // F2 tiene otra operación que no se eligió
  op('o6', { clientePaga: 'MON' }), // no es proveedor
  prov('o7', { facturaProveedorId: 'F3' }), // la destino ya tiene ese folio
  prov('o8', { facturaProveedorId: 'F4' }), // su pago también paga F5
  prov('o9', { facturaProveedorId: 'F6' }), // su pago solo paga F6
];
const facturas = [
  facturaPaseDe({ id: 'F1', invoice: 'A-1', operacionesIds: ['o3'], operaciones: ['TR-o4'] }, 'proveedor'),
  facturaPaseDe({ id: 'F2', invoice: 'A-2', operacionesIds: ['o5', 'oX'] }, 'proveedor'),
  facturaPaseDe({ id: 'F3', invoice: 'A-3', operacionesIds: ['o7'] }, 'proveedor'),
  facturaPaseDe({ id: 'F4', invoice: 'A-4', operacionesIds: ['o8'] }, 'proveedor'),
  facturaPaseDe({ id: 'F5', invoice: 'A-5', operacionesIds: ['oY'] }, 'proveedor'),
  facturaPaseDe({ id: 'F6', invoice: 'A-6', operacionesIds: ['o9'] }, 'proveedor'),
];
const pagos = [
  pagoPaseDe({ id: 'P1', tipo: 'proveedor', facturas: [{ facturaId: 'F4', aplicado: 10 }, { invoice: 'A-5', aplicado: 5 }] }),
  pagoPaseDe({ id: 'P2', tipo: 'proveedor', facturas: [{ facturaId: 'F6', aplicado: 10 }] }),
];
const entrada = (modo: ModoFacturadas | null): EntradaPase => ({
  idsOrigen: ORIGEN, operaciones, papeles: ['proveedorUnidad'], modo, facturas, pagos,
  foliosDestino: { cliente: new Set(), proveedor: new Set(['A-3']) },
});
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe('planDePase', () => {
  it('papeles por cualquiera de los ids de la empresa', () => {
    expect(papelesDeEmpresa(operaciones[1], ORIGEN)).toEqual(['proveedorUnidad']);
    expect(papelesDeEmpresa(op('z', { clientePaga: 'MON', proveedorUnidad: 'MON', origen: 'otra' }), ORIGEN)).toEqual(['clientePaga', 'proveedorUnidad']);
  });

  it('sin decidir: pasan las no facturadas y pide decidir las facturadas', () => {
    const p = planDePase(entrada(null));
    expect(ids(p.operaciones)).toEqual(['o1', 'o2']);
    expect(p.facturadas).toBe(6);
    expect(p.falta).toBe(true);
    expect(p.omitidas.find((o) => o.id === 'o6')?.motivo).toBe('La empresa no está como Proveedor (Unidad) en esta operación');
  });

  it('"dejar": las facturadas no pasan', () => {
    const p = planDePase(entrada('dejar'));
    expect(ids(p.operaciones)).toEqual(['o1', 'o2']);
    expect(p.falta).toBe(false);
    expect(p.omitidas.filter((o) => o.motivo === 'Ya está facturada').map((o) => o.id)).toEqual(['o3', 'o4', 'o5', 'o7', 'o8', 'o9']);
  });

  it('"sinFactura": pasan todas las del papel y no se toca ninguna factura ni pago', () => {
    const p = planDePase(entrada('sinFactura'));
    expect(ids(p.operaciones)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5', 'o7', 'o8', 'o9']);
    expect(p.facturas).toEqual([]);
    expect(p.pagos).toEqual([]);
  });

  it('"conFactura": la factura pasa solo completa, sin folio repetido en la destino y con pagos solo de ella', () => {
    const p = planDePase(entrada('conFactura'));
    expect(ids(p.operaciones)).toEqual(['o1', 'o2', 'o3', 'o4', 'o9']);
    expect(ids(p.facturas)).toEqual(['F1', 'F6']);
    expect(ids(p.pagos)).toEqual(['P2']);
    const motivo = (id: string) => p.omitidas.find((o) => o.id === id)?.motivo;
    expect(motivo('o5')).toBe('Su factura A-2 tiene operaciones que no se están pasando');
    expect(motivo('o7')).toBe('La empresa destino ya tiene la factura A-3');
    expect(motivo('o8')).toBe('Un pago de la factura A-4 también paga otra factura que no se pasa');
    expect(p.operaciones.find((o) => o.id === 'o3')?.facturas).toEqual(['F1']);
  });

  it('"conFactura": si una factura no pasa, tampoco la que queda incompleta por eso', () => {
    const p = planDePase({
      idsOrigen: ORIGEN, papeles: ['proveedorUnidad'], modo: 'conFactura',
      operaciones: [prov('a', { facturaProveedorId: 'G1' }), prov('b', { facturaProveedorId: 'G2' })],
      facturas: [
        facturaPaseDe({ id: 'G1', invoice: 'G-1', operacionesIds: ['a', 'b'] }, 'proveedor'),
        facturaPaseDe({ id: 'G2', invoice: 'G-2', operacionesIds: ['b', 'z'] }, 'proveedor'),
      ],
    });
    expect(p.operaciones).toEqual([]);
    expect(p.omitidas.map((o) => o.id).sort()).toEqual(['a', 'b']);
  });
});

describe('cambios', () => {
  const destino = { nombre: 'Jose Fernando Carbajo Jimenez', nombreCorto: 'Monarca MX' };
  it('operación: el campo del papel, otro campo viejo con la origen y sus copias de nombre', () => {
    expect(cambiosDeOperacion({ clientePaga: 'MON', clienteId: 'mon-app' }, ['clientePaga'], ORIGEN, 'JF', destino))
      .toEqual({ clientePaga: 'JF', clienteId: 'JF', clientePagaNombre: 'Jose Fernando Carbajo Jimenez', clienteNombre: 'Jose Fernando Carbajo Jimenez' });
    expect(cambiosDeOperacion({ proveedorUnidad: 'MON' }, ['proveedorUnidad', 'provServicios'], ORIGEN, 'JF', destino))
      .toEqual({ proveedorUnidad: 'JF', proveedorUnidadNombre: 'Jose Fernando Carbajo Jimenez', provServicios: 'JF', provServiciosNombre: 'Monarca MX' });
  });
  it('factura y pago', () => {
    expect(cambiosDeFactura({ proveedorId: 'MON', proveedor: 'Monar' }, 'proveedor', 'JF', destino))
      .toEqual({ proveedorId: 'JF', proveedorNombre: 'Jose Fernando Carbajo Jimenez', proveedor: 'Jose Fernando Carbajo Jimenez' });
    expect(cambiosDePago({ entidadId: 'MON', empresaId: 'mon-app', entidadNombre: 'Monar' }, ORIGEN, 'JF', destino))
      .toEqual({ entidadId: 'JF', empresaId: 'JF', entidadNombre: 'Jose Fernando Carbajo Jimenez' });
  });
});

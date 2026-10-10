// ✅ V00441 (Fase 5.3/5.4) — planes de facturación y pagos (lo que ejecutan las callables).
import { describe, expect, it } from 'vitest';
import { ID_USD } from './constantes';
import { ErrorDinero } from './dinero';
import {
  aplicarPlanEnMemoria, idFacturaDeterminista, lista, planAgregarOperacion, planEditarFactura, planEditarPago, planEliminarFacturas,
  planEliminarPago, planFacturar, planMoverOperacion, planQuitarOperacion, planRecalcularFactura, planRegistrarPago, renglonesDeFactura,
} from './facturacion';
import type { DocLeido, PlanDinero } from './facturacion';

type D = Record<string, unknown>;
const AHORA = '2026-10-10T12:00:00.000Z';
const op = (id: string, extra: D = {}): DocLeido => ({
  id,
  datos: {
    ref: `TR-${id}`, clientePaga: 'EMP1', proveedorUnidad: 'PROV1', montoConvenioCliente: 100, monedaConvenioCliente: 'USD',
    facturadoEnCobrar: ID_USD, tipoCambioAprobado: 18, tipoOperacionNombre: 'Logística Fletes', remolqueNombre: `CAJA ${id}`, ...extra,
  },
});
const facturar = (ops: DocLeido[], existente: DocLeido | null = null) => planFacturar({
  lado: 'cliente', empresaId: 'EMP1', empresaNombre: 'Acme', invoice: 'A-100', fecha: '2026-10-10', facturaCcp: '', statusFactura: 'Facturado', moneda: 'USD', ahoraISO: AHORA,
}, ops, existente, idFacturaDeterminista('EMP1', 'A-100'));
const escrituraDe = (plan: PlanDinero, coleccion: string, id: string) => plan.escrituras.find((e) => e.coleccion === coleccion && e.id === id);

describe('facturar', () => {
  it('crea la factura con id determinista, renglones, totales y liga las operaciones', () => {
    const plan = facturar([op('o1'), op('o2', { cargosAdicionales: 20 })]);
    const id = 'EMP1_a-100';
    const fac = escrituraDe(plan, 'facturas_clientes', id);
    expect(fac?.tipo).toBe('crear');
    expect(plan.facturas[id]).toMatchObject({ invoice: 'A-100', clienteId: 'EMP1', monedaFacturacion: 'USD', operacionesIds: ['o1', 'o2'], subtotalMonedaFactura: 220, subtotalFactura: 3960, remolques: ['CAJA o1', 'CAJA o2'] });
    expect(plan.operaciones.o1).toEqual({ facturaClienteId: id, facturaClienteInvoice: 'A-100', facturado: true });
  });

  it('mismo folio y misma empresa: se fusiona y recalcula con todas las operaciones', () => {
    const existente: DocLeido = { id: 'F-viejo', datos: { invoice: 'a-100', clienteId: 'EMP1', monedaFacturacion: 'USD', operacionesIds: ['o1'], operacionesGuardadas: [{ id: 'o1', ref: 'TR-o1', dol: 100, monto: 1800, subtotalBase: 100 }], subtotalMonedaFactura: 100, subtotalFactura: 1800 } };
    const plan = facturar([op('o2')], existente);
    expect(escrituraDe(plan, 'facturas_clientes', 'F-viejo')?.tipo).toBe('combinar');
    expect(plan.facturas['F-viejo']).toMatchObject({ operacionesIds: ['o1', 'o2'], subtotalMonedaFactura: 200, subtotalFactura: 3600 });
  });

  it('no factura una operación que ya está en OTRA factura ni de otra empresa', () => {
    expect(() => facturar([op('o1', { facturaClienteId: 'OTRA', facturaClienteInvoice: 'Z-9' })])).toThrow(/ya está en la factura Z-9/);
    expect(() => facturar([op('o1', { clientePaga: 'EMP2' })])).toThrow(ErrorDinero);
  });

  it('repetir el mismo facturar (reintento) no duplica nada', () => {
    const primera = facturar([op('o1')]);
    const id = 'EMP1_a-100';
    const fac: DocLeido = { id, datos: primera.facturas[id] as D };
    const reintento = facturar([op('o1', { facturaClienteId: id })], fac);
    expect(reintento.facturas[id]).toMatchObject({ operacionesIds: ['o1'], subtotalMonedaFactura: 100 });
  });
});

describe('editar factura (total manual)', () => {
  const renglones = [{ id: 'o1', dol: 600, monto: 10800 }, { id: 'o2', dol: 300, monto: 5400 }];
  const grupo: DocLeido[] = [{ id: 'F1', datos: { invoice: 'A-1', montoPagado: 300, operacionesGuardadas: renglones } }, { id: 'F2', datos: { invoice: 'A-1' } }];
  const editar = (total: number, g = grupo) => planEditarFactura({ lado: 'cliente', origen: 'facturacion', invoice: 'A-1', fecha: '', facturaCcp: '', statusFactura: 'Facturado', moneda: 'USD', total, ahoraISO: AHORA, usuario: 'u' }, g);
  it('desde Facturación: el total va al primer documento, marcado como manual; el saldo respeta lo pagado', () => {
    const plan = editar(1000);
    expect(plan.facturas.F1).toMatchObject({ subtotalMonedaFactura: 1000, saldoPendiente: 700, statusPago: 'PARCIAL', totalManualCentavos: 100000 });
    expect(plan.facturas.F2).toMatchObject({ subtotalMonedaFactura: 0, totalManualCentavos: 0 });
  });
  it('un total IGUAL al de sus operaciones (o sin operaciones) no queda como manual', () => {
    expect(editar(900).facturas.F1).toMatchObject({ subtotalMonedaFactura: 900, totalManualCentavos: 0 });
    expect(editar(1000, [{ id: 'F1', datos: { invoice: 'A-1' } }]).facturas.F1).toMatchObject({ totalManualCentavos: 0 });
  });
  it('desde Pagos no se baja de lo pagado', () => {
    expect(() => planEditarFactura({ lado: 'cliente', origen: 'pagos', invoice: 'A-1', fecha: '', facturaCcp: '', statusFactura: '', moneda: 'USD', total: 200, ahoraISO: AHORA, usuario: 'u' }, [grupo[0]])).toThrow(/MENOR a lo ya pagado/);
  });
});

describe('quitar, mover y agregar operaciones', () => {
  const fac = (id: string, ids: string[], extra: D = {}): DocLeido => ({
    id, datos: { invoice: id, clienteId: 'EMP1', monedaFacturacion: 'USD', operacionesIds: ids, operacionesGuardadas: ids.map((o) => ({ id: o, ref: `TR-${o}`, dol: 100, monto: 1800, subtotalBase: 100 })), subtotalMonedaFactura: ids.length * 100, subtotalFactura: ids.length * 1800, ...extra },
  });
  it('quitar: recalcula la factura y libera la operación', () => {
    const plan = planQuitarOperacion('cliente', 'o1', op('o1'), [fac('F1', ['o1', 'o2'])], true, AHORA);
    expect(plan.facturas.F1).toMatchObject({ operacionesIds: ['o2'], subtotalMonedaFactura: 100 });
    expect(plan.operaciones.o1).toEqual({ facturaClienteId: null, facturaClienteInvoice: null, facturado: false });
  });
  it('facturas importadas del CSV: IDs en texto con comas', () => {
    const csv: D = { invoice: 'C-1', clienteId: 'EMP1', operacionesIds: 'o1, o2,o3', operaciones: 'TR-1,TR-2,TR-3', subtotalMonedaFactura: 300 };
    expect(lista(csv.operacionesIds)).toEqual(['o1', 'o2', 'o3']);
    expect(renglonesDeFactura(csv)).toEqual([
      { id: 'o1', ref: 'TR-1', monto: 0, subtotalBase: 0 }, { id: 'o2', ref: 'TR-2', monto: 0, subtotalBase: 0 }, { id: 'o3', ref: 'TR-3', monto: 0, subtotalBase: 0 },
    ]);
    const plan = planQuitarOperacion('cliente', 'o2', op('o2'), [{ id: 'C1', datos: csv }], true, AHORA);
    expect(plan.facturas.C1).toMatchObject({ operacionesIds: ['o1', 'o3'], operaciones: ['TR-1', 'TR-3'] });
    const agregar = planAgregarOperacion('cliente', { id: 'C1', datos: csv }, op('o9'), AHORA);
    expect(agregar.facturas.C1).toMatchObject({ operacionesIds: ['o1', 'o2', 'o3', 'o9'] });
  });
  it('quitar la última: borra la factura, salvo con pagos o desde el detalle', () => {
    expect(planQuitarOperacion('cliente', 'o1', op('o1'), [fac('F1', ['o1'])], true, AHORA).facturas.F1).toBeNull();
    expect(() => planQuitarOperacion('cliente', 'o1', op('o1'), [fac('F1', ['o1'], { montoPagado: 50 })], true, AHORA)).toThrow(/Revierte los pagos/);
    expect(() => planQuitarOperacion('cliente', 'o1', op('o1'), [fac('F1', ['o1'])], false, AHORA)).toThrow(/sin operaciones/);
  });
  it('quitar no deja el total por debajo de lo pagado', () => {
    expect(() => planQuitarOperacion('cliente', 'o1', op('o1'), [fac('F1', ['o1', 'o2'], { montoPagado: 150 })], true, AHORA)).toThrow(/por debajo de lo ya pagado/);
  });
  it('mover a un folio nuevo: sale de la suya y nace la nueva con sus datos', () => {
    const plan = planMoverOperacion({ lado: 'cliente', nuevoInvoice: 'B-7', ahoraISO: AHORA, nombreEmpresa: () => 'Acme' }, op('o1'), [fac('F1', ['o1', 'o2'], { fecha: '2026-10-01' })], null, 'NUEVA');
    expect(plan.facturas.F1).toMatchObject({ operacionesIds: ['o2'] });
    expect(plan.facturas.NUEVA).toMatchObject({ invoice: 'B-7', fecha: '2026-10-01', clienteId: 'EMP1', operacionesIds: ['o1'], subtotalMonedaFactura: 100 });
    expect(plan.operaciones.o1).toMatchObject({ facturaClienteId: 'NUEVA', facturaClienteInvoice: 'B-7' });
  });
  it('agregar: solo operaciones libres y de la misma empresa', () => {
    const plan = planAgregarOperacion('cliente', fac('F1', ['o1']), op('o2'), AHORA);
    expect(plan.facturas.F1).toMatchObject({ operacionesIds: ['o1', 'o2'], subtotalMonedaFactura: 200 });
    expect(() => planAgregarOperacion('cliente', fac('F1', ['o1']), op('o3', { clientePaga: 'EMP9' }), AHORA)).toThrow(/otro cliente/);
  });
});

describe('eliminar y recalcular', () => {
  it('eliminar libera solo las operaciones que apuntan a esa factura', () => {
    const grupo: DocLeido[] = [{ id: 'F1', datos: { invoice: 'A', operacionesIds: ['o1', 'o2'] } }];
    const plan = planEliminarFacturas('cliente', grupo, [op('o1', { facturaClienteId: 'F1' }), op('o2', { facturaClienteId: 'OTRA' })]);
    expect(plan.facturas.F1).toBeNull();
    expect(Object.keys(plan.operaciones)).toEqual(['o1']);
    expect(() => planEliminarFacturas('cliente', [{ id: 'F1', datos: { montoPagado: 10 } }], [])).toThrow(ErrorDinero);
  });
  it('recalcular rehace renglones y quita la marca de total manual', () => {
    const f: DocLeido = { id: 'F1', datos: { monedaFacturacion: 'USD', operacionesIds: ['o1'], operacionesGuardadas: [{ id: 'o1', ref: 'TR-o1', dol: 1 }], totalManualCentavos: 999 } };
    const plan = planRecalcularFactura('cliente', f, [op('o1')], null, AHORA, 'u');
    expect(plan.facturas.F1).toMatchObject({ subtotalMonedaFactura: 100, subtotalFactura: 1800, totalManualCentavos: 0, saldoPendiente: 100 });
  });
});

describe('pagos', () => {
  const facturas = new Map<string, D | null>([
    ['F1', { invoice: 'A-1', monedaFacturacion: 'USD', subtotalMonedaFactura: 1000, montoPagado: 0 }],
    ['F2', { invoice: 'A-2', monedaFacturacion: 'USD', subtotalMonedaFactura: 500, montoPagado: 100, pagosIds: ['P0'] }],
  ]);
  const datos = {
    tipo: 'cliente' as const, numeroPago: 'PAGO-1', fecha: '2026-10-10', metodoPago: 'Transferencia', referencia: '', entidadId: 'EMP1', entidadNombre: 'Acme',
    monto: 1500, observaciones: '', pdfUrl: '', pdfNombre: '', creadoEn: AHORA, creadoPor: 'u',
    aplicacion: [
      { facturaId: 'F1', invoice: 'A-1', fecha: '', total: 1000, saldoAnterior: 1000, aplicado: 1000, saldoNuevo: 0 },
      { facturaId: 'F2', invoice: 'A-2', fecha: '', total: 500, saldoAnterior: 400, aplicado: 400, saldoNuevo: 0 },
    ],
  };
  it('registrar: aplica con el saldo fresco, guarda saldo a favor y liga el pago', () => {
    const plan = planRegistrarPago(datos, 'P1', facturas);
    const pago = escrituraDe(plan, 'pagos', 'P1');
    expect(pago?.tipo === 'crear' && pago.datos).toMatchObject({ monto: 1500, montoAplicado: 1400, saldoAFavor: 100, saldoAFavorCentavos: 10000, moneda: 'USD', empresaId: 'EMP1' });
    expect(plan.facturas.F2).toMatchObject({ montoPagado: 500, saldoPendiente: 0, statusPago: 'PAGADA', pagosIds: ['P0', 'P1'] });
  });
  it('registrar y luego eliminar deja las facturas como estaban', () => {
    const base = new Map<string, D>([['facturas_clientes/F1', facturas.get('F1') as D], ['facturas_clientes/F2', facturas.get('F2') as D]]);
    const tras = aplicarPlanEnMemoria(base, planRegistrarPago(datos, 'P1', facturas));
    const pago: DocLeido = { id: 'P1', datos: tras.get('pagos/P1') as D };
    const frescas = new Map<string, D | null>([['F1', tras.get('facturas_clientes/F1') ?? null], ['F2', tras.get('facturas_clientes/F2') ?? null]]);
    const final = aplicarPlanEnMemoria(tras, planEliminarPago(pago, frescas));
    expect(final.has('pagos/P1')).toBe(false);
    expect(final.get('facturas_clientes/F1')).toMatchObject({ montoPagado: 0, saldoPendiente: 1000, statusPago: '' });
    expect(final.get('facturas_clientes/F2')).toMatchObject({ montoPagado: 100, saldoPendiente: 400, statusPago: 'PARCIAL', pagosIds: ['P0'] });
  });
  it('rechaza: saldo insuficiente (otro usuario pagó), monedas distintas, más aplicado que recibido', () => {
    const pagada = new Map(facturas); pagada.set('F1', { ...(facturas.get('F1') as D), montoPagado: 900 });
    expect(() => planRegistrarPago(datos, 'P1', pagada)).toThrow(/ya no tiene saldo suficiente/);
    const mezcladas = new Map(facturas); mezcladas.set('F2', { ...(facturas.get('F2') as D), monedaFacturacion: 'MXN' });
    expect(() => planRegistrarPago(datos, 'P1', mezcladas)).toThrow(/monedas distintas/);
    expect(() => planRegistrarPago({ ...datos, monto: 1000 }, 'P1', facturas)).toThrow(/más dinero del recibido/);
  });
  it('una factura repetida en el mismo pago se rechaza (se aplicaría y revertiría doble)', () => {
    const repetida = { ...datos, aplicacion: [datos.aplicacion[0], { ...datos.aplicacion[0], aplicado: 50 }] };
    expect(() => planRegistrarPago(repetida, 'P1', facturas)).toThrow(/aparece dos veces/);
  });
  it('editar: agrega una factura con su saldo fresco y suma al monto del pago', () => {
    const pago: DocLeido = { id: 'P1', datos: { tipo: 'cliente', monto: 1000, facturas: [{ facturaId: 'F1', aplicado: 1000 }] } };
    const plan = planEditarPago(pago, {
      fecha: '2026-10-11', numeroPago: 'PAGO-1', referencia: '', metodoPago: 'Transferencia', observaciones: '', pdfUrl: '', pdfNombre: '', editadoEn: AHORA, editadoPor: 'u',
      agregadas: [{ facturaId: 'F2', invoice: 'A-2', fecha: '', total: 500, saldoAnterior: 400, aplicado: 400, saldoNuevo: 0 }],
    }, facturas);
    const e = escrituraDe(plan, 'pagos', 'P1');
    expect(e?.tipo === 'combinar' && e.datos).toMatchObject({ monto: 1400, montoAplicado: 1400, fecha: '2026-10-11' });
    expect(plan.facturas.F2).toMatchObject({ montoPagado: 500, statusPago: 'PAGADA' });
  });
});

// ✅ V00502 — resultados del buscador global: qué se muestra y a dónde lleva cada uno.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD, STATUS_CANCELADO, STATUS_COMPLETADOS } from '../../../shared/dominio/constantes';
import {
  fmtMonto, resultadosConvenios, resultadosEmpleados, resultadosEmpresas, resultadosFacturas, resultadosOperaciones,
  resultadosPagos, resultadosRemolques, resultadosUnidades,
} from './resultados';

describe('resultadosOperaciones', () => {
  const ops = [
    { id: 'o1', ref: 'TR-261026-004', status: 'a1', statusNombre: '3. Documentado (Asignado)', clienteNombre: 'Landstar', refCliente: 'PO-77', remolqueNombre: '514105 254551', fechaServicio: '2026-10-26' },
    { id: 'o2', ref: 'TR-261026-003', status: STATUS_COMPLETADOS[0], statusNombre: STATUS_COMPLETADOS[0], fechaServicio: '26/10/2026' },
    { id: 'o3', ref: 'TR-261026-002', status: STATUS_CANCELADO, fechaServicioISO: '2026-10-26' },
    { id: 'o1', ref: 'TR-261026-004' }, // repetida (salió en dos consultas)
  ];
  it('una vez cada una; abre en la pestaña de su status; el status sin nombre dice su grupo', () => {
    const r = resultadosOperaciones(ops, 'tr-261026');
    expect(r.map((x) => [x.titulo, x.destino.modulo, x.estado?.texto])).toEqual([
      ['TR-261026-004', 'operaciones', '3. Documentado (Asignado)'],
      ['TR-261026-003', 'serviciosCompletados', 'Completada'],
      ['TR-261026-002', 'serviciosCancelados', 'Cancelada'],
    ]);
    expect(r[0]).toMatchObject({ detalle: 'Landstar · Ref. cliente PO-77 · Remolque 514105 254551', fecha: '2026-10-26', destino: { id: 'o1' } });
    expect(r[1].fecha).toBe('2026-10-26');
  });
  it('el nombre y el grupo del status salen del catálogo cuando se lo pasan', () => {
    const r = resultadosOperaciones([{ id: 'o9', ref: 'TR-9', status: 's77', statusNombre: 's77' }], 'tr-9', new Map([['s77', '9. Cancelado por el cliente']]));
    expect(r[0]).toMatchObject({ estado: { texto: '9. Cancelado por el cliente', tono: 'alerta' }, destino: { modulo: 'serviciosCancelados' } });
  });
  it('encuentra por ref. cliente y por remolque', () => {
    expect(resultadosOperaciones(ops, 'po-77').map((x) => x.titulo)).toEqual(['TR-261026-004']);
    expect(resultadosOperaciones(ops, '514105').map((x) => x.titulo)).toEqual(['TR-261026-004']);
  });
});

describe('resultadosFacturas', () => {
  const facs = [
    { id: 'f1', invoice: '39785', clienteId: 'e1', clienteNombre: 'SET FREIGHT INTERNATIONAL LLC', fecha: '2026-10-23', monedaFacturacion: ID_USD, subtotalMonedaFactura: 150 },
    { id: 'f2', invoice: '39785', clienteId: 'e1', clienteNombre: 'SET FREIGHT INTERNATIONAL LLC', subtotalMonedaFactura: 50 }, // mismo grupo
    { id: 'f3', invoice: '38928', clienteId: 'e1', clienteNombre: 'SET FREIGHT INTERNATIONAL LLC', monedaFacturacion: ID_MXN, subtotalMonedaFactura: 135, montoPagado: 135, saldoPendiente: 0 },
    { id: 'f4', invoice: '39000', clienteId: 'e2', clienteNombre: 'Landstar', statusFactura: 'Cancelado' },
  ];
  it('por invoice, una vez por grupo, con total, moneda, estado y destino de Facturación', () => {
    const r = resultadosFacturas(facs, 'cliente', '39785');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ titulo: 'Invoice 39785', detalle: 'SET FREIGHT INTERNATIONAL LLC', fecha: '2026-10-23', monto: '$150.00 USD', estado: { texto: 'Abierta' }, destino: { modulo: 'facturacionClientes', id: 'f1' } });
  });
  it('por empresa, por monto; pagadas y canceladas con su estado', () => {
    expect(resultadosFacturas(facs, 'cliente', 'set freight').map((x) => x.titulo)).toEqual(['Invoice 39785', 'Invoice 38928']);
    expect(resultadosFacturas(facs, 'cliente', '135')[0]).toMatchObject({ titulo: 'Invoice 38928', monto: '$135.00 MXN', estado: { texto: 'Pagada' } });
    expect(resultadosFacturas(facs, 'cliente', 'landstar')[0].estado).toEqual({ texto: 'Cancelada', tono: 'alerta' });
    expect(resultadosFacturas([{ id: 'p1', invoice: 'A-1', proveedorNombre: 'Transportes X', monedaProveedor: 'MXN' }], 'proveedor', 'a-1')[0])
      .toMatchObject({ titulo: 'Factura de proveedor A-1', destino: { modulo: 'facturacionProveedores', id: 'p1' } });
  });
});

describe('resultadosPagos', () => {
  it('por número, empresa o invoice aplicado; lleva a Pagos con su pestaña', () => {
    const pagos = [{ id: 'g1', numeroPago: 'PAGO-261026-101500', entidadNombre: 'Landstar', monto: 280, moneda: 'USD', fecha: '2026-10-26', facturas: [{ invoice: '39781' }, { invoice: '39780' }] }];
    const r = resultadosPagos(pagos, 'cliente', '39780');
    expect(r[0]).toMatchObject({ titulo: 'Pago PAGO-261026-101500', detalle: 'Landstar · Pago de cliente · Facturas 39781, 39780', monto: '$280.00 USD', destino: { modulo: 'pagos', id: 'g1', tipo: 'cliente' } });
  });
});

describe('catálogos', () => {
  it('empresas por nombre, razón social o RFC', () => {
    const r = resultadosEmpresas([{ id: 'e1', nombre: 'A. Castañeda & Co. Inc.', rfcTaxId: 'ACA010101AAA', numCliente: 12, status: 'Activa' }], 'castaneda');
    expect(r[0]).toMatchObject({ titulo: 'A. Castañeda & Co. Inc.', detalle: 'ACA010101AAA · Cliente #12', destino: { modulo: 'empresas', id: 'e1' } });
    expect(r[0].estado).toBeUndefined();
    expect(resultadosEmpresas([{ id: 'e1', nombre: 'X', rfcTaxId: 'ACA010101AAA' }], 'aca0101')).toHaveLength(1);
  });
  it('convenios: el nombre de la empresa sale del convenio maestro; lleva a su fila', () => {
    const r = resultadosConvenios(
      [{ id: 'd1', convenioId: 'c1', consecutivo: 'CONV-001', origenNombre: 'Nuevo Laredo', destinoNombre: 'Laredo TX', tipoConvenioNombre: 'Cruce de importación', costo: 140, moneda: 'USD', status: 'Aprobado' }],
      [{ id: 'c1', clienteNombre: 'Landstar', numeroConvenio: 'C-10' }], 'clientes', 'landstar laredo');
    expect(r[0]).toMatchObject({ titulo: 'Convenio CONV-001', detalle: 'Landstar · Nuevo Laredo → Laredo TX · Cruce de importación', monto: '$140.00 USD', destino: { modulo: 'detallesConvenioClientes', id: 'd1' } });
  });
  it('empleados, unidades (propias y de proveedor) y remolques', () => {
    expect(resultadosEmpleados([{ id: 'x1', firstName: 'Jesús', lastNamePaternal: 'Molero', employeeId: 'Emp-001', cargoNombre: 'Operador', activo: false }], 'jesus molero')[0])
      .toMatchObject({ titulo: 'Jesús Molero', detalle: 'Emp-001 · Operador', estado: { texto: 'Inactivo' }, destino: { modulo: 'colaboradores', id: 'x1' } });
    const u = resultadosUnidades([{ id: 'u1', unidad: '1012', placas: 'ABC123', marca: 'Kenworth', modelo: 'T680' }], [{ id: 'up1', numeroUnidad: '1012-P', proveedorNombre: 'Fletes X' }], '1012');
    expect(u.map((x) => [x.titulo, x.destino.modulo])).toEqual([['Unidad 1012', 'unidades'], ['Unidad de proveedor 1012-P', 'unidadesProveedor']]);
    expect(resultadosRemolques([{ id: 'r1', nombre: 'MRVC25382', placas: 'P-1', tipoNombre: 'Caja seca' }], 'mrvc')[0])
      .toMatchObject({ titulo: 'Remolque MRVC25382', detalle: 'Placas P-1 · Caja seca', destino: { modulo: 'remolques', id: 'r1' } });
  });
});

describe('fmtMonto', () => {
  it('con miles, 2 decimales y la moneda si se reconoce', () => {
    expect(fmtMonto(132000, ID_MXN)).toBe('$132,000.00 MXN');
    expect(fmtMonto('2986.72', 'Dólares')).toBe('$2,986.72 USD');
    expect(fmtMonto(5, '')).toBe('$5.00');
  });
});

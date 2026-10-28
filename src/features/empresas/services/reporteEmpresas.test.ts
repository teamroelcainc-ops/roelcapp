// ✅ V00507 — Reporte de empresas: categorías, papeles, clases (impo / expo / otros) y direcciones.
import { describe, expect, it } from 'vitest';
import { STATUS_CANCELADO, STATUS_COMPLETADOS, TIPO_EMPRESA } from '../../../shared/dominio/constantes';
import { armarReporteEmpresas, claseDeOperacion, otrosDe } from './reporteEmpresas';

/** Como llegan de los listeners: `_docId` no enumerable; un `id` guardado gana en `id`. */
const vivo = (docId: string, datos: Record<string, unknown>) => {
  const d = { id: docId, ...datos };
  Object.defineProperty(d, '_docId', { value: docId, enumerable: false });
  return d;
};

const tiposEmpresa = [
  vivo(TIPO_EMPRESA.clientePaga, { tipo: 'Cliente (Paga)' }),
  vivo('Xa9F2kQ', { id: TIPO_EMPRESA.proveedorUnidad, tipo: 'Proveedor (Transporte)' }),
  vivo('cm000001', { tipo: 'Cliente (Mercancía)' }),
  vivo(TIPO_EMPRESA.bodega, { tipo: 'Bodega' }),
];
const direcciones = [
  vivo('d1', { calleNombre: 'Av. Reforma', numExterior: '100', coloniaNombre: 'Centro', municipioNombre: 'Nuevo Laredo', estadoNombre: 'Tamaulipas', cpNombre: '88000', paisNombre: 'México', direccionCompleta: 'Av. Reforma 100, Centro, Nuevo Laredo' }),
  vivo('d2', { calleNombre: 'Calle Bodega', numExterior: '5', municipioNombre: 'Laredo', estadoNombre: 'Texas', paisNombre: 'USA' }),
];
const empresas = [
  // A: cliente; su dirección de "Cliente (Paga)" es d1 y la general es d2.
  vivo('empA', { nombre: 'Alfa Logística', numCliente: 'EMP-1', status: 'Activa', tiposEmpresa: [TIPO_EMPRESA.clientePaga],
    direccionId: 'd2', direccionLabel: 'Calle Bodega 5', direccionesPorTipo: [{ tipoNombre: 'Cliente (Paga)', direccionId: 'd1', direccionNombre: 'Av. Reforma 100' }] }),
  // B: proveedor de transporte, con el tipo guardado con el id de AppSheet y un id de AppSheet propio.
  vivo('empB', { id: 'ab12cd34', nombre: 'Transportes Beta', numCliente: 'EMP-2', tiposEmpresa: [TIPO_EMPRESA.proveedorUnidad], direccion: 'Carretera 85 km 3' }),
  // C: cliente (mercancía) y proveedor.
  vivo('empC', { nombre: 'Gamma', tiposEmpresa: [{ id: 'cm000001', nombre: 'Cliente (Mercancía)' }, 'Xa9F2kQ'] }),
  // D: bodega sin operaciones → no sale.
  vivo('empD', { nombre: 'Bodega Delta', tiposEmpresa: [TIPO_EMPRESA.bodega] }),
  // E: sin tipo, pero es cliente en una operación → sale en Clientes.
  vivo('empE', { nombre: 'Épsilon' }),
];
const trafico = [vivo('tr1', { trafico: 'Exportación' })];
const status = [vivo('st-falso', { nombre: '15. Falso' })];

const op = (ref: string, extra: Record<string, unknown>) => ({ id: ref, ref, status: 's3', _fechaISO: '2026-10-01', ...extra });
const operaciones = [
  op('TR-1', { convenioNombre: 'IMPO TRANSFER', clientePaga: 'empA', proveedorUnidad: 'empB', _fechaISO: '2026-10-05' }),
  op('TR-2', { tipoServicio: 'Exportación', clientePaga: 'empA', proveedorUnidad: 'Transportes  BETA' }), // proveedor por nombre (registro viejo)
  op('TR-3', { convenioNombre: 'IMPO', status: STATUS_COMPLETADOS[0], statusNombre: 'Falso', clientePaga: 'empA', proveedorUnidad: 'ab12cd34' }), // id de AppSheet
  op('TR-4', { convenioNombre: 'IMPO', status: STATUS_CANCELADO, clientePaga: 'empA', proveedorUnidad: 'empB' }),
  op('TR-5', { movimientoManual: 'Movimiento', clientePaga: 'empC', clienteMercancia: 'empC', proveedorUnidad: 'empC' }),
  op('TR-6', { trafico: 'tr1', clientePaga: 'empE' }),
  op('TR-7', { clientePaga: 'ffffffff' }), // cliente que no está en Empresas, sin proveedor
  op('PR.8', { convenioNombre: 'IMPO', clientePaga: 'empA' }), // prueba: no cuenta
  op('TR-9', { convenioNombre: 'IMPO', clientePaga: 'empA', clienteMercancia: 'empC', status: 'st-falso' }), // falso por el catálogo
];

const r = armarReporteEmpresas({ empresas, operaciones, tiposEmpresa, direcciones, status, trafico });
const fila = (lista: typeof r.clientes, nombre: string) => lista.find((f) => f.nombre === nombre);

describe('armarReporteEmpresas', () => {
  it('clientes y proveedores por su tipo o por sus operaciones; una empresa puede estar en las dos', () => {
    expect(r.clientes.map((f) => f.nombre)).toEqual(['Alfa Logística', 'Gamma', 'Épsilon']);
    expect(r.proveedores.map((f) => f.nombre)).toEqual(['Transportes Beta', 'Gamma']);
    expect(fila(r.clientes, 'Gamma')?.tipos).toBe('Cliente (Mercancía), Proveedor (Transporte)');
  });

  it('cuenta impo, expo y otros; canceladas y de prueba no cuentan; en falso va a Otros', () => {
    const a = fila(r.clientes, 'Alfa Logística')?.conteo;
    expect(a).toEqual({ total: 4, importacion: 1, exportacion: 1, movimiento: 0, falso: 2, sinClasificar: 0, ultima: '2026-10-05' });
    expect(a && otrosDe(a)).toBe(2);
    expect(fila(r.proveedores, 'Transportes Beta')?.conteo).toMatchObject({ total: 3, importacion: 1, exportacion: 1, falso: 1 });
    expect(r.revisadas).toBe(8);
    expect(r.canceladas).toBe(1);
  });

  it('una operación cuenta una vez por empresa; los totales son operaciones distintas', () => {
    expect(fila(r.clientes, 'Gamma')?.conteo).toMatchObject({ total: 2, movimiento: 1, falso: 1 });
    expect(fila(r.proveedores, 'Gamma')?.conteo).toMatchObject({ total: 1, movimiento: 1 });
    expect(r.totales.cliente.total).toBe(6); // TR-1, 2, 3, 5, 6 y 9 (TR-7 no tiene empresa)
    expect(r.totales.proveedor.total).toBe(4);
    expect(r.sinEmpresa).toEqual({ cliente: 1, proveedor: 0 });
    expect(r.sinPapel).toEqual({ cliente: 0, proveedor: 3 }); // TR-6, TR-7 y TR-9
  });

  it('sin clasificar por texto: usa el tráfico de la operación', () => {
    expect(fila(r.clientes, 'Épsilon')?.conteo).toMatchObject({ total: 1, exportacion: 1 });
  });

  it('dirección: la del tipo de la categoría primero, la general después; sin documento, el texto guardado', () => {
    const a = fila(r.clientes, 'Alfa Logística');
    expect(a?.direccion).toMatchObject({ completa: 'Av. Reforma 100, Centro, Nuevo Laredo', municipio: 'Nuevo Laredo', estado: 'Tamaulipas', cp: '88000' });
    expect(a?.otrasDirecciones).toBe('Calle Bodega 5, Laredo, Texas, USA');
    expect(fila(r.proveedores, 'Transportes Beta')?.direccion).toMatchObject({ completa: 'Carretera 85 km 3', calle: '' });
    expect(fila(r.clientes, 'Épsilon')?.direccion.completa).toBe('');
  });
});

describe('claseDeOperacion', () => {
  const sinNombre = () => undefined;
  const igual = (v: unknown) => String(v ?? '');
  it('la clasificación manual y el texto mandan; el tráfico es respaldo', () => {
    expect(claseDeOperacion({ movimientoManual: 'Exportación', convenioNombre: 'IMPO' }, sinNombre, igual)).toBe('exportacion');
    expect(claseDeOperacion({ convenioNombre: 'Importación Logística', trafico: 'Exportación' }, sinNombre, igual)).toBe('importacion');
    expect(claseDeOperacion({ trafico: 'Movimiento' }, sinNombre, igual)).toBe('movimiento');
    expect(claseDeOperacion({ trafico: 'N/A' }, sinNombre, igual)).toBe('sinClasificar');
  });
  it('cancelada y en falso por el status', () => {
    expect(claseDeOperacion({ status: STATUS_CANCELADO, convenioNombre: 'IMPO' }, sinNombre, igual)).toBe('cancelada');
    expect(claseDeOperacion({ status: 'x', statusNombre: 'Servicio en Falso', convenioNombre: 'EXPO' }, sinNombre, igual)).toBe('falso');
  });
});

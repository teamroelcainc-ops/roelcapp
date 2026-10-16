// ✅ V00457 — historial del Saldo Diesel (tarjeta de Operaciones Activas).
import { describe, expect, it } from 'vitest';
import { CLAVE_TODOS_DIESEL, cuentasDiesel, cuentasDieselDesdeReferencias, type SaldoCorrienteDiesel } from '../../../shared/dominio/saldosCorrientes';
import { cargasDelDia, cuentasDeSaldos, diasDesdeCorrientes, diasDesdeReferencias, movimientosDiesel, movimientosEnRango, resumenDiesel } from './movimientosDiesel';
import { incluyeId, nombreProveedorDiesel, proveedoresDeDiesel, TIPO_SERVICIO_DIESEL } from '../../diesel/services/proveedoresDiesel';
import { TIPO_EMPRESA } from '../../../shared/dominio/constantes';

const saldos = [
  { id: 's1', fecha: '2026-10-10', hora: '08:00', proveedorId: CLAVE_TODOS_DIESEL, proveedorNombre: 'Todos los proveedores', saldo: 500, moneda: 'Dólares', registradoPor: 'Ana' },
  { id: 's2', fecha: '2026-10-14', hora: '09:00', proveedorId: CLAVE_TODOS_DIESEL, proveedorNombre: 'Todos los proveedores', saldo: 200, moneda: 'Dólares' },
];
const refs = [
  { id: 'r0', consecutivo: 'D-0', fecha: '2026-10-09', proveedorId: 'p1', proveedorNombre: 'Pilot', totalCargado: 50 },
  { id: 'r1', consecutivo: 'D-1', fecha: '2026-10-10', proveedorId: 'p1', proveedorNombre: 'Pilot', totalCargado: 100, galonesCargados: 20, costoDiesel: 5, unidadNombre: 'UND.10' },
  { id: 'r2', consecutivo: 'D-2', fecha: '2026-10-10', proveedorId: 'p2', proveedorNombre: 'Murphy', galonesCargados: 10, costoDiesel: 5 },
  { id: 'r3', consecutivo: 'D-3', fecha: '2026-10-14', proveedorId: 'p1', proveedorNombre: 'Pilot', totalCargado: 80, galonesCargados: 16 },
  { id: 'r4', consecutivo: 'D-4', fecha: '2026-10-15T10:00', proveedorNombre: 'Pilot', totalCargado: 20 },
  { id: 'r5', consecutivo: 'D-5', fecha: '2026-10-15', proveedorId: 'p1', totalCargado: 0 },
];

describe('historial del saldo de diesel', () => {
  it('con las referencias: saldos y cargas por día con el saldo corrido, y cuadra con la tarjeta', () => {
    const cuentas = cuentasDeSaldos(saldos);
    expect(cuentas.map((c) => [c.clave, c.primera])).toEqual([[CLAVE_TODOS_DIESEL, '2026-10-10']]);
    const movs = movimientosDiesel(cuentas, (c) => diasDesdeReferencias(c, refs));
    expect(movs.map((m) => [m.fecha, m.tipo, m.abono, m.cargo, m.cargas, m.saldo])).toEqual([
      ['2026-10-15', 'cargas', 0, 20, 1, 450],
      ['2026-10-14', 'cargas', 0, 80, 1, 470],
      ['2026-10-14', 'saldo', 200, 0, 0, 550],
      ['2026-10-10', 'cargas', 0, 150, 2, 350],
      ['2026-10-10', 'saldo', 500, 0, 0, 500],
    ]);
    expect(movs[3].galones).toBe(30);
    expect(movs[4].registradoPor).toBe('Ana');
    const tarjeta = cuentasDieselDesdeReferencias(saldos, refs, '2026-10-16');
    expect(movs[0].saldo).toBeCloseTo(tarjeta[0].restante, 2);
  });

  it('con los documentos de saldo corriente (bandera): las mismas cifras, sin galones', () => {
    const corrientes: SaldoCorrienteDiesel[] = [
      { tipo: 'diesel', clave: CLAVE_TODOS_DIESEL, nombre: 'Todos los proveedores', dias: { '2026-10-09': { c: 5000, n: 1 }, '2026-10-10': { c: 15000, n: 2 }, '2026-10-14': { c: 8000, n: 1 }, '2026-10-15': { c: 2000, n: 1 } } },
      { tipo: 'diesel', clave: 'p1', nombre: 'Pilot', dias: { '2026-10-10': { c: 10000, n: 1 } } },
    ];
    const cuentas = cuentasDeSaldos(saldos);
    const movs = movimientosDiesel(cuentas, (c) => diasDesdeCorrientes(c, corrientes));
    expect(movs.map((m) => m.saldo)).toEqual([450, 470, 550, 350, 500]);
    expect(movs.every((m) => m.galones === null)).toBe(true);
    expect(movs[0].saldo).toBeCloseTo(cuentasDiesel(saldos, corrientes, '2026-10-16')[0].restante, 2);
  });

  it('cuadra al centavo con la tarjeta aunque el Total Cargado venga sin redondear', () => {
    const s = [{ id: 'g', fecha: '2026-10-01', hora: '07:00', proveedorId: CLAVE_TODOS_DIESEL, proveedorNombre: 'Todos los proveedores', saldo: 2000, moneda: 'Dólares' }];
    const r = [[150.5, 3.459], [98.3, 3.461], [120.7, 3.457], [33.3, 3.4567]].map(([g, c], i) => ({ id: `u${i}`, fecha: `2026-10-0${2 + (i % 2)}`, proveedorId: 'p1', galonesCargados: g, costoDiesel: c, totalCargado: g * c }));
    const movs = movimientosDiesel(cuentasDeSaldos(s), (c) => diasDesdeReferencias(c, r));
    expect(movs[0].saldo.toFixed(2)).toBe(cuentasDieselDesdeReferencias(s, r, '2026-10-16')[0].restante.toFixed(2));
  });

  it('cuenta de UN proveedor: solo sus cargas (por ID o por nombre) desde su primer saldo', () => {
    const s = [{ id: 'x', fecha: '2026-10-10', hora: '07:00', proveedorId: 'p1', proveedorNombre: 'Pilot', saldo: 300, moneda: 'Dólares' }];
    const cuentas = cuentasDeSaldos(s);
    const movs = movimientosDiesel(cuentas, (c) => diasDesdeReferencias(c, refs));
    // r1 (10/10, 100) + r3 (10/14, 80) + r4 por nombre (10/15, 20); r0 es anterior; r2 es de otro proveedor
    expect(movs.map((m) => [m.fecha, m.cargo, m.saldo])).toEqual([['2026-10-15', 20, 100], ['2026-10-14', 80, 120], ['2026-10-10', 100, 200], ['2026-10-10', 0, 300]]);
  });

  it('rango de fechas, totales y cargas de un día', () => {
    const movs = movimientosDiesel(cuentasDeSaldos(saldos), (c) => diasDesdeReferencias(c, refs));
    const enRango = movimientosEnRango(movs, '2026-10-14', '2026-10-14');
    expect(enRango).toHaveLength(2);
    expect(resumenDiesel(enRango)).toEqual({ abonos: 200, cargos: 80, cargas: 1 });
    expect(movimientosEnRango(movs, '', '')).toHaveLength(5);
    const dia = cargasDelDia(refs, { clave: CLAVE_TODOS_DIESEL, nombre: 'Todos los proveedores' }, '2026-10-10');
    expect(dia.map((c) => [c.consecutivo, c.unidad, c.galones, c.total])).toEqual([['D-1', 'UND.10', 20, 100], ['D-2', '—', 10, 50]]);
    expect(cargasDelDia(refs, { clave: 'p2', nombre: 'Murphy' }, '2026-10-10').map((c) => c.id)).toEqual(['r2']);
    expect(cargasDelDia(refs, { clave: 'p1', nombre: 'Pilot' }, '2026-10-15').map((c) => c.id)).toEqual(['r4']);
  });
});

describe('proveedores de diesel', () => {
  it('filtra por tipo de empresa y servicio en cualquier formato heredado', () => {
    expect(incluyeId(['a', 'b'], 'b')).toBe(true);
    expect(incluyeId('a, b c', 'c')).toBe(true);
    expect(incluyeId({ x: 'b' }, 'b')).toBe(true);
    expect(incluyeId({ b: true }, 'b')).toBe(true);
    expect(incluyeId(undefined, 'b')).toBe(false);
    const empresas = [
      { id: '2', nombre: 'Pilot', tiposEmpresa: [TIPO_EMPRESA.proveedorServicios], tiposServicio: TIPO_SERVICIO_DIESEL },
      { id: '1', nombre: 'Murphy', tiposEmpresa: `${TIPO_EMPRESA.proveedorServicios}`, tiposServicio: [TIPO_SERVICIO_DIESEL] },
      { id: '3', nombre: 'Cliente', tiposEmpresa: ['otro'], tiposServicio: [TIPO_SERVICIO_DIESEL] },
    ];
    expect(proveedoresDeDiesel(empresas).map((e) => e.nombre)).toEqual(['Murphy', 'Pilot']);
    expect(nombreProveedorDiesel(empresas, '2')).toBe('Pilot');
    expect(nombreProveedorDiesel(empresas, 'zz')).toBe('zz');
    expect(nombreProveedorDiesel(empresas, '')).toBe('-');
  });
});

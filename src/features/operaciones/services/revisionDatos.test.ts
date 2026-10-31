// ✅ V00505 — Revisión de datos: cada grupo del reporte del 27-oct con casos de ejemplo.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD, STATUS_CANCELADO, STATUS_COMPLETADOS } from '../../../shared/dominio/constantes';
import type { Moneda } from '../../../shared/dominio/moneda';
import { filasExcelRevision, filtrarPorFechas, revisarDatos } from './revisionDatos';
import type { FacturaRevision, OpRevision } from './revisionDatos';

const COMPLETADA = { status: STATUS_COMPLETADOS[0], statusNombre: '14. Servicio Completado' };
const CANCELADA = { status: STATUS_CANCELADO, statusNombre: 'Cancelado' };
const ACTIVA = { status: 's3', statusNombre: '3. Documentado (Asignado)' };
const MONEDAS = new Map<string, Moneda>([['e1', 'USD'], ['e2', 'MXN']]);

/** Operación bien capturada: convenio 100 USD cobrado en dólares, TC 18.5. */
const op = (idDoc: string, ref: string, extra: Record<string, unknown> = {}): OpRevision => ({
  idDoc, id: idDoc, ref, fechaServicio: '2026-10-01', ...COMPLETADA, clientePaga: 'e1', clienteNombre: 'Acme', convenio: 'cv1',
  montoConvenioCliente: 100, cargosAdicionales: 0, tipoCambioDia: 18.5, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD,
  dolaresCliente: 100, pesosCliente: 0, conversionCliente: 1850, ...extra,
});
const factura = (id: string, invoice: string, extra: Record<string, unknown>): FacturaRevision => ({
  id, invoice, clienteId: 'e1', clienteNombre: 'Acme', fecha: '2026-10-02', statusFactura: 'Facturado', monedaFacturacion: 'USD',
  operacionesIds: [], operaciones: [], operacionesGuardadas: [], ...extra,
});
const facturada = (inv: string) => ({ facturado: true, facturaClienteId: `id-${inv}`, facturaClienteInvoice: inv });

const ops: OpRevision[] = [
  op('o1', 'TR-1', facturada('A-1')),
  op('o2', 'TR-2'), // en A-1 sin marca → F1
  op('o3', 'TR-3', facturada('A-1')), op('o4', 'tr-3 ', { ...facturada('A-1'), fechaServicio: '2026-09-01' }), // D2
  op('o5', 'TR-5', { facturado: true, facturaClienteInvoice: 'ZZZ' }), // F3 (C-1 la lista)
  op('o6', 'TR-6', CANCELADA), // D6
  op('o7', 'TR-7'), // F5 (solo en una factura cancelada)
  op('o8', 'TR-8', { ...facturada('A-1'), status: '', statusNombre: '' }), // D3
  op('o9', 'TR-9', { ...facturada('A-1'), clientePaga: 'e2' }), // D1 (+ D4: con la moneda de la empresa no cuadra)
  op('o10', 'TR-10', { ...facturada('A-1'), ...ACTIVA, convenio: '', montoConvenioCliente: 0, dolaresCliente: 0, conversionCliente: 0 }), // D5
];
const facturas: FacturaRevision[] = [
  // A-1: lista o1 y o2 por id; su total cuadra (2 × 100).
  factura('fA', 'A-1', { operacionesIds: ['o1', 'o2'], operacionesGuardadas: [{ id: 'o1', ref: 'TR-1', dol: 100 }, { id: 'o2', ref: 'TR-2', dol: 100 }] }),
  // B-9: lista o1 por su REFERENCIA → o1 queda en dos folios (F4).
  factura('fB', 'B-9', { operaciones: ['TR-1'], subtotalMonedaFactura: 100 }),
  // C-1: lista o5 → sugerencia para F3.
  factura('fC', 'C-1', { operacionesIds: ['o5'], subtotalMonedaFactura: 100 }),
  // D-1 cancelada: lista o7 (no cuenta).
  factura('fD', 'D-1', { statusFactura: 'Cancelado', operacionesIds: ['o7'], subtotalMonedaFactura: 100 }),
  // E-1: total 500 contra 100 de su operación → F2. TR-3 está repetida: no se liga.
  factura('fE', 'E-1', { operacionesIds: ['o9'], operaciones: ['TR-3'], subtotalMonedaFactura: 500 }),
  // G-1: 100.50 contra 100 → centavos.
  factura('fG', 'G-1', { operacionesIds: ['o1'], subtotalMonedaFactura: 100.5 }),
];

const r = revisarDatos({ operaciones: ops, facturas, monedaEmpresa: MONEDAS, reglaUnica: true });
const de = (codigo: string) => r.filas.filter((f) => f.codigo === codigo);

describe('revisarDatos', () => {
  it('F4: la operación en dos o más folios no cancelados, con enlace a cada factura', () => {
    expect(de('F4').map((f) => f.ref)).toEqual(['TR-1']);
    const [f4] = de('F4');
    expect(f4.detalle).toContain('En 3 facturas');
    expect(f4.enlaces.map((e) => e.destino)).toEqual([
      { modulo: 'facturacionClientes', id: 'fA' }, { modulo: 'facturacionClientes', id: 'fB' }, { modulo: 'facturacionClientes', id: 'fG' },
    ]);
    expect(f4.destino).toEqual({ modulo: 'serviciosCompletados', id: 'o1' });
  });
  it('F1: en una factura, sin Invoice ni marca de facturada', () => {
    expect(de('F1').map((f) => f.ref)).toEqual(['TR-2']);
    expect(de('F1')[0].detalle).toContain('A-1');
  });
  it('D2: referencias repetidas (sin mayúsculas ni espacios), cada una con enlace a la otra', () => {
    expect(r.referenciasRepetidas).toBe(1);
    expect(de('D2').map((f) => f.destino.id).sort()).toEqual(['o3', 'o4']);
    expect(de('D2').find((f) => f.destino.id === 'o3')?.enlaces[0].destino.id).toBe('o4');
  });
  it('F3: Invoice que no existe, con el sugerido si una sola factura la lista', () => {
    expect(de('F3').map((f) => f.ref)).toEqual(['TR-5']);
    expect(de('F3')[0].detalle).toBe('El Invoice "ZZZ" no existe en Facturas · Invoice sugerido: C-1 (la factura que la lista)');
  });
  it('D1, D4 y D5 con la regla del Excel de operaciones', () => {
    expect(de('D1').map((f) => f.ref)).toEqual(['TR-9']);
    expect(de('D1')[0].detalle).toContain('Ya facturada');
    expect(de('D4').map((f) => f.ref)).toEqual(['TR-9']);
    expect(de('D5').map((f) => f.ref)).toEqual(['TR-10']);
    expect(de('D5')[0].destino.modulo).toBe('operaciones'); // activa → Operaciones Activas
  });
  it('F2 y F2c: factura contra la suma de sus operaciones en su moneda; centavos aparte', () => {
    expect(de('F2').map((f) => f.ref)).toEqual(['E-1']);
    expect(de('F2')[0].detalle).toMatch(/^Factura \$500\.00 USD · operaciones \$100\.00 USD · diferencia \$400\.00 \(1 operación, 1 que no se encontraron\)$/);
    expect(de('F2c').map((f) => f.ref)).toEqual(['G-1']);
    expect(r.sinLigar).toBe(1);
  });
  it('D6: canceladas con monto; F5: terminadas sin facturar (una factura cancelada no cuenta); D3: sin status', () => {
    expect(de('D6').map((f) => f.ref)).toEqual(['TR-6']);
    expect(de('D6')[0].destino.modulo).toBe('serviciosCancelados');
    expect(de('F5').map((f) => f.ref)).toEqual(['TR-7']);
    expect(de('D3').map((f) => f.ref)).toEqual(['TR-8']);
  });
  it('D3: un status fijo de la app (Cancelado, Completado) sin nombre guardado no cuenta como "sin status"', () => {
    const sinNombre = revisarDatos({
      operaciones: [op('c1', 'TR-C1', { ...facturada('A-1'), status: STATUS_CANCELADO, statusNombre: '' }), op('c2', 'TR-C2', { status: 'zzz', statusNombre: '' })],
      facturas: [], monedaEmpresa: MONEDAS, reglaUnica: true,
    });
    expect(sinNombre.filas.filter((f) => f.codigo === 'D3').map((f) => [f.ref, f.detalle])).toEqual([['TR-C2', 'El status "zzz" no está en el catálogo']]);    // ✅ V00517: con lo guardado, para "Corregir status".
    expect(sinNombre.statusD3).toMatchObject([{ opId: 'c2', ref: 'TR-C2', status: 'zzz', statusNombre: '' }]);
    expect(filtrarPorFechas(sinNombre, '2030-01-01', '').statusD3).toEqual([]);
  });
  it('conteo por grupo, claves únicas y Excel con el grupo y dónde se corrige', () => {
    expect(r.conteo).toMatchObject({ F4: 1, F1: 1, D2: 2, F3: 1, D1: 1, D4: 1, D5: 1, F2: 1, F2c: 1, D6: 1, F5: 1, D3: 1 });
    expect(new Set(r.filas.map((f) => f.clave)).size).toBe(r.filas.length);
    const [primera] = filasExcelRevision(r);
    expect(Object.keys(primera)).toEqual(['Grupo', 'Error', 'Prioridad', 'Referencia / Invoice', 'Cliente', 'Fecha', 'Status', 'Invoice', 'Detalle', 'Dónde se corrige']);
    expect(primera).toMatchObject({ Grupo: 'F4', Prioridad: 'Alta' });
  });
  it('una factura en pesos compara contra las operaciones convertidas a pesos', () => {
    const enPesos = revisarDatos({
      operaciones: [op('p1', 'TR-P1', { ...facturada('M-1'), clientePaga: 'e2', facturadoEnCobrar: ID_MXN, dolaresCliente: 0, pesosCliente: 1850 })],
      facturas: [factura('fM', 'M-1', { clienteId: 'e2', monedaFacturacion: 'MXN', operacionesIds: ['p1'], subtotalMonedaFactura: 1850 })],
      monedaEmpresa: MONEDAS, reglaUnica: true,
    });
    expect(enPesos.filas).toEqual([]);
  });
});

describe('✅ V00512 — rango de fechas', () => {
  it('sin rango se ve todo; con rango, por fecha de servicio (o de la factura) y sin las que no tienen fecha', () => {
    const todo = filtrarPorFechas(r, '', '');
    expect(todo.filas).toHaveLength(r.filas.length);
    expect(todo.sinFecha).toBe(0);
    const sept = filtrarPorFechas(r, '2026-09-01', '2026-09-30');
    expect(sept.filas.map((f) => f.ref)).toEqual(['tr-3']); // la otra de la referencia repetida (D2)
    const octubre = filtrarPorFechas(r, '2026-10-01', '');
    expect(octubre.conteo.D2).toBe(1);
    expect(octubre.conteo.F2).toBe(r.conteo.F2); // facturas del 2-oct
    expect(octubre.marcasF1.map((m) => m.ref)).toEqual(['TR-2']);
    expect(filtrarPorFechas(r, '2026-11-01', '').marcasF1).toEqual([]);
  });
  it('las filas sin fecha no entran en un rango y se cuentan', () => {
    const sinFecha = revisarDatos({ operaciones: [op('x1', 'TR-X', { fechaServicio: '', status: '', statusNombre: '' })], facturas: [], monedaEmpresa: MONEDAS, reglaUnica: true });
    expect(filtrarPorFechas(sinFecha, '2026-01-01', '2026-12-31')).toMatchObject({ filas: [], sinFecha: sinFecha.filas.length });
  });
});

// ✅ V00539 — Planes de D2 (renumerar) y F3 (ligar o liberar).
describe('planes de Solucionar: D2 y F3', () => {
  const base = { status: 'c2d57403', statusNombre: 'Servicio Completado', clientePaga: 'C1', fechaServicio: '2026-04-27' };
  const op = (idDoc: string, extra: Record<string, unknown>) => ({ idDoc, ...base, ...extra });
  const revisar = (operaciones: Record<string, unknown>[], facturas: Record<string, unknown>[] = []) =>
    revisarDatos({ operaciones: operaciones as never, facturas: facturas as never, monedaEmpresa: new Map(), reglaUnica: false });
  it('D2: la creada primero se queda; la otra se renumera en su línea; sin fecha de creación o facturada, a mano', () => {
    const r = revisar([
      op('a', { ref: 'TR-270426-022', createdAt: '2026-04-27T10:00:00Z' }),
      op('b', { ref: 'TR-270426-022', createdAt: '2026-04-27T12:00:00Z' }),
      op('c', { ref: 'LO-010526-001' }), op('d', { ref: 'LO-010526-001', createdAt: '2026-05-01T00:00:00Z' }),
      op('e', { ref: 'X-1', createdAt: '2026-05-01T00:00:00Z' }), op('f', { ref: 'X-1', createdAt: '2026-05-02T00:00:00Z' }),
      op('g', { ref: 'FL-020526-003', createdAt: '2026-05-02T00:00:00Z' }), op('h', { ref: 'FL-020526-003', createdAt: '2026-05-03T00:00:00Z', facturaClienteInvoice: 'I1' }),
    ]);
    const porId = new Map(r.planesD2.map((p) => [p.opId, p]));
    expect(porId.get('b')).toMatchObject({ prefijo: 'TR', ddmmyy: '270426', motivo: '', seQueda: expect.stringContaining('TR-270426-022') });
    expect(porId.has('a')).toBe(false);
    expect(porId.get('d')?.motivo ?? porId.get('c')?.motivo).toMatch(/No se sabe cuál se creó primero/);
    expect(porId.get('f')?.motivo).toMatch(/LÍNEA-DDMMAA-NNN/);
    expect(porId.get('h')?.motivo).toMatch(/Está facturada/);
  });
  it('F3: ligar si una factura la lista; liberar si ninguna; a mano si hay una del cliente con el folio escrito distinto', () => {
    const r = revisar(
      [op('o1', { ref: 'TR-1', facturaClienteInvoice: 'I-8368 ' }), op('o2', { ref: 'TR-2', facturaClienteInvoice: 'ZZZ' }), op('o3', { ref: 'TR-3', facturaClienteInvoice: 'i 9000' })],
      [{ id: 'F1', invoice: 'I8399', clienteId: 'C1', operacionesIds: ['o1'] }, { id: 'F2', invoice: 'I9000', clienteId: 'C1', operacionesIds: [] }],
    );
    const porId = new Map(r.planesF3.map((p) => [p.opId, p]));
    expect(porId.get('o1')).toMatchObject({ accion: 'ligar', facturaId: 'F1', folio: 'I8399' });
    expect(porId.get('o2')).toMatchObject({ accion: 'liberar' });
    expect(porId.get('o3')).toMatchObject({ accion: 'manual', folio: 'I9000' });
    expect(filtrarPorFechas(r, '2030-01-01', '').planesF3).toEqual([]);
  });
});

// ✅ V00498 — Excel de operaciones: los valores de siempre (los del Excel de Servicios Completados),
// la unión por rango sin filtro de status y las configuraciones guardadas sobre las columnas reales.
import { describe, expect, it, vi } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';

vi.mock('../../../config/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('firebase/firestore', () => ({}));

const { conNombreDeStatus, filasExcel, nombreGuardado, valorExcelOperacion } = await import('./excelOperaciones');
const { unirOperacionesDelRango } = await import('./operacionesDelRangoExcel');
const { columnasDesdeGuardadas } = await import('./configsExportExcel');

const op = {
  id: 'abcdef123', ref: 'TR-261026-004', fechaServicio: '26/10/2026', _fechaISO: '2026-10-26',
  status: 'ab12cd34', statusNombre: '3. Documentado (Asignado)', tipoOperacionId: 't1', tipoOperacionNombre: 'Transfer',
  clientePaga: 'e1', clienteNombre: 'Acme', facturado: true, facturaClienteInvoice: '',
  facturadoEnCobrar: ID_USD, monedaCobroNombre: '', facturadoEnUnidad: ID_MXN, monedaUnidadNombre: 'pesos',
  montoConvenioCliente: '155', subtotalCliente: 155, cantidad: 0, numeroRemolque: 'r1', remolqueNombre: 'r1',
  saldoPuente: 25, saldoPuenteMoneda: 'USD',
};

describe('valorExcelOperacion', () => {
  it('nombres guardados (nunca un ID), monedas y montos como siempre', () => {
    expect(valorExcelOperacion(op, 'ref')).toBe('TR-261026-004');
    expect(valorExcelOperacion({ id: 'abcdef123' }, 'ref')).toBe('abcdef');
    expect(valorExcelOperacion(op, 'fechaServicio')).toBe('2026-10-26');
    expect(valorExcelOperacion(op, 'status')).toBe('3. Documentado (Asignado)');
    expect(valorExcelOperacion(op, 'tipoOperacion')).toBe('Transfer');
    expect(valorExcelOperacion(op, 'invoiceCliente')).toBe('Facturada');
    expect(valorExcelOperacion(op, 'facturadoEnCobrar')).toBe('USD');
    expect(valorExcelOperacion(op, 'facturadoEnUnidad')).toBe('Pesos');
    expect(valorExcelOperacion(op, 'montoConvenioCliente')).toBe(155);
    expect(valorExcelOperacion(op, 'cantidad')).toBe('');
    expect(valorExcelOperacion(op, 'remolque')).toBe('-'); // el "nombre" guardado es el mismo ID
    expect(valorExcelOperacion(op, 'saldoPuente')).toBe('$25.00 USD');
    expect(valorExcelOperacion(op, 'noExiste')).toBe('-');
  });
  it('nombreGuardado: el texto guardado; en monedas el código del ID; si no, "-"', () => {
    expect(nombreGuardado('x', 'Nombre')).toBe('Nombre');
    expect(nombreGuardado('x', 'x')).toBe('-');
    expect(nombreGuardado(ID_MXN, '', true)).toBe('MXN');
    expect(nombreGuardado('Dólares', '', true)).toBe('Dólares');
  });
  it('filas con el encabezado de cada columna, en el orden elegido', () => {
    expect(filasExcel([op], [{ id: 'status', label: 'Status' }, { id: 'ref', label: '# Referencia' }])).toEqual([{ Status: '3. Documentado (Asignado)', '# Referencia': 'TR-261026-004' }]);
  });
  it('✅ V00501: al lado de Fecha Servicio, siempre Año, Mes, Semana y Día (en ese orden)', () => {
    const [fila] = filasExcel([op], [{ id: 'ref', label: '# Referencia' }, { id: 'fechaServicio', label: 'Fecha Servicio' }, { id: 'status', label: 'Status' }]);
    expect(Object.keys(fila)).toEqual(['# Referencia', 'Fecha Servicio', 'Año', 'Mes', 'Semana', 'Día', 'Status']);
    expect(fila).toMatchObject({ 'Fecha Servicio': '2026-10-26', Año: 2026, Mes: 'octubre', Semana: 44, Día: 'lunes' });
    const [sinFecha] = filasExcel([{ id: 'x', fechaServicio: 'pendiente' }], [{ id: 'fechaServicio', label: 'Fecha Servicio' }]);
    expect(sinFecha).toEqual({ 'Fecha Servicio': 'pendiente', Año: '', Mes: '', Semana: '', Día: '' });
    expect(Object.keys(filasExcel([op], [{ id: 'ref', label: '# Referencia' }])[0])).toEqual(['# Referencia']);
  });
});

describe('conNombreDeStatus (✅ V00500)', () => {
  it('completa el status que falta o que es el ID, por ID o por nombre (AppSheet); lo guardado se respeta', () => {
    const cat = [{ id: 's3', nombre: '3. Documentado (Asignado)' }, { id: 's14', nombre: '14. Servicio Completado' }];
    const ops = [
      { id: '1', status: 's3' },
      { id: '2', status: 's3', statusNombre: 's3' },
      { id: '3', status: 's14', statusNombre: '9.1 Verde Mx' },
      { id: '4', status: '14. servicio completado' },
      { id: '5', status: 'otro' },
    ];
    expect(conNombreDeStatus(ops, cat).map((o) => valorExcelOperacion(o, 'status')))
      .toEqual(['3. Documentado (Asignado)', '3. Documentado (Asignado)', '9.1 Verde Mx', '14. Servicio Completado', '-']);
  });
});

describe('unirOperacionesDelRango', () => {
  it('une las dos consultas sin repetir, de cualquier status, solo del rango y sin pruebas', () => {
    const a = [
      { id: 'o1', datos: { ref: 'TR-1', fechaServicio: '2026-10-02', status: 'activa' } },
      { id: 'o2', datos: { ref: 'TR-2', fechaServicio: '2026-10-02', status: 'cancelada' } },
    ];
    const b = [
      { id: 'o1', datos: { ref: 'TR-1', fechaServicioISO: '2026-10-02' } },
      { id: 'o3', datos: { ref: 'TR-3', fechaServicio: '05/10/2026', fechaServicioISO: '2026-10-05', status: 'completada' } },
      { id: 'o4', datos: { ref: 'PR.TR-4', esPrueba: true, fechaServicioISO: '2026-10-06' } },
      { id: 'o5', datos: { ref: 'TR-5', fechaServicioISO: '2026-11-01' } },
    ];
    const r = unirOperacionesDelRango([a, b], '2026-10-01', '2026-10-31');
    expect(r.map((x) => [x.id, x._fechaISO])).toEqual([['o3', '2026-10-05'], ['o2', '2026-10-02'], ['o1', '2026-10-02']]);
  });
});

describe('columnasDesdeGuardadas', () => {
  it('respeta el orden guardado; las columnas nuevas van al final desmarcadas; las que ya no existen se ignoran', () => {
    const disponibles = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
    expect(columnasDesdeGuardadas([{ id: 'c', visible: true }, { id: 'x', visible: true }, { id: 'a', visible: false }], disponibles))
      .toEqual([{ id: 'c', label: 'C', visible: true }, { id: 'a', label: 'A', visible: false }, { id: 'b', label: 'B', visible: false }]);
  });
});

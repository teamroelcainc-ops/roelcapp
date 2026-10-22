// ✅ V00476 — regresar el estatus: opciones (flujo / bitácora / catálogo) y efectos (Activas, sueldo, ligas).
import { describe, expect, it } from 'vitest';
import { STATUS_COMPLETADOS } from '../../../shared/dominio/constantes';
import { efectosDelRegreso, fechaHoraCorta, opcionesDeRegreso } from './regresoStatus';
import type { StatusResuelto } from './regresoStatus';

const IDS: Record<string, string> = { '6. servicio completado': STATUS_COMPLETADOS[0], '7. falso': STATUS_COMPLETADOS[1] };
const resolver = (nombre: string): StatusResuelto => ({ id: IDS[nombre.trim().toLowerCase()] || `id-${nombre}`, nombre });
const FLUJO = ['1. Pendiente', '2. En ruta', '3. Verde Mx', '6. Servicio Completado', '7. Falso', 'Cancelado'];

describe('opciones de regreso', () => {
  it('los estatus del flujo en orden, sin el actual ni Cancelado; Completado se queda en Completados', () => {
    const r = opcionesDeRegreso({
      flujo: FLUJO, catalogo: [], actual: '7. Falso', resolver,
      historial: [
        { statusNombre: '2. En ruta', fechaHora: '2026-10-22T08:00' },
        { statusNombre: '1. Pendiente', fechaHora: '2026-10-22T07:30' },
        { statusNombre: '2. En ruta', fechaHora: '2026-10-22T09:15' },
        { statusNombre: '7. Falso', fechaHora: '2026-10-22T10:00' },
      ],
    });
    expect(r.map((o) => o.nombre)).toEqual(['1. Pendiente', '2. En ruta', '3. Verde Mx', '6. Servicio Completado']);
    expect(r.find((o) => o.nombre === '2. En ruta')?.ultimaVez).toBe('2026-10-22T09:15');
    expect(r.find((o) => o.nombre === '3. Verde Mx')?.ultimaVez).toBe('');
    expect(r.filter((o) => o.terminado).map((o) => o.nombre)).toEqual(['6. Servicio Completado']);
  });
  it('compara el estatus actual sin acentos, mayúsculas ni espacios de más', () => {
    const r = opcionesDeRegreso({ flujo: FLUJO, historial: [], catalogo: [], actual: ' 7.  FALSO ', resolver });
    expect(r.map((o) => o.nombre)).not.toContain('7. Falso');
  });
  it('sin flujo: los de la bitácora (sin repetir); sin bitácora: el catálogo', () => {
    const historial = [{ statusNombre: '2. En ruta', fechaHora: '2026-10-22T08:00' }, { status: 'id-x', fechaHora: '2026-10-22T07:00' }, { statusNombre: '2. En ruta', fechaHora: '2026-10-22T09:00' }];
    const r = opcionesDeRegreso({ flujo: null, historial, catalogo: ['No va'], actual: '7. Falso', resolver: (n) => (n === 'id-x' ? { id: 'id-x', nombre: '1. Pendiente' } : resolver(n)) });
    expect(r.map((o) => o.nombre)).toEqual(['1. Pendiente', '2. En ruta']);
    expect(opcionesDeRegreso({ flujo: [], historial: [], catalogo: ['A', 'Cancelado', '7. Falso'], actual: '7. Falso', resolver }).map((o) => o.nombre)).toEqual(['A']);
  });
});

describe('efectos del regreso', () => {
  const falso = { sueldoOperador: 200, sueldoExtra: 50, sueldoOperadorCompleto: 400, sueldoMitadAplicada: true };
  it('de Falso a un paso del flujo: vuelve a Activas y el sueldo regresa al completo', () => {
    expect(efectosDelRegreso(falso, resolver('2. En ruta'))).toEqual({ vuelveAActivas: true, sueldo: 'El sueldo del operador regresa al completo: $400.00.', conexiones: [] });
  });
  it('de Falso a Completado: se queda en Completados', () => {
    expect(efectosDelRegreso(falso, resolver('6. Servicio Completado')).vuelveAActivas).toBe(false);
  });
  it('de Completado a Falso: sueldo a la mitad', () => {
    expect(efectosDelRegreso({ sueldoOperador: 400 }, resolver('7. Falso')).sueldo).toBe('En Falso el sueldo del operador se paga a la mitad: $200.00.');
  });
  it('avisa las referencias a las que sigue ligada', () => {
    const op = { facturaClienteInvoice: 'F-120', facturadoProveedor: true, referenciaNominaConsecutivo: 'NOM-45', referenciaDieselId: 'd1' };
    expect(efectosDelRegreso(op, resolver('2. En ruta')).conexiones).toEqual(['Factura del cliente F-120', 'Factura del proveedor', 'Nómina NOM-45', 'Diésel']);
  });
});

it('fecha y hora corta', () => {
  expect(fechaHoraCorta('2026-10-22T09:10')).toBe('22/10/2026 09:10');
  expect(fechaHoraCorta('2026-10-22')).toBe('22/10/2026');
  expect(fechaHoraCorta('ayer')).toBe('ayer');
});

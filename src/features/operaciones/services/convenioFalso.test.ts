// ✅ V00511 — Falso al 50% (cliente y proveedor) y regla del operador (sueldo fijo, 3 galones).
//   Reemplaza las pruebas de la V00509 (cambio al convenio Falso del cliente).
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { ajusteOperadorPorStatus, sueldoFalsoDe } from '../../../utils/sueldoFalso';
import { ajusteConvenioPorStatus, cambiaFalso } from './convenioFalso';

const op = (extra: Record<string, unknown> = {}) => ({
  ref: 'TR-281026-018', statusNombre: '3. Documentado (Asignado)',
  convenioNombre: 'Cruce de Exportación - Caja - Cargado - 240 Nuevo Laredo',
  montoConvenioCliente: 120, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_USD, cargosAdicionales: 10,
  totalAPagarProv: 80, monedaConvenioProv: ID_USD, facturadoEnUnidad: ID_USD,
  tipoCambioDia: 18, conversionCliente: 2340, conversionProv: 1440,
  sueldoOperador: 400, sueldoExtra: 50, combustible: 6, combustibleExtra: 1, ...extra,
});

describe('cobro de Falso al 50%', () => {
  it('solo cuando entra o sale de Falso', () => {
    expect([cambiaFalso('6. En Tránsito', '7. Falso'), cambiaFalso('7. Falso', '14. Servicio Completado'), cambiaFalso('3', '5')]).toEqual([true, true, false]);
    expect(ajusteConvenioPorStatus(op(), '5.1 Llegada (a Origen)')).toEqual({ cambios: {}, mensaje: '', tipo: null });
  });

  it('al entrar: el MISMO convenio a la mitad (cliente y proveedor), Por Cobrar, Por Pagar y utilidad; guarda lo de antes', () => {
    const a = ajusteConvenioPorStatus(op(), '7. Falso');
    expect(a.tipo).toBe('info');
    expect(a.cambios).toEqual({
      montoConvenioCliente: 60, subtotalCliente: 70, dolaresCliente: 70, pesosCliente: 0, conversionCliente: 1260,
      totalAPagarProv: 40, subtotalProv: 40, dolaresProv: 40, pesosProv: 0, conversionProv: 720,
      utilidadEstimada: 540,
      mitadFalso: { cliente: { antes: 120, mitad: 60 }, proveedor: { antes: 80, mitad: 40 } },
    });
    expect(a.cambios).not.toHaveProperty('convenio');
    expect(a.mensaje).toBe('TR-281026-018 en Falso se cobra al 50%: cliente $60.00 USD (antes $120.00 USD) · proveedor $40.00 USD (antes $80.00 USD).');
  });

  it('no parte a la mitad: lo ya facturado, un convenio Falso, montos en 0, ni dos veces', () => {
    const fact = ajusteConvenioPorStatus(op({ facturaClienteId: 'F1' }), '7. Falso');
    expect(fact.tipo).toBe('alerta');
    expect(fact.cambios).not.toHaveProperty('montoConvenioCliente');
    expect(fact.cambios).toMatchObject({ totalAPagarProv: 40, conversionProv: 720, utilidadEstimada: 1620 });
    expect(fact.mensaje).toContain('Ya está facturada al cliente: se queda en $120.00 USD');
    const conFalso = ajusteConvenioPorStatus(op({ convenioNombre: 'Cruce de Exportacion - Falso', totalAPagarProv: 0 }), '7. Falso');
    expect(conFalso).toMatchObject({ cambios: {}, tipo: 'alerta' });
    expect(ajusteConvenioPorStatus(op({ montoConvenioCliente: 0, totalAPagarProv: 0 }), '7. Falso')).toEqual({ cambios: {}, mensaje: '', tipo: null });
    expect(ajusteConvenioPorStatus(op({ mitadFalso: { cliente: { antes: 240, mitad: 120 } } }), '7. Falso').cambios).toEqual({});
  });

  it('al salir regresa al 100%; si lo cambiaron a mano o ya se facturó, no', () => {
    const enFalso = { ...op(), ...ajusteConvenioPorStatus(op(), '7. Falso').cambios, statusNombre: '7. Falso' };
    const r = ajusteConvenioPorStatus(enFalso, '14. Servicio Completado');
    expect(r.cambios).toMatchObject({ montoConvenioCliente: 120, conversionCliente: 2340, totalAPagarProv: 80, conversionProv: 1440, utilidadEstimada: 900, mitadFalso: null });
    expect(r.mensaje).toBe('TR-281026-018 salió de Falso y regresa al 100%: cliente $120.00 USD · proveedor $80.00 USD.');
    const aMano = ajusteConvenioPorStatus({ ...enFalso, montoConvenioCliente: 75 }, '14. Servicio Completado');
    expect(aMano.cambios).not.toHaveProperty('montoConvenioCliente');
    expect(aMano.cambios).toMatchObject({ totalAPagarProv: 80, mitadFalso: null });
    const facturada = ajusteConvenioPorStatus({ ...enFalso, facturado: true }, '14. Servicio Completado');
    expect(facturada.tipo).toBe('alerta');
    expect(facturada.cambios).not.toHaveProperty('montoConvenioCliente');
    // Las que ya estaban en Falso antes de la V00511 (sin respaldo) no cambian.
    expect(ajusteConvenioPorStatus(op({ statusNombre: '7. Falso' }), '14. Servicio Completado')).toEqual({ cambios: {}, mensaje: '', tipo: null });
  });

  it('pesos facturados en dólares: la regla única divide entre el T.C.; sin T.C. escala lo guardado', () => {
    const mxn = op({ montoConvenioCliente: 1800, monedaConvenioCliente: ID_MXN, cargosAdicionales: 0, totalAPagarProv: 0 });
    expect(ajusteConvenioPorStatus(mxn, '7. Falso').cambios).toMatchObject({ montoConvenioCliente: 900, subtotalCliente: 50, dolaresCliente: 50 });
    const sinTC = op({ tipoCambioDia: 0, montoConvenioCliente: 100, cargosAdicionales: 0, subtotalCliente: 100, dolaresCliente: 100, conversionCliente: 1800, totalAPagarProv: 0 });
    expect(ajusteConvenioPorStatus(sinTC, '7. Falso').cambios).toMatchObject({ montoConvenioCliente: 50, subtotalCliente: 50, dolaresCliente: 50, conversionCliente: 900 });
  });

  it('compatibilidad V00509: la que entró con el convenio Falso del cliente regresa a su convenio', () => {
    const v509 = op({
      statusNombre: '7. Falso', convenio: 'D2', convenioNombre: 'Cruce de Exportacion - Falso', montoConvenioCliente: 60, totalAPagarProv: 0,
      convenioAntesFalso: { convenio: 'D1', convenioNombre: 'Cruce de Exportacion - Cargado', montoConvenioCliente: 120, monedaConvenioCliente: ID_USD },
    });
    expect(ajusteConvenioPorStatus(v509, '14. Servicio Completado').cambios).toMatchObject({ convenio: 'D1', montoConvenioCliente: 120, convenioAntesFalso: null, conversionCliente: 2340 });
  });
});

describe('operador en Falso (sueldo fijo y 3 galones)', () => {
  it('sueldo: $200 en cruces de impo / expo, $150 en movimientos, sin clasificar no se toca', () => {
    expect(sueldoFalsoDe(op())).toBe(200);
    expect(sueldoFalsoDe(op({ convenioNombre: 'Cruce de Importacion - Vacio' }))).toBe(200);
    expect(sueldoFalsoDe(op({ convenioNombre: 'Mov. local patio' }))).toBe(150);
    expect(sueldoFalsoDe(op({ convenioNombre: 'Transfer', tipoOperacionNombre: 'Transfer' }))).toBeNull();
  });

  it('al entrar: sueldo fijo y 3 galones, lo extra se queda; al salir regresa lo completo', () => {
    const a = ajusteOperadorPorStatus(op(), '7. Falso');
    expect(a).toEqual({
      sueldoOperadorCompleto: 400, sueldoOperador: 200, sueldoTotal: 250, sueldoMitadAplicada: true,
      combustibleCompleto: 6, combustible: 3, combustibleTotal: 4, combustibleFalsoAplicado: true,
    });
    expect(ajusteOperadorPorStatus({ ...op(), ...a }, '7. Falso')).toEqual({}); // no dos veces
    expect(ajusteOperadorPorStatus({ ...op(), ...a }, '14. Servicio Completado')).toEqual({
      sueldoOperador: 400, sueldoTotal: 450, sueldoMitadAplicada: false, combustible: 6, combustibleTotal: 7, combustibleFalsoAplicado: false,
    });
  });

  it('nunca sube ni toca ceros; sin clasificar solo el diesel', () => {
    expect(ajusteOperadorPorStatus(op({ convenioNombre: 'Mov local', sueldoOperador: 120, combustible: 2 }), '7. Falso'))
      .toMatchObject({ sueldoOperador: 120, combustible: 2 });
    expect(ajusteOperadorPorStatus(op({ sueldoOperador: 0, combustible: 0 }), '7. Falso')).toEqual({});
    expect(ajusteOperadorPorStatus(op({ convenioNombre: 'Transfer' }), '7. Falso')).toEqual({
      combustibleCompleto: 6, combustible: 3, combustibleTotal: 4, combustibleFalsoAplicado: true,
    });
  });

  it('las que ya estaban en Falso (V00387, sueldo a la mitad) regresan su sueldo completo', () => {
    expect(ajusteOperadorPorStatus({ sueldoOperador: 200, sueldoExtra: 50, sueldoOperadorCompleto: 400, sueldoMitadAplicada: true, combustible: 6 }, '2. En ruta'))
      .toEqual({ sueldoOperador: 400, sueldoTotal: 450, sueldoMitadAplicada: false });
  });
});

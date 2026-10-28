// ✅ V00509 — Convenio de Falso: sentido, convenios del cliente, entrar y salir de Falso.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { ajusteConvenioPorStatus, cambiaFalso, conveniosDelCliente, convenioFalsoPara, sentidoDe } from './convenioFalso';
import type { CatalogosConvenio } from './convenioFalso';

const cat: CatalogosConvenio = {
  maestros: [{ id: 'M1', clienteId: 'CHR', moneda: ID_USD }, { id: 'M9', clienteId: 'OTRO' }],
  detalles: [
    { id: 'D1', convenioId: 'M1', tipoConvenioNombre: 'Cruce de Importacion - Caja - Vacio - 240 Nuevo Laredo', tarifa: 120, consecutivo: 'CONV-001' },
    { id: 'D2', convenioId: 'M1', tipoConvenioNombre: 'Cruce de Importacion - Falso', tarifa: 60, consecutivo: 'CONV-002' },
    { id: 'D3', convenioId: 'M1', tipoConvenioId: 'T-EXPO-F', tarifa: 70, consecutivo: 'CONV-003' }, // nombre desde la tarifa
    { id: 'D4', convenioId: 'M1', tipoConvenioNombre: 'Cruce de Exportacion - Cargado', tarifa: 150, consecutivo: 'CONV-004' },
    { id: 'D5', convenioId: 'M1', tipoConvenioNombre: 'Cruce de Importacion - Falso - Colombia', tarifa: 65, status: 'Inactivo' }, // inactivo: no cuenta
    { id: 'D6', convenioId: 'M9', tipoConvenioNombre: 'Cruce de Exportacion - Falso', tarifa: 999 }, // de otro cliente
    { id: 'D7', tipoConvenioNombre: 'Transfer Exportacion Falso Pesos', tarifa: 900, moneda: 'Pesos', consecutivo: '7' }, // por línea de tarifario
  ],
  tarifas: [{ id: 'T-EXPO-F', descripcion: 'Cruce de Exportacion - Falso' }],
  tarifarios: [{ id: 'TARI-1', clienteId: 'CHR', status: 'Aprobado', tarifas: [{ consecutivo: 'CONV-007', status: 'Inactivo' }] }],
};

const op = (extra: Record<string, unknown>) => ({
  ref: 'TR-271026-028', clientePaga: 'CHR', clientePagaNombre: 'C.H. Robinson', statusNombre: '6. En Tránsito',
  convenio: 'D1', convenioNombre: 'Cruce de Importacion - Caja - Vacio - 240 Nuevo Laredo', montoConvenioCliente: 120, monedaConvenioCliente: ID_USD,
  facturadoEnCobrar: ID_USD, tipoCambioDia: 18, conversionProv: 500, ...extra,
});

describe('convenioFalso', () => {
  it('sentido por el texto y cuándo hay que revisar', () => {
    expect([sentidoDe('Cruce de Importación'), sentidoDe('EXPO Logística'), sentidoDe('Transfer'), sentidoDe('Impo y luego expo')])
      .toEqual(['importacion', 'exportacion', null, 'importacion']);
    expect([cambiaFalso('6. En Tránsito', '7. Falso'), cambiaFalso('7. Falso', '14. Servicio Completado'), cambiaFalso('3', '5')]).toEqual([true, true, false]);
  });

  it('convenios del cliente: maestro, nombre por la tarifa, sin inactivos ni de otro cliente; la línea del tarifario manda', () => {
    const l = conveniosDelCliente('CHR', cat);
    expect(l.map((c) => c.id)).toEqual(['D1', 'D2', 'D3', 'D4']);
    expect(l.find((c) => c.id === 'D3')?.nombre).toBe('Cruce de Exportacion - Falso');
    expect(l[0].moneda).toBe(ID_USD);
  });

  it('elige el Falso del mismo sentido', () => {
    const lista = conveniosDelCliente('CHR', cat);
    expect(convenioFalsoPara(op({}), lista)?.id).toBe('D2');
    expect(convenioFalsoPara(op({ convenioNombre: 'Cruce de Exportacion - Cargado' }), lista)?.id).toBe('D3');
    // Sin sentido en el convenio: el tráfico.
    expect(convenioFalsoPara(op({ convenioNombre: 'Transfer', trafico: 'Exportación' }), lista)?.id).toBe('D3');
  });

  it('al entrar a Falso: cambia convenio, monto y Por Cobrar, y guarda el anterior', () => {
    const a = ajusteConvenioPorStatus(op({}), '7. Falso', cat);
    expect(a.tipo).toBe('info');
    expect(a.cambios).toMatchObject({
      convenio: 'D2', convenioNombre: 'Cruce de Importacion - Falso', montoConvenioCliente: 60, monedaConvenioCliente: ID_USD,
      convenioAntesFalso: { convenio: 'D1', montoConvenioCliente: 120 },
      subtotalCliente: 60, dolaresCliente: 60, pesosCliente: 0, conversionCliente: 1080, utilidadEstimada: 580,
    });
    expect(a.mensaje).toBe('TR-271026-028: el convenio cambió a "Cruce de Importacion - Falso" ($60.00 USD).');
  });

  it('no toca: ya en Falso, ya facturada, sin convenio Falso de ese sentido, sin sentido', () => {
    expect(ajusteConvenioPorStatus(op({ convenioNombre: 'Cruce de Importacion - Falso' }), '7. Falso', cat).cambios).toEqual({});
    const fact = ajusteConvenioPorStatus(op({ facturaClienteId: 'F1' }), '7. Falso', cat);
    expect([fact.tipo, fact.cambios]).toEqual(['alerta', {}]);
    const sinFalso = ajusteConvenioPorStatus(op({ clientePaga: 'OTRO', clientePagaNombre: 'Otro SA' }), '7. Falso', cat);
    expect(sinFalso.mensaje).toBe('Otro SA no tiene convenio Falso de importación: el convenio de TR-271026-028 no se cambió.');
    expect(ajusteConvenioPorStatus(op({ convenioNombre: 'Transfer', tipoServicio: '' }), '7. Falso', cat).tipo).toBe('alerta');
    expect(ajusteConvenioPorStatus(op({}), '5.1 Llegada (a Origen)', cat)).toMatchObject({ cambios: {}, tipo: null });
  });

  it('al salir de Falso regresa su convenio; si lo cambiaron a mano, solo se olvida el respaldo', () => {
    const enFalso = op({ statusNombre: '7. Falso', ...ajusteConvenioPorStatus(op({}), '7. Falso', cat).cambios });
    const r = ajusteConvenioPorStatus(enFalso, '14. Servicio Completado', cat);
    expect(r.cambios).toMatchObject({ convenio: 'D1', montoConvenioCliente: 120, convenioAntesFalso: null, dolaresCliente: 120, conversionCliente: 2160 });
    expect(r.mensaje).toBe('TR-271026-028: regresó a su convenio "Cruce de Importacion - Caja - Vacio - 240 Nuevo Laredo".');
    const aMano = ajusteConvenioPorStatus({ ...enFalso, convenio: 'D4', convenioNombre: 'Cruce de Exportacion - Cargado' }, '14. Servicio Completado', cat);
    expect(aMano).toMatchObject({ cambios: { convenioAntesFalso: null }, tipo: null });
  });

  it('un convenio en pesos facturado en dólares divide entre el T.C.', () => {
    const mxn: CatalogosConvenio = { ...cat, detalles: [...cat.detalles, { id: 'D8', convenioId: 'M1', tipoConvenioNombre: 'Cruce de Importacion - Falso - Pesos', tarifa: 1800, moneda: 'MXN' }] };
    const a = ajusteConvenioPorStatus(op({ convenioNombre: 'Cruce de Importacion - Pesos' }), '7. Falso', mxn);
    expect(a.cambios).toMatchObject({ convenio: 'D8', monedaConvenioCliente: ID_MXN, subtotalCliente: 100, dolaresCliente: 100 });
  });
});

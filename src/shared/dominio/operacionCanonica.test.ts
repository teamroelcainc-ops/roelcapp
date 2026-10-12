// ✅ V00440 (Fase 4) — campos canónicos de una operación.
import { describe, expect, it } from 'vitest';
import { ESQUEMA_OPERACION_VERSION, ID_MXN, ID_USD, STATUS_CANCELADO, STATUS_COMPLETADOS } from './constantes';
import {
  camposCanonicos, crearIndice, derivarDesdeConvenio, diferenciasCanonicas, esFacturableProveedor, esOperacionPrueba,
  estadoGrupoDe, normalizarNumerosOperacion,
} from './operacionCanonica';
import type { CatalogoNombres, ContextoCanonico } from './operacionCanonica';

const EMP_A = 'a1b2c3d4';
const EMP_B = 'b1b2c3d4';
const EMP_C = 'c1b2c3d4';
const STATUS_RUTA = 'aaaa1111';
const STATUS_FALSO_OTRO = 'ffff0000';

const ctxCompleto = (): ContextoCanonico => ({
  empresas: crearIndice([
    { id: EMP_A, nombres: ['Acme', 'ACME SA de CV'] },
    { id: EMP_B, nombres: ['Bodega Norte'] },
    { id: EMP_C, nombres: ['Bodega Norte'] }, // homónimo
  ]),
  status: crearIndice([
    { id: STATUS_RUTA, nombres: ['En ruta'] },
    { id: STATUS_COMPLETADOS[0], nombres: ['Servicio Completado'] },
    { id: STATUS_COMPLETADOS[1], nombres: ['Falso'] },
    { id: STATUS_FALSO_OTRO, nombres: ['Falso (sin cobro)'] },
  ]),
  nombreStatus: (id) => ({ [STATUS_RUTA]: 'En ruta', [STATUS_COMPLETADOS[0]]: 'Servicio Completado', [STATUS_COMPLETADOS[1]]: 'Falso', [STATUS_FALSO_OTRO]: 'Falso (sin cobro)' } as Record<string, string>)[id],
  conveniosCliente: crearIndice([{ id: 'CONV-054', nombres: [] }]),
  incluirPropio: true,
});

describe('estadoGrupoDe (misma regla que Activas / Completados / Cancelados)', () => {
  it('por ID', () => {
    expect(estadoGrupoDe({ status: STATUS_CANCELADO })).toBe('cancelada');
    expect(estadoGrupoDe({ status: STATUS_COMPLETADOS[0], statusNombre: 'Servicio Completado' })).toBe('completada');
    expect(estadoGrupoDe({ status: STATUS_COMPLETADOS[1] }, 'Falso')).toBe('falso');
  });
  it('si el ID no es final, manda el nombre (catálogo primero, luego el guardado)', () => {
    expect(estadoGrupoDe({ status: STATUS_FALSO_OTRO }, 'Falso (sin cobro)')).toBe('falso');
    expect(estadoGrupoDe({ status: 'xxxx', statusNombre: 'CANCELADO' })).toBe('cancelada');
    expect(estadoGrupoDe({ status: STATUS_RUTA, statusNombre: 'En ruta' }, 'En ruta')).toBe('activa');
    expect(estadoGrupoDe({})).toBe('activa');
  });
});

describe('camposCanonicos', () => {
  const base = {
    ref: 'TR-101026-001', fechaServicio: '9/10/2026', status: STATUS_RUTA, statusNombre: 'En ruta',
    clientePaga: EMP_A, proveedorUnidad: EMP_A, origen: EMP_A, destino: EMP_A, convenio: 'CONV-054',
    facturadoEnCobrar: ID_USD, facturadoEnUnidad: ID_MXN, montoConvenioCliente: '1,250.50', totalAPagarProv: 800,
    tipoOperacionNombre: 'Logística Fletes', proveedorUnidadNombre: 'Transportes X',
  };

  it('normaliza fecha, montos, monedas y versión', () => {
    const { campos, pendientes } = camposCanonicos(base, ctxCompleto());
    expect(campos.fechaServicioISO).toBe('2026-10-09');
    expect(campos.montoConvenioClienteCentavos).toBe(125050);
    expect(campos.totalAPagarProvCentavos).toBe(80000);
    expect(campos.cargosAdicionalesCentavos).toBe(0);
    expect(campos.monedaCliente).toBe('USD');
    expect(campos.monedaProveedor).toBe('MXN');
    expect(campos.esquemaVersion).toBe(ESQUEMA_OPERACION_VERSION);
    expect(campos.estadoGrupo).toBe('activa');
    expect(campos.empresasIds).toEqual([EMP_A]);
    expect(campos.convenioClienteId).toBe('CONV-054');
    expect(pendientes).toEqual([]);
  });

  it('resuelve nombres de AppSheet a ID y reporta homónimos sin inventar', () => {
    const { campos, pendientes } = camposCanonicos({ ...base, clientePaga: 'acme', destino: 'Bodega Norte' }, ctxCompleto());
    expect(campos.clientePagaId).toBe(EMP_A);
    expect(campos.destinoId).toBeUndefined(); // homónimo: no se toca
    expect(campos.empresasIds).toEqual([EMP_A]);
    expect(pendientes).toContainEqual({ campo: 'destinoId', valor: 'Bodega Norte', motivo: 'ambiguo' });
  });

  it('un papel sin resolver conserva en empresasIds el ID que ya tenía', () => {
    const { campos } = camposCanonicos({ ...base, destino: 'Bodega Norte', destinoId: EMP_B }, ctxCompleto());
    expect(campos.empresasIds).toEqual([EMP_A, EMP_B]);
  });

  it('un ID inexistente se guarda igual (trigger y migración coinciden) y se avisa', () => {
    const r1 = camposCanonicos({ ...base, clientePaga: 'deadbeef' }, ctxCompleto());
    expect(r1.campos.clientePagaId).toBe('deadbeef');
    expect(r1.avisos).toContainEqual({ campo: 'clientePagaId', valor: 'deadbeef', motivo: 'idInexistente' });
    const r2 = camposCanonicos({ ...base, clientePaga: 'deadbeef' });
    expect(r2.campos.clientePagaId).toBe('deadbeef');
    expect(r2.avisos).toEqual([]);
  });

  it('llave de AppSheet guardada dentro del documento: se conserva y se avisa a qué documento apunta', () => {
    const ctx = { ...ctxCompleto(), empresas: crearIndice([{ id: EMP_A, nombres: ['Acme'], alias: 'APP123' }]) };
    const r = camposCanonicos({ ...base, clientePaga: 'APP123' }, ctx);
    expect(r.campos.clientePagaId).toBe('APP123');
    expect(r.avisos).toContainEqual({ campo: 'clientePagaId', valor: 'APP123', motivo: 'aliasAppSheet', detalle: EMP_A });
  });

  it('la prioridad es el campo vigente: un ID viejo en clientePagaId no gana a clientePaga', () => {
    const { campos } = camposCanonicos({ ...base, clientePaga: 'Acme', clientePagaId: EMP_B }, ctxCompleto());
    expect(campos.clientePagaId).toBe(EMP_A);
  });

  it('vacío = null (se puede consultar "sin unidad")', () => {
    const { campos } = camposCanonicos({ ...base, unidad: '' }, ctxCompleto());
    expect(campos.unidadId).toBeNull();
  });

  it('fecha faltante o ilegible: null y se reporta, pero NO pisa un fechaServicioISO válido ya escrito', () => {
    const r1 = camposCanonicos({ ...base, fechaServicio: '' }, ctxCompleto());
    expect(r1.campos.fechaServicioISO).toBeNull();
    expect(r1.pendientes[0]).toMatchObject({ campo: 'fechaServicioISO', motivo: 'fechaFaltante' });
    const r2 = camposCanonicos({ ...base, fechaServicio: 'mañana', fechaServicioISO: '2026-10-25' }, ctxCompleto());
    expect(r2.campos.fechaServicioISO).toBeUndefined();
  });

  it('fechas: la regla de ⚡ Acelerar búsquedas (m/d si el segundo número > 12, Timestamp en UTC)', () => {
    expect(camposCanonicos({ ...base, fechaServicio: '10/25/2026' }).campos.fechaServicioISO).toBe('2026-10-25');
    expect(camposCanonicos({ ...base, fechaServicio: { seconds: Date.UTC(2026, 9, 9) / 1000 } }).campos.fechaServicioISO).toBe('2026-10-09');
    expect(camposCanonicos({ ...base, fechaServicio: Date.UTC(2026, 9, 9) }).campos.fechaServicioISO).toBe('2026-10-09');
  });

  it('pendientes de facturar: terminada, no facturada, no de prueba', () => {
    const completada = { ...base, status: STATUS_COMPLETADOS[0], statusNombre: 'Servicio Completado' };
    expect(camposCanonicos(completada, ctxCompleto()).campos.porFacturarCliente).toBe(true);
    expect(camposCanonicos(completada, ctxCompleto()).campos.porFacturarProveedor).toBe(true);
    expect(camposCanonicos({ ...completada, facturaClienteId: 'F1' }, ctxCompleto()).campos.porFacturarCliente).toBe(false);
    expect(camposCanonicos({ ...completada, ref: 'PR.TR-101026-001' }, ctxCompleto()).campos.porFacturarCliente).toBe(false);
    expect(camposCanonicos(base, ctxCompleto()).campos.porFacturarCliente).toBe(false); // activa
  });

  it('diferenciasCanonicas: solo lo que cambia (null = ausente)', () => {
    const { campos } = camposCanonicos(base, ctxCompleto());
    const yaMigrada = { ...base, ...campos };
    expect(diferenciasCanonicas(yaMigrada, campos)).toEqual({});
    expect(diferenciasCanonicas({ ...yaMigrada, empresasIds: ['zz'] }, campos)).toEqual({ empresasIds: [EMP_A] });
    expect(diferenciasCanonicas({ ...base, ...campos, unidadId: undefined }, { unidadId: null })).toEqual({});
    // ✅ V00448: fechaServicioISO SÍ se escribe como null si falta (orderBy deja fuera los documentos sin el campo).
    expect(diferenciasCanonicas({ ...base, ...campos, fechaServicioISO: undefined }, { fechaServicioISO: null })).toEqual({ fechaServicioISO: null });
    expect(diferenciasCanonicas({ ...base, ...campos, fechaServicioISO: null }, { fechaServicioISO: null })).toEqual({});
  });
});

describe('reglas compartidas', () => {
  it('operaciones de prueba (V00380)', () => {
    expect(esOperacionPrueba({ esPrueba: true })).toBe(true);
    expect(esOperacionPrueba({ ref: 'pr.TR-1' })).toBe(true);
    expect(esOperacionPrueba({ ref: 'TR-1' })).toBe(false);
  });
  it('Facturación Proveedores: Fletes y Logística no-Roelca', () => {
    expect(esFacturableProveedor({ tipoOperacionNombre: 'Logística Fletes' })).toBe(true);
    expect(esFacturableProveedor({ tipoOperacionNombre: 'Logística Cruces', proveedorUnidadNombre: 'ROELCA INC' })).toBe(false);
    expect(esFacturableProveedor({ tipoOperacionNombre: 'Transfer' })).toBe(false);
  });
  it('números del formulario: texto → number, vacío se queda', () => {
    expect(normalizarNumerosOperacion({ pesoKg: '1,200', montoManifiesto: '', sueldoExtra: 'abc', otro: '5' }))
      .toEqual({ pesoKg: 1200, montoManifiesto: '', sueldoExtra: 'abc', otro: '5' });
  });
});

describe('derivarDesdeConvenio (EL CONVENIO MANDA, V00258)', () => {
  const cat = (pares: [string, string][]): CatalogoNombres => ({
    porId: new Map(pares),
    porNorm: new Map(pares.map(([, n]) => [n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), n])),
  });
  const cv = cat([['cv1', 'Cargado'], ['cv2', 'Vacío']]);
  const adu = cat([['ad1', 'Colombia'], ['ad2', 'Nuevo Laredo']]);
  it('toma C/V y aduana del nombre del convenio', () => {
    expect(derivarDesdeConvenio({ convenioNombre: 'Transfer - Cargada - Colombia', carga: 'Vacío', trafico: 'Importación' }, cv, adu))
      .toEqual({ carga: 'Cargado', aduanaNombre: 'Colombia' });
  });
  it('Expo/Impo solo si la operación no trae uno válido', () => {
    expect(derivarDesdeConvenio({ convenioNombre: 'Exportación - Vacía', trafico: '' }, cv, adu)).toEqual({ carga: 'Vacío', trafico: 'Exportación' });
    expect(derivarDesdeConvenio({ convenioNombre: 'Exportación', trafico: 'Importación' }, cv, adu)).toEqual({});
  });
});

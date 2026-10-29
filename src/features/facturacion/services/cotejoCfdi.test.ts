// ✅ V00513 — Cotejo de un XML (CFDI) contra las operaciones por facturar.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import type { ClienteCotejo, OpCotejo } from './cotejoCfdi';
import { claveNombre, cotejarCfdi, opParaCotejo, problemaCliente } from './cotejoCfdi';
import type { Cfdi, ConceptoCfdi } from './leerCfdi';

const concepto = (refs: string[], importe: number, extra: Partial<ConceptoCfdi> = {}): ConceptoCfdi => ({
  descripcion: `SERVICIO ${refs.join(' ')}`, importe, refs, caja: '', refCliente: '', tcDescripcion: 0, ...extra,
});

const cfdi = (extra: Partial<Cfdi> = {}): Cfdi => ({
  folio: 'I8663', serie: 'I', numero: '8663', fecha: '2026-10-28', tipo: 'I', moneda: 'USD', tipoCambio: 18.6525,
  subtotal: 275, total: 275, uuid: 'UUID-1', emisorRfc: 'AAA010101AAA',
  receptorNombre: 'C.H. ROBINSON WORLDWIDE,INC.', receptorRfc: 'XEXX010101000', receptorTaxId: '411956721',
  conceptos: [concepto(['TR-271026-026'], 150), concepto(['TR-271026-010'], 50), concepto(['TR-271026-014'], 75)],
  ...extra,
});

const op = (ref: string, usd: number, extra: Partial<OpCotejo> = {}): OpCotejo => ({
  id: `id-${ref}`, ref, clienteId: 'chr', facturaFolio: '', enRevision: false, importeUSD: usd, importeMXN: usd * 18.5, tipoCambio: 18.5, ...extra,
});

const CLIENTES = new Map<string, ClienteCotejo>([
  ['chr', { nombre: 'C.H. Robinson Worldwide, INC.', rfc: '', moneda: 'USD' }],
  ['temm', { nombre: 'Temm Truck', rfc: 'TTR240321JJ0', moneda: 'MXN' }],
]);
const OPS = [op('TR-271026-026', 150), op('TR-271026-010', 50), op('TR-271026-014', 75)];

describe('cotejarCfdi', () => {
  it('todo cuadra al centavo → listo, con las operaciones a facturar', () => {
    const r = cotejarCfdi(cfdi(), OPS, CLIENTES, []);
    expect(r.estado).toBe('listo');
    expect(r.clienteId).toBe('chr');
    expect(r.opsIds).toEqual(['id-TR-271026-026', 'id-TR-271026-010', 'id-TR-271026-014']);
    expect(r.problemas).toEqual([]);
    expect(r.notas).toEqual(['C.H. Robinson Worldwide, INC. no tiene RFC / Tax ID en Empresas; se comparó por nombre.']);
  });

  it('un centavo de diferencia en un concepto → diferencias, y dice cuál', () => {
    const r = cotejarCfdi(cfdi(), [op('TR-271026-026', 150.01), OPS[1], OPS[2]], CLIENTES, []);
    expect(r.estado).toBe('diferencias');
    expect(r.renglones[0].problema).toBe('Diferencia -0.01');
    expect(r.problemas[0]).toContain('TR-271026-026: el XML cobra 150.00 USD y la app 150.01');
  });

  it('en pesos señala cuando el TC del XML no es el de la operación', () => {
    const x = cfdi({
      folio: 'A5744', moneda: 'MXN', receptorNombre: 'TEMM TRUCK', receptorRfc: 'TTR240321JJ0', receptorTaxId: '', subtotal: 3131.4,
      conceptos: [concepto(['LO-211026-008'], 3131.4, { tcDescripcion: 18.42 })],
    });
    const r = cotejarCfdi(x, [op('LO-211026-008', 170, { clienteId: 'temm', importeMXN: 3128, tipoCambio: 18.4 })], CLIENTES, []);
    expect(r.estado).toBe('diferencias');
    expect(r.problemas[0]).toContain('El XML usa TC 18.42 y la operación 18.4.');
  });

  it('operación ya facturada, en Revisión o folio repetido → bloqueada', () => {
    expect(cotejarCfdi(cfdi(), [op('TR-271026-026', 150, { facturaFolio: '39761' }), OPS[1], OPS[2]], CLIENTES, []).problemas[0])
      .toBe('TR-271026-026 ya está en la factura 39761.');
    expect(cotejarCfdi(cfdi(), [op('TR-271026-026', 150, { enRevision: true }), OPS[1], OPS[2]], CLIENTES, []).estado).toBe('bloqueada');
    const r = cotejarCfdi(cfdi(), OPS, CLIENTES, [{ folio: 'i8663', clienteNombre: 'C.H. Robinson Worldwide, INC.' }]);
    expect(r.estado).toBe('bloqueada');
    expect(r.problemas[0]).toBe('La factura I8663 ya está registrada en la app (C.H. Robinson Worldwide, INC.).');
  });

  it('referencia que no está entre las operaciones → sin_operacion si no hay ninguna', () => {
    const r = cotejarCfdi(cfdi({ conceptos: [concepto(['TR-999999-001'], 275)] }), OPS, CLIENTES, []);
    expect(r.estado).toBe('sin_operacion');
    expect(r.problemas).toEqual(['TR-999999-001 no aparece en las operaciones por facturar.']);
  });

  it('concepto sin referencia o una de varias que falta → diferencias', () => {
    const r = cotejarCfdi(cfdi({ conceptos: [concepto(['TR-271026-026'], 150), concepto([], 125)] }), OPS, CLIENTES, []);
    expect(r.estado).toBe('diferencias');
    expect(r.renglones[1].problema).toBe('Sin referencia');
  });

  it('moneda distinta a la del cliente, clientes mezclados y cliente sin moneda', () => {
    expect(cotejarCfdi(cfdi({ moneda: 'MXN' }), OPS, CLIENTES, []).problemas).toContain('El XML está en MXN y C.H. Robinson Worldwide, INC. se factura en USD.');
    const mezcla = cotejarCfdi(cfdi(), [OPS[0], op('TR-271026-010', 50, { clienteId: 'temm' }), OPS[2]], CLIENTES, []);
    expect(mezcla.problemas).toContain('Las referencias son de clientes distintos: C.H. Robinson Worldwide, INC., Temm Truck.');
    const sinMoneda = new Map(CLIENTES); sinMoneda.set('chr', { nombre: 'CHR', rfc: '', moneda: '' });
    expect(cotejarCfdi(cfdi({ receptorNombre: 'CHR' }), OPS, sinMoneda, []).estado).toBe('bloqueada');
  });

  it('solo facturas de ingreso', () => {
    expect(cotejarCfdi(cfdi({ tipo: 'E' }), OPS, CLIENTES, []).estado).toBe('bloqueada');
  });
});

describe('problemaCliente', () => {
  it('nacional: por RFC', () => {
    const x = cfdi({ receptorRfc: 'TTR240321JJ0', receptorNombre: 'TEMM TRUCK', receptorTaxId: '' });
    expect(problemaCliente(x, { nombre: 'Temm Truck', rfc: 'ttr240321jj0', moneda: 'MXN' })).toBe('');
    expect(problemaCliente(x, { nombre: 'Temm Truck', rfc: 'OTR010101AAA', moneda: 'MXN' })).toContain('El XML es para TEMM TRUCK');
  });
  it('extranjero (RFC genérico): por Tax ID o por nombre', () => {
    expect(problemaCliente(cfdi(), { nombre: 'Otro nombre', rfc: '41-1956721', moneda: 'USD' })).toBe('');
    expect(problemaCliente(cfdi(), { nombre: 'C.H. Robinson Worldwide, INC.', rfc: '', moneda: 'USD' })).toBe('');
    expect(problemaCliente(cfdi(), { nombre: 'Landstar Transportation Logistics', rfc: '', moneda: 'USD' })).not.toBe('');
  });
  it('claveNombre ignora puntos, comas, espacios, mayúsculas y acentos', () => {
    expect(claveNombre('A. Castañeda & CO. Inc.')).toBe(claveNombre('A. CASTANEDA & CO, INC'));
  });
});

describe('opParaCotejo', () => {
  it('toma la referencia normalizada, el cliente que paga y el importe con la regla de Generar Factura', () => {
    const quintanar = {
      id: 'x1', ref: 'LO-050626-2', clientePaga: 'q', montoConvenioCliente: 115, cargosAdicionales: 0, facturadoEnCobrar: ID_MXN,
      tipoCambioAprobado: 17.2888, subtotalCliente: 115, dolaresCliente: 0, pesosCliente: 1988.21, conversionCliente: 1988.21,
    };
    expect(opParaCotejo(quintanar, '', false)).toMatchObject({ id: 'x1', ref: 'LO-050626-002', clienteId: 'q', importeMXN: 1988.21 });
    const enDolares = { id: 'x2', numReferencia: 'TR-271026-26', clienteId: 'chr', montoConvenioCliente: 150, facturadoEnCobrar: ID_USD, monedaConvenioCliente: ID_USD, tipoCambioAprobado: 18.5 };
    expect(opParaCotejo(enDolares, '', false)).toMatchObject({ ref: 'TR-271026-026', clienteId: 'chr', importeUSD: 150 });
  });
});

describe('cotejarCfdi — ya registrada', () => {
  it('folio en la app y todas sus operaciones en esa factura → registrada (no bloqueada)', () => {
    const ops = OPS.map((o) => ({ ...o, facturaFolio: 'I8663' }));
    const r = cotejarCfdi(cfdi(), ops, CLIENTES, [{ folio: 'I8663', clienteNombre: 'CHR' }]);
    expect(r.estado).toBe('registrada');
    expect(r.problemas).toEqual([]);
  });
});

// @vitest-environment jsdom
// ✅ V00513 — Lector de XML de CFDI. Los XML de prueba copian la FORMA de los del SIT
// (CFDI 4.0, descripción con saltos de línea), con datos ficticios.
import { describe, expect, it } from 'vitest';
import { datosDeDescripcion, esRefOperacion, leerCfdi, normalizarRef } from './leerCfdi';

const xml = (atributos: string, receptor: string, conceptos: string, uuid = '7E3F034C-9061-4945-9B33-7240FB07E80E') => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" ${atributos}>
<cfdi:Emisor Nombre="EMISOR DE PRUEBA" RegimenFiscal="624" Rfc="AAA010101AAA" />
${receptor}
<cfdi:Conceptos>${conceptos}</cfdi:Conceptos>
<cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuid}" /></cfdi:Complemento>
</cfdi:Comprobante>`;

const USD_TRES = xml(
  'Serie="I" Folio="8663" Fecha="2026-10-28T11:06:43" Moneda="USD" TipoCambio="18.6525" SubTotal="275.00" Total="275.00" TipoDeComprobante="I"',
  '<cfdi:Receptor Nombre="CLIENTE EXTRANJERO,INC." Rfc="XEXX010101000" NumRegIdTrib="123456789" ResidenciaFiscal="USA" />',
  `<cfdi:Concepto Cantidad="1.00" Descripcion="IMPORTACION CAJA POR LAREDO CARGADA
TR-271026-026
27/10/2026
CAJA ETX53269
REF 568917117
ANGEL" Importe="150.00" />
<cfdi:Concepto Cantidad="1.00" Descripcion="EXPORTACION TROMPO POR LAREDO
TR-271026-010
27/10/2026
CAJA ETX53269
REF 568917117" Importe="50.00" />
<cfdi:Concepto Cantidad="1.00" Descripcion="IMPORTACION CAJA POR LAREDO FALSO
TR-271026-14
27/10/2026
CAJA ETX53269" Importe="75.00" />`,
);

const MXN_TC = xml(
  'Serie="A" Folio="5744" Fecha="2026-10-22T16:49:16" Moneda="MXN" SubTotal="7275.90" Total="7275.90" TipoDeComprobante="I"',
  '<cfdi:Receptor Nombre="CLIENTE NACIONAL" Rfc="BBB010101BBB" />',
  `<cfdi:Concepto Descripcion="IMPORTACION CAJA POR LAREDO CARGADA
LO-211026-008
21/10/2026
CAJA RP116
TC 18.4200" Importe="3131.40" />
<cfdi:Concepto Descripcion="MOVIMIENTO EN LAREDO TEXAS VACIO
TR-211026-033
21/10/2026
CAJA CG113
TC 18.4200" Importe="4144.50" />`,
  'a683281f-ce16-46fa-868c-e780506b610d',
);

describe('leerCfdi', () => {
  it('lee folio, fecha, moneda, TC, UUID, receptor y cada concepto con su referencia e importe', () => {
    const r = leerCfdi(USD_TRES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.cfdi;
    expect(c).toMatchObject({
      folio: 'I8663', serie: 'I', numero: '8663', fecha: '2026-10-28', tipo: 'I', moneda: 'USD', tipoCambio: 18.6525,
      subtotal: 275, total: 275, uuid: '7E3F034C-9061-4945-9B33-7240FB07E80E',
      receptorRfc: 'XEXX010101000', receptorTaxId: '123456789', receptorNombre: 'CLIENTE EXTRANJERO,INC.',
    });
    expect(c.conceptos.map((x) => [x.refs, x.importe, x.caja, x.refCliente])).toEqual([
      [['TR-271026-026'], 150, 'ETX53269', '568917117'],
      [['TR-271026-010'], 50, 'ETX53269', '568917117'],
      [['TR-271026-014'], 75, 'ETX53269', ''],
    ]);
  });

  it('factura en pesos: sin TipoCambio en el comprobante, el TC viene en la descripción; UUID en mayúsculas', () => {
    const r = leerCfdi(MXN_TC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cfdi.moneda).toBe('MXN');
    expect(r.cfdi.tipoCambio).toBe(0);
    expect(r.cfdi.uuid).toBe('A683281F-CE16-46FA-868C-E780506B610D');
    expect(r.cfdi.conceptos.map((x) => [x.refs[0], x.caja, x.tcDescripcion])).toEqual([['LO-211026-008', 'RP116', 18.42], ['TR-211026-033', 'CG113', 18.42]]);
  });

  it('rechaza lo que no es un CFDI', () => {
    expect(leerCfdi('no es xml <<<')).toEqual({ ok: false, error: 'El archivo no es un XML válido.' });
    expect(leerCfdi('<?xml version="1.0"?><otra/>')).toEqual({ ok: false, error: 'No es una factura del SAT (no trae cfdi:Comprobante).' });
  });
});

describe('normalizarRef / datosDeDescripcion', () => {
  it('rellena el consecutivo a 3 dígitos y pasa a mayúsculas', () => {
    expect(normalizarRef('tr-271026-26')).toBe('TR-271026-026');
    expect(normalizarRef('LO-200126-3')).toBe('LO-200126-003');
    expect(normalizarRef('FL-210126-004')).toBe('FL-210126-004');
  });

  it('la palabra CAJA del nombre del servicio no se toma como número de caja', () => {
    expect(datosDeDescripcion('IMPORTACION CAJA POR LAREDO CARGADA TR-271026-025 27/10/2026 CAJA 145 REF 572510393').caja).toBe('145');
  });

  it('un concepto puede traer varias referencias (o ninguna)', () => {
    expect(datosDeDescripcion('CRUCES TR-010126-1 Y TR-010126-002').refs).toEqual(['TR-010126-001', 'TR-010126-002']);
    expect(datosDeDescripcion('SERVICIO SIN REFERENCIA').refs).toEqual([]);
    // ✅ V00519: también las referencias viejas (AppSheet) "TR46028-05".
    expect(datosDeDescripcion('MOVIMIENTO EN NUEVO LAREDO CARGADO TR46028-05 19/01/2026 CAJA 1096 535963738').refs).toEqual(['TR46028-05']);
    expect(esRefOperacion('TR46028-05')).toBe(true);
    expect(esRefOperacion(' lo-271026-26 ')).toBe(true);
    expect(esRefOperacion('TR-27102-026')).toBe(false);
  });
});

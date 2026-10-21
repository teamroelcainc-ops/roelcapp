// ✅ V00451 — el formulario no guarda campos de otros módulos (facturación, nómina, diésel…).
import { describe, expect, it } from 'vitest';
import { quitarCamposAjenos } from './camposAjenos';

describe('quitarCamposAjenos', () => {
  it('quita facturación, conexiones e identidad; deja lo del formulario', () => {
    const datos = quitarCamposAjenos({
      refCliente: 'PO1', montoConvenioCliente: 10, facturaClienteId: '', facturado: false, facturaProveedorFolio: 'X',
      referenciaNominaId: 'N1', cambiosSueldo: [], id: 'viejo', _docId: 'real',
    });
    expect(datos).toEqual({ refCliente: 'PO1', montoConvenioCliente: 10 });
  });
  it('V00469: tampoco el cobro del puente de la copia (lo escriben el servidor y Referencias de Puentes)', () => {
    const datos = quitarCamposAjenos({
      trafico: 'Importación', puenteId: 'g-avi', puenteMonto: 23.75,
      saldoPuente: 0, saldoPuentePuente: 'Caseta AVI', saldoPuenteFecha: '2026-10-01', saldoPuenteManual: true,
      saldoPuentePiso: 90, saldoPuentePisoEvento: 'Verde MX', puenteCobradoEn: 'x', puenteCobradoPor: 'servidor',
    });
    expect(datos).toEqual({ trafico: 'Importación', puenteId: 'g-avi', puenteMonto: 23.75 });
  });
});

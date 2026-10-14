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
});

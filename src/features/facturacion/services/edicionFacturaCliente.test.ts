// ✅ V00540: Editar factura (clientes): cómo arranca y cuándo hay cambios (Actualizar se activa solo con cambios).
import { describe, expect, it } from 'vitest';
import { camposIniciales, claveEdicion } from './edicionFacturaCliente';

const factura = {
  id: 'F1', invoice: 'I8392', fecha: '2026-09-12T00:00:00', facturaCcp: '', statusFactura: 'Facturado', clienteId: 'cli1',
  docsFactura: [{ url: 'https://x/doc.pdf', nombre: 'doc.pdf' }],
};

describe('Editar factura (clientes)', () => {
  it('arranca con los datos de la factura y el subtotal sugerido', () => {
    const c = camposIniciales(factura, 2715.56);
    expect(c).toMatchObject({ invoice: 'I8392', fecha: '2026-09-12', ccp: '', status: 'Facturado', clienteId: 'cli1', total: '2715.56', cancelacion: { nota: '', reemplazo: '' } });
    expect(c.adjuntos).toHaveLength(1);
  });
  it('sin status, Facturado; con cancelación guardada, la trae', () => {
    const c = camposIniciales({ id: 'F2', statusFactura: 'Cancelado', motivoCancelacion: 'Error de RFC', facturaReemplazo: 'I9000' }, 0);
    expect(camposIniciales({ id: 'F3' }, 0).status).toBe('Facturado');
    expect(c.status).toBe('Cancelado');
    expect(c.cancelacion).toEqual({ nota: 'Error de RFC', reemplazo: 'I9000' });
  });
  it('la clave cambia con lo que se edita y no con espacios al final del folio', () => {
    const c = camposIniciales(factura, 100);
    const base = claveEdicion(c);
    expect(claveEdicion({ ...c, invoice: 'I8392 ' })).toBe(base);
    expect(claveEdicion({ ...c, invoice: 'I8393' })).not.toBe(base);
    expect(claveEdicion({ ...c, total: '101' })).not.toBe(base);
    expect(claveEdicion({ ...c, adjuntos: [] })).not.toBe(base);
  });
});

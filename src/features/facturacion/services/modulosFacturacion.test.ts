// ✅ V00480 — el menú "Facturación" lleva a la pestaña que ya se ve o a la primera con permiso.
import { describe, expect, it } from 'vitest';
import { esModuloFacturacion, pestanaDeFacturacion } from './modulosFacturacion';

describe('pestaña de entrada de Facturación', () => {
  it('desde otro módulo va a Clientes; desde una pestaña se queda en ella', () => {
    expect(pestanaDeFacturacion('pagos', () => true)).toBe('facturacionClientes');
    expect(pestanaDeFacturacion('facturacionProveedores', () => true)).toBe('facturacionProveedores');
  });
  it('sin permiso de Clientes va a Proveedores; sin ninguno, null', () => {
    expect(pestanaDeFacturacion('pagos', (m) => m === 'facturacionProveedores')).toBe('facturacionProveedores');
    expect(pestanaDeFacturacion('facturacionClientes', (m) => m === 'facturacionProveedores')).toBe('facturacionProveedores');
    expect(pestanaDeFacturacion('pagos', () => false)).toBeNull();
  });
  it('reconoce los dos módulos', () => {
    expect(['facturacionClientes', 'facturacionProveedores', 'pagos'].map(esModuloFacturacion)).toEqual([true, true, false]);
  });
});

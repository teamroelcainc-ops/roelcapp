// ✅ V00540: las reglas de moneda de Facturación Clientes, ahora fuera del tablero (las usa también Editar factura).
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { construirMapaCatalogos } from './mapaCatalogos';
import { codigoMonedaFactura, monedaDeClienteNombre, monedaFacturaMostrar, monedaFacturacionCliente, nombreMonedaCanonico } from './monedaFacturaCliente';

const monedas = [{ id: 'mon-dls', nombre: 'Dólares' }, { id: 'mon-raro', nombre: 'Euros' }];
const empresas = [
  { id: 'cli-usd', nombre: 'Caro-Kar', monedaFacturacion: ID_USD },
  { id: 'cli-cat', nombre: 'Temm Truck', moneda: 'mon-dls' },
  { id: 'cli-mxn', nombre: 'Like Solutions', monedaRef: 'Pesos', monedaFacturacion: ID_USD },
  { id: 'cli-sin', nombre: 'Sin moneda' },
];
const mapa = construirMapaCatalogos([monedas], empresas);

describe('moneda de una factura de cliente', () => {
  it('nombre canónico: código, id del catálogo, N/A y lo que no se reconoce', () => {
    expect(nombreMonedaCanonico('USD', mapa)).toBe('Dólares');
    expect(nombreMonedaCanonico(ID_MXN, mapa)).toBe('Pesos');
    expect(nombreMonedaCanonico('mon-dls', mapa)).toBe('Dólares');
    expect(nombreMonedaCanonico(' N/A ', mapa)).toBe('');
    expect(nombreMonedaCanonico('', mapa)).toBe('');
    expect(nombreMonedaCanonico('mon-raro', mapa)).toBe('Euros');
    expect(nombreMonedaCanonico('xyz', mapa)).toBe('xyz');
  });
  it('la del cliente en Empresas (monedaRef, moneda, monedaFacturacion, en ese orden)', () => {
    expect(monedaDeClienteNombre('cli-usd', empresas, mapa)).toBe('Dólares');
    expect(monedaDeClienteNombre('cli-cat', empresas, mapa)).toBe('Dólares');
    expect(monedaDeClienteNombre('cli-mxn', empresas, mapa)).toBe('Pesos');
    expect(monedaDeClienteNombre('cli-sin', empresas, mapa)).toBe('');
    expect(monedaDeClienteNombre('', empresas, mapa)).toBe('');
  });
  it('manda la moneda en que se emitió; la del cliente solo si la factura no trae', () => {
    expect(monedaFacturaMostrar({ monedaFacturacion: 'MXN', clienteId: 'cli-usd' }, empresas, mapa)).toBe('Pesos');
    expect(monedaFacturaMostrar({ moneda: 'Dólares', clienteId: 'cli-mxn' }, empresas, mapa)).toBe('Dólares');
    expect(monedaFacturaMostrar({ clienteId: 'cli-mxn' }, empresas, mapa)).toBe('Pesos');
    expect(monedaFacturaMostrar({ clienteId: 'cli-sin' }, empresas, mapa)).toBe('N/A');
    expect(codigoMonedaFactura({ monedaFacturacion: ID_USD }, empresas, mapa)).toBe('USD');
    expect(codigoMonedaFactura({ clienteId: 'cli-sin' }, empresas, mapa)).toBeNull();
  });
  it('la moneda con que se factura es la del cliente (monedaDeEmpresa)', () => {
    expect(monedaFacturacionCliente('cli-usd', empresas, mapa)).toBe('USD');
    expect(monedaFacturacionCliente('cli-cat', empresas, mapa)).toBe('USD');
    expect(monedaFacturacionCliente('cli-sin', empresas, mapa)).toBeNull();
    expect(monedaFacturacionCliente('no-existe', empresas, mapa)).toBeNull();
  });
});

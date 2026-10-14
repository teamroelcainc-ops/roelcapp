// ✅ V00452 — facturas pagables de Pagos: moneda de la empresa (índice), cobrables, total y MTTO.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import {
  claveEntidad, claveFecha, crearMonedaEmpresa, esFacturaCobrable, facturasMtto, facturasPagablesDe, monedaDeFactura,
} from './facturasPagables';
import type { DocFactura } from './facturasPagables';

const empresas = [
  { id: 'E1', nombre: 'Transportes Uno', monedaId: ID_USD },
  { id: 'E2', nombre: 'Logística Dos ', moneda: 'Pesos' },
  { id: 'E3', nombre: 'Sin Moneda' },
  { id: 'E1', nombre: 'Duplicada', monedaId: ID_MXN }, // mismo id: gana la primera (como el find de antes)
];
const monedas = [{ id: ID_USD, moneda: 'Dólares' }, { id: ID_MXN, moneda: 'Pesos' }];
const monedaEmpresa = crearMonedaEmpresa(empresas, monedas);
const o = { reglaUnica: false, monedaEmpresa };

/** Documento como lo entrega el listener: { id, ...datos } con `_docId` no enumerable. */
const docVivo = (id: string, datos: Record<string, unknown>): DocFactura => {
  const d = { id, ...datos } as DocFactura;
  Object.defineProperty(d, '_docId', { value: id, enumerable: false });
  return d;
};

describe('crearMonedaEmpresa', () => {
  it('por id primero, luego por nombre (sin mayúsculas ni espacios alrededor)', () => {
    expect(monedaEmpresa({ clienteId: 'E1' })).toBe('Dólares');
    expect(monedaEmpresa({ entidadNombre: 'logística dos' })).toBe('Pesos');
    expect(monedaEmpresa({ entidadId: 'NO-EXISTE', entidadNombre: 'Transportes Uno' })).toBe('Dólares');
  });
  it('empresa encontrada sin moneda, o no encontrada → vacío', () => {
    expect(monedaEmpresa({ empresaId: 'E3' })).toBe('');
    expect(monedaEmpresa({ entidadNombre: 'Nadie' })).toBe('');
  });
});

describe('monedaDeFactura', () => {
  it('la moneda de la EMPRESA manda sobre la guardada en la factura', () => {
    expect(monedaDeFactura({ clienteId: 'E1', monedaFacturacion: 'MXN' }, monedaEmpresa)).toBe('USD');
  });
  it('sin moneda de empresa: los campos de la factura; si no se reconoce, el texto tal cual', () => {
    expect(monedaDeFactura({ clienteId: 'E3', moneda: 'Dolares' }, monedaEmpresa)).toBe('USD');
    expect(monedaDeFactura({ monedaFacturacion: 'EUR-X' }, monedaEmpresa)).toBe('EUR-X');
  });
});

describe('esFacturaCobrable', () => {
  it('sin status = Facturado; fuera canceladas y "No Facturado"', () => {
    expect(esFacturaCobrable({})).toBe(true);
    expect(esFacturaCobrable({ statusFactura: 'Cancelada' })).toBe(false);
    expect(esFacturaCobrable({ statusFactura: 'No Facturado' })).toBe(false);
    expect(esFacturaCobrable({ statusFactura: 'Facturado' })).toBe(true);
  });
});

describe('facturasPagablesDe', () => {
  const docs = [
    docVivo('F1', { invoice: 'INV-1', clienteId: 'E1', clienteNombre: 'Transportes Uno', subtotalMonedaFactura: 100, montoPagado: 40, fecha: '2026-10-01' }),
    docVivo('F2', { invoice: 'INV-2', clienteId: 'E1', subtotalMonedaFactura: 0 }), // documento secundario de un folio: sin total
    docVivo('F3', { invoice: 'INV-3', statusFactura: 'Cancelada', subtotalMonedaFactura: 50 }),
  ];
  it('solo cobrables con total; saldo = total − pagado; id real', () => {
    const r = facturasPagablesDe(docs, 'cliente', o);
    expect(r.map((f) => f.id)).toEqual(['F1']);
    expect(r[0]).toMatchObject({ invoice: 'INV-1', total: 100, montoPagado: 40, saldo: 60, moneda: 'USD', entidadNombre: 'Transportes Uno' });
    expect(r[0].raw && 'id' in r[0].raw).toBe(false); // como d.data(): sin el id que agrega el listener
  });
  it('un campo `id` guardado distinto: el id de la lista es el REAL y raw conserva el guardado', () => {
    const d = { id: 'IMP-7', invoice: 'INV-7', subtotalMonedaFactura: 10 } as DocFactura;
    Object.defineProperty(d, '_docId', { value: 'real7', enumerable: false });
    const [f] = facturasPagablesDe([d], 'cliente', o);
    expect(f.id).toBe('real7');
    expect(f.raw?.id).toBe('IMP-7');
  });
  it('proveedores: entidad del lado proveedor', () => {
    const [f] = facturasPagablesDe([docVivo('P1', { invoice: 'P-1', proveedorId: 'E2', proveedorNombre: 'Logística Dos', subtotalMonedaFactura: 5 })], 'proveedor', o);
    expect(f).toMatchObject({ entidadId: 'E2', entidadNombre: 'Logística Dos', moneda: 'MXN' });
  });
});

describe('facturasMtto', () => {
  it('agrupa por invoice y descuenta lo pagado con pagos tipo mtto', () => {
    const gastos = [
      docVivo('g1', { invoice: 'M-1', total: 100, proveedorNombre: 'Taller', fecha: '2026-10-01' }),
      docVivo('g2', { invoice: 'm-1', importe: 50, ivaMonto: 8, retIva: 0, retIsr: 0, fecha: '2026-10-05' }),
      docVivo('g3', { total: 30 }), // sin invoice: no es pagable
    ];
    const pagos = [{ tipo: 'mtto', facturas: [{ facturaId: 'MTTO__m-1', aplicado: 120 }] }, { tipo: 'cliente', facturas: [{ facturaId: 'MTTO__m-1', aplicado: 999 }] }];
    const [f, ...resto] = facturasMtto(gastos, pagos);
    expect(resto).toHaveLength(0);
    expect(f).toMatchObject({ id: 'MTTO__m-1', invoice: 'M-1', total: 158, montoPagado: 120, saldo: 38, fecha: '2026-10-05', entidadNombre: 'Taller', moneda: 'MXN' });
  });
});

describe('claves', () => {
  it('entidad sin acentos, mayúsculas ni espacios de más; fecha ordenable', () => {
    expect(claveEntidad('  Logística  Dos ')).toBe('logistica dos');
    expect(claveFecha('5/3/2026')).toBe('2026-03-05');
    expect(claveFecha('2026-03-05T10:00')).toBe('2026-03-05');
  });
});

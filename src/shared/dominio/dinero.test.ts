// ✅ V00441 (Fase 5.1) — una sola fórmula de dinero. Además de casos reales, cada
// regla se compara contra la copia que había antes (Facturación, Pagos, servidor)
// con miles de operaciones al azar: la unificación no cambia ni un centavo.
import { describe, expect, it } from 'vitest';
import { ID_MXN, ID_USD } from './constantes';
import {
  agregadosFactura, calcularAbono, calcularReversion, conversionOperacion, ErrorDinero, estadoFactura, monedaConvenioDe, monedaConvenioDeducida, montoOperacion,
  renglonEnCentavos, renglonFactura, totalesTrasCambioDeOps, totalNativoDeRenglonesLegado, totalNativoFactura,
  totalNativoFacturaLegado,
} from './dinero';
import type { Lado } from './dinero';

type D = Record<string, unknown>;

// ── Copias de las reglas ANTERIORES (referencia) ──────────────────────────
const refConversion = (op: D, lado: Lado) => {
  const cli = lado === 'cliente';
  const fact = cli ? op.facturadoEnCobrar : op.facturadoEnUnidad;
  const tc = Number(op.tipoCambioAprobado) || Number(op.tipoCambioDia) || 0;
  const montoConvenio = Number((cli ? op.montoConvenioCliente : op.totalAPagarProv) || 0);
  const cargos = Number((cli ? op.cargosAdicionales : op.cargosAdicionalesProv) || 0);
  const nombreMoneda = String((cli ? op.monedaCobroNombre : op.monedaUnidadNombre) || '').toUpperCase();
  const factUSD = fact === ID_USD || nombreMoneda.includes('USD') || nombreMoneda.includes('DOLAR') || nombreMoneda.includes('DÓLAR');
  const factMXN = fact === ID_MXN || nombreMoneda.includes('MXN') || nombreMoneda.includes('PESO');
  const monConv = String((cli ? op.monedaConvenioCliente : op.monedaConvenioProv) || '');
  const convUSD = monConv === ID_USD || (!!monConv && (monConv.toUpperCase().includes('USD') || monConv.toUpperCase().includes('DOLAR') || monConv.toUpperCase().includes('DÓLAR')));
  const convMXN = monConv === ID_MXN || (!!monConv && (monConv.toUpperCase().includes('MXN') || monConv.toUpperCase().includes('PESO')));
  let subtotal = montoConvenio;
  if (convUSD && factMXN) subtotal = tc > 0 ? montoConvenio * tc : 0;
  else if (convMXN && factUSD) subtotal = tc > 0 ? montoConvenio / tc : 0;
  let cargosFact = cargos;
  if (convUSD && factMXN) cargosFact = tc > 0 ? cargos * tc : 0;
  else if (convMXN && factUSD) cargosFact = tc > 0 ? cargos / tc : 0;
  const r2f = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const total = r2f(r2f(subtotal) + r2f(cargosFact));
  let dol = 0, pes = 0, conv = 0;
  const facturaUSD = factUSD || (!factMXN && convUSD);
  if (facturaUSD) { dol = total; pes = 0; conv = total * tc; } else { dol = 0; pes = total; conv = total; }
  return { subtotal: r2f(subtotal), cargos: r2f(cargosFact), total, dol: r2f(dol), pes: r2f(pes), conv: r2f(conv), tc };
};

const refMontoCliente = (op: D) => {
  const calc = refConversion(op, 'cliente');
  const convGuardada = Number(op.conversionCliente);
  if (calc.conv === 0 && !isNaN(convGuardada) && convGuardada > 0) {
    return { ...calc, conv: convGuardada, total: calc.total || Number(op.subtotalCliente) || 0, pes: Number(op.pesosCliente) || calc.pes, dol: Number(op.dolaresCliente) || calc.dol };
  }
  return calc;
};

const refMontoProveedor = (op: D) => {
  const calculado = refConversion(op, 'proveedor');
  if (calculado.total > 0 && calculado.conv > 0) return calculado;
  const convGuardada = Number(op.conversionProv);
  if (!isNaN(convGuardada) && convGuardada > 0) {
    return { ...calculado, subtotal: calculado.subtotal || Number(op.subtotalProv) || 0, total: calculado.total || Number(op.subtotalProv) || 0, dol: Number(op.dolaresProv) || calculado.dol, pes: Number(op.pesosProv) || calculado.pes, conv: convGuardada };
  }
  if (calculado.subtotal > 0 || calculado.conv > 0) return calculado;
  const ct = op.confirmacionTarifa as D | undefined;
  if (ct && typeof ct === 'object') {
    const subtotalCT = Number(ct.subtotalProv) || ((Number(ct.convenioProv) || 0) + (Number(ct.costosAdic) || 0));
    if (subtotalCT > 0) {
      const tc = Number(op.tipoCambioAprobado) || Number(ct.tipoCambio) || 0;
      const monedaTxt = String(ct.facturadoEn || ct.monedaConvenio || '').toUpperCase();
      const esDolarCT = monedaTxt.includes('USD') || monedaTxt.includes('DOLAR') || monedaTxt.includes('DÓLAR');
      const esPesoCT = monedaTxt.includes('MXN') || monedaTxt.includes('PESO');
      const convCT = Number(ct.totalAFacturar) || (esDolarCT && tc > 0 ? subtotalCT * tc : subtotalCT);
      return { subtotal: Number(ct.convenioProv) || subtotalCT, cargos: Number(ct.costosAdic) || 0, total: subtotalCT, dol: esDolarCT ? subtotalCT : 0, pes: esPesoCT ? subtotalCT : 0, conv: convCT, tc };
    }
  }
  return calculado;
};

const normR = (t: unknown): string => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/** Copia de totalNativoFactura de Pagos (aplicarPagos.ts, V00440). */
const refTotalPagos = (fac: D): number => {
  const monTxt = normR(fac.monedaFacturacion || fac.monedaProveedor || fac.moneda || fac.monedaId);
  const esUSD = monTxt === ID_USD || monTxt === 'usd' || monTxt === 'us$' || monTxt === 'dls' || monTxt.startsWith('dolar');
  const esMXN = monTxt === ID_MXN || monTxt === 'mxn' || monTxt === 'mn' || monTxt.startsWith('peso');
  const directo = Number(fac.subtotalMonedaFactura);
  if (!isNaN(directo) && directo > 0) return directo;
  const ops = Array.isArray(fac.operacionesGuardadas) ? (fac.operacionesGuardadas as D[]) : [];
  const suma = (c: string) => ops.reduce((s, o) => s + (Number(o?.[c]) || 0), 0);
  if (ops.length > 0) {
    if (esUSD) { const dol = suma('dol'); if (dol > 0) return dol; const base = suma('subtotalBase'); if (base > 0) return base; }
    else if (esMXN) { const conv = suma('monto'); if (conv > 0) return conv; const pes = suma('pes'); if (pes > 0) return pes; const base = suma('subtotalBase'); if (base > 0) return base; }
    else { const base = suma('subtotalBase'); if (base > 0) return base; }
  }
  return Number(fac.subtotalFactura) || Number(fac.total) || Number(fac.montoFactura) || 0;
};
/** Copia de totalNativoFacturaRel (servidor, V00440). */
const refTotalServidor = (fac: D, ops: D[]): number => {
  const r2rel = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
  const monTxt = normR(fac.monedaFacturacion || fac.monedaProveedor || fac.moneda || fac.monedaId);
  const esUSD = monTxt === ID_USD || monTxt === 'usd' || monTxt === 'us$' || monTxt === 'dls' || monTxt.startsWith('dolar');
  const esMXN = monTxt === ID_MXN || monTxt === 'mxn' || monTxt === 'mn' || monTxt.startsWith('peso');
  const suma = (c: string) => ops.reduce((s, o) => s + (Number(o?.[c]) || 0), 0);
  if (ops.length > 0) {
    if (esUSD) { const dol = suma('dol'); if (dol > 0) return r2rel(dol); const base = suma('subtotalBase'); if (base > 0) return r2rel(base); }
    else if (esMXN) { const conv = suma('monto'); if (conv > 0) return r2rel(conv); const pes = suma('pes'); if (pes > 0) return r2rel(pes); const base = suma('subtotalBase'); if (base > 0) return r2rel(base); }
    else { const base = suma('subtotalBase'); if (base > 0) return r2rel(base); }
  }
  return r2rel(fac.subtotalFactura || fac.total || fac.montoFactura || 0);
};

// ── Generador al azar (con semilla: siempre los mismos casos) ─────────────
const azar = (semilla: number) => () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const rnd = azar(20261010);
const de = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const MONEDAS = [ID_USD, ID_MXN, 'USD', 'MXN', 'Dólares', 'Pesos', 'DLS', 'M.N.', '', undefined, 'N/A', 'Pesos (MXN)'];
const MONTOS = [0, 1, 100, 1250.5, 99.999, '350', '', undefined, '1,200', 18.75, 4500];
const TCS = [0, 17.5, 18.2345, '19.1', undefined, 20];
const opAlAzar = (): D => ({
  facturadoEnCobrar: de(MONEDAS), facturadoEnUnidad: de(MONEDAS), monedaCobroNombre: de(MONEDAS), monedaUnidadNombre: de(MONEDAS),
  monedaConvenioCliente: de(MONEDAS), monedaConvenioProv: de(MONEDAS),
  montoConvenioCliente: de(MONTOS), cargosAdicionales: de(MONTOS), totalAPagarProv: de(MONTOS), cargosAdicionalesProv: de(MONTOS),
  tipoCambioAprobado: de(TCS), tipoCambioDia: de(TCS),
  conversionCliente: de(MONTOS), subtotalCliente: de(MONTOS), pesosCliente: de(MONTOS), dolaresCliente: de(MONTOS),
  conversionProv: de(MONTOS), subtotalProv: de(MONTOS), pesosProv: de(MONTOS), dolaresProv: de(MONTOS),
  confirmacionTarifa: rnd() < 0.3 ? { subtotalProv: de(MONTOS), convenioProv: de(MONTOS), costosAdic: de(MONTOS), tipoCambio: de(TCS), facturadoEn: de(MONEDAS), totalAFacturar: de(MONTOS) } : undefined,
});
const renglonAlAzar = (): D => ({ monto: de(MONTOS), dol: rnd() < 0.2 ? undefined : de(MONTOS), pes: de(MONTOS), subtotalBase: de(MONTOS) });
const facturaAlAzar = (): D => ({
  monedaFacturacion: de(MONEDAS), monedaProveedor: de(MONEDAS), moneda: de(MONEDAS), monedaId: de(MONEDAS),
  subtotalMonedaFactura: rnd() < 0.5 ? 0 : de(MONTOS), subtotalFactura: de(MONTOS), total: de(MONTOS),
  operacionesGuardadas: Array.from({ length: Math.floor(rnd() * 5) }, renglonAlAzar),
});

describe('paridad con las reglas anteriores (3,000 casos al azar)', () => {
  it('conversión y monto de operación = Facturación Clientes / Proveedores', () => {
    for (let i = 0; i < 3000; i++) {
      const op = opAlAzar();
      // ✅ V00486: la regla solo cambia cuando la moneda del convenio falta y se deduce de la conversión guardada.
      if (!monedaConvenioDe(op, 'cliente').deducida) {
        expect(conversionOperacion(op, 'cliente')).toEqual(refConversion(op, 'cliente'));
        expect(montoOperacion(op, 'cliente')).toEqual(refMontoCliente(op));
      }
      if (!monedaConvenioDe(op, 'proveedor').deducida) {
        expect(conversionOperacion(op, 'proveedor')).toEqual(refConversion(op, 'proveedor'));
        expect(montoOperacion(op, 'proveedor')).toEqual(refMontoProveedor(op));
      }
    }
  });
  it('total "legado" = Pagos; total de renglones "legado" = servidor', () => {
    for (let i = 0; i < 3000; i++) {
      const fac = facturaAlAzar();
      expect(totalNativoFacturaLegado(fac)).toBeCloseTo(refTotalPagos(fac), 9);
      const ops = fac.operacionesGuardadas as D[];
      expect(totalNativoDeRenglonesLegado(fac, ops)).toBe(refTotalServidor(fac, ops));
    }
  });
});

describe('conversión de una operación (regla V00126)', () => {
  const base = { tipoCambioAprobado: 18.5, montoConvenioCliente: 100, cargosAdicionales: 10 };
  it('convenio USD facturado en pesos → × TC (cargos también)', () => {
    const m = conversionOperacion({ ...base, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_MXN }, 'cliente');
    expect(m).toMatchObject({ subtotal: 1850, cargos: 185, total: 2035, pes: 2035, dol: 0, conv: 2035 });
  });
  it('convenio MXN facturado en dólares → ÷ TC', () => {
    const m = conversionOperacion({ ...base, montoConvenioCliente: 1850, cargosAdicionales: 0, monedaConvenioCliente: ID_MXN, facturadoEnCobrar: ID_USD }, 'cliente');
    expect(m).toMatchObject({ subtotal: 100, total: 100, dol: 100, conv: 1850 });
  });
  it('misma moneda: igual; sin TC un cruce de monedas da 0 (no se inventa)', () => {
    expect(conversionOperacion({ ...base, monedaConvenioCliente: 'USD', facturadoEnCobrar: ID_USD }, 'cliente')).toMatchObject({ total: 110, dol: 110, conv: 2035 });
    expect(conversionOperacion({ montoConvenioCliente: 100, monedaConvenioCliente: ID_USD, facturadoEnCobrar: ID_MXN }, 'cliente').total).toBe(0);
  });
  it('proveedor sin montos cae a la Confirmación de Tarifa', () => {
    const m = montoOperacion({ confirmacionTarifa: { convenioProv: 500, costosAdic: 50, facturadoEn: 'Dólares', tipoCambio: 18 } }, 'proveedor');
    expect(m).toMatchObject({ subtotal: 500, total: 550, dol: 550, conv: 9900 });
  });
});

describe('total de la factura (regla única)', () => {
  it('un total capturado a mano manda sobre todo lo demás', () => {
    expect(totalNativoFactura({ totalManualCentavos: 123456, subtotalMonedaFactura: 99, operacionesGuardadas: [{ monto: 5 }] })).toBe(1234.56);
  });
  it('la regla única reconoce más nombres de moneda que la legada (diferencias para la reconciliación)', () => {
    const fac = { monedaFacturacion: 'M.N.', operacionesGuardadas: [{ monto: 1000, subtotalBase: 50 }] };
    expect(totalNativoFactura(fac)).toBe(1000);
    expect(totalNativoFacturaLegado(fac)).toBe(50);
  });
  it('al cambiar operaciones, un total manual se ajusta por la diferencia y sigue marcado como manual', () => {
    const fac = { monedaFacturacion: 'USD', totalManualCentavos: 100000, subtotalMonedaFactura: 1000, subtotalFactura: 18000, operacionesGuardadas: [{ id: 'a', dol: 400, monto: 7200 }, { id: 'b', dol: 500, monto: 9000 }] };
    const r = totalesTrasCambioDeOps(fac, [{ id: 'a', dol: 400, monto: 7200 }]);
    expect(r).toMatchObject({ ok: true, total: 500, campos: { subtotalMonedaFactura: 500, totalManualCentavos: 50000 } });
  });
  it('✅ V00448 el documento secundario de un folio repetido (0/0 guardado) sigue en 0 al quitarle una operación', () => {
    const sec = { monedaFacturacion: 'USD', subtotalMonedaFactura: 0, subtotalFactura: 0,
      operacionesGuardadas: [{ id: 'a', dol: 300, monto: 5400 }, { id: 'b', dol: 500, monto: 9000 }] };
    const r = totalesTrasCambioDeOps(sec, [{ id: 'b', dol: 500, monto: 9000 }]);
    expect(r).toMatchObject({ ok: true, total: 0, campos: { subtotalMonedaFactura: 0, subtotalFactura: 0 } });
  });
  it('sin total guardado se parte de los renglones (como antes)', () => {
    const fac = { monedaFacturacion: 'USD', operacionesGuardadas: [{ id: 'a', dol: 300, monto: 5400 }, { id: 'b', dol: 500, monto: 9000 }] };
    const r = totalesTrasCambioDeOps(fac, [{ id: 'b', dol: 500, monto: 9000 }]);
    expect(r).toMatchObject({ ok: true, total: 500, campos: { subtotalMonedaFactura: 500, subtotalFactura: 9000 } });
  });
});

describe('pagos', () => {
  const factura = { monedaFacturacion: 'USD', subtotalMonedaFactura: 1000, montoPagado: 250 };
  it('abono con el saldo fresco', () => {
    const ab = calcularAbono(factura, 500, 'F-1', 'unica');
    expect(ab).toMatchObject({ total: 1000, saldoAnterior: 750, aplicado: 500, saldoNuevo: 250, cambios: { montoPagado: 750, saldoPendiente: 250, statusPago: 'PARCIAL' } });
  });
  it('no se aplica más que el saldo (otro usuario ya pagó): error con mensaje para el usuario', () => {
    expect(() => calcularAbono({ ...factura, montoPagado: 900 }, 500, 'F-1', 'unica')).toThrow(ErrorDinero);
  });
  it('revertir nunca deja el pagado negativo', () => {
    expect(calcularReversion(factura, 400, 'unica')).toEqual({ montoPagado: 0, saldoPendiente: 1000, statusPago: '' });
  });
  it('dos pagos simultáneos: el segundo se calcula sobre lo que dejó el primero', () => {
    const p1 = calcularAbono(factura, 600, 'F-1', 'unica');
    const trasP1 = { ...factura, ...p1.cambios };
    expect(() => calcularAbono(trasP1, 600, 'F-1', 'unica')).toThrow(/ya no tiene saldo suficiente/);
    expect(estadoFactura(trasP1, 'unica').saldo).toBe(150);
  });
});

describe('agregados y renglones en centavos', () => {
  it('sobrepago: el saldo es 0 y lo de más queda a favor (no se pierde con Math.max)', () => {
    expect(agregadosFactura({ subtotalMonedaFactura: 800, montoPagado: 1000.5 })).toEqual({
      totalCentavos: 80000, montoPagadoCentavos: 100050, saldoCentavos: 0, saldoAFavorCentavos: 20050, abierta: false,
    });
  });
  it('una factura cancelada no cuenta como abierta', () => {
    expect(agregadosFactura({ subtotalMonedaFactura: 800, statusFactura: 'Cancelada' }).abierta).toBe(false);
    expect(agregadosFactura({ subtotalMonedaFactura: 800 }).abierta).toBe(true);
  });
  it('renglón: el monto nativo depende de la moneda de la factura', () => {
    const r = { ref: 'TR-1', monto: 1850.4, dol: 100.02, pes: 0, subtotalBase: 100.02 };
    expect(renglonEnCentavos(r, 'USD').montoCentavos).toBe(10002);
    expect(renglonEnCentavos(r, 'MXN').montoCentavos).toBe(185040);
  });
  it('renglón de factura con los campos de siempre', () => {
    const r = renglonFactura('op1', { ref: 'TR-1', refCliente: 'PO-9', convenioNombre: 'Transfer', numeroRemolque: 'r1', montoConvenioCliente: 100, monedaConvenioCliente: 'USD', facturadoEnCobrar: ID_USD, tipoCambioAprobado: 18 }, 'cliente', (v) => (v === 'r1' ? 'CAJA 12' : v));
    expect(r).toEqual({ id: 'op1', ref: 'TR-1', monto: 1800, subtotalBase: 100, dol: 100, pes: 0, convenioNombre: 'Transfer', refCliente: 'PO-9', remolque: 'CAJA 12' });
  });
});

describe('✅ V00486 — convenio sin moneda: se deduce de la conversión guardada', () => {
  // LO-050626-002 (Juan Carlos Quintanar): convenio 115 (USD), facturado en Pesos, TC 17.2888;
  //   el formulario guardó Pesos (Cliente) y Conversión Final $1,988.21, sin monedaConvenioCliente.
  const quintanar = {
    montoConvenioCliente: 115, cargosAdicionales: 0, facturadoEnCobrar: ID_MXN, monedaConvenioCliente: '',
    tipoCambioAprobado: 17.2888, subtotalCliente: 115, dolaresCliente: 0, pesosCliente: 1988.21, conversionCliente: 1988.21,
  };
  it('convenio en dólares facturado en pesos: × TC (antes quedaba en $115 pesos)', () => {
    expect(monedaConvenioDe(quintanar, 'cliente')).toEqual({ moneda: 'USD', deducida: true });
    const m = montoOperacion(quintanar, 'cliente');
    expect([m.pes, m.conv, m.dol]).toEqual([1988.21, 1988.21, 0]);
    expect(renglonFactura('o1', quintanar, 'cliente').monto).toBe(1988.21);
  });
  it('convenio en pesos (la conversión guardada es igual al convenio): sin cambio', () => {
    const op = { ...quintanar, montoConvenioCliente: 2000, conversionCliente: 2000, pesosCliente: 2000 };
    expect(monedaConvenioDeducida(op, 'cliente')).toBe('MXN');
    expect(montoOperacion(op, 'cliente').conv).toBe(2000);
  });
  it('convenio en pesos facturado en dólares: ÷ TC', () => {
    const op = { montoConvenioCliente: 1850, facturadoEnCobrar: ID_USD, tipoCambioAprobado: 18.5, conversionCliente: 1850 };
    const m = montoOperacion(op, 'cliente');
    expect([m.dol, m.conv]).toEqual([100, 1850]);
  });
  it('la moneda guardada manda; sin conversión guardada no se deduce (regla de antes)', () => {
    expect(montoOperacion({ ...quintanar, monedaConvenioCliente: ID_MXN }, 'cliente').conv).toBe(115);
    const sinGuardada = { ...quintanar, conversionCliente: 0, pesosCliente: 0 };
    expect(monedaConvenioDe(sinGuardada, 'cliente')).toEqual({ moneda: null, deducida: false });
    expect(montoOperacion(sinGuardada, 'cliente').conv).toBe(115);
    // una conversión que no se parece a ninguna (p. ej. 3×) tampoco deduce
    expect(monedaConvenioDeducida({ ...quintanar, conversionCliente: 345 }, 'cliente')).toBeNull();
  });
  it('proveedores: con la conversión del proveedor', () => {
    const op = { totalAPagarProv: 50, cargosAdicionalesProv: 0, facturadoEnUnidad: ID_MXN, tipoCambioAprobado: 18, conversionProv: 900 };
    expect(monedaConvenioDe(op, 'proveedor')).toEqual({ moneda: 'USD', deducida: true });
    expect(montoOperacion(op, 'proveedor').conv).toBe(900);
  });
  it('sin TC en la operación: cae a la conversión guardada (respaldo de siempre)', () => {
    const op = { ...quintanar, tipoCambioAprobado: 0 };
    expect(montoOperacion(op, 'cliente').conv).toBe(1988.21);
  });
});

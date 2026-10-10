// ✅ V00441 (Fase 5.6) — el saldo corriente de diesel da la MISMA cuenta que la tarjeta de siempre.
import { describe, expect, it } from 'vitest';
import {
  agregadosDiesel, aporteDieselCambio, claveProveedorDiesel, cuentasDiesel, cuentasDieselDesdeReferencias, diaDiesel, idSaldoDiesel,
} from './saldosCorrientes';
import type { SaldoCorrienteDiesel } from './saldosCorrientes';

type Datos = Record<string, unknown>;

const docs = (refs: Datos[]): SaldoCorrienteDiesel[] =>
  Array.from(agregadosDiesel(refs).entries()).map(([clave, v]) => ({ tipo: 'diesel', clave, nombre: v.nombre, dias: v.dias }));

// Generador determinista (sin Math.random: la prueba siempre ve los mismos casos).
const lcg = (semilla: number) => { let s = semilla; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; };

describe('saldo corriente de diesel', () => {
  it('clave: ID del proveedor; sin ID, el nombre', () => {
    expect(claveProveedorDiesel({ proveedorId: 'P1', proveedorNombre: 'Gas' })).toBe('P1');
    expect(claveProveedorDiesel({ proveedor: 'P2' })).toBe('P2');
    expect(claveProveedorDiesel({ proveedorNombre: ' Gas Norte ' })).toBe('nombre:gas norte');
    expect(idSaldoDiesel('__todos__')).toBe('diesel___todos__');
    expect(idSaldoDiesel('nombre:a/b')).not.toContain('/');
  });

  it('el día suma por proveedor y en el general; galones × costo como respaldo', () => {
    const dia = diaDiesel([
      { proveedorId: 'P1', fecha: '2026-10-10', totalCargado: 100.5 },
      { proveedorId: 'P1', fecha: '2026-10-10', galonesCargados: 10, costoDiesel: 3.25 },
      { proveedorId: 'P2', fecha: '2026-10-10', totalCargado: 0 },
    ]);
    expect(dia.get('P1')).toMatchObject({ c: 13300, n: 2 });
    expect(dia.get('__todos__')).toMatchObject({ c: 13300, n: 2 });
    expect(dia.has('P2')).toBe(false);
  });

  it('solo cambia el saldo si cambia proveedor, fecha o monto', () => {
    const r = { proveedorId: 'P1', fecha: '2026-10-10', totalCargado: 50, fotos: [] };
    expect(aporteDieselCambio(r, { ...r, fotos: ['x'], observaciones: 'y' })).toBe(false);
    expect(aporteDieselCambio(r, { ...r, totalCargado: 51 })).toBe(true);
    expect(aporteDieselCambio(r, { ...r, fecha: '2026-10-11' })).toBe(true);
    expect(aporteDieselCambio(undefined, r)).toBe(true);
    expect(aporteDieselCambio(r, undefined)).toBe(true);
  });

  it('paridad con la cuenta de siempre (2,000 referencias al azar)', () => {
    const azar = lcg(441);
    const provs = ['P1', 'P2', 'P3'];
    const fechas = Array.from({ length: 40 }, (_, i) => `2026-09-${String((i % 30) + 1).padStart(2, '0')}`);
    const refs: Datos[] = Array.from({ length: 2000 }, () => {
      const p = provs[Math.floor(azar() * provs.length)];
      return {
        proveedorId: p, proveedorNombre: `Proveedor ${p}`, fecha: fechas[Math.floor(azar() * fechas.length)],
        ...(azar() < 0.7 ? { totalCargado: Math.round(azar() * 500000) / 100 } : { galonesCargados: Math.round(azar() * 200), costoDiesel: 3.5 }),
      };
    });
    const saldos: Datos[] = [
      { proveedorId: 'P1', proveedorNombre: 'Proveedor P1', fecha: '2026-09-05', saldo: 100000 },
      { proveedorId: 'P1', proveedorNombre: 'Proveedor P1', fecha: '2026-09-20', saldo: 5000 },
      { proveedorId: 'P2', proveedorNombre: 'Proveedor P2', fecha: '2026-09-01', saldo: 70000 },
      { proveedorId: '__todos__', proveedorNombre: 'Todos los proveedores', fecha: '2026-09-15', saldo: 250000 },
    ];
    const hoy = '2026-09-20';
    const antes = cuentasDieselDesdeReferencias(saldos, refs, hoy);
    const ahora = cuentasDiesel(saldos, docs(refs), hoy);
    expect(ahora.length).toBe(antes.length);
    ahora.forEach((c, i) => {
      expect(c.clave).toBe(antes[i].clave);
      expect(c.restante).toBeCloseTo(antes[i].restante, 2);
      expect(c.cargasHoy).toBe(antes[i].cargasHoy);
      expect(c.cargadoHoy).toBeCloseTo(antes[i].cargadoHoy, 2);
    });
  });

  it('referencias viejas sin ID cuentan por el nombre del saldo', () => {
    const refs: Datos[] = [
      { proveedorId: 'P1', proveedorNombre: 'Gas', fecha: '2026-10-01', totalCargado: 10 },
      { proveedorNombre: 'GAS ', fecha: '2026-10-02', totalCargado: 5 },
      { proveedorId: 'P1', proveedorNombre: 'Gas', fecha: '2026-09-01', totalCargado: 99 }, // antes del 1er saldo
    ];
    const saldos: Datos[] = [{ proveedorId: 'P1', proveedorNombre: 'Gas', fecha: '2026-10-01', saldo: 100, moneda: 'Dólares' }];
    const [c] = cuentasDiesel(saldos, docs(refs), '2026-10-02');
    expect(c).toMatchObject({ restante: 85, cargasHoy: 1, cargadoHoy: 5, moneda: 'Dólares' });
    expect(cuentasDieselDesdeReferencias(saldos, refs, '2026-10-02')[0].restante).toBe(85);
  });
});

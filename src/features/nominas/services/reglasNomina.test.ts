// src/features/nominas/services/reglasNomina.test.ts — ✅ Fase 1.8b
import { describe, expect, it } from 'vitest';
import {
  ErrorNomina, formatearFolioNomina, huellaSaldos, idContadorFolioNomina, mensajeConflictosNomina,
  numeroDeFolio, ordenarNominasRecientes, prefijoFolioNomina, tieneFechaPagoCanonica, unirNominasPorId,
  vinculoNominaDeOp,
} from './reglasNomina';

describe('folio de nómina', () => {
  it('conserva el formato NOMINA-DDMMAAAA-### por día', () => {
    const prefijo = prefijoFolioNomina('2026-10-10');
    expect(prefijo).toBe('NOMINA-10102026-');
    expect(formatearFolioNomina(prefijo, 7)).toBe('NOMINA-10102026-007');
    expect(idContadorFolioNomina(prefijo)).toBe('referencias_nomina_10102026');
  });

  it('rechaza fechas inválidas en lugar de generar "undefined"', () => {
    expect(prefijoFolioNomina('')).toBe('');
    expect(prefijoFolioNomina('10/10/2026')).toBe('');
  });

  it('lee el número solo de folios del mismo prefijo', () => {
    expect(numeroDeFolio('NOMINA-10102026-012', 'NOMINA-10102026-')).toBe(12);
    expect(numeroDeFolio('NOMINA-101026-012', 'NOMINA-10102026-')).toBe(0);
    expect(numeroDeFolio(undefined, 'NOMINA-10102026-')).toBe(0);
  });
});

describe('vínculo operación ↔ nómina', () => {
  it('libre si la operación no apunta a ninguna nómina', () => {
    expect(vinculoNominaDeOp({}, 'A', 'F').tipo).toBe('libre');
    expect(vinculoNominaDeOp({ referenciaNominaId: null, referenciaNominaConsecutivo: null }, 'A', 'F').tipo).toBe('libre');
  });

  it('otra nómina por id o, en datos heredados, por folio', () => {
    expect(vinculoNominaDeOp({ referenciaNominaId: 'B', referenciaNominaConsecutivo: 'NOMINA-1' }, 'A', 'F'))
      .toEqual({ tipo: 'otra', folio: 'NOMINA-1' });
    expect(vinculoNominaDeOp({ referenciaNominaConsecutivo: 'G' }, 'A', 'F')).toEqual({ tipo: 'otra', folio: 'G' });
  });

  it('propia cuando ya apunta a la nómina que se guarda', () => {
    expect(vinculoNominaDeOp({ referenciaNominaId: 'A', referenciaNominaConsecutivo: 'F' }, 'A', 'F'))
      .toEqual({ tipo: 'propia', exacto: true });
    expect(vinculoNominaDeOp({ referenciaNominaConsecutivo: 'F' }, 'A', 'F')).toEqual({ tipo: 'propia', exacto: false });
  });

  it('el mensaje lista referencia y folio', () => {
    const msj = mensajeConflictosNomina([{ ref: 'TR-1', folio: 'NOMINA-09102026-001' }]);
    expect(msj).toContain('TR-1 → NOMINA-09102026-001');
  });
});

describe('huella de saldos', () => {
  it('solo cambia cuando cambian los campos de saldo', () => {
    expect(huellaSaldos({ saldoPrestamo: 5, id: 'x', IMSS: 1 })).toBe(huellaSaldos({ saldoPrestamo: 5 }));
    expect(huellaSaldos({ saldoPrestamo: 5 })).not.toBe(huellaSaldos({ saldoPrestamo: 6 }));
    expect(huellaSaldos(null)).toBe(huellaSaldos({}));
  });
});

describe('utilidades', () => {
  it('une listas sin repetir id', () => {
    expect(unirNominasPorId([{ id: 'a' }], null, [{ id: 'a' }, { id: 'b' }]).map(n => n.id)).toEqual(['a', 'b']);
  });

  it('ErrorNomina conserva el mensaje para el usuario', () => {
    const e = new ErrorNomina('x');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('x');
  });
});

describe('nóminas heredadas sin fechaPago AAAA-MM-DD (PENDIENTE Fase 4)', () => {
  it('solo cuenta como canónica una fechaPago de texto AAAA-MM-DD', () => {
    expect(tieneFechaPagoCanonica({ id: 'a', fechaPago: '2026-10-10' })).toBe(true);
    expect(tieneFechaPagoCanonica({ id: 'b' })).toBe(false);
    expect(tieneFechaPagoCanonica({ id: 'c', fechaPago: '10/10/2026' })).toBe(false);
    expect(tieneFechaPagoCanonica({ id: 'd', fechaPago: { seconds: 1760054400, nanoseconds: 0 } })).toBe(false);
  });

  it('ordena como antes: createdAt o fechaPago, más reciente primero, ilegibles al final', () => {
    const lista = [
      { id: 'viejo', fechaPago: '01/02/2025' },
      { id: 'sinFecha' },
      { id: 'ts', fechaPago: { seconds: Date.UTC(2026, 0, 15, 12) / 1000 } },
      { id: 'nuevo', createdAt: '2026-10-09T15:00:00.000Z', fechaPago: '2026-10-09' },
    ];
    expect(ordenarNominasRecientes(lista).map(n => n.id)).toEqual(['nuevo', 'ts', 'viejo', 'sinFecha']);
  });
});

// ✅ V00501 — desglose de una fecha (Año, Mes, Semana, Día) como lo cuenta Roelca.
import { describe, expect, it } from 'vitest';
import { partesDeFecha, semanaDelAnio } from './fechas';

describe('semanaDelAnio', () => {
  it('lunes a domingo; la semana 1 es la del 1 de enero', () => {
    expect(semanaDelAnio('2026-01-01')).toBe(1); // jueves
    expect(semanaDelAnio('2026-01-04')).toBe(1); // domingo
    expect(semanaDelAnio('2026-01-05')).toBe(2); // lunes
    expect(semanaDelAnio('2026-10-25')).toBe(43); // domingo
    expect(semanaDelAnio('2026-10-26')).toBe(44); // lunes
    expect(semanaDelAnio('2026-12-31')).toBe(53);
    expect(semanaDelAnio('2027-01-01')).toBe(1);
  });
  it('un lunes con horario de verano empieza su semana (antes caía en la anterior)', () => {
    expect(semanaDelAnio('2026-03-08')).toBe(10); // domingo, cambio de horario en Texas
    expect(semanaDelAnio('2026-03-09')).toBe(11); // lunes
    expect(semanaDelAnio('2026-03-30')).toBe(14); // lunes, después del cambio en Europa
  });
  it('fecha no válida → 0', () => {
    expect(semanaDelAnio('')).toBe(0);
    expect(semanaDelAnio('26/10/2026')).toBe(0);
    expect(semanaDelAnio('2026-02-30')).toBe(0);
  });
});

describe('partesDeFecha', () => {
  it('año, mes y día con nombre, y la semana', () => {
    expect(partesDeFecha('2026-10-26')).toEqual({ anio: 2026, mes: 'octubre', semana: 44, dia: 'lunes' });
    expect(partesDeFecha('2026-01-01T10:00:00')).toEqual({ anio: 2026, mes: 'enero', semana: 1, dia: 'jueves' });
    expect(partesDeFecha('2026-03-08')).toEqual({ anio: 2026, mes: 'marzo', semana: 10, dia: 'domingo' });
    expect(partesDeFecha('x')).toBeNull();
  });
});

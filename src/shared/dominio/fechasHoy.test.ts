// ✅ V00535 — "Hoy" en la zona de las operaciones (igual en web y servidor) y fecha corta para mostrar.
import { describe, expect, it } from 'vitest';
import { fechaCortaEs, hoyEnZona, ZONA_HORARIA_DOMINIO } from './fechas';

describe('hoyEnZona', () => {
  it('a las 7 p. m. de Nuevo Laredo todavía es el mismo día (en UTC ya es mañana)', () => {
    const tarde = new Date('2026-10-31T00:30:00Z'); // 30-oct 7:30 p. m. en Nuevo Laredo (UTC-5 en horario de verano)
    expect(tarde.toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(hoyEnZona(ZONA_HORARIA_DOMINIO, tarde)).toBe('2026-10-30');
  });
  it('en invierno (UTC-6) también', () => {
    expect(hoyEnZona(ZONA_HORARIA_DOMINIO, new Date('2026-12-16T05:00:00Z'))).toBe('2026-12-15');
    expect(hoyEnZona(ZONA_HORARIA_DOMINIO, new Date('2026-12-16T06:30:00Z'))).toBe('2026-12-16');
  });
  it('una zona inválida cae a la fecha UTC', () => {
    expect(hoyEnZona('Zona/Inexistente', new Date('2026-10-31T00:30:00Z'))).toBe('2026-10-31');
  });
});

describe('fechaCortaEs', () => {
  it('AAAA-MM-DD se muestra en su día (no el anterior)', () => {
    expect(fechaCortaEs('2026-10-31')).toBe('31 oct 2026');
  });
  it('también d/m/aaaa de AppSheet, fecha y hora, y un Timestamp', () => {
    expect(fechaCortaEs('5/1/2026')).toBe('05 ene 2026');
    expect(fechaCortaEs('2026-10-31T23:15')).toBe('31 oct 2026');
    expect(fechaCortaEs({ toDate: () => new Date(2026, 9, 31, 22, 0) })).toBe('31 oct 2026');
  });
  it('vacío o no reconocido → texto vacío', () => {
    expect(fechaCortaEs('')).toBe('');
    expect(fechaCortaEs('no es fecha')).toBe('');
  });
});

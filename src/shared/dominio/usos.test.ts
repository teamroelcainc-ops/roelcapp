// ✅ V00442 (Fase 6.5) — qué operaciones cuentan para los contadores de uso.
import { describe, expect, it } from 'vitest';
import { contarUsos, diferenciaUsos, idUso, usosDeOperacion } from './usos';

const ID_A = 'AAAAAAAAAAAAAAAAAAA1';
const ID_B = 'BBBBBBBBBBBBBBBBBBB2';

describe('contadores de uso', () => {
  it('cuenta empresas por ID (canónicas si existen) y convenios por su consecutivo', () => {
    expect(Array.from(usosDeOperacion({ clientePaga: ID_A, origen: 'Bodega Norte', convenio: 'CONV-054' })).sort())
      .toEqual([`convenioCliente|CONV-054`, `empresa|${ID_A}`]);
    expect(Array.from(usosDeOperacion({ clientePaga: 'Acme (nombre viejo)', empresasIds: [ID_A, ID_B] })).sort())
      .toEqual([`empresa|${ID_A}`, `empresa|${ID_B}`]);
    expect(usosDeOperacion({ clientePaga: ID_A, convenio: 'Tarifa con espacios' }).has('convenioCliente|Tarifa con espacios')).toBe(false);
  });
  it('las operaciones de prueba no cuentan', () => {
    expect(usosDeOperacion({ clientePaga: ID_A, esPrueba: true }).size).toBe(0);
  });
  it('crear suma, borrar resta, cambiar de convenio mueve el conteo', () => {
    const op = { clientePaga: ID_A, convenio: '054' };
    expect(diferenciaUsos(undefined, op)).toEqual({ sumar: ['convenioCliente|054', `empresa|${ID_A}`], restar: [] });
    expect(diferenciaUsos(op, undefined)).toEqual({ sumar: [], restar: ['convenioCliente|054', `empresa|${ID_A}`] });
    expect(diferenciaUsos(op, { ...op, convenio: '055' })).toEqual({ sumar: ['convenioCliente|055'], restar: ['convenioCliente|054'] });
    expect(diferenciaUsos(op, { ...op, observaciones: 'x' })).toEqual({ sumar: [], restar: [] });
  });
  it('recuento desde cero con la fecha más reciente', () => {
    const c = contarUsos([
      { clientePaga: ID_A, fechaServicioISO: '2026-10-01' },
      { clientePaga: ID_A, fechaServicio: '05/10/2026' },
      { clientePaga: ID_A, esPrueba: true, fechaServicioISO: '2026-12-31' },
    ]);
    expect(c.get(`empresa|${ID_A}`)).toEqual({ usoOps: 2, ultimoUsoISO: '2026-10-05' });
    expect(idUso('empresa', 'a/b')).toBe('empresa_a-b');
  });
});

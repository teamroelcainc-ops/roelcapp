// ✅ V00477 — el menú "Operaciones" lleva a la pestaña que ya se ve o a la primera con permiso.
import { describe, expect, it } from 'vitest';
import { esModuloOperaciones, pestanaDeEntrada } from './modulosOperaciones';

describe('pestaña de entrada de Operaciones', () => {
  const todas = () => true;
  it('desde otro módulo va a Activas; desde una pestaña se queda en ella', () => {
    expect(pestanaDeEntrada('empresas', todas)).toBe('operaciones');
    expect(pestanaDeEntrada('serviciosCancelados', todas)).toBe('serviciosCancelados');
  });
  it('sin permiso de Activas va a la primera que sí tiene; sin ninguna, null', () => {
    expect(pestanaDeEntrada('empresas', (m) => m !== 'operaciones')).toBe('serviciosCompletados');
    expect(pestanaDeEntrada('operaciones', (m) => m === 'serviciosCancelados')).toBe('serviciosCancelados');
    expect(pestanaDeEntrada('empresas', () => false)).toBeNull();
  });
  it('reconoce los tres módulos', () => {
    expect(['operaciones', 'serviciosCompletados', 'serviciosCancelados', 'misOperaciones'].map(esModuloOperaciones)).toEqual([true, true, true, false]);
  });
});

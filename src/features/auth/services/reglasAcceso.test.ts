// ✅ V00437 — reglas de acceso al sistema web.
import { describe, it, expect } from 'vitest';
import { evaluarPerfil, esAdminPorRoles } from './reglasAcceso';

describe('evaluarPerfil', () => {
  it('sin documento no entra (se acabó el "bypass")', () => expect(evaluarPerfil(null)).toBe('sin-perfil'));
  it('cliente no entra a la web', () => expect(evaluarPerfil({ tipoUsuario: 'Cliente' })).toBe('cliente'));
  it('desactivado no entra', () => expect(evaluarPerfil({ activo: false })).toBe('inactivo'));
  it('personal entra', () => expect(evaluarPerfil({ roles: ['Trafico'] })).toBe('ok'));
});

describe('esAdminPorRoles', () => {
  it('exacto', () => {
    expect(esAdminPorRoles(['Admin'])).toBe(true);
    expect(esAdminPorRoles(['ADMINISTRATIVO'])).toBe(false);
    expect(esAdminPorRoles(undefined)).toBe(false);
  });
});

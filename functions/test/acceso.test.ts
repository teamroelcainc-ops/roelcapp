// ✅ V00437 — claims de acceso a partir del documento usuarios/{uid}.
import { describe, it, expect } from 'vitest';
import { claimsDePerfil } from '../src/acceso';

describe('claimsDePerfil', () => {
  it('sin documento: sin acceso (antes era admin por "bypass")', () => {
    expect(claimsDePerfil(null)).toEqual({ personal: false, admin: false, cliente: false });
  });
  it('personal normal', () => {
    expect(claimsDePerfil({ roles: ['Trafico'] })).toEqual({ personal: true, admin: false, cliente: false });
  });
  it('admin por rol exacto, sin distinguir mayúsculas', () => {
    expect(claimsDePerfil({ roles: ['admin'] }).admin).toBe(true);
    expect(claimsDePerfil({ rol: 'ADMIN' }).admin).toBe(true);
  });
  it('"ADMINISTRATIVO" no es admin', () => {
    expect(claimsDePerfil({ roles: ['ADMINISTRATIVO'] }).admin).toBe(false);
  });
  it('desactivado: nada', () => {
    expect(claimsDePerfil({ roles: ['ADMIN'], activo: false })).toEqual({ personal: false, admin: false, cliente: false });
  });
  it('cliente de la app móvil (tolerante a mayúsculas y espacios)', () => {
    expect(claimsDePerfil({ tipoUsuario: ' Cliente ' })).toEqual({ personal: false, admin: false, cliente: true });
    expect(claimsDePerfil({ tipoUsuario: 'cliente', roles: ['ADMIN'] }).admin).toBe(false);
  });
});

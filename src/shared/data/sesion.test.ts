// ✅ V00439 — permisos por rol sin leer Firestore.
import { describe, it, expect } from 'vitest';
import { rolesTienenPermiso } from './sesion';

const catalogo = [
  { id: 'r1', nombre: 'Tráfico', modulosPermitidos: ['Operaciones', 'Personalizar Vista (Operaciones)'] },
  { id: 'r2', nombre: 'Facturación', modulosPermitidos: ['Editar Ref. en Operaciones'] },
];

describe('rolesTienenPermiso', () => {
  it('exacto y sin acentos', () => {
    expect(rolesTienenPermiso(['Trafico'], catalogo, 'Personalizar Vista (Operaciones)')).toBe(true);
    expect(rolesTienenPermiso(['Trafico'], catalogo, 'Autorizaciones')).toBe(false);
  });
  it('contiene', () => {
    expect(rolesTienenPermiso(['Facturación'], catalogo, 'EDITAR REF', 'contiene')).toBe(true);
  });
  it('admin siempre; "ADMINISTRATIVO" no', () => {
    expect(rolesTienenPermiso(['Admin'], [], 'Lo que sea')).toBe(true);
    expect(rolesTienenPermiso(['ADMINISTRATIVO'], [], 'Lo que sea')).toBe(false);
  });
  it('por id del rol también', () => {
    expect(rolesTienenPermiso(['r2'], catalogo, 'Editar Ref. en Operaciones')).toBe(true);
  });
});

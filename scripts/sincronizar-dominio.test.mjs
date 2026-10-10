// La copia de la lógica pura en functions/src/dominio debe ser idéntica a src/shared/dominio.
import { describe, it, expect } from 'vitest';
import { diferencias } from './sincronizar-dominio.mjs';

describe('functions/src/dominio', () => {
  it('es copia exacta de src/shared/dominio (corre node scripts/sincronizar-dominio.mjs)', () => {
    expect(diferencias()).toEqual([]);
  });
});

// ✅ V00540: Solucionar de F5 sale a Facturación; al volver a Operaciones la Revisión se reabre donde estaba.
import { afterEach, describe, expect, it } from 'vitest';
import { hayQueReabrirRevision, olvidarPosicionRevision, posicionRevision, salirDeRevision } from './volverARevision';

afterEach(() => { olvidarPosicionRevision(); });

describe('volver a la Revisión de datos', () => {
  it('sin salir, no se reabre', () => {
    expect(hayQueReabrirRevision()).toBe(false);
    expect(posicionRevision()).toBeNull();
  });
  it('al salir guarda grupo, filas y desplazamiento; al reabrirse se olvida', () => {
    salirDeRevision({ grupo: 'F5', mostrar: 200, scrollLista: 640, scrollCuerpo: 0 });
    expect(hayQueReabrirRevision()).toBe(true);
    expect(posicionRevision()).toEqual({ grupo: 'F5', mostrar: 200, scrollLista: 640, scrollCuerpo: 0 });
    olvidarPosicionRevision();
    expect(hayQueReabrirRevision()).toBe(false);
  });
});

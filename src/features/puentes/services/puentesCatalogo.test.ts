// ✅ V00457 — la caseta de los Otros Cruces (solo Caseta AVI).
import { describe, expect, it } from 'vitest';
import { casetaAviOtrosCruces } from './puentesCatalogo';

const p = (id: string, nombre_gasto: string) => ({ id, nombre_gasto, categoria_gasto: 'Puente' });

describe('caseta de los otros cruces', () => {
  it('es la Caseta AVI; si se llama distinto, la caseta AVI de nombre más corto', () => {
    const cat = [p('a', 'Caseta AVI Auto'), p('b', 'Caseta AVI'), p('c', 'Caseta AVI Nissan Puente 3'), p('d', 'Trompo AVI'), p('e', 'Tag del Puente AVI')];
    expect(casetaAviOtrosCruces(cat)?.id).toBe('b');
    expect(casetaAviOtrosCruces([p('a', 'Caseta AVI Auto'), p('c', 'Caseta AVI Nissan Puente 3'), p('x', 'Caseta  Avi  (USD)')])?.id).toBe('x');
    expect(casetaAviOtrosCruces([p('d', 'Trompo AVI'), p('p3', 'Caseta Puente III')])).toBeNull();
    expect(casetaAviOtrosCruces([])).toBeNull();
  });
});

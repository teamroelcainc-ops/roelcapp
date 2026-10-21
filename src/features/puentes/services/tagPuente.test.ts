// ✅ V00465 — TAG de la unidad según el puente de la operación.
import { describe, expect, it } from 'vitest';
import { grupoTagDeNombres, grupoTagDeOperacion, tagDeUnidad } from './tagPuente';

const und = { tagAvi: '00202745', tagPuente3: ' P3-778 ', tagPuenteColombia: '' };
const transfer = (extra: Record<string, unknown> = {}) => ({ tipoOperacionNombre: 'Transfer', trafico: 'Importación', ...extra });

describe('TAG por puente', () => {
  it('agrupa el nombre del puente como el Acumulado', () => {
    expect(grupoTagDeNombres('Caseta AVI')).toBe('AVI');
    expect(grupoTagDeNombres('Caseta Puente III')).toBe('PT3');
    expect(grupoTagDeNombres('Trompo Colombia')).toBe('PTC');
    expect(grupoTagDeNombres('Caseta Mx Colombia', 'Puente Mx Colombia')).toBe('PTC');
    expect(grupoTagDeNombres('', undefined)).toBe('');
  });

  it('el puente cobrado manda, luego el elegido, luego el tráfico', () => {
    expect(grupoTagDeOperacion(transfer({ saldoPuente: 144, saldoPuentePuente: 'Caseta Puente III', puenteNombre: 'Caseta AVI' }))).toBe('PT3');
    expect(grupoTagDeOperacion(transfer({ puenteNombre: 'Caseta Mx Colombia' }))).toBe('PTC');
    expect(grupoTagDeOperacion(transfer())).toBe('AVI');
    expect(grupoTagDeOperacion(transfer({ trafico: 'Exportación' }))).toBe('PT3');
    expect(grupoTagDeOperacion(transfer({ trafico: '' }))).toBe('');
  });

  it('sin peaje (Fletes, Logística con proveedor externo) no hay TAG que mostrar', () => {
    expect(grupoTagDeOperacion({ tipoOperacionNombre: 'Logística Fletes', proveedorUnidadNombre: 'Roelca', trafico: 'Importación' })).toBe('');
    expect(grupoTagDeOperacion({ tipoOperacionNombre: 'Logística Cruces', proveedorUnidadNombre: 'Otro', trafico: 'Importación' })).toBe('');
    expect(grupoTagDeOperacion({ tipoOperacionNombre: 'Logística Cruces', proveedorUnidadNombre: 'ROELCA INC', trafico: 'Exportación' })).toBe('PT3');
  });

  it('toma el TAG de ese puente de la unidad', () => {
    expect(tagDeUnidad(und, 'AVI')).toEqual({ grupo: 'AVI', etiqueta: 'TAG AVI', tag: '00202745' });
    expect(tagDeUnidad(und, 'PT3')).toEqual({ grupo: 'PT3', etiqueta: 'TAG Puente 3', tag: 'P3-778' });
    expect(tagDeUnidad(und, 'PTC')).toEqual({ grupo: 'PTC', etiqueta: 'TAG Puente Colombia', tag: '' });
    expect(tagDeUnidad(undefined, 'AVI')?.tag).toBe('');
    expect(tagDeUnidad(und, '')).toBeNull();
  });
});

// ✅ V00506 — nombre e id de un registro de catálogo con sus dos ids (el del documento y el de AppSheet).
import { describe, expect, it } from 'vitest';
import { buscarEntrada, diccionarioCatalogo, entradasCatalogo, idsDeRegistro, nombreDeRegistro, traductorCatalogo } from './indiceCatalogo';

/** Como llegan de los listeners: `_docId` no enumerable; un `id` guardado gana en `id`. */
const vivo = (docId: string, datos: Record<string, unknown>) => {
  const d = { id: docId, ...datos };
  Object.defineProperty(d, '_docId', { value: docId, enumerable: false });
  return d;
};

// "Proveedor (Transporte)" con su id de AppSheet (ca21ab07) guardado en un documento con otro id.
const transporte = vivo('Xa9F2kQ', { id: 'ca21ab07', tipo: 'Proveedor (Transporte)' });
const paga = vivo('7eec9cbb', { tipo: 'Cliente (Paga)' });
const bodega = vivo('6e7af5ab', { nombre: 'Bodega' }); // escrito con `nombre`
const sinNombre = vivo('zz1', { otro: 1 });

describe('indiceCatalogo', () => {
  it('los dos ids de un registro y su nombre en cualquiera de sus campos', () => {
    expect(idsDeRegistro(transporte)).toEqual(['Xa9F2kQ', 'ca21ab07']);
    expect(idsDeRegistro(paga)).toEqual(['7eec9cbb']);
    expect(idsDeRegistro({ id: 'plano' })).toEqual(['plano']);
    expect(nombreDeRegistro(transporte)).toBe('Proveedor (Transporte)');
    expect(nombreDeRegistro(bodega, ['tipo'])).toBe('Bodega');
    expect(nombreDeRegistro(sinNombre)).toBe('');
  });

  it('se encuentra por cualquiera de sus ids; los que no tienen nombre no entran', () => {
    const e = entradasCatalogo([transporte, paga, bodega, sinNombre], ['tipo']);
    expect(e.map((x) => x.nombre)).toEqual(['Proveedor (Transporte)', 'Cliente (Paga)', 'Bodega']);
    expect(buscarEntrada(e, 'ca21ab07')?.nombre).toBe('Proveedor (Transporte)');
    expect(buscarEntrada(e, 'Xa9F2kQ')?.nombre).toBe('Proveedor (Transporte)');
    expect(buscarEntrada(e, 'nada')).toBeNull();
  });

  it('diccionario con los dos ids; el del documento gana si otro registro guardó ese mismo id', () => {
    const choca = vivo('ca21ab07', { tipo: 'Otro tipo' });
    const dict = diccionarioCatalogo([transporte, choca], (d) => nombreDeRegistro(d));
    expect(dict).toEqual({ Xa9F2kQ: 'Proveedor (Transporte)', ca21ab07: 'Otro tipo' });
    expect(diccionarioCatalogo([transporte], (d) => nombreDeRegistro(d))).toEqual({ Xa9F2kQ: 'Proveedor (Transporte)', ca21ab07: 'Proveedor (Transporte)' });
  });

  it('traductor del formulario: muestra nombres y al guardar conserva el id que ya traía', () => {
    const e = entradasCatalogo([transporte, paga, bodega], ['tipo']);
    // La empresa traía el id de AppSheet: se muestra el nombre y se guarda el MISMO id.
    const t = traductorCatalogo(e, ['ca21ab07'], ['ca21ab07', '7eec9cbb']);
    expect(t.nombreDe('ca21ab07')).toBe('Proveedor (Transporte)');
    expect(t.idDe('Proveedor (Transporte)')).toBe('ca21ab07');
    // Uno nuevo: el id fijo de la app si el registro lo tiene; si no, el del documento.
    expect(traductorCatalogo(e, [], ['ca21ab07']).idDe('Proveedor (Transporte)')).toBe('ca21ab07');
    expect(traductorCatalogo(e, []).idDe('Proveedor (Transporte)')).toBe('Xa9F2kQ');
    expect(t.idDe('Bodega')).toBe('6e7af5ab');
    // Un valor que no es de ningún registro se queda como estaba.
    expect(t.nombreDe('desconocido')).toBe('desconocido');
    expect(t.idDe('desconocido')).toBe('desconocido');
  });
});

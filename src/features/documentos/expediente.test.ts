// ✅ V00451 — expedientes sin límite: tipo de cada documento, etiquetas "Tipo (n)", nombres al
// reemplazar y la traducción de lo que se hace en AdjuntosArchivos a cambios pendientes.
import { describe, expect, it } from 'vitest';
import { adjuntoNuevo } from '../../shared/archivos/adjuntos';
import type { Adjunto } from '../../shared/archivos/adjuntos';
import {
  SIN_CAMBIOS, aplicarCambioLista, cambiosAlCambiarTipo, carpetaStorageDe, comoDocumentoExpediente, esDelTipo,
  etiquetasNuevos, idCanonicoDocumento, listaVisible, nombreArchivoNuevo, nombreTrasReemplazo, pathCompartido,
  planGuardado,
} from './expediente';
import type { DocumentoExpediente } from './expediente';

const archivo = (name: string) => new File([new Uint8Array(4)], name, { type: 'application/pdf' });
const documento = (id: string, extra: Partial<Record<string, unknown>> = {}): DocumentoExpediente =>
  comoDocumentoExpediente(id, {
    coleccionOrigen: 'empleados', registroId: 'E1', registroNombre: 'Juan Pérez', tipoDocumento: '16. Contrato Laboral',
    carpeta: 'Juan Pérez', subcarpeta: 'Contrato Laboral', nombreArchivo: 'Contrato Laboral.pdf',
    path: `empleados/Juan Pérez/Contrato Laboral/${id}.pdf`, url: `https://x/${id}.pdf`, createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  });

describe('tipo de cada documento', () => {
  it('reconoce el tipo con o sin prefijo numérico, con "(2)" y por subcarpeta', () => {
    expect(esDelTipo({ tipoDocumento: '16. Contrato Laboral', subcarpeta: '' }, 'Contrato Laboral')).toBe(true);
    expect(esDelTipo({ tipoDocumento: '16. Contrato Laboral (2)', subcarpeta: '16. Contrato Laboral' }, '16. Contrato Laboral')).toBe(true);
    expect(esDelTipo({ tipoDocumento: "Entry's 1", subcarpeta: "Entry's" }, "Entry's")).toBe(true);
    expect(esDelTipo({ tipoDocumento: 'Licencia', subcarpeta: 'Licencia' }, 'Contrato Laboral')).toBe(false);
    expect(esDelTipo({ tipoDocumento: 'Contrato', subcarpeta: '' }, '')).toBe(false);
  });
  it('id canónico como siempre', () => {
    expect(idCanonicoDocumento('empleados', 'E1', 'Contrato Laboral')).toBe('empleados__E1__Contrato_Laboral');
  });
});

describe('etiquetas y nombres', () => {
  it('el primero toma el tipo si va al id canónico; los demás siguen el número más alto', () => {
    expect(etiquetasNuevos('Licencia', [], 3, true)).toEqual(['Licencia', 'Licencia (2)', 'Licencia (3)']);
    expect(etiquetasNuevos('Licencia', ['Licencia'], 2, false)).toEqual(['Licencia (2)', 'Licencia (3)']);
    expect(etiquetasNuevos('Licencia', ['Licencia (2)'], 2, true)).toEqual(['Licencia', 'Licencia (3)']);
    expect(etiquetasNuevos('Licencia', ['Licencia', 'Licencia (4)'], 1, false)).toEqual(['Licencia (5)']);
    // Id canónico libre pero el nombre ya lo usa otro documento (p. ej. de la Carga Masiva): numerado.
    expect(etiquetasNuevos('Licencia', ['Licencia'], 1, true)).toEqual(['Licencia (2)']);
  });
  it('nombre del archivo nuevo y al reemplazar', () => {
    expect(nombreArchivoNuevo('Contrato Laboral', 'scan 1.PDF', true)).toBe('Contrato Laboral.PDF');
    expect(nombreArchivoNuevo('Contrato Laboral', 'scan 1.PDF', false)).toBe('scan 1.PDF');
    expect(nombreTrasReemplazo({ nombreArchivo: 'Carta Porte.pdf', subcarpeta: 'Carta Porte', tipoDocumento: 'Carta Porte' }, 'foto.jpg')).toBe('Carta Porte.jpg');
    expect(nombreTrasReemplazo({ nombreArchivo: "Entry's 2.pdf", subcarpeta: "Entry's", tipoDocumento: "Entry's 2" }, 'e.pdf')).toBe("Entry's 2.pdf");
    expect(nombreTrasReemplazo({ nombreArchivo: 'viejo.pdf', subcarpeta: 'Licencia', tipoDocumento: 'Licencia (2)' }, 'nuevo.png')).toBe('nuevo.png');
  });
  it('carpeta de Storage: la del archivo actual o la de siempre', () => {
    expect(carpetaStorageDe(documento('a'))).toBe('empleados/Juan Pérez/Contrato Laboral');
    expect(carpetaStorageDe(documento('b', { path: '' }))).toBe('empleados/Juan Pérez/Contrato Laboral');
  });
  it('no borra un archivo que otro documento usa', () => {
    const a = documento('a', { path: 'x/1.pdf' });
    expect(pathCompartido(a, [a, documento('b', { path: 'x/1.pdf' })])).toBe(true);
    expect(pathCompartido(a, [a, documento('b')])).toBe(false);
    expect(pathCompartido(documento('c', { path: '' }), [documento('d', { path: '' })])).toBe(false);
  });
});

describe('cambios de la lista del modal', () => {
  const g1 = documento('g1');
  const g2 = documento('g2');
  const guardados = [g1, g2];
  const cambiar = (c: typeof SIN_CAMBIOS, next: (prev: Adjunto[]) => Adjunto[]) => {
    const prev = listaVisible(guardados, c);
    return aplicarCambioLista(c, prev, next(prev));
  };

  it('agregar: nuevos al final, sin tocar los guardados', () => {
    const n1 = adjuntoNuevo(archivo('n1.pdf'));
    const n2 = adjuntoNuevo(archivo('n2.pdf'));
    const c = cambiar(SIN_CAMBIOS, (p) => [...p, n1, n2]);
    expect(c.nuevos.map((a) => a.clave)).toEqual([n1.clave, n2.clave]);
    expect(listaVisible(guardados, c).map((a) => a.estado)).toEqual(['guardado', 'guardado', 'nuevo', 'nuevo']);
    const plan = planGuardado(guardados, c);
    expect(plan.nuevos.map((x) => x.file.name)).toEqual(['n1.pdf', 'n2.pdf']);
    expect(plan.quitar).toEqual([]);
    expect(plan.reemplazar).toEqual([]);
  });

  it('Reemplazar un guardado: mismo lugar, se liga a SU documento', () => {
    const r = adjuntoNuevo(archivo('r.pdf'));
    const c = cambiar(SIN_CAMBIOS, (p) => p.map((a, i) => (i === 1 ? r : a)));
    expect(Object.keys(c.reemplazos)).toEqual(['g2']);
    const plan = planGuardado(guardados, c);
    expect(plan.reemplazar.map((x) => [x.doc.id, x.file.name])).toEqual([['g2', 'r.pdf']]);
    // Reemplazar otra vez el mismo renglón: sigue ligado a g2.
    const r2 = adjuntoNuevo(archivo('r2.pdf'));
    const c2 = cambiar(c, (p) => p.map((a) => (a.clave === r.clave ? r2 : a)));
    expect(planGuardado(guardados, c2).reemplazar.map((x) => [x.doc.id, x.file.name])).toEqual([['g2', 'r2.pdf']]);
  });

  it('× sobre un guardado lo quita; × sobre su reemplazo cancela el reemplazo', () => {
    const c = cambiar(SIN_CAMBIOS, (p) => p.filter((a) => a.clave !== 'doc:g1'));
    expect(c.quitados).toEqual(['g1']);
    expect(planGuardado(guardados, c).quitar.map((d) => d.id)).toEqual(['g1']);

    const r = adjuntoNuevo(archivo('r.pdf'));
    const conReemplazo = cambiar(SIN_CAMBIOS, (p) => p.map((a, i) => (i === 0 ? r : a)));
    const cancelado = cambiar(conReemplazo, (p) => p.filter((a) => a.clave !== r.clave));
    expect(cancelado.reemplazos).toEqual({});
    expect(cancelado.quitados).toEqual([]);
    expect(listaVisible(guardados, cancelado).map((a) => a.clave)).toEqual(['doc:g1', 'doc:g2']);
  });

  it('reemplazar y quitar archivos nuevos', () => {
    const n1 = adjuntoNuevo(archivo('n1.pdf'));
    const n2 = adjuntoNuevo(archivo('n2.pdf'));
    const c = cambiar(SIN_CAMBIOS, (p) => [...p, n1]);
    const c2 = cambiar(c, (p) => p.map((a) => (a.clave === n1.clave ? n2 : a)));
    expect(c2.nuevos.map((a) => a.clave)).toEqual([n2.clave]);
    expect(Object.keys(c2.reemplazos)).toEqual([]);
    const c3 = cambiar(c2, (p) => p.filter((a) => a.clave !== n2.clave));
    expect(c3).toEqual(SIN_CAMBIOS);
  });

  it('el plan solo toca documentos del tipo que se ve', () => {
    const c = { ...SIN_CAMBIOS, quitados: ['g1', 'otro'] };
    expect(planGuardado(guardados, c).quitar.map((d) => d.id)).toEqual(['g1']);
  });

  it('al cambiar de tipo los archivos elegidos quedan como nuevos', () => {
    const r = adjuntoNuevo(archivo('r.pdf'));
    const n = adjuntoNuevo(archivo('n.pdf'));
    const c = cambiosAlCambiarTipo({ quitados: ['g1'], reemplazos: { g2: r }, nuevos: [n] });
    expect(c.quitados).toEqual([]);
    expect(c.reemplazos).toEqual({});
    expect(c.nuevos.map((a) => a.clave)).toEqual([r.clave, n.clave]);
  });
});

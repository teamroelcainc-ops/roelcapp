// ✅ V00478 — empresas duplicadas: forma legal, signos, errores de escritura y grupos.
import { describe, expect, it } from 'vitest';
import { buscarDuplicados, claveNombre, distanciaEdicion, nombreComparable } from './duplicadosEmpresas';

const e = (id: string, nombre: string, rfcTaxId = '') => ({ id, nombre, rfcTaxId });
const grupos = (lista: ReturnType<typeof e>[]) => buscarDuplicados(lista).map((g) => ({ ids: [...g.ids].sort(), criterios: g.criterios }));

describe('nombre comparable', () => {
  it('quita acentos, signos y la forma legal del final', () => {
    expect(nombreComparable('Tubería y Válvulas Del Norte SA DE CV')).toBe('tuberia y valvulas del norte');
    expect(nombreComparable('Enlaces Terrestres C&C S DE RL DE CV')).toBe('enlaces terrestres c y c');
    expect(nombreComparable('Roelca Inc.')).toBe('roelca');
    expect(nombreComparable('ELI Logistics, LLC')).toBe('eli logistics');
    expect(nombreComparable('Montacargas Galeria, S.A. de C.V.')).toBe('montacargas galeria');
    expect(claveNombre('C.H. Robinson Worldwide, INC.')).toBe(claveNombre('CH Robinson Worldwide'));
  });
  it('un nombre que ES una forma legal no se vacía', () => {
    expect(nombreComparable('Co')).toBe('co');
  });
});

it('distancia de edición con tope', () => {
  expect(distanciaEdicion('logistics', 'logisticss', 1)).toBe(1);
  expect(distanciaEdicion('lopez', 'perez', 1)).toBe(2);
  expect(distanciaEdicion('abc', 'abcdef', 1)).toBe(2);
});

describe('grupos de duplicados', () => {
  it('mismo nombre aunque cambie la forma legal o los signos', () => {
    expect(grupos([e('a', 'Roelca Inc.'), e('b', 'ROELCA'), e('c', 'Otra Empresa')])).toEqual([{ ids: ['a', 'b'], criterios: ['nombre'] }]);
  });
  it('errores de escritura y una palabra de más son "parecido"; nombres distintos no', () => {
    const r = grupos([
      e('l1', 'Like Solutions Logisticss'), e('l2', 'Like Solutions Logistics LLC'),
      e('j1', 'Jesús Molero'), e('j2', 'Jesus Levi Molero'),
      e('t1', 'Transportes Lopez'), e('t2', 'Transportes Perez'),
      e('m1', 'Transportes Morales Valdez'), e('m2', 'Transportes Garcia Valdez'),
      e('p5', 'Centro Logistico ZF Planta 5'), e('p6', 'Centro Logistico ZF Planta 6'), e('e1', 'Empresa 1 SA de CV'), e('e11', 'Empresa 11 SA de CV'),
    ]);
    expect(r).toEqual([{ ids: ['j1', 'j2'], criterios: ['parecido'] }, { ids: ['l1', 'l2'], criterios: ['parecido'] }]);
  });
  it('mismo RFC (no el genérico) y grupos encadenados', () => {
    const r = grupos([e('a', 'Alfa Uno', 'ABC010101AB1'), e('b', 'Beta Dos', 'ABC010101AB1'), e('c', 'Beta Doss'), e('x', 'X', 'XAXX010101000'), e('y', 'Y', 'XAXX010101000')]);
    expect(r).toEqual([{ ids: ['a', 'b', 'c'], criterios: ['parecido', 'rfc'] }]);
  });
  it('primero los de mismo nombre', () => {
    const r = buscarDuplicados([e('p1', 'Like Solutions Logisticss'), e('p2', 'Like Solutions Logistics'), e('n1', 'Zeta SA de CV'), e('n2', 'Zeta')]);
    expect(r.map((g) => g.criterios[0])).toEqual(['nombre', 'parecido']);
    expect(r[0].nombres).toEqual(['Zeta SA de CV', 'Zeta']);
  });
});

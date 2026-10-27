// ✅ V00443 (Fase 7) — consultas acotadas: páginas con cursor, topes, lotes por ID y contadores.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Filtro = { tipo: string; args: unknown[] };
type Doc = { id: string; data: () => Record<string, unknown> };
const llamadas: { col: string; filtros: Filtro[] }[] = [];
let respuesta: (col: string, filtros: Filtro[]) => Doc[] = () => [];

vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => {
  const f = (tipo: string) => (...args: unknown[]): Filtro => ({ tipo, args });
  return {
    collection: (_db: unknown, col: string) => ({ col }),
    documentId: () => '__name__',
    where: f('where'),
    orderBy: f('orderBy'),
    startAfter: f('startAfter'),
    limit: f('limit'),
    query: (ref: { col: string }, ...filtros: Filtro[]) => ({ col: ref.col, filtros }),
    getDocs: async (q: { col: string; filtros: Filtro[] }) => {
      llamadas.push(q);
      return { docs: respuesta(q.col, q.filtros) };
    },
  };
});

const mod = await import('./consultas');

const docs = (n: number, desde = 0): Doc[] =>
  Array.from({ length: n }, (_, i) => ({ id: `op${desde + i}`, data: () => ({ ref: `R${desde + i}` }) }));
const limiteDe = (filtros: Filtro[]) => Number(filtros.find((x) => x.tipo === 'limit')?.args[0]);
const cursorDe = (filtros: Filtro[]) => filtros.find((x) => x.tipo === 'startAfter')?.args[0] as Doc | undefined;

beforeEach(() => { llamadas.length = 0; respuesta = () => []; });

describe('paginaOperaciones', () => {
  it('pide tamaño + 1 para saber si hay más, sin leer otra página', async () => {
    respuesta = (_c, filtros) => docs(limiteDe(filtros));
    const p = await mod.paginaOperaciones({ estados: ['activa'] }, 50);
    expect(llamadas).toHaveLength(1);
    expect(limiteDe(llamadas[0].filtros)).toBe(51);
    expect(p.docs).toHaveLength(50);
    expect(p.hayMas).toBe(true);
    expect(p.cursor).not.toBeNull();
  });

  it('última página: sin cursor ni "hay más"', async () => {
    respuesta = () => docs(3);
    const p = await mod.paginaOperaciones({ estados: ['activa'] }, 50);
    expect(p.hayMas).toBe(false);
    expect(p.cursor).toBeNull();
  });

  it('un estado usa ==; varios, in; el rango va sobre fechaServicioISO y ordena de la más reciente', async () => {
    await mod.paginaOperaciones({ estados: ['completada', 'falso'], desde: '2026-01-01', hasta: '2026-01-31' }, 10);
    const w = llamadas[0].filtros.filter((x) => x.tipo === 'where').map((x) => x.args);
    expect(w).toEqual([
      ['estadoGrupo', 'in', ['completada', 'falso']],
      ['fechaServicioISO', '>=', '2026-01-01'],
      ['fechaServicioISO', '<=', '2026-01-31'],
    ]);
    expect(llamadas[0].filtros.find((x) => x.tipo === 'orderBy')?.args).toEqual(['fechaServicioISO', 'desc']);
    await mod.paginaOperaciones({ estados: ['activa'] }, 10);
    expect(llamadas[1].filtros.find((x) => x.tipo === 'where')?.args).toEqual(['estadoGrupo', '==', 'activa']);
  });

  it('el id real va en _docId (no enumerable) y un `id` guardado gana, como antes', async () => {
    respuesta = () => [{ id: 'real', data: () => ({ id: 'APPSHEET-1', ref: 'X' }) }];
    const p = await mod.paginaOperaciones({ estados: ['activa'] }, 5);
    expect(p.docs[0].id).toBe('APPSHEET-1');
    expect(p.docs[0]._docId).toBe('real');
    expect(Object.keys({ ...p.docs[0] })).not.toContain('_docId');
  });
});

describe('todasLasPaginas', () => {
  it('sigue el cursor hasta que no hay más', async () => {
    respuesta = (_c, filtros) => {
      const cursor = cursorDe(filtros);
      const inicio = cursor ? Number(cursor.id.slice(2)) + 1 : 0;
      return docs(Math.max(0, Math.min(limiteDe(filtros), 25 - inicio)), inicio);
    };
    const r = await mod.todasLasPaginas((c) => mod.paginaPorFacturar('cliente', null, 10, c), 1000);
    expect(r.docs.map((d) => d.id)).toEqual(Array.from({ length: 25 }, (_, i) => `op${i}`));
    expect(r.truncado).toBe(false);
    expect(llamadas).toHaveLength(3);
    expect(cursorDe(llamadas[1].filtros)?.id).toBe('op9');
  });

  it('se detiene en el tope y lo avisa', async () => {
    respuesta = (_c, filtros) => docs(limiteDe(filtros), llamadas.length * 100);
    const r = await mod.todasLasPaginas((c) => mod.paginaOperacionesDeEmpresa('E1', 10, c), 25);
    expect(r.truncado).toBe(true);
    expect(r.docs).toHaveLength(30);
    expect(llamadas).toHaveLength(3);
    expect(llamadas[0].filtros.find((x) => x.tipo === 'where')?.args).toEqual(['empresasIds', 'array-contains', 'E1']);
  });
});

describe('paginaPorFacturar / convenio / facturas abiertas', () => {
  it('por facturar del proveedor con su empresa', async () => {
    await mod.paginaPorFacturar('proveedor', 'P1', 10);
    expect(llamadas[0].filtros.filter((x) => x.tipo === 'where').map((x) => x.args)).toEqual([
      ['porFacturarProveedor', '==', true], ['proveedorUnidadId', '==', 'P1'],
    ]);
  });

  it('operaciones de un convenio de cliente', async () => {
    await mod.paginaOperacionesDeConvenio('cliente', 'D1', 50);
    expect(llamadas[0].filtros.find((x) => x.tipo === 'where')?.args).toEqual(['convenioClienteId', '==', 'D1']);
  });

  it('facturas abiertas ordenadas por id', async () => {
    await mod.paginaFacturasAbiertas('facturas_proveedores', 1000);
    expect(llamadas[0].col).toBe('facturas_proveedores');
    expect(llamadas[0].filtros.find((x) => x.tipo === 'where')?.args).toEqual(['abierta', '==', true]);
    expect(llamadas[0].filtros.find((x) => x.tipo === 'orderBy')?.args).toEqual(['__name__']);
  });
});

describe('porIds', () => {
  it('lotes de 30 en paralelo, sin repetidos, vacíos ni rutas', async () => {
    const ids = [...Array.from({ length: 65 }, (_, i) => `id${i}`), 'id0', '', 'a/b'];
    respuesta = (_c, filtros) => (filtros[0].args[2] as string[]).map((id) => ({ id, data: () => ({}) }));
    const r = await mod.porIds('operaciones', ids);
    expect(llamadas).toHaveLength(3);
    expect(llamadas.map((l) => (l.filtros[0].args[2] as string[]).length)).toEqual([30, 30, 5]);
    expect(llamadas[0].filtros[0].args.slice(0, 2)).toEqual(['__name__', 'in']);
    expect(r).toHaveLength(65);
  });

  it('sin ids no consulta', async () => {
    expect(await mod.porIds('operaciones', [])).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });
});

describe('usosPorTipo', () => {
  it('mapa refId → contador y último uso', async () => {
    respuesta = () => [
      { id: 'empresa_A', data: () => ({ tipo: 'empresa', refId: 'A', usoOps: 3, ultimoUsoISO: '2026-09-01' }) },
      { id: 'empresa_B', data: () => ({ tipo: 'empresa', refId: 'B' }) },
    ];
    const m = await mod.usosPorTipo('empresa');
    expect(llamadas[0].filtros[0].args).toEqual(['tipo', '==', 'empresa']);
    expect(m.get('A')).toEqual({ usoOps: 3, ultimoUsoISO: '2026-09-01' });
    expect(m.get('B')).toEqual({ usoOps: 0, ultimoUsoISO: '' });
  });
});

describe('todasLasOperacionesDelRango (✅ V00499, Excel de operaciones)', () => {
  it('trae TODO el rango en páginas, sin pasar el límite de 10,000 de Firestore ni tope propio', async () => {
    const total = 12500;
    respuesta = (_c, filtros) => {
      const cursor = cursorDe(filtros);
      const inicio = cursor ? Number(cursor.id.slice(2)) + 1 : 0;
      return docs(Math.max(0, Math.min(limiteDe(filtros), total - inicio)), inicio);
    };
    const avance: number[] = [];
    const r = await mod.todasLasOperacionesDelRango('fechaServicioISO', '2026-01-01', '2026-10-27', (n) => avance.push(n));
    expect(r).toHaveLength(total);
    expect(new Set(r.map((d) => d.id)).size).toBe(total);
    expect(llamadas.every((l) => limiteDe(l.filtros) <= mod.LIMITE_FIRESTORE)).toBe(true);
    expect(llamadas).toHaveLength(7);
    expect(avance).toEqual([2000, 4000, 6000, 8000, 10000, 12000, 12500]);
    const f = llamadas[0].filtros;
    expect(f.filter((x) => x.tipo === 'where').map((x) => x.args)).toEqual([['fechaServicioISO', '>=', '2026-01-01'], ['fechaServicioISO', '<=', '2026-10-27']]);
    expect(f.find((x) => x.tipo === 'orderBy')?.args).toEqual(['fechaServicioISO']);
  });
});

describe('recorrerOperaciones (✅ V00500, Excel de operaciones sin fechaServicioISO)', () => {
  it('4 tramos del id en paralelo que cubren todo, en páginas de 2,000; entrega cada página y avisa el avance', async () => {
    // 3,000 ids en cada tramo: el tramo se deduce de los filtros por id.
    const tramoDe = (filtros: Filtro[]) => String(filtros.find((x) => x.tipo === 'where' && x.args[1] === '>=')?.args[2] ?? 'inicio');
    respuesta = (_c, filtros) => {
      const t = tramoDe(filtros);
      const cursor = cursorDe(filtros);
      const inicio = cursor ? Number(cursor.id.split('-')[1]) + 1 : 0;
      const n = Math.max(0, Math.min(limiteDe(filtros), 3000 - inicio));
      return Array.from({ length: n }, (_, i) => ({ id: `${t}-${inicio + i}`, data: () => ({ ref: 'R' }) }));
    };
    const recibidos: string[] = [];
    const avance: number[] = [];
    const total = await mod.recorrerOperaciones((docs) => { recibidos.push(...docs.map((d) => d.id)); }, (n) => avance.push(n));
    expect(total).toBe(12000);
    expect(new Set(recibidos).size).toBe(12000);
    expect(llamadas).toHaveLength(8);
    expect(llamadas.every((l) => limiteDe(l.filtros) === 2001)).toBe(true);
    expect(avance[avance.length - 1]).toBe(12000);
    const ids = llamadas.filter((l) => !cursorDe(l.filtros)).map((l) => l.filtros.filter((x) => x.tipo === 'where').map((x) => x.args.slice(1)));
    expect(ids).toEqual([[['<', '5']], [['>=', '5'], ['<', 'M']], [['>=', 'M'], ['<', 'f']], [['>=', 'f']]]);
    expect(llamadas[0].filtros.find((x) => x.tipo === 'orderBy')?.args).toEqual(['__name__']);
  });
});

describe('porPrefijo (✅ V00502, buscador global)', () => {
  it('rango del prefijo sobre el mismo campo, ordenado y con tope; vacío no consulta', async () => {
    respuesta = () => docs(2);
    const r = await mod.porPrefijo('operaciones', 'ref', 'TR-2610', 8);
    expect(r).toHaveLength(2);
    const f = llamadas[0].filtros;
    expect(f.filter((x) => x.tipo === 'where').map((x) => x.args)).toEqual([['ref', '>=', 'TR-2610'], ['ref', '<=', 'TR-2610\uf8ff']]);
    expect(f.find((x) => x.tipo === 'orderBy')?.args).toEqual(['ref']);
    expect(limiteDe(f)).toBe(8);
    expect(await mod.porPrefijo('operaciones', 'ref', '', 8)).toEqual([]);
    expect(llamadas).toHaveLength(1);
  });
});

describe('operacionesDelDia / operacionesDelRango', () => {
  it('un día por igualdad; un rango en páginas de 1,000', async () => {
    await mod.operacionesDelDia('2026-10-01');
    expect(llamadas[0].filtros[0].args).toEqual(['fechaServicioISO', '==', '2026-10-01']);
    await mod.operacionesDelRango('2026-10-01', '2026-10-31');
    expect(limiteDe(llamadas[1].filtros)).toBe(1001);
  });
});

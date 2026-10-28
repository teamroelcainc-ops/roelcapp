// ✅ V00505 — (C5 del reporte del 27-oct) Unir duplicados de Pagos y la descarga de facturas: sin el
// tope viejo de 12,000. Baja página por página hasta la última; solo el tope de seguridad se avisa.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const coleccion: { id: string; datos: Record<string, unknown> }[] = [];
const paginasPedidas: number[] = [];

vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../shared/data/coleccionesVivas', () => ({
  armarDoc: (id: string, datos: Record<string, unknown>) => {
    const d = { id, ...datos };
    Object.defineProperty(d, '_docId', { value: id, enumerable: false });
    return d;
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  documentId: () => '__id__',
  orderBy: () => ({ tipo: 'orden' }),
  limit: (n: number) => ({ tipo: 'limite', n }),
  startAfter: (cursor: { indice: number }) => ({ tipo: 'despues', indice: cursor.indice }),
  query: (_c: unknown, ...filtros: { tipo: string; n?: number; indice?: number }[]) => filtros,
  getDocs: async (filtros: { tipo: string; n?: number; indice?: number }[]) => {
    const desde = (filtros.find((f) => f.tipo === 'despues')?.indice ?? -1) + 1;
    const n = filtros.find((f) => f.tipo === 'limite')?.n ?? 0;
    paginasPedidas.push(desde);
    const pagina = coleccion.slice(desde, desde + n);
    return { docs: pagina.map((d, i) => ({ id: d.id, data: () => d.datos, indice: desde + i })) };
  },
}));

const { descargarFacturasComoVivas, descargarTodasLasFacturas, PAGINA_FACTURAS } = await import('./descargarFacturas');

const llenar = (n: number) => {
  coleccion.length = 0;
  for (let i = 0; i < n; i++) coleccion.push({ id: `F${String(i).padStart(6, '0')}`, datos: { invoice: `INV-${i}`, ...(i === 0 ? { id: 'APP-1' } : {}) } });
};

beforeEach(() => { paginasPedidas.length = 0; });

describe('descargarFacturas (C5)', () => {
  it('baja más de 12,000 facturas, página por página, sin aviso de tope', async () => {
    llenar(13_500);
    const r = await descargarFacturasComoVivas('facturas_clientes');
    expect(r.truncada).toBe(false);
    expect(r.docs).toHaveLength(13_500);
    expect(paginasPedidas).toHaveLength(Math.ceil(13_500 / PAGINA_FACTURAS));
    // Forma de los listeners: un `id` guardado gana; el id real queda en _docId.
    expect(r.docs[0]).toMatchObject({ id: 'APP-1' });
    expect((r.docs[0] as unknown as { _docId: string })._docId).toBe('F000000');
  });
  it('el tope de seguridad se avisa (truncada) en vez de cortar en silencio', async () => {
    llenar(3_500);
    const r = await descargarTodasLasFacturas('facturas_clientes', 2_000);
    expect(r).toMatchObject({ truncada: true });
    expect(r.docs).toHaveLength(2_000);
  });
});

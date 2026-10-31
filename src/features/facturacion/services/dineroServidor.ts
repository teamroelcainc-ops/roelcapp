// src/features/facturacion/services/dineroServidor.ts
// ---------------------------------------------------------------------------
// ✅ V00441 (Fase 5.3 / 5.4) — Facturación y Pagos por el SERVIDOR.
// Con la bandera `dineroPorServidor` encendida, Facturación Clientes/Proveedores
// y Pagos ya no escriben facturas ni pagos desde el navegador: llaman a las
// callables de functions/src/dinero.ts (transacción en el servidor) y aplican
// aquí la respuesta a sus listas en memoria. Con la bandera apagada todo sigue
// por el camino de siempre.
// ---------------------------------------------------------------------------
import { ErrorCallable, llamarCallable } from '../../../shared/data/callables';
import { notificarOperacionesGuardadas } from '../../../utils/operacionesBus';

type Datos = Record<string, unknown>;

export interface RespuestaDinero {
  ok: boolean;
  /** Facturas tocadas tal como quedaron (null = eliminada). */
  facturas: Record<string, Datos | null>;
  /** Operaciones tocadas: los campos que cambiaron. */
  operaciones: Record<string, Datos>;
  facturaId?: string;
  fusionada?: boolean;
  pagoId?: string;
  yaExistia?: boolean;
  /** editarPago: el pago tal como quedó. */
  pago?: Datos;
}

export type CallableDinero =
  | 'facturarOperaciones' | 'editarFactura' | 'quitarOperacionFactura' | 'moverOperacionFactura' | 'agregarOperacionFactura'
  | 'eliminarFactura' | 'recalcularFactura' | 'registrarPago' | 'editarPago' | 'eliminarPago';

/**
 * ✅ V00536: cada respuesta avisa al bus con las operaciones que tocó el servidor (sus ids son los del
 * documento), así Completados, Operaciones y la otra Facturación las ven sin recargar.
 */
export const llamarDinero = async (nombre: CallableDinero, datos: Datos): Promise<RespuestaDinero> => {
  const r = await llamarCallable<RespuestaDinero, Datos>(nombre, datos);
  notificarOperacionesGuardadas(Object.entries(r?.operaciones ?? {}), `dinero:${nombre}`);
  return r;
};

/** Mensaje para el usuario: el del servidor (ya viene en español) o uno genérico. */
export const mensajeDinero = (e: unknown, generico: string): string =>
  (e instanceof ErrorCallable ? e.message : generico);

/**
 * Aplica las facturas de la respuesta a una lista en memoria: reemplaza las que
 * ya estaban, quita las borradas y agrega al inicio las nuevas.
 */
export const aplicarFacturas = <F extends { id?: unknown }>(prev: F[], facturas: RespuestaDinero['facturas'], normalizar: (x: Datos) => F): F[] => {
  const ids = Object.keys(facturas);
  if (ids.length === 0) return prev;
  const vistos = new Set<string>();
  const salida: F[] = [];
  for (const f of prev) {
    const id = String(f.id ?? '');
    if (!(id in facturas)) { salida.push(f); continue; }
    vistos.add(id);
    const nueva = facturas[id];
    if (nueva) salida.push(normalizar({ ...(f as unknown as Datos), ...nueva, id }));
  }
  const nuevas = ids.filter((id) => !vistos.has(id) && facturas[id]).map((id) => normalizar({ ...(facturas[id] as Datos), id }));
  return [...nuevas, ...salida];
};

/**
 * Aplica los cambios de operaciones de la respuesta a una lista en memoria.
 * ✅ V00536: el servidor responde con el id del DOCUMENTO; la fila se busca por su `_docId` (antes por
 * `id`, que en las operaciones importadas es otro y el cambio no se veía).
 */
export const aplicarOperaciones = <O extends { id?: unknown; _docId?: unknown }>(prev: O[], operaciones: RespuestaDinero['operaciones']): O[] => {
  if (Object.keys(operaciones).length === 0) return prev;
  return prev.map((o) => {
    const c = operaciones[String(o._docId ?? o.id ?? '')] ?? operaciones[String(o.id ?? '')];
    return c ? { ...o, ...c } : o;
  });
};

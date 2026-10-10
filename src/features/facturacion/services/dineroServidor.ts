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

export const llamarDinero = (nombre: CallableDinero, datos: Datos): Promise<RespuestaDinero> =>
  llamarCallable<RespuestaDinero, Datos>(nombre, datos);

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

/** Aplica los cambios de operaciones de la respuesta a una lista en memoria. */
export const aplicarOperaciones = <O extends { id?: unknown }>(prev: O[], operaciones: RespuestaDinero['operaciones']): O[] => {
  if (Object.keys(operaciones).length === 0) return prev;
  return prev.map((o) => {
    const c = operaciones[String(o.id ?? '')];
    return c ? { ...o, ...c } : o;
  });
};

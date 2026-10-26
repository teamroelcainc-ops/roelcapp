// src/features/operaciones/services/montosCongelados.ts
// ✅ V00494 — "Una vez facturada, nada automático cambia los importes" (pedido de Roelca:
//   "bloquear que no se modifiquen los importes una vez facturados automáticamente").
//   Al abrir una operación ya facturada (de ese lado), el formulario conserva los montos
//   guardados (Subtotal, Dólares, Pesos, Conversión) mientras nadie cambie a mano una de sus
//   ENTRADAS (monto del convenio, cargos, tipo de cambio, Facturado en, moneda del convenio).
//   Antes se recalculaban al abrir (moneda de la empresa, T.C. del día) y, al guardar, la cascada
//   del servidor cambiaba también el renglón y el total de la factura.
import { facturadaCliente, facturadaProveedor } from '../../../shared/dominio/operacionCanonica';

type Datos = Record<string, unknown>;
export type LadoMontos = 'cliente' | 'proveedor';

/** Campos que, cambiados A MANO, sí recalculan los montos de ese lado. */
export const ENTRADAS_DINERO: Record<LadoMontos, readonly string[]> = {
  cliente: ['montoConvenioCliente', 'cargosAdicionales', 'tipoCambioAprobado', 'facturadoEnCobrar', 'monedaConvenioCliente'],
  proveedor: ['totalAPagarProv', 'cargosAdicionalesProv', 'tipoCambioAprobado', 'facturadoEnUnidad', 'monedaConvenioProv'],
};

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Mismo dato aunque uno venga como texto ('1250.50') y otro como número (1250.5); vacío = 0. */
export const mismoDato = (a: unknown, b: unknown): boolean => {
  const na = numero(a);
  const nb = numero(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.00005;
  return String(a ?? '').trim() === String(b ?? '').trim();
};

/** Montos que el formulario calcula y que, en una facturada, se quedan como se guardaron. */
export const MONTOS_GUARDADOS: Record<LadoMontos, readonly string[]> = {
  cliente: ['subtotalCliente', 'dolaresCliente', 'pesosCliente', 'conversionCliente'],
  proveedor: ['subtotalProv', 'dolaresProv', 'pesosProv', 'conversionProv'],
};

/** ¿La operación (tal como se abrió) ya está facturada de ese lado? */
export const facturadaDeLado = (lado: LadoMontos, inicial: Datos | null | undefined): boolean =>
  !!inicial && (lado === 'cliente' ? facturadaCliente(inicial) : facturadaProveedor(inicial));

/**
 * true = NO recalcular: está facturada de ese lado y ninguna entrada de dinero cambió respecto a como
 * se abrió (se quedan los montos guardados, que son los que se facturaron).
 */
export const conservarMontosGuardados = (lado: LadoMontos, actual: Datos, inicial: Datos | null | undefined): boolean =>
  facturadaDeLado(lado, inicial) && ENTRADAS_DINERO[lado].every((c) => mismoDato(actual[c], (inicial as Datos)[c]));

/**
 * Los montos guardados a devolver al formulario si un cálculo previo los cambió (p. ej. el que corre con
 * el formulario aún vacío, antes de cargar la operación); null = ya están igual.
 */
export const montosARestaurar = (lado: LadoMontos, actual: Datos, inicial: Datos): Datos | null => {
  const campos = MONTOS_GUARDADOS[lado];
  if (campos.every((c) => mismoDato(actual[c], inicial[c]))) return null;
  return Object.fromEntries(campos.map((c) => [c, Number(inicial[c]) || 0]));
};

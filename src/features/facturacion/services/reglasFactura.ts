// src/features/facturacion/services/reglasFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00481 — REGLAS DE LA FACTURA (lógica pura, la misma para Clientes y Proveedores):
//   · Facturada → ya no se genera Remisión ni se le agregan operaciones.
//   · Cancelada → exige nota y el número de la factura que la reemplaza.
//   · Moneda    → siempre la de la empresa (cliente o proveedor) en Empresas.
//   · Importe de cada operación en la moneda de la factura: Dólares → "Dólares (Cliente)"
//     (dol del renglón); Pesos → "Conversión Final (Ingreso)" (monto del renglón).
// ---------------------------------------------------------------------------
import { sumarMontos } from '../../../shared/dominio/numeros';
import { monedaCanonica, nombreMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { STATUS_FACTURA_OPCIONES } from '../selectores';

const sinAcentos = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// ── Status ──────────────────────────────────────────────────────────────
/** Sin status guardado la factura cuenta como "Facturado" (igual que la tabla). */
export const estaFacturada = (status: unknown): boolean => (sinAcentos(status) || 'facturado') === 'facturado';
export const estaCancelada = (status: unknown): boolean => sinAcentos(status).startsWith('cancelad');

/** La Remisión es para lo que aún no se factura: con la factura emitida ya no se genera. */
export const puedeGenerarRemision = (status: unknown): boolean => !estaFacturada(status);
/** A una factura emitida ya no se le agregan operaciones (se quitan con la ✕ si hace falta). */
export const puedeAgregarOperaciones = (status: unknown): boolean => !estaFacturada(status);

/** Status para una factura NUEVA: se cancela después (con nota y reemplazo), no al crearla. */
export const STATUS_AL_CREAR: readonly string[] = STATUS_FACTURA_OPCIONES.filter((s) => !estaCancelada(s));

export const AVISO_REMISION_FACTURADA = 'La factura ya está Facturada: la Remisión solo se genera mientras no se factura.';
export const AVISO_AGREGAR_FACTURADA = 'La factura ya está Facturada: no se le pueden agregar operaciones.';

// ── Cancelación ─────────────────────────────────────────────────────────
export interface DatosCancelacion {
  /** Por qué se cancela (obligatoria). */
  nota: string;
  /** Número de la factura que la reemplaza (obligatorio). */
  reemplazo: string;
}

export const CANCELACION_VACIA: DatosCancelacion = { nota: '', reemplazo: '' };

/** Campos que se guardan en la factura al cancelarla (y se borran si deja de estar cancelada). */
export const CAMPOS_CANCELACION = ['motivoCancelacion', 'facturaReemplazo', 'canceladaEn', 'canceladaPor'] as const;

/** Mensaje de lo que falta, o null si se puede cancelar. */
export const validarCancelacion = (d: DatosCancelacion, invoicePropio: unknown): string | null => {
  if (!d.nota.trim()) return 'Escribe la nota: por qué se cancela la factura.';
  const reemplazo = d.reemplazo.trim();
  if (!reemplazo) return 'Escribe el número de la factura que reemplaza a esta.';
  if (sinAcentos(reemplazo) === sinAcentos(invoicePropio)) return 'La factura que la reemplaza debe ser otra (no la misma que se cancela).';
  return null;
};

export const camposCancelacion = (d: DatosCancelacion, por: string, ahoraISO: string) => ({
  motivoCancelacion: d.nota.trim(),
  facturaReemplazo: d.reemplazo.trim(),
  canceladaEn: ahoraISO,
  canceladaPor: por,
});

export interface CancelacionGuardada extends DatosCancelacion {
  en: string;
  por: string;
}

/** Lo que se guardó al cancelar (null si la factura no trae nota ni reemplazo). */
export const cancelacionDe = (factura: unknown): CancelacionGuardada | null => {
  const f = (factura && typeof factura === 'object' ? factura : {}) as Record<string, unknown>;
  const nota = String(f.motivoCancelacion ?? '').trim();
  const reemplazo = String(f.facturaReemplazo ?? '').trim();
  if (!nota && !reemplazo) return null;
  return { nota, reemplazo, en: String(f.canceladaEn ?? ''), por: String(f.canceladaPor ?? '') };
};

/**
 * Qué cambia en la cancelación al guardar un status nuevo:
 *  · pasa a Cancelado → se guardan nota, reemplazo, cuándo y quién;
 *  · ya estaba Cancelado y cambió la nota o el reemplazo → solo esos dos;
 *  · deja de estar Cancelado (o no lo está y trae datos viejos) → se borran.
 */
export const planCancelacion = (
  factura: unknown, statusNuevo: unknown, datos: DatosCancelacion | null, por: string, ahoraISO: string,
): { escribir: Record<string, string>; borrar: boolean } => {
  const f = (factura && typeof factura === 'object' ? factura : {}) as Record<string, unknown>;
  const previa = cancelacionDe(f);
  if (estaCancelada(statusNuevo)) {
    if (!datos) return { escribir: {}, borrar: false };
    if (!estaCancelada(f.statusFactura) || !previa) return { escribir: camposCancelacion(datos, por, ahoraISO), borrar: false };
    if (previa.nota === datos.nota.trim() && previa.reemplazo === datos.reemplazo.trim()) return { escribir: {}, borrar: false };
    return { escribir: { motivoCancelacion: datos.nota.trim(), facturaReemplazo: datos.reemplazo.trim() }, borrar: false };
  }
  return { escribir: {}, borrar: !!previa };
};

// ── Moneda ──────────────────────────────────────────────────────────────
/**
 * Moneda de la empresa en Empresas. Manda `moneda` (el campo que edita el formulario de Empresas);
 * si no, `monedaId`, `monedaNombre`, `monedaRef` (AppSheet) y el campo de su lado. Acepta el ID del
 * catálogo, el código o el nombre; `nombreDeId` traduce otro ID del catálogo a su nombre.
 * ✅ V00482: antes `monedaRef` iba primero y una copia vieja de AppSheet podía ganarle a la moneda actual.
 */
export const monedaDeEmpresa = (empresa: unknown, campoLado: string, nombreDeId: (id: string) => unknown = () => ''): Moneda | null => {
  if (!empresa || typeof empresa !== 'object') return null;
  const e = empresa as Record<string, unknown>;
  for (const campo of ['moneda', 'monedaId', 'monedaNombre', 'monedaRef', campoLado]) {
    const crudo = String(e[campo] ?? '').trim();
    if (!crudo) continue;
    const m = monedaCanonica(crudo) ?? monedaCanonica(nombreDeId(crudo));
    if (m) return m;
  }
  return null;
};

/** Aviso cuando la factura quedó en otra moneda que la de la empresa (null si coinciden o falta alguna). */
export const avisoMonedaDistinta = (monedaFactura: Moneda | null, monedaEmpresa: Moneda | null, quien: 'cliente' | 'proveedor'): string | null => {
  if (!monedaFactura || !monedaEmpresa || monedaFactura === monedaEmpresa) return null;
  return `Esta factura está en ${nombreMoneda(monedaFactura)}, pero el ${quien} factura en ${nombreMoneda(monedaEmpresa)} (Empresas).`;
};

export const avisoSinMoneda = (quien: 'cliente' | 'proveedor'): string =>
  `El ${quien} no tiene moneda en Empresas. Ponla en su ficha de Empresas para facturar.`;

// ── Importe de cada operación en la moneda de la factura ────────────────
type Renglon = Record<string, unknown>;
// Mismas posiciones que la lista (un renglón inválido vale 0), para pintar cada operación con su importe.
const renglones = (v: unknown): Renglon[] => (Array.isArray(v) ? v.map((x): Renglon => (x && typeof x === 'object' ? (x as Renglon) : {})) : []);
const n = (v: unknown): number => Number(v) || 0;
const trae = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * Importe de cada renglón (operación facturada) en la moneda de la factura, con el mismo campo que
 * usa el total (`totalNativoDeOperaciones`), para que la suma de los renglones dé el total:
 *  · Dólares → `dol` ("Dólares (Cliente)"; los que no lo traen, `subtotalBase`).
 *  · Pesos   → `monto` ("Conversión Final (Ingreso)"); si ninguno lo trae, `pes`; luego `subtotalBase`.
 *  · Sin moneda → `monto` (la conversión que siempre se mostró).
 */
export const importesDeRenglones = (moneda: unknown, operaciones: unknown): number[] => {
  const ops = renglones(operaciones);
  const mon = monedaCanonica(moneda);
  if (mon === 'USD') {
    const porDol = ops.map((o) => n(trae(o.dol) ? o.dol : o.subtotalBase));
    return porDol.some((x) => x > 0) ? porDol : ops.map((o) => n(o.subtotalBase));
  }
  if (mon === 'MXN') {
    for (const campo of ['monto', 'pes', 'subtotalBase']) {
      const valores = ops.map((o) => n(o[campo]));
      if (valores.some((x) => x > 0)) return valores;
    }
    return ops.map(() => 0);
  }
  return ops.map((o) => n(o.monto));
};

/**
 * Total de las operaciones EN OTRA MONEDA (al pasar la factura a la moneda de la empresa, o al facturar):
 *  · Dólares → suma de `dol` ("Dólares (Cliente)");
 *  · Pesos   → suma de `monto` ("Conversión Final"), o de `pes`.
 * Sin `subtotalBase`: ese va en la moneda en que se facturó y en otra moneda no vale.
 * 0 si las operaciones no traen importe en esa moneda (p. ej. se facturaron en pesos y no tienen dólares).
 */
export const totalSugeridoEn = (moneda: Moneda, operaciones: unknown): number => {
  const ops = renglones(operaciones);
  const campos = moneda === 'USD' ? ['dol'] : ['monto', 'pes'];
  for (const campo of campos) {
    const t = sumarMontos(ops.map((o) => n(o[campo])));
    if (t > 0) return t;
  }
  return 0;
};

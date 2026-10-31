// src/features/operaciones/services/tomarDeFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00538 — Revisión de datos, D1/D4 en operaciones YA FACTURADAS: "la factura emitida manda"
// (decisión de Omaf, 31-oct). La operación queda con la moneda y el monto con que se facturó; la
// factura y sus pagos no cambian.
//
// Se usa la misma regla que "Corregir monedas y montos" (corregirMonedaConvenio.ts, V00490:
// "Facturado en" = la moneda de la empresa; el precio del convenio se queda en su moneda y se
// convierte con el TC), como si la operación no estuviera facturada. El resultado se acepta SOLO si
// cuadra con la factura emitida:
//   · la factura existe y su moneda es la nueva "Facturado en";
//   · la Conversión que da la regla es el monto con que se facturó (su renglón, ±1 centavo).
// Si no cuadra, NO se toca: se lista "a mano" con el motivo (lo facturado no sale del convenio y TC
// de la operación, la factura está en otra moneda que la empresa…). Así la factura nunca cambia.
// Lógica pura; la lectura y la escritura están en tomarDeFacturaDatos.ts.
// ---------------------------------------------------------------------------
import { refDeOperacion, monedaDeFactura } from '../../../shared/dominio/dinero';
import { renglonesDeFactura } from '../../../shared/dominio/facturacion';
import { monedaCanonica, nombreMoneda } from '../../../shared/dominio/moneda';
import { facturadaCliente } from '../../../shared/dominio/operacionCanonica';
import { revisarOperacion } from './corregirMonedaConvenio';
import type { CatalogoConvenios } from './corregirMonedaConvenio';

type Datos = Record<string, unknown>;

/** Campos de dinero del cliente que se muestran antes y después en la prueba. */
export const CAMPOS_PRUEBA_FACTURA = ['facturadoEnCobrar', 'monedaCobroNombre', 'subtotalCliente', 'dolaresCliente', 'pesosCliente', 'conversionCliente', 'utilidadEstimada'] as const;

export interface PlanTomarDeFactura {
  opId: string;
  ref: string;
  invoice: string;
  facturaId: string;
  /** 'corregir' = se escribe `datos`; 'manual' = se deja para corregirla a mano (`motivo`). */
  estado: 'corregir' | 'manual';
  motivo: string;
  /** Monto con que se facturó (su renglón), en la moneda de la factura. */
  facturado: number | null;
  monedaFactura: string;
  antes: Datos;
  datos: Datos | null;
}

/** Motivo de las que no están facturadas (se corrigen con "Corregir monedas y montos"). */
export const MOTIVO_SIN_FACTURAR = 'Sin facturar: se corrige con "Corregir monedas y montos".';

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;
const TOLERANCIA = 0.01;

/** La operación como si no estuviera facturada (la regla de Corregir monedas salta las facturadas). */
const sinMarcasDeFactura = (op: Datos): Datos => ({ ...op, facturaClienteId: '', facturaClienteInvoice: '', facturado: false });

/** El renglón de la factura que es esta operación (por id del documento, `id` guardado o referencia). */
export const renglonDeOperacion = (factura: Datos, opId: string, op: Datos): Datos | null => {
  const ids = new Set([opId, txt(op.id)].filter(Boolean));
  const ref = refDeOperacion(op, opId).toUpperCase();
  return renglonesDeFactura(factura).find((r) => ids.has(txt(r.id)) || (!!ref && txt(r.ref).toUpperCase() === ref)) ?? null;
};

export const planTomarDeFactura = (opId: string, op: Datos, factura: Datos | null, cat: CatalogoConvenios): PlanTomarDeFactura => {
  const antes = Object.fromEntries(CAMPOS_PRUEBA_FACTURA.map((c) => [c, op[c] ?? '']));
  const base = { opId, ref: refDeOperacion(op, opId), invoice: txt(op.facturaClienteInvoice), facturaId: txt(op.facturaClienteId), facturado: null, monedaFactura: '', antes, datos: null };
  const manual = (motivo: string, extra: Partial<PlanTomarDeFactura> = {}): PlanTomarDeFactura => ({ ...base, ...extra, estado: 'manual', motivo });

  if (!facturadaCliente(op)) return manual(MOTIVO_SIN_FACTURAR);
  if (!factura) return manual('Su factura no existe: primero corrige el Invoice (grupo F3).');
  const monedaFactura = monedaDeFactura(factura);
  if (!monedaFactura) return manual('La factura no tiene moneda: revísala en Editar factura.');
  const renglon = renglonDeOperacion(factura, opId, op);
  const facturado = renglon ? num(renglon.monto) : null;
  const extra = { facturado, monedaFactura: nombreMoneda(monedaFactura) };
  if (!renglon) return manual('La factura no tiene el renglón de esta operación: revísala en Editar factura.', extra);

  const r = revisarOperacion(opId, sinMarcasDeFactura(op), cat, ['cliente']);
  if (!r || r.estado !== 'corregir' || !r.datos) {
    return manual(r?.avisos[0]?.motivo || 'Con la regla no hay nada que cambiar: revísala en el formulario.', extra);
  }
  const final = { ...op, ...r.datos };
  const monedaNueva = monedaCanonica(final.facturadoEnCobrar);
  if (monedaNueva !== monedaFactura) {
    return manual(`La factura está en ${nombreMoneda(monedaFactura)} y la empresa factura en ${monedaNueva ? nombreMoneda(monedaNueva) : 'otra moneda'}: revisa a mano (¿cambió la moneda de la empresa después de facturar?).`, extra);
  }
  const conversion = num(final.conversionCliente);
  if (Math.abs(conversion - (facturado ?? 0)) > TOLERANCIA) {
    return manual(`Se facturó ${facturado?.toFixed(2)} ${nombreMoneda(monedaFactura)} y con su convenio y TC da ${conversion.toFixed(2)}: revisa a mano cuál está bien.`, extra);
  }
  return { ...base, ...extra, estado: 'corregir', motivo: '', datos: r.datos };
};

/** Filas del Excel de prueba: cada operación con lo de antes y lo de después (o por qué no se toca). */
export const filasPruebaTomarDeFactura = (planes: readonly PlanTomarDeFactura[]): Record<string, string | number>[] =>
  planes.map((p) => {
    const fila: Record<string, string | number> = {
      'Acción': p.estado === 'corregir' ? 'Se corrige con lo de la factura' : 'No se toca (a mano)',
      Referencia: p.ref, Invoice: p.invoice, 'Moneda de la factura': p.monedaFactura, Facturado: p.facturado ?? '', Motivo: p.motivo,
    };
    CAMPOS_PRUEBA_FACTURA.forEach((c) => {
      fila[`${c} antes`] = String(p.antes[c] ?? '');
      fila[`${c} después`] = p.datos && c in p.datos ? String(p.datos[c] ?? '') : String(p.antes[c] ?? '');
    });
    return fila;
  });

/** Respaldo: lo que tiene hoy cada operación que se va a corregir. */
export const respaldoTomarDeFactura = (planes: readonly PlanTomarDeFactura[], cuando: string, quien: string) => ({
  tipo: 'D1/D4 facturadas: tomar lo de la factura', cuando, quien,
  operaciones: planes.filter((p) => p.estado === 'corregir').map((p) => ({ id: p.opId, ref: p.ref, campos: p.antes })),
});

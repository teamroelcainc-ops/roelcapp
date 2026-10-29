// src/features/facturacion/services/datosParaSit.ts
// ---------------------------------------------------------------------------
// ✅ V00513 — DATOS PARA EL SIT. Para las operaciones seleccionadas arma, por operación,
// lo que la persona de facturación captura en el SIT: el texto de la descripción
// (referencia, fecha, caja, Ref Cliente y, si se convirtió, el TC) y el IMPORTE ya
// convertido, con la MISMA regla con que Generar Factura guarda el total y con que
// "Subir XML" coteja (montoOperacion + totalNativoDeOperaciones). Así nadie calcula a
// mano y el XML que sale del SIT cuadra al subirlo.
// Solo subtotales: el IVA y las retenciones los calcula el SIT (son contables).
// ---------------------------------------------------------------------------
import { aFechaISO } from '../../../shared/dominio/fechas';
import { monedaConvenioDe, montoOperacion, totalNativoDeOperaciones } from '../../../shared/dominio/dinero';
import { aCentavos, deCentavos } from '../../../shared/dominio/numeros';
import { normalizarRef } from './leerCfdi';

export interface ConceptoSit {
  id: string;
  ref: string;
  /** Convenio de la operación: guía para elegir el producto/servicio en el SIT. */
  convenio: string;
  /** Renglones de la descripción, en el orden en que se capturan. */
  lineas: string[];
  importe: number;
  /** TC con el que se convirtió (0 = no hubo conversión). */
  tipoCambio: number;
}

export interface DatosSit {
  moneda: 'USD' | 'MXN';
  conceptos: ConceptoSit[];
  /** Suma de los importes (subtotal, sin impuestos), en centavos exactos. */
  subtotal: number;
}

const texto = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());

/** AAAA-MM-DD → DD/MM/AAAA (como va en la descripción del SIT). */
export const fechaSit = (v: unknown): string => {
  const iso = aFechaISO(v);
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};

/** Datos de una operación que no son de dinero (los resuelve el tablero: caja y convenio con nombre). */
export interface ExtrasOperacion { caja: string; convenio: string }

export const conceptoSit = (op: Record<string, unknown>, moneda: 'USD' | 'MXN', extras: ExtrasOperacion): ConceptoSit => {
  const m = montoOperacion(op, 'cliente');
  const importe = totalNativoDeOperaciones(moneda, [{ monto: m.conv, dol: m.dol, pes: m.pes, subtotalBase: m.subtotal }]);
  // Hubo conversión si el convenio está en otra moneda que la factura (USD → MXN × TC; MXN → USD ÷ TC).
  const monedaConvenio = monedaConvenioDe(op, 'cliente').moneda;
  const convertido = m.tc > 0 && monedaConvenio !== null && monedaConvenio !== moneda;
  const ref = normalizarRef(texto(op.numReferencia) || texto(op.referencia) || texto(op.ref));
  const refCliente = texto(op.refCliente);
  const fecha = fechaSit(op.fechaServicioISO ?? op.fechaServicio);
  const lineas = [
    ref,
    fecha,
    extras.caja ? `CAJA ${extras.caja}` : '',
    refCliente && refCliente.toUpperCase() !== 'N/A' ? `REF ${refCliente}` : '',
    convertido ? `TC ${m.tc.toFixed(4)}` : '',
  ].filter(Boolean);
  return { id: texto(op.id), ref, convenio: extras.convenio, lineas, importe, tipoCambio: convertido ? m.tc : 0 };
};

export const datosParaSit = (
  ops: readonly Record<string, unknown>[], moneda: 'USD' | 'MXN', extrasDe: (op: Record<string, unknown>) => ExtrasOperacion,
): DatosSit => {
  const conceptos = ops.map((op) => conceptoSit(op, moneda, extrasDe(op)))
    .sort((a, b) => a.ref.localeCompare(b.ref, 'es', { numeric: true }));
  const subtotal = deCentavos(conceptos.reduce((s, c) => s + aCentavos(c.importe), 0));
  return { moneda, conceptos, subtotal };
};

/** Texto de la descripción para pegar en el SIT (un renglón por dato). */
export const textoDescripcion = (c: ConceptoSit): string => c.lineas.join('\n');

/** Importe como se teclea en el SIT: sin símbolo ni comas, 2 decimales. */
export const textoImporte = (n: number): string => n.toFixed(2);

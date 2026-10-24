// src/features/operaciones/services/corregirMonedaConvenio.ts
// ---------------------------------------------------------------------------
// ✅ V00487 — CORREGIR MONEDAS DE CONVENIO (lógica pura; la lectura y escritura están en
// corregirMonedaConvenioDatos.ts). Para cada operación SIN moneda del convenio (cliente o
// proveedor), la moneda que le toca:
//   · la de su convenio (el detalle elegido y, si no la trae, su convenio maestro): la misma
//     fuente que usa el formulario de la operación;
//   · la que dice su conversión guardada (V00486, monedaConvenioDeducida).
// Si las dos coinciden, o solo hay una, se guarda la moneda y se recalculan Subtotal, Dólares,
// Pesos, Conversión y Utilidad con la regla única (lo mismo que hace el formulario al guardar).
// Si chocan, NO se toca: se lista para revisarla en el formulario (p. ej. una conversión que
// quedó sin multiplicar por el TC). Sin ninguna de las dos, se salta.
// ---------------------------------------------------------------------------
import { conversionOperacion, monedaConvenioDeducida, montoOperacion } from '../../../shared/dominio/dinero';
import type { Lado } from '../../../shared/dominio/dinero';
import { idMoneda, monedaCanonica, nombreMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { r2 } from '../../../shared/dominio/numeros';

type Datos = Record<string, unknown>;

/** Convenios de un lado: detalles (lo que guarda la operación) y maestros, por id (y número). */
export interface ConveniosLado {
  detalles: ReadonlyMap<string, Datos>;
  maestros: ReadonlyMap<string, Datos>;
}
export type CatalogoConvenios = Record<Lado, ConveniosLado>;

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Índice de los catálogos de un lado. Los maestros también por su número (como el formulario). */
export const indexarConvenios = (detalles: readonly Datos[], maestros: readonly Datos[]): ConveniosLado => {
  const det = new Map<string, Datos>();
  detalles.forEach((d) => { const id = texto(d._docId ?? d.id); if (id) det.set(id, d); });
  const mae = new Map<string, Datos>();
  maestros.forEach((m) => {
    [m._docId, m.id, m.numeroConvenio, m.numero].map(texto).filter(Boolean).forEach((k) => { if (!mae.has(k)) mae.set(k, m); });
  });
  return { detalles: det, maestros: mae };
};

/** Campos de cada lado en la operación. */
export const CAMPOS_LADO = {
  cliente: { moneda: 'monedaConvenioCliente', convenio: 'convenio', subtotal: 'subtotalCliente', dol: 'dolaresCliente', pes: 'pesosCliente', conv: 'conversionCliente', monto: 'montoConvenioCliente', cargos: 'cargosAdicionales' },
  proveedor: { moneda: 'monedaConvenioProv', convenio: 'convenioProveedor', subtotal: 'subtotalProv', dol: 'dolaresProv', pes: 'pesosProv', conv: 'conversionProv', monto: 'totalAPagarProv', cargos: 'cargosAdicionalesProv' },
} as const;

/** Liga del detalle a su convenio maestro (los mismos nombres que acepta el formulario). */
const refMaestro = (d: Datos): string => texto(
  d.convenioId ?? d.convenio ?? d.id_convenio ?? d.convenioClienteId ?? d.convenioProveedorId ?? d.maestroId ?? d.padreId ?? d.convenio_id,
);

/** Moneda del convenio elegido en la operación: la del detalle; si no trae, la del maestro. */
export const monedaDelConvenio = (op: Datos, lado: Lado, cat: CatalogoConvenios): Moneda | null => {
  const idDetalle = texto(op[CAMPOS_LADO[lado].convenio]);
  if (!idDetalle) return null;
  const detalle = cat[lado].detalles.get(idDetalle);
  if (!detalle) return null;
  const propia = monedaCanonica(detalle.moneda);
  if (propia) return propia;
  const maestro = cat[lado].maestros.get(refMaestro(detalle));
  return maestro ? monedaCanonica(maestro.monedaId) ?? monedaCanonica(maestro.moneda) : null;
};

export type Fuente = 'convenio' | 'conversion' | 'ambas';

export interface CambioLado {
  lado: Lado;
  moneda: Moneda;
  fuente: Fuente;
  /** Subtotal guardado (lo que dice Por Cobrar) antes y después, en la moneda de la factura. */
  subtotalAntes: number;
  subtotalDespues: number;
  monedaFactura: Moneda;
  /** Conversión (pesos) antes y después. */
  convAntes: number;
  convDespues: number;
  /** ¿Cambia lo que Facturación toma de la operación (Dólares o Conversión)? */
  cambiaFactura: boolean;
}

export interface AvisoLado {
  lado: Lado;
  motivo: string;
}

export type EstadoOperacion = 'corregir' | 'revisar' | 'sinDatos';

export interface RevisionOperacion {
  id: string;
  ref: string;
  estado: EstadoOperacion;
  cambios: CambioLado[];
  avisos: AvisoLado[];
  /** Campos que se escriben (solo 'corregir'). */
  datos: Datos | null;
}

export const MOTIVO_SIN_DATOS = 'Sin moneda en su convenio ni conversión guardada: captúrala en el formulario.';
const motivoChoque = (convenio: Moneda, conversion: Moneda): string =>
  `Su convenio es en ${nombreMoneda(convenio)} pero la conversión guardada dice ${nombreMoneda(conversion)}: revísala en el formulario.`;

export const etiquetaLado = (lado: Lado): string => (lado === 'cliente' ? 'Cliente' : 'Proveedor');

const difiere = (a: unknown, b: number): boolean => Math.abs(num(a) - b) >= 0.005;

/**
 * Revisa una operación. null si no hay nada que hacer: los dos lados ya traen moneda del
 * convenio o no tienen monto.
 */
export const revisarOperacion = (id: string, op: Datos, cat: CatalogoConvenios): RevisionOperacion | null => {
  const cambios: CambioLado[] = [];
  const avisos: AvisoLado[] = [];
  const datos: Datos = {};
  (['cliente', 'proveedor'] as const).forEach((lado) => {
    const c = CAMPOS_LADO[lado];
    if (monedaCanonica(op[c.moneda])) return; // ya la trae
    if (!(num(op[c.monto]) + num(op[c.cargos]) > 0)) return; // sin monto: nada que calcular
    const porConvenio = monedaDelConvenio(op, lado, cat);
    const porConversion = monedaConvenioDeducida(op, lado);
    if (!porConvenio && !porConversion) { avisos.push({ lado, motivo: MOTIVO_SIN_DATOS }); return; }
    if (porConvenio && porConversion && porConvenio !== porConversion) { avisos.push({ lado, motivo: motivoChoque(porConvenio, porConversion) }); return; }
    const moneda = (porConvenio ?? porConversion) as Moneda;
    const fuente: Fuente = porConvenio && porConversion ? 'ambas' : porConvenio ? 'convenio' : 'conversion';
    const propios: Datos = { [c.moneda]: idMoneda(moneda) };
    const m = conversionOperacion({ ...op, ...propios }, lado);
    // Sin TC la regla da 0: se guarda solo la moneda y se conservan los montos que había.
    if (m.conv > 0) {
      if (difiere(op[c.subtotal], m.total)) propios[c.subtotal] = m.total;
      if (difiere(op[c.dol], m.dol)) propios[c.dol] = m.dol;
      if (difiere(op[c.pes], m.pes)) propios[c.pes] = m.pes;
      if (difiere(op[c.conv], m.conv)) propios[c.conv] = m.conv;
    }
    Object.assign(datos, propios);
    const antes = montoOperacion(op, lado);
    const despues = montoOperacion({ ...op, ...propios }, lado);
    const subtotalAntes = num(op[c.subtotal]);
    cambios.push({
      lado, moneda, fuente,
      subtotalAntes, subtotalDespues: m.conv > 0 ? m.total : subtotalAntes,
      monedaFactura: m.dol > 0 ? 'USD' : 'MXN',
      convAntes: num(op[c.conv]), convDespues: m.conv > 0 ? m.conv : num(op[c.conv]),
      cambiaFactura: Math.abs(antes.conv - despues.conv) >= 0.005 || Math.abs(antes.dol - despues.dol) >= 0.005,
    });
  });
  if (cambios.length === 0 && avisos.length === 0) return null;
  const ref = texto(op.ref) || texto(op.numReferencia) || texto(op.referencia) || id;
  if (cambios.length === 0) {
    return { id, ref, estado: avisos.some((a) => a.motivo !== MOTIVO_SIN_DATOS) ? 'revisar' : 'sinDatos', cambios, avisos, datos: null };
  }
  // Utilidad = ingreso − gasto, como la calcula el formulario, si cambió alguna conversión.
  if ('conversionCliente' in datos || 'conversionProv' in datos) {
    const ingreso = 'conversionCliente' in datos ? num(datos.conversionCliente) : num(op.conversionCliente);
    const gasto = 'conversionProv' in datos ? num(datos.conversionProv) : num(op.conversionProv);
    const utilidad = r2(ingreso - gasto);
    if (difiere(op.utilidadEstimada, utilidad)) datos.utilidadEstimada = utilidad;
  }
  return { id, ref, estado: 'corregir', cambios, avisos, datos };
};

export interface ResumenOperaciones {
  corregir: RevisionOperacion[];
  revisar: RevisionOperacion[];
  sinDatos: RevisionOperacion[];
  /** Operaciones leídas en total (incluye las que ya estaban bien). */
  leidas: number;
  /** De las que se corrigen: cuántas cambian lo que Facturación toma de ellas (Dólares o Conversión). */
  cambianMonto: number;
}

export const resumirOperaciones = (revisiones: readonly RevisionOperacion[], leidas: number): ResumenOperaciones => {
  const corregir = revisiones.filter((r) => r.estado === 'corregir');
  return {
    corregir,
    revisar: revisiones.filter((r) => r.estado === 'revisar'),
    sinDatos: revisiones.filter((r) => r.estado === 'sinDatos'),
    leidas,
    cambianMonto: corregir.filter((r) => r.cambios.some((c) => c.cambiaFactura)).length,
  };
};

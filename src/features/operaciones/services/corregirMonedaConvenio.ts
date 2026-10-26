// src/features/operaciones/services/corregirMonedaConvenio.ts
// ---------------------------------------------------------------------------
// ✅ V00487 — CORREGIR MONEDAS (lógica pura; la lectura y escritura están en
// corregirMonedaConvenioDatos.ts). Para cada operación SIN moneda del convenio (cliente o
// proveedor), la moneda que le toca:
//   · la de su convenio (el detalle elegido y, si no la trae, su convenio maestro): la misma
//     fuente que usa el formulario de la operación;
//   · la que dice su conversión guardada (V00486, monedaConvenioDeducida).
// Si las dos coinciden, o solo hay una, se guarda la moneda y se recalculan Subtotal, Dólares,
// Pesos, Conversión y Utilidad con la regla única (lo mismo que hace el formulario al guardar).
// Si chocan, NO se toca: se lista para revisarla en el formulario (p. ej. una conversión que
// quedó sin multiplicar por el TC). Sin ninguna de las dos, se salta.
// ✅ V00489: también las que YA traen la moneda del convenio pero cuyo "Facturado en" guarda dos
// monedas distintas (el ID una y la copia del nombre otra): sus montos guardados pudieron quedar
// multiplicados dos veces por el TC (la regla de antes tomaba las dos). Se recalculan con la regla
// única (la moneda del ID, como el formulario) si no cuadran.
// ✅ V00490: "Facturado en" de cada lado = la moneda de su empresa en Empresas (Cliente que paga /
// Proveedor de transporte), con la copia del nombre. El precio del convenio se queda en su moneda
// (decisión de Omaf: precio en dólares, cobro en pesos) y se convierte con el TC: la Conversión en
// pesos no cambia; cambian Dólares / Pesos / Subtotal. Si no se sabe la moneda del convenio (sin
// datos o choque), ese lado no se toca: cambiar solo "Facturado en" movería el monto.
// ---------------------------------------------------------------------------
import { conversionOperacion, monedaConvenioDeducida, monedaFacturaOperacion, montoOperacion } from '../../../shared/dominio/dinero';
import type { Lado } from '../../../shared/dominio/dinero';
import { idMoneda, monedaCanonica, nombreMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { r2 } from '../../../shared/dominio/numeros';
import { facturadaCliente, facturadaProveedor } from '../../../shared/dominio/operacionCanonica';

type Datos = Record<string, unknown>;

/**
 * Catálogos de un lado: detalles de convenio (lo que guarda la operación), maestros (por id y número)
 * y ✅ V00490 la moneda de cada empresa en Empresas (por id).
 */
export interface ConveniosLado {
  detalles: ReadonlyMap<string, Datos>;
  maestros: ReadonlyMap<string, Datos>;
  monedaEmpresa?: ReadonlyMap<string, Moneda>;
}
export type CatalogoConvenios = Record<Lado, ConveniosLado>;

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Índice de los catálogos de un lado. Los maestros también por su número (como el formulario). */
export const indexarConvenios = (
  detalles: readonly Datos[], maestros: readonly Datos[], monedaEmpresa?: ReadonlyMap<string, Moneda>,
): ConveniosLado => {
  const det = new Map<string, Datos>();
  detalles.forEach((d) => { const id = texto(d._docId ?? d.id); if (id) det.set(id, d); });
  const mae = new Map<string, Datos>();
  maestros.forEach((m) => {
    [m._docId, m.id, m.numeroConvenio, m.numero].map(texto).filter(Boolean).forEach((k) => { if (!mae.has(k)) mae.set(k, m); });
  });
  return { detalles: det, maestros: mae, monedaEmpresa };
};

/** Campos de cada lado en la operación. */
export const CAMPOS_LADO = {
  cliente: {
    moneda: 'monedaConvenioCliente', convenio: 'convenio', subtotal: 'subtotalCliente', dol: 'dolaresCliente', pes: 'pesosCliente', conv: 'conversionCliente',
    monto: 'montoConvenioCliente', cargos: 'cargosAdicionales', fact: 'facturadoEnCobrar', nombreFact: 'monedaCobroNombre', empresa: ['clientePaga', 'clientePagaId'],
  },
  proveedor: {
    moneda: 'monedaConvenioProv', convenio: 'convenioProveedor', subtotal: 'subtotalProv', dol: 'dolaresProv', pes: 'pesosProv', conv: 'conversionProv',
    monto: 'totalAPagarProv', cargos: 'cargosAdicionalesProv', fact: 'facturadoEnUnidad', nombreFact: 'monedaUnidadNombre', empresa: ['proveedorUnidad', 'proveedorUnidadId'],
  },
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

/** ✅ V00490: moneda de la empresa del lado (Cliente que paga / Proveedor de transporte); null si no se sabe. */
export const monedaEmpresaDelLado = (op: Datos, lado: Lado, cat: CatalogoConvenios): Moneda | null => {
  const mapa = cat[lado].monedaEmpresa;
  if (!mapa) return null;
  for (const campo of CAMPOS_LADO[lado].empresa) {
    const id = texto(op[campo]);
    if (id && mapa.has(id)) return mapa.get(id) ?? null;
  }
  return null;
};

/** De dónde salió la moneda del convenio: ya la tenía o se puso desde el convenio / la conversión. */
export type Fuente = 'convenio' | 'conversion' | 'ambas' | 'guardada';

export interface CambioLado {
  lado: Lado;
  /** Moneda del convenio (precio); null si el lado no tiene monto y no la trae. */
  moneda: Moneda | null;
  fuente: Fuente;
  /** ✅ V00490: "Facturado en" antes y después (después = la de su empresa). */
  facturadoAntes: Moneda | null;
  facturadoDespues: Moneda | null;
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
/** ✅ V00495: el lado ya está en una factura: no se corrige aquí (se cambia a mano, una por una). */
export const MOTIVO_FACTURADA_OP = 'Ya facturada: no se corrige aquí; si hay que cambiarla, ábrela y corrige su factura a mano (Editar factura)';
const motivoChoque = (convenio: Moneda, conversion: Moneda): string =>
  `Su convenio es en ${nombreMoneda(convenio)} pero la conversión guardada dice ${nombreMoneda(conversion)}: revísala en el formulario.`;

export const etiquetaLado = (lado: Lado): string => (lado === 'cliente' ? 'Cliente' : 'Proveedor');

const difiere = (a: unknown, b: number): boolean => Math.abs(num(a) - b) >= 0.005;

/** ✅ V00489: ¿"Facturado en" guarda dos monedas distintas (el ID dice una y la copia del nombre otra)? */
export const facturaContradice = (op: Datos, lado: Lado): boolean => {
  const porId = monedaCanonica(lado === 'cliente' ? op.facturadoEnCobrar : op.facturadoEnUnidad);
  const porNombre = monedaCanonica(lado === 'cliente' ? op.monedaCobroNombre : op.monedaUnidadNombre);
  return !!porId && !!porNombre && porId !== porNombre;
};

/** Subtotal, Dólares, Pesos y Conversión guardados que no cuadran con la regla (solo esos campos). */
const montosQueCambian = (op: Datos, lado: Lado, m: { total: number; dol: number; pes: number; conv: number }): Datos => {
  const c = CAMPOS_LADO[lado];
  const propios: Datos = {};
  if (difiere(op[c.subtotal], m.total)) propios[c.subtotal] = m.total;
  if (difiere(op[c.dol], m.dol)) propios[c.dol] = m.dol;
  if (difiere(op[c.pes], m.pes)) propios[c.pes] = m.pes;
  if (difiere(op[c.conv], m.conv)) propios[c.conv] = m.conv;
  return propios;
};

/**
 * Revisa un lado. Devuelve los campos a escribir y el cambio para la lista, un aviso (no se toca),
 * o null si ese lado ya está bien.
 */
const revisarLado = (op: Datos, lado: Lado, cat: CatalogoConvenios): { propios: Datos; cambio: CambioLado } | { aviso: AvisoLado } | null => {
  const c = CAMPOS_LADO[lado];
  const tieneMonto = num(op[c.monto]) + num(op[c.cargos]) > 0;
  const propios: Datos = {};

  // 1) Moneda del convenio (precio): la guardada o, si falta, la de su convenio / su conversión.
  let moneda = monedaCanonica(op[c.moneda]);
  let fuente: Fuente = 'guardada';
  if (!moneda && tieneMonto) {
    const porConvenio = monedaDelConvenio(op, lado, cat);
    const porConversion = monedaConvenioDeducida(op, lado);
    if (!porConvenio && !porConversion) return { aviso: { lado, motivo: MOTIVO_SIN_DATOS } };
    if (porConvenio && porConversion && porConvenio !== porConversion) return { aviso: { lado, motivo: motivoChoque(porConvenio, porConversion) } };
    moneda = (porConvenio ?? porConversion) as Moneda;
    fuente = porConvenio && porConversion ? 'ambas' : porConvenio ? 'convenio' : 'conversion';
    propios[c.moneda] = idMoneda(moneda);
  }

  // 2) ✅ V00490: "Facturado en" = la moneda de su empresa (con la copia del nombre).
  const facturadoAntes = monedaFacturaOperacion(op, lado);
  const deEmpresa = monedaEmpresaDelLado(op, lado, cat);
  let facturadoDespues = facturadoAntes;
  if (deEmpresa && facturadoAntes !== deEmpresa) {
    facturadoDespues = deEmpresa;
    propios[c.fact] = idMoneda(deEmpresa);
    propios[c.nombreFact] = nombreMoneda(deEmpresa);
  } else if (facturadoAntes && facturaContradice(op, lado)) {
    propios[c.nombreFact] = nombreMoneda(facturadoAntes); // ✅ V00489: la copia vieja del nombre
  }
  if (Object.keys(propios).length === 0) return null; // ya está bien (los montos solo se tocan si cambia una moneda)

  // 3) Montos con la regla única. Sin TC la regla da 0: se conservan los montos que había.
  const despuesOp = { ...op, ...propios };
  const m = conversionOperacion(despuesOp, lado);
  if (tieneMonto && m.conv > 0) Object.assign(propios, montosQueCambian(op, lado, m));
  if (Object.keys(propios).length === 0) return null;

  const antes = montoOperacion(op, lado);
  const despues = montoOperacion({ ...op, ...propios }, lado);
  const subtotalAntes = num(op[c.subtotal]);
  const conMontos = tieneMonto && m.conv > 0;
  return {
    propios,
    cambio: {
      lado, moneda, fuente, facturadoAntes, facturadoDespues,
      subtotalAntes, subtotalDespues: conMontos ? m.total : subtotalAntes,
      monedaFactura: facturadoDespues ?? (m.dol > 0 ? 'USD' : 'MXN'),
      convAntes: num(op[c.conv]), convDespues: conMontos ? m.conv : num(op[c.conv]),
      cambiaFactura: Math.abs(antes.conv - despues.conv) >= 0.005 || Math.abs(antes.dol - despues.dol) >= 0.005,
    },
  };
};

const LADOS_TODOS: readonly Lado[] = ['cliente', 'proveedor'];

/**
 * Revisa una operación. null si no hay nada que hacer: los dos lados ya traen moneda del
 * convenio, "Facturado en" con la moneda de su empresa y sus montos cuadran, o no tienen monto.
 * `lados` limita la revisión (el botón de Empresas solo toca el lado de esa empresa).
 */
export const revisarOperacion = (id: string, op: Datos, cat: CatalogoConvenios, lados: readonly Lado[] = LADOS_TODOS): RevisionOperacion | null => {
  const cambios: CambioLado[] = [];
  const avisos: AvisoLado[] = [];
  const datos: Datos = {};
  lados.forEach((lado) => {
    const r = revisarLado(op, lado, cat);
    if (!r) return;
    if ('aviso' in r) { avisos.push(r.aviso); return; }
    // ✅ V00495: ya facturada de ese lado → no se toca (su factura solo cambia a mano, 1 x 1): se lista.
    if (lado === 'cliente' ? facturadaCliente(op) : facturadaProveedor(op)) { avisos.push({ lado, motivo: MOTIVO_FACTURADA_OP }); return; }
    Object.assign(datos, r.propios);
    cambios.push(r.cambio);
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
  /** ✅ V00490: de las que se corrigen, cuántas cambian "Facturado en" a la moneda de su empresa. */
  cambianFacturado: number;
}

const conMonto = (r: RevisionOperacion): number => (r.cambios.some((c) => c.convDespues > 0 || c.subtotalDespues > 0) ? 0 : 1);

export const resumirOperaciones = (revisiones: readonly RevisionOperacion[], leidas: number): ResumenOperaciones => {
  // ✅ V00490: primero las que tienen monto (las de $0 solo cambian la etiqueta de la moneda).
  const corregir = revisiones.filter((r) => r.estado === 'corregir').sort((a, b) => conMonto(a) - conMonto(b));
  return {
    corregir,
    revisar: revisiones.filter((r) => r.estado === 'revisar'),
    sinDatos: revisiones.filter((r) => r.estado === 'sinDatos'),
    leidas,
    cambianMonto: corregir.filter((r) => r.cambios.some((c) => c.cambiaFactura)).length,
    cambianFacturado: corregir.filter((r) => r.cambios.some((c) => c.facturadoDespues !== c.facturadoAntes)).length,
  };
};

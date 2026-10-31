// src/shared/dominio/facturacion.ts
// ---------------------------------------------------------------------------
// ✅ V00441 (Fase 5.3 / 5.4) — PLANES de las operaciones de dinero.
//
// Cada función recibe los documentos LEÍDOS EN LA TRANSACCIÓN (frescos) y
// devuelve qué escribir; no toca Firebase. Las callables del servidor
// (functions/src/dinero/*.ts) los ejecutan dentro de runTransaction, así dos
// usuarios a la vez nunca se pisan. Reproducen lo que hacen hoy Facturación
// Clientes/Proveedores y Pagos (mismos campos, mismos avisos), con tres reglas
// nuevas que antes dependían de la pantalla:
//   · una operación no se puede facturar si ya está en OTRA factura;
//   · el total se calcula con la regla única (dinero.ts) y un total capturado a
//     mano queda marcado (totalManualCentavos) para que nada lo pise;
//   · un pago se aplica con el saldo fresco de cada factura (sin acotar en silencio).
// ---------------------------------------------------------------------------
import { ID_MXN, ID_USD } from './constantes.js';
import {
  aplicadoPorFactura, calcularAbono, calcularReversion, ErrorDinero, monedaDeFactura, montoOperacion, montoPagadoDe,
  renglonFactura, tienePagosAplicados, totalesTrasCambioDeOps, totalNativoDeOperaciones, totalNativoFactura,
} from './dinero.js';
import type { CambiosPagoFactura, Lado, RenglonLegado } from './dinero.js';
import { monedaCanonica } from './moneda.js';
import type { Moneda } from './moneda.js';
import { aCentavos, r2, sumarMontos } from './numeros.js';
import { normalizarTexto } from './texto.js';

type Datos = Record<string, unknown>;
export interface DocLeido { id: string; datos: Datos }

/** Máximo de escrituras por transacción/lote (Firestore permite 500; se deja margen). */
export const MAX_ESCRITURAS = 450;

// ── Configuración por lado ───────────────────────────────────────────────
export interface ConfigLado {
  coleccion: 'facturas_clientes' | 'facturas_proveedores';
  campoEmpresa: 'clienteId' | 'proveedorId';
  campoEmpresaNombre: 'clienteNombre' | 'proveedorNombre';
  campoMoneda: 'monedaFacturacion' | 'monedaProveedor';
  opFacturaId: 'facturaClienteId' | 'facturaProveedorId';
  opFolio: 'facturaClienteInvoice' | 'facturaProveedorFolio';
  opFacturado: 'facturado' | 'facturadoProveedor';
  /** Campos de la operación que dicen quién es la empresa de ese lado. */
  opEmpresa: readonly string[];
  etiquetaEmpresa: string;
}

export const LADOS: Readonly<Record<Lado, ConfigLado>> = {
  cliente: {
    coleccion: 'facturas_clientes', campoEmpresa: 'clienteId', campoEmpresaNombre: 'clienteNombre', campoMoneda: 'monedaFacturacion',
    opFacturaId: 'facturaClienteId', opFolio: 'facturaClienteInvoice', opFacturado: 'facturado', opEmpresa: ['clientePaga', 'clienteId'], etiquetaEmpresa: 'cliente',
  },
  proveedor: {
    coleccion: 'facturas_proveedores', campoEmpresa: 'proveedorId', campoEmpresaNombre: 'proveedorNombre', campoMoneda: 'monedaProveedor',
    opFacturaId: 'facturaProveedorId', opFolio: 'facturaProveedorFolio', opFacturado: 'facturadoProveedor', opEmpresa: ['proveedorUnidad', 'proveedorUnidadId'], etiquetaEmpresa: 'proveedor',
  },
};

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
/** Lista de IDs: arreglo, o texto separado por comas (así llegan las facturas importadas del CSV). */
export const lista = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
};
const renglonesDe = (v: unknown): Datos[] => (Array.isArray(v) ? v.filter((x): x is Datos => x !== null && typeof x === 'object') : []);

/**
 * Renglones de una factura. Sin detalle (factura importada) se arman con los IDs
 * y las referencias por posición, en $0 — igual que normalizarFactura de Facturación.
 */
export const renglonesDeFactura = (fac: Datos): Datos[] => {
  const guardadas = renglonesDe(fac.operacionesGuardadas);
  if (guardadas.length > 0) return guardadas;
  const ids = lista(fac.operacionesIds);
  const refs = lista(fac.operaciones);
  return Array.from({ length: Math.max(ids.length, refs.length) }, (_, i) => ({
    id: ids[i] || refs[i] || '', ref: refs[i] || ids[i] || '', monto: 0, subtotalBase: 0,
  }));
};

/** Empresa de la operación en ese lado (mismo orden que Facturación). */
export const empresaDeOperacion = (op: Datos, lado: Lado): string => {
  for (const c of LADOS[lado].opEmpresa) { const v = txt(op[c]); if (v) return v; }
  return '';
};

/** Variantes del folio para buscar la factura existente (la pantalla compara sin mayúsculas). */
export const variantesFolio = (invoice: string): string[] => {
  const t = invoice.trim();
  return Array.from(new Set([t, t.toUpperCase(), t.toLowerCase()])).filter(Boolean);
};

/** ¿Es la misma factura? (mismo folio sin distinguir mayúsculas y misma empresa). */
export const mismoFolio = (fac: Datos, invoice: string, empresaId: string, lado: Lado): boolean =>
  txt(fac.invoice).toLowerCase() === invoice.trim().toLowerCase() && txt(fac[LADOS[lado].campoEmpresa]) === empresaId;

/** ID determinista de una factura nueva: {empresaId}_{folio normalizado} (impide duplicados). */
export const idFacturaDeterminista = (empresaId: string, invoice: string): string => {
  const folio = normalizarTexto(invoice).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'sin-folio';
  return `${empresaId}_${folio}`.replace(/\//g, '-');
};

const montoTexto = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const avisoFacturaConPagos = (monto: number): string =>
  `Esta factura tiene pagos aplicados por ${montoTexto(monto)}. Revierte los pagos en Pagos antes de eliminarla.`;
export const avisoTotalBajoPagado = (total: number, pagado: number): string =>
  `No se puede: el nuevo total (${montoTexto(total)}) quedaría por debajo de lo ya pagado (${montoTexto(pagado)}).\n\nElimina primero el pago aplicado en el módulo de Pagos y vuelve a intentar.`;
const avisoLote = (n: number): string =>
  `Este cambio necesita ${n} escrituras y el máximo por operación es ${MAX_ESCRITURAS}.\n\nDivide la selección en partes más pequeñas y vuelve a intentar.`;

/** Remolques distintos de los renglones (sin vacíos ni '-'). */
export const remolquesDe = (renglones: readonly Datos[]): string[] =>
  Array.from(new Set(renglones.map((o) => txt(o.remolque)).filter((r) => r && r !== '-')));

// ── Escrituras ───────────────────────────────────────────────────────────
export type Escritura =
  | { tipo: 'crear'; coleccion: string; id: string; datos: Datos }
  | { tipo: 'combinar'; coleccion: string; id: string; datos: Datos }
  | { tipo: 'actualizar'; coleccion: string; id: string; datos: Datos }
  | { tipo: 'borrar'; coleccion: string; id: string };

export interface PlanDinero {
  escrituras: Escritura[];
  /** Cómo quedan las facturas tocadas (null = borrada), para refrescar la pantalla. */
  facturas: Record<string, Datos | null>;
  /** Cambios aplicados a operaciones (id → campos). */
  operaciones: Record<string, Datos>;
}

const nuevoPlan = (): PlanDinero => ({ escrituras: [], facturas: {}, operaciones: {} });

const vincular = (plan: PlanDinero, lado: Lado, opId: string, facturaId: string | null, folio: string | null): void => {
  const c = LADOS[lado];
  const datos = { [c.opFacturaId]: facturaId, [c.opFolio]: folio, [c.opFacturado]: facturaId !== null };
  plan.escrituras.push({ tipo: 'actualizar', coleccion: 'operaciones', id: opId, datos });
  plan.operaciones[opId] = datos;
};

/** Error si la operación ya está facturada en OTRA factura de ese lado. */
const exigirLibre = (op: DocLeido, lado: Lado, salvoFactura: string | null): void => {
  const actual = txt(op.datos[LADOS[lado].opFacturaId]);
  if (actual && actual !== salvoFactura) {
    const folio = txt(op.datos[LADOS[lado].opFolio]) || actual;
    throw new ErrorDinero(`La operación ${txt(op.datos.ref) || op.id} ya está en la factura ${folio}. Recarga la lista: otro usuario pudo haberla facturado. No se guardó nada.`);
  }
};

// ── Facturar ─────────────────────────────────────────────────────────────
export interface DatosFacturar {
  lado: Lado;
  empresaId: string;
  empresaNombre: string;
  invoice: string;
  fecha: string;
  facturaCcp: string;
  statusFactura: string;
  /** 'USD' | 'MXN' | '' (la que eligió el usuario). */
  moneda: string;
  ahoraISO: string;
  nombreRemolque?: (v: string) => string;
}

/**
 * Facturar operaciones (handleGuardarFactura): si ya existe una factura con ese
 * folio y esa empresa, se FUSIONA (sus totales se recalculan con todas las
 * operaciones); si no, se crea con `idNueva` (determinista).
 */
export const planFacturar = (d: DatosFacturar, ops: readonly DocLeido[], existente: DocLeido | null, idNueva: string): PlanDinero => {
  const c = LADOS[d.lado];
  const invoice = d.invoice.trim();
  if (!invoice) throw new ErrorDinero('El # de Invoice es obligatorio.');
  if (ops.length === 0) throw new ErrorDinero('Selecciona al menos una operación.');
  if (ops.length + 1 > MAX_ESCRITURAS) throw new ErrorDinero(avisoLote(ops.length + 1));
  const ajenas = ops.filter((o) => empresaDeOperacion(o.datos, d.lado) !== d.empresaId);
  if (ajenas.length > 0) {
    throw new ErrorDinero(`Las operaciones seleccionadas deben ser de un mismo ${c.etiquetaEmpresa}: ${ajenas.map((o) => txt(o.datos.ref) || o.id).slice(0, 5).join(', ')} no es de la empresa elegida.`);
  }
  const destinoId = existente?.id ?? idNueva;
  ops.forEach((o) => exigirLibre(o, d.lado, destinoId));

  const renglones: Datos[] = ops.map((o) => ({ ...renglonFactura(o.id, o.datos, d.lado, d.nombreRemolque) }));
  const moneda = (d.moneda === 'USD' || d.moneda === 'MXN') ? d.moneda : '';
  const monedaId = moneda === 'MXN' ? ID_MXN : moneda === 'USD' ? ID_USD : '';
  const plan = nuevoPlan();

  if (existente) {
    const fac = existente.datos;
    const idsUnion = Array.from(new Set([...lista(fac.operacionesIds), ...ops.map((o) => o.id)]));
    const mapa = new Map<string, Datos>();
    [...renglonesDeFactura(fac), ...renglones].forEach((o) => { if (txt(o.id)) mapa.set(txt(o.id), o); });
    const guardadas = Array.from(mapa.values());
    const monedaMerge = fac[c.campoMoneda] || moneda;
    const totales = totalesTrasCambioDeOps({ ...fac, [c.campoMoneda]: monedaMerge }, guardadas);
    if (!totales.ok) throw new ErrorDinero(avisoTotalBajoPagado(totales.total, totales.pagado));
    const merge: Datos = {
      invoice: txt(fac.invoice) || invoice,
      facturaCcp: d.facturaCcp.trim() || txt(fac.facturaCcp),
      statusFactura: d.statusFactura || txt(fac.statusFactura) || 'Facturado',
      [c.campoEmpresa]: d.empresaId,
      [c.campoEmpresaNombre]: txt(fac[c.campoEmpresaNombre]) || d.empresaNombre,
      [c.campoMoneda]: monedaMerge,
      monedaId: txt(fac.monedaId) || monedaId,
      operacionesIds: idsUnion,
      operaciones: guardadas.map((o) => txt(o.ref)).filter(Boolean),
      operacionesGuardadas: guardadas,
      remolques: Array.from(new Set([...lista(fac.remolques), ...remolquesDe(renglones)].map(txt).filter((r) => r && r !== '-'))),
      ...totales.campos,
      updatedAt: d.ahoraISO,
    };
    plan.escrituras.push({ tipo: 'combinar', coleccion: c.coleccion, id: destinoId, datos: merge });
    plan.facturas[destinoId] = { ...fac, ...merge };
  } else {
    const datos: Datos = {
      invoice,
      fecha: d.fecha,
      facturaCcp: d.facturaCcp.trim(),
      statusFactura: d.statusFactura || 'Facturado',
      [c.campoEmpresa]: d.empresaId,
      [c.campoEmpresaNombre]: d.empresaNombre,
      [c.campoMoneda]: moneda,
      monedaId,
      operacionesIds: ops.map((o) => o.id),
      operaciones: renglones.map((o) => txt(o.ref)).filter(Boolean),
      operacionesGuardadas: renglones,
      remolques: remolquesDe(renglones),
      subtotalFactura: r2(sumarMontos(renglones.map((o) => o.monto))),
      subtotalMonedaFactura: totalNativoFactura({ [c.campoMoneda]: moneda, operacionesGuardadas: renglones }),
      createdAt: d.ahoraISO,
    };
    plan.escrituras.push({ tipo: 'crear', coleccion: c.coleccion, id: destinoId, datos });
    plan.facturas[destinoId] = datos;
  }
  ops.forEach((o) => vincular(plan, d.lado, o.id, destinoId, invoice));
  return plan;
};

// ── Copia del folio en las operaciones ───────────────────────────────────
/** Ids de las operaciones de un grupo de facturas (`operacionesIds` de cada documento, sin repetir). */
export const idsOperacionesDeGrupo = (grupo: readonly DocLeido[]): string[] =>
  Array.from(new Set(grupo.flatMap((f) => lista(f.datos.operacionesIds))));

/**
 * ✅ V00536: la copia del folio en cada operación de la factura (`facturaClienteInvoice` /
 * `facturaProveedorFolio`). Antes, editar el # de Invoice solo cambiaba la factura y la operación seguía
 * mostrando el folio viejo. Solo las ligadas a ESTA factura (su id de factura es uno de los documentos
 * del grupo) y con otro folio; las demás (de otra factura, o sin id de factura) no se tocan.
 */
export const copiasDeFolio = (lado: Lado, folio: string, grupoIds: readonly string[], ops: readonly DocLeido[]): { id: string; datos: Datos }[] => {
  const c = LADOS[lado];
  const f = folio.trim();
  if (!f) return [];
  const ids = new Set(grupoIds);
  return ops
    .filter((o) => ids.has(txt(o.datos[c.opFacturaId])) && txt(o.datos[c.opFolio]) !== f)
    .map((o) => ({ id: o.id, datos: { [c.opFolio]: f } }));
};

// ── Editar factura (total capturado a mano) ──────────────────────────────
export interface DatosEditarFactura {
  lado: Lado;
  /** Desde dónde se edita: Facturación (grupo de documentos) o Pagos (uno). */
  origen: 'facturacion' | 'pagos';
  invoice: string;
  fecha: string;
  facturaCcp: string;
  statusFactura: string;
  moneda: string;
  total: number;
  empresaId?: string;
  empresaNombre?: string;
  ahoraISO: string;
  usuario: string;
}

/**
 * Editar una factura (o su grupo de documentos con el mismo folio). El total
 * capturado queda en el PRIMER documento (los demás en 0, como hoy) y se marca
 * como manual. Desde Pagos no se permite bajar el total por debajo de lo pagado.
 */
export const planEditarFactura = (d: DatosEditarFactura, grupo: readonly DocLeido[], ops: readonly DocLeido[] = []): PlanDinero => {
  const c = LADOS[d.lado];
  if (grupo.length === 0) throw new ErrorDinero('La factura ya no existe (otro usuario la eliminó).');
  if (!d.invoice.trim()) throw new ErrorDinero('El # de Invoice es obligatorio.');
  const total = r2(d.total);
  const primeraFac = grupo[0].datos;
  const pagado = montoPagadoDe(primeraFac);
  if (d.origen === 'pagos') {
    if (!(total > 0)) throw new ErrorDinero('El total debe ser un número mayor a cero.');
    if (total < pagado - 0.009) throw new ErrorDinero(`El total (${montoTexto(total)}) no puede ser MENOR a lo ya pagado (${montoTexto(pagado)}).\n\nPara bajarlo, primero elimina el/los pagos aplicados.`);
  }
  const saldo = r2(Math.max(0, total - pagado));
  const plan = nuevoPlan();
  grupo.forEach((f, i) => {
    const datos: Datos = d.origen === 'pagos'
      ? {
        invoice: d.invoice.trim(), fecha: d.fecha, facturaCcp: d.facturaCcp.trim(), statusFactura: d.statusFactura,
        subtotalFactura: total, subtotalMonedaFactura: total, saldoPendiente: saldo,
        [c.campoMoneda]: d.moneda, // ✅ V00496: el campo de su lado (antes siempre monedaFacturacion)
        editadoEn: d.ahoraISO, editadoPor: d.usuario,
      }
      : {
        invoice: d.invoice.trim(), fecha: d.fecha, facturaCcp: d.facturaCcp.trim(), statusFactura: d.statusFactura,
        [c.campoMoneda]: d.moneda || 'N/A', updatedAt: d.ahoraISO,
        ...(d.empresaId ? { [c.campoEmpresa]: d.empresaId, [c.campoEmpresaNombre]: d.empresaNombre ?? '' } : {}),
        subtotalFactura: i === 0 ? total : 0,
        subtotalMonedaFactura: i === 0 ? total : 0,
        ...(i === 0 ? { saldoPendiente: saldo } : {}),
      };
    if (i === 0) {
      // Manual SOLO si no sale de sus renglones (igual que la reconciliación): un total
      // que coincide con las operaciones sigue al día cuando cambia una operación.
      const deRenglones = r2(totalNativoDeOperaciones(monedaCanonica(d.moneda) ?? monedaDeFactura(f.datos), f.datos.operacionesGuardadas));
      const esManual = deRenglones > 0 && Math.abs(total - deRenglones) > 0.005;
      datos.totalManualCentavos = esManual ? aCentavos(total) : 0;
      if (pagado > 0.009) datos.statusPago = saldo <= 0.009 ? 'PAGADA' : 'PARCIAL';
    } else if (d.origen === 'facturacion') {
      datos.totalManualCentavos = 0;
    }
    plan.escrituras.push({ tipo: 'combinar', coleccion: c.coleccion, id: f.id, datos });
    plan.facturas[f.id] = { ...f.datos, ...datos };
  });
  // ✅ V00536: el folio también en sus operaciones (`ops` = las operaciones de la factura que existen).
  copiasDeFolio(d.lado, d.invoice, grupo.map((f) => f.id), ops).forEach(({ id, datos }) => {
    plan.escrituras.push({ tipo: 'actualizar', coleccion: 'operaciones', id, datos });
    plan.operaciones[id] = datos;
  });
  if (plan.escrituras.length > MAX_ESCRITURAS) throw new ErrorDinero(avisoLote(plan.escrituras.length).replace('Divide la selección en partes más pequeñas', 'Quita primero algunas operaciones de la factura'));
  return plan;
};

// ── Quitar una operación de su(s) factura(s) ─────────────────────────────
/**
 * Quitar una operación (quitarOpDeFactura / quitarRefDeFactura). Si era la
 * única de la factura: se borra la factura (si no tiene pagos) o, con
 * `permitirBorrarFactura: false`, se avisa. La operación vuelve a "Por facturar".
 */
export const planQuitarOperacion = (
  lado: Lado, opId: string, op: DocLeido | null, facturasConOp: readonly DocLeido[], permitirBorrarFactura: boolean, ahoraISO: string,
): PlanDinero => {
  const c = LADOS[lado];
  const plan = nuevoPlan();
  const ref = txt(op?.datos.ref) || opId.substring(0, 6);
  for (const f of facturasConOp) {
    const ids = lista(f.datos.operacionesIds).filter((id) => id !== opId);
    const guardadas = renglonesDeFactura(f.datos).filter((o) => txt(o.id) !== opId);
    if (ids.length === 0) {
      if (!permitirBorrarFactura) {
        throw new ErrorDinero('No puedes dejar la factura sin operaciones.\n\nSi quieres deshacerla por completo, usa el botón de eliminar factura (las operaciones vuelven a Por facturar).');
      }
      if (tienePagosAplicados(f.datos)) {
        throw new ErrorDinero(`La operación ${ref} es la única de la factura ${txt(f.datos.invoice)}, que se eliminaría.\n\n${avisoFacturaConPagos(montoPagadoDe(f.datos))}`);
      }
      plan.escrituras.push({ tipo: 'borrar', coleccion: c.coleccion, id: f.id });
      plan.facturas[f.id] = null;
      continue;
    }
    const totales = totalesTrasCambioDeOps(f.datos, guardadas);
    if (!totales.ok) throw new ErrorDinero(avisoTotalBajoPagado(totales.total, totales.pagado));
    const datos: Datos = {
      operacionesIds: ids, operacionesGuardadas: guardadas, operaciones: guardadas.map((o) => txt(o.ref)).filter(Boolean),
      remolques: remolquesDe(guardadas), ...totales.campos, updatedAt: ahoraISO,
    };
    plan.escrituras.push({ tipo: 'combinar', coleccion: c.coleccion, id: f.id, datos });
    plan.facturas[f.id] = { ...f.datos, ...datos };
  }
  if (op) vincular(plan, lado, opId, null, null);
  return plan;
};

// ── Mover una operación a otro folio ─────────────────────────────────────
export interface DatosMover {
  lado: Lado;
  nuevoInvoice: string;
  ahoraISO: string;
  nombreEmpresa: (id: string) => string;
  nombreRemolque?: (v: string) => string;
}

/**
 * Cambiar el # de factura de una operación (editarInvoiceDeOp): sale de su(s)
 * factura(s) (la que se queda vacía se borra si no tiene pagos) y entra a la del
 * nuevo folio de la misma empresa, o a una nueva con los datos de la anterior.
 */
export const planMoverOperacion = (
  d: DatosMover, op: DocLeido, facturasConOp: readonly DocLeido[], destino: DocLeido | null, idNueva: string,
): PlanDinero => {
  const c = LADOS[d.lado];
  const nuevoInvoice = d.nuevoInvoice.trim();
  if (!nuevoInvoice) throw new ErrorDinero('Captura un número de factura.');
  const empresaId = empresaDeOperacion(op.datos, d.lado);
  const plan = nuevoPlan();
  let renglon: Datos | null = null;
  let meta: Datos | null = null;
  for (const f of facturasConOp) {
    if (!meta) meta = f.datos;
    const g = renglonesDeFactura(f.datos).find((o) => txt(o.id) === op.id);
    if (g && !renglon) renglon = g;
  }
  const resumen: Datos = renglon ?? { ...renglonFactura(op.id, op.datos, d.lado, d.nombreRemolque) };
  const salida = planQuitarOperacion(d.lado, op.id, null, facturasConOp, true, d.ahoraISO);
  plan.escrituras.push(...salida.escrituras);
  Object.assign(plan.facturas, salida.facturas);

  let destinoId: string;
  if (destino) {
    const fac = destino.datos;
    const ids = Array.from(new Set([...lista(fac.operacionesIds), op.id]));
    const mapa = new Map<string, Datos>();
    [...renglonesDeFactura(fac), resumen].forEach((o) => { if (txt(o.id)) mapa.set(txt(o.id), o); });
    const guardadas = Array.from(mapa.values());
    const totales = totalesTrasCambioDeOps(fac, guardadas);
    if (!totales.ok) throw new ErrorDinero(avisoTotalBajoPagado(totales.total, totales.pagado));
    destinoId = destino.id;
    const datos: Datos = {
      invoice: txt(fac.invoice) || nuevoInvoice, operacionesIds: ids, operacionesGuardadas: guardadas,
      operaciones: guardadas.map((o) => txt(o.ref)).filter(Boolean), remolques: remolquesDe(guardadas), ...totales.campos, updatedAt: d.ahoraISO,
    };
    plan.escrituras.push({ tipo: 'combinar', coleccion: c.coleccion, id: destinoId, datos });
    plan.facturas[destinoId] = { ...fac, ...datos };
  } else {
    destinoId = idNueva;
    const moneda = meta?.[c.campoMoneda] || 'N/A';
    const datos: Datos = {
      invoice: nuevoInvoice,
      fecha: txt(meta?.fecha),
      facturaCcp: txt(meta?.facturaCcp),
      statusFactura: txt(meta?.statusFactura) || 'Facturado',
      [c.campoEmpresa]: empresaId,
      [c.campoEmpresaNombre]: txt(meta?.[c.campoEmpresaNombre]) || d.nombreEmpresa(empresaId),
      [c.campoMoneda]: moneda,
      operacionesIds: [op.id],
      operaciones: [txt(resumen.ref)].filter(Boolean),
      operacionesGuardadas: [resumen],
      remolques: remolquesDe([resumen]),
      subtotalFactura: r2(resumen.monto),
      subtotalMonedaFactura: totalNativoDeOperaciones(moneda, [resumen]),
      createdAt: d.ahoraISO,
    };
    plan.escrituras.push({ tipo: 'crear', coleccion: c.coleccion, id: destinoId, datos });
    plan.facturas[destinoId] = datos;
  }
  vincular(plan, d.lado, op.id, destinoId, nuevoInvoice);
  return plan;
};

// ── Agregar una operación a una factura ──────────────────────────────────
export const planAgregarOperacion = (lado: Lado, factura: DocLeido, op: DocLeido, ahoraISO: string, nombreRemolque?: (v: string) => string): PlanDinero => {
  const c = LADOS[lado];
  exigirLibre(op, lado, factura.id);
  const fac = factura.datos;
  const empresaFac = txt(fac[c.campoEmpresa]);
  const empresaOp = empresaDeOperacion(op.datos, lado);
  if (empresaFac && empresaOp && empresaFac !== empresaOp) {
    throw new ErrorDinero(`La operación ${txt(op.datos.ref) || op.id} es de otro ${c.etiquetaEmpresa}; no se puede agregar a la factura ${txt(fac.invoice)}.`);
  }
  const resumen: Datos = { ...renglonFactura(op.id, op.datos, lado, nombreRemolque) };
  const ids = Array.from(new Set([...lista(fac.operacionesIds), op.id]));
  const mapa = new Map<string, Datos>();
  [...renglonesDeFactura(fac), resumen].forEach((o) => { if (txt(o.id)) mapa.set(txt(o.id), o); });
  const guardadas = Array.from(mapa.values());
  const totales = totalesTrasCambioDeOps(fac, guardadas);
  if (!totales.ok) throw new ErrorDinero(avisoTotalBajoPagado(totales.total, totales.pagado));
  const datos: Datos = {
    operacionesIds: ids, operacionesGuardadas: guardadas, operaciones: guardadas.map((o) => txt(o.ref)).filter(Boolean),
    remolques: remolquesDe(guardadas), ...totales.campos, updatedAt: ahoraISO,
  };
  const plan = nuevoPlan();
  plan.escrituras.push({ tipo: 'combinar', coleccion: c.coleccion, id: factura.id, datos });
  plan.facturas[factura.id] = { ...fac, ...datos };
  vincular(plan, lado, op.id, factura.id, txt(fac.invoice));
  return plan;
};

// ── Eliminar factura(s) ──────────────────────────────────────────────────
/** ✅ V00496: otra factura (que no se borra) con sus operaciones, para no "desfacturar" las que siguen en ella. */
export interface FacturaContenedora {
  id: string;
  invoice: string;
  operacionesIds: readonly string[];
  statusFactura?: unknown;
}

export type DestinoAlEliminar =
  | { accion: 'liberar' }
  | { accion: 'ligar'; facturaId: string; folio: string }
  | { accion: 'dejar' };

const esCancelada = (status: unknown): boolean => normalizarTexto(status).startsWith('cancelad');

/**
 * ✅ V00496 (antes solo en la web, V00494): qué pasa con una operación de las facturas que se borran.
 *  · Apunta a OTRA factura que no se borra (y existe, si se sabe) → 'dejar' (no se toca, como siempre en el servidor).
 *  · Si no (apunta a una de las borradas o a ninguna) y sigue en otra factura NO cancelada → 'ligar'
 *    a esa (p. ej. al borrar el duplicado, queda en la buena).
 *  · Si no → 'liberar' (vuelve a "Por facturar"). Una factura cancelada no la retiene (igual que el
 *    script de facturas en texto: no se marca con canceladas).
 * `idsOp` = los ids con que puede aparecer en `operacionesIds` (el del documento y el de la lista o
 * su campo `id` de AppSheet).
 */
export const destinoAlEliminar = (
  apunta: string, idsOp: readonly string[], borradas: ReadonlySet<string>, otras: readonly FacturaContenedora[],
  existe?: ReadonlySet<string>,
): DestinoAlEliminar => {
  // `existe` (si se sabe): una marca a una factura que ya no existe cuenta como sin marca.
  if (apunta && !borradas.has(apunta) && (!existe || existe.has(apunta))) return { accion: 'dejar' };
  const viva = otras.find((f) => !borradas.has(f.id) && !esCancelada(f.statusFactura) && idsOp.some((x) => x && f.operacionesIds.includes(x)));
  return viva ? { accion: 'ligar', facturaId: viva.id, folio: viva.invoice } : { accion: 'liberar' };
};

/**
 * Eliminar una factura o su grupo (handleEliminarFactura): nunca con pagos
 * aplicados. ✅ V00496: cada operación sigue `destinoAlEliminar` con las OTRAS facturas que la
 * contienen (`otras`): antes toda operación que apuntaba a la factura borrada volvía a "Por
 * facturar", aunque siguiera en otra (p. ej. al borrar el duplicado, que suele ser la última).
 */
export const planEliminarFacturas = (
  lado: Lado, grupo: readonly DocLeido[], opsExistentes: readonly DocLeido[], otras: readonly FacturaContenedora[] = [], existe?: ReadonlySet<string>,
): PlanDinero => {
  const c = LADOS[lado];
  const conPagos = grupo.find((f) => tienePagosAplicados(f.datos));
  if (conPagos) {
    const quien = grupo.length > 1 ? `La factura ${txt(conPagos.datos.invoice)} (del grupo) no se puede eliminar.\n\n` : '';
    throw new ErrorDinero(quien + avisoFacturaConPagos(montoPagadoDe(conPagos.datos)));
  }
  const escrituras = grupo.length + opsExistentes.length;
  if (escrituras > MAX_ESCRITURAS) throw new ErrorDinero(avisoLote(escrituras).replace('Divide la selección en partes más pequeñas', 'Quita primero algunas operaciones de la factura'));
  const plan = nuevoPlan();
  const ids = new Set(grupo.map((f) => f.id));
  grupo.forEach((f) => { plan.escrituras.push({ tipo: 'borrar', coleccion: c.coleccion, id: f.id }); plan.facturas[f.id] = null; });
  opsExistentes.forEach((o) => {
    const destino = destinoAlEliminar(txt(o.datos[c.opFacturaId]), [o.id, txt(o.datos.id)], ids, otras, existe);
    if (destino.accion === 'liberar') vincular(plan, lado, o.id, null, null);
    else if (destino.accion === 'ligar') vincular(plan, lado, o.id, destino.facturaId, destino.folio);
  });
  return plan;
};

// ── Recalcular una factura desde sus operaciones (Pagos) ─────────────────
/**
 * "Recalcular montos" de Pagos: rehace cada renglón con la conversión de la
 * operación (regla única) y el total en la moneda de la factura (la de la
 * empresa si la tiene). Quita la marca de total manual.
 */
export const planRecalcularFactura = (
  lado: Lado, factura: DocLeido, ops: readonly DocLeido[], monedaEmpresa: Moneda | null, ahoraISO: string, usuario: string,
): PlanDinero => {
  const c = LADOS[lado];
  const fac = factura.datos;
  const ids = lista(fac.operacionesIds);
  if (ids.length === 0) throw new ErrorDinero('Esta factura no tiene operaciones ligadas: corrige el total con "Editar factura".');
  if (ops.length === 0) throw new ErrorDinero('No se encontraron las operaciones de la factura.');
  const porId = new Map(ops.map((o) => [o.id, montoOperacion(o.datos, lado)]));
  const previas = renglonesDeFactura(fac);
  const guardadas = (previas.length > 0 ? previas : ids.map((id) => ({ id }) as Datos)).map((g) => {
    const m = porId.get(txt(g.id));
    return m ? { ...g, monto: m.conv, subtotalBase: m.subtotal, dol: m.dol, pes: m.pes } : g;
  });
  const moneda = monedaEmpresa ?? monedaDeFactura(fac);
  const totalConv = sumarMontos(guardadas.map((o) => o.monto));
  const total = moneda === 'USD' ? sumarMontos(guardadas.map((o) => o.dol)) : totalConv;
  if (total <= 0) throw new ErrorDinero('El recálculo dio $0.00 — revisa las operaciones (montos de convenio y tipo de cambio).');
  const pagado = montoPagadoDe(fac);
  if (total < pagado - 0.009) throw new ErrorDinero(`El total recalculado (${montoTexto(total)}) es MENOR a lo ya pagado (${montoTexto(pagado)}).\n\nElimina primero el/los pagos aplicados y vuelve a intentar.`);
  const saldo = r2(Math.max(0, total - pagado));
  const datos: Datos = {
    operacionesGuardadas: guardadas, subtotalFactura: totalConv, subtotalMonedaFactura: total, saldoPendiente: saldo,
    totalManualCentavos: 0, editadoEn: ahoraISO, editadoPor: usuario,
  };
  if (monedaEmpresa) datos.moneda = monedaEmpresa;
  if (pagado > 0.009) datos.statusPago = saldo <= 0.009 ? 'PAGADA' : 'PARCIAL';
  const plan = nuevoPlan();
  plan.escrituras.push({ tipo: 'combinar', coleccion: c.coleccion, id: factura.id, datos });
  plan.facturas[factura.id] = { ...fac, ...datos };
  return plan;
};

// ── Pagos ────────────────────────────────────────────────────────────────
export type TipoPago = 'cliente' | 'proveedor' | 'mtto';
const coleccionDePago = (tipo: TipoPago): string | null =>
  tipo === 'cliente' ? LADOS.cliente.coleccion : tipo === 'proveedor' ? LADOS.proveedor.coleccion : null;

/** Renglón de `facturas[]` de un pago (forma actual). */
export interface FacturaAplicada {
  facturaId: string;
  invoice: string;
  fecha: string;
  total: number;
  saldoAnterior: number;
  aplicado: number;
  saldoNuevo: number;
}

export interface DatosRegistrarPago {
  tipo: TipoPago;
  numeroPago: string;
  fecha: string;
  metodoPago: string;
  referencia: string;
  entidadId: string;
  entidadNombre: string;
  monto: number;
  observaciones: string;
  pdfUrl: string;
  pdfNombre: string;
  /** Lo que capturó el usuario por factura (para MTTO, también total y saldo de la lista). */
  aplicacion: readonly FacturaAplicada[];
  creadoEn: string;
  creadoPor: string;
}

/** Una factura no puede aparecer dos veces en el mismo pago (se aplicaría y revertiría doble). */
const exigirSinRepetidas = (aplicacion: readonly FacturaAplicada[]): void => {
  const vistas = new Set<string>();
  for (const a of aplicacion) {
    if (vistas.has(a.facturaId)) throw new ErrorDinero(`La factura ${a.invoice || a.facturaId} aparece dos veces en el pago. Quita la repetida y vuelve a intentar. No se guardó nada.`);
    vistas.add(a.facturaId);
  }
};

const conPagoId = (fac: Datos, pagoId: string, quitar = false): string[] => {
  const previos = lista(fac.pagosIds);
  return quitar ? previos.filter((p) => p !== pagoId) : Array.from(new Set([...previos, pagoId]));
};

/**
 * Registrar un pago (guardarPago): valida montos y moneda, aplica cada abono con
 * el saldo FRESCO de su factura (regla única) y escribe pago + facturas.
 * `facturas` = documentos frescos de las facturas aplicadas (vacío en MTTO).
 */
export const planRegistrarPago = (d: DatosRegistrarPago, pagoId: string, facturas: ReadonlyMap<string, Datos | null>): PlanDinero => {
  exigirSinRepetidas(d.aplicacion);
  const aplicables = d.tipo === 'mtto' ? new Map<string, number>() : aplicadoPorFactura(d.aplicacion);
  const totalAplicadoCapturado = sumarMontos(d.aplicacion.map((a) => a.aplicado));
  if (d.aplicacion.length === 0) throw new ErrorDinero('Selecciona al menos una factura.');
  if (totalAplicadoCapturado <= 0) throw new ErrorDinero('Captura el monto a aplicar en al menos una factura.');
  const monto = r2(d.monto);
  if (monto <= 0) throw new ErrorDinero('Captura el monto recibido del pago.');
  if (!d.fecha) throw new ErrorDinero('Captura la fecha del pago.');
  if (aplicables.size > 400) throw new ErrorDinero(`Este pago afecta ${aplicables.size} facturas y en una sola operación se pueden procesar como máximo 400. No se guardó nada.`);
  const coleccion = coleccionDePago(d.tipo);
  const monedas = new Set<Moneda>();
  const abonos = new Map<string, ReturnType<typeof calcularAbono>>();
  for (const [id, aplicado] of aplicables) {
    const fac = facturas.get(id);
    const etiqueta = d.aplicacion.find((a) => a.facturaId === id)?.invoice || id;
    if (!fac) throw new ErrorDinero(`La factura ${etiqueta} ya no existe (pudo haber sido eliminada). Recarga las facturas y vuelve a intentarlo. No se guardó nada.`);
    const m = monedaDeFactura(fac);
    if (m) monedas.add(m);
    abonos.set(id, calcularAbono(fac, aplicado, etiqueta, 'unica'));
  }
  if (monedas.size > 1) throw new ErrorDinero(`Las facturas seleccionadas tienen monedas distintas (${Array.from(monedas).join(', ')}). Un pago solo puede cubrir facturas de la misma moneda.`);
  const filas: FacturaAplicada[] = d.aplicacion.map((a) => {
    const ab = abonos.get(a.facturaId);
    return ab ? { ...a, total: ab.total, saldoAnterior: ab.saldoAnterior, aplicado: ab.aplicado, saldoNuevo: ab.saldoNuevo } : { ...a };
  });
  const montoAplicado = sumarMontos(filas.map((f) => f.aplicado));
  if (montoAplicado > monto + 0.009) {
    throw new ErrorDinero(`Estás aplicando ${montoTexto(montoAplicado)} pero el monto recibido es ${montoTexto(monto)}.\n\nNo se puede aplicar más dinero del recibido: baja el monto de alguna factura o sube el monto recibido.`);
  }
  const moneda = Array.from(monedas)[0] ?? (d.tipo === 'mtto' ? 'MXN' : '');
  const plan = nuevoPlan();
  const pago: Datos = {
    tipo: d.tipo, numeroPago: d.numeroPago, fecha: d.fecha, metodoPago: d.metodoPago, referencia: d.referencia,
    entidadId: d.entidadId, empresaId: d.entidadId || null, entidadNombre: d.entidadNombre,
    monto, montoAplicado, saldoAFavor: r2(Math.max(0, monto - montoAplicado)), moneda,
    observaciones: d.observaciones, pdfUrl: d.pdfUrl, pdfNombre: d.pdfNombre, facturas: filas,
    creadoEn: d.creadoEn, creadoPor: d.creadoPor,
    montoCentavos: aCentavos(monto), montoAplicadoCentavos: aCentavos(montoAplicado), saldoAFavorCentavos: Math.max(0, aCentavos(monto) - aCentavos(montoAplicado)),
  };
  plan.escrituras.push({ tipo: 'crear', coleccion: 'pagos', id: pagoId, datos: pago });
  if (coleccion) {
    abonos.forEach((ab, id) => {
      const fac = facturas.get(id) as Datos;
      const datos: Datos = { ...ab.cambios, pagosIds: conPagoId(fac, pagoId) };
      plan.escrituras.push({ tipo: 'combinar', coleccion, id, datos });
      plan.facturas[id] = { ...fac, ...datos };
    });
  }
  return plan;
};

export interface DatosEditarPago {
  fecha: string;
  numeroPago: string;
  referencia: string;
  metodoPago: string;
  observaciones: string;
  pdfUrl: string;
  pdfNombre: string;
  editadoEn: string;
  editadoPor: string;
  /** Facturas que se agregan al pago (MTTO: con total/saldo de la lista). */
  agregadas: readonly FacturaAplicada[];
}

/** Editar un pago (guardarEdicionPago): datos del pago y facturas nuevas aplicadas con su saldo fresco. */
export const planEditarPago = (pago: DocLeido, d: DatosEditarPago, facturas: ReadonlyMap<string, Datos | null>): PlanDinero => {
  if (!d.fecha) throw new ErrorDinero('Captura la fecha del pago.');
  if (!d.numeroPago.trim()) throw new ErrorDinero('Captura el número del pago.');
  const tipo = txt(pago.datos.tipo) as TipoPago;
  const coleccion = coleccionDePago(tipo);
  const previas = Array.isArray(pago.datos.facturas) ? (pago.datos.facturas as FacturaAplicada[]) : [];
  const yaEnPago = new Set(previas.map((fa) => String(fa.facturaId)));
  if (d.agregadas.length > 400) throw new ErrorDinero(`Este pago afecta ${d.agregadas.length} facturas y en una sola operación se pueden procesar como máximo 400. No se guardó nada.`);
  const nuevas: FacturaAplicada[] = [];
  const plan = nuevoPlan();
  exigirSinRepetidas(d.agregadas);
  for (const a of d.agregadas) {
    if (!(a.aplicado > 0)) continue;
    if (yaEnPago.has(a.facturaId)) throw new ErrorDinero(`La factura ${a.invoice} ya está aplicada en este pago (otro usuario la agregó). Cierra la edición y vuelve a abrirla. No se guardó nada.`);
    if (!coleccion) {
      // MTTO: como hoy, con los datos de la lista (el saldo se deriva de los pagos).
      const aplicado = r2(a.aplicado);
      nuevas.push({ ...a, aplicado, saldoNuevo: r2(Math.max(0, a.saldoAnterior - aplicado)) });
      continue;
    }
    const fac = facturas.get(a.facturaId);
    if (!fac) throw new ErrorDinero(`La factura ${a.invoice} ya no existe (pudo haber sido eliminada). No se guardó nada.`);
    // ✅ V00496: igual que al registrar, un pago no mezcla monedas (una empresa puede tener facturas en las dos).
    const monedaPago = monedaCanonica(pago.datos.moneda);
    const monedaFac = monedaDeFactura(fac);
    if (monedaPago && monedaFac && monedaFac !== monedaPago) {
      throw new ErrorDinero(`La factura ${a.invoice} está en ${monedaFac} y el pago en ${monedaPago}: un pago solo puede cubrir facturas de su misma moneda. No se guardó nada.`);
    }
    const ab = calcularAbono(fac, a.aplicado, a.invoice, 'unica');
    nuevas.push({ ...a, total: ab.total, saldoAnterior: ab.saldoAnterior, aplicado: ab.aplicado, saldoNuevo: ab.saldoNuevo });
    const datos: Datos = { ...ab.cambios, pagosIds: conPagoId(fac, pago.id) };
    plan.escrituras.push({ tipo: 'combinar', coleccion, id: a.facturaId, datos });
    plan.facturas[a.facturaId] = { ...fac, ...datos };
  }
  const datosPago: Datos = {
    fecha: d.fecha, numeroPago: d.numeroPago.trim(), referencia: d.referencia.trim(), metodoPago: d.metodoPago,
    observaciones: d.observaciones.trim(), pdfUrl: d.pdfUrl, pdfNombre: d.pdfNombre, editadoEn: d.editadoEn, editadoPor: d.editadoPor,
  };
  if (nuevas.length > 0) {
    const monto = sumarMontos([pago.datos.monto, ...nuevas.map((n) => n.aplicado)]);
    const montoAplicado = sumarMontos([...previas, ...nuevas].map((n) => n.aplicado));
    Object.assign(datosPago, {
      facturas: [...previas, ...nuevas], monto, montoAplicado,
      montoCentavos: aCentavos(monto), montoAplicadoCentavos: aCentavos(montoAplicado),
    });
  }
  plan.escrituras.push({ tipo: 'combinar', coleccion: 'pagos', id: pago.id, datos: datosPago });
  return plan;
};

/** Eliminar un pago: revierte lo aplicado en cada factura que siga existiendo (regla única). */
export const planEliminarPago = (pago: DocLeido, facturas: ReadonlyMap<string, Datos | null>): PlanDinero => {
  const tipo = txt(pago.datos.tipo) as TipoPago;
  const coleccion = coleccionDePago(tipo);
  const plan = nuevoPlan();
  if (coleccion) {
    const aplicado = aplicadoPorFactura(pago.datos.facturas);
    if (aplicado.size > 400) throw new ErrorDinero(`Este pago afecta ${aplicado.size} facturas y en una sola operación se pueden procesar como máximo 400. No se guardó nada.`);
    aplicado.forEach((monto, id) => {
      const fac = facturas.get(id);
      if (!fac) return; // factura eliminada: no hay saldo que revertir
      const cambios: CambiosPagoFactura = calcularReversion(fac, monto, 'unica');
      const datos: Datos = { ...cambios, pagosIds: conPagoId(fac, pago.id, true) };
      plan.escrituras.push({ tipo: 'combinar', coleccion, id, datos });
      plan.facturas[id] = { ...fac, ...datos };
    });
  }
  plan.escrituras.push({ tipo: 'borrar', coleccion: 'pagos', id: pago.id });
  return plan;
};

/** Moneda canónica de una empresa (para Recalcular). */
export const monedaDeEmpresa = (empresa: Datos | null | undefined): Moneda | null =>
  empresa ? (monedaCanonica(empresa.moneda) ?? monedaCanonica(empresa.monedaNombre) ?? monedaCanonica(empresa.monedaId)) : null;

/** Utilidad para pruebas y para el servidor: aplica un plan sobre un mapa en memoria. */
export const aplicarPlanEnMemoria = (base: Map<string, Datos>, plan: PlanDinero): Map<string, Datos> => {
  const salida = new Map(base);
  for (const e of plan.escrituras) {
    const clave = `${e.coleccion}/${e.id}`;
    if (e.tipo === 'borrar') salida.delete(clave);
    else if (e.tipo === 'crear') salida.set(clave, { ...e.datos });
    else salida.set(clave, { ...(salida.get(clave) ?? {}), ...e.datos });
  }
  return salida;
};

export type { Lado, RenglonLegado };

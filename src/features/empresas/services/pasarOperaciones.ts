// src/features/empresas/services/pasarOperaciones.ts
// ---------------------------------------------------------------------------
// ✅ V00508 — PASAR OPERACIONES DE UNA EMPRESA A OTRA (lógica pura; las lecturas y escrituras están
// en pasarOperacionesEscritura.ts). Caso: un cliente con dos registros (su alias de cliente y el
// nombre que usa como proveedor) y operaciones capturadas con el que no era. Desde Referencias se
// eligen las operaciones, la empresa destino y el papel que cambia (Proveedor (Unidad), Cliente que
// Paga…). Las que ya están facturadas en ese papel se deciden en la ventana:
//   · 'dejar'      → no se pasan;
//   · 'sinFactura' → la operación pasa; su factura y sus pagos siguen a nombre de la empresa origen;
//   · 'conFactura' → la operación pasa con su factura y los pagos de esa factura. Solo si TODAS las
//     operaciones de la factura se pasan, la empresa destino no tiene ya ese folio y cada pago solo
//     paga facturas que también se pasan; si no, sus operaciones no se pasan y se dice por qué.
// Solo cambia la empresa (el id y su copia *Nombre): montos, convenio y moneda se quedan. Los
// campos canónicos (`proveedorUnidadId`, `empresasIds`…) los recalcula el servidor (operacionEscrita).
// ---------------------------------------------------------------------------
import { MAESTROS, razonSocialEmpresa } from '../../../shared/dominio/nombres';
import { facturadaCliente, facturadaProveedor, fuentesReales } from '../../../shared/dominio/operacionCanonica';

type Datos = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
/** Folio comparable (mayúsculas, sin espacios). */
export const folio = (v: unknown): string => txt(v).toUpperCase().replace(/\s+/g, '');
const lista = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).map(txt).filter(Boolean);

export type Papel = 'clientePaga' | 'clienteMercancia' | 'provServicios' | 'proveedorUnidad' | 'origen' | 'destino';
export type Lado = 'cliente' | 'proveedor';
export type ModoFacturadas = 'dejar' | 'sinFactura' | 'conFactura';

/** Papeles de una empresa en la operación; `lado` = el de su factura (los demás no se facturan). */
export const PAPELES_EMPRESA: readonly { campo: Papel; etiqueta: string; lado: Lado | null }[] = [
  { campo: 'clientePaga', etiqueta: 'Cliente que Paga', lado: 'cliente' },
  { campo: 'clienteMercancia', etiqueta: 'Cliente (Mercancía)', lado: null },
  { campo: 'provServicios', etiqueta: 'Proveedor (Servicios)', lado: null },
  { campo: 'proveedorUnidad', etiqueta: 'Proveedor (Unidad)', lado: 'proveedor' },
  { campo: 'origen', etiqueta: 'Origen', lado: null },
  { campo: 'destino', etiqueta: 'Destino', lado: null },
];
const ladoDe = (p: Papel): Lado | null => PAPELES_EMPRESA.find((x) => x.campo === p)?.lado ?? null;
export const etiquetaPapel = (p: Papel): string => PAPELES_EMPRESA.find((x) => x.campo === p)?.etiqueta ?? p;

/** Campos donde la operación guarda la empresa de un papel: los del usuario y el canónico (`<campo>Id`). */
const fuentesDePapel = (p: Papel): string[] => Array.from(new Set([p, ...fuentesReales(`${p}Id`), `${p}Id`]));

/** Papeles en los que la operación tiene a la empresa (por cualquiera de sus ids). */
export const papelesDeEmpresa = (op: Datos, idsEmpresa: readonly string[]): Papel[] =>
  PAPELES_EMPRESA.filter(({ campo }) => fuentesDePapel(campo).some((f) => idsEmpresa.includes(txt(op[f])))).map((x) => x.campo);

export const facturadaEn = (op: Datos, lado: Lado): boolean => (lado === 'cliente' ? facturadaCliente(op) : facturadaProveedor(op));

// ── Facturas y pagos ──────────────────────────────────────────────────────
export interface FacturaPase { id: string; lado: Lado; invoice: string; operacionesIds: string[]; operacionesRefs: string[] }
export interface PagoPase { id: string; lado: Lado | null; facturaIds: string[]; folios: string[] }

export const facturaPaseDe = (d: Datos & { id: string }, lado: Lado): FacturaPase => ({
  id: d.id, lado, invoice: txt(d.invoice ?? d.folio ?? d.numeroFactura), operacionesIds: lista(d.operacionesIds), operacionesRefs: lista(d.operaciones),
});

export const pagoPaseDe = (d: Datos & { id: string }): PagoPase => {
  const facturas = (Array.isArray(d.facturas) ? d.facturas : []).filter((f): f is Datos => !!f && typeof f === 'object');
  const tipo = txt(d.tipo);
  return {
    id: d.id,
    lado: tipo === 'cliente' || tipo === 'proveedor' ? tipo : null,
    facturaIds: facturas.map((f) => txt(f.facturaId)).filter(Boolean),
    folios: facturas.map((f) => folio(f.invoice)).filter(Boolean),
  };
};

/** Facturas del lado donde está la operación: por el id que guarda o por su folio. */
export const facturasDeOperacion = (op: Datos, lado: Lado, facturas: readonly FacturaPase[]): FacturaPase[] => {
  const id = txt(lado === 'cliente' ? op.facturaClienteId : op.facturaProveedorId);
  const fol = folio(lado === 'cliente' ? op.facturaClienteInvoice : op.facturaProveedorFolio);
  const delLado = facturas.filter((f) => f.lado === lado);
  const porId = id ? delLado.filter((f) => f.id === id) : [];
  if (porId.length > 0) return porId;
  return fol ? delLado.filter((f) => folio(f.invoice) === fol) : [];
};

/** ¿El pago paga esa factura? (por su id o por el folio del mismo lado). */
export const pagaA = (p: PagoPase, f: FacturaPase): boolean =>
  p.facturaIds.includes(f.id) || ((p.lado === null || p.lado === f.lado) && !!folio(f.invoice) && p.folios.includes(folio(f.invoice)));

// ── Plan ──────────────────────────────────────────────────────────────────
export interface EntradaPase {
  idsOrigen: readonly string[];
  /** Operaciones elegidas (id real en `id`). */
  operaciones: readonly (Datos & { id: string })[];
  papeles: readonly Papel[];
  modo: ModoFacturadas | null;
  /** Facturas y pagos de la empresa origen (solo hacen falta con 'conFactura'). */
  facturas?: readonly FacturaPase[];
  pagos?: readonly PagoPase[];
  /** Folios que la empresa destino ya tiene, por lado. */
  foliosDestino?: Readonly<Record<Lado, ReadonlySet<string>>>;
}

export interface OpPase { id: string; ref: string; papeles: Papel[]; facturas: string[] }
export interface Omitida { id: string; ref: string; motivo: string }

export interface PlanPase {
  operaciones: OpPase[];
  omitidas: Omitida[];
  /** Elegidas que ya están facturadas en alguno de los papeles que cambian. */
  facturadas: number;
  /** Hay facturadas y aún no se decidió qué hacer con ellas. */
  falta: boolean;
  facturas: FacturaPase[];
  pagos: PagoPase[];
}

const refDe = (op: Datos & { id: string }): string => txt(op.ref) || op.id;
const SIN_FOLIOS: Record<Lado, ReadonlySet<string>> = { cliente: new Set(), proveedor: new Set() };

export const planDePase = (e: EntradaPase): PlanPase => {
  const omitidas: Omitida[] = [];
  const candidatas: (OpPase & { refNorm: string })[] = [];
  let facturadas = 0;
  const facturas = e.facturas ?? [];
  for (const op of e.operaciones) {
    const tiene = papelesDeEmpresa(op, e.idsOrigen);
    const papeles = e.papeles.filter((p) => tiene.includes(p));
    if (papeles.length === 0) {
      omitidas.push({ id: op.id, ref: refDe(op), motivo: `La empresa no está como ${e.papeles.map(etiquetaPapel).join(' ni ') || 'ese papel'} en esta operación` });
      continue;
    }
    const lados = Array.from(new Set(papeles.map(ladoDe).filter((l): l is Lado => l !== null))).filter((l) => facturadaEn(op, l));
    const base = { id: op.id, ref: refDe(op), refNorm: folio(op.ref), papeles, facturas: [] as string[] };
    if (lados.length === 0) { candidatas.push(base); continue; }
    facturadas += 1;
    if (e.modo === null || e.modo === 'dejar') {
      omitidas.push({ id: op.id, ref: base.ref, motivo: 'Ya está facturada' });
      continue;
    }
    if (e.modo === 'sinFactura') { candidatas.push(base); continue; }
    const suyas = lados.flatMap((l) => facturasDeOperacion(op, l, facturas));
    const sinEncontrar = lados.filter((l) => facturasDeOperacion(op, l, facturas).length === 0);
    if (sinEncontrar.length > 0) {
      omitidas.push({ id: op.id, ref: base.ref, motivo: 'No se encontró su factura entre las de esta empresa' });
      continue;
    }
    candidatas.push({ ...base, facturas: Array.from(new Set(suyas.map((f) => f.id))) });
  }

  // Facturas que pasan con sus operaciones: se descartan hasta que no cambie nada (quitar una
  // factura saca sus operaciones, y eso puede dejar incompleta otra factura).
  const porId = new Map(facturas.map((f) => [f.id, f]));
  const pagos = e.pagos ?? [];
  const folios = e.foliosDestino ?? SIN_FOLIOS;
  let vivas = candidatas;
  for (;;) {
    const ids = new Set(vivas.map((o) => o.id));
    const refs = new Set(vivas.map((o) => o.refNorm).filter(Boolean));
    const enJuego = new Set(vivas.flatMap((o) => o.facturas));
    const bloqueo = new Map<string, string>();
    enJuego.forEach((fid) => {
      const f = porId.get(fid);
      if (!f) { bloqueo.set(fid, 'No se encontró su factura'); return; }
      const faltan = f.operacionesIds.filter((x) => !ids.has(x)).length + f.operacionesRefs.filter((r) => !refs.has(folio(r))).length;
      if (faltan > 0) { bloqueo.set(fid, `Su factura ${f.invoice || f.id} tiene operaciones que no se están pasando`); return; }
      if (folio(f.invoice) && folios[f.lado].has(folio(f.invoice))) { bloqueo.set(fid, `La empresa destino ya tiene la factura ${f.invoice}`); return; }
      const ajeno = pagos.find((p) => pagaA(p, f) && facturas.some((g) => pagaA(p, g) && !enJuego.has(g.id)));
      if (ajeno) bloqueo.set(fid, `Un pago de la factura ${f.invoice || f.id} también paga otra factura que no se pasa`);
    });
    if (bloqueo.size === 0) break;
    const siguen: typeof vivas = [];
    vivas.forEach((o) => {
      const motivo = o.facturas.map((f) => bloqueo.get(f)).find(Boolean);
      if (motivo) omitidas.push({ id: o.id, ref: o.ref, motivo }); else siguen.push(o);
    });
    vivas = siguen;
  }

  const idsFacturas = new Set(vivas.flatMap((o) => o.facturas));
  const facturasQuePasan = facturas.filter((f) => idsFacturas.has(f.id));
  return {
    operaciones: vivas.map((o) => ({ id: o.id, ref: o.ref, papeles: o.papeles, facturas: o.facturas })),
    omitidas,
    facturadas,
    falta: facturadas > 0 && e.modo === null,
    facturas: facturasQuePasan,
    pagos: pagos.filter((p) => facturasQuePasan.some((f) => pagaA(p, f))),
  };
};

// ── Cambios a escribir ────────────────────────────────────────────────────
/** Lo que cambia en la operación: el campo del papel (y otro campo viejo que tuviera a la origen) y sus nombres. */
export const cambiosDeOperacion = (op: Datos, papeles: readonly Papel[], idsOrigen: readonly string[], idDestino: string, destino: Datos): Datos => {
  const cambios: Datos = {};
  const destinos = MAESTROS.find((m) => m.coleccion === 'empresas')?.destinos ?? [];
  papeles.forEach((p) => {
    cambios[p] = idDestino;
    fuentesReales(`${p}Id`).filter((f) => f !== p && idsOrigen.includes(txt(op[f]))).forEach((f) => { cambios[f] = idDestino; });
    destinos.filter((d) => d.coleccion === 'operaciones' && d.campoId === p).forEach((d) => { cambios[d.campoNombre] = (d.regla ?? razonSocialEmpresa)(destino); });
  });
  return cambios;
};

/** Lo que cambia en una factura que pasa: su empresa y su nombre. */
export const cambiosDeFactura = (f: Datos, lado: Lado, idDestino: string, destino: Datos): Datos => {
  const nombre = razonSocialEmpresa(destino);
  const [campoId, campoNombre, campoTexto] = lado === 'cliente' ? ['clienteId', 'clienteNombre', 'cliente'] : ['proveedorId', 'proveedorNombre', 'proveedor'];
  return { [campoId]: idDestino, [campoNombre]: nombre, ...(txt(f[campoTexto]) ? { [campoTexto]: nombre } : {}) };
};

/** Lo que cambia en un pago que pasa: cada campo de empresa que tenga a la origen, y sus nombres. */
export const cambiosDePago = (p: Datos, idsOrigen: readonly string[], idDestino: string, destino: Datos): Datos => {
  const nombre = razonSocialEmpresa(destino);
  const cambios: Datos = { entidadNombre: nombre };
  ['entidadId', 'clienteId', 'proveedorId', 'empresaId'].forEach((c) => { if (idsOrigen.includes(txt(p[c]))) cambios[c] = idDestino; });
  if (!txt(p.entidadId)) cambios.entidadId = idDestino;
  ['clienteNombre', 'proveedorNombre'].forEach((c) => { if (txt(p[c])) cambios[c] = nombre; });
  return cambios;
};

/** ¿La factura / el pago sigue siendo de la empresa origen? (se revisa al escribir). */
export const facturaEsDe = (f: Datos, lado: Lado, idsOrigen: readonly string[]): boolean =>
  idsOrigen.includes(txt(lado === 'cliente' ? f.clienteId : f.proveedorId));
export const pagoEsDe = (p: Datos, idsOrigen: readonly string[]): boolean =>
  ['entidadId', 'clienteId', 'proveedorId', 'empresaId'].some((c) => idsOrigen.includes(txt(p[c])));

/**
 * ✅ V00441 (Fase 5.3 / 5.4) — DINERO EN EL SERVIDOR: facturación y pagos por callable.
 * ------------------------------------------------------------------------------
 * Cada callable lee TODO lo que necesita dentro de una transacción (facturas,
 * operaciones, el pago), calcula con el plan puro de dominio/facturacion.ts (el
 * mismo cálculo y los mismos avisos que la pantalla) y escribe en la misma
 * transacción. Dos usuarios a la vez ya no se pisan: si alguien cambió algo
 * entre la lectura y la escritura, Firestore reintenta con el dato nuevo.
 *
 * Detrás de la bandera `dineroPorServidor` (configuracion/flags): con la
 * bandera apagada estas funciones se niegan y la web sigue con su camino viejo.
 * Se enciende DESPUÉS de aprobar la reconciliación (punto de parada P3), porque
 * aquí el total se calcula con la regla única de dominio/dinero.ts.
 * ------------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { exigirPersonal, EXIGIR_APP_CHECK } from './acceso.js';
import { banderaServidorFresca } from './flags.js';
import { catalogoServidor } from './canonico.js';
import { ErrorDinero } from './dominio/dinero.js';
import {
  empresaDeOperacion, idFacturaDeterminista, LADOS, lista, mismoFolio, monedaDeEmpresa, planAgregarOperacion, planEditarFactura,
  planEditarPago, planEliminarFacturas, planEliminarPago, planFacturar, planMoverOperacion, planQuitarOperacion,
  planRecalcularFactura, planRegistrarPago, variantesFolio,
} from './dominio/facturacion.js';
import type { DocLeido, Escritura, PlanDinero } from './dominio/facturacion.js';

if (getApps().length === 0) initializeApp();

type Datos = Record<string, unknown>;
const OPCIONES = { region: 'us-central1', enforceAppCheck: EXIGIR_APP_CHECK } as const;

// ── Utilidades ───────────────────────────────────────────────────────────
/** Quita `undefined` en cualquier nivel (Firestore Admin los rechaza). */
export const sinIndefinidos = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sinIndefinidos);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const salida: Datos = {};
    for (const [k, x] of Object.entries(v as Datos)) if (x !== undefined) salida[k] = sinIndefinidos(x);
    return salida;
  }
  return v;
};

/** Escribe un plan dentro de la transacción. */
export const ejecutarPlan = (db: Firestore, tx: Transaction, plan: PlanDinero): void => {
  for (const e of plan.escrituras as Escritura[]) {
    const ref = db.collection(e.coleccion).doc(e.id);
    if (e.tipo === 'borrar') tx.delete(ref);
    else if (e.tipo === 'crear') tx.set(ref, sinIndefinidos(e.datos) as Datos);
    else if (e.tipo === 'combinar') tx.set(ref, sinIndefinidos(e.datos) as Datos, { merge: true });
    else tx.update(ref, sinIndefinidos(e.datos) as Datos);
  }
};

const leer = async (tx: Transaction, refs: DocumentReference[]): Promise<DocLeido[]> => {
  if (refs.length === 0) return [];
  const snaps = await tx.getAll(...refs);
  return snaps.filter((s) => s.exists).map((s) => ({ id: s.id, datos: s.data() as Datos }));
};

/** Valida el payload, exige personal y la bandera; traduce los errores de negocio. */
const callable = <S extends z.ZodTypeAny, R>(esquema: S, cuerpo: (datos: z.infer<S>, uid: string, req: CallableRequest) => Promise<R>) =>
  onCall(OPCIONES, async (request) => {
    await exigirPersonal(request.auth?.uid);
    if (!(await banderaServidorFresca('dineroPorServidor'))) {
      throw new HttpsError('failed-precondition', 'La facturación por servidor no está activa (bandera dineroPorServidor). Recarga la página.');
    }
    const parsed = esquema.safeParse(request.data ?? {});
    if (!parsed.success) throw new HttpsError('invalid-argument', parsed.error.issues.map((i) => `${i.path.join('.') || 'datos'}: ${i.message}`).join('; '));
    try {
      return await cuerpo(parsed.data, request.auth?.uid ?? '', request);
    } catch (e) {
      if (e instanceof ErrorDinero) throw new HttpsError('failed-precondition', e.message);
      if (e instanceof HttpsError) throw e;
      logger.error('[dinero] fallo', e);
      throw new HttpsError('internal', (e as Error)?.message || 'No se pudo completar la operación.');
    }
  });

const nombreUsuario = async (db: Firestore, uid: string): Promise<string> => {
  const s = await db.collection('usuarios').doc(uid).get();
  const x = (s.data() ?? {}) as Datos;
  return String(x.nombre || x.email || uid);
};

/** Traduce el ID de un remolque a su nombre (catálogo en memoria 5 min). */
const resolverRemolque = async (): Promise<(v: string) => string> => {
  try {
    const cat = await catalogoServidor('remolques', ['nombre', 'placas', 'placa']);
    return (v) => cat.porId.get(v) ?? v;
  } catch { return (v) => v; }
};

const lado = z.enum(['cliente', 'proveedor']);
const id = z.string().trim().min(1).max(200).refine((s) => !s.includes('/'), 'Id inválido');
const texto = (max = 500) => z.string().max(max).default('');
const monto = z.number().finite().min(0).max(1e12);

/** Facturas del lado con ese folio y esa empresa (sin distinguir mayúsculas). */
const buscarPorFolio = async (db: Firestore, tx: Transaction, l: 'cliente' | 'proveedor', empresaId: string, invoice: string): Promise<DocLeido[]> => {
  const c = LADOS[l];
  const snap = await tx.get(db.collection(c.coleccion).where(c.campoEmpresa, '==', empresaId).where('invoice', 'in', variantesFolio(invoice)));
  return snap.docs.map((d) => ({ id: d.id, datos: d.data() as Datos })).filter((f) => mismoFolio(f.datos, invoice, empresaId, l));
};

/**
 * Facturas del lado que contienen la operación: las de `array-contains` y, además,
 * la que la operación dice tener (facturaClienteId/facturaProveedorId) — las
 * facturas importadas del CSV guardan operacionesIds como texto con comas y la
 * consulta no las encuentra (igual que facturasFrescasConOp de la pantalla).
 */
const facturasConOperacion = async (db: Firestore, tx: Transaction, l: 'cliente' | 'proveedor', opId: string, op: DocLeido | null): Promise<DocLeido[]> => {
  const col = db.collection(LADOS[l].coleccion);
  const snap = await tx.get(col.where('operacionesIds', 'array-contains', opId));
  const salida = snap.docs.map((d) => ({ id: d.id, datos: d.data() as Datos }));
  const propia = String(op?.datos[LADOS[l].opFacturaId] ?? '').trim();
  if (propia && !propia.includes('/') && !salida.some((f) => f.id === propia)) {
    const f = await tx.get(col.doc(propia));
    if (f.exists && lista((f.data() as Datos).operacionesIds).includes(opId)) salida.push({ id: f.id, datos: f.data() as Datos });
  }
  return salida;
};

/**
 * Factura destino de un folio: la que ya existe con ese folio (búsqueda por
 * variantes o, si el folio se capturó con otras mayúsculas, la del ID
 * determinista) o el ID para crearla (el determinista si está libre).
 */
const destinoDeFolio = async (
  db: Firestore, tx: Transaction, l: 'cliente' | 'proveedor', empresaId: string, invoice: string, excluir: ReadonlySet<string> = new Set(),
): Promise<{ existente: DocLeido | null; id: string }> => {
  const c = LADOS[l];
  const porFolio = (await buscarPorFolio(db, tx, l, empresaId, invoice)).filter((f) => !excluir.has(f.id));
  if (porFolio[0]) return { existente: porFolio[0], id: porFolio[0].id };
  const det = idFacturaDeterminista(empresaId, invoice);
  const snap = await tx.get(db.collection(c.coleccion).doc(det));
  if (!snap.exists) return { existente: null, id: det };
  const datos = snap.data() as Datos;
  if (!excluir.has(det) && mismoFolio(datos, invoice, empresaId, l)) return { existente: { id: det, datos }, id: det };
  return { existente: null, id: db.collection(c.coleccion).doc().id };
};

const respuesta = (plan: PlanDinero, extra: Datos = {}) => ({ ok: true, facturas: plan.facturas, operaciones: plan.operaciones, ...extra });

// ── Facturación ──────────────────────────────────────────────────────────
export const facturarOperaciones = callable(z.object({
  lado, empresaId: id, empresaNombre: texto(300), invoice: z.string().trim().min(1).max(120), fecha: texto(40), facturaCcp: texto(120),
  statusFactura: texto(60), moneda: z.enum(['USD', 'MXN', '']).default(''), operacionesIds: z.array(id).min(1).max(449),
}), async (d) => {
  const db = getFirestore();
  const nombreRemolque = await resolverRemolque();
  const ids = Array.from(new Set(d.operacionesIds));
  return db.runTransaction(async (tx) => {
    const [ops, destino] = await Promise.all([
      leer(tx, ids.map((x) => db.collection('operaciones').doc(x))),
      destinoDeFolio(db, tx, d.lado, d.empresaId, d.invoice),
    ]);
    if (ops.length !== ids.length) throw new ErrorDinero('Alguna operación ya no existe (otro usuario la eliminó). Recarga la lista.');
    const existente = destino.existente;
    const idNueva = destino.id;
    const plan = planFacturar({ ...d, ahoraISO: new Date().toISOString(), nombreRemolque }, ops, existente, idNueva);
    ejecutarPlan(db, tx, plan);
    return respuesta(plan, { facturaId: idNueva, fusionada: !!existente });
  });
});

export const editarFactura = callable(z.object({
  lado, origen: z.enum(['facturacion', 'pagos']), facturaIds: z.array(id).min(1).max(50), invoice: z.string().trim().min(1).max(120),
  fecha: texto(40), facturaCcp: texto(120), statusFactura: texto(60), moneda: texto(20), total: monto, empresaId: id.optional(),
}), async (d, uid) => {
  const db = getFirestore();
  const usuario = await nombreUsuario(db, uid);
  return db.runTransaction(async (tx) => {
    const refs = d.facturaIds.map((x) => db.collection(LADOS[d.lado].coleccion).doc(x));
    const [grupoLeido, empresa] = await Promise.all([
      leer(tx, refs),
      d.empresaId ? tx.get(db.collection('empresas').doc(d.empresaId)) : Promise.resolve(null),
    ]);
    // Mismo orden que pidió la pantalla (el total va al primero).
    const grupo = d.facturaIds.map((x) => grupoLeido.find((f) => f.id === x)).filter((f): f is DocLeido => !!f);
    const empresaNombre = empresa?.exists ? String((empresa.data() as Datos).nombre ?? '') : undefined;
    const plan = planEditarFactura({
      ...d, empresaId: empresa?.exists ? d.empresaId : undefined, empresaNombre, ahoraISO: new Date().toISOString(), usuario,
    }, grupo);
    ejecutarPlan(db, tx, plan);
    return respuesta(plan);
  });
});

export const quitarOperacionFactura = callable(z.object({
  lado, operacionId: id, permitirBorrarFactura: z.boolean().default(true),
}), async (d) => {
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const ops = await leer(tx, [db.collection('operaciones').doc(d.operacionId)]);
    const facturas = await facturasConOperacion(db, tx, d.lado, d.operacionId, ops[0] ?? null);
    const plan = planQuitarOperacion(d.lado, d.operacionId, ops[0] ?? null, facturas, d.permitirBorrarFactura, new Date().toISOString());
    ejecutarPlan(db, tx, plan);
    return respuesta(plan);
  });
});

export const moverOperacionFactura = callable(z.object({
  lado, operacionId: id, nuevoInvoice: z.string().trim().min(1).max(120),
}), async (d) => {
  const db = getFirestore();
  const nombreRemolque = await resolverRemolque();
  return db.runTransaction(async (tx) => {
    const [op] = await leer(tx, [db.collection('operaciones').doc(d.operacionId)]);
    if (!op) throw new ErrorDinero('La operación ya no existe (otro usuario la eliminó).');
    const origen = await facturasConOperacion(db, tx, d.lado, d.operacionId, op);
    const empresaId = empresaDeOperacion(op.datos, d.lado);
    const origenIds = new Set(origen.map((f) => f.id));
    const { existente: destino, id: idNueva } = await destinoDeFolio(db, tx, d.lado, empresaId, d.nuevoInvoice, origenIds);
    const empresa = destino ? null : await tx.get(db.collection('empresas').doc(empresaId || '-'));
    const nombreEmpresa = () => (empresa?.exists ? String((empresa.data() as Datos).nombre ?? '') : '');
    const plan = planMoverOperacion({ lado: d.lado, nuevoInvoice: d.nuevoInvoice, ahoraISO: new Date().toISOString(), nombreEmpresa, nombreRemolque }, op, origen, destino, idNueva);
    ejecutarPlan(db, tx, plan);
    return respuesta(plan, { facturaId: idNueva });
  });
});

export const agregarOperacionFactura = callable(z.object({ lado, facturaId: id, operacionId: id }), async (d) => {
  const db = getFirestore();
  const nombreRemolque = await resolverRemolque();
  return db.runTransaction(async (tx) => {
    const [facturas, ops] = await Promise.all([
      leer(tx, [db.collection(LADOS[d.lado].coleccion).doc(d.facturaId)]),
      leer(tx, [db.collection('operaciones').doc(d.operacionId)]),
    ]);
    if (!facturas[0]) throw new ErrorDinero('Esta factura ya no existe (alguien más la eliminó). Recarga el historial.');
    if (!ops[0]) throw new ErrorDinero('La operación ya no existe (otro usuario la eliminó).');
    const plan = planAgregarOperacion(d.lado, facturas[0], ops[0], new Date().toISOString(), nombreRemolque);
    ejecutarPlan(db, tx, plan);
    return respuesta(plan);
  });
});

export const eliminarFactura = callable(z.object({ lado, facturaIds: z.array(id).min(1).max(50) }), async (d) => {
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const grupo = await leer(tx, d.facturaIds.map((x) => db.collection(LADOS[d.lado].coleccion).doc(x)));
    if (grupo.length === 0) throw new ErrorDinero('La factura ya no existe (otro usuario la eliminó). Recarga el historial.');
    const opsIds = Array.from(new Set(grupo.flatMap((f) => lista(f.datos.operacionesIds)))).filter((x) => !x.includes('/'));
    if (opsIds.length + grupo.length > 450) throw new ErrorDinero('La factura tiene demasiadas operaciones para eliminarla de una vez. Quita primero algunas operaciones y vuelve a intentar.');
    const ops = await leer(tx, opsIds.map((x) => db.collection('operaciones').doc(x)));
    const plan = planEliminarFacturas(d.lado, grupo, ops);
    ejecutarPlan(db, tx, plan);
    return respuesta(plan);
  });
});

export const recalcularFactura = callable(z.object({ lado, facturaId: id }), async (d, uid) => {
  const db = getFirestore();
  const usuario = await nombreUsuario(db, uid);
  return db.runTransaction(async (tx) => {
    const [factura] = await leer(tx, [db.collection(LADOS[d.lado].coleccion).doc(d.facturaId)]);
    if (!factura) throw new ErrorDinero('No se encontró la factura (pudo haber sido eliminada).');
    const opsIds = lista(factura.datos.operacionesIds).filter((x) => !x.includes('/')).slice(0, 449);
    const empresaId = String(factura.datos[LADOS[d.lado].campoEmpresa] ?? '');
    const [ops, empresa] = await Promise.all([
      leer(tx, opsIds.map((x) => db.collection('operaciones').doc(x))),
      empresaId ? tx.get(db.collection('empresas').doc(empresaId)) : Promise.resolve(null),
    ]);
    const moneda = monedaDeEmpresa(empresa?.exists ? (empresa.data() as Datos) : null);
    const plan = planRecalcularFactura(d.lado, factura, ops, moneda, new Date().toISOString(), usuario);
    ejecutarPlan(db, tx, plan);
    return respuesta(plan);
  });
});

// ── Pagos ────────────────────────────────────────────────────────────────
const facturaAplicada = z.object({
  facturaId: id, invoice: texto(120), fecha: texto(40), total: monto.default(0), saldoAnterior: monto.default(0), aplicado: monto, saldoNuevo: monto.default(0),
});
const tipoPago = z.enum(['cliente', 'proveedor', 'mtto']);

const leerFacturasDePago = async (db: Firestore, tx: Transaction, tipo: 'cliente' | 'proveedor' | 'mtto', ids: string[]): Promise<Map<string, Datos | null>> => {
  const mapa = new Map<string, Datos | null>();
  if (tipo === 'mtto') return mapa;
  const leidas = await leer(tx, ids.map((x) => db.collection(LADOS[tipo].coleccion).doc(x)));
  ids.forEach((x) => mapa.set(x, leidas.find((f) => f.id === x)?.datos ?? null));
  return mapa;
};

export const registrarPago = callable(z.object({
  tipo: tipoPago, pagoId: id, numeroPago: z.string().trim().min(1).max(120), fecha: z.string().min(1).max(40), metodoPago: texto(60), referencia: texto(200),
  entidadId: texto(200), entidadNombre: texto(300), monto, observaciones: texto(2000), pdfUrl: texto(2000), pdfNombre: texto(300),
  aplicacion: z.array(facturaAplicada).min(1).max(400),
}), async (d, uid) => {
  const db = getFirestore();
  const creadoPor = await nombreUsuario(db, uid);
  return db.runTransaction(async (tx) => {
    const pagoRef = db.collection('pagos').doc(d.pagoId);
    const ids = Array.from(new Set(d.aplicacion.map((a) => a.facturaId)));
    const [pago, facturas] = await Promise.all([tx.get(pagoRef), leerFacturasDePago(db, tx, d.tipo, ids)]);
    // Idempotencia: un reintento tras un corte de red no aplica el pago dos veces.
    if (pago.exists) return { ok: true, yaExistia: true, facturas: {}, operaciones: {} };
    const plan = planRegistrarPago({ ...d, creadoEn: new Date().toISOString(), creadoPor }, d.pagoId, facturas);
    ejecutarPlan(db, tx, plan);
    return respuesta(plan, { pagoId: d.pagoId });
  });
});

export const editarPago = callable(z.object({
  pagoId: id, fecha: z.string().min(1).max(40), numeroPago: z.string().trim().min(1).max(120), referencia: texto(200), metodoPago: texto(60),
  observaciones: texto(2000), pdfUrl: texto(2000), pdfNombre: texto(300), agregadas: z.array(facturaAplicada).max(400).default([]),
}), async (d, uid) => {
  const db = getFirestore();
  const editadoPor = await nombreUsuario(db, uid);
  return db.runTransaction(async (tx) => {
    const [pago] = await leer(tx, [db.collection('pagos').doc(d.pagoId)]);
    if (!pago) throw new ErrorDinero(`El pago ${d.numeroPago} ya no existe (otro usuario lo eliminó). No se guardó nada.`);
    const tipo = String(pago.datos.tipo) as 'cliente' | 'proveedor' | 'mtto';
    const facturas = await leerFacturasDePago(db, tx, tipo, Array.from(new Set(d.agregadas.map((a) => a.facturaId))));
    const plan = planEditarPago(pago, { ...d, editadoEn: new Date().toISOString(), editadoPor }, facturas);
    ejecutarPlan(db, tx, plan);
    const escrituraPago = plan.escrituras.find((e) => e.coleccion === 'pagos' && e.id === pago.id);
    const datosPago = escrituraPago && escrituraPago.tipo !== 'borrar' ? escrituraPago.datos : {};
    return respuesta(plan, { pago: { ...pago.datos, ...datosPago, id: pago.id } });
  });
});

export const eliminarPago = callable(z.object({ pagoId: id }), async (d) => {
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const [pago] = await leer(tx, [db.collection('pagos').doc(d.pagoId)]);
    if (!pago) throw new ErrorDinero('El pago ya no existe (otro usuario lo eliminó).');
    const tipo = String(pago.datos.tipo) as 'cliente' | 'proveedor' | 'mtto';
    const ids = Array.isArray(pago.datos.facturas) ? Array.from(new Set((pago.datos.facturas as Datos[]).map((f) => String(f?.facturaId ?? '')).filter(Boolean))) : [];
    const facturas = await leerFacturasDePago(db, tx, tipo, ids);
    const plan = planEliminarPago(pago, facturas);
    ejecutarPlan(db, tx, plan);
    return respuesta(plan);
  });
});

/**
 * Cloud Function: portalCliente  (✅ V00435 — app móvil de clientes)
 * ------------------------------------------------------------------------------
 * Única puerta de datos del CLIENTE en la app móvil.
 *
 * ▶ POR QUÉ UNA FUNCIÓN Y NO LECTURAS DIRECTAS:
 *   Firestore no puede ocultar CAMPOS: quien puede leer un documento de
 *   `operaciones` ve TODO (costo del proveedor, sueldo del operador, utilidad).
 *   Por eso el cliente NO lee colecciones: esta función, con el Admin SDK,
 *   arma una respuesta con SOLO los campos que el cliente debe ver.
 *   Las reglas de Firestore niegan al usuario cliente cualquier otra lectura.
 *
 * ▶ QUIÉN ES CLIENTE:
 *   usuarios/{uid}.tipoUsuario === 'cliente' y usuarios/{uid}.empresasClienteIds
 *   (ids de `empresas`). Se configura en el módulo Usuarios de la web.
 *   Un Admin puede llamar la función con { empresaId } para ver lo que vería
 *   esa empresa (vista previa).
 *
 * ▶ ACCIONES:
 *   { accion: 'resumen' }               → operaciones en proceso y recientes,
 *                                         facturas por pagar, pagos, totales.
 *   { accion: 'operacion', opId }       → detalle + bitácora de status +
 *                                         trayecto GPS (rastreo_operaciones).
 *
 * ▶ ÍNDICES (opcionales, aceleran y abaratan): ver firestore.indexes.json de la
 *   entrega. Sin ellos la función usa la consulta simple por cliente y filtra
 *   en memoria (funciona igual, lee más documentos).
 *
 * Deploy: firebase deploy --only functions:portalCliente
 * ------------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp();
const db = getFirestore();

const FN_VERSION = 'portal-v1';

// Mismos ids que la web (OperacionesDashboard / Facturación).
const STATUS_FINALES = ['c2d57403', 'f557b751', '7607f692'];
const STATUS_CANCELADO = '7607f692';
const DIAS_RECIENTES = 60;
const MESES_PAGOS = 12;
const MAX_EMPRESAS = 10;
const MAX_PUNTOS_RUTA = 1500;

// ───────────────────────── Contrato de respuesta ─────────────────────────
// (La app móvil tiene una copia en src/features/cliente/tipos.ts — mantener iguales.)
type Moneda = 'USD' | 'MXN' | '';

export interface UbicacionPortal { lat: number; lng: number; t: number; velocidad: number | null }

export interface OperacionPortal {
  id: string;
  ref: string;
  refCliente: string;
  fechaServicio: string;
  status: string;
  etapa: 'enProceso' | 'completada' | 'cancelada';
  tipoServicio: string;
  trafico: string;
  carga: string;
  origen: string;
  destino: string;
  aduana: string;
  remolque: string;
  papel: 'paga' | 'mercancia' | 'ambos';
  empresaId: string;
  rastreo: { activo: boolean; ultima: UbicacionPortal | null; actualizadoEn: string } | null;
}

export interface OperacionPortalDetalle extends OperacionPortal {
  clientePaga: string;
  clienteMercancia: string;
  descripcionMercancia: string;
  cantidad: string;
  embalaje: string;
  pesoKg: string;
  unidad: string;
}

export interface FacturaPortal {
  id: string;
  invoice: string;
  fecha: string;
  vence: string;
  moneda: Moneda;
  total: number;
  pagado: number;
  saldo: number;
  estado: 'pagada' | 'parcial' | 'pendiente' | 'vencida';
  operaciones: string[];
  documentoUrl: string;
  empresaId: string;
}

export interface PagoPortal {
  id: string;
  numero: string;
  fecha: string;
  metodo: string;
  referencia: string;
  monto: number;
  moneda: Moneda;
  facturas: { invoice: string; aplicado: number }[];
  comprobanteUrl: string;
  empresaId: string;
}

export interface TotalesMoneda { porPagar: number; vencido: number; pagado: number }

export interface ResumenPortal {
  version: string;
  generadoEn: string;
  empresas: { id: string; nombre: string; diasCredito: number }[];
  operaciones: OperacionPortal[];
  facturasPendientes: FacturaPortal[];
  facturasPagadas: FacturaPortal[];
  pagos: PagoPortal[];
  totales: { USD: TotalesMoneda; MXN: TotalesMoneda };
}

export interface DetallePortal {
  version: string;
  operacion: OperacionPortalDetalle;
  bitacora: { id: string; status: string; fechaHora: string }[];
  ruta: { activo: boolean; puntos: UbicacionPortal[]; ultima: UbicacionPortal | null; actualizadoEn: string } | null;
}

// ───────────────────────── Utilidades ─────────────────────────
type Doc = Record<string, unknown>;

const txt = (...vals: unknown[]): string => {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number): number => Math.round(n * 100) / 100;
const norm = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoDia = (d: Date): string => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const haceDias = (dias: number): string => isoDia(new Date(Date.now() - dias * 86400000));

/** "YYYY-MM-DD" desde ISO o d/m/aaaa (operaciones migradas de AppSheet). */
const fechaISO = (v: unknown): string => {
  const t = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};
const sumarDias = (iso: string, dias: number): string => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return isoDia(d);
};

const monedaCanonica = (v: unknown): Moneda => {
  const t = norm(v);
  if (!t) return '';
  if (t === '7dca62b3' || t === 'usd' || t === 'us$' || t === 'dls' || t.startsWith('dolar')) return 'USD';
  if (t === 'f95d8894' || t === 'mxn' || t === 'mn' || t.startsWith('peso')) return 'MXN';
  return '';
};

const esPrueba = (op: Doc): boolean => op.esPrueba === true || String(op.ref ?? '').trim().toUpperCase().startsWith('PR.');

const esCodigo = (e: unknown, codigo: number, texto: string): boolean => {
  const c = (e as { code?: unknown })?.code;
  return c === codigo || String(c ?? '').toLowerCase().includes(texto);
};

/** Consulta con índice compuesto; si falta el índice, usa la simple y filtra en memoria. */
const consultarConRespaldo = async (
  optimizada: () => Query,
  simple: () => Query,
  filtro: (d: Doc) => boolean,
  etiqueta: string,
): Promise<QueryDocumentSnapshot[]> => {
  try {
    return (await optimizada().get()).docs;
  } catch (e) {
    if (!esCodigo(e, 9, 'failed_precondition') && !esCodigo(e, 9, 'failed-precondition')) throw e;
    logger.warn(`[portalCliente] Falta índice para ${etiqueta}; se usa la consulta simple.`, { error: String((e as Error).message || e) });
    return (await simple().get()).docs.filter((d) => filtro(d.data()));
  }
};

// Solo los campos que se leen (menos datos en tránsito; el costo por documento es el mismo).
const CAMPOS_OP = [
  'ref', 'refCliente', 'fechaServicio', 'status', 'statusNombre', 'tipoOperacionNombre', 'trafico', 'carga',
  'origenNombre', 'destinoNombre', 'aduanaNombre', 'numeroRemolqueNombre', 'remolqueNombre', 'numeroRemolque',
  'clientePaga', 'clienteMercancia', 'esPrueba', 'operador',
];

const etapaDe = (op: Doc): OperacionPortal['etapa'] => {
  const id = String(op.status ?? '');
  const n = norm(op.statusNombre);
  if (id === STATUS_CANCELADO || n.includes('cancel')) return 'cancelada';
  if (STATUS_FINALES.includes(id) || n.includes('completad') || n.includes('falso')) return 'completada';
  return 'enProceso';
};

const aUbicacion = (u: unknown): UbicacionPortal | null => {
  const x = u as Doc | null | undefined;
  if (!x || !Number.isFinite(Number(x.lat)) || !Number.isFinite(Number(x.lng))) return null;
  return { lat: Number(x.lat), lng: Number(x.lng), t: num(x.t), velocidad: x.velocidad === null || x.velocidad === undefined ? null : num(x.velocidad) };
};

/**
 * El rastreo se muestra "en vivo" SOLO si la operación sigue en proceso y lo
 * registra el operador que la tiene asignada (si tráfico la reasignó o ya
 * terminó, el cliente no debe ver la ubicación de nadie en tiempo real).
 */
const rastreoVisible = (op: Doc, rastreo: Doc | undefined): boolean =>
  !!rastreo && etapaDe(op) === 'enProceso' && (!rastreo.operadorId || String(rastreo.operadorId) === String(op.operador ?? ''));

const aOperacion = (id: string, op: Doc, empresas: string[], rastreo: Doc | undefined): OperacionPortal => {
  const paga = empresas.includes(String(op.clientePaga ?? ''));
  const merc = empresas.includes(String(op.clienteMercancia ?? ''));
  const vivo = rastreoVisible(op, rastreo);
  return {
    id,
    ref: txt(op.ref, id),
    refCliente: txt(op.refCliente),
    fechaServicio: txt(op.fechaServicio),
    status: txt(op.statusNombre, 'Sin status'),
    etapa: etapaDe(op),
    tipoServicio: txt(op.tipoOperacionNombre),
    trafico: txt(op.trafico),
    carga: txt(op.carga),
    origen: txt(op.origenNombre),
    destino: txt(op.destinoNombre),
    aduana: txt(op.aduanaNombre),
    remolque: txt(op.numeroRemolqueNombre, op.remolqueNombre, op.numeroRemolque),
    papel: paga && merc ? 'ambos' : paga ? 'paga' : 'mercancia',
    empresaId: paga ? String(op.clientePaga) : String(op.clienteMercancia ?? ''),
    rastreo: vivo && rastreo
      ? { activo: rastreo.activo === true, ultima: aUbicacion(rastreo.ultimaUbicacion), actualizadoEn: txt(rastreo.actualizadoEn) }
      : null,
  };
};

/** Total de la factura en SU moneda — espejo de totalNativoFactura (FacturacionClientesDashboard). */
const totalNativoFactura = (f: Doc): number => {
  const mon = monedaCanonica(f.monedaFacturacion ?? f.monedaProveedor ?? f.moneda ?? f.monedaId);
  const directo = Number(f.subtotalMonedaFactura);
  if (Number.isFinite(directo) && directo > 0) return directo;
  const ops = Array.isArray(f.operacionesGuardadas) ? (f.operacionesGuardadas as Doc[]) : [];
  const suma = (campo: string) => ops.reduce((s, o) => s + num(o?.[campo]), 0);
  if (ops.length > 0) {
    if (mon === 'USD') {
      if (suma('dol') > 0) return suma('dol');
      if (suma('subtotalBase') > 0) return suma('subtotalBase');
    } else if (mon === 'MXN') {
      if (suma('monto') > 0) return suma('monto');
      if (suma('pes') > 0) return suma('pes');
      if (suma('subtotalBase') > 0) return suma('subtotalBase');
    } else if (suma('subtotalBase') > 0) {
      return suma('subtotalBase');
    }
  }
  return num(f.subtotalFactura) || num(f.total) || num(f.montoFactura);
};

// ───────────────────────── Autorización ─────────────────────────
const empresasDelUsuario = async (uid: string, empresaIdPedida: unknown): Promise<string[]> => {
  const snap = await db.doc(`usuarios/${uid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Tu usuario no tiene perfil en Roelca.');
  const u = snap.data() as Doc;
  if (u.activo === false) throw new HttpsError('permission-denied', 'Tu acceso está desactivado.');

  if (norm(u.tipoUsuario) === 'cliente') {
    const ids = lista(u.empresasClienteIds).slice(0, MAX_EMPRESAS);
    if (ids.length === 0) throw new HttpsError('failed-precondition', 'Tu usuario aún no está ligado a una empresa.');
    return ids;
  }
  // Vista previa para Admin (personal de Roelca).
  const esAdmin = u.esAdmin === true || lista(u.roles).some((r) => r.toUpperCase() === 'ADMIN');
  const pedida = String(empresaIdPedida ?? '').trim();
  if (esAdmin && pedida) return [pedida];
  throw new HttpsError('permission-denied', 'Este acceso es solo para clientes de Roelca.');
};

// ───────────────────────── Acciones ─────────────────────────
const resumen = async (empresas: string[]): Promise<ResumenPortal> => {
  const empDocs = await db.getAll(...empresas.map((id) => db.doc(`empresas/${id}`)));
  const infoEmpresas = empDocs.map((d) => {
    const x = (d.data() ?? {}) as Doc;
    return {
      id: d.id,
      nombre: txt(x.razonSocial, x.nombre, d.id),
      diasCredito: num(x.diasCredito ?? x.credito ?? x.diasDeCredito ?? x.creditoDias),
    };
  });

  // ── Operaciones: en proceso (cualquier fecha) + recientes ──
  const hace = haceDias(DIAS_RECIENTES);
  const consultasOps = empresas.flatMap((E) =>
    (['clientePaga', 'clienteMercancia'] as const).flatMap((campo) => [
      consultarConRespaldo(
        () => db.collection('operaciones').where(campo, '==', E).where('status', 'not-in', STATUS_FINALES).select(...CAMPOS_OP),
        () => db.collection('operaciones').where(campo, '==', E).select(...CAMPOS_OP),
        (op) => !STATUS_FINALES.includes(String(op.status ?? '')),
        `operaciones(${campo}, status)`,
      ),
      consultarConRespaldo(
        () => db.collection('operaciones').where(campo, '==', E).where('fechaServicio', '>=', hace).select(...CAMPOS_OP),
        () => db.collection('operaciones').where(campo, '==', E).select(...CAMPOS_OP),
        (op) => fechaISO(op.fechaServicio) >= hace,
        `operaciones(${campo}, fechaServicio)`,
      ),
    ]),
  );
  const opsMap = new Map<string, Doc>();
  (await Promise.all(consultasOps)).flat().forEach((d) => {
    const x = d.data();
    if (esPrueba(x)) return;
    // Mismo criterio con o sin índice: en proceso (cualquier fecha) o de los últimos días.
    // (Con índice, "fechaServicio >= aaaa-mm-dd" compara TEXTO y dejaría pasar d/m/aaaa viejas.)
    if (etapaDe(x) !== 'enProceso' && fechaISO(x.fechaServicio) < hace) return;
    opsMap.set(d.id, x);
  });

  const enProcesoIds = [...opsMap.entries()].filter(([, op]) => etapaDe(op) === 'enProceso').map(([id]) => id);
  const rastreos = new Map<string, Doc>();
  if (enProcesoIds.length > 0) {
    const snaps = await db.getAll(...enProcesoIds.slice(0, 300).map((id) => db.doc(`rastreo_operaciones/${id}`)));
    snaps.forEach((s) => s.exists && rastreos.set(s.id, s.data() as Doc));
  }
  const operaciones = [...opsMap.entries()]
    .map(([id, op]) => aOperacion(id, op, empresas, rastreos.get(id)))
    .sort((a, b) => (a.etapa === b.etapa ? fechaISO(b.fechaServicio).localeCompare(fechaISO(a.fechaServicio)) : a.etapa === 'enProceso' ? -1 : 1));

  // ── Facturas: SOLO por clienteId. A propósito NO se usa el respaldo por nombre
  //    del auditor web: hay empresas homónimas y el cliente podría ver facturas
  //    ajenas. Las facturas viejas sin clienteId se corrigen con
  //    "⇄ Sincronizar con Empresas" en Facturación. ──
  const factMap = new Map<string, Doc>();
  (await db.collection('facturas_clientes').where('clienteId', 'in', empresas).get()).docs.forEach((d) => factMap.set(d.id, d.data()));
  const hoy = isoDia(new Date());
  const credito = new Map(infoEmpresas.map((e) => [e.id, e.diasCredito]));
  const facturas: FacturaPortal[] = [...factMap.entries()]
    .filter(([, f]) => {
      const st = norm(f.statusFactura);
      return !st.includes('cancel') && st !== 'no facturado';
    })
    .map(([id, f]) => {
      const total = r2(totalNativoFactura(f));
      const pagado = r2(num(f.montoPagado));
      const saldo = r2(f.saldoPendiente !== undefined && f.saldoPendiente !== null ? num(f.saldoPendiente) : total - pagado);
      const fecha = fechaISO(f.fecha ?? f.fechaFactura);
      const empresaId = String(f.clienteId ?? '');
      const vence = fecha ? sumarDias(fecha, credito.get(empresaId) ?? 0) : '';
      const pagada = saldo <= 0.009 || String(f.statusPago ?? '').toUpperCase() === 'PAGADA';
      const estado: FacturaPortal['estado'] = pagada ? 'pagada' : vence && vence < hoy ? 'vencida' : pagado > 0.009 ? 'parcial' : 'pendiente';
      return {
        id,
        invoice: txt(f.invoice, f.numeroInvoice, f.folio, id),
        fecha,
        vence,
        moneda: monedaCanonica(f.monedaFacturacion ?? f.moneda ?? f.monedaId),
        total,
        pagado,
        saldo: pagada ? 0 : saldo,
        estado,
        operaciones: lista(f.operaciones).slice(0, 50),
        documentoUrl: txt(f.docFacturaUrl),
        empresaId,
      };
    });
  const facturasPendientes = facturas.filter((f) => f.estado !== 'pagada').sort((a, b) => (a.vence || a.fecha).localeCompare(b.vence || b.fecha));
  const desdePagos = haceDias(MESES_PAGOS * 31);
  const facturasPagadas = facturas
    .filter((f) => f.estado === 'pagada' && (!f.fecha || f.fecha >= desdePagos))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 200);

  // ── Pagos (la empresa se guarda como entidadId en unos y clienteId en otros) ──
  const pagosMap = new Map<string, Doc>();
  const [porEntidad, porCliente] = await Promise.all([
    db.collection('pagos').where('entidadId', 'in', empresas).get(),
    db.collection('pagos').where('clienteId', 'in', empresas).get(),
  ]);
  [...porEntidad.docs, ...porCliente.docs].forEach((d) => {
    const x = d.data();
    if (norm(x.tipo) === 'cliente' || (!x.tipo && x.clienteId)) pagosMap.set(d.id, x);
  });
  const pagos: PagoPortal[] = [...pagosMap.entries()]
    .map(([id, p]) => ({
      id,
      numero: txt(p.numeroPago, id),
      fecha: fechaISO(p.fecha),
      metodo: txt(p.metodoPago),
      referencia: txt(p.referencia),
      monto: r2(num(p.monto)),
      moneda: monedaCanonica(p.moneda),
      facturas: (Array.isArray(p.facturas) ? (p.facturas as Doc[]) : [])
        .filter((fa) => num(fa?.aplicado) > 0)
        .map((fa) => ({ invoice: txt(fa.invoice, fa.facturaId), aplicado: r2(num(fa.aplicado)) })),
      comprobanteUrl: txt(p.pdfUrl),
      empresaId: txt(p.entidadId, p.clienteId),
    }))
    .filter((p) => !p.fecha || p.fecha >= desdePagos)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 300);

  // ── Totales por moneda ──
  const totales = { USD: { porPagar: 0, vencido: 0, pagado: 0 }, MXN: { porPagar: 0, vencido: 0, pagado: 0 } };
  facturasPendientes.forEach((f) => {
    if (!f.moneda) return;
    totales[f.moneda].porPagar = r2(totales[f.moneda].porPagar + f.saldo);
    if (f.estado === 'vencida') totales[f.moneda].vencido = r2(totales[f.moneda].vencido + f.saldo);
  });
  pagos.forEach((p) => {
    if (p.moneda) totales[p.moneda].pagado = r2(totales[p.moneda].pagado + p.monto);
  });

  return {
    version: FN_VERSION,
    generadoEn: new Date().toISOString(),
    empresas: infoEmpresas.map(({ id, nombre, diasCredito }) => ({ id, nombre, diasCredito })),
    operaciones,
    facturasPendientes,
    facturasPagadas,
    pagos,
    totales,
  };
};

/** Reduce una ruta larga a `max` puntos conservando el primero y el último. */
const reducir = <T>(puntos: T[], max: number): T[] => {
  if (puntos.length <= max) return puntos;
  const paso = (puntos.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => puntos[Math.round(i * paso)]);
};

const detalle = async (empresas: string[], opId: string): Promise<DetallePortal> => {
  if (!opId || opId.includes('/') || opId.length > 200) throw new HttpsError('invalid-argument', 'Operación inválida.');
  const snap = await db.doc(`operaciones/${opId}`).get();
  const op = (snap.data() ?? {}) as Doc;
  const suya = empresas.includes(String(op.clientePaga ?? '')) || empresas.includes(String(op.clienteMercancia ?? ''));
  // Mismo mensaje si no existe o no es suya (no se revela qué existe).
  if (!snap.exists || !suya || esPrueba(op)) throw new HttpsError('not-found', 'No encontramos esa operación.');

  const [horariosSnap, rastreoSnap, tramosSnap] = await Promise.all([
    db.collection('horarios').where('operacionId', '==', opId).get(),
    db.doc(`rastreo_operaciones/${opId}`).get(),
    db.collection(`rastreo_operaciones/${opId}/puntos`).orderBy('desde').get(),
  ]);
  const rastreo = rastreoSnap.exists ? (rastreoSnap.data() as Doc) : undefined;

  const base = aOperacion(opId, op, empresas, rastreo);
  const operacion: OperacionPortalDetalle = {
    ...base,
    clientePaga: txt(op.clientePagaNombre, op.clienteNombre),
    clienteMercancia: txt(op.clienteMercanciaNombre),
    descripcionMercancia: txt(op.descripcionMercancia),
    cantidad: txt(op.cantidad),
    embalaje: txt(op.embalajeNombre),
    pesoKg: txt(op.pesoKg),
    unidad: txt(op.unidadNombre),
  };

  const horariosOrdenados = horariosSnap.docs
    .map((d) => {
      const h = d.data();
      return { id: d.id, status: txt(h.statusNombre, h.status), fechaHora: txt(h.fechaHora), orden: txt(h.registradoEn, h.fechaHora) };
    })
    .sort((a, b) => a.orden.localeCompare(b.orden));
  const bitacora = horariosOrdenados.map(({ id, status, fechaHora }) => ({ id, status, fechaHora }));

  // Operación terminada: el trayecto se corta en su último registro de status
  // (+10 min), para no mostrar movimientos del operador posteriores al servicio.
  const vivo = rastreoVisible(op, rastreo);
  const ultimoRegistro = Date.parse(horariosOrdenados[horariosOrdenados.length - 1]?.orden ?? '');
  const corte = !vivo && Number.isFinite(ultimoRegistro) ? ultimoRegistro + 10 * 60 * 1000 : Infinity;

  const puntos: UbicacionPortal[] = [];
  tramosSnap.docs.forEach((d) => {
    const pts = (d.data().pts ?? []) as Doc[];
    pts.forEach((p) => {
      if (Number.isFinite(Number(p.la)) && Number.isFinite(Number(p.lo)) && num(p.t) <= corte) {
        puntos.push({ lat: Number(p.la), lng: Number(p.lo), t: num(p.t), velocidad: p.v === null || p.v === undefined ? null : num(p.v) });
      }
    });
  });
  puntos.sort((a, b) => a.t - b.t);

  return {
    version: FN_VERSION,
    operacion,
    bitacora,
    ruta:
      puntos.length > 0 || (vivo && rastreo)
        ? {
            activo: vivo && rastreo?.activo === true,
            puntos: reducir(puntos, MAX_PUNTOS_RUTA),
            ultima: (vivo ? aUbicacion(rastreo?.ultimaUbicacion) : null) ?? puntos[puntos.length - 1] ?? null,
            actualizadoEn: vivo ? txt(rastreo?.actualizadoEn) : '',
          }
        : null,
  };
};

// Caché corta por instancia: la app refresca en intervalos y varias pantallas
// pueden pedir lo mismo casi al mismo tiempo; así no se relee toda la historia.
const CACHE_MS = 15 * 1000;
const cache = new Map<string, { ts: number; valor: unknown }>();
const desdeCache = <T>(clave: string, calcular: () => Promise<T>): Promise<T> => {
  const hit = cache.get(clave);
  if (hit && Date.now() - hit.ts < CACHE_MS) return Promise.resolve(hit.valor as T);
  return calcular().then((valor) => {
    if (cache.size > 500) cache.clear();
    cache.set(clave, { ts: Date.now(), valor });
    return valor;
  });
};

export const portalCliente = onCall({ region: 'us-central1', memory: '512MiB', timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar.');
  const datos = (request.data ?? {}) as Doc;
  const accion = String(datos.accion ?? 'resumen');
  try {
    // La autorización se revisa SIEMPRE (no se cachea): un acceso revocado se corta al momento.
    const empresas = await empresasDelUsuario(uid, datos.empresaId);
    const base = `${empresas.join(',')}|${accion}`;
    if (accion === 'resumen') return await desdeCache(base, () => resumen(empresas));
    if (accion === 'operacion') {
      const opId = String(datos.opId ?? '');
      return await desdeCache(`${base}|${opId}`, () => detalle(empresas, opId));
    }
    throw new HttpsError('invalid-argument', `Acción desconocida: ${accion}`);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error('[portalCliente] Error', { uid, accion, error: String((e as Error)?.message || e) });
    throw new HttpsError('internal', 'No se pudo cargar tu información. Intenta de nuevo.');
  }
});

/**
 * Cloud Functions: MOTOR RELACIONAL de Roelca  (✅ V00266 — Fase 1)
 * ------------------------------------------------------------------------------
 * Firestore no es relacional: no tiene llaves foráneas ni cascadas. Este módulo
 * las EMULA en el servidor, como los ON UPDATE CASCADE de SQL:
 *
 *   1) empresaActualizada        — renombras una empresa y su nombre se propaga
 *                                  SOLO a facturas, operaciones y tarifarios.
 *   2) operacionEscrita          — toda operación guardada (nueva, editada o
 *                                  importada) queda íntegra al instante: su
 *                                  Cargada/Vacía, Aduana y Expo/Impo se derivan
 *                                  del convenio contra los catálogos (regla
 *                                  "EL CONVENIO MANDA" del V00258), sin botón.
 *   3) catalogoCVRenombrado /
 *      catalogoAduanaRenombrada  — renombras un rubro del catálogo y todas las
 *                                  operaciones que lo usaban se actualizan.
 *   4) verificarIntegridad       — (callable) recorre la base y REPORTA
 *                                  referencias rotas: el equivalente casero de
 *                                  los constraints de SQL — no previene, pero
 *                                  detecta en minutos lo que antes tardaba meses.
 *
 * Los botones del cliente (⇊ Normalizar, ⇄ Sincronizar) SIGUEN funcionando como
 * respaldo manual masivo; estos triggers mantienen la integridad al día
 * documento por documento, corran o no esos botones.
 *
 * Anti-bucles: cada trigger escribe SOLO si el valor difiere. La escritura del
 * trigger dispara un segundo evento cuyo cálculo ya no difiere → no escribe →
 * la cadena se detiene sola.
 *
 * Deploy: firebase deploy --only functions
 * ------------------------------------------------------------------------------
 */

import { onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp();
const dbRel = getFirestore();

const REL_VERSION = 'relacional-v1.3'; // ✅ V00299: + sync INVERSA detalle→línea del tarifario

/** Normaliza: sin acentos, espacios colapsados, minúsculas (misma regla del cliente V00257). */
const normR = (t: unknown): string =>
  String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Alias legados en descripciones viejas → nombre del catálogo (V00257). */
const ALIAS_CV: Record<string, string> = { cargada: 'cargado', vacia: 'vacio' };
const claveCV = (seg: string): string => ALIAS_CV[seg] || seg;

// ─────────────────────────────────────────────────────────────────────────────
// Caché de catálogos en memoria del contenedor (5 min): los triggers de
// operaciones se disparan seguido y los catálogos casi no cambian.
// ─────────────────────────────────────────────────────────────────────────────
type MapaCatalogo = { porId: Map<string, string>; porNorm: Map<string, string> };
const cacheCatalogos: Record<string, { data: MapaCatalogo; ts: number }> = {};
const TTL_CATALOGO_MS = 5 * 60 * 1000;

const cargarCatalogoR = async (coleccion: string, campos: string[]): Promise<MapaCatalogo> => {
  const hit = cacheCatalogos[coleccion];
  if (hit && Date.now() - hit.ts < TTL_CATALOGO_MS) return hit.data;
  const porId = new Map<string, string>();
  const porNorm = new Map<string, string>();
  const snap = await dbRel.collection(coleccion).get();
  snap.docs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    let nombre = '';
    for (const c of campos) { const v = String(x[c] || '').trim(); if (v) { nombre = v; break; } }
    if (!nombre) return;
    porId.set(d.id, nombre);
    porNorm.set(normR(nombre), nombre);
  });
  const data = { porId, porNorm };
  cacheCatalogos[coleccion] = { data, ts: Date.now() };
  return data;
};

/** Invalida el caché (los triggers de renombre lo llaman). */
const invalidarCatalogoR = (coleccion: string): void => { delete cacheCatalogos[coleccion]; };

// ─────────────────────────────────────────────────────────────────────────────
// 1) EMPRESA ACTUALIZADA → el nombre se propaga a todo lo que la referencia.
//    (La MONEDA de emisión de las facturas NO se toca: regla V00265.)
// ─────────────────────────────────────────────────────────────────────────────
const OBJETIVOS_NOMBRE_EMPRESA: { coleccion: string; campoId: string; campoNombre: string }[] = [
  { coleccion: 'facturas_clientes',    campoId: 'clienteId',       campoNombre: 'clienteNombre' },
  { coleccion: 'facturas_proveedores', campoId: 'proveedorId',     campoNombre: 'proveedorNombre' },
  { coleccion: 'operaciones',          campoId: 'clientePaga',     campoNombre: 'clientePagaNombre' },
  { coleccion: 'operaciones',          campoId: 'proveedorUnidad', campoNombre: 'proveedorUnidadNombre' },
  { coleccion: 'tarifario_clientes',   campoId: 'clienteId',       campoNombre: 'clienteNombre' },
  { coleccion: 'tarifario_proveedores', campoId: 'proveedorId',    campoNombre: 'proveedorNombre' },
];

export const empresaActualizada = onDocumentUpdated({ document: 'empresas/{empresaId}', region: 'us-central1' }, async (event) => {
  const antes = event.data?.before.data() as Record<string, unknown> | undefined;
  const despues = event.data?.after.data() as Record<string, unknown> | undefined;
  if (!antes || !despues) return;

  const nombreAntes = String(antes.nombre || '').trim();
  const nombreDespues = String(despues.nombre || '').trim();
  if (!nombreDespues || nombreAntes === nombreDespues) return; // solo nos importa el renombre

  const empresaId = event.params.empresaId;
  let total = 0;
  for (const obj of OBJETIVOS_NOMBRE_EMPRESA) {
    try {
      const snap = await dbRel.collection(obj.coleccion).where(obj.campoId, '==', empresaId).get();
      let lote = dbRel.batch();
      let enLote = 0;
      for (const d of snap.docs) {
        const actual = String((d.data() as Record<string, unknown>)[obj.campoNombre] || '');
        if (actual === nombreDespues) continue; // anti-bucle: ya está bien
        lote.update(d.ref, { [obj.campoNombre]: nombreDespues });
        total += 1; enLote += 1;
        if (enLote >= 400) { await lote.commit(); lote = dbRel.batch(); enLote = 0; }
      }
      if (enLote > 0) await lote.commit();
    } catch (e) {
      logger.error(`[${REL_VERSION}] empresaActualizada: fallo propagando a ${obj.coleccion}`, e);
    }
  }
  logger.info(`[${REL_VERSION}] empresaActualizada: "${nombreAntes}" → "${nombreDespues}" propagado a ${total} documento(s).`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) OPERACIÓN ESCRITA → C/V, Aduana y Expo/Impo derivados del convenio.
//    (Port server-side del botón "⇊ Normalizar operaciones", por documento.)
// ─────────────────────────────────────────────────────────────────────────────
const derivarDesdeConvenio = async (x: Record<string, unknown>): Promise<Record<string, string>> => {
  const cambios: Record<string, string> = {};
  const conv = String(x.convenioNombre || '').trim();
  const segmentos = conv.split(' - ').map((s) => normR(s)).filter(Boolean);

  const [catCV, catAdu] = await Promise.all([
    cargarCatalogoR('catalogo_carga_vacia', ['nombre', 'estado_carga']),
    cargarCatalogoR('catalogo_aduanas', ['aduana', 'nombre']),
  ]);

  // C/V — EL CONVENIO MANDA (V00258); el campo directo es respaldo.
  let cvFinal = '';
  for (let i = segmentos.length - 1; i >= 0; i--) {
    const m = catCV.porNorm.get(claveCV(segmentos[i]));
    if (m) { cvFinal = m; break; }
  }
  if (!cvFinal) {
    const bruto = String(x.carga || x.estadoCarga || x.cargaVacia || x.cargadoVacio || '').trim();
    if (bruto && normR(bruto) !== 'n/a') cvFinal = catCV.porId.get(bruto) || catCV.porNorm.get(claveCV(normR(bruto))) || '';
  }
  if (cvFinal && String(x.carga || '') !== cvFinal) cambios.carga = cvFinal;

  // Aduana — igual: convenio primero.
  let aduFinal = '';
  for (let i = segmentos.length - 1; i >= 0; i--) {
    const m = catAdu.porNorm.get(segmentos[i]);
    if (m) { aduFinal = m; break; }
  }
  if (!aduFinal) {
    const bruto = String(x.aduanaNombre || x.aduana || x.aduanaId || '').trim();
    if (bruto) aduFinal = catAdu.porId.get(bruto) || catAdu.porNorm.get(normR(bruto)) || '';
  }
  if (aduFinal && String(x.aduanaNombre || '') !== aduFinal) cambios.aduanaNombre = aduFinal;

  // Expo/Impo — SOLO si la operación no trae uno válido (nunca se sobreescribe).
  const trafNorm = normR(String(x.trafico || ''));
  const trafValido = trafNorm.includes('export') || trafNorm.includes('import') || trafNorm.includes('movimiento');
  if (!trafValido) {
    const texto = normR(`${conv} ${x.tipoOperacionNombre || x.tipoServicioNombre || x.tipoServicio || ''}`);
    const trafFinal = texto.includes('export') ? 'Exportación' : texto.includes('import') ? 'Importación' : texto.includes('movimiento') ? 'Movimiento' : '';
    if (trafFinal) cambios.trafico = trafFinal;
  }
  return cambios;
};

export const operacionEscrita = onDocumentWritten({ document: 'operaciones/{opId}', region: 'us-central1' }, async (event) => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return; // borrado: nada que normalizar
  const x = despues.data() as Record<string, unknown>;
  try {
    const cambios = await derivarDesdeConvenio(x);
    if (Object.keys(cambios).length === 0) return; // anti-bucle: ya está íntegra
    await despues.ref.update(cambios);
    logger.info(`[${REL_VERSION}] operacionEscrita: ${String(x.ref || event.params.opId)} normalizada`, cambios);
  } catch (e) {
    logger.error(`[${REL_VERSION}] operacionEscrita: fallo en ${event.params.opId}`, e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) CATÁLOGO RENOMBRADO → las operaciones que usaban el nombre viejo se
//    actualizan al nuevo (C/V y Aduanas).
// ─────────────────────────────────────────────────────────────────────────────
const propagarRenombreCatalogo = async (
  campoOperacion: 'carga' | 'aduanaNombre', nombreAntes: string, nombreDespues: string,
): Promise<number> => {
  if (!nombreAntes || !nombreDespues || nombreAntes === nombreDespues) return 0;
  const snap = await dbRel.collection('operaciones').where(campoOperacion, '==', nombreAntes).get();
  let lote = dbRel.batch();
  let enLote = 0; let n = 0;
  for (const d of snap.docs) {
    lote.update(d.ref, { [campoOperacion]: nombreDespues });
    n += 1; enLote += 1;
    if (enLote >= 400) { await lote.commit(); lote = dbRel.batch(); enLote = 0; }
  }
  if (enLote > 0) await lote.commit();
  return n;
};

export const catalogoCVRenombrado = onDocumentUpdated({ document: 'catalogo_carga_vacia/{id}', region: 'us-central1' }, async (event) => {
  invalidarCatalogoR('catalogo_carga_vacia');
  const antes = String((event.data?.before.data() as Record<string, unknown> | undefined)?.nombre || '').trim();
  const despues = String((event.data?.after.data() as Record<string, unknown> | undefined)?.nombre || '').trim();
  const n = await propagarRenombreCatalogo('carga', antes, despues);
  if (n) logger.info(`[${REL_VERSION}] catalogoCVRenombrado: "${antes}" → "${despues}" en ${n} operación(es).`);
});

export const catalogoAduanaRenombrada = onDocumentUpdated({ document: 'catalogo_aduanas/{id}', region: 'us-central1' }, async (event) => {
  invalidarCatalogoR('catalogo_aduanas');
  const xA = event.data?.before.data() as Record<string, unknown> | undefined;
  const xD = event.data?.after.data() as Record<string, unknown> | undefined;
  const antes = String(xA?.aduana || xA?.nombre || '').trim();
  const despues = String(xD?.aduana || xD?.nombre || '').trim();
  const n = await propagarRenombreCatalogo('aduanaNombre', antes, despues);
  if (n) logger.info(`[${REL_VERSION}] catalogoAduanaRenombrada: "${antes}" → "${despues}" en ${n} operación(es).`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) VERIFICADOR DE INTEGRIDAD (callable) — reporta referencias rotas.
// ─────────────────────────────────────────────────────────────────────────────
type Hallazgo = { total: number; muestras: string[] };
const nuevoHallazgo = (): Hallazgo => ({ total: 0, muestras: [] });
const anotar = (h: Hallazgo, etiqueta: string): void => {
  h.total += 1;
  if (h.muestras.length < 20) h.muestras.push(etiqueta);
};

export const verificarIntegridad = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');

  // Conjuntos de referencia (ids válidos y nombres canónicos).
  const [empresasSnap, catCV, catAdu] = await Promise.all([
    dbRel.collection('empresas').select().get(),
    cargarCatalogoR('catalogo_carga_vacia', ['nombre', 'estado_carga']),
    cargarCatalogoR('catalogo_aduanas', ['aduana', 'nombre']),
  ]);
  const empresasIds = new Set(empresasSnap.docs.map((d) => d.id));
  const cvValidos = new Set(Array.from(catCV.porNorm.keys()));
  const aduValidas = new Set(Array.from(catAdu.porNorm.keys()));

  const reporte = {
    version: REL_VERSION,
    revisadas: { operaciones: 0, facturasClientes: 0, tarifariosClientes: 0, tarifariosProveedores: 0 },
    opsClienteInexistente: nuevoHallazgo(),      // operaciones cuyo clientePaga no existe en Empresas
    opsProveedorInexistente: nuevoHallazgo(),    // operaciones cuyo proveedorUnidad no existe en Empresas
    opsCargaFueraDeCatalogo: nuevoHallazgo(),    // carga con valor que no está en el catálogo C/V
    opsAduanaFueraDeCatalogo: nuevoHallazgo(),   // aduanaNombre fuera del catálogo Aduanas
    facturasClienteInexistente: nuevoHallazgo(), // facturas_clientes cuyo clienteId no existe
    facturasOpsMuertas: nuevoHallazgo(),         // facturas con operacionesIds que ya no existen
    tarifariosClienteInexistente: nuevoHallazgo(),
    tarifariosProveedorInexistente: nuevoHallazgo(),
  };

  // Operaciones.
  const opsSnap = await dbRel.collection('operaciones')
    .select('ref', 'clientePaga', 'proveedorUnidad', 'carga', 'aduanaNombre').get();
  reporte.revisadas.operaciones = opsSnap.size;
  const opsIds = new Set(opsSnap.docs.map((d) => d.id));
  opsSnap.docs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    const etiqueta = String(x.ref || d.id);
    const cli = String(x.clientePaga || '').trim();
    if (cli && !empresasIds.has(cli)) anotar(reporte.opsClienteInexistente, etiqueta);
    const prov = String(x.proveedorUnidad || '').trim();
    if (prov && !empresasIds.has(prov)) anotar(reporte.opsProveedorInexistente, etiqueta);
    const cv = String(x.carga || '').trim();
    if (cv && normR(cv) !== 'n/a' && !cvValidos.has(normR(cv))) anotar(reporte.opsCargaFueraDeCatalogo, `${etiqueta} ("${cv}")`);
    const adu = String(x.aduanaNombre || '').trim();
    if (adu && !aduValidas.has(normR(adu))) anotar(reporte.opsAduanaFueraDeCatalogo, `${etiqueta} ("${adu}")`);
  });

  // Facturas de clientes.
  const factSnap = await dbRel.collection('facturas_clientes').select('invoice', 'clienteId', 'operacionesIds').get();
  reporte.revisadas.facturasClientes = factSnap.size;
  factSnap.docs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    const etiqueta = String(x.invoice || d.id);
    const cli = String(x.clienteId || '').trim();
    if (cli && !empresasIds.has(cli)) anotar(reporte.facturasClienteInexistente, etiqueta);
    const ids = Array.isArray(x.operacionesIds) ? (x.operacionesIds as unknown[]) : [];
    const muertas = ids.filter((id) => { const k = String(id || '').trim(); return k && !opsIds.has(k); });
    if (muertas.length) anotar(reporte.facturasOpsMuertas, `${etiqueta} (${muertas.length} op(s) borrada(s))`);
  });

  // Tarifarios.
  const tcSnap = await dbRel.collection('tarifario_clientes').select('consecutivo', 'clienteId', 'clienteNombre').get();
  reporte.revisadas.tarifariosClientes = tcSnap.size;
  tcSnap.docs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    const cli = String(x.clienteId || '').trim();
    if (cli && !empresasIds.has(cli)) anotar(reporte.tarifariosClienteInexistente, String(x.consecutivo || d.id));
  });
  const tpSnap = await dbRel.collection('tarifario_proveedores').select('consecutivo', 'proveedorId').get();
  reporte.revisadas.tarifariosProveedores = tpSnap.size;
  tpSnap.docs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    const prov = String(x.proveedorId || '').trim();
    if (prov && !empresasIds.has(prov)) anotar(reporte.tarifariosProveedorInexistente, String(x.consecutivo || d.id));
  });

  logger.info(`[${REL_VERSION}] verificarIntegridad ejecutado por ${request.auth.uid}`, reporte.revisadas);
  return reporte;
});


// ─────────────────────────────────────────────────────────────────────────────
// 5) ✅ V00275 — CASCADA DE MONTOS (regla de Jesús):
//    · Cambia un monto en la OPERACIÓN → se actualizan las FACTURAS que la
//      contienen (su renglón en operacionesGuardadas y los agregados).
//    · Cambia el total de una FACTURA → se actualiza su saldo en PAGOS
//      (saldoPendiente y statusPago; los documentos de pago aplicados son
//      historial y no se tocan).
//    Las fórmulas son ESPEJO de Facturación (calcularConversionCliente /
//    Proveedor y totalNativoFactura) — si cambian allá, cambiar aquí.
// ─────────────────────────────────────────────────────────────────────────────
const ID_USD_REL = '7dca62b3';
const ID_MXN_REL = 'f95d8894';
const r2rel = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

type Dict = Record<string, unknown>;

const esUSDTexto = (v: unknown): boolean => {
  const t = String(v ?? '').toUpperCase();
  return t === ID_USD_REL.toUpperCase() || t.includes('USD') || t.includes('DOLAR') || t.includes('DÓLAR');
};
const esMXNTexto = (v: unknown): boolean => {
  const t = String(v ?? '').toUpperCase();
  return t === ID_MXN_REL.toUpperCase() || t.includes('MXN') || t.includes('PESO');
};

/** Espejo de calcularConversionCliente / calcularConversionProveedor. */
const conversionOperacion = (op: Dict, lado: 'cliente' | 'proveedor') => {
  const fact = lado === 'cliente' ? op.facturadoEnCobrar : op.facturadoEnUnidad;
  const tc = Number(op.tipoCambioAprobado) || Number(op.tipoCambioDia) || 0;
  const montoConvenio = Number(lado === 'cliente' ? op.montoConvenioCliente : op.totalAPagarProv) || 0;
  const cargos = Number(lado === 'cliente' ? op.cargosAdicionales : op.cargosAdicionalesProv) || 0;
  const nombreMoneda = String((lado === 'cliente' ? op.monedaCobroNombre : op.monedaUnidadNombre) || '');
  const factUSD = fact === ID_USD_REL || esUSDTexto(nombreMoneda);
  const factMXN = fact === ID_MXN_REL || esMXNTexto(nombreMoneda);
  const monConv = String((lado === 'cliente' ? op.monedaConvenioCliente : op.monedaConvenioProv) || '');
  const convUSD = monConv === ID_USD_REL || (!!monConv && esUSDTexto(monConv));
  const convMXN = monConv === ID_MXN_REL || (!!monConv && esMXNTexto(monConv));
  let subtotal = montoConvenio;
  if (convUSD && factMXN) subtotal = tc > 0 ? montoConvenio * tc : 0;
  else if (convMXN && factUSD) subtotal = tc > 0 ? montoConvenio / tc : 0;
  let cargosFact = cargos;
  if (convUSD && factMXN) cargosFact = tc > 0 ? cargos * tc : 0;
  else if (convMXN && factUSD) cargosFact = tc > 0 ? cargos / tc : 0;
  const total = r2rel(r2rel(subtotal) + r2rel(cargosFact));
  let dol = 0; let pes = 0; let conv = 0;
  const facturaUSD = factUSD || (!factMXN && convUSD);
  if (facturaUSD) { dol = total; pes = 0; conv = total * tc; }
  else { dol = 0; pes = total; conv = total; }
  return { subtotal: r2rel(subtotal), total, dol: r2rel(dol), pes: r2rel(pes), conv: r2rel(conv) };
};

/** Espejo de totalNativoFactura (Facturación): total en la MONEDA de la factura. */
const totalNativoFacturaRel = (fac: Dict, ops: Dict[]): number => {
  const monTxt = normR(fac.monedaFacturacion || fac.monedaProveedor || fac.moneda || fac.monedaId);
  const esUSD = monTxt === ID_USD_REL || monTxt === 'usd' || monTxt === 'us$' || monTxt === 'dls' || monTxt.startsWith('dolar');
  const esMXN = monTxt === ID_MXN_REL || monTxt === 'mxn' || monTxt === 'mn' || monTxt.startsWith('peso');
  const suma = (campo: string) => ops.reduce((s, o) => s + (Number(o?.[campo]) || 0), 0);
  if (ops.length > 0) {
    if (esUSD) { const dol = suma('dol'); if (dol > 0) return r2rel(dol); const base = suma('subtotalBase'); if (base > 0) return r2rel(base); }
    else if (esMXN) { const conv = suma('monto'); if (conv > 0) return r2rel(conv); const pes = suma('pes'); if (pes > 0) return r2rel(pes); const base = suma('subtotalBase'); if (base > 0) return r2rel(base); }
    else { const base = suma('subtotalBase'); if (base > 0) return r2rel(base); }
  }
  return r2rel(fac.subtotalFactura || fac.total || fac.montoFactura || 0);
};

const difiere = (a: unknown, b: unknown): boolean => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.005;

/** Cascada Operación → Facturas de un lado (clientes o proveedores). */
const propagarMontoOperacionAFacturas = async (opId: string, op: Dict, lado: 'cliente' | 'proveedor'): Promise<number> => {
  const coleccion = lado === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
  const snap = await dbRel.collection(coleccion).where('operacionesIds', 'array-contains', opId).get();
  if (snap.empty) return 0;
  const m = conversionOperacion(op, lado);
  let n = 0;
  for (const d of snap.docs) {
    const fac = d.data() as Dict;
    const ops = Array.isArray(fac.operacionesGuardadas) ? [...(fac.operacionesGuardadas as Dict[])] : [];
    const idx = ops.findIndex((o) => String(o?.id || '') === opId);
    if (idx === -1) continue; // factura sin snapshot detallado: no se inventa
    const viejo = ops[idx] as Dict;
    const nuevo: Dict = {
      ...viejo,
      monto: m.conv,
      subtotalBase: m.subtotal,
      dol: m.dol,
      pes: m.pes,
      convenioNombre: String((lado === 'cliente' ? (op.convenioNombre || op.convenioClienteNombre) : (op.convenioProveedorNombre || op.convenioNombre)) ?? viejo.convenioNombre ?? ''),
    };
    if (lado === 'cliente') nuevo.refCliente = String(op.refCliente ?? viejo.refCliente ?? '');
    const cambioRenglon = difiere(viejo.monto, nuevo.monto) || difiere(viejo.subtotalBase, nuevo.subtotalBase) ||
      difiere(viejo.dol, nuevo.dol) || difiere(viejo.pes, nuevo.pes) ||
      String(viejo.convenioNombre || '') !== String(nuevo.convenioNombre || '') ||
      (lado === 'cliente' && String(viejo.refCliente || '') !== String(nuevo.refCliente || ''));
    if (!cambioRenglon) continue; // anti-bucle
    ops[idx] = nuevo;
    const subtotalFactura = r2rel(ops.reduce((s, o) => s + (Number(o?.monto) || 0), 0));
    const subtotalMonedaFactura = totalNativoFacturaRel(fac, ops);
    const cambios: Dict = { operacionesGuardadas: ops };
    if (difiere(fac.subtotalFactura, subtotalFactura)) cambios.subtotalFactura = subtotalFactura;
    if (difiere(fac.subtotalMonedaFactura, subtotalMonedaFactura)) cambios.subtotalMonedaFactura = subtotalMonedaFactura;
    await d.ref.update(cambios);
    n += 1;
  }
  return n;
};

const CAMPOS_DINERO_CLIENTE = ['montoConvenioCliente', 'cargosAdicionales', 'facturadoEnCobrar', 'monedaConvenioCliente', 'monedaCobroNombre', 'tipoCambioAprobado', 'tipoCambioDia', 'convenioNombre', 'refCliente'];
const CAMPOS_DINERO_PROV = ['totalAPagarProv', 'cargosAdicionalesProv', 'facturadoEnUnidad', 'monedaConvenioProv', 'monedaUnidadNombre', 'tipoCambioAprobado', 'tipoCambioDia', 'convenioProveedorNombre'];

export const operacionMontoCambiado = onDocumentUpdated({ document: 'operaciones/{opId}', region: 'us-central1' }, async (event) => {
  const antes = event.data?.before.data() as Dict | undefined;
  const despues = event.data?.after.data() as Dict | undefined;
  if (!antes || !despues) return;
  const opId = event.params.opId;
  try {
    const cambioCliente = CAMPOS_DINERO_CLIENTE.some((c) => String(antes[c] ?? '') !== String(despues[c] ?? ''));
    const cambioProv = CAMPOS_DINERO_PROV.some((c) => String(antes[c] ?? '') !== String(despues[c] ?? ''));
    if (!cambioCliente && !cambioProv) return;
    let n = 0;
    if (cambioCliente) n += await propagarMontoOperacionAFacturas(opId, despues, 'cliente');
    if (cambioProv) n += await propagarMontoOperacionAFacturas(opId, despues, 'proveedor');
    if (n > 0) logger.info(`[${REL_VERSION}] operacionMontoCambiado: ${String(despues.ref || opId)} → ${n} factura(s) actualizada(s)`);
  } catch (e) {
    logger.error(`[${REL_VERSION}] operacionMontoCambiado: fallo en ${opId}`, e);
  }
});

/** Cascada Factura → saldo de Pagos: si la factura ya tiene pagos aplicados,
 *  su saldoPendiente y statusPago se recalculan con el total nuevo. */
const recalcularSaldoFactura = async (event: { data?: { after?: FirebaseFirestore.DocumentSnapshot } }, etiqueta: string) => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  const fac = despues.data() as Dict;
  const montoPagado = Number(fac.montoPagado) || 0;
  const tieneAplicaciones = montoPagado > 0 || typeof fac.saldoPendiente === 'number';
  if (!tieneAplicaciones) return; // sin pagos: nada que recalcular
  const ops = Array.isArray(fac.operacionesGuardadas) ? (fac.operacionesGuardadas as Dict[]) : [];
  const total = totalNativoFacturaRel(fac, ops);
  const saldo = Math.max(0, r2rel(total - montoPagado));
  const status = saldo <= 0.009 ? 'PAGADA' : (montoPagado > 0 ? 'PARCIAL' : String(fac.statusPago || ''));
  const cambios: Dict = {};
  if (difiere(fac.saldoPendiente, saldo)) cambios.saldoPendiente = saldo;
  if (status && String(fac.statusPago || '') !== status) cambios.statusPago = status;
  if (Object.keys(cambios).length === 0) return; // anti-bucle
  await despues.ref.update(cambios);
  logger.info(`[${REL_VERSION}] ${etiqueta}: ${String(fac.invoice || despues.id)} saldo recalculado`, cambios);
};

export const facturaClienteMontoCambiado = onDocumentWritten({ document: 'facturas_clientes/{facId}', region: 'us-central1' }, async (event) => {
  try { await recalcularSaldoFactura(event, 'facturaClienteMontoCambiado'); }
  catch (e) { logger.error(`[${REL_VERSION}] facturaClienteMontoCambiado: fallo en ${event.params.facId}`, e); }
});

export const facturaProveedorMontoCambiado = onDocumentWritten({ document: 'facturas_proveedores/{facId}', region: 'us-central1' }, async (event) => {
  try { await recalcularSaldoFactura(event, 'facturaProveedorMontoCambiado'); }
  catch (e) { logger.error(`[${REL_VERSION}] facturaProveedorMontoCambiado: fallo en ${event.params.facId}`, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) ✅ V00282 — SINCRONIZACIÓN TARIFARIO → DETALLES DE CONVENIO (server-side).
//    Regla de Jesús: el tarifario y sus convenios NO pueden decir cosas
//    distintas. Cada línea del tarifario guarda su consecutivo CONV-### y la
//    CLAVE del detalle ES ese consecutivo → al escribirse un tarifario, el
//    status de cada línea se refleja en su detalle (y se repara el
//    tarifarioId del detalle si falta). Anti-bucle: solo escribe si difiere.
// ─────────────────────────────────────────────────────────────────────────────
const sincronizarDetallesDeTarifario = async (
  tarifarioId: string,
  tarifario: Dict,
  coleccionDetalles: string,
): Promise<number> => {
  const lineas = Array.isArray(tarifario.tarifas) ? (tarifario.tarifas as Dict[]) : [];
  let n = 0;
  for (const t of lineas) {
    const cc = String(t?.consecutivo || '').trim();
    if (!cc) continue;
    const statusLinea = String(t?.status || tarifario.status || '').trim();
    if (!statusLinea) continue;
    const ref = dbRel.collection(coleccionDetalles).doc(cc);
    const snap = await ref.get();
    if (!snap.exists) continue; // el detalle aún no existe: nada que sincronizar
    const det = snap.data() as Dict;
    const cambios: Dict = {};
    if (String(det.status || '') !== statusLinea) cambios.status = statusLinea;
    if (!String(det.tarifarioId || '').trim()) cambios.tarifarioId = tarifarioId; // repara la relación
    if (Object.keys(cambios).length === 0) continue;
    await ref.update(cambios);
    n += 1;
  }
  return n;
};

export const tarifarioClienteEscrito = onDocumentWritten({ document: 'tarifario_clientes/{tarId}', region: 'us-central1' }, async (event) => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  try {
    const n = await sincronizarDetallesDeTarifario(event.params.tarId, despues.data() as Dict, 'convenios_clientes_detalles');
    if (n > 0) logger.info(`[${REL_VERSION}] tarifarioClienteEscrito: ${event.params.tarId} → ${n} detalle(s) sincronizado(s)`);
  } catch (e) {
    logger.error(`[${REL_VERSION}] tarifarioClienteEscrito: fallo en ${event.params.tarId}`, e);
  }
});

export const tarifarioProveedorEscrito = onDocumentWritten({ document: 'tarifario_proveedores/{tarId}', region: 'us-central1' }, async (event) => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  try {
    const n = await sincronizarDetallesDeTarifario(event.params.tarId, despues.data() as Dict, 'convenios_proveedores_detalles');
    if (n > 0) logger.info(`[${REL_VERSION}] tarifarioProveedorEscrito: ${event.params.tarId} → ${n} detalle(s) sincronizado(s)`);
  } catch (e) {
    logger.error(`[${REL_VERSION}] tarifarioProveedorEscrito: fallo en ${event.params.tarId}`, e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7) ✅ V00299 — SINCRONIZACIÓN INVERSA: DETALLE DE CONVENIO → LÍNEA DEL
//    TARIFARIO. El "# de tarifario" es la llave foránea: cualquier edición del
//    detalle (origen, destino, costo, moneda, status, tarifa del catálogo) se
//    refleja en la línea del tarifario con el mismo consecutivo. Anti-bucle:
//    solo escribe si algo difiere (igual que el trigger directo v1.2, así los
//    dos convergen y se detienen).
// ─────────────────────────────────────────────────────────────────────────────
const monedaCortaRel = (m: unknown): string => {
  const t = String(m ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (t.includes('dolar') || t.includes('usd') || String(m) === ID_USD_REL) return 'USD';
  if (t.includes('peso') || t.includes('mxn') || String(m) === ID_MXN_REL) return 'MXN';
  return '';
};

const sincronizarLineaDeDetalle = async (detalleId: string, det: Dict, coleccionTarifarios: string): Promise<boolean> => {
  const tarId = String(det.tarifarioId || '').trim();
  if (!tarId) return false;
  const consec = String(det.consecutivo || detalleId).trim();
  const ref = dbRel.collection(coleccionTarifarios).doc(tarId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data() as Dict;
  const tarifas = Array.isArray(data.tarifas) ? [...(data.tarifas as Dict[])] : [];
  const idx = tarifas.findIndex((t) => String(t?.consecutivo || '').trim() === consec);
  if (idx < 0) return false;
  const antes = tarifas[idx];
  const nueva: Dict = { ...antes };
  const costo = Number(det.tarifa) || 0;
  if (costo > 0 && difiere(Number(antes.tarifa) || 0, costo)) nueva.tarifa = costo;
  const mon = monedaCortaRel(det.moneda);
  if (mon && String(antes.cotizadoEn || '') !== mon) nueva.cotizadoEn = mon;
  const st = String(det.status || '').trim();
  if (st && String(antes.status || '') !== st) nueva.status = st;
  const ori = String(det.origenNombre || det.origen || '').trim();
  if (ori && String(antes.origen || '') !== ori) nueva.origen = ori;
  const dest = String(det.destinoNombre || det.destino || '').trim();
  if (dest && String(antes.destino || '') !== dest) nueva.destino = dest;
  const tipoId = String(det.tipoConvenioId || '').trim();
  if (tipoId && String(antes.tarifaReferenciaId || '') !== tipoId) nueva.tarifaReferenciaId = tipoId;
  const tipoNom = String(det.tipoConvenioNombre || '').trim();
  if (tipoNom && String(antes.descripcion || '') !== tipoNom) nueva.descripcion = tipoNom;
  if (JSON.stringify(nueva) === JSON.stringify(antes)) return false;
  tarifas[idx] = nueva;
  await ref.update({ tarifas });
  return true;
};

export const convenioClienteDetalleEscrito = onDocumentWritten({ document: 'convenios_clientes_detalles/{detId}', region: 'us-central1' }, async (event) => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  try {
    const cambio = await sincronizarLineaDeDetalle(event.params.detId, despues.data() as Dict, 'tarifario_clientes');
    if (cambio) logger.info(`[${REL_VERSION}] convenioClienteDetalleEscrito: ${event.params.detId} → línea del tarifario sincronizada`);
  } catch (e) {
    logger.error(`[${REL_VERSION}] convenioClienteDetalleEscrito: fallo en ${event.params.detId}`, e);
  }
});

export const convenioProveedorDetalleEscrito = onDocumentWritten({ document: 'convenios_proveedores_detalles/{detId}', region: 'us-central1' }, async (event) => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  try {
    const cambio = await sincronizarLineaDeDetalle(event.params.detId, despues.data() as Dict, 'tarifario_proveedores');
    if (cambio) logger.info(`[${REL_VERSION}] convenioProveedorDetalleEscrito: ${event.params.detId} → línea del tarifario sincronizada`);
  } catch (e) {
    logger.error(`[${REL_VERSION}] convenioProveedorDetalleEscrito: fallo en ${event.params.detId}`, e);
  }
});

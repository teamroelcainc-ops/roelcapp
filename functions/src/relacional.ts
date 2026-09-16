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

const REL_VERSION = 'relacional-v1.0';

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


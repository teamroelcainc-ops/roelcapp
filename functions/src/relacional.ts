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
import { exigirAdmin, EXIGIR_APP_CHECK } from './acceso'; // ✅ V00435 · V00437: solo admin
import { CATALOGO_ADUANAS, CATALOGO_CV, cambiosCanonicos, catalogoServidor, contextoServidor, invalidarCatalogoServidor } from './canonico';
import { banderaServidor } from './flags';
import { CAMPOS_CANONICOS, derivarDesdeConvenio } from './dominio/operacionCanonica.js';
import { ESQUEMA_OPERACION_VERSION, ID_MXN, ID_USD } from './dominio/constantes.js';
import { conversionOperacion, derivadosFactura, monedaConvenioDeducida, monedaDeFactura, monedaFacturaOperacion, totalNativoDeOperaciones, totalNativoDeRenglonesLegado } from './dominio/dinero.js';
import { aNumero, deCentavos, r2 } from './dominio/numeros.js';
import { cambioParaFacturas, valorCongelado } from './dominio/cascadaFacturas.js'; // ✅ V00494 · V00495
import { borrarRenglones, proyectarRenglones } from './proyecciones.js';
import { cambiosCobroPuente } from './puentesYDiesel.js';
import { conReintento, OPCIONES_TRIGGER } from './eventos.js';
import { actualizarUsos } from './usos.js';
import { OPCIONES_PROPAGACION, propagarSiCambioNombre } from './propagacion.js';

if (getApps().length === 0) initializeApp();
const dbRel = getFirestore();

const REL_VERSION = 'relacional-v1.9'; // ✅ V00495: facturas emitidas con el valor congelado · ✅ V00494: la cascada a facturas solo recalcula con cambios de dinero · ✅ V00299: + sync INVERSA detalle→línea del tarifario · ✅ V00429: + guardián de integridad del convenio · ✅ V00440: + campos canónicos · ✅ V00441: + dinero y cobro del puente

/** Normaliza: sin acentos, espacios colapsados, minúsculas (misma regla del cliente V00257). */
const normR = (t: unknown): string =>
  String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// ✅ V00440 (Fase 4): los catálogos de Carga/Vacía y Aduanas (5 min en memoria)
//   y la regla "EL CONVENIO MANDA" se movieron a canonico.ts y a
//   dominio/operacionCanonica.ts (misma lógica, compartida con la migración).

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

export const empresaActualizada = onDocumentUpdated({ document: 'empresas/{empresaId}', ...OPCIONES_PROPAGACION }, (event) => conReintento('empresaActualizada', event, async () => {
  const antes = event.data?.before.data() as Record<string, unknown> | undefined;
  const despues = event.data?.after.data() as Record<string, unknown> | undefined;
  if (!antes || !despues) return;
  // ✅ V00442 (Fase 6.2): con la bandera, UN mapa y UNA regla (propagacion.ts).
  if (await banderaServidor('propagacionEnServidor')) {
    await propagarSiCambioNombre('empresas', event.params.empresaId, antes, despues);
    return;
  }

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
}));

// ─────────────────────────────────────────────────────────────────────────────
// 2) OPERACIÓN ESCRITA → C/V, Aduana y Expo/Impo derivados del convenio.
//    (Port server-side del botón "⇊ Normalizar operaciones", por documento.)
// ─────────────────────────────────────────────────────────────────────────────
// ✅ V00440 (Fase 4.4): además, con la bandera `canonicosEnServidor`, los campos
//   canónicos (fechaServicioISO, *Id, estadoGrupo, empresasIds, porFacturar*,
//   *Centavos…) se recalculan en la MISMA escritura. La escritura lleva la
//   precondición lastUpdateTime: si la operación cambió mientras se calculaba, se
//   vuelve a calcular DENTRO de una transacción con el dato actual (comparando
//   contra el `antes` de este evento, para no perder un cambio de origen).
const calcularCambiosOperacion = async (opId: string, antes: Record<string, unknown> | undefined, x: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const [catCV, catAdu] = await Promise.all([catalogoServidor(...CATALOGO_CV), catalogoServidor(...CATALOGO_ADUANAS)]);
  const cambios: Record<string, unknown> = derivarDesdeConvenio(x, catCV, catAdu);
  if (await banderaServidor('canonicosEnServidor')) {
    Object.assign(cambios, cambiosCanonicos(antes, { ...x, ...cambios }, await contextoServidor()));
  }
  // ✅ V00441 (Fase 5.7): cobro del puente al cambiar de estatus (web, Mis Operaciones y app móvil).
  if (await banderaServidor('cobroPuenteEnServidor')) {
    Object.assign(cambios, await cambiosCobroPuente(dbRel, opId, antes, { ...x, ...cambios }));
  }
  return cambios;
};

const codigoError = (e: unknown): string => String((e as { code?: unknown })?.code ?? '').toUpperCase();
const esPrecondicion = (e: unknown): boolean => ['9', 'FAILED_PRECONDITION', 'FAILED-PRECONDITION'].includes(codigoError(e));
const esNoExiste = (e: unknown): boolean => ['5', 'NOT_FOUND', 'NOT-FOUND'].includes(codigoError(e));

// ✅ V00442 (Fase 6.1): campos que SOLO escribe este trigger. Si un evento solo
//   cambió estos (la escritura del propio trigger), se sale sin calcular nada.
//   (esPrueba no: lo marca el usuario.)
const CAMPOS_PROPIOS_OPERACION: ReadonlySet<string> = new Set<string>([
  ...CAMPOS_CANONICOS.filter((c) => c !== 'esPrueba'), 'puenteCobradoEn', 'puenteCobradoPor',
]);
const mismoValor = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
export const soloCamposPropios = (antes: Dict, despues: Dict): boolean => {
  for (const k of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
    if (!mismoValor(antes[k], despues[k]) && !CAMPOS_PROPIOS_OPERACION.has(k)) return false;
  }
  return true;
};

/**
 * ✅ V00442 (Fase 6.1): UN solo trigger por escritura de operación. Antes había dos
 * (operacionEscrita + operacionMontoCambiado) y facturar N operaciones costaba 2N
 * invocaciones (4N con la escritura de los canónicos). Hace, en orden:
 *   1) sale si solo cambiaron campos que escribe él mismo,
 *   2) cascada de montos a las facturas (lo que hacía operacionMontoCambiado; en
 *      transacción y con la operación actual),
 *   3) derivados del convenio, canónicos y cobro del puente (una escritura con precondición),
 *   4) contadores de uso (6.5; una vez por evento; si fallan, solo se registra: los
 *      corrige el recuento, nunca frenan lo demás).
 * Con retry (6.4): los errores de 2) y 3) se relanzan; ambos son seguros de repetir.
 */
export const operacionEscrita = onDocumentWritten({ document: 'operaciones/{opId}', ...OPCIONES_TRIGGER }, (event) => conReintento('operacionEscrita', event, async () => {
  const antes = event.data?.before?.exists ? (event.data.before.data() as Dict) : undefined;
  const x = event.data?.after?.exists ? (event.data.after.data() as Dict) : undefined;
  await normalizarOperacion(event.params.opId, event.data?.after, antes, x);
  try {
    await actualizarUsos(dbRel, event.id, antes, x);
  } catch (e) {
    logger.error(`[${REL_VERSION}] operacionEscrita: contadores de uso de ${event.params.opId} (los corrige npm run usos)`, e);
  }
}));

const normalizarOperacion = async (opId: string, despues: FirebaseFirestore.DocumentSnapshot | undefined, antes: Dict | undefined, x: Dict | undefined): Promise<void> => {
  if (!despues || !x) return; // borrado: nada que normalizar
  if (antes && soloCamposPropios(antes, x)) return;
  if (antes) await propagarMontosDeOperacion(opId, antes, x);
  try {
    const cambios = await calcularCambiosOperacion(opId, antes, x);
    if (Object.keys(cambios).length === 0) return; // anti-bucle: ya está íntegra
    await despues.ref.update(cambios, { lastUpdateTime: despues.updateTime });
    logger.info(`[${REL_VERSION}] operacionEscrita: ${String(x.ref || opId)} normalizada`, Object.keys(cambios));
  } catch (e) {
    if (esNoExiste(e)) return; // se borró mientras se calculaba
    if (!esPrecondicion(e)) throw e;
    // Cambió mientras se calculaba: se recalcula con el dato actual, en transacción.
    await dbRel.runTransaction(async (tx) => {
      const actual = await tx.get(despues.ref);
      if (!actual.exists) return;
      const cambios = await calcularCambiosOperacion(opId, antes, actual.data() as Dict);
      if (Object.keys(cambios).length > 0) tx.update(despues.ref, cambios);
    });
  }
};

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

export const catalogoCVRenombrado = onDocumentUpdated({ document: 'catalogo_carga_vacia/{id}', ...OPCIONES_TRIGGER }, (event) => conReintento('catalogoCVRenombrado', event, async () => {
  invalidarCatalogoServidor('catalogo_carga_vacia');
  const antes = String((event.data?.before.data() as Record<string, unknown> | undefined)?.nombre || '').trim();
  if (antes === String((event.data?.after.data() as Record<string, unknown> | undefined)?.nombre || '').trim()) return;
  // ✅ V00442 (6.4): el nombre ACTUAL (si se renombró otra vez, un reintento no regresa el intermedio).
  const actual = await event.data?.after.ref.get();
  const despues = String((actual?.data() as Record<string, unknown> | undefined)?.nombre || '').trim();
  const n = await propagarRenombreCatalogo('carga', antes, despues);
  if (n) logger.info(`[${REL_VERSION}] catalogoCVRenombrado: "${antes}" → "${despues}" en ${n} operación(es).`);
}));

export const catalogoAduanaRenombrada = onDocumentUpdated({ document: 'catalogo_aduanas/{id}', ...OPCIONES_TRIGGER }, (event) => conReintento('catalogoAduanaRenombrada', event, async () => {
  invalidarCatalogoServidor('catalogo_aduanas');
  const xA = event.data?.before.data() as Record<string, unknown> | undefined;
  const xD = event.data?.after.data() as Record<string, unknown> | undefined;
  const antes = String(xA?.aduana || xA?.nombre || '').trim();
  if (antes === String(xD?.aduana || xD?.nombre || '').trim()) return;
  const xActual = (await event.data?.after.ref.get())?.data() as Record<string, unknown> | undefined; // ✅ V00442 (6.4)
  const despues = String(xActual?.aduana || xActual?.nombre || '').trim();
  const n = await propagarRenombreCatalogo('aduanaNombre', antes, despues);
  if (n) logger.info(`[${REL_VERSION}] catalogoAduanaRenombrada: "${antes}" → "${despues}" en ${n} operación(es).`);
}));

// ─────────────────────────────────────────────────────────────────────────────
// 4) VERIFICADOR DE INTEGRIDAD (callable) — reporta referencias rotas.
// ─────────────────────────────────────────────────────────────────────────────
type Hallazgo = { total: number; muestras: string[] };
const nuevoHallazgo = (): Hallazgo => ({ total: 0, muestras: [] });
const anotar = (h: Hallazgo, etiqueta: string): void => {
  h.total += 1;
  if (h.muestras.length < 20) h.muestras.push(etiqueta);
};

// ✅ V00437 (Fase 1.5): verificarIntegridad lee TODA la base (operaciones, facturas,
//   tarifarios): solo administradores y como máximo una vez cada 10 minutos. Si se
//   pide antes, se devuelve el último reporte guardado en meta/verificarIntegridad.
const INTERVALO_INTEGRIDAD_MS = 10 * 60 * 1000;

export const verificarIntegridad = onCall({ region: 'us-central1', timeoutSeconds: 300, memory: '512MiB', enforceAppCheck: EXIGIR_APP_CHECK }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  await exigirAdmin(request.auth.uid);
  // Candado: `enCursoDesde` evita corridas simultáneas (caduca a los 6 min por si
  // una corrida muere); `reporteEn` es la hora REAL del último reporte guardado.
  const refMeta = dbRel.collection('meta').doc('verificarIntegridad');
  const previo = await dbRel.runTransaction(async (tx) => {
    const snap = await tx.get(refMeta);
    const m = (snap.data() ?? {}) as { enCursoDesde?: number; reporteEn?: number; reporte?: unknown };
    const ahora = Date.now();
    if (m.reporte && m.reporteEn && ahora - m.reporteEn < INTERVALO_INTEGRIDAD_MS) return m;
    if (m.enCursoDesde && ahora - m.enCursoDesde < 6 * 60 * 1000) {
      throw new HttpsError('resource-exhausted', 'Ya se está verificando la integridad. Intenta en unos minutos.');
    }
    tx.set(refMeta, { enCursoDesde: ahora, ejecutadoPor: request.auth?.uid ?? '' }, { merge: true });
    return null;
  });
  if (previo) {
    return { ...(previo.reporte as Record<string, unknown>), cacheado: true, reporteEn: new Date(previo.reporteEn ?? 0).toISOString() };
  }

  // Conjuntos de referencia (ids válidos y nombres canónicos).
  const [empresasSnap, catCV, catAdu] = await Promise.all([
    dbRel.collection('empresas').select().get(),
    catalogoServidor(...CATALOGO_CV),
    catalogoServidor(...CATALOGO_ADUANAS),
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
    // ✅ V00440 (Fase 4): operaciones sin el esquema canónico al día.
    opsSinEsquemaV2: nuevoHallazgo(),            // esquemaVersion distinto de 2
    opsSinFechaISO: nuevoHallazgo(),             // sin fechaServicioISO
    opsSinEstadoGrupo: nuevoHallazgo(),          // sin estadoGrupo
    opsRelacionSinId: nuevoHallazgo(),           // trae cliente/proveedor/status/convenio pero no su *Id canónico
  };

  // Operaciones.
  const opsSnap = await dbRel.collection('operaciones')
    .select('ref', 'clientePaga', 'proveedorUnidad', 'carga', 'aduanaNombre', 'status', 'convenio',
      'esquemaVersion', 'fechaServicioISO', 'estadoGrupo', 'clientePagaId', 'proveedorUnidadId', 'statusId', 'convenioClienteId').get();
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
    if (x.esquemaVersion !== ESQUEMA_OPERACION_VERSION) anotar(reporte.opsSinEsquemaV2, etiqueta);
    if (!String(x.fechaServicioISO || '').trim()) anotar(reporte.opsSinFechaISO, etiqueta);
    if (!String(x.estadoGrupo || '').trim()) anotar(reporte.opsSinEstadoGrupo, etiqueta);
    const sinId = ([['clientePaga', 'clientePagaId'], ['proveedorUnidad', 'proveedorUnidadId'], ['status', 'statusId'], ['convenio', 'convenioClienteId']] as const)
      .filter(([origen, canon]) => String(x[origen] || '').trim() && !String(x[canon] || '').trim())
      .map(([origen]) => origen);
    if (sinId.length) anotar(reporte.opsRelacionSinId, `${etiqueta} (${sinId.join(', ')})`);
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
  await refMeta.set({ reporte, reporteEn: Date.now(), enCursoDesde: 0 }, { merge: true });
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
// ✅ V00441 (Fase 5.1): la conversión de la operación y el total de la factura
//   viven en dominio/dinero.ts (la MISMA regla que Facturación y Pagos). Antes
//   aquí había una copia "espejo" que había que cambiar a mano.
type Dict = Record<string, unknown>;

const difiere = (a: unknown, b: unknown): boolean => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.005;

// ── LEGADO (bandera dineroPorServidor apagada): la copia "espejo" de la V00440,
//    tal cual, para que sin la bandera el servidor calcule EXACTAMENTE lo mismo
//    que antes (incluye aceptar el ID de moneda en monedaCobroNombre). Se borra
//    con el resto del camino viejo (punto de parada P4).
const esUSDTextoLegado = (v: unknown): boolean => {
  const t = String(v ?? '').toUpperCase();
  return t === ID_USD.toUpperCase() || t.includes('USD') || t.includes('DOLAR') || t.includes('DÓLAR');
};
const esMXNTextoLegado = (v: unknown): boolean => {
  const t = String(v ?? '').toUpperCase();
  return t === ID_MXN.toUpperCase() || t.includes('MXN') || t.includes('PESO');
};
const conversionOperacionLegado = (op: Dict, lado: 'cliente' | 'proveedor') => {
  const fact = lado === 'cliente' ? op.facturadoEnCobrar : op.facturadoEnUnidad;
  const tc = Number(op.tipoCambioAprobado) || Number(op.tipoCambioDia) || 0;
  const montoConvenio = Number(lado === 'cliente' ? op.montoConvenioCliente : op.totalAPagarProv) || 0;
  const cargos = Number(lado === 'cliente' ? op.cargosAdicionales : op.cargosAdicionalesProv) || 0;
  const nombreMoneda = String((lado === 'cliente' ? op.monedaCobroNombre : op.monedaUnidadNombre) || '');
  // ✅ V00489: UNA sola moneda de factura (el ID; el nombre solo si el ID no se reconoce). Antes, con el
  //   ID en Dólares y el nombre copiado en "Pesos" (o al revés), eran las dos a la vez y el monto
  //   quedaba multiplicado dos veces por el TC.
  const monedaFactura = fact === ID_USD ? 'USD' : fact === ID_MXN ? 'MXN' : monedaFacturaOperacion(op, lado);
  const factUSD = monedaFactura === 'USD' || (monedaFactura === null && esUSDTextoLegado(nombreMoneda) && !esMXNTextoLegado(nombreMoneda));
  const factMXN = monedaFactura === 'MXN' || (monedaFactura === null && esMXNTextoLegado(nombreMoneda) && !esUSDTextoLegado(nombreMoneda));
  const monConv = String((lado === 'cliente' ? op.monedaConvenioCliente : op.monedaConvenioProv) || '');
  let convUSD = monConv === ID_USD || (!!monConv && esUSDTextoLegado(monConv));
  let convMXN = monConv === ID_MXN || (!!monConv && esMXNTextoLegado(monConv));
  // ✅ V00486: sin moneda del convenio, la deducida de la conversión guardada (la misma regla de la web).
  if (!convUSD && !convMXN) {
    const deducida = monedaConvenioDeducida(op, lado);
    convUSD = deducida === 'USD';
    convMXN = deducida === 'MXN';
  }
  let subtotal = montoConvenio;
  if (convUSD && factMXN) subtotal = tc > 0 ? montoConvenio * tc : 0;
  else if (convMXN && factUSD) subtotal = tc > 0 ? montoConvenio / tc : 0;
  let cargosFact = cargos;
  if (convUSD && factMXN) cargosFact = tc > 0 ? cargos * tc : 0;
  else if (convMXN && factUSD) cargosFact = tc > 0 ? cargos / tc : 0;
  const total = r2(r2(subtotal) + r2(cargosFact));
  let dol = 0; let pes = 0; let conv = 0;
  const facturaUSD = factUSD || (!factMXN && convUSD);
  if (facturaUSD) { dol = total; pes = 0; conv = total * tc; } else { dol = 0; pes = total; conv = total; }
  return { subtotal: r2(subtotal), total, dol: r2(dol), pes: r2(pes), conv: r2(conv) };
};

/**
 * Cascada Operación → Facturas de un lado (clientes o proveedores).
 * ✅ V00494: `soloTexto` = solo cambió el nombre del convenio o la Ref Cliente: se copian esos textos
 *   al renglón y NO se recalculan importes ni el total (antes cualquier cambio de esos textos —también
 *   el que propaga el servidor al renombrar un convenio— recalculaba el renglón con la regla y la
 *   factura cambiaba de monto sin que nadie tocara dinero).
 */
const propagarMontoOperacionAFacturas = async (opId: string, lado: 'cliente' | 'proveedor', soloTexto = false): Promise<number> => {
  const coleccion = lado === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
  const snap = await dbRel.collection(coleccion).where('operacionesIds', 'array-contains', opId).select().get();
  if (snap.empty) return 0;
  const dineroOn = await banderaServidor('dineroPorServidor');
  const refOp = dbRel.collection('operaciones').doc(opId);
  let n = 0;
  for (const d of snap.docs) {
    // ✅ V00442 (Fase 6.4): en transacción y con la operación ACTUAL (no la copia del evento):
    //   un reintento tardío no regresa montos viejos, y varias operaciones de la misma
    //   factura que se propagan a la vez no se pisan el arreglo de renglones.
    const escribio = await dbRel.runTransaction(async (tx) => {
      const [fSnap, opSnap] = await tx.getAll(d.ref, refOp);
      if (!fSnap.exists || !opSnap.exists) return false;
      const fac = fSnap.data() as Dict;
      const op = opSnap.data() as Dict;
      const ops = Array.isArray(fac.operacionesGuardadas) ? [...(fac.operacionesGuardadas as Dict[])] : [];
      const idx = ops.findIndex((o) => String(o?.id || '') === opId);
      if (idx === -1) return false; // factura sin snapshot detallado: no se inventa
      const viejo = ops[idx] as Dict;
      // ✅ V00495: factura emitida = valor congelado ("una vez facturado, el valor solo se cambia a mano,
      //   1 x 1"): de la operación solo se copian los textos. Solo el borrador "No Facturado" la sigue.
      if (soloTexto || valorCongelado(fac.statusFactura)) {
        const texto: Dict = {
          ...viejo,
          convenioNombre: String((lado === 'cliente' ? (op.convenioNombre || op.convenioClienteNombre) : (op.convenioProveedorNombre || op.convenioNombre)) ?? viejo.convenioNombre ?? ''),
        };
        if (lado === 'cliente') texto.refCliente = String(op.refCliente ?? viejo.refCliente ?? '');
        if (String(viejo.convenioNombre || '') === String(texto.convenioNombre || '') && (lado !== 'cliente' || String(viejo.refCliente || '') === String(texto.refCliente || ''))) return false;
        ops[idx] = texto;
        tx.update(d.ref, { operacionesGuardadas: ops });
        return true;
      }
      const m = dineroOn ? conversionOperacion(op, lado) : conversionOperacionLegado(op, lado);
      // ✅ V00448: si la conversión sale en 0 (p. ej. convenio en otra moneda SIN tipo de cambio)
      //   y el renglón facturado tiene monto, NO se pone en 0: ese monto vino al facturar de un
      //   respaldo (conversión guardada, confirmación de tarifa) y la factura bajaría sin razón.
      //   Para quitar una operación de una factura se usa "Quitar referencia".
      if (!(m.total > 0) && (aNumero(viejo.monto) > 0 || aNumero(viejo.dol) > 0 || aNumero(viejo.pes) > 0)) {
        logger.warn(`[${REL_VERSION}] cascada: ${opId} calcula 0 en ${coleccion}/${d.id}; se conserva el renglón facturado.`);
        return false;
      }
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
      if (!cambioRenglon) return false; // anti-bucle
      ops[idx] = nuevo;
      const subtotalFactura = r2(ops.reduce((s, o) => s + (Number(o?.monto) || 0), 0));
      const cambios: Dict = { operacionesGuardadas: ops };
      if (difiere(fac.subtotalFactura, subtotalFactura)) cambios.subtotalFactura = subtotalFactura;
      // ✅ V00441 (Fase 5.5): un total capturado a mano (totalManualCentavos) no se pisa.
      if (!(aNumero(fac.totalManualCentavos) > 0)) {
        // ✅ V00448: con dineroPorServidor, la regla única (la misma de las callables y la web).
        const subtotalMonedaFactura = dineroOn ? totalNativoDeOperaciones(monedaDeFactura(fac), ops) : totalNativoDeRenglonesLegado(fac, ops);
        if (difiere(fac.subtotalMonedaFactura, subtotalMonedaFactura)) cambios.subtotalMonedaFactura = subtotalMonedaFactura;
      }
      tx.update(d.ref, cambios);
      return true;
    });
    if (escribio) n += 1;
  }
  return n;
};

// ✅ V00489: también los montos guardados (Subtotal, Dólares, Pesos, Conversión). Desde la V00486 la
//   regla deduce la moneda del convenio de la conversión guardada (y sin TC siempre cayó a esos montos):
//   corregirlos en el formulario sin tocar nada más no actualizaba el renglón de la factura (D-6166).
// ✅ V00494: solo las ENTRADAS de dinero recalculan el renglón. Las copias de nombres (monedaCobroNombre,
//   monedaUnidadNombre) y tipoCambioDia ya no disparan nada (las cambia el sistema, no quien factura), y el
//   nombre del convenio / la Ref Cliente solo se copian como texto. Regla pura en dominio/cascadaFacturas.
/** ✅ V00442 (Fase 6.1): la cascada de montos (antes el trigger operacionMontoCambiado) corre dentro de operacionEscrita. */
const propagarMontosDeOperacion = async (opId: string, antes: Dict, despues: Dict): Promise<void> => {
  const cambio = cambioParaFacturas(antes, despues);
  if (!cambio.cliente && !cambio.proveedor) return;
  let n = 0;
  if (cambio.cliente) n += await propagarMontoOperacionAFacturas(opId, 'cliente', cambio.cliente === 'texto');
  if (cambio.proveedor) n += await propagarMontoOperacionAFacturas(opId, 'proveedor', cambio.proveedor === 'texto');
  if (n > 0) logger.info(`[${REL_VERSION}] operacionEscrita (montos): ${String(despues.ref || opId)} → ${n} factura(s) actualizada(s)`, cambio);
};

/** Cascada Factura → saldo de Pagos: si la factura ya tiene pagos aplicados,
 *  su saldoPendiente y statusPago se recalculan con el total nuevo.
 *  ✅ V00441 (Fase 5): sin la bandera, IGUAL que antes (total desde los renglones;
 *  la diferencia con Pagos, que lee primero subtotalMonedaFactura, la muestra la
 *  reconciliación — punto de parada P3). Con `dineroPorServidor` usa la regla
 *  única, mantiene los agregados en centavos y la tabla hija de renglones. */
const recalcularSaldoFactura = async (
  event: { data?: { before?: FirebaseFirestore.DocumentSnapshot; after?: FirebaseFirestore.DocumentSnapshot } }, etiqueta: string,
) => {
  const antes = event.data?.before;
  const despues = event.data?.after;
  const dinero = await banderaServidor('dineroPorServidor');
  if (!despues || !despues.exists) {
    if (dinero && antes?.exists) await borrarRenglones(antes.ref);
    return;
  }
  const fac = despues.data() as Dict;
  // ✅ V00442 (Fase 6.1): con la bandera, un evento que no tocó nada de dinero (documento
  //   adjunto, status de la factura, nombres, o la escritura de este mismo trigger) sale aquí.
  if (dinero && antes?.exists && !cambioDeDinero(antes.data() as Dict, fac)) return;
  let cambios: Dict = {};
  if (dinero) {
    cambios = derivadosFactura(fac);
    const n = await proyectarRenglones(despues.ref, antes?.exists ? (antes.data() as Dict) : undefined, fac, despues.updateTime);
    if (n) logger.info(`[${REL_VERSION}] ${etiqueta}: ${String(fac.invoice || despues.id)} → ${n} renglón(es) sincronizado(s)`);
  } else {
    // Sin la bandera: el total de SIEMPRE de este trigger (desde los renglones, V00275),
    // salvo un total manual que haya quedado de cuando la bandera estuvo encendida.
    const montoPagado = Number(fac.montoPagado) || 0;
    if (montoPagado > 0 || typeof fac.saldoPendiente === 'number') {
      const manual = aNumero(fac.totalManualCentavos);
      const ops = Array.isArray(fac.operacionesGuardadas) ? (fac.operacionesGuardadas as Dict[]) : [];
      const total = manual > 0 ? deCentavos(manual) : totalNativoDeRenglonesLegado(fac, ops);
      const saldo = Math.max(0, r2(total - montoPagado));
      const status = saldo <= 0.009 ? 'PAGADA' : (montoPagado > 0 ? 'PARCIAL' : String(fac.statusPago || ''));
      if (difiere(fac.saldoPendiente, saldo)) cambios.saldoPendiente = saldo;
      if (status && String(fac.statusPago || '') !== status) cambios.statusPago = status;
    }
  }
  if (Object.keys(cambios).length === 0) return; // anti-bucle
  try {
    await despues.ref.update(cambios, { lastUpdateTime: despues.updateTime });
  } catch (e) {
    if (esNoExiste(e)) return; // se borró
    if (!esPrecondicion(e)) throw e;
    // ✅ V00442: cambió mientras se calculaba. Con la bandera se recalcula AQUÍ con el dato
    //   actual (el siguiente evento puede no tocar dinero y salir por la lista blanca).
    if (!dinero) return; // sin la bandera, como antes: lo recalcula el siguiente evento
    await dbRel.runTransaction(async (tx) => {
      const actual = await tx.get(despues.ref);
      if (!actual.exists) return;
      const nuevos = derivadosFactura(actual.data() as Dict);
      if (Object.keys(nuevos).length > 0) tx.update(despues.ref, nuevos);
    });
  }
  logger.info(`[${REL_VERSION}] ${etiqueta}: ${String(fac.invoice || despues.id)} saldo/agregados recalculados`, Object.keys(cambios));
};

/** Campos de la factura que NO mueven su dinero (ni sus renglones). Las escrituras del propio trigger también. */
const CAMPOS_SIN_DINERO_FACTURA: ReadonlySet<string> = new Set([
  // (statusFactura NO: "Cancelada" cambia `abierta`)
  'docFacturaUrl', 'docFacturaNombre', 'docFacturaFecha', 'docFacturaPor', 'rateProveedor', 'encabezadoRemision',
  'docsFactura', // ✅ V00451: varios documentos por factura (docFactura* = el primero)
  'auditRevisado', 'clienteNombre', 'proveedorNombre', 'updatedAt', 'editadoEn', 'editadoPor', 'facturaCcp', 'fecha', 'invoice',
  // del propio trigger:
  'saldoPendiente', 'statusPago', 'totalCentavos', 'montoPagadoCentavos', 'saldoCentavos', 'saldoAFavorCentavos', 'abierta', 'esquemaDinero',
]);
export const cambioDeDinero = (antes: Dict, despues: Dict): boolean => {
  for (const k of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
    if (!CAMPOS_SIN_DINERO_FACTURA.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(despues[k])) return true;
  }
  return false;
};

export const facturaClienteMontoCambiado = onDocumentWritten({ document: 'facturas_clientes/{facId}', ...OPCIONES_TRIGGER }, (event) =>
  conReintento('facturaClienteMontoCambiado', event, () => recalcularSaldoFactura(event, 'facturaClienteMontoCambiado')));

export const facturaProveedorMontoCambiado = onDocumentWritten({ document: 'facturas_proveedores/{facId}', ...OPCIONES_TRIGGER }, (event) =>
  conReintento('facturaProveedorMontoCambiado', event, () => recalcularSaldoFactura(event, 'facturaProveedorMontoCambiado')));

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

export const tarifarioClienteEscrito = onDocumentWritten({ document: 'tarifario_clientes/{tarId}', ...OPCIONES_TRIGGER }, (event) => conReintento('tarifarioClienteEscrito', event, async () => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  // ✅ V00442 (Fase 6.1): solo si cambiaron las líneas o el status del tarifario.
  const antes = event.data?.before?.exists ? (event.data.before.data() as Dict) : undefined;
  const x = despues.data() as Dict;
  if (antes && JSON.stringify(antes.tarifas) === JSON.stringify(x.tarifas) && antes.status === x.status) return;
  const actual = await despues.ref.get(); // ✅ V00442: el dato actual (un reintento tardío no regresa status viejos)
  if (!actual.exists) return;
  const n = await sincronizarDetallesDeTarifario(event.params.tarId, actual.data() as Dict, 'convenios_clientes_detalles');
  if (n > 0) logger.info(`[${REL_VERSION}] tarifarioClienteEscrito: ${event.params.tarId} → ${n} detalle(s) sincronizado(s)`);
}));

export const tarifarioProveedorEscrito = onDocumentWritten({ document: 'tarifario_proveedores/{tarId}', ...OPCIONES_TRIGGER }, (event) => conReintento('tarifarioProveedorEscrito', event, async () => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  // ✅ V00442 (Fase 6.1): solo si cambiaron las líneas o el status del tarifario.
  const antes = event.data?.before?.exists ? (event.data.before.data() as Dict) : undefined;
  const x = despues.data() as Dict;
  if (antes && JSON.stringify(antes.tarifas) === JSON.stringify(x.tarifas) && antes.status === x.status) return;
  const actual = await despues.ref.get(); // ✅ V00442: el dato actual
  if (!actual.exists) return;
  const n = await sincronizarDetallesDeTarifario(event.params.tarId, actual.data() as Dict, 'convenios_proveedores_detalles');
  if (n > 0) logger.info(`[${REL_VERSION}] tarifarioProveedorEscrito: ${event.params.tarId} → ${n} detalle(s) sincronizado(s)`);
}));

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
  if (t.includes('dolar') || t.includes('usd') || String(m) === ID_USD) return 'USD';
  if (t.includes('peso') || t.includes('mxn') || String(m) === ID_MXN) return 'MXN';
  return '';
};

const sincronizarLineaDeDetalle = async (detalleId: string, det: Dict, coleccionTarifarios: string): Promise<boolean> => {
  const tarId = String(det.tarifarioId || '').trim();
  if (!tarId) return false;
  const consec = String(det.consecutivo || detalleId).trim();
  const ref = dbRel.collection(coleccionTarifarios).doc(tarId);
  // ✅ V00442: en transacción (varios detalles del mismo tarifario no se pisan el arreglo de líneas).
  return dbRel.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
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
    tx.update(ref, { tarifas });
    return true;
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 8) ✅ V00429 — GUARDIÁN DE INTEGRIDAD DEL CONVENIO (regla de Jesús: "bajo
//    ningún concepto" un convenio queda sin cliente/proveedor, sin tarifa o
//    sin la llave foránea a su tarifario). Al escribirse un detalle se
//    completa lo que falte desde su tarifario (FK → línea con el mismo # por
//    NÚMERO → único tarifario de su maestro). Anti-bucle: solo escribe lo que
//    falta o difiere; la segunda pasada ya no cambia nada.
// ─────────────────────────────────────────────────────────────────────────────
const claveNumRel = (v: unknown): string => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
interface CfgGuard { tarifarios: string; maestros: string; campoId: string; campoNombre: string }
const entidadDeMaestroRel = (cfg: CfgGuard, c: Dict | undefined): string => {
  if (!c) return '';
  return cfg.campoId === 'clienteId'
    ? String(c.clienteId ?? c.cliente ?? c.id_cliente ?? c.clientePaga ?? c.empresaId ?? c.empresa ?? '').trim()
    : String(c.proveedorId ?? c.proveedor ?? c.id_proveedor ?? c.empresaId ?? c.empresa ?? '').trim();
};
const garantizarIntegridadDetalle = async (ref: FirebaseFirestore.DocumentReference, det: Dict, cfg: CfgGuard): Promise<string[]> => {
  if (det._eliminado === true) return [];
  const k = claveNumRel(det.consecutivo || ref.id);
  // 1) tarifario padre
  let tarId = String(det.tarifarioId || '').trim();
  let tar: Dict | undefined;
  if (tarId) { const t = await dbRel.collection(cfg.tarifarios).doc(tarId).get(); if (t.exists) tar = t.data() as Dict; }
  if (!tar) {
    const todos = await dbRel.collection(cfg.tarifarios).get();
    const porLinea = todos.docs.filter((d) => {
      const ls = Array.isArray((d.data() as Dict).tarifas) ? ((d.data() as Dict).tarifas as Dict[]) : [];
      return !!k && ls.some((l) => claveNumRel(l?.consecutivo) === k);
    });
    const delMaestro = todos.docs.filter((d) => String(det.convenioId || '') && String((d.data() as Dict).convenioId || '') === String(det.convenioId));
    const elegido = porLinea.length === 1 ? porLinea[0] : (porLinea.length === 0 && delMaestro.length === 1 ? delMaestro[0] : undefined);
    if (elegido) { tarId = elegido.id; tar = elegido.data() as Dict; }
  }
  if (!tar) return [];
  const ent = String(tar[cfg.campoId] || '').trim();
  const cambios: Dict = {};
  if (String(det.tarifarioId || '') !== tarId) cambios.tarifarioId = tarId;
  // 2) empresa escrita en el convenio
  if (ent && String(det[cfg.campoId] || '') !== ent) {
    cambios[cfg.campoId] = ent;
    const nom = String(tar[cfg.campoNombre] || '').trim();
    if (nom) cambios[cfg.campoNombre] = nom;
  }
  // 3) convenio maestro vivo de la misma empresa
  if (ent) {
    const convActual = String(det.convenioId || '').trim();
    const mSnap = convActual ? await dbRel.collection(cfg.maestros).doc(convActual).get() : undefined;
    const duenio = mSnap?.exists ? entidadDeMaestroRel(cfg, mSnap.data() as Dict) : undefined;
    if (!convActual || duenio === undefined || (duenio !== '' && duenio !== ent)) {
      let convNuevo = '';
      const delTar = String(tar.convenioId || '').trim();
      if (delTar) { const mt = await dbRel.collection(cfg.maestros).doc(delTar).get(); if (mt.exists && [ent, ''].includes(entidadDeMaestroRel(cfg, mt.data() as Dict))) convNuevo = delTar; }
      if (!convNuevo) { const q = await dbRel.collection(cfg.maestros).where(cfg.campoId, '==', ent).limit(1).get(); if (!q.empty) convNuevo = q.docs[0].id; }
      if (convNuevo && convNuevo !== convActual) cambios.convenioId = convNuevo;
    }
  }
  // 4) tarifa del catálogo desde su línea
  if (!String(det.tipoConvenioId || '').trim()) {
    const ls = Array.isArray(tar.tarifas) ? (tar.tarifas as Dict[]) : [];
    const linea = ls.find((l) => !!k && claveNumRel(l?.consecutivo) === k);
    const idLinea = String(linea?.tarifaReferenciaId || '').trim();
    if (idLinea) {
      cambios.tipoConvenioId = idLinea;
      if (!String(det.tipoConvenioNombre || '').trim() && String(linea?.descripcion || '').trim()) cambios.tipoConvenioNombre = String(linea?.descripcion);
    }
  }
  const llaves = Object.keys(cambios);
  if (llaves.length > 0) await ref.update(cambios);
  return llaves;
};
/** Campos del detalle que deciden su relación o su línea en el tarifario (V00299/V00429). */
const CAMPOS_RELEVANTES_DETALLE = [
  'tarifarioId', 'consecutivo', 'clienteId', 'proveedorId', 'convenioId', 'tipoConvenioId', 'tipoConvenioNombre',
  'tarifa', 'moneda', 'status', 'origen', 'origenNombre', 'destino', 'destinoNombre', '_eliminado',
];
const cambioRelevanteDetalle = (antes: Dict, despues: Dict): boolean =>
  CAMPOS_RELEVANTES_DETALLE.some((c) => JSON.stringify(antes[c]) !== JSON.stringify(despues[c]));
const integridadIncompleta = (det: Dict, cfg: CfgGuard): boolean =>
  det._eliminado !== true && (!String(det.tarifarioId || '').trim() || !String(det[cfg.campoId] || '').trim()
    || !String(det.convenioId || '').trim() || !String(det.tipoConvenioId || '').trim());

const CFG_GUARD_CLI: CfgGuard = { tarifarios: 'tarifario_clientes', maestros: 'convenios_clientes', campoId: 'clienteId', campoNombre: 'clienteNombre' };
const CFG_GUARD_PROV: CfgGuard = { tarifarios: 'tarifario_proveedores', maestros: 'convenios_proveedores', campoId: 'proveedorId', campoNombre: 'proveedorNombre' };

export const convenioClienteDetalleEscrito = onDocumentWritten({ document: 'convenios_clientes_detalles/{detId}', ...OPCIONES_TRIGGER }, (event) => conReintento('convenioClienteDetalleEscrito', event, async () => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  const antes = event.data?.before?.exists ? (event.data.before.data() as Dict) : undefined;
  // ✅ V00442 (Fase 6.1): lista blanca. Un cambio que no toca la relación ni la línea
  //   del tarifario no lee nada (salvo que al convenio le falte algo: el guardián lo completa).
  if (antes && !cambioRelevanteDetalle(antes, despues.data() as Dict) && !integridadIncompleta(despues.data() as Dict, CFG_GUARD_CLI)) return;
  // El detalle ACTUAL (6.4: un reintento tardío no regresa datos viejos al tarifario).
  const fresco = await despues.ref.get();
  if (!fresco.exists) return;
  const det = fresco.data() as Dict;
  const relevante = !antes || cambioRelevanteDetalle(antes, det);
  if (relevante || integridadIncompleta(det, CFG_GUARD_CLI)) {
    const reparados = await garantizarIntegridadDetalle(despues.ref, det, CFG_GUARD_CLI); // ✅ V00429
    if (reparados.length > 0) { logger.info(`[${REL_VERSION}] convenioClienteDetalleEscrito: ${event.params.detId} → integridad completada (${reparados.join(', ')})`); return; } // la próxima escritura sincroniza la línea
  }
  if (relevante) {
    const cambio = await sincronizarLineaDeDetalle(event.params.detId, det, 'tarifario_clientes');
    if (cambio) logger.info(`[${REL_VERSION}] convenioClienteDetalleEscrito: ${event.params.detId} → línea del tarifario sincronizada`);
  }
}));

export const convenioProveedorDetalleEscrito = onDocumentWritten({ document: 'convenios_proveedores_detalles/{detId}', ...OPCIONES_TRIGGER }, (event) => conReintento('convenioProveedorDetalleEscrito', event, async () => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  const antes = event.data?.before?.exists ? (event.data.before.data() as Dict) : undefined;
  // ✅ V00442 (Fase 6.1): lista blanca. Un cambio que no toca la relación ni la línea
  //   del tarifario no lee nada (salvo que al convenio le falte algo: el guardián lo completa).
  if (antes && !cambioRelevanteDetalle(antes, despues.data() as Dict) && !integridadIncompleta(despues.data() as Dict, CFG_GUARD_PROV)) return;
  // El detalle ACTUAL (6.4: un reintento tardío no regresa datos viejos al tarifario).
  const fresco = await despues.ref.get();
  if (!fresco.exists) return;
  const det = fresco.data() as Dict;
  const relevante = !antes || cambioRelevanteDetalle(antes, det);
  if (relevante || integridadIncompleta(det, CFG_GUARD_PROV)) {
    const reparados = await garantizarIntegridadDetalle(despues.ref, det, CFG_GUARD_PROV); // ✅ V00429
    if (reparados.length > 0) { logger.info(`[${REL_VERSION}] convenioProveedorDetalleEscrito: ${event.params.detId} → integridad completada (${reparados.join(', ')})`); return; } // la próxima escritura sincroniza la línea
  }
  if (relevante) {
    const cambio = await sincronizarLineaDeDetalle(event.params.detId, det, 'tarifario_proveedores');
    if (cambio) logger.info(`[${REL_VERSION}] convenioProveedorDetalleEscrito: ${event.params.detId} → línea del tarifario sincronizada`);
  }
}));

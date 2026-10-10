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
import { derivarDesdeConvenio } from './dominio/operacionCanonica.js';
import { ESQUEMA_OPERACION_VERSION, ID_MXN, ID_USD } from './dominio/constantes.js';
import { agregadosFactura, conversionOperacion, totalNativoDeRenglonesLegado, totalNativoFactura } from './dominio/dinero.js';
import { aNumero, deCentavos, r2 } from './dominio/numeros.js';
import { borrarRenglones, proyectarRenglones } from './proyecciones.js';
import { cambiosCobroPuente } from './puentesYDiesel.js';

if (getApps().length === 0) initializeApp();
const dbRel = getFirestore();

const REL_VERSION = 'relacional-v1.7'; // ✅ V00299: + sync INVERSA detalle→línea del tarifario · ✅ V00429: + guardián de integridad del convenio · ✅ V00440: + campos canónicos · ✅ V00441: + dinero y cobro del puente

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

export const operacionEscrita = onDocumentWritten({ document: 'operaciones/{opId}', region: 'us-central1' }, async (event) => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return; // borrado: nada que normalizar
  const x = despues.data() as Record<string, unknown>;
  const antes = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : undefined;
  try {
    const cambios = await calcularCambiosOperacion(event.params.opId, antes, x);
    if (Object.keys(cambios).length === 0) return; // anti-bucle: ya está íntegra
    await despues.ref.update(cambios, { lastUpdateTime: despues.updateTime });
    logger.info(`[${REL_VERSION}] operacionEscrita: ${String(x.ref || event.params.opId)} normalizada`, Object.keys(cambios));
  } catch (e) {
    if (esNoExiste(e)) return; // se borró mientras se calculaba
    if (!esPrecondicion(e)) {
      logger.error(`[${REL_VERSION}] operacionEscrita: fallo en ${event.params.opId}`, e);
      return;
    }
    // Cambió mientras se calculaba: se recalcula con el dato actual, en transacción.
    try {
      await dbRel.runTransaction(async (tx) => {
        const actual = await tx.get(despues.ref);
        if (!actual.exists) return;
        const cambios = await calcularCambiosOperacion(event.params.opId, antes, actual.data() as Record<string, unknown>);
        if (Object.keys(cambios).length > 0) tx.update(despues.ref, cambios);
      });
    } catch (e2) {
      logger.error(`[${REL_VERSION}] operacionEscrita: fallo al recalcular ${event.params.opId}`, e2);
    }
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
  invalidarCatalogoServidor('catalogo_carga_vacia');
  const antes = String((event.data?.before.data() as Record<string, unknown> | undefined)?.nombre || '').trim();
  const despues = String((event.data?.after.data() as Record<string, unknown> | undefined)?.nombre || '').trim();
  const n = await propagarRenombreCatalogo('carga', antes, despues);
  if (n) logger.info(`[${REL_VERSION}] catalogoCVRenombrado: "${antes}" → "${despues}" en ${n} operación(es).`);
});

export const catalogoAduanaRenombrada = onDocumentUpdated({ document: 'catalogo_aduanas/{id}', region: 'us-central1' }, async (event) => {
  invalidarCatalogoServidor('catalogo_aduanas');
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
  const factUSD = fact === ID_USD || esUSDTextoLegado(nombreMoneda);
  const factMXN = fact === ID_MXN || esMXNTextoLegado(nombreMoneda);
  const monConv = String((lado === 'cliente' ? op.monedaConvenioCliente : op.monedaConvenioProv) || '');
  const convUSD = monConv === ID_USD || (!!monConv && esUSDTextoLegado(monConv));
  const convMXN = monConv === ID_MXN || (!!monConv && esMXNTextoLegado(monConv));
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

/** Cascada Operación → Facturas de un lado (clientes o proveedores). */
const propagarMontoOperacionAFacturas = async (opId: string, op: Dict, lado: 'cliente' | 'proveedor'): Promise<number> => {
  const coleccion = lado === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
  const snap = await dbRel.collection(coleccion).where('operacionesIds', 'array-contains', opId).get();
  if (snap.empty) return 0;
  const m = (await banderaServidor('dineroPorServidor')) ? conversionOperacion(op, lado) : conversionOperacionLegado(op, lado);
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
    const subtotalFactura = r2(ops.reduce((s, o) => s + (Number(o?.monto) || 0), 0));
    const cambios: Dict = { operacionesGuardadas: ops };
    if (difiere(fac.subtotalFactura, subtotalFactura)) cambios.subtotalFactura = subtotalFactura;
    // ✅ V00441 (Fase 5.5): un total capturado a mano (totalManualCentavos) no se pisa.
    if (!(aNumero(fac.totalManualCentavos) > 0)) {
      const subtotalMonedaFactura = totalNativoDeRenglonesLegado(fac, ops);
      if (difiere(fac.subtotalMonedaFactura, subtotalMonedaFactura)) cambios.subtotalMonedaFactura = subtotalMonedaFactura;
    }
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
  const cambios: Dict = {};
  const montoPagado = Number(fac.montoPagado) || 0;
  const tieneAplicaciones = montoPagado > 0 || typeof fac.saldoPendiente === 'number';
  if (tieneAplicaciones) {
    // Sin la bandera: el total de SIEMPRE de este trigger (desde los renglones, V00275),
    // salvo un total manual que haya quedado de cuando la bandera estuvo encendida.
    const manual = aNumero(fac.totalManualCentavos);
    const ops = Array.isArray(fac.operacionesGuardadas) ? (fac.operacionesGuardadas as Dict[]) : [];
    const total = dinero ? totalNativoFactura(fac) : (manual > 0 ? deCentavos(manual) : totalNativoDeRenglonesLegado(fac, ops));
    const saldo = Math.max(0, r2(total - montoPagado));
    const status = saldo <= 0.009 ? 'PAGADA' : (montoPagado > 0 ? 'PARCIAL' : String(fac.statusPago || ''));
    if (difiere(fac.saldoPendiente, saldo)) cambios.saldoPendiente = saldo;
    if (status && String(fac.statusPago || '') !== status) cambios.statusPago = status;
  }
  if (dinero) {
    const ag = agregadosFactura(fac) as unknown as Dict;
    for (const [k, v] of Object.entries(ag)) if (fac[k] !== v) cambios[k] = v;
    if (fac.esquemaDinero !== 2) cambios.esquemaDinero = 2;
    const n = await proyectarRenglones(despues.ref, antes?.exists ? (antes.data() as Dict) : undefined, fac, despues.updateTime);
    if (n) logger.info(`[${REL_VERSION}] ${etiqueta}: ${String(fac.invoice || despues.id)} → ${n} renglón(es) sincronizado(s)`);
  }
  if (Object.keys(cambios).length === 0) return; // anti-bucle
  try {
    await despues.ref.update(cambios, { lastUpdateTime: despues.updateTime });
  } catch (e) {
    const codigo = String((e as { code?: unknown })?.code ?? '').toUpperCase();
    if (codigo === '9' || codigo === 'FAILED_PRECONDITION' || codigo === '5' || codigo === 'NOT_FOUND') return; // cambió o se borró: lo recalcula el siguiente evento
    throw e;
  }
  logger.info(`[${REL_VERSION}] ${etiqueta}: ${String(fac.invoice || despues.id)} saldo/agregados recalculados`, Object.keys(cambios));
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
  if (t.includes('dolar') || t.includes('usd') || String(m) === ID_USD) return 'USD';
  if (t.includes('peso') || t.includes('mxn') || String(m) === ID_MXN) return 'MXN';
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
const CFG_GUARD_CLI: CfgGuard = { tarifarios: 'tarifario_clientes', maestros: 'convenios_clientes', campoId: 'clienteId', campoNombre: 'clienteNombre' };
const CFG_GUARD_PROV: CfgGuard = { tarifarios: 'tarifario_proveedores', maestros: 'convenios_proveedores', campoId: 'proveedorId', campoNombre: 'proveedorNombre' };

export const convenioClienteDetalleEscrito = onDocumentWritten({ document: 'convenios_clientes_detalles/{detId}', region: 'us-central1' }, async (event) => {
  const despues = event.data?.after;
  if (!despues || !despues.exists) return;
  try {
    const reparados = await garantizarIntegridadDetalle(despues.ref, despues.data() as Dict, CFG_GUARD_CLI); // ✅ V00429
    if (reparados.length > 0) { logger.info(`[${REL_VERSION}] convenioClienteDetalleEscrito: ${event.params.detId} → integridad completada (${reparados.join(', ')})`); return; } // la próxima escritura sincroniza la línea
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
    const reparados = await garantizarIntegridadDetalle(despues.ref, despues.data() as Dict, CFG_GUARD_PROV); // ✅ V00429
    if (reparados.length > 0) { logger.info(`[${REL_VERSION}] convenioProveedorDetalleEscrito: ${event.params.detId} → integridad completada (${reparados.join(', ')})`); return; }
    const cambio = await sincronizarLineaDeDetalle(event.params.detId, despues.data() as Dict, 'tarifario_proveedores');
    if (cambio) logger.info(`[${REL_VERSION}] convenioProveedorDetalleEscrito: ${event.params.detId} → línea del tarifario sincronizada`);
  } catch (e) {
    logger.error(`[${REL_VERSION}] convenioProveedorDetalleEscrito: fallo en ${event.params.detId}`, e);
  }
});

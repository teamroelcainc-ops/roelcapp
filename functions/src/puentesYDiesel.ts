/**
 * ✅ V00441 (Fase 5.6 / 5.7) — COBRO DEL PUENTE y SALDO CORRIENTE DE DIESEL en el servidor.
 * ------------------------------------------------------------------------------
 * 5.7 · cambiosCobroPuente(): lo llama operacionEscrita (relacional.ts) cuando una
 *       operación CAMBIA DE ESTATUS y la bandera `cobroPuenteEnServidor` está
 *       encendida. Cubre web, Mis Operaciones y la app móvil (que hoy no cobra).
 *       Idempotente: si la operación ya tiene saldoPuente (> 0) no se vuelve a cobrar.
 *       La regla es dominio/cobroPuente.ts (la misma de OperacionesDashboard) y la
 *       del flujo "🌉 aquí se descuenta el puente" es dominio/flujos.ts.
 * 5.6 · referenciaDieselEscrita: cada referencia de diesel guardada recalcula el
 *       cargado de SU día (y del día anterior si cambió de fecha) en
 *       saldos_corrientes/diesel_<proveedor>. Recalcula, no incrementa: repetir
 *       el evento no duplica. La tarjeta "Saldo Diesel" lo lee con la bandera
 *       `saldosCorrientes` en lugar de escuchar 3,000 referencias.
 * ------------------------------------------------------------------------------
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { conReintento, OPCIONES_TRIGGER } from './eventos.js';
import { CATALOGO_ADUANAS, catalogoServidor } from './canonico';
import { aplicaPeaje, cobroAlCambiarStatus, disparoCobroPuente, puenteYaCobrado, tarifaDeDetalleConvenio } from './dominio/cobroPuente.js';
import type { CtxCobroPuente } from './dominio/cobroPuente.js';
import { COL } from './dominio/constantes.js';
import { aFechaISO, aFechaServicioISO } from './dominio/fechas.js';
import { buscarFlujo, descuentaPuenteSegunFlujo, esStatusAutomatico, normalizarNombreFlujo } from './dominio/flujos.js';
import {
  aporteDiesel, aporteDieselCambio, CLAVE_TODOS_DIESEL, COL_SALDOS_CORRIENTES, diaDiesel, idSaldoDiesel,
} from './dominio/saldosCorrientes.js';

if (getApps().length === 0) initializeApp();

type Datos = Record<string, unknown>;

// ── Catálogos completos en memoria (5 min por contenedor) ──────────────────
const TTL_MS = 5 * 60 * 1000;
const cacheDocs = new Map<string, { datos: Promise<{ id: string; datos: Datos }[]>; ts: number }>();

/** Documentos completos de un catálogo chico (se comparte la promesa; los errores no se guardan). */
export const docsCatalogoServidor = (coleccion: string): Promise<{ id: string; datos: Datos }[]> => {
  const hit = cacheDocs.get(coleccion);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.datos;
  const datos = getFirestore().collection(coleccion).get().then((s) => s.docs.map((d) => ({ id: d.id, datos: d.data() as Datos })));
  cacheDocs.set(coleccion, { datos, ts: Date.now() });
  datos.catch(() => { if (cacheDocs.get(coleccion)?.datos === datos) cacheDocs.delete(coleccion); });
  return datos;
};

/** Para pruebas. */
export const reiniciarCacheCatalogos = (): void => { cacheDocs.clear(); };

/** Hoy en Nuevo Laredo (America/Matamoros sigue el horario de verano de EE. UU.). */
export const hoyOperacion = (ahora = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Matamoros', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);

// ✅ V00465: la tarifa del detalle se lee con la regla compartida (también `tipoConvenioId`,
//   que es donde la guarda Convenios de Clientes).
const tarifaBaseDe = tarifaDeDetalleConvenio;

/** Contexto del cobro para UNA operación: su detalle de convenio y su tarifa (2 lecturas) + catálogos en memoria. */
const contextoCobro = async (db: Firestore, op: Datos): Promise<CtxCobroPuente> => {
  const convenio = String(op.convenio || '').trim();
  const [gastosIncluidos, tiposGasto, aduanas, det] = await Promise.all([
    docsCatalogoServidor('tarifas_gastos_incluidos'),
    docsCatalogoServidor('catalogo_tipos_gastos'),
    catalogoServidor(...CATALOGO_ADUANAS),
    convenio && !convenio.includes('/') ? db.collection(COL.conveniosClientesDetalles).doc(convenio).get() : Promise.resolve(null),
  ]);
  const detalles = new Map<string, Datos>();
  const tarifas = new Map<string, Datos>();
  if (det?.exists) {
    const dd = det.data() as Datos;
    detalles.set(convenio, dd);
    const tb = tarifaBaseDe(dd);
    if (tb && !tb.includes('/')) {
      const t = await db.collection('catalogo_tarifas_referencia').doc(tb).get();
      if (t.exists) tarifas.set(tb, t.data() as Datos);
    }
  }
  return {
    detalles, tarifas,
    gastosIncluidos: gastosIncluidos.map((g) => g.datos),
    tiposGasto: new Map(tiposGasto.map((g) => [g.id, g.datos])),
    aduanas: aduanas.porId,
  };
};

/** Horarios de la operación (una consulta por operacionId). */
const horariosDe = async (db: Firestore, opId: string): Promise<Datos[]> =>
  (await db.collection(COL.horarios).where('operacionId', '==', opId).get()).docs.map((d) => d.data() as Datos);

/** Fecha capturada del movimiento: el horario más reciente de la operación con ese estatus. */
const fechaDeHorarios = (horarios: readonly Datos[], statusId: string, statusNombre: string): string => {
  const nombre = normalizarNombreFlujo(statusNombre);
  const mios = horarios
    .filter((h) => String(h.status || '') === statusId || (nombre && normalizarNombreFlujo(String(h.statusNombre || '')) === nombre))
    .sort((a, b) => String(b.registradoEn || b.fechaHora || '').localeCompare(String(a.registradoEn || a.fechaHora || '')));
  return mios.length ? (aFechaISO(mios[0].fechaHora) ?? '') : '';
};

/** ✅ V00469: una cascada cuenta solo si se registró hace poco (el trigger corre en segundos; con reintentos, minutos). */
export const MINUTOS_CASCADA_VIGENTE = 30;

/**
 * ✅ V00469: los pasos ANTERIORES de la cascada que terminó en `statusId` (Operaciones Activas
 * guarda un horario por paso con el mismo `registradoEn` y su `ordenCascada`), en orden.
 * [] si el último horario de la operación no es ese paso final de una cascada, o si es de hace
 * más de MINUTOS_CASCADA_VIGENTE (una cascada vieja no se vuelve a cobrar con su fecha de entonces).
 */
export const pasosPreviosDeCascada = (horarios: readonly Datos[], statusId: string, ahora = Date.now()): Datos[] => {
  const ultimo = [...horarios].sort((a, b) => String(b.registradoEn || '').localeCompare(String(a.registradoEn || ''))
    || Number(b.ordenCascada ?? 0) - Number(a.ordenCascada ?? 0))[0];
  if (!ultimo || String(ultimo.status || '') !== statusId || !(Number(ultimo.ordenCascada) > 0)) return [];
  const t = Date.parse(String(ultimo.registradoEn || ''));
  if (!Number.isFinite(t) || ahora - t > MINUTOS_CASCADA_VIGENTE * 60_000) return [];
  const clave = String(ultimo.registradoEn || '');
  return horarios
    .filter((h) => String(h.registradoEn || '') === clave && Number(h.ordenCascada) < Number(ultimo.ordenCascada))
    .sort((a, b) => Number(a.ordenCascada) - Number(b.ordenCascada));
};

const CAMPOS_QUE_DECIDEN_PUENTE = ['convenio', 'tipoOperacion', 'tipoOperacionId', 'proveedorUnidad'];

/**
 * Campos del cobro del puente para una operación que acaba de cambiar de estatus
 * ({} si no aplica, ya se cobró o el estatus no lo dispara).
 */
export const cambiosCobroPuente = async (db: Firestore, opId: string, antes: Datos | undefined, x: Datos): Promise<Datos> => {
  const statusId = String(x.status || '').trim();
  if (!statusId) return {};
  // Se evalúa al CAMBIAR DE ESTATUS o, ya en un estatus que cobra, si el USUARIO corrige
  // el convenio, el tipo de operación o el proveedor (sus IDs). Los NOMBRES y lo que
  // deriva el servidor (carga, aduana, tráfico) no cuentan: un renombre en catálogos, la
  // propagación de nombres o una migración nunca cobran operaciones viejas (V00442).
  const cambioStatus = statusId !== String(antes?.status || '').trim();
  const cambioDatos = !!antes && CAMPOS_QUE_DECIDEN_PUENTE.some((c) => String(antes[c] ?? '') !== String(x[c] ?? ''));
  if (!cambioStatus && !cambioDatos) return {};
  if (puenteYaCobrado(x)) return {}; // nunca se cobra dos veces (✅ V00469: un 0 no cuenta como cobrado)
  if (!aplicaPeaje(x)) return {}; // V00369: solo Transfer y Logística de Cruces de Roelca
  const statusNombre = String(x.statusNombre || '');
  const flujos = await docsCatalogoServidor(COL.flujosOperacion);
  const flujo = buscarFlujo(x, flujos);
  const reglaDe = (nombre: string) => descuentaPuenteSegunFlujo(flujo?.datos ?? null, nombre);
  const hoy = hoyOperacion();
  const fechaServicioISO = String(x.fechaServicioISO || '') || aFechaServicioISO(x.fechaServicio) || '';
  const dispara = (id: string, nombre: string) => !!disparoCobroPuente({ statusId: id, statusNombre: nombre, flagFlujo: reglaDe(nombre), hoy, fechaServicioISO, fechaEvento: '' });
  // ✅ V00469: a un estatus AUTOMÁTICO se llega en CASCADA (un clic que pasa por varios). Los pasos
  //   del mismo clic (p. ej. Verde MX → Completado, o Verde USA → En tránsito) se prueban EN ORDEN y
  //   cobra el primero que da un cobro, como en Operaciones Activas. Solo entonces se leen los horarios.
  let horarios: Datos[] | null = null;
  const pasos: { statusId: string; statusNombre: string }[] = [];
  if (cambioStatus && esStatusAutomatico(flujo?.datos ?? null, statusNombre)) {
    horarios = await horariosDe(db, opId);
    for (const h of pasosPreviosDeCascada(horarios, statusId)) pasos.push({ statusId: String(h.status || ''), statusNombre: String(h.statusNombre || '') });
  }
  pasos.push({ statusId, statusNombre });
  // Antes de leer nada más: ¿algún paso siquiera dispara el cobro?
  const candidatos = pasos.filter((p) => dispara(p.statusId, p.statusNombre));
  if (candidatos.length === 0) return {};
  const [ctx, hs] = await Promise.all([contextoCobro(db, x), horarios ? Promise.resolve(horarios) : horariosDe(db, opId)]);
  for (const p of candidatos) {
    const fechaEvento = fechaDeHorarios(hs, p.statusId, p.statusNombre);
    const campos = cobroAlCambiarStatus(ctx, x, { ...p, flagFlujo: reglaDe(p.statusNombre), hoy, fechaServicioISO, fechaEvento });
    if (Object.keys(campos).length > 0) return { ...campos, puenteCobradoEn: new Date().toISOString(), puenteCobradoPor: 'servidor' };
  }
  return {};
};

// ── 5.6 Saldo corriente de diesel ─────────────────────────────────────────
const refSaldo = (db: Firestore, clave: string): DocumentReference => db.collection(COL_SALDOS_CORRIENTES).doc(idSaldoDiesel(clave));

/** Recalcula, en transacción, el cargado de un día para las claves indicadas (+ la general). */
export const recalcularDiaDiesel = async (db: Firestore, fecha: string, claves: readonly string[]): Promise<void> => {
  const todas = Array.from(new Set([...claves.filter(Boolean), CLAVE_TODOS_DIESEL]));
  await db.runTransaction(async (tx: Transaction) => {
    // Se LEEN primero los documentos de saldo: dos recálculos del mismo día se
    // serializan y el último siempre ve todas las referencias ya guardadas.
    await Promise.all(todas.map((k) => tx.get(refSaldo(db, k))));
    const refsDia = await tx.get(db.collection(COL.referenciasDiesel).where('fecha', '==', fecha));
    const dia = diaDiesel(refsDia.docs.map((d) => d.data() as Datos));
    for (const k of todas) {
      const v = dia.get(k);
      const datos: Datos = {
        tipo: 'diesel', clave: k, actualizadoEn: new Date().toISOString(),
        dias: { [fecha]: v ? { c: v.c, n: v.n } : FieldValue.delete() },
      };
      if (v?.nombre) datos.nombre = v.nombre;
      tx.set(refSaldo(db, k), datos, { merge: true });
    }
  });
};

export const referenciaDieselEscrita = onDocumentWritten({ document: 'referencias_diesel/{refId}', ...OPCIONES_TRIGGER }, (event) => conReintento('referenciaDieselEscrita', event, async () => {
  const antes = event.data?.before?.exists ? (event.data.before.data() as Datos) : undefined;
  const despues = event.data?.after?.exists ? (event.data.after.data() as Datos) : undefined;
  if (!aporteDieselCambio(antes, despues)) return; // fotos, observaciones…: no mueve el saldo
  const db = getFirestore();
  const a = aporteDiesel(antes);
  const d = aporteDiesel(despues);
  const porFecha = new Map<string, Set<string>>();
  for (const ap of [a, d]) {
    if (!ap || !ap.fecha) continue;
    porFecha.set(ap.fecha, new Set([...(porFecha.get(ap.fecha) ?? []), ap.clave]));
  }
  for (const [fecha, claves] of porFecha) await recalcularDiaDiesel(db, fecha, Array.from(claves));
}));

/**
 * ✅ V00441 (Fase 5.2 / 5.3) — Renglones y aplicaciones como TABLAS HIJAS.
 * ------------------------------------------------------------------------------
 *   facturas_x/{id}/renglones/{opId}      ← proyección de operacionesGuardadas
 *   facturas_x/{id}/aplicaciones/{pagoId} ← proyección de pagos.facturas[]
 *
 * Mientras la app siga leyendo los arreglos (operacionesGuardadas, facturas[]),
 * ESOS son la fuente y estas subcolecciones se mantienen solas desde aquí, sin
 * importar quién escribió (la web, una callable o un script). Así las consultas
 * nuevas (Fase 7) ya pueden leer renglones sueltos y paginados. Cuando todo lea
 * las subcolecciones (P4) se invierte la dirección y se borran los arreglos.
 *
 * Solo con la bandera `dineroPorServidor`. Cada evento escribe ÚNICAMENTE los
 * renglones/aplicaciones que cambiaron (compara antes/después del evento), en una
 * transacción que relee el documento: si el evento llegó TARDE (el documento ya
 * cambió otra vez), no se escribe lo del evento sino lo VIGENTE y se borra lo que
 * salió — así un evento viejo nunca deja la tabla hija atrasada.
 * ------------------------------------------------------------------------------
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentReference, Timestamp, Transaction } from 'firebase-admin/firestore';
import { banderaServidor } from './flags.js';
import { conReintento, OPCIONES_TRIGGER } from './eventos.js';
import { aplicadoPorFactura, monedaDeFactura, renglonEnCentavos } from './dominio/dinero.js';
import { aCentavos } from './dominio/numeros.js';

if (getApps().length === 0) initializeApp();

type Datos = Record<string, unknown>;
const LOTE = 450;

const renglonesDe = (fac: Datos | undefined): Map<string, string> => {
  const mapa = new Map<string, string>();
  if (!fac) return mapa;
  const moneda = monedaDeFactura(fac);
  for (const r of Array.isArray(fac.operacionesGuardadas) ? fac.operacionesGuardadas : []) {
    const id = String((r as Datos)?.id ?? '').trim();
    if (!id || id.includes('/')) continue;
    mapa.set(id, JSON.stringify(renglonEnCentavos(r, moneda)));
  }
  return mapa;
};

type Escritura = { ref: DocumentReference; datos: Datos | null };

/** Escribe en lotes (≤ 450 por commit). */
const escribirEnLotes = async (ops: Escritura[]): Promise<void> => {
  const db = getFirestore();
  for (let i = 0; i < ops.length; i += LOTE) {
    const lote = db.batch();
    ops.slice(i, i + LOTE).forEach(({ ref, datos }) => (datos ? lote.set(ref, datos) : lote.delete(ref)));
    await lote.commit();
  }
};

/** ¿El documento sigue en la versión del evento? (si no, el evento llegó tarde). */
const esVigente = (actual: { exists: boolean; updateTime?: Timestamp }, existeEnEvento: boolean, version: Timestamp | undefined): boolean =>
  (actual.exists ? existeEnEvento && !!version && !!actual.updateTime?.isEqual(version) : !existeEnEvento);

/**
 * Escrituras de una proyección: con el evento VIGENTE, solo la diferencia
 * antes→después; con el evento TARDE, todo lo vigente + borrar lo que salió.
 */
export const escriturasProyeccion = (
  vigente: boolean, a: ReadonlyMap<string, string>, d: ReadonlyMap<string, string>, actual: ReadonlyMap<string, string>,
): { poner: string[]; quitar: string[] } => {
  if (vigente) {
    return { poner: Array.from(d.keys()).filter((k) => a.get(k) !== d.get(k)), quitar: Array.from(a.keys()).filter((k) => !d.has(k)) };
  }
  const salieron = new Set([...a.keys(), ...d.keys()]);
  return { poner: Array.from(actual.keys()), quitar: Array.from(salieron).filter((k) => !actual.has(k)) };
};

/** Corre las escrituras dentro de la transacción (o en lotes si no caben en una). */
const aplicar = (tx: Transaction, ops: Escritura[]): Escritura[] => {
  if (ops.length > LOTE) return ops; // no cabe en una transacción: se escribe después en lotes
  ops.forEach(({ ref, datos }) => (datos ? tx.set(ref, datos) : tx.delete(ref)));
  return [];
};

/**
 * Sincroniza facturas_x/{id}/renglones con operacionesGuardadas. `antes`/`despues`
 * son los datos del evento y `version` el updateTime de `despues`. Devuelve cuántos tocó.
 */
export const proyectarRenglones = async (
  ref: DocumentReference, antes: Datos | undefined, despues: Datos | undefined, version?: Timestamp,
): Promise<number> => {
  const db = getFirestore();
  let pendientes: Escritura[] = [];
  const n = await db.runTransaction(async (tx) => {
    const actual = await tx.get(ref);
    const vigente = esVigente(actual, despues !== undefined, version);
    const mapaActual = renglonesDe(actual.exists ? (actual.data() as Datos) : undefined);
    const { poner, quitar } = escriturasProyeccion(vigente, renglonesDe(antes), renglonesDe(despues), mapaActual);
    const ops: Escritura[] = [
      ...poner.map((opId) => ({ ref: ref.collection('renglones').doc(opId), datos: { ...JSON.parse(mapaActual.get(opId) as string), opId } })),
      ...quitar.map((opId) => ({ ref: ref.collection('renglones').doc(opId), datos: null })),
    ];
    pendientes = aplicar(tx, ops);
    return ops.length;
  });
  await escribirEnLotes(pendientes);
  return n;
};

/** Borra la subcolección de renglones de una factura eliminada (si no se volvió a crear). */
export const borrarRenglones = async (ref: DocumentReference): Promise<number> => {
  if ((await ref.get()).exists) return proyectarRenglones(ref, undefined, undefined); // se recreó: se sincroniza con lo vigente
  const snap = await ref.collection('renglones').select().get();
  await escribirEnLotes(snap.docs.map((d) => ({ ref: d.ref, datos: null })));
  return snap.size;
};

const coleccionDeTipo = (tipo: unknown): string | null =>
  tipo === 'cliente' ? 'facturas_clientes' : tipo === 'proveedor' ? 'facturas_proveedores' : null;

/** Lo que un pago aplica por factura, en centavos (vacío para MTTO). */
const aplicacionesDe = (pago: Datos | undefined): Map<string, Datos> => {
  const mapa = new Map<string, Datos>();
  if (!pago || !coleccionDeTipo(pago.tipo)) return mapa;
  aplicadoPorFactura(pago.facturas).forEach((monto, facturaId) => {
    if (facturaId.includes('/')) return;
    mapa.set(facturaId, {
      aplicadoCentavos: aCentavos(monto), fecha: String(pago.fecha ?? ''), numeroPago: String(pago.numeroPago ?? ''), tipo: pago.tipo,
    });
  });
  return mapa;
};

/** Clave estable "coleccion|facturaId" → datos JSON de la aplicación. */
const aplicacionesPorClave = (pago: Datos | undefined): Map<string, string> => {
  const col = coleccionDeTipo(pago?.tipo);
  const mapa = new Map<string, string>();
  if (!col) return mapa;
  aplicacionesDe(pago).forEach((datos, facturaId) => mapa.set(`${col}|${facturaId}`, JSON.stringify(datos)));
  return mapa;
};

/** pagos/{id} escrito → facturas_x/{facturaId}/aplicaciones/{pagoId}. */
export const pagoEscrito = onDocumentWritten({ document: 'pagos/{pagoId}', ...OPCIONES_TRIGGER }, (event) => conReintento('pagoEscrito', event, async () => {
  {
    if (!(await banderaServidor('dineroPorServidor'))) return;
    const pagoId = event.params.pagoId;
    const antes = event.data?.before?.exists ? (event.data.before.data() as Datos) : undefined;
    const despues = event.data?.after?.exists ? (event.data.after.data() as Datos) : undefined;
    // ✅ V00442 (Fase 6.1): solo si cambió lo que se proyecta (facturas, tipo, fecha o número).
    if (antes && despues && ['facturas', 'tipo', 'fecha', 'numeroPago'].every((k) => JSON.stringify(antes[k]) === JSON.stringify(despues[k]))) return;
    const db = getFirestore();
    const refPago = db.collection('pagos').doc(pagoId);
    const destino = (clave: string): DocumentReference => {
      const [col, facturaId] = clave.split('|');
      return db.collection(col).doc(facturaId).collection('aplicaciones').doc(pagoId);
    };
    let pendientes: Escritura[] = [];
    const n = await db.runTransaction(async (tx) => {
      const actual = await tx.get(refPago);
      const vigente = esVigente(actual, despues !== undefined, event.data?.after?.updateTime);
      const mapaActual = aplicacionesPorClave(actual.exists ? (actual.data() as Datos) : undefined);
      const { poner, quitar } = escriturasProyeccion(vigente, aplicacionesPorClave(antes), aplicacionesPorClave(despues), mapaActual);
      const ops: Escritura[] = [
        ...poner.map((k) => ({ ref: destino(k), datos: { ...JSON.parse(mapaActual.get(k) as string), pagoId } })),
        ...quitar.map((k) => ({ ref: destino(k), datos: null })),
      ];
      pendientes = aplicar(tx, ops);
      return ops.length;
    });
    await escribirEnLotes(pendientes);
    if (n) logger.info(`[proyecciones] pago ${pagoId}: ${n} aplicación(es) sincronizada(s)`);
  }
}));

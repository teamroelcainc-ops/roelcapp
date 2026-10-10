/**
 * ✅ V00442 (Fase 6.2) — PROPAGACIÓN DE NOMBRES con UN mapa.
 * ------------------------------------------------------------------------------
 * Las copias `*Nombre` (para pintar tablas sin leer catálogos) las mantiene el
 * servidor: al renombrar un maestro se actualizan todos los documentos que lo
 * referencian POR SU ID (el de siempre y el canónico), una escritura por documento.
 * Reemplaza a los botones "Sincronizar nombres" / "🏷 Razón social" (se ocultan con
 * la bandera; se borran en P4) y al empresaActualizada viejo (solo `nombre`, 6 destinos).
 *
 * EL mapa y las reglas (razón social / nombre corto por destino) están en
 * dominio/nombres.ts (compartido con el script que pone todo al día).
 * Los detalles de convenio NO se propagan todavía: su descripción alimenta "EL CONVENIO
 * MANDA" (carga/aduana de operaciones pasadas) — ver code-notes.md.
 *
 * Bandera `propagacionEnServidor` (apagada: no hace nada y sigue el trigger viejo).
 * Antes de encenderla: `npm run nombres` (simulación → --aplicar) deja todo al día.
 * ------------------------------------------------------------------------------
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { BulkWriter, Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { conReintento, OPCIONES_TRIGGER } from './eventos.js';
import { banderaServidor } from './flags.js';
import { cambiosDeNombres, cambioDeNombre, maestroDe } from './dominio/nombres.js';
import type { Destino, Maestro } from './dominio/nombres.js';
export { cambiosDeNombres, MAESTROS } from './dominio/nombres.js';

if (getApps().length === 0) initializeApp();

type Datos = Record<string, unknown>;

/** Propaga un maestro (sus datos ACTUALES) a sus destinos: una escritura por documento. */
export const propagarMaestro = async (db: Firestore, maestro: Maestro, id: string, datos: Datos): Promise<number> => {
  const mapa = new Map([[maestro.coleccion, new Map([[id, datos]])]]);
  const porColeccion = new Map<string, Destino[]>();
  maestro.destinos.forEach((d) => porColeccion.set(d.coleccion, [...(porColeccion.get(d.coleccion) ?? []), d]));
  const bw: BulkWriter = db.bulkWriter();
  let n = 0; let fallas = 0;
  try {
    for (const [coleccion, destinos] of porColeccion) {
      const campos = Array.from(new Set(destinos.flatMap((d) => [d.campoId, d.campoNombre, ...(d.campoIdCanonico ? [d.campoIdCanonico] : [])])));
      const camposId = Array.from(new Set(destinos.flatMap((d) => [d.campoId, ...(d.campoIdCanonico ? [d.campoIdCanonico] : [])])));
      const vistos = new Set<string>();
      for (const campo of camposId) {
        const snap = await db.collection(coleccion).where(campo, '==', id).select(...campos).get();
        for (const doc of snap.docs) {
          if (vistos.has(doc.id)) continue;
          vistos.add(doc.id);
          const cambios = cambiosDeNombres(coleccion, doc.data() as Datos, mapa);
          if (Object.keys(cambios).length === 0) continue;
          n += 1;
          bw.update(doc.ref, cambios).catch((e: unknown) => { fallas += 1; logger.error(`[propagacion] ${coleccion}/${doc.id}`, e); });
        }
      }
    }
  } finally {
    await bw.close();
  }
  if (fallas > 0) throw new Error(`[propagacion] ${maestro.coleccion}/${id}: ${fallas} escritura(s) fallaron (se reintenta)`);
  return n;
};

/**
 * Si cambió un nombre del maestro (lista blanca) y la bandera está encendida, lo
 * propaga con los datos ACTUALES del maestro (un reintento tardío no regresa un nombre
 * viejo). La usan los triggers de aquí y empresaActualizada.
 */
export const propagarSiCambioNombre = async (coleccion: string, id: string, antes: Datos | undefined, despues: Datos | undefined): Promise<number> => {
  if (!antes || !despues) return 0;
  const maestro = maestroDe(coleccion);
  if (!cambioDeNombre(maestro, antes, despues)) return 0;
  if (!(await banderaServidor('propagacionEnServidor'))) return 0;
  const db = getFirestore();
  const actual = await db.collection(coleccion).doc(id).get();
  if (!actual.exists) return 0;
  const n = await propagarMaestro(db, maestro, id, actual.data() as Datos);
  logger.info(`[propagacion] ${coleccion}/${id} → ${n} documento(s)`);
  return n;
};

/** Renombres que tocan miles de operaciones: más tiempo y memoria que un trigger normal. */
export const OPCIONES_PROPAGACION = { ...OPCIONES_TRIGGER, timeoutSeconds: 540, memory: '512MiB' } as const;

const triggerDe = (coleccion: string) => onDocumentUpdated({ document: `${coleccion}/{id}`, ...OPCIONES_PROPAGACION }, (event) =>
  conReintento(`propagacion:${coleccion}`, event, async () => {
    await propagarSiCambioNombre(coleccion, event.params.id, event.data?.before.data() as Datos | undefined, event.data?.after.data() as Datos | undefined);
  }));

// Maestros SIN trigger previo. Empresas usa propagarSiCambioNombre desde empresaActualizada.
export const propagarStatus = triggerDe('catalogo_status_servicio');
export const propagarTipoOperacion = triggerDe('catalogo_tipo_operacion');
export const propagarUnidad = triggerDe('unidades');
export const propagarEmpleado = triggerDe('empleados');

/**
 * ✅ V00440 (Fase 4.4) — Banderas de la refactorización leídas desde el servidor.
 * ------------------------------------------------------------------------------
 * Mismo documento que usa la web (`configuracion/flags`). Se guarda en memoria
 * del contenedor 60 s: los triggers se disparan seguido y una bandera se cambia
 * a mano muy de vez en cuando. Si el documento no existe o falla la lectura,
 * todas las banderas valen `false` (camino viejo).
 * ------------------------------------------------------------------------------
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { COL, DOC_FLAGS } from './dominio/constantes.js';

if (getApps().length === 0) initializeApp();

const TTL_MS = 60 * 1000;
let cache: { datos: Record<string, unknown>; ts: number } | null = null;

/** Valor de una bandera (true solo si el documento la tiene en `true`). */
export const banderaServidor = async (nombre: string): Promise<boolean> => {
  if (!cache || Date.now() - cache.ts > TTL_MS) {
    try {
      const snap = await getFirestore().collection(COL.configuracion).doc(DOC_FLAGS).get();
      cache = { datos: (snap.data() ?? {}) as Record<string, unknown>, ts: Date.now() };
    } catch (e) {
      logger.error('[flags] No se pudo leer configuracion/flags; todas apagadas.', e);
      cache = { datos: {}, ts: Date.now() };
    }
  }
  return cache.datos[nombre] === true;
};

/**
 * ✅ V00441: la bandera leída AL MOMENTO (sin los 60 s de memoria). La usan las
 * callables de dinero: la web y las reglas ven el cambio al instante, así que el
 * servidor no debe rechazar durante un minuto después de encenderla. 1 lectura por llamada.
 */
export const banderaServidorFresca = async (nombre: string): Promise<boolean> => {
  cache = null;
  return banderaServidor(nombre);
};

/** Para pruebas. */
export const reiniciarCacheBanderas = (): void => { cache = null; };

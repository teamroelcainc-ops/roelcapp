// src/features/conveniosClientes/services/tarifasReferenciaService.ts
//
// Helper para resolver `tipoConvenioId` → `descripcion` (catalogo_tarifas_referencia)
// con UNA SOLA lectura por sesión.
//
// - Cache en memoria (Map) → 0 lecturas en la misma vida del componente
// - Cache en sessionStorage → 0 lecturas tras recargar la página dentro de la sesión
// - Sólo lee Firestore si NO hay cache (primera vez por sesión)
// - inFlight: si dos componentes llaman al mismo tiempo, solo hay UN getDocs

import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';

const CACHE_KEY = 'roelca_catalogo_tarifas_ref_v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

let memoryCache: { data: Record<string, any>; ts: number } | null = null;
let inFlight: Promise<Record<string, any>> | null = null;

/**
 * Devuelve un mapa { tarifaId → docCompleto } de catalogo_tarifas_referencia.
 * Usa cache en memoria + sessionStorage. Sólo lee Firestore la primera vez
 * por sesión (o cuando expira el TTL).
 */
export const obtenerTarifasReferencia = async (): Promise<Record<string, any>> => {
  if (memoryCache && Date.now() - memoryCache.ts < CACHE_TTL_MS) {
    return memoryCache.data;
  }

  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.ts === 'number' && Date.now() - parsed.ts < CACHE_TTL_MS) {
        memoryCache = { data: parsed.data, ts: parsed.ts };
        return parsed.data;
      }
    }
  } catch { /* noop */ }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const snap = await getDocs(collection(db, 'catalogo_tarifas_referencia'));
      const data: Record<string, any> = {};
      snap.docs.forEach(d => { data[d.id] = { id: d.id, ...d.data() }; });

      const ts = Date.now();
      memoryCache = { data, ts };
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts })); } catch { /* quota */ }
      return data;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};

/**
 * Helper síncrono: dado un id y el mapa ya cargado, devuelve la descripción.
 */
export const descripcionDeTipoConvenio = (
  tipoConvenioId: string | undefined | null,
  tarifasRef: Record<string, any>
): string => {
  if (!tipoConvenioId) return '';
  const doc = tarifasRef[String(tipoConvenioId)];
  if (!doc) return '';
  return doc.descripcion || doc.nombre || '';
};

/**
 * Invalida el cache (útil si en algún punto se editan tarifas y hay que recargar).
 */
export const limpiarCacheTarifasReferencia = () => {
  memoryCache = null;
  try { sessionStorage.removeItem(CACHE_KEY); } catch { /* noop */ }
};
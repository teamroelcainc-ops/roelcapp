// src/shared/data/medidor/firestoreMedido.ts
// ---------------------------------------------------------------------------
// ✅ V00436 (Fase 0) — MEDIDOR DE LECTURAS (solo desarrollo).
//
// Con `npm run dev:medir` (vite --mode medir) vite.config.ts redirige
// `firebase/firestore` a ESTE archivo. Reexporta todo el SDK y reemplaza las
// funciones que leen para contar cuántos documentos cobra cada colección y
// cada módulo. En producción y en `npm run dev` normal este archivo NO se usa.
//
// En la consola del navegador:
//   __lecturas.marcar('Abrir Facturación')   empieza una acción nueva
//   __lecturas.tabla()                        documentos por colección y módulo
//   __lecturas.acciones()                     total por acción (para la tabla de CAMBIOS)
//   __lecturas.listeners()                    listeners vivos ahora mismo
//   __lecturas.reiniciar()
//
// Cómo cuenta (aproximado, igual que la facturación de Firestore):
//   · getDocs / getDocsFromServer: 1 lectura por documento devuelto (mínimo 1).
//   · getDoc: 1 lectura (exista o no).
//   · onSnapshot: el primer snapshot del SERVIDOR cobra todos sus documentos;
//     los siguientes, solo los que cambiaron. Lo servido desde la caché local
//     se registra aparte como "caché" (no se cobra).
//   · getCountFromServer / getAggregateFromServer: 1 lectura por llamada
//     (Firestore cobra 1 por cada 1,000 entradas de índice).
// ---------------------------------------------------------------------------
export * from '@firebase/firestore';
import * as sdk from '@firebase/firestore';
import type {
  DocumentReference, DocumentSnapshot, Query, QuerySnapshot, DocumentData,
  AggregateSpec, AggregateQuerySnapshot,
} from '@firebase/firestore';

interface Registro { lecturas: number; cache: number; llamadas: number }
const porClave = new Map<string, Registro>();
const porAccion = new Map<string, number>();
const listenersVivos = new Map<number, string>();
let accionActual = '(sin acción)';
let siguienteListener = 1;

/** Ruta legible de una consulta o referencia (usa internos del SDK con respaldo). */
const rutaDe = (objetivo: unknown): string => {
  try {
    const o = objetivo as { path?: string; type?: string; _query?: { path?: { canonicalString?: () => string } } };
    if (o.type === 'collection' || o.type === 'document') return String(o.path ?? '?');
    const canon = o._query?.path?.canonicalString?.();
    return canon || '?';
  } catch {
    return '?';
  }
};

/** Módulo que hizo la llamada, tomado de la pila (solo en desarrollo hay rutas de src/). */
const moduloLlamador = (): string => {
  const pila = new Error().stack ?? '';
  const lineas = pila.split('\n').slice(2);
  for (const l of lineas) {
    if (l.includes('/medidor/')) continue;
    const m = l.match(/\/src\/(.+?\.(?:tsx?|jsx?))/);
    if (m) {
      const ruta = m[1];
      const feat = ruta.match(/^features\/([^/]+)\/.*?([^/]+)\.(?:tsx?|jsx?)$/);
      return feat ? `${feat[1]}/${feat[2]}` : ruta;
    }
  }
  return '?';
};

const anotar = (coleccion: string, modulo: string, lecturas: number, cache: number): void => {
  const clave = `${coleccion} ← ${modulo}`;
  const r = porClave.get(clave) ?? { lecturas: 0, cache: 0, llamadas: 0 };
  r.lecturas += lecturas;
  r.cache += cache;
  r.llamadas += 1;
  porClave.set(clave, r);
  porAccion.set(accionActual, (porAccion.get(accionActual) ?? 0) + lecturas);
};

export async function getDocs<A, D extends DocumentData>(q: Query<A, D>): Promise<QuerySnapshot<A, D>> {
  const modulo = moduloLlamador();
  const snap = await sdk.getDocs(q);
  const desdeCache = snap.metadata.fromCache;
  anotar(rutaDe(q), modulo, desdeCache ? 0 : Math.max(1, snap.size), desdeCache ? snap.size : 0);
  return snap;
}

export async function getDocsFromServer<A, D extends DocumentData>(q: Query<A, D>): Promise<QuerySnapshot<A, D>> {
  const modulo = moduloLlamador();
  const snap = await sdk.getDocsFromServer(q);
  anotar(rutaDe(q), modulo, Math.max(1, snap.size), 0);
  return snap;
}

export async function getDocsFromCache<A, D extends DocumentData>(q: Query<A, D>): Promise<QuerySnapshot<A, D>> {
  const modulo = moduloLlamador();
  const snap = await sdk.getDocsFromCache(q);
  anotar(rutaDe(q), modulo, 0, snap.size);
  return snap;
}

export async function getDoc<A, D extends DocumentData>(ref: DocumentReference<A, D>): Promise<DocumentSnapshot<A, D>> {
  const modulo = moduloLlamador();
  const snap = await sdk.getDoc(ref);
  const desdeCache = snap.metadata.fromCache;
  anotar(rutaDe(ref), modulo, desdeCache ? 0 : 1, desdeCache ? 1 : 0);
  return snap;
}

export async function getCountFromServer<A, D extends DocumentData>(
  q: Query<A, D>,
): Promise<AggregateQuerySnapshot<{ count: sdk.AggregateField<number> }, A, D>> {
  const modulo = moduloLlamador();
  const r = await sdk.getCountFromServer(q);
  anotar(`${rutaDe(q)} (count)`, modulo, 1, 0);
  return r;
}

export async function getAggregateFromServer<S extends AggregateSpec, A, D extends DocumentData>(
  q: Query<A, D>, spec: S,
): Promise<AggregateQuerySnapshot<S, A, D>> {
  const modulo = moduloLlamador();
  const r = await sdk.getAggregateFromServer(q, spec);
  anotar(`${rutaDe(q)} (aggregate)`, modulo, 1, 0);
  return r;
}

/**
 * onSnapshot con conteo. Acepta todas las firmas del SDK (referencia de
 * documento o consulta, con o sin opciones, con observer u callbacks).
 */
export function onSnapshot(...args: unknown[]): sdk.Unsubscribe {
  const modulo = moduloLlamador();
  const objetivo = args[0];
  const ruta = rutaDe(objetivo);
  const id = siguienteListener++;
  listenersVivos.set(id, `${ruta} ← ${modulo}`);
  let primeroDelServidor = true;

  const contar = (snap: unknown): void => {
    const s = snap as {
      metadata: { fromCache: boolean };
      size?: number;
      docChanges?: () => unknown[];
      exists?: () => boolean;
    };
    const esConsulta = typeof s.docChanges === 'function';
    if (s.metadata.fromCache) {
      anotar(ruta, modulo, 0, esConsulta ? (s.size ?? 0) : 1);
      return;
    }
    if (primeroDelServidor) {
      primeroDelServidor = false;
      anotar(ruta, modulo, esConsulta ? Math.max(1, s.size ?? 0) : 1, 0);
      return;
    }
    anotar(ruta, modulo, esConsulta ? (s.docChanges?.().length ?? 0) : 1, 0);
  };

  // Envuelve el primer callback/observer "next" que aparezca en los argumentos.
  const nuevos = args.map((a, i) => {
    if (i === 0) return a;
    if (typeof a === 'function') {
      const original = a as (x: unknown) => void;
      // Solo el PRIMER function es el "next"; los siguientes son error/complete.
      const yaEnvuelto = args.slice(1, i).some((b) => typeof b === 'function');
      if (yaEnvuelto) return a;
      return (snap: unknown) => { contar(snap); original(snap); };
    }
    if (a && typeof a === 'object' && typeof (a as { next?: unknown }).next === 'function') {
      const obs = a as { next: (x: unknown) => void };
      return { ...obs, next: (snap: unknown) => { contar(snap); obs.next(snap); } };
    }
    return a;
  });

  const cancelar = (sdk.onSnapshot as unknown as (...xs: unknown[]) => sdk.Unsubscribe)(...nuevos);
  return () => {
    listenersVivos.delete(id);
    cancelar();
  };
}

// ── API de consola ─────────────────────────────────────────────────────────
const api = {
  marcar(nombre: string): void {
    accionActual = nombre;
    porAccion.set(nombre, 0);
    console.info(`[lecturas] acción: ${nombre}`);
  },
  tabla(): void {
    const filas = Array.from(porClave.entries())
      .map(([clave, r]) => ({ clave, lecturas: r.lecturas, cache: r.cache, llamadas: r.llamadas }))
      .sort((a, b) => b.lecturas - a.lecturas);
    console.table(filas);
  },
  acciones(): void {
    console.table(Array.from(porAccion.entries()).map(([accion, lecturas]) => ({ accion, lecturas })));
  },
  listeners(): void {
    console.info(`[lecturas] ${listenersVivos.size} listener(s) vivos`);
    console.table(Array.from(listenersVivos.values()).map((l) => ({ listener: l })));
  },
  reiniciar(): void {
    porClave.clear();
    porAccion.clear();
    accionActual = '(sin acción)';
  },
};

declare global {
  interface Window { __lecturas?: typeof api }
}
if (typeof window !== 'undefined') {
  window.__lecturas = api;
  console.info('[lecturas] Medidor activo: usa __lecturas.marcar("…"), __lecturas.tabla(), __lecturas.listeners()');
}

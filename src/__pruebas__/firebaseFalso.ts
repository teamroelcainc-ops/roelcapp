// src/__pruebas__/firebaseFalso.ts
// ---------------------------------------------------------------------------
// ✅ V00445 — Firebase FALSO para las pruebas de humo de los módulos: contesta
// "sin datos" a todo (lecturas vacías, escuchas que entregan una lista vacía,
// escrituras que no hacen nada). `estadoFalso.flags` decide qué devuelve el
// documento configuracion/flags (null = no existe → todas apagadas).
// ---------------------------------------------------------------------------
export const estadoFalso: { flags: Record<string, boolean> | null } = { flags: null };

const rutaDe = (ref: unknown): string => String((ref as { path?: unknown } | null)?.path ?? '');

/** Sirve igual para una consulta (sin documentos) que para un documento (no existe). */
const snapVacio = () => ({
  docs: [], empty: true, size: 0, forEach: () => {}, docChanges: () => [],
  id: 'falso', exists: () => false, data: () => undefined, get: () => undefined, ref: {},
  metadata: { fromCache: false, hasPendingWrites: false },
});
const snapDe = (ref: unknown) => {
  if (rutaDe(ref) === 'configuracion/flags' && estadoFalso.flags) {
    const datos = estadoFalso.flags;
    return { ...snapVacio(), id: 'flags', exists: () => true, data: () => datos, get: (k: string) => datos[k] };
  }
  return snapVacio();
};
const loteFalso = () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} });
class TimestampFalso {
  seconds: number;
  nanoseconds: number;
  constructor(seconds = 0, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  static now() { return new TimestampFalso(Math.floor(Date.now() / 1000)); }
  static fromDate(d: Date) { return new TimestampFalso(Math.floor(d.getTime() / 1000)); }
  toDate() { return new Date(this.seconds * 1000); }
  toMillis() { return this.seconds * 1000; }
}
const refFalsa = (path: string) => ({ id: path.split('/').pop() || 'falso', path, withConverter() { return this; } });

const especificos: Record<string, unknown> = {
  doc: (_db: unknown, ...partes: unknown[]) => refFalsa(partes.map(String).join('/')),
  collection: (_db: unknown, ...partes: unknown[]) => refFalsa(partes.map(String).join('/')),
  getDocs: async () => snapVacio(),
  getDocsFromServer: async () => snapVacio(),
  getDocsFromCache: async () => snapVacio(),
  getDoc: async (ref: unknown) => snapDe(ref),
  getDocFromServer: async (ref: unknown) => snapDe(ref),
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
  getAggregateFromServer: async () => ({ data: () => ({}) }),
  onSnapshot: (ref: unknown, ...args: unknown[]) => {
    const alLlegar = args.find((a) => typeof a === 'function') as ((s: unknown) => void) | undefined;
    const objeto = args.find((a) => a && typeof a === 'object' && typeof (a as { next?: unknown }).next === 'function') as { next: (s: unknown) => void } | undefined;
    setTimeout(() => (alLlegar ?? objeto?.next)?.(snapDe(ref)), 0);
    return () => {};
  },
  writeBatch: () => loteFalso(),
  runTransaction: async (_db: unknown, fn: (tx: unknown) => unknown) => fn({ get: async (r: unknown) => snapDe(r), set: () => {}, update: () => {}, delete: () => {} }),
  Timestamp: TimestampFalso,
  getAuth: () => ({ currentUser: null, onAuthStateChanged: () => () => {} }),
  onAuthStateChanged: () => () => {},
  onIdTokenChanged: () => () => {},
  httpsCallable: () => async () => ({ data: {} }),
};

/** Módulo falso: lo conocido arriba; cualquier otra función devuelve un objeto encadenable. */
export const moduloFalso = (): Record<string, unknown> => new Proxy({}, {
  has: () => true,
  get: (_t, clave) => {
    if (clave === '__esModule') return true;
    if (clave === 'then' || typeof clave === 'symbol') return undefined;
    if (clave in especificos) return especificos[clave];
    return () => refFalsa('falso');
  },
});

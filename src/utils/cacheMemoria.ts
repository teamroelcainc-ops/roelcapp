// src/utils/cacheMemoria.ts
// ---------------------------------------------------------------------------
// Caché EN MEMORIA a nivel de módulo (sobrevive a montar/desmontar vistas
// mientras la pestaña siga abierta). Complementa al de sessionStorage:
// sessionStorage tiene cuota de ~5MB y con datasets grandes (miles de
// operaciones) el setItem falla en silencio — la memoria no tiene ese límite.
// Resultado: al volver a un módulo o re-buscar, los datos ya están y los
// filtros responden al instante sin volver a descargar de Firestore.
// ---------------------------------------------------------------------------
const almacen = new Map<string, { ts: number; datos: unknown }>();

export const obtenerCacheMemoria = <T>(clave: string, ttlMs: number): T | null => {
  const e = almacen.get(clave);
  if (!e) return null;
  if (Date.now() - e.ts > ttlMs) { almacen.delete(clave); return null; }
  return e.datos as T;
};

export const guardarCacheMemoria = (clave: string, datos: unknown): void => {
  almacen.set(clave, { ts: Date.now(), datos });
};

export const limpiarCacheMemoria = (clave: string): void => {
  almacen.delete(clave);
};

// ---------------------------------------------------------------------------
// Espejo de sessionStorage con respaldo EN MEMORIA. Mismo API (getItem/setItem/
// removeItem), pero el valor SIEMPRE queda disponible aunque la cuota de
// sessionStorage (~5MB) falle con datasets grandes — que era la razón por la
// que los módulos con filtros re-descargaban todo en cada búsqueda.
// Reemplazo directo de `sessionStorage.` por `almacenSesion.` en los cachés.
// ---------------------------------------------------------------------------
const espejo = new Map<string, string>();

export const almacenSesion = {
  getItem(clave: string): string | null {
    const m = espejo.get(clave);
    if (m !== undefined) return m;
    try { return sessionStorage.getItem(clave); } catch { return null; }
  },
  setItem(clave: string, valor: string): void {
    espejo.set(clave, valor);
    try { sessionStorage.setItem(clave, valor); } catch { /* cuota agotada: la memoria ya lo tiene */ }
  },
  removeItem(clave: string): void {
    espejo.delete(clave);
    try { sessionStorage.removeItem(clave); } catch { /* noop */ }
  },
};

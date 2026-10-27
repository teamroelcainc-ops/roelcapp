// src/features/buscador/services/recientes.ts
// ✅ V00502 — lo último que se abrió desde el buscador global, SOLO en memoria (esta sesión):
// nombres de empresas y montos no van a localStorage (regla del proyecto).
import type { ResultadoBusqueda } from './resultados';

const MAX_RECIENTES = 8;
let lista: ResultadoBusqueda[] = [];

export const recientes = (): ResultadoBusqueda[] => lista;

/** Pone el resultado al principio (sin repetir) y devuelve la lista nueva. */
export const guardarReciente = (r: ResultadoBusqueda): ResultadoBusqueda[] => {
  lista = [r, ...lista.filter((x) => x.clave !== r.clave)].slice(0, MAX_RECIENTES);
  return lista;
};

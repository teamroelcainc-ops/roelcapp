// src/features/buscador/services/buscarOperaciones.ts
// ---------------------------------------------------------------------------
// ✅ V00502 — BUSCADOR GLOBAL: operaciones del HISTORIAL por el INICIO del texto (decisión de
// Roelca para esta versión). Firestore no busca palabras sueltas: se pide el prefijo de la
// referencia, de la ref. cliente y del remolque, con sus variantes de mayúsculas (los campos
// distinguen mayúsculas). Pocas lecturas: como mucho 6 por consulta y unas 8 consultas.
// ---------------------------------------------------------------------------
import { porPrefijo } from '../../../shared/data/consultas';
import { variantesPrefijo } from './coincidencias';
import type { Doc } from './resultados';

/** Letras mínimas para buscar operaciones (con menos, el prefijo trae cualquier cosa). */
export const MIN_LETRAS_OPERACIONES = 3;
const POR_CONSULTA = 6;

/** Operaciones cuyo ref, ref. cliente o remolque EMPIEZA con el texto (pueden venir repetidas). */
export async function buscarOperaciones(texto: string): Promise<Doc[]> {
  const q = String(texto ?? '').trim();
  if (q.length < MIN_LETRAS_OPERACIONES) return [];
  const variantes = variantesPrefijo(q);
  const pedidos = [
    ...Array.from(new Set([q.toUpperCase(), q])).map((v) => porPrefijo('operaciones', 'ref', v, POR_CONSULTA)),
    ...variantes.map((v) => porPrefijo('operaciones', 'refCliente', v, POR_CONSULTA)),
    ...variantes.map((v) => porPrefijo('operaciones', 'remolqueNombre', v, POR_CONSULTA)),
  ];
  const lotes = await Promise.allSettled(pedidos);
  const bien = lotes.flatMap((l) => (l.status === 'fulfilled' ? [l.value] : []));
  const fallo = lotes.find((l): l is PromiseRejectedResult => l.status === 'rejected');
  if (fallo) console.error('Buscador: una consulta de operaciones falló:', fallo.reason);
  if (bien.length === 0 && fallo) throw fallo.reason;
  return bien.flat();
}

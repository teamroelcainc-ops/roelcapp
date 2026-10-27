// src/features/buscador/services/coincidencias.ts
// ---------------------------------------------------------------------------
// ✅ V00502 — BUSCADOR GLOBAL: reglas PURAS de coincidencia (sin Firebase ni React).
//   · Sin mayúsculas ni acentos ("castaneda" encuentra "A. CASTAÑEDA & CO.").
//   · Todas las palabras de la búsqueda deben aparecer (en cualquier orden y en cualquier campo).
//   · Puntaje: igual > empieza igual > empieza una palabra > aparece en medio; el primer campo
//     (el título) pesa más que los demás.
// ---------------------------------------------------------------------------

/** Texto para comparar: minúsculas, sin acentos, sin espacios repetidos. */
export const normalizar = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Palabras de la búsqueda (normalizadas, sin vacías). */
export const palabras = (consulta: string): string[] => normalizar(consulta).split(' ').filter(Boolean);

const puntajeCampo = (campo: string, consulta: string, palabra: string): number => {
  if (!campo) return 0;
  if (campo === consulta) return 100;
  if (campo.startsWith(consulta)) return 80;
  if (campo.startsWith(palabra) || campo.includes(` ${palabra}`) || campo.includes(`-${palabra}`)) return 50;
  return campo.includes(palabra) ? 20 : 0;
};

interface Preparada { ps: string[]; completa: string }
const preparar = (consulta: string): Preparada => { const ps = palabras(consulta); return { ps, completa: ps.join(' ') }; };

/** Puntaje con los campos YA normalizados (el de `puntaje`, sin volver a normalizar). */
const puntajeNormalizado = (norm: readonly string[], { ps, completa }: Preparada): number => {
  if (ps.length === 0) return 0;
  let total = 0;
  for (const p of ps) {
    let mejor = 0;
    for (let i = 0; i < norm.length; i++) {
      const s = puntajeCampo(norm[i], ps.length === 1 ? completa : p, p) * (i === 0 ? 1.5 : 1);
      if (s > mejor) mejor = s;
    }
    if (mejor === 0) return 0;
    total += mejor;
  }
  // La búsqueda completa como frase dentro del título suma (ej. "landstar transportation").
  if (ps.length > 1 && norm[0]?.includes(completa)) total += 40;
  return total;
};

/**
 * Puntaje de un registro para la búsqueda (0 = no coincide). `campos[0]` es el título.
 * Cada palabra debe aparecer en algún campo; se suma el mejor campo de cada palabra.
 */
export const puntaje = (campos: readonly unknown[], consulta: string): number =>
  puntajeNormalizado(campos.map(normalizar), preparar(consulta));

/**
 * Los `max` mejores de una lista según `puntaje` (estable: a igual puntaje, el orden original).
 * Con `cache`, el texto normalizado de cada registro se calcula UNA vez y se reutiliza en cada
 * tecla mientras el objeto no cambie (las listas en vivo traen objetos nuevos solo al cambiar).
 */
export const mejores = <T>(
  lista: readonly T[], campos: (x: T) => readonly unknown[], consulta: string, max: number, cache?: WeakMap<object, string[]>,
): { item: T; puntaje: number }[] => {
  const prep = preparar(consulta);
  if (prep.ps.length === 0) return [];
  const normDe = (item: T): string[] => {
    if (!cache || typeof item !== 'object' || item === null) return campos(item).map(normalizar);
    const hit = cache.get(item);
    if (hit) return hit;
    const n = campos(item).map(normalizar);
    cache.set(item, n);
    return n;
  };
  const con: { item: T; puntaje: number; i: number }[] = [];
  lista.forEach((item, i) => {
    const p = puntajeNormalizado(normDe(item), prep);
    if (p > 0) con.push({ item, puntaje: p, i });
  });
  return con.sort((a, b) => b.puntaje - a.puntaje || a.i - b.i).slice(0, max).map(({ item, puntaje: p }) => ({ item, puntaje: p }));
};

/**
 * Variantes de un texto para buscar por PREFIJO en Firestore (distingue mayúsculas): como se
 * escribió, en MAYÚSCULAS y con la primera letra de cada palabra en mayúscula. Sin repetidas.
 */
export const variantesPrefijo = (texto: string): string[] => {
  const t = String(texto ?? '').trim();
  if (!t) return [];
  const titulo = t.toLowerCase().replace(/(^|\s)(\S)/g, (_m, esp: string, l: string) => esp + l.toUpperCase());
  return Array.from(new Set([t, t.toUpperCase(), titulo]));
};

// src/features/empresas/services/duplicadosEmpresas.ts
// ---------------------------------------------------------------------------
// ✅ V00478 — EMPRESAS DUPLICADAS (lógica pura). Antes (botón Duplicadas) solo se juntaban
// nombres idénticos al quitar acentos y signos, el mismo RFC y la primera + última palabra.
// Ahora también:
//   · sin la forma legal: "Tubería y Válvulas del Norte SA de CV" = "Tuberia y Valvulas Del Norte";
//     "Roelca Inc." = "Roelca";
//   · sin espacios ni puntos: "C.H. Robinson" = "CH Robinson";
//   · parecidos por escritura (1 letra de diferencia, 2 en nombres de 20 letras o más): "Like Solutions
//     Logisticss" ≈ "Like Solutions Logistics";
//   · mismas palabras en otro orden, o una palabra de más ("Jesús Molero" ≈ "Jesus Levi Molero").
// Los pares se juntan en grupos (si A≈B y B≈C, los tres van en el mismo grupo). Para no
// comparar todas contra todas, solo se comparan las que empiezan o terminan igual (4 letras).
// ---------------------------------------------------------------------------

export interface EmpresaParaDuplicados {
  id: string;
  nombre?: unknown;
  rfcTaxId?: unknown;
}

export type CriterioDuplicado = 'nombre' | 'parecido' | 'rfc';

export interface GrupoDuplicados {
  /** Ids de las empresas del grupo (en el orden de la lista recibida). */
  ids: string[];
  /** Por qué se juntaron (uno o más). */
  criterios: CriterioDuplicado[];
  /** Nombres distintos del grupo, para el título. */
  nombres: string[];
}

const RFC_GENERICOS = ['XAXX010101000', 'XEXX010101000'];

/** Formas legales que se quitan al final del nombre (ya sin acentos ni signos). */
const FORMAS_LEGALES = [
  's a p i de c v', 's a de c v', 's de r l de c v', 's de rl de cv', 's de r l', 's de rl',
  'sapi de cv', 'sa de cv', 'sde rl de cv', 's c', 'sc', 's a', 'sa', 'llc', 'l l c', 'inc', 'incorporated', 'ltd', 'ltda',
  'limited', 'corp', 'corporation', 'co', 'company', 'cia', 'lp', 'llp', 'plc', 'gmbh', 'srl', 's r l', 'sas', 'de cv',
].sort((a, b) => b.length - a.length);

const sinAcentosNiSignos = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Nombre comparable: sin acentos, signos ni forma legal al final ("Roelca Inc." → "roelca"). */
export const nombreComparable = (nombre: unknown): string => {
  let n = sinAcentosNiSignos(nombre);
  let cambio = true;
  while (cambio && n) {
    cambio = false;
    for (const f of FORMAS_LEGALES) {
      if (n === f) break;
      if (n.endsWith(` ${f}`)) { n = n.slice(0, -(f.length + 1)).trim(); cambio = true; break; }
    }
  }
  return n;
};

/** Clave exacta: el nombre comparable sin espacios ("c h robinson" y "ch robinson" → "chrobinson"). */
export const claveNombre = (nombre: unknown): string => nombreComparable(nombre).replace(/ /g, '');

/** Distancia de edición (Levenshtein) con tope: devuelve tope + 1 en cuanto lo pasa. */
export const distanciaEdicion = (a: string, b: string, tope: number): number => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      fila.push(v);
      if (v < minimo) minimo = v;
    }
    if (minimo > tope) return tope + 1;
    previa = fila;
  }
  return previa[b.length];
};

/** Letras de diferencia que se aceptan como error de escritura según el largo. */
const toleranciaPara = (largo: number): number => (largo >= 20 ? 2 : largo >= 6 ? 1 : 0);

const sonParecidos = (a: string, b: string, palabrasA: string[], palabrasB: string[]): boolean => {
  // Con números distintos son otras empresas o sucursales ("Planta 5" / "Planta 6", "Empresa 1" / "Empresa 11").
  if (a.replace(/\D/g, '') !== b.replace(/\D/g, '')) return false;
  const tope = toleranciaPara(Math.min(a.length, b.length));
  if (tope > 0 && distanciaEdicion(a, b, tope) <= tope) return true;
  // Mismas palabras en otro orden ("Logistica Torve Servicios" / "Servicios Logistica Torve").
  if (palabrasA.length >= 2 && palabrasA.length === palabrasB.length && [...palabrasA].sort().join(' ') === [...palabrasB].sort().join(' ')) return true;
  // Una palabra de más, con la misma primera palabra ("Jesús Molero" / "Jesus Levi Molero").
  const [corta, larga] = palabrasA.length <= palabrasB.length ? [palabrasA, palabrasB] : [palabrasB, palabrasA];
  return corta.length >= 2 && larga.length === corta.length + 1 && corta[0] === larga[0] && corta.every((w) => larga.includes(w));
};

export const buscarDuplicados = (empresas: readonly EmpresaParaDuplicados[]): GrupoDuplicados[] => {
  const n = empresas.length;
  const padre = Array.from({ length: n }, (_, i) => i);
  const raiz = (i: number): number => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };
  const criteriosPar = new Map<number, Set<CriterioDuplicado>>();
  const unir = (i: number, j: number, c: CriterioDuplicado) => {
    const a = raiz(i); const b = raiz(j);
    const r = Math.min(a, b);
    const s = new Set([...(criteriosPar.get(a) ?? []), ...(criteriosPar.get(b) ?? []), c]);
    if (a !== b) padre[Math.max(a, b)] = r;
    criteriosPar.set(r, s);
  };

  const comparables = empresas.map((e) => nombreComparable(e.nombre));
  const claves = comparables.map((c) => c.replace(/ /g, ''));
  const palabras = comparables.map((c) => c.split(' ').filter(Boolean));

  // 1) Mismo nombre (clave exacta) y mismo RFC.
  const porClave = new Map<string, number>();
  const porRfc = new Map<string, number>();
  empresas.forEach((e, i) => {
    const k = claves[i];
    if (k) { const otro = porClave.get(k); if (otro === undefined) porClave.set(k, i); else unir(otro, i, 'nombre'); }
    const rfc = String(e.rfcTaxId ?? '').trim().toUpperCase();
    if (rfc.length >= 9 && !RFC_GENERICOS.includes(rfc)) { const otro = porRfc.get(rfc); if (otro === undefined) porRfc.set(rfc, i); else unir(otro, i, 'rfc'); }
  });

  // 2) Parecidos: solo entre las que empiezan o terminan con las mismas 4 letras, o tienen la misma primera palabra.
  const bloques = new Map<string, number[]>();
  const meter = (clave: string, i: number) => { const l = bloques.get(clave); if (l) l.push(i); else bloques.set(clave, [i]); };
  porClave.forEach((i) => {
    const k = claves[i];
    if (k.length < 4) return;
    meter(`i:${k.slice(0, 4)}`, i);
    meter(`f:${k.slice(-4)}`, i);
    if (palabras[i][0]) meter(`p:${palabras[i][0]}`, i);
  });
  const vistos = new Set<string>();
  bloques.forEach((lista) => {
    if (lista.length < 2 || lista.length > 400) return; // un bloque enorme (p. ej. "transportes …") no aporta
    for (let x = 0; x < lista.length; x++) {
      for (let y = x + 1; y < lista.length; y++) {
        const i = lista[x]; const j = lista[y];
        const par = i < j ? `${i}|${j}` : `${j}|${i}`;
        if (vistos.has(par)) continue;
        vistos.add(par);
        if (sonParecidos(claves[i], claves[j], palabras[i], palabras[j])) unir(i, j, 'parecido');
      }
    }
  });

  // 3) Grupos de 2 o más.
  const miembros = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = raiz(i); const l = miembros.get(r); if (l) l.push(i); else miembros.set(r, [i]); }
  const grupos: GrupoDuplicados[] = [];
  miembros.forEach((lista, r) => {
    if (lista.length < 2) return;
    const orden: CriterioDuplicado[] = ['nombre', 'parecido', 'rfc'];
    const c = criteriosPar.get(r) ?? new Set<CriterioDuplicado>();
    grupos.push({
      ids: lista.map((i) => empresas[i].id),
      criterios: orden.filter((x) => c.has(x)),
      nombres: Array.from(new Set(lista.map((i) => String(empresas[i].nombre ?? '').trim() || '(sin nombre)'))),
    });
  });
  const peso = (g: GrupoDuplicados) => (g.criterios.includes('nombre') ? 0 : g.criterios.includes('rfc') ? 1 : 2);
  return grupos.sort((a, b) => peso(a) - peso(b) || b.ids.length - a.ids.length || a.nombres[0].localeCompare(b.nombres[0], 'es'));
};

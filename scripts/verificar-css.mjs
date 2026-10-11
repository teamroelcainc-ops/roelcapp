// scripts/verificar-css.mjs
// ✅ V00447 — Clases de CSS REPETIDAS entre archivos.
// Las clases generadas por el codemod (`sc-x12`, `ed-x3`…) se nombraron con las
// iniciales del archivo y varios archivos quedaron con el mismo prefijo
// (Completados/Cancelados, Empresas/Empleados…). Como el CSS de cada módulo se
// queda cargado al navegar, las reglas de uno desacomodaban al otro según el
// orden en que se abrían. Este script falla si una clase `xx-xN` se define en
// más de un archivo. mobile.css es la capa responsive global: puede repetir
// clases a propósito para corregirlas en teléfono.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const raiz = new URL('..', import.meta.url).pathname;
const EXCEPCIONES = new Set(['src/styles/mobile.css']);

const archivos = [];
const recorrer = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (n.endsWith('.css')) archivos.push(p);
  }
};
recorrer(join(raiz, 'src'));

const definidas = new Map(); // clase → Set(archivo)
for (const a of archivos) {
  const rel = relative(raiz, a).split('\\').join('/');
  if (EXCEPCIONES.has(rel)) continue;
  const css = readFileSync(a, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/\.([a-z]{1,6}-x\d+)\b/g)) {
    if (!definidas.has(m[1])) definidas.set(m[1], new Set());
    definidas.get(m[1]).add(rel);
  }
}
const repetidas = [...definidas].filter(([, fs]) => fs.size > 1);
if (repetidas.length) {
  console.error(`[css] ✖ ${repetidas.length} clases definidas en más de un archivo (usa un prefijo propio por archivo):`);
  repetidas.slice(0, 20).forEach(([c, fs]) => console.error(`  .${c}: ${[...fs].join(', ')}`));
  process.exit(1);
}
console.log(`[css] ✔ Sin clases repetidas entre archivos (${definidas.size} clases generadas).`);

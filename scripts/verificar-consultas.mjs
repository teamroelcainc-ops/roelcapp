// scripts/verificar-consultas.mjs — ✅ V00443 (Fase 7, criterio de aceptación):
//   ningún getDocs/onSnapshot NUEVO sobre la colección `operaciones` COMPLETA
//   (sin where/limit). Los que quedan son caminos viejos detrás de la bandera
//   `consultasCanonicas` o herramientas de reparación/migración; viven en
//   scripts/consultas-baseline.json y solo pueden BAJAR (se borran en P4).
//
//   node scripts/verificar-consultas.mjs              → falla si un archivo sube
//   node scripts/verificar-consultas.mjs --actualizar → baja la línea base
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(raiz, 'scripts', 'consultas-baseline.json');
// getDocs(collection(db, 'operaciones')) · onSnapshot(collection(db, 'operaciones'), …)
const RE = /\b(?:getDocs|onSnapshot)\(\s*collection\(\s*\w+\s*,\s*['"]operaciones['"]\s*\)/g;

const archivos = [];
const recorrer = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) archivos.push(p);
  }
};
recorrer(join(raiz, 'src'));

const actual = {};
for (const a of archivos) {
  const n = (readFileSync(a, 'utf8').match(RE) || []).length;
  if (n > 0) actual[relative(raiz, a).split('\\').join('/')] = n;
}

const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : {};
const empeoraron = Object.entries(actual).filter(([f, n]) => n > (base[f] ?? 0));
const mejoraron = Object.entries(base).filter(([f, n]) => (actual[f] ?? 0) < n);

if (process.argv.includes('--actualizar')) {
  if (empeoraron.length && existsSync(BASE)) {
    console.error('[consultas] No se baja la línea base: hay archivos que empeoraron.');
  } else {
    writeFileSync(BASE, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`[consultas] Línea base actualizada (${Object.values(actual).reduce((s, n) => s + n, 0)} lecturas de la colección completa).`);
  }
}
if (mejoraron.length) console.log(`[consultas] Mejoraron: ${mejoraron.map(([f]) => f).join(', ')} (usa --actualizar).`);
if (empeoraron.length && !(process.argv.includes('--actualizar') && Object.keys(base).length === 0)) {
  console.error('[consultas] ✖ Lecturas NUEVAS de la colección `operaciones` completa (usa src/shared/data/consultas.ts):');
  empeoraron.forEach(([f, n]) => console.error(`  ${f}: ${base[f] ?? 0} → ${n}`));
  process.exit(1);
}
console.log(`[consultas] ✔ Sin lecturas nuevas de la colección completa (${Object.values(actual).reduce((s, n) => s + n, 0)} heredadas).`);

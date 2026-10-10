// scripts/verificar-lint.mjs — ✅ V00436 (Fase 0) TRINQUETE de ESLint.
// ---------------------------------------------------------------------------
// El repo arrastra ~3,000 problemas de ESLint heredados (casi todos `any`).
// No se pueden arreglar de golpe, pero tampoco deben CRECER:
//   · Ningún archivo puede tener MÁS problemas que en scripts/lint-baseline.json.
//   · Un archivo nuevo debe tener 0 problemas.
//   · El total de `no-explicit-any` no puede subir.
// Si un archivo mejora, se avisa para bajar su línea base con
//   node scripts/verificar-lint.mjs --actualizar
// (solo se actualiza hacia ABAJO: el trinquete nunca se afloja solo).
// ---------------------------------------------------------------------------
import { ESLint } from 'eslint';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rutaBase = resolve(raiz, 'scripts/lint-baseline.json');
const actualizar = process.argv.includes('--actualizar');
const inicializar = process.argv.includes('--inicializar');

const eslint = new ESLint({ cwd: raiz });
const resultados = await eslint.lintFiles(['src', 'functions/src', 'scripts']);

const actual = { archivos: {}, anyTotal: 0 };
for (const r of resultados) {
  const n = r.errorCount + r.warningCount;
  const rel = relative(raiz, r.filePath).replaceAll('\\', '/');
  if (n > 0) actual.archivos[rel] = n;
  actual.anyTotal += r.messages.filter((m) => m.ruleId === '@typescript-eslint/no-explicit-any').length;
}

if (inicializar || !existsSync(rutaBase)) {
  writeFileSync(rutaBase, JSON.stringify(actual, null, 2) + '\n');
  console.log(`[lint] Línea base creada: ${Object.keys(actual.archivos).length} archivos, any=${actual.anyTotal}`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(rutaBase, 'utf8'));
const empeoran = [];
const mejoran = [];
for (const [archivo, n] of Object.entries(actual.archivos)) {
  const permitido = base.archivos[archivo] ?? 0;
  if (n > permitido) empeoran.push(`${archivo}: ${permitido} → ${n}`);
  else if (n < permitido) mejoran.push(`${archivo}: ${permitido} → ${n}`);
}
for (const [archivo, permitido] of Object.entries(base.archivos)) {
  if (!(archivo in actual.archivos) && permitido > 0) mejoran.push(`${archivo}: ${permitido} → 0`);
}
const anySube = actual.anyTotal > base.anyTotal;

if (mejoran.length) {
  console.log(`[lint] Mejoraron ${mejoran.length} archivo(s):\n  ${mejoran.slice(0, 40).join('\n  ')}`);
}
if (actualizar && !empeoran.length && !anySube) {
  const nueva = { archivos: {}, anyTotal: Math.min(base.anyTotal, actual.anyTotal) };
  for (const [archivo, n] of Object.entries(actual.archivos)) nueva.archivos[archivo] = Math.min(n, base.archivos[archivo] ?? n);
  writeFileSync(rutaBase, JSON.stringify(nueva, null, 2) + '\n');
  console.log(`[lint] Línea base bajada (any ${base.anyTotal} → ${nueva.anyTotal}).`);
}
if (empeoran.length || anySube) {
  if (empeoran.length) console.error(`[lint] ✖ Empeoraron ${empeoran.length} archivo(s):\n  ${empeoran.join('\n  ')}`);
  if (anySube) console.error(`[lint] ✖ El total de \`any\` subió: ${base.anyTotal} → ${actual.anyTotal}`);
  process.exit(1);
}
console.log(`[lint] ✔ Sin problemas nuevos (any=${actual.anyTotal}, línea base ${base.anyTotal}).`);

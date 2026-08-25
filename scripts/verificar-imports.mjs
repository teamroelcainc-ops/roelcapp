// scripts/verificar-imports.mjs — ✅ V00128: verifica ANTES del build que todo
//   import relativo de src/ exista en disco (ya van tres deploys caídos por un
//   .css o .ts borrado al copiar carpetas). Se ejecuta en `prebuild`: si falta
//   un archivo, el build truena de inmediato con un mensaje claro en español.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(raiz, 'src');
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.css', '/index.ts', '/index.tsx'];

const archivos = [];
const recorrer = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) recorrer(p);
    else if (/\.(ts|tsx)$/.test(n)) archivos.push(p);
  }
};
recorrer(SRC);

const faltantes = [];
const RE_IMPORT = /(?:import\s[^'"]*|export\s[^'"]*from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
for (const archivo of archivos) {
  const contenido = readFileSync(archivo, 'utf8');
  for (const m of contenido.matchAll(RE_IMPORT)) {
    const ref = m[1].replace(/\?.*$/, '');
    const base = resolve(dirname(archivo), ref);
    if (!EXTS.some((e) => existsSync(base + e))) {
      faltantes.push({ archivo: archivo.slice(raiz.length + 1), ref });
    }
  }
}

if (faltantes.length) {
  console.error('\n✗ IMPORTS ROTOS — estos archivos se importan pero NO existen en el repo:');
  for (const f of faltantes) console.error(`   · ${f.archivo}  →  "${f.ref}"`);
  console.error('\n  Suele pasar cuando se reemplaza una carpeta y se pierde un archivo.');
  console.error('  Recupéralo con: git checkout <commit-anterior> -- <ruta>\n');
  process.exit(1);
}
console.log(`[imports] ✓ ${archivos.length} archivos revisados; sin imports rotos.`);

// scripts/sincronizar-dominio.mjs — ✅ V00436: copia la lógica PURA compartida
//   src/shared/dominio/*.ts  →  functions/src/dominio/*.ts
// Las Cloud Functions se despliegan solas (solo la carpeta functions/), así que
// no pueden importar desde src/. La fuente de verdad es src/shared/dominio;
// la copia lleva un encabezado "NO EDITAR". Lo corre `npm --prefix functions run build`
// (prebuild) y la prueba scripts/sincronizar-dominio.test.mjs avisa si hay diferencias.
//   node scripts/sincronizar-dominio.mjs            → copia
//   node scripts/sincronizar-dominio.mjs --verificar → solo compara (exit 1 si difiere)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGEN = resolve(raiz, 'src/shared/dominio');
export const DESTINO = resolve(raiz, 'functions/src/dominio');
const ENCABEZADO = '// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.\n// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).\n';

const fuentes = () => readdirSync(ORIGEN).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

export const diferencias = () => {
  const difs = [];
  const esperados = new Set(fuentes());
  for (const f of esperados) {
    const esperado = ENCABEZADO + readFileSync(resolve(ORIGEN, f), 'utf8');
    const ruta = resolve(DESTINO, f);
    if (!existsSync(ruta) || readFileSync(ruta, 'utf8') !== esperado) difs.push(f);
  }
  if (existsSync(DESTINO)) {
    for (const f of readdirSync(DESTINO)) if (f.endsWith('.ts') && !esperados.has(f)) difs.push(`${f} (sobra)`);
  }
  return difs;
};

const ejecutar = () => {
  if (process.argv.includes('--verificar')) {
    const difs = diferencias();
    if (difs.length) {
      console.error(`[dominio] ✖ functions/src/dominio no coincide con src/shared/dominio: ${difs.join(', ')}\n  Corre: node scripts/sincronizar-dominio.mjs`);
      process.exit(1);
    }
    console.log('[dominio] ✔ copia de functions al día');
    return;
  }
  mkdirSync(DESTINO, { recursive: true });
  const esperados = new Set(fuentes());
  for (const f of esperados) writeFileSync(resolve(DESTINO, f), ENCABEZADO + readFileSync(resolve(ORIGEN, f), 'utf8'));
  for (const f of readdirSync(DESTINO)) if (f.endsWith('.ts') && !esperados.has(f)) unlinkSync(resolve(DESTINO, f));
  console.log(`[dominio] ${esperados.size} archivo(s) copiados a functions/src/dominio`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ejecutar();

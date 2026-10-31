// scripts/medir-pantallas.mjs
// ---------------------------------------------------------------------------
// ✅ V00534 — PESO POR PANTALLA del build (`npx vite build` primero). Por cada pantalla suma, en KB
// gzip, lo que el navegador descarga la PRIMERA vez que la abre: el chunk de arranque (index-*.js) y
// el chunk de la pantalla, cada uno con TODO lo que importa de forma estática (recursivo), contando
// cada archivo una sola vez. Los `import()` dinámicos no cuentan (se bajan al usarse). Solo JS.
// También el precache del Service Worker (dist/sw.js): cuántos archivos y cuánto pesan sin comprimir.
//
//   node scripts/medir-pantallas.mjs                     → tabla
//   node scripts/medir-pantallas.mjs --json medida.json  → además guarda la medición
//   node scripts/medir-pantallas.mjs --comparar antes.json → columna "Antes" y diferencia
//   node scripts/medir-pantallas.mjs --dist otra/carpeta     → mide otro build (por omisión, dist/)
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gzipSync } from 'node:zlib';

const argumento = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i > 0 ? process.argv[i + 1] : null;
};

const DIST = argumento('--dist') ?? 'dist';
const ASSETS = join(DIST, 'assets');

/** Pantalla → nombre del componente de su chunk (el que se carga con lazy() en App.tsx). */
const PANTALLAS = [
  ['Arranque (login)', null],
  ['Operaciones Activas (inicio)', 'OperacionesDashboard'],
  ['Servicios Completados', 'ServiciosCompletados'],
  ['Facturación Clientes', 'FacturacionClientesDashboard'],
  ['Facturación Proveedores', 'FacturacionProveedoresDashboard'],
  ['Estadísticas', 'EstadisticasDashboard'],
  ['Empresas', 'EmpresasDashboard'],
  ['Pagos', 'PagosDashboard'],
];

if (!existsSync(ASSETS)) {
  console.error('No existe dist/assets: corre primero `npx vite build`.');
  process.exit(1);
}

const archivosJs = readdirSync(ASSETS).filter((a) => a.endsWith('.js'));
const tamanoGzip = new Map();
const gzipDe = (archivo) => {
  if (!tamanoGzip.has(archivo)) tamanoGzip.set(archivo, gzipSync(readFileSync(join(ASSETS, archivo))).length);
  return tamanoGzip.get(archivo);
};

// Imports ESTÁTICOS de un chunk de Rollup: `import{a}from"./x.js"`, `import"./x.js"`, `export{a}from"./x.js"`.
// `import("./x.js")` (dinámico) no coincide: después de `import` viene un paréntesis.
const IMPORT_ESTATICO = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?from\s*)?["']\.\/([^"']+\.js)["']/g;
const importsDe = new Map();
const estaticosDe = (archivo) => {
  if (!importsDe.has(archivo)) {
    const codigo = readFileSync(join(ASSETS, archivo), 'utf8');
    importsDe.set(archivo, Array.from(codigo.matchAll(IMPORT_ESTATICO), (m) => basename(m[1])).filter((a) => archivosJs.includes(a)));
  }
  return importsDe.get(archivo);
};

/** El chunk y todo lo que importa de forma estática (recursivo). */
const cierre = (inicio, vistos = new Set()) => {
  const pila = [inicio];
  while (pila.length) {
    const actual = pila.pop();
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    pila.push(...estaticosDe(actual));
  }
  return vistos;
};

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const entrada = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+\.js)"/)?.[1];
if (!entrada) {
  console.error('No se encontró el script de entrada en dist/index.html.');
  process.exit(1);
}
const deArranque = cierre(entrada);

const kb = (bytes) => bytes / 1024;
const medir = (componente) => {
  const archivos = new Set(deArranque);
  if (componente) {
    const chunk = archivosJs.find((a) => a.startsWith(`${componente}-`));
    if (!chunk) return null;
    cierre(chunk, archivos);
  }
  return { kb: kb(Array.from(archivos).reduce((s, a) => s + gzipDe(a), 0)), archivos: archivos.size };
};

const medicion = { pantallas: {}, precache: null };
for (const [nombre, componente] of PANTALLAS) medicion.pantallas[nombre] = medir(componente);

// Precache: las URL que lista dist/sw.js (workbox) y su tamaño en disco.
const sw = join(DIST, 'sw.js');
if (existsSync(sw)) {
  const urls = Array.from(new Set(Array.from(readFileSync(sw, 'utf8').matchAll(/url:"([^"]+)"/g), (m) => m[1])));
  const bytes = urls.reduce((s, u) => (existsSync(join(DIST, u)) ? s + statSync(join(DIST, u)).size : s), 0);
  medicion.precache = { archivos: urls.length, mb: bytes / 1024 / 1024 };
}

const rutaAntes = argumento('--comparar');
const antes = rutaAntes && existsSync(rutaAntes) ? JSON.parse(readFileSync(rutaAntes, 'utf8')) : null;
const fmt = (n) => n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

console.log(antes ? '| Pantalla | Antes (KB gz) | Ahora (KB gz) | Diferencia | Archivos |' : '| Pantalla | KB gzip | Archivos |');
console.log(antes ? '| --- | ---: | ---: | ---: | ---: |' : '| --- | ---: | ---: |');
for (const [nombre, m] of Object.entries(medicion.pantallas)) {
  if (!m) { console.log(`| ${nombre} | (no se encontró su chunk) | |`); continue; }
  const previo = antes?.pantallas?.[nombre];
  console.log(antes
    ? `| ${nombre} | ${previo ? fmt(previo.kb) : '—'} | ${fmt(m.kb)} | ${previo ? `${m.kb - previo.kb >= 0 ? '+' : ''}${fmt(m.kb - previo.kb)} (${Math.round(((m.kb - previo.kb) / previo.kb) * 100)}%)` : '—'} | ${m.archivos} |`
    : `| ${nombre} | ${fmt(m.kb)} | ${m.archivos} |`);
}
if (medicion.precache) {
  const p = medicion.precache;
  const previo = antes?.precache;
  console.log(antes
    ? `| Precache del Service Worker | ${previo ? `${previo.mb.toFixed(2)} MB (${previo.archivos})` : '—'} | ${p.mb.toFixed(2)} MB (${p.archivos}) | ${previo ? `${p.mb - previo.mb >= 0 ? '+' : ''}${(p.mb - previo.mb).toFixed(2)} MB` : '—'} | |`
    : `| Precache del Service Worker | ${p.mb.toFixed(2)} MB | ${p.archivos} |`);
}

const rutaJson = argumento('--json');
if (rutaJson) writeFileSync(rutaJson, JSON.stringify(medicion, null, 2));

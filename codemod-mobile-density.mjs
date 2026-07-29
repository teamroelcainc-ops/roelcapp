// codemod-mobile-density.mjs — Densidad y distribución MÓVIL para todos los CSS
// ---------------------------------------------------------------------------
// Recorre los CSS hermanos generados (y App.css) y les agrega, POR CLASE, un
// bloque @media (max-width: 640px) con reglas de comodidad móvil:
//   · Rejillas fijas (repeat(2..6, 1fr), "1fr 1fr", etc.) → 1 columna (formularios).
//   · Rejillas auto-fit/minmax anchas (≥170px) → minmax(150px, 1fr): las
//     tarjetas KPI quedan a 2 columnas en teléfono en vez de apilarse enormes.
//   · Filas flex (no columna) → flex-wrap: wrap (nada se corta fuera de pantalla).
//   · Paddings grandes (≥24px) → 14px 12px (más contenido visible).
//   · Tipografías gigantes (≥1.5rem) → 1.3rem.
//   · min-width ≥ 280px → 0 (paneles que desbordaban horizontalmente).
// Idempotente: si el archivo ya tiene el bloque MOBILE-DENSITY-AUTO, lo omite.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const MARCA = '/* MOBILE-DENSITY-AUTO */';

const archivos = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.css')) archivos.push(p);
  }
})('src');

// Extrae reglas de nivel superior (ignora las que ya están dentro de @media).
function reglasTopLevel(css) {
  const reglas = [];
  let i = 0;
  while (i < css.length) {
    const abre = css.indexOf('{', i);
    if (abre === -1) break;
    const selector = css.slice(i, abre).trim().split('\n').pop().trim();
    // Saltar bloques @ (media, keyframes...) completos
    if (selector.startsWith('@')) {
      let depth = 1, j = abre + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }
    const cierra = css.indexOf('}', abre);
    if (cierra === -1) break;
    const cuerpo = css.slice(abre + 1, cierra);
    reglas.push({ selector, cuerpo });
    i = cierra + 1;
  }
  return reglas;
}

let archivosTocados = 0, overrides = 0;

for (const file of archivos) {
  if (path.basename(file) === 'mobile.css') continue;
  let css = fs.readFileSync(file, 'utf8');
  if (css.includes(MARCA)) continue;

  const salidas = [];
  for (const { selector, cuerpo } of reglasTopLevel(css)) {
    if (!selector.startsWith('.')) continue;
    const props = [];

    // 1) Rejillas
    const gtc = cuerpo.match(/grid-template-columns:\s*([^;]+);/);
    if (gtc) {
      const val = gtc[1].trim();
      const mm = val.match(/minmax\((\d+)px/);
      if (mm) {
        if (Number(mm[1]) >= 170) props.push('grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));');
      } else if (/repeat\(\s*[2-9]\s*,/.test(val) || /(fr|px|%)\s+\S+/.test(val)) {
        props.push('grid-template-columns: 1fr;');
      }
    }

    // 2) Filas flex → wrap
    if (/display:\s*flex;/.test(cuerpo) && !/flex-direction:\s*column/.test(cuerpo) && !/flex-wrap:/.test(cuerpo)) {
      props.push('flex-wrap: wrap;');
    }

    // 3) Paddings grandes
    const pad = cuerpo.match(/(?:^|[^-])padding:\s*(\d+)px/);
    if (pad && Number(pad[1]) >= 24) props.push('padding: 14px 12px;');

    // 4) Tipografías gigantes
    const fz = cuerpo.match(/font-size:\s*([\d.]+)rem/);
    if (fz && Number(fz[1]) >= 1.5) props.push('font-size: 1.3rem;');

    // 5) Anchos mínimos que desbordan
    const mw = cuerpo.match(/min-width:\s*(\d+)px/);
    if (mw && Number(mw[1]) >= 280) props.push('min-width: 0;');

    if (props.length) {
      salidas.push(`  ${selector} { ${props.join(' ')} }`);
      overrides += props.length;
    }
  }

  if (!salidas.length) continue;
  css += `\n${MARCA}\n/* Reglas de densidad móvil generadas automáticamente. */\n@media (max-width: 640px) {\n${salidas.join('\n')}\n}\n`;
  fs.writeFileSync(file, css);
  archivosTocados++;
}

console.log(`CSS con bloque móvil agregado: ${archivosTocados}`);
console.log(`Overrides móviles generados: ${overrides}`);

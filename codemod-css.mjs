// codemod-css.mjs — Migración masiva de estilos inline a CSS hermanos (CLAUDE.md)
// ---------------------------------------------------------------------------
// Recorre todos los .tsx y, usando el AST real de TypeScript (no regex):
//   · style={{...}} con TODOS los valores estáticos (string/número) → clase en
//     el archivo CSS hermano del componente + className en el JSX.
//   · style con valores dinámicos (ternarios, variables, template strings,
//     spreads, casts a CSSProperties) → SE DEJA INTACTO: es exactamente el
//     caso que CLAUDE.md permite como inline (valores de runtime).
//   · Deduplica: objetos de estilo idénticos comparten una sola clase.
//   · Si el elemento ya tiene className de texto, se le agrega la clase.
//     Si el className es una expresión (template/ternario), NO se toca ese
//     elemento (evita romper lógica) — queda para migración manual.
// ---------------------------------------------------------------------------
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('src');

// Propiedades CSS sin unidad (React NO les agrega px a los números).
const UNITLESS = new Set([
  'opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow',
  'flexShrink', 'order', 'zoom', 'aspectRatio', 'gridColumn', 'gridRow',
  'gridColumnStart', 'gridColumnEnd', 'gridRowStart', 'gridRowEnd',
  'columnCount', 'orphans', 'widows', 'tabSize', 'WebkitLineClamp',
  'fillOpacity', 'strokeOpacity', 'strokeWidth', 'scale',
]);

const kebab = (p) => {
  // Prefijos de vendor: WebkitX → -webkit-x, msX → -ms-x
  let out = p.replace(/([A-Z])/g, '-$1').toLowerCase();
  if (/^(webkit|moz|ms|o)-/.test(out)) out = '-' + out;
  return out;
};

const cssValue = (propName, node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const v = node.text;
    if (v.includes('"') || v.includes('\\')) return null; // valor raro: no migrar
    return v;
  }
  if (ts.isNumericLiteral(node)) {
    const n = node.text;
    return UNITLESS.has(propName) || n === '0' ? n : `${n}px`;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    const n = `-${node.operand.text}`;
    return UNITLESS.has(propName) ? n : `${n}px`;
  }
  return null; // dinámico → no migrar
};

// Prefijo corto por archivo para los nombres de clase (FacturacionClientesDashboard → fcd)
const prefijoDe = (file) => {
  const base = path.basename(file, '.tsx');
  const letras = (base.match(/[A-Z]/g) || []).join('').toLowerCase();
  return (letras.length >= 2 ? letras : base.slice(0, 3).toLowerCase()).slice(0, 5);
};

const archivos = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.tsx')) archivos.push(p);
  }
})(ROOT);

let totalMigrados = 0, totalOmitidos = 0, archivosTocados = 0;

for (const file of archivos) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('style={{')) continue;

  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const prefijo = prefijoDe(file);
  const reglas = new Map();       // cssBody → className
  const ediciones = [];           // { start, end, texto }
  let contador = 0;
  let omitidosArchivo = 0;

  const procesarElemento = (el) => {
    // el: JsxOpeningElement | JsxSelfClosingElement
    const attrs = el.attributes.properties;
    let styleAttr = null, classAttr = null, tieneSpreadAttr = false;
    for (const a of attrs) {
      if (ts.isJsxSpreadAttribute(a)) { tieneSpreadAttr = true; continue; }
      if (!a.name) continue;
      const nombre = a.name.getText(sf);
      if (nombre === 'style') styleAttr = a;
      if (nombre === 'className') classAttr = a;
    }
    if (!styleAttr || !styleAttr.initializer || !ts.isJsxExpression(styleAttr.initializer)) return;
    const expr = styleAttr.initializer.expression;
    if (!expr || !ts.isObjectLiteralExpression(expr)) { omitidosArchivo++; return; }
    if (tieneSpreadAttr) { omitidosArchivo++; return; } // {...props} podría traer style

    // ¿Todas las propiedades son estáticas?
    const decls = [];
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop)) return void omitidosArchivo++;
      let nombreProp;
      if (ts.isIdentifier(prop.name)) nombreProp = prop.name.text;
      else if (ts.isStringLiteral(prop.name)) nombreProp = prop.name.text;
      else return void omitidosArchivo++;
      if (nombreProp.startsWith('--')) return void omitidosArchivo++; // CSS vars: caso inline legítimo
      const val = cssValue(nombreProp, prop.initializer);
      if (val === null) return void omitidosArchivo++;
      decls.push(`${kebab(nombreProp)}: ${val};`);
    }
    if (decls.length === 0) return void omitidosArchivo++;

    // className del elemento: solo string literal simple o ausente
    let claseExistente = null;
    if (classAttr) {
      if (classAttr.initializer && ts.isStringLiteral(classAttr.initializer)) {
        claseExistente = classAttr.initializer;
      } else {
        omitidosArchivo++;
        return; // className dinámico: no tocar este elemento
      }
    }

    const body = decls.join(' ');
    let clase = reglas.get(body);
    if (!clase) {
      contador += 1;
      clase = `${prefijo}-x${contador}`;
      reglas.set(body, clase);
    }

    // Edición 1: quitar el atributo style (incluyendo el espacio previo)
    let start = styleAttr.getStart(sf);
    while (start > 0 && /\s/.test(src[start - 1])) start--;
    ediciones.push({ start, end: styleAttr.getEnd(), texto: '' });

    // Edición 2: className
    if (claseExistente) {
      const fin = claseExistente.getEnd() - 1; // antes de la comilla de cierre
      ediciones.push({ start: fin, end: fin, texto: ` ${clase}` });
    } else {
      const insercion = el.tagName.getEnd();
      ediciones.push({ start: insercion, end: insercion, texto: ` className="${clase}"` });
    }
    totalMigrados++;
  };

  const visitar = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) procesarElemento(node);
    ts.forEachChild(node, visitar);
  };
  visitar(sf);

  totalOmitidos += omitidosArchivo;
  if (reglas.size === 0) continue;

  // Aplicar ediciones de atrás hacia adelante
  ediciones.sort((a, b) => b.start - a.start);
  let out = src;
  for (const ed of ediciones) out = out.slice(0, ed.start) + ed.texto + out.slice(ed.end);

  // Import del CSS hermano después del último import existente
  const cssBase = path.basename(file, '.tsx') + '.css';
  if (!out.includes(`'./${cssBase}'`)) {
    const sf2 = ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let lastImportEnd = 0;
    for (const st of sf2.statements) if (ts.isImportDeclaration(st)) lastImportEnd = st.getEnd();
    const imp = `\nimport './${cssBase}';`;
    out = lastImportEnd > 0 ? out.slice(0, lastImportEnd) + imp + out.slice(lastImportEnd) : `import './${cssBase}';\n` + out;
  }

  // CSS hermano (se agrega a lo que exista)
  const cssPath = path.join(path.dirname(file), cssBase);
  const encabezado = `/* Estilos hermanos de ${path.basename(file)} — extraídos de estilos inline\n   estáticos (convención CLAUDE.md). Los style={{...}} que quedan en el .tsx\n   son dinámicos (runtime) y por regla permanecen inline. */\n\n`;
  let css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') + '\n' : encabezado;
  for (const [body, clase] of reglas) css += `.${clase} { ${body} }\n`;
  fs.writeFileSync(cssPath, css);
  fs.writeFileSync(file, out);
  archivosTocados++;
}

console.log(`Archivos con CSS hermano generado/actualizado: ${archivosTocados}`);
console.log(`style={{...}} migrados a clases: ${totalMigrados}`);
console.log(`style dinámicos que permanecen inline (regla CLAUDE.md): ${totalOmitidos}`);

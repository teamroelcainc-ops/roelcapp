// src/features/facturacion/selectores.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.1) — SELECTORES PUROS de Facturación. Estas funciones estaban
// COPIADAS idénticas en FacturacionClientesDashboard y FacturacionProveedoresDashboard
// (comparadas texto contra texto; parseFechaFactura solo difería en un comentario).
// Ahora hay una sola copia, tipada y con pruebas. No es la fusión de los dos módulos
// (8.2, pendiente de decisión): cada tablero sigue siendo el suyo.
// ---------------------------------------------------------------------------

/** Tope y tamaño de página de las descargas de operaciones y facturas. */
export const LIMITE_OPS_TODAS = 20000;
export const LIMITE_FACTURAS_TODAS = 12000;
export const PAG_FACTURAS = 1000;

/** Documento (en config_columnas) con el encabezado de remisiones; compartido por los dos módulos. */
export const DOC_REMISION_EMISORES = 'facturacion_remision_emisores';

/** Reconstruye las columnas a partir de la BASE aplicando el orden y la visibilidad guardados. */
export const aplicarConfigColumnasGuardada = <T extends { id: string }>(base: T[], guardadas: unknown): T[] => {
  if (!Array.isArray(guardadas) || guardadas.length === 0) return base.map((c) => ({ ...c }));
  const baseById = new Map<string, T>(base.map((c) => [c.id, c]));
  const resultado: T[] = [];
  const usados = new Set<string>();
  (guardadas as { id?: unknown; visible?: unknown }[]).forEach((g) => {
    const id = g?.id as string;
    const def = baseById.get(id);
    if (def && !usados.has(id)) {
      resultado.push({ ...def, visible: !!g.visible });
      usados.add(id);
    }
  });
  base.forEach((c) => { if (!usados.has(c.id)) resultado.push({ ...c }); });
  return resultado;
};

/** Mueve la columna `id` al principio (sin cambios si ya lo está o no existe). */
export const moverIdAlInicio = <T extends { id?: unknown }>(cols: T[], id: string): T[] => {
  const idx = cols.findIndex((c) => c.id === id);
  if (idx <= 0) return cols;
  const copia = [...cols];
  const [el] = copia.splice(idx, 1);
  copia.unshift(el);
  return copia;
};

/** Opciones y colores del status de la factura. */
export const STATUS_FACTURA_OPCIONES = ['Facturado', 'Cancelado', 'No Facturado'];
export const colorStatusFactura = (s: unknown): string => {
  const t = String(s || '').toLowerCase();
  if (t.includes('cancel')) return '#f85149';
  if (t.includes('no')) return '#f59e0b';
  if (t.includes('factur')) return '#10b981';
  return '#8b949e';
};

/**
 * Fecha de una factura a AAAA-MM-DD. A/B/AAAA es ambiguo (D/M vs M/D): se descartan las
 * imposibles y, si ambas son válidas, se prefiere D/M salvo que caiga en el futuro y M/D no
 * (una factura no puede tener fecha posterior a hoy). Lo que no se reconoce se devuelve tal cual.
 */
export const parseFechaFactura = (val: unknown): string => {
  if (!val) return '';
  const s = String(val).trim();
  if (!s) return '';
  // ISO (YYYY-MM-DD) → tal cual
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${y}-${(m || '01').padStart(2, '0')}-${(d || '01').padStart(2, '0')}`;
  }
  // YYYY/M/D
  const mISO = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (mISO) return `${mISO[1]}-${mISO[2].padStart(2, '0')}-${mISO[3].padStart(2, '0')}`;

  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const y = m[3];
    const hoy = new Date(); hoy.setHours(23, 59, 59, 999);
    const arma = (dia: number, mes: number) => `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const valido = (dia: number, mes: number) => mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
    const esPasada = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return !isNaN(d.getTime()) && d <= hoy; };

    const dm = valido(a, b) ? arma(a, b) : ''; // A = día, B = mes  (D/M/YYYY)
    const md = valido(b, a) ? arma(b, a) : ''; // A = mes, B = día  (M/D/YYYY)

    if (dm && !md) return dm;
    if (md && !dm) return md;
    if (dm && md) {
      if (!esPasada(dm) && esPasada(md)) return md;
      return dm;
    }
  }
  return s;
};

/** Valor de una columna "genérica" de la tabla de operaciones: el primer `sourceField` con dato. */
export const valorGenericoOp = (op: unknown, col: { sourceField?: string | string[] } | null | undefined): unknown => {
  if (!col?.sourceField) return '';
  const fields = Array.isArray(col.sourceField) ? col.sourceField : [col.sourceField];
  for (const f of fields) {
    const v = (op as Record<string, unknown> | null | undefined)?.[f];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
};

/** Clave AAAAMMDD para ordenar por fecha (ISO, AAAA/M/D, D/M/AAAA, D/M/AA o lo que entienda Date). */
export const fechaOrdenKey = (val: unknown): string => {
  const s = String(val || '').trim();
  if (!s) return '00000000';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0');
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0');
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})(?!\d)/);
  if (m) return '20' + m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0');
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return s;
};

/** Clave de orden "natural" de la referencia (RFT-9 antes que RFT-10). */
export const refNaturalKey = (op: { numReferencia?: unknown; referencia?: unknown; ref?: unknown; id?: unknown }): string => {
  const r = String(op.numReferencia || op.referencia || op.ref || op.id || '');
  return r.toLowerCase().replace(/\d+/g, (n) => n.padStart(12, '0'));
};

/**
 * ¿Parece una referencia de operación (letras + dígitos)? Un id de Firestore puro hexadecimal
 * ("d449e0e7…") NO lo es (V00126: la ficha mostraba el id en lugar de la referencia).
 */
export const pareceReferencia = (s: unknown): boolean => {
  const t = String(s || '').trim();
  if (!t || /^[0-9a-f]{8,}$/i.test(t)) return false;
  return /^[A-Za-z]{1,6}[-\s]?\d{3,}/.test(t);
};

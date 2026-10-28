// src/shared/data/indiceCatalogo.ts
// ---------------------------------------------------------------------------
// ✅ V00506 — NOMBRE E ID DE UN REGISTRO DE CATÁLOGO, a prueba de los dos ids (lógica pura).
// Los catálogos que vienen de AppSheet guardan su propio campo `id` (p. ej. el tipo de empresa
// "ca21ab07", el que usan las constantes TIPO_EMPRESA) y en algunos documentos ese `id` no es el
// id del documento en Firestore. Las empresas guardan uno u otro, según quién las guardó. Las
// pantallas buscaban solo por el id del documento y mostraban el id pelón ("ca21ab07") en Tipo(s)
// de Empresa y, a veces, en Tipo de Factura. Aquí un registro se encuentra por CUALQUIERA de sus
// dos ids, y su nombre sale del primer campo de nombre que traiga (Catálogos escribe `tipo` en
// Tipo de Empresa y `nombre` en los demás; los importados pueden traer otro).
// ---------------------------------------------------------------------------

type Datos = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Campos donde los catálogos guardan el nombre, en orden. */
export const CAMPOS_NOMBRE = ['nombre', 'tipo', 'descripcion', 'Nombre', 'Tipo', 'name', 'label', 'titulo'] as const;

/**
 * Ids con que se puede referir un registro: primero el del documento (`_docId`, no enumerable, el de
 * los listeners) y después el `id` guardado, si es otro. Sin `_docId`, el `id` es el del documento.
 */
export const idsDeRegistro = (d: Datos): string[] => {
  const guardado = txt(d.id);
  const real = txt((d as { _docId?: unknown })._docId) || guardado;
  return guardado && guardado !== real ? [real, guardado] : real ? [real] : [];
};

/** Nombre del registro: los campos `preferidos` primero y luego los de siempre. '' si no trae ninguno. */
export const nombreDeRegistro = (d: Datos, preferidos: readonly string[] = []): string => {
  for (const campo of [...preferidos, ...CAMPOS_NOMBRE]) {
    const v = txt(d[campo]);
    if (v) return v;
  }
  return '';
};

export interface EntradaCatalogo {
  /** Id del documento. */
  id: string;
  /** Todos los ids del registro (el del documento y el guardado). */
  ids: string[];
  nombre: string;
}

/** Registros con nombre de un catálogo (los que no traen nombre no se pueden elegir). */
export const entradasCatalogo = (docs: readonly Datos[], preferidos: readonly string[] = []): EntradaCatalogo[] =>
  docs
    .map((d) => { const ids = idsDeRegistro(d); return { id: ids[0] ?? '', ids, nombre: nombreDeRegistro(d, preferidos) }; })
    .filter((e) => e.id && e.nombre);

/** El registro al que apunta un valor guardado (por cualquiera de sus ids), o null. */
export const buscarEntrada = (entradas: readonly EntradaCatalogo[], valor: unknown): EntradaCatalogo | null => {
  const v = txt(valor);
  if (!v) return null;
  return entradas.find((e) => e.ids[0] === v) ?? entradas.find((e) => e.ids.includes(v)) ?? null;
};

/**
 * Diccionario id → etiqueta con los DOS ids de cada registro (el del documento gana si otro registro
 * tiene guardado ese mismo id).
 */
export const diccionarioCatalogo = (docs: readonly Datos[], etiqueta: (d: Datos) => unknown): Record<string, unknown> => {
  const dict: Record<string, unknown> = {};
  docs.forEach((d) => { const [real] = idsDeRegistro(d); if (real) dict[real] = etiqueta(d); });
  docs.forEach((d) => { idsDeRegistro(d).slice(1).forEach((k) => { if (!(k in dict)) dict[k] = etiqueta(d); }); });
  return dict;
};

/**
 * Traductor nombre ↔ id para un formulario que muestra nombres y guarda ids.
 *   · nombreDe(valor): el nombre del registro (por cualquiera de sus ids); si no se encuentra, el valor.
 *   · idDe(nombre): el id que se guarda. Conserva el que el registro ya traía para ese nombre (no lo
 *     cambia por el otro id del mismo catálogo); para uno nuevo usa un id fijo de la app si el
 *     registro lo tiene (TIPO_EMPRESA) y si no, el id del documento. Un valor que no es de ningún
 *     registro se guarda como estaba.
 */
export const traductorCatalogo = (
  entradas: readonly EntradaCatalogo[], valoresGuardados: readonly unknown[], idsFijos: readonly string[] = [],
): { nombreDe: (valor: unknown) => string; idDe: (nombre: string) => string } => {
  const original = new Map<string, string>();
  valoresGuardados.forEach((v) => {
    const e = buscarEntrada(entradas, v);
    if (e && !original.has(e.nombre)) original.set(e.nombre, txt(v));
  });
  return {
    nombreDe: (valor) => buscarEntrada(entradas, valor)?.nombre ?? txt(valor),
    idDe: (nombre) => {
      const guardado = original.get(nombre);
      if (guardado) return guardado;
      const e = entradas.find((x) => x.nombre === nombre);
      if (!e) return nombre;
      return e.ids.find((id) => idsFijos.includes(id)) ?? e.id;
    },
  };
};

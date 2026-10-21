// src/features/puentes/services/reporteAvi.ts
// ---------------------------------------------------------------------------
// ✅ V00464 — REPORTE DEL PUENTE AVI (Excel que se descarga del portal del AVI).
// ✅ V00467 — también PUENTE 3 y PUENTE COLOMBIA. El formato se reconoce por el encabezado:
//   · AVI: POSTING DATE · TRANSACTION DATE (fecha y hora) · TAG # · LOCATION · DESCRIPTION · AMOUNT
//     (fechas mes/día/año, el portal es de EE. UU.).
//   · Puente 3 (estado de cuenta de Comercio Mundial): Fecha · Hora · Folio Tarjeta (el tag) ·
//     Evento · Carril · Tpo. Veh · Abono · Importe · Saldo · T. Movimiento (solo los "Cargo").
//   · Puente Colombia: Fecha (con hora) · Tag · #Económico · Movimiento · Importe Trans. ·
//     Descuento % · Importe Total (lo que se pagó) · SALDO. Cada cruce trae DOS cobros (el puente,
//     p. ej. $90, y la caseta, p. ej. $129.60): se unen en un solo cruce (unirCruces).
//   Las filas de saldo, recarga, abono y totales no traen tag y no se toman.
//   1) leerReportePuente: filas de UNA hoja → cruces (fecha, hora, tag, monto…).
//   2) unirCruces: junta las hojas de un mismo puente sin repetir y une los cobros de Colombia.
//   3) coincidirCruces: tag → unidad, y la operación de esa unidad ese día; si la unidad cruzó
//      varias veces, cada cruce va con la operación cuyo Verde quedó más cerca de la hora del
//      cruce (sin hora de Verde, por orden).
// ✅ V00466: solo se buscan las operaciones de "Operaciones sin asignar" (completadas y fuera
//   del Acumulado: las filtra la pantalla) y ya no se lee el LOCATION.
// Lógica pura: sin Firebase ni React.
// ---------------------------------------------------------------------------

type Celda = unknown;

/** Puente del reporte (el mismo grupo del Acumulado). */
export type GrupoReporte = 'AVI' | 'PT3' | 'PTC';
export const NOMBRE_REPORTE: Record<GrupoReporte, string> = { AVI: 'AVI', PT3: 'Puente 3', PTC: 'Puente Colombia' };
/** Etiqueta del TAG de la unidad para ese puente (campos de Unidades Propias, V00457). */
export const ETIQUETA_TAG_REPORTE: Record<GrupoReporte, string> = { AVI: 'TAG AVI', PT3: 'TAG Puente 3', PTC: 'TAG Puente Colombia' };

export interface CruceAvi {
  /** Renglón del Excel (1 = primero), para ubicarlo. */
  fila: number;
  fecha: string; // AAAA-MM-DD
  hora: string; // HH:mm (24 h)
  tag: string; // normalizado (normalizarTag)
  tagOriginal: string;
  /** # económico que trae el reporte (Colombia); '' si no. */
  economico: string;
  monto: number; // positivo
  /** Los cobros que forman el cruce (Colombia: el puente y la caseta). */
  cobros: { hora: string; monto: number }[];
}

const norm = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Tag comparable.
 * · AVI y Colombia (números): solo dígitos y sin ceros a la izquierda ("00202745" = "202745").
 * · Puente 3 (folio con letras, "9D1A330000000000"): letras y números en mayúsculas, sin los
 *   ceros de relleno del final (= "9D1A33"), por si en la unidad se capturó corto.
 * Sin dígitos (RECARGA, ABONO…) → el texto en mayúsculas (no es un tag).
 */
export const normalizarTag = (v: unknown, grupo: GrupoReporte = 'AVI'): string => {
  const s = String(v ?? '').trim();
  if (grupo === 'PT3') {
    const alnum = s.toUpperCase().replace(/[^0-9A-Z]/g, '');
    return /\d/.test(alnum) ? alnum.replace(/0+$/, '') || '0' : alnum;
  }
  const digitos = s.replace(/\D/g, '');
  if (digitos) return digitos.replace(/^0+(?=\d)/, '');
  return s.toUpperCase().replace(/\s+/g, '');
};

/** # económico comparable ("1019", "UND.1019", "U-1019" → "1019"). */
export const normalizarEconomico = (v: unknown): string => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/** Monto del reporte: "($23.75)", "-23.75", "$23.75" o un número → 23.75. */
export const montoReporte = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.abs(v) : null;
  const s = String(v ?? '').replace(/[$,\s()]/g, '').replace(/^-/, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.abs(n) : null;
};

/** Hora de una celda: "21:25:08", "7:05 PM" o la fracción de día de Excel (0.89…). '' si no hay. */
export const horaDeCelda = (v: unknown): string => {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1) {
    const min = Math.round(v * 1440) % 1440;
    return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  }
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?/i);
  if (!m) return '';
  let h = Number(m[1]);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h <= 23 ? `${pad2(h)}:${m[2]}` : '';
};

/**
 * Fecha y hora de un cruce. El texto "a/b/aaaa" es mes/día/año (AVI, EE. UU.) o, con
 * `diaPrimero`, día/mes/año (los reportes de México). También acepta AAAA-MM-DD, una fecha de
 * Excel (número de serie; la fracción es la hora) o un Date (la hora tal cual viene).
 */
export const fechaHoraReporte = (v: unknown, diaPrimero = false): { fecha: string; hora: string } | null => {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return { fecha: `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`, hora: `${pad2(v.getHours())}:${pad2(v.getMinutes())}` };
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Serie de Excel: días desde 1899-12-30; la fracción es la hora.
    const d = new Date(Math.round((v - 25569) * 86400000));
    return { fecha: d.toISOString().slice(0, 10), hora: d.toISOString().slice(11, 16) };
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  if (m) return { fecha: `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`, hora: horaDeCelda(m[4]) };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(.*)$/);
  if (m) {
    const mes = Number(diaPrimero ? m[2] : m[1]); const dia = Number(diaPrimero ? m[1] : m[2]);
    const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return { fecha: `${anio}-${pad2(mes)}-${pad2(dia)}`, hora: horaDeCelda(m[4]) };
  }
  return null;
};

// Nombres de columna aceptados (sin acentos ni mayúsculas), en orden de preferencia.
const COLUMNAS = {
  fecha: ['transaction date', 'fecha de transaccion', 'fecha transaccion', 'fecha de cruce', 'fecha'],
  hora: ['hora', 'hora de cruce'],
  tag: ['tag #', 'tag#', 'folio tarjeta', 'folio de tarjeta', 'tag', 'tag no', 'tag number', 'numero de tag', 'tarjeta'],
  economico: ['#economico', '# economico', 'economico', 'no. economico', 'numero economico'],
  monto: ['amount', 'importe total', 'importe', 'monto'],
  movimiento: ['t. movimiento', 'tipo de movimiento', 'tipo movimiento', 'movimiento'],
} as const;

const indice = (enc: readonly Celda[], nombres: readonly string[]): number => {
  for (const n of nombres) {
    const i = enc.findIndex((c) => norm(c) === n);
    if (i >= 0) return i;
  }
  return -1;
};

/** ¿De qué puente es el encabezado? (null si no es un reporte de puente). */
const grupoDeEncabezado = (enc: readonly Celda[]): GrupoReporte | null => {
  if (indice(enc, COLUMNAS.fecha) < 0 || indice(enc, COLUMNAS.tag) < 0) return null;
  if (indice(enc, ['folio tarjeta', 'folio de tarjeta']) >= 0) return 'PT3';
  if (indice(enc, COLUMNAS.economico) >= 0 || indice(enc, ['importe total']) >= 0) return 'PTC';
  if (indice(enc, ['transaction date', 'tag #', 'tag#']) >= 0) return 'AVI';
  return null;
};

export interface LecturaReporte {
  /** null si la hoja no trae el encabezado de un reporte de puente. */
  grupo: GrupoReporte | null;
  cruces: CruceAvi[];
  /** Renglones con datos que no son cruces (saldos, recargas, abonos, totales). */
  omitidas: number;
}

/**
 * Cruces de UNA hoja (filas como arreglos, la primera fila del Excel = índice 0). El encabezado
 * se busca en las primeras 40 filas (los portales ponen títulos arriba).
 */
export const leerReportePuente = (filas: readonly (readonly Celda[])[]): LecturaReporte => {
  let iEnc = -1;
  let grupo: GrupoReporte | null = null;
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    grupo = grupoDeEncabezado(filas[i] || []);
    if (grupo) { iEnc = i; break; }
  }
  if (!grupo || iEnc < 0) return { grupo: null, cruces: [], omitidas: 0 };
  const enc = filas[iEnc];
  const col = {
    fecha: indice(enc, COLUMNAS.fecha), hora: indice(enc, COLUMNAS.hora), tag: indice(enc, COLUMNAS.tag),
    economico: indice(enc, COLUMNAS.economico), monto: indice(enc, COLUMNAS.monto), movimiento: indice(enc, COLUMNAS.movimiento),
  };
  const diaPrimero = grupo !== 'AVI';
  const cruces: CruceAvi[] = [];
  let omitidas = 0;
  for (let i = iEnc + 1; i < filas.length; i++) {
    const f = filas[i] || [];
    if (f.every((c) => String(c ?? '').trim() === '')) continue; // renglón vacío
    const tagOriginal = String(f[col.tag] ?? '').trim();
    const mov = col.movimiento >= 0 ? norm(f[col.movimiento]) : '';
    const esCobro = !/abono|recarga|deposito|saldo/.test(mov);
    const fh = fechaHoraReporte(f[col.fecha], diaPrimero);
    if (!fh || !/\d/.test(tagOriginal) || !esCobro) { omitidas += 1; continue; } // totales, saldos, recargas, abonos
    const hora = (col.hora >= 0 ? horaDeCelda(f[col.hora]) : '') || fh.hora;
    const monto = (col.monto >= 0 ? montoReporte(f[col.monto]) : null) ?? 0;
    cruces.push({
      fila: i + 1, fecha: fh.fecha, hora, tag: normalizarTag(tagOriginal, grupo), tagOriginal,
      economico: col.economico >= 0 ? String(f[col.economico] ?? '').trim() : '',
      monto, cobros: [{ hora, monto }],
    });
  }
  return { grupo, cruces, omitidas };
};

/** Minutos entre dos cruces del mismo día (HH:mm). */
const minutos = (hhmm: string): number | null => {
  const m = String(hhmm).match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** En Colombia el cobro del puente y el de la caseta del mismo cruce pueden quedar hasta ~5 h aparte (la fila). */
export const MINUTOS_COBROS_COLOMBIA = 300;
/** Minutos desde 1970 de una fecha y hora (para comparar cobros de días distintos, p. ej. a medianoche). */
const minutosAbsolutos = (c: CruceAvi): number | null => {
  const m = minutos(c.hora);
  const d = Date.parse(`${c.fecha}T00:00:00Z`);
  return m === null || Number.isNaN(d) ? null : d / 60000 + m;
};

/**
 * Junta las hojas de un MISMO puente (el reporte de Puente 3 trae el mismo periodo en dos hojas),
 * sin repetir un cobro (misma fecha, hora, tag y monto). En Colombia une cada par de cobros
 * seguidos del mismo tag (el puente y la caseta: montos distintos, a lo más 5 h aparte, también
 * pasando la medianoche) en un solo cruce con el total; la fecha y la hora son las del primer cobro.
 */
export const unirCruces = (grupo: GrupoReporte, listas: readonly (readonly CruceAvi[])[]): CruceAvi[] => {
  const vistos = new Set<string>();
  const todos: CruceAvi[] = [];
  for (const l of listas) {
    for (const c of l) {
      const k = `${c.fecha} ${c.hora}|${c.tag}|${c.monto}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      todos.push(c);
    }
  }
  todos.sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`) || a.fila - b.fila);
  if (grupo !== 'PTC') return todos;
  const salida: CruceAvi[] = [];
  const abierto = new Map<string, CruceAvi>(); // tag → cruce con un solo cobro
  for (const c of todos) {
    const k = c.tag;
    const previo = abierto.get(k);
    const mp = previo ? minutosAbsolutos(previo) : null;
    const mc = minutosAbsolutos(c);
    const otroCobro = !!previo && Math.abs(previo.monto - c.monto) > 0.009; // dos cobros iguales = dos cruces
    if (previo && otroCobro && mp !== null && mc !== null && mc - mp <= MINUTOS_COBROS_COLOMBIA) {
      previo.cobros = [...previo.cobros, ...c.cobros];
      previo.monto = Math.round((previo.monto + c.monto) * 100) / 100;
      abierto.delete(k);
      continue;
    }
    const nuevo: CruceAvi = { ...c, cobros: [...c.cobros] };
    salida.push(nuevo);
    abierto.set(k, nuevo);
  }
  return salida;
};

// ── Coincidir con las operaciones ───────────────────────────────────────────

export interface UnidadConTag {
  id: string;
  nombre: string;
  /** El TAG de la unidad para el puente del reporte. */
  tag: string;
}

/** Una operación de Operaciones sin asignar (completada y fuera del Acumulado). */
export interface OpParaCruce {
  id: string;
  ref: string;
  fecha: string; // AAAA-MM-DD
  /** Id de la unidad (o su nombre si no está en el catálogo). */
  unidad: string;
  /** Horas de Verde (HH:mm) del día, para escoger la más cercana al cruce. */
  horas: string[];
  /** Lo que trae de puente: caseta + piso de Colombia (0 = sin monto). */
  monto: number;
  puente: string;
  /** Grupo de su puente ('' si aún no tiene). */
  grupo: GrupoReporte | '';
}

/** coincide = tiene operación por asignar · sinOperacion = la unidad no tiene una por asignar para ese cruce. */
export type EstadoCruce = 'coincide' | 'sinOperacion' | 'tagSinUnidad';

export interface ResultadoCruce {
  cruce: CruceAvi;
  unidad: UnidadConTag | null;
  op: OpParaCruce | null;
  estado: EstadoCruce;
  avisos: string[];
}

/** Tag → unidad. Un tag repetido en dos unidades se reporta (se usa la primera). */
export const indiceDeTags = (unidades: readonly UnidadConTag[], grupo: GrupoReporte = 'AVI'): { porTag: Map<string, UnidadConTag>; repetidos: Map<string, string[]> } => {
  const porTag = new Map<string, UnidadConTag>();
  const repetidos = new Map<string, string[]>();
  for (const u of unidades) {
    const t = normalizarTag(u.tag, grupo);
    if (!t || !/\d/.test(t)) continue;
    const previa = porTag.get(t);
    if (previa) repetidos.set(t, [...(repetidos.get(t) ?? [previa.nombre]), u.nombre]);
    else porTag.set(t, u);
  }
  return { porTag, repetidos };
};

/** Clave unidad + día de servicio (la de `otrasDelDia`). */
export const claveUnidadDia = (unidad: string, fecha: string): string => `${unidad}|${fecha}`;

export interface OpcionesCoincidir {
  /** Puente del reporte (por omisión AVI). */
  grupo?: GrupoReporte;
  /** claveUnidadDia → "TR-… (en el Acumulado)": las demás operaciones de la unidad ese día. */
  otrasDelDia?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Une cada cruce con su unidad y con UNA operación de esa unidad ese día. Las operaciones
 * de una unidad y día se reparten entre sus cruces por cercanía de la hora (la del Verde
 * contra la del cruce); las que no traen hora van después, en su orden.
 * ✅ V00466: `ops` son solo las de Operaciones sin asignar; `otrasDelDia` no se emparejan,
 *   pero se avisan en cada cruce, para no enviar dos veces el mismo cruce.
 * ✅ V00467: el tag se busca con el TAG de ESE puente; si no está y el reporte trae # económico
 *   (Colombia), por el número de la unidad. Primero se emparejan las operaciones de ese puente
 *   (o sin puente) y al final las de otro puente, con aviso.
 */
export const coincidirCruces = (
  cruces: readonly CruceAvi[],
  unidades: readonly UnidadConTag[],
  ops: readonly OpParaCruce[],
  opciones: OpcionesCoincidir = {},
): { filas: ResultadoCruce[]; opsSinCruce: OpParaCruce[]; repetidos: Map<string, string[]> } => {
  const grupo = opciones.grupo ?? 'AVI';
  const otrasDelDia = opciones.otrasDelDia ?? new Map<string, readonly string[]>();
  const nombre = NOMBRE_REPORTE[grupo];
  const etiquetaTag = ETIQUETA_TAG_REPORTE[grupo];
  const { porTag, repetidos } = indiceDeTags(unidades, grupo);
  const porEconomico = new Map<string, UnidadConTag>();
  unidades.forEach((u) => { const e = normalizarEconomico(u.nombre); if (e && !porEconomico.has(e)) porEconomico.set(e, u); });

  const filas: ResultadoCruce[] = cruces.map((cruce) => {
    const avisos: string[] = [];
    let unidad = porTag.get(cruce.tag) ?? null;
    if (!unidad && cruce.economico) {
      unidad = porEconomico.get(normalizarEconomico(cruce.economico)) ?? null;
      if (unidad) avisos.push(unidad.tag
        ? `Se tomó por el # económico ${cruce.economico}: el ${etiquetaTag} de ${unidad.nombre} es ${unidad.tag}`
        : `Se tomó por el # económico ${cruce.economico}: ${unidad.nombre} no tiene ${etiquetaTag}`);
    }
    const rep = repetidos.get(cruce.tag);
    if (rep) avisos.push(`El tag está en varias unidades: ${rep.join(', ')}`);
    return { cruce, unidad, op: null, estado: unidad ? 'sinOperacion' : 'tagSinUnidad', avisos };
  });

  // Agrupa por unidad + fecha.
  const clave = claveUnidadDia;
  const crucesPorGrupo = new Map<string, number[]>();
  filas.forEach((f, i) => {
    if (!f.unidad) return;
    const k = clave(f.unidad.id, f.cruce.fecha);
    crucesPorGrupo.set(k, [...(crucesPorGrupo.get(k) ?? []), i]);
  });
  const opsPorGrupo = new Map<string, OpParaCruce[]>();
  ops.forEach((o) => {
    const k = clave(o.unidad, o.fecha);
    if (crucesPorGrupo.has(k)) opsPorGrupo.set(k, [...(opsPorGrupo.get(k) ?? []), o]);
  });

  const usadas = new Set<string>();
  crucesPorGrupo.forEach((indices, k) => {
    const candidatas = [...(opsPorGrupo.get(k) ?? [])].sort((a, b) => a.ref.localeCompare(b.ref, 'es', { numeric: true }));
    const pares: { i: number; o: OpParaCruce; d: number }[] = [];
    indices.forEach((i, posCruce) => {
      const mc = minutos(filas[i].cruce.hora);
      candidatas.forEach((o, posOp) => {
        const horas = o.horas.map(minutos).filter((x): x is number => x !== null);
        const d = mc !== null && horas.length > 0
          ? Math.min(...horas.map((h) => Math.abs(h - mc)))
          : 100000 + Math.abs(posCruce - posOp); // sin hora: por orden
        const otroPuente = o.monto > 0 && !!o.grupo && o.grupo !== grupo;
        pares.push({ i, o, d: d + (otroPuente ? 1000000 : 0) }); // las de otro puente, al final
      });
    });
    pares.sort((a, b) => a.d - b.d);
    const crucesAsignados = new Set<number>();
    for (const p of pares) {
      if (crucesAsignados.has(p.i) || usadas.has(p.o.id)) continue;
      crucesAsignados.add(p.i);
      usadas.add(p.o.id);
      const f = filas[p.i];
      f.op = p.o;
      f.estado = 'coincide';
      if (!(p.o.monto > 0)) f.avisos.push('La operación no tiene monto de puente');
      else if (Math.abs(p.o.monto - f.cruce.monto) > 0.009 && f.cruce.monto > 0) f.avisos.push(`La operación tiene $${p.o.monto.toFixed(2)} y el ${nombre} cobró $${f.cruce.monto.toFixed(2)}`);
      if (p.o.monto > 0 && p.o.grupo && p.o.grupo !== grupo && p.o.puente) f.avisos.push(`La operación va por ${p.o.puente}`);
    }
    // Más cruces que operaciones: se dice cuántas hay para que se revise cuál falta capturar.
    if (candidatas.length > 0) {
      indices.filter((i) => !crucesAsignados.has(i)).forEach((i) => {
        filas[i].avisos.push(`La unidad tiene ${candidatas.length} ${candidatas.length === 1 ? 'operación' : 'operaciones'} por asignar y ${indices.length} cruces ese día`);
      });
    }
    const otras = otrasDelDia.get(k);
    if (otras && otras.length > 0) indices.forEach((i) => filas[i].avisos.push(`La unidad también tiene ese día: ${otras.join(', ')}`));
  });

  const opsSinCruce = ops.filter((o) => !usadas.has(o.id) && crucesPorGrupo.has(clave(o.unidad, o.fecha)));
  return { filas, opsSinCruce, repetidos };
};

/** Conteos para el resumen. */
export const resumenCruces = (filas: readonly ResultadoCruce[]): Record<EstadoCruce, number> & { total: number; monto: number } => {
  const r = { coincide: 0, sinOperacion: 0, tagSinUnidad: 0, total: filas.length, monto: 0 };
  filas.forEach((f) => { r[f.estado] += 1; r.monto += f.cruce.monto; });
  r.monto = Math.round(r.monto * 100) / 100;
  return r;
};

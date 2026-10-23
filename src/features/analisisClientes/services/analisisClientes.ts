// src/features/analisisClientes/services/analisisClientes.ts
// ---------------------------------------------------------------------------
// ✅ V00479 — ANÁLISIS DE CLIENTES (lógica pura). Con las operaciones del año (sin canceladas ni
// pruebas), por Cliente Paga y por Cliente Mercancía: cuántas hace, cómo cambian los últimos
// 3 meses frente al resto del año, sus días y pausas, y un estado:
//   1. Ocasional — menos de 20 operaciones en el año.
//   2. Inactivo  — ninguna operación en las últimas 3 semanas (21 días).
//   3. Nuevo     — su primera operación del año fue en los últimos 6 meses (183 días).
//   4. Creciendo — sus operaciones por semana de los últimos 3 meses subieron 20 % o más
//                  frente a las de antes (desde su primera operación del año).
//   5. Bajando   — bajaron 20 % o más.
//   6. Estable   — el resto.
// Las reglas viven en REGLAS y la pantalla las explica con el mismo objeto.
// ---------------------------------------------------------------------------
import { estadoGrupoDe, esOperacionPrueba } from '../../../shared/dominio/operacionCanonica';
import { fechaServicioDeOperacion } from '../../../shared/dominio/fechas';
import { normalizarTexto } from '../../../shared/dominio/texto';

type Datos = Record<string, unknown>;

export type RolCliente = 'paga' | 'mercancia';
export type EstadoCliente = 'creciendo' | 'estable' | 'bajando' | 'inactivo' | 'nuevo' | 'ocasional';

export const REGLAS = {
  /** Menos de esto en el año = Ocasional (y no entra en "Qué está cambiando"). */
  minOps: 20,
  /** Días sin operar (desde la última) para ser Inactivo. */
  diasInactivo: 21,
  /** Primera operación del año dentro de estos días = Nuevo. */
  diasNuevo: 183,
  /** Cambio (fracción) para Creciendo / Bajando. */
  cambio: 0.2,
  /** "Últimos 3 meses" = estas semanas. */
  semanasUlt3m: 13,
  /** "Últimas 4 semanas". */
  semanasUlt4s: 4,
} as const;

export const ETIQUETA_ESTADO: Record<EstadoCliente, string> = {
  creciendo: 'Creciendo', estable: 'Estable', bajando: 'Bajando', inactivo: 'Inactivo', nuevo: 'Nuevo', ocasional: 'Ocasional',
};
export const ORDEN_ESTADOS: readonly EstadoCliente[] = ['creciendo', 'estable', 'bajando', 'inactivo', 'nuevo', 'ocasional'];
export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;
const MESES_MIN = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

export interface ClienteDeOp { id: string; nombre: string }

/** Lo que el análisis usa de una operación. */
export interface OpAnalisis {
  id: string;
  ref: string;
  /** AAAA-MM-DD */
  fecha: string;
  paga: ClienteDeOp | null;
  mercancia: ClienteDeOp | null;
  importacion: boolean;
  exportacion: boolean;
  vacio: boolean;
  hazmat: boolean;
  falso: boolean;
  tipo: string;
  trafico: string;
  estatus: string;
  unidad: string;
  convenio: string;
}

const txt = (v: unknown): string => String(v ?? '').trim();

const clienteDe = (id: unknown, nombreGuardado: unknown, nombreEmpresa: (id: string) => string | undefined): ClienteDeOp | null => {
  const i = txt(id);
  const n = (i && nombreEmpresa(i)) || txt(nombreGuardado);
  if (i) return { id: i, nombre: n || i };
  return n ? { id: `nombre:${normalizarTexto(n)}`, nombre: n } : null;
};

/** Documento de operación → OpAnalisis; null si es cancelada, de prueba o no tiene fecha. */
export const aOpAnalisis = (op: Datos & { id: string }, nombreEmpresa: (id: string) => string | undefined): OpAnalisis | null => {
  if (esOperacionPrueba(op)) return null;
  const grupo = estadoGrupoDe({ status: op.status, statusNombre: op.statusNombre });
  if (grupo === 'cancelada') return null;
  const fecha = fechaServicioDeOperacion(op);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const trafico = txt(op.trafico);
  const traficoN = normalizarTexto(trafico);
  const cajaN = normalizarTexto([op.carga, op.cargadoVacio, op.convenioNombre, op.tipoConvenioNombre, op.tarifaLabel].map(txt).join(' '));
  return {
    id: op.id,
    ref: txt(op.ref || op.referencia) || op.id,
    fecha,
    paga: clienteDe(op.clientePaga ?? op.clientePagaId, op.clientePagaNombre || op.clienteNombre || op.nombreCliente, nombreEmpresa),
    mercancia: clienteDe(op.clienteMercancia ?? op.clienteMercanciaId, op.clienteMercanciaNombre, nombreEmpresa),
    importacion: traficoN.includes('import'),
    exportacion: traficoN.includes('export'),
    vacio: /vaci[oa]/.test(cajaN),
    hazmat: /hazmat|peligros/.test(cajaN),
    falso: grupo === 'falso',
    tipo: txt(op.tipoOperacionNombre || op.tipoServicio),
    trafico,
    estatus: txt(op.statusNombre || op.status),
    unidad: txt(op.unidadNombre || op.unidadProveedorNombre),
    convenio: txt(op.convenioNombre),
  };
};

// ── Fechas como número de día (UTC, sin horarios) ─────────────────────────
export const diaNum = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
/** 0 = lunes … 6 = domingo. */
const diaSemana = (n: number): number => (new Date(n * 86400000).getUTCDay() + 6) % 7;
const isoDeDia = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);

/** Periodo del análisis: del 1 de enero al día de corte (hoy, o el 31 de diciembre de un año pasado). */
export interface Periodo { anio: number; inicio: string; fin: string }
export const periodoDelAnio = (anio: number, hoyISO: string): Periodo => {
  const fin = hoyISO.slice(0, 4) === String(anio) ? hoyISO : `${anio}-12-31`;
  return { anio, inicio: `${anio}-01-01`, fin };
};

export interface FichaCliente {
  id: string;
  nombre: string;
  rol: RolCliente;
  estado: EstadoCliente;
  ops: number;
  /** Fracción del total de operaciones del periodo. */
  pct: number;
  primera: string;
  ultima: string;
  opsSemAntes: number | null;
  opsSemUlt3m: number;
  /** (últ. 3 meses − antes) ÷ antes; null sin "antes" suficiente. */
  cambio: number | null;
  opsSemUlt4s: number;
  trimestres: { etiqueta: string; opsSem: number }[];
  diasConOp: number;
  /** Días con operación ÷ días de lunes a sábado desde su primera operación. */
  pctDiasOpera: number;
  porDiaQueOpera: number;
  /** Días de lunes a viernes, desde su primera operación, sin operar. */
  diasHabilesSinOperar: number;
  importacion: number;
  exportacion: number;
  vacios: number;
  hazmat: number;
  falso: number;
  sabados: number;
  /** 0 = lunes … 6 = domingo. */
  diaFuerte: number;
  porMes: number[];
  porDiaSemana: number[];
  /** Días seguidos sin operar entre dos operaciones (la más larga). */
  pausaMasLarga: number;
  /** Días desde la última operación hasta el corte. */
  pausaActual: number;
}

export const clienteDeRol = (op: OpAnalisis, rol: RolCliente): ClienteDeOp | null => (rol === 'paga' ? op.paga : op.mercancia);

const estadoDe = (ops: number, pausaActual: number, primeraN: number, finN: number, cambio: number | null): EstadoCliente => {
  if (ops < REGLAS.minOps) return 'ocasional';
  if (pausaActual >= REGLAS.diasInactivo) return 'inactivo';
  if (finN - primeraN < REGLAS.diasNuevo) return 'nuevo';
  if (cambio !== null && cambio >= REGLAS.cambio) return 'creciendo';
  if (cambio !== null && cambio <= -REGLAS.cambio) return 'bajando';
  return 'estable';
};

const contarDias = (desde: number, hasta: number, incluye: (dia: number) => boolean): number => {
  let n = 0;
  for (let d = desde; d <= hasta; d++) if (incluye(diaSemana(d))) n++;
  return n;
};

const etiquetaTrimestre = (mesIni: number, mesFin: number): string =>
  mesIni === mesFin ? MESES_MIN[mesIni] : `${MESES_MIN[mesIni]}-${MESES_MIN[mesFin]}`;

/** Fichas de todos los clientes del rol, de más a menos operaciones. */
export const analizarClientes = (ops: readonly OpAnalisis[], rol: RolCliente, periodo: Periodo): FichaCliente[] => {
  const inicioN = diaNum(periodo.inicio);
  const finN = diaNum(periodo.fin);
  const enPeriodo = ops.filter((o) => o.fecha >= periodo.inicio && o.fecha <= periodo.fin);
  const total = enPeriodo.length;
  const porCliente = new Map<string, { nombre: string; ops: OpAnalisis[] }>();
  for (const o of enPeriodo) {
    const c = clienteDeRol(o, rol);
    if (!c) continue;
    const g = porCliente.get(c.id);
    if (g) g.ops.push(o); else porCliente.set(c.id, { nombre: c.nombre, ops: [o] });
  }
  const desdeUlt3m = finN - REGLAS.semanasUlt3m * 7 + 1;
  const desdeUlt4s = finN - REGLAS.semanasUlt4s * 7 + 1;
  // Trimestres hasta el corte.
  const trimestres: { ini: number; fin: number; etiqueta: string }[] = [];
  for (let q = 0; q < 4; q++) {
    const ini = Math.round(Date.UTC(periodo.anio, q * 3, 1) / 86400000);
    if (ini > finN) break;
    const finQ = Math.min(Math.round(Date.UTC(periodo.anio, q * 3 + 3, 1) / 86400000) - 1, finN);
    trimestres.push({ ini, fin: finQ, etiqueta: etiquetaTrimestre(q * 3, new Date(finQ * 86400000).getUTCMonth()) });
  }

  const fichas: FichaCliente[] = [];
  porCliente.forEach(({ nombre, ops: lista }, id) => {
    const dias = lista.map((o) => diaNum(o.fecha));
    const primeraN = Math.min(...dias);
    const ultimaN = Math.max(...dias);
    const n = lista.length;
    const ult3m = dias.filter((d) => d >= desdeUlt3m).length;
    const ult4s = dias.filter((d) => d >= desdeUlt4s).length;
    const desdeAntes = Math.max(inicioN, primeraN);
    const diasAntes = desdeUlt3m - desdeAntes;
    const opsSemAntes = diasAntes >= 14 ? dias.filter((d) => d < desdeUlt3m).length / (diasAntes / 7) : null;
    const opsSemUlt3m = ult3m / REGLAS.semanasUlt3m;
    const cambio = opsSemAntes && opsSemAntes > 0 ? (opsSemUlt3m - opsSemAntes) / opsSemAntes : null;
    const fechas = Array.from(new Set(dias)).sort((a, b) => a - b);
    const conOp = new Set(fechas);
    let pausaMasLarga = 0;
    for (let i = 1; i < fechas.length; i++) pausaMasLarga = Math.max(pausaMasLarga, fechas[i] - fechas[i - 1] - 1);
    const pausaActual = finN - ultimaN;
    const porMes = Array.from({ length: 12 }, () => 0);
    const porDiaSemana = Array.from({ length: 7 }, () => 0);
    lista.forEach((o) => { porMes[Number(o.fecha.slice(5, 7)) - 1]++; porDiaSemana[diaSemana(diaNum(o.fecha))]++; });
    const lunASab = contarDias(primeraN, finN, (d) => d <= 5);
    let habilesSinOperar = 0;
    for (let d = primeraN; d <= finN; d++) if (diaSemana(d) <= 4 && !conOp.has(d)) habilesSinOperar++;
    const fr = (k: number) => (n > 0 ? k / n : 0);
    fichas.push({
      id, nombre, rol,
      estado: estadoDe(n, pausaActual, primeraN, finN, cambio),
      ops: n,
      pct: total > 0 ? n / total : 0,
      primera: isoDeDia(primeraN),
      ultima: isoDeDia(ultimaN),
      opsSemAntes,
      opsSemUlt3m,
      cambio,
      opsSemUlt4s: ult4s / REGLAS.semanasUlt4s,
      trimestres: trimestres.map((t) => ({ etiqueta: t.etiqueta, opsSem: dias.filter((d) => d >= t.ini && d <= t.fin).length / ((t.fin - t.ini + 1) / 7) })),
      diasConOp: fechas.length,
      pctDiasOpera: lunASab > 0 ? Math.min(1, fechas.length / lunASab) : 0,
      porDiaQueOpera: fechas.length > 0 ? n / fechas.length : 0,
      diasHabilesSinOperar: habilesSinOperar,
      importacion: fr(lista.filter((o) => o.importacion).length),
      exportacion: fr(lista.filter((o) => o.exportacion).length),
      vacios: fr(lista.filter((o) => o.vacio).length),
      hazmat: lista.filter((o) => o.hazmat).length,
      falso: lista.filter((o) => o.falso).length,
      sabados: fr(porDiaSemana[5]),
      diaFuerte: porDiaSemana.indexOf(Math.max(...porDiaSemana)),
      porMes,
      porDiaSemana,
      pausaMasLarga,
      pausaActual,
    });
  });
  return fichas.sort((a, b) => b.ops - a.ops || a.nombre.localeCompare(b.nombre, 'es'));
};

export interface QueEstaCambiando {
  inactivos: FichaCliente[];
  bajando: FichaCliente[];
  creciendo: FichaCliente[];
  nuevos: FichaCliente[];
}

/** Clientes con 20 o más operaciones, agrupados por cómo se comportan en los últimos 3 meses. */
export const queEstaCambiando = (fichas: readonly FichaCliente[]): QueEstaCambiando => {
  const con = fichas.filter((f) => f.ops >= REGLAS.minOps);
  const de = (e: EstadoCliente) => con.filter((f) => f.estado === e);
  return {
    inactivos: de('inactivo').sort((a, b) => b.ops - a.ops),
    bajando: de('bajando').sort((a, b) => (a.cambio ?? 0) - (b.cambio ?? 0)),
    creciendo: de('creciendo').sort((a, b) => (b.cambio ?? 0) - (a.cambio ?? 0)),
    nuevos: de('nuevo').sort((a, b) => b.ops - a.ops),
  };
};

/** Operaciones de un cliente en ese papel, de la más reciente a la primera. */
export const operacionesDeCliente = (ops: readonly OpAnalisis[], rol: RolCliente, clienteId: string): OpAnalisis[] =>
  ops.filter((o) => clienteDeRol(o, rol)?.id === clienteId)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.ref.localeCompare(a.ref, 'es', { numeric: true }));

// ── Orden de las tablas ───────────────────────────────────────────────────
export type ColumnaFicha = 'nombre' | 'estado' | 'ops' | 'pct' | 'cambio' | 'opsSemUlt4s' | 'diaFuerte' | 'pausaMasLarga' | 'pausaActual' | 'ultima'
  | 'diasConOp' | 'pctDiasOpera' | 'porDiaQueOpera' | 'diasHabilesSinOperar';

const valorOrden = (f: FichaCliente, c: ColumnaFicha): number | string => {
  if (c === 'nombre') return normalizarTexto(f.nombre);
  if (c === 'estado') return ORDEN_ESTADOS.indexOf(f.estado);
  if (c === 'cambio') return f.cambio ?? -Infinity;
  return f[c];
};

/** Ordena por una columna (empate: más operaciones primero). */
export const ordenarFichas = (lista: readonly FichaCliente[], col: ColumnaFicha, dir: 1 | -1): FichaCliente[] =>
  [...lista].sort((a, b) => {
    const x = valorOrden(a, col); const y = valorOrden(b, col);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || b.ops - a.ops;
  });

/** Texto o número: los textos empiezan de la A, los números del mayor. */
export const direccionInicial = (col: ColumnaFicha): 1 | -1 => (col === 'nombre' || col === 'estado' || col === 'ultima' ? 1 : -1);

// ── Formatos ──────────────────────────────────────────────────────────────
export const fmtPct = (f: number, decimales = 1): string => `${(f * 100).toFixed(decimales).replace(/\.0$/, '')}%`;
export const fmtCambio = (c: number | null): string => (c === null ? '—' : `${c >= 0 ? '+' : ''}${Math.round(c * 100)}%`);
export const fmtNum = (n: number, decimales = 1): string => (Math.round(n * 10 ** decimales) / 10 ** decimales).toLocaleString('es-MX', { maximumFractionDigits: decimales });
/** "2026-07-08" → "8 jul". */
export const fmtDiaMes = (iso: string): string => `${Number(iso.slice(8, 10))} ${MESES_MIN[Number(iso.slice(5, 7)) - 1] ?? ''}`.trim();

// src/features/operaciones/services/movimientosPuente.ts
// ✅ V00455: MOVIMIENTOS DEL SALDO de un puente (modal de las tarjetas de puente de
//   Operaciones Activas): saldos agregados (+) y referencias del Historial / otros
//   cruces que lo descuentan (−), filtrados por rango de fechas. Lógica pura.
//   Cada referencia cuenta solo la parte que es de ESE puente (caseta y/o Puente Mx
//   Colombia), igual que la pestaña Saldo de Referencias de Puentes y las tarjetas.

/** Fila guardada en una referencia del Historial (referencias_puentes_auto.operacionesGuardadas). */
export interface FilaRefPuente {
  ref: string;
  /** "Caseta X" o "Caseta X + Puente Mx Colombia". */
  puenteNombre: string;
  caseta: number;
  casetaMoneda: string;
  piso: number;
  pisoMoneda: string;
}

export interface RefPuente {
  id: string;
  consecutivo: string;
  puenteNombre: string;
  fecha: string; // AAAA-MM-DD (fechaGeneracion)
  hora: string;
  automatico: boolean;
  filas: FilaRefPuente[];
}

export interface SaldoPuenteMin {
  id: string;
  puenteId: string;
  puenteNombre: string;
  fecha: string;
  hora: string;
  saldo: number;
  moneda: string;
  registradoPor: string;
}

/** Otro cruce del sistema anterior (referencias_puentes con tipo "otroCruce"). */
export interface OtroCruceMin {
  id: string;
  consecutivo: string;
  puenteNombre: string;
  fecha: string;
  hora: string;
  monto: number;
  moneda: string;
  unidad: string;
}

export interface MontoMoneda { moneda: string; monto: number; }

export interface MovimientoPuente {
  id: string;
  tipo: 'referencia' | 'saldo' | 'otroCruce';
  consecutivo: string;
  puente: string;
  fecha: string;
  hora: string;
  /** Refs de operación (y "Otro cruce…") que descuentan de este puente. */
  operaciones: string[];
  /** Cargo (referencia, otro cruce) o abono (saldo), por moneda. */
  montos: MontoMoneda[];
  automatico: boolean;
  registradoPor: string;
}

export interface DatosMovimientos {
  refs: readonly RefPuente[];
  saldos: readonly SaldoPuenteMin[];
  otros: readonly OtroCruceMin[];
}

const sumarEn = (mapa: Map<string, number>, moneda: string, monto: number) => {
  if (!(monto > 0)) return;
  const m = moneda || 'Sin moneda';
  mapa.set(m, Math.round(((mapa.get(m) || 0) + monto) * 100) / 100);
};
const aLista = (mapa: Map<string, number>): MontoMoneda[] => Array.from(mapa, ([moneda, monto]) => ({ moneda, monto }));

/**
 * Todos los movimientos de un puente, del más reciente al más antiguo.
 * `esDelPuente(nombre)` decide si una caseta o piso es de este puente;
 * `esSaldoDelPuente(s)` si un saldo agregado le toca.
 */
export const movimientosDePuente = (
  datos: DatosMovimientos,
  esDelPuente: (nombre: string) => boolean,
  esSaldoDelPuente: (s: SaldoPuenteMin) => boolean,
): MovimientoPuente[] => {
  const out: MovimientoPuente[] = [];
  datos.refs.forEach((r) => {
    const montos = new Map<string, number>();
    const operaciones: string[] = [];
    r.filas.forEach((f) => {
      const [nomCaseta, nomPiso] = String(f.puenteNombre || '').split(' + ');
      let cuenta = false;
      if (nomCaseta && esDelPuente(nomCaseta) && f.caseta > 0) { sumarEn(montos, f.casetaMoneda, f.caseta); cuenta = true; }
      if (nomPiso && esDelPuente(nomPiso) && f.piso > 0) { sumarEn(montos, f.pisoMoneda, f.piso); cuenta = true; }
      if (cuenta) operaciones.push(f.ref);
    });
    if (operaciones.length === 0) return;
    out.push({ id: `ref:${r.id}`, tipo: 'referencia', consecutivo: r.consecutivo, puente: r.puenteNombre, fecha: r.fecha, hora: r.hora, operaciones, montos: aLista(montos), automatico: r.automatico, registradoPor: '' });
  });
  datos.saldos.forEach((s) => {
    if (!esSaldoDelPuente(s) || !(s.saldo > 0)) return;
    out.push({ id: `saldo:${s.id}`, tipo: 'saldo', consecutivo: 'Saldo agregado', puente: s.puenteNombre, fecha: s.fecha, hora: s.hora, operaciones: [], montos: [{ moneda: s.moneda || 'Sin moneda', monto: s.saldo }], automatico: false, registradoPor: s.registradoPor });
  });
  datos.otros.forEach((o) => {
    if (!esDelPuente(o.puenteNombre) || !(o.monto > 0)) return;
    out.push({ id: `otro:${o.id}`, tipo: 'otroCruce', consecutivo: o.consecutivo, puente: o.puenteNombre, fecha: o.fecha, hora: o.hora, operaciones: [`Otro cruce${o.unidad ? ` · ${o.unidad}` : ''}`], montos: [{ moneda: o.moneda || 'Sin moneda', monto: o.monto }], automatico: false, registradoPor: '' });
  });
  return out.sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`) || b.consecutivo.localeCompare(a.consecutivo));
};

/** Movimientos con fecha dentro de [desde, hasta] (AAAA-MM-DD; vacío = sin límite). */
export const enRango = (movs: readonly MovimientoPuente[], desde: string, hasta: string): MovimientoPuente[] =>
  movs.filter((m) => (!desde || m.fecha >= desde) && (!hasta || m.fecha <= hasta));

/** Totales de una lista de movimientos: abonos (saldos) y cargos por moneda, referencias y operaciones. */
export const resumenMovimientos = (movs: readonly MovimientoPuente[]) => {
  const abonos = new Map<string, number>();
  const cargos = new Map<string, number>();
  let referencias = 0;
  let operaciones = 0;
  movs.forEach((m) => {
    m.montos.forEach((x) => sumarEn(m.tipo === 'saldo' ? abonos : cargos, x.moneda, x.monto));
    if (m.tipo !== 'saldo') { referencias += 1; operaciones += m.operaciones.length; }
  });
  return { abonos: aLista(abonos), cargos: aLista(cargos), referencias, operaciones };
};

/** Fecha AAAA-MM-DD de hace `dias` días a partir de `hoy` (AAAA-MM-DD), en hora local. */
export const haceDias = (hoy: string, dias: number): string => {
  const [y, m, d] = hoy.split('-').map(Number);
  const f = new Date(y, (m || 1) - 1, (d || 1) - dias);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};

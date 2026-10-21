// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.
// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).
// src/shared/dominio/cobroPuente.ts
// ---------------------------------------------------------------------------
// ✅ V00441 (Fase 5.7) — COBRO DEL PUENTE (peaje) como lógica PURA compartida.
// Antes vivía en src/utils/puenteColombia.ts y, duplicada, en OperacionesDashboard
// y FormularioOperacion (con una cadena de getDoc por clic). Ahora:
//   · cobroPuenteDeOperacion → asignar en lote (Referencias de Puentes, V00392).
//   · cobroAlCambiarStatus   → al pasar a Verde / estatus "🌉" / Completado; es la
//     regla de OperacionesDashboard (V00355…V00416) y la usa el TRIGGER del servidor
//     (bandera cobroPuenteEnServidor) para web, Mis Operaciones y la app móvil.
// Sin Firebase: recibe los catálogos ya cargados (CtxCobroPuente).
// ---------------------------------------------------------------------------
import { STATUS_COMPLETADOS } from './constantes.js';
import { monedaCanonica, nombreMoneda } from './moneda.js';
import type { Moneda } from './moneda.js';
import { fechaServicioDeOperacion } from './fechas.js';

type Datos = Record<string, unknown>;

export const normPuente = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const NOMBRE_PISO_COLOMBIA = 'Puente Mx Colombia';
export const esGastoPisoColombia = (nombreGasto: unknown): boolean => normPuente(nombreGasto) === normPuente(NOMBRE_PISO_COLOMBIA);
export const esAduanaColombia = (nombreAduana: unknown): boolean => normPuente(nombreAduana).includes('colombia');

/** Moneda como la escribe la app ("Dólares"/"Pesos"); lo no reconocido se deja tal cual. */
export const monedaNombrePuente = (m: unknown): string => nombreMoneda(monedaCanonica(m)) || String(m || '');

/** Catálogos que necesita el cobro (mapas por id). */
export interface CtxCobroPuente {
  detalles: ReadonlyMap<string, Datos>;
  tarifas: ReadonlyMap<string, Datos>;
  gastosIncluidos: readonly Datos[];
  tiposGasto: ReadonlyMap<string, Datos>;
  aduanas: ReadonlyMap<string, string>;
}

/** ✅ V00369/V00371: el peaje aplica SOLO a Transfer y a Logística de Cruces con proveedor Roelca. */
export const aplicaPeaje = (op: Datos): boolean => {
  const tipo = normPuente(op.tipoOperacionNombre);
  if (tipo.includes('flete') || tipo.includes('movimiento')) return false;
  if (tipo.includes('transfer')) return true;
  if (!tipo.includes('logistica')) return false;
  return normPuente(op.proveedorUnidadNombre).includes('roelca');
};

/**
 * ✅ V00465: TARIFA DE REFERENCIA del detalle de convenio. Convenios de Clientes la guarda en
 * `tipoConvenioId` (igual que lo lee el formulario de operación); antes aquí solo se leía
 * `tarifaBaseId`, y con un detalle que no lo trae no se encontraba la caseta de la tarifa ni la
 * aduana. El primer campo con valor manda (tarifaBaseId sigue primero: nada cambia donde ya estaba).
 */
export const tarifaDeDetalleConvenio = (det: Datos | undefined | null): string => {
  if (!det) return '';
  for (const k of ['tarifaBaseId', 'tarifa_base_id', 'tarifaReferenciaId', 'tarifa_referencia_id', 'tipoConvenioId', 'tipo_convenio_id', 'tipoConvenio', 'tipo_convenio', 'tarifaId', 'tarifa_id', 'TIPO DE CONVENIO']) {
    const v = String(det[k] ?? '').trim();
    if (v) return v;
  }
  return '';
};
const tarifaBaseDe = tarifaDeDetalleConvenio;

const refTarifaDeVinculo = (g: Datos): string =>
  String(g.tarifa_referencia_id ?? g.tarifaReferenciaId ?? g.tarifa_referencia ?? g.tarifaReferencia ?? g.ID_SERVICES ?? g.id_services ?? g.idServices ?? g.tarifaId ?? '').trim();

const gastoDeVinculo = (g: Datos): string => String(g.gasto ?? g.gastoId ?? g.gasto_id ?? '').trim();
const montoDeVinculo = (g: Datos): number => Number(g.monto ?? g.importe ?? g.cantidad ?? g.valor ?? 0) || 0;

const gastoConIdPorNombre = (ctx: CtxCobroPuente, nombres: string[]): { id: string; x: Datos } | null => {
  for (const [id, x] of ctx.tiposGasto) if (nombres.includes(normPuente(x.nombre_gasto))) return { id, x };
  return null;
};
const gastoPorNombre = (ctx: CtxCobroPuente, nombres: string[]): Datos | null => gastoConIdPorNombre(ctx, nombres)?.x ?? null;

/** ✅ V00412: nombre de la ADUANA de la operación (convenio → tarifa de referencia). */
export const aduanaDeOperacionCtx = (ctx: CtxCobroPuente, op: Datos): string => {
  const tarifaBase = tarifaBaseDe(ctx.detalles.get(String(op.convenio || '').trim()));
  const t = tarifaBase ? ctx.tarifas.get(tarifaBase) : undefined;
  const v = String(t?.aduana ?? '').trim();
  return ctx.aduanas.get(v) || v;
};

const hoyUTC = (): string => new Date().toISOString().slice(0, 10);

/**
 * ✅ V00469: ¿la operación YA tiene su caseta? Solo un monto mayor a 0 o el puente elegido a
 * mano en Referencias de Puentes (`saldoPuenteManual`). Un 0 o un campo vacío NO cuentan: antes
 * un 0 (p. ej. una caseta del catálogo sin importe) dejaba la operación sin cobrar para siempre,
 * aunque Referencias de Puentes sí la veía "sin monto".
 */
export const puenteYaCobrado = (op: Datos): boolean => Number(op.saldoPuente) > 0 || op.saldoPuenteManual === true;

/**
 * ✅ V00392: campos saldoPuente… / saldoPuentePiso… que le FALTAN a la operación
 * ({} si ya los tiene o no aplica). Para asignar en lote desde Referencias de Puentes.
 * ✅ V00469: la caseta sale de `casetaPrevista` (la MISMA regla del cobro al cambiar de estatus;
 * antes, con aduana Colombia podía tomar una caseta de Nuevo Laredo de la tarifa), y la fecha de
 * servicio se convierte (Timestamp o d/m/aaaa de AppSheet ya no quedan como texto roto).
 */
export const cobroPuenteDeOperacion = (ctx: CtxCobroPuente, op: Datos, evento = 'Asignado desde Referencias de Puentes', hoy = hoyUTC()): Datos => {
  const fecha = fechaServicioDeOperacion(op) || hoy;
  const colombia = esAduanaColombia(aduanaDeOperacionCtx(ctx, op));
  const out: Datos = {};

  if (!(Number(op.saldoPuente) > 0)) {
    const caseta = casetaPrevista(ctx, op);
    if (caseta && caseta.monto > 0) {
      Object.assign(out, { saldoPuente: caseta.monto, saldoPuentePuente: caseta.nombre, saldoPuenteMoneda: monedaNombrePuente(caseta.moneda), saldoPuenteFecha: fecha, saldoPuenteEvento: evento });
    }
  }

  if (colombia && !(Number(op.saldoPuentePiso) > 0) && (Number(op.saldoPuente) > 0 || Number(out.saldoPuente) > 0)) {
    const p = gastoPorNombre(ctx, [normPuente(NOMBRE_PISO_COLOMBIA)]);
    if (p && Number(p.importe) > 0) {
      Object.assign(out, { saldoPuentePiso: Number(p.importe), saldoPuentePisoPuente: String(p.nombre_gasto || NOMBRE_PISO_COLOMBIA), saldoPuentePisoMoneda: monedaNombrePuente(p.moneda), saldoPuentePisoFecha: String(op.saldoPuenteFecha || out.saldoPuenteFecha || fecha), saldoPuentePisoEvento: evento });
    }
  }
  return out;
};

/** ✅ V00473: un puente elegido en Reglas de Estatus (tipo de gasto y, si se cambió, su monto). */
export interface PuenteElegido {
  gastoId: string;
  /** null = el importe del catálogo Tipos de Gastos. */
  monto: number | null;
}

/** ✅ V00473: el puente que eligieron en Reglas de Estatus para el paso que cobra. */
export interface ReglaPuenteFlujo {
  /** La caseta (en Colombia, la de cruzar). */
  caseta: PuenteElegido | null;
  /** Colombia: el puente (piso). */
  piso: PuenteElegido | null;
  /** Aduana del flujo ('' = flujo para todas las aduanas). */
  aduanaFlujo: string;
}

/** Evento de cambio de estatus que puede cobrar el puente. */
export interface EventoStatusPuente {
  statusId: string;
  statusNombre: string;
  /** Fecha capturada del movimiento (AAAA-MM-DD…); vacía → hoy. */
  fechaEvento: string;
  /** Regla del flujo (descuentaPuenteSegunFlujo): true/false, o null si el flujo no la define. */
  flagFlujo: boolean | null;
  /** Hoy (AAAA-MM-DD) en la zona de la operación. */
  hoy: string;
  /** Fecha de servicio en AAAA-MM-DD (para el respaldo de Completado). */
  fechaServicioISO: string;
  /** ✅ V00473: el puente elegido en Reglas de Estatus para este paso (si eligieron uno). */
  reglaPuente?: ReglaPuenteFlujo | null;
}

/** ¿El estatus dispara el cobro? (V00355/V00367/V00377) y con qué evento y fecha. */
export const disparoCobroPuente = (ev: EventoStatusPuente): { evento: string; fecha: string } | null => {
  const nombreSt = normPuente(ev.statusNombre);
  const esVerdeUSA = nombreSt.includes('verde usa');
  const esVerdeMX = nombreSt.includes('verde mx') || nombreSt.includes('verde mexico');
  const esCompletado = STATUS_COMPLETADOS.includes(String(ev.statusId || '').trim());
  const dispara = ev.flagFlujo === true || (ev.flagFlujo === null && (esVerdeUSA || esVerdeMX)) || esCompletado;
  if (!dispara) return null;
  const directo = ev.flagFlujo === true || esVerdeUSA || esVerdeMX;
  const evento = ev.flagFlujo === true ? String(ev.statusNombre || '').trim() : esVerdeUSA ? 'Verde USA' : esVerdeMX ? 'Verde MX' : 'Completado';
  // ✅ V00384: el cruce lleva la FECHA capturada del movimiento; Completado, la de servicio.
  const fecha = directo ? (String(ev.fechaEvento || '').slice(0, 10) || ev.hoy) : (ev.fechaServicioISO || ev.hoy);
  return { evento, fecha };
};

/** ✅ V00465: caseta que le toca a la operación (id del tipo de gasto, nombre, monto y moneda). */
export interface CasetaPrevista {
  gastoId: string;
  nombre: string;
  monto: number;
  moneda: unknown;
  /** De dónde salió: la tarifa del convenio, Reglas de Estatus (V00473), el respaldo de Colombia o el tráfico (o el verde marcado). */
  origen: 'tarifa' | 'regla' | 'colombia' | 'trafico';
}

/** ✅ V00473: el puente elegido, con su nombre y moneda del catálogo; null si ya no está o no tiene monto. */
export const casetaDeElegido = (ctx: CtxCobroPuente, elegido: PuenteElegido | null | undefined): Omit<CasetaPrevista, 'origen'> | null => {
  if (!elegido?.gastoId) return null;
  const cat = ctx.tiposGasto.get(elegido.gastoId);
  if (!cat) return null;
  const monto = elegido.monto != null && elegido.monto > 0 ? elegido.monto : Number(cat.importe) || 0;
  if (!(monto > 0)) return null;
  return { gastoId: elegido.gastoId, nombre: String(cat.nombre_gasto || ''), monto, moneda: cat.moneda };
};

/**
 * ✅ V00473: ¿el puente de Reglas de Estatus aplica a esta operación? Un flujo para todas las
 * aduanas también lo usan las de Colombia sin flujo propio: a esas no se les cobra la caseta
 * elegida para Nuevo Laredo, sino la de Colombia.
 */
const reglaAplica = (regla: ReglaPuenteFlujo | null | undefined, colombia: boolean): regla is ReglaPuenteFlujo =>
  !!regla && (!colombia || esAduanaColombia(regla.aduanaFlujo));

/**
 * ✅ V00465: la CASETA que corresponde a la operación, con la misma regla con la que se cobra
 * (cobroAlCambiarStatus): 1) la de los GASTOS INCLUIDOS de la tarifa del convenio, con el monto
 * del vínculo; 2) aduana Colombia → Trompo Colombia / Caseta Mx Colombia; 3) por TRÁFICO
 * (importación → Caseta AVI, exportación → Caseta Puente III; sin tráfico, el verde marcado).
 * La usa el formulario para dejar elegido el puente en cuanto hay convenio y unidad.
 */
export const casetaPrevista = (ctx: CtxCobroPuente, op: Datos, statusNombre = '', reglaPuente?: ReglaPuenteFlujo | null): CasetaPrevista | null => {
  const colombia = esAduanaColombia(aduanaDeOperacionCtx(ctx, op));
  const tarifaBase = tarifaBaseDe(ctx.detalles.get(String(op.convenio || '').trim()));
  if (tarifaBase) {
    for (const g of ctx.gastosIncluidos) {
      if (refTarifaDeVinculo(g) !== tarifaBase) continue;
      const gastoId = gastoDeVinculo(g);
      const cat = ctx.tiposGasto.get(gastoId);
      if (!cat || normPuente(cat.categoria_gasto) !== 'puente') continue;
      if (esGastoPisoColombia(cat.nombre_gasto)) continue;
      if (colombia && !normPuente(cat.nombre_gasto).includes('colombia')) continue;
      const monto = montoDeVinculo(g) || Number(cat.importe) || 0;
      if (monto > 0) return { gastoId, nombre: String(cat.nombre_gasto || ''), monto, moneda: cat.moneda, origen: 'tarifa' };
      break; // el primer vínculo de puente manda (igual que la pantalla)
    }
  }
  // ✅ V00473: después de la tarifa, el puente ELEGIDO en Reglas de Estatus para el paso que cobra.
  if (reglaAplica(reglaPuente, colombia)) {
    const elegida = casetaDeElegido(ctx, reglaPuente.caseta);
    if (elegida) return { ...elegida, origen: 'regla' };
  }
  if (colombia) {
    const trompo = normPuente(`${String(op.carga || '')} ${String(op.convenioNombre || '')}`).includes('trompo');
    const r = gastoConIdPorNombre(ctx, [trompo ? 'trompo colombia' : 'caseta mx colombia']);
    if (r && Number(r.x.importe) > 0) return { gastoId: r.id, nombre: String(r.x.nombre_gasto || ''), monto: Number(r.x.importe) || 0, moneda: r.x.moneda, origen: 'colombia' };
  }
  const traf = normPuente(op.trafico);
  const nombreSt = normPuente(statusNombre);
  const objetivo = traf.includes('import') ? 'avi' : traf.includes('export') ? 'p3'
    : nombreSt.includes('verde usa') ? 'avi' : (nombreSt.includes('verde mx') || nombreSt.includes('verde mexico')) ? 'p3' : '';
  if (!objetivo) return null;
  const r = gastoConIdPorNombre(ctx, objetivo === 'avi' ? ['caseta avi'] : ['caseta puente iii', 'caseta puente 3']);
  if (!r) return null;
  return { gastoId: r.id, nombre: String(r.x.nombre_gasto || ''), monto: Number(r.x.importe) || 0, moneda: r.x.moneda, origen: 'trafico' };
};

/**
 * Campos del cobro del puente al CAMBIAR DE ESTATUS ({} si no aplica o ya se cobró).
 * Misma regla que OperacionesDashboard.camposSaldoPuenteAlCompletar:
 *   1) solo si la operación aún no tiene saldoPuente (nunca se cobra dos veces);
 *   2) caseta de los GASTOS INCLUIDOS de la tarifa (V00373; con aduana Colombia, la de Colombia);
 *   3) aduana Colombia sin caseta → Trompo Colombia / Caseta Mx Colombia (V00388/V00416);
 *   4) por TRÁFICO: importación → Caseta AVI, exportación → Caseta Puente III; sin tráfico,
 *      el verde marcado decide (V00365);
 *   5) aduana Colombia → además el PISO "Puente Mx Colombia" (V00388).
 */
export const cobroAlCambiarStatus = (ctx: CtxCobroPuente, op: Datos, ev: EventoStatusPuente): Datos => {
  if (puenteYaCobrado(op)) return {}; // ✅ V00469: un 0 ya no cuenta como cobrado
  if (!aplicaPeaje(op)) return {};
  const disparo = disparoCobroPuente(ev);
  if (!disparo) return {};
  const { evento, fecha } = disparo;
  const colombia = esAduanaColombia(aduanaDeOperacionCtx(ctx, op));
  // ✅ V00465: la elección de la caseta es casetaPrevista (la misma que ve el formulario).
  const c = casetaPrevista(ctx, op, ev.statusNombre, ev.reglaPuente);
  // ✅ V00469: una caseta sin importe (0) no se cobra: se queda pendiente, no en 0 para siempre.
  const base: Datos = c && c.monto > 0
    ? { saldoPuente: c.monto, saldoPuentePuente: c.nombre, saldoPuenteMoneda: monedaNombrePuente(c.moneda), saldoPuenteFecha: fecha, saldoPuenteEvento: evento }
    : {};
  if (!(Number(base.saldoPuente) > 0) || !colombia || Number(op.saldoPuentePiso) > 0) return base;
  // ✅ V00473: el puente (piso) elegido en Reglas de Estatus de un flujo de Colombia; si no, el del catálogo.
  const pisoElegido = reglaAplica(ev.reglaPuente, colombia) && esAduanaColombia(ev.reglaPuente.aduanaFlujo) ? casetaDeElegido(ctx, ev.reglaPuente.piso) : null;
  const piso: Datos | null = pisoElegido
    ? { nombre_gasto: pisoElegido.nombre, moneda: pisoElegido.moneda }
    : gastoPorNombre(ctx, [normPuente(NOMBRE_PISO_COLOMBIA)]);
  const montoPiso = pisoElegido ? pisoElegido.monto : Number(piso?.importe) || 0;
  if (!piso || montoPiso <= 0) return base;
  return {
    ...base,
    saldoPuentePiso: montoPiso,
    saldoPuentePisoPuente: String(piso.nombre_gasto || NOMBRE_PISO_COLOMBIA),
    saldoPuentePisoMoneda: monedaNombrePuente(piso.moneda),
    saldoPuentePisoFecha: String(base.saldoPuenteFecha || ''),
    saldoPuentePisoEvento: String(base.saldoPuenteEvento || ''),
  };
};

/**
 * ✅ V00469: un clic que pasa por VARIOS estatus (cascada: p. ej. Verde USA → En tránsito, el
 * segundo automático) cobra en el PRIMER paso que dispara. Antes solo se revisaba el último, y
 * el cruce en Verde se quedaba sin cobrar hasta Completado (con otra fecha y otro evento).
 */
export const cobroEnCascada = (ctx: CtxCobroPuente, op: Datos, pasos: readonly EventoStatusPuente[]): Datos => {
  for (const ev of pasos) {
    const c = cobroAlCambiarStatus(ctx, op, ev);
    if (Object.keys(c).length > 0) return c;
  }
  return {};
};

/** ✅ V00470: una línea del costo del puente que se muestra (informativo) en el Editor de Flujos. */
export interface LineaPuenteFlujo {
  /** 'Caseta' / 'Puente' (Colombia), o 'Importación' / 'Exportación' cuando el flujo es para todos los tráficos. */
  etiqueta: string;
  /** ✅ V00473: id del tipo de gasto ('' si no está en el catálogo). */
  gastoId: string;
  nombre: string;
  /** null = ese tipo de gasto no está en el catálogo. */
  monto: number | null;
  moneda: Moneda | null;
}

const lineaDeCatalogo = (tiposGasto: ReadonlyMap<string, Datos>, etiqueta: string, nombres: string[], nombreVisible: string): LineaPuenteFlujo => {
  for (const [gastoId, x] of tiposGasto) {
    if (nombres.includes(normPuente(x.nombre_gasto))) {
      return { etiqueta, gastoId, nombre: String(x.nombre_gasto || nombreVisible), monto: Number(x.importe) || 0, moneda: monedaCanonica(x.moneda) };
    }
  }
  return { etiqueta, gastoId: '', nombre: nombreVisible, monto: null, moneda: null };
};

/**
 * ✅ V00470: lo que cobra un paso del FLUJO, con el costo del catálogo Tipos de Gastos (informativo:
 * el flujo no tiene convenio; si la tarifa del convenio de la operación trae su caseta, se cobra esa).
 *   · aduana Colombia → la CASETA (Trompo Colombia si la carga es trompo; si no, Caseta Mx Colombia)
 *     y el PUENTE (Puente Mx Colombia): dos líneas;
 *   · importación → Caseta AVI; exportación → Caseta Puente III;
 *   · sin tráfico (flujo para todos) → las dos, una por tráfico.
 */
export const casetasDeFlujo = (tiposGasto: ReadonlyMap<string, Datos>, flujo: { trafico?: unknown; carga?: unknown; aduana?: unknown }): LineaPuenteFlujo[] => {
  if (esAduanaColombia(flujo.aduana)) {
    const trompo = normPuente(flujo.carga).includes('trompo');
    return [
      lineaDeCatalogo(tiposGasto, 'Caseta', [trompo ? 'trompo colombia' : 'caseta mx colombia'], trompo ? 'Trompo Colombia' : 'Caseta Mx Colombia'),
      lineaDeCatalogo(tiposGasto, 'Puente', [normPuente(NOMBRE_PISO_COLOMBIA)], NOMBRE_PISO_COLOMBIA),
    ];
  }
  const avi = (etiqueta: string) => lineaDeCatalogo(tiposGasto, etiqueta, ['caseta avi'], 'Caseta AVI');
  const p3 = (etiqueta: string) => lineaDeCatalogo(tiposGasto, etiqueta, ['caseta puente iii', 'caseta puente 3'], 'Caseta Puente III');
  const traf = normPuente(flujo.trafico);
  if (traf.includes('import')) return [avi('Caseta')];
  if (traf.includes('export')) return [p3('Caseta')];
  return [avi('Importación'), p3('Exportación')];
};


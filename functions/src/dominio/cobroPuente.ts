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

const tarifaBaseDe = (det: Datos | undefined): string =>
  String(det?.tarifaBaseId ?? det?.tarifa_base_id ?? det?.tarifaReferenciaId ?? det?.tarifa_referencia_id ?? '').trim();

const refTarifaDeVinculo = (g: Datos): string =>
  String(g.tarifa_referencia_id ?? g.tarifaReferenciaId ?? g.tarifa_referencia ?? g.tarifaReferencia ?? g.ID_SERVICES ?? g.id_services ?? g.idServices ?? g.tarifaId ?? '').trim();

const gastoDeVinculo = (g: Datos): string => String(g.gasto ?? g.gastoId ?? g.gasto_id ?? '').trim();
const montoDeVinculo = (g: Datos): number => Number(g.monto ?? g.importe ?? g.cantidad ?? g.valor ?? 0) || 0;

const gastoPorNombre = (ctx: CtxCobroPuente, nombres: string[]): Datos | null => {
  for (const x of ctx.tiposGasto.values()) if (nombres.includes(normPuente(x.nombre_gasto))) return x;
  return null;
};

/** ✅ V00412: nombre de la ADUANA de la operación (convenio → tarifa de referencia). */
export const aduanaDeOperacionCtx = (ctx: CtxCobroPuente, op: Datos): string => {
  const tarifaBase = tarifaBaseDe(ctx.detalles.get(String(op.convenio || '').trim()));
  const t = tarifaBase ? ctx.tarifas.get(tarifaBase) : undefined;
  const v = String(t?.aduana ?? '').trim();
  return ctx.aduanas.get(v) || v;
};

const hoyUTC = (): string => new Date().toISOString().slice(0, 10);

/**
 * ✅ V00392: campos saldoPuente… / saldoPuentePiso… que le FALTAN a la operación
 * ({} si ya los tiene o no aplica). Para asignar en lote desde Referencias de Puentes.
 */
export const cobroPuenteDeOperacion = (ctx: CtxCobroPuente, op: Datos, evento = 'Asignado desde Referencias de Puentes', hoy = hoyUTC()): Datos => {
  const fecha = String(op.fechaServicio || '').slice(0, 10) || hoy;
  const tarifaBase = tarifaBaseDe(ctx.detalles.get(String(op.convenio || '').trim()));
  const tarifa = tarifaBase ? ctx.tarifas.get(tarifaBase) : undefined;
  const aduanaV = String(tarifa?.aduana ?? '').trim();
  const colombia = esAduanaColombia(ctx.aduanas.get(aduanaV) || aduanaV);
  const out: Datos = {};

  if (!(Number(op.saldoPuente) > 0)) {
    let caseta: { monto: number; nombre: string; moneda: unknown } | null = null;
    if (tarifaBase) {
      for (const g of ctx.gastosIncluidos) {
        if (refTarifaDeVinculo(g) !== tarifaBase) continue;
        const cat = ctx.tiposGasto.get(gastoDeVinculo(g));
        if (!cat || normPuente(cat.categoria_gasto) !== 'puente' || esGastoPisoColombia(cat.nombre_gasto)) continue;
        caseta = { monto: montoDeVinculo(g) || Number(cat.importe) || 0, nombre: String(cat.nombre_gasto || ''), moneda: cat.moneda };
        break;
      }
    }
    if (!caseta || !(caseta.monto > 0)) {
      let x: Datos | null = null;
      if (colombia) {
        const trompo = normPuente(`${String(op.carga || '')} ${String(op.convenioNombre || '')}`).includes('trompo');
        x = gastoPorNombre(ctx, [trompo ? 'trompo colombia' : 'caseta mx colombia']);
      } else {
        const traf = normPuente(op.trafico);
        if (traf.includes('import')) x = gastoPorNombre(ctx, ['caseta avi']);
        else if (traf.includes('export')) x = gastoPorNombre(ctx, ['caseta puente iii', 'caseta puente 3']);
      }
      if (x) caseta = { monto: Number(x.importe) || 0, nombre: String(x.nombre_gasto || ''), moneda: x.moneda };
    }
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
  if (Number.isFinite(Number(op.saldoPuente))) return {};
  if (!aplicaPeaje(op)) return {};
  const disparo = disparoCobroPuente(ev);
  if (!disparo) return {};
  const { evento, fecha } = disparo;
  const colombia = esAduanaColombia(aduanaDeOperacionCtx(ctx, op));
  const base = ((): Datos => {
    const tarifaBase = tarifaBaseDe(ctx.detalles.get(String(op.convenio || '').trim()));
    if (tarifaBase) {
      for (const g of ctx.gastosIncluidos) {
        if (refTarifaDeVinculo(g) !== tarifaBase) continue;
        const cat = ctx.tiposGasto.get(gastoDeVinculo(g));
        if (!cat || normPuente(cat.categoria_gasto) !== 'puente') continue;
        if (esGastoPisoColombia(cat.nombre_gasto)) continue;
        if (colombia && !normPuente(cat.nombre_gasto).includes('colombia')) continue;
        const monto = montoDeVinculo(g) || Number(cat.importe) || 0;
        if (monto > 0) return { saldoPuente: monto, saldoPuentePuente: String(cat.nombre_gasto || ''), saldoPuenteMoneda: monedaNombrePuente(cat.moneda), saldoPuenteFecha: fecha, saldoPuenteEvento: evento };
        break; // el primer vínculo de puente manda (igual que la pantalla)
      }
    }
    if (colombia) {
      const trompo = normPuente(`${String(op.carga || '')} ${String(op.convenioNombre || '')}`).includes('trompo');
      const x = gastoPorNombre(ctx, [trompo ? 'trompo colombia' : 'caseta mx colombia']);
      if (x && Number(x.importe) > 0) return { saldoPuente: Number(x.importe) || 0, saldoPuentePuente: String(x.nombre_gasto || ''), saldoPuenteMoneda: monedaNombrePuente(x.moneda), saldoPuenteFecha: fecha, saldoPuenteEvento: evento };
    }
    const traf = normPuente(op.trafico);
    const nombreSt = normPuente(ev.statusNombre);
    const objetivo = traf.includes('import') ? 'avi' : traf.includes('export') ? 'p3'
      : nombreSt.includes('verde usa') ? 'avi' : (nombreSt.includes('verde mx') || nombreSt.includes('verde mexico')) ? 'p3' : '';
    if (!objetivo) return {};
    const x = gastoPorNombre(ctx, objetivo === 'avi' ? ['caseta avi'] : ['caseta puente iii', 'caseta puente 3']);
    if (!x) return {};
    return { saldoPuente: Number(x.importe) || 0, saldoPuentePuente: String(x.nombre_gasto || ''), saldoPuenteMoneda: monedaNombrePuente(x.moneda), saldoPuenteFecha: fecha, saldoPuenteEvento: evento };
  })();
  if (!(Number(base.saldoPuente) > 0) || !colombia || Number(op.saldoPuentePiso) > 0) return base;
  const piso = gastoPorNombre(ctx, [normPuente(NOMBRE_PISO_COLOMBIA)]);
  const montoPiso = Number(piso?.importe) || 0;
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

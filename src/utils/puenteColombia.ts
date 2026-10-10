// src/utils/puenteColombia.ts
// ✅ V00388: ADUANA COLOMBIA = DOS cobros de puente.
//   1) CASETA (cruzar): la de los Gastos Incluidos de la tarifa — Caseta Mx
//      Colombia, o Trompo Colombia si es trompo — y va en `saldoPuente…`.
//   2) PUENTE (pisarlo): "Puente Mx Colombia", monto FIJO del catálogo Tipos de
//      Gastos (hoy $90) hasta que se modifique allá — va en `saldoPuentePiso…`.
//   Nuevo Laredo (y cualquier otra aduana) solo tiene UN cobro: la caseta.
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { idReal, obtenerCatalogo } from '../shared/data/catalogos';
import { monedaCanonica, nombreMoneda } from '../shared/dominio/moneda';

export const normPuente = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const NOMBRE_PISO_COLOMBIA = 'Puente Mx Colombia';
export const esGastoPisoColombia = (nombreGasto: unknown) => normPuente(nombreGasto) === normPuente(NOMBRE_PISO_COLOMBIA);
export const esAduanaColombia = (nombreAduana: unknown) => normPuente(nombreAduana).includes('colombia');

// ✅ V00439 (Fase 3.x): moneda con el helper compartido (ID, código o nombre);
//   lo que no reconoce se deja tal cual, como antes.
const monedaNombre = (m: unknown) => nombreMoneda(monedaCanonica(m)) || String(m || '');

// ✅ V00439 (Fase 3.x): los catálogos salen del listener compartido
//   (obtenerCatalogo, siempre en vivo); sin getDocs por clic ni caché de 10 min.
/** Mapa id → nombre del catálogo de aduanas. */
export const nombresAduana = async (): Promise<Map<string, string>> => {
  const aduanas = await obtenerCatalogo('catalogo_aduanas');
  return new Map(aduanas.map((d) => [idReal(d), String(d.aduana ?? d.nombre ?? '')]));
};

/** Nombre de una aduana guardada como id del catálogo (o ya como nombre). */
export const nombreAduana = async (valor: unknown): Promise<string> => {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  try { return (await nombresAduana()).get(v) || v; } catch { return v; }
};

/** Aduana (nombre) de la tarifa de referencia detrás del convenio de la operación. */
export const aduanaDeConvenio = async (convenioId: unknown): Promise<string> => {
  const convId = String(convenioId ?? '').trim();
  if (!convId) return '';
  try {
    const det = await getDoc(doc(db, 'convenios_clientes_detalles', convId));
    if (!det.exists()) return '';
    const dd = det.data() as Record<string, unknown>;
    const tarifaBase = String(dd.tarifaBaseId ?? dd.tarifa_base_id ?? dd.tarifaReferenciaId ?? dd.tarifa_referencia_id ?? '').trim();
    if (!tarifaBase) return '';
    const t = await getDoc(doc(db, 'catalogo_tarifas_referencia', tarifaBase));
    if (!t.exists()) return '';
    return nombreAduana((t.data() as Record<string, unknown>).aduana);
  } catch { return ''; }
};

/** Segundo cobro (piso del puente) si la aduana del convenio es Colombia; {} si no aplica o ya se cobró. */
export const camposPisoColombia = async (
  op: { convenio?: unknown; saldoPuentePiso?: unknown },
  fecha: unknown,
  evento: unknown,
): Promise<Record<string, unknown>> => {
  try {
    if (Number(op?.saldoPuentePiso) > 0) return {};
    const aduana = await aduanaDeConvenio(op?.convenio);
    if (!esAduanaColombia(aduana)) return {};
    const tipos = await obtenerCatalogo('catalogo_tipos_gastos');
    const x = tipos.find((t) => esGastoPisoColombia(t.nombre_gasto));
    if (!x) return {};
    const monto = Number(x.importe) || 0;
    if (monto <= 0) return {};
    return {
      saldoPuentePiso: monto,
      saldoPuentePisoPuente: String(x.nombre_gasto || NOMBRE_PISO_COLOMBIA),
      saldoPuentePisoMoneda: monedaNombre(x.moneda),
      saldoPuentePisoFecha: String(fecha || ''),
      saldoPuentePisoEvento: String(evento || ''),
    };
  } catch { return {}; }
};

/** Caseta de respaldo para Colombia cuando la tarifa no trae caseta: trompo → Trompo Colombia; si no, Caseta Mx Colombia. */
export const casetaRespaldoColombia = async (esTrompo: boolean): Promise<{ saldoPuente: number; saldoPuentePuente: string; saldoPuenteMoneda: string } | null> => {
  try {
    const tipos = await obtenerCatalogo('catalogo_tipos_gastos');
    const buscado = esTrompo ? 'trompo colombia' : 'caseta mx colombia';
    const x = tipos.find((t) => normPuente(t.nombre_gasto) === buscado);
    if (!x) return null;
    return { saldoPuente: Number(x.importe) || 0, saldoPuentePuente: String(x.nombre_gasto || ''), saldoPuenteMoneda: monedaNombre(x.moneda) };
  } catch { return null; }
};

// ✅ V00392: cálculo del COBRO DE PUENTE de una operación a partir de catálogos
//   ya cargados (para asignarlo en lote desde Referencias de Puentes).
export interface CtxCobroPuente {
  detalles: Map<string, Record<string, unknown>>;
  tarifas: Map<string, Record<string, unknown>>;
  gastosIncluidos: Record<string, unknown>[];
  tiposGasto: Map<string, Record<string, unknown>>;
  aduanas: Map<string, string>;
}

// ✅ V00439 (Fase 3.x): sin TTL. Cada snapshot del listener compartido trae un
//   arreglo nuevo, así que el contexto se reutiliza mientras los MISMOS arreglos
//   sigan vigentes (en lotes no se rearman los mapas por operación) y se rearma
//   en cuanto cambia cualquiera de los catálogos.
let ultimoCtx: { fuentes: readonly unknown[]; ctx: CtxCobroPuente } | null = null;
export const cargarCtxCobroPuente = async (): Promise<CtxCobroPuente> => {
  const fuentes = await Promise.all([
    obtenerCatalogo('convenios_clientes_detalles'),
    obtenerCatalogo('catalogo_tarifas_referencia'),
    obtenerCatalogo('tarifas_gastos_incluidos'),
    obtenerCatalogo('catalogo_tipos_gastos'),
    obtenerCatalogo('catalogo_aduanas'),
  ]);
  if (ultimoCtx && ultimoCtx.fuentes.every((f, i) => f === fuentes[i])) return ultimoCtx.ctx;
  const [det, tar, gi, tg, adu] = fuentes;
  const ctx: CtxCobroPuente = {
    detalles: new Map(det.map((d) => [idReal(d), d])),
    tarifas: new Map(tar.map((d) => [idReal(d), d])),
    gastosIncluidos: gi,
    tiposGasto: new Map(tg.map((d) => [idReal(d), d])),
    aduanas: new Map(adu.map((d) => [idReal(d), String(d.aduana ?? d.nombre ?? '')])),
  };
  ultimoCtx = { fuentes, ctx };
  return ctx;
};

const gastoPorNombre = (ctx: CtxCobroPuente, nombres: string[]) => {
  for (const x of ctx.tiposGasto.values()) if (nombres.includes(normPuente(x.nombre_gasto))) return x;
  return null;
};

/** Campos saldoPuente… / saldoPuentePiso… que le FALTAN a la operación ({} si ya los tiene o no aplica). */
export const cobroPuenteDeOperacion = (ctx: CtxCobroPuente, op: Record<string, unknown>, evento = 'Asignado desde Referencias de Puentes'): Record<string, unknown> => {
  const fecha = String(op.fechaServicio || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const det = ctx.detalles.get(String(op.convenio || '').trim());
  const tarifaBase = String(det?.tarifaBaseId ?? det?.tarifa_base_id ?? det?.tarifaReferenciaId ?? det?.tarifa_referencia_id ?? '').trim();
  const tarifa = tarifaBase ? ctx.tarifas.get(tarifaBase) : undefined;
  const aduanaV = String(tarifa?.aduana ?? '').trim();
  const colombia = esAduanaColombia(ctx.aduanas.get(aduanaV) || aduanaV);
  const out: Record<string, unknown> = {};

  if (!(Number(op.saldoPuente) > 0)) {
    let caseta: { monto: number; nombre: string; moneda: unknown } | null = null;
    if (tarifaBase) {
      for (const g of ctx.gastosIncluidos) {
        const ref = String(g.tarifa_referencia_id ?? g.tarifaReferenciaId ?? g.tarifa_referencia ?? g.tarifaReferencia ?? g.ID_SERVICES ?? g.id_services ?? g.idServices ?? g.tarifaId ?? '').trim();
        if (ref !== tarifaBase) continue;
        const cat = ctx.tiposGasto.get(String(g.gasto ?? g.gastoId ?? g.gasto_id ?? '').trim());
        if (!cat || normPuente(cat.categoria_gasto) !== 'puente' || esGastoPisoColombia(cat.nombre_gasto)) continue;
        caseta = { monto: Number(g.monto ?? g.importe ?? g.cantidad ?? g.valor ?? 0) || Number(cat.importe) || 0, nombre: String(cat.nombre_gasto || ''), moneda: cat.moneda };
        break;
      }
    }
    if (!caseta || !(caseta.monto > 0)) {
      let x: Record<string, unknown> | null = null;
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
      Object.assign(out, { saldoPuente: caseta.monto, saldoPuentePuente: caseta.nombre, saldoPuenteMoneda: monedaNombre(caseta.moneda), saldoPuenteFecha: fecha, saldoPuenteEvento: evento });
    }
  }

  if (colombia && !(Number(op.saldoPuentePiso) > 0) && (Number(op.saldoPuente) > 0 || Number(out.saldoPuente) > 0)) {
    const p = gastoPorNombre(ctx, [normPuente(NOMBRE_PISO_COLOMBIA)]);
    if (p && Number(p.importe) > 0) {
      Object.assign(out, { saldoPuentePiso: Number(p.importe), saldoPuentePisoPuente: String(p.nombre_gasto || NOMBRE_PISO_COLOMBIA), saldoPuentePisoMoneda: monedaNombre(p.moneda), saldoPuentePisoFecha: String(op.saldoPuenteFecha || out.saldoPuenteFecha || fecha), saldoPuentePisoEvento: evento });
    }
  }
  return out;
};

// ✅ V00412: nombre de la ADUANA de la operación (convenio → tarifa) usando el contexto cargado.
export const aduanaDeOperacionCtx = (ctx: CtxCobroPuente, op: Record<string, unknown>): string => {
  const det = ctx.detalles.get(String(op.convenio || '').trim());
  const tarifaBase = String(det?.tarifaBaseId ?? det?.tarifa_base_id ?? det?.tarifaReferenciaId ?? det?.tarifa_referencia_id ?? '').trim();
  const t = tarifaBase ? ctx.tarifas.get(tarifaBase) : undefined;
  const v = String(t?.aduana ?? '').trim();
  return ctx.aduanas.get(v) || v;
};

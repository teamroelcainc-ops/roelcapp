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
// ✅ V00441 (Fase 5.7): la regla pura del cobro vive en src/shared/dominio/cobroPuente.ts
//   (la usa también el trigger del servidor). Aquí quedan los cargadores de catálogos.
import { esAduanaColombia, esGastoPisoColombia, monedaNombrePuente as monedaNombre, NOMBRE_PISO_COLOMBIA, normPuente } from '../shared/dominio/cobroPuente';
import type { CtxCobroPuente } from '../shared/dominio/cobroPuente';
export { aduanaDeOperacionCtx, cobroPuenteDeOperacion, esAduanaColombia, esGastoPisoColombia, NOMBRE_PISO_COLOMBIA, normPuente } from '../shared/dominio/cobroPuente';
export type { CtxCobroPuente } from '../shared/dominio/cobroPuente';

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

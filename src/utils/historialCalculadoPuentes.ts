// src/utils/historialCalculadoPuentes.ts
// ============================================================================
// ✅ V00402: HISTORIAL CALCULADO de puentes (método AUTOMÁTICO).
//   Cuando una operación se marca con un estatus que contiene "Verde" (Verde MX
//   o Verde USA), se agrega sola a la referencia automática de SU PUENTE y del
//   DÍA DE HOY: referencias_puentes_auto/{GRUPO}_{YYYY-MM-DD}.
//   · Una referencia por puente y por día (AVI / PT3 / PTC), con el mismo
//     formato y la misma serie de consecutivos del Historial de Referencias.
//   · Misma forma de documento que la referencia manual (operacionesGuardadas,
//     totales por moneda…), con `automatico: true`.
//   · No marca las operaciones (el método manual sigue funcionando aparte).
// ============================================================================
import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { esOperacionPrueba } from './operacionPrueba';
import { cargarCtxCobroPuente, cobroPuenteDeOperacion, type CtxCobroPuente } from './puenteColombia';

export const COL_REF_AUTO = 'referencias_puentes_auto';
type GrupoRef = 'AVI' | 'PT3' | 'PTC';
const NOMBRE_GRUPO: Record<GrupoRef, string> = { AVI: 'Puente AVI', PT3: 'Puente III', PTC: 'Puente Colombia' };

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const esStatusVerde = (nombre: unknown) => norm(nombre).includes('verde');
export const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const horaDe = (fh: unknown) => { const m = String(fh ?? '').match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };

const esPuenteRoelca = (op: Record<string, unknown>) => {
  const tipo = norm(op.tipoOperacionNombre);
  if (tipo.includes('transfer')) return true;
  const logistica = tipo.includes('logistica') && !tipo.includes('flete');
  return logistica && norm(op.proveedorUnidadNombre || op.proveedorNombre).includes('roelca');
};

let ctxCache: { ts: number; ctx: CtxCobroPuente } | null = null;
const ctxCobro = async () => {
  if (ctxCache && Date.now() - ctxCache.ts < 10 * 60 * 1000) return ctxCache.ctx;
  const ctx = await cargarCtxCobroPuente();
  ctxCache = { ts: Date.now(), ctx };
  return ctx;
};

/** Montos de puente de la operación (los ya cobrados o, si aún no, los calculados). */
const montosPuente = async (op: Record<string, unknown>) => {
  let x: Record<string, unknown> = op;
  if (!(Number(op.saldoPuente) > 0)) x = { ...op, ...cobroPuenteDeOperacion(await ctxCobro(), op) };
  if (!(Number(x.saldoPuente) > 0)) return null;
  const casetaNom = String(x.saldoPuentePuente || '');
  const pisoNom = Number(x.saldoPuentePiso) > 0 ? String(x.saldoPuentePisoPuente || '') : '';
  const n = norm(`${casetaNom} ${pisoNom}`);
  const grupo: GrupoRef = n.includes('colombia') ? 'PTC' : n.includes('avi') ? 'AVI' : 'PT3';
  return {
    grupo,
    caseta: Number(x.saldoPuente) || 0, casetaMoneda: String(x.saldoPuenteMoneda || ''),
    piso: Number(x.saldoPuentePiso) || 0, pisoMoneda: String(x.saldoPuentePisoMoneda || ''),
    puenteNombre: [casetaNom, pisoNom].filter(Boolean).join(' + '),
  };
};

const siguienteConsecutivo = async (grupo: GrupoRef, fecha: string) => {
  const [y, m, d] = fecha.split('-');
  const prefijo = `${grupo}-${d}${m}${y.slice(2)}-`;
  let max = 0;
  for (const col of ['referencias_puentes', COL_REF_AUTO]) {
    try {
      const snap = await getDocs(query(collection(db, col), where('consecutivo', '>=', prefijo), where('consecutivo', '<', `${prefijo}~`)));
      snap.docs.forEach((x) => { const n = parseInt(String((x.data() as Record<string, unknown>).consecutivo || '').slice(prefijo.length), 10); if (n > max) max = n; });
    } catch { /* sin índice o sin permiso: se sigue */ }
  }
  return `${prefijo}${String(max + 1).padStart(3, '0')}`;
};

export type GrupoRefPuente = GrupoRef;
export const NOMBRE_GRUPO_PUENTE = NOMBRE_GRUPO;

/** Fila de la operación para la referencia + su grupo de puente (null si no se puede determinar). */
export const filaDeOperacion = async (op: Record<string, unknown>, horaVerde: string): Promise<{ grupo: GrupoRef; fila: Record<string, unknown> } | null> => {
  const m = await montosPuente(op);
  if (!m) return null;
  const opId = String(op._docId || op.id || '');
  return {
    grupo: m.grupo,
    fila: {
      id: opId,
      ref: String(op.ref || opId),
      fecha: String(op.fechaServicio || '').slice(0, 10),
      horaVerde,
      unidad: String(op.unidadNombre || op.unidad || '-'),
      convenio: String(op.convenioNombre || '-'),
      trafico: String(op.trafico || ''),
      puenteNombre: m.puenteNombre,
      caseta: m.caseta, casetaMoneda: m.casetaMoneda,
      piso: m.piso, pisoMoneda: m.pisoMoneda,
      puente: m.caseta + m.piso,
    },
  };
};

/** Agrega filas (sin duplicar) a la referencia `docId`; si no existe la crea con su consecutivo. */
export const upsertReferenciaAuto = async (docId: string, grupo: GrupoRef, fecha: string, filas: Record<string, unknown>[], hora: string, origen: 'verde' | 'manual'): Promise<void> => {
  const ref = doc(db, COL_REF_AUTO, docId);
  const previo = await getDoc(ref);
  const consecutivo = previo.exists() ? String((previo.data() as Record<string, unknown>).consecutivo || '') : await siguienteConsecutivo(grupo, fecha);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
    const ids = (Array.isArray(d.operacionesIds) ? d.operacionesIds : []) as string[];
    const nuevas = filas.filter((f) => !ids.includes(String(f.id)));
    if (nuevas.length === 0 && snap.exists()) return;
    const guardadas = [...((Array.isArray(d.operacionesGuardadas) ? d.operacionesGuardadas : []) as Record<string, unknown>[]), ...nuevas];
    const porMoneda: Record<string, number> = {};
    guardadas.forEach((o) => {
      if (Number(o.caseta) > 0) porMoneda[String(o.casetaMoneda || 'Sin moneda')] = (porMoneda[String(o.casetaMoneda || 'Sin moneda')] || 0) + Number(o.caseta);
      if (Number(o.piso) > 0) porMoneda[String(o.pisoMoneda || 'Sin moneda')] = (porMoneda[String(o.pisoMoneda || 'Sin moneda')] || 0) + Number(o.piso);
    });
    tx.set(ref, {
      automatico: true,
      origen: String(d.origen || origen),
      consecutivo: String(d.consecutivo || consecutivo),
      grupoPuente: grupo,
      puenteNombre: NOMBRE_GRUPO[grupo],
      fechaGeneracion: String(d.fechaGeneracion || fecha),
      horaGeneracion: String(d.horaGeneracion || hora),
      operacionesIds: [...ids, ...nuevas.map((f) => String(f.id))],
      operaciones: guardadas.map((o) => String(o.ref)),
      operacionesGuardadas: guardadas,
      subtotalPuentes: guardadas.reduce((a, o) => a + (Number(o.puente) || 0), 0),
      totalesPorMoneda: porMoneda,
      statusPagado: d.statusPagado === true,
      createdAt: String(d.createdAt || new Date().toISOString()),
      actualizadoEn: new Date().toISOString(),
    });
  });
};

/**
 * Agrega la operación a la referencia automática de su puente de HOY.
 * `op` = datos de la operación ya con lo que se acaba de guardar (status, cobro…).
 */
export const registrarVerdeAutomatico = async (op: Record<string, unknown>, statusNombre: unknown, fechaHora?: unknown): Promise<void> => {
  try {
    if (!esStatusVerde(statusNombre) || esOperacionPrueba(op) || !esPuenteRoelca(op)) return;
    const traf = norm(op.trafico);
    if (traf && !traf.includes('import') && !traf.includes('export')) return;
    const r = await filaDeOperacion(op, `${norm(statusNombre).includes('usa') ? 'Verde USA' : 'Verde MX'} ${horaDe(fechaHora)}`.trim());
    if (!r) return;
    const fecha = hoyLocal();
    await upsertReferenciaAuto(`${r.grupo}_${fecha}`, r.grupo, fecha, [r.fila], horaDe(fechaHora) || horaDe(new Date().toTimeString()), 'verde');
  } catch (e) {
    console.warn('[historialCalculado] no se pudo registrar el verde:', e);
  }
};

/** Revisa la bitácora de HOY y agrega a las referencias automáticas los verdes que falten. */
export const recalcularHistorialCalculadoHoy = async (): Promise<number> => {
  const hoy = hoyLocal();
  const snap = await getDocs(query(collection(db, 'horarios'), where('fechaHora', '>=', hoy), where('fechaHora', '<', `${hoy}~`)));
  const verdes = snap.docs.map((d) => d.data() as Record<string, unknown>).filter((h) => esStatusVerde(h.statusNombre));
  const vistos = new Set<string>();
  let n = 0;
  for (const h of verdes) {
    const id = String(h.operacionId || '');
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const opSnap = await getDoc(doc(db, 'operaciones', id));
    if (!opSnap.exists()) continue;
    await registrarVerdeAutomatico({ id: opSnap.id, _docId: opSnap.id, ...(opSnap.data() as Record<string, unknown>) }, h.statusNombre, h.fechaHora);
    n += 1;
  }
  return n;
};

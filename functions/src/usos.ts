/**
 * ✅ V00442 (Fase 6.5) — Contadores de uso (usos/{tipo}_{id}) desde operacionEscrita.
 * · Conteo: UN lote sin lecturas con create(eventos_procesados/usos_<evento>) +
 *   increment(): si el evento ya se contó, el create falla y no se suma dos veces.
 *   Sin transacción a propósito: una importación de cientos de operaciones de la misma
 *   empresa no compite por el mismo documento (increment no necesita leerlo).
 * · "Último uso": solo SUBE y es de mejor esfuerzo (sin transacción); al borrar una
 *   operación no se recalcula. Lo deja exacto el recuento (functions/scripts/recontarUsos.ts).
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { COL_USOS, diferenciaUsos, fechaDeUso, idUso, partesUso, usosDeOperacion } from './dominio/usos.js';
import { COL_EVENTOS } from './eventos.js';

type Datos = Record<string, unknown>;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Qué hay que tocar: llaves que suben, que bajan y las que solo actualizan su último uso. */
export const planUsos = (antes: Datos | undefined, despues: Datos | undefined): { sumar: string[]; restar: string[]; fechas: string[]; fecha: string } => {
  const { sumar, restar } = diferenciaUsos(antes, despues);
  const fecha = fechaDeUso(despues);
  const cambioFecha = !!antes && !!despues && fecha !== fechaDeUso(antes);
  const fechas = fecha ? Array.from(usosDeOperacion(despues)).filter((k) => sumar.includes(k) || cambioFecha) : [];
  return { sumar, restar, fechas, fecha };
};

const yaExiste = (e: unknown): boolean => ['6', 'ALREADY_EXISTS', 'ALREADY-EXISTS'].includes(String((e as { code?: unknown })?.code ?? '').toUpperCase());

export const actualizarUsos = async (db: Firestore, eventId: string, antes: Datos | undefined, despues: Datos | undefined): Promise<number> => {
  const { sumar, restar, fechas, fecha } = planUsos(antes, despues);
  if (sumar.length + restar.length + fechas.length === 0) return 0;
  const ref = (llave: string) => { const { tipo, refId } = partesUso(llave); return db.collection(COL_USOS).doc(idUso(tipo, refId)); };
  const base = (k: string): Datos => { const { tipo, refId } = partesUso(k); return { tipo, refId }; };
  if (sumar.length + restar.length > 0) {
    const lote = db.batch();
    lote.create(db.collection(COL_EVENTOS).doc(`usos_${eventId}`.replace(/\//g, '_')), { creadoEn: Timestamp.now(), expiraEn: Timestamp.fromMillis(Date.now() + TTL_MS) });
    for (const k of sumar) lote.set(ref(k), { ...base(k), usoOps: FieldValue.increment(1) }, { merge: true });
    for (const k of restar) lote.set(ref(k), { ...base(k), usoOps: FieldValue.increment(-1) }, { merge: true });
    try {
      await lote.commit();
    } catch (e) {
      if (yaExiste(e)) return 0; // este evento ya se contó (reintento)
      throw e;
    }
  }
  for (const k of fechas) {
    const actual = String(((await ref(k).get()).data() as Datos | undefined)?.ultimoUsoISO ?? '');
    if (fecha > actual) await ref(k).set({ ...base(k), ultimoUsoISO: fecha }, { merge: true });
  }
  return sumar.length + restar.length;
};

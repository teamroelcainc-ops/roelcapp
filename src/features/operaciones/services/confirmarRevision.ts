// src/features/operaciones/services/confirmarRevision.ts
// ---------------------------------------------------------------------------
// ✅ V00518 — CONFIRMAR como correcta (✓) una fila de la Revisión de datos (hoy: D6, canceladas que
// conservan su monto). Se escribe en la operación `revisionOk.<grupo>` = { en, por, detalle } y sale
// de la revisión; si su detalle cambia después (otro monto), vuelve a aparecer. No cambia nada más.
//   · Una por una (✓ Está bien en la fila): una escritura, con Deshacer.
//   · Todas las del grupo: reglas de escritura masiva del usuario (PRUEBA → RESPALDO → "APLICAR"),
//     en transacciones de 100 que releen cada operación: si ya no es de ese grupo o su detalle cambió,
//     no se confirma.
// ---------------------------------------------------------------------------
import { deleteField, doc, runTransaction, updateDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import type { CeldaExcel } from './excelOperaciones';
import { detalleD6 } from './revisionDatos';
import type { CodigoRevision, ConfirmacionRevision, FilaRevision } from './revisionDatos';

type Datos = Record<string, unknown>;
const TANDA = 100;

/** El detalle que tendría la operación HOY en ese grupo ('' = ya no es de ese grupo). */
const detalleActual = (codigo: CodigoRevision, op: Datos): string => (codigo === 'D6' ? detalleD6(op) : '');

export const marcaConfirmacion = (f: Pick<FilaRevision, 'detalle'>, cuando: string, quien: string): ConfirmacionRevision => ({ en: cuando, por: quien, detalle: f.detalle });

/** Confirma UNA fila (✓ Está bien). */
export const confirmarFila = async (codigo: CodigoRevision, f: FilaRevision, quien: string): Promise<ConfirmacionRevision> => {
  const marca = marcaConfirmacion(f, new Date().toISOString(), quien);
  await updateDoc(doc(db, 'operaciones', f.destino.id), { [`revisionOk.${codigo}`]: marca });
  return marca;
};

/** Quita la confirmación (Deshacer): vuelve a aparecer en la revisión. */
export const deshacerConfirmacion = async (codigo: CodigoRevision, opId: string): Promise<void> => {
  await updateDoc(doc(db, 'operaciones', opId), { [`revisionOk.${codigo}`]: deleteField() });
};

/** Excel de PRUEBA: lo que se confirmaría. */
export const filasPruebaConfirmar = (filas: readonly FilaRevision[]): Record<string, CeldaExcel>[] =>
  filas.map((f) => ({ 'Acción': 'Se confirma como correcta', Referencia: f.ref, Cliente: f.cliente, Fecha: f.fecha, Status: f.status, Detalle: f.detalle }));

/** RESPALDO: las operaciones no tenían confirmación; para deshacer se quita `revisionOk.<grupo>`. */
export const respaldoConfirmar = (codigo: CodigoRevision, filas: readonly FilaRevision[], cuando: string, quien: string): Datos => ({
  tipo: `respaldo-confirmar-${codigo}`, generado: cuando, por: quien,
  nota: `Para deshacer: en cada operación, quitar el campo revisionOk.${codigo}. No se cambió nada más.`,
  operaciones: filas.map((f) => ({ id: f.destino.id, ref: f.ref, cliente: f.cliente, antes: { [`revisionOk.${codigo}`]: null }, despues: { [`revisionOk.${codigo}`]: { detalle: f.detalle } } })),
});

/** Motivo por el que ya no se confirma al escribir ('' = se confirma). */
export const motivoAlConfirmar = (codigo: CodigoRevision, op: Datos | null, f: FilaRevision): string => {
  if (!op) return 'La operación ya no existe';
  const ahora = detalleActual(codigo, op);
  if (!ahora) return 'Ya no es de este grupo (cambió desde la revisión)';
  if (ahora !== f.detalle) return 'Sus montos cambiaron desde la revisión: revisarla otra vez';
  return '';
};

export interface OmitidaConfirmar { fila: FilaRevision; motivo: string }
export interface ResultadoConfirmar { confirmadas: Map<string, ConfirmacionRevision>; omitidas: OmitidaConfirmar[]; error: string }

/** Confirma todas las filas en tandas (transacción por tanda). */
export const confirmarTodas = async (codigo: CodigoRevision, filas: readonly FilaRevision[], cuando: string, quien: string, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoConfirmar> => {
  const total = filas.length;
  const confirmadas = new Map<string, ConfirmacionRevision>();
  const omitidas: OmitidaConfirmar[] = [];
  let error = '';
  alAvanzar(0, total);
  for (let i = 0; i < total && !error; i += TANDA) {
    const tanda = filas.slice(i, i + TANDA);
    const r = await runTransaction(db, async (tx) => {
      const refs = tanda.map((f) => doc(db, 'operaciones', f.destino.id));
      const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
      const fuera: OmitidaConfirmar[] = [];
      const hechas: [string, ConfirmacionRevision][] = [];
      tanda.forEach((f, k) => {
        const motivo = motivoAlConfirmar(codigo, snaps[k].exists() ? (snaps[k].data() as Datos) : null, f);
        if (motivo) { fuera.push({ fila: f, motivo }); return; }
        const marca = marcaConfirmacion(f, cuando, quien);
        tx.update(refs[k], { [`revisionOk.${codigo}`]: marca });
        hechas.push([f.destino.id, marca]);
      });
      return { fuera, hechas };
    }).catch((e: unknown) => {
      console.error(`[${codigo}] No se pudo confirmar una tanda de operaciones:`, e);
      error = String((e as { message?: string })?.message || e);
      return null;
    });
    if (!r) break;
    r.hechas.forEach(([id, m]) => confirmadas.set(id, m));
    omitidas.push(...r.fuera);
    alAvanzar(Math.min(i + TANDA, total), total);
  }
  if (confirmadas.size > 0) {
    await registrarLog('Operaciones', 'Edición',
      `Revisión de datos (${codigo}): confirmó ${confirmadas.size} operación(es) como correctas (revisionOk.${codigo}, ${cuando}). ${omitidas.length} no se confirmaron porque cambiaron desde la revisión.${error ? ` Se detuvo por un error: ${error}` : ''}`);
  }
  return { confirmadas, omitidas, error };
};

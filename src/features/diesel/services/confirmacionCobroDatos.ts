// src/features/diesel/services/confirmacionCobroDatos.ts
// ✅ V00459: guarda la confirmación del cobro en la referencia de diesel. Es dinero: se hace en
//   una TRANSACCIÓN que vuelve a leer la referencia y calcula los campos con lo que tiene ahora
//   (no con la copia de la lista). Solo se escriben los campos que cambian. El servidor, si
//   tiene encendido saldosCorrientes (y las funciones de la V00459), recalcula ese día solo.
import { doc, runTransaction } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { camposConfirmacion, errorCaptura, type CapturaCobro } from './confirmacionCobro';

export const usuarioActualDiesel = (): string => auth.currentUser?.displayName || auth.currentUser?.email || 'Usuario';

/** Guarda y devuelve los campos escritos (para reflejarlos en pantalla). */
export const guardarConfirmacionCobro = async (refId: string, captura: CapturaCobro): Promise<Record<string, unknown>> =>
  runTransaction(db, async (tx) => {
    const referencia = doc(db, 'referencias_diesel', refId);
    const snap = await tx.get(referencia);
    if (!snap.exists()) throw new Error('La referencia ya no existe.');
    const actual = snap.data() as Record<string, unknown>;
    const problema = errorCaptura(actual, captura);
    if (problema) throw new Error(problema);
    const campos = camposConfirmacion(actual, captura, usuarioActualDiesel(), new Date().toISOString());
    tx.update(referencia, campos);
    return campos;
  });

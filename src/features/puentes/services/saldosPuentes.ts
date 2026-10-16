// src/features/puentes/services/saldosPuentes.ts
// ✅ V00455: alta de un SALDO de puente (colección saldos_puentes). La usan la pestaña
//   Saldo de Referencias de Puentes y el botón "Actualizar saldo" de las tarjetas de
//   Operaciones Activas: el registro queda igual venga de donde venga.
import { collection, doc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';

export interface NuevoSaldoPuente {
  fecha: string; // AAAA-MM-DD
  hora: string; // HH:mm
  puenteId: string;
  puenteNombre: string;
  moneda: string; // "Dólares" / "Pesos"
  saldo: number;
}

export const usuarioActualPuentes = (): string => auth.currentUser?.displayName || auth.currentUser?.email || 'Usuario';

export const guardarSaldoPuente = async (s: NuevoSaldoPuente): Promise<void> => {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'saldos_puentes')), {
    fecha: s.fecha, hora: s.hora,
    puenteId: s.puenteId, puenteNombre: s.puenteNombre,
    moneda: s.moneda, saldo: s.saldo,
    registradoPor: usuarioActualPuentes(),
    creadoEn: new Date().toISOString(),
  });
  await batch.commit();
};

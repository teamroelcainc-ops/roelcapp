// src/features/diesel/services/saldosDiesel.ts
// ✅ V00457: alta de un SALDO de diesel (colección saldos_diesel). La usan la pestaña
//   Saldos de Referencias del Diesel y el botón "Actualizar saldo" de la tarjeta Saldo
//   Diesel de Operaciones Activas: el registro queda igual venga de donde venga.
import { collection, doc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { CLAVE_TODOS_DIESEL } from '../../../shared/dominio/saldosCorrientes';

/** Saldo GENERAL: descuenta las cargas de todos los proveedores (V00422). */
export const TODOS_PROVEEDORES_DIESEL = CLAVE_TODOS_DIESEL;
export const NOMBRE_TODOS_PROVEEDORES_DIESEL = 'Todos los proveedores';

export interface NuevoSaldoDiesel {
  fecha: string; // AAAA-MM-DD
  hora: string; // HH:mm
  proveedorId: string; // ID del proveedor o TODOS_PROVEEDORES_DIESEL
  proveedorNombre: string;
  saldo: number;
  moneda: string; // "Dólares" / "Pesos"
}

export const guardarSaldoDiesel = async (s: NuevoSaldoDiesel): Promise<void> => {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'saldos_diesel')), {
    fecha: s.fecha, hora: s.hora,
    proveedorId: s.proveedorId, proveedorNombre: s.proveedorNombre,
    saldo: s.saldo, moneda: s.moneda,
    registradoPor: auth.currentUser?.displayName || auth.currentUser?.email || 'Usuario',
    creadoEn: new Date().toISOString(),
  });
  await batch.commit();
};

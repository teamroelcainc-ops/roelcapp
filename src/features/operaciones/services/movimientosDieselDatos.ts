// src/features/operaciones/services/movimientosDieselDatos.ts
// ✅ V00457: lectura acotada para el detalle de un día en los movimientos del Saldo
//   Diesel: SOLO las referencias de diesel de esa fecha, y solo cuando se abre la fila
//   (con la bandera saldosCorrientes la tarjeta ya no escucha las referencias). Sin la
//   bandera el detalle sale de las referencias que la tarjeta ya tiene, sin leer nada.
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';

/** Clave de TanStack Query (+ la fecha). */
export const CLAVE_CARGAS_DIESEL_DIA = ['saldo-diesel', 'cargas-del-dia'] as const;

/** Referencias de diesel con fecha AAAA-MM-DD (también las que guardan hora después de la fecha). */
export const leerReferenciasDieselDelDia = async (fecha: string): Promise<Record<string, unknown>[]> => {
  const snap = await getDocs(query(collection(db, 'referencias_diesel'), where('fecha', '>=', fecha), where('fecha', '<=', `${fecha}\uf8ff`)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
};

// src/features/pagos/services/consultaPagos.ts
// ✅ V00502 — la consulta en vivo de los pagos de una pestaña de Pagos, en UN lugar: la usan Pagos y
// el buscador global con la MISMA clave, así comparten un solo listener (coleccionesVivas.ts).
import { collection, query, where } from 'firebase/firestore';
import type { Query } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import type { TipoPago } from './facturasPagables';

export const consultaPagos = (tipo: TipoPago): { clave: string; crear: () => Query } => ({
  clave: `pagos:${tipo}`,
  crear: () => query(collection(db, 'pagos'), where('tipo', '==', tipo)),
});

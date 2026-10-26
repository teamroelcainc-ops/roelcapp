// src/features/facturacion/services/descargarFacturas.ts
// ✅ V00494 — TODAS las facturas de una colección (Clientes o Proveedores), por páginas de 1,000.
//   Antes cada tablero tenía su copia del ciclo con un tope de 12,000 (`LIMITE_FACTURAS_TODAS`):
//   con más facturas, las que quedaban después del corte (por ID, no por fecha) no se cargaban y,
//   como cada factura nueva cae en cualquier lugar del orden por ID, cada día salía de la lista
//   otra distinta. Sus operaciones sin marca de facturada (importadas) volvían a "Pendientes" y se
//   facturaban otra vez. Ahora se baja hasta la última; el tope de seguridad se avisa.
import { collection, documentId, getDocs, limit, orderBy, query, startAfter } from 'firebase/firestore';
import type { DocumentData, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';

export const PAGINA_FACTURAS = 1000;
/** Tope de seguridad (no de diseño): si se alcanza, el tablero lo avisa. */
export const TOPE_FACTURAS = 100000;

export interface DescargaFacturas {
  /** `{ id, ...datos }` como siempre (un campo `id` guardado gana, igual que antes). */
  docs: Record<string, unknown>[];
  truncada: boolean;
}

export async function descargarTodasLasFacturas(
  coleccion: 'facturas_clientes' | 'facturas_proveedores', tope = TOPE_FACTURAS,
): Promise<DescargaFacturas> {
  const docs: Record<string, unknown>[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  while (docs.length < tope) {
    const filtros: QueryConstraint[] = [orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(PAGINA_FACTURAS)];
    const snap = await getDocs(query(collection(db, coleccion), ...filtros));
    snap.docs.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    if (snap.docs.length < PAGINA_FACTURAS) return { docs, truncada: false };
    cursor = snap.docs[snap.docs.length - 1];
  }
  return { docs, truncada: true };
}

export const avisoFacturasTruncadas = (n: number): string =>
  `Se cargaron ${n.toLocaleString('es-MX')} facturas (el máximo). Puede haber facturas que no aparecen y operaciones que se ven pendientes sin estarlo: avisa a soporte.`;

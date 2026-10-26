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
import { armarDoc } from '../../../shared/data/coleccionesVivas';
import type { DocVivo } from '../../../shared/data/coleccionesVivas';

export const PAGINA_FACTURAS = 1000;
/** Tope de seguridad (no de diseño): si se alcanza, el tablero lo avisa. */
export const TOPE_FACTURAS = 100000;

export interface DescargaFacturas<T = Record<string, unknown>> {
  /** `{ id, ...datos }` como siempre (un campo `id` guardado gana, igual que antes). */
  docs: T[];
  truncada: boolean;
}

type ColeccionFacturas = 'facturas_clientes' | 'facturas_proveedores';

async function paginar<T>(coleccion: ColeccionFacturas, armar: (id: string, datos: DocumentData) => T, tope: number): Promise<DescargaFacturas<T>> {
  const docs: T[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  while (docs.length < tope) {
    const filtros: QueryConstraint[] = [orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(PAGINA_FACTURAS)];
    const snap = await getDocs(query(collection(db, coleccion), ...filtros));
    snap.docs.forEach((d) => docs.push(armar(d.id, d.data())));
    if (snap.docs.length < PAGINA_FACTURAS) return { docs, truncada: false };
    cursor = snap.docs[snap.docs.length - 1];
  }
  return { docs, truncada: true };
}

export const descargarTodasLasFacturas = (coleccion: ColeccionFacturas, tope = TOPE_FACTURAS): Promise<DescargaFacturas> =>
  paginar(coleccion, (id, datos) => ({ id, ...datos }), tope);

/** ✅ V00496: lo mismo con la forma de los listeners (`armarDoc`: el id real en `_docId`), para Pagos. */
export const descargarFacturasComoVivas = (coleccion: ColeccionFacturas, tope = TOPE_FACTURAS): Promise<DescargaFacturas<DocVivo>> =>
  paginar(coleccion, armarDoc, tope);

export const avisoFacturasTruncadas = (n: number): string =>
  `Se cargaron ${n.toLocaleString('es-MX')} facturas (el máximo). Puede haber facturas que no aparecen y operaciones que se ven pendientes sin estarlo: avisa a soporte.`;

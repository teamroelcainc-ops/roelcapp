// src/features/facturacion/services/facturarSeguro.ts
// ---------------------------------------------------------------------------
// ✅ V00451 — Antes de facturar (camino sin `dineroPorServidor`), se pregunta al
// SERVIDOR en vez de confiar en la lista cargada:
//   · operacionesYaFacturadas: ¿alguna de las operaciones ya está en una factura?
//     (otra persona, otra pestaña u otra computadora pudo facturarla después de
//     que se cargó la lista). Revisa los campos de la operación Y las facturas
//     que la tienen en `operacionesIds`.
//   · facturaExistenteFresca: ¿ya existe una factura con ese número para esa
//     empresa? (antes solo se buscaba en la lista en memoria: si no estaba
//     cargada se creaba OTRA factura con el mismo folio y el documento se subía
//     a esa segunda, escondida detrás de la primera en el Historial).
// Caso real: operación LO-081026-004, "facturada dos veces y sigue pendiente".
// ---------------------------------------------------------------------------
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';

export type LadoFactura = 'cliente' | 'proveedor';

const CAMPOS = {
  cliente: { id: 'facturaClienteId', folio: 'facturaClienteInvoice', bandera: 'facturado', coleccion: 'facturas_clientes', empresa: 'clienteId' },
  proveedor: { id: 'facturaProveedorId', folio: 'facturaProveedorFolio', bandera: 'facturadoProveedor', coleccion: 'facturas_proveedores', empresa: 'proveedorId' },
} as const;

const LOTE = 30; // tope de Firestore para `in` y `array-contains-any`

const lotes = <T,>(xs: readonly T[]): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += LOTE) r.push(xs.slice(i, i + LOTE));
  return r;
};
const texto = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());

export interface OpAFacturar {
  /** ID con el que la factura guarda la operación (`op.id` de la lista). */
  idLista: string;
  /** ID real del documento (`_docId`). */
  idReal: string;
  ref: string;
}

export interface OpYaFacturada {
  idLista: string;
  ref: string;
  folio: string;
  facturaId: string;
}

/** Datos que se leen de una operación para decidir si está facturada (puro, probado aparte). */
export const facturaDeOperacion = (lado: LadoFactura, datos: Record<string, unknown>): { facturaId: string; folio: string; marcada: boolean } => {
  const c = CAMPOS[lado];
  const facturaId = texto(datos[c.id]);
  const folio = texto(datos[c.folio]);
  return { facturaId, folio, marcada: !!facturaId || !!folio || datos[c.bandera] === true };
};

/**
 * Operaciones que YA están en una factura según el servidor. `facturaDestinoId` = la factura a la
 * que se van a agregar (si ya existe con ese número): estar en ella no cuenta.
 */
export async function operacionesYaFacturadas(
  lado: LadoFactura, ops: readonly OpAFacturar[], facturaDestinoId?: string,
): Promise<OpYaFacturada[]> {
  if (ops.length === 0) return [];
  const c = CAMPOS[lado];
  const destino = facturaDestinoId ? String(facturaDestinoId) : '';
  const encontradas = new Map<string, OpYaFacturada>();
  const porIdReal = new Map(ops.map((o) => [o.idReal, o]));
  const porCualquierId = new Map<string, OpAFacturar>();
  ops.forEach((o) => { porCualquierId.set(o.idLista, o); porCualquierId.set(o.idReal, o); });

  // 1) Los campos de cada operación, leídos del servidor.
  const idsReales = [...new Set(ops.map((o) => o.idReal).filter(Boolean))];
  for (const lote of lotes(idsReales)) {
    const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', lote)));
    snap.docs.forEach((d) => {
      const op = porIdReal.get(d.id);
      if (!op) return;
      const f = facturaDeOperacion(lado, d.data());
      if (!f.marcada) return;
      if (destino && f.facturaId === destino) return;
      encontradas.set(op.idLista, { idLista: op.idLista, ref: op.ref, folio: f.folio, facturaId: f.facturaId });
    });
  }

  // 2) Facturas que ya las tienen en `operacionesIds` (aunque la operación haya perdido sus campos).
  const idsBuscar = [...new Set(ops.flatMap((o) => [o.idLista, o.idReal]).filter(Boolean))];
  for (const lote of lotes(idsBuscar)) {
    const snap = await getDocs(query(collection(db, c.coleccion), where('operacionesIds', 'array-contains-any', lote)));
    snap.docs.forEach((d) => {
      if (destino && d.id === destino) return;
      const datos = d.data();
      const ids = Array.isArray(datos.operacionesIds) ? datos.operacionesIds.map(String) : [];
      ids.forEach((id: string) => {
        const op = porCualquierId.get(id);
        if (!op || encontradas.has(op.idLista)) return;
        encontradas.set(op.idLista, { idLista: op.idLista, ref: op.ref, folio: texto(datos.invoice), facturaId: d.id });
      });
    });
  }
  return [...encontradas.values()];
}

/**
 * Formas en que pudo guardarse un folio (Firestore compara exacto): como se capturó, sin espacios
 * alrededor, con un espacio al final, MAYÚSCULAS, minúsculas, Primera mayúscula, Cada Palabra y, si es un número
 * sin ceros a la izquierda, como número. Una mezcla rara de mayúsculas no se encuentra aquí (la
 * lista cargada sí la compara sin importar mayúsculas).
 */
export const variantesFolio = (folio: string): (string | number)[] => {
  const t = folio.trim();
  if (!t) return [];
  const cap = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  // "Inv-Srv-2": cada palabra con mayúscula inicial.
  const palabras = t.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_m, sep: string, letra: string) => sep + letra.toUpperCase());
  const textos = [folio, t, `${t} `, t.toUpperCase(), t.toLowerCase(), cap, palabras, `${t.toUpperCase()} `];
  const numero = /^[1-9]\d{0,14}$/.test(t) ? [Number(t)] : [];
  return [...new Set<string | number>([...textos, ...numero])];
};

/**
 * Factura existente con ese número para esa empresa, leída del servidor (sin importar
 * mayúsculas/espacios en el número). Si hay varias (folio repetido), la más antigua.
 */
export async function facturaExistenteFresca(
  lado: LadoFactura, folio: string, empresaId: string,
): Promise<(Record<string, unknown> & { id: string }) | null> {
  const f = folio.trim();
  if (!f || !empresaId) return null;
  const c = CAMPOS[lado];
  const snap = await getDocs(query(collection(db, c.coleccion), where('invoice', 'in', variantesFolio(folio))));
  const clave = f.toLowerCase();
  const candidatas = snap.docs
    .map((d) => ({ ...d.data(), id: d.id } as Record<string, unknown> & { id: string }))
    .filter((x) => texto(x.invoice).toLowerCase() === clave && texto(x[c.empresa]) === String(empresaId))
    .sort((a, b) => texto(a.createdAt).localeCompare(texto(b.createdAt)));
  return candidatas[0] ?? null;
}

/** Texto del aviso cuando hay operaciones ya facturadas. */
export const avisoYaFacturadas = (ops: readonly OpYaFacturada[]): string =>
  `Estas operaciones YA están facturadas (otra persona u otra pestaña las facturó después de que se cargó tu lista):\n\n${
    ops.map((o) => `· ${o.ref || o.idLista} → factura ${o.folio || o.facturaId}`).join('\n')}\n\nNo se creó ninguna factura. La lista se va a refrescar.`;

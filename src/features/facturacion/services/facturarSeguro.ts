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

// ─────────────────────────────────────────────────────────────────────────────
// ✅ V00494 — ELIMINAR UNA FACTURA SIN "DESFACTURAR" OPERACIONES QUE SIGUEN EN OTRA.
//   Antes, borrar una factura (p. ej. el duplicado de otra) liberaba TODAS sus operaciones:
//   quedaban sin marca aunque siguieran en la factura buena y volvían a "Pendientes". Ahora,
//   igual que el servidor (planEliminarFacturas), solo se libera la que apunta a la factura
//   borrada (o a ninguna) y no está en otra factura; si está en otra, se liga a esa.
// ─────────────────────────────────────────────────────────────────────────────

/** Una factura con sus operaciones (ya como arreglo: la lista cargada viene normalizada). */
export interface FacturaLigada {
  id: string;
  invoice: string;
  operacionesIds: readonly string[];
  statusFactura?: unknown;
}

export interface OpDeFacturaBorrada {
  idLista: string;
  idReal: string;
  /** Datos frescos de la operación (null = ya no existe: no se escribe). */
  datos: Record<string, unknown> | null;
}

export type DecisionLiberar =
  | { idLista: string; idReal: string; accion: 'liberar' }
  | { idLista: string; idReal: string; accion: 'ligar'; facturaId: string; folio: string }
  | { idLista: string; idReal: string; accion: 'dejar' };

const cancelada = (s: unknown): boolean => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().startsWith('cancelad');

/** Puro: qué se hace con cada operación de las facturas que se borran. */
export const decidirLiberacion = (
  lado: LadoFactura, ops: readonly OpDeFacturaBorrada[], borradas: ReadonlySet<string>, otras: readonly FacturaLigada[],
): DecisionLiberar[] => {
  const salida: DecisionLiberar[] = [];
  for (const o of ops) {
    if (!o.datos) continue;
    const apunta = facturaDeOperacion(lado, o.datos).facturaId;
    const contenedoras = otras.filter((f) => !borradas.has(f.id) && (f.operacionesIds.includes(o.idLista) || f.operacionesIds.includes(o.idReal)));
    const elegida = contenedoras.find((f) => f.id === apunta) ?? contenedoras.find((f) => !cancelada(f.statusFactura)) ?? contenedoras[0];
    if (elegida) {
      salida.push(elegida.id === apunta ? { idLista: o.idLista, idReal: o.idReal, accion: 'dejar' } : { idLista: o.idLista, idReal: o.idReal, accion: 'ligar', facturaId: elegida.id, folio: elegida.invoice });
    } else if (apunta && !borradas.has(apunta)) {
      salida.push({ idLista: o.idLista, idReal: o.idReal, accion: 'dejar' }); // apunta a otra factura viva: no se toca (como el servidor)
    } else {
      salida.push({ idLista: o.idLista, idReal: o.idReal, accion: 'liberar' });
    }
  }
  return salida;
};

/**
 * Lee del servidor las operaciones de las facturas que se van a borrar y las OTRAS facturas que las
 * tienen (`array-contains-any`, más la lista cargada, que también trae las importadas con
 * `operacionesIds` en texto) y decide qué hacer con cada una.
 */
export async function planLiberarAlEliminar(
  lado: LadoFactura, ops: readonly { idLista: string; idReal: string }[], borradas: ReadonlySet<string>, cargadas: readonly FacturaLigada[],
): Promise<DecisionLiberar[]> {
  if (ops.length === 0) return [];
  const c = CAMPOS[lado];
  const datosPorReal = new Map<string, Record<string, unknown>>();
  for (const lote of lotes([...new Set(ops.map((o) => o.idReal).filter(Boolean))])) {
    const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', lote)));
    snap.docs.forEach((d) => datosPorReal.set(d.id, d.data()));
  }
  const otras = new Map<string, FacturaLigada>();
  cargadas.forEach((f) => { if (!borradas.has(f.id)) otras.set(f.id, f); });
  for (const lote of lotes([...new Set(ops.flatMap((o) => [o.idLista, o.idReal]).filter(Boolean))])) {
    const snap = await getDocs(query(collection(db, c.coleccion), where('operacionesIds', 'array-contains-any', lote)));
    snap.docs.forEach((d) => {
      if (borradas.has(d.id)) return;
      const x = d.data();
      otras.set(d.id, { id: d.id, invoice: texto(x.invoice), statusFactura: x.statusFactura, operacionesIds: Array.isArray(x.operacionesIds) ? x.operacionesIds.map(String) : [] });
    });
  }
  return decidirLiberacion(lado, ops.map((o) => ({ ...o, datos: datosPorReal.get(o.idReal) ?? null })), borradas, [...otras.values()]);
}

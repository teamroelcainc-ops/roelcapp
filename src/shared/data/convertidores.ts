// src/shared/data/convertidores.ts
// ---------------------------------------------------------------------------
// ✅ V00439 (Fase 3.2) — CONVERTIDORES de Firestore y colecciones tipadas.
//
// Cada colección se tipa UNA vez aquí (withConverter) y el resto del código
// recibe el tipo sin casts:  getDocs(query(col('pagos'), where(...)))
//
// Al LEER se normaliza lo que la base guarda mezclado, SIN borrar el dato
// original (el código viejo lo sigue leyendo igual):
//   · números guardados como texto ('1,234.50') → number
//   · fechaServicio en ISO / Timestamp / d/m/aaaa → se agrega fechaServicioISO
//     si el documento aún no lo tiene (lo canónico lo escribe el servidor, Fase 4)
// Al ESCRIBIR se quitan los `undefined` (Firestore los rechaza) y el `id`.
// Úsalo en código NUEVO; el existente se migra cuando se toca.
// ---------------------------------------------------------------------------
import { collection } from 'firebase/firestore';
import type {
  CollectionReference, DocumentData, FirestoreDataConverter, QueryDocumentSnapshot, SnapshotOptions, WithFieldValue,
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { aFechaISO } from '../dominio/fechas';
import { aNumero } from '../dominio/numeros';
import type { ColeccionTipada, Esquema, FechaISO, OperacionDoc } from '../../types/firestore';

type Crudo = Record<string, unknown>;

/** Campos numéricos que la app a veces guardó como texto. */
const CAMPOS_NUMERICOS = [
  'montoConvenioCliente', 'cargosAdicionales', 'totalAPagarProv', 'cargosAdicionalesProv', 'sueldoOperador',
  'tipoCambioAprobado', 'tipoCambioDia', 'montoPagado', 'saldoPendiente', 'subtotalFactura', 'subtotalMonedaFactura',
  'monto', 'montoAplicado', 'saldoAFavor', 'tarifa', 'creditoDias', 'total', 'valor', 'usoOps',
] as const;

const normalizarNumeros = (x: Crudo): Crudo => {
  const salida: Crudo = { ...x };
  for (const campo of CAMPOS_NUMERICOS) {
    const v = salida[campo];
    if (typeof v === 'string' && v.trim() !== '') salida[campo] = aNumero(v);
  }
  return salida;
};

/** Normalizadores por colección (crudo → documento con id). */
const NORMALIZADORES: { [K in ColeccionTipada]?: (crudo: Crudo, id: string) => Esquema[K] } = {
  operaciones: (crudo, id) => {
    const x = normalizarNumeros(crudo);
    const iso = (x.fechaServicioISO as string | undefined) ?? aFechaISO(x.fechaServicio);
    return { ...(x as Omit<OperacionDoc, 'id'>), id, ...(iso ? { fechaServicioISO: iso as FechaISO } : {}) } as OperacionDoc;
  },
};

/** Normalización por defecto: números de texto → number. */
const normalizarGenerico = <T>(crudo: Crudo, id: string): T => ({ ...normalizarNumeros(crudo), id }) as T;

/** Quita `undefined` y el `id` (va en la ruta, no en el documento). */
const limpiarParaEscribir = (datos: Crudo): DocumentData => {
  const salida: DocumentData = {};
  for (const [k, v] of Object.entries(datos)) {
    if (k === 'id' || v === undefined) continue;
    salida[k] = v;
  }
  return salida;
};

const convertidores = new Map<string, FirestoreDataConverter<unknown>>();

/** Convertidor de una colección tipada (se crea una vez). */
export function convertidor<K extends ColeccionTipada>(nombre: K): FirestoreDataConverter<Esquema[K]> {
  let c = convertidores.get(nombre);
  if (!c) {
    const normalizar = NORMALIZADORES[nombre] ?? normalizarGenerico<Esquema[K]>;
    const nuevo: FirestoreDataConverter<Esquema[K]> = {
      toFirestore: (dato: WithFieldValue<Esquema[K]>) => limpiarParaEscribir(dato as unknown as Crudo),
      fromFirestore: (snap: QueryDocumentSnapshot, opciones?: SnapshotOptions) =>
        normalizar(snap.data(opciones) as Crudo, snap.id) as Esquema[K],
    };
    c = nuevo as FirestoreDataConverter<unknown>;
    convertidores.set(nombre, c);
  }
  return c as FirestoreDataConverter<Esquema[K]>;
}

/** Colección tipada: `col('pagos')` → CollectionReference<PagoDoc>. */
export function col<K extends ColeccionTipada>(nombre: K): CollectionReference<Esquema[K]> {
  return collection(db, nombre).withConverter(convertidor(nombre));
}

/** Para pruebas: normaliza un documento crudo como lo haría el convertidor. */
export const normalizarDocumento = <K extends ColeccionTipada>(nombre: K, crudo: Crudo, id: string): Esquema[K] =>
  (NORMALIZADORES[nombre] ?? normalizarGenerico<Esquema[K]>)(crudo, id) as Esquema[K];

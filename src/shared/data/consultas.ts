// src/shared/data/consultas.ts
// ---------------------------------------------------------------------------
// ✅ V00443 (Fase 7) — CONSULTAS ACOTADAS sobre los campos canónicos (Fase 4).
// Con la bandera `consultasCanonicas` (encendida DESPUÉS de la migración P2), las
// pantallas piden al servidor solo lo que muestran: por estado (`estadoGrupo`), por
// rango de `fechaServicioISO`, por empresa (`empresasIds`) o por pendientes de
// facturar (`porFacturar*`), en páginas con cursor — en vez de descargar la colección.
// Sin índice NO hay respaldo de "leer todo": el error se muestra (regla 7 del plan) y
// el índice va en firestore.indexes.json.
// ---------------------------------------------------------------------------
import {
  collection, documentId, getCountFromServer, getDocs, limit as limitar, orderBy, query, startAfter, where,
} from 'firebase/firestore';
import type { DocumentData, QueryConstraint, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { armarDoc } from './coleccionesVivas';
import { queryClient } from '../../lib/queryClient';
import type { EstadoGrupo } from '../dominio/constantes';

export type Datos = Record<string, unknown>;
export type Cursor = QueryDocumentSnapshot<DocumentData> | null;

export interface Pagina {
  /** Documentos como los usan las pantallas: { id, ...datos }. */
  docs: (Datos & { id: string })[];
  /** Para pedir la siguiente página (null = no hay más). */
  cursor: Cursor;
  hayMas: boolean;
}

/** { id, ...datos } como siempre (un campo `id` guardado gana) + `_docId` NO enumerable con el id real. */
const aDoc = (d: QueryDocumentSnapshot<DocumentData>): Datos & { id: string } => armarDoc(d.id, d.data() as Datos);

/** Una página de una consulta: pide `tamano + 1` para saber si hay más sin otra lectura. */
const pagina = async (coleccion: string, filtros: QueryConstraint[], tamano: number, cursor: Cursor): Promise<Pagina> => {
  const snap = await getDocs(query(collection(db, coleccion), ...filtros, ...(cursor ? [startAfter(cursor)] : []), limitar(tamano + 1)));
  const hayMas = snap.docs.length > tamano;
  const docs = snap.docs.slice(0, tamano);
  return { docs: docs.map(aDoc), cursor: hayMas ? docs[docs.length - 1] : null, hayMas };
};

/**
 * Todas las páginas hasta `maximo` documentos (el que llama decide el tope y avisa si se alcanzó).
 * ✅ V00499: `alAvanzar` recibe cuántos documentos van leídos después de cada página.
 */
export const todasLasPaginas = async (
  siguiente: (c: Cursor) => Promise<Pagina>, maximo: number, alAvanzar?: (leidos: number) => void,
): Promise<{ docs: (Datos & { id: string })[]; truncado: boolean }> => {
  const docs: (Datos & { id: string })[] = [];
  let cursor: Cursor = null;
  for (;;) {
    const p = await siguiente(cursor);
    docs.push(...p.docs);
    alAvanzar?.(docs.length);
    if (!p.hayMas) return { docs, truncado: false };
    if (docs.length >= maximo) return { docs, truncado: true };
    cursor = p.cursor;
  }
};

export interface FiltroOperaciones {
  estados: readonly EstadoGrupo[];
  /** AAAA-MM-DD inclusive. */
  desde?: string;
  hasta?: string;
}

const filtrosOperaciones = (f: FiltroOperaciones): QueryConstraint[] => [
  f.estados.length === 1 ? where('estadoGrupo', '==', f.estados[0]) : where('estadoGrupo', 'in', [...f.estados]),
  ...(f.desde ? [where('fechaServicioISO', '>=', f.desde)] : []),
  ...(f.hasta ? [where('fechaServicioISO', '<=', f.hasta)] : []),
  orderBy('fechaServicioISO', 'desc'),
];

/** 7.1 / 7.2 — operaciones por estado (y rango), de la más reciente a la más vieja. */
export const paginaOperaciones = (f: FiltroOperaciones, tamano: number, cursor: Cursor = null): Promise<Pagina> =>
  pagina('operaciones', filtrosOperaciones(f), tamano, cursor);

/** 7.5 — operaciones de UN día de servicio (Resumen del día). */
export const operacionesDelDia = async (dia: string): Promise<(Datos & { id: string })[]> =>
  (await getDocs(query(collection(db, 'operaciones'), where('fechaServicioISO', '==', dia)))).docs.map(aDoc);

/** 7.5 — operaciones de un rango de fechas de servicio (Reportes, Estadísticas). */
export const operacionesDelRango = async (desde: string, hasta: string, maximo = 20000): Promise<{ docs: (Datos & { id: string })[]; truncado: boolean }> =>
  todasLasPaginas((c) => pagina('operaciones', [
    where('fechaServicioISO', '>=', desde), where('fechaServicioISO', '<=', hasta), orderBy('fechaServicioISO', 'desc'),
  ], 1000, c), maximo);

/** ✅ V00499 — Firestore no acepta un `limit` mayor a 10,000 en una consulta: lo grande va en páginas. */
export const LIMITE_FIRESTORE = 10000;
const PAGINA_RANGO_COMPLETO = 2000;

/**
 * ✅ V00499 — TODAS las operaciones con `campo` dentro del rango (AAAA-MM-DD inclusive), de cualquier
 * status, en páginas de 2,000 y SIN tope (Excel de operaciones: se pide el rango completo).
 * `campo`: `fechaServicioISO` (canónica) o `fechaServicio` (las que aún no la tienen); el que llama une ambas.
 */
export const todasLasOperacionesDelRango = async (
  campo: 'fechaServicio' | 'fechaServicioISO', desde: string, hasta: string, alAvanzar?: (leidos: number) => void,
): Promise<(Datos & { id: string })[]> =>
  (await todasLasPaginas((c) => pagina('operaciones', [
    where(campo, '>=', desde), where(campo, '<=', hasta), orderBy(campo),
  ], PAGINA_RANGO_COMPLETO, c), Number.POSITIVE_INFINITY, alAvanzar)).docs;

/** ✅ V00500 — cortes del id del documento: 4 tramos que cubren cualquier texto, sin huecos ni cruces. */
const CORTES_ID = ['5', 'M', 'f'] as const;

/**
 * ✅ V00500 — RECORRE TODAS las operaciones (por id del documento, 4 tramos en paralelo, páginas de
 * 2,000) y entrega cada página a `alRecibir` para que el que llama se quede solo con lo que necesita
 * (no se acumula la colección en memoria). Solo para acciones que el usuario lanza a mano y que NO
 * pueden depender del formato de la fecha (Excel de operaciones mientras falte `fechaServicioISO`
 * en las operaciones viejas: d/m/aaaa o Timestamp no se pueden pedir por rango). Devuelve cuántas leyó.
 */
export const recorrerOperaciones = async (
  alRecibir: (docs: (Datos & { id: string })[]) => void, alAvanzar?: (leidas: number) => void,
): Promise<number> => {
  let leidas = 0;
  const bordes: (string | null)[] = [null, ...CORTES_ID, null];
  await Promise.all(bordes.slice(0, -1).map(async (desde, i) => {
    const hasta = bordes[i + 1];
    const filtros: QueryConstraint[] = [
      ...(desde ? [where(documentId(), '>=', desde)] : []),
      ...(hasta ? [where(documentId(), '<', hasta)] : []),
      orderBy(documentId()),
    ];
    let cursor: Cursor = null;
    for (;;) {
      const p = await pagina('operaciones', filtros, PAGINA_RANGO_COMPLETO, cursor);
      leidas += p.docs.length;
      alRecibir(p.docs);
      alAvanzar?.(leidas);
      if (!p.hayMas) return;
      cursor = p.cursor;
    }
  }));
  return leidas;
};

/** 7.3 — operaciones pendientes de facturar de un lado (opcionalmente de una empresa). */
export const paginaPorFacturar = (lado: 'cliente' | 'proveedor', empresaId: string | null, tamano: number, cursor: Cursor = null): Promise<Pagina> =>
  pagina('operaciones', [
    where(lado === 'cliente' ? 'porFacturarCliente' : 'porFacturarProveedor', '==', true),
    ...(empresaId ? [where(lado === 'cliente' ? 'clientePagaId' : 'proveedorUnidadId', '==', empresaId)] : []),
    orderBy('fechaServicioISO', 'desc'),
  ], tamano, cursor);

/** 7.6 — operaciones de una empresa (en cualquier papel), de la más reciente. */
export const paginaOperacionesDeEmpresa = (empresaId: string, tamano: number, cursor: Cursor = null): Promise<Pagina> =>
  pagina('operaciones', [where('empresasIds', 'array-contains', empresaId), orderBy('fechaServicioISO', 'desc')], tamano, cursor);

/**
 * ✅ V00487 — TODAS las operaciones, en páginas por id (sin índice). Solo para herramientas de
 * corrección que el usuario lanza a mano y que antes dicen cuántas lecturas cuestan
 * (Corregir monedas de convenio); ninguna pantalla debe listar con esto.
 */
export const paginaOperacionesPorId = (tamano: number, cursor: Cursor = null): Promise<Pagina> =>
  pagina('operaciones', [orderBy(documentId())], tamano, cursor);

/** ✅ V00487 — cuántas operaciones hay (agregación del servidor: 1 lectura por cada 1,000). */
export const contarOperaciones = async (): Promise<number> =>
  (await getCountFromServer(collection(db, 'operaciones'))).data().count;

/** 7.7 — operaciones de un convenio (detalle) de cliente o proveedor. */
export const paginaOperacionesDeConvenio = (lado: 'cliente' | 'proveedor', convenioId: string, tamano: number, cursor: Cursor = null): Promise<Pagina> =>
  pagina('operaciones', [
    where(lado === 'cliente' ? 'convenioClienteId' : 'convenioProveedorId', '==', convenioId), orderBy('fechaServicioISO', 'desc'),
  ], tamano, cursor);

/**
 * 7.4 — facturas ABIERTAS (con saldo y cobrables) de un lado. `abierta` la escribe el servidor
 * (derivadosFactura) con `dineroPorServidor`, y la reconciliación P3 la deja en todas: úsese
 * solo con esa bandera encendida.
 */
export const paginaFacturasAbiertas = (coleccion: 'facturas_clientes' | 'facturas_proveedores', tamano: number, cursor: Cursor = null): Promise<Pagina> =>
  pagina(coleccion, [where('abierta', '==', true), orderBy(documentId())], tamano, cursor);

/** 7.6 / 7.7 — contadores de uso (usos/{tipo}_{id}, Fase 6.5) de un tipo: id → {usoOps, ultimoUsoISO}. */
export const usosPorTipo = async (tipo: 'empresa' | 'convenioCliente' | 'convenioProveedor'): Promise<Map<string, { usoOps: number; ultimoUsoISO: string }>> => {
  const snap = await getDocs(query(collection(db, 'usos'), where('tipo', '==', tipo)));
  return new Map(snap.docs.map((d) => {
    const x = d.data() as Datos;
    return [String(x.refId ?? ''), { usoOps: Number(x.usoOps) || 0, ultimoUsoISO: String(x.ultimoUsoISO ?? '') }];
  }));
};

/** Lo mismo con la caché de TanStack Query (5 min, peticiones simultáneas compartidas). */
export const usosEnCache = (tipo: 'empresa' | 'convenioCliente' | 'convenioProveedor'): Promise<Map<string, { usoOps: number; ultimoUsoISO: string }>> =>
  queryClient.fetchQuery({ queryKey: ['usos', tipo], queryFn: () => usosPorTipo(tipo) });

/** 7.8 — documentos por ID en lotes de 30 EN PARALELO (en lugar de uno por uno o de a 10). */
export const porIds = async (coleccion: string, ids: readonly string[]): Promise<(Datos & { id: string })[]> => {
  const unicos = Array.from(new Set(ids.map(String).filter((x) => x && !x.includes('/'))));
  const lotes: string[][] = [];
  for (let i = 0; i < unicos.length; i += 30) lotes.push(unicos.slice(i, i + 30));
  const snaps = await Promise.all(lotes.map((l) => getDocs(query(collection(db, coleccion), where(documentId(), 'in', l)))));
  return snaps.flatMap((s) => s.docs.map(aDoc));
};

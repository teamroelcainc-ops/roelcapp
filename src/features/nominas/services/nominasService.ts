// src/features/nominas/services/nominasService.ts
// ---------------------------------------------------------------------------
// ✅ Fase 1.8b — Acceso a datos de Referencias de Nómina. Cierra el "doble
//   pago" de una operación:
//   · El historial se lee ORDENADO y acotado (antes: limit(400) sin orderBy =
//     400 nóminas arbitrarias que alimentaban folio, préstamos y "asignada").
//   · Guardar una nómina corre en runTransaction: relee cada operación y
//     aborta si ya está en otra nómina; el folio sale de un contador que se
//     lee e incrementa dentro de la misma transacción; los saldos de
//     préstamo/ahorro solo se escriben si nadie los cambió mientras tanto.
// ---------------------------------------------------------------------------
import {
  collection, doc, endBefore, getDocs, limit, orderBy, query, runTransaction, startAfter, where,
} from 'firebase/firestore';
import type { DocumentData, Query, QueryDocumentSnapshot, QuerySnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { COL } from '../../../shared/dominio/constantes';
import {
  ErrorNomina, MAX_OPS_POR_GUARDADO, formatearFolioNomina, huellaSaldos, idContadorFolioNomina,
  mensajeConflictosNomina, numeroDeFolio, prefijoFolioNomina, unirNominasPorId, vinculoNominaDeOp,
} from './reglasNomina';
import type { ConflictoNomina, DocNomina } from './reglasNomina';

/**
 * Campo con el que se ordena y pagina el historial: `fechaPago` (desc).
 *   · Es la fecha que la nómina usa de verdad: el historial se ordena y se
 *     filtra por ella y los movimientos de préstamo/ahorro se acumulan en ese
 *     orden.
 *   · `orderBy` EXCLUYE los documentos que no tienen el campo. El ÚNICO punto
 *     que escribe en `referencias_nomina` es guardarNomina() (abajo) y SIEMPRE
 *     escribe `fechaPago` como texto AAAA-MM-DD (input date / hoyLocalISO; al
 *     editar se normaliza con fechaISO), cuyo orden alfabético es el
 *     cronológico. `createdAt` no sirve igual de bien: el formulario lo pone
 *     en "ahora" al editar una nómina heredada que no lo tenía, y la saltaría
 *     al inicio de la lista.
 *   · Una nómina migrada SIN `fechaPago` (o con Timestamp / d/m/aaaa, que
 *     Firestore agrupa por tipo después de los textos) no aparece bien en esta
 *     consulta: el historial la completa con consultaNominasLegado(). La
 *     asignación se valida con el campo de la operación y con operacionesIds
 *     en el servidor, y el historial de préstamos se lee por operador sin
 *     orderBy, así que ninguna de las dos depende de esta lista.
 */
export const CAMPO_ORDEN_NOMINAS = 'fechaPago';

const colNominas = () => collection(db, COL.referenciasNomina);

/** Mismo mapeo que usó siempre el módulo: id del documento y luego sus campos. */
export const aDocNomina = (d: QueryDocumentSnapshot): DocNomina => ({ id: d.id, ...d.data() });

/** Id para una nómina nueva (se reserva antes de la transacción). */
export const nuevoIdNomina = (): string => doc(colNominas()).id;

// ── Historial paginado ─────────────────────────────────────────────────────

/** Ventana en vivo: las `tam` nóminas con fecha de pago más reciente. */
export const consultaNominasRecientes = (tam: number): Query =>
  query(colNominas(), orderBy(CAMPO_ORDEN_NOMINAS, 'desc'), limit(tam));

// PENDIENTE Fase 4: quitar cuando migrarEsquemaV2 rellene fechaPago
/**
 * Listener HEREDADO, igual a la consulta original del módulo (limit sin
 * orderBy): de aquí solo se usan las nóminas cuyo `fechaPago` falta o no es
 * AAAA-MM-DD, que la consulta ordenada no muestra.
 */
export const consultaNominasLegado = (tam: number): Query => query(colNominas(), limit(tam));

/** "Cargar más": la página siguiente después del cursor (lectura única). */
export const leerPaginaNominas = (cursor: QueryDocumentSnapshot, tam: number): Promise<QuerySnapshot> =>
  getDocs(query(colNominas(), orderBy(CAMPO_ORDEN_NOMINAS, 'desc'), startAfter(cursor), limit(tam)));

/**
 * Nóminas que quedaron ENTRE la ventana en vivo y la primera página cargada
 * con "Cargar más" (salen de la ventana cuando llegan nóminas nuevas arriba).
 */
export const leerHuecoNominas = (ultimaVentana: QueryDocumentSnapshot, primeraPagina: QueryDocumentSnapshot): Promise<QuerySnapshot> =>
  getDocs(query(colNominas(), orderBy(CAMPO_ORDEN_NOMINAS, 'desc'), startAfter(ultimaVentana), endBefore(primeraPagina)));

// ── Historial COMPLETO de un operador (préstamos, ahorro, recibos) ─────────
// Mismo criterio que siempre usó el módulo: operadorId == id  Ó  operadorNombre
// == nombre. Sin orderBy para no excluir nóminas migradas; sin limit porque el
// saldo es la suma de TODOS sus movimientos.

export const consultaNominasPorOperadorId = (operadorId: string): Query =>
  query(colNominas(), where('operadorId', '==', operadorId));

export const consultaNominasPorOperadorNombre = (operadorNombre: string): Query =>
  query(colNominas(), where('operadorNombre', '==', operadorNombre));

const textoNoVacio = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v : '');

/** Lectura única del historial completo del operador de una nómina. */
export async function obtenerHistorialOperador(operadorId: unknown, operadorNombre: unknown): Promise<DocNomina[]> {
  const id = textoNoVacio(operadorId);
  const nombre = textoNoVacio(operadorNombre);
  const [porId, porNombre] = await Promise.all([
    id ? getDocs(consultaNominasPorOperadorId(id)) : Promise.resolve(null),
    nombre ? getDocs(consultaNominasPorOperadorNombre(nombre)) : Promise.resolve(null),
  ]);
  return unirNominasPorId(porId?.docs.map(aDocNomina), porNombre?.docs.map(aDocNomina));
}

// ── Guardado transaccional ─────────────────────────────────────────────────

/**
 * Semilla del contador: el folio más alto ya guardado con ese prefijo (una
 * sola lectura). Se consulta SIEMPRE, fuera de la transacción, y adentro se
 * usa max(contador, semilla): cubre el primer uso del contador y las nóminas
 * que aún cree una versión vieja de la app (que no toca el contador).
 */
async function maxFolioDelDia(prefijo: string): Promise<number> {
  const snap = await getDocs(query(
    colNominas(),
    where('consecutivo', '>=', prefijo),
    where('consecutivo', '<=', `${prefijo}`),
    orderBy('consecutivo', 'desc'),
    limit(1),
  ));
  return snap.docs.reduce((max, d) => Math.max(max, numeroDeFolio(d.get('consecutivo'), prefijo)), 0);
}

/**
 * Señal HEREDADA: nóminas migradas que ligan la operación solo por
 * `operacionesIds` (la operación no trae referenciaNominaId). Se consulta en
 * el servidor (array-contains-any, tandas de 30) para no depender de la lista
 * cargada en pantalla. Devuelve opId → folio de la otra nómina.
 */
async function nominasQueContienen(opIds: readonly string[], excluirNominaId: string): Promise<Map<string, string>> {
  const ids = [...new Set(opIds)];
  const tandas: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) tandas.push(ids.slice(i, i + 30));
  const snaps = await Promise.all(tandas.map(t =>
    getDocs(query(colNominas(), where('operacionesIds', 'array-contains-any', t)))));
  const buscados = new Set(ids);
  const res = new Map<string, string>();
  snaps.forEach(snap => snap.docs.forEach(d => {
    if (d.id === excluirNominaId) return;
    const lista: unknown = d.get('operacionesIds');
    if (!Array.isArray(lista)) return;
    const folio = textoNoVacio(d.get('consecutivo')) || `id ${d.id}`;
    lista.forEach((x: unknown) => {
      const id = String(x);
      if (buscados.has(id) && !res.has(id)) res.set(id, folio);
    });
  }));
  return res;
}

export interface OpParaNomina {
  id: string;
  /** Referencia visible de la operación (para los mensajes). */
  ref: string;
}

export interface DeduccionParaNomina {
  id: string;
  /** huellaSaldos() del registro tal como lo vio el usuario; null = no se pudo comparar. */
  huellaEsperada: string | null;
  /** Campos que se escriben en `deducciones/{id}`. */
  cambios: DocumentData;
}

export interface GuardarNominaParams {
  esEdicion: boolean;
  /** Id del documento: el existente (edición) o el de nuevoIdNomina() (creación). */
  nominaId: string;
  /** AAAA-MM-DD; en creación define el prefijo del folio. */
  fechaPago: string;
  /** En edición se conserva el folio que ya tenía la nómina. */
  folioEdicion: string;
  /** Documento de la nómina SIN `consecutivo` (lo pone la transacción). */
  datos: DocumentData;
  /** Operaciones que quedan en la nómina. */
  ops: readonly OpParaNomina[];
  /** (Edición) operaciones que salen de la nómina. */
  opsRemovidas: readonly string[];
  deduccion: DeduccionParaNomina | null;
  /** opId → folio de otra nómina detectado en la lista cargada en pantalla (señal extra). */
  conflictosConocidos: ReadonlyMap<string, string>;
}

export interface ResultadoGuardarNomina {
  folio: string;
  vinculadas: string[];
  desvinculadas: string[];
}

/**
 * Genera o edita una nómina de forma ATÓMICA. Lanza ErrorNomina (mensaje para
 * el usuario) si alguna operación ya está en otra nómina, si ya no existe, si
 * la nómina fue eliminada o si los saldos del operador cambiaron.
 */
export async function guardarNomina(p: GuardarNominaParams): Promise<ResultadoGuardarNomina> {
  const totalOps = p.ops.length + p.opsRemovidas.length;
  if (totalOps > MAX_OPS_POR_GUARDADO) {
    throw new ErrorNomina(
      `Esta nómina mueve ${totalOps} operaciones y el máximo por guardado es ${MAX_OPS_POR_GUARDADO}. `
      + 'Divide las operaciones en dos nóminas (por ejemplo, por rango de fechas).',
    );
  }
  const prefijo = p.esEdicion ? '' : prefijoFolioNomina(p.fechaPago);
  if (!p.esEdicion && !prefijo) {
    throw new ErrorNomina('Captura una Fecha de Pago válida: con ella se genera el folio de la nómina.');
  }

  // ── Fuera de la transacción (consultas: runTransaction solo lee documentos) ──
  const refPorId = new Map(p.ops.map(o => [o.id, o.ref]));
  const [legado, semilla] = await Promise.all([
    nominasQueContienen(p.ops.map(o => o.id), p.nominaId),
    p.esEdicion ? Promise.resolve(0) : maxFolioDelDia(prefijo),
  ]);
  const previos = new Map<string, string>([...p.conflictosConocidos, ...legado]);
  const conflictosPrevios: ConflictoNomina[] = [...previos]
    .filter(([id]) => refPorId.has(id))
    .map(([id, folio]) => ({ ref: refPorId.get(id) || id, folio }));
  if (conflictosPrevios.length > 0) throw new ErrorNomina(mensajeConflictosNomina(conflictosPrevios));

  // ── Transacción: TODAS las lecturas antes de cualquier escritura y ningún
  //    efecto fuera de `tx` (Firestore puede reintentarla). ──
  return runTransaction(db, async (tx) => {
    const refNomina = doc(db, COL.referenciasNomina, p.nominaId);
    const refContador = p.esEdicion ? null : doc(db, COL.contadores, idContadorFolioNomina(prefijo));
    const refDeduccion = p.deduccion ? doc(db, 'deducciones', p.deduccion.id) : null;
    const refsOps = p.ops.map(o => doc(db, COL.operaciones, o.id));
    const refsRemovidas = p.opsRemovidas.map(id => doc(db, COL.operaciones, id));

    const [snapNomina, snapContador, snapDeduccion, snapsOps, snapsRemovidas] = await Promise.all([
      p.esEdicion ? tx.get(refNomina) : Promise.resolve(null),
      refContador ? tx.get(refContador) : Promise.resolve(null),
      refDeduccion ? tx.get(refDeduccion) : Promise.resolve(null),
      Promise.all(refsOps.map(r => tx.get(r))),
      Promise.all(refsRemovidas.map(r => tx.get(r))),
    ]);

    if (p.esEdicion && !snapNomina?.exists()) {
      throw new ErrorNomina('Esta nómina ya no existe (otro usuario la eliminó). No se guardó nada.');
    }

    // Folio: el contador del día se lee e incrementa aquí mismo → dos nóminas
    // simultáneas chocan y la segunda se reintenta con el número siguiente.
    let folio = p.folioEdicion;
    let numero = 0;
    if (!p.esEdicion) {
      const guardado = Number(snapContador?.get('ultimo')) || 0;
      numero = Math.max(guardado, semilla) + 1;
      folio = formatearFolioNomina(prefijo, numero);
    }

    const conflictos: ConflictoNomina[] = [];
    const faltantes: string[] = [];
    const aVincular: typeof refsOps = [];
    snapsOps.forEach((s, i) => {
      const op = p.ops[i];
      if (!s.exists()) {
        // En edición, un id heredado que ya no existe se ignora (como antes).
        if (!p.esEdicion) faltantes.push(op.ref);
        return;
      }
      const v = vinculoNominaDeOp(s.data(), p.nominaId, folio);
      if (v.tipo === 'otra') conflictos.push({ ref: op.ref, folio: v.folio });
      else if (!(v.tipo === 'propia' && v.exacto)) aVincular.push(refsOps[i]);
    });
    if (conflictos.length > 0) throw new ErrorNomina(mensajeConflictosNomina(conflictos));
    if (faltantes.length > 0) {
      throw new ErrorNomina(
        `No se guardó la nómina: ${faltantes.length === 1 ? 'esta operación ya no existe' : 'estas operaciones ya no existen'}: `
        + `${faltantes.join(', ')}. Pulsa "↻ Actualizar" y vuelve a seleccionar.`,
      );
    }
    // Solo se liberan las que siguen apuntando a ESTA nómina (no se toca una
    // operación que ya pasó a otra).
    const aDesvincular = snapsRemovidas
      .filter(s => s.exists() && vinculoNominaDeOp(s.data(), p.nominaId, folio).tipo === 'propia')
      .map(s => s.ref);

    if (p.deduccion) {
      if (!snapDeduccion?.exists()) {
        throw new ErrorNomina('No se encontró el registro de Deducciones del operador; no se guardó nada. Revísalo en el módulo Deducciones.');
      }
      if (p.deduccion.huellaEsperada !== null && huellaSaldos(snapDeduccion.data()) !== p.deduccion.huellaEsperada) {
        throw new ErrorNomina(
          'Los saldos de préstamo/ahorro del operador cambiaron mientras capturabas (otro usuario guardó una nómina '
          + 'o editó sus Deducciones). Revisa los montos del formulario y vuelve a guardar.',
        );
      }
    }

    // ── Escrituras ──
    const docNomina = { ...p.datos, consecutivo: folio };
    if (p.esEdicion) tx.set(refNomina, docNomina, { merge: true }); // conserva campos heredados
    else tx.set(refNomina, docNomina);
    if (refContador) {
      tx.set(refContador, { ultimo: numero, prefijo, actualizadoEl: new Date().toISOString() }, { merge: true });
    }
    if (p.deduccion && refDeduccion) tx.update(refDeduccion, p.deduccion.cambios);
    aVincular.forEach(r => tx.update(r, { referenciaNominaId: p.nominaId, referenciaNominaConsecutivo: folio }));
    aDesvincular.forEach(r => tx.update(r, { referenciaNominaId: null, referenciaNominaConsecutivo: null }));

    return { folio, vinculadas: aVincular.map(r => r.id), desvinculadas: aDesvincular.map(r => r.id) };
  });
}

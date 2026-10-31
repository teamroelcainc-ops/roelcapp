// src/features/operaciones/services/correccionesD2F3Datos.ts
// ---------------------------------------------------------------------------
// ✅ V00539 — Escritura de "Solucionar" en D2 y F3 (lo puro en correccionesD2F3.ts).
// D2: una transacción por operación con el contador de su línea como ancla (como renumerarOperacion
//     del servidor): el consecutivo = máximo real de la línea + 1; si otro guarda en esa línea al mismo
//     tiempo, la transacción se repite y vuelve a contar. Antes se relee la operación: si su referencia
//     cambió o se facturó desde la prueba, no se toca.
// F3: tandas de 50; se relee cada operación (y la factura a la que se liga) antes de escribir.
// ---------------------------------------------------------------------------
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { notificarCambiosOperacion, notificarOperacionesGuardadas } from '../../../utils/operacionesBus';
import { camposLiberarF3, camposLigarF3, camposRenumerar, consecutivoDeRef, motivoAlCorregirF3, motivoAlRenumerar } from './correccionesD2F3';
import type { ResultadoCorreccion } from './correccion';
import type { PlanD2, PlanF3 } from './revisionDatos';

type Datos = Record<string, unknown>;
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const TANDA_F3 = 50;

/** No se escribe: el motivo sale en el resultado (lanzado dentro de la transacción para no escribir nada). */
class NoSeEscribe extends Error {}

/** Consecutivo más alto que existe en la línea (por refPrefijo y por la referencia misma). */
const maximoDeLinea = async (prefijo: string, ddmmyy: string): Promise<number> => {
  const linea = `${prefijo}-${ddmmyy}`;
  const [porPrefijo, porRef] = await Promise.all([
    getDocs(query(collection(db, 'operaciones'), where('refPrefijo', '==', linea))),
    getDocs(query(collection(db, 'operaciones'), where('ref', '>=', `${linea}-`), where('ref', '<=', `${linea}-`))),
  ]);
  let maximo = 0;
  [...porPrefijo.docs, ...porRef.docs].forEach((d) => {
    const x = d.data();
    maximo = Math.max(maximo, Number(x.refConsecutivo) || 0, consecutivoDeRef(x.ref));
  });
  return maximo;
};

export const aplicarRenumerarD2 = async (planes: readonly PlanD2[], cuando: string, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoCorreccion> => {
  const aRenumerar = planes.filter((p) => !p.motivo);
  const omitidas: ResultadoCorreccion['omitidas'] = [];
  const nuevas: string[] = [];
  let error = '';
  for (let i = 0; i < aRenumerar.length; i++) {
    const p = aRenumerar[i];
    const opRef = doc(db, 'operaciones', p.opId);
    const contadorRef = doc(db, 'counters', `operaciones_${p.prefijo}_${p.ddmmyy}`);
    try {
      const campos = await runTransaction(db, async (tx) => {
        const snap = await tx.get(opRef);
        const op = snap.exists() ? (snap.data() as Datos) : null;
        const motivo = motivoAlRenumerar(op, p);
        if (motivo || !op) throw new NoSeEscribe(motivo);
        const contador = await tx.get(contadorRef); // ancla: otra escritura en la línea repite esta transacción
        const asignado = Math.max(await maximoDeLinea(p.prefijo, p.ddmmyy), Number(contador.data()?.count) || 0) + 1;
        const datos = camposRenumerar(op, p, asignado, cuando);
        tx.update(opRef, datos);
        tx.set(contadorRef, { count: asignado, prefijo: p.prefijo, fecha: p.ddmmyy, syncAt: cuando }, { merge: true });
        return datos;
      });
      notificarCambiosOperacion(p.opId, campos, 'revision-d2');
      nuevas.push(`${p.ref} → ${txt(campos.ref)}`);
    } catch (e) {
      if (e instanceof NoSeEscribe) { omitidas.push({ id: p.opId, ref: p.ref, motivo: e.message }); continue; }
      console.error('[D2] No se pudo renumerar:', e);
      error = String((e as { message?: string })?.message || e).split('\n')[0];
      break;
    }
    alAvanzar(i + 1, aRenumerar.length);
  }
  if (nuevas.length > 0) {
    await registrarLog('Operaciones', 'Edición', `Revisión de datos (D2): renumeró ${nuevas.length} operación(es) con referencia repetida (la creada primero se quedó con la suya): ${nuevas.join(', ')}.${error ? ` Se detuvo por un error: ${error}` : ''}`).catch(() => {});
  }
  return { hechas: nuevas.length, omitidas, error };
};

export const aplicarCorregirF3 = async (planes: readonly PlanF3[], cuando: string, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoCorreccion> => {
  const aCorregir = planes.filter((p) => p.accion !== 'manual');
  const omitidas: ResultadoCorreccion['omitidas'] = [];
  let hechas = 0;
  let ligadas = 0;
  let error = '';
  for (let i = 0; i < aCorregir.length; i += TANDA_F3) {
    const tanda = aCorregir.slice(i, i + TANDA_F3);
    try {
      const escritos = await runTransaction(db, async (tx) => {
        const refsOps = tanda.map((p) => doc(db, 'operaciones', p.opId));
        const snapsOps = await Promise.all(refsOps.map((r) => tx.get(r)));
        const snapsFac = await Promise.all(tanda.map((p) => (p.accion === 'ligar' ? tx.get(doc(db, 'facturas_clientes', p.facturaId)) : Promise.resolve(null))));
        const lista: [string, Datos][] = [];
        tanda.forEach((p, k) => {
          const op = snapsOps[k].exists() ? (snapsOps[k].data() as Datos) : null;
          const fac = snapsFac[k]?.exists() ? (snapsFac[k]?.data() as Datos) : null;
          const motivo = motivoAlCorregirF3(op, fac, p);
          if (motivo) { omitidas.push({ id: p.opId, ref: p.ref, motivo }); return; }
          const datos = p.accion === 'ligar' ? camposLigarF3(p, cuando) : camposLiberarF3(cuando);
          tx.update(refsOps[k], datos);
          lista.push([p.opId, datos]);
        });
        return lista;
      });
      hechas += escritos.length;
      ligadas += escritos.filter(([, d]) => d.facturado === true).length;
      notificarOperacionesGuardadas(escritos, 'revision-f3');
    } catch (e) {
      console.error('[F3] No se pudo escribir una tanda:', e);
      error = String((e as { message?: string })?.message || e).split('\n')[0];
      break;
    }
    alAvanzar(Math.min(i + TANDA_F3, aCorregir.length), aCorregir.length);
  }
  if (hechas > 0) {
    await registrarLog('Operaciones', 'Edición', `Revisión de datos (F3): ${ligadas} operación(es) ligadas a la factura que las lista y ${hechas - ligadas} liberadas (vuelven a Por facturar) (invoiceCorregidoPorRevision = ${cuando}). ${omitidas.length} no se escribieron.${error ? ` Se detuvo por un error: ${error}` : ''}`).catch(() => {});
  }
  return { hechas, omitidas, error };
};

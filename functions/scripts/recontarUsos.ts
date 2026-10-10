/**
 * ✅ V00442 (Fase 6.5) — RECUENTO de los contadores de uso (usos/{tipo}_{id}).
 * ------------------------------------------------------------------------------
 * Cuenta desde cero cuántas operaciones (sin pruebas) usan cada empresa y cada
 * convenio, y su fecha de servicio más reciente. operacionEscrita los mantiene
 * después con increment(); este script es la carga inicial y la reparación (por
 * ejemplo, "último uso" después de borrar operaciones).
 *
 * ⛔ PUNTO DE PARADA P2 en producción: primero sin --aplicar. Escribe valores
 * ABSOLUTOS: córrelo sin capturas de operaciones en curso (una operación creada
 * mientras corre puede quedar contada de menos; volver a correrlo lo corrige).
 *
 * Uso (desde functions/):
 *   npm run usos                                    → simulación (usos.csv con antes/después)
 *   npm run usos -- --aplicar --confirmo-respaldo   → escribe
 * ------------------------------------------------------------------------------
 */
import type { Firestore } from 'firebase-admin/firestore';
import { COL_USOS, contarUsos, idUso, partesUso } from '../src/dominio/usos.js';
import { destinoDe, escritorDe, firestoreDe, leerArgumentos, recorrer, Reporte } from './comun.js';
import type { Datos } from './comun.js';

const ARGS = leerArgumentos([], 'P2');
if (ARGS.aplicar && Number.isFinite(ARGS.limite)) throw new Error('--limite es solo para simular: no se puede usar con --aplicar.');
const reporte = new Reporte('usos');
const tabla = reporte.tabla('usos', ['docId', 'tipo', 'refId', 'usoOpsAntes', 'usoOpsNuevo', 'ultimoUsoAntes', 'ultimoUsoNuevo']);

async function recontar(db: Firestore, escritor: ReturnType<Firestore['bulkWriter']> | null): Promise<void> {
  const ops: Datos[] = [];
  const n = await recorrer(db, 'operaciones', ARGS.limite, (d) => { ops.push(d.data()); });
  reporte.contar('operaciones', 'documentos', n);
  const actuales = new Map<string, Datos>();
  await recorrer(db, COL_USOS, Infinity, (d) => { actuales.set(d.id, d.data()); });
  const conteo = contarUsos(ops);
  conteo.forEach((v, llave) => {
    const { tipo, refId } = partesUso(llave);
    const id = idUso(tipo, refId);
    const antes = actuales.get(id);
    actuales.delete(id);
    const igual = Number(antes?.usoOps) === v.usoOps && String(antes?.ultimoUsoISO ?? '') === v.ultimoUsoISO;
    reporte.contar(tipo, igual ? 'iguales' : 'aEscribir');
    if (igual) return;
    tabla.push([id, tipo, refId, antes?.usoOps ?? '', v.usoOps, antes?.ultimoUsoISO ?? '', v.ultimoUsoISO]);
    if (escritor) escritor.set(db.collection(COL_USOS).doc(id), { tipo, refId, usoOps: v.usoOps, ultimoUsoISO: v.ultimoUsoISO }).catch(() => {});
  });
  // Contadores que ya no tienen operaciones: a cero.
  actuales.forEach((antes, id) => {
    if (!Number(antes.usoOps)) return;
    tabla.push([id, antes.tipo, antes.refId, antes.usoOps, 0, antes.ultimoUsoISO ?? '', antes.ultimoUsoISO ?? '']);
    reporte.contar('sinOperaciones', 'aCero');
    if (escritor) escritor.update(db.collection(COL_USOS).doc(id), { usoOps: 0 }).catch(() => {});
  });
}

async function main(): Promise<void> {
  const db = firestoreDe(ARGS);
  const escritor = escritorDe(db, ARGS, reporte);
  const destino = destinoDe(ARGS);
  console.log(`\nRecuento de usos → ${destino} · ${ARGS.aplicar ? '⚠ APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);
  try {
    await recontar(db, escritor);
  } finally {
    if (escritor) await escritor.close().catch(() => {});
    const dir = reporte.escribir({ destino, aplicado: ARGS.aplicar }, ['usos']);
    console.log(JSON.stringify(reporte.resumen, null, 2));
    console.log(`\nReportes en ${dir}`);
  }
}

/** Promesa de la corrida (las pruebas la esperan). */
export const corrida = main().catch((e: unknown) => {
  console.error('El recuento falló:', e);
  process.exitCode = 1;
});

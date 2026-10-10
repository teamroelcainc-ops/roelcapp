/**
 * ✅ V00441 (Fase 5.6) — RECONSTRUIR EL SALDO CORRIENTE DE DIESEL.
 * ------------------------------------------------------------------------------
 * Recorre TODAS las referencias de diesel y arma, por proveedor, lo cargado por
 * día (saldos_corrientes/diesel_<clave>). El trigger referenciaDieselEscrita lo
 * mantiene después; este script es la carga inicial (y la reparación).
 *
 * Además compara, por cada saldo de saldos_diesel, la cuenta de siempre (todas
 * las referencias) contra la cuenta con los documentos nuevos → paridad.csv.
 * Encender la bandera `saldosCorrientes` solo con paridad.csv sin diferencias
 * (o con las diferencias entendidas: referencias viejas con otro ID y el mismo
 * nombre de proveedor).
 *
 * ⛔ PUNTO DE PARADA P2 en producción: primero sin --aplicar.
 * Escribe documentos COMPLETOS (sustituye `dias`): corre en un horario sin capturas
 * de diesel; si alguien captura mientras corre, el trigger corrige ese día en la
 * siguiente referencia (o se vuelve a correr).
 *
 * Uso (desde functions/):
 *   npm run saldos:diesel                                     → simulación
 *   npm run saldos:diesel -- --aplicar --confirmo-respaldo    → escribe
 * Reportes en functions/reportes/saldos-diesel-<fecha>/: resumen.json, documentos.csv, paridad.csv.
 * ------------------------------------------------------------------------------
 */
import type { Firestore } from 'firebase-admin/firestore';
import {
  agregadosDiesel, COL_SALDOS_CORRIENTES, cuentasDiesel, cuentasDieselDesdeReferencias, idSaldoDiesel,
} from '../src/dominio/saldosCorrientes.js';
import type { SaldoCorrienteDiesel } from '../src/dominio/saldosCorrientes.js';
import { r2 } from '../src/dominio/numeros.js';
import { destinoDe, escritorDe, firestoreDe, leerArgumentos, recorrer, Reporte } from './comun.js';
import type { Datos } from './comun.js';

const ARGS = leerArgumentos([], 'P2');
// Con --limite se reconstruiría con una parte de las referencias y se vaciaría lo demás.
if (ARGS.aplicar && Number.isFinite(ARGS.limite)) throw new Error('--limite es solo para simular: no se puede usar con --aplicar.');
const reporte = new Reporte('saldos-diesel');
const documentos = reporte.tabla('documentos', ['docId', 'clave', 'nombre', 'dias', 'primerDia', 'ultimoDia', 'cargadoTotal', 'cambia']);
const paridad = reporte.tabla('paridad', ['clave', 'nombre', 'restanteAntes', 'restanteNuevo', 'diferencia', 'cargasHoyAntes', 'cargasHoyNuevo']);

const hoy = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Matamoros', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function reconstruir(db: Firestore, escritor: ReturnType<Firestore['bulkWriter']> | null): Promise<void> {
  const refs: Datos[] = [];
  const n = await recorrer(db, 'referencias_diesel', ARGS.limite, (d) => { refs.push(d.data()); });
  reporte.contar('referencias_diesel', 'documentos', n);
  const saldos: Datos[] = [];
  await recorrer(db, 'saldos_diesel', Infinity, (d) => { saldos.push(d.data()); });
  const actuales = new Map<string, Datos>();
  await recorrer(db, COL_SALDOS_CORRIENTES, Infinity, (d) => { if (d.data().tipo === 'diesel') actuales.set(d.id, d.data()); });

  const agregados = agregadosDiesel(refs);
  const nuevos: SaldoCorrienteDiesel[] = [];
  agregados.forEach((v, clave) => {
    const doc: SaldoCorrienteDiesel = { tipo: 'diesel', clave, nombre: v.nombre, dias: v.dias };
    nuevos.push(doc);
    const id = idSaldoDiesel(clave);
    const fechas = Object.keys(v.dias).sort();
    const total = Object.values(v.dias).reduce((a, x) => a + x.c, 0) / 100;
    const cambia = JSON.stringify(actuales.get(id)?.dias ?? {}) !== JSON.stringify(Object.fromEntries(fechas.map((f) => [f, v.dias[f]])));
    documentos.push([id, clave, v.nombre, fechas.length, fechas[0] ?? '', fechas[fechas.length - 1] ?? '', r2(total), cambia ? 'sí' : 'no']);
    reporte.contar('saldos_corrientes', cambia ? 'aEscribir' : 'iguales');
    actuales.delete(id);
    if (escritor && cambia) {
      escritor.set(db.collection(COL_SALDOS_CORRIENTES).doc(id), { ...doc, dias: Object.fromEntries(fechas.map((f) => [f, v.dias[f]])), actualizadoEn: new Date().toISOString() })
        .catch(() => {}); // el error lo anota onWriteError
    }
  });
  // Documentos que ya no corresponden a ninguna referencia: se vacían.
  actuales.forEach((_, id) => {
    reporte.contar('saldos_corrientes', 'aVaciar');
    if (escritor) escritor.update(db.collection(COL_SALDOS_CORRIENTES).doc(id), { dias: {}, actualizadoEn: new Date().toISOString() }).catch(() => {});
  });

  // Paridad: la cuenta de la tarjeta, antes y con los documentos nuevos.
  const h = hoy();
  const antes = new Map(cuentasDieselDesdeReferencias(saldos, refs, h).map((c) => [c.clave, c]));
  for (const c of cuentasDiesel(saldos, nuevos, h)) {
    const a = antes.get(c.clave);
    const dif = r2((a?.restante ?? 0) - c.restante);
    if (Math.abs(dif) > 0.009 || a?.cargasHoy !== c.cargasHoy) {
      paridad.push([c.clave, c.nombre, r2(a?.restante ?? 0), r2(c.restante), dif, a?.cargasHoy ?? 0, c.cargasHoy]);
      reporte.contar('paridad', 'diferencias');
    } else {
      reporte.contar('paridad', 'iguales');
    }
  }
}

async function main(): Promise<void> {
  const db = firestoreDe(ARGS);
  const escritor = escritorDe(db, ARGS, reporte);
  const destino = destinoDe(ARGS);
  console.log(`\nSaldo corriente de diesel → ${destino} · ${ARGS.aplicar ? '⚠ APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);
  try {
    await reconstruir(db, escritor);
  } finally {
    if (escritor) await escritor.close().catch(() => {});
    const dir = reporte.escribir({ destino, aplicado: ARGS.aplicar }, ['paridad', 'documentos']);
    console.log(JSON.stringify(reporte.resumen, null, 2));
    console.log(`\nReportes en ${dir}`);
    if (!ARGS.aplicar) console.log('Simulación: no se escribió nada. Revisa paridad.csv (punto de parada P2) antes de --aplicar.');
  }
}

/** Promesa de la corrida (las pruebas la esperan). */
export const corrida = main().catch((e: unknown) => {
  console.error('La reconstrucción falló:', e);
  process.exitCode = 1;
});

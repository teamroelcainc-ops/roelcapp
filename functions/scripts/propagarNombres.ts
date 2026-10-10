/**
 * ✅ V00442 (Fase 6.2) — PONER AL DÍA todas las copias de nombres con EL mapa de
 * propagacion.ts (lo que hacían "Sincronizar nombres" y "🏷 Razón social", en el
 * servidor y con una sola regla). Se corre UNA vez antes de encender la bandera
 * `propagacionEnServidor`; después los triggers mantienen los nombres al día.
 *
 * ⛔ PUNTO DE PARADA P2 en producción: primero sin --aplicar (cambios.csv muestra
 * documento, campo, valor actual y nuevo).
 *
 * Uso (desde functions/):
 *   npm run nombres                                    → simulación
 *   npm run nombres -- --aplicar --confirmo-respaldo   → escribe
 *   npm run nombres -- --solo operaciones              → una colección destino
 */
import type { Firestore } from 'firebase-admin/firestore';
import { cambiosDeNombres, MAESTROS } from '../src/dominio/nombres.js';
import { destinoDe, escritorDe, firestoreDe, leerArgumentos, mostrar, recorrer, Reporte } from './comun.js';
import type { Datos } from './comun.js';

const DESTINOS = Array.from(new Set(MAESTROS.flatMap((m) => m.destinos.map((d) => d.coleccion))));
const ARGS = leerArgumentos(DESTINOS, 'P2');
const reporte = new Reporte('nombres');
const tabla = reporte.tabla('cambios', ['coleccion', 'docId', 'campo', 'actual', 'nuevo']);

async function propagar(db: Firestore, escritor: ReturnType<Firestore['bulkWriter']> | null): Promise<void> {
  const maestros = new Map<string, Map<string, Datos>>();
  for (const m of MAESTROS) {
    const registros = new Map<string, Datos>();
    await recorrer(db, m.coleccion, Infinity, (d) => { registros.set(d.id, d.data()); });
    maestros.set(m.coleccion, registros);
  }
  for (const coleccion of DESTINOS) {
    if (ARGS.solo && ARGS.solo !== coleccion) continue;
    const n = await recorrer(db, coleccion, ARGS.limite, (d) => {
      const datos = d.data() as Datos;
      const cambios = cambiosDeNombres(coleccion, datos, maestros);
      const campos = Object.keys(cambios);
      reporte.contar(coleccion, campos.length ? 'conCambios' : 'sinCambios');
      campos.forEach((c) => { tabla.push([coleccion, d.id, c, mostrar(datos[c]), mostrar(cambios[c])]); reporte.contar(coleccion, `campo:${c}`); });
      if (escritor && campos.length) escritor.update(d.ref, cambios, { lastUpdateTime: d.updateTime }).catch(() => {});
    });
    reporte.contar(coleccion, 'documentos', n);
  }
}

async function main(): Promise<void> {
  const db = firestoreDe(ARGS);
  const escritor = escritorDe(db, ARGS, reporte);
  const destino = destinoDe(ARGS);
  console.log(`\nPropagación de nombres → ${destino} · ${ARGS.aplicar ? '⚠ APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);
  try {
    await propagar(db, escritor);
  } finally {
    if (escritor) await escritor.close().catch(() => {});
    const dir = reporte.escribir({ destino, aplicado: ARGS.aplicar }, ['cambios']);
    console.log(JSON.stringify(reporte.resumen, null, 2));
    console.log(`\nReportes en ${dir}`);
  }
}

/** Promesa de la corrida (las pruebas la esperan). */
export const corrida = main().catch((e: unknown) => {
  console.error('La propagación falló:', e);
  process.exitCode = 1;
});

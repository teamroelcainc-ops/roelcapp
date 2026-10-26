/**
 * ✅ V00496 — FACTURAS CON LAS OPERACIONES EN TEXTO (importadas de AppSheet).
 * ------------------------------------------------------------------------------
 * Convierte `operacionesIds` de texto ("id1, id2") a arreglo y marca como
 * facturadas las operaciones de esas facturas que no tienen la marca. La regla
 * (pura, con pruebas) está en facturasTextoPlan.ts.
 *
 * ⛔ PUNTO DE PARADA: escribe en muchos documentos. En producción se corre
 *    primero SIN --aplicar, el negocio revisa facturas.csv y operaciones.csv, se
 *    hace el export de respaldo y solo entonces se aplica.
 *
 * Uso (desde functions/):
 *   npm run facturas:texto                                     → simulación
 *   npm run facturas:texto -- --solo clientes|proveedores · --limite N (facturas en texto)
 *   npm run facturas:texto -- --incluir-con-saldo              → también las que cambiarían de saldo
 *   npm run facturas:texto -- --aplicar --confirmo-respaldo    → aplica
 * Reportes en functions/reportes/facturas-texto-<fecha>/: resumen.json, facturas.csv, operaciones.csv, errores.csv.
 * Escribe con precondición (lastUpdateTime): lo que cambió mientras corría se
 * salta y lo recoge la siguiente corrida.
 * ------------------------------------------------------------------------------
 */
import type { DocumentData, DocumentReference, Firestore, QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { LADOS, lista } from '../src/dominio/facturacion.js';
import type { Lado } from '../src/dominio/dinero.js';
import { destinoDe, escritorDe, firestoreDe, leerArgumentos, recorrer, Reporte, txt } from './comun.js';
import type { Datos } from './comun.js';
import { enTexto, planFacturasTexto } from './facturasTextoPlan.js';
import type { FacturaLeida, OperacionLeida } from './facturasTextoPlan.js';

const ARGS = leerArgumentos(['clientes', 'proveedores'], 'facturas en texto (simulación revisada + respaldo)');
const INCLUIR_CON_SALDO = ARGS.tiene('--incluir-con-saldo');
const reporte = new Reporte('facturas-texto');
const tablaFacturas = reporte.tabla('facturas', ['coleccion', 'facturaId', 'invoice', 'empresa', 'statusFactura', 'operaciones', 'accion', 'motivo']);
const tablaOps = reporte.tabla('operaciones', ['lado', 'idEnFactura', 'docId', 'ref', 'accion', 'facturaId', 'folio', 'motivo']);

const LADOS_SCRIPT: ReadonlyArray<{ solo: string; lado: Lado }> = [{ solo: 'clientes', lado: 'cliente' }, { solo: 'proveedores', lado: 'proveedor' }];

interface Leida { datos: Datos; ref: DocumentReference; updateTime: Timestamp }

/** Id de la lista → operación: primero por id del documento, luego por su campo `id` (AppSheet). */
const leerOperaciones = async (db: Firestore, ids: readonly string[]): Promise<Map<string, (OperacionLeida & Leida) | null>> => {
  const salida = new Map<string, (OperacionLeida & Leida) | null>();
  const validos = ids.filter((x) => x && !x.includes('/'));
  for (let i = 0; i < validos.length; i += 300) {
    const lote = validos.slice(i, i + 300);
    const snaps = await db.getAll(...lote.map((x) => db.collection('operaciones').doc(x)));
    snaps.forEach((s, k) => { if (s.exists) salida.set(lote[k], { docId: s.id, datos: s.data() as Datos, ref: s.ref, updateTime: s.updateTime as Timestamp }); });
  }
  const faltan = ids.filter((x) => !salida.has(x));
  for (let i = 0; i < faltan.length; i += 30) {
    const lote = faltan.slice(i, i + 30);
    const snap = await db.collection('operaciones').where('id', 'in', lote).get();
    snap.docs.forEach((d) => {
      const propio = txt(d.data().id);
      if (propio && !salida.has(propio)) salida.set(propio, { docId: d.id, datos: d.data() as Datos, ref: d.ref, updateTime: d.updateTime });
    });
  }
  ids.forEach((x) => { if (!salida.has(x)) salida.set(x, null); });
  return salida;
};

async function procesar(db: Firestore, dineroPorServidor: boolean, escritor: ReturnType<Firestore['bulkWriter']> | null): Promise<void> {
  const err = (): void => {}; // el error final lo anota onWriteError
  for (const { solo, lado } of LADOS_SCRIPT) {
    if (ARGS.solo && ARGS.solo !== solo) continue;
    const c = LADOS[lado];
    const leidas = new Map<string, Leida>();
    const facturas: FacturaLeida[] = [];
    await recorrer(db, c.coleccion, Infinity, (d: QueryDocumentSnapshot<DocumentData>) => {
      leidas.set(d.id, { datos: d.data() as Datos, ref: d.ref, updateTime: d.updateTime });
      facturas.push({ id: d.id, datos: d.data() as Datos });
    });
    // --limite: cuántas facturas en TEXTO se procesan (las demás siguen contando para saber dónde está cada operación).
    const elegidas = new Set(facturas.filter((f) => enTexto(f.datos)).slice(0, ARGS.limite).map((f) => f.id));
    const idsEnTexto = Array.from(new Set(facturas.filter((f) => elegidas.has(f.id)).flatMap((f) => lista(f.datos.operacionesIds))));
    console.log(`[${c.coleccion}] ${facturas.length} facturas; ${elegidas.size} con las operaciones en texto (${idsEnTexto.length} ids).`);
    const ops = await leerOperaciones(db, idsEnTexto);
    const plan = planFacturasTexto(lado, facturas, ops, { dineroPorServidor, incluirConSaldo: INCLUIR_CON_SALDO, soloEstas: elegidas });

    for (const f of plan.facturas) {
      const datos = leidas.get(f.id)?.datos ?? {};
      tablaFacturas.push([c.coleccion, f.id, f.invoice, txt(datos[c.campoEmpresaNombre]), txt(datos.statusFactura), f.ids.join(' '), f.accion, f.motivo]);
      reporte.contar(c.coleccion, `facturas:${f.accion}`);
      const l = leidas.get(f.id);
      if (escritor && l && f.accion === 'convertir') escritor.update(l.ref, { operacionesIds: f.ids }, { lastUpdateTime: l.updateTime }).catch(err);
    }
    for (const o of plan.operaciones) {
      tablaOps.push([lado, o.idLista, o.docId, o.ref, o.accion, o.facturaId, o.folio, o.motivo]);
      reporte.contar(c.coleccion, `operaciones:${o.accion}`);
      if (o.motivo.startsWith('REVISAR') || o.motivo.includes('· REVISAR')) reporte.contar(c.coleccion, 'operaciones:enVariasFacturas');
      const leida = ops.get(o.idLista);
      if (escritor && leida && o.accion === 'marcar' && o.campos) escritor.update(leida.ref, o.campos, { lastUpdateTime: leida.updateTime }).catch(err);
    }
  }
}

async function main(): Promise<void> {
  const db = firestoreDe(ARGS);
  const flags = (await db.collection('configuracion').doc('flags').get()).data() ?? {};
  const dineroPorServidor = flags.dineroPorServidor === true;
  const escritor = escritorDe(db, ARGS, reporte);
  const destino = destinoDe(ARGS);
  console.log(`\nFacturas con operaciones en texto → ${destino} · ${ARGS.aplicar ? '⚠ APLICANDO CAMBIOS' : 'simulación (no escribe)'} · dineroPorServidor ${dineroPorServidor ? 'encendida' : 'apagada'}`);
  try {
    await procesar(db, dineroPorServidor, escritor);
  } finally {
    if (escritor) await escritor.close().catch(() => {});
    const dir = reporte.escribir({ destino, aplicado: ARGS.aplicar, dineroPorServidor, incluirConSaldo: INCLUIR_CON_SALDO, solo: ARGS.solo ?? 'ambas' }, ['facturas', 'operaciones']);
    console.log(JSON.stringify(reporte.resumen, null, 2));
    console.log(`\nReportes en ${dir}`);
    if (!ARGS.aplicar) console.log('Simulación: no se escribió nada. Revisa facturas.csv y operaciones.csv y haz el respaldo antes de --aplicar.');
  }
}

/** Promesa de la corrida (las pruebas la esperan). */
export const corrida = main().catch((e: unknown) => {
  console.error('El script de facturas en texto falló:', e);
  process.exitCode = 1;
});

/**
 * ✅ V00536 — PONER AL DÍA la copia del folio en las operaciones (facturaClienteInvoice /
 * facturaProveedorFolio). Hasta la V00535, editar el # de Invoice de una factura solo cambiaba la
 * factura: sus operaciones se quedaron con el folio viejo. Desde la V00536 Editar factura (web y
 * servidor) escribe el folio también en sus operaciones; este script arregla las que ya quedaron mal.
 *
 * Regla: la de `copiasDeFolio` (shared/dominio/facturacion.ts): solo operaciones LIGADAS a la factura
 * (su facturaClienteId / facturaProveedorId es el id del documento) y con otro folio. Las que no tienen
 * id de factura, o lo tienen de una factura que ya no existe, no se tocan (salen en el reporte).
 *
 * ⛔ PUNTO DE PARADA P2 en producción: primero SIN --aplicar (cambios.csv muestra operación, factura,
 * folio actual y nuevo). Con --aplicar necesita --confirmo-respaldo (export de respaldo hecho).
 *
 * Uso (desde functions/):
 *   npm run folios                                     → simulación (no escribe)
 *   npm run folios -- --solo cliente                   → un lado
 *   npm run folios -- --aplicar --confirmo-respaldo    → escribe
 */
import type { Firestore } from 'firebase-admin/firestore';
import { copiasDeFolio, LADOS } from '../src/dominio/facturacion.js';
import type { Lado } from '../src/dominio/dinero.js';
import { destinoDe, escritorDe, firestoreDe, leerArgumentos, mostrar, recorrer, Reporte, txt } from './comun.js';
import type { Datos } from './comun.js';

const LADOS_VALIDOS: readonly Lado[] = ['cliente', 'proveedor'];
const ARGS = leerArgumentos(LADOS_VALIDOS, 'P2');
const reporte = new Reporte('folios');
const cambios = reporte.tabla('cambios', ['lado', 'operacionId', 'ref', 'facturaId', 'folioActual', 'folioNuevo']);
const sinFactura = reporte.tabla('facturaNoExiste', ['lado', 'operacionId', 'ref', 'facturaId', 'folioActual']);

async function revisar(db: Firestore, escritor: ReturnType<Firestore['bulkWriter']> | null): Promise<void> {
  for (const lado of LADOS_VALIDOS) {
    if (ARGS.solo && ARGS.solo !== lado) continue;
    const c = LADOS[lado];
    // 1) Folio de cada documento de factura de ese lado.
    const folioDe = new Map<string, string>();
    await recorrer(db, c.coleccion, Infinity, (d) => { folioDe.set(d.id, txt((d.data() as Datos).invoice)); });
    reporte.contar(lado, 'facturas', folioDe.size);
    // 2) Cada operación ligada: si su copia del folio es otra, se pone la de su factura.
    const n = await recorrer(db, 'operaciones', ARGS.limite, (d) => {
      const datos = d.data() as Datos;
      const facturaId = txt(datos[c.opFacturaId]);
      if (!facturaId) return;
      reporte.contar(lado, 'ligadas');
      const folio = folioDe.get(facturaId);
      if (folio === undefined) {
        sinFactura.push([lado, d.id, mostrar(datos.ref), facturaId, mostrar(datos[c.opFolio])]);
        reporte.contar(lado, 'facturaNoExiste');
        return;
      }
      const [copia] = copiasDeFolio(lado, folio, [facturaId], [{ id: d.id, datos }]);
      if (!copia) { reporte.contar(lado, 'yaAlDia'); return; }
      cambios.push([lado, d.id, mostrar(datos.ref), facturaId, mostrar(datos[c.opFolio]), folio]);
      reporte.contar(lado, 'porCorregir');
      if (escritor) escritor.update(d.ref, copia.datos, { lastUpdateTime: d.updateTime }).catch(() => {});
    });
    reporte.contar(lado, 'operacionesRevisadas', n);
  }
}

async function main(): Promise<void> {
  const db = firestoreDe(ARGS);
  const escritor = escritorDe(db, ARGS, reporte);
  const destino = destinoDe(ARGS);
  console.log(`\nFolio en las operaciones → ${destino} · ${ARGS.aplicar ? '⚠ APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);
  try {
    await revisar(db, escritor);
  } finally {
    if (escritor) await escritor.close().catch(() => {});
    const dir = reporte.escribir({ destino, aplicado: ARGS.aplicar }, ['cambios']);
    console.log(JSON.stringify(reporte.resumen, null, 2));
    console.log(`\nReportes en ${dir}`);
  }
}

/** Promesa de la corrida (las pruebas la esperan). */
export const corrida = main().catch((e: unknown) => {
  console.error('La puesta al día de folios falló:', e);
  process.exitCode = 1;
});

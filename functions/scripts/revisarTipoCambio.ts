/**
 * ✅ V00461 — REVISIÓN del tipo de cambio de las operaciones (solo lee, nunca escribe).
 * ------------------------------------------------------------------------------
 * Compara el T.C. que usa cada operación (tipoCambioAprobado, o tipoCambioDia si falta:
 * el orden de dinero.ts) con el que le toca a SU fecha de servicio en tipo_cambio (sábado y
 * domingo sin registro: el del viernes). Hasta la V00460 el formulario podía dejar el T.C. de
 * otro día: al abrir una operación guardada le ponía el de HOY, al cambiar la fecha a
 * una sin registro se quedaba el anterior, y un T.C. capturado en la noche pasaba por
 * el del día siguiente.
 *
 * Reporte en functions/reportes/tipo-cambio-<fecha>/:
 *   distintos.csv  → operaciones con otro T.C. (y de qué día es el que traen)
 *   sin-tc.csv     → operaciones con T.C. 0 cuya fecha sí tiene registro
 *   resumen.json   → conteos (por estado, separando las que el T.C. mueve dinero) y los
 *                    renglones de tipo_cambio que no se pudieron leer (sin fecha o sin valor)
 * La corrección es una decisión del negocio (las facturadas cambian dinero): se revisa
 * el reporte juntos antes de tocar nada.
 *
 * Uso (desde functions/):
 *   npm run revisar:tc
 *   npm run revisar:tc -- --desde 2026-09-01     → solo servicios desde esa fecha
 * ------------------------------------------------------------------------------
 */
import { esOperacionPrueba, facturadaCliente, facturadaProveedor } from '../src/dominio/operacionCanonica.js';
import { fechaDeTipoCambio, mapaTipoCambio, revisarTipoCambioOperacion, tipoCambioMueveDinero, valorDeTipoCambio } from '../src/dominio/tipoCambio.js';
import { destinoDe, firestoreDe, leerArgumentos, recorrer, Reporte, txt } from './comun.js';

if (process.argv.includes('--aplicar')) throw new Error('Este script solo revisa: no tiene --aplicar.');
const ARGS = leerArgumentos([], 'P2');
const desde = (() => {
  const i = process.argv.indexOf('--desde');
  const v = i >= 0 ? process.argv[i + 1] ?? '' : '';
  if (i >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('--desde va con una fecha AAAA-MM-DD');
  return v;
})();

const reporte = new Reporte('tipo-cambio');
const COLUMNAS = ['ref', 'docId', 'fechaServicio', 'cliente', 'status', 'tcGuardado', 'tcDeSuFecha', 'registroDelTC', 'tcGuardadoEsDe', 'tcMueveDinero', 'facturadaCliente', 'facturaClienteId', 'facturadaProveedor'];
const distintos = reporte.tabla('distintos', COLUMNAS);
const sinTC = reporte.tabla('sin-tc', COLUMNAS);

async function main(): Promise<void> {
  const db = firestoreDe(ARGS);
  console.log(`\nRevisión del tipo de cambio → ${destinoDe(ARGS)} · solo lectura${desde ? ` · servicios desde ${desde}` : ''}`);
  try {
    const filasTC: unknown[] = [];
    await recorrer(db, 'tipo_cambio', Infinity, (d) => {
      const fila = d.data();
      filasTC.push(fila);
      if (!fechaDeTipoCambio(fila)) reporte.contar('tipo_cambio', 'sinFechaLegible');
      else if (valorDeTipoCambio(fila) === null) reporte.contar('tipo_cambio', 'sinValor');
    });
    const mapa = mapaTipoCambio(filasTC);
    // T.C. → fechas que lo tienen (para decir de qué día es el que trae la operación).
    const fechasDeValor = new Map<string, string[]>();
    mapa.forEach((valor, fecha) => {
      const k = valor.toFixed(4);
      fechasDeValor.set(k, [...(fechasDeValor.get(k) ?? []), fecha]);
    });
    reporte.contar('tipo_cambio', 'fechas', mapa.size);

    const n = await recorrer(db, 'operaciones', ARGS.limite, (d) => {
      const op = d.data();
      if (esOperacionPrueba(op)) { reporte.contar('operaciones', 'pruebas'); return; }
      const r = revisarTipoCambioOperacion(op, mapa);
      if (desde && (!r.fecha || r.fecha < desde)) { reporte.contar('operaciones', 'antesDeDesde'); return; }
      const mueveDinero = tipoCambioMueveDinero(op);
      reporte.contar(mueveDinero ? 'tcMueveDinero' : 'tcNoMueveDinero', r.estado);
      if (r.estado !== 'distinto' && r.estado !== 'sinTC') return;
      // Días que tienen el T.C. que trae la operación, del más cercano a su fecha (hasta 3).
      const distancia = (f: string): number => Math.abs(Date.parse(`${f}T12:00:00Z`) - Date.parse(`${r.fecha}T12:00:00Z`));
      const esDe = r.guardado > 0
        ? (fechasDeValor.get(r.guardado.toFixed(4)) ?? []).filter((f) => f !== r.fechaDelTC).sort((a, b) => distancia(a) - distancia(b)).slice(0, 3)
        : [];
      (r.estado === 'distinto' ? distintos : sinTC).push([
        txt(op.ref), d.id, r.fecha, txt(op.clientePagaNombre || op.clienteNombre), txt(op.statusNombre), r.guardado, r.deSuFecha ?? '', r.fechaDelTC,
        esDe.join(' '), mueveDinero ? 'sí' : 'no', facturadaCliente(op) ? 'sí' : 'no', txt(op.facturaClienteId), facturadaProveedor(op) ? 'sí' : 'no',
      ]);
    });
    reporte.contar('operaciones', 'documentos', n);
    // Lo más reciente arriba.
    for (const t of [distintos, sinTC]) {
      const [enc, ...filas] = t;
      filas.sort((a, b) => String(b[2]).localeCompare(String(a[2])));
      t.splice(0, t.length, enc, ...filas);
    }
  } finally {
    const dir = reporte.escribir({ destino: destinoDe(ARGS), desde: desde || null }, ['distintos', 'sin-tc']);
    console.log(JSON.stringify(reporte.resumen, null, 2));
    console.log(`\nReportes en ${dir}`);
  }
}

/** Promesa de la corrida (las pruebas la esperan). */
export const corrida = main().catch((e: unknown) => {
  console.error('La revisión falló:', e);
  process.exitCode = 1;
});

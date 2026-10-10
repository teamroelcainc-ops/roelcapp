/**
 * ✅ V00441 (Fase 5.9) — RECONCILIACIÓN DE FACTURAS con la regla única de dinero.
 * ------------------------------------------------------------------------------
 * Recorre facturas_clientes y facturas_proveedores y compara, factura por factura:
 *   · total: el que usan hoy Pagos/servidor ("legado") vs. la regla única;
 *   · total editado a mano: subtotalMonedaFactura que ya no coincide con sus
 *     renglones → se propone marcarlo (totalManualCentavos) para que nada lo pise;
 *   · montoPagado guardado vs. la suma de lo aplicado en `pagos` (libro de pagos);
 *   · saldoPendiente y statusPago vs. lo que da la regla única;
 *   · agregados en centavos (totalCentavos, saldoCentavos, saldoAFavorCentavos…).
 *
 * ⛔ PUNTO DE PARADA P3: en producción se corre primero SIN --aplicar y el negocio
 *    revisa `diferencias.csv` factura por factura antes de aplicar.
 *
 * Con --aplicar escribe, por factura (con precondición lastUpdateTime):
 *   totalManualCentavos (si se detectó total manual), saldoPendiente, statusPago,
 *   los agregados en centavos, esquemaDinero: 2 y las tablas hijas
 *   renglones/{opId} y aplicaciones/{pagoId}. El montoPagado guardado NO se
 *   cambia salvo con --pagado-desde-pagos (entonces se toma del libro de pagos).
 *
 * Uso (desde functions/):
 *   npm run reconciliar                                         → simulación
 *   npm run reconciliar -- --aplicar --confirmo-respaldo        → aplica (después de P3)
 *   npm run reconciliar -- --solo clientes|proveedores · --limite N · --pagado-desde-pagos
 * Reportes en functions/reportes/reconciliacion-<fecha>/: resumen.json, diferencias.csv, errores.csv.
 * ------------------------------------------------------------------------------
 */
import type { DocumentData, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  agregadosFactura, aplicadoPorFactura, monedaDeFactura, renglonEnCentavos, statusPagoDe, totalNativoDeOperaciones,
  totalNativoFactura, totalNativoFacturaLegado,
} from '../src/dominio/dinero.js';
import { aCentavos, deCentavos, r2 } from '../src/dominio/numeros.js';
import { destinoDe, escritorDe, firestoreDe, leerArgumentos, mostrar, recorrer, Reporte, txt } from './comun.js';
import type { Datos } from './comun.js';

const ARGS = leerArgumentos(['clientes', 'proveedores'], 'P3');
const PAGADO_DESDE_PAGOS = ARGS.tiene('--pagado-desde-pagos');
const reporte = new Reporte('reconciliacion');
const diferencias = reporte.tabla('diferencias', ['coleccion', 'facturaId', 'invoice', 'empresa', 'moneda', 'campo', 'actual', 'nuevo', 'motivo']);

const LADOS = [
  { solo: 'clientes', coleccion: 'facturas_clientes', tipo: 'cliente', empresa: 'clienteNombre' },
  { solo: 'proveedores', coleccion: 'facturas_proveedores', tipo: 'proveedor', empresa: 'proveedorNombre' },
] as const;

const difiere = (a: unknown, b: unknown): boolean => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.005;

/** Libro de pagos: por factura, lo aplicado (en centavos) y por qué pagos. */
const libroDePagos = async (db: Firestore): Promise<Map<string, Map<string, Datos>>> => {
  const libro = new Map<string, Map<string, Datos>>();
  await recorrer(db, 'pagos', Infinity, (d) => {
    const p = d.data();
    const tipo = txt(p.tipo);
    if (tipo !== 'cliente' && tipo !== 'proveedor') return;
    aplicadoPorFactura(p.facturas).forEach((monto, facturaId) => {
      const clave = `${tipo}/${facturaId}`;
      const porPago = libro.get(clave) ?? new Map<string, Datos>();
      porPago.set(d.id, { aplicadoCentavos: aCentavos(monto), fecha: txt(p.fecha), numeroPago: txt(p.numeroPago), tipo, pagoId: d.id });
      libro.set(clave, porPago);
    });
  });
  return libro;
};

async function reconciliar(db: Firestore, escritor: ReturnType<Firestore['bulkWriter']> | null): Promise<void> {
  console.log('Leyendo el libro de pagos…');
  const libro = await libroDePagos(db);

  for (const lado of LADOS) {
    if (ARGS.solo && ARGS.solo !== lado.solo) continue;
    const n = await recorrer(db, lado.coleccion, ARGS.limite, (d: QueryDocumentSnapshot<DocumentData>) => {
      const fac = d.data() as Datos;
      const invoice = txt(fac.invoice) || d.id;
      const moneda = monedaDeFactura(fac);
      const anotar = (campo: string, actual: unknown, nuevo: unknown, motivo: string): void => {
        diferencias.push([lado.coleccion, d.id, invoice, txt(fac[lado.empresa]), moneda ?? '?', campo, mostrar(actual), mostrar(nuevo), motivo]);
        reporte.contar(lado.coleccion, `dif:${campo}`);
      };

      // Total editado a mano: el guardado ya no sale de sus renglones.
      const deRenglones = r2(totalNativoDeOperaciones(moneda, fac.operacionesGuardadas));
      const guardado = r2(fac.subtotalMonedaFactura);
      const yaManual = Number(fac.totalManualCentavos) > 0;
      const proponerManual = !yaManual && guardado > 0 && deRenglones > 0 && difiere(guardado, deRenglones);
      if (proponerManual) anotar('totalManualCentavos', '', aCentavos(guardado), `total guardado ${guardado} ≠ renglones ${deRenglones}: se conserva como total manual`);
      const facConMarca: Datos = proponerManual ? { ...fac, totalManualCentavos: aCentavos(guardado) } : fac;

      const totalLegado = r2(totalNativoFacturaLegado(fac));
      const totalUnico = r2(totalNativoFactura(facConMarca));
      if (difiere(totalLegado, totalUnico)) anotar('total', totalLegado, totalUnico, 'la regla única reconoce la moneda/renglones distinto que la anterior');

      const pagos = libro.get(`${lado.tipo}/${d.id}`) ?? new Map<string, Datos>();
      const pagadoLibro = deCentavos(Array.from(pagos.values()).reduce<number>((s, a) => s + (Number(a.aplicadoCentavos) || 0), 0));
      const pagadoGuardado = r2(fac.montoPagado);
      if (difiere(pagadoLibro, pagadoGuardado)) {
        anotar('montoPagado', pagadoGuardado, pagadoLibro, PAGADO_DESDE_PAGOS ? 'se toma del libro de pagos' : 'difiere del libro de pagos (no se cambia sin --pagado-desde-pagos)');
      }
      const pagado = PAGADO_DESDE_PAGOS ? pagadoLibro : pagadoGuardado;
      const saldo = r2(Math.max(0, totalUnico - pagado));
      const status = pagado > 0.009 || txt(fac.statusPago) ? statusPagoDe(pagado, saldo) : '';
      const tieneSaldoGuardado = typeof fac.saldoPendiente === 'number' || pagado > 0.009;
      if (tieneSaldoGuardado && difiere(fac.saldoPendiente, saldo)) anotar('saldoPendiente', fac.saldoPendiente, saldo, 'saldo con la regla única');
      if (tieneSaldoGuardado && txt(fac.statusPago) !== status) anotar('statusPago', fac.statusPago, status, 'status con la regla única');
      if (pagado - totalUnico > 0.009) anotar('saldoAFavor', '', r2(pagado - totalUnico), 'pagado de más: queda a favor (antes se perdía con Math.max)');

      // Cambios a escribir.
      const cambios: Datos = {};
      if (proponerManual) cambios.totalManualCentavos = aCentavos(guardado);
      if (PAGADO_DESDE_PAGOS && difiere(pagadoLibro, pagadoGuardado)) cambios.montoPagado = pagadoLibro;
      if (tieneSaldoGuardado && difiere(fac.saldoPendiente, saldo)) cambios.saldoPendiente = saldo;
      if (tieneSaldoGuardado && txt(fac.statusPago) !== status) cambios.statusPago = status;
      const ag = agregadosFactura({ ...facConMarca, montoPagado: pagado }) as unknown as Datos;
      for (const [k, v] of Object.entries(ag)) if (fac[k] !== v) cambios[k] = v;
      if (fac.esquemaDinero !== 2) cambios.esquemaDinero = 2;
      reporte.contar(lado.coleccion, Object.keys(cambios).length ? 'conCambios' : 'sinCambios');
      reporte.contar(lado.coleccion, 'revisadas');

      if (!escritor) return;
      const err = () => {}; // el error lo anota onWriteError
      if (Object.keys(cambios).length) escritor.update(d.ref, cambios, { lastUpdateTime: d.updateTime }).catch(err);
      // Tablas hijas (se reescriben completas: idempotente).
      for (const r of Array.isArray(fac.operacionesGuardadas) ? fac.operacionesGuardadas : []) {
        const opId = txt((r as Datos)?.id);
        if (opId && !opId.includes('/')) escritor.set(d.ref.collection('renglones').doc(opId), { ...renglonEnCentavos(r, moneda), opId }).catch(err);
      }
      pagos.forEach((ap, pagoId) => { escritor.set(d.ref.collection('aplicaciones').doc(pagoId), ap).catch(err); });
    });
    reporte.contar(lado.coleccion, 'documentos', n);
  }
}

async function main(): Promise<void> {
  const db = firestoreDe(ARGS);
  if (ARGS.aplicar) {
    // Con la bandera apagada, el trigger de saldo (regla anterior) desharía lo escrito aquí.
    const flags = (await db.collection('configuracion').doc('flags').get()).data() ?? {};
    if (flags.dineroPorServidor !== true) {
      throw new Error('Para --aplicar primero enciende dineroPorServidor en configuracion/flags (y espera 1 minuto): con la bandera apagada el trigger de saldo regresaría los valores anteriores.');
    }
  }
  const escritor = escritorDe(db, ARGS, reporte);
  const destino = destinoDe(ARGS);
  console.log(`\nReconciliación de facturas → ${destino} · ${ARGS.aplicar ? '⚠ APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);
  try {
    await reconciliar(db, escritor);
  } finally {
    if (escritor) await escritor.close().catch(() => {});
    const dir = reporte.escribir({ destino, aplicado: ARGS.aplicar, pagadoDesdePagos: PAGADO_DESDE_PAGOS, solo: ARGS.solo ?? 'ambas' }, ['diferencias']);
    console.log(JSON.stringify(reporte.resumen, null, 2));
    console.log(`\nReportes en ${dir}`);
    if (!ARGS.aplicar) console.log('Simulación: no se escribió nada. El negocio revisa diferencias.csv (punto de parada P3) antes de --aplicar.');
  }
}

/** Promesa de la corrida (las pruebas la esperan). */
export const corrida = main().catch((e: unknown) => {
  console.error('La reconciliación falló:', e);
  process.exitCode = 1;
});

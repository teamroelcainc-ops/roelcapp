// src/features/operaciones/services/tomarDeFacturaDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00538 — Lectura y escritura de "Tomar lo de la factura" (D1/D4 facturadas, regla en
// tomarDeFactura.ts). Se lee lo de este momento (operaciones, sus facturas y los convenios) para la
// prueba; al aplicar, cada operación y su factura se RELEEN dentro de la transacción y el plan se
// vuelve a calcular: si algo cambió desde la prueba, no se toca y se dice por qué.
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { porIds } from '../../../shared/data/consultas';
import { registrarLog } from '../../../utils/logger';
import { notificarOperacionesGuardadas } from '../../../utils/operacionesBus';
import { leerConvenios } from './corregirMonedaConvenioDatos';
import type { CatalogoConvenios } from './corregirMonedaConvenio';
import { planTomarDeFactura } from './tomarDeFactura';
import type { PlanTomarDeFactura } from './tomarDeFactura';
import type { ResultadoCorreccion } from './correccion';

type Datos = Record<string, unknown>;
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
/** Operaciones por transacción (cada una relee la operación y su factura). */
const TANDA = 50;

export interface PreparacionTomarDeFactura { planes: PlanTomarDeFactura[]; cat: CatalogoConvenios }

/** Lee las operaciones, sus facturas y los convenios, y arma el plan de cada una. */
export const prepararTomarDeFactura = async (opIds: readonly string[]): Promise<PreparacionTomarDeFactura> => {
  const [cat, ops] = await Promise.all([leerConvenios(), porIds('operaciones', opIds)]);
  const facturaIds = Array.from(new Set(ops.map((o) => txt(o.facturaClienteId)).filter(Boolean)));
  const facturas = await porIds('facturas_clientes', facturaIds);
  const facturaPorId = new Map(facturas.map((f) => [idReal(f), f as Datos] as const));
  const planes = ops.map((o) => planTomarDeFactura(idReal(o), o, facturaPorId.get(txt(o.facturaClienteId)) ?? null, cat));
  return { planes, cat };
};

/** Aplica las que se corrigen, en tandas; relee cada operación y su factura antes de escribir. */
export const aplicarTomarDeFactura = async (
  prep: PreparacionTomarDeFactura, cuando: string, alAvanzar: (hechas: number, total: number) => void,
): Promise<ResultadoCorreccion> => {
  const aCorregir = prep.planes.filter((p) => p.estado === 'corregir');
  const omitidas: ResultadoCorreccion['omitidas'] = [];
  let hechas = 0;
  let error = '';
  for (let i = 0; i < aCorregir.length; i += TANDA) {
    const tanda = aCorregir.slice(i, i + TANDA);
    try {
      const escritos = await runTransaction(db, async (tx) => {
        const refsOps = tanda.map((p) => doc(db, 'operaciones', p.opId));
        const snapsOps = await Promise.all(refsOps.map((r) => tx.get(r)));
        const refsFac = snapsOps.map((s) => { const id = txt(s.data()?.facturaClienteId); return id ? doc(db, 'facturas_clientes', id) : null; });
        const snapsFac = await Promise.all(refsFac.map((r) => (r ? tx.get(r) : Promise.resolve(null))));
        const lista: [string, Datos][] = [];
        tanda.forEach((p, k) => {
          const op = snapsOps[k].exists() ? (snapsOps[k].data() as Datos) : null;
          const fac = snapsFac[k]?.exists() ? (snapsFac[k]?.data() as Datos) : null;
          if (!op) { omitidas.push({ id: p.opId, ref: p.ref, motivo: 'La operación ya no existe.' }); return; }
          const ahora = planTomarDeFactura(p.opId, op, fac, prep.cat);
          if (ahora.estado !== 'corregir' || !ahora.datos) { omitidas.push({ id: p.opId, ref: p.ref, motivo: `Cambió desde la prueba: ${ahora.motivo}` }); return; }
          const datos = { ...ahora.datos, montosDeFacturaEn: cuando };
          tx.update(refsOps[k], datos);
          lista.push([p.opId, datos]);
        });
        return lista;
      });
      hechas += escritos.length;
      notificarOperacionesGuardadas(escritos, 'revision-tomar-de-factura');
    } catch (e) {
      console.error('[Tomar lo de la factura] No se pudo escribir una tanda:', e);
      error = String((e as { message?: string })?.message || e).split('\n')[0];
      break;
    }
    alAvanzar(Math.min(i + TANDA, aCorregir.length), aCorregir.length);
  }
  if (hechas > 0) {
    await registrarLog('Operaciones', 'Edición',
      `Revisión de datos (D1/D4 facturadas): ${hechas} operación(es) tomaron la moneda y el monto de su factura (montosDeFacturaEn = ${cuando}); las facturas no cambiaron. ${omitidas.length} no se escribieron.${error ? ` Se detuvo por un error: ${error}` : ''}`).catch(() => {});
  }
  return { hechas, omitidas, error };
};

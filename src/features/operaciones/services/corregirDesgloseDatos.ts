// src/features/operaciones/services/corregirDesgloseDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00532 — lecturas y escrituras de "Corregir desglose" (la regla está en corregirDesglose.ts).
// La revisión recorre TODAS las operaciones por páginas de 500 sin escribir nada. Al aplicar, cada
// tanda de 100 va en UNA transacción que relee sus operaciones y solo escribe las que siguen dando
// exactamente lo de la prueba (si alguien la cambió desde entonces, se salta y se dice por qué).
// Se escriben Total (subtotal), Dólares y Pesos y la marca desgloseCorregido; la Conversión no.
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { contarOperaciones, paginaOperacionesPorId } from '../../../shared/data/consultas';
import type { Cursor } from '../../../shared/data/consultas';
import { idReal } from '../../../shared/data/coleccionesVivas';
import type { Lado } from '../../../shared/dominio/dinero';
import { esOperacionPrueba } from '../../../utils/operacionPrueba';
import { registrarLog } from '../../../utils/logger';
import { motivoAlAplicar, revisarDesglose } from './corregirDesglose';
import type { RevisionDesglose } from './corregirDesglose';

type Datos = Record<string, unknown>;
const PAGINA = 500;
const TANDA = 100;

export interface OtraConversion { id: string; ref: string; lados: Lado[] }
export interface RevisionDesgloseTodas { revisiones: RevisionDesglose[]; otraConversion: OtraConversion[]; leidas: number }

/** Recorre todas las operaciones (sin las de prueba): las que hay que corregir y las de otra conversión. `sigue()` en false corta. */
export const revisarDesgloseTodas = async (alAvanzar: (leidas: number, total: number) => void, sigue: () => boolean): Promise<RevisionDesgloseTodas> => {
  const total = await contarOperaciones();
  const revisiones: RevisionDesglose[] = [];
  const otraConversion: OtraConversion[] = [];
  let leidas = 0;
  let cursor: Cursor = null;
  alAvanzar(leidas, total);
  while (sigue()) {
    const p = await paginaOperacionesPorId(PAGINA, cursor);
    p.docs.forEach((op) => {
      if (esOperacionPrueba(op)) return;
      const id = idReal(op);
      const r = revisarDesglose(id, op);
      if (r.revision) revisiones.push(r.revision);
      if (r.otraConversion.length > 0) otraConversion.push({ id, ref: r.ref, lados: r.otraConversion });
    });
    leidas += p.docs.length;
    alAvanzar(leidas, Math.max(total, leidas));
    if (!p.hayMas) break;
    cursor = p.cursor;
  }
  return { revisiones, otraConversion, leidas };
};

export interface OmitidaDesglose { id: string; ref: string; motivo: string }
export interface ResultadoDesglose { corregidas: number; omitidas: OmitidaDesglose[]; error: string }

/** Escribe lo de la prueba, tanda por tanda (cada tanda es todo o nada). */
export const aplicarDesglose = async (revisiones: readonly RevisionDesglose[], cuando: string, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoDesglose> => {
  const total = revisiones.length;
  const omitidas: OmitidaDesglose[] = [];
  let corregidas = 0;
  let error = '';
  alAvanzar(0, total);
  for (let i = 0; i < total && !error; i += TANDA) {
    const tanda = revisiones.slice(i, i + TANDA);
    const r = await runTransaction(db, async (tx) => {
      const refs = tanda.map((x) => doc(db, 'operaciones', x.id));
      const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
      const fuera: OmitidaDesglose[] = [];
      let escritas = 0;
      tanda.forEach((plan, k) => {
        const motivo = motivoAlAplicar(snaps[k].exists() ? (snaps[k].data() as Datos) : null, plan);
        if (motivo) { fuera.push({ id: plan.id, ref: plan.ref, motivo }); return; }
        tx.update(refs[k], { ...plan.datos, desgloseCorregido: cuando });
        escritas += 1;
      });
      return { fuera, escritas };
    }).catch((e: unknown) => {
      console.error('[Corregir desglose] No se pudo escribir una tanda de operaciones:', e);
      error = String((e as { message?: string })?.message || e).split('\n')[0];
      return null;
    });
    if (!r) break;
    corregidas += r.escritas;
    omitidas.push(...r.fuera);
    alAvanzar(Math.min(i + TANDA, total), total);
  }
  if (corregidas > 0) {
    await registrarLog('Operaciones', 'Edición',
      `Corregir desglose: ${corregidas} operación(es) con Total, Dólares y Pesos en la moneda de su Facturado en (desgloseCorregido = ${cuando}); la Conversión no cambió. ${omitidas.length} no se escribieron (cambiaron desde la prueba).${error ? ` Se detuvo por un error: ${error}` : ''}`);
  }
  return { corregidas, omitidas, error };
};

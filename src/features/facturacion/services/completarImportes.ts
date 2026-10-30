// src/features/facturacion/services/completarImportes.ts
// ---------------------------------------------------------------------------
// ✅ V00524 — COMPLETAR IMPORTES (pestaña Corregir de Facturación de Clientes). Las facturas que "no
// guardaron lo que cobró cada operación" (sobre todo las importadas de AppSheet: solo el total y la
// lista de operaciones) reciben su desglose: un renglón por operación con lo que cobra HOY
// (`renglonFactura`, el mismo renglón de Facturar). EL TOTAL NO CAMBIA:
//   · si la factura tenía su total guardado (subtotalMonedaFactura o total manual), se queda igual;
//   · si no lo tenía (salía de otros campos), se guarda ESE MISMO total en subtotalMonedaFactura, para
//     que al tener renglones no se calcule de ellos.
// Se comprueba antes de escribir: el total que se ve hoy = el total después (si no, no se completa).
// Escritura MASIVA: reglas del usuario (PRUEBA → RESPALDO → "APLICAR"), en transacciones por tanda que
// releen cada factura y sus operaciones; lo que cambió desde la prueba no se toca.
// ✅ V00527 — También PONE AL DÍA los importes viejos: si la factura ya tenía su desglose pero no suma su total
// y con el TOTAL de hoy de cada operación (con sus cargos adicionales) SÍ cuadra (p. ej. la 39802: guardó el
// subtotal $140 y el total ya era $390 con $250 de cargos), sus renglones toman lo de hoy. El total tampoco
// cambia. Si con lo de hoy tampoco cuadra, no se toca (revisarla a mano).
// No se completa (queda para revisarla a mano): sin operaciones ligadas (solo referencias), una
// operación que no existe o que está en otra factura, sin moneda, sin total, o si sus operaciones hoy
// cobran $0.00. Con dineroPorServidor no se ofrece (las reglas no dejan escribir dinero de la factura).
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { porIds } from '../../../shared/data/consultas';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { montoOperacion, renglonFactura, totalNativoFacturaLegado } from '../../../shared/dominio/dinero';
import { renglonesDeFactura } from '../../../shared/dominio/facturacion';
import { aCentavos } from '../../../shared/dominio/numeros';
import { registrarLog } from '../../../utils/logger';
import type { CeldaExcel } from '../../operaciones/services/excelOperaciones';
import { esRefOperacion } from './leerCfdi';
import { normalizarFacturaDe } from './normalizarFactura';
import { estaCancelada, importesDeRenglones } from './reglasFactura';

type Datos = Record<string, unknown>;
type MonedaFactura = 'USD' | 'MXN';

const txt = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(txt).filter(Boolean) : []);
const dinero = (n: number): string => `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const centavosDe = (moneda: MonedaFactura, renglones: unknown): number =>
  importesDeRenglones(moneda, renglones).reduce((s, x) => s + aCentavos(x), 0);

/** Una factura (documento) sin desglose, como está en pantalla (normalizada). */
export interface DocSinImportes {
  id: string;
  invoice: string;
  cliente: string;
  fecha: string;
  /** La moneda con la que se ve en Facturación (la de la factura o, si no tiene, la del cliente). */
  moneda: MonedaFactura | null;
  datos: Datos;
}

/** Lo que se escribe en una factura. */
export interface PlanDoc {
  id: string;
  invoice: string;
  cliente: string;
  fecha: string;
  moneda: MonedaFactura;
  ids: string[];
  renglones: Datos[];
  /** El total que tiene hoy (no cambia). */
  total: number;
  /** No tenía el total guardado: se guarda el mismo en subtotalMonedaFactura. */
  fijarTotal: boolean;
  /** Lo que suman hoy sus operaciones. */
  suma: number;
  cuadra: boolean;
  /** ✅ V00527: ya tenía su desglose (viejo): se reemplaza por el de hoy (solo cuando así cuadra con el total). */
  reemplaza: boolean;
  /** Los renglones que tenía (para el respaldo y la prueba); [] si no tenía importes. */
  antes: Datos[];
}
export interface OmitidaCompletar { id: string; invoice: string; cliente: string; fecha: string; motivo: string }
export interface PlanCompletar { completar: PlanDoc[]; omitidas: OmitidaCompletar[] }

/** Los ids de las operaciones de cada factura (los que se pueden leer): los de sus renglones si ya tiene importes; si no, las ligadas. */
export const idsPorLeer = (docs: readonly DocSinImportes[]): string[] =>
  Array.from(new Set(docs.flatMap((d) => (d.moneda && centavosDe(d.moneda, d.datos.operacionesGuardadas) > 0
    ? renglonesDeFactura(d.datos).map((r) => txt(r.id))
    : lista(d.datos.operacionesIds))).filter((id) => id && !esRefOperacion(id))));

/** El plan de UNA factura, o el motivo por el que no se completa. Puro. */
export const planDeDoc = (d: DocSinImportes, ops: ReadonlyMap<string, Datos | null>): PlanDoc | { motivo: string } => {
  const fac = d.datos;
  if (estaCancelada(fac.statusFactura)) return { motivo: 'Está cancelada' };
  if (!d.moneda) return { motivo: 'La factura no tiene moneda' };
  const total = totalNativoFacturaLegado(fac);
  if (!(aCentavos(total) > 0)) return { motivo: 'La factura no tiene total' };
  // ✅ V00527: con importes (viejos) se ponen al día SUS renglones; sin importes se arman de las operaciones ligadas.
  const guardados = renglonesDeFactura(fac);
  const yaTiene = centavosDe(d.moneda, fac.operacionesGuardadas) > 0;
  // Un total guardado EN CERO (el campo existe con 0) se usa así en las filas agrupadas: no se toca.
  if (fac.subtotalMonedaFactura !== undefined && fac.subtotalMonedaFactura !== null && fac.subtotalMonedaFactura !== '' && !(Number(fac.subtotalMonedaFactura) > 0)) {
    return { motivo: 'Tiene su total guardado en $ 0.00: revisarla a mano' };
  }
  const ids = yaTiene ? guardados.map((r) => txt(r.id)) : lista(fac.operacionesIds);
  if (ids.length === 0 || ids.some((id) => !id || esRefOperacion(id))) return { motivo: 'Solo guardó las referencias, no las operaciones: revisarla a mano' };
  const renglones: Datos[] = [];
  for (const [i, id] of ids.entries()) {
    const op = ops.get(id);
    if (!op) return { motivo: `No se encontró la operación ${id}` };
    const otraId = txt(op.facturaClienteId);
    const otraInvoice = txt(op.facturaClienteInvoice);
    if (otraId && otraId !== d.id && otraInvoice && otraInvoice.toLowerCase() !== d.invoice.toLowerCase()) {
      return { motivo: `La operación ${txt(op.ref) || id} está en otra factura (${otraInvoice})` };
    }
    if (yaTiene) {
      // El mismo renglón con el TOTAL de hoy de su operación (sus demás datos se quedan).
      const m = montoOperacion(op, 'cliente');
      renglones.push({ ...guardados[i], monto: m.conv, subtotalBase: m.subtotal, dol: m.dol, pes: m.pes });
    } else renglones.push({ ...renglonFactura(id, op, 'cliente') });
  }
  const sumaC = centavosDe(d.moneda, renglones);
  if (sumaC === 0) return { motivo: 'Sus operaciones hoy cobran $ 0.00' };
  if (yaTiene) {
    if (importesDeRenglones(d.moneda, renglones).join('|') === importesDeRenglones(d.moneda, guardados).join('|')) return { motivo: 'Ya tiene sus importes al día' };
    if (sumaC !== aCentavos(total)) return { motivo: 'Ya tiene sus importes y con el total de hoy de sus operaciones tampoco cuadra: revisarla a mano' };
  }
  const fijarTotal = !(Number(fac.subtotalMonedaFactura) > 0) && !(Number(fac.totalManualCentavos) > 0);
  // El total NO puede cambiar: se comprueba con la misma regla que usa la pantalla.
  const despues = totalNativoFacturaLegado({ ...fac, operacionesGuardadas: renglones, ...(fijarTotal ? { subtotalMonedaFactura: total } : {}) });
  if (aCentavos(despues) !== aCentavos(total)) return { motivo: `El total cambiaría (${dinero(total)} → ${dinero(despues)})` };
  return {
    id: d.id, invoice: d.invoice, cliente: d.cliente, fecha: d.fecha, moneda: d.moneda, ids, renglones, total, fijarTotal,
    suma: sumaC / 100, cuadra: sumaC === aCentavos(total), reemplaza: yaTiene, antes: yaTiene ? guardados : [],
  };
};

/** El plan de todas. Puro. */
export const planCompletarImportes = (docs: readonly DocSinImportes[], ops: ReadonlyMap<string, Datos | null>): PlanCompletar => {
  const completar: PlanDoc[] = [];
  const omitidas: OmitidaCompletar[] = [];
  docs.forEach((d) => {
    const p = planDeDoc(d, ops);
    if ('motivo' in p) omitidas.push({ id: d.id, invoice: d.invoice, cliente: d.cliente, fecha: d.fecha, motivo: p.motivo });
    else completar.push(p);
  });
  return { completar, omitidas };
};

/** El motivo sin lo particular de cada factura (para agruparlas en pantalla). */
export const categoriaMotivo = (motivo: string): string => {
  if (motivo.endsWith('(cambió desde la prueba)') || motivo.startsWith('Cambió desde la prueba')) return 'Cambió desde la prueba';
  if (motivo.startsWith('No se encontró la operación')) return 'No se encontró una de sus operaciones';
  if (motivo.includes('está en otra factura')) return 'Una de sus operaciones está en otra factura';
  if (motivo.startsWith('El total cambiaría')) return 'El total cambiaría';
  return motivo;
};

/** Lo que se escribe en la factura (solo el desglose y, si hace falta, el MISMO total). */
export const datosCompletar = (p: PlanDoc, ahoraISO: string, usuario: string): Datos => ({
  operacionesGuardadas: p.renglones,
  ...(p.fijarTotal ? { subtotalMonedaFactura: p.total } : {}),
  importesCompletados: { en: ahoraISO, por: usuario, total: p.total, fijoTotal: p.fijarTotal, reemplazo: p.reemplaza },
});

const refsConImporte = (p: PlanDoc, renglones: readonly Datos[]): string =>
  renglones.map((r, i) => `${txt(r.ref) || p.ids[i]} ${dinero(importesDeRenglones(p.moneda, renglones)[i] ?? 0)}`).join('; ');

/** Excel de PRUEBA: una fila por factura (las que se completan y las que no, con su motivo). */
export const filasPruebaCompletar = (plan: PlanCompletar): Record<string, CeldaExcel>[] => [
  ...plan.completar.map((p) => ({
    'Acción': p.reemplaza ? 'Se ponen al día sus importes' : 'Se completa', Invoice: p.invoice, Fecha: p.fecha, Cliente: p.cliente, Moneda: p.moneda === 'USD' ? 'Dólares' : 'Pesos',
    'Total (no cambia)': p.total, 'Referencias antes (en la factura)': p.reemplaza ? refsConImporte(p, p.antes) : 'sin importes',
    'Referencias (total de hoy)': refsConImporte(p, p.renglones), 'Suman hoy': p.suma,
    Diferencia: (aCentavos(p.total) - aCentavos(p.suma)) / 100,
    Resultado: p.cuadra ? 'Cuadra: sale de Corregir' : 'No cuadra: pasa a "Sus operaciones no suman el total"',
    'Se guarda el mismo total': p.fijarTotal ? 'Sí (no lo tenía guardado)' : 'No (ya lo tenía)', Motivo: '',
  })),
  ...plan.omitidas.map((o) => ({
    'Acción': 'No se toca', Invoice: o.invoice, Fecha: o.fecha, Cliente: o.cliente, Moneda: '', 'Total (no cambia)': '',
    'Referencias antes (en la factura)': '', 'Referencias (total de hoy)': '', 'Suman hoy': '', Diferencia: '', Resultado: 'Queda en Corregir (revisarla a mano)', 'Se guarda el mismo total': '', Motivo: o.motivo,
  })),
];

/** RESPALDO: cómo estaban (sin desglose) y qué se escribe; para deshacer, quitar lo escrito. */
export const respaldoCompletar = (plan: readonly PlanDoc[], cuando: string, quien: string): Datos => ({
  tipo: 'respaldo-completar-importes', generado: cuando, por: quien,
  nota: 'Para deshacer: en cada factura, regresar operacionesGuardadas a "antes" (si dice "sin importes", quitarlo) y quitar importesCompletados; si "fijoTotal" es true, quitar también subtotalMonedaFactura (antes no lo tenía). El total no cambió.',
  facturas: plan.map((p) => ({
    id: p.id, invoice: p.invoice, cliente: p.cliente, total: p.total, fijoTotal: p.fijarTotal,
    antes: { operacionesGuardadas: p.reemplaza ? p.antes : 'sin importes', subtotalMonedaFactura: p.fijarTotal ? null : p.total, operacionesIds: p.ids },
    despues: { operacionesGuardadas: p.renglones, ...(p.fijarTotal ? { subtotalMonedaFactura: p.total } : {}) },
  })),
});

/** Lee las operaciones de las facturas por partes (para la prueba), avisando cuántas lleva. */
export const leerOperacionesDe = async (ids: readonly string[], alAvanzar: (hechas: number, total: number) => void): Promise<Map<string, Datos | null>> => {
  const PARTE = 300;
  const mapa = new Map<string, Datos | null>();
  alAvanzar(0, ids.length);
  for (let i = 0; i < ids.length; i += PARTE) {
    const parte = ids.slice(i, i + PARTE);
    const docs = await porIds('operaciones', parte);
    parte.forEach((id) => mapa.set(id, null));
    docs.forEach((d) => mapa.set(idReal(d), d));
    alAvanzar(Math.min(i + PARTE, ids.length), ids.length);
  }
  return mapa;
};

/** Facturas por transacción (cada una: leer la factura y sus operaciones, escribir la factura). */
const TANDA = 20;

export interface ResultadoCompletar {
  /** id de la factura → lo que se escribió (para mostrarlo sin volver a leer). */
  completadas: Map<string, Datos>;
  omitidas: OmitidaCompletar[];
  error: string;
}

/** Completa las facturas del plan (el congelado de la prueba). Lo que cambió desde la prueba no se toca. */
export const completarImportes = async (plan: readonly PlanDoc[], ahoraISO: string, usuario: string, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoCompletar> => {
  const total = plan.length;
  const completadas = new Map<string, Datos>();
  const omitidas: OmitidaCompletar[] = [];
  let error = '';
  alAvanzar(0, total);
  for (let i = 0; i < total && !error; i += TANDA) {
    const tanda = plan.slice(i, i + TANDA);
    const r = await runTransaction(db, async (tx) => {
      const fuera: OmitidaCompletar[] = [];
      const hechas: [string, Datos][] = [];
      const refsFac = tanda.map((p) => doc(db, 'facturas_clientes', p.id));
      const snapsFac = await Promise.all(refsFac.map((ref) => tx.get(ref)));
      const idsOps = Array.from(new Set(tanda.flatMap((p) => p.ids)));
      const snapsOps = await Promise.all(idsOps.map((id) => tx.get(doc(db, 'operaciones', id))));
      const ops = new Map<string, Datos | null>(idsOps.map((id, k) => [id, snapsOps[k].exists() ? (snapsOps[k].data() as Datos) : null]));
      tanda.forEach((p, k) => {
        const omitir = (motivo: string) => fuera.push({ id: p.id, invoice: p.invoice, cliente: p.cliente, fecha: p.fecha, motivo });
        if (!snapsFac[k].exists()) { omitir('La factura ya no existe'); return; }
        const datos = normalizarFacturaDe(snapsFac[k].data() as Datos, 'cliente');
        const nuevo = planDeDoc({ id: p.id, invoice: p.invoice, cliente: p.cliente, fecha: p.fecha, moneda: p.moneda, datos }, ops);
        if ('motivo' in nuevo) { omitir(`${nuevo.motivo} (cambió desde la prueba)`); return; }
        const iguales = nuevo.ids.join('|') === p.ids.join('|') && aCentavos(nuevo.total) === aCentavos(p.total) && nuevo.fijarTotal === p.fijarTotal && nuevo.reemplaza === p.reemplaza
          && importesDeRenglones(p.moneda, nuevo.renglones).join('|') === importesDeRenglones(p.moneda, p.renglones).join('|');
        if (!iguales) { omitir('Cambió desde la prueba (su total, sus operaciones o lo que cobran): vuelve a revisarla'); return; }
        const escribir = datosCompletar(p, ahoraISO, usuario);
        tx.update(refsFac[k], escribir);
        hechas.push([p.id, escribir]);
      });
      return { fuera, hechas };
    }).catch((e: unknown) => {
      console.error('[Facturación] No se pudo completar una tanda de facturas:', e);
      error = String((e as { message?: string })?.message || e);
      return null;
    });
    if (!r) break;
    r.hechas.forEach(([id, d]) => completadas.set(id, d));
    omitidas.push(...r.fuera);
    alAvanzar(Math.min(i + TANDA, total), total);
  }
  if (completadas.size > 0) {
    await registrarLog('Facturación Clientes', 'Edición',
      `Completar importes: ${completadas.size} factura(s) recibieron (o pusieron al día) su desglose por operación con el total de hoy de cada una; ningún total cambió (${ahoraISO}). ${omitidas.length} no se completaron porque cambiaron desde la prueba.${error ? ` Se detuvo por un error: ${error}` : ''}`);
  }
  return { completadas, omitidas, error };
};

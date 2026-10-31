// src/features/facturacion/services/actualizarFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00528 — "Actualizar factura": la factura de cliente toma el total de HOY de cada una de sus operaciones.
// Es la MISMA regla para el Actualizar de Editar factura (V00520 · V00525 · V00527) y para el botón
// "Actualizar factura" de la Ficha (sin entrar a Editar factura):
//   · si la factura guardó lo que cobró cada operación y alguna cambió → sincronizarFacturaConOperaciones
//     (UNA transacción que relee la factura y sus operaciones; el total sigue ModoSincronizar);
//   · si no lo guardó (las de AppSheet) → completarImportes: lo que cobra hoy cada una, SIN cambiar el total.
// No con dineroPorServidor ni con folios en varios registros (sincronizar). Solo Clientes.
// ---------------------------------------------------------------------------
import { avisar } from '../../../shared/data/avisos';
import { registrarLog } from '../../../utils/logger';
import { fechaFacturaISO } from '../selectores';
import { completarImportes, planCompletarImportes } from './completarImportes';
import type { DocSinImportes, PlanCompletar } from './completarImportes';
import { opsDeFactura } from './diferenciaEnCargos';
import { normalizarFacturaDe } from './normalizarFactura';
import { diferenciasConServidor, opsDesfasadas, planSincronizarFactura, renglonesConImporte, sincronizarFacturaConOperaciones } from './sincronizarFactura';
import type { OpDesfasada, PlanSincronizar } from './sincronizarFactura';

type Datos = Record<string, unknown>;
type Moneda = 'USD' | 'MXN';

/** ✅ V00525: con una factura sin importes, Actualizar guarda lo que cobra hoy cada operación (suma vs. total, que no cambia), o por qué no puede. */
export type CompletarEdicion = { suma: number; total: number; cuadra: boolean } | { motivo: string };

export interface PlanActualizarFactura {
  /** Las operaciones cuyo total de hoy no es el que guardó la factura. */
  desfasadas: OpDesfasada[];
  /** Cómo queda la factura al ponerla al día (null = al día o no se puede). */
  sincronizar: PlanSincronizar | null;
  /** Por qué no se puede poner al día ('' = se puede). */
  impedimento: string;
  /** La factura no guardó lo que cobró cada operación (no se puede saber si cambió). */
  sinImportes: boolean;
  /** Qué se completa en una factura sin importes (null = nada o no se puede). */
  completar: PlanCompletar | null;
  /** Lo que se le dice al usuario de esa factura sin importes (null = nada / todavía leyendo). */
  resumenCompletar: CompletarEdicion | null;
}

const VACIO: Omit<PlanActualizarFactura, 'sinImportes'> = { desfasadas: [], sincronizar: null, impedimento: '', completar: null, resumenCompletar: null };

interface Opciones {
  /** La moneda GUARDADA en la factura (monedaDeFactura): con la que la transacción la pone al día. */
  moneda: Moneda | null;
  /** La moneda con la que se ve (la del cliente si la factura no trae). */
  monedaVista: Moneda | null;
  /** La moneda con la que se ve cada documento del folio. */
  monedaDoc: (d: Datos) => Moneda | null;
  /** Las operaciones todavía se están leyendo: no se decide nada. */
  cargando: boolean;
  dineroPorServidor: boolean;
}

/** Los ids de los documentos de la fila (un folio puede estar en varios registros). */
export const idsDocsFactura = (fila: Datos): string[] =>
  (Array.isArray(fila.__groupIds) && fila.__groupIds.length ? fila.__groupIds : [fila.id]).map((x) => String(x ?? '')).filter(Boolean);

/** Qué hace "Actualizar" con esta factura y sus operaciones de hoy (id → datos). No escribe nada. */
export const planActualizarFactura = (fila: Datos, actuales: ReadonlyMap<string, Datos>, o: Opciones): PlanActualizarFactura => {
  const sinImportes = !!o.monedaVista && renglonesConImporte(fila, o.monedaVista).length === 0;
  if (o.cargando) return { ...VACIO, sinImportes };
  const lista = Array.from(actuales, ([id, datos]) => ({ id, datos }));
  const monedaComparar = o.moneda ?? o.monedaVista;
  const desfasadas = monedaComparar ? opsDesfasadas(fila, lista, monedaComparar) : [];
  let sincronizar: PlanSincronizar | null = null;
  let impedimento = '';
  if (desfasadas.length > 0 && monedaComparar) {
    if (o.dineroPorServidor) impedimento = 'Con el dinero en el servidor encendido, la factura no se pone al día desde aquí: usa Recalcular montos en Pagos.';
    else if (idsDocsFactura(fila).length > 1) impedimento = 'Esta factura está en varios registros con el mismo folio: no se pone al día desde aquí.';
    else if (!o.moneda) impedimento = 'La factura no tiene su moneda guardada: no se puede poner al día con sus operaciones.';
    try { sincronizar = planSincronizarFactura(fila, lista, monedaComparar, '', ''); } catch (e) { impedimento = impedimento || (e instanceof Error ? e.message : String(e)); }
  }
  let completar: PlanCompletar | null = null;
  let resumenCompletar: CompletarEdicion | null = null;
  if (sinImportes && o.monedaVista) {
    if (o.dineroPorServidor) resumenCompletar = { motivo: 'con el dinero en el servidor encendido (dineroPorServidor) no se guarda desde aquí' };
    else {
      const docs = (Array.isArray(fila.__groupDocs) && fila.__groupDocs.length ? fila.__groupDocs : [fila]) as Datos[];
      const monedaVista = o.monedaVista;
      const plan = planCompletarImportes(docs.map((d): DocSinImportes => ({
        id: String(d.id ?? ''), invoice: String(d.invoice || fila.invoice || ''), cliente: '', fecha: fechaFacturaISO(d.fecha) || '',
        moneda: o.monedaDoc(d) ?? monedaVista, datos: d,
      })), actuales);
      if (plan.omitidas.length > 0) resumenCompletar = { motivo: plan.omitidas[0].motivo };
      else if (plan.completar.length > 0) {
        completar = plan;
        const suma = plan.completar.reduce((s, p) => s + Math.round(p.suma * 100), 0) / 100;
        const total = plan.completar.reduce((s, p) => s + Math.round(p.total * 100), 0) / 100;
        resumenCompletar = { suma, total, cuadra: Math.round(suma * 100) === Math.round(total * 100) };
      }
    }
  }
  return { desfasadas, sincronizar, impedimento, sinImportes, completar, resumenCompletar };
};

/** Hay algo que guardar al presionar Actualizar. */
export const hayQueActualizar = (p: PlanActualizarFactura): boolean => (!!p.sincronizar && !p.impedimento) || !!p.completar;

export interface ResultadoActualizar {
  /** id del documento → lo que se escribió o (✅ V00529) la factura COMPLETA como está en el servidor, para que la
   *  pantalla muestre lo que hay de verdad (también cuando no se escribió nada). */
  escritos: Map<string, Datos>;
  /** ✅ V00529: sus operaciones como están en el servidor (para el "→ hoy" de la Ficha). */
  opsServidor: { id: string; datos: Datos }[];
  /** ✅ V00529: se esperaba cambiar algo y en el servidor no había nada que cambiar: por qué (una por operación). */
  diferencias: string[];
  /** Cómo quedó (null = no se puso al día con sus operaciones: ya estaba o no tocaba). */
  sincronizado: PlanSincronizar | null;
  /** Las que no se completaron (cambiaron desde que se abrió), "folio: motivo". */
  omitidas: string[];
  /** Completar se detuvo por un error ('' = no). Lo anterior ya quedó escrito. */
  errorCompletar: string;
}

/**
 * Escribe el plan: la factura relee sus operaciones dentro de la transacción (si algo cambió desde que se
 * abrió, se usa lo de ese momento) y queda en la bitácora. `invoice` es el folio para la bitácora.
 */
export const aplicarActualizarFactura = async (fila: Datos, plan: PlanActualizarFactura, invoice: string, usuario: string): Promise<ResultadoActualizar> => {
  const ahora = new Date().toISOString();
  const escritos = new Map<string, Datos>();
  let sincronizado: PlanSincronizar | null = null;
  let opsServidor: { id: string; datos: Datos }[] = [];
  let diferencias: string[] = [];
  const ids = idsDocsFactura(fila);
  if (plan.sincronizar && !plan.impedimento && ids[0]) {
    // ✅ V00529: las operaciones que ya conoce la pantalla se leen junto con la factura (la moneda no cambia los ids).
    const r = await sincronizarFacturaConOperaciones(ids[0], ahora, usuario, opsDeFactura(fila, 'USD').map((o) => o.opId));
    sincronizado = r.plan;
    opsServidor = r.ops;
    // ✅ V00529: la pantalla toma la factura del servidor (normalizada como la lista), se haya escrito o no.
    escritos.set(ids[0], normalizarFacturaDe({ ...r.factura, id: ids[0] }, 'cliente'));
    if (!sincronizado) diferencias = diferenciasConServidor(plan.sincronizar.desfasadas, r);
    if (sincronizado) {
      void registrarLog('Facturación Clientes', 'Edición', `Factura ${invoice} al día con sus operaciones (${sincronizado.desfasadas.map((d) => `${d.ref} ${d.antes.toFixed(2)} → ${d.ahora.toFixed(2)}`).join(', ')}): total ${sincronizado.totalAntes.toFixed(2)} → ${sincronizado.totalDespues.toFixed(2)}.`);
    }
  }
  let omitidas: string[] = [];
  let errorCompletar = '';
  if (plan.completar) {
    const r = await completarImportes(plan.completar.completar, ahora, usuario, () => undefined);
    r.completadas.forEach((c, id) => escritos.set(id, { ...(escritos.get(id) ?? {}), ...c }));
    omitidas = r.omitidas.map((x) => `${x.invoice}: ${x.motivo}`);
    errorCompletar = r.error;
  }
  return { escritos, sincronizado, opsServidor, diferencias, omitidas, errorCompletar };
};

/**
 * ✅ V00540: los avisos de lo que hizo Actualizar (antes solo en el tablero de Facturación; ahora también al
 * actualizar desde Editar factura encima de la Revisión de datos). `alFinal` se agrega al segundo aviso.
 */
export const avisarResultadoActualizar = (r: ResultadoActualizar, alFinal = ''): void => {
  if (r.omitidas.length > 0) avisar({ tipo: 'alerta', titulo: 'No se guardó lo que cobra cada operación', texto: r.omitidas.join('; ') });
  // ✅ V00529: se esperaba cambiar algo y en el servidor no había nada que cambiar: se dice por qué, con sus números.
  if (!r.sincronizado && r.diferencias.length > 0) {
    avisar({ tipo: 'alerta', titulo: 'No se cambió nada en la factura', texto: `En el servidor no había nada que poner al día. ${r.diferencias.join('; ')}.${alFinal}` });
  }
};

const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Qué pasa con el total al presionar "Actualizar factura" (el botón de la Ficha), en una frase. '' = nada que decir. */
export const textoActualizar = (p: PlanActualizarFactura, moneda: string): string => {
  if (p.impedimento) return p.impedimento;
  if (p.sincronizar) {
    const s = p.sincronizar;
    if (s.modo === 'diferencia') return `Actualizar factura toma el total de hoy de cada operación: el total pasa de ${dinero(s.totalAntes)} a ${dinero(s.totalDespues)} ${moneda}.`;
    if (s.modo === 'yaIncluido') return `Actualizar factura guarda el total de hoy de cada operación; el total de la factura (${dinero(s.totalAntes)} ${moneda}) no cambia: ya lo incluía.`;
    return `Actualizar factura guarda el total de hoy de cada operación; el total de la factura (${dinero(s.totalAntes)} ${moneda}) no cambia: no cuadraba con sus operaciones y seguirá en Corregir con la diferencia.`;
  }
  const c = p.resumenCompletar;
  if (c && 'motivo' in c) return `No se puede guardar desde aquí: ${c.motivo}.`;
  if (c) return `Actualizar factura guarda lo que cobra hoy cada operación (suman ${dinero(c.suma)} ${moneda}); el total (${dinero(c.total)} ${moneda}) no cambia.${c.cuadra ? '' : ' No cuadra con el total: seguirá en Corregir con la diferencia.'}`;
  return '';
};

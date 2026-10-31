// src/features/operaciones/services/marcarFacturadasF1.ts
// ---------------------------------------------------------------------------
// ✅ V00510 — CORRECCIÓN F1 de la Revisión de datos: "Marcar facturadas". A cada operación que ya
// está en la lista de una factura activa (Facturado, No Aplica / N/A…) pero no tiene Invoice ni la
// marca de facturada, se le escribe lo MISMO que escribe Facturación al facturar:
//   facturaClienteId (id real de la factura) · facturaClienteInvoice (su folio) · facturado: true
// y `facturadoPorRevision` (fecha y hora) para saber cuáles se marcaron aquí (y poder deshacerlo).
// No cambia montos, facturas ni pagos.
// Reglas de la escritura masiva (pedidas por el usuario): PRUEBA (Excel de lo que cambiaría) →
// RESPALDO (archivo con lo que tenía cada operación) → AUTORIZACIÓN escrita ("APLICAR") → aplicar.
// Al aplicar, cada tanda va en TRANSACCIÓN y relee la operación y su factura: si la operación ya
// tiene factura o marca, se canceló, o la factura ya no existe / se canceló / ya no la lista, no se toca.
// No se marcan solas: las canceladas y las que listan dos o más facturas activas (se revisan a mano).
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import type { DocumentReference, DocumentSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { estadoGrupoDe, facturadaCliente } from '../../../shared/dominio/operacionCanonica';
import { registrarLog } from '../../../utils/logger';
import { estaCancelada } from '../../facturacion/services/reglasFactura';
import type { CeldaExcel } from './excelOperaciones';
import type { MarcaF1 } from './revisionDatos';
import { notificarOperacionesGuardadas } from '../../../utils/operacionesBus'; // ✅ V00536

type Datos = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const TEXTO_AUTORIZACION = 'APLICAR';
/** Operaciones por transacción (cada una: leer operación + factura y escribir la operación). */
const TANDA = 100;

export interface OmitidaF1 { marca: MarcaF1; motivo: string }
export interface PlanF1 { marcar: MarcaF1[]; omitidas: OmitidaF1[] }

export const MOTIVO_CANCELADA = 'La operación está cancelada: revisarla a mano';
export const MOTIVO_VARIAS = 'La listan dos o más facturas: revisarla a mano';

/** Qué se marca y qué no (y por qué). */
export const planMarcarF1 = (marcas: readonly MarcaF1[]): PlanF1 => {
  const marcar: MarcaF1[] = [];
  const omitidas: OmitidaF1[] = [];
  marcas.forEach((m) => {
    if (m.grupo === 'cancelada') omitidas.push({ marca: m, motivo: MOTIVO_CANCELADA });
    else if (m.facturas > 1) omitidas.push({ marca: m, motivo: MOTIVO_VARIAS });
    else marcar.push(m);
  });
  return { marcar, omitidas };
};

/** Campos que se escriben en la operación. */
export const camposMarca = (m: MarcaF1, cuando: string): Datos => ({
  facturaClienteId: m.facturaId, facturaClienteInvoice: m.invoice, facturado: true, facturadoPorRevision: cuando,
});

/** Excel de PRUEBA: una fila por operación, con lo que se haría. */
export const filasPruebaF1 = (plan: PlanF1): Record<string, CeldaExcel>[] => [
  ...plan.marcar.map((m) => ({ 'Acción': 'Se marca', Referencia: m.ref, Cliente: m.cliente, Status: m.status, Factura: m.invoice, 'Status factura': m.statusFactura, 'Fecha factura': m.fechaFactura, 'Se escribe': `facturado: sí · Invoice: ${m.invoice || '(vacío)'}`, Motivo: '' })),
  ...plan.omitidas.map(({ marca: m, motivo }) => ({ 'Acción': 'No se marca', Referencia: m.ref, Cliente: m.cliente, Status: m.status, Factura: m.invoice, 'Status factura': m.statusFactura, 'Fecha factura': m.fechaFactura, 'Se escribe': '', Motivo: motivo })),
];

/** RESPALDO: lo que cada operación tenía antes (las que se marcan no tienen factura ni marca). */
export const respaldoF1 = (plan: PlanF1, cuando: string, quien: string): Datos => ({
  tipo: 'respaldo-marcar-facturadas-F1', generado: cuando, por: quien,
  nota: 'Para deshacer: en cada operación, facturaClienteId y facturaClienteInvoice vacíos y facturado en false (o los valores de "antes"). Las marcadas llevan facturadoPorRevision.',
  operaciones: plan.marcar.map((m) => ({
    id: m.opId, ref: m.ref, cliente: m.cliente,
    antes: { facturaClienteId: null, facturaClienteInvoice: null, facturado: false },
    despues: { facturaClienteId: m.facturaId, facturaClienteInvoice: m.invoice, facturado: true },
  })),
});

/** ¿La factura (como está ahora) sigue listando la operación? Por id, id de AppSheet o referencia. */
export const facturaListaOperacion = (f: Datos, m: MarcaF1): boolean => {
  const ids = new Set([m.opId, m.opAppId].filter(Boolean));
  const ref = m.ref.toUpperCase();
  const renglones = lista(f.operacionesGuardadas).filter((r): r is Datos => !!r && typeof r === 'object');
  return lista(f.operacionesIds).some((x) => ids.has(txt(x)))
    || lista(f.operaciones).some((x) => txt(x).toUpperCase() === ref || ids.has(txt(x)))
    || renglones.some((r) => ids.has(txt(r.id)) || txt(r.ref).toUpperCase() === ref);
};

/** Motivo por el que ya no se marca al escribir ('' = se marca). */
export const motivoAlMarcar = (op: Datos | null, factura: Datos | null, m: MarcaF1): string => {
  if (!op) return 'La operación ya no existe';
  if (facturadaCliente(op)) return 'Ya tiene factura o marca (se marcó mientras tanto)';
  if (estadoGrupoDe({ status: op.status, statusNombre: op.statusNombre }) === 'cancelada') return MOTIVO_CANCELADA;
  if (!factura) return 'Su factura ya no existe';
  if (estaCancelada(txt(factura.statusFactura) || 'Facturado')) return 'Su factura se canceló';
  if (!facturaListaOperacion(factura, m)) return 'Su factura ya no la lista';
  return '';
};

export interface ResultadoF1 {
  marcadas: number;
  /** ✅ V00512: ids de las operaciones que sí se marcaron (para quitarlas de la revisión sin volver a leer). */
  marcadasIds: string[];
  omitidas: OmitidaF1[];
  /** Si una tanda falló (conexión, permiso): lo de las tandas anteriores ya quedó; las demás no se escribieron. */
  error: string;
}

/** Aplica el plan en tandas (transacción por tanda). `alAvanzar(hechas, total)`. */
export const aplicarMarcasF1 = async (plan: PlanF1, cuando: string, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoF1> => {
  const total = plan.marcar.length;
  const omitidas: OmitidaF1[] = [];
  const marcadasIds: string[] = [];
  let marcadas = 0;
  let error = '';
  alAvanzar(0, total);
  for (let i = 0; i < total && !error; i += TANDA) {
    const tanda = plan.marcar.slice(i, i + TANDA);
    const r = await runTransaction(db, async (tx) => {
      const refsOps = tanda.map((m) => doc(db, 'operaciones', m.opId));
      const idsFac = Array.from(new Set(tanda.map((m) => m.facturaId)));
      const refsFac = new Map<string, DocumentReference>(idsFac.map((id) => [id, doc(db, 'facturas_clientes', id)]));
      const [sOps, sFac] = await Promise.all([
        Promise.all(refsOps.map((ref) => tx.get(ref))),
        Promise.all(idsFac.map((id) => tx.get(refsFac.get(id) as DocumentReference))),
      ]);
      const facPorId = new Map<string, DocumentSnapshot>(idsFac.map((id, k) => [id, sFac[k]]));
      const fuera: OmitidaF1[] = [];
      const ids: string[] = [];
      const escritos: (readonly [string, Datos])[] = []; // ✅ V00536: aviso al bus
      tanda.forEach((m, k) => {
        const so = sOps[k];
        const sf = facPorId.get(m.facturaId);
        const motivo = motivoAlMarcar(so.exists() ? (so.data() as Datos) : null, sf?.exists() ? (sf.data() as Datos) : null, m);
        if (motivo) { fuera.push({ marca: m, motivo }); return; }
        const campos = camposMarca(m, cuando);
        tx.update(refsOps[k], campos);
        ids.push(m.opId);
        escritos.push([m.opId, campos]);
      });
      return { fuera, ids, escritos };
    }).catch((e: unknown) => {
      console.error('[F1] No se pudo escribir una tanda de operaciones:', e);
      error = String((e as { message?: string })?.message || e);
      return null;
    });
    if (!r) break;
    marcadas += r.ids.length;
    notificarOperacionesGuardadas(r.escritos, 'revision-f1'); // ✅ V00536
    marcadasIds.push(...r.ids);
    omitidas.push(...r.fuera);
    alAvanzar(Math.min(i + TANDA, total), total);
  }
  if (marcadas > 0) {
    await registrarLog('Operaciones', 'Edición',
      `Revisión de datos (F1): marcó ${marcadas} operación(es) como facturadas con la factura que las lista (facturadoPorRevision = ${cuando}). ${plan.omitidas.length + omitidas.length} no se marcaron (${plan.omitidas.length} para revisar a mano, ${omitidas.length} cambiaron desde la revisión).${error ? ` Se detuvo por un error: ${error}` : ''}`);
  }
  return { marcadas, marcadasIds, omitidas, error };
};

/** Descarga un objeto como archivo .json (el respaldo). */
export const descargarJSON = (datos: unknown, archivo: string): void => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

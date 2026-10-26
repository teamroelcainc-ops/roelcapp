/**
 * ✅ V00496 — Regla pura del script `facturas:texto` (facturasTexto.ts).
 * ------------------------------------------------------------------------------
 * Las facturas importadas de AppSheet guardan sus operaciones como TEXTO
 * ("id1, id2") y esas operaciones no tienen la marca de facturada. Por eso
 * "Pendientes" depende de que la lista de facturas esté completa, la revisión
 * anti-duplicados del servidor (`array-contains`) no las encuentra y el
 * formulario no las protege (montosCongelados mira la marca).
 *
 * Por factura en texto:   operacionesIds → arreglo con los mismos ids.
 *   Se deja para revisar (no se reescribe salvo --incluir-con-saldo) si el
 *   trigger de la factura, al reescribirla, le cambiaría el saldo o el status.
 * Por operación de esas facturas, si no tiene marca (o apunta a una factura que
 * ya no existe): se marca con la factura no cancelada que la contiene
 * (facturaClienteId + facturaClienteInvoice + facturado, o los de proveedor).
 *   · Solo en facturas canceladas → no se marca (se reporta).
 *   · En varias facturas no canceladas → se marca con la primera y se reporta
 *     (posible duplicado: revisar).
 *   · Ya marcada con una factura que existe → no se toca.
 * ------------------------------------------------------------------------------
 */
import { cambiosSaldoLegado, derivadosFactura } from '../src/dominio/dinero.js';
import { LADOS, lista } from '../src/dominio/facturacion.js';
import type { Lado } from '../src/dominio/dinero.js';
import { normalizarTexto } from '../src/dominio/texto.js';

type Datos = Record<string, unknown>;
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export interface FacturaLeida { id: string; datos: Datos }
/** Operación encontrada para un id de la lista (por id del documento o por su campo `id`). */
export interface OperacionLeida { docId: string; datos: Datos }

export const enTexto = (f: Datos): boolean => typeof f.operacionesIds === 'string';
const cancelada = (f: Datos): boolean => normalizarTexto(f.statusFactura).startsWith('cancel');

/**
 * Lo que el trigger de la factura le cambiaría al reescribirla y se VE (vacío = nada). Sin la bandera:
 * saldo y status (cambiosSaldoLegado). Con `dineroPorServidor`: saldo, status y `abierta` cuando pasa a
 * abierta (aparecería en Pagos como deuda) o deja de estarlo. Los agregados en centavos que faltan en las
 * importadas no cuentan (solo se completan: no cambian lo que se ve).
 */
export const efectoEnSaldo = (factura: Datos, dineroPorServidor: boolean): Datos => {
  if (!dineroPorServidor) return cambiosSaldoLegado(factura);
  const c = derivadosFactura(factura);
  const visible: Datos = {};
  if ('saldoPendiente' in c) visible.saldoPendiente = c.saldoPendiente;
  if ('statusPago' in c) visible.statusPago = c.statusPago;
  if ('abierta' in c && (c.abierta === true || factura.abierta === true)) visible.abierta = c.abierta;
  return visible;
};

export interface FacturaPlan {
  id: string; invoice: string; ids: string[];
  accion: 'convertir' | 'revisar' | 'vacia';
  motivo: string;
}
export interface OperacionPlan {
  idLista: string; docId: string; ref: string;
  accion: 'marcar' | 'yaMarcada' | 'soloCanceladas' | 'noExiste';
  facturaId: string; folio: string; motivo: string;
  campos: Datos | null;
}
export interface PlanTexto { facturas: FacturaPlan[]; operaciones: OperacionPlan[] }

/**
 * @param facturas TODAS las facturas del lado (en texto y en arreglo: una operación puede estar en ambas).
 * @param operaciones id de la lista → operación (null = no existe).
 */
export const planFacturasTexto = (
  lado: Lado, facturas: readonly FacturaLeida[], operaciones: ReadonlyMap<string, OperacionLeida | null>,
  o: { dineroPorServidor: boolean; incluirConSaldo: boolean; soloEstas?: ReadonlySet<string> },
): PlanTexto => {
  // --limite: solo se procesan `soloEstas`; TODAS siguen contando para saber si existe una factura y
  // dónde está cada operación.
  const procesar = (f: FacturaLeida): boolean => enTexto(f.datos) && (!o.soloEstas || o.soloEstas.has(f.id));
  const c = LADOS[lado];
  const existe = new Set(facturas.map((f) => f.id));
  const contienen = new Map<string, FacturaLeida[]>();
  facturas.forEach((f) => lista(f.datos.operacionesIds).forEach((x) => contienen.set(x, [...(contienen.get(x) ?? []), f])));

  const planF: FacturaPlan[] = [];
  const porRevisar = new Set<string>();
  for (const f of facturas) {
    if (!procesar(f)) continue;
    const ids = lista(f.datos.operacionesIds);
    const base = { id: f.id, invoice: txt(f.datos.invoice) || f.id, ids };
    if (ids.length === 0) { planF.push({ ...base, accion: 'vacia', motivo: 'texto sin ids: no se toca' }); continue; }
    const efecto = efectoEnSaldo({ ...f.datos, operacionesIds: ids }, o.dineroPorServidor);
    if (Object.keys(efecto).length > 0 && !o.incluirConSaldo) {
      porRevisar.add(f.id);
      planF.push({ ...base, accion: 'revisar', motivo: `al reescribirla, el servidor le cambiaría ${JSON.stringify(efecto)} (actual: saldo ${txt(f.datos.saldoPendiente) || '—'}, status ${txt(f.datos.statusPago) || '—'}); se convierte con --incluir-con-saldo` });
      continue;
    }
    planF.push({ ...base, accion: 'convertir', motivo: Object.keys(efecto).length ? `también cambia ${JSON.stringify(efecto)} (--incluir-con-saldo)` : '' });
  }

  const planO: OperacionPlan[] = [];
  const vistas = new Set<string>();
  for (const f of facturas) {
    if (!procesar(f)) continue;
    for (const idLista of lista(f.datos.operacionesIds)) {
      const op = operaciones.get(idLista) ?? null;
      const clave = op ? op.docId : `?${idLista}`;
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      const vacio = { idLista, docId: op?.docId ?? '', ref: txt(op?.datos.ref), facturaId: '', folio: '', campos: null };
      if (!op) { planO.push({ ...vacio, accion: 'noExiste', motivo: 'no hay operación con ese id' }); continue; }
      const marca = txt(op.datos[c.opFacturaId]);
      if (marca && existe.has(marca)) { planO.push({ ...vacio, accion: 'yaMarcada', facturaId: marca, folio: txt(op.datos[c.opFolio]), motivo: '' }); continue; }
      const todas = [...new Set([...(contienen.get(idLista) ?? []), ...(contienen.get(op.docId) ?? [])])];
      const vivas = todas.filter((x) => !cancelada(x.datos));
      const elegida = vivas[0];
      if (!elegida) { planO.push({ ...vacio, accion: 'soloCanceladas', motivo: 'solo está en facturas canceladas: no se marca' }); continue; }
      const folio = txt(elegida.datos.invoice);
      const motivos = [
        marca ? `apuntaba a ${marca}, que ya no existe` : '',
        vivas.length > 1 ? `REVISAR: está en ${vivas.length} facturas no canceladas (${vivas.map((x) => txt(x.datos.invoice) || x.id).join(', ')})` : '',
        porRevisar.has(elegida.id) ? 'su factura queda en texto (revisar saldo)' : '',
      ].filter(Boolean).join(' · ');
      planO.push({ ...vacio, accion: 'marcar', facturaId: elegida.id, folio, motivo: motivos, campos: { [c.opFacturaId]: elegida.id, [c.opFolio]: folio, [c.opFacturado]: true } });
    }
  }
  return { facturas: planF, operaciones: planO };
};

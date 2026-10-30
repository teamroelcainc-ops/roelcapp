// src/features/facturacion/services/subtotalManual.ts
// ---------------------------------------------------------------------------
// ✅ V00533 — EL SUBTOTAL DE LA FACTURA SE CAPTURA A MANO en Editar factura (Clientes). Pedido de Roelca
// (A5506 → E48, 30-oct): "que se pueda editar el subtotal, pero que alerte si coincide con el subtotal
// de la factura. El subtotal, no el total". La factura guardó 481.40 (el TOTAL del CFDI, con IVA) y sus
// operaciones suman 415.00 (el SUBTOTAL del CFDI). La app maneja subtotales: el IVA lo lleva el SIT.
//   · avisosSubtotal: lo capturado contra el SUBTOTAL del documento (PDF o XML) y contra la suma de hoy
//     de sus operaciones. Solo AVISA: no impide guardar.
//   · planSubtotalManual / guardarSubtotalManual: el subtotal nuevo en UNA transacción que relee la
//     factura (lo pagado de ese momento): no por debajo de lo pagado; la conversión a pesos se ajusta en
//     proporción; queda como capturado a mano (totalManualCentavos) para que el servidor no lo regrese.
// Revierte, solo para Clientes y a pedido, el candado de la V00519 ("el monto sale de las operaciones").
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { ErrorDinero, monedaDeFactura, montoPagadoDe, totalNativoFacturaLegado } from '../../../shared/dominio/dinero';
import { avisoTotalBajoPagado } from '../../../shared/dominio/facturacion';
import { aCentavos, r2 } from '../../../shared/dominio/numeros';
import type { DocumentoFactura, LecturaDocumento } from './leerFacturaPdf';

type Datos = Record<string, unknown>;
type Moneda = 'USD' | 'MXN';

const num = (v: unknown): number => Number(v ?? 0) || 0;
const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mismo = (a: number, b: number): boolean => Math.abs(aCentavos(a) - aCentavos(b)) === 0;

/** Lo que se leyó de un documento de la factura (su nombre y la lectura). */
export interface LecturaNombrada { nombre: string; lectura: LecturaDocumento }

/** El documento con el que se compara: el primero con subtotal, el XML antes que el PDF. */
export const documentoParaSubtotal = (lecturas: readonly LecturaNombrada[]): { nombre: string; doc: DocumentoFactura } | null => {
  const con = lecturas.flatMap((l) => (l.lectura.ok && l.lectura.doc.subtotal !== null ? [{ nombre: l.nombre, doc: l.lectura.doc }] : []));
  return con.find((x) => x.doc.formato === 'xml') ?? con[0] ?? null;
};

export type NivelAviso = 'ok' | 'aviso' | 'info';
export interface AvisoSubtotal { nivel: NivelAviso; texto: string }

interface DatosAviso {
  /** Lo capturado (texto del campo). */
  valor: string;
  /** Moneda de la factura (la del cliente). */
  moneda: Moneda | null;
  /** El documento con que se compara (null = no hay o no se pudo leer). */
  documento: { nombre: string; doc: DocumentoFactura } | null;
  /** Lo que suman HOY sus operaciones en la moneda de la factura (null = todavía se leen o no hay). */
  sumaOps: number | null;
}

/** Qué se le dice al capturar el subtotal (en orden: el documento y luego sus operaciones). */
export const avisosSubtotal = ({ valor, moneda, documento, sumaOps }: DatosAviso): AvisoSubtotal[] => {
  const n = Number(valor);
  if (valor.trim() === '' || !Number.isFinite(n)) return [{ nivel: 'aviso', texto: 'Escribe el subtotal (sin IVA).' }];
  const mon = moneda ? ` ${moneda}` : '';
  const avisos: AvisoSubtotal[] = [];
  if (documento) {
    const d = documento.doc;
    const sub = d.subtotal ?? 0;
    const otraMoneda = !!d.moneda && !!moneda && d.moneda !== moneda;
    if (otraMoneda) avisos.push({ nivel: 'aviso', texto: `El documento está en ${d.moneda} y la factura en ${moneda}: revisa la moneda.` });
    if (mismo(n, sub)) avisos.push({ nivel: 'ok', texto: `Coincide con el subtotal del documento (${dinero(sub)}${d.moneda ? ` ${d.moneda}` : mon}).` });
    else {
      const esTotal = d.total !== null && mismo(n, d.total) && !mismo(d.total, sub);
      avisos.push({
        nivel: 'aviso',
        texto: esTotal
          ? `No coincide: ${dinero(n)} es el TOTAL del documento (con impuestos). Su subtotal es ${dinero(sub)}${mon}.`
          : `No coincide con el subtotal del documento: el documento dice ${dinero(sub)}${mon} (diferencia ${dinero(r2(n - sub))}).`,
      });
    }
  }
  if (sumaOps !== null && sumaOps > 0 && !mismo(n, sumaOps)) {
    avisos.push({ nivel: 'info', texto: `Sus operaciones suman ${dinero(sumaOps)}${mon}: con este subtotal la factura saldrá en Corregir.` });
  }
  return avisos;
};

/** Qué se escribe en la factura con el subtotal nuevo (con sus datos FRESCOS). Lanza ErrorDinero si no se puede. */
export const planSubtotalManual = (fac: Datos, nuevo: number, ahoraISO: string, usuario: string): Datos => {
  const total = r2(nuevo);
  if (!(total > 0)) throw new ErrorDinero('El subtotal debe ser mayor que $0.00. No se guardó nada.');
  const pagado = montoPagadoDe(fac);
  if (total < pagado - 0.009) throw new ErrorDinero(avisoTotalBajoPagado(total, pagado));
  const antes = r2(totalNativoFacturaLegado(fac));
  const convAntes = num(fac.subtotalFactura);
  // La conversión a pesos sigue al subtotal en la misma proporción; en pesos es el mismo número.
  const conv = monedaDeFactura(fac) === 'MXN' ? total : convAntes > 0 && antes > 0 ? r2((convAntes * total) / antes) : null;
  const saldo = r2(Math.max(0, total - pagado));
  return {
    subtotalMonedaFactura: total,
    ...(conv !== null ? { subtotalFactura: conv } : {}),
    totalManualCentavos: aCentavos(total),
    saldoPendiente: saldo,
    ...(pagado > 0.009 ? { statusPago: saldo <= 0.009 ? 'PAGADA' : 'PARCIAL' } : {}),
    editadoEn: ahoraISO, editadoPor: usuario,
  };
};

/** Relee la factura y escribe el subtotal nuevo en UNA transacción. Devuelve lo escrito. */
export const guardarSubtotalManual = (facturaId: string, nuevo: number, ahoraISO: string, usuario: string): Promise<Datos> =>
  runTransaction(db, async (tx) => {
    const ref = doc(db, 'facturas_clientes', facturaId);
    const s = await tx.get(ref);
    if (!s.exists()) throw new ErrorDinero('La factura ya no existe. No se guardó nada.');
    const datos = planSubtotalManual(s.data() as Datos, nuevo, ahoraISO, usuario);
    tx.set(ref, datos, { merge: true });
    return datos;
  });

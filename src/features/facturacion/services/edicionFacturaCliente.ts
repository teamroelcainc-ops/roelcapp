// src/features/facturacion/services/edicionFacturaCliente.ts
// ---------------------------------------------------------------------------
// ✅ V00540 — Lo puro de "Editar factura" (clientes): sus campos, cómo arrancan y cómo saber si algo cambió.
//   El formulario está en components/EditarFacturaCliente.tsx y lo que escribe en hooks/useEdicionFacturaCliente.ts.
// ---------------------------------------------------------------------------
import { desdeGuardados } from '../../../shared/archivos/adjuntos';
import type { Adjunto } from '../../../shared/archivos/adjuntos';
import type { RespuestaDinero } from './dineroServidor';
import { docsDeFactura } from './documentosFactura';
import type { EscrituraDocs } from './documentosFactura';
import type { ResultadoActualizar } from './actualizarFactura';
import { CANCELACION_VACIA, cancelacionDe } from './reglasFactura';
import type { DatosCancelacion } from './reglasFactura';
import type { EscrituraCancelacion } from './statusFacturaDatos';

/** Una fila del Historial de Facturación de Clientes (un folio; puede agrupar varios documentos). */
export type FilaFactura = Record<string, unknown>;

/** Lo que se puede cambiar en Editar factura. */
export interface CamposEdicionFactura {
  invoice: string;
  fecha: string;
  ccp: string;
  status: string;
  cancelacion: DatosCancelacion;
  clienteId: string;
  /** El subtotal (sin IVA) en la moneda del cliente, como texto del campo. */
  total: string;
  adjuntos: Adjunto[];
}

/** ✅ V00520: lo que se puede cambiar, en una sola cadena (para saber si algo cambió desde que se abrió). */
export const claveEdicion = (e: CamposEdicionFactura): string =>
  JSON.stringify([e.invoice.trim(), e.fecha, e.ccp.trim(), e.status, e.cancelacion.nota, e.cancelacion.reemplazo, e.clienteId, e.total,
    e.adjuntos.map((a) => (a.estado === 'nuevo' ? `n:${a.clave}` : `g:${a.archivo.url}`))]);

/** Cómo arranca el formulario. `total` es el subtotal sugerido (totalEditPara del que abre). */
export const camposIniciales = (f: FilaFactura, total: number): CamposEdicionFactura => {
  const cancelada = cancelacionDe(f); // ✅ V00481
  return {
    invoice: String(f.invoice || ''),
    fecha: String(f.fecha || '').slice(0, 10),
    ccp: String(f.facturaCcp || ''),
    status: String(f.statusFactura || 'Facturado'),
    cancelacion: cancelada ? { nota: cancelada.nota, reemplazo: cancelada.reemplazo } : CANCELACION_VACIA,
    clienteId: String(f.clienteId || ''),
    total: String(total),
    adjuntos: desdeGuardados(docsDeFactura(f)), // ✅ V00451: los documentos actuales (de todo el grupo)
  };
};

/**
 * Lo que Editar factura acaba de escribir, para que la pantalla que lo abrió (su lista y su ficha) lo vea al
 * instante, sin volver a leer. Quien no tiene lista propia (la Revisión de datos) no lo necesita.
 */
export type EscritoEdicionFactura =
  /** Con dineroPorServidor: las facturas como las dejó la callable `editarFactura`. */
  | { tipo: 'servidor'; ids: string[]; facturas: RespuestaDinero['facturas']; canc: EscrituraCancelacion }
  /** Sin la bandera: los campos que se escribieron en todos los documentos del folio. */
  | { tipo: 'directo'; ids: string[]; campos: Record<string, unknown>; canc: EscrituraCancelacion }
  /** ✅ V00533: el subtotal capturado a mano (en el primer documento). */
  | { tipo: 'subtotal'; id: string; datos: Record<string, unknown> }
  /** ✅ V00451: los documentos de la factura. */
  | { tipo: 'docs'; escrituras: EscrituraDocs[] }
  /** ✅ V00520 · V00525: lo que escribió Actualizar (factura al día con sus operaciones). */
  | { tipo: 'actualizar'; resultado: ResultadoActualizar };

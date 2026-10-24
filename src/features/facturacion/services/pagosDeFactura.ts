// src/features/facturacion/services/pagosDeFactura.ts
// ✅ V00483 — los pagos aplicados a cada factura (de la colección `pagos`, que Facturación ya escucha):
// para la columna # Pago y para la lista de pagos en la ficha de la factura.
import { aFechaISO } from '../../../shared/dominio/fechas';
import { sumarMontos } from '../../../shared/dominio/numeros';

export interface PagoDeFactura {
  /** Id del documento en `pagos`. */
  id: string;
  numeroPago: string;
  fecha: string;
  metodoPago: string;
  referencia: string;
  /** Monto total del pago (puede cubrir varias facturas). */
  monto: number;
  moneda: string;
  /** Lo que el pago aplicó a ESTA factura. */
  aplicado: number;
}

type Datos = Record<string, unknown>;
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** facturaId → pagos aplicados a esa factura (lo aplicado se suma si el pago la trae dos veces). */
export const indexarPagos = (pagos: readonly (Datos & { id: string })[]): Map<string, PagoDeFactura[]> => {
  const mapa = new Map<string, PagoDeFactura[]>();
  pagos.forEach((p) => {
    const facturas = Array.isArray(p.facturas) ? p.facturas : [];
    facturas.forEach((fa) => {
      if (!fa || typeof fa !== 'object') return;
      const fid = texto((fa as Datos).facturaId);
      if (!fid) return;
      const aplicado = Number((fa as Datos).aplicado) || 0;
      const lista = mapa.get(fid) ?? [];
      const ya = lista.find((x) => x.id === p.id);
      if (ya) { ya.aplicado = sumarMontos([ya.aplicado, aplicado]); return; }
      lista.push({
        id: p.id, numeroPago: texto(p.numeroPago) || p.id, fecha: texto(p.fecha), metodoPago: texto(p.metodoPago),
        referencia: texto(p.referencia), monto: Number(p.monto) || 0, moneda: texto(p.moneda), aplicado,
      });
      mapa.set(fid, lista);
    });
  });
  return mapa;
};

/** Pagos de una fila (una factura o varios documentos con el mismo folio), del más reciente al más viejo. */
export const pagosDeFacturas = (mapa: ReadonlyMap<string, readonly PagoDeFactura[]>, ids: readonly string[]): PagoDeFactura[] => {
  const juntos = new Map<string, PagoDeFactura>();
  ids.forEach((id) => (mapa.get(id) ?? []).forEach((p) => {
    const ya = juntos.get(p.id);
    if (ya) juntos.set(p.id, { ...ya, aplicado: sumarMontos([ya.aplicado, p.aplicado]) });
    else juntos.set(p.id, { ...p });
  }));
  return [...juntos.values()].sort((a, b) => (aFechaISO(b.fecha) || b.fecha).localeCompare(aFechaISO(a.fecha) || a.fecha) || a.numeroPago.localeCompare(b.numeroPago, 'es'));
};

/** facturaId → números de pago (la columna # Pago de siempre). */
export const numerosPorFactura = (mapa: ReadonlyMap<string, readonly PagoDeFactura[]>): Record<string, string[]> => {
  const salida: Record<string, string[]> = {};
  mapa.forEach((lista, fid) => { salida[fid] = Array.from(new Set(lista.map((p) => p.numeroPago))); });
  return salida;
};

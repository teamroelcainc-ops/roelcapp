// src/features/facturacion/services/normalizarFactura.ts
// ✅ V00493 — Forma única de una factura leída de Firestore (antes había una copia idéntica en
//   Facturación de Clientes y otra en Proveedores; Estadísticas la necesita igual para que sus
//   montos salgan exactamente como en el Historial de Facturación).
//   · fecha normalizada (cualquier formato guardado → AAAA-MM-DD cuando se reconoce);
//   · operacionesIds / operaciones como arreglos (las importadas del CSV las traen en texto);
//   · sin renglones (factura importada): renglones en 0 armados con ids + referencias;
//   · moneda, nombre, folio y status con sus respaldos de siempre.
import { parseFechaFactura } from '../selectores';

export type LadoFactura = 'cliente' | 'proveedor';

/** Renglón guardado de una factura (resumen de cada operación). */
export type RenglonGuardado = Record<string, unknown>;

export type FacturaNormalizada = Record<string, unknown> & {
  fecha: string;
  operacionesIds: string[];
  operaciones: string[];
  operacionesGuardadas: RenglonGuardado[];
  subtotalFactura: number;
  monedaId: unknown;
  facturaCcp: unknown;
  invoice: unknown;
  statusFactura: unknown;
};

/** Arreglo tanto si viene como arreglo como si viene en texto separado por comas (CSV importado). */
const aArreglo = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
};

export const normalizarFacturaDe = (raw: Record<string, unknown>, lado: LadoFactura): FacturaNormalizada => {
  const fechaNorm = parseFechaFactura(raw.fecha || raw.fechaFactura);
  const opsIds = aArreglo(raw.operacionesIds);
  const opsRefs = aArreglo(raw.operaciones);

  let opsGuardadas: RenglonGuardado[];
  if (Array.isArray(raw.operacionesGuardadas) && raw.operacionesGuardadas.length > 0) {
    opsGuardadas = raw.operacionesGuardadas as RenglonGuardado[];
  } else {
    // Sin detalle (factura importada): se combinan IDs + referencias por posición.
    const n = Math.max(opsIds.length, opsRefs.length);
    opsGuardadas = [];
    for (let i = 0; i < n; i++) {
      opsGuardadas.push({ id: String(opsIds[i] || opsRefs[i] || ''), ref: String(opsRefs[i] || opsIds[i] || ''), monto: 0, subtotalBase: 0 });
    }
  }
  const propios = lado === 'cliente'
    ? { monedaFacturacion: raw.monedaFacturacion || raw.moneda || 'N/A', clienteNombre: raw.clienteNombre || raw.cliente || '' }
    : { monedaProveedor: raw.monedaProveedor || raw.moneda || 'N/A', proveedorNombre: raw.proveedorNombre || raw.proveedor || '' };
  return {
    ...raw,
    fecha: fechaNorm || String(raw.fecha || raw.fechaFactura || ''),
    operacionesIds: opsIds,
    operaciones: opsRefs,
    operacionesGuardadas: opsGuardadas,
    subtotalFactura: Number(raw.subtotalFactura) || Number(raw.total) || 0,
    ...propios,
    monedaId: raw.monedaId || '',
    facturaCcp: raw.facturaCcp || raw.ccp || '',
    invoice: raw.invoice || raw.numeroInvoice || raw.numInvoice || raw.folio || String(raw.id || ''),
    statusFactura: raw.statusFactura || 'Facturado',
  };
};

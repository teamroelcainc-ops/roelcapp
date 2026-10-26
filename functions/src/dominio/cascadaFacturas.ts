// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.
// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).
// src/shared/dominio/cascadaFacturas.ts
// ---------------------------------------------------------------------------
// ✅ V00494 — QUÉ CAMBIO DE UNA OPERACIÓN SE LLEVA A SUS FACTURAS (cascada del servidor,
// functions/src/relacional.ts → propagarMontosDeOperacion). Pedido de Roelca: "bloquear que no se
// modifiquen los importes una vez facturados automáticamente".
//   · 'dinero': cambió una ENTRADA de dinero (monto del convenio, cargos, Facturado en, moneda del
//     convenio, tipo de cambio aprobado) o un monto guardado (Subtotal, Dólares, Pesos, Conversión):
//     el renglón y el total de la factura se recalculan (como antes).
//   · 'texto': solo cambió el nombre del convenio o la Ref Cliente: se copian al renglón; los importes
//     y el total NO se tocan (antes se recalculaban con la regla y la factura cambiaba sola).
//   · Ya NO disparan nada: las copias de nombres de moneda (monedaCobroNombre / monedaUnidadNombre) y
//     tipoCambioDia: las cambia el sistema (catálogos, tipo de cambio del día), no quien factura.
// ---------------------------------------------------------------------------
type Datos = Record<string, unknown>;

export type CambioFactura = 'dinero' | 'texto' | null;

export const DINERO_CLIENTE: readonly string[] = [
  'montoConvenioCliente', 'cargosAdicionales', 'facturadoEnCobrar', 'monedaConvenioCliente', 'tipoCambioAprobado',
  'conversionCliente', 'subtotalCliente', 'pesosCliente', 'dolaresCliente',
];
export const DINERO_PROVEEDOR: readonly string[] = [
  'totalAPagarProv', 'cargosAdicionalesProv', 'facturadoEnUnidad', 'monedaConvenioProv', 'tipoCambioAprobado',
  'conversionProv', 'subtotalProv', 'pesosProv', 'dolaresProv',
];
export const TEXTO_CLIENTE: readonly string[] = ['convenioNombre', 'convenioClienteNombre', 'refCliente'];
export const TEXTO_PROVEEDOR: readonly string[] = ['convenioProveedorNombre'];

const numeroDe = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
/** Distinto de verdad: '1250.50' y 1250.5 (o '' y 0) son el mismo monto. */
const difiere = (a: unknown, b: unknown): boolean => {
  const na = numeroDe(a);
  const nb = numeroDe(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) >= 0.00005;
  return String(a ?? '').trim() !== String(b ?? '').trim();
};
const algunoCambio = (campos: readonly string[], antes: Datos, despues: Datos): boolean => campos.some((c) => difiere(antes[c], despues[c]));

const cambioDeLado = (dinero: readonly string[], texto: readonly string[], antes: Datos, despues: Datos): CambioFactura =>
  algunoCambio(dinero, antes, despues) ? 'dinero' : algunoCambio(texto, antes, despues) ? 'texto' : null;

/** Qué hay que llevar a las facturas de cada lado tras una escritura de la operación. */
export const cambioParaFacturas = (antes: Datos, despues: Datos): { cliente: CambioFactura; proveedor: CambioFactura } => ({
  cliente: cambioDeLado(DINERO_CLIENTE, TEXTO_CLIENTE, antes, despues),
  proveedor: cambioDeLado(DINERO_PROVEEDOR, TEXTO_PROVEEDOR, antes, despues),
});

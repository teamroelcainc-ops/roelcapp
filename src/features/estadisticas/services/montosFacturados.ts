// src/features/estadisticas/services/montosFacturados.ts
// ---------------------------------------------------------------------------
// ✅ V00493 — MONTOS DE ESTADÍSTICAS DESDE FACTURACIÓN (lógica pura).
//   Antes el área Facturación de Estadísticas sumaba el Por Cobrar guardado en cada operación
//   (por fecha de servicio, facturada o no), y no cuadraba con las tarjetas del Historial de
//   Facturación. Ahora el dinero sale de las FACTURAS, con las mismas reglas del Historial:
//   · solo facturas con FECHA DE FACTURA dentro del rango (cualquier formato guardado);
//   · los documentos con el mismo folio y cliente se agrupan como en el Historial y su total es
//     el mismo de la fila (`totalDoc` de un documento solo; si son varios, cada uno con
//     `totalGuardadoDeDocumento`);
//   · las facturas canceladas no suman;
//   · la moneda es la de la factura (con respaldo de la empresa), igual que las tarjetas.
//   El total de cada factura se reparte entre sus operaciones en proporción a lo que cada renglón
//   trae en la moneda de la factura (USD: `dol`; MXN: la conversión `monto`), al centavo: la suma
//   de los renglones da exactamente el total de la factura.
// ---------------------------------------------------------------------------
import { aCentavos, aNumero, deCentavos } from '../../../shared/dominio/numeros';
import type { Moneda } from '../../../shared/dominio/moneda';
import { estaCancelada } from '../../facturacion/services/reglasFactura';
import { fechaFacturaISO } from '../../facturacion/selectores';
import { totalGuardadoDeDocumento } from '../../facturacion/services/totalesFactura';
import type { FacturaNormalizada, LadoFactura, RenglonGuardado } from '../../facturacion/services/normalizarFactura';

/** Una operación dentro de una factura, con su parte del total. */
export interface RenglonFacturado {
  /** Única por renglón (una operación puede venir en dos facturas). */
  clave: string;
  opId: string;
  ref: string;
  facturaId: string;
  invoice: string;
  /** Fecha de la factura (AAAA-MM-DD; '' si no se reconoce). */
  fecha: string;
  /** clienteId o proveedorId de la factura. */
  entidadId: string;
  entidadNombre: string;
  moneda: Moneda;
  /** Parte del total en dólares (factura USD) o en pesos (factura MXN); la otra en 0. */
  dol: number;
  pes: number;
  /** En pesos: los pesos, o los dólares × el tipo de cambio de la operación. */
  conv: number;
  tc: number;
}

export interface ResumenFacturado {
  renglones: RenglonFacturado[];
  /** Filas del Historial que suman (sin canceladas ni sin moneda). */
  facturas: number;
  /** Filas canceladas dentro del rango (no suman). */
  canceladas: number;
  /** Filas sin moneda reconocible (tampoco suman en las tarjetas del Historial). */
  sinMoneda: { facturas: number; total: number };
  /** Totales exactos de las facturas que suman (los mismos de las tarjetas). */
  totalUSD: number;
  totalMXN: number;
}

export interface OpcionesFacturado {
  lado: LadoFactura;
  /** Rango de fecha de factura (AAAA-MM-DD). Vacíos = sin límite. */
  desde: string;
  hasta: string;
  /** Total de UN documento (la misma regla que usa el Historial según la bandera). */
  totalDoc: (f: unknown) => number;
  /** Moneda de la factura (la suya o, si no trae, la de la empresa); null = no reconocida. */
  monedaDe: (f: FacturaNormalizada) => Moneda | null;
  /** Tipo de cambio de respaldo de una operación cuando el renglón no permite calcularlo. */
  tcDe?: (opId: string) => number;
}

const texto = (v: unknown): string => String(v ?? '').trim();
const trae = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * Reparte `totalCentavos` en proporción a `pesos`, al centavo (la suma da exacto el total).
 * Sin pesos positivos se reparte en partes iguales.
 */
export const repartirCentavos = (totalCentavos: number, pesos: readonly number[]): number[] => {
  const n = pesos.length;
  if (n === 0) return [];
  const limpios = pesos.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const suma = limpios.reduce((a, b) => a + b, 0);
  const base = suma > 0 ? limpios : limpios.map(() => 1);
  const sumaBase = suma > 0 ? suma : n;
  const exactos = base.map((p) => (totalCentavos * p) / sumaBase);
  const partes = exactos.map((x) => Math.trunc(x));
  let resto = totalCentavos - partes.reduce((a, b) => a + b, 0);
  // El residuo (centavos sueltos por redondeo) va a los de mayor fracción, en el signo del total.
  const paso = resto >= 0 ? 1 : -1;
  const orden = exactos
    .map((x, i) => ({ i, frac: Math.abs(x - Math.trunc(x)) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; resto !== 0 && k < orden.length * 2; k++) {
    partes[orden[k % orden.length].i] += paso;
    resto -= paso;
  }
  return partes;
};

/**
 * Peso de cada renglón en la moneda de la factura (mismo orden de respaldos que el total
 * calculado con renglones): USD → `dol` (o `subtotalBase` si no trae), luego `subtotalBase`;
 * MXN → la conversión `monto`, luego `pes`, luego `subtotalBase`.
 */
export const pesosDeRenglones = (moneda: Moneda, renglones: readonly RenglonGuardado[]): number[] => {
  const candidatos: ((r: RenglonGuardado) => number)[] = moneda === 'USD'
    ? [(r) => aNumero(trae(r.dol) ? r.dol : r.subtotalBase), (r) => aNumero(r.subtotalBase)]
    : [(r) => aNumero(r.monto), (r) => aNumero(r.pes), (r) => aNumero(r.subtotalBase)];
  for (const c of candidatos) {
    const pesos = renglones.map(c);
    if (pesos.some((p) => p > 0)) return pesos;
  }
  return renglones.map(() => 0);
};

// Mismo criterio del Historial para el status de un folio con varios documentos:
// cancelada > "no facturado" > el resto (gana el primero con el rango más alto).
const rangoStatus = (s: unknown): number => {
  const t = String(s || '').toLowerCase();
  if (t.includes('cancel')) return 3;
  if (t.includes('no')) return 2;
  return 1;
};

interface Grupo { docs: FacturaNormalizada[]; status: unknown }

/**
 * Renglones facturados (una fila por operación de cada factura) del rango, con las reglas del
 * Historial de Facturación. Las sumas de `totalUSD` y `totalMXN` son las de sus tarjetas.
 */
export const renglonesFacturados = (facturas: readonly FacturaNormalizada[], o: OpcionesFacturado): ResumenFacturado => {
  const campoEntidad = o.lado === 'cliente' ? 'clienteId' : 'proveedorId';
  const campoNombre = o.lado === 'cliente' ? 'clienteNombre' : 'proveedorNombre';
  const grupos = new Map<string, Grupo>();
  for (const f of facturas) {
    if (o.desde || o.hasta) {
      const fc = fechaFacturaISO(f.fecha);
      if (!fc) continue;
      if (o.desde && fc < o.desde) continue;
      if (o.hasta && fc > o.hasta) continue;
    }
    const clave = `${texto(f.invoice || f.id).toLowerCase()}__${texto(f[campoEntidad])}`;
    const g = grupos.get(clave);
    if (!g) grupos.set(clave, { docs: [f], status: f.statusFactura });
    else {
      g.docs.push(f);
      if (rangoStatus(f.statusFactura) > rangoStatus(g.status)) g.status = f.statusFactura;
    }
  }

  const renglones: RenglonFacturado[] = [];
  let cuenta = 0, canceladas = 0, sinMonedaN = 0, sinMonedaTotal = 0, centUSD = 0, centMXN = 0;
  for (const g of grupos.values()) {
    if (estaCancelada(String(g.status || 'Facturado'))) { canceladas++; continue; }
    const primero = g.docs[0];
    const totalCent = g.docs.length <= 1
      ? aCentavos(o.totalDoc(primero))
      : g.docs.reduce((acc, d) => acc + aCentavos(totalGuardadoDeDocumento(d, o.totalDoc)), 0);
    const moneda = o.monedaDe(primero);
    if (!moneda) { sinMonedaN++; sinMonedaTotal += totalCent; continue; }
    cuenta++;
    if (moneda === 'USD') centUSD += totalCent; else centMXN += totalCent;

    // Renglones del folio: los de cada documento sin repetir operación (el último gana, como en el Historial).
    let lineas: RenglonGuardado[] = primero.operacionesGuardadas;
    if (g.docs.length > 1) {
      const porId = new Map<string, RenglonGuardado>();
      g.docs.forEach((d) => d.operacionesGuardadas.forEach((r) => { const id = texto(r.id); if (id) porId.set(id, r); }));
      lineas = Array.from(porId.values());
    }
    if (lineas.length === 0) continue;
    const partes = repartirCentavos(totalCent, pesosDeRenglones(moneda, lineas));
    const fecha = g.docs.map((d) => fechaFacturaISO(d.fecha)).reduce((a, b) => (b > a ? b : a), '');
    const facturaId = texto(primero.id);
    lineas.forEach((r, i) => {
      const monto = deCentavos(partes[i]);
      const opId = texto(r.id) || texto(r.ref);
      const dolR = aNumero(r.dol), convR = aNumero(r.monto);
      const tc = moneda === 'USD'
        ? (dolR > 0 && convR > 0 ? convR / dolR : (o.tcDe?.(opId) || aNumero(primero.tipoCambio) || 0))
        : (o.tcDe?.(opId) || 0);
      renglones.push({
        clave: `${facturaId}#${renglones.length}`,
        opId,
        ref: texto(r.ref),
        facturaId,
        invoice: texto(primero.invoice),
        fecha,
        entidadId: texto(primero[campoEntidad]),
        entidadNombre: texto(primero[campoNombre]),
        moneda,
        dol: moneda === 'USD' ? monto : 0,
        pes: moneda === 'MXN' ? monto : 0,
        conv: moneda === 'USD' ? Math.round(monto * tc * 100) / 100 : monto,
        tc,
      });
    });
  }
  return { renglones, facturas: cuenta, canceladas, sinMoneda: { facturas: sinMonedaN, total: deCentavos(sinMonedaTotal) }, totalUSD: deCentavos(centUSD), totalMXN: deCentavos(centMXN) };
};

/** Operaciones que aparecen en alguna factura NO cancelada (de cualquier fecha). */
export const operacionesConFactura = (facturas: readonly FacturaNormalizada[]): Set<string> => {
  const ids = new Set<string>();
  facturas.forEach((f) => {
    if (estaCancelada(String(f.statusFactura || 'Facturado'))) return;
    f.operacionesIds.forEach((id) => ids.add(texto(id)));
    f.operacionesGuardadas.forEach((r) => { const id = texto(r.id); if (id) ids.add(id); });
  });
  return ids;
};

/** Costo en pesos por operación (suma de sus renglones en facturas de proveedor). */
export const costoPorOperacion = (renglones: readonly RenglonFacturado[]): Map<string, number> => {
  const m = new Map<string, number>();
  renglones.forEach((r) => { if (r.opId) m.set(r.opId, Math.round(((m.get(r.opId) || 0) + r.conv) * 100) / 100); });
  return m;
};

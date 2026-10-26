// src/features/estadisticas/hooks/useMontosFacturados.ts
// ---------------------------------------------------------------------------
// ✅ V00493 — Filas del área FACTURACIÓN de Estadísticas armadas desde las facturas.
//   · Una fila por operación de cada factura de cliente con FECHA DE FACTURA en el rango, con
//     su parte del total de la factura (services/montosFacturados.ts). Las tarjetas del
//     Historial de Facturación y los totales de Estadísticas salen de la misma regla.
//   · Los datos de la operación (tipo, C/V, operador, unidad, proveedor…) salen de las
//     operaciones del rango ya escuchadas; las facturadas en el rango con servicio de OTRO
//     periodo se leen por id (lotes de 30) una sola vez.
//   · Costo proveedor = facturas de proveedor (no canceladas) de esas mismas operaciones.
//   · Aparte (no suman): operaciones del rango sin factura de cliente con Por Cobrar
//     ("por facturar") y facturadas cuyo Por Pagar aún no tiene factura del proveedor.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { porIds } from '../../../shared/data/consultas';
import { idReal } from '../../../shared/data/coleccionesVivas';
import type { DocVivo } from '../../../shared/data/coleccionesVivas';
import { monedaCanonica } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { normalizarFacturaDe } from '../../facturacion/services/normalizarFactura';
import type { FacturaNormalizada } from '../../facturacion/services/normalizarFactura';
import { costoPorOperacion, operacionesConFactura, renglonesFacturados } from '../services/montosFacturados';
import type { ResumenFacturado } from '../services/montosFacturados';

type Datos = Record<string, unknown>;
interface Montos { dol: number; pes: number; conv: number }

/** Fila de Estadísticas armada con una operación de una factura (los `__` no existen en Firestore). */
export type FilaFacturada = Datos & {
  id: string;
  __clave: string;
  __fechaFact: string;
  __fact: Montos & { tc: number; moneda: Moneda };
  __costo: number;
  __factura: { id: string; invoice: string };
};

export interface EntradaMontosFacturados {
  /** false = no calcula nada (área Operaciones o sin búsqueda). */
  activo: boolean;
  /** Los listeners de las dos colecciones de facturas ya respondieron. */
  facturasListas: boolean;
  facturasCliente: readonly DocVivo[];
  facturasProveedor: readonly DocVivo[];
  /** Operaciones del rango por fecha de servicio (sin canceladas). */
  ops: readonly Datos[];
  /** Rango buscado (fecha de factura). */
  desde: string;
  hasta: string;
  totalDoc: (f: unknown) => number;
  empresas: readonly DocVivo[];
  /** id del catálogo de monedas → nombre (para monedas guardadas con un id que no es USD/MXN). */
  nombresMoneda: ReadonlyMap<string, string>;
  /** Por Cobrar guardado en la operación (solo para lo "por facturar"). */
  porCobrarDe: (op: Datos) => Montos;
  /** Por Pagar guardado en la operación (solo para lo que falta facturar del proveedor). */
  porPagarDe: (op: Datos) => number;
}

export interface MontosFacturados {
  filas: FilaFacturada[];
  resumen: ResumenFacturado | null;
  porFacturar: Montos & { ops: Datos[] };
  sinFacturaProveedor: { ops: Datos[]; costo: number };
  cargando: boolean;
  error: string | null;
}

const VACIO: Datos[] = [];
const texto = (v: unknown): string => String(v ?? '').trim();
const r2 = (n: number): number => Math.round(n * 100) / 100;

export function useMontosFacturados(e: EntradaMontosFacturados): MontosFacturados {
  const { activo, facturasCliente, facturasProveedor, ops, desde, hasta, totalDoc, empresas, nombresMoneda, porCobrarDe, porPagarDe } = e;

  const empresaPorId = useMemo(() => new Map(empresas.map((x) => [idReal(x), x] as const)), [empresas]);
  // Moneda de la factura con el mismo criterio del Historial: la guardada en la factura (si trae
  // una); si no, la de la empresa. Un valor que no se reconoce deja la factura "sin moneda".
  const monedaDe = useMemo(() => {
    const deValor = (v: unknown): Moneda | null => monedaCanonica(v) ?? monedaCanonica(nombresMoneda.get(texto(v)));
    const conRespaldo = (valores: unknown[], respaldo: () => unknown): Moneda | null => {
      const propio = valores.map(texto).find((s) => s && s.toLowerCase() !== 'n/a');
      return propio ? deValor(propio) : deValor(respaldo());
    };
    return {
      cliente: (f: FacturaNormalizada) => conRespaldo([f.monedaFacturacion, f.moneda], () => {
        const em = empresaPorId.get(texto(f.clienteId));
        return em?.monedaRef || em?.moneda || em?.monedaFacturacion;
      }),
      proveedor: (f: FacturaNormalizada) => conRespaldo([f.monedaProveedor], () => {
        const em = empresaPorId.get(texto(f.proveedorId));
        return em?.monedaRef || em?.moneda || em?.monedaProveedor;
      }),
    };
  }, [empresaPorId, nombresMoneda]);

  const opsPorId = useMemo(() => new Map(ops.map((o) => [texto(o.id), o] as const)), [ops]);
  const tcDe = useMemo(() => (opId: string) => Number(opsPorId.get(opId)?.tipoCambioAprobado) || 0, [opsPorId]);

  const cli = useMemo(() => (activo ? facturasCliente.map((d) => normalizarFacturaDe(d, 'cliente')) : []), [activo, facturasCliente]);
  const prov = useMemo(() => (activo ? facturasProveedor.map((d) => normalizarFacturaDe(d, 'proveedor')) : []), [activo, facturasProveedor]);

  const resumen = useMemo(
    () => (activo ? renglonesFacturados(cli, { lado: 'cliente', desde, hasta, totalDoc, monedaDe: monedaDe.cliente, tcDe }) : null),
    [activo, cli, desde, hasta, totalDoc, monedaDe, tcDe],
  );
  const costos = useMemo(
    () => (activo ? costoPorOperacion(renglonesFacturados(prov, { lado: 'proveedor', desde: '', hasta: '', totalDoc, monedaDe: monedaDe.proveedor, tcDe }).renglones) : new Map<string, number>()),
    [activo, prov, totalDoc, monedaDe, tcDe],
  );

  // Operaciones facturadas en el rango cuyo servicio cae en otro periodo: se leen por id una vez.
  const [extras, setExtras] = useState<ReadonlyMap<string, Datos | null>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const pedidos = useRef(new Set<string>());
  const faltantes = useMemo(() => {
    if (!resumen) return [] as string[];
    const ids = new Set<string>();
    resumen.renglones.forEach((r) => { if (r.opId && !opsPorId.has(r.opId) && !extras.has(r.opId)) ids.add(r.opId); });
    return Array.from(ids);
  }, [resumen, opsPorId, extras]);
  useEffect(() => {
    const nuevos = faltantes.filter((id) => !pedidos.current.has(id));
    if (nuevos.length === 0) return;
    nuevos.forEach((id) => pedidos.current.add(id));
    porIds('operaciones', nuevos)
      .then((docs) => {
        const porId = new Map(docs.map((d) => [idReal(d), d as Datos] as const));
        setExtras((prev) => { const m = new Map(prev); nuevos.forEach((id) => m.set(id, porId.get(id) ?? null)); return m; });
      })
      .catch((err: unknown) => {
        console.error('[Estadísticas] No se pudieron leer las operaciones facturadas de otro periodo:', err);
        setError('No se pudieron leer algunas operaciones facturadas con servicio de otro periodo: se muestran solo con los datos de la factura.');
        setExtras((prev) => { const m = new Map(prev); nuevos.forEach((id) => m.set(id, null)); return m; });
      })
      .finally(() => nuevos.forEach((id) => pedidos.current.delete(id)));
  }, [faltantes]);

  const filas = useMemo((): FilaFacturada[] => {
    if (!resumen) return [];
    const nombreEmpresa = (id: string): string => texto(empresaPorId.get(id)?.nombre);
    const conCosto = new Set<string>();
    return resumen.renglones.map((r) => {
      const base = opsPorId.get(r.opId) ?? extras.get(r.opId) ?? null;
      // El costo del proveedor de la operación va una sola vez (aunque venga en dos facturas).
      const costo = !conCosto.has(r.opId) ? (costos.get(r.opId) ?? 0) : 0;
      conCosto.add(r.opId);
      return {
        ...(base ?? {}),
        id: r.opId,
        ref: texto(base?.ref) || r.ref,
        clientePaga: r.entidadId || base?.clientePaga,
        clientePagaNombre: nombreEmpresa(r.entidadId) || texto(base?.clientePagaNombre) || r.entidadNombre,
        __clave: r.clave,
        __fechaFact: r.fecha,
        __fact: { dol: r.dol, pes: r.pes, conv: r.conv, tc: r.tc, moneda: r.moneda },
        __costo: costo,
        __factura: { id: r.facturaId, invoice: r.invoice },
      };
    });
  }, [resumen, opsPorId, extras, costos, empresaPorId]);

  const conFactura = useMemo(() => (activo ? operacionesConFactura(cli) : new Set<string>()), [activo, cli]);
  const porFacturar = useMemo(() => {
    const lista: Datos[] = [];
    let dol = 0, pes = 0, conv = 0;
    if (activo) {
      ops.forEach((op) => {
        if (conFactura.has(texto(op.id))) return;
        const m = porCobrarDe(op);
        if (!(m.conv > 0 || m.dol > 0 || m.pes > 0)) return;
        lista.push(op); dol += m.dol; pes += m.pes; conv += m.conv;
      });
    }
    return { ops: lista.length ? lista : VACIO, dol: r2(dol), pes: r2(pes), conv: r2(conv) };
  }, [activo, ops, conFactura, porCobrarDe]);

  const sinFacturaProveedor = useMemo(() => {
    const lista: Datos[] = [];
    let costo = 0;
    const vistos = new Set<string>();
    filas.forEach((f) => {
      if (vistos.has(f.id) || costos.has(f.id)) return;
      vistos.add(f.id);
      const base = opsPorId.get(f.id) ?? extras.get(f.id);
      const c = base ? porPagarDe(base) : 0;
      if (c > 0) { lista.push(base as Datos); costo += c; }
    });
    return { ops: lista, costo: r2(costo) };
  }, [filas, costos, opsPorId, extras, porPagarDe]);

  return {
    filas,
    resumen,
    porFacturar,
    sinFacturaProveedor,
    cargando: activo && (!e.facturasListas || faltantes.length > 0),
    error,
  };
}

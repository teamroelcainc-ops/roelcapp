// src/shared/dominio/saldosCorrientes.ts
// ---------------------------------------------------------------------------
// ✅ V00441 (Fase 5.6) — SALDO CORRIENTE DE DIESEL sin leer el historial.
// Hoy la tarjeta "Saldo Diesel" de Operaciones escucha hasta 3,000 referencias
// para restar lo cargado. El servidor mantiene, por proveedor, lo cargado POR
// DÍA en `saldos_corrientes/diesel_<clave>` (campo `dias`: { 'AAAA-MM-DD':
// { c: centavos, n: cargas } }) y la tarjeta solo lee esos pocos documentos.
//
// La cuenta es la MISMA de Referencias del Diesel → Saldos (V00400/V00422):
//   restante = Σ saldos agregados − Σ Total Cargado de las referencias del
//   proveedor desde la fecha de su PRIMER saldo; "__todos__" = todas las cargas.
// Se recalcula el día completo (no se incrementa): repetir un evento no duplica.
// ---------------------------------------------------------------------------
import { aCentavos, aNumero, deCentavos } from './numeros.js';
import { cobroDiesel } from './cobroDiesel.js';

type Datos = Record<string, unknown>;

export const COL_SALDOS_CORRIENTES = 'saldos_corrientes';
/** Saldo GENERAL de diesel: descuenta las cargas de todos los proveedores (V00422). */
export const CLAVE_TODOS_DIESEL = '__todos__';

/** Una entrada del mapa `dias`: centavos cargados y número de cargas. */
export interface DiaCargado { c: number; n: number }

/** Documento saldos_corrientes/diesel_<clave>. */
export interface SaldoCorrienteDiesel {
  tipo: 'diesel';
  clave: string;
  nombre: string;
  dias: Record<string, DiaCargado>;
}

const normNombre = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * Lo que una referencia descuenta del saldo.
 * ✅ V00459: lo COBRADO (el Monto cobrado capturado o, mientras no se captura, el total
 * menos el descuento estimado de Murphy; ver cobroDiesel.ts). Las cargas sin descuento ni
 * captura dan EXACTO el Total Cargado de siempre (galones × costo).
 */
export const cargadoDiesel = (r: Datos): number => cobroDiesel(r).cobrado;

/** Clave del proveedor de una referencia: su ID; sin ID, su nombre normalizado. */
export const claveProveedorDiesel = (r: Datos): string => {
  const id = String(r.proveedorId || r.proveedor || '').trim();
  if (id) return id;
  const nombre = normNombre(r.proveedorNombre);
  return nombre ? `nombre:${nombre}` : '';
};

/** Id del documento de una clave (sin "/" y sin la forma reservada __x__). */
export const idSaldoDiesel = (clave: string): string => `diesel_${encodeURIComponent(clave)}`;

/** Lo que aporta una referencia al saldo: clave, día y centavos (null si no carga). */
export const aporteDiesel = (r: Datos | undefined | null): { clave: string; fecha: string; centavos: number; nombre: string } | null => {
  if (!r) return null;
  const centavos = aCentavos(cargadoDiesel(r));
  if (!(centavos > 0)) return null;
  // Sin fecha AAAA-MM-DD no se puede ubicar en un día (la reconstrucción las cuenta en paridad.csv).
  const fecha = typeof r.fecha === 'string' ? r.fecha.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(fecha)) return null;
  return { clave: claveProveedorDiesel(r), fecha: fecha.slice(0, 10), centavos, nombre: String(r.proveedorNombre || '') };
};

/** ¿Cambió algo que mueva el saldo? (lista blanca: proveedor, fecha y monto). */
export const aporteDieselCambio = (antes: Datos | undefined | null, despues: Datos | undefined | null): boolean => {
  const a = aporteDiesel(antes);
  const d = aporteDiesel(despues);
  return a?.clave !== d?.clave || a?.fecha !== d?.fecha || a?.centavos !== d?.centavos;
};

/**
 * Cargado de UN día, por clave, a partir de las referencias de ese día.
 * Incluye siempre la clave general (CLAVE_TODOS_DIESEL).
 */
export const diaDiesel = (refsDelDia: readonly Datos[]): Map<string, DiaCargado & { nombre: string }> => {
  const porClave = new Map<string, DiaCargado & { nombre: string }>();
  const sumar = (clave: string, centavos: number, nombre: string) => {
    const x = porClave.get(clave) ?? { c: 0, n: 0, nombre };
    x.c += centavos; x.n += 1;
    if (!x.nombre && nombre) x.nombre = nombre;
    porClave.set(clave, x);
  };
  for (const r of refsDelDia) {
    const ap = aporteDiesel(r);
    if (!ap) continue;
    sumar(CLAVE_TODOS_DIESEL, ap.centavos, 'Todos los proveedores');
    if (ap.clave) sumar(ap.clave, ap.centavos, ap.nombre);
  }
  return porClave;
};

/** Todos los días de todas las claves (reconstrucción completa). */
export const agregadosDiesel = (refs: readonly Datos[]): Map<string, { nombre: string; dias: Record<string, DiaCargado> }> => {
  const porFecha = new Map<string, Datos[]>();
  for (const r of refs) {
    const ap = aporteDiesel(r);
    if (!ap) continue;
    porFecha.set(ap.fecha, [...(porFecha.get(ap.fecha) ?? []), r]);
  }
  const salida = new Map<string, { nombre: string; dias: Record<string, DiaCargado> }>();
  porFecha.forEach((lista, fecha) => {
    diaDiesel(lista).forEach((v, clave) => {
      const x = salida.get(clave) ?? { nombre: v.nombre, dias: {} };
      x.dias[fecha] = { c: v.c, n: v.n };
      if (!x.nombre && v.nombre) x.nombre = v.nombre;
      salida.set(clave, x);
    });
  });
  return salida;
};

export interface CuentaDiesel {
  clave: string;
  nombre: string;
  moneda: string;
  restante: number;
  cargasHoy: number;
  cargadoHoy: number;
}

const sumarDias = (dias: Record<string, DiaCargado> | undefined, desde: string): { c: number; n: number } => {
  let c = 0; let n = 0;
  for (const [fecha, v] of Object.entries(dias ?? {})) {
    if (desde && fecha < desde) continue;
    c += aNumero(v?.c); n += aNumero(v?.n);
  }
  return { c, n };
};

/**
 * Cuentas de la tarjeta "Saldo Diesel" a partir de los saldos agregados
 * (colección saldos_diesel) y de los documentos de saldo corriente.
 * Un saldo con ID de proveedor suma lo cargado con ese ID y lo de las
 * referencias viejas sin ID que traen el mismo nombre.
 */
export const cuentasDiesel = (saldos: readonly Datos[], corrientes: readonly SaldoCorrienteDiesel[], hoy: string): CuentaDiesel[] => {
  const porClave = new Map(corrientes.map((d) => [d.clave, d]));
  const grupos = new Map<string, Datos[]>();
  saldos.forEach((s) => { const k = String(s.proveedorId || s.proveedorNombre || ''); grupos.set(k, [...(grupos.get(k) ?? []), s]); });
  return Array.from(grupos.entries()).map(([k, lista]) => {
    const primera = lista.map((s) => String(s.fecha || '')).sort()[0] || '';
    const nombre = String(lista[0].proveedorNombre || k);
    const fuentes: (SaldoCorrienteDiesel | undefined)[] = k === CLAVE_TODOS_DIESEL
      ? [porClave.get(CLAVE_TODOS_DIESEL)]
      : Array.from(new Set([porClave.get(k), porClave.get(`nombre:${normNombre(nombre)}`)]));
    let consumido = 0; let hoyC = 0; let hoyN = 0;
    for (const f of fuentes) {
      if (!f) continue;
      consumido += sumarDias(f.dias, primera).c;
      const dHoy = f.dias?.[hoy];
      if (dHoy && (!primera || hoy >= primera)) { hoyC += aNumero(dHoy.c); hoyN += aNumero(dHoy.n); }
    }
    const agregado = lista.reduce((a, s) => a + (Number(s.saldo) || 0), 0);
    return {
      clave: k, nombre, moneda: String(lista[0].moneda || ''),
      restante: agregado - deCentavos(consumido), cargasHoy: hoyN, cargadoHoy: deCentavos(hoyC),
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
};

/** La misma cuenta con las referencias completas (la de siempre; para comparar). */
export const cuentasDieselDesdeReferencias = (saldos: readonly Datos[], refs: readonly Datos[], hoy: string): CuentaDiesel[] => {
  const grupos = new Map<string, Datos[]>();
  saldos.forEach((s) => { const k = String(s.proveedorId || s.proveedorNombre || ''); grupos.set(k, [...(grupos.get(k) ?? []), s]); });
  return Array.from(grupos.entries()).map(([k, lista]) => {
    const primera = lista.map((s) => String(s.fecha || '')).sort()[0] || '';
    const nombre = String(lista[0].proveedorNombre || k);
    const general = k === CLAVE_TODOS_DIESEL;
    const mias = refs.filter((r) => (general || String(r.proveedorId || r.proveedor || '') === k || normNombre(r.proveedorNombre) === normNombre(nombre))
      && cargadoDiesel(r) > 0 && (!primera || String(r.fecha || '') >= primera));
    const agregado = lista.reduce((a, s) => a + (Number(s.saldo) || 0), 0);
    const consumido = mias.reduce((a, r) => a + cargadoDiesel(r), 0);
    const hoyRefs = mias.filter((r) => String(r.fecha || '') === hoy);
    return {
      clave: k, nombre, moneda: String(lista[0].moneda || ''),
      restante: agregado - consumido, cargasHoy: hoyRefs.length, cargadoHoy: hoyRefs.reduce((a, r) => a + cargadoDiesel(r), 0),
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
};

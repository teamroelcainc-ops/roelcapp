// src/features/operaciones/services/movimientosDiesel.ts
// ✅ V00457: MOVIMIENTOS DEL SALDO DE DIESEL (modal de la tarjeta Saldo Diesel de
//   Operaciones Activas): saldos agregados (+) y lo cargado POR DÍA (−) de cada cuenta,
//   con el saldo que queda después de cada movimiento. Es la MISMA cuenta de la tarjeta
//   y de Referencias del Diesel → Saldos (V00400 / V00422 / V00441): la cuenta es el
//   proveedor del saldo (o "Todos los proveedores") y lo cargado cuenta desde la fecha de
//   su PRIMER saldo. Las cargas salen de los documentos de saldo corriente (bandera
//   saldosCorrientes) o de las referencias. Lógica pura: sin Firebase ni React.
import { aCentavos, aNumero, deCentavos } from '../../../shared/dominio/numeros';
import { CLAVE_TODOS_DIESEL, cargadoDiesel, type SaldoCorrienteDiesel } from '../../../shared/dominio/saldosCorrientes';
import { cobroEstimado } from '../../../shared/dominio/cobroDiesel';

type Datos = Record<string, unknown>;

/** Una cuenta de diesel: los saldos agregados de un proveedor (o el general). */
export interface CuentaDieselMov {
  clave: string;
  nombre: string;
  moneda: string;
  /** Fecha del primer saldo (desde ahí se descuenta). */
  primera: string;
  saldos: readonly Datos[];
}

/**
 * Lo cargado en un día. `monto` se suma igual que la tarjeta (centavos del servidor, o
 * el Total Cargado de cada referencia sin redondear), así el saldo final cuadra al
 * centavo. `galones` es null cuando solo se tiene el total del servidor.
 */
export interface DiaDiesel {
  monto: number;
  cargas: number;
  galones: number | null;
}

export interface MovimientoDiesel {
  id: string;
  tipo: 'saldo' | 'cargas';
  fecha: string; // AAAA-MM-DD
  hora: string; // HH:mm del saldo; vacío en las cargas del día
  cuenta: string;
  cuentaNombre: string;
  moneda: string;
  abono: number;
  cargo: number;
  cargas: number;
  galones: number | null;
  /** Saldo de la cuenta después de este movimiento. */
  saldo: number;
  registradoPor: string;
}

/** Una carga (referencia de diesel) para el detalle de un día. */
export interface CargaDiesel {
  id: string;
  consecutivo: string;
  unidad: string;
  proveedor: string;
  galones: number;
  costo: number;
  /** ✅ V00459: lo cobrado (lo que descuenta del saldo) y si todavía es un estimado (descuento estimado o por confirmar). */
  total: number;
  estimado: boolean;
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();
const fechaDe = (v: unknown): string => String(v ?? '').trim().slice(0, 10);

/** Cuentas de los saldos agregados (misma agrupación que la tarjeta: por proveedorId o nombre). */
export const cuentasDeSaldos = (saldos: readonly Datos[]): CuentaDieselMov[] => {
  const grupos = new Map<string, Datos[]>();
  saldos.forEach((s) => {
    const k = String(s.proveedorId || s.proveedorNombre || '');
    grupos.set(k, [...(grupos.get(k) ?? []), s]);
  });
  return Array.from(grupos, ([clave, lista]) => ({
    clave,
    nombre: String(lista[0].proveedorNombre || clave),
    moneda: String(lista[0].moneda || ''),
    primera: lista.map((s) => String(s.fecha || '')).sort()[0] || '',
    saldos: lista,
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));
};

/** ¿La referencia descuenta de esta cuenta? (general = todas; si no, por ID o por nombre). */
const esDeCuenta = (r: Datos, cuenta: Pick<CuentaDieselMov, 'clave' | 'nombre'>): boolean =>
  cuenta.clave === CLAVE_TODOS_DIESEL
  || String(r.proveedorId || r.proveedor || '') === cuenta.clave
  || norm(r.proveedorNombre) === norm(cuenta.nombre);

/** Cargado por día de la cuenta con los documentos de saldo corriente (bandera saldosCorrientes). */
export const diasDesdeCorrientes = (cuenta: CuentaDieselMov, corrientes: readonly SaldoCorrienteDiesel[]): Map<string, DiaDiesel> => {
  const porClave = new Map(corrientes.map((d) => [d.clave, d]));
  const fuentes = cuenta.clave === CLAVE_TODOS_DIESEL
    ? [porClave.get(CLAVE_TODOS_DIESEL)]
    : Array.from(new Set([porClave.get(cuenta.clave), porClave.get(`nombre:${norm(cuenta.nombre)}`)]));
  const centavos = new Map<string, { c: number; n: number }>();
  for (const f of fuentes) {
    if (!f) continue;
    for (const [fecha, v] of Object.entries(f.dias ?? {})) {
      if (cuenta.primera && fecha < cuenta.primera) continue;
      const d = centavos.get(fecha) ?? { c: 0, n: 0 };
      d.c += aNumero(v?.c);
      d.n += aNumero(v?.n);
      centavos.set(fecha, d);
    }
  }
  const dias = new Map<string, DiaDiesel>();
  centavos.forEach((d, fecha) => dias.set(fecha, { monto: deCentavos(d.c), cargas: d.n, galones: null }));
  return dias;
};

/** Cargado por día de la cuenta con las referencias completas (sin la bandera). */
export const diasDesdeReferencias = (cuenta: CuentaDieselMov, refs: readonly Datos[]): Map<string, DiaDiesel> => {
  const dias = new Map<string, DiaDiesel>();
  refs.forEach((r) => {
    const monto = cargadoDiesel(r);
    if (!(monto > 0) || !esDeCuenta(r, cuenta)) return;
    if (cuenta.primera && String(r.fecha || '') < cuenta.primera) return;
    const fecha = fechaDe(r.fecha);
    const d = dias.get(fecha) ?? { monto: 0, cargas: 0, galones: 0 };
    d.monto += monto;
    d.cargas += 1;
    d.galones = (d.galones ?? 0) + (Number(r.galonesCargados) || 0);
    dias.set(fecha, d);
  });
  return dias;
};

/**
 * Movimientos de todas las cuentas, del más reciente al más antiguo. En un mismo día el
 * saldo agregado va antes que las cargas (el saldo que queda al final del día es el de
 * la fila de cargas).
 */
export const movimientosDiesel = (cuentas: readonly CuentaDieselMov[], diasDe: (c: CuentaDieselMov) => Map<string, DiaDiesel>): MovimientoDiesel[] => {
  const out: MovimientoDiesel[] = [];
  for (const c of cuentas) {
    const eventos: { orden: string; m: Omit<MovimientoDiesel, 'saldo'> }[] = [];
    c.saldos.forEach((s, i) => {
      const monto = Number(s.saldo) || 0;
      if (monto === 0) return;
      const fecha = String(s.fecha || '');
      const hora = String(s.hora || '');
      eventos.push({
        orden: `${fecha}|0|${hora}|${String(i).padStart(4, '0')}`,
        m: { id: `saldo:${String(s.id ?? `${c.clave}-${i}`)}`, tipo: 'saldo', fecha, hora, cuenta: c.clave, cuentaNombre: c.nombre, moneda: String(s.moneda || c.moneda), abono: monto, cargo: 0, cargas: 0, galones: null, registradoPor: String(s.registradoPor || '') },
      });
    });
    diasDe(c).forEach((d, fecha) => {
      if (!(d.monto > 0)) return;
      eventos.push({
        orden: `${fecha}|1`,
        m: { id: `cargas:${c.clave}:${fecha}`, tipo: 'cargas', fecha, hora: '', cuenta: c.clave, cuentaNombre: c.nombre, moneda: c.moneda, abono: 0, cargo: d.monto, cargas: d.cargas, galones: d.galones, registradoPor: '' },
      });
    });
    eventos.sort((a, b) => a.orden.localeCompare(b.orden));
    // Saldos agregados − cargado, sumado como la tarjeta (sin redondear a mitad de camino).
    let corrido = 0;
    eventos.forEach((e) => {
      corrido += e.m.abono - e.m.cargo;
      out.push({ ...e.m, saldo: corrido });
    });
  }
  const orden = (m: MovimientoDiesel) => `${m.fecha}|${m.tipo === 'cargas' ? 1 : 0}|${m.hora}`;
  return out.sort((a, b) => orden(b).localeCompare(orden(a)) || a.cuentaNombre.localeCompare(b.cuentaNombre));
};

/** Movimientos con fecha dentro de [desde, hasta] (AAAA-MM-DD; vacío = sin límite). */
export const movimientosEnRango = (movs: readonly MovimientoDiesel[], desde: string, hasta: string): MovimientoDiesel[] =>
  movs.filter((m) => (!desde || m.fecha >= desde) && (!hasta || m.fecha <= hasta));

/** Totales de una lista: saldo agregado, cargado y número de cargas. */
export const resumenDiesel = (movs: readonly MovimientoDiesel[]) => {
  let abonos = 0;
  let cargos = 0;
  let cargas = 0;
  movs.forEach((m) => { abonos += aCentavos(m.abono); cargos += aCentavos(m.cargo); cargas += m.cargas; });
  return { abonos: deCentavos(abonos), cargos: deCentavos(cargos), cargas };
};

/** Las cargas de un día que descuentan de la cuenta (para el detalle de la fila). */
export const cargasDelDia = (refs: readonly Datos[], cuenta: Pick<CuentaDieselMov, 'clave' | 'nombre'>, fecha: string): CargaDiesel[] =>
  refs
    .filter((r) => fechaDe(r.fecha) === fecha && cargadoDiesel(r) > 0 && esDeCuenta(r, cuenta))
    .map((r) => ({
      id: String(r.id ?? ''),
      consecutivo: String(r.consecutivo || r.id || ''),
      unidad: String(r.unidadNombre || r.unidad || '—'),
      proveedor: String(r.proveedorNombre || '—'),
      galones: Number(r.galonesCargados) || 0,
      costo: Number(r.costoDiesel) || 0,
      total: cargadoDiesel(r),
      estimado: cobroEstimado(r).cobrado,
    }))
    .sort((a, b) => a.consecutivo.localeCompare(b.consecutivo, 'es', { numeric: true }));

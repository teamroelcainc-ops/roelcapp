// src/features/operaciones/services/convenioFalso.ts
// ---------------------------------------------------------------------------
// ✅ V00511 — FALSO AL 50% (lógica pura; la lectura de la operación está en convenioFalsoDatos.ts).
// Regla del usuario (29-oct), reemplaza la de la V00509 (cambiar al convenio Falso del cliente):
// cuando una operación ENTRA a un estatus "Falso" (el mismo reconocimiento del sueldo,
// utils/sueldoFalso.ts) se queda con el MISMO convenio y se cobra a la MITAD:
//   · cliente: montoConvenioCliente ÷ 2 → se recalcula el Por Cobrar;
//   · proveedor: totalAPagarProv ÷ 2 → se recalcula el Por Pagar.
// La utilidad estimada se recalcula con los dos. Los cargos adicionales no cambian.
// Lo que tenía queda en `mitadFalso` ({ cliente?: { antes, mitad }, proveedor?: { antes, mitad } })
// y, si la operación SALE de Falso (Regresar estatus, deshacer la marca), regresa al 100%, salvo
// que alguien lo haya cambiado a mano mientras tanto (entonces solo se olvida el respaldo).
// No se toca un lado ya facturado (su factura se emitió con ese monto: se avisa), ni el cobro de una
// operación que ya trae un convenio Falso (ya es la tarifa de Falso). Solo de aquí en adelante: las
// que ya estaban en Falso antes de la V00511 se quedan como están.
// Compatibilidad V00509: una operación que entró a Falso con el convenio Falso del cliente
// (`convenioAntesFalso`) regresa a su convenio de antes al salir de Falso, como en la V00509.
// ---------------------------------------------------------------------------
import { ID_MXN } from '../../../shared/dominio/constantes';
import { conversionOperacion } from '../../../shared/dominio/dinero';
import type { Lado } from '../../../shared/dominio/dinero';
import { monedaCanonica } from '../../../shared/dominio/moneda';
import { facturadaCliente, facturadaProveedor } from '../../../shared/dominio/operacionCanonica';
import { normalizarTexto } from '../../../shared/dominio/texto';
import { esStatusFalso } from '../../../utils/sueldoFalso';

type Datos = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => Number(v) || 0;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const objeto = (v: unknown): Datos | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Datos) : null);

export const esConvenioFalso = (nombre: unknown): boolean => /\bfalso\b/.test(normalizarTexto(nombre));

export interface AjusteConvenio {
  /** Campos a fusionar en la escritura del estatus ({} = nada). */
  cambios: Datos;
  /** Qué pasó, para el aviso ('' = nada que decir). */
  mensaje: string;
  tipo: 'info' | 'alerta' | null;
}
export const SIN_AJUSTE: AjusteConvenio = { cambios: {}, mensaje: '', tipo: null };

/** ¿Entra o sale de Falso? (solo entonces hay que revisar los montos). */
export const cambiaFalso = (statusAnterior: unknown, statusNuevo: unknown): boolean => esStatusFalso(statusAnterior) !== esStatusFalso(statusNuevo);

// ── Montos de cada lado ────────────────────────────────────────────────────
interface LadoFalso {
  lado: Lado;
  nombre: string;
  campoMonto: 'montoConvenioCliente' | 'totalAPagarProv';
  campoMoneda: 'monedaConvenioCliente' | 'monedaConvenioProv';
  facturada: (op: Datos) => boolean;
  /** Campos del Por Cobrar / Por Pagar que guarda el formulario. */
  derivados: readonly ['subtotalCliente' | 'subtotalProv', 'dolaresCliente' | 'dolaresProv', 'pesosCliente' | 'pesosProv', 'conversionCliente' | 'conversionProv'];
  cargos: 'cargosAdicionales' | 'cargosAdicionalesProv';
}
const CLIENTE: LadoFalso = {
  lado: 'cliente', nombre: 'cliente', campoMonto: 'montoConvenioCliente', campoMoneda: 'monedaConvenioCliente', facturada: facturadaCliente,
  derivados: ['subtotalCliente', 'dolaresCliente', 'pesosCliente', 'conversionCliente'], cargos: 'cargosAdicionales',
};
const PROVEEDOR: LadoFalso = {
  lado: 'proveedor', nombre: 'proveedor', campoMonto: 'totalAPagarProv', campoMoneda: 'monedaConvenioProv', facturada: facturadaProveedor,
  derivados: ['subtotalProv', 'dolaresProv', 'pesosProv', 'conversionProv'], cargos: 'cargosAdicionalesProv',
};

const dinero = (n: number, monedaId: unknown): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${monedaId === ID_MXN || monedaCanonica(monedaId) === 'MXN' ? 'MXN' : 'USD'}`;

/**
 * Por Cobrar / Por Pagar del lado con el monto nuevo, con la regla única (conversionOperacion).
 * Si la regla no puede calcular (falta el T.C.) pero había valores guardados, se escalan en la
 * misma proporción que cambió (monto + cargos): la conversión es lineal.
 */
const derivadosLado = (L: LadoFalso, op: Datos, montoNuevo: number): Datos => {
  const nueva = { ...op, [L.campoMonto]: montoNuevo };
  const m = conversionOperacion(nueva, L.lado);
  const [sub, dol, pes, conv] = L.derivados;
  if (m.conv > 0 || num(op[conv]) === 0) return { [sub]: m.total, [dol]: m.dol, [pes]: m.pes, [conv]: m.conv };
  const antes = num(op[L.campoMonto]) + num(op[L.cargos]);
  const f = antes > 0 ? (montoNuevo + num(op[L.cargos])) / antes : 1;
  return { [sub]: r2(num(op[sub]) * f), [dol]: r2(num(op[dol]) * f), [pes]: r2(num(op[pes]) * f), [conv]: r2(num(op[conv]) * f) };
};

/** Monto nuevo por lado → campos a escribir (montos, derivados y utilidad). */
const camposDinero = (op: Datos, montos: Partial<Record<Lado, number>>): Datos => {
  const out: Datos = {};
  ([CLIENTE, PROVEEDOR] as const).forEach((L) => {
    const m = montos[L.lado];
    if (m === undefined) return;
    Object.assign(out, { [L.campoMonto]: m }, derivadosLado(L, op, m));
  });
  const convCliente = 'conversionCliente' in out ? num(out.conversionCliente) : num(op.conversionCliente);
  const convProv = 'conversionProv' in out ? num(out.conversionProv) : num(op.conversionProv);
  out.utilidadEstimada = r2(convCliente - convProv);
  return out;
};

const unir = (partes: string[]): string => partes.filter(Boolean).join(' ');

// ── Ajuste al cambiar el estatus ───────────────────────────────────────────
const alEntrar = (op: Datos, ref: string): AjusteConvenio => {
  if (objeto(op.mitadFalso)) return SIN_AJUSTE; // ya se aplicó
  const montos: Partial<Record<Lado, number>> = {};
  const respaldo: Datos = {};
  const hechos: string[] = [];
  const avisos: string[] = [];
  ([CLIENTE, PROVEEDOR] as const).forEach((L) => {
    const antes = num(op[L.campoMonto]);
    if (!(antes > 0)) return;
    if (L.lado === 'cliente' && esConvenioFalso(op.convenioNombre)) {
      avisos.push(`Ya trae un convenio Falso ("${txt(op.convenioNombre)}"): el cobro al cliente se queda en ${dinero(antes, op[L.campoMoneda])}.`);
      return;
    }
    if (L.facturada(op)) {
      avisos.push(`Ya está facturada al ${L.nombre}: se queda en ${dinero(antes, op[L.campoMoneda])}; ajústalo en su factura si hace falta.`);
      return;
    }
    const mitad = r2(antes / 2);
    montos[L.lado] = mitad;
    respaldo[L.lado] = { antes, mitad };
    hechos.push(`${L.nombre} ${dinero(mitad, op[L.campoMoneda])} (antes ${dinero(antes, op[L.campoMoneda])})`);
  });
  if (!hechos.length) return avisos.length ? { cambios: {}, tipo: 'alerta', mensaje: unir([`${ref} en Falso:`, ...avisos]) } : SIN_AJUSTE;
  return {
    cambios: { ...camposDinero(op, montos), mitadFalso: respaldo },
    tipo: avisos.length ? 'alerta' : 'info',
    mensaje: unir([`${ref} en Falso se cobra al 50%: ${hechos.join(' · ')}.`, ...avisos]),
  };
};

const alSalir = (op: Datos, ref: string): AjusteConvenio => {
  const resp = objeto(op.mitadFalso);
  if (!resp) return SIN_AJUSTE;
  const montos: Partial<Record<Lado, number>> = {};
  const hechos: string[] = [];
  const avisos: string[] = [];
  ([CLIENTE, PROVEEDOR] as const).forEach((L) => {
    const r = objeto(resp[L.lado]);
    if (!r) return;
    const antes = num(r.antes);
    const actual = num(op[L.campoMonto]);
    if (actual !== num(r.mitad)) return; // lo cambiaron a mano: se queda como está
    if (L.facturada(op)) {
      avisos.push(`Ya está facturada al ${L.nombre}: se queda al 50% (${dinero(actual, op[L.campoMoneda])}); ajústalo en su factura si hace falta.`);
      return;
    }
    montos[L.lado] = antes;
    hechos.push(`${L.nombre} ${dinero(antes, op[L.campoMoneda])}`);
  });
  const cambios: Datos = { ...(hechos.length ? camposDinero(op, montos) : {}), mitadFalso: null };
  if (!hechos.length && !avisos.length) return { cambios, tipo: null, mensaje: '' };
  return {
    cambios,
    tipo: avisos.length ? 'alerta' : 'info',
    mensaje: unir([hechos.length ? `${ref} salió de Falso y regresa al 100%: ${hechos.join(' · ')}.` : `${ref} salió de Falso.`, ...avisos]),
  };
};

/** V00509: la que entró a Falso cambiando al convenio Falso del cliente regresa a su convenio de antes. */
const alSalirV00509 = (op: Datos, ref: string): AjusteConvenio | null => {
  const antes = objeto(op.convenioAntesFalso);
  if (!antes || !txt(antes.convenio)) return null;
  if (!esConvenioFalso(op.convenioNombre)) return { cambios: { convenioAntesFalso: null }, mensaje: '', tipo: null };
  if (facturadaCliente(op)) return { cambios: {}, tipo: 'alerta', mensaje: `${ref} ya está facturada al cliente: su convenio se queda en "${txt(op.convenioNombre)}".` };
  const base: Datos = {
    convenio: txt(antes.convenio), convenioNombre: txt(antes.convenioNombre), monedaConvenioCliente: txt(antes.monedaConvenioCliente), convenioAntesFalso: null,
  };
  return {
    cambios: { ...base, ...camposDinero({ ...op, ...base }, { cliente: num(antes.montoConvenioCliente) }) },
    tipo: 'info', mensaje: `${ref}: regresó a su convenio "${txt(antes.convenioNombre)}".`,
  };
};

/**
 * Campos que cambian en la operación al pasar de `statusAnterior` a `statusNuevo`.
 * `op` = la operación como está (lo más fresca posible: decide montos).
 */
export const ajusteConvenioPorStatus = (op: Datos, statusNuevo: unknown, statusAnterior: unknown = op.statusNombre): AjusteConvenio => {
  if (!cambiaFalso(statusAnterior, statusNuevo)) return SIN_AJUSTE;
  const ref = txt(op.ref) || 'La operación';
  if (esStatusFalso(statusNuevo)) return alEntrar(op, ref);
  return alSalirV00509(op, ref) ?? alSalir(op, ref);
};

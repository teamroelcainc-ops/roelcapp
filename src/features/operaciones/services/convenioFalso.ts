// src/features/operaciones/services/convenioFalso.ts
// ---------------------------------------------------------------------------
// ✅ V00509 — CONVENIO DE FALSO (lógica pura; las lecturas están en convenioFalsoDatos.ts).
// Cuando una operación pasa a un estatus "Falso" (el mismo reconocimiento del sueldo a la mitad,
// utils/sueldoFalso.ts), su convenio del cliente cambia al convenio Falso del MISMO cliente y del
// mismo sentido: un convenio de exportación → el Falso de exportación; de importación → el Falso de
// importación. Con él cambian el monto y la moneda del convenio, y el Por Cobrar se recalcula con la
// regla única (conversionOperacion). El convenio anterior queda en `convenioAntesFalso` y, si la
// operación sale de Falso (Regresar estatus, deshacer la marca), regresa.
// No se toca: una operación ya facturada al cliente (su factura ya se emitió con ese monto), ni una
// que ya trae un convenio Falso. Sin convenio Falso del cliente para ese sentido, solo se avisa.
// La lista de convenios del cliente es la del formulario de operación (maestros, detalles sueltos y
// líneas de sus tarifarios; sin los Inactivos ni Cancelados).
// ---------------------------------------------------------------------------
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { conversionOperacion } from '../../../shared/dominio/dinero';
import { monedaCanonica } from '../../../shared/dominio/moneda';
import { facturadaCliente } from '../../../shared/dominio/operacionCanonica';
import { normalizarTexto } from '../../../shared/dominio/texto';
import { claveConsecutivo } from '../../../utils/claveConsecutivo';
import { esStatusFalso } from '../../../utils/sueldoFalso';
import { movimientoDeOperacion } from './clasificacionOperacion';

type Datos = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => Number(v) || 0;
const r2 = (n: number): number => Math.round(n * 100) / 100;

export type Sentido = 'importacion' | 'exportacion';
const NOMBRE_SENTIDO: Record<Sentido, string> = { importacion: 'importación', exportacion: 'exportación' };

export interface CatalogosConvenio {
  /** convenios_clientes */
  maestros: readonly Datos[];
  /** convenios_clientes_detalles */
  detalles: readonly Datos[];
  /** catalogo_tarifas_referencia (el nombre del convenio sale de su tarifa) */
  tarifas: readonly Datos[];
  /** tarifario_clientes */
  tarifarios: readonly Datos[];
}

export interface ConvenioCliente { id: string; nombre: string; moneda: string; monto: number; consecutivo: string }

/** Sentido de un texto: "impo" → importación, "expo" → exportación (el que aparezca primero). */
export const sentidoDe = (v: unknown): Sentido | null => {
  const t = normalizarTexto(v);
  const i = t.indexOf('impo');
  const e = t.indexOf('expo');
  if (i < 0 && e < 0) return null;
  if (e < 0 || (i >= 0 && i < e)) return 'importacion';
  return 'exportacion';
};

export const esConvenioFalso = (nombre: unknown): boolean => /\bfalso\b/.test(normalizarTexto(nombre));

// ── Convenios del cliente (misma relación que el formulario de operación) ─────
const refMaestro = (d: Datos): string => txt(d.convenioId ?? d.convenio ?? d.id_convenio ?? d.convenioClienteId ?? d.convenioProveedorId ?? d.maestroId ?? d.padreId ?? d.convenio_id);
const duenoDetalle = (d: Datos): string => txt(d.clienteId ?? d.cliente ?? d.id_cliente ?? d.clientePaga ?? d.empresaId);
const duenoMaestro = (m: Datos): string => txt(m.clienteId ?? m.cliente ?? m.id_cliente ?? m.clientePaga ?? m.empresaId ?? m.empresa);
const montoDetalle = (d: Datos): number => num(d.tarifa ?? d.monto ?? d.precio ?? d.importe ?? d.costo ?? d.montoConvenio ?? d.monto_convenio ?? d.tarifaMonto ?? d.valor);
const tarifaDe = (d: Datos): string => txt(d.tipoConvenioId || d.tipo_convenio_id || d.tipoConvenio || d.tipo_convenio || d.tarifaId || d.tarifa_id || d['TIPO DE CONVENIO']);
const FUERA = ['Inactivo', 'Cancelado'];

export const conveniosDelCliente = (clienteId: string, cat: CatalogosConvenio): ConvenioCliente[] => {
  const cid = txt(clienteId);
  if (!cid) return [];
  const maestros = cat.maestros.filter((m) => duenoMaestro(m) === cid);
  const idsMaestro = new Set<string>();
  maestros.forEach((m) => [m.id, m.numeroConvenio, m.numero].map(txt).filter(Boolean).forEach((x) => idsMaestro.add(x)));
  const union = new Map<string, Datos>();
  cat.detalles.forEach((d) => {
    const ref = refMaestro(d);
    if ((ref && idsMaestro.has(ref)) || duenoDetalle(d) === cid) union.set(txt(d.id), d);
  });
  // Líneas de los tarifarios del cliente (V00428): también son fuente, y su status manda.
  const statusLinea = new Map<string, string>();
  const porId = new Map(cat.detalles.map((d) => [txt(d.id), d] as const));
  const porNumero = new Map<string, Datos>();
  cat.detalles.forEach((d) => { const k = claveConsecutivo(d.consecutivo || d.id); if (k && !porNumero.has(k)) porNumero.set(k, d); });
  const tarifarios = cat.tarifarios.filter((t) => txt(t.clienteId) === cid && !FUERA.includes(txt(t.status)));
  const idsTarifario = new Set<string>();
  tarifarios.forEach((t) => {
    [t.id, t.consecutivo].map(txt).filter(Boolean).forEach((x) => idsTarifario.add(x));
    (Array.isArray(t.tarifas) ? t.tarifas : []).forEach((l: unknown) => {
      const linea = (l && typeof l === 'object' ? l : {}) as Datos;
      const cc = txt(linea.consecutivo);
      const d = cc ? porId.get(cc) ?? porNumero.get(claveConsecutivo(cc)) : undefined;
      if (!d) return;
      union.set(txt(d.id), d);
      if (txt(linea.status)) statusLinea.set(txt(d.id), txt(linea.status));
    });
  });
  cat.detalles.forEach((d) => { if (idsTarifario.has(txt(d.tarifarioId))) union.set(txt(d.id), d); });

  const tarifaPorId = new Map(cat.tarifas.map((t) => [txt(t.id), t] as const));
  return Array.from(union.values())
    .filter((d) => !FUERA.includes(statusLinea.get(txt(d.id)) || txt(d.status)))
    .map((d) => {
      const t = tarifaPorId.get(tarifaDe(d));
      const nombre = txt(d.tipoConvenioNombre) || txt(t?.descripcion || t?.nombre || t?.tarifa || t?.concepto || t?.tipo);
      const maestro = maestros.find((m) => [m.id, m.numeroConvenio, m.numero].map(txt).includes(refMaestro(d)));
      const moneda = monedaCanonica(d.moneda) ?? monedaCanonica(maestro?.monedaId ?? maestro?.moneda) ?? 'USD';
      return { id: txt(d.id), nombre, moneda: moneda === 'MXN' ? ID_MXN : ID_USD, monto: montoDetalle(d), consecutivo: txt(d.consecutivo || d.id) };
    })
    .filter((c) => c.id && c.nombre);
};

const segmentos = (nombre: string): string[] => nombre.split(' - ').map(normalizarTexto).filter(Boolean);

/** Sentido de la operación: el de su convenio y, si no lo dice, su tráfico o su clasificación (Estadísticas). */
export const sentidoDeOperacion = (op: Datos): Sentido | null => {
  const porConvenio = sentidoDe(op.convenioNombre) ?? sentidoDe(op.trafico);
  if (porConvenio) return porConvenio;
  const mov = movimientoDeOperacion(op);
  return mov === 'Importación' ? 'importacion' : mov === 'Exportación' ? 'exportacion' : null;
};

/** El convenio Falso del cliente para ese sentido: el que más se parece al actual (mismos segmentos). */
export const convenioFalsoPara = (op: Datos, lista: readonly ConvenioCliente[]): ConvenioCliente | null => {
  const sentido = sentidoDeOperacion(op);
  if (!sentido) return null;
  const actual = new Set(segmentos(txt(op.convenioNombre)));
  const puntos = (c: ConvenioCliente) => segmentos(c.nombre).filter((s) => actual.has(s)).length;
  const numero = (c: ConvenioCliente) => Number(claveConsecutivo(c.consecutivo)) || Number.MAX_SAFE_INTEGER;
  return lista
    .filter((c) => esConvenioFalso(c.nombre) && sentidoDe(c.nombre) === sentido)
    .sort((a, b) => puntos(b) - puntos(a) || a.nombre.length - b.nombre.length || numero(a) - numero(b))[0] ?? null;
};

// ── Ajuste al cambiar el estatus ───────────────────────────────────────────
export interface AjusteConvenio {
  /** Campos a fusionar en la escritura del estatus ({} = nada). */
  cambios: Datos;
  /** Qué pasó, para el aviso ('' = nada que decir). */
  mensaje: string;
  tipo: 'info' | 'alerta' | null;
}
export const SIN_AJUSTE: AjusteConvenio = { cambios: {}, mensaje: '', tipo: null };

/** ¿Entra o sale de Falso? (solo entonces hay que leer convenios). */
export const cambiaFalso = (statusAnterior: unknown, statusNuevo: unknown): boolean => esStatusFalso(statusAnterior) !== esStatusFalso(statusNuevo);

/** Por Cobrar recalculado con la regla única (lo mismo que guarda el formulario). */
const porCobrar = (op: Datos): Datos => {
  const m = conversionOperacion(op, 'cliente');
  return { subtotalCliente: m.total, dolaresCliente: m.dol, pesosCliente: m.pes, conversionCliente: m.conv, utilidadEstimada: r2(m.conv - num(op.conversionProv)) };
};

const moneda = (n: number, monedaId: string): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${monedaId === ID_MXN ? 'MXN' : 'USD'}`;

/**
 * Campos que cambian en la operación al pasar de `statusAnterior` a `statusNuevo`.
 * `op` = la operación como está (lo más fresco posible).
 */
export const ajusteConvenioPorStatus = (op: Datos, statusNuevo: unknown, cat: CatalogosConvenio, statusAnterior: unknown = op.statusNombre): AjusteConvenio => {
  if (!cambiaFalso(statusAnterior, statusNuevo)) return SIN_AJUSTE;
  const ref = txt(op.ref) || 'La operación';
  if (esStatusFalso(statusNuevo)) {
    if (esConvenioFalso(op.convenioNombre)) return SIN_AJUSTE;
    if (facturadaCliente(op)) return { cambios: {}, tipo: 'alerta', mensaje: `${ref} ya está facturada al cliente: su convenio se queda como está (no se cambió al de Falso).` };
    const sentido = sentidoDeOperacion(op);
    if (!sentido) return { cambios: {}, tipo: 'alerta', mensaje: `${ref}: su convenio no dice si es de importación o de exportación, así que no se cambió al de Falso.` };
    const falso = convenioFalsoPara(op, conveniosDelCliente(txt(op.clientePagaId) || txt(op.clientePaga), cat));
    const cliente = txt(op.clientePagaNombre) || txt(op.clienteNombre) || 'El cliente';
    if (!falso) return { cambios: {}, tipo: 'alerta', mensaje: `${cliente} no tiene convenio Falso de ${NOMBRE_SENTIDO[sentido]}: el convenio de ${ref} no se cambió.` };
    const base: Datos = {
      convenio: falso.id, convenioNombre: falso.nombre, montoConvenioCliente: falso.monto, monedaConvenioCliente: falso.moneda,
      convenioAntesFalso: {
        convenio: txt(op.convenio), convenioNombre: txt(op.convenioNombre),
        montoConvenioCliente: num(op.montoConvenioCliente), monedaConvenioCliente: txt(op.monedaConvenioCliente),
      },
    };
    return { cambios: { ...base, ...porCobrar({ ...op, ...base }) }, tipo: 'info', mensaje: `${ref}: el convenio cambió a "${falso.nombre}" (${moneda(falso.monto, falso.moneda)}).` };
  }
  // Sale de Falso: regresa el convenio que tenía (si se cambió aquí y nadie lo cambió después).
  const antes = op.convenioAntesFalso && typeof op.convenioAntesFalso === 'object' ? (op.convenioAntesFalso as Datos) : null;
  if (!antes || !txt(antes.convenio)) return SIN_AJUSTE;
  if (!esConvenioFalso(op.convenioNombre)) return { cambios: { convenioAntesFalso: null }, mensaje: '', tipo: null };
  if (facturadaCliente(op)) return { cambios: {}, tipo: 'alerta', mensaje: `${ref} ya está facturada al cliente: su convenio se queda en "${txt(op.convenioNombre)}".` };
  const base: Datos = {
    convenio: txt(antes.convenio), convenioNombre: txt(antes.convenioNombre),
    montoConvenioCliente: num(antes.montoConvenioCliente), monedaConvenioCliente: txt(antes.monedaConvenioCliente), convenioAntesFalso: null,
  };
  return { cambios: { ...base, ...porCobrar({ ...op, ...base }) }, tipo: 'info', mensaje: `${ref}: regresó a su convenio "${txt(antes.convenioNombre)}".` };
};

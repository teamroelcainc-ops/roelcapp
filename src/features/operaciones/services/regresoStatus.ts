// src/features/operaciones/services/regresoStatus.ts
// ---------------------------------------------------------------------------
// ✅ V00476 — REGRESAR EL ESTATUS de una operación completada o en Falso (lógica pura).
//   · opcionesDeRegreso → los estatus a los que puede regresar: los del flujo de la operación
//     (Reglas de Estatus, en orden); sin flujo, los de su bitácora; sin bitácora, el catálogo.
//     Nunca el estatus actual ni uno de cancelación (cancelar tiene su propio camino).
//   · efectosDelRegreso → lo que pasa al regresar: si vuelve a Operaciones Activas, cómo queda el
//     sueldo del operador (Falso = mitad) y a qué referencias sigue ligada.
// La escritura está en regresoStatusDatos.ts.
// ---------------------------------------------------------------------------
import { normalizarNombreFlujo } from '../../../shared/dominio/flujos';
import { estadoGrupoDe, esGrupoTerminado, facturadaCliente, facturadaProveedor } from '../../../shared/dominio/operacionCanonica';
import { ajusteOperadorPorStatus } from '../../../utils/sueldoFalso'; // ✅ V00511: sueldo y diesel de Falso
import { ajusteConvenioPorStatus } from './convenioFalso';

type Datos = Record<string, unknown>;

/** Origen del aviso de operacionesBus: Operaciones Activas agrega la operación que regresó. */
export const ORIGEN_REGRESO_STATUS = 'regreso-status';

/** Lo que se usa de un documento de `horarios`. */
export interface HorarioResumen {
  status?: unknown;
  statusNombre?: unknown;
  fechaHora?: unknown;
}

export interface OpcionRegreso {
  nombre: string;
  /** Última vez que la operación pasó por este estatus (fechaHora del horario) o ''. */
  ultimaVez: string;
  /** Completado o Falso: la operación se queda en Servicios Completados. */
  terminado: boolean;
}

export interface StatusResuelto { id: string; nombre: string }

/** Completado o Falso (misma regla que Activas / Completados / Cancelados). */
export const statusTerminado = (s: StatusResuelto): boolean => esGrupoTerminado(estadoGrupoDe({ status: s.id, statusNombre: s.nombre }, s.nombre));

const esCancelacion = (nombre: string): boolean => normalizarNombreFlujo(nombre).includes('cancel');

/**
 * Estatus a los que puede regresar la operación, en el orden del flujo (o de la bitácora).
 * @param resolver nombre → {id, nombre} del catálogo de estatus (para saber si es terminado).
 */
export const opcionesDeRegreso = (args: {
  flujo: readonly string[] | null;
  historial: readonly HorarioResumen[];
  catalogo: readonly string[];
  actual: string;
  resolver: (nombre: string) => StatusResuelto;
}): OpcionRegreso[] => {
  const { flujo, historial, catalogo, actual, resolver } = args;
  const nombreDe = (h: HorarioResumen): string => String(h.statusNombre || '').trim() || resolver(String(h.status || '')).nombre;
  const cronologico = [...historial].sort((a, b) => String(a.fechaHora || '').localeCompare(String(b.fechaHora || '')));
  const ultima = new Map<string, string>();
  cronologico.forEach((h) => { const n = normalizarNombreFlujo(nombreDe(h)); if (n) ultima.set(n, String(h.fechaHora || '')); });

  const deBitacora = cronologico.map(nombreDe);
  const base = flujo && flujo.length > 0 ? flujo : deBitacora.some(Boolean) ? deBitacora : catalogo;
  const actualNorm = normalizarNombreFlujo(actual);
  const vistos = new Set<string>();
  const opciones: OpcionRegreso[] = [];
  for (const crudo of base) {
    const nombre = String(crudo || '').trim();
    const n = normalizarNombreFlujo(nombre);
    if (!n || n === actualNorm || vistos.has(n) || esCancelacion(nombre)) continue;
    vistos.add(n);
    opciones.push({ nombre, ultimaVez: ultima.get(n) || '', terminado: statusTerminado(resolver(nombre)) });
  }
  return opciones;
};

const fmt = (n: number): string => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const txt = (v: unknown): string => String(v ?? '').trim();

export interface EfectosRegreso {
  /** Deja Servicios Completados y vuelve a Operaciones Activas. */
  vuelveAActivas: boolean;
  /** Cómo cambian el sueldo, el diesel y los montos por entrar o salir de Falso ('' si no cambian). ✅ V00511 */
  sueldo: string;
  /** Referencias a las que la operación sigue ligada (no se tocan al regresar). */
  conexiones: string[];
}

export const efectosDelRegreso = (op: Datos, destino: StatusResuelto): EfectosRegreso => {
  const ajuste = ajusteOperadorPorStatus(op, destino.nombre);
  const partes: string[] = [];
  if (typeof ajuste.sueldoOperador === 'number') {
    partes.push(ajuste.sueldoMitadAplicada === true
      ? `En Falso el sueldo del operador queda en ${fmt(ajuste.sueldoOperador)}.`
      : `El sueldo del operador regresa al completo: ${fmt(ajuste.sueldoOperador)}.`);
  }
  // ✅ V00511: diesel de Falso (galones) y cobro al 50% (con la copia de la lista: solo es el aviso
  //   previo; al aplicar se recalcula con la operación actual dentro de la transacción).
  if (typeof ajuste.combustible === 'number') {
    partes.push(ajuste.combustibleFalsoAplicado === true
      ? `El diesel queda en ${ajuste.combustible} galones.`
      : `El diesel regresa a ${ajuste.combustible} galones.`);
  }
  const montos = ajusteConvenioPorStatus(op, destino.nombre);
  if (montos.mensaje) partes.push(montos.mensaje);
  const sueldo = partes.join(' ');
  const conexiones: string[] = [];
  if (facturadaCliente(op)) conexiones.push(`Factura del cliente ${txt(op.facturaClienteInvoice)}`.trim());
  if (facturadaProveedor(op)) conexiones.push(`Factura del proveedor ${txt(op.facturaProveedorFolio)}`.trim());
  if (txt(op.referenciaNominaConsecutivo) || txt(op.referenciaNominaId)) conexiones.push(`Nómina ${txt(op.referenciaNominaConsecutivo)}`.trim());
  if (txt(op.referenciaDieselConsecutivo) || txt(op.referenciaDieselId)) conexiones.push(`Diésel ${txt(op.referenciaDieselConsecutivo)}`.trim());
  return { vuelveAActivas: !statusTerminado(destino), sueldo, conexiones };
};

/** "2026-10-22T09:10" → "22/10/2026 09:10" (lo demás, tal cual). */
export const fechaHoraCorta = (v: unknown): string => {
  const s = txt(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
};

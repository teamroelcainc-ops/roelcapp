// src/features/operaciones/services/refClienteDuplicado.ts
// ---------------------------------------------------------------------------
// ✅ V00450 — REF CLIENTE DUPLICADA (lógica pura, sin Firebase ni React).
//
// Regla acordada con el negocio:
//   · Duplicada = la MISMA Ref Cliente en otra operación, de CUALQUIER cliente.
//   · Se compara sin mayúsculas/minúsculas ni espacios ("po 123" = "PO123").
//   · No cuentan: Ref vacía o de relleno ("N/A", "NA", "-", "S/R", "0"…), las
//     operaciones canceladas y las de prueba.
//   · "No es duplicado": la operación guarda `refClienteRevisado` = la clave de
//     su Ref en ese momento. Si después cambia la Ref, se vuelve a revisar.
// La consulta al servidor y la escritura viven en refClienteDuplicadoServidor.ts.
// ---------------------------------------------------------------------------
import { esOperacionPrueba, estadoGrupoDe, facturadaCliente } from '../../../shared/dominio/operacionCanonica';
import type { EstadoGrupo } from '../../../shared/dominio/constantes';

type Datos = Record<string, unknown>;

/** Textos de relleno que NO son una referencia (ya sin espacios y en mayúsculas). */
const SIN_REF = new Set([
  'NA', 'N/A', 'N.A', 'N.A.', 'N-A', 'NOAPLICA', 'NOAPLICA.', 'SINREF', 'SINREFERENCIA', 'SR', 'S/R',
  'S/N', 'S-N', 'SN', 'N/D', 'N-D', 'ND', 'SIN', 'SINNUMERO', 'SINDATO', 'SINDATOS', 'NOTIENE', 'NODISPONIBLE',
  'NINGUNA', 'NINGUNO', 'PENDIENTE', 'PEND', 'TBD', 'TBA', 'NULL', 'UNDEFINED', 'NONE', 'XX', 'XXX', 'XXXX',
]);

/** Largo mínimo de una Ref Cliente para compararla (1–2 caracteres suelen ser relleno). */
export const LARGO_MINIMO_REF = 3;

/**
 * Clave de comparación de una Ref Cliente: sin espacios y en mayúsculas.
 * '' = no se compara (vacía, relleno o muy corta).
 */
export const claveRefCliente = (v: unknown): string => {
  if (v === null || v === undefined || typeof v === 'object') return '';
  const t = String(v).normalize('NFKC').toUpperCase().replace(/\s+/g, '');
  if (t.length < LARGO_MINIMO_REF) return '';
  if (SIN_REF.has(t)) return '';
  if (/^[-_./0#*]+$/.test(t)) return ''; // solo guiones, puntos, ceros…
  return t;
};

/**
 * Valores con los que se busca la Ref en Firestore (`where('refCliente', 'in', …)` compara
 * exacto): como está capturada, recortada, en mayúsculas, en minúsculas, sin espacios, con un
 * espacio entre letras y números ("PO 123"), con un espacio al final (copiado y pegado), y el
 * número si es puramente numérica (registros viejos la guardaban como número). Otras escrituras
 * solo se detectan si una de las dos operaciones está en la lista cargada.
 */
export const variantesConsulta = (v: unknown): (string | number)[] => {
  const clave = claveRefCliente(v);
  if (!clave) return [];
  const crudo = String(v);
  const t = crudo.trim();
  const separada = clave.replace(/([A-Z])(?=\d)|(\d)(?=[A-Z])/g, '$1$2 ');
  const textos = new Set([
    crudo, t, t.toUpperCase(), t.toLowerCase(), clave, clave.toLowerCase(),
    separada, separada.toLowerCase(), `${clave} `,
  ]);
  const valores: (string | number)[] = [...textos].filter((x) => x !== '');
  if (/^[1-9]\d{0,14}$/.test(clave)) valores.push(Number(clave));
  return valores;
};

/** Lo que se muestra y se escribe de cada operación de un grupo. */
export interface OpRefResumen {
  /** ID real del documento. */
  id: string;
  /** Consecutivo de la operación (TR-…, FL-…). */
  ref: string;
  /** Ref Cliente como está capturada. */
  refCliente: string;
  clave: string;
  clienteId: string;
  clienteNombre: string;
  fechaServicio: string;
  estado: EstadoGrupo;
  facturada: boolean;
  invoice: string;
  /** Marcada "No es duplicado" para ESTA Ref. */
  revisada: boolean;
}

/** Cuenta para la regla (no cancelada, no de prueba). */
export const cuentaParaDuplicado = (op: unknown): boolean => {
  if (!op || typeof op !== 'object') return false;
  if (esOperacionPrueba(op)) return false;
  return estadoGrupoDe(op as { status?: unknown; statusNombre?: unknown }) !== 'cancelada';
};

const texto = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());

export const resumenOp = (op: Datos, id: string): OpRefResumen => {
  const clave = claveRefCliente(op.refCliente);
  return {
    id,
    ref: texto(op.ref),
    refCliente: texto(op.refCliente),
    clave,
    clienteId: texto(op.clientePaga) || texto(op.clienteId),
    clienteNombre: texto(op.clienteNombre) || texto(op.clientePagaNombre),
    fechaServicio: texto(op.fechaServicio).slice(0, 10),
    estado: estadoGrupoDe(op as { status?: unknown; statusNombre?: unknown }),
    facturada: facturadaCliente(op),
    invoice: texto(op.facturaClienteInvoice),
    revisada: !!clave && claveRefCliente(op.refClienteRevisado) === clave,
  };
};

/** Lo que el tablero necesita de una operación con Ref duplicada. */
export interface InfoDuplicado {
  clave: string;
  /** ID real con el que se escribe (puede diferir del `id` de la lista en registros viejos). */
  idReal: string;
  /** Las OTRAS operaciones con la misma Ref. */
  otras: OpRefResumen[];
  revisada: boolean;
  /** Todas las del grupo (esta incluida): a quién se marca "No es duplicado". */
  grupo: OpRefResumen[];
}

/**
 * Cruza las operaciones de la lista (`locales`, su `id` es el de la lista) con lo que devolvió
 * el servidor por clave. `locales` trae TODA la lista (las que no cuentan van con clave ''): lo
 * local manda, así una operación de la lista que se canceló, quedó sin Ref o cambió de Ref no
 * sigue contando con la copia vieja del servidor.
 * Identidad: el ID; si el ID de la lista no volvió del servidor (registros viejos con un campo
 * `id` interno distinto del ID del documento), el consecutivo `ref`, solo si UNA sola operación
 * del servidor lo tiene (hay folios repetidos de la numeración vieja).
 * Una operación también cuenta como revisada si su copia del servidor lo está (la marcó otra
 * persona después de que se cargó la lista).
 * Devuelve, por `id` de la lista, solo las que SÍ tienen otra operación con la misma Ref.
 */
export const detectarDuplicados = (
  locales: readonly OpRefResumen[],
  delServidor: ReadonlyMap<string, readonly OpRefResumen[]>,
): Map<string, InfoDuplicado> => {
  // Índices del servidor.
  const servPorId = new Map<string, OpRefResumen[]>();
  const idsPorRef = new Map<string, Set<string>>();
  for (const lista of delServidor.values()) {
    for (const s of lista) {
      const xs = servPorId.get(s.id);
      if (xs) xs.push(s); else servPorId.set(s.id, [s]);
      if (s.ref) {
        const ids = idsPorRef.get(s.ref);
        if (ids) ids.add(s.id); else idsPorRef.set(s.ref, new Set([s.id]));
      }
    }
  }
  const idsLista = new Set(locales.map((l) => l.id));
  // ID de la lista → ID real en el servidor.
  const idReal = new Map<string, string>();
  for (const l of locales) {
    if (servPorId.has(l.id)) { idReal.set(l.id, l.id); continue; }
    const ids = l.ref ? idsPorRef.get(l.ref) : undefined;
    if (ids && ids.size === 1) {
      const unico = [...ids][0];
      if (!idsLista.has(unico)) idReal.set(l.id, unico);
    }
  }
  const deLaLista = new Set<string>([...idsLista, ...idReal.values()]);

  const porClave = new Map<string, OpRefResumen[]>();
  for (const l of locales) {
    if (!l.clave) continue;
    const g = porClave.get(l.clave);
    if (g) g.push(l); else porClave.set(l.clave, [l]);
  }
  const salida = new Map<string, InfoDuplicado>();
  for (const [clave, ls] of porClave) {
    const miembros: OpRefResumen[] = [];
    const vistos = new Set<string>();
    const revisadaEnServidor = (id: string): boolean =>
      (servPorId.get(id) ?? []).some((s) => s.clave === clave && s.revisada);
    for (const l of ls) {
      const id = idReal.get(l.id) ?? l.id;
      if (vistos.has(id)) continue;
      vistos.add(id);
      miembros.push({ ...l, id, revisada: l.revisada || revisadaEnServidor(id) });
    }
    for (const s of delServidor.get(clave) ?? []) {
      if (deLaLista.has(s.id) || vistos.has(s.id)) continue;
      vistos.add(s.id);
      miembros.push(s);
    }
    if (miembros.length < 2) continue;
    for (const l of ls) {
      const id = idReal.get(l.id) ?? l.id;
      const yo = miembros.find((m) => m.id === id);
      salida.set(l.id, { clave, idReal: id, otras: miembros.filter((m) => m.id !== id), revisada: !!yo?.revisada, grupo: miembros });
    }
  }
  return salida;
};

/** Texto corto para avisos: "RFT-123 (PO 55)". */
export const describirOp = (r: Pick<OpRefResumen, 'ref' | 'refCliente'>): string =>
  r.ref ? `${r.ref}${r.refCliente ? ` (${r.refCliente})` : ''}` : (r.refCliente || 'sin referencia');

/** Estado legible de una operación del grupo. */
export const etiquetaEstado = (r: Pick<OpRefResumen, 'estado' | 'facturada' | 'invoice'>): string => {
  if (r.facturada) return r.invoice ? `Facturada ${r.invoice}` : 'Facturada';
  if (r.estado === 'activa') return 'Activa';
  if (r.estado === 'falso') return 'Falso';
  if (r.estado === 'completada') return 'Completada';
  return 'Cancelada';
};

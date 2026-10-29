// src/features/operaciones/services/revisionDatosLectura.ts
// ---------------------------------------------------------------------------
// ✅ V00505 — LECTURAS de la Revisión de datos (la regla está en revisionDatos.ts). Solo lee y
// solo cuando el usuario presiona "Revisar":
//   · TODAS las operaciones (recorrerOperaciones, como el Excel de la V00500: la herramienta no
//     puede depender del formato de la fecha). Es la excepción documentada de "leer toda la
//     colección": la lanza el usuario a mano y avisa el avance.
//   · Las facturas de clientes del listener compartido (pagos:facturas_clientes): si Facturación o
//     Pagos ya lo tienen abierto, no cuesta lecturas nuevas.
//   · Empresas (moneda de cada cliente) y el catálogo de status, de los catálogos abiertos.
// El último resultado se queda en memoria durante la sesión (no en el navegador): al abrir un
// registro se cierra la ventana y al volver a abrirla sigue ahí.
// ✅ V00512:
//   · Se puede CANCELAR mientras lee (la señal corta el recorrido en la siguiente página).
//   · AL DÍA sin volver a leer todo: se guardan los datos de la revisión y se vuelven a revisar solo
//     los registros que pudieron cambiar: los que se abrieron desde la ventana (para corregirlos) y
//     las operaciones que la app avisa que se guardaron (operacionesBus). Se releen esos documentos
//     (unas cuantas lecturas) y se recalcula todo en memoria: lo corregido deja de mostrarse.
//     Las marcadas en F1 se actualizan sin leer (ya se sabe qué se escribió).
//   · El rango de fechas de la ventana se recuerda durante la sesión.
// ---------------------------------------------------------------------------
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { obtenerCatalogo } from '../../../shared/data/catalogos';
import { armarDoc, idReal, obtenerVivo } from '../../../shared/data/coleccionesVivas';
import { contarOperaciones, porIds, recorrerOperaciones } from '../../../shared/data/consultas';
import { obtenerFlags } from '../../../shared/data/flags';
import type { Moneda } from '../../../shared/dominio/moneda';
import { esOperacionPrueba } from '../../../shared/dominio/operacionCanonica';
import { suscribirOperacionGuardada } from '../../../utils/operacionesBus';
import { normalizarFacturaDe } from '../../facturacion/services/normalizarFactura';
import { consultaFacturasPagables } from '../../pagos/hooks/useFacturasPagables';
import { conNombreDeStatus } from './excelOperaciones';
import { leerMonedasEmpresas } from './monedasEmpresas';
import { revisarDatos } from './revisionDatos';
import type { CodigoRevision, ConfirmacionRevision, DestinoRevision, FacturaRevision, OpRevision, ResultadoRevision } from './revisionDatos';

type Datos = Record<string, unknown>;

export interface AvanceRevisionDatos { leidas: number; total: number }

export interface RevisionGuardada {
  resultado: ResultadoRevision;
  /** Cuándo se leyó todo. */
  en: Date;
  /** ✅ V00512: última vez que se volvieron a revisar registros sueltos (null = nunca). */
  actualizada: Date | null;
}

/** ✅ V00512: la señal con la que el botón Cancelar corta la lectura. */
export interface SenalRevision { cancelada: boolean }
export class RevisionCancelada extends Error {
  constructor() { super('Revisión cancelada'); this.name = 'RevisionCancelada'; }
}

interface DatosRevision {
  operaciones: OpRevision[];
  facturas: FacturaRevision[];
  monedaEmpresa: ReadonlyMap<string, Moneda>;
  reglaUnica: boolean;
  status: readonly { id: string; _docId?: string; nombre?: unknown }[];
}

let ultima: RevisionGuardada | null = null;
let datos: DatosRevision | null = null;
const pendientesOps = new Set<string>();
const pendientesFacturas = new Set<string>();
const oyentes = new Set<() => void>();
let bajaBus: (() => void) | null = null;

/** La última revisión de esta sesión (null si no se ha hecho). */
export const ultimaRevisionDatos = (): RevisionGuardada | null => ultima;

// ── Rango de fechas (se recuerda durante la sesión) ────────────────────────
export interface RangoRevision { desde: string; hasta: string }
let rango: RangoRevision = { desde: '', hasta: '' };
export const rangoRevisionDatos = (): RangoRevision => rango;
export const guardarRangoRevisionDatos = (r: RangoRevision): void => { rango = r; };

// ── Avisos a la ventana abierta ────────────────────────────────────────────
const avisarOyentes = (): void => { oyentes.forEach((cb) => { try { cb(); } catch (e) { console.error('[revisionDatos] oyente:', e); } }); };
/** La ventana se entera de que hay registros por volver a revisar. Devuelve cómo darse de baja. */
export const suscribirPendientesRevision = (cb: () => void): (() => void) => { oyentes.add(cb); return () => { oyentes.delete(cb); }; };
export const hayPendientesRevision = (): boolean => !!datos && (pendientesOps.size > 0 || pendientesFacturas.size > 0);

const buscarOp = (id: string): OpRevision | undefined => datos?.operaciones.find((o) => o.idDoc === id || String(o.id ?? '') === id);

/** Desde la ventana se abrió un registro (para corregirlo): al volver se revisa de nuevo. */
export const marcarParaRevisar = (d: DestinoRevision): void => {
  if (!datos) return;
  if (d.modulo === 'facturacionClientes') {
    const f = datos.facturas.find((x) => x.id === d.id || x.idDoc === d.id);
    if (f) pendientesFacturas.add(f.idDoc || f.id);
  } else {
    const op = buscarOp(d.id);
    if (op) pendientesOps.add(op.idDoc);
  }
};

const escucharGuardados = (): void => {
  if (bajaBus) return;
  bajaBus = suscribirOperacionGuardada((d) => {
    const op = buscarOp(d.id);
    if (!op) return; // nueva desde la revisión: entra en la próxima revisión completa
    pendientesOps.add(op.idDoc);
    avisarOyentes();
  });
};

const recalcular = (): RevisionGuardada | null => {
  if (!datos || !ultima) return ultima;
  const resultado = revisarDatos({ operaciones: datos.operaciones, facturas: datos.facturas, monedaEmpresa: datos.monedaEmpresa, reglaUnica: datos.reglaUnica });
  ultima = { resultado, en: ultima.en, actualizada: new Date() };
  return ultima;
};

const comoFactura = (f: Datos & { id: string }): FacturaRevision => ({ ...normalizarFacturaDe(f, 'cliente'), id: String(f.id), idDoc: idReal(f) });

/** Lee todo lo necesario y arma la revisión. Rechaza si algo no se pudo leer (no se muestra a medias) o si se canceló. */
export const leerYRevisarDatos = async (alAvanzar: (a: AvanceRevisionDatos) => void, senal: SenalRevision = { cancelada: false }): Promise<RevisionGuardada> => {
  const total = await contarOperaciones();
  if (senal.cancelada) throw new RevisionCancelada();
  alAvanzar({ leidas: 0, total });
  const operaciones: OpRevision[] = [];
  const { clave, crear } = consultaFacturasPagables('cliente', false);
  const [, crudas, monedaEmpresa, status, flags] = await Promise.all([
    recorrerOperaciones((docs) => {
      if (senal.cancelada) throw new RevisionCancelada(); // ✅ V00512: corta en la siguiente página
      docs.forEach((d) => { if (!esOperacionPrueba(d)) operaciones.push({ ...d, idDoc: idReal(d) }); });
    }, (leidas) => alAvanzar({ leidas, total })),
    obtenerVivo(clave, crear, 120000, { fresco: true }),
    leerMonedasEmpresas('cliente'),
    obtenerCatalogo('catalogo_status_servicio'),
    obtenerFlags(),
  ]);
  if (senal.cancelada) throw new RevisionCancelada();
  // ✅ V00510: también el id REAL del documento (para marcar las operaciones de F1 con su factura).
  datos = {
    operaciones: conNombreDeStatus(operaciones, status),
    facturas: crudas.map(comoFactura),
    monedaEmpresa,
    reglaUnica: flags.dineroPorServidor,
    status,
  };
  pendientesOps.clear();
  pendientesFacturas.clear();
  ultima = { resultado: revisarDatos(datos), en: new Date(), actualizada: null };
  escucharGuardados();
  return ultima;
};

export interface Refresco { revisada: RevisionGuardada; registros: number; antes: number; despues: number }

/**
 * ✅ V00512 — Vuelve a leer SOLO los registros pendientes (abiertos desde la ventana o guardados en
 * la app) y recalcula. null = no había nada que revisar. Si una operación o factura ya no existe
 * (se eliminó), sale de la revisión.
 */
export const refrescarRevisionDatos = async (): Promise<Refresco | null> => {
  if (!datos || !ultima || !hayPendientesRevision()) return null;
  const ids = Array.from(pendientesOps);
  const idsFac = Array.from(pendientesFacturas);
  pendientesOps.clear();
  pendientesFacturas.clear();
  try {
    const [ops, facs] = await Promise.all([
      porIds('operaciones', ids),
      Promise.all(idsFac.map(async (id) => {
        const s = await getDoc(doc(db, 'facturas_clientes', id));
        return { id, doc: s.exists() ? armarDoc(s.id, s.data() as Datos) : null };
      })),
    ]);
    const d = datos;
    const leidas = new Map(ops.map((o) => [idReal(o), o] as const));
    const frescas = conNombreDeStatus(Array.from(leidas.values()).filter((o) => !esOperacionPrueba(o)).map((o) => ({ ...o, idDoc: idReal(o) })), d.status);
    const porId = new Map(frescas.map((o) => [o.idDoc, o] as const));
    const fuera = new Set(ids.filter((id) => !leidas.has(id) || !porId.has(id)));
    d.operaciones = d.operaciones.filter((o) => !fuera.has(o.idDoc)).map((o) => porId.get(o.idDoc) ?? o);
    facs.forEach(({ id, doc: f }) => {
      const i = d.facturas.findIndex((x) => (x.idDoc || x.id) === id);
      if (!f) { if (i >= 0) d.facturas.splice(i, 1); return; }
      const nueva = comoFactura(f);
      if (i >= 0) d.facturas[i] = nueva; else d.facturas.push(nueva);
    });
    const antes = ultima.resultado.filas.length;
    const revisada = recalcular() as RevisionGuardada;
    return { revisada, registros: ids.length + idsFac.length, antes, despues: revisada.resultado.filas.length };
  } catch (e) {
    // No se pudo leer: se quedan pendientes para el siguiente intento.
    ids.forEach((id) => pendientesOps.add(id));
    idsFac.forEach((id) => pendientesFacturas.add(id));
    throw e;
  }
};

/**
 * ✅ V00518 — Confirmaciones (✓) que ya se escribieron (o se deshicieron, con null): se ponen en las
 * operaciones de la revisión sin leer y se recalcula (salen de su grupo o vuelven).
 */
export const aplicarConfirmacionesLocales = (codigo: CodigoRevision, marcas: ReadonlyMap<string, ConfirmacionRevision | null>): RevisionGuardada | null => {
  if (!datos || marcas.size === 0) return ultima;
  datos.operaciones = datos.operaciones.map((o) => {
    if (!marcas.has(o.idDoc)) return o;
    const previas = o.revisionOk && typeof o.revisionOk === 'object' ? { ...(o.revisionOk as Datos) } : {};
    const m = marcas.get(o.idDoc);
    if (m) previas[codigo] = m; else delete previas[codigo];
    return { ...o, revisionOk: previas };
  });
  return recalcular();
};

/** ✅ V00512 — Operaciones que ya se sabe cómo quedaron (las marcadas en F1): se actualizan sin leer y se recalcula. */
export const aplicarCambiosLocales = (cambios: ReadonlyMap<string, Datos>): RevisionGuardada | null => {
  if (!datos || cambios.size === 0) return ultima;
  datos.operaciones = datos.operaciones.map((o) => { const c = cambios.get(o.idDoc); return c ? { ...o, ...c } : o; });
  return recalcular();
};

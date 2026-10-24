// src/features/empresas/services/referenciasEmpresa.ts
// ---------------------------------------------------------------------------
// ✅ V00484 — LECTURA DE LA PESTAÑA REFERENCIAS de una empresa (antes vivía dentro del efecto de
// EmpresasDashboard): operaciones en cualquier papel, convenios, facturas y pagos ligados.
// La usan la carga al abrir la pestaña, el botón Actualizar y la relectura de UNA operación
// después de editarla desde la pestaña. Mismas consultas que antes (V00191 / V00443).
// ---------------------------------------------------------------------------
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { armarDoc, idReal } from '../../../shared/data/coleccionesVivas';
import { paginaOperacionesDeEmpresa, todasLasPaginas } from '../../../shared/data/consultas';
import { esOperacionPrueba } from '../../../utils/operacionPrueba';

/** Documento como lo pinta la pestaña: { id, ...datos } con el id real en `_docId` (idReal). */
export type DocReferencia = Record<string, unknown> & { id: string; _docId?: string };
/** Operación con los papeles de la empresa en ella (Cliente que Paga, Origen…). */
export type OperacionReferencia = DocReferencia & { _roles: string[] };

export interface ReferenciasEmpresa {
  operaciones: OperacionReferencia[];
  /** Tope alcanzado o error de la consulta de operaciones ('' si no hubo). */
  avisoOperaciones: string;
  convenios: DocReferencia[];
  facturas: DocReferencia[];
  pagos: DocReferencia[];
}

/** ✅ V00443 (Fase 7.6): tope de operaciones en la pestaña (las más recientes). */
export const TOPE_REFS_OPS = 3000;

const ROLES: readonly (readonly [string, string])[] = [
  ['clientePaga', 'Cliente que Paga'],
  ['clienteMercancia', 'Cliente (Mercancía)'],
  ['provServicios', 'Proveedor (Servicios)'],
  ['proveedorUnidad', 'Proveedor (Unidad)'],
  ['origen', 'Origen'],
  ['destino', 'Destino'],
];

/** Papeles de la empresa en la operación (por el ID canónico `<campo>Id` o, si no, el del campo). */
export const rolesDeOperacion = (op: Record<string, unknown>, idEmp: string): string[] =>
  ROLES.filter(([campo]) => String(op[`${campo}Id`] ?? op[campo] ?? '') === idEmp).map(([, etiqueta]) => etiqueta);

const conRoles = (d: DocReferencia, roles: string[]): OperacionReferencia =>
  // Object.assign sobre el mismo objeto: conserva `_docId` (no enumerable; un {...d} lo perdería).
  Object.assign(d, { _roles: roles });

const mensaje = (e: unknown): string => String((e as { message?: string })?.message || e);

const leerOperaciones = async (idEmp: string, consultasCanonicas: boolean): Promise<{ lista: OperacionReferencia[]; aviso: string }> => {
  const porOp = new Map<string, OperacionReferencia>();
  let aviso = '';
  if (consultasCanonicas) {
    // UNA consulta (empresasIds contiene la empresa, de la más reciente); el papel sale de los IDs
    // canónicos. Su propio try: si falla, convenios, facturas y pagos se muestran igual.
    try {
      const r = await todasLasPaginas((c) => paginaOperacionesDeEmpresa(idEmp, 500, c), TOPE_REFS_OPS);
      r.docs.filter((op) => !esOperacionPrueba(op)).forEach((op) => {
        porOp.set(idReal(op), conRoles(op, rolesDeOperacion(op, idEmp)));
      });
      if (r.truncado) aviso = `Se muestran las ${TOPE_REFS_OPS.toLocaleString('es-MX')} operaciones más recientes.`;
    } catch (e: unknown) {
      console.error('No se pudieron leer las operaciones de la empresa:', e);
      aviso = `No se pudieron leer las operaciones: ${mensaje(e)}`;
    }
  } else {
    await Promise.all(ROLES.map(async ([campo, etiqueta]) => {
      try {
        const snap = await getDocs(query(collection(db, 'operaciones'), where(campo, '==', idEmp), limit(1000)));
        snap.docs.filter((d) => !esOperacionPrueba(d.data())).forEach((d) => {
          const previo = porOp.get(d.id);
          if (previo) { previo._roles.push(etiqueta); return; }
          porOp.set(d.id, conRoles(armarDoc(d.id, d.data()), [etiqueta]));
        });
      } catch { /* índice o colección faltante: seguir con los demás papeles */ }
    }));
  }
  const lista = [...porOp.values()].sort((a, b) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')));
  return { lista, aviso };
};

const leerLigados = async (col: string, campo: string, idEmp: string, extra: Record<string, unknown> = {}): Promise<DocReferencia[]> => {
  try {
    const snap = await getDocs(query(collection(db, col), where(campo, '==', idEmp), limit(500)));
    return snap.docs.map((d) => Object.assign(armarDoc(d.id, d.data()), extra));
  } catch { return []; }
};

const ordenarPor = (arr: DocReferencia[], campo: string): DocReferencia[] =>
  [...arr].sort((a, b) => String(b[campo] || '').localeCompare(String(a[campo] || '')));

/** Todo lo de la pestaña Referencias de la empresa. Rechaza solo si falla algo inesperado. */
export const leerReferenciasEmpresa = async (idEmp: string, consultasCanonicas: boolean): Promise<ReferenciasEmpresa> => {
  const [ops, convCli, convProv, factCli, factProv, pagos] = await Promise.all([
    leerOperaciones(idEmp, consultasCanonicas),
    leerLigados('convenios_clientes', 'clienteId', idEmp, { _tipo: 'Cliente' }),
    leerLigados('convenios_proveedores', 'proveedorId', idEmp, { _tipo: 'Proveedor' }),
    leerLigados('facturas_clientes', 'clienteId', idEmp, { _tipo: 'Cliente' }),
    leerLigados('facturas_proveedores', 'proveedorId', idEmp, { _tipo: 'Proveedor' }),
    leerLigados('pagos', 'entidadId', idEmp),
  ]);
  return {
    operaciones: ops.lista,
    avisoOperaciones: ops.aviso,
    convenios: ordenarPor([...convCli, ...convProv], 'fechaConvenio'),
    facturas: ordenarPor([...factCli, ...factProv], 'fecha'),
    pagos: ordenarPor(pagos, 'fecha'),
  };
};

/**
 * Relee UNA operación (después de editarla desde la pestaña) para pintar su fila al día.
 * Si la empresa ya no aparece en ningún papel, conserva los papeles que tenía la fila.
 * null si la operación ya no existe.
 */
export const releerOperacionReferencia = async (opId: string, idEmp: string, rolesPrevios: string[]): Promise<OperacionReferencia | null> => {
  const snap = await getDoc(doc(db, 'operaciones', opId));
  if (!snap.exists()) return null;
  const op = armarDoc(snap.id, snap.data());
  const roles = rolesDeOperacion(op, idEmp);
  return conRoles(op, roles.length > 0 ? roles : rolesPrevios);
};

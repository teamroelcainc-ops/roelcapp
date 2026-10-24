// src/features/facturacion/services/statusFacturaDatos.ts
// ✅ V00481 — guarda el status de una factura con su cancelación (nota y factura que la reemplaza).
// statusFactura y los campos de cancelación no son de dinero: las reglas dejan escribirlos desde la
// web también con `dineroPorServidor`.
import { deleteField, doc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { CAMPOS_CANCELACION, planCancelacion } from './reglasFactura';
import type { DatosCancelacion } from './reglasFactura';

export type ColeccionFacturas = 'facturas_clientes' | 'facturas_proveedores';

export const usuarioFacturacion = (): string => auth.currentUser?.displayName || auth.currentUser?.email || 'Usuario';

export interface EscrituraCancelacion {
  /** Campos para Firestore (con deleteField() al borrar). */
  firestore: Record<string, unknown>;
  /** El mismo cambio para la copia en pantalla. */
  local: <T extends object>(f: T) => T;
  vacia: boolean;
}

export const escrituraCancelacion = (factura: unknown, statusNuevo: unknown, datos: DatosCancelacion | null): EscrituraCancelacion => {
  const plan = planCancelacion(factura, statusNuevo, datos, usuarioFacturacion(), new Date().toISOString());
  const firestore: Record<string, unknown> = plan.borrar ? Object.fromEntries(CAMPOS_CANCELACION.map((c) => [c, deleteField()])) : { ...plan.escribir };
  const local = <T extends object>(f: T): T => {
    const n: Record<string, unknown> = { ...(f as Record<string, unknown>), ...plan.escribir };
    if (plan.borrar) CAMPOS_CANCELACION.forEach((c) => { delete n[c]; });
    return n as T;
  };
  return { firestore, local, vacia: Object.keys(firestore).length === 0 };
};

/** Escribe en todos los documentos del grupo de la factura (mismo folio) `campos` con merge. */
export const escribirEnGrupo = async (coleccion: ColeccionFacturas, ids: readonly string[], campos: Record<string, unknown>): Promise<void> => {
  if (ids.length === 0 || Object.keys(campos).length === 0) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.set(doc(db, coleccion, id), campos, { merge: true }));
  await batch.commit();
};

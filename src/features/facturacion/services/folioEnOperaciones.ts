// src/features/facturacion/services/folioEnOperaciones.ts
// ---------------------------------------------------------------------------
// ✅ V00536 — Editar factura sin el servidor (bandera dineroPorServidor apagada): el # de Invoice nuevo
// también se escribe en sus operaciones (facturaClienteInvoice / facturaProveedorFolio). Antes solo
// cambiaba la factura y Completados, Operaciones y la ficha de la operación seguían con el folio viejo,
// aun después de recargar. La regla (cuáles operaciones) es `copiasDeFolio` de shared/dominio, la misma
// que usa el servidor en editarFactura.
// ---------------------------------------------------------------------------
import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { porIds } from '../../../shared/data/consultas';
import type { Lado } from '../../../shared/dominio/dinero';
import { copiasDeFolio, idsOperacionesDeGrupo, MAX_ESCRITURAS } from '../../../shared/dominio/facturacion';
import { notificarOperacionesGuardadas } from '../../../utils/operacionesBus';

type Datos = Record<string, unknown>;

/** Lee las operaciones del grupo, escribe el folio en las que lo tienen distinto y avisa al bus. Devuelve cuántas cambió. */
export const escribirFolioEnOperaciones = async (lado: Lado, folio: string, grupo: readonly { id: string; datos: Datos }[]): Promise<number> => {
  const ids = idsOperacionesDeGrupo(grupo);
  if (ids.length === 0) return 0;
  const leidas = await porIds('operaciones', ids);
  const copias = copiasDeFolio(lado, folio, grupo.map((f) => f.id), leidas.map((o) => ({ id: idReal(o), datos: o })));
  for (let i = 0; i < copias.length; i += MAX_ESCRITURAS) {
    const batch = writeBatch(db);
    copias.slice(i, i + MAX_ESCRITURAS).forEach((c) => batch.update(doc(db, 'operaciones', c.id), c.datos));
    await batch.commit();
  }
  notificarOperacionesGuardadas(copias.map((c) => [c.id, c.datos] as const), `folio-${lado}`);
  return copias.length;
};

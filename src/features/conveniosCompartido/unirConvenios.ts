// src/features/conveniosCompartido/unirConvenios.ts
// ✅ V00126: UNIR CONVENIOS DUPLICADOS (clientes y proveedores).
//   Se elige un convenio DESTINO; todos los detalles (tarifas/conceptos) de los
//   convenios FUENTE se re-apuntan al destino (conservan su id, así las
//   operaciones que los referencian siguen funcionando) y los maestros fuente
//   se envían a la papelera de reciclaje global.
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../config/firebase';

export type TipoConvenio = 'clientes' | 'proveedores';

export const COLECCIONES_CONVENIO: Record<TipoConvenio, { maestro: string; detalles: string; campoEntidad: string; campoEntidadNombre: string }> = {
  clientes:    { maestro: 'convenios_clientes',    detalles: 'convenios_clientes_detalles',    campoEntidad: 'clienteId',   campoEntidadNombre: 'clienteNombre' },
  proveedores: { maestro: 'convenios_proveedores', detalles: 'convenios_proveedores_detalles', campoEntidad: 'proveedorId', campoEntidadNombre: 'proveedorNombre' },
};

export interface ResultadoUnion {
  destinoId: string;
  fuentesEliminadas: string[];
  detallesMovidos: number;
}

export const unirConvenios = async (
  tipo: TipoConvenio,
  destinoId: string,
  fuentesIds: string[],
  motivo: string,
): Promise<ResultadoUnion> => {
  const cfg = COLECCIONES_CONVENIO[tipo];
  const fuentes = Array.from(new Set(fuentesIds.map(String))).filter(id => id && id !== destinoId);
  if (!destinoId || fuentes.length === 0) throw new Error('Selecciona un convenio destino y al menos un convenio fuente.');

  const snapDestino = await getDoc(doc(db, cfg.maestro, destinoId));
  if (!snapDestino.exists()) throw new Error('El convenio destino ya no existe en la base de datos.');

  // 1) Re-apuntar detalles (en lotes ≤ 400 escrituras).
  let detallesMovidos = 0;
  let batch = writeBatch(db);
  let enBatch = 0;
  const flush = async () => { if (enBatch > 0) { await batch.commit(); batch = writeBatch(db); enBatch = 0; } };
  for (const fuenteId of fuentes) {
    const snapDet = await getDocs(query(collection(db, cfg.detalles), where('convenioId', '==', fuenteId)));
    for (const d of snapDet.docs) {
      batch.update(d.ref, { convenioId: destinoId, _unidoDesde: fuenteId, _unidoEn: new Date().toISOString() });
      detallesMovidos++; enBatch++;
      if (enBatch >= 400) await flush();
    }
  }
  await flush();

  // 2) Maestros fuente → papelera (con motivo, sin volver a preguntar).
  const eliminadas: string[] = [];
  for (const fuenteId of fuentes) {
    await eliminarRegistro(cfg.maestro, fuenteId, { motivo, modulo: `Convenios ${tipo}`, etiqueta: `Unido en ${destinoId}` });
    eliminadas.push(fuenteId);
  }
  return { destinoId, fuentesEliminadas: eliminadas, detallesMovidos };
};

/** Elimina varios convenios (y sus detalles) enviándolos a la papelera con un solo motivo. */
export const eliminarConveniosMasivo = async (tipo: TipoConvenio, ids: string[], motivo: string): Promise<{ maestros: number; detalles: number }> => {
  const cfg = COLECCIONES_CONVENIO[tipo];
  let maestros = 0, detalles = 0;
  for (const id of Array.from(new Set(ids.map(String))).filter(Boolean)) {
    const snapDet = await getDocs(query(collection(db, cfg.detalles), where('convenioId', '==', id)));
    for (const d of snapDet.docs) {
      await eliminarRegistro(cfg.detalles, d.id, { motivo, modulo: `Convenios ${tipo}`, etiqueta: `Detalle del convenio ${id}` });
      detalles++;
    }
    await eliminarRegistro(cfg.maestro, id, { motivo, modulo: `Convenios ${tipo}` });
    maestros++;
  }
  return { maestros, detalles };
};

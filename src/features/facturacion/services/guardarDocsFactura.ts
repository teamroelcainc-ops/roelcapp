// src/features/facturacion/services/guardarDocsFactura.ts
// ✅ V00451: sube y guarda los DOCUMENTOS de una factura (varios, hasta 10). Antes, subirDocFacturaA
//   (uno solo, que se reemplazaba) estaba copiado en Clientes y Proveedores.
//   · agregarDocsFactura: al FACTURAR; los archivos se AGREGAN a los que ya tenga la factura (el
//     folio pudo existir y la factura se fusionó). Se lee la factura dentro de una transacción para
//     no pisar archivos que alguien más subió mientras tanto.
//   · guardarDocsFactura: Editar factura y el modal "Documentos de la factura"; guarda la lista que
//     el usuario dejó (la completa en el primer documento del grupo; ver documentosFactura.ts).
//   Carpeta en Storage: facturas_documentos/facturas_<lado>/<id>/ (la de siempre).
import { doc, getDoc, runTransaction, writeBatch } from 'firebase/firestore';
import type { WriteBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { cambioAdjuntos } from '../../../shared/archivos/adjuntos';
import type { Adjunto, ArchivoGuardado } from '../../../shared/archivos/adjuntos';
import { subirAdjuntos } from '../../../shared/archivos/subirAdjuntos';
import { camposDocsFactura, docsDeFactura, escriturasDocsFactura, folioDeFila, idsDeFila, unirDocs } from './documentosFactura';
import type { EscrituraDocs, LadoDocsFactura } from './documentosFactura';

const COLECCION: Record<LadoDocsFactura, string> = { clientes: 'facturas_clientes', proveedores: 'facturas_proveedores' };
const MODULO_LOG: Record<LadoDocsFactura, string> = { clientes: 'Facturación Clientes', proveedores: 'Facturación Proveedores' };

const carpetaDocsFactura = (lado: LadoDocsFactura, id: string): string => `facturas_documentos/facturas_${lado}/${id}`;
const nombres = (lista: readonly ArchivoGuardado[]): string => lista.map((a) => a.nombre).join(', ');

/** Facturar: sube los archivos elegidos y los AGREGA a los de la factura. Devuelve la lista final. */
export async function agregarDocsFactura(lado: LadoDocsFactura, id: string, adjuntos: readonly Adjunto[], folio: string): Promise<ArchivoGuardado[]> {
  const subidos = await subirAdjuntos(adjuntos, carpetaDocsFactura(lado, id));
  if (subidos.length === 0) return [];
  const ref = doc(db, COLECCION[lado], id);
  const lista = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('La factura ya no existe.');
    const final = unirDocs(docsDeFactura(snap.data()), subidos);
    tx.update(ref, camposDocsFactura(final));
    return final;
  });
  void registrarLog(MODULO_LOG[lado], 'Edición', `Subió ${subidos.length === 1 ? 'el documento' : `${subidos.length} documentos`} de la factura ${folio}: ${nombres(subidos)}.`);
  return lista;
}

/**
 * Editar / "Documentos de la factura": guarda la lista que quedó en pantalla (sube los nuevos).
 * null si no cambió nada. Las escrituras devueltas sirven para actualizar la lista local.
 */
export async function guardarDocsFactura(lado: LadoDocsFactura, fila: Record<string, unknown>, adjuntos: readonly Adjunto[]): Promise<EscrituraDocs[] | null> {
  const antes = docsDeFactura(fila);
  if (!cambioAdjuntos(adjuntos, antes)) return null;
  const [primero] = idsDeFila(fila);
  if (!primero) throw new Error('La factura no tiene identificador.');
  const lista = await subirAdjuntos(adjuntos, carpetaDocsFactura(lado, primero));
  const escrituras = escriturasDocsFactura(fila, lista);
  const batch = writeBatch(db);
  // update (no set+merge): si alguien borró la factura, falla con aviso en vez de revivirla vacía.
  escrituras.forEach((e) => batch.update(doc(db, COLECCION[lado], e.id), e.campos));
  await batch.commit();
  void registrarLog(MODULO_LOG[lado], 'Edición', `Documentos de la factura ${folioDeFila(fila)} (${lista.length}): ${nombres(lista) || 'ninguno'}.`);
  return escrituras;
}

/**
 * ✅ V00451: antes de BORRAR documentos de factura que se quedaron sin operaciones (quitar o mover
 * una operación, quitar una referencia): si tienen archivos y queda OTRO documento con el mismo folio
 * y la misma empresa, los archivos pasan a ese (se lee fresco). Antes se perdían con el borrado: en
 * un folio repetido el PDF solía estar justo en el segundo documento (caso LO-081026-004).
 * Agrega las escrituras al `batch` y las devuelve (para actualizar la lista local).
 */
export async function rescatarDocsDeBorradas(
  lado: LadoDocsFactura, borradas: readonly Record<string, unknown>[], todas: readonly Record<string, unknown>[], batch: WriteBatch,
): Promise<EscrituraDocs[]> {
  const campoEmpresa = lado === 'clientes' ? 'clienteId' : 'proveedorId';
  const clave = (f: Record<string, unknown>): string => `${String(f.invoice ?? '').trim().toLowerCase()}__${String(f[campoEmpresa] ?? '')}`;
  const idsBorradas = new Set(borradas.map((f) => String(f.id ?? '')));
  const porFolio = new Map<string, Record<string, unknown>[]>();
  borradas.forEach((f) => { if (docsDeFactura(f).length > 0) porFolio.set(clave(f), [...(porFolio.get(clave(f)) ?? []), f]); });
  const escrituras: EscrituraDocs[] = [];
  for (const [k, grupo] of porFolio) {
    const moverse = unirDocs(...grupo.map(docsDeFactura));
    const candidatos = todas.filter((f) => clave(f) === k && !idsBorradas.has(String(f.id ?? ''))).map((f) => String(f.id ?? ''));
    for (const id of candidatos) {
      const snap = await getDoc(doc(db, COLECCION[lado], id));
      if (!snap.exists() || clave(snap.data()) !== k) continue;
      const campos = camposDocsFactura(unirDocs(docsDeFactura(snap.data()), moverse));
      batch.update(snap.ref, campos);
      escrituras.push({ id, campos });
      break;
    }
  }
  return escrituras;
}

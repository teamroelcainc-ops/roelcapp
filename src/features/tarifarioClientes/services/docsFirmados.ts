// src/features/tarifarioClientes/services/docsFirmados.ts
// ✅ V00451: TARIFARIO FIRMADO con VARIOS archivos (hasta 10), clientes y proveedores.
//   · Lista nueva `docsFirmados` (ArchivoGuardado[]) en tarifario_clientes / tarifario_proveedores.
//   · docFirmadoUrl / Nombre / Fecha / Por = el PRIMERO de la lista: el candado de aprobación
//     (V00273/V00277) y lo que todavía lee un solo archivo siguen funcionando.
//   · Los registros viejos (solo docFirmadoUrl) se leen como una lista de uno.
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { archivosDeDocumento, camposDeArchivos, cambioAdjuntos, guardadosDe, MAX_ADJUNTOS } from '../../../shared/archivos/adjuntos';
import type { Adjunto, ArchivoGuardado, CamposLegado } from '../../../shared/archivos/adjuntos';
import { subirAdjuntos } from '../../../shared/archivos/subirAdjuntos';

export type LadoTarifario = 'clientes' | 'proveedores';

export const MAX_DOCS_FIRMADOS = MAX_ADJUNTOS;
const CAMPO_LISTA = 'docsFirmados';
const LEGADO: CamposLegado = { url: 'docFirmadoUrl', nombre: 'docFirmadoNombre', fecha: 'docFirmadoFecha', por: 'docFirmadoPor' };
const MODULO: Record<LadoTarifario, string> = { clientes: 'Tarifario Clientes', proveedores: 'Tarifario Proveedores' };

/** Documentos firmados de un tarifario (la lista nueva o el archivo único de siempre). */
export const docsFirmadosDe = (r: Record<string, unknown> | null | undefined): ArchivoGuardado[] =>
  archivosDeDocumento(r, CAMPO_LISTA, LEGADO);

/** Campos a escribir en el tarifario: la lista + el primero en docFirmado*. */
export const camposDocsFirmados = (lista: readonly ArchivoGuardado[]): Record<string, unknown> =>
  camposDeArchivos(lista, CAMPO_LISTA, LEGADO);

/**
 * Sube los archivos nuevos a tarifarios_firmados/tarifario_<lado>/<id> y escribe la lista en el
 * tarifario. Si la lista no cambió respecto a `antes`, no sube ni escribe nada.
 * Devuelve la lista final (la de `antes` si no hubo cambios).
 */
export async function guardarDocsFirmados(
  lado: LadoTarifario, id: string, nombreEntidad: string, adjuntos: readonly Adjunto[], antes: readonly ArchivoGuardado[],
): Promise<ArchivoGuardado[]> {
  if (!cambioAdjuntos(adjuntos, antes)) return [...antes];
  const lista = await subirAdjuntos(adjuntos, `tarifarios_firmados/tarifario_${lado}/${id}`);
  await updateDoc(doc(db, `tarifario_${lado}`, id), camposDocsFirmados(lista));
  const quedan = new Set(guardadosDe(adjuntos).map((a) => a.url));
  const subidos = adjuntos.flatMap((a) => (a.estado === 'nuevo' ? [a.file.name] : []));
  const quitados = antes.filter((a) => !quedan.has(a.url)).map((a) => a.nombre);
  const partes = [
    subidos.length ? `subió ${subidos.join(', ')}` : '',
    quitados.length ? `quitó ${quitados.join(', ')}` : '',
  ].filter(Boolean);
  registrarLog(MODULO[lado], 'Edición',
    `Tarifario firmado de "${nombreEntidad}" (${id}): ${partes.join('; ') || 'reordenó los archivos'}. Quedan ${lista.length} archivo(s).`,
  ).catch(() => {});
  return lista;
}

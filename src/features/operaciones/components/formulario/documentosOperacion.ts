// src/features/operaciones/components/formulario/documentosOperacion.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — documentos de una operación en Storage + índice en
// `documentos` (antes dentro de FormularioOperacion.tsx).
// ✅ V00451 — cada documento (Carta Porte, DODA, cada Entry's, Manifiesto) acepta VARIOS
// archivos, sin límite, y se AGREGAN a los que ya tenga la operación (como el modal de documentos):
// el id y el nombre de siempre solo si están libres; los demás, id único y el tipo
// "Carta Porte (2)", "(3)"… siguiendo el número más alto. Nombre único en Storage (antes el primero
// se subía a la ruta fija y PISABA el archivo anterior).
// ---------------------------------------------------------------------------
import type { Adjunto } from '../../../../shared/archivos/adjuntos';
import { esDelTipo, etiquetasNuevos, nombreArchivoNuevo } from '../../../documentos/expediente';
import type { DocumentoExpediente } from '../../../documentos/expediente';
import { agregarArchivoExpediente, leerDocumentosDeRegistro } from '../../../documentos/expedienteServicio';

export const TIPOS_DOCUMENTO_OPERACION = [
  'Otros documentos',
  'Factura',
  'Comprobante de Pago',
  'Evidencia de Entrega (POD)',
  'Carta Porte',
  'DODA',
  'Manifiesto',
  "Entry's",
  'Otro',
];

export const sanitizarRutaOp = (s: string) =>
  String(s || '').trim().replace(/[/\\:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();

export const referenciaDeOperacion = (idOp: string, ref?: string): string =>
  (ref && String(ref).trim()) || (idOp ? String(idOp).substring(0, 6) : 'Operacion');

/** Carpeta, subcarpeta, nombre base y tipo de un campo de documento de la operación. */
const datosDelCampo = (idOp: string, refOp: string, campoLabel: string, sufijoUnico?: string) => {
  const carpeta = sanitizarRutaOp(refOp) || sanitizarRutaOp(idOp) || 'sin_referencia';
  const subcarpeta = sanitizarRutaOp(campoLabel) || 'otros documentos';
  const nombreBase = sufijoUnico ? `${subcarpeta} ${sufijoUnico}` : subcarpeta;
  const docIdBase = sanitizarRutaOp(`operaciones__${idOp}__${nombreBase}`).replace(/\s+/g, '_');
  return { carpeta, subcarpeta, nombreBase, docIdBase };
};

/**
 * ✅ V00451: sube TODOS los archivos de un campo y los AGREGA a los documentos de la operación.
 * Un fallo no detiene los demás; se devuelve cuántos se subieron y qué falló (para avisar).
 */
export const subirDocumentosOperacion = async (
  files: readonly File[],
  idOp: string,
  refOp: string,
  campoLabel: string,
  sufijoUnico?: string,
): Promise<{ subidos: number; errores: string[] }> => {
  const etiqueta = sufijoUnico ? `${campoLabel} ${sufijoUnico}` : campoLabel;
  const { carpeta, subcarpeta, nombreBase, docIdBase } = datosDelCampo(idOp, refOp, campoLabel, sufijoUnico);
  // Lo que ya tiene la operación. Si no se puede leer, ningún archivo toma el id de siempre (nunca se pisa).
  let todos: DocumentoExpediente[] | null = null;
  try { todos = await leerDocumentosDeRegistro(idOp, 'operaciones'); }
  catch (e) { console.warn('No se pudieron leer los documentos de la operación:', e); }
  const canonicoLibre = !!todos && !todos.some((d) => d.id === docIdBase);
  const delTipo = (todos ?? []).filter((d) => esDelTipo(d, etiqueta)).map((d) => d.tipoDocumento);
  const etiquetas = etiquetasNuevos(etiqueta, delTipo, files.length, canonicoLibre);
  const sello = Date.now();
  let subidos = 0;
  const errores: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const canonico = i === 0 && canonicoLibre;
    try {
      await agregarArchivoExpediente({
        carpetaStorage: `operaciones/${carpeta}/${subcarpeta}`,
        file: files[i],
        nombre: nombreArchivoNuevo(nombreBase, files[i].name, etiquetas[i] === etiqueta),
        indice: i,
        idPreferido: canonico ? docIdBase : null,
        idAlterno: `${docIdBase}__${sello}_${i}`,
        datos: {
          coleccionOrigen: 'operaciones',
          registroId: idOp,
          registroNombre: refOp,
          tipoDocumento: etiquetas[i],
          carpeta,
          subcarpeta,
          vence: false,
          fechaExpedicion: '',
          fechaVencimiento: '',
          observaciones: '',
        },
      });
      subidos += 1;
    } catch (err) {
      console.error('Error subiendo documento de operación:', etiqueta, files[i].name, err);
      errores.push(`${etiqueta}: ${files[i].name}`);
    }
  }
  return { subidos, errores };
};

const esAdjuntoNuevo = (x: unknown): x is Adjunto =>
  !!x && typeof x === 'object' && (x as { estado?: unknown }).estado === 'nuevo' && (x as { file?: unknown }).file instanceof File;

/** ✅ V00451: archivos de un campo del formulario (lista de adjuntos nuevos; cualquier otro valor → vacío). */
export const adjuntosDeCampo = (v: unknown): Adjunto[] => (Array.isArray(v) ? v.filter(esAdjuntoNuevo) : []);

/** ✅ V00451: los File por subir de un campo. */
export const archivosDeCampo = (v: unknown): File[] =>
  adjuntosDeCampo(v).flatMap((a) => (a.estado === 'nuevo' ? [a.file] : []));

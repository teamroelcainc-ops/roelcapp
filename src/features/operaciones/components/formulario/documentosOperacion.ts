// src/features/operaciones/components/formulario/documentosOperacion.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — documentos de una operación en Storage + índice en
// `documentos` (antes dentro de FormularioOperacion.tsx).
// ---------------------------------------------------------------------------
import { doc, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../../../config/firebase';

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

/** Sube el archivo a operaciones/<ref>/<campo>/ y lo registra en `documentos` (id determinista). */
export const subirDocumentoOperacion = async (
  file: File,
  idOp: string,
  refOp: string,
  campoLabel: string,
  sufijoUnico?: string,
): Promise<void> => {
  const carpeta = sanitizarRutaOp(refOp) || sanitizarRutaOp(idOp) || 'sin_referencia';
  const subcarpeta = sanitizarRutaOp(campoLabel) || 'otros documentos';
  const nombreBase = sufijoUnico ? `${subcarpeta} ${sufijoUnico}` : subcarpeta;
  const punto = file.name.lastIndexOf('.');
  const extension = punto >= 0 ? file.name.slice(punto) : '';
  const nombreFinal = `${nombreBase}${extension}`;
  const ruta = `operaciones/${carpeta}/${subcarpeta}/${nombreFinal}`;

  const r = storageRef(storage, ruta);
  await uploadBytes(r, file, file.type ? { contentType: file.type } : undefined);
  const url = await getDownloadURL(r);

  const docId = sanitizarRutaOp(`operaciones__${idOp}__${nombreBase}`).replace(/\s+/g, '_');
  await setDoc(doc(db, 'documentos', docId), {
    coleccionOrigen: 'operaciones',
    registroId: idOp,
    registroNombre: refOp,
    tipoDocumento: sufijoUnico ? `${campoLabel} ${sufijoUnico}` : campoLabel,
    carpeta,
    subcarpeta,
    nombreArchivo: nombreFinal,
    path: ruta,
    url,
    vence: false,
    fechaExpedicion: '',
    fechaVencimiento: '',
    observaciones: '',
    createdAt: new Date().toISOString(),
  }, { merge: true });
};

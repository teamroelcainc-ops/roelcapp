// src/features/facturacion/services/documentosFactura.ts
// ---------------------------------------------------------------------------
// ✅ V00451 — DOCUMENTOS DE LA FACTURA (Clientes y Proveedores): hasta 10 por factura.
//   · Lista nueva `docsFactura` + los campos de UN documento de siempre (docFacturaUrl/Nombre/
//     Fecha/Por = el PRIMERO), que siguen leyendo el portal de clientes y Roelca Móvil.
//   · Una fila del Historial puede juntar varios documentos de Firestore con el mismo folio
//     (`__groupIds`/`__groupDocs`): la fila muestra los archivos de TODOS y, al guardar, la lista
//     completa queda en el primero y los demás que tenían archivos quedan vacíos (se consolida).
//   Lógica pura (probada); lo que toca Storage/Firestore está en guardarDocsFactura.ts.
// ---------------------------------------------------------------------------
import { MAX_ADJUNTOS, archivosDeDocumento, camposDeArchivos } from '../../../shared/archivos/adjuntos';
import type { ArchivoGuardado, CamposLegado } from '../../../shared/archivos/adjuntos';

type Datos = Record<string, unknown>;

export type LadoDocsFactura = 'clientes' | 'proveedores';

export const CAMPO_DOCS_FACTURA = 'docsFactura';
export const LEGADO_DOC_FACTURA: CamposLegado = { url: 'docFacturaUrl', nombre: 'docFacturaNombre', fecha: 'docFacturaFecha', por: 'docFacturaPor' };
export const MAX_DOCS_FACTURA = MAX_ADJUNTOS;

/** Escritura de los campos de documentos en UN documento de factura. */
export interface EscrituraDocs {
  id: string;
  campos: Datos;
}

const esDatos = (v: unknown): v is Datos => !!v && typeof v === 'object' && !Array.isArray(v);

/** Une listas sin repetir archivos (misma URL), en el orden en que llegan. */
export const unirDocs = (...listas: ReadonlyArray<readonly ArchivoGuardado[]>): ArchivoGuardado[] => {
  const vistas = new Set<string>();
  const salida: ArchivoGuardado[] = [];
  for (const lista of listas) {
    for (const a of lista) {
      if (!a.url || vistas.has(a.url)) continue;
      vistas.add(a.url);
      salida.push(a);
    }
  }
  return salida;
};

/** Archivos de una factura (o de una fila del Historial, que ya trae los del grupo unidos). Sin repetir (la URL es la llave). */
export const docsDeFactura = (f: unknown): ArchivoGuardado[] =>
  unirDocs(archivosDeDocumento(esDatos(f) ? f : null, CAMPO_DOCS_FACTURA, LEGADO_DOC_FACTURA));

/** Campos a escribir: la lista + el primero en los campos de siempre (vacíos si no queda ninguno). */
export const camposDocsFactura = (lista: readonly ArchivoGuardado[]): Datos =>
  camposDeArchivos(lista, CAMPO_DOCS_FACTURA, LEGADO_DOC_FACTURA);

/** Campos de documentos de una fila del Historial al juntarle otro documento del grupo ({} si ninguno tiene). */
export const camposDocsDeGrupo = (fila: unknown, otro: unknown): Datos => {
  const union = unirDocs(docsDeFactura(fila), docsDeFactura(otro));
  return union.length > 0 ? camposDocsFactura(union) : {};
};

/** Ids de los documentos de Firestore de una fila del Historial (grupo) o de una factura suelta. */
export const idsDeFila = (fila: Datos): string[] => {
  const grupo = Array.isArray(fila.__groupIds) ? fila.__groupIds.map(String).filter(Boolean) : [];
  return grupo.length > 0 ? grupo : [String(fila.id ?? '')];
};

export const folioDeFila = (fila: Datos): string => String(fila.invoice || fila.id || '');

/**
 * Escrituras al guardar la lista de una fila: la lista completa en el PRIMER documento y, en los
 * demás del grupo que tenían archivos, la lista vacía (así no se muestran dos veces ni se pierden:
 * todos quedaron en la lista que el usuario vio y guardó). Esos demás conservan en los campos de
 * siempre el PRIMER archivo: el portal de clientes y la app móvil muestran cada documento por
 * separado y leen solo `docFacturaUrl`.
 */
export const escriturasDocsFactura = (fila: Datos, lista: readonly ArchivoGuardado[]): EscrituraDocs[] => {
  const [primero, ...resto] = idsDeFila(fila);
  const docs = Array.isArray(fila.__groupDocs) ? fila.__groupDocs.filter(esDatos) : [];
  const conArchivos = resto.filter((id) => docs.some((d) => String(d.id ?? '') === id && docsDeFactura(d).length > 0));
  return [
    { id: primero, campos: camposDocsFactura(lista) },
    ...conArchivos.map((id) => ({ id, campos: { ...camposDocsFactura(lista.slice(0, 1)), [CAMPO_DOCS_FACTURA]: [] } })),
  ];
};

/** Aplica las escrituras a una lista local de facturas (la de la pantalla). */
export const aplicarEscriturasDocs = <T extends { id?: unknown }>(filas: readonly T[], escrituras: readonly EscrituraDocs[]): T[] => {
  if (escrituras.length === 0) return [...filas];
  const porId = new Map(escrituras.map((e) => [e.id, e.campos]));
  return filas.map((f) => {
    const campos = porId.get(String(f.id ?? ''));
    return campos ? { ...f, ...campos } : f;
  });
};

/** Texto de la píldora de la fila. */
export const etiquetaPildoraDocs = (n: number): string => (n <= 0 ? 'Sin doc' : n === 1 ? 'Doc ✓' : `Doc ✓ (${n})`);

/** Ayuda (title) de la píldora de la fila. */
export const tituloPildoraDocs = (archivos: readonly ArchivoGuardado[]): string => {
  const primero = archivos[0];
  if (!primero) return 'Sin el documento de la factura — clic para subirlo';
  const cuando = primero.fecha ? ` el ${primero.fecha}${primero.por ? ` por ${primero.por}` : ''}` : '';
  const cuantos = archivos.length === 1 ? `Documento cargado${cuando}` : `${archivos.length} documentos cargados`;
  return `${cuantos} — clic para verlos, agregar o cambiar`;
};

/** Motivo legible de un error de Storage/Firestore (código o mensaje). */
export const detalleError = (e: unknown): string => {
  if (esDatos(e)) {
    const codigo = typeof e.code === 'string' ? e.code : '';
    const mensaje = typeof e.message === 'string' ? e.message : '';
    if (codigo || mensaje) return codigo || mensaje;
  }
  return String(e);
};

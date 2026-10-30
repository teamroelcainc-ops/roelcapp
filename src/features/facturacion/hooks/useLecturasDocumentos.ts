// src/features/facturacion/hooks/useLecturasDocumentos.ts
// ---------------------------------------------------------------------------
// ✅ V00533 — Lee los PDF y XML de una lista de adjuntos (los ya guardados y los nuevos) para comparar
// su subtotal en Editar factura. Cada archivo se lee una vez (la caché por archivo / por URL está en
// leerDocumentoFactura.ts): agregar o quitar uno solo lee el nuevo. Las imágenes no se leen.
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useState } from 'react';
import type { Adjunto } from '../../../shared/archivos/adjuntos';
import { esDocumentoRevisable, esGuardadoRevisable, leerDocumentoFactura, leerDocumentoGuardado } from '../services/leerDocumentoFactura';
import type { LecturaDocumento } from '../services/leerFacturaPdf';
import type { LecturaNombrada } from '../services/subtotalManual';

const revisable = (a: Adjunto): boolean => (a.estado === 'nuevo' ? esDocumentoRevisable(a.file) : esGuardadoRevisable(a.archivo));
const leer = (a: Adjunto): Promise<LecturaDocumento> => (a.estado === 'nuevo' ? leerDocumentoFactura(a.file) : leerDocumentoGuardado(a.archivo));
const nombre = (a: Adjunto): string => (a.estado === 'nuevo' ? a.file.name : a.archivo.nombre || 'Documento');

export interface LecturasDocumentos {
  lecturas: LecturaNombrada[];
  /** Todavía falta leer alguno. */
  leyendo: boolean;
  /** Hay al menos un PDF o XML. */
  hayDocumentos: boolean;
}

/** `activo` en false no lee nada (por ejemplo, mientras la ventana está cerrada). */
export function useLecturasDocumentos(adjuntos: readonly Adjunto[], activo: boolean): LecturasDocumentos {
  const docs = activo ? adjuntos.filter(revisable) : [];
  const [leidas, setLeidas] = useState<ReadonlyMap<string, LecturaDocumento>>(() => new Map());
  const clave = docs.map((a) => a.clave).join('|');

  const leerTodos = useEffectEvent((sigue: { vigente: boolean }) => {
    docs.forEach((a) => {
      void leer(a).then((r) => { if (sigue.vigente) setLeidas((prev) => (prev.get(a.clave) === r ? prev : new Map(prev).set(a.clave, r))); });
    });
  });
  useEffect(() => {
    const sigue = { vigente: true };
    leerTodos(sigue);
    return () => { sigue.vigente = false; };
  }, [clave]);

  const lecturas = docs.flatMap((a) => { const l = leidas.get(a.clave); return l ? [{ nombre: nombre(a), lectura: l }] : []; });
  return { lecturas, leyendo: lecturas.length < docs.length, hayDocumentos: docs.length > 0 };
}

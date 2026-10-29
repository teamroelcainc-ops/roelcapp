// src/features/facturacion/components/RevisionDocumentosFactura.tsx
// ---------------------------------------------------------------------------
// ✅ V00514 — REVISIÓN DEL DOCUMENTO al subirlo (Generar Factura y Documentos de la factura). Por
// cada PDF o XML nuevo dice qué se leyó (número, cliente, subtotal) y lo compara con la factura:
// número, cliente, moneda, operaciones, costo de cada operación y subtotal. Solo AVISA (no impide
// guardar). Se lee una vez por archivo; si cambias el número o la selección, se vuelve a comparar.
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useState } from 'react';
import type { Adjunto } from '../../../shared/archivos/adjuntos';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { compararDocumentoFactura } from '../services/documentoFactura';
import type { FacturaEsperada, Hallazgo } from '../services/documentoFactura';
import { esDocumentoRevisable, leerDocumentoFactura } from '../services/leerDocumentoFactura';
import type { DocumentoFactura, LecturaDocumento } from '../services/leerFacturaPdf';
import './RevisionDocumentosFactura.css';

interface Props {
  adjuntos: readonly Adjunto[];
  /** La factura con la que se compara (null = solo se muestra lo leído). */
  esperado: FacturaEsperada | null;
}

const ICONO: Record<Hallazgo['nivel'], string> = { ok: '✅', error: '⚠️', aviso: '❔', info: 'ℹ️' };
const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FORMATO: Record<DocumentoFactura['formato'], string> = { sit: 'CFDI del SIT', invoice: 'Invoice', xml: 'XML del CFDI', otro: 'PDF' };

const resumen = (d: DocumentoFactura): string => [
  d.folio ? `${d.formato === 'invoice' ? 'Invoice' : 'Factura'} ${d.folio}` : 'Sin número',
  d.clienteNombre,
  d.subtotal !== null ? `Subtotal ${dinero(d.subtotal)}${d.moneda ? ` ${d.moneda}` : ''}` : '',
  `${d.conceptos.flatMap((c) => c.refs).length} referencia(s)`,
].filter(Boolean).join(' · ');

function Documento({ nombre, lectura, esperado }: { nombre: string; lectura: LecturaDocumento | undefined; esperado: FacturaEsperada | null }) {
  if (!lectura) return <li className="rdf-doc"><span className="rdf-nombre">{nombre}</span><CargandoDatos compacto texto="Leyendo el documento…" /></li>;
  if (!lectura.ok) return <li className="rdf-doc rdf-doc--error"><span className="rdf-nombre">{nombre}</span><p className="rdf-linea">⚠️ {lectura.error}</p></li>;
  const revision = esperado ? compararDocumentoFactura(lectura.doc, esperado) : null;
  const errores = revision ? revision.hallazgos.filter((x) => x.nivel === 'error').length : 0;
  return (
    <li className={`rdf-doc${revision ? (revision.coincide ? ' rdf-doc--ok' : ' rdf-doc--error') : ''}`}>
      <span className="rdf-nombre">{nombre} <span className="rdf-formato">{FORMATO[lectura.doc.formato]}</span></span>
      <span className="rdf-resumen">{resumen(lectura.doc)}</span>
      {revision && (
        <>
          <p className={`rdf-veredicto${revision.coincide ? ' rdf-veredicto--ok' : ' rdf-veredicto--error'}`} role="status">
            {revision.coincide ? '✅ El documento coincide con la factura.' : `⚠️ El documento no coincide con la factura (${errores} ${errores === 1 ? 'diferencia' : 'diferencias'}).`}
          </p>
          <ul className="rdf-hallazgos">
            {revision.hallazgos.map((x) => (
              <li key={`${x.campo}:${x.texto}`} className={`rdf-hallazgo rdf-hallazgo--${x.nivel}`}><span aria-hidden="true">{ICONO[x.nivel]}</span> {x.texto}</li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

export default function RevisionDocumentosFactura({ adjuntos, esperado }: Props) {
  const nuevos = adjuntos.flatMap((a) => (a.estado === 'nuevo' && esDocumentoRevisable(a.file) ? [a] : []));
  const [lecturas, setLecturas] = useState<ReadonlyMap<File, LecturaDocumento>>(() => new Map());

  // Se leen cuando cambian los archivos (la lectura queda en caché por archivo).
  const claveNuevos = nuevos.map((a) => a.clave).join('|');
  const leerNuevos = useEffectEvent((sigue: { vigente: boolean }) => {
    nuevos.forEach((a) => {
      void leerDocumentoFactura(a.file).then((r) => { if (sigue.vigente) setLecturas((prev) => (prev.get(a.file) === r ? prev : new Map(prev).set(a.file, r))); });
    });
  });
  useEffect(() => {
    const sigue = { vigente: true };
    leerNuevos(sigue);
    return () => { sigue.vigente = false; };
  }, [claveNuevos]);

  if (nuevos.length === 0) return null;
  return (
    <section className="rdf-panel" aria-label="Revisión del documento contra la factura">
      <h4 className="rdf-titulo">Revisión del documento</h4>
      <ul className="rdf-docs">
        {nuevos.map((a) => <Documento key={a.clave} nombre={a.file.name} lectura={lecturas.get(a.file)} esperado={esperado} />)}
      </ul>
    </section>
  );
}

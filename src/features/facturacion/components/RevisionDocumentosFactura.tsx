// src/features/facturacion/components/RevisionDocumentosFactura.tsx
// ---------------------------------------------------------------------------
// ✅ V00514 — REVISIÓN DEL DOCUMENTO al subirlo (Generar Factura y Documentos de la factura). Por
// cada PDF o XML nuevo dice qué se leyó (número, cliente, subtotal) y lo compara con la factura:
// número, cliente, moneda, operaciones, costo de cada operación y subtotal. Solo AVISA (no impide
// guardar). Se lee una vez por archivo; si cambias el número o la selección, se vuelve a comparar.
// ✅ V00516: RevisionDocumentosGuardados hace lo mismo con los documentos YA GUARDADOS de una factura
// (botón "Analizar documento" de la Ficha de Factura): los descarga y los compara con la factura.
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useState } from 'react';
import type { ReactNode } from 'react';
import type { Adjunto, ArchivoGuardado } from '../../../shared/archivos/adjuntos';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { compararDocumentoFactura } from '../services/documentoFactura';
import type { FacturaEsperada, Hallazgo, RevisionDocumento } from '../services/documentoFactura';
import DiferenciaEnCargos, { ResumenDiferenciaAplicada } from './DiferenciaEnCargos';
import type { PlanCargos } from '../services/diferenciaEnCargos';
import { esDocumentoRevisable, esGuardadoRevisable, leerDocumentoFactura, leerDocumentoGuardado } from '../services/leerDocumentoFactura';
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

interface PropsDocumento {
  nombre: string;
  lectura: LecturaDocumento | undefined;
  esperado: FacturaEsperada | null;
  /** ✅ V00519: lo que va debajo de la revisión (la propuesta de poner la diferencia en costos adicionales). */
  extra?: (r: RevisionDocumento) => ReactNode;
}

function Documento({ nombre, lectura, esperado, extra }: PropsDocumento) {
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
          {extra?.(revision)}
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

interface PropsGuardados {
  archivos: readonly ArchivoGuardado[];
  esperado: FacturaEsperada | null;
  onCerrar: () => void;
  /** ✅ V00519: la factura (para poner la diferencia en costos adicionales) y cómo refrescarla. */
  fila?: Record<string, unknown>;
  onFacturaCambiada?: (facturaId: string, campos: Record<string, unknown>) => void;
}

/** ✅ V00516 — Analiza los documentos ya guardados de una factura (se descargan al abrir el panel). */
export function RevisionDocumentosGuardados({ archivos, esperado, onCerrar, fila, onFacturaCambiada }: PropsGuardados) {
  const revisables = archivos.filter(esGuardadoRevisable);
  const imagenes = archivos.length - revisables.length;
  const [lecturas, setLecturas] = useState<ReadonlyMap<string, LecturaDocumento>>(() => new Map());
  const [aplicadas, setAplicadas] = useState<ReadonlyMap<string, PlanCargos>>(() => new Map()); // ✅ V00519

  const claveUrls = revisables.map((a) => a.url).join('|');
  const leerGuardados = useEffectEvent((sigue: { vigente: boolean }) => {
    revisables.forEach((a) => {
      void leerDocumentoGuardado(a).then((r) => { if (sigue.vigente) setLecturas((prev) => (prev.get(a.url) === r ? prev : new Map(prev).set(a.url, r))); });
    });
  });
  useEffect(() => {
    const sigue = { vigente: true };
    leerGuardados(sigue);
    return () => { sigue.vigente = false; };
  }, [claveUrls]);

  return (
    <section className="rdf-panel rdf-panel--ficha" aria-label="Análisis del documento guardado contra la factura">
      <div className="rdf-cabecera">
        <h4 className="rdf-titulo">Análisis del documento contra la factura</h4>
        <button type="button" className="rdf-cerrar" onClick={onCerrar}>Ocultar</button>
      </div>
      {revisables.length === 0
        ? <p className="rdf-linea">Esta factura solo tiene imágenes: solo los PDF y XML se pueden revisar.</p>
        : (
          <ul className="rdf-docs">
            {revisables.map((a) => (
              <Documento key={a.url} nombre={a.nombre || 'Documento'} lectura={lecturas.get(a.url)} esperado={esperado}
                extra={(r) => {
                  const hecha = aplicadas.get(a.url);
                  if (hecha) return <ResumenDiferenciaAplicada plan={hecha} moneda={esperado?.moneda ?? ''} />;
                  if (!r.diferencia || !fila || !onFacturaCambiada || !esperado?.moneda) return null;
                  return (
                    <DiferenciaEnCargos fila={fila} folio={esperado.folio} moneda={esperado.moneda} diferencia={r.diferencia} difOps={r.difOps}
                      onAplicado={(plan) => { setAplicadas((m) => new Map(m).set(a.url, plan)); onFacturaCambiada(plan.facturaId, plan.datosFactura); }} />
                  );
                }} />
            ))}
          </ul>
        )}
      {revisables.length > 0 && imagenes > 0 && <p className="rdf-resumen">{imagenes === 1 ? '1 imagen no se revisa' : `${imagenes} imágenes no se revisan`}: solo los PDF y XML se pueden leer.</p>}
    </section>
  );
}

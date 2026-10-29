// src/features/facturacion/components/SubirXmlModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00513 — SUBIR XML (Facturación de Clientes). Se arrastran uno o varios XML de
// facturas fiscales (CFDI del SIT); cada uno se lee y se coteja contra las operaciones
// por facturar. Solo las que cuadran AL CENTAVO se pueden registrar: "Registrar factura"
// abre el Generar Factura de siempre, ya llenado (operaciones, folio, fecha y el XML
// como documento), y ahí se confirma. Aquí no se escribe nada.
// ✅ V00513: también se suben los PDF (la factura para verla). Cada PDF se junta con su XML
// (parearPdfXml) y la factura queda con los dos documentos: primero el PDF, luego el XML.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { createPortal } from 'react-dom';
import AdjuntosArchivos from '../../../shared/components/AdjuntosArchivos';
import type { Adjunto } from '../../../shared/archivos/adjuntos';
import type { EstadoCotejo, ResultadoCotejo } from '../services/cotejoCfdi';
import type { Cfdi, ResultadoLectura } from '../services/leerCfdi';
import { leerCfdi } from '../services/leerCfdi';
import { esPdfNombre, esXmlNombre, parearPdfXml } from '../services/parearPdfXml';
import FilaCfdi from './FilaCfdi';
import './SubirXmlModal.css';

/** 60 facturas (PDF + XML) por carga; más que eso, mejor en varias tandas. */
const MAX_ARCHIVOS = 120;
const ORDEN: Record<EstadoCotejo, number> = { listo: 0, diferencias: 1, sin_operacion: 2, bloqueada: 3, registrada: 4 };

interface Props {
  /** Coteja con los datos actuales del tablero (se recalcula en cada pintado). */
  cotejar: (cfdi: Cfdi) => ResultadoCotejo;
  nombreCliente: (clienteId: string) => string;
  /** `pdf` = null si no se subió el PDF de esa factura. */
  onRegistrar: (resultado: ResultadoCotejo, xml: File, pdf: File | null) => void;
  onCerrar: () => void;
  /** Mientras está abierto Generar Factura: no se pinta, pero conserva lo cargado. */
  oculto: boolean;
}

/** Texto del archivo (FileReader como respaldo donde no hay Blob.text). */
const textoDe = (f: File): Promise<string> => (typeof f.text === 'function' ? f.text() : new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result ?? ''));
  r.onerror = () => mal(r.error);
  r.readAsText(f);
}));

const esXml = (f: File): boolean => esXmlNombre(f.name, f.type);
const esPdf = (f: File): boolean => esPdfNombre(f.name, f.type);
type AdjuntoNuevo = Extract<Adjunto, { estado: 'nuevo' }>;
const esNuevo = (a: Adjunto): a is AdjuntoNuevo => a.estado === 'nuevo';

export default function SubirXmlModal({ cotejar, nombreCliente, onRegistrar, onCerrar, oculto }: Props) {
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [lecturas, setLecturas] = useState<Record<string, ResultadoLectura>>({});
  const [leyendo, setLeyendo] = useState(false);

  const alCambiar = async (lista: Adjunto[]): Promise<void> => {
    const nuevos = lista.filter((a): a is AdjuntoNuevo => esNuevo(a) && !(a.clave in lecturas));
    const otros = nuevos.filter((a) => !esXml(a.file) && !esPdf(a.file));
    if (otros.length > 0) alert(`Solo se aceptan los PDF y XML de las facturas; se quitaron: ${otros.map((a) => a.file.name).join(', ')}`);
    setAdjuntos(lista.filter((a) => esNuevo(a) && (esXml(a.file) || esPdf(a.file))));
    const porLeer = nuevos.filter((a) => esXml(a.file));
    if (porLeer.length === 0) return;
    setLeyendo(true);
    try {
      const leidos = await Promise.all(porLeer.map(async (a) => {
        try { return [a.clave, leerCfdi(await textoDe(a.file))] as const; } catch { return [a.clave, { ok: false, error: 'No se pudo leer el archivo.' } as ResultadoLectura] as const; }
      }));
      setLecturas((prev) => ({ ...prev, ...Object.fromEntries(leidos) }));
    } finally {
      setLeyendo(false);
    }
  };

  if (oculto) return null;

  const nuevos = adjuntos.filter(esNuevo);
  const pdfs = nuevos.filter((a) => esPdf(a.file));
  const filas = nuevos.flatMap((a) => {
    const l = esXml(a.file) ? lecturas[a.clave] : undefined;
    return l ? [{ a, l }] : [];
  });
  const pareo = parearPdfXml(
    filas.map(({ a, l }) => ({ clave: a.clave, nombre: a.file.name, folio: l.ok ? l.cfdi.folio : '', uuid: l.ok ? l.cfdi.uuid : '' })),
    pdfs.map((a) => ({ clave: a.clave, nombre: a.file.name })),
  );
  const pdfDe = (clave: string): File | null => pdfs.find((p) => p.clave === pareo.pdfDeXml.get(clave))?.file ?? null;
  const pdfSueltos = pdfs.filter((p) => pareo.pdfSueltos.includes(p.clave));
  const errores = filas.filter((f) => !f.l.ok);
  const vistosUuid = new Set<string>();
  const cotejadas = filas.flatMap(({ a, l }) => {
    if (!l.ok) return [];
    const repetido = !!l.cfdi.uuid && vistosUuid.has(l.cfdi.uuid);
    vistosUuid.add(l.cfdi.uuid);
    return [{ a, r: cotejar(l.cfdi), repetido, pdf: pdfDe(a.clave) }];
  }).sort((x, y) => (x.repetido ? 9 : ORDEN[x.r.estado]) - (y.repetido ? 9 : ORDEN[y.r.estado]) || x.r.cfdi.folio.localeCompare(y.r.cfdi.folio));
  const cuenta = (e: EstadoCotejo) => cotejadas.filter((c) => !c.repetido && c.r.estado === e).length;

  return createPortal(
    <div className="modal-overlay sxm-fondo" role="dialog" aria-modal="true" aria-labelledby="sxm-titulo">
      <div className="sxm-ventana">
        <header className="sxm-cabecera">
          <div>
            <h2 id="sxm-titulo" className="sxm-titulo">Subir facturas fiscales (PDF y XML)</h2>
            <p className="sxm-sub">Arrastra juntos el PDF y el XML de cada factura. El XML se coteja contra las operaciones por facturar: cliente (RFC), moneda, folio y el importe de cada referencia al centavo. Solo las que cuadran se pueden registrar, y quedan con sus dos archivos.</p>
          </div>
          <button type="button" className="sxm-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </header>
        <div className="sxm-cuerpo">
          <AdjuntosArchivos etiqueta="PDF y XML de las facturas" adjuntos={adjuntos} onCambiar={(l) => { void alCambiar(l); }} max={MAX_ARCHIVOS} tipos="cualquiera" previaCerrada deshabilitado={leyendo} />
          {cotejadas.length > 0 && (
            <ul className="sxm-cifras">
              <li className="sxm-cifra sxm-cifra--listo"><b>{cuenta('listo')}</b> cuadran</li>
              <li className="sxm-cifra sxm-cifra--diferencias"><b>{cuenta('diferencias')}</b> no cuadran</li>
              <li className="sxm-cifra sxm-cifra--sin"><b>{cuenta('sin_operacion')}</b> sin operación</li>
              <li className="sxm-cifra sxm-cifra--bloqueada"><b>{cuenta('bloqueada') + cotejadas.filter((c) => c.repetido).length}</b> no se pueden registrar</li>
              <li className="sxm-cifra"><b>{cuenta('registrada')}</b> registradas</li>
            </ul>
          )}
          {pdfSueltos.length > 0 && (
            <ul className="sxm-notas">{pdfSueltos.map((a) => <li key={a.clave}>PDF sin su XML: {a.file.name}</li>)}</ul>
          )}
          {errores.length > 0 && (
            <ul className="sxm-problemas">{errores.map(({ a, l }) => <li key={a.clave}>{a.estado === 'nuevo' ? a.file.name : ''}: {l.ok ? '' : l.error}</li>)}</ul>
          )}
          <ul className="sxm-lista">
            {cotejadas.map(({ a, r, repetido, pdf }) => (
              <FilaCfdi
                key={a.clave}
                resultado={r}
                nombreArchivo={a.estado === 'nuevo' ? a.file.name : ''}
                nombrePdf={pdf?.name ?? ''}
                nombreCliente={r.clienteId ? nombreCliente(r.clienteId) : ''}
                repetidoEnCarga={repetido}
                onRegistrar={() => { if (a.estado === 'nuevo') onRegistrar(r, a.file, pdf); }}
              />
            ))}
          </ul>
        </div>
        <footer className="sxm-pie">
          <button type="button" className="sxm-btn" onClick={onCerrar}>Cerrar</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

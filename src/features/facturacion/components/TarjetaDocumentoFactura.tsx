// src/features/facturacion/components/TarjetaDocumentoFactura.tsx
// ✅ V00381: tarjeta GRANDE del documento de la factura (Clientes y Proveedores) en la Ficha de
//   Factura, para que se note a simple vista si el documento YA está cargado.
// ✅ V00451: VARIOS documentos por factura (hasta 10). La tarjeta lista los archivos (cada nombre
//   abre el archivo) y "Ver documentos" abría el modal "Documentos de la factura" (vista previa,
//   agregar, reemplazar, quitar). La píldora de la fila (PildoraDocsFactura) abre lo mismo.
//   Facturar y Editar factura usan AdjuntosArchivos (ya no la tarjeta con el archivo pendiente).
// ✅ V00516: botón opcional "Analizar documento" (Clientes, DocumentoFichaCliente): revisa el PDF / XML
//   ya guardado contra la factura.
// ✅ V00531: "Ver documento" abre la factura (el PDF; si no hay, la imagen o el primero) en OTRA PESTAÑA.
//   Agregar, reemplazar o quitar documentos pasó al botón "Agregar o cambiar" (el modal de siempre).
import type { MouseEvent } from 'react';
import { urlParaPestana } from '../../../shared/archivos/adjuntos';
import type { ArchivoGuardado } from '../../../shared/archivos/adjuntos';
import { documentoPrincipal, etiquetaPildoraDocs, tituloPildoraDocs } from '../services/documentosFactura';
import './TarjetaDocumentoFactura.css';

interface Props {
  archivos: readonly ArchivoGuardado[];
  /** Abre "Documentos de la factura". */
  onAbrir: () => void;
  /** ✅ V00516: muestra u oculta el análisis del documento (sin esto no hay botón). */
  onAnalizar?: () => void;
  analizando?: boolean;
}

const extension = (nombre: string): string => {
  const m = nombre.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  return m ? m[1].toUpperCase() : 'DOC';
};

const fechaCorta = (v: string): string => {
  const s = v.slice(0, 10);
  const [a, m, d] = s.split('-');
  return a && m && d ? `${d}/${m}/${a}` : s;
};

const cargado = (a: ArchivoGuardado): string =>
  [a.fecha ? `Cargado el ${fechaCorta(a.fecha)}` : 'Cargado', a.por ? `por ${a.por}` : ''].filter(Boolean).join(' ');

const IconoCheck = () => (
  <svg className="tdf-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
);
const IconoAlerta = () => (
  <svg className="tdf-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
);

/** Un archivo guardado en base64 no se abre con el enlace directo: se abre como blob. */
const abrirEnPestana = (e: MouseEvent<HTMLAnchorElement>, url: string): void => {
  if (!url.startsWith('data:')) return; // el enlace lo abre en otra pestaña
  e.preventDefault();
  window.open(urlParaPestana(url), '_blank', 'noopener');
};

export default function TarjetaDocumentoFactura({ archivos, onAbrir, onAnalizar, analizando = false }: Props) {
  const primero = archivos[0];
  const principal = documentoPrincipal(archivos);

  if (!primero) {
    return (
      <div className="tdf tdf--vacio">
        <div className="tdf-archivo tdf-archivo--vacio">—</div>
        <div className="tdf-cuerpo">
          <span className="tdf-estado"><IconoAlerta /> Sin documento de la factura</span>
          <span className="tdf-meta">Aún no se ha cargado el PDF o la imagen de esta factura.</span>
        </div>
        <div className="tdf-acciones">
          <button type="button" className="tdf-btn tdf-btn--subir" onClick={onAbrir}>Subir documentos</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tdf tdf--ok">
      <div className="tdf-archivo">{extension(primero.nombre || primero.url)}</div>
      <div className="tdf-cuerpo">
        <span className="tdf-estado"><IconoCheck /> {archivos.length === 1 ? 'Documento cargado' : `${archivos.length} documentos cargados`}</span>
        <ul className="tdf-lista">
          {archivos.map((a) => (
            <li key={a.url} className="tdf-lista-item">
              <a className="tdf-nombre" href={a.url} target="_blank" rel="noopener noreferrer" title={`${a.nombre} · ${cargado(a)} · abrir en otra pestaña`}>{a.nombre}</a>
            </li>
          ))}
        </ul>
        {archivos.length === 1 && <span className="tdf-meta">{cargado(primero)}</span>}
      </div>
      <div className="tdf-acciones">
        {onAnalizar && (
          <button type="button" className={`tdf-btn tdf-btn--analizar${analizando ? ' tdf-btn--activo' : ''}`} onClick={onAnalizar} aria-pressed={analizando}
            title="Lee el PDF o XML guardado y lo compara con la factura: número, cliente, moneda, operaciones, costo de cada una y subtotal">
            {analizando ? 'Ocultar análisis' : archivos.length === 1 ? 'Analizar documento' : 'Analizar documentos'}
          </button>
        )}
        {principal && (
          <a className="tdf-btn tdf-btn--ver" href={principal.url} target="_blank" rel="noopener noreferrer" onClick={(e) => abrirEnPestana(e, principal.url)}
            title={`Abrir ${principal.nombre || 'el documento'} en otra pestaña`}>Ver documento</a>
        )}
        <button type="button" className="tdf-btn" onClick={onAbrir} title="Agregar, reemplazar o quitar documentos de la factura">Agregar o cambiar</button>
      </div>
    </div>
  );
}

interface PropsPildora {
  archivos: readonly ArchivoGuardado[];
  onAbrir: () => void;
}

/** Píldora de la FILA del Historial: "Doc ✓", "Doc ✓ (3)" o "Sin doc"; abre "Documentos de la factura". */
export function PildoraDocsFactura({ archivos, onAbrir }: PropsPildora) {
  const alClic = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation(); // la fila abre la Ficha
    onAbrir();
  };
  return (
    <button type="button" className={`tdf-pill ${archivos.length > 0 ? 'tdf-pill--ok' : 'tdf-pill--falta'}`} title={tituloPildoraDocs(archivos)} onClick={alClic}>
      {etiquetaPildoraDocs(archivos.length)}
    </button>
  );
}

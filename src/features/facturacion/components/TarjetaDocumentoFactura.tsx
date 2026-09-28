// src/features/facturacion/components/TarjetaDocumentoFactura.tsx
// ✅ V00381: tarjeta GRANDE del documento de la factura (Clientes y Proveedores).
//   Se usa en la Ficha de Factura, en "Confirmar Factura" y en "Editar Factura"
//   para que se note a simple vista si el documento YA está cargado.
//   Estados: cargado (verde) · listo para subir (azul) · subiendo · sin documento (ámbar).
import React from 'react';
import './TarjetaDocumentoFactura.css';

interface Props {
  url?: unknown;
  nombre?: unknown;
  fecha?: unknown;
  por?: unknown;
  /** Archivo elegido que todavía no se sube (se sube al guardar/confirmar). */
  pendiente?: File | null;
  /** Texto de cuándo se sube el pendiente. */
  notaPendiente?: string;
  subiendo?: boolean;
  /** Elegir / reemplazar archivo. */
  onElegir: () => void;
  onQuitarPendiente?: () => void;
}

const extension = (nombre: string): string => {
  const m = nombre.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  return m ? m[1].toUpperCase() : 'DOC';
};

const fechaCorta = (v: unknown): string => {
  const s = String(v ?? '').slice(0, 10);
  const [a, m, d] = s.split('-');
  return a && m && d ? `${d}/${m}/${a}` : s;
};

const tamano = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const IconoCheck = () => (
  <svg className="tdf-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
);
const IconoAlerta = () => (
  <svg className="tdf-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
);

export const TarjetaDocumentoFactura: React.FC<Props> = ({ url, nombre, fecha, por, pendiente, notaPendiente, subiendo, onElegir, onQuitarPendiente }) => {
  const link = String(url || '');
  const nombreDoc = String(nombre || '') || 'Documento de la factura';

  if (subiendo) {
    return (
      <div className="tdf tdf--subiendo" role="status">
        <div className="tdf-archivo">…</div>
        <div className="tdf-cuerpo">
          <span className="tdf-estado">Subiendo documento…</span>
          <span className="tdf-meta">No cierres la ventana hasta que termine.</span>
        </div>
      </div>
    );
  }

  if (pendiente) {
    return (
      <div className="tdf tdf--pendiente">
        <div className="tdf-archivo">{extension(pendiente.name)}</div>
        <div className="tdf-cuerpo">
          <span className="tdf-estado"><IconoCheck /> Documento listo para subir</span>
          <span className="tdf-nombre" title={pendiente.name}>{pendiente.name}</span>
          <span className="tdf-meta">{tamano(pendiente.size)} · {notaPendiente || 'Se subirá al guardar'}</span>
        </div>
        <div className="tdf-acciones">
          <button type="button" className="tdf-btn" onClick={onElegir}>Cambiar</button>
          {onQuitarPendiente && <button type="button" className="tdf-btn tdf-btn--quitar" onClick={onQuitarPendiente}>Quitar</button>}
        </div>
      </div>
    );
  }

  if (link) {
    const meta = [fecha ? `Cargado el ${fechaCorta(fecha)}` : 'Cargado', String(por || '') ? `por ${String(por)}` : ''].filter(Boolean).join(' ');
    return (
      <div className="tdf tdf--ok">
        <div className="tdf-archivo">{extension(nombreDoc)}</div>
        <div className="tdf-cuerpo">
          <span className="tdf-estado"><IconoCheck /> Documento cargado</span>
          <span className="tdf-nombre" title={nombreDoc}>{nombreDoc}</span>
          <span className="tdf-meta">{meta}</span>
        </div>
        <div className="tdf-acciones">
          <a className="tdf-btn tdf-btn--ver" href={link} target="_blank" rel="noopener noreferrer">Ver documento</a>
          <button type="button" className="tdf-btn" onClick={onElegir}>Reemplazar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tdf tdf--vacio">
      <div className="tdf-archivo tdf-archivo--vacio">—</div>
      <div className="tdf-cuerpo">
        <span className="tdf-estado"><IconoAlerta /> Sin documento de la factura</span>
        <span className="tdf-meta">Aún no se ha cargado el PDF o la imagen de esta factura.</span>
      </div>
      <div className="tdf-acciones">
        <button type="button" className="tdf-btn tdf-btn--subir" onClick={onElegir}>Subir documento</button>
      </div>
    </div>
  );
};

export default TarjetaDocumentoFactura;

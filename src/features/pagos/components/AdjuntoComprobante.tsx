// src/features/pagos/components/AdjuntoComprobante.tsx
// ✅ V00450: COMPROBANTE del pago (estilo "Attachments" de QuickBooks) en Registrar y Editar Pago.
//   · Zona punteada: clic o arrastrar el archivo (PDF o imagen, máx. 20 MB).
//   · Renglón del archivo: nombre, tamaño, Ver/Ocultar, Reemplazar y × (quitar el nuevo).
//   · Vista previa en el MISMO formulario: PDF en un visor, imagen tal cual.
//   El archivo se sube al guardar el pago (como antes): aquí solo se elige y se ve.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { esImagen, esPdf, MAX_MB_COMPROBANTE, tamanoLegible, validarComprobante } from '../services/comprobante';
import './AdjuntoComprobante.css';

const TIPOS = 'application/pdf,image/*';

interface Props {
  /** Archivo nuevo elegido (todavía sin subir). */
  archivo: File | null;
  onArchivo: (archivo: File | null) => void;
  /** Comprobante ya guardado en el pago (Editar). */
  existente?: { url: string; nombre: string } | null;
  etiqueta?: string;
}

export default function AdjuntoComprobante({ archivo, onArchivo, existente = null, etiqueta = 'Comprobante (PDF o imagen, opcional)' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [verPrevia, setVerPrevia] = useState(true);

  // URL local del archivo nuevo para la vista previa. Se libera cuando deja de usarse (con el
  // retraso, el doble montaje de StrictMode en desarrollo no la libera mientras se ve).
  const urlNueva = useMemo(() => (archivo ? URL.createObjectURL(archivo) : ''), [archivo]);
  const enUsoRef = useRef('');
  useEffect(() => {
    enUsoRef.current = urlNueva;
    return () => {
      enUsoRef.current = '';
      setTimeout(() => { if (urlNueva && enUsoRef.current !== urlNueva) URL.revokeObjectURL(urlNueva); }, 0);
    };
  }, [urlNueva]);

  const elegir = (f: File | null | undefined): void => {
    if (!f) return;
    const error = validarComprobante(f);
    if (error) { alert(error); return; }
    setVerPrevia(true);
    onArchivo(f);
  };
  const alElegir = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    elegir(f);
  };
  const abrirSelector = (): void => inputRef.current?.click();
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirSelector(); }
  };
  // Arrastrar y soltar en TODO el bloque (también sobre el archivo y la vista previa): soltar
  // un archivo fuera de la zona abría el archivo en el navegador y se perdía el pago a medias.
  const alArrastrar = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!arrastrando) setArrastrando(true);
  };
  const alSalir = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false);
  };
  const alSoltar = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setArrastrando(false);
    elegir(e.dataTransfer.files?.[0]);
  };

  // Lo que se muestra: el nuevo manda; si no hay, el ya guardado.
  const actual = archivo
    ? { url: urlNueva, nombre: archivo.name, tipo: archivo.type, tamano: tamanoLegible(archivo.size), nuevo: true }
    : existente?.url
      ? { url: existente.url, nombre: existente.nombre || 'Comprobante', tipo: '', tamano: '', nuevo: false }
      : null;

  return (
    <div className={`adj-caja${arrastrando ? ' adj-caja--arrastrando' : ''}`} onDragOver={alArrastrar} onDragEnter={alArrastrar} onDragLeave={alSalir} onDrop={alSoltar}>
      <div className="adj-etiqueta">{etiqueta}</div>
      <input ref={inputRef} type="file" accept={TIPOS} className="adj-input-oculto" onChange={alElegir} tabIndex={-1} aria-hidden="true" />

      {actual ? (
        <>
          <div className="adj-renglon">
            <span className="adj-icono" aria-hidden="true">{esPdf(actual.nombre, actual.tipo) ? '📄' : '🖼️'}</span>
            <button type="button" className="adj-nombre" title={verPrevia ? 'Ocultar vista previa' : 'Ver vista previa'} onClick={() => setVerPrevia((v) => !v)}>
              {actual.nombre}
            </button>
            {actual.tamano && <span className="adj-tamano">{actual.tamano}</span>}
            <span className={`adj-estado${actual.nuevo ? ' adj-estado--nuevo' : ''}`}>{actual.nuevo ? 'Se sube al guardar' : 'Guardado'}</span>
            <span className="adj-acciones">
              <button type="button" className="adj-btn" onClick={() => setVerPrevia((v) => !v)}>{verPrevia ? 'Ocultar' : 'Ver'}</button>
              <button type="button" className="adj-btn" onClick={abrirSelector} title="Elegir otro archivo en lugar de este">Reemplazar</button>
              {actual.nuevo && (
                <button type="button" className="adj-quitar" onClick={() => onArchivo(null)}
                  title={existente?.url ? 'Quitar el archivo nuevo (se queda el comprobante guardado)' : 'Quitar el archivo'} aria-label="Quitar el archivo">×</button>
              )}
            </span>
          </div>
          {actual.nuevo && existente?.url && (
            <div className="adj-nota">Al guardar, este archivo reemplaza a «{existente.nombre || 'el comprobante anterior'}».</div>
          )}
          {verPrevia && (
            <div className="adj-previa">
              {esPdf(actual.nombre, actual.tipo) ? (
                <iframe className="adj-visor-pdf" src={actual.url} title={`Vista previa de ${actual.nombre}`} />
              ) : esImagen(actual.nombre, actual.tipo) ? (
                <img className="adj-visor-img" src={actual.url} alt={`Vista previa de ${actual.nombre}`} />
              ) : (
                <div className="adj-sin-previa">Sin vista previa para este tipo de archivo.</div>
              )}
              <a className="adj-abrir" href={actual.url} target="_blank" rel="noopener noreferrer">Abrir en otra pestaña ↗</a>
            </div>
          )}
        </>
      ) : (
        <div
          className="adj-zona"
          role="button"
          tabIndex={0}
          onClick={abrirSelector}
          onKeyDown={alTeclear}
        >
          <span className="adj-zona-titulo">📎 Agregar comprobante</span>
          <span className="adj-zona-sub">Arrastra aquí o haz clic · PDF o imagen · Máx. {MAX_MB_COMPROBANTE} MB</span>
        </div>
      )}
    </div>
  );
}

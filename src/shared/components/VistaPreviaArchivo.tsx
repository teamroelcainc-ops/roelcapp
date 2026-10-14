// src/shared/components/VistaPreviaArchivo.tsx
// ✅ V00451: vista previa de UN archivo en el mismo formulario: PDF en un visor, imagen tal cual,
//   y "Abrir en otra pestaña". La usan AdjuntosArchivos y las listas de documentos (expedientes).
import { esImagen, esPdf } from '../archivos/adjuntos';
import './AdjuntosArchivos.css';

interface Props {
  url: string;
  nombre: string;
  tipo?: string;
}

export default function VistaPreviaArchivo({ url, nombre, tipo = '' }: Props) {
  return (
    <div className="adj-previa">
      {!url ? (
        <div className="adj-sin-previa">Preparando vista previa…</div>
      ) : esPdf(nombre, tipo) || esPdf(url) ? (
        <iframe className="adj-visor-pdf" src={url} title={`Vista previa de ${nombre}`} />
      ) : esImagen(nombre, tipo) || esImagen(url) ? (
        <img className="adj-visor-img" src={url} alt={`Vista previa de ${nombre}`} />
      ) : (
        <div className="adj-sin-previa">Sin vista previa para este tipo de archivo.</div>
      )}
      {/* Chrome no abre `data:` en otra pestaña (fotos guardadas en base64): ahí no se ofrece. */}
      {url && !url.startsWith('data:') && <a className="adj-abrir" href={url} target="_blank" rel="noopener noreferrer">Abrir en otra pestaña ↗</a>}
    </div>
  );
}

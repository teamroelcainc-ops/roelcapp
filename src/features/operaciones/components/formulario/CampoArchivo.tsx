// src/features/operaciones/components/formulario/CampoArchivo.tsx
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — campo de archivo con arrastrar y soltar y el botón "+"
// del formulario de operación (antes dentro de FormularioOperacion.tsx). Los
// estilos en línea pasaron a CampoArchivo.css (mismos colores) y el hover del
// botón "+" a CSS (antes onMouseEnter/onMouseLeave).
//
// FIX ARRASTRE DE DOCUMENTOS (de siempre):
//   - Contenedor con onClick explícito (un <label> re-disparaba un "click" al
//     soltar y, si se cancelaba, borraba el archivo recién arrastrado).
//   - input con ref + DataTransfer para asignar un FileList real.
//   - onChange del input SOLO se propaga cuando de verdad hay archivos (cancelar
//     el diálogo ya NO borra el archivo cargado).
//   - dragDepth evita el parpadeo al pasar sobre elementos hijos.
// ---------------------------------------------------------------------------
import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, MouseEvent } from 'react';
import { IconCheck, IconPlus, IconX } from './iconos';
import './CampoArchivo.css';

export const BotonAgregar = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <button className="fo-x3" type="button" onClick={onClick} title={title}>
    <IconPlus size={17} />
  </button>
);

/** Evento "como si" viniera del input (los formularios leen `target.files`). */
const eventoDeArchivos = (files: FileList | null): ChangeEvent<HTMLInputElement> =>
  ({ target: files ? { files } : { value: '', files: null } }) as unknown as ChangeEvent<HTMLInputElement>;

export const CampoArchivo = ({
  label,
  file,
  onChange,
  accept = '.pdf',
  resaltar = false,
}: {
  label: string;
  file: File | null | undefined;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  accept?: string;
  resaltar?: boolean;
}) => {
  const cargado = !!file;
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const emitirArchivos = (lista: FileList | null) => {
    const arr = lista ? Array.from(lista).filter(Boolean) : [];
    if (arr.length === 0) {
      if (inputRef.current) inputRef.current.value = '';
      onChange(eventoDeArchivos(null));
      return;
    }
    try {
      const dt = new DataTransfer();
      arr.forEach((f) => dt.items.add(f));
      if (inputRef.current) inputRef.current.files = dt.files;
      onChange(eventoDeArchivos(dt.files));
    } catch {
      onChange(eventoDeArchivos(lista));
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setArrastrando(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) { dragDepth.current = 0; setArrastrando(false); }
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setArrastrando(false);
    const archivos = e.dataTransfer?.files;
    if (archivos && archivos.length > 0) emitirArchivos(archivos);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) onChange(e);
  };

  const abrirDialogo = () => { inputRef.current?.click(); };

  const quitarArchivo = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (inputRef.current) inputRef.current.value = '';
    onChange(eventoDeArchivos(null));
  };

  // Un solo estado visual, con la misma prioridad de antes: arrastrando > cargado > resaltar.
  const estado = arrastrando ? 'arrastrando' : cargado ? 'cargado' : resaltar ? 'resaltar' : 'vacio';

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div
        role="button"
        className={`fo-archivo fo-archivo--${estado}`}
        onClick={abrirDialogo}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className={`fo-archivo-icono${cargado ? ' fo-archivo-icono--cargado' : ''}`}>
          {cargado ? <IconCheck size={15} /> : <IconPlus size={15} />}
        </span>
        <span className={`fo-archivo-texto${cargado ? ' fo-archivo-texto--cargado' : ''}${arrastrando ? ' fo-archivo-texto--arrastrando' : ''}`}>
          {arrastrando ? 'Suelta el archivo aquí…' : (cargado ? `✓ ${file?.name ?? ''}` : 'Haz clic o arrastra un archivo aquí')}
        </span>
        {cargado && !arrastrando && (
          <button className="fo-x4" type="button" title="Quitar archivo" onClick={quitarArchivo}>
            <IconX size={12} /> Quitar
          </button>
        )}
        <input className="fo-x5" ref={inputRef} type="file" accept={accept} onChange={handleInputChange} />
      </div>
    </div>
  );
};

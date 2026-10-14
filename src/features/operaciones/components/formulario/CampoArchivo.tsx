// src/features/operaciones/components/formulario/CampoArchivo.tsx
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — campo de archivo y botón "+" del formulario de operación
// (antes dentro de FormularioOperacion.tsx).
// ✅ V00451 — el campo usa la carga de archivos de toda la app (AdjuntosArchivos, la de Pagos):
//   VARIOS archivos por documento (sin límite: es el expediente de la operación), arrastrar y
//   soltar, vista previa en el mismo formulario, Reemplazar y quitar ANTES de guardar. Los
//   archivos se suben al guardar la operación (documentosOperacion.ts). Antes: un solo PDF.
// ---------------------------------------------------------------------------
import AdjuntosArchivos from '../../../../shared/components/AdjuntosArchivos';
import { SIN_LIMITE } from '../../../../shared/archivos/adjuntos';
import type { Adjunto } from '../../../../shared/archivos/adjuntos';
import { IconPlus } from './iconos';
import './CampoArchivo.css';

export const BotonAgregar = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <button className="fo-x3" type="button" onClick={onClick} title={title}>
    <IconPlus size={17} />
  </button>
);

export const CampoArchivo = ({
  label,
  adjuntos,
  onCambiar,
  resaltar = false,
}: {
  label: string;
  adjuntos: readonly Adjunto[];
  onCambiar: (adjuntos: Adjunto[]) => void;
  /** Campo obligatorio (Reglas de Estatus) que todavía no tiene archivo. */
  resaltar?: boolean;
}) => (
  <div className={`form-group fca-campo${resaltar && adjuntos.length === 0 ? ' fca-campo--falta' : ''}`}>
    <AdjuntosArchivos etiqueta={label} adjuntos={adjuntos} onCambiar={onCambiar} max={SIN_LIMITE} tipos="pdf-imagen" previaCerrada />
  </div>
);

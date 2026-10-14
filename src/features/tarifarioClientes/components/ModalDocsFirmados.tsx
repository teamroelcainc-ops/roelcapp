// src/features/tarifarioClientes/components/ModalDocsFirmados.tsx
// ✅ V00451: "Documento firmado de <tarifario>" — una sola ventana para ver, agregar, reemplazar
//   y quitar los archivos del tarifario firmado (hasta 10, PDF o imagen), con vista previa.
//   Antes la fila, la ficha y el candado de Aprobar abrían el selector y subían UN archivo al
//   instante. Ahora se sube al dar Guardar. La usan Tarifario Clientes y Tarifario Proveedores.
import { useId, useState } from 'react';
import type { DragEvent } from 'react';
import AdjuntosArchivos from '../../../shared/components/AdjuntosArchivos';
import { cambioAdjuntos, desdeGuardados } from '../../../shared/archivos/adjuntos';
import type { Adjunto, ArchivoGuardado } from '../../../shared/archivos/adjuntos';
import { avisar } from '../../../shared/data/avisos';
import { MAX_DOCS_FIRMADOS, guardarDocsFirmados } from '../services/docsFirmados';
import type { LadoTarifario } from '../services/docsFirmados';
import './ModalDocsFirmados.css';

interface Props {
  lado: LadoTarifario;
  /** Id del documento del tarifario. */
  id: string;
  /** Consecutivo del tarifario (TAR-###) para el título. */
  consecutivo: string;
  /** Cliente o proveedor (título y bitácora). */
  nombreEntidad: string;
  /** Archivos ya guardados en el tarifario cuando se abrió la ventana. */
  guardados: readonly ArchivoGuardado[];
  /** "Tarifario obligatorio" = Sí: sin documento no se aprueba. */
  obligatorio: boolean;
  /** Se abrió desde Aprobar: al guardar, la aprobación continúa (lo hace la pantalla en onGuardado). */
  aprobarDespues?: boolean;
  onCerrar: () => void;
  /** Lista final, ya guardada. Se llama después de cerrar la ventana. */
  onGuardado?: (lista: ArchivoGuardado[]) => void;
}

const motivo = (e: unknown): string => {
  const o = e as { code?: unknown; message?: unknown } | null;
  return String(o?.code || o?.message || e);
};

export default function ModalDocsFirmados({
  lado, id, consecutivo, nombreEntidad, guardados, obligatorio, aprobarDespues = false, onCerrar, onGuardado,
}: Props) {
  const idTitulo = useId();
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>(() => desdeGuardados(guardados));
  const [guardando, setGuardando] = useState(false);
  const cambio = cambioAdjuntos(adjuntos, guardados);

  const cerrar = (): void => {
    if (guardando) return;
    if (cambio && !window.confirm('¿Salir sin guardar los cambios del documento firmado?')) return;
    onCerrar();
  };

  const guardar = async (): Promise<void> => {
    if (guardando || !cambio) return;
    setGuardando(true);
    let lista: ArchivoGuardado[];
    try {
      lista = await guardarDocsFirmados(lado, id, nombreEntidad, adjuntos, guardados);
    } catch (e) {
      console.error('[Tarifario] No se pudo guardar el documento firmado:', e);
      alert(`No se pudo guardar el documento firmado.\n\nMotivo: ${motivo(e)}`);
      setGuardando(false);
      return;
    }
    avisar({
      titulo: 'Tarifario firmado',
      texto: lista.length ? `${consecutivo}: ${lista.length} archivo(s) guardado(s).` : `${consecutivo}: sin documento firmado.`,
      tipo: 'info',
    });
    onCerrar();
    onGuardado?.(lista);
  };

  // Un archivo soltado fuera de la zona (sobre el fondo) no debe abrirse en el navegador y sacar al
  // usuario de la app: se ignora.
  const ignorarSoltar = (e: DragEvent<HTMLDivElement>): void => { e.preventDefault(); };

  return (
    <div className="modal-overlay tfm-overlay" onClick={cerrar} onDragOver={ignorarSoltar} onDrop={ignorarSoltar}>
      <div className="tfm-modal" role="dialog" aria-modal="true" aria-labelledby={idTitulo} onClick={(e) => e.stopPropagation()}>
        <div className="tfm-encabezado">
          <div>
            <h3 className="tfm-titulo" id={idTitulo}>
              Documento firmado de {consecutivo}{nombreEntidad && <> · <span className="tfm-entidad">{nombreEntidad}</span></>}
            </h3>
            <p className="tfm-sub">
              {obligatorio ? 'Obligatorio para aprobar' : 'Opcional para este tarifario'}
              {aprobarDespues && ' · al guardar, la aprobación continúa'}
            </p>
          </div>
          <button type="button" className="tfm-cerrar" onClick={cerrar} disabled={guardando} aria-label="Cerrar">✕</button>
        </div>

        <AdjuntosArchivos
          etiqueta="Tarifario firmado (escaneado)"
          adjuntos={adjuntos}
          onCambiar={setAdjuntos}
          max={MAX_DOCS_FIRMADOS}
          tipos="pdf-imagen"
          deshabilitado={guardando}
        />

        <div className="tfm-pie">
          <button type="button" className="btn btn-outline" onClick={cerrar} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando || !cambio}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

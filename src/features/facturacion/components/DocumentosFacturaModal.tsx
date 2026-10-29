// src/features/facturacion/components/DocumentosFacturaModal.tsx
// ✅ V00451: "Documentos de la factura <folio>" (Clientes y Proveedores). Lo abren la píldora de la
//   fila (Doc ✓ / Sin doc) y la tarjeta de la Ficha. Ver (vista previa en el mismo modal, con el
//   primero ya abierto), agregar (hasta 10), reemplazar o quitar; nada se sube hasta Guardar.
//   Antes: clic abría el documento en otra pestaña y Ctrl+clic lo reemplazaba al instante.
import { useState } from 'react';
import AdjuntosArchivos from '../../../shared/components/AdjuntosArchivos';
import { cambioAdjuntos, desdeGuardados } from '../../../shared/archivos/adjuntos';
import type { Adjunto } from '../../../shared/archivos/adjuntos';
import { MAX_DOCS_FACTURA, detalleError, docsDeFactura, folioDeFila, idsDeFila } from '../services/documentosFactura';
import type { EscrituraDocs, LadoDocsFactura } from '../services/documentosFactura';
import { guardarDocsFactura } from '../services/guardarDocsFactura';
import type { FacturaEsperada } from '../services/documentoFactura';
import RevisionDocumentosFactura from './RevisionDocumentosFactura'; // ✅ V00514
import './DocumentosFacturaModal.css';

interface Props {
  lado: LadoDocsFactura;
  /** Fila del Historial (puede juntar varios documentos con el mismo folio) o factura suelta. */
  fila: Record<string, unknown>;
  /** ✅ V00514: los datos de la factura para revisar el PDF / XML que se agrega (solo Clientes). */
  esperado?: FacturaEsperada | null;
  onGuardado: (escrituras: EscrituraDocs[]) => void;
  onCerrar: () => void;
}

export default function DocumentosFacturaModal({ lado, fila, esperado = null, onGuardado, onCerrar }: Props) {
  const [antes] = useState(() => docsDeFactura(fila));
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>(() => desdeGuardados(antes));
  const [guardando, setGuardando] = useState(false);
  const cambio = cambioAdjuntos(adjuntos, antes);
  const folio = folioDeFila(fila);
  const agrupados = idsDeFila(fila).length;

  const cerrar = (): void => {
    if (guardando) return;
    if (cambio && !window.confirm('¿Cerrar sin guardar los cambios de los documentos?')) return;
    onCerrar();
  };

  const guardar = async (): Promise<void> => {
    if (!cambio) { onCerrar(); return; }
    setGuardando(true);
    try {
      const escrituras = await guardarDocsFactura(lado, fila, adjuntos);
      if (escrituras) onGuardado(escrituras);
      onCerrar();
    } catch (e: unknown) {
      console.error('[Facturación] No se guardaron los documentos de la factura:', e);
      alert(`No se pudieron guardar los documentos.\n\nMotivo: ${detalleError(e)}`);
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay dfm-fondo" role="dialog" aria-modal="true" aria-label={`Documentos de la factura ${folio}`}>
      <div className="dfm-caja">
        <div className="dfm-cabeza">
          <h2 className="dfm-titulo">Documentos de la factura <span className="dfm-folio">{folio}</span></h2>
          <button type="button" className="dfm-cerrar" onClick={cerrar} disabled={guardando} aria-label="Cerrar">✕</button>
        </div>
        {agrupados > 1 && <p className="dfm-nota">Este folio junta {agrupados} registros: los documentos se guardan juntos en el primero.</p>}
        <AdjuntosArchivos etiqueta="PDF o imagen" adjuntos={adjuntos} onCambiar={setAdjuntos} max={MAX_DOCS_FACTURA} deshabilitado={guardando} />
        {esperado && <RevisionDocumentosFactura adjuntos={adjuntos} esperado={esperado} />}
        <div className="dfm-pie">
          <button type="button" className="dfm-btn" onClick={cerrar} disabled={guardando}>Cancelar</button>
          <button type="button" className="dfm-btn dfm-btn--guardar" onClick={() => void guardar()} disabled={guardando || !cambio}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

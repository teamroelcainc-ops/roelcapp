// src/features/facturacion/components/ModalCancelarFactura.tsx
// ✅ V00481 — al pasar una factura a Cancelado (desde la ficha) se pide la nota y el número de la
// factura que la reemplaza; sin los dos no se cancela.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CANCELACION_VACIA, validarCancelacion } from '../services/reglasFactura';
import type { DatosCancelacion } from '../services/reglasFactura';
import CamposCancelacion from './CamposCancelacion';
import './ModalCancelarFactura.css';

interface Props {
  invoice: string;
  sugerencias?: readonly string[];
  onVolver: () => void;
  /** Guarda la cancelación; si lanza, el mensaje se muestra en la ventana. */
  onConfirmar: (datos: DatosCancelacion) => Promise<void>;
}

export default function ModalCancelarFactura({ invoice, sugerencias = [], onVolver, onConfirmar }: Props) {
  const [datos, setDatos] = useState<DatosCancelacion>(CANCELACION_VACIA);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const confirmar = async () => {
    const falta = validarCancelacion(datos, invoice);
    if (falta) { setError(falta); return; }
    setGuardando(true);
    setError('');
    try {
      await onConfirmar(datos);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'No se pudo cancelar la factura. Intenta de nuevo.');
      setGuardando(false);
    }
  };

  return createPortal(
    <div className="modal-overlay mcf-fondo" role="dialog" aria-modal="true" aria-labelledby="mcf-titulo">
      <div className="mcf-ventana">
        <h2 id="mcf-titulo" className="mcf-titulo">Cancelar la factura {invoice}</h2>
        <p className="mcf-texto">Para cancelarla escribe por qué y el número de la factura que la reemplaza. Las dos cosas se guardan en la ficha.</p>
        <CamposCancelacion idBase="mcf" valor={datos} onCambiar={(v) => { setDatos(v); setError(''); }} sugerencias={sugerencias} deshabilitado={guardando} />
        {error && <p className="mcf-error" role="alert">{error}</p>}
        <div className="mcf-acciones">
          <button type="button" className="mcf-volver" onClick={onVolver} disabled={guardando}>No cancelar</button>
          <button type="button" className="mcf-confirmar" onClick={() => { void confirmar(); }} disabled={guardando}>
            {guardando ? 'Cancelando…' : 'Cancelar factura'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

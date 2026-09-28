// src/features/operaciones/components/ModalFechaStatus.tsx
// ✅ V00384: al presionar un botón de SIGUIENTE PASO se pide la FECHA y HORA
//   del movimiento (igual que "Registrar Movimiento"), con la hora actual
//   precargada. Confirmar registra el estatus con esa fecha/hora.
import React, { useEffect, useState } from 'react';
import './ModalFechaStatus.css';

interface Props {
  status: string;
  fechaInicial: string; // YYYY-MM-DDTHH:mm
  onConfirmar: (fechaHora: string) => void;
  onCancelar: () => void;
}

export const ModalFechaStatus: React.FC<Props> = ({ status, fechaInicial, onConfirmar, onCancelar }) => {
  const [fechaHora, setFechaHora] = useState(fechaInicial);
  useEffect(() => { setFechaHora(fechaInicial); }, [fechaInicial]);

  const confirmar = () => {
    if (!fechaHora) { alert('Captura la fecha y la hora del movimiento.'); return; }
    onConfirmar(fechaHora);
  };

  return (
    <div className="mfs-fondo" onClick={onCancelar}>
      <div className="mfs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mfs-enc">
          <h3 className="mfs-titulo">Registrar Movimiento</h3>
          <button type="button" className="mfs-cerrar" onClick={onCancelar} aria-label="Cerrar">✕</button>
        </div>
        <div className="mfs-cuerpo">
          <div>
            <span className="mfs-etq">Estatus</span>
            <div className="mfs-status">{status}</div>
          </div>
          <label className="mfs-campo">
            <span className="mfs-etq">Fecha y Hora</span>
            <input
              type="datetime-local"
              className="mfs-input"
              value={fechaHora}
              onChange={(e) => setFechaHora(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmar(); }}
              autoFocus
            />
          </label>
        </div>
        <div className="mfs-pie">
          <button type="button" className="mfs-btn" onClick={onCancelar}>Cancelar</button>
          <button type="button" className="mfs-btn mfs-btn--primario" onClick={confirmar}>Guardar</button>
        </div>
      </div>
    </div>
  );
};

export default ModalFechaStatus;

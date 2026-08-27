// src/features/autorizaciones/ModalAccesoCampo.tsx
// ✅ V00141: modal genérico "No tienes acceso para modificar este campo".
//   Se renderiza una vez por formulario y se controla con useAutorizacionesCampos:
//   al hacer clic en un campo bloqueado, el formulario llama aut.abrirSolicitudAcceso(campo)
//   y este modal ofrece "Solicitar autorización" (cola de Autorizaciones).
import React from 'react';
import type { CtrlAutorizaciones } from './useAutorizacionesCampos';
import { HORAS_VIGENCIA_ACCESO } from './autorizaciones';
import './ModalAccesoCampo.css';

export const ModalAccesoCampo: React.FC<{ aut: CtrlAutorizaciones }> = ({ aut }) => {
  if (!aut.solicitudCampo) return null;
  const etiqueta = aut.etiquetas[aut.solicitudCampo] || aut.solicitudCampo;
  return (
    <div className="modal-overlay mac-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !aut.solicitudEnviando) aut.cerrarSolicitudAcceso(); }}>
      <div className="mac-card">
        <div className="mac-header">
          <h3 className="mac-titulo">🔒 Campo bloqueado</h3>
          <button type="button" className="mac-cerrar" onClick={aut.cerrarSolicitudAcceso} disabled={aut.solicitudEnviando}>✕</button>
        </div>
        <div className="mac-cuerpo">
          {aut.solicitudEnviada ? (
            <>
              <p className="mac-txt mac-ok">✅ Solicitud enviada.</p>
              <p className="mac-sub">Un Administrador la verá en <b>Configuración → Autorizaciones → Pendientes</b>. Cuando la resuelva te llegará una <b>notificación</b> en la campana (arriba a la derecha); si se aprueba, tendrás acceso al campo durante {HORAS_VIGENCIA_ACCESO} horas.</p>
              <div className="mac-acciones"><button type="button" className="btn btn-primary" onClick={aut.cerrarSolicitudAcceso}>Entendido</button></div>
            </>
          ) : (
            <>
              <p className="mac-txt">No tienes acceso para modificar este campo</p>
              <p className="mac-sub">El campo <b>"{etiqueta}"</b> está bloqueado por Autorizaciones para tu rol. Puedes pedir a un Administrador que te dé acceso temporal.</p>
              <div className="mac-acciones">
                <button type="button" className="btn btn-outline" onClick={aut.cerrarSolicitudAcceso} disabled={aut.solicitudEnviando}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={aut.enviarSolicitudAcceso} disabled={aut.solicitudEnviando}>{aut.solicitudEnviando ? 'Enviando…' : '📨 Solicitar autorización'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

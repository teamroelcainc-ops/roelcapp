// src/shared/components/AvisosFlotantes.tsx
// ✅ V00450: notificaciones flotantes (esquina inferior derecha) de src/shared/data/avisos.ts.
//   Se monta UNA vez en App. Cada aviso se quita solo; "Ver" abre la pestaña Revisión
//   del módulo que lo generó.
import { irARevision, quitarAviso, useAvisos } from '../data/avisos';
import './AvisosFlotantes.css';

export default function AvisosFlotantes() {
  const { flotantes } = useAvisos();
  if (flotantes.length === 0) return null;
  return (
    <div className="avf-pila" role="region" aria-label="Notificaciones">
      {flotantes.map((a) => (
        <div key={a.id} className={`avf-aviso avf-aviso--${a.tipo}`} role="alert">
          <div className="avf-icono" aria-hidden="true">{a.tipo === 'alerta' ? '⚠️' : 'ℹ️'}</div>
          <div className="avf-cuerpo">
            <div className="avf-titulo">{a.titulo}</div>
            <div className="avf-texto">{a.texto}</div>
            {a.modulo && (
              <button type="button" className="avf-ver" onClick={() => { const m = a.modulo; quitarAviso(a.id); if (m) irARevision(m); }}>
                Ver en Revisión
              </button>
            )}
          </div>
          <button type="button" className="avf-cerrar" onClick={() => quitarAviso(a.id)} aria-label="Cerrar notificación" title="Cerrar">×</button>
        </div>
      ))}
    </div>
  );
}

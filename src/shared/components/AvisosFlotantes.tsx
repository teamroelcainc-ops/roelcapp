// src/shared/components/AvisosFlotantes.tsx
// ✅ V00450: notificaciones flotantes (esquina inferior derecha) de src/shared/data/avisos.ts.
//   Se monta UNA vez en App. Cada aviso se quita solo; "Ver" abre la pestaña Revisión
//   del módulo que lo generó.
//   ✅ V00470: también la VENTANA (pop-up) de mostrarVentana(), una a la vez, con "Entendido".
import { useEffect, useRef } from 'react';
import { cerrarVentana, irARevision, quitarAviso, useAvisos } from '../data/avisos';
import type { AvisoVentana } from '../data/avisos';
import './AvisosFlotantes.css';

function VentanaAviso({ ventana }: { ventana: AvisoVentana }) {
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => { boton.current?.focus(); }, [ventana.id]);
  return (
    <div className="avf-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrarVentana(ventana.id); }}>
      <div className="avf-ventana" role="dialog" aria-modal="true" aria-labelledby={`avf-ventana-${ventana.id}`}
        onKeyDown={(e) => { if (e.key === 'Escape') cerrarVentana(ventana.id); }}>
        <h2 id={`avf-ventana-${ventana.id}`} className="avf-ventana-titulo">{ventana.titulo}</h2>
        {ventana.parrafos.map((p) => <p key={p} className="avf-ventana-texto">{p}</p>)}
        <button ref={boton} type="button" className="avf-ventana-ok" onClick={() => cerrarVentana(ventana.id)}>Entendido</button>
      </div>
    </div>
  );
}

export default function AvisosFlotantes() {
  const { flotantes, ventanas } = useAvisos();
  if (flotantes.length === 0 && ventanas.length === 0) return null;
  return (
    <>
    {ventanas[0] && <VentanaAviso ventana={ventanas[0]} />}
    {flotantes.length > 0 && (
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
    )}
    </>
  );
}

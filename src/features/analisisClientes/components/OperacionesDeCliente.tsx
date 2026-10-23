// src/features/analisisClientes/components/OperacionesDeCliente.tsx
// ✅ V00479 — ventana con las operaciones de un cliente en el periodo, de la más reciente a la
// primera (las mismas que cuenta el análisis: sin canceladas ni pruebas).
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDiaMes, operacionesDeCliente } from '../services/analisisClientes';
import type { OpAnalisis, Periodo, RolCliente } from '../services/analisisClientes';
import './OperacionesDeCliente.css';

const TANDA = 100;
const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

interface Props {
  ops: readonly OpAnalisis[];
  rol: RolCliente;
  clienteId: string;
  nombre: string;
  periodo: Periodo;
  onCerrar: () => void;
}

export default function OperacionesDeCliente({ ops, rol, clienteId, nombre, periodo, onCerrar }: Props) {
  const lista = useMemo(() => operacionesDeCliente(ops, rol, clienteId), [ops, rol, clienteId]);
  const [limite, setLimite] = useState(TANDA);
  const cerrarConEscape = useEffectEvent((e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); });
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => cerrarConEscape(e);
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);
  const otro = rol === 'paga' ? 'Cliente Mercancía' : 'Cliente Paga';

  return createPortal(
    <div className="aco-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="aco-modal" role="dialog" aria-modal="true" aria-labelledby="aco-titulo">
        <div className="aco-enc">
          <div>
            <h2 id="aco-titulo" className="aco-titulo">{nombre}</h2>
            <p className="aco-sub">
              {rol === 'paga' ? 'Cliente Paga' : 'Cliente Mercancía'} · {lista.length.toLocaleString('es-MX')} operaciones del {fmtDiaMes(periodo.inicio)} al {fmtDiaMes(periodo.fin)} de {periodo.anio}, de la más reciente a la primera
            </p>
          </div>
          <button type="button" className="aco-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <div className="aco-cuerpo">
          {lista.length === 0 ? (
            <p className="aco-vacio">Este cliente no tiene operaciones en el periodo.</p>
          ) : (
            <table className="aco-tabla">
              <thead>
                <tr>
                  <th>Fecha</th><th>Referencia</th><th>Tipo</th><th>Tráfico</th><th>Estatus</th><th>{otro}</th><th>Unidad</th><th>Convenio</th>
                </tr>
              </thead>
              <tbody>
                {lista.slice(0, limite).map((o) => {
                  const contraparte = rol === 'paga' ? o.mercancia : o.paga;
                  return (
                    <tr key={o.id} className={o.falso ? 'aco-fila--falso' : undefined}>
                      <td className="aco-fecha">{fechaCorta(o.fecha)}</td>
                      <td className="aco-ref">{o.ref}</td>
                      <td>{o.tipo || '—'}</td>
                      <td>{o.trafico || '—'}</td>
                      <td>{o.estatus || '—'}</td>
                      <td className="aco-texto">{contraparte?.nombre || '—'}</td>
                      <td>{o.unidad || '—'}</td>
                      <td className="aco-texto">{o.convenio || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {lista.length > limite && (
            <button type="button" className="btn btn-outline aco-mas" onClick={() => setLimite((l) => l + TANDA)}>
              Mostrar {Math.min(TANDA, lista.length - limite)} más ({(lista.length - limite).toLocaleString('es-MX')} restantes)
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

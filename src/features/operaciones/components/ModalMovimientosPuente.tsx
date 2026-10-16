// src/features/operaciones/components/ModalMovimientosPuente.tsx
// ✅ V00455: al presionar una tarjeta de puente (Operaciones Activas) se ven los
//   últimos MOVIMIENTOS de su saldo con rango de fechas: las referencias del
//   Historial (y otros cruces) que lo descuentan, con las mismas columnas que el
//   Historial de referencias, y los saldos agregados.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { enRango, haceDias, resumenMovimientos, type MontoMoneda, type MovimientoPuente } from '../services/movimientosPuente';
import './ModalMovimientosPuente.css';

interface Props {
  titulo: string;
  /** Saldo restante del puente (la cifra de la tarjeta). */
  restante: number;
  moneda: string;
  movimientos: readonly MovimientoPuente[];
  cargando: boolean;
  onCerrar: () => void;
}

const DIAS_POR_DEFECTO = 30;
const fmt = (n: number) => `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaCorta = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
};

function Montos({ lista, signo, clase }: { lista: readonly MontoMoneda[]; signo: string; clase: string }) {
  if (lista.length === 0) return <span className="tmov-moneda">—</span>;
  return (
    <>
      {lista.map((m) => <div key={m.moneda} className={clase}>{signo}{fmt(m.monto)} <span className="tmov-moneda">{m.moneda}</span></div>)}
    </>
  );
}

export default function ModalMovimientosPuente({ titulo, restante, moneda, movimientos, cargando, onCerrar }: Props) {
  const hoy = hoyLocalISO();
  const [desde, setDesde] = useState(() => haceDias(hoy, DIAS_POR_DEFECTO));
  const [hasta, setHasta] = useState(hoy);
  const lista = enRango(movimientos, desde, hasta);
  const r = resumenMovimientos(lista);

  return createPortal(
    <div className="modal-overlay tmov-fondo" onClick={onCerrar}>
      <div className="tmov-caja" role="dialog" aria-label={`Movimientos del saldo de ${titulo}`} onClick={(e) => e.stopPropagation()}>
        <div className="tmov-enc">
          <div>
            <h2 className="tmov-titulo">{titulo} · movimientos del saldo</h2>
            <span className="tmov-sub">Saldo restante: <b className={restante < 0 ? 'tmov-neg' : ''}>{fmt(restante)}</b>{moneda ? ` ${moneda}` : ''}</span>
          </div>
          <button type="button" className="tmov-x" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <div className="tmov-filtros">
          <label className="tmov-campo"><span>Desde</span>
            <input type="date" className="tmov-input" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="tmov-campo"><span>Hasta</span>
            <input type="date" className="tmov-input" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <div className="tmov-rapidos">
            <button type="button" className="tmov-chip" onClick={() => { setDesde(hoy); setHasta(hoy); }}>Hoy</button>
            <button type="button" className="tmov-chip" onClick={() => { setDesde(haceDias(hoy, 7)); setHasta(hoy); }}>7 días</button>
            <button type="button" className="tmov-chip" onClick={() => { setDesde(haceDias(hoy, DIAS_POR_DEFECTO)); setHasta(hoy); }}>30 días</button>
            <button type="button" className="tmov-chip" onClick={() => { setDesde(''); setHasta(''); }}>Todo</button>
          </div>
          {!cargando && (
            <dl className="tmov-resumen">
              <div><dt>Saldo agregado</dt><dd className="tmov-abono">{r.abonos.length ? r.abonos.map((m) => `+${fmt(m.monto)} ${m.moneda}`).join(' · ') : '—'}</dd></div>
              <div><dt>Descontado</dt><dd className="tmov-cargo">{r.cargos.length ? r.cargos.map((m) => `−${fmt(m.monto)} ${m.moneda}`).join(' · ') : '—'}</dd></div>
            </dl>
          )}
        </div>

        <div className="tmov-marco">
          <table className="tmov-tabla">
            <thead>
              <tr>
                <th># Referencia</th>
                <th>Puente</th>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Referencias seleccionadas</th>
                <th className="tmov-num">Total a pagar</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={6}><CargandoDatos texto="Cargando movimientos…" /></td></tr>
              ) : lista.length === 0 ? (
                <tr><td colSpan={6} className="tmov-vacio">Sin movimientos en estas fechas.</td></tr>
              ) : lista.map((m) => (
                <tr key={m.id} className={m.tipo === 'saldo' ? 'tmov-fila--saldo' : ''}>
                  <td className="tmov-ref">
                    {m.consecutivo}
                    {m.tipo === 'referencia' && m.automatico && <span className="tmov-chip-tipo">auto</span>}
                    {m.tipo === 'saldo' && <span className="tmov-chip-tipo tmov-chip-tipo--saldo">saldo</span>}
                    {m.tipo === 'otroCruce' && <span className="tmov-chip-tipo">otro cruce</span>}
                  </td>
                  <td>{m.puente || '—'}</td>
                  <td>{fechaCorta(m.fecha)}</td>
                  <td>{m.hora || '—'}</td>
                  <td className="tmov-refs" title={m.operaciones.join(', ')}>
                    {m.tipo === 'saldo'
                      ? <span className="tmov-moneda">{m.registradoPor ? `Registrado por ${m.registradoPor}` : 'Saldo agregado'}</span>
                      : <><b>{m.operaciones.length}</b> · {m.operaciones.join(', ')}</>}
                  </td>
                  <td className="tmov-num">
                    {m.tipo === 'saldo'
                      ? <Montos lista={m.montos} signo="+" clase="tmov-abono" />
                      : <Montos lista={m.montos} signo="" clase="tmov-total" />}
                  </td>
                </tr>
              ))}
            </tbody>
            {!cargando && lista.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4}><b>{r.referencias}</b> {r.referencias === 1 ? 'referencia' : 'referencias'}</td>
                  <td><b>{r.operaciones}</b> {r.operaciones === 1 ? 'operación' : 'operaciones'}</td>
                  <td className="tmov-num"><Montos lista={r.cargos} signo="" clase="tmov-total" /></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="tmov-pie">
          <button type="button" className="tmov-btn" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

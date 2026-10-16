// src/features/puentes/components/ModalAgregarSaldoPuente.tsx
// ✅ V00455: formulario "Agregar saldo" de Referencias de Puentes → Saldo, en un solo
//   componente. Lo abren la pestaña Saldo y el botón "Actualizar saldo" de las
//   tarjetas de puente de Operaciones Activas (con la caseta de esa tarjeta ya
//   elegida). Mismo formulario configurable (modulo "referenciasPuentes") y el
//   mismo registro en saldos_puentes.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCatalogo } from '../../../shared/data/catalogos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { FormularioConfigurable } from '../../formularios/FormularioConfigurable';
import { monedaDePuente, nombrePuenteCatalogo, puentePredeterminado, puentesDelCatalogo, type TarjetaPuente } from '../services/puentesCatalogo';
import { guardarSaldoPuente } from '../services/saldosPuentes';
import './ModalAgregarSaldoPuente.css';

interface Props {
  /** Tarjeta desde la que se abrió: define la caseta que viene elegida. */
  tarjeta?: TarjetaPuente;
  onCerrar: () => void;
}

const horaAhora = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default function ModalAgregarSaldoPuente({ tarjeta, onCerrar }: Props) {
  const { datos: tiposGasto } = useCatalogo('catalogo_tipos_gastos');
  const puentes = puentesDelCatalogo(tiposGasto);
  const [fecha, setFecha] = useState(hoyLocalISO);
  const [hora, setHora] = useState(horaAhora);
  // null = el usuario aún no elige: vale la caseta de la tarjeta (aunque el catálogo llegue después)
  const [elegido, setElegido] = useState<string | null>(null);
  const [monto, setMonto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const puenteId = elegido ?? puentePredeterminado(puentes, tarjeta, (p) => String(p.id));
  const puente = puentes.find((p) => String(p.id) === puenteId);

  const cerrar = () => { if (!guardando) onCerrar(); };
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puente) { alert('Elige el puente.'); return; }
    const n = Number(monto);
    if (!(n > 0)) { alert('Captura el saldo inicial.'); return; }
    if (!fecha || !hora) { alert('Captura la fecha y la hora.'); return; }
    setGuardando(true);
    try {
      await guardarSaldoPuente({ fecha, hora, puenteId: String(puente.id), puenteNombre: nombrePuenteCatalogo(puente), moneda: monedaDePuente(puente.moneda), saldo: n });
      onCerrar();
    } catch (err) {
      alert(`No se pudo guardar el saldo: ${(err as Error)?.message || err}`);
    } finally { setGuardando(false); }
  };

  // En un portal: las tarjetas usan transform al pasar el mouse y no deben atrapar el modal.
  return createPortal(
    <div className="modal-overlay masp-fondo" onClick={cerrar}>
      <div className="masp-caja" onClick={(e) => e.stopPropagation()}>
        <div className="masp-enc">
          <h2 className="masp-titulo">Agregar saldo</h2>
          <button type="button" className="masp-x" onClick={cerrar} aria-label="Cerrar">✕</button>
        </div>
        <FormularioConfigurable modulo="referenciasPuentes">
          <form onSubmit={guardar} className="masp-form">
            <div className="masp-grid">
              <div className="masp-campo">
                <label className="masp-label">Fecha</label>
                <input className="masp-input" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="masp-campo">
                <label className="masp-label">Hora</label>
                <input className="masp-input" type="time" required value={hora} onChange={(e) => setHora(e.target.value)} />
              </div>
              <div className="masp-campo">
                <label className="masp-label">Puente</label>
                <select className="masp-input" required value={puenteId} onChange={(e) => setElegido(e.target.value)}>
                  <option value="">Seleccionar puente…</option>
                  {puentes.map((p) => <option key={String(p.id)} value={String(p.id)}>{nombrePuenteCatalogo(p)}</option>)}
                </select>
              </div>
              <div className="masp-campo">
                <label className="masp-label">Saldo inicial{puente ? ` (${monedaDePuente(puente.moneda)})` : ''}</label>
                <input className="masp-input" type="number" step="0.01" min="0" required value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="masp-pie">
              <button className="masp-btn" type="button" onClick={cerrar} disabled={guardando}>Cancelar</button>
              <button className="masp-btn masp-btn--guardar" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar saldo'}</button>
            </div>
          </form>
        </FormularioConfigurable>
      </div>
    </div>,
    document.body,
  );
}

// src/features/diesel/components/ModalAgregarSaldoDiesel.tsx
// ✅ V00457: formulario "Agregar saldo de diesel" de Referencias del Diesel → Saldos, en un
//   solo componente. Lo abren la pestaña Saldos y el botón "Actualizar saldo" de la tarjeta
//   Saldo Diesel de Operaciones Activas. Mismo formulario configurable (modulo
//   "referenciasDiesel"), los mismos campos y el mismo registro en saldos_diesel. Viene
//   elegido "Todos los proveedores" (saldo general), como siempre.
import { useEffect, useEffectEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCatalogo } from '../../../shared/data/catalogos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { FormularioConfigurable } from '../../formularios/FormularioConfigurable';
import { nombreProveedorDiesel, proveedoresDeDiesel } from '../services/proveedoresDiesel';
import { guardarSaldoDiesel, NOMBRE_TODOS_PROVEEDORES_DIESEL, TODOS_PROVEEDORES_DIESEL } from '../services/saldosDiesel';
import SelectorProveedorBuscable from './SelectorProveedorBuscable';
import './ModalAgregarSaldoDiesel.css';

interface Props {
  onCerrar: () => void;
}

const horaAhora = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default function ModalAgregarSaldoDiesel({ onCerrar }: Props) {
  const { datos: empresas } = useCatalogo('empresas');
  const proveedores = proveedoresDeDiesel(empresas);
  const nombreDe = (id: string) => nombreProveedorDiesel(empresas, id);
  const [fecha, setFecha] = useState(hoyLocalISO);
  const [hora, setHora] = useState(horaAhora);
  const [proveedor, setProveedor] = useState<string>(TODOS_PROVEEDORES_DIESEL);
  const [monto, setMonto] = useState('');
  const [moneda, setMoneda] = useState('Dólares');
  const [guardando, setGuardando] = useState(false);

  const cerrar = () => { if (!guardando) onCerrar(); };
  // Escape cierra (si no está guardando); con useEffectEvent el efecto corre una sola vez.
  const alTeclear = useEffectEvent((e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); });
  useEffect(() => {
    const escuchar = (e: KeyboardEvent) => alTeclear(e);
    window.addEventListener('keydown', escuchar);
    return () => window.removeEventListener('keydown', escuchar);
  }, []);
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proveedor) { alert('Elige el proveedor de diesel.'); return; }
    const n = Number(monto);
    if (!(n > 0)) { alert('Captura el saldo inicial.'); return; }
    if (!fecha || !hora) { alert('Captura la fecha y la hora.'); return; }
    setGuardando(true);
    try {
      await guardarSaldoDiesel({
        fecha, hora, proveedorId: proveedor,
        proveedorNombre: proveedor === TODOS_PROVEEDORES_DIESEL ? NOMBRE_TODOS_PROVEEDORES_DIESEL : nombreDe(proveedor),
        saldo: n, moneda,
      });
      onCerrar();
    } catch (err) {
      alert(`No se pudo guardar el saldo: ${(err as Error)?.message || err}`);
    } finally { setGuardando(false); }
  };

  // En un portal: las tarjetas de Operaciones Activas no deben atrapar el modal.
  return createPortal(
    <div className="modal-overlay masd-fondo" onClick={cerrar}>
      <div className="masd-caja" role="dialog" aria-modal="true" aria-label="Agregar saldo de diesel" onClick={(e) => e.stopPropagation()}>
        <div className="masd-enc">
          <h2 className="masd-titulo">Agregar saldo de diesel</h2>
          <button type="button" className="masd-x" onClick={cerrar} aria-label="Cerrar">✕</button>
        </div>
        <FormularioConfigurable modulo="referenciasDiesel">
          <form onSubmit={guardar} className="masd-form">
            <div className="masd-grid">
              <div className="masd-campo"><label>Fecha</label><input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
              <div className="masd-campo"><label>Hora</label><input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} /></div>
              <div className="masd-campo masd-campo--ancho"><label>Proveedor</label>
                <label className="masd-todos"><input type="checkbox" checked={proveedor === TODOS_PROVEEDORES_DIESEL} onChange={(e) => setProveedor(e.target.checked ? TODOS_PROVEEDORES_DIESEL : '')} /> Todos los proveedores (saldo general)</label>
                {proveedor !== TODOS_PROVEEDORES_DIESEL && <SelectorProveedorBuscable proveedores={proveedores} value={proveedor} onChange={setProveedor} resolverNombre={nombreDe} />}
              </div>
              <div className="masd-campo"><label>Saldo inicial</label><input type="number" step="0.01" min="0" required value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" /></div>
              <div className="masd-campo"><label>Moneda</label>
                <select value={moneda} onChange={(e) => setMoneda(e.target.value)}><option value="Dólares">Dólares</option><option value="Pesos">Pesos</option></select>
              </div>
            </div>
            <div className="masd-pie">
              <button className="masd-btn" type="button" onClick={cerrar} disabled={guardando}>Cancelar</button>
              <button className="masd-btn masd-btn--guardar" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar saldo'}</button>
            </div>
          </form>
        </FormularioConfigurable>
      </div>
    </div>,
    document.body,
  );
}

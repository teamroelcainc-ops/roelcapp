// src/features/conveniosCompartido/UnirConveniosModal.tsx
// ✅ V00126: modal para UNIR convenios duplicados (clientes / proveedores).
import React, { useMemo, useState } from 'react';
import { unirConvenios, type TipoConvenio } from './unirConvenios';
import { registrarLog } from '../../utils/logger';
import './UnirConveniosModal.css';

export interface ConvenioParaUnir {
  id: string;
  numeroConvenio?: string;
  entidadNombre?: string;
  entidadId?: string;
  fechaConvenio?: string;
  monedaNombre?: string;
  numDetalles?: number;
}

interface Props {
  tipo: TipoConvenio;
  convenios: ConvenioParaUnir[];
  onClose: () => void;
  onUnido: (destinoId: string) => void;
}

export const UnirConveniosModal: React.FC<Props> = ({ tipo, convenios, onClose, onUnido }) => {
  const ordenados = useMemo(() => [...convenios].sort((a, b) => String(a.fechaConvenio || '').localeCompare(String(b.fechaConvenio || ''))), [convenios]);
  const [destinoId, setDestinoId] = useState<string>(ordenados[0]?.id || '');
  const [motivo, setMotivo] = useState('Unión de convenios duplicados');
  const [procesando, setProcesando] = useState(false);

  const entidades = new Set(convenios.map(c => String(c.entidadId || c.entidadNombre || '')));
  const mezclaEntidades = entidades.size > 1;
  const etiquetaEntidad = tipo === 'clientes' ? 'cliente' : 'proveedor';

  const confirmar = async () => {
    if (!destinoId) return alert('Elige el convenio que se va a CONSERVAR.');
    if (!motivo.trim()) return alert('Escribe una nota para la papelera (motivo de la unión).');
    const fuentes = convenios.filter(c => c.id !== destinoId);
    const destino = convenios.find(c => c.id === destinoId);
    const msg = `Se conservará ${destino?.numeroConvenio || destinoId} y se moverán a él TODOS los detalles de:\n\n${fuentes.map(f => `• ${f.numeroConvenio || f.id} (${f.entidadNombre || '—'})`).join('\n')}\n\nLos convenios fuente se enviarán a la papelera de reciclaje. ¿Continuar?`;
    if (!window.confirm(msg)) return;
    setProcesando(true);
    try {
      const r = await unirConvenios(tipo, destinoId, fuentes.map(f => f.id), motivo.trim());
      await registrarLog('Convenios', 'Edición', `Unió ${r.fuentesEliminadas.length} convenio(s) de ${etiquetaEntidad} en ${destino?.numeroConvenio || destinoId} (${r.detallesMovidos} detalle(s) movidos).`);
      alert(`Listo: ${r.detallesMovidos} detalle(s) movidos a ${destino?.numeroConvenio || destinoId}; ${r.fuentesEliminadas.length} convenio(s) enviados a la papelera.`);
      onUnido(destinoId);
    } catch (e: any) {
      alert(`No se pudo unir: ${e?.code || ''} ${e?.message || String(e)}`);
    } finally { setProcesando(false); }
  };

  return (
    <div className="modal-overlay ucm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !procesando) onClose(); }}>
      <div className="form-card ucm-card">
        <div className="form-header ucm-header">
          <h3 className="ucm-titulo">🔗 Unir convenios duplicados ({convenios.length})</h3>
          <button type="button" className="close-x ucm-cerrar" onClick={onClose} disabled={procesando}>✕</button>
        </div>
        <div className="ucm-cuerpo">
          <p className="ucm-texto">Elige el convenio que se <b>conserva</b>. Los detalles (tarifas) de los demás se moverán a él conservando su id, por lo que las operaciones que ya los usan no se afectan.</p>
          {mezclaEntidades && <div className="ucm-alerta">⚠ Los convenios seleccionados pertenecen a más de un {etiquetaEntidad}. Verifica que realmente sean duplicados antes de unir.</div>}
          <table className="data-table ucm-tabla">
            <thead><tr><th>Conservar</th><th># Convenio</th><th className="ucm-th-ent">{tipo === 'clientes' ? 'Cliente' : 'Proveedor'}</th><th>Fecha</th><th>Moneda</th><th>Detalles</th></tr></thead>
            <tbody>
              {ordenados.map(c => (
                <tr key={c.id} className={c.id === destinoId ? 'ucm-fila-destino' : ''} onClick={() => setDestinoId(c.id)}>
                  <td><input type="radio" name="ucm-destino" checked={c.id === destinoId} onChange={() => setDestinoId(c.id)} /></td>
                  <td className="ucm-mono">{c.numeroConvenio || c.id}</td>
                  <td>{c.entidadNombre || '—'}</td>
                  <td>{c.fechaConvenio || '—'}</td>
                  <td>{c.monedaNombre || '—'}</td>
                  <td>{c.numDetalles ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-group ucm-motivo">
            <label className="form-label">Nota para la papelera *</label>
            <input className="form-control" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="ucm-acciones">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={procesando}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={confirmar} disabled={procesando || convenios.length < 2}>{procesando ? 'Uniendo…' : `Unir en ${convenios.find(c => c.id === destinoId)?.numeroConvenio || 'destino'}`}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

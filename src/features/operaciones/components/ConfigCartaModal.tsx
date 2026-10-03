// ✅ V00421: configurar cuándo se muestra la Carta de Instrucciones
import React, { useMemo, useState } from 'react';
import { type ConfigCarta, guardarConfigCarta } from '../../../utils/configCartaInstrucciones';
import './ConfigCartaModal.css';

interface Props {
  config: ConfigCarta;
  tipos: { id: string; nombre: string }[];
  destinos: { id: string; nombre: string }[];
  onClose: () => void;
}

export const ConfigCartaModal: React.FC<Props> = ({ config, tipos, destinos, onClose }) => {
  const [modo, setModo] = useState<ConfigCarta['modo']>(config.modo);
  const [selTipos, setSelTipos] = useState<string[]>(config.tipos);
  const [selDestinos, setSelDestinos] = useState<string[]>(config.destinos);
  const [busca, setBusca] = useState('');
  const [guardando, setGuardando] = useState(false);
  const destinosFiltrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const lista = t ? destinos.filter((d) => d.nombre.toLowerCase().includes(t)) : destinos;
    return [...lista].sort((a, b) => Number(selDestinos.includes(b.id)) - Number(selDestinos.includes(a.id)) || a.nombre.localeCompare(b.nombre, 'es'));
  }, [busca, destinos, selDestinos]);
  const alterna = (lista: string[], set: (v: string[]) => void, id: string) => set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
  const guardar = async () => {
    setGuardando(true);
    try { await guardarConfigCarta({ modo, tipos: selTipos, destinos: selDestinos }); onClose(); }
    catch (e) { alert(`No se pudo guardar: ${(e as Error)?.message || e}`); }
    finally { setGuardando(false); }
  };
  return (
    <div className="modal-overlay ccm-fondo" onClick={onClose}>
      <div className="ccm-caja" onClick={(e) => e.stopPropagation()}>
        <div className="ccm-enc">
          <h3>¿Cuándo mostrar la Carta de Instrucciones?</h3>
          <button type="button" className="ccm-cerrar" onClick={onClose}>✕</button>
        </div>
        <label className="ccm-opcion"><input type="radio" checked={modo === 'todos'} onChange={() => setModo('todos')} /> En <b>todas</b> las operaciones (Logística Cruces, Transfer, Fletes, Rentas…)</label>
        <label className="ccm-opcion"><input type="radio" checked={modo === 'filtro'} onChange={() => setModo('filtro')} /> Solo para los <b>tipos de operación</b> o <b>destinos (bodegas)</b> que marque</label>
        {modo === 'filtro' && (
          <div className="ccm-filtros">
            <div className="ccm-bloque">
              <span className="ccm-titulo">Tipos de operación</span>
              <div className="ccm-lista ccm-lista--corta">
                {tipos.map((t) => (
                  <label key={t.id} className="ccm-item"><input type="checkbox" checked={selTipos.includes(t.id)} onChange={() => alterna(selTipos, setSelTipos, t.id)} /> {t.nombre}</label>
                ))}
              </div>
            </div>
            <div className="ccm-bloque">
              <span className="ccm-titulo">Destinos (bodegas) — {selDestinos.length} marcado(s)</span>
              <input className="ccm-busca" placeholder="Buscar destino…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              <div className="ccm-lista">
                {destinosFiltrados.slice(0, 300).map((d) => (
                  <label key={d.id} className="ccm-item"><input type="checkbox" checked={selDestinos.includes(d.id)} onChange={() => alterna(selDestinos, setSelDestinos, d.id)} /> {d.nombre}</label>
                ))}
              </div>
            </div>
            <p className="ccm-nota">Se muestra si el tipo de la operación O su destino están marcados.</p>
          </div>
        )}
        <div className="ccm-pie">
          <button type="button" className="ccm-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="ccm-btn ccm-btn--prim" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar para todos'}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfigCartaModal;

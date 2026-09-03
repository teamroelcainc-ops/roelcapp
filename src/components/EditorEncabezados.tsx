// src/components/EditorEncabezados.tsx
// ---------------------------------------------------------------------------
// ✅ V00168: EDITOR DE ENCABEZADOS REUTILIZABLE — botón "✎ Encabezados" (solo
//   Admin) + modal para renombrar los textos del módulo donde se coloque.
//   Usa el motor central de etiquetas (settings_ui/etiquetas): aplica al
//   instante para todos y también es editable en Configuración → Personalizar
//   Etiquetas. Un campo vacío regresa el texto a su valor por defecto.
//   Uso: <EditorEncabezados titulo="Pagos" claves={[{ clave, porDefecto, ayuda }]} />
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEtiquetas } from '../contexts/EtiquetasContext';
import { obtenerUsuarioAut } from '../features/autorizaciones/autorizaciones';
import './EditorEncabezados.css';

export interface ClaveEncabezado { clave: string; porDefecto: string; ayuda: string }

export const EditorEncabezados: React.FC<{ titulo: string; claves: ClaveEncabezado[]; compacto?: boolean }> = ({ titulo, claves, compacto }) => {
  const { etq, guardarEtiquetas } = useEtiquetas();
  const [esAdmin, setEsAdmin] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { obtenerUsuarioAut().then((u) => setEsAdmin(!!u?.esAdmin)).catch(() => setEsAdmin(false)); }, []);
  if (!esAdmin) return null;

  const abrir = () => {
    const d: Record<string, string> = {};
    claves.forEach((c) => { d[c.clave] = etq(c.clave, c.porDefecto); });
    setDraft(d); setAbierto(true);
  };
  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try {
      const cambios: Record<string, string> = {};
      claves.forEach((c) => { cambios[c.clave] = String(draft[c.clave] ?? '').trim(); });
      await guardarEtiquetas(cambios);
      setAbierto(false);
    } catch (e: any) { alert(`No se pudieron guardar los encabezados: ${e?.message || e}`); }
    finally { setGuardando(false); }
  };

  return (
    <>
      <button type="button" className={`ee-btn${compacto ? ' ee-btn-compacto' : ''}`} title={`Configurar los encabezados de ${titulo} (aplica para todos)`} onClick={abrir}>✎ {compacto ? '' : 'Encabezados'}</button>
      {abierto && createPortal(
        <div className="modal-overlay ee-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) setAbierto(false); }}>
          <div className="ee-card">
            <div className="ee-header"><h3>✎ Encabezados · {titulo}</h3><button className="ee-cerrar" onClick={() => setAbierto(false)} disabled={guardando}>✕</button></div>
            <div className="ee-cuerpo">
              <p className="ee-nota">Cambia los textos de este módulo. Aplica para <b>todos los usuarios</b> al instante; deja un campo vacío para regresar al nombre original. También editables en Configuración → Personalizar Etiquetas.</p>
              {claves.map((c) => (
                <label key={c.clave} className="ee-campo">
                  <span>{c.ayuda}</span>
                  <input className="form-control" type="text" placeholder={c.porDefecto} value={draft[c.clave] ?? ''} onChange={(e) => setDraft((p) => ({ ...p, [c.clave]: e.target.value }))} />
                </label>
              ))}
              <div className="ee-acciones">
                <button className="btn btn-outline" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</button>
                <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar encabezados'}</button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}
    </>
  );
};

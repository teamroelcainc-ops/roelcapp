// src/features/operaciones/components/EditorDetalleConvenioModal.tsx
// ✅ V00126: editar el DETALLE del convenio elegido (tarifa y, sobre todo, su
//   MONEDA) sin salir del formulario de Operaciones. Aplica a convenios de
//   cliente y de proveedor. Guarda directo en Firestore, invalida las cachés
//   de convenios y avisa al formulario para que recalcule montos.
import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { limpiarCacheMemoria } from '../../../utils/cacheMemoria';
import './EditorDetalleConvenioModal.css';

interface Props {
  tipo: 'cliente' | 'proveedor';
  detalleId: string;
  monedas: any[]; // catálogo de monedas ({ id, moneda })
  onClose: () => void;
  onGuardado: (detalle: { id: string; tarifa: number; moneda: string; tipoConvenioNombre: string }) => void;
}

export const EditorDetalleConvenioModal: React.FC<Props> = ({ tipo, detalleId, monedas, onClose, onGuardado }) => {
  const colDetalles = tipo === 'cliente' ? 'convenios_clientes_detalles' : 'convenios_proveedores_detalles';
  const colMaestro = tipo === 'cliente' ? 'convenios_clientes' : 'convenios_proveedores';
  const [detalle, setDetalle] = useState<any | null>(null);
  const [maestro, setMaestro] = useState<any | null>(null);
  const [tarifa, setTarifa] = useState<number>(0);
  const [moneda, setMoneda] = useState<string>('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const opciones: string[] = (monedas || []).map((m: any) => String(m.moneda || '')).filter(Boolean);
  const listaMonedas = opciones.length ? opciones : ['Pesos', 'Dólares'];

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, colDetalles, detalleId));
        if (!activo) return;
        if (!snap.exists()) { setError('Este convenio no tiene un detalle editable en la base de datos (registro heredado). Edítalo desde el módulo de Convenios.'); return; }
        const d: any = { id: snap.id, ...snap.data() };
        setDetalle(d);
        setTarifa(Number(d.tarifa) || 0);
        setMoneda(String(d.moneda || ''));
        if (d.convenioId) {
          const m = await getDoc(doc(db, colMaestro, String(d.convenioId)));
          if (activo && m.exists()) setMaestro({ id: m.id, ...m.data() });
        }
      } catch (e: any) { if (activo) setError(e?.message || String(e)); }
    })();
    return () => { activo = false; };
  }, [detalleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    if (!detalle) return;
    if (!moneda) { alert('Selecciona la moneda del detalle.'); return; }
    if (!(tarifa > 0)) { alert('La tarifa debe ser mayor a 0.'); return; }
    setGuardando(true);
    try {
      const ref = doc(db, colDetalles, detalle.id);
      await updateDoc(ref, { tarifa: Number(tarifa), moneda });
      // Verificación de lectura (mismo criterio que el formulario de convenios)
      const back = await getDoc(ref);
      if (String(back.data()?.moneda || '') !== moneda) throw new Error('Firestore no devolvió la moneda guardada.');
      limpiarCacheMemoria(`detalles_convenio__${tipo === 'cliente' ? 'clientes' : 'proveedores'}`);
      try { localStorage.removeItem(`cat_v1__${tipo === 'cliente' ? 'catalogoConvDetalles' : 'catalogoConvProvDetalles'}`); } catch { /* noop */ }
      onGuardado({ id: detalle.id, tarifa: Number(tarifa), moneda, tipoConvenioNombre: String(detalle.tipoConvenioNombre || '') });
    } catch (e: any) {
      alert(`No se pudo guardar el detalle:\n\n${e?.code || ''} ${e?.message || String(e)}`);
    } finally { setGuardando(false); }
  };

  return (
    <div className="modal-overlay edc-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) onClose(); }}>
      <div className="form-card edc-card">
        <div className="form-header edc-header">
          <h3 className="edc-titulo">✎ Detalle del convenio {tipo === 'cliente' ? '(cliente)' : '(proveedor)'}</h3>
          <button type="button" className="close-x edc-cerrar" onClick={onClose} disabled={guardando}>✕</button>
        </div>
        <div className="edc-cuerpo">
          {error && <div className="edc-error">{error}</div>}
          {!detalle && !error && <p className="edc-cargando">⏳ Cargando el detalle…</p>}
          {detalle && (
            <>
              <div className="edc-contexto">
                <div><span className="edc-etq">Convenio</span><b>{maestro?.numeroConvenio || detalle.convenioId || '—'}</b></div>
                <div><span className="edc-etq">{tipo === 'cliente' ? 'Cliente' : 'Proveedor'}</span><b>{maestro?.clienteNombre || maestro?.proveedorNombre || '—'}</b></div>
                <div className="edc-tipo"><span className="edc-etq">Tipo / concepto</span><b>{detalle.tipoConvenioNombre || '—'}</b></div>
              </div>
              <div className="form-grid edc-grid">
                <div className="form-group">
                  <label className="form-label">Tarifa *</label>
                  <input type="number" step="any" className="form-control" value={tarifa} onChange={(e) => setTarifa(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Moneda *</label>
                  <select className="form-control" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                    <option value="">— Seleccionar —</option>
                    {listaMonedas.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <p className="edc-nota">El cambio se guarda en el convenio (Firestore) y aplica a esta y a futuras operaciones que usen este detalle; las operaciones ya guardadas conservan sus montos.</p>
              <div className="edc-acciones">
                <button type="button" className="btn btn-outline" onClick={onClose} disabled={guardando}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar detalle'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

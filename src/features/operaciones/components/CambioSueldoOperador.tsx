// src/features/operaciones/components/CambioSueldoOperador.tsx
// ---------------------------------------------------------------------------
// ✅ V00433 — CAMBIAR EL SUELDO DEL OPERADOR CON MOTIVO (pedido de Omaf: "hay
//   veces que los operadores se equivocan y no se les paga nada").
//   · Botón "✎ Cambiar sueldo" → modal con el sueldo actual, el NUEVO monto y
//     el MOTIVO (obligatorio).
//   · Se guarda en la operación: sueldoOperador, sueldoTotal (= nuevo + extra),
//     sueldoManual, y cada cambio en `cambiosSueldo[]` {fecha, de, a, motivo,
//     usuario} — la NOTA queda en el detalle de la operación
//     (<HistorialCambiosSueldo />) y en el Historial de Actividad.
//   · Si la operación está en FALSO, el monto capturado es el FINAL (no se
//     vuelve a partir a la mitad).
//   · Si la nómina ya se pagó, avisa antes de cambiar.
//   Modo "directo" (fichas de Activas/Completados): escribe en Firestore.
//   Modo "formulario": devuelve los campos al formulario; si la operación ya
//   existe también los escribe de inmediato para no perder el motivo.
// ---------------------------------------------------------------------------
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useUsuarioStore } from '../../../stores/useUsuarioStore';
import { registrarLog } from '../../../utils/logger';
import { esStatusFalso } from '../../../utils/sueldoFalso';
import './CambioSueldoOperador.css';

export interface CambioSueldo {
  fecha: string;
  de: number;
  a: number;
  motivo: string;
  usuario: string;
  uid?: string;
}

interface OpSueldo {
  id?: unknown;
  _docId?: unknown;
  ref?: unknown;
  sueldoOperador?: unknown;
  sueldoExtra?: unknown;
  statusNombre?: unknown;
  referenciaNominaConsecutivo?: unknown;
  cambiosSueldo?: unknown;
}

const fmt = (n: number): string => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const CambioSueldoOperador: React.FC<{
  op: OpSueldo;
  modulo: string;
  /** directo: escribe en Firestore (fichas). formulario: devuelve los campos (y escribe si la op ya existe). */
  modo?: 'directo' | 'formulario';
  deshabilitado?: boolean;
  onGuardado: (campos: Record<string, unknown>) => void;
}> = ({ op, modulo, modo = 'directo', deshabilitado = false, onGuardado }) => {
  const usuario = useUsuarioStore((s) => s.usuario);
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const actual = Number(op.sueldoOperador) || 0;
  const extra = Number(op.sueldoExtra) || 0;
  const idDoc = String(op._docId || op.id || '').trim();
  const nominaPagada = String(op.referenciaNominaConsecutivo || '').trim();

  const abrir = () => { setMonto(String(actual)); setMotivo(''); setAbierto(true); };

  const guardar = async () => {
    const nuevo = Math.round((Number(monto) || 0) * 100) / 100;
    if (monto.trim() === '' || Number.isNaN(Number(monto)) || nuevo < 0) { alert('Escribe el NUEVO sueldo del operador (puede ser 0).'); return; }
    if (motivo.trim().length < 5) { alert('Escribe el MOTIVO del cambio (es obligatorio, mínimo 5 caracteres).'); return; }
    if (nuevo === actual) { alert('El nuevo sueldo es igual al actual.'); return; }
    if (nominaPagada && !window.confirm(`⚠ La nómina de esta operación YA se pagó (${nominaPagada}).\n\nCambiar el sueldo NO modifica lo ya pagado. ¿Continuar de todos modos?`)) return;
    setGuardando(true);
    try {
      const cambio: CambioSueldo = {
        fecha: new Date().toISOString(),
        de: actual,
        a: nuevo,
        motivo: motivo.trim(),
        usuario: String(usuario?.nombre || usuario?.email || usuario?.id || 'Desconocido'),
        uid: String(usuario?.id || ''),
      };
      const falso = esStatusFalso(op.statusNombre);
      const campos: Record<string, unknown> = {
        sueldoOperador: nuevo,
        sueldoTotal: Math.round((nuevo + extra) * 100) / 100,
        sueldoManual: true,
        ultimoCambioSueldo: cambio,
        // en FALSO el monto capturado es el final: no se vuelve a partir a la mitad
        sueldoMitadAplicada: falso,
        ...(falso ? { sueldoOperadorCompleto: nuevo } : {}),
      };
      if (idDoc) {
        await updateDoc(doc(db, 'operaciones', idDoc), { ...campos, cambiosSueldo: arrayUnion(cambio) });
        registrarLog(modulo, 'Edición', `Cambió el sueldo del operador de la operación ${String(op.ref || idDoc)}: ${fmt(actual)} → ${fmt(nuevo)}. Motivo: ${cambio.motivo}`).catch(() => {});
      }
      const previos = Array.isArray(op.cambiosSueldo) ? (op.cambiosSueldo as CambioSueldo[]) : [];
      onGuardado({ ...campos, cambiosSueldo: [...previos, cambio] });
      setAbierto(false);
      if (modo === 'directo' || idDoc) alert(`Sueldo del operador actualizado a ${fmt(nuevo)}. ✅\nEl motivo quedó en el detalle de la operación.`);
    } catch (e) {
      console.error('No se pudo cambiar el sueldo:', e);
      alert('No se pudo cambiar el sueldo del operador.');
    }
    setGuardando(false);
  };

  return (
    <>
      <button type="button" className="cso-btn" disabled={deshabilitado} onClick={(e) => { e.stopPropagation(); abrir(); }}
        title="Cambiar el sueldo del operador (se pide el motivo y queda en el detalle de la operación)">
        ✎ Cambiar sueldo
      </button>
      {abierto && createPortal(
        <div className="cso-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) setAbierto(false); }}>
          <div className="cso-modal" role="dialog" aria-label="Cambiar sueldo del operador">
            <div className="cso-enc">
              <h3 className="cso-titulo">Cambiar sueldo del operador</h3>
              <button type="button" className="cso-cerrar" onClick={() => !guardando && setAbierto(false)}>✕</button>
            </div>
            <div className="cso-cuerpo">
              <div className="cso-actual">Sueldo actual: <b>{fmt(actual)}</b>{extra ? <> · Extra: <b>{fmt(extra)}</b></> : null}</div>
              {nominaPagada && <div className="cso-aviso">⚠ La nómina de esta operación ya se pagó ({nominaPagada}).</div>}
              <label className="cso-lbl" htmlFor="cso-monto">Nuevo sueldo del operador</label>
              <input id="cso-monto" type="number" step="0.01" min="0" className="form-control cso-input" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
              <label className="cso-lbl" htmlFor="cso-motivo">Motivo del cambio <span className="cso-oblig">*</span></label>
              <textarea id="cso-motivo" className="form-control cso-textarea" rows={3} placeholder="Ej. El operador no cobró: se le paga el viaje completo / error en la tarifa…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              {Number(monto) >= 0 && monto.trim() !== '' && <div className="cso-total">Sueldo total quedará en <b>{fmt((Number(monto) || 0) + extra)}</b></div>}
            </div>
            <div className="cso-pie">
              <button type="button" className="btn btn-outline" disabled={guardando} onClick={() => setAbierto(false)}>Cancelar</button>
              <button type="button" className="cso-guardar" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar cambio'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

/** Notas de los cambios de sueldo (para el detalle de la operación). */
export const HistorialCambiosSueldo: React.FC<{ cambios: unknown }> = ({ cambios }) => {
  const lista = Array.isArray(cambios) ? (cambios as CambioSueldo[]) : [];
  if (lista.length === 0) return null;
  const orden = [...lista].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  return (
    <div className="cso-historial">
      <div className="cso-historial-tit">📝 Cambios del sueldo del operador ({lista.length})</div>
      {orden.map((c, i) => (
        <div key={`${c.fecha}-${i}`} className="cso-nota">
          <div className="cso-nota-enc">
            <span className="cso-nota-montos">{fmt(c.de)} → <b>{fmt(c.a)}</b></span>
            <span className="cso-nota-meta">{c.usuario || '—'} · {c.fecha ? new Date(c.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span>
          </div>
          <div className="cso-nota-motivo">{c.motivo}</div>
        </div>
      ))}
    </div>
  );
};

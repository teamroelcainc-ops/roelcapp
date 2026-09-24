// ✅ V00348: tarjeta "CASETAS DEL DÍA" para el resumen del día — muestra EN
//   VIVO el saldo (importe vigente) de Caseta AVI y Caseta Puente III desde el
//   catálogo Tipos de Gastos. Editar el importe en Catálogos lo actualiza aquí
//   al momento. Autocontenida: se monta con <TarjetaCasetas /> junto a las
//   demás tarjetas (tipo de cambio, diésel) en App.tsx.
import React, { useEffect, useState } from 'react';
import { addDoc, collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import './TarjetaCasetas.css';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';
const norm = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const nombreMoneda = (v: unknown): string => {
  const t = String(v ?? '');
  if (t === ID_USD) return 'Dólares';
  if (t === ID_MXN) return 'Pesos';
  const n = norm(t);
  if (n.includes('dolar') || n === 'usd') return 'Dólares';
  if (n.includes('peso') || n === 'mxn') return 'Pesos';
  return t;
};
const fmtMonto = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};

interface Caseta { id: string; nombre: string; importe: unknown; moneda: string; }

export const TarjetaCasetas: React.FC = () => {
  const [avi, setAvi] = useState<Caseta | null>(null);
  const [p3, setP3] = useState<Caseta | null>(null);
  // ✅ V00349: captura del saldo de los puentes (como el tipo de cambio).
  const [modalAbierto, setModalAbierto] = useState(false);
  const [montoAvi, setMontoAvi] = useState('');
  const [montoP3, setMontoP3] = useState('');
  const [guardando, setGuardando] = useState(false);
  // ✅ V00352: puentes con saldo YA registrado HOY (tabla saldos_puentes) —
  //   cuando ambos están al día, el botón "+ Actualizar saldos" se quita
  //   (como el del tipo de cambio).
  const [capturadosHoy, setCapturadosHoy] = useState<string[]>([]);
  useEffect(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    const unsub = onSnapshot(query(collection(db, 'saldos_puentes'), where('fecha', '==', hoy)), (snap) => {
      setCapturadosHoy(snap.docs.map((d) => String((d.data() as Record<string, unknown>).puenteId || '')));
    }, () => {});
    return () => unsub();
  }, []);
  const faltaCapturarHoy = (avi ? !capturadosHoy.includes(avi.id) : false) || (p3 ? !capturadosHoy.includes(p3.id) : false);
  const abrirCaptura = () => {
    setMontoAvi(avi && Number.isFinite(Number(avi.importe)) ? String(avi.importe) : '');
    setMontoP3(p3 && Number.isFinite(Number(p3.importe)) ? String(p3.importe) : '');
    setModalAbierto(true);
  };
  const guardarSaldos = async () => {
    const nAvi = Number(montoAvi); const nP3 = Number(montoP3);
    if (avi && (!Number.isFinite(nAvi) || nAvi < 0)) { alert('Captura un monto válido para el Puente AVI.'); return; }
    if (p3 && (!Number.isFinite(nP3) || nP3 < 0)) { alert('Captura un monto válido para el Puente III.'); return; }
    setGuardando(true);
    try {
      // ✅ V00350: además del catálogo, la captura REGISTRA EL DÍA en la tabla
      //   saldos_puentes (módulo Saldos de Puentes) — un registro por puente y
      //   fecha (si el de hoy ya existe, se actualiza).
      const hoy = new Date().toISOString().slice(0, 10);
      const registrarDia = async (c: Caseta, monto: number) => {
        await updateDoc(doc(db, 'catalogo_tipos_gastos', c.id), { importe: monto });
        const previo = await getDocs(query(collection(db, 'saldos_puentes'), where('puenteId', '==', c.id), where('fecha', '==', hoy)));
        const datos = { fecha: hoy, puenteId: c.id, puenteNombre: c.nombre, moneda: c.moneda, saldo: monto };
        if (!previo.empty) await updateDoc(doc(db, 'saldos_puentes', previo.docs[0].id), datos);
        else await addDoc(collection(db, 'saldos_puentes'), { ...datos, creadoEn: new Date().toISOString() });
      };
      if (avi) await registrarDia(avi, nAvi);
      if (p3) await registrarDia(p3, nP3);
      setModalAbierto(false);
    } catch (e) { alert(`No se pudo guardar el saldo: ${(e as Error)?.message || e}`); }
    finally { setGuardando(false); }
  };
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'catalogo_tipos_gastos'), (snap) => {
      let a: Caseta | null = null; let p: Caseta | null = null;
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        const n = norm(x.nombre_gasto);
        const c: Caseta = { id: d.id, nombre: String(x.nombre_gasto || ''), importe: x.importe, moneda: nombreMoneda(x.moneda) };
        if (n === 'caseta avi') a = c;
        if (n === 'caseta puente iii' || n === 'caseta puente 3') p = c;
      });
      setAvi(a); setP3(p);
    }, (e) => console.warn('Casetas del día:', e));
    return () => unsub();
  }, []);
  return (
    <div className="tcas-tarjeta" title="Saldo vigente de las casetas — se edita en Catálogos → Tipos de Gastos y aquí se actualiza al momento">
      <span className="tcas-etiqueta">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="2.2"><path d="M4 21V8l8-5 8 5v13"></path><path d="M4 11h16"></path><path d="M9 21v-6h6v6"></path></svg>
        Casetas del día
      </span>
      <div className="tcas-linea"><span className="tcas-nombre">Puente AVI{avi && !capturadosHoy.includes(avi.id) && <em className="tcas-viejo" title="Todavía sin captura HOY — presiona + Actualizar saldos">· sin captura hoy</em>}</span><span className="tcas-monto">{avi ? `${fmtMonto(avi.importe)} ${avi.moneda}` : '—'}</span></div>
      <div className="tcas-linea"><span className="tcas-nombre">Puente III{p3 && !capturadosHoy.includes(p3.id) && <em className="tcas-viejo" title="Todavía sin captura HOY — presiona + Actualizar saldos">· sin captura hoy</em>}</span><span className="tcas-monto">{p3 ? `${fmtMonto(p3.importe)} ${p3.moneda}` : '—'}</span></div>
      {faltaCapturarHoy && <button type="button" className="tcas-capturar" onClick={abrirCaptura} title="Actualizar el saldo de los puentes — se guarda en el catálogo, en la tabla Saldos de Puentes con la fecha de hoy, y se refleja en toda la app">+ Actualizar saldos</button>}
      {/* ✅ V00349: modal de captura (como el del tipo de cambio) */}
      {modalAbierto && (
        <div className="tcas-modal-fondo" onClick={() => !guardando && setModalAbierto(false)}>
          <div className="tcas-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tcas-modal-titulo">🌉 Actualizar saldo de los puentes</div>
            <div className="tcas-modal-sub">El saldo se guarda en Catálogos → Tipos de Gastos y se usa en toda la app al momento.</div>
            {avi ? (
              <label className="tcas-modal-campo">
                <span>Puente AVI ({avi.moneda})</span>
                <input type="number" step="0.01" min="0" className="form-control" value={montoAvi} onChange={(e) => setMontoAvi(e.target.value)} />
              </label>
            ) : <div className="tcas-modal-aviso">⚠ No encontré el registro "Caseta AVI" en Tipos de Gastos.</div>}
            {p3 ? (
              <label className="tcas-modal-campo">
                <span>Puente III ({p3.moneda})</span>
                <input type="number" step="0.01" min="0" className="form-control" value={montoP3} onChange={(e) => setMontoP3(e.target.value)} />
              </label>
            ) : <div className="tcas-modal-aviso">⚠ No encontré el registro "Caseta Puente III" en Tipos de Gastos.</div>}
            <div className="tcas-modal-pie">
              <button type="button" className="tcas-btn" disabled={guardando} onClick={() => setModalAbierto(false)}>Cancelar</button>
              <button type="button" className="tcas-btn tcas-btn--primario" disabled={guardando || (!avi && !p3)} onClick={guardarSaldos}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

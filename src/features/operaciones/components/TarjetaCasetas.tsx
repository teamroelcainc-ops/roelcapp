// ✅ V00358: tarjeta "CASETAS DEL DÍA" — muestra el SALDO ACTUAL de la cuenta
//   de cada puente (recargas − cruces completados), con semáforo, y permite
//   AGREGAR SALDO (recarga del día en la tabla saldos_puentes). La tarifa por
//   cruce vive en el catálogo Tipos de Gastos y ya no se modifica desde aquí.
import React, { useEffect, useState } from 'react';
import { addDoc, collection, onSnapshot, query, where } from 'firebase/firestore';
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
const hoyISO = () => new Date().toISOString().slice(0, 10);

interface Caseta { id: string; nombre: string; moneda: string; tarifa: number; umbralAmarillo: number; umbralRojo: number; }
interface RecargaMin { puenteId: string; fecha: string; saldo: number; }
interface CruceMin { puenteNombre: string; fecha: string; monto: number; }

export const TarjetaCasetas: React.FC = () => {
  const [avi, setAvi] = useState<Caseta | null>(null);
  const [p3, setP3] = useState<Caseta | null>(null);
  const [recargas, setRecargas] = useState<RecargaMin[]>([]);
  const [cruces, setCruces] = useState<CruceMin[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [montoAvi, setMontoAvi] = useState('');
  const [montoP3, setMontoP3] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'catalogo_tipos_gastos'), (snap) => {
      let a: Caseta | null = null; let p: Caseta | null = null;
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        const n = norm(x.nombre_gasto);
        const tarifa = Number(x.importe) || 0;
        const c: Caseta = { id: d.id, nombre: String(x.nombre_gasto || ''), moneda: nombreMoneda(x.moneda), tarifa, umbralAmarillo: Number(x.umbralAmarillo) || tarifa * 20, umbralRojo: Number(x.umbralRojo) || tarifa * 10 };
        if (n === 'caseta avi') a = c;
        if (n === 'caseta puente iii' || n === 'caseta puente 3') p = c;
      });
      setAvi(a); setP3(p);
    }, (e) => console.warn('Casetas del día:', e));
    const u2 = onSnapshot(collection(db, 'saldos_puentes'), (snap) => {
      setRecargas(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return { puenteId: String(x.puenteId || ''), fecha: String(x.fecha || ''), saldo: Number(x.saldo) || 0 };
      }));
    }, () => {});
    const u3 = onSnapshot(query(collection(db, 'operaciones'), where('saldoPuente', '>', 0)), (snap) => {
      setCruces(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return { puenteNombre: String(x.saldoPuentePuente || ''), fecha: String(x.saldoPuenteFecha || ''), monto: Number(x.saldoPuente) || 0 };
      }));
    }, () => {});
    return () => { u1(); u2(); u3(); };
  }, []);

  const cuentaDe = (c: Caseta | null) => {
    if (!c) return null;
    const recs = recargas.filter((r) => r.puenteId === c.id).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const primera = recs[0]?.fecha || '';
    const inicial = recs.reduce((acc, r) => acc + r.saldo, 0);
    const consumo = cruces.filter((x) => norm(x.puenteNombre) === norm(c.nombre) && (!primera || x.fecha >= primera)).reduce((acc, x) => acc + x.monto, 0);
    const actual = inicial - consumo;
    const nivel = actual < c.umbralRojo ? 'rojo' : actual < c.umbralAmarillo ? 'amarillo' : 'ok';
    return { actual, nivel };
  };
  const cAvi = cuentaDe(avi);
  const cP3 = cuentaDe(p3);

  const abrirCaptura = () => { setMontoAvi(''); setMontoP3(''); setModalAbierto(true); };
  const guardarSaldos = async () => {
    const nAvi = Number(montoAvi) || 0; const nP3 = Number(montoP3) || 0;
    if (nAvi <= 0 && nP3 <= 0) { alert('Captura el saldo a agregar en al menos un puente.'); return; }
    setGuardando(true);
    try {
      const registrar = async (c: Caseta, monto: number) => {
        await addDoc(collection(db, 'saldos_puentes'), { fecha: hoyISO(), puenteId: c.id, puenteNombre: c.nombre, moneda: c.moneda, saldo: monto, creadoEn: new Date().toISOString() });
      };
      if (avi && nAvi > 0) await registrar(avi, nAvi);
      if (p3 && nP3 > 0) await registrar(p3, nP3);
      setModalAbierto(false);
    } catch (e) { alert(`No se pudo agregar el saldo: ${(e as Error)?.message || e}`); }
    finally { setGuardando(false); }
  };

  const lineaPuente = (etiqueta: string, c: Caseta | null, cta: { actual: number; nivel: string } | null) => (
    <div className="tcas-linea">
      <span className="tcas-nombre">{etiqueta}{cta && cta.nivel !== 'ok' && <em className={`tcas-nivel tcas-nivel--${cta.nivel}`}>{cta.nivel === 'rojo' ? '· crítico' : '· bajo'}</em>}</span>
      <span className={`tcas-monto${cta ? ` tcas-monto--${cta.nivel}` : ''}`}>{c && cta ? `${fmtMonto(cta.actual)} ${c.moneda}` : '—'}</span>
    </div>
  );

  return (
    <div className="tcas-tarjeta" title="Saldo ACTUAL de la cuenta de cada puente (recargas − cruces completados). La tarifa por cruce se edita en Catálogos → Tipos de Gastos">
      <span className="tcas-etiqueta">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="2.2"><path d="M4 21V8l8-5 8 5v13"></path><path d="M4 11h16"></path><path d="M9 21v-6h6v6"></path></svg>
        Casetas del día
      </span>
      {lineaPuente('Puente AVI', avi, cAvi)}
      {lineaPuente('Puente III', p3, cP3)}
      <button type="button" className="tcas-capturar" onClick={abrirCaptura} title="Agregar saldo a la cuenta de los puentes (recarga de hoy — queda en Saldos de Puentes)">➕ Agregar saldo</button>
      {modalAbierto && (
        <div className="tcas-modal-fondo" onClick={() => !guardando && setModalAbierto(false)}>
          <div className="tcas-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tcas-modal-titulo">➕ Agregar saldo a los puentes</div>
            <div className="tcas-modal-fila2">
              <label className="tcas-modal-campo"><span>Fecha (hoy)</span><input type="date" className="form-control" value={hoyISO()} disabled readOnly /></label>
            </div>
            {avi ? (
              <div className="tcas-modal-puente">
                <div className="tcas-modal-puente-titulo">Puente AVI <span className="tcas-modal-moneda">Moneda: {avi.moneda}</span></div>
                <label className="tcas-modal-campo"><span>Saldo a agregar</span>
                  <input type="number" step="0.01" min="0" className="form-control" value={montoAvi} onChange={(e) => setMontoAvi(e.target.value)} placeholder="0.00" />
                </label>
                <div className="tcas-modal-linea"><span>Saldo restante</span><b>{cAvi ? fmtMonto(cAvi.actual) : '—'}</b></div>
                <div className="tcas-modal-linea tcas-modal-linea--total"><span>Total (restante + agregado)</span><b>{fmtMonto((cAvi?.actual || 0) + (Number(montoAvi) || 0))} {avi.moneda}</b></div>
              </div>
            ) : <div className="tcas-modal-aviso">⚠ No encontré el registro "Caseta AVI" en Tipos de Gastos.</div>}
            {p3 ? (
              <div className="tcas-modal-puente">
                <div className="tcas-modal-puente-titulo">Puente III <span className="tcas-modal-moneda">Moneda: {p3.moneda}</span></div>
                <label className="tcas-modal-campo"><span>Saldo a agregar</span>
                  <input type="number" step="0.01" min="0" className="form-control" value={montoP3} onChange={(e) => setMontoP3(e.target.value)} placeholder="0.00" />
                </label>
                <div className="tcas-modal-linea"><span>Saldo restante</span><b>{cP3 ? fmtMonto(cP3.actual) : '—'}</b></div>
                <div className="tcas-modal-linea tcas-modal-linea--total"><span>Total (restante + agregado)</span><b>{fmtMonto((cP3?.actual || 0) + (Number(montoP3) || 0))} {p3.moneda}</b></div>
              </div>
            ) : <div className="tcas-modal-aviso">⚠ No encontré el registro "Caseta Puente III" en Tipos de Gastos.</div>}
            <div className="tcas-modal-pie">
              <button type="button" className="tcas-btn" disabled={guardando} onClick={() => setModalAbierto(false)}>Cancelar</button>
              <button type="button" className="tcas-btn tcas-btn--primario" disabled={guardando || (!avi && !p3)} onClick={guardarSaldos}>{guardando ? 'Guardando…' : '➕ Agregar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

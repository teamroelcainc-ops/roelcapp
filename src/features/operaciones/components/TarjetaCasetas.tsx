// ✅ V00360: tarjeta "CASETAS DEL DÍA" — muestra lo GASTADO HOY en cruces
//   (total en Dólares y total en Pesos) y el botón diario "＋ Actualizar saldo":
//   modal con Puente (lista del catálogo), Moneda (no editable), Saldo a
//   agregar, Saldo pendiente por puente y Total. Las recargas quedan en
//   saldos_puentes y el saldo se consume al marcar Verde MX (exportación,
//   Puente III en pesos) o Verde USA (importación, Caseta AVI en dólares).
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

interface Puente { id: string; nombre: string; moneda: string; }
interface RecargaMin { puenteId: string; fecha: string; saldo: number; }
interface CruceMin { puenteNombre: string; fecha: string; monto: number; moneda: string; }

export const TarjetaCasetas: React.FC = () => {
  const [puentes, setPuentes] = useState<Puente[]>([]);
  const [recargas, setRecargas] = useState<RecargaMin[]>([]);
  const [cruces, setCruces] = useState<CruceMin[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [puenteId, setPuenteId] = useState('');
  const [monto, setMonto] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'catalogo_tipos_gastos'), (snap) => {
      const lista: Puente[] = [];
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        if (norm(x.categoria_gasto) !== 'puente') return;
        lista.push({ id: d.id, nombre: String(x.nombre_gasto || ''), moneda: nombreMoneda(x.moneda) });
      });
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setPuentes(lista);
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
        return { puenteNombre: String(x.saldoPuentePuente || ''), fecha: String(x.saldoPuenteFecha || ''), monto: Number(x.saldoPuente) || 0, moneda: nombreMoneda(x.saldoPuenteMoneda) };
      }));
    }, () => {});
    return () => { u1(); u2(); u3(); };
  }, []);

  /** GASTADO HOY en cruces, por moneda. */
  const gastadoHoy = (moneda: 'Dólares' | 'Pesos') =>
    cruces.filter((c) => c.fecha === hoyISO() && c.moneda === moneda).reduce((acc, c) => acc + c.monto, 0);

  /** Saldo pendiente (disponible) del puente = Σ recargas − Σ cruces desde la 1ª recarga. */
  const pendienteDe = (p: Puente | undefined): number => {
    if (!p) return 0;
    const recs = recargas.filter((r) => r.puenteId === p.id).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const primera = recs[0]?.fecha || '';
    const inicial = recs.reduce((acc, r) => acc + r.saldo, 0);
    const consumo = cruces.filter((x) => norm(x.puenteNombre) === norm(p.nombre) && (!primera || x.fecha >= primera)).reduce((acc, x) => acc + x.monto, 0);
    return inicial - consumo;
  };

  const puenteSel = puentes.find((p) => p.id === puenteId);
  const pendienteSel = pendienteDe(puenteSel);
  const montoNum = Number(monto) || 0;

  const guardar = async () => {
    if (!puenteSel) { alert('Elige el PUENTE (viene del catálogo Tipos de Gastos).'); return; }
    if (!Number.isFinite(Number(monto)) || Number(monto) <= 0) { alert('Captura el SALDO a agregar (mayor a cero).'); return; }
    setGuardando(true);
    try {
      await addDoc(collection(db, 'saldos_puentes'), { fecha: hoyISO(), puenteId: puenteSel.id, puenteNombre: puenteSel.nombre, moneda: puenteSel.moneda, saldo: Number(monto), creadoEn: new Date().toISOString() });
      setModalAbierto(false); setPuenteId(''); setMonto('');
    } catch (e) { alert(`No se pudo agregar el saldo: ${(e as Error)?.message || e}`); }
    finally { setGuardando(false); }
  };

  return (
    <div className="tcas-tarjeta" title="Total gastado HOY en cruces por moneda. El saldo se descuenta al marcar Verde MX (exportación) o Verde USA (importación); las cuentas completas están en Bases de Datos → Saldos de Puentes">
      <span className="tcas-etiqueta">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="2.2"><path d="M4 21V8l8-5 8 5v13"></path><path d="M4 11h16"></path><path d="M9 21v-6h6v6"></path></svg>
        Casetas del día
      </span>
      <div className="tcas-linea"><span className="tcas-nombre">Gastado hoy (Dólares)</span><span className="tcas-monto">{fmtMonto(gastadoHoy('Dólares'))}</span></div>
      <div className="tcas-linea"><span className="tcas-nombre">Gastado hoy (Pesos)</span><span className="tcas-monto tcas-monto--mxn">{fmtMonto(gastadoHoy('Pesos'))}</span></div>
      <button type="button" className="tcas-capturar" onClick={() => { setPuenteId(''); setMonto(''); setModalAbierto(true); }} title="Agregar saldo a un puente (recarga de hoy — queda en Saldos de Puentes)">＋ Actualizar saldo</button>
      {modalAbierto && (
        <div className="tcas-modal-fondo" onClick={() => !guardando && setModalAbierto(false)}>
          <div className="tcas-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tcas-modal-titulo">＋ Actualizar saldo</div>
            <label className="tcas-modal-campo"><span>Puente (del catálogo)</span>
              <select className="form-control" value={puenteId} onChange={(e) => setPuenteId(e.target.value)}>
                <option value="">— Elegir puente —</option>
                {puentes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label className="tcas-modal-campo"><span>Moneda (del catálogo)</span>
              <input type="text" className="form-control" value={puenteSel?.moneda || ''} disabled readOnly placeholder="—" />
            </label>
            <label className="tcas-modal-campo"><span>Saldo a agregar</span>
              <input type="number" step="0.01" min="0" className="form-control" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
            </label>
            <div className="tcas-modal-linea"><span>Saldo pendiente por puente</span><b>{puenteSel ? fmtMonto(pendienteSel) : '—'}</b></div>
            <div className="tcas-modal-linea tcas-modal-linea--total"><span>Total (agregar + pendiente)</span><b>{puenteSel ? `${fmtMonto(pendienteSel + montoNum)} ${puenteSel.moneda}` : '—'}</b></div>
            <div className="tcas-modal-pie">
              <button type="button" className="tcas-btn" disabled={guardando} onClick={() => setModalAbierto(false)}>Cancelar</button>
              <button type="button" className="tcas-btn tcas-btn--primario" disabled={guardando || !puenteSel} onClick={guardar}>{guardando ? 'Guardando…' : '＋ Agregar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

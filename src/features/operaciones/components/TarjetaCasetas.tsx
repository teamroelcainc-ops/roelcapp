// ✅ V00360: tarjeta "CASETAS DEL DÍA" — muestra lo GASTADO HOY en cruces
//   (total en Dólares y total en Pesos) y el botón diario "＋ Actualizar saldo":
//   modal con Puente (lista del catálogo), Moneda (no editable), Saldo a
//   agregar, Saldo pendiente por puente y Total. Las recargas quedan en
//   saldos_puentes y el saldo se consume al marcar Verde MX (exportación,
//   Puente III en pesos) o Verde USA (importación, Caseta AVI en dólares).
import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import './TarjetaCasetas.css';
import { docsSinPruebas } from '../../../utils/operacionPrueba';

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
interface CruceMin { puenteNombre: string; fecha: string; monto: number; moneda: string; ref: string; statusNombre: string; evento: string; }

// ✅ V00389: a qué tarjeta pertenece cada puente del catálogo
type GrupoPuente = 'avi' | 'p3' | 'colombia';
const GRUPOS: { clave: GrupoPuente; titulo: string }[] = [
  { clave: 'avi', titulo: 'Puente AVI' },
  { clave: 'p3', titulo: 'Puente III' },
  { clave: 'colombia', titulo: 'Puente Colombia' },
];
const esPisoColombia = (nombre: string) => norm(nombre) === 'puente mx colombia';
const grupoDePuente = (nombre: string): GrupoPuente | null => {
  const n = norm(nombre);
  if (!n) return null;
  if (n.includes('colombia')) return 'colombia';
  if (n.includes('avi')) return 'avi';
  if (n.includes('puente iii') || n.includes('puente 3')) return 'p3';
  if (n.includes('mx')) return 'p3'; // casetas de México hacia Nuevo Laredo (ej. Caseta Mx Auto)
  return null;
};

export const TarjetaCasetas: React.FC = () => {
  const [puentes, setPuentes] = useState<Puente[]>([]);
  const [recargas, setRecargas] = useState<RecargaMin[]>([]);
  const [crucesOps, setCruces] = useState<CruceMin[]>([]);
  // ✅ V00395: OTROS CRUCES (sin operación, registrados en Referencias de Puentes) también descuentan
  const [crucesOtros, setCrucesOtros] = useState<CruceMin[]>([]);
  const cruces = useMemo(() => [...crucesOps, ...crucesOtros], [crucesOps, crucesOtros]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [puenteId, setPuenteId] = useState('');
  const [monto, setMonto] = useState('');
  const [guardando, setGuardando] = useState(false);
  // ✅ V00362: clic en el gasto del día → operaciones que suman al saldo
  const [verGasto, setVerGasto] = useState<{ titulo: string; filtro: (nombre: string) => boolean; soloHoy?: boolean } | null>(null);
  const [grupoRecarga, setGrupoRecarga] = useState<GrupoPuente | ''>('');

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
      setCruces(docsSinPruebas(snap.docs).flatMap((d) => { // ✅ V00380
        const x = d.data() as Record<string, unknown>;
        const caseta = { puenteNombre: String(x.saldoPuentePuente || ''), fecha: String(x.saldoPuenteFecha || ''), monto: Number(x.saldoPuente) || 0, moneda: nombreMoneda(x.saldoPuenteMoneda), ref: String(x.ref || d.id), statusNombre: String(x.statusNombre || ''), evento: String(x.saldoPuenteEvento || '') };
        // ✅ V00388: aduana Colombia — el PISO del puente cuenta como segundo cruce
        if (!(Number(x.saldoPuentePiso) > 0)) return [caseta];
        return [caseta, { ...caseta, puenteNombre: String(x.saldoPuentePisoPuente || 'Puente Mx Colombia'), fecha: String(x.saldoPuentePisoFecha || x.saldoPuenteFecha || ''), monto: Number(x.saldoPuentePiso) || 0, moneda: nombreMoneda(x.saldoPuentePisoMoneda), evento: String(x.saldoPuentePisoEvento || x.saldoPuenteEvento || '') }];
      }));
    }, () => {});
    const u4 = onSnapshot(query(collection(db, 'referencias_puentes'), where('tipo', '==', 'otroCruce')), (snap) => {
      setCrucesOtros(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return { puenteNombre: String(x.puenteNombre || ''), fecha: String(x.fechaCruce || x.fechaGeneracion || ''), monto: Number(x.monto ?? x.subtotalPuentes) || 0, moneda: nombreMoneda(x.moneda), ref: String(x.consecutivo || d.id), statusNombre: 'Otro cruce', evento: String(x.unidad || '') };
      }));
    }, () => setCrucesOtros([]));
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

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

  // ✅ V00389: TRES tarjetas separadas — Puente AVI, Puente III y Puente
  //   Colombia. Colombia muestra por separado la CASETA (cruzar) y el PUENTE
  //   (pisarlo, Puente Mx Colombia).
  const hoy = hoyISO();
  const sumar = (l: CruceMin[]) => l.reduce((acc, c) => acc + c.monto, 0);
  const monedaDe = (filtro: (nombre: string) => boolean) => puentes.find((p) => filtro(p.nombre))?.moneda || '';

  const lineasGrupo = (g: GrupoPuente): { etiqueta: string; filtro: (n: string) => boolean }[] =>
    g === 'colombia'
      ? [
          { etiqueta: 'Caseta', filtro: (n) => grupoDePuente(n) === 'colombia' && !esPisoColombia(n) },
          { etiqueta: 'Puente', filtro: (n) => esPisoColombia(n) },
        ]
      : [{ etiqueta: '', filtro: (n) => grupoDePuente(n) === g }];

  // ✅ V00392: CONTROL por cuenta — saldo agregado (recargas), cruces hechos,
  //   total consumido (la suma de esos cruces) y saldo restante = agregado − consumido.
  //   Los cruces cuentan desde la PRIMERA recarga del puente, igual que el saldo.
  const statsDe = (filtro: (nombre: string) => boolean) => {
    let agregado = 0, nCruces = 0, consumido = 0;
    puentes.filter((p) => filtro(p.nombre)).forEach((p) => {
      const recs = recargas.filter((r) => r.puenteId === p.id).sort((a, b) => a.fecha.localeCompare(b.fecha));
      const primera = recs[0]?.fecha || '';
      agregado += recs.reduce((acc, r) => acc + r.saldo, 0);
      const mios = cruces.filter((x) => norm(x.puenteNombre) === norm(p.nombre) && (!primera || x.fecha >= primera));
      nCruces += mios.length;
      consumido += mios.reduce((acc, x) => acc + x.monto, 0);
    });
    return { agregado, cruces: nCruces, consumido, restante: agregado - consumido };
  };

  const abrirRecarga = (g: GrupoPuente) => { setGrupoRecarga(g); setPuenteId(''); setMonto(''); setModalAbierto(true); };
  const puentesRecarga = puentes.filter((p) => !grupoRecarga || grupoDePuente(p.nombre) === grupoRecarga);

  return (
    <>
      {GRUPOS.map((g) => {
        // ✅ V00392: agregado · cruces · consumido · restante (Colombia: caseta y puente)
        const lineas = lineasGrupo(g.clave);
        const filtroTodo = (n: string) => lineas.some((l) => l.filtro(n));
        const total = statsDe(filtroTodo);
        const mon = monedaDe(filtroTodo);
        const partes = lineas.map((l) => ({ ...l, st: statsDe(l.filtro) }));
        const col = partes.length > 1;
        return (
          <div key={g.clave} className="rd-card rd-card--morado" title={`Control de ${g.titulo}: saldo agregado, cruces, consumido y saldo restante. Detalle en Bases de Datos → Saldos de Puentes`}>
            <div className="rd-card__head">
              <span className="rd-card__label">{g.titulo}</span>
              {mon && <span className="rd-card__chip">{mon === 'Dólares' ? 'USD' : mon === 'Pesos' ? 'MXN' : mon}</span>}
            </div>
            <span className={`rd-card__value${total.restante < 0 ? ' rd-card__value--neg' : ''}`} title="Saldo restante = agregado − consumido">{fmtMonto(total.restante)}</span>
            <span className="rd-card__sub">{total.restante < 0 ? 'Restante (sobregirado)' : 'Saldo restante'}</span>
            <div className={`rd-control${col ? ' rd-control--dos' : ''}`}>
              {col && <><span /> {partes.map((p) => <span key={p.etiqueta} className="rd-control__col">{p.etiqueta}</span>)}</>}
              <span className="rd-control__et">Agregado</span>
              {partes.map((p) => <span key={`a${p.etiqueta}`} className="rd-control__v">{fmtMonto(p.st.agregado)}</span>)}
              <span className="rd-control__et">Cruces</span>
              {partes.map((p) => (
                <button key={`c${p.etiqueta}`} type="button" className="rd-control__v rd-control__v--btn" title="Ver los cruces"
                  onClick={() => setVerGasto({ titulo: `${g.titulo}${p.etiqueta ? ` — ${p.etiqueta}` : ''}`, filtro: p.filtro })}>{p.st.cruces}</button>
              ))}
              <span className="rd-control__et">Consumido</span>
              {partes.map((p) => <span key={`k${p.etiqueta}`} className="rd-control__v rd-control__v--cargo">{fmtMonto(p.st.consumido)}</span>)}
              {col && <>
                <span className="rd-control__et">Restante</span>
                {partes.map((p) => <span key={`r${p.etiqueta}`} className={`rd-control__v${p.st.restante < 0 ? ' rd-control__v--neg' : ''}`}>{fmtMonto(p.st.restante)}</span>)}
              </>}
            </div>
            <div className="rd-card__foot">
              <button type="button" className="rd-btn" onClick={() => abrirRecarga(g.clave)} title={`Agregar saldo a ${g.titulo} (queda en Saldos de Puentes)`}>Actualizar saldo</button>
            </div>
          </div>
        );
      })}

      {verGasto && (() => {
        const lista = cruces.filter((c) => (!verGasto.soloHoy || c.fecha === hoy) && verGasto.filtro(c.puenteNombre)).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.ref.localeCompare(b.ref));
        const total = sumar(lista);
        return (
          <div className="tcas-modal-fondo" onClick={() => setVerGasto(null)}>
            <div className="tcas-modal tcas-modal--gasto" onClick={(e) => e.stopPropagation()}>
              <div className="tcas-modal-titulo">Cruces — {verGasto.titulo}</div>
              <div className="tcas-gasto-marco">
                <table className="tcas-gasto-tabla">
                  <thead><tr><th>Fecha</th><th># Referencia</th><th>Status</th><th>Puente</th><th className="tcas-gasto-num">Peaje</th></tr></thead>
                  <tbody>
                    {lista.length === 0 && <tr><td colSpan={5} className="tcas-gasto-vacio">Sin cruces.</td></tr>}
                    {lista.map((c, i) => (
                      <tr key={i}>
                        <td>{c.fecha}</td>
                        <td className="tcas-gasto-ref">{c.ref}</td>
                        <td className="tcas-gasto-status" title={c.evento ? `Peaje cobrado al marcar: ${c.evento}` : ''}>{c.statusNombre || '—'}{c.evento && <em className="tcas-gasto-evento">✓ {c.evento}</em>}</td>
                        <td>{c.puenteNombre}</td>
                        <td className="tcas-gasto-num">−{fmtMonto(c.monto)} {c.moneda}</td>
                      </tr>
                    ))}
                  </tbody>
                  {lista.length > 0 && <tfoot><tr><td colSpan={4}>Total consumido ({lista.length} cruce{lista.length === 1 ? '' : 's'})</td><td className="tcas-gasto-num tcas-gasto-total">−{fmtMonto(total)}</td></tr></tfoot>}
                </table>
              </div>
              <div className="tcas-modal-pie"><button type="button" className="tcas-btn" onClick={() => setVerGasto(null)}>Cerrar</button></div>
            </div>
          </div>
        );
      })()}

      {modalAbierto && (
        <div className="tcas-modal-fondo" onClick={() => !guardando && setModalAbierto(false)}>
          <div className="tcas-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tcas-modal-titulo">Actualizar saldo{grupoRecarga ? ` — ${GRUPOS.find((x) => x.clave === grupoRecarga)?.titulo}` : ''}</div>
            <label className="tcas-modal-campo"><span>Puente (del catálogo)</span>
              <select className="form-control" value={puenteId} onChange={(e) => setPuenteId(e.target.value)}>
                <option value="">— Elegir puente —</option>
                {puentesRecarga.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
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
              <button type="button" className="tcas-btn tcas-btn--primario" disabled={guardando || !puenteSel} onClick={guardar}>{guardando ? 'Guardando…' : 'Agregar'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

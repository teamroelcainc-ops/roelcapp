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
// ✅ V00398: fecha LOCAL (antes UTC: por la tarde-noche ya era "mañana")
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const horaAhora = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

interface Puente { id: string; nombre: string; moneda: string; }
interface RecargaMin { puenteId: string; puenteNombre: string; fecha: string; saldo: number; }
interface CruceMin { puenteNombre: string; fecha: string; fechaServicio: string; monto: number; moneda: string; ref: string; statusNombre: string; evento: string; }

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
  // ✅ V00398: fecha y HORA de la actualización del saldo
  const [fechaRecarga, setFechaRecarga] = useState(hoyISO());
  const [horaRecarga, setHoraRecarga] = useState(horaAhora());

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
        return { puenteId: String(x.puenteId || ''), puenteNombre: String(x.puenteNombre || ''), fecha: String(x.fecha || ''), saldo: Number(x.saldo) || 0 };
      }));
    }, () => {});
    // ✅ V00410: las tarjetas cuadran con la pestaña SALDO de Referencias de Puentes —
    //   se descuenta lo que está en el HISTORIAL DE REFERENCIAS (calculado) + Otros Cruces.
    const u3 = onSnapshot(collection(db, 'referencias_puentes_auto'), (snap) => {
      setCruces(snap.docs.flatMap((d) => {
        const r = d.data() as Record<string, unknown>;
        const fechaRef = String(r.fechaGeneracion || '');
        const ops = (Array.isArray(r.operacionesGuardadas) ? r.operacionesGuardadas : []) as Record<string, unknown>[];
        return ops.flatMap((o) => {
          const [nomCaseta, nomPiso] = String(o.puenteNombre || '').split(' + ');
          const base = { fecha: fechaRef, fechaServicio: String(o.fecha || fechaRef).slice(0, 10), ref: String(o.ref || ''), statusNombre: String(r.consecutivo || ''), evento: String(o.horaVerde || '') };
          const filas = [{ ...base, puenteNombre: String(nomCaseta || ''), monto: Number(o.caseta ?? o.puente) || 0, moneda: String(o.casetaMoneda || '') }];
          if (nomPiso && Number(o.piso) > 0) filas.push({ ...base, puenteNombre: String(nomPiso), monto: Number(o.piso) || 0, moneda: String(o.pisoMoneda || '') });
          return filas;
        });
      }));
    }, () => {});
    const u4 = onSnapshot(query(collection(db, 'referencias_puentes'), where('tipo', '==', 'otroCruce')), (snap) => {
      setCrucesOtros(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return { puenteNombre: String(x.puenteNombre || ''), fecha: String(x.fechaCruce || x.fechaGeneracion || ''), fechaServicio: String(x.fechaCruce || x.fechaGeneracion || ''), monto: Number(x.monto ?? x.subtotalPuentes) || 0, moneda: nombreMoneda(x.moneda), ref: String(x.consecutivo || d.id), statusNombre: 'Otro cruce', evento: String(x.unidad || '') };
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
      if (!fechaRecarga || !horaRecarga) { alert('Captura la fecha y la hora de la actualización.'); setGuardando(false); return; }
      await addDoc(collection(db, 'saldos_puentes'), { fecha: fechaRecarga, hora: horaRecarga, puenteId: puenteSel.id, puenteNombre: puenteSel.nombre, moneda: puenteSel.moneda, saldo: Number(monto), creadoEn: new Date().toISOString() });
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
    // ✅ V00418: IGUAL que la pestaña Saldo — el saldo es por PUENTE (grupo): los
    //   saldos agregados del grupo descuentan TODOS sus cobros (Puente III = caseta +
    //   trompo; Colombia = caseta + puente) desde el primer saldo del grupo.
    const recs = recargas
      .filter((r) => filtro(r.puenteNombre) || puentes.some((p) => p.id === r.puenteId && filtro(p.nombre)))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const primera = recs[0]?.fecha || '';
    const agregado = recs.reduce((acc, r) => acc + r.saldo, 0);
    const mios = recs.length ? cruces.filter((x) => filtro(x.puenteNombre) && (!primera || x.fecha >= primera)) : [];
    const consumido = mios.reduce((acc, x) => acc + x.monto, 0);
    // ✅ V00398: lo de HOY (por fecha de servicio); inicio + recargas hoy − consumido hoy = restante.
    const restante = agregado - consumido;
    const delDia = cruces.filter((x) => filtro(x.puenteNombre) && x.fechaServicio === hoy);
    const consumidoHoy = recs.length ? delDia.reduce((acc, x) => acc + x.monto, 0) : 0;
    const recargasHoy = recs.filter((r) => r.fecha === hoy).reduce((acc, r) => acc + r.saldo, 0);
    return { agregado, cruces: mios.length, consumido, restante, crucesHoy: delDia.length, consumidoHoy, recargasHoy, inicioDia: restante + consumidoHoy - recargasHoy };
  };

  const abrirRecarga = (g: GrupoPuente) => { setGrupoRecarga(g); setPuenteId(''); setMonto(''); setFechaRecarga(hoyISO()); setHoraRecarga(horaAhora()); setModalAbierto(true); };
  const puentesRecarga = puentes.filter((p) => !grupoRecarga || grupoDePuente(p.nombre) === grupoRecarga);

  return (
    <>
      {GRUPOS.map((g) => {
        // ✅ V00411: diseño renovado — cifra grande = saldo restante (igual que la
        //   pestaña Saldo); filas compactas; Colombia en dos bloques (caseta / puente).
        const lineas = lineasGrupo(g.clave);
        const filtroTodo = (n: string) => lineas.some((l) => l.filtro(n));
        const total = statsDe(filtroTodo);
        const mon = monedaDe(filtroTodo);
        const partes = lineas.map((l) => ({ ...l, st: statsDe(l.filtro) }));
        return (
          <div key={g.clave} className="rd-card rd-card--morado" title={`${g.titulo}: saldos agregados menos el Historial de referencias (Referencias de Puentes → Saldo)`}>
            <div className="rd-card__head">
              <span className="rd-card__label">{g.titulo}</span>
              {mon && <span className="rd-card__chip">{mon === 'Dólares' ? 'USD' : mon === 'Pesos' ? 'MXN' : mon}</span>}
            </div>
            <span className={`rd-card__value${total.restante < 0 ? ' rd-card__value--neg' : ''}`} title="Saldo restante = saldos agregados − referencias">{fmtMonto(total.restante)}</span>
            <span className="rd-card__sub">{total.restante < 0 ? 'Sobregirado' : 'Saldo restante'}</span>
            <div className="rd-filas">
              {partes.length > 1 ? partes.map((p) => (
                <React.Fragment key={p.etiqueta}>
                  <div className="rd-filas__f">
                    <span className="rd-filas__et rd-filas__et--fuerte">{p.etiqueta}</span>
                    <span className="rd-filas__v rd-filas__v--cargo" title="Total cruzado de este concepto">−{fmtMonto(p.st.consumido)}</span>
                  </div>
                  <button type="button" className="rd-filas__f rd-filas__f--btn" title="Ver los cruces de hoy" onClick={() => setVerGasto({ titulo: `${g.titulo} — ${p.etiqueta}`, filtro: p.filtro, soloHoy: true })}>
                    <span className="rd-filas__et">Hoy · {p.st.crucesHoy} {p.st.crucesHoy === 1 ? 'cruce' : 'cruces'}</span>
                    <span className="rd-filas__v rd-filas__v--cargo">−{fmtMonto(p.st.consumidoHoy)}</span>
                  </button>
                </React.Fragment>
              )) : (
                <>
                  <div className="rd-filas__f"><span className="rd-filas__et">Al iniciar hoy</span><span className="rd-filas__v">{fmtMonto(total.inicioDia)}</span></div>
                  {total.recargasHoy > 0 && <div className="rd-filas__f"><span className="rd-filas__et">Recargas hoy</span><span className="rd-filas__v rd-filas__v--abono">+{fmtMonto(total.recargasHoy)}</span></div>}
                  <button type="button" className="rd-filas__f rd-filas__f--btn" title="Ver los cruces de hoy" onClick={() => setVerGasto({ titulo: g.titulo, filtro: filtroTodo, soloHoy: true })}>
                    <span className="rd-filas__et">Hoy · {total.crucesHoy} {total.crucesHoy === 1 ? 'cruce' : 'cruces'}</span>
                    <span className="rd-filas__v rd-filas__v--cargo">−{fmtMonto(total.consumidoHoy)}</span>
                  </button>
                </>
              )}
            </div>
            <div className="rd-card__foot">
              <button type="button" className="rd-btn rd-btn--ancho" onClick={() => abrirRecarga(g.clave)} title={`Agregar saldo a ${g.titulo} (queda en Referencias de Puentes → Saldo)`}>Actualizar saldo</button>
            </div>
          </div>
        );
      })}

      {verGasto && (() => {
        const lista = cruces.filter((c) => (!verGasto.soloHoy || c.fechaServicio === hoy) && verGasto.filtro(c.puenteNombre)).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.ref.localeCompare(b.ref));
        const total = sumar(lista);
        return (
          <div className="tcas-modal-fondo" onClick={() => setVerGasto(null)}>
            <div className="tcas-modal tcas-modal--gasto" onClick={(e) => e.stopPropagation()}>
              <div className="tcas-modal-titulo">Cruces de hoy — {verGasto.titulo}</div>
              <div className="tcas-gasto-marco">
                <table className="tcas-gasto-tabla">
                  <thead><tr><th>Fecha</th><th># Referencia</th><th>Status</th><th>Puente</th><th className="tcas-gasto-num">Peaje</th></tr></thead>
                  <tbody>
                    {lista.length === 0 && <tr><td colSpan={5} className="tcas-gasto-vacio">Sin cruces hoy.</td></tr>}
                    {lista.map((c, i) => (
                      <tr key={i}>
                        <td>{c.fechaServicio}</td>
                        <td className="tcas-gasto-ref">{c.ref}</td>
                        <td className="tcas-gasto-status" title={c.evento ? `Peaje cobrado al marcar: ${c.evento}` : ''}>{c.statusNombre || '—'}{c.evento && <em className="tcas-gasto-evento">✓ {c.evento}</em>}</td>
                        <td>{c.puenteNombre}</td>
                        <td className="tcas-gasto-num">−{fmtMonto(c.monto)} {c.moneda}</td>
                      </tr>
                    ))}
                  </tbody>
                  {lista.length > 0 && <tfoot><tr><td colSpan={4}>Consumido hoy ({lista.length} cruce{lista.length === 1 ? '' : 's'})</td><td className="tcas-gasto-num tcas-gasto-total">−{fmtMonto(total)}</td></tr></tfoot>}
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
            <div className="tcas-modal-fila">
              <label className="tcas-modal-campo"><span>Fecha</span>
                <input type="date" className="form-control" value={fechaRecarga} onChange={(e) => setFechaRecarga(e.target.value)} />
              </label>
              <label className="tcas-modal-campo"><span>Hora de la actualización</span>
                <input type="time" className="form-control" value={horaRecarga} onChange={(e) => setHoraRecarga(e.target.value)} />
              </label>
            </div>
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

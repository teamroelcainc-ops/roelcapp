// ✅ V00358: SALDOS DE PUENTES = CUENTAS por puente que se CONSUMEN con cada
//   cruce. Por puente: Saldo Inicial (suma de recargas), Cruces (operaciones
//   COMPLETADAS que llevan ese puente, con su costo) y Saldo Actual =
//   recargas − cruces, con semáforo (amarillo/rojo por umbral). El importe del
//   catálogo Tipos de Gastos es la TARIFA por cruce (ya no se pisa con saldos).
//   Recargas en la colección saldos_puentes (varias por día permitidas).
import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import './SaldosPuentesDashboard.css';

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
  return t || '—';
};
const hoyISO = () => new Date().toISOString().slice(0, 10);
const fmtMonto = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};
const fmtDia = (iso: string): string => {
  const [a, m, d] = String(iso || '').split('-');
  return d && m && a ? `${d}/${m}/${a}` : String(iso || '—');
};

interface Puente { id: string; nombre: string; moneda: string; tarifa: number; umbralAmarillo: number; umbralRojo: number; }
interface Recarga { id: string; fecha: string; puenteId: string; puenteNombre: string; moneda: string; saldo: number; }
interface CruceOp { puenteNombre: string; fecha: string; monto: number; ref: string; }

export const SaldosPuentesDashboard: React.FC = () => {
  const [puentes, setPuentes] = useState<Puente[]>([]);
  const [recargas, setRecargas] = useState<Recarga[]>([]);
  const [cruces, setCruces] = useState<CruceOp[]>([]);
  const [cargando, setCargando] = useState(true);
  // modal de recarga (Agregar saldo)
  const [modalPuente, setModalPuente] = useState<Puente | null>(null);
  const [monto, setMonto] = useState('');
  const [guardando, setGuardando] = useState(false);
  // edición del historial
  const [editandoId, setEditandoId] = useState('');
  const [montoEdit, setMontoEdit] = useState('');
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'catalogo_tipos_gastos'), (snap) => {
      const lista: Puente[] = [];
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        if (norm(x.categoria_gasto) !== 'puente') return;
        const tarifa = Number(x.importe) || 0;
        lista.push({
          id: d.id,
          nombre: String(x.nombre_gasto || ''),
          moneda: nombreMoneda(x.moneda),
          tarifa,
          // ✅ Umbrales del jefe: AMARILLO a 20 cruces de tarifa, ROJO a 10
          //   (Puente 3: 2,880/1,440 · AVI: 475/237.50). Se pueden fijar a mano
          //   con los campos umbralAmarillo/umbralRojo en el catálogo.
          umbralAmarillo: Number(x.umbralAmarillo) || tarifa * 20,
          umbralRojo: Number(x.umbralRojo) || tarifa * 10,
        });
      });
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setPuentes(lista);
    }, (e) => console.warn('Puentes del catálogo:', e));
    const u2 = onSnapshot(collection(db, 'saldos_puentes'), (snap) => {
      const lista: Recarga[] = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return { id: d.id, fecha: String(x.fecha || ''), puenteId: String(x.puenteId || ''), puenteNombre: String(x.puenteNombre || ''), moneda: String(x.moneda || ''), saldo: Number(x.saldo) || 0 };
      });
      lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.puenteNombre.localeCompare(b.puenteNombre));
      setRecargas(lista);
      setCargando(false);
    }, (e) => { console.warn('Recargas de puentes:', e); setCargando(false); });
    // Cruces = operaciones completadas que llevan saldo de puente colocado (V00355)
    const u3 = onSnapshot(query(collection(db, 'operaciones'), where('saldoPuente', '>', 0)), (snap) => {
      setCruces(snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return { puenteNombre: String(x.saldoPuentePuente || ''), fecha: String(x.saldoPuenteFecha || ''), monto: Number(x.saldoPuente) || 0, ref: String(x.ref || d.id) };
      }));
    }, (e) => console.warn('Cruces con saldo:', e));
    return () => { u1(); u2(); u3(); };
  }, []);

  /** Cuenta de un puente: recargas, cruces (desde la 1ª recarga) y saldo actual. */
  const cuentaDe = (p: Puente) => {
    const recs = recargas.filter((r) => r.puenteId === p.id);
    const primeraRecarga = recs.length ? recs[recs.length - 1].fecha : '';
    const saldoInicial = recs.reduce((acc, r) => acc + r.saldo, 0);
    const misCruces = cruces.filter((c) => norm(c.puenteNombre) === norm(p.nombre) && (!primeraRecarga || c.fecha >= primeraRecarga));
    const consumo = misCruces.reduce((acc, c) => acc + c.monto, 0);
    const hoy = hoyISO();
    const crucesHoy = misCruces.filter((c) => c.fecha === hoy);
    const consumoHoy = crucesHoy.reduce((acc, c) => acc + c.monto, 0);
    const saldoActual = saldoInicial - consumo;
    const nivel = saldoActual < p.umbralRojo ? 'rojo' : saldoActual < p.umbralAmarillo ? 'amarillo' : 'ok';
    return { saldoInicial, misCruces, consumo, crucesHoy, consumoHoy, saldoActual, nivel, primeraRecarga };
  };

  // ✅ V00358 (de V00357): colocar el saldo del puente a las operaciones
  //   COMPLETADAS que no lo tengan — así sus cruces descuentan de la cuenta.
  const [aplicando, setAplicando] = useState(false);
  const STATUS_COMPLETADOS_IDS = ['c2d57403', 'f557b751'];
  const aplicarAOperaciones = async () => {
    const buscar = (clave: 'avi' | 'p3') => puentes.find((p) => clave === 'avi' ? norm(p.nombre) === 'caseta avi' : (norm(p.nombre) === 'caseta puente iii' || norm(p.nombre) === 'caseta puente 3'));
    const avi = buscar('avi'); const p3 = buscar('p3');
    if (!avi && !p3) { alert('No encontré "Caseta AVI" ni "Caseta Puente III" en el catálogo Tipos de Gastos.'); return; }
    if (!window.confirm('Se colocará la tarifa del puente a todas las operaciones COMPLETADAS que no la tengan (Importación → Caseta AVI · Exportación → Caseta Puente III), para que sus cruces descuenten de la cuenta. Las que ya la tienen NO se tocan. ¿Continuar?')) return;
    setAplicando(true);
    try {
      const snap = await getDocs(collection(db, 'operaciones'));
      let pendientes: { id: string; data: Record<string, unknown> }[] = [];
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        if (!STATUS_COMPLETADOS_IDS.includes(String(x.status || '').trim())) return;
        if (Number.isFinite(Number(x.saldoPuente))) return;
        const traf = norm(x.trafico);
        const p = traf.includes('import') ? avi : traf.includes('export') ? p3 : undefined;
        if (!p) return;
        pendientes.push({ id: d.id, data: { saldoPuente: p.tarifa, saldoPuentePuente: p.nombre, saldoPuenteMoneda: p.moneda, saldoPuenteFecha: String(x.fechaServicio || hoyISO()) } });
      });
      const total = pendientes.length;
      while (pendientes.length > 0) {
        const lote = pendientes.slice(0, 450);
        pendientes = pendientes.slice(450);
        const batch = writeBatch(db);
        lote.forEach((c) => batch.update(doc(db, 'operaciones', c.id), c.data));
        await batch.commit();
      }
      alert(`Tarifa del puente colocada en ${total} operación(es) completada(s).`);
    } catch (e) { alert(`No se pudo completar: ${(e as Error)?.message || e}`); }
    finally { setAplicando(false); }
  };

  const abrirRecarga = (p: Puente) => { setModalPuente(p); setMonto(''); };
  const cerrarRecarga = () => { if (!guardando) { setModalPuente(null); setMonto(''); } };
  const guardarRecarga = async () => {
    if (!modalPuente) return;
    const n = Number(monto);
    if (!Number.isFinite(n) || n <= 0) { alert('Captura el SALDO a agregar (mayor a cero).'); return; }
    setGuardando(true);
    try {
      await addDoc(collection(db, 'saldos_puentes'), {
        fecha: hoyISO(), puenteId: modalPuente.id, puenteNombre: modalPuente.nombre,
        moneda: modalPuente.moneda, saldo: n, creadoEn: new Date().toISOString(),
      });
      setModalPuente(null); setMonto('');
    } catch (e) { alert(`No se pudo agregar el saldo: ${(e as Error)?.message || e}`); }
    finally { setGuardando(false); }
  };

  const guardarEdicion = async (r: Recarga) => {
    const n = Number(montoEdit);
    if (!Number.isFinite(n) || n < 0) { alert('Monto inválido.'); return; }
    try { await updateDoc(doc(db, 'saldos_puentes', r.id), { saldo: n }); setEditandoId(''); }
    catch (e) { alert(`No se pudo guardar: ${(e as Error)?.message || e}`); }
  };
  const eliminar = async (r: Recarga) => {
    if (!window.confirm(`¿Eliminar la recarga de ${r.puenteNombre} del ${fmtDia(r.fecha)} por ${fmtMonto(r.saldo)}?`)) return;
    try { await deleteDoc(doc(db, 'saldos_puentes', r.id)); } catch (e) { alert(`No se pudo eliminar: ${(e as Error)?.message || e}`); }
  };

  const recargasFiltradas = useMemo(() => {
    const q = norm(busqueda);
    if (!q) return recargas;
    return recargas.filter((r) => norm(`${r.puenteNombre} ${r.fecha} ${r.saldo} ${r.moneda}`).includes(q));
  }, [recargas, busqueda]);

  const cuentaModal = modalPuente ? cuentaDe(modalPuente) : null;
  const montoNum = Number(monto) || 0;

  return (
    <div className="sp-modulo">
      <div className="sp-encabezado">
        <div>
          <h2 className="sp-titulo">🌉 Saldos de Puentes</h2>
          <p className="sp-sub">Cuenta por puente: el saldo inicial es la suma de tus recargas, cada operación COMPLETADA que cruza descuenta su tarifa, y el saldo actual se marca en amarillo o rojo cuando va quedando bajo. La tarifa por cruce vive en el catálogo Tipos de Gastos.</p>
        </div>
        <button type="button" className="sp-btn" disabled={aplicando} title="Coloca la tarifa del puente a las operaciones completadas que no la tengan, para que sus cruces descuenten de la cuenta" onClick={aplicarAOperaciones}>{aplicando ? 'Aplicando…' : '🧮 Aplicar a operaciones'}</button>
      </div>

      {/* ✅ Cuentas por puente */}
      <div className="sp-cuentas">
        {puentes.map((p) => {
          const c = cuentaDe(p);
          const sinRecargas = c.saldoInicial === 0 && c.misCruces.length === 0;
          return (
            <div key={p.id} className={`sp-cuenta sp-cuenta--${c.nivel}`}>
              <div className="sp-cuenta-enc">
                <span className="sp-cuenta-nombre">{p.nombre}</span>
                <span className={`sp-moneda${p.moneda.includes('Dólar') ? ' sp-moneda--usd' : p.moneda.includes('Peso') ? ' sp-moneda--mxn' : ''}`}>{p.moneda}</span>
              </div>
              <div className="sp-cuenta-linea"><span>Saldo Inicial</span><b>{fmtMonto(c.saldoInicial)}</b></div>
              <div className="sp-cuenta-linea" title={c.crucesHoy.map((x) => x.ref).join(' · ') || 'Sin cruces hoy'}>
                <span>Cruces hoy: {c.crucesHoy.length}</span><b>−{fmtMonto(c.consumoHoy)}</b>
              </div>
              <div className="sp-cuenta-linea"><span>Cruces totales: {c.misCruces.length}</span><b>−{fmtMonto(c.consumo)}</b></div>
              <div className={`sp-cuenta-actual sp-cuenta-actual--${c.nivel}`}>
                <span>Saldo Actual</span>
                <b>{fmtMonto(c.saldoActual)} {p.moneda}</b>
              </div>
              {c.nivel !== 'ok' && !sinRecargas && (
                <div className={`sp-cuenta-alerta sp-cuenta-alerta--${c.nivel}`}>
                  {c.nivel === 'rojo' ? '🔴 Saldo crítico — agrega saldo YA' : '🟡 Saldo bajo — programa una recarga'}
                </div>
              )}
              <button type="button" className="sp-btn sp-btn--primario sp-cuenta-btn" onClick={() => abrirRecarga(p)}>➕ Agregar saldo</button>
              <div className="sp-cuenta-tarifa">Tarifa por cruce: {fmtMonto(p.tarifa)} · Amarillo &lt; {fmtMonto(p.umbralAmarillo)} · Rojo &lt; {fmtMonto(p.umbralRojo)}</div>
            </div>
          );
        })}
        {puentes.length === 0 && <div className="sp-vacio">No hay puentes (categoría "Puente") en el catálogo Tipos de Gastos.</div>}
      </div>

      {/* ✅ Modal AGREGAR SALDO — fecha de hoy fija, moneda del catálogo */}
      {modalPuente && cuentaModal && (
        <div className="sp-modal-fondo" onClick={cerrarRecarga}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sp-modal-titulo">➕ Agregar saldo — {modalPuente.nombre}</div>
            <label className="sp-campo"><span>Fecha (hoy)</span><input type="date" className="form-control" value={hoyISO()} disabled readOnly /></label>
            <label className="sp-campo"><span>Moneda (del catálogo)</span><input type="text" className="form-control" value={modalPuente.moneda} disabled readOnly /></label>
            <label className="sp-campo"><span>Saldo a agregar</span><input type="number" step="0.01" min="0" className="form-control" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" autoFocus /></label>
            <div className="sp-modal-resumen">
              <div className="sp-cuenta-linea"><span>Saldo restante (disponible hoy)</span><b>{fmtMonto(cuentaModal.saldoActual)}</b></div>
              <div className="sp-cuenta-linea sp-modal-total"><span>Total (restante + agregado)</span><b>{fmtMonto(cuentaModal.saldoActual + montoNum)} {modalPuente.moneda}</b></div>
            </div>
            <div className="sp-modal-pie">
              <button type="button" className="sp-btn" disabled={guardando} onClick={cerrarRecarga}>Cancelar</button>
              <button type="button" className="sp-btn sp-btn--primario" disabled={guardando} onClick={guardarRecarga}>{guardando ? 'Guardando…' : '➕ Agregar saldo'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Historial de recargas */}
      <div className="sp-barra">
        <input type="text" className="form-control sp-buscar" placeholder="Buscar recargas por puente, fecha o monto…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <span className="sp-conteo">{recargasFiltradas.length} recarga(s)</span>
      </div>
      <div className="sp-tabla-marco">
        <table className="sp-tabla">
          <thead><tr><th>Fecha</th><th>Puente</th><th className="sp-num">Saldo agregado</th><th>Moneda</th><th>Acciones</th></tr></thead>
          <tbody>
            {cargando && <tr><td colSpan={5} className="sp-vacio">Cargando…</td></tr>}
            {!cargando && recargasFiltradas.length === 0 && <tr><td colSpan={5} className="sp-vacio">Sin recargas. Usa "➕ Agregar saldo" en la tarjeta del puente.</td></tr>}
            {recargasFiltradas.map((r) => (
              <tr key={r.id} className={editandoId === r.id ? 'sp-fila--editando' : ''}>
                <td>{fmtDia(r.fecha)}</td>
                <td>{r.puenteNombre}</td>
                <td className="sp-num sp-monto">
                  {editandoId === r.id
                    ? <input type="number" step="0.01" min="0" className="form-control sp-edit-input" value={montoEdit} onChange={(e) => setMontoEdit(e.target.value)} />
                    : fmtMonto(r.saldo)}
                </td>
                <td><span className={`sp-moneda${norm(r.moneda).includes('dolar') ? ' sp-moneda--usd' : norm(r.moneda).includes('peso') ? ' sp-moneda--mxn' : ''}`}>{r.moneda}</span></td>
                <td className="sp-acciones">
                  {editandoId === r.id ? (
                    <>
                      <button type="button" className="sp-mini" title="Guardar" onClick={() => guardarEdicion(r)}>💾</button>
                      <button type="button" className="sp-mini" title="Cancelar" onClick={() => setEditandoId('')}>✕</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="sp-mini" title="Editar monto" onClick={() => { setEditandoId(r.id); setMontoEdit(String(r.saldo)); }}>✎</button>
                      <button type="button" className="sp-mini sp-mini--rojo" title="Eliminar" onClick={() => eliminar(r)}>🗑</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

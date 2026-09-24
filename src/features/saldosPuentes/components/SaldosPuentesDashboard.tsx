// ✅ V00350: módulo SALDOS DE PUENTES (Bases de Datos) — historial diario del
//   saldo de cada puente. RELACIONAL: el puente se elige del catálogo Tipos de
//   Gastos (se guarda su ID + nombre/moneda desnormalizados) y al registrar el
//   saldo más reciente de un puente, el importe del catálogo se actualiza —
//   la tarjeta "Casetas del día" y toda la app quedan al momento.
import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import './SaldosPuentesDashboard.css';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';
const norm = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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

interface Puente { id: string; nombre: string; moneda: string; importe: unknown; }
interface Saldo { id: string; fecha: string; puenteId: string; puenteNombre: string; moneda: string; saldo: number; }

export const SaldosPuentesDashboard: React.FC = () => {
  const [puentes, setPuentes] = useState<Puente[]>([]);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [cargando, setCargando] = useState(true);
  // formulario
  const [fecha, setFecha] = useState(hoyISO());
  const [puenteId, setPuenteId] = useState('');
  const [monto, setMonto] = useState('');
  const [editandoId, setEditandoId] = useState('');
  const [modalForm, setModalForm] = useState(false); // ✅ V00351: el formulario es un MODAL
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'catalogo_tipos_gastos'), (snap) => {
      const lista: Puente[] = [];
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        if (norm(x.categoria_gasto) === 'puente') lista.push({ id: d.id, nombre: String(x.nombre_gasto || ''), moneda: nombreMoneda(x.moneda), importe: x.importe });
      });
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setPuentes(lista);
    }, (e) => console.warn('Puentes del catálogo:', e));
    const u2 = onSnapshot(collection(db, 'saldos_puentes'), (snap) => {
      const lista: Saldo[] = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return { id: d.id, fecha: String(x.fecha || ''), puenteId: String(x.puenteId || ''), puenteNombre: String(x.puenteNombre || ''), moneda: String(x.moneda || ''), saldo: Number(x.saldo) || 0 };
      });
      lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.puenteNombre.localeCompare(b.puenteNombre));
      setSaldos(lista);
      setCargando(false);
    }, (e) => { console.warn('Saldos de puentes:', e); setCargando(false); });
    return () => { u1(); u2(); };
  }, []);

  const filtrados = useMemo(() => {
    const q = norm(busqueda);
    if (!q) return saldos;
    return saldos.filter((s) => norm(`${s.puenteNombre} ${s.fecha} ${s.saldo} ${s.moneda}`).includes(q));
  }, [saldos, busqueda]);

  /** Si este registro es el MÁS RECIENTE del puente, el catálogo hereda el saldo. */
  const sincronizarCatalogo = async (pId: string, f: string, s: number, idRegistro: string) => {
    const masReciente = saldos.filter((x) => x.puenteId === pId && x.id !== idRegistro).every((x) => x.fecha <= f);
    if (!masReciente) return;
    try { await updateDoc(doc(db, 'catalogo_tipos_gastos', pId), { importe: s }); }
    catch (e) { console.warn('No se pudo actualizar el catálogo:', e); }
  };

  const limpiarForm = () => { setEditandoId(''); setFecha(hoyISO()); setPuenteId(''); setMonto(''); setModalForm(false); };
  const abrirNuevo = () => { setEditandoId(''); setFecha(hoyISO()); setPuenteId(''); setMonto(''); setModalForm(true); };

  const guardar = async () => {
    const p = puentes.find((x) => x.id === puenteId);
    const n = Number(monto);
    if (!fecha) { alert('Captura la FECHA del saldo.'); return; }
    if (!p) { alert('Elige el PUENTE (viene del catálogo Tipos de Gastos).'); return; }
    if (!Number.isFinite(n) || n < 0) { alert('Captura un SALDO válido.'); return; }
    setGuardando(true);
    try {
      const datos = { fecha, puenteId: p.id, puenteNombre: p.nombre, moneda: p.moneda, saldo: n };
      let idReg = editandoId;
      if (editandoId) {
        await updateDoc(doc(db, 'saldos_puentes', editandoId), datos);
      } else {
        const dup = saldos.find((x) => x.puenteId === p.id && x.fecha === fecha);
        if (dup) { await updateDoc(doc(db, 'saldos_puentes', dup.id), datos); idReg = dup.id; }
        else { const ref = await addDoc(collection(db, 'saldos_puentes'), { ...datos, creadoEn: new Date().toISOString() }); idReg = ref.id; }
      }
      await sincronizarCatalogo(p.id, fecha, n, idReg);
      limpiarForm();
    } catch (e) { alert(`No se pudo guardar: ${(e as Error)?.message || e}`); }
    finally { setGuardando(false); }
  };

  // ✅ V00356: colocar el saldo del puente a TODAS las operaciones completadas
  //   que aún no lo tengan: Importación → Caseta AVI · Exportación → Caseta
  //   Puente III. Usa el saldo REGISTRADO en esta tabla con fecha más cercana
  //   (≤) a la fecha de servicio de cada operación; si no hay histórico, el
  //   saldo vigente del catálogo. No pisa las que ya lo tienen.
  const [aplicando, setAplicando] = useState(false);
  const STATUS_COMPLETADOS_IDS = ['c2d57403', 'f557b751'];
  const aplicarAOperaciones = async () => {
    const buscarPuente = (clave: 'avi' | 'p3'): Puente | undefined =>
      puentes.find((p) => clave === 'avi' ? norm(p.nombre) === 'caseta avi' : (norm(p.nombre) === 'caseta puente iii' || norm(p.nombre) === 'caseta puente 3'));
    const avi = buscarPuente('avi');
    const p3 = buscarPuente('p3');
    if (!avi && !p3) { alert('No encontré "Caseta AVI" ni "Caseta Puente III" en el catálogo Tipos de Gastos.'); return; }
    if (!window.confirm('Se colocará el SALDO DEL PUENTE a todas las operaciones COMPLETADAS que no lo tengan:\n\n· Importación → Caseta AVI\n· Exportación → Caseta Puente III\n\nSe usa el saldo registrado con fecha más cercana a la fecha de servicio (o el vigente del catálogo). Las que ya lo tienen NO se tocan. ¿Continuar?')) return;
    setAplicando(true);
    try {
      const saldoPara = (p: Puente, fechaServicio: string): { saldo: number; fecha: string } => {
        const hist = saldos.filter((x) => x.puenteId === p.id && (!fechaServicio || x.fecha <= fechaServicio)).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
        if (hist) return { saldo: hist.saldo, fecha: hist.fecha };
        return { saldo: Number(p.importe) || 0, fecha: hoyISO() };
      };
      const snap = await getDocs(collection(db, 'operaciones'));
      let pendientes: { id: string; data: Record<string, unknown> }[] = [];
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        if (!STATUS_COMPLETADOS_IDS.includes(String(x.status || '').trim())) return;
        if (Number.isFinite(Number(x.saldoPuente))) return; // ya lo tiene
        const traf = norm(x.trafico);
        const p = traf.includes('import') ? avi : traf.includes('export') ? p3 : undefined;
        if (!p) return;
        const res = saldoPara(p, String(x.fechaServicio || ''));
        pendientes.push({ id: d.id, data: { saldoPuente: res.saldo, saldoPuentePuente: p.nombre, saldoPuenteMoneda: p.moneda, saldoPuenteFecha: res.fecha } });
      });
      const total = pendientes.length;
      while (pendientes.length > 0) {
        const lote = pendientes.slice(0, 450);
        pendientes = pendientes.slice(450);
        const batch = writeBatch(db);
        lote.forEach((c) => batch.update(doc(db, 'operaciones', c.id), c.data));
        await batch.commit();
      }
      alert(`Saldo del puente colocado en ${total} operación(es) completada(s). Las que ya lo tenían no se tocaron.`);
    } catch (e) { alert(`No se pudo completar: ${(e as Error)?.message || e}`); }
    finally { setAplicando(false); }
  };

  const editar = (s: Saldo) => { setEditandoId(s.id); setFecha(s.fecha); setPuenteId(s.puenteId); setMonto(String(s.saldo)); setModalForm(true); };
  const eliminar = async (s: Saldo) => {
    if (!window.confirm(`¿Eliminar el saldo de ${s.puenteNombre} del ${fmtDia(s.fecha)}?`)) return;
    try { await deleteDoc(doc(db, 'saldos_puentes', s.id)); } catch (e) { alert(`No se pudo eliminar: ${(e as Error)?.message || e}`); }
  };

  return (
    <div className="sp-modulo">
      <div className="sp-encabezado">
        <div>
          <h2 className="sp-titulo">🌉 Saldos de Puentes</h2>
          <p className="sp-sub">Registro diario del saldo de cada puente (relacionado con el catálogo Tipos de Gastos). El saldo más reciente de cada puente actualiza el catálogo y se refleja en toda la app al momento.</p>
        </div>
        <div className="sp-enc-botones">
          <button type="button" className="sp-btn" disabled={aplicando} title="Coloca el saldo del puente (AVI en importación, Puente III en exportación) a todas las operaciones completadas que no lo tengan" onClick={aplicarAOperaciones}>{aplicando ? 'Aplicando…' : '🧮 Aplicar a operaciones'}</button>
          <button type="button" className="sp-btn sp-btn--primario" onClick={abrirNuevo}>➕ Registrar saldo</button>
        </div>
      </div>

      {/* ✅ V00351: el formulario vive en su MODAL */}
      {modalForm && (
        <div className="sp-modal-fondo" onClick={() => !guardando && limpiarForm()}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sp-modal-titulo">{editandoId ? '✎ Editar saldo de puente' : '➕ Registrar saldo de puente'}</div>
            <label className="sp-campo"><span>Fecha</span><input type="date" className="form-control" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
            <label className="sp-campo"><span>Puente (catálogo Tipos de Gastos)</span>
              <select className="form-control" value={puenteId} onChange={(e) => {
                const id = e.target.value;
                setPuenteId(id);
                // ✅ V00352: al elegir el puente se precarga su saldo ACTUAL del catálogo.
                const pSel = puentes.find((x) => x.id === id);
                if (pSel && Number.isFinite(Number(pSel.importe))) setMonto(String(pSel.importe));
              }}>
                <option value="">— Elegir puente —</option>
                {puentes.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.moneda})</option>)}
              </select>
            </label>
            <label className="sp-campo"><span>Saldo{puenteId ? ` (${puentes.find(p => p.id === puenteId)?.moneda || ''})` : ''}</span><input type="number" step="0.01" min="0" className="form-control" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" /></label>
            <div className="sp-modal-pie">
              <button type="button" className="sp-btn" disabled={guardando} onClick={limpiarForm}>Cancelar</button>
              <button type="button" className="sp-btn sp-btn--primario" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : editandoId ? '💾 Guardar cambios' : '➕ Registrar saldo'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="sp-barra">
        <input type="text" className="form-control sp-buscar" placeholder="Buscar por puente, fecha o monto…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <span className="sp-conteo">{filtrados.length} registro(s)</span>
      </div>

      <div className="sp-tabla-marco">
        <table className="sp-tabla">
          <thead><tr><th>Fecha</th><th>Puente</th><th className="sp-num">Saldo</th><th>Moneda</th><th>Acciones</th></tr></thead>
          <tbody>
            {cargando && <tr><td colSpan={5} className="sp-vacio">Cargando…</td></tr>}
            {!cargando && filtrados.length === 0 && <tr><td colSpan={5} className="sp-vacio">Sin registros. Captura el primero arriba o desde la tarjeta "Casetas del día".</td></tr>}
            {filtrados.map((s) => (
              <tr key={s.id} className={editandoId === s.id ? 'sp-fila--editando' : ''}>
                <td>{fmtDia(s.fecha)}</td>
                <td>{s.puenteNombre}</td>
                <td className="sp-num sp-monto">{fmtMonto(s.saldo)}</td>
                <td><span className={`sp-moneda${norm(s.moneda).includes('dolar') ? ' sp-moneda--usd' : norm(s.moneda).includes('peso') ? ' sp-moneda--mxn' : ''}`}>{s.moneda}</span></td>{/* ✅ V00355 */}
                <td className="sp-acciones">
                  <button type="button" className="sp-mini" title="Editar" onClick={() => editar(s)}>✎</button>
                  <button type="button" className="sp-mini sp-mini--rojo" title="Eliminar" onClick={() => eliminar(s)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

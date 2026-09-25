// ✅ V00358: SALDOS DE PUENTES = CUENTAS por puente que se CONSUMEN con cada
//   cruce. Por puente: Saldo Inicial (suma de recargas), Cruces (operaciones
//   COMPLETADAS que llevan ese puente, con su costo) y Saldo Actual =
//   recargas − cruces, con semáforo (amarillo/rojo por umbral). El importe del
//   catálogo Tipos de Gastos es la TARIFA por cruce (ya no se pisa con saldos).
//   Recargas en la colección saldos_puentes (varias por día permitidas).
import React, { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
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
  // ✅ V00361: modal de recarga ÚNICO con el puente en DESPLEGABLE
  const [modalRecarga, setModalRecarga] = useState(false);
  const [recPuenteId, setRecPuenteId] = useState('');
  const [monto, setMonto] = useState('');
  const [guardando, setGuardando] = useState(false);
  // edición del historial
  // ✅ V00368: libro contable — puente seleccionado
  const [libroPuenteId, setLibroPuenteId] = useState('');
  // ✅ V00359: historial de movimientos (deducciones y recargas con saldo corrido)
  //   por MONEDA (desde las tarjetas de saldo disponible) o por PUENTE.
  const [historial, setHistorial] = useState<{ titulo: string; puenteIds: string[]; nombres: string[] } | null>(null);

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

  // ✅ V00369: el peaje aplica SOLO a (1) Transfer y (2) Logística de Cruces
  //   con proveedor Roelca; Logística de Fletes NUNCA.
  const aplicaPeajeSP = (x: Record<string, unknown>): boolean => {
    const tipo = norm(x.tipoOperacionNombre);
    if (tipo.includes('transfer')) return true;
    if (tipo.includes('flete')) return false;
    if (!tipo.includes('logistica')) return false;
    return norm(x.proveedorUnidadNombre).includes('roelca');
  };

  // ✅ V00369: REPORTE de saldos del puente
  interface FilaRep { ref: string; fecha: string; tipo: string; trafico: string; puente: string; saldo: number | null; moneda: string; }
  const [repAbierto, setRepAbierto] = useState(false);
  const [repCargando, setRepCargando] = useState(false);
  const [repFilas, setRepFilas] = useState<FilaRep[]>([]);
  const [repDe, setRepDe] = useState('');
  const [repHasta, setRepHasta] = useState('');
  const abrirReporte = async () => {
    setRepAbierto(true); setRepCargando(true);
    try {
      const snap = await getDocs(collection(db, 'operaciones'));
      const filas: FilaRep[] = [];
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        if (!aplicaPeajeSP(x)) return;
        if (norm(x.statusNombre).includes('cancel')) return;
        const traf = norm(x.trafico);
        const tieneSaldo = Number(x.saldoPuente) > 0;
        const puenteDef = traf.includes('import') ? 'Caseta AVI' : traf.includes('export') ? 'Caseta Puente III' : '';
        filas.push({
          ref: String(x.ref || d.id),
          fecha: String(x.fechaServicio || '').slice(0, 10),
          tipo: String(x.tipoOperacionNombre || '—'),
          trafico: traf.includes('import') ? 'Importación' : traf.includes('export') ? 'Exportación' : String(x.trafico || '—'),
          puente: String(x.saldoPuentePuente || '') || puenteDef || '—',
          saldo: tieneSaldo ? Number(x.saldoPuente) : null,
          moneda: String(x.saldoPuenteMoneda || (puenteDef === 'Caseta AVI' ? 'Dólares' : puenteDef ? 'Pesos' : '')),
        });
      });
      filas.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.ref.localeCompare(b.ref));
      setRepFilas(filas);
    } catch (e) { alert(`No se pudo armar el reporte: ${(e as Error)?.message || e}`); }
    finally { setRepCargando(false); }
  };
  const repVisibles = repFilas.filter((f) => (!repDe || f.fecha >= repDe) && (!repHasta || f.fecha <= repHasta));
  const repExcel = () => {
    const hoja = repVisibles.map((f) => ({
      'Fecha de Servicio': f.fecha, '# Referencia': f.ref, 'Tipo de Operación': f.tipo,
      'Tráfico': f.trafico, 'Puente': f.puente,
      'Saldo del Puente': f.saldo === null ? 'SIN DESCUENTO' : f.saldo, 'Moneda': f.moneda,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hoja), 'Saldos del Puente');
    XLSX.writeFile(wb, `Reporte-Saldos-Puente-${hoyISO()}.xlsx`);
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
        if (Number.isFinite(Number(x.saldoPuente))) {
          // ✅ V00366: REPARA cruces cobrados por Completado (o sin evento) que
          //   quedaron con la fecha del día en que se registró en vez de la
          //   fecha de servicio — así el "gastado hoy" solo suma cruces de hoy.
          const evento = String(x.saldoPuenteEvento || '');
          const fServ = String(x.fechaServicio || '').slice(0, 10);
          const fSP = String(x.saldoPuenteFecha || '').slice(0, 10);
          if (!evento.toLowerCase().includes('verde') && fServ && fSP && fSP !== fServ) {
            pendientes.push({ id: d.id, data: { saldoPuenteFecha: fServ, saldoPuenteEvento: evento || 'Completado' } });
          }
          return;
        }
        if (!aplicaPeajeSP(x)) return; // ✅ V00369: Fletes / Logística no-Roelca no cobran
        const traf = norm(x.trafico);
        const p = traf.includes('import') ? avi : traf.includes('export') ? p3 : undefined;
        if (!p) return;
        pendientes.push({ id: d.id, data: { saldoPuente: p.tarifa, saldoPuentePuente: p.nombre, saldoPuenteMoneda: p.moneda, saldoPuenteFecha: String(x.fechaServicio || hoyISO()), saldoPuenteEvento: 'Completado' } });
      });
      const total = pendientes.length;
      while (pendientes.length > 0) {
        const lote = pendientes.slice(0, 450);
        pendientes = pendientes.slice(450);
        const batch = writeBatch(db);
        lote.forEach((c) => batch.update(doc(db, 'operaciones', c.id), c.data));
        await batch.commit();
      }
      alert(`Listo: ${total} operación(es) actualizadas (tarifas colocadas y fechas de cruce corregidas).`);
    } catch (e) { alert(`No se pudo completar: ${(e as Error)?.message || e}`); }
    finally { setAplicando(false); }
  };

  // ✅ V00359: saldo disponible por moneda = Σ del saldo actual de las cuentas.
  const disponiblePor = (moneda: 'Dólares' | 'Pesos') => {
    const lista = puentes.filter((p) => p.moneda === moneda);
    return lista.reduce((acc, p) => acc + cuentaDe(p).saldoActual, 0);
  };
  const abrirHistorialMoneda = (moneda: 'Dólares' | 'Pesos') => {
    const lista = puentes.filter((p) => p.moneda === moneda);
    setHistorial({ titulo: `Saldo disponible en ${moneda}`, puenteIds: lista.map((x) => x.id), nombres: lista.map((x) => norm(x.nombre)) });
  };

  /** Movimientos (recargas + y cruces −) ordenados por fecha, con saldo corrido. */
  const movimientosDe = (puenteIds: string[], nombres: string[]) => {
    type Mov = { fecha: string; orden: number; concepto: string; monto: number; recarga?: Recarga };
    const movs: Mov[] = [];
    recargas.filter((r) => puenteIds.includes(r.puenteId)).forEach((r) => movs.push({ fecha: r.fecha, orden: 0, concepto: `➕ Recarga — ${r.puenteNombre}`, monto: r.saldo, recarga: r }));
    const primeras = puenteIds.map((id) => { const recs = recargas.filter((r) => r.puenteId === id).map((r) => r.fecha).sort(); return { id, primera: recs[0] || '' }; });
    cruces.forEach((c) => {
      const idx = nombres.indexOf(norm(c.puenteNombre));
      if (idx === -1) return;
      const primera = primeras.find((x) => x.id === puenteIds[idx])?.primera || '';
      if (primera && c.fecha < primera) return;
      movs.push({ fecha: c.fecha, orden: 1, concepto: `➖ Cruce ${c.ref} — ${c.puenteNombre}`, monto: -c.monto });
    });
    movs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);
    let corrido = 0;
    const conSaldo = movs.map((m) => { corrido += m.monto; return { ...m, saldo: corrido }; });
    return conSaldo.reverse(); // más reciente arriba
  };

  const abrirRecarga = () => { setRecPuenteId(''); setMonto(''); setModalRecarga(true); };
  const cerrarRecarga = () => { if (!guardando) { setModalRecarga(false); setRecPuenteId(''); setMonto(''); } };
  const guardarRecarga = async () => {
    const pSel = puentes.find((x) => x.id === recPuenteId);
    if (!pSel) { alert('Elige el PUENTE en el desplegable.'); return; }
    const n = Number(monto);
    if (!Number.isFinite(n) || n <= 0) { alert('Captura el SALDO a agregar (mayor a cero).'); return; }
    setGuardando(true);
    try {
      await addDoc(collection(db, 'saldos_puentes'), {
        fecha: hoyISO(), puenteId: pSel.id, puenteNombre: pSel.nombre,
        moneda: pSel.moneda, saldo: n, creadoEn: new Date().toISOString(),
      });
      cerrarRecarga();
    } catch (e) { alert(`No se pudo agregar el saldo: ${(e as Error)?.message || e}`); }
    finally { setGuardando(false); }
  };

  const eliminar = async (r: Recarga) => {
    if (!window.confirm(`¿Eliminar la recarga de ${r.puenteNombre} del ${fmtDia(r.fecha)} por ${fmtMonto(r.saldo)}?`)) return;
    try { await deleteDoc(doc(db, 'saldos_puentes', r.id)); } catch (e) { alert(`No se pudo eliminar: ${(e as Error)?.message || e}`); }
  };

  const montoNum = Number(monto) || 0;

  return (
    <div className="sp-modulo">
      <div className="sp-encabezado">
        <div>
          <h2 className="sp-titulo">🌉 Saldos de Puentes</h2>
          <p className="sp-sub">Cuenta por puente: el saldo inicial es la suma de tus recargas, cada operación COMPLETADA que cruza descuenta su tarifa, y el saldo actual se marca en amarillo o rojo cuando va quedando bajo. La tarifa por cruce vive en el catálogo Tipos de Gastos.</p>
        </div>
        <div className="sp-enc-botones">
          <button type="button" className="sp-btn" disabled={aplicando} title="Coloca la tarifa del puente a las operaciones completadas que no la tengan, para que sus cruces descuenten de la cuenta" onClick={aplicarAOperaciones}>{aplicando ? 'Aplicando…' : '🧮 Aplicar a operaciones'}</button>
          <button type="button" className="sp-btn" onClick={abrirReporte} title="Reporte de operaciones que cruzan puente (Transfer y Logística de Cruces con Roelca)">📊 Reporte</button>
          <button type="button" className="sp-btn sp-btn--primario" onClick={abrirRecarga}>➕ Agregar saldo</button>
        </div>
      </div>

      {/* ✅ V00359: saldo disponible por MONEDA — clic = historial de movimientos */}
      <div className="sp-monedas">
        {(['Dólares', 'Pesos'] as const).map((m) => {
          const disp = disponiblePor(m);
          return (
            <button key={m} type="button" className={`sp-moneda-card${disp < 0 ? ' sp-moneda-card--neg' : ''}`} onClick={() => abrirHistorialMoneda(m)} title="Ver el historial de deducciones y saldos">
              <span className="sp-moneda-card-etq">Saldo disponible en {m}</span>
              <b className="sp-moneda-card-monto">{fmtMonto(disp)}</b>
              <span className="sp-moneda-card-ver">📜 Ver historial</span>
            </button>
          );
        })}
      </div>

      {/* ✅ V00368: LIBRO CONTABLE — chips con el disponible de cada puente y
          asientos del puente elegido: las recargas ABONAN (+) y los cruces
          CARGAN (−); la columna Saldo siempre dice cuánto queda disponible. */}
      <div className="sp-chips">
        {puentes.map((p) => {
          const c = cuentaDe(p);
          const activo = (libroPuenteId || puentes[0]?.id) === p.id;
          return (
            <button key={p.id} type="button" className={`sp-chip sp-chip--${c.nivel}${activo ? ' sp-chip--activo' : ''}`} onClick={() => setLibroPuenteId(p.id)} title={`Ver el libro de ${p.nombre}`}>
              <span className="sp-chip-nombre">{p.nombre}</span>
              <b className="sp-chip-saldo">{fmtMonto(c.saldoActual)}</b>
            </button>
          );
        })}
        {puentes.length === 0 && <div className="sp-vacio">No hay puentes (categoría "Puente") en el catálogo Tipos de Gastos.</div>}
      </div>
      {(() => {
        const p = puentes.find((x) => x.id === (libroPuenteId || puentes[0]?.id));
        if (!p) return null;
        const c = cuentaDe(p);
        const movs = movimientosDe([p.id], [norm(p.nombre)]);
        return (
          <div className={`sp-libro sp-libro--${c.nivel}`}>
            <div className="sp-libro-enc">
              <div>
                <span className="sp-libro-nombre">📒 Libro de {p.nombre}</span>
                <span className={`sp-moneda${p.moneda.includes('Dólar') ? ' sp-moneda--usd' : ' sp-moneda--mxn'}`}>{p.moneda}</span>
                <div className="sp-cuenta-tarifa">Tarifa por cruce: {fmtMonto(p.tarifa)} · Amarillo &lt; {fmtMonto(p.umbralAmarillo)} · Rojo &lt; {fmtMonto(p.umbralRojo)}</div>
              </div>
              <div className={`sp-libro-disp sp-cuenta-actual--${c.nivel}`}>
                <span>Disponible</span>
                <b>{fmtMonto(c.saldoActual)} {p.moneda}</b>
                {c.nivel !== 'ok' && <em className="sp-libro-alerta">{c.nivel === 'rojo' ? '🔴 Saldo crítico — agrega saldo YA' : '🟡 Saldo bajo — programa una recarga'}</em>}
              </div>
            </div>
            <div className="sp-libro-marco">
              <table className="sp-tabla sp-tabla--libro">
                <thead><tr><th>Fecha</th><th>Movimiento</th><th className="sp-num">Cargo (−)</th><th className="sp-num">Abono (+)</th><th className="sp-num">Saldo</th><th></th></tr></thead>
                <tbody>
                  {cargando && <tr><td colSpan={6} className="sp-vacio">Cargando…</td></tr>}
                  {!cargando && movs.length === 0 && <tr><td colSpan={6} className="sp-vacio">Sin movimientos. Usa "➕ Agregar saldo" para abonar la cuenta.</td></tr>}
                  {movs.map((m, i) => (
                    <tr key={i}>
                      <td>{fmtDia(m.fecha)}</td>
                      <td>{m.concepto}</td>
                      <td className="sp-num sp-hist-resta">{m.monto < 0 ? `−${fmtMonto(-m.monto)}` : ''}</td>
                      <td className="sp-num sp-hist-suma">{m.monto > 0 ? `+${fmtMonto(m.monto)}` : ''}</td>
                      <td className={`sp-num sp-monto${(m as { saldo?: number }).saldo !== undefined && (m as { saldo?: number }).saldo! < 0 ? ' sp-hist-resta' : ''}`}>{fmtMonto((m as { saldo?: number }).saldo ?? 0)}</td>
                      <td className="sp-acciones">{m.recarga && <button type="button" className="sp-mini sp-mini--rojo" title="Eliminar esta recarga" onClick={() => eliminar(m.recarga!)}>🗑</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ✅ V00369: REPORTE de saldos del puente */}
      {repAbierto && (() => {
        const cobradas = repVisibles.filter((f) => f.saldo !== null);
        const sinSaldo = repVisibles.length - cobradas.length;
        const totUSD = cobradas.filter((f) => norm(f.moneda).includes('dolar')).reduce((a, f) => a + (f.saldo || 0), 0);
        const totMXN = cobradas.filter((f) => norm(f.moneda).includes('peso')).reduce((a, f) => a + (f.saldo || 0), 0);
        return (
          <div className="sp-modal-fondo" onClick={() => setRepAbierto(false)}>
            <div className="sp-modal sp-modal--reporte" onClick={(e) => e.stopPropagation()}>
              <div className="sp-modal-titulo">📊 Reporte de saldos del puente</div>
              <p className="sp-rep-nota">Operaciones de Transfer y de Logística de Cruces con proveedor Roelca (Fletes no cruza puente). "Sin descuento" = aún no marca Verde MX / Verde USA.</p>
              <div className="sp-rep-barra">
                <label>De <input type="date" className="form-control" value={repDe} onChange={(e) => setRepDe(e.target.value)} /></label>
                <label>Hasta <input type="date" className="form-control" value={repHasta} onChange={(e) => setRepHasta(e.target.value)} /></label>
                <span className="sp-conteo">{repVisibles.length} operación(es) · sin descuento: {sinSaldo}</span>
                <button type="button" className="sp-btn" onClick={repExcel} disabled={repVisibles.length === 0}>⬇ Excel</button>
              </div>
              <div className="sp-rep-marco">
                <table className="sp-tabla sp-tabla--libro">
                  <thead><tr><th>Fecha de Servicio</th><th># Referencia</th><th>Tipo de Operación</th><th>Tráfico</th><th>Puente</th><th className="sp-num">Saldo del Puente</th></tr></thead>
                  <tbody>
                    {repCargando && <tr><td colSpan={6} className="sp-vacio">Cargando…</td></tr>}
                    {!repCargando && repVisibles.length === 0 && <tr><td colSpan={6} className="sp-vacio">Sin operaciones en el rango.</td></tr>}
                    {!repCargando && repVisibles.map((f, i) => (
                      <tr key={i} className={f.saldo === null ? 'sp-rep-fila--falta' : ''}>
                        <td>{fmtDia(f.fecha)}</td>
                        <td className="sp-rep-ref">{f.ref}</td>
                        <td>{f.tipo}</td>
                        <td>{f.trafico}</td>
                        <td>{f.puente}</td>
                        <td className="sp-num">{f.saldo === null ? <span className="sp-rep-falta" title="Aún no descuenta — falta marcar Verde MX / Verde USA">🌉⚠ Sin descuento</span> : `−${fmtMonto(f.saldo)} ${f.moneda}`}</td>
                      </tr>
                    ))}
                  </tbody>
                  {!repCargando && cobradas.length > 0 && (
                    <tfoot>
                      <tr><td colSpan={5}>Total descontado — Dólares</td><td className="sp-num sp-hist-resta">−{fmtMonto(totUSD)}</td></tr>
                      <tr><td colSpan={5}>Total descontado — Pesos</td><td className="sp-num sp-hist-resta">−{fmtMonto(totMXN)}</td></tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <div className="sp-modal-pie"><button type="button" className="sp-btn" onClick={() => setRepAbierto(false)}>Cerrar</button></div>
            </div>
          </div>
        );
      })()}

      {/* ✅ Modal AGREGAR SALDO — fecha de hoy fija, moneda del catálogo */}
      {modalRecarga && (() => {
        const pSel = puentes.find((x) => x.id === recPuenteId);
        const pendiente = pSel ? cuentaDe(pSel).saldoActual : 0;
        return (
          <div className="sp-modal-fondo" onClick={cerrarRecarga}>
            <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
              <div className="sp-modal-titulo">➕ Agregar saldo</div>
              <label className="sp-campo"><span>Fecha (hoy)</span><input type="date" className="form-control" value={hoyISO()} disabled readOnly /></label>
              <label className="sp-campo"><span>Puente (del catálogo)</span>
                <select className="form-control" value={recPuenteId} onChange={(e) => setRecPuenteId(e.target.value)} autoFocus>
                  <option value="">— Elegir puente —</option>
                  {puentes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </label>
              <label className="sp-campo"><span>Moneda (del catálogo)</span><input type="text" className="form-control" value={pSel?.moneda || ''} disabled readOnly placeholder="—" /></label>
              <label className="sp-campo"><span>Saldo a agregar</span><input type="number" step="0.01" min="0" className="form-control" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" /></label>
              <div className="sp-modal-resumen">
                <div className="sp-cuenta-linea"><span>Saldo pendiente por puente</span><b>{pSel ? fmtMonto(pendiente) : '—'}</b></div>
                <div className="sp-cuenta-linea sp-modal-total"><span>Total (agregar + pendiente)</span><b>{pSel ? `${fmtMonto(pendiente + montoNum)} ${pSel.moneda}` : '—'}</b></div>
              </div>
              <div className="sp-modal-pie">
                <button type="button" className="sp-btn" disabled={guardando} onClick={cerrarRecarga}>Cancelar</button>
                <button type="button" className="sp-btn sp-btn--primario" disabled={guardando || !pSel} onClick={guardarRecarga}>{guardando ? 'Guardando…' : '➕ Agregar saldo'}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ✅ V00359: modal HISTORIAL de deducciones y saldos */}
      {historial && (() => {
        const movs = movimientosDe(historial.puenteIds, historial.nombres);
        return (
          <div className="sp-modal-fondo" onClick={() => setHistorial(null)}>
            <div className="sp-modal sp-modal--historial" onClick={(e) => e.stopPropagation()}>
              <div className="sp-modal-titulo">📜 Historial — {historial.titulo}</div>
              <div className="sp-hist-marco">
                <table className="sp-tabla">
                  <thead><tr><th>Fecha</th><th>Movimiento</th><th className="sp-num">Monto</th></tr></thead>{/* ✅ V00367: sin saldo corrido en los movimientos */}
                  <tbody>
                    {movs.length === 0 && <tr><td colSpan={4} className="sp-vacio">Sin movimientos todavía.</td></tr>}
                    {movs.map((m, i) => (
                      <tr key={i}>
                        <td>{fmtDia(m.fecha)}</td>
                        <td>{m.concepto}</td>
                        <td className={`sp-num ${m.monto < 0 ? 'sp-hist-resta' : 'sp-hist-suma'}`}>{m.monto < 0 ? `−${fmtMonto(-m.monto)}` : `+${fmtMonto(m.monto)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sp-modal-pie"><button type="button" className="sp-btn" onClick={() => setHistorial(null)}>Cerrar</button></div>
            </div>
          </div>
        );
      })()}

    </div>
  );
};

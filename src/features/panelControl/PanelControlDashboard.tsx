// src/features/panelControl/PanelControlDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00164: PANEL DE CONTROL — metas mensuales/anuales + dashboard gráfico.
//   · Configurador de metas: operaciones, facturación (MXN) y utilidad (MXN)
//     por MES y por AÑO → doc configuracion/metas_globales (compartido).
//   · Gráficas por mes (barras CSS, sin librerías): real vs meta con línea de
//     meta, colores por cumplimiento y tarjetas de avance del mes y del año.
//   · Semáforos de control del app: documentos vencidos, solicitudes de
//     autorización pendientes y empresas sin moneda.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import './PanelControlDashboard.css';

interface Metas { opsMes: number; opsAnio: number; factMes: number; factAnio: number; utilMes: number; utilAnio: number; }
const METAS_VACIAS: Metas = { opsMes: 0, opsAnio: 0, factMes: 0, factAnio: 0, utilMes: 0, utilAnio: 0 };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const fmtMon = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const num = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };

export const PanelControlDashboard = () => {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [metas, setMetas] = useState<Metas>(METAS_VACIAS);
  const [editandoMetas, setEditandoMetas] = useState(false);
  const [metasDraft, setMetasDraft] = useState<Metas>(METAS_VACIAS);
  const [guardandoMetas, setGuardandoMetas] = useState(false);
  const [ops, setOps] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [alertas, setAlertas] = useState({ docsVencidos: 0, solicitudesPend: 0, empresasSinMoneda: 0 });

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const [mSnap, oSnap, dSnap, sSnap, eSnap] = await Promise.all([
          getDoc(doc(db, 'configuracion', 'metas_globales')),
          getDocs(query(collection(db, 'operaciones'), where('fechaServicio', '>=', `${anio}-01-01`), where('fechaServicio', '<=', `${anio}-12-31`))),
          getDocs(collection(db, 'documentos')),
          getDocs(query(collection(db, 'solicitudes_autorizacion'), where('estado', '==', 'pendiente'))),
          getDocs(collection(db, 'empresas')),
        ]);
        const m: any = mSnap.exists() ? mSnap.data() : {};
        const cargadas: Metas = { opsMes: num(m.opsMes), opsAnio: num(m.opsAnio), factMes: num(m.factMes), factAnio: num(m.factAnio), utilMes: num(m.utilMes), utilAnio: num(m.utilAnio) };
        setMetas(cargadas); setMetasDraft(cargadas);
        setOps(oSnap.docs.map((d) => d.data()));
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        let vencidos = 0;
        dSnap.docs.forEach((d) => { const x: any = d.data(); if (x.vence && x.fechaVencimiento) { const v = new Date(String(x.fechaVencimiento) + 'T00:00:00'); if (!isNaN(v.getTime()) && v.getTime() < hoy.getTime()) vencidos++; } });
        let sinMoneda = 0;
        eSnap.docs.forEach((d) => { const x: any = d.data(); if (!String(x.monedaId || x.moneda || x.monedaNombre || '').trim()) sinMoneda++; });
        setAlertas({ docsVencidos: vencidos, solicitudesPend: sSnap.size, empresasSinMoneda: sinMoneda });
      } catch (e) { console.error('[Panel de Control]', e); }
      finally { setCargando(false); }
    })();
  }, [anio]);

  const porMes = useMemo(() => {
    const base = MESES.map(() => ({ ops: 0, fact: 0, util: 0 }));
    ops.forEach((o: any) => {
      const mm = Number(String(o.fechaServicio || '').split('-')[1]) - 1;
      if (mm < 0 || mm > 11) return;
      base[mm].ops += 1;
      base[mm].fact += num(o.conversionCliente);
      base[mm].util += num(o.utilidadEstimada);
    });
    return base;
  }, [ops]);

  const mesActual = new Date().getMonth();
  const totalAnio = useMemo(() => porMes.reduce((a, m) => ({ ops: a.ops + m.ops, fact: a.fact + m.fact, util: a.util + m.util }), { ops: 0, fact: 0, util: 0 }), [porMes]);

  const guardarMetas = async () => {
    if (guardandoMetas) return;
    setGuardandoMetas(true);
    try {
      const limpio: Metas = { opsMes: num(metasDraft.opsMes), opsAnio: num(metasDraft.opsAnio), factMes: num(metasDraft.factMes), factAnio: num(metasDraft.factAnio), utilMes: num(metasDraft.utilMes), utilAnio: num(metasDraft.utilAnio) };
      await setDoc(doc(db, 'configuracion', 'metas_globales'), limpio, { merge: true });
      setMetas(limpio); setEditandoMetas(false);
    } catch (e: any) { alert(`No se pudieron guardar las metas: ${e?.message || e}`); }
    finally { setGuardandoMetas(false); }
  };

  const pct = (real: number, meta: number) => meta > 0 ? Math.round((real / meta) * 100) : null;
  const claseAvance = (p: number | null) => p === null ? '' : p >= 100 ? 'pc-ok' : p >= 70 ? 'pc-medio' : 'pc-bajo';

  const Grafica = ({ titulo, valores, meta, dinero }: { titulo: string; valores: number[]; meta: number; dinero?: boolean }) => {
    const maxVal = Math.max(...valores, meta, 1);
    return (
      <div className="pc-grafica">
        <div className="pc-grafica-titulo">{titulo}{meta > 0 && <span className="pc-grafica-meta">Meta mensual: {dinero ? fmtMon(meta) : meta}</span>}</div>
        <div className="pc-barras">
          {meta > 0 && <div className="pc-linea-meta" style={{ '--pc-meta-frac': String(meta / maxVal) } as React.CSSProperties} />}
          {valores.map((v, i) => {
            const p = pct(v, meta);
            return (
              <div key={i} className={`pc-barra-col${i === mesActual && anio === anioActual ? ' pc-mes-actual' : ''}`} title={`${MESES[i]}: ${dinero ? fmtMon(v) : v}${p !== null ? ` (${p}% de la meta)` : ''}`}>
                <div className={`pc-barra ${meta > 0 ? (v >= meta ? 'pc-b-ok' : v >= meta * 0.7 ? 'pc-b-medio' : 'pc-b-bajo') : 'pc-b-neutra'}`} style={{ '--pc-h': `${(v / maxVal) * 100}%` } as React.CSSProperties} />
                <span className="pc-barra-mes">{MESES[i]}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const Tarjeta = ({ titulo, real, meta, dinero }: { titulo: string; real: number; meta: number; dinero?: boolean }) => {
    const p = pct(real, meta);
    return (
      <div className={`pc-tarjeta ${claseAvance(p)}`}>
        <div className="pc-tarjeta-titulo">{titulo}</div>
        <div className="pc-tarjeta-valor">{dinero ? fmtMon(real) : real.toLocaleString('en-US')}</div>
        <div className="pc-tarjeta-meta">{meta > 0 ? <>de {dinero ? fmtMon(meta) : meta.toLocaleString('en-US')} · <b>{p}%</b></> : 'Sin meta configurada'}</div>
        {meta > 0 && <div className="pc-progreso"><div className="pc-progreso-fill" style={{ '--pc-w': `${Math.min(100, p || 0)}%` } as React.CSSProperties} /></div>}
      </div>
    );
  };

  return (
    <div className="dashboard-container pc-contenedor">
      <div className="pc-encabezado">
        <div>
          <h2 className="pc-titulo">Panel de Control</h2>
          <p className="pc-sub">Metas mensuales y anuales vs. resultados reales, y salud general del app.</p>
        </div>
        <div className="pc-encabezado-der">
          <select className="form-control pc-select-anio" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {[anioActual + 1, anioActual, anioActual - 1, anioActual - 2].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn btn-outline pc-btn-metas" onClick={() => { setMetasDraft(metas); setEditandoMetas(true); }}>🎯 Configurar metas</button>
        </div>
      </div>

      <div className="pc-alertas">
        <div className={`pc-alerta${alertas.docsVencidos ? ' pc-alerta-mal' : ''}`}>📄 Documentos vencidos: <b>{alertas.docsVencidos}</b></div>
        <div className={`pc-alerta${alertas.solicitudesPend ? ' pc-alerta-medio' : ''}`}>🔐 Solicitudes pendientes: <b>{alertas.solicitudesPend}</b></div>
        <div className={`pc-alerta${alertas.empresasSinMoneda ? ' pc-alerta-medio' : ''}`}>💱 Empresas sin moneda: <b>{alertas.empresasSinMoneda}</b></div>
      </div>

      {cargando ? <p className="pc-cargando">⏳ Cargando información del {anio}…</p> : (
        <>
          <h3 className="pc-seccion">Avance del mes ({MESES[mesActual]})</h3>
          <div className="pc-tarjetas">
            <Tarjeta titulo="Operaciones del mes" real={porMes[mesActual].ops} meta={metas.opsMes} />
            <Tarjeta titulo="Facturación del mes (MXN)" real={porMes[mesActual].fact} meta={metas.factMes} dinero />
            <Tarjeta titulo="Utilidad del mes (MXN)" real={porMes[mesActual].util} meta={metas.utilMes} dinero />
          </div>
          <h3 className="pc-seccion">Avance del año {anio}</h3>
          <div className="pc-tarjetas">
            <Tarjeta titulo="Operaciones del año" real={totalAnio.ops} meta={metas.opsAnio} />
            <Tarjeta titulo="Facturación del año (MXN)" real={totalAnio.fact} meta={metas.factAnio} dinero />
            <Tarjeta titulo="Utilidad del año (MXN)" real={totalAnio.util} meta={metas.utilAnio} dinero />
          </div>
          <Grafica titulo={`Operaciones por mes · ${anio}`} valores={porMes.map((m) => m.ops)} meta={metas.opsMes} />
          <Grafica titulo={`Facturación por mes (MXN) · ${anio}`} valores={porMes.map((m) => m.fact)} meta={metas.factMes} dinero />
          <Grafica titulo={`Utilidad estimada por mes (MXN) · ${anio}`} valores={porMes.map((m) => m.util)} meta={metas.utilMes} dinero />
        </>
      )}

      {editandoMetas && (
        <div className="modal-overlay pc-metas-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !guardandoMetas) setEditandoMetas(false); }}>
          <div className="pc-metas-card">
            <div className="pc-metas-header"><h3>🎯 Metas mensuales y anuales</h3><button className="pc-metas-cerrar" onClick={() => setEditandoMetas(false)} disabled={guardandoMetas}>✕</button></div>
            <div className="pc-metas-grid">
              <label><span>Operaciones / mes</span><input className="form-control" type="number" min={0} value={metasDraft.opsMes || ''} onChange={(e) => setMetasDraft((p) => ({ ...p, opsMes: num(e.target.value) }))} /></label>
              <label><span>Operaciones / año</span><input className="form-control" type="number" min={0} value={metasDraft.opsAnio || ''} onChange={(e) => setMetasDraft((p) => ({ ...p, opsAnio: num(e.target.value) }))} /></label>
              <label><span>Facturación MXN / mes</span><input className="form-control" type="number" min={0} value={metasDraft.factMes || ''} onChange={(e) => setMetasDraft((p) => ({ ...p, factMes: num(e.target.value) }))} /></label>
              <label><span>Facturación MXN / año</span><input className="form-control" type="number" min={0} value={metasDraft.factAnio || ''} onChange={(e) => setMetasDraft((p) => ({ ...p, factAnio: num(e.target.value) }))} /></label>
              <label><span>Utilidad MXN / mes</span><input className="form-control" type="number" min={0} value={metasDraft.utilMes || ''} onChange={(e) => setMetasDraft((p) => ({ ...p, utilMes: num(e.target.value) }))} /></label>
              <label><span>Utilidad MXN / año</span><input className="form-control" type="number" min={0} value={metasDraft.utilAnio || ''} onChange={(e) => setMetasDraft((p) => ({ ...p, utilAnio: num(e.target.value) }))} /></label>
            </div>
            <p className="pc-metas-nota">Las metas se comparten con todos los usuarios del panel. La facturación y utilidad se calculan con la Conversión Cliente y la Utilidad Estimada (MXN) de cada operación por su fecha de servicio; las metas por día de la semana siguen en la tarjeta "Operaciones del día".</p>
            <div className="pc-metas-acciones">
              <button className="btn btn-outline" onClick={() => setEditandoMetas(false)} disabled={guardandoMetas}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarMetas} disabled={guardandoMetas}>{guardandoMetas ? 'Guardando…' : 'Guardar metas'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

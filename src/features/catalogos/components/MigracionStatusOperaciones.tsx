// src/features/catalogos/components/MigracionStatusOperaciones.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// MIGRACIÓN DE STATUS  (ejecutar UNA sola vez, en este orden: A y luego B)
// ═══════════════════════════════════════════════════════════════════════
//
// MIGRACIÓN A — Flujos → statusID
//   Agrega `statusID` (hex de catalogo_status_servicio) a cada nodo de
//   config_flujos_operacion, por nombre. No toca `nombreStatus`.
//
// MIGRACIÓN B — Operaciones (status final)
//   CON horarios:
//     1. Empareja la operación con su FLUJO por cobertura de statuses de la
//        bitácora (no usa trafico/carga; configId solo como desempate).
//     2. Toma el status MÁS AVANZADO registrado (por `orden` del flujo).
//     3. Avanza por los nodos AUTOMÁTICOS siguientes (respetando, si se marca,
//        sus camposRequeridos) hasta un paso manual/decisión o el final.
//        => p.ej. "13.1 Entregada" → "14. Servicio Completado".
//     Si ningún flujo casa, usa el status más avanzado por prefijo numérico
//     ("13.1" > "13" > "11.2"…) SIN avanzar (mejor eso que dejar "-").
//   SIN horarios:
//     - sin status → status por defecto elegido (por defecto "Pre-Documentado").
//     - con status → se deja igual.
//   Solo escribe cuando el valor cambia.
//
// NOTA: que una operación llegue a "Servicio Completado" depende de que SU
// flujo tenga ese paso como AUTOMÁTICO después de "Entregada". El preview lo
// muestra antes de escribir nada.
//
// RUTA: src/features/catalogos/components/MigracionStatusOperaciones.tsx
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';

type LogTipo = 'info' | 'ok' | 'warn' | 'err';
interface LogLinea { tipo: LogTipo; texto: string; }

const BATCH_MAX = 400;

const norm = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const stripPrefijo = (s: any): string =>
  String(s ?? '').replace(/^\s*\d+(?:\.\d+)*\.?\s+/, '').trim();
const laxo = (s: any): string => norm(stripPrefijo(s)).replace(/[^a-z0-9]/g, '');

// Prefijo numérico "13.1 ..." → [13,1] para comparar avance
const prefijoTupla = (nombre: any): number[] => {
  const m = String(nombre ?? '').match(/^\s*(\d+(?:\.\d+)*)/);
  if (!m) return [-1];
  return m[1].split('.').map(n => parseInt(n, 10));
};
const cmpTupla = (a: number[], b: number[]): number => {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? -1, y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
};

interface MapaStatus {
  porId: Record<string, { id: string; nombre: string }>;
  porNombre: Record<string, { id: string; nombre: string }>;
  porNombreSinPrefijo: Record<string, { id: string; nombre: string }[]>;
}
const construirMapaStatus = (docs: any[]): MapaStatus => {
  const porId: MapaStatus['porId'] = {};
  const porNombre: MapaStatus['porNombre'] = {};
  const porNombreSinPrefijo: MapaStatus['porNombreSinPrefijo'] = {};
  docs.forEach(d => {
    const entry = { id: String(d.id || ''), nombre: String(d.nombre || '') };
    if (!entry.id) return;
    porId[entry.id] = entry;
    if (entry.nombre) {
      porNombre[norm(entry.nombre)] = entry;
      const k = norm(stripPrefijo(entry.nombre));
      if (k) (porNombreSinPrefijo[k] = porNombreSinPrefijo[k] || []).push(entry);
    }
  });
  return { porId, porNombre, porNombreSinPrefijo };
};
const resolverPorNombre = (nombreStatus: string, mapa: MapaStatus): { id: string; nombre: string } | null => {
  const exacto = mapa.porNombre[norm(nombreStatus)];
  if (exacto) return exacto;
  const cands = mapa.porNombreSinPrefijo[norm(stripPrefijo(nombreStatus))];
  if (cands && cands.length === 1) return cands[0];
  return null;
};

const formatTitleCase = (str: string): string =>
  (!str || str === 'N/A') ? 'N/A' : str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
const construirConfigId = (op: any, tiposOpPorId: Record<string, string>): string => {
  let t = tiposOpPorId[String(op.tipoOperacionId)] || 'N/A';
  if (t.toLowerCase() === 'logistica') t = 'Logística';
  else if (t !== 'N/A') t = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return `${t}_${formatTitleCase(op.trafico)}_${formatTitleCase(op.carga)}`;
};


interface FlujoInfo {
  configId: string;
  nodos: any[];
  nodosPorId: Record<string, any>;
  nodoPorStatusId: Record<string, any>;
  statusIdSet: Set<string>;
}

export const MigracionStatusOperaciones = () => {
  const [logsA, setLogsA] = useState<LogLinea[]>([]);
  const [logsB, setLogsB] = useState<LogLinea[]>([]);
  const [corriendoA, setCorriendoA] = useState(false);
  const [corriendoB, setCorriendoB] = useState(false);

  const [statusOpciones, setStatusOpciones] = useState<{ id: string; nombre: string }[]>([]);
  const [defaultStatusId, setDefaultStatusId] = useState('');
  const [respetarCampos, setRespetarCampos] = useState(true);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);

  const pushA = (tipo: LogTipo, texto: string) => setLogsA(prev => [...prev, { tipo, texto }]);
  const pushB = (tipo: LogTipo, texto: string) => setLogsB(prev => [...prev, { tipo, texto }]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'catalogo_status_servicio'));
        const lista = snap.docs
          .map(d => ({ id: d.id, nombre: String((d.data() as any).nombre || '') }))
          .filter(s => s.nombre)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
        setStatusOpciones(lista);
        const pre = lista.find(s => laxo(s.nombre) === 'predocumentado') || lista.find(s => laxo(s.nombre).startsWith('predocumentado'));
        if (pre) setDefaultStatusId(pre.id);
      } catch (e) { console.error(e); }
      finally { setCargandoCatalogo(false); }
    })();
  }, []);

  // ====================================================================
  // MIGRACIÓN A — Flujos → statusID
  // ====================================================================
  const migrarFlujos = async (aplicar: boolean) => {
    setCorriendoA(true); setLogsA([]);
    pushA('info', aplicar ? '▶ APLICANDO Migración A…' : '👁 Previsualización Migración A (no escribe)…');
    try {
      const [statusSnap, flujosSnap] = await Promise.all([
        getDocs(collection(db, 'catalogo_status_servicio')),
        getDocs(collection(db, 'config_flujos_operacion')),
      ]);
      const mapa = construirMapaStatus(statusSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      pushA('info', `Catálogo: ${statusSnap.docs.length} · Flujos: ${flujosSnap.docs.length}.`);

      const noEnc = new Set<string>();
      let docsCambios = 0, nodosUpd = 0, nodosOk = 0;
      const updates: { id: string; flujo: any[] }[] = [];
      flujosSnap.docs.forEach(d => {
        const flujo: any[] = Array.isArray((d.data() as any).flujo) ? (d.data() as any).flujo : [];
        let cambio = false;
        const nuevo = flujo.map(nodo => {
          const yaTiene = nodo.statusID && String(nodo.statusID).trim() !== '';
          const m = resolverPorNombre(String(nodo.nombreStatus || ''), mapa);
          if (!m) { if (nodo.nombreStatus) noEnc.add(String(nodo.nombreStatus)); return nodo; }
          if (yaTiene && String(nodo.statusID) === m.id) { nodosOk++; return nodo; }
          cambio = true; nodosUpd++;
          return { ...nodo, statusID: m.id };
        });
        if (cambio) { docsCambios++; updates.push({ id: d.id, flujo: nuevo }); }
      });
      pushA('ok', `Nodos a actualizar: ${nodosUpd} · ya correctos: ${nodosOk} · documentos: ${docsCambios}.`);
      if (noEnc.size > 0) { pushA('warn', `⚠ ${noEnc.size} nodo(s) sin match:`); Array.from(noEnc).sort().forEach(n => pushA('warn', `   • "${n}"`)); }
      if (!aplicar) { pushA('info', '👁 Fin previsualización. Pulsa "Aplicar".'); return; }

      let batch = writeBatch(db); let n = 0;
      for (const u of updates) {
        batch.update(doc(db, 'config_flujos_operacion', u.id), { flujo: u.flujo, ultimaActualizacion: new Date().toISOString() });
        if (++n >= BATCH_MAX) { await batch.commit(); batch = writeBatch(db); n = 0; }
      }
      if (n > 0) await batch.commit();
      pushA('ok', `✅ Migración A aplicada. ${docsCambios} flujo(s).`);
    } catch (e: any) { pushA('err', `❌ ${e?.message || e}`); console.error(e); }
    finally { setCorriendoA(false); }
  };

  // ====================================================================
  // MIGRACIÓN B — Operaciones (status final con cascada)
  // ====================================================================
  const migrarOperaciones = async (aplicar: boolean) => {
    if (aplicar && !defaultStatusId) { alert('Elige primero el "Status por defecto (sin horario)".'); return; }
    setCorriendoB(true); setLogsB([]);
    pushB('info', aplicar ? '▶ APLICANDO Migración B…' : '👁 Previsualización Migración B (no escribe)…');
    try {
      pushB('info', 'Descargando catálogo, horarios, flujos, tipos de operación y operaciones…');
      const [statusSnap, horariosSnap, flujosSnap, tiposOpSnap, opsSnap] = await Promise.all([
        getDocs(collection(db, 'catalogo_status_servicio')),
        getDocs(collection(db, 'horarios')),
        getDocs(collection(db, 'config_flujos_operacion')),
        getDocs(collection(db, 'catalogo_tipo_operacion')),
        getDocs(collection(db, 'operaciones')),
      ]);

      const mapa = construirMapaStatus(statusSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      const defaultStatus = mapa.porId[defaultStatusId] || null;
      if (defaultStatus) pushB('info', `Default sin horario: "${defaultStatus.nombre}".`);

      const tiposOpPorId: Record<string, string> = {};
      tiposOpSnap.docs.forEach(d => { tiposOpPorId[d.id] = String((d.data() as any).tipo_operacion || ''); });

      // statusID de un nodo (statusID directo o resuelto por nombre)
      const statusIdDeNodo = (nodo: any): string => {
        const sid = nodo?.statusID && String(nodo.statusID).trim();
        if (sid) return sid;
        const m = resolverPorNombre(String(nodo?.nombreStatus || ''), mapa);
        return m ? m.id : '';
      };

      // Construir info por flujo
      const flujoInfos: FlujoInfo[] = flujosSnap.docs.map(d => {
        const data = d.data() as any;
        const nodos: any[] = Array.isArray(data.flujo) ? data.flujo : [];
        const nodosPorId: Record<string, any> = {};
        const nodoPorStatusId: Record<string, any> = {};
        const statusIdSet = new Set<string>();
        nodos.forEach(nd => {
          nodosPorId[nd.id] = nd;
          const sid = statusIdDeNodo(nd);
          if (sid) { statusIdSet.add(sid); if (!nodoPorStatusId[sid]) nodoPorStatusId[sid] = nd; }
        });
        return { configId: String(data.configId || d.id), nodos, nodosPorId, nodoPorStatusId, statusIdSet };
      });

      // Nodo inicial (orden 1) por configId — para el default opcional por flujo (no se usa salvo extensión futura)
      // Campos requeridos cumplidos por la operación
      const camposCumplidos = (nodo: any, op: any): boolean => {
        const reqs = Array.isArray(nodo?.camposRequeridos) ? nodo.camposRequeridos : [];
        return reqs.every((c: string) => {
          const v = op[c];
          return v !== undefined && v !== null && String(v).trim() !== '';
        });
      };

      // Cascada: avanza por nodos automáticos siguientes hasta toparse con manual/decisión o final
      const cascada = (nodoInicial: any, info: FlujoInfo, op: any): any => {
        let actual = nodoInicial;
        const vis = new Set<string>();
        while (actual && !vis.has(actual.id)) {
          vis.add(actual.id);
          const sigs = (actual.opcionesSiguientes || []).map((id: string) => info.nodosPorId[id]).filter(Boolean);
          const auto = sigs.filter((nd: any) => nd.tipoMecanismo === 'automatico' && (!respetarCampos || camposCumplidos(nd, op)));
          if (auto.length === 0) break;
          actual = auto.sort((a: any, b: any) => (a.orden ?? 9999) - (b.orden ?? 9999))[0];
        }
        return actual;
      };

      // Agrupar TODOS los horarios por operación
      const horariosPorOp: Record<string, any[]> = {};
      let horariosSinOp = 0;
      horariosSnap.docs.forEach(d => {
        const h = d.data() as any;
        const opId = String(h.operacionId || '').trim();
        if (!opId) { horariosSinOp++; return; }
        (horariosPorOp[opId] = horariosPorOp[opId] || []).push(h);
      });

      pushB('info', `Horarios: ${horariosSnap.docs.length} (sin operacionId: ${horariosSinOp}) · Operaciones: ${opsSnap.docs.length} · Flujos: ${flujoInfos.length}.`);

      let desdeCascada = 0, sinFlujoPrefijo = 0, desdeDefault = 0, sinCambio = 0, sinHorarioConStatus = 0, sinNada = 0;
      const huerfanos = new Set<string>();
      const updates: { id: string; status: string; statusNombre: string }[] = [];

      opsSnap.docs.forEach(d => {
        const op = d.data() as any;
        const opId = String(d.id);
        const statusActual = String(op.status || '').trim();
        const nombreActual = String(op.statusNombre || '').trim();
        const lista = horariosPorOp[opId] || [];

        let nuevoHex = '', nuevoNombre = '';

        if (lista.length > 0) {
          // Emparejar con flujo por cobertura de statuses de la bitácora
          const opHexes = Array.from(new Set(lista.map(h => String(h.status || '').trim()).filter(Boolean)));
          const configIdOp = construirConfigId(op, tiposOpPorId);
          let best: FlujoInfo | null = null, bestCov = 0;
          for (const info of flujoInfos) {
            let cov = 0;
            for (const hx of opHexes) if (info.statusIdSet.has(hx)) cov++;
            if (cov > bestCov || (cov === bestCov && cov > 0 && info.configId === configIdOp)) { bestCov = cov; best = info; }
          }

          if (best && bestCov > 0) {
            // Nodo más avanzado por orden entre los horarios mapeables
            let nodoMax: any = null, ordenMax = -Infinity;
            for (const h of lista) {
              const hx = String(h.status || '').trim();
              const nd = best.nodoPorStatusId[hx];
              if (nd && (nd.orden ?? -1) > ordenMax) { ordenMax = nd.orden ?? -1; nodoMax = nd; }
            }
            if (nodoMax) {
              const final = cascada(nodoMax, best, op);
              const hex = statusIdDeNodo(final);
              if (hex) { nuevoHex = hex; nuevoNombre = mapa.porId[hex]?.nombre || String(final.nombreStatus || ''); desdeCascada++; }
            }
          }

          // Fallback sin flujo: status más avanzado por prefijo numérico (sin cascada)
          if (!nuevoHex) {
            let mejorTup = [-2]; let mejorHex = '', mejorNombre = '';
            for (const h of lista) {
              const hx = String(h.status || '').trim();
              if (!hx) continue;
              if (!mapa.porId[hx]) huerfanos.add(hx);
              const nombre = mapa.porId[hx]?.nombre || String(h.statusNombre || '');
              const t = prefijoTupla(nombre);
              if (cmpTupla(t, mejorTup) > 0) { mejorTup = t; mejorHex = hx; mejorNombre = nombre; }
            }
            if (mejorHex) { nuevoHex = mejorHex; nuevoNombre = mejorNombre; sinFlujoPrefijo++; }
          }

          if (!nuevoHex) { sinNada++; return; }
        } else {
          // SIN horarios
          if (statusActual) { sinHorarioConStatus++; return; }
          if (!defaultStatus) { sinNada++; return; }
          nuevoHex = defaultStatus.id; nuevoNombre = defaultStatus.nombre; desdeDefault++;
        }

        if (nuevoHex === statusActual && nuevoNombre === nombreActual) { sinCambio++; return; }
        updates.push({ id: opId, status: nuevoHex, statusNombre: nuevoNombre });
      });

      pushB('ok', `Resultado → con cascada de flujo: ${desdeCascada} · sin flujo (por prefijo): ${sinFlujoPrefijo} · default sin horario: ${desdeDefault} · sin cambio: ${sinCambio} · sin horario con status: ${sinHorarioConStatus} · sin resolver: ${sinNada}.`);
      if (huerfanos.size > 0) pushB('warn', `⚠ ${huerfanos.size} status hex en horarios no están en el catálogo: ${Array.from(huerfanos).join(', ')}`);
      pushB('info', `Total operaciones a escribir: ${updates.length}.`);

      if (!aplicar) { pushB('info', '👁 Fin previsualización. Pulsa "Aplicar".'); return; }

      let batch = writeBatch(db); let n = 0, escritas = 0;
      for (const u of updates) {
        batch.update(doc(db, 'operaciones', u.id), { status: u.status, statusNombre: u.statusNombre });
        n++; escritas++;
        if (n >= BATCH_MAX) { await batch.commit(); pushB('info', `   …${escritas}/${updates.length}`); batch = writeBatch(db); n = 0; }
      }
      if (n > 0) await batch.commit();
      pushB('ok', `✅ Migración B aplicada. ${updates.length} operación(es). Recarga Operaciones con Ctrl+Shift+R.`);
    } catch (e: any) { pushB('err', `❌ ${e?.message || e}`); console.error(e); }
    finally { setCorriendoB(false); }
  };

  // ---------- UI ----------
  const colorLog = (t: LogTipo) => t === 'ok' ? '#3fb950' : t === 'warn' ? '#d29922' : t === 'err' ? '#f85149' : '#8b949e';
  const Panel = ({ logs }: { logs: LogLinea[] }) => (
    <div style={{ marginTop: 14, background: '#010409', border: '1px solid #30363d', borderRadius: 8, padding: 14, minHeight: 120, maxHeight: 340, overflowY: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.6 }}>
      {logs.length === 0 ? <span style={{ color: '#6e7681' }}>Sin ejecutar. Empieza por "Previsualizar".</span>
        : logs.map((l, i) => <div key={i} style={{ color: colorLog(l.tipo), whiteSpace: 'pre-wrap' }}>{l.texto}</div>)}
    </div>
  );
  const btn = (bg: string): React.CSSProperties => ({ padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', background: bg });
  const btnOutline: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, border: '1px solid #30363d', color: '#c9d1d9', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', background: 'transparent' };
  const card: React.CSSProperties = { background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, padding: 24, marginBottom: 22 };
  const selEstilo: React.CSSProperties = { background: '#010409', border: '1px solid #30363d', color: '#e6edf3', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, minWidth: 280 };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0d14', color: '#c9d1d9', padding: '32px 28px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#f0f6fc', margin: '0 0 4px' }}>Migración de Status</h1>
        <p style={{ color: '#8b949e', margin: '0 0 24px', fontSize: 14 }}>Corre <b style={{ color: '#fb923c' }}>A</b> y luego <b style={{ color: '#fb923c' }}>B</b>. Cada una tiene "Previsualizar" (no escribe) para revisar números antes de aplicar.</p>

        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f0f6fc', margin: '0 0 6px' }}>A · Flujos → <code style={{ color: '#fb923c' }}>statusID</code></h2>
          <p style={{ color: '#8b949e', fontSize: 13.5, margin: '0 0 16px' }}>Agrega <code>statusID</code> a cada nodo de <code>config_flujos_operacion</code>. No toca <code>nombreStatus</code>. (Necesario para que B mapee bitácora → flujo.)</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btnOutline} disabled={corriendoA} onClick={() => migrarFlujos(false)}>{corriendoA ? 'Procesando…' : 'Previsualizar'}</button>
            <button style={btn('linear-gradient(180deg,#ea580c,#c2410c)')} disabled={corriendoA} onClick={() => { if (window.confirm('¿Aplicar Migración A?')) migrarFlujos(true); }}>{corriendoA ? 'Procesando…' : 'Aplicar Migración A'}</button>
          </div>
          <Panel logs={logsA} />
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f0f6fc', margin: '0 0 6px' }}>B · Operaciones (status final)</h2>
          <p style={{ color: '#8b949e', fontSize: 13.5, margin: '0 0 14px' }}>Con horarios: toma el status más avanzado de la bitácora y avanza por los pasos automáticos del flujo hasta el final (p.ej. → Servicio Completado). Sin horarios: status por defecto.</p>

          <div style={{ background: '#010409', border: '1px solid #21262d', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12.5, color: '#8b949e', fontWeight: 600, marginBottom: 6 }}>Status por defecto (operaciones sin horario)</label>
            <select style={selEstilo} value={defaultStatusId} onChange={e => setDefaultStatusId(e.target.value)} disabled={cargandoCatalogo || corriendoB}>
              <option value="">{cargandoCatalogo ? 'Cargando catálogo…' : '— Selecciona un status —'}</option>
              {statusOpciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 13.5, color: '#c9d1d9', cursor: 'pointer' }}>
              <input type="checkbox" checked={respetarCampos} onChange={e => setRespetarCampos(e.target.checked)} style={{ transform: 'scale(1.2)' }} disabled={corriendoB} />
              Avanzar automático solo si la operación cumple los <b>campos requeridos</b> del nodo (recomendado)
            </label>
            <p style={{ color: '#6e7681', fontSize: 12, margin: '8px 0 0', lineHeight: 1.5 }}>Desmárcalo para avanzar por la topología del flujo ignorando campos (más agresivo).</p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btnOutline} disabled={corriendoB} onClick={() => migrarOperaciones(false)}>{corriendoB ? 'Procesando…' : 'Previsualizar'}</button>
            <button style={btn('linear-gradient(180deg,#238636,#196c2e)')} disabled={corriendoB || !defaultStatusId} onClick={() => { if (window.confirm('¿Aplicar Migración B? Se escribirá status/statusNombre en las operaciones.')) migrarOperaciones(true); }}>{corriendoB ? 'Procesando…' : 'Aplicar Migración B'}</button>
          </div>
          <Panel logs={logsB} />
        </div>

        <p style={{ color: '#6e7681', fontSize: 12.5, lineHeight: 1.6 }}>Llegar a "Servicio Completado" depende de que el flujo de esa operación tenga ese paso como automático tras "Entregada". El preview lo refleja. La Migración B lee colecciones completas; córrela en baja demanda si tu cuota es ajustada.</p>
      </div>
    </div>
  );
};

export default MigracionStatusOperaciones;
// src/features/tablero/TableroOperacionesDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00170: TABLERO (CRM) — módulo DE PRUEBA estilo kanban: las operaciones
//   activas se muestran en columnas por STATUS y se cambian de status con
//   arrastrar y soltar (drag & drop nativo). Al soltar, se guarda en Firestore
//   (updateDoc status) y las tarjetas se reacomodan en vivo (onSnapshot).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import './TableroOperacionesDashboard.css';

const norm = (s: string) => String(s || '').trim();
// ✅ V00171: paleta de prueba por status (se asigna por orden de columna)
const PALETA = ['#58a6ff', '#3fb950', '#f59e0b', '#f85149', '#a371f7', '#2dd4bf', '#ff7043', '#eab308', '#ec4899', '#8b949e', '#22c55e', '#38bdf8'];

export const TableroOperacionesDashboard = () => {
  const [ops, setOps] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [arrastrando, setArrastrando] = useState('');
  const [guardandoId, setGuardandoId] = useState('');
  // ✅ V00171: catálogo de status (Reglas de Estatus) — id → nombre, y TODAS las columnas
  const [catStatus, setCatStatus] = useState<{ id: string; nombre: string }[]>([]);
  useEffect(() => {
    getDocs(collection(db, 'catalogo_status_servicio')).then((snap) => {
      setCatStatus(snap.docs.map((d) => ({ id: d.id, nombre: String((d.data() as any).nombre || d.id) })));
    }).catch(() => setCatStatus([]));
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'operaciones'), orderBy('fechaServicio', 'desc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setOps(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      setCargando(false);
    }, () => setCargando(false));
    return () => unsub();
  }, []);

  const columnas = useMemo(() => {
    // id de catálogo → nombre real (muchas operaciones guardan el id del status)
    const idANombre = new Map(catStatus.map((c) => [c.id, c.nombre]));
    const nombreDe = (st: string) => idANombre.get(st) || st;
    const porStatus = new Map<string, any[]>();
    // ✅ TODAS las reglas de estatus presentes como columna, aunque estén vacías
    catStatus.forEach((c) => porStatus.set(c.nombre, []));
    ops.forEach((o) => {
      const st = nombreDe(norm(o.status)) || '(Sin status)';
      if (!porStatus.has(st)) porStatus.set(st, []);
      porStatus.get(st)!.push(o);
    });
    return Array.from(porStatus.entries()).sort((a, b) => {
      const na = parseFloat(a[0]); const nb = parseFloat(b[0]);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      if (!isNaN(na)) return -1; if (!isNaN(nb)) return 1;
      return a[0].localeCompare(b[0], 'es');
    });
  }, [ops, catStatus]);

  const soltarEn = async (status: string, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || arrastrando;
    setArrastrando('');
    if (!id) return;
    const op = ops.find((o) => o.id === id);
    if (!op || norm(op.status) === status) return;
    setGuardandoId(id);
    try { await updateDoc(doc(db, 'operaciones', id), { status }); }
    catch (err: any) { alert(`No se pudo cambiar el status: ${err?.message || err}`); }
    finally { setGuardandoId(''); }
  };

  return (
    <div className="dashboard-container tb-contenedor">
      <div>
        <h2 className="tb-titulo">Tablero (CRM) <span className="tb-beta">módulo de prueba</span></h2>
        <p className="tb-sub">Arrastra una operación a otra columna para cambiarle el status (se guarda al instante). Muestra las últimas 200 operaciones.</p>
      </div>
      {cargando ? <p className="tb-cargando">⏳ Cargando operaciones…</p> : (
        <div className="tb-tablero">
          {columnas.map(([status, lista], idxCol) => (
            <div key={status} className="tb-columna" style={{ '--tb-color': PALETA[idxCol % PALETA.length] } as React.CSSProperties} onDragOver={(e) => e.preventDefault()} onDrop={(e) => soltarEn(status, e)}>
              <div className="tb-col-header"><span className="tb-col-titulo">{status}</span><span className="tb-col-conteo">{lista.length}</span></div>
              <div className="tb-col-cuerpo">
                {lista.map((o: any) => (
                  <div key={o.id} draggable
                    className={`tb-tarjeta${guardandoId === o.id ? ' tb-guardando' : ''}${arrastrando === o.id ? ' tb-arrastrando' : ''}`}
                    onDragStart={(e) => { setArrastrando(o.id); e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => setArrastrando('')}
                    title="Arrastra a otra columna para cambiar el status">
                    <div className="tb-tarjeta-ref">{o.ref || '(sin ref)'}{guardandoId === o.id && ' ⏳'}</div>
                    <div className="tb-tarjeta-linea">{o.clientePagaNombre || o.clienteNombre || '—'}</div>
                    <div className="tb-tarjeta-meta">
                      {o.fechaServicio && <span>{o.fechaServicio}</span>}
                      {o.unidadNombre && <span>· {o.unidadNombre}</span>}
                      {o.operadorNombre && <span>· {o.operadorNombre}</span>}
                    </div>
                  </div>
                ))}
                {lista.length === 0 && <div className="tb-col-vacia">Suelta aquí</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

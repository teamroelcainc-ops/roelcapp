// src/features/vencimientos/ReporteVencimientosDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00154: REPORTE DE VENCIMIENTO — documentos de empleados, empresas y
//   unidades con fecha de vencimiento.
//   · Pestaña 1 "Vencidos y por vencer": primero los VENCIDOS (rojo) y después
//     los POR VENCER (ámbar), ordenados por proximidad de la fecha.
//   · Pestaña 2 "Sin fechas": todos los documentos sin fecha de emisión o de
//     vencimiento, con edición de fechas DIRECTO en la tabla (guardado al
//     instante en Firestore).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, updateDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../../config/firebase';
import './ReporteVencimientosDashboard.css';

interface DocVenc {
  id: string;
  coleccionOrigen: string;
  registroId: string;
  registroNombre: string;
  tipoDocumento: string;
  nombreArchivo: string;
  url?: string;
  vence: boolean;
  fechaExpedicion: string;
  fechaVencimiento: string;
  dias: number | null; // días para vencer (negativo = vencido); null si no hay fecha
}

const ETQ_ORIGEN: Record<string, string> = {
  empleados: 'Empleado', empresas: 'Empresa', unidades: 'Unidad',
  operaciones: 'Operación', bodegas: 'Bodega',
};
const fmtFecha = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
};

export const ReporteVencimientosDashboard = () => {
  const [docs, setDocs] = useState<DocVenc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pestana, setPestana] = useState<'vencimientos' | 'sinFechas'>('vencimientos');
  const [filtroOrigen, setFiltroOrigen] = useState<string>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [soloQueVencen, setSoloQueVencen] = useState(true); // pestaña 2
  const [guardandoId, setGuardandoId] = useState('');
  // ✅ V00155: nombres reales de los registros — muchos documentos guardan solo
  //   el ID (registroNombre vacío o con pinta de id); se resuelven contra
  //   empleados / empresas / unidades.
  const [nombres, setNombres] = useState<Record<string, Record<string, string>>>({});
  useEffect(() => {
    (async () => {
      const out: Record<string, Record<string, string>> = { empleados: {}, empresas: {}, unidades: {} };
      try {
        const [se, sm, su] = await Promise.all([
          getDocs(collection(db, 'empleados')),
          getDocs(collection(db, 'empresas')),
          getDocs(collection(db, 'unidades')),
        ]);
        se.docs.forEach((d) => { const x: any = d.data(); out.empleados[d.id] = (`${x.firstName || x.nombres || ''} ${x.lastNamePaternal || x.apellidoPaterno || ''} ${x.lastNameMaternal || x.apellidoMaterno || ''}`.replace(/\s+/g, ' ').trim()) || String(x.nombre || x.nombreCompleto || x.employeeId || d.id); });
        sm.docs.forEach((d) => { const x: any = d.data(); out.empresas[d.id] = String(x.nombre || x.empresa || d.id); });
        su.docs.forEach((d) => { const x: any = d.data(); out.unidades[d.id] = String(x.unidad || x.placas || x.nombre || d.id); });
      } catch (e) { console.error('[Reporte Vencimiento] nombres:', e); }
      setNombres(out);
    })();
  }, []);
  const pareceId = (t: string) => /^[0-9a-f]{8,}$/i.test(String(t || '').trim());
  // ✅ V00158: resolución ROBUSTA del nombre — muchos documentos migrados guardan
  //   el id recortado o solo en el docId (empleados__<id>__<tipo>); se prueba
  //   coincidencia exacta y por prefijo contra la colección correspondiente.
  const nombreRegistro = (d: DocVenc): string => {
    const col = String(d.coleccionOrigen || '').toLowerCase();
    const colKey = col.startsWith('emple') ? 'empleados' : col.startsWith('empre') ? 'empresas' : col.startsWith('unidad') ? 'unidades' : col;
    const mapa = nombres[colKey] || {};
    const delDocId = (() => {
      const partes = String(d.id || '').split('__');
      return partes.length >= 3 ? partes[1] : '';
    })();
    const candidatos = [d.registroId, delDocId, pareceId(d.registroNombre) ? d.registroNombre : '']
      .map((c) => String(c || '').trim()).filter(Boolean);
    for (const c of candidatos) {
      if (mapa[c] && !pareceId(mapa[c])) return mapa[c]; // exacto (y con nombre real)
    }
    // por prefijo (ids recortados en la migración): el candidato es prefijo del id
    // real, o el id real es prefijo del candidato.
    for (const c of candidatos) {
      if (c.length < 6) continue;
      const k = Object.keys(mapa).find((id) => id.startsWith(c) || c.startsWith(id));
      if (k && !pareceId(mapa[k])) return mapa[k];
    }
    if (d.registroNombre && !pareceId(d.registroNombre)) return d.registroNombre;
    return d.registroNombre || d.registroId || '—';
  };

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'documentos'), (snap) => {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const lista: DocVenc[] = snap.docs.map((d) => {
        const x: any = d.data();
        let dias: number | null = null;
        if (x.fechaVencimiento) {
          const v = new Date(String(x.fechaVencimiento) + 'T00:00:00');
          if (!isNaN(v.getTime())) dias = Math.floor((v.getTime() - hoy.getTime()) / 86400000);
        }
        return {
          id: d.id,
          coleccionOrigen: String(x.coleccionOrigen || ''),
          registroId: String(x.registroId || ''),
          registroNombre: String(x.registroNombre || x.carpeta || x.registroId || '—'),
          tipoDocumento: String(x.tipoDocumento || x.subcarpeta || x.nombreArchivo || 'Documento'),
          nombreArchivo: String(x.nombreArchivo || ''),
          url: x.url,
          vence: !!x.vence,
          fechaExpedicion: String(x.fechaExpedicion || ''),
          fechaVencimiento: String(x.fechaVencimiento || ''),
          dias,
        };
      });
      setDocs(lista);
      setCargando(false);
    }, () => setCargando(false));
    return () => unsub();
  }, []);

  const coincide = (d: DocVenc) => {
    if (filtroOrigen !== 'todos' && d.coleccionOrigen !== filtroOrigen) return false;
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return `${nombreRegistro(d)} ${d.registroNombre} ${d.tipoDocumento} ${ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen}`.toLowerCase().includes(q);
  };

  // Pestaña 1: vencidos primero, luego por vencer, por proximidad.
  const filasVencimientos = useMemo(() => {
    const conFecha = docs.filter((d) => d.vence && d.dias !== null && coincide(d));
    const vencidos = conFecha.filter((d) => (d.dias as number) < 0).sort((a, b) => (a.dias! - b.dias!)); // más vencido primero
    const porVencer = conFecha.filter((d) => (d.dias as number) >= 0).sort((a, b) => (a.dias! - b.dias!)); // más próximo primero
    return { vencidos, porVencer, todas: [...vencidos, ...porVencer] };
  }, [docs, filtroOrigen, busqueda]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pestaña 2: sin fecha de emisión o vencimiento (editable en la tabla).
  const filasSinFechas = useMemo(() =>
    docs.filter((d) => coincide(d) && (soloQueVencen ? d.vence : true) && (!d.fechaVencimiento || !d.fechaExpedicion))
      .sort((a, b) => Number(b.vence) - Number(a.vence) || nombreRegistro(a).localeCompare(nombreRegistro(b), 'es') || a.tipoDocumento.localeCompare(b.tipoDocumento, 'es')),
  [docs, filtroOrigen, busqueda, soloQueVencen]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardarCampo = async (d: DocVenc, campo: 'fechaExpedicion' | 'fechaVencimiento' | 'vence', valor: string | boolean) => {
    setGuardandoId(d.id);
    try { await updateDoc(doc(db, 'documentos', d.id), { [campo]: valor }); }
    catch (e: any) { alert(`No se pudo guardar: ${e?.message || e}`); }
    finally { setGuardandoId(''); }
  };

  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    const filas = filasVencimientos.todas.map((d) => [
      ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen, nombreRegistro(d), d.tipoDocumento,
      fmtFecha(d.fechaExpedicion), fmtFecha(d.fechaVencimiento),
      (d.dias as number) < 0 ? `VENCIDO hace ${Math.abs(d.dias as number)} día(s)` : `Vence en ${d.dias} día(s)`,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['TIPO', 'USUARIO DEL DOCUMENTO', 'DOCUMENTO', 'EXPEDICIÓN', 'VENCIMIENTO', 'ESTADO'], ...filas]), 'Vencimientos');
    XLSX.writeFile(wb, 'Reporte_Vencimientos.xlsx');
  };

  const chipEstado = (d: DocVenc) => {
    const dias = d.dias as number;
    if (dias < 0) return <span className="rv-chip rv-rojo">Vencido hace {Math.abs(dias)} día(s)</span>;
    if (dias === 0) return <span className="rv-chip rv-ambar">Vence HOY</span>;
    return <span className="rv-chip rv-ambar">Vence en {dias} día(s)</span>;
  };

  return (
    <div className="dashboard-container rv-contenedor">
      <div className="rv-encabezado">
        <div>
          <h2 className="rv-titulo">Reporte de Vencimiento</h2>
          <p className="rv-sub">Documentos de empleados, empresas y unidades con control de vencimiento.</p>
        </div>
        <button className="btn btn-outline rv-btn-excel" onClick={exportarExcel} disabled={filasVencimientos.todas.length === 0}>⬇ Excel</button>
      </div>

      <div className="rv-tabs">
        <button className={`rv-tab${pestana === 'vencimientos' ? ' activa' : ''}`} onClick={() => setPestana('vencimientos')}>
          Vencidos y por vencer
          {filasVencimientos.vencidos.length > 0 && <span className="rv-badge rv-rojo">{filasVencimientos.vencidos.length}</span>}
          {filasVencimientos.porVencer.length > 0 && <span className="rv-badge rv-ambar">{filasVencimientos.porVencer.length}</span>}
        </button>
        <button className={`rv-tab${pestana === 'sinFechas' ? ' activa' : ''}`} onClick={() => setPestana('sinFechas')}>
          Sin fechas de emisión o vencimiento
          {filasSinFechas.length > 0 && <span className="rv-badge rv-gris">{filasSinFechas.length}</span>}
        </button>
      </div>

      <div className="rv-filtros">
        <input className="form-control rv-buscar" type="text" placeholder="Buscar por usuario o documento…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select className="form-control rv-select" value={filtroOrigen} onChange={(e) => setFiltroOrigen(e.target.value)}>
          <option value="todos">Todos (empleados, empresas, unidades)</option>
          <option value="empleados">Empleados</option>
          <option value="empresas">Empresas</option>
          <option value="unidades">Unidades</option>
        </select>
        {pestana === 'sinFechas' && (
          <label className="rv-check">
            <input type="checkbox" checked={soloQueVencen} onChange={(e) => setSoloQueVencen(e.target.checked)} />
            <span>Solo documentos que vencen</span>
          </label>
        )}
      </div>

      {cargando ? <p className="rv-cargando">⏳ Cargando documentos…</p> : (
        <div className="rv-tabla-wrap">
          {pestana === 'vencimientos' ? (
            <table className="rv-tabla">
              <thead><tr><th>Tipo</th><th>Usuario del documento</th><th>Documento</th><th>Expedición</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {filasVencimientos.todas.length === 0 && <tr><td colSpan={7} className="rv-vacio">Sin documentos vencidos ni por vencer con los filtros actuales. ✅</td></tr>}
                {filasVencimientos.todas.map((d) => (
                  <tr key={d.id} className={(d.dias as number) < 0 ? 'rv-fila-vencido' : 'rv-fila-porvencer'}>
                    <td>{ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen || '—'}</td>
                    <td className="rv-registro">{nombreRegistro(d)}</td>
                    <td className="rv-doc">{d.tipoDocumento}</td>
                    <td className="rv-fecha">{fmtFecha(d.fechaExpedicion)}</td>
                    <td className="rv-fecha">{fmtFecha(d.fechaVencimiento)}</td>
                    <td>{chipEstado(d)}</td>
                    <td>{d.url && <a className="rv-ver" href={d.url} target="_blank" rel="noopener noreferrer">Ver</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="rv-tabla">
              <thead><tr><th>Tipo</th><th>Usuario del documento</th><th>Documento</th><th>Vence</th><th>Expedición</th><th>Vencimiento</th><th></th></tr></thead>
              <tbody>
                {filasSinFechas.length === 0 && <tr><td colSpan={7} className="rv-vacio">Todos los documentos tienen sus fechas completas. ✅</td></tr>}
                {filasSinFechas.map((d) => (
                  <tr key={d.id} className={guardandoId === d.id ? 'rv-fila-guardando' : ''}>
                    <td>{ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen || '—'}</td>
                    <td className="rv-registro">{nombreRegistro(d)}</td>
                    <td className="rv-doc">{d.tipoDocumento}</td>
                    <td><input type="checkbox" checked={d.vence} title="¿Este documento vence?" onChange={(e) => guardarCampo(d, 'vence', e.target.checked)} /></td>
                    {/* ✅ Edición DIRECTA en la tabla: se guarda al elegir la fecha */}
                    <td><input type="date" className={`rv-input-fecha${!d.fechaExpedicion ? ' rv-falta' : ''}`} value={d.fechaExpedicion} onChange={(e) => guardarCampo(d, 'fechaExpedicion', e.target.value)} /></td>
                    <td><input type="date" className={`rv-input-fecha${!d.fechaVencimiento ? ' rv-falta' : ''}`} value={d.fechaVencimiento} disabled={!d.vence} title={d.vence ? '' : 'Marca "Vence" para capturar el vencimiento'} onChange={(e) => guardarCampo(d, 'fechaVencimiento', e.target.value)} /></td>
                    <td className="rv-celda-ver">{guardandoId === d.id && <span className="rv-guardando">⏳</span>}{d.url && <a className="rv-ver" href={d.url} target="_blank" rel="noopener noreferrer" title="Visualizar el documento">Ver</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

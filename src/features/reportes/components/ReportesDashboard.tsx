// src/features/reportes/components/ReportesDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// MÓDULO DE REPORTES (operaciones)
// ═══════════════════════════════════════════════════════════════════════
// Todos los reportes salen de la colección `operaciones`, filtrando por
// `fechaServicio` (YYYY-MM-DD) dentro del rango elegido.
//
// Reportes incluidos:
//   1. Reporte diario de Transfer        (detalle)
//   2. Reporte diario de Logística       (detalle)
//   3. Reporte diario de Fletes          (detalle)
//   4. Operaciones por semana            (matriz por día: Transfer/Cruces/Fletes/Servicios)
//   5. Promedio mensual de operaciones   (matriz por mes + Acumulado + Promedio)
//   6. Resumen por estatus               (bonus)
//   7. Resumen por cliente               (bonus)
//
// Conteo: CRUCES = Logística. SERVICIOS = Transfer + Cruces + Fletes.
//   NO COBRABLES = statusNombre con "cancel" / "no cobrable".
//   TOTAL = Servicios − No cobrables.
//   PROMEDIO MENSUAL = Acumulado ÷ (meses con datos).
//
// Exporta a EXCEL (SheetJS, ya usado en el proyecto) y a PDF (ventana de
// impresión con estilo → "Guardar como PDF"; sin dependencias extra).
//
// Para identificar "no cobrable" se usan palabras clave editables abajo.
// RUTA: src/features/reportes/components/ReportesDashboard.tsx
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';

// Palabras clave (normalizadas) que marcan una operación como NO COBRABLE
const KEYWORDS_NO_COBRABLE = ['cancel', 'no cobrable'];

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const norm = (s: any): string =>
  String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// Parse "YYYY-MM-DD" → Date local (sin corrimiento de zona)
const parseFecha = (f: any): Date | null => {
  const s = String(f || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
const fmtFechaCorta = (f: any): string => {
  const d = parseFecha(f);
  if (!d) return String(f || '-');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtMoneda = (v: any): string =>
  `$ ${(Number(v) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Semana del mes (lunes inicia semana), 1-based — replica la lógica de tu Excel
const semanaDelMes = (d: Date): number => {
  const primero = new Date(d.getFullYear(), d.getMonth(), 1);
  const isoWeekdayPrimero = (primero.getDay() + 6) % 7; // lunes=0 ... domingo=6
  return Math.floor((d.getDate() - 1 + isoWeekdayPrimero) / 7) + 1;
};

interface Columna { key: string; label: string; align?: 'left' | 'right' | 'center'; }
interface ResumenItem { label: string; valor: string; }
interface ReporteResult {
  titulo: string;
  columnas: Columna[];
  filas: any[][];           // valores ya formateados para mostrar/exportar
  resumen?: ResumenItem[];
  weekendFlags?: boolean[]; // por fila (solo reporte semanal): sombrea fin de semana
}

interface Ctx {
  ops: any[];
  desde: string;
  hasta: string;
  clasificarTipo: (op: any) => 'Transfer' | 'Logística' | 'Fletes' | 'Otro';
  esNoCobrable: (op: any) => boolean;
  statusNombreDe: (op: any) => string;
}

export const ReportesDashboard = () => {
  const hoy = new Date();
  const ini = `${hoy.getFullYear()}-01-01`;
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  const [desde, setDesde] = useState(ini);
  const [hasta, setHasta] = useState(hoyStr);
  const [reporteId, setReporteId] = useState('semanal');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ReporteResult | null>(null);

  // Caches de catálogos para resolver tipo/estatus
  const [tiposPorId, setTiposPorId] = useState<Record<string, string>>({});
  const [statusPorId, setStatusPorId] = useState<Record<string, string>>({});

  const cargarCatalogos = async () => {
    if (Object.keys(tiposPorId).length > 0 || Object.keys(statusPorId).length > 0) return;
    try {
      const [tSnap, sSnap] = await Promise.all([
        getDocs(collection(db, 'catalogo_tipo_operacion')),
        getDocs(collection(db, 'catalogo_status_servicio')),
      ]);
      const t: Record<string, string> = {};
      tSnap.docs.forEach(d => { t[d.id] = String((d.data() as any).tipo_operacion || ''); });
      const s: Record<string, string> = {};
      sSnap.docs.forEach(d => { s[d.id] = String((d.data() as any).nombre || ''); });
      setTiposPorId(t);
      setStatusPorId(s);
      return { t, s };
    } catch (e) {
      console.error('Error cargando catálogos de reportes:', e);
      return { t: {}, s: {} };
    }
  };

  // ---------------- Registro de reportes ----------------
  const reportes: { id: string; nombre: string; build: (ctx: Ctx) => ReporteResult }[] = useMemo(() => [
    { id: 'diario_transfer', nombre: 'Reporte diario de Transfer', build: (c) => reporteDetalle(c, 'Transfer') },
    { id: 'diario_logistica', nombre: 'Reporte diario de Logística', build: (c) => reporteDetalle(c, 'Logística') },
    { id: 'diario_fletes', nombre: 'Reporte diario de Fletes', build: (c) => reporteDetalle(c, 'Fletes') },
    { id: 'semanal', nombre: 'Operaciones por semana', build: (c) => reporteSemanal(c) },
    { id: 'mensual', nombre: 'Promedio mensual de operaciones', build: (c) => reporteMensual(c) },
    { id: 'por_estatus', nombre: 'Resumen por estatus', build: (c) => reportePorEstatus(c) },
    { id: 'por_cliente', nombre: 'Resumen por cliente', build: (c) => reportePorCliente(c) },
  ], []);

  // ---------------- Builders ----------------
  function reporteDetalle(c: Ctx, tipo: 'Transfer' | 'Logística' | 'Fletes'): ReporteResult {
    const filtradas = c.ops
      .filter(op => c.clasificarTipo(op) === tipo)
      .sort((a, b) => String(a.fechaServicio || '').localeCompare(String(b.fechaServicio || '')));
    const columnas: Columna[] = [
      { key: 'fecha', label: 'Fecha' },
      { key: 'ref', label: 'Referencia' },
      { key: 'cliente', label: 'Cliente' },
      { key: 'convenio', label: 'Convenio' },
      { key: 'origen', label: 'Origen' },
      { key: 'destino', label: 'Destino' },
      { key: 'status', label: 'Estatus' },
      { key: 'subtotal', label: 'Subtotal', align: 'right' },
      { key: 'utilidad', label: 'Utilidad', align: 'right' },
    ];
    const filas = filtradas.map(op => [
      fmtFechaCorta(op.fechaServicio),
      op.ref || String(op.id || '').substring(0, 6),
      op.clienteNombre || op.nombreCliente || op.clientePaga || '-',
      op.convenioNombre || op.convenio || '-',
      op.origenNombre || op.origen || '-',
      op.destinoNombre || op.destino || '-',
      c.statusNombreDe(op) || '-',
      fmtMoneda(op.subtotalCliente),
      fmtMoneda(op.utilidadEstimada),
    ]);
    const totalSub = filtradas.reduce((s, op) => s + (Number(op.subtotalCliente) || 0), 0);
    const totalUtil = filtradas.reduce((s, op) => s + (Number(op.utilidadEstimada) || 0), 0);
    return {
      titulo: `Reporte diario de ${tipo}`,
      columnas, filas,
      resumen: [
        { label: 'Operaciones', valor: String(filtradas.length) },
        { label: 'Subtotal', valor: fmtMoneda(totalSub) },
        { label: 'Utilidad', valor: fmtMoneda(totalUtil) },
      ],
    };
  }

  function reporteSemanal(c: Ctx): ReporteResult {
    const dDesde = parseFecha(c.desde), dHasta = parseFecha(c.hasta);
    if (!dDesde || !dHasta) return { titulo: 'Operaciones por semana', columnas: [], filas: [] };

    // Conteos por fecha (YYYY-MM-DD) y tipo
    const porFecha: Record<string, { Transfer: number; Logística: number; Fletes: number }> = {};
    c.ops.forEach(op => {
      const f = String(op.fechaServicio || '').slice(0, 10);
      if (!f) return;
      const tipo = c.clasificarTipo(op);
      if (tipo === 'Otro') return;
      (porFecha[f] = porFecha[f] || { Transfer: 0, 'Logística': 0, Fletes: 0 } as any)[tipo]++;
    });

    const columnas: Columna[] = [
      { key: 'mes', label: 'Mes' },
      { key: 'semana', label: 'Semana' },
      { key: 'dia', label: 'Día' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'transfer', label: 'Transfer', align: 'right' },
      { key: 'cruces', label: 'Cruces', align: 'right' },
      { key: 'fletes', label: 'Fletes', align: 'right' },
      { key: 'servicios', label: 'Servicios', align: 'right' },
    ];

    const filas: any[][] = [];
    const weekendFlags: boolean[] = [];
    let tT = 0, tC = 0, tF = 0;

    const cur = new Date(dDesde);
    while (cur <= dHasta) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const cnt = porFecha[key] || { Transfer: 0, 'Logística': 0, Fletes: 0 };
      const serv = cnt.Transfer + cnt['Logística'] + cnt.Fletes;
      tT += cnt.Transfer; tC += cnt['Logística']; tF += cnt.Fletes;
      const dow = cur.getDay();
      filas.push([
        MESES[cur.getMonth()].toUpperCase(),
        `Semana ${semanaDelMes(cur)}`,
        DIAS[dow],
        fmtFechaCorta(key),
        cnt.Transfer || '',
        cnt['Logística'] || '',
        cnt.Fletes || '',
        serv || '',
      ]);
      weekendFlags.push(dow === 0 || dow === 6);
      cur.setDate(cur.getDate() + 1);
    }

    return {
      titulo: 'Operaciones por semana',
      columnas, filas, weekendFlags,
      resumen: [
        { label: 'Transfer', valor: String(tT) },
        { label: 'Cruces', valor: String(tC) },
        { label: 'Fletes', valor: String(tF) },
        { label: 'Servicios', valor: String(tT + tC + tF) },
      ],
    };
  }

  function reporteMensual(c: Ctx): ReporteResult {
    const dDesde = parseFecha(c.desde), dHasta = parseFecha(c.hasta);
    if (!dDesde || !dHasta) return { titulo: 'Promedio mensual de operaciones', columnas: [], filas: [] };

    // Lista de meses del rango (YYYY-MM)
    const claves: string[] = [];
    const cur = new Date(dDesde.getFullYear(), dDesde.getMonth(), 1);
    const fin = new Date(dHasta.getFullYear(), dHasta.getMonth(), 1);
    while (cur <= fin) { claves.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`); cur.setMonth(cur.getMonth() + 1); }

    const acc: Record<string, { Transfer: number; Logística: number; Fletes: number; noCob: number }> = {};
    claves.forEach(k => { acc[k] = { Transfer: 0, 'Logística': 0, Fletes: 0, noCob: 0 }; });
    c.ops.forEach(op => {
      const f = String(op.fechaServicio || '').slice(0, 10);
      const k = f.slice(0, 7);
      if (!acc[k]) return;
      const tipo = c.clasificarTipo(op);
      if (tipo !== 'Otro') acc[k][tipo]++;
      if (c.esNoCobrable(op)) acc[k].noCob++;
    });

    const columnas: Columna[] = [
      { key: 'mes', label: 'Mes' },
      { key: 'transfer', label: 'Transfer', align: 'right' },
      { key: 'cruces', label: 'Cruces', align: 'right' },
      { key: 'fletes', label: 'Fletes', align: 'right' },
      { key: 'servicios', label: 'Servicios', align: 'right' },
      { key: 'noCob', label: 'No Cobrables', align: 'right' },
      { key: 'total', label: 'Total', align: 'right' },
      { key: 'prom', label: 'Prom. diario', align: 'right' },
    ];

    const filas: any[][] = [];
    let aT = 0, aC = 0, aF = 0, aS = 0, aN = 0, aTot = 0;
    let mesesConDatos = 0;

    claves.forEach(k => {
      const [y, m] = k.split('-').map(Number);
      const v = acc[k];
      const serv = v.Transfer + v['Logística'] + v.Fletes;
      const total = serv - v.noCob;
      const dias = new Date(y, m, 0).getDate();
      const prom = dias > 0 ? Math.round(total / dias) : 0;
      const hayDatos = serv > 0 || v.noCob > 0;
      if (hayDatos) mesesConDatos++;
      aT += v.Transfer; aC += v['Logística']; aF += v.Fletes; aS += serv; aN += v.noCob; aTot += total;
      filas.push([`${MESES[m - 1]} ${y}`, v.Transfer, v['Logística'], v.Fletes, serv, v.noCob, total, prom]);
    });

    // Acumulado
    filas.push(['ACUMULADO', aT, aC, aF, aS, aN, aTot, '']);
    // Promedio mensual = acumulado / meses con datos
    const div = mesesConDatos || 1;
    filas.push([
      'PROMEDIO MENSUAL',
      Math.round(aT / div), Math.round(aC / div), Math.round(aF / div),
      Math.round(aS / div), Math.round(aN / div), Math.round(aTot / div), '',
    ]);

    return {
      titulo: 'Promedio mensual de operaciones',
      columnas, filas,
      resumen: [
        { label: 'Servicios', valor: String(aS) },
        { label: 'No cobrables', valor: String(aN) },
        { label: 'Total', valor: String(aTot) },
        { label: 'Meses con datos', valor: String(mesesConDatos) },
      ],
    };
  }

  function reportePorEstatus(c: Ctx): ReporteResult {
    const conteo: Record<string, number> = {};
    c.ops.forEach(op => { const n = c.statusNombreDe(op) || 'Sin status'; conteo[n] = (conteo[n] || 0) + 1; });
    const filas = Object.entries(conteo)
      .sort((a, b) => b[1] - a[1])
      .map(([n, q]) => [n, q]);
    return {
      titulo: 'Resumen por estatus',
      columnas: [{ key: 'status', label: 'Estatus' }, { key: 'cant', label: 'Operaciones', align: 'right' }],
      filas,
      resumen: [{ label: 'Operaciones', valor: String(c.ops.length) }, { label: 'Estatus distintos', valor: String(filas.length) }],
    };
  }

  function reportePorCliente(c: Ctx): ReporteResult {
    const agg: Record<string, { cant: number; sub: number; util: number }> = {};
    c.ops.forEach(op => {
      const cli = op.clienteNombre || op.nombreCliente || op.clientePaga || 'Sin cliente';
      const a = (agg[cli] = agg[cli] || { cant: 0, sub: 0, util: 0 });
      a.cant++; a.sub += Number(op.subtotalCliente) || 0; a.util += Number(op.utilidadEstimada) || 0;
    });
    const filas = Object.entries(agg)
      .sort((a, b) => b[1].cant - a[1].cant)
      .map(([cli, a]) => [cli, a.cant, fmtMoneda(a.sub), fmtMoneda(a.util)]);
    return {
      titulo: 'Resumen por cliente',
      columnas: [
        { key: 'cliente', label: 'Cliente' },
        { key: 'cant', label: 'Operaciones', align: 'right' },
        { key: 'sub', label: 'Subtotal', align: 'right' },
        { key: 'util', label: 'Utilidad', align: 'right' },
      ],
      filas,
      resumen: [{ label: 'Clientes', valor: String(filas.length) }, { label: 'Operaciones', valor: String(c.ops.length) }],
    };
  }

  // ---------------- Generar ----------------
  const generar = async () => {
    if (desde > hasta) { setError('El rango de fechas es inválido (desde > hasta).'); return; }
    setCargando(true); setError(null); setResultado(null);
    try {
      const cat = await cargarCatalogos();
      const tMap = (cat && cat.t) || tiposPorId;
      const sMap = (cat && cat.s) || statusPorId;

      const q = query(
        collection(db, 'operaciones'),
        where('fechaServicio', '>=', desde),
        where('fechaServicio', '<=', hasta),
        orderBy('fechaServicio', 'asc'),
      );
      const snap = await getDocs(q);
      const ops = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

      const tipoTextoDe = (op: any): string => String(op.tipoOperacionNombre || tMap[String(op.tipoOperacionId)] || '');
      const clasificarTipo = (op: any): 'Transfer' | 'Logística' | 'Fletes' | 'Otro' => {
        const t = norm(tipoTextoDe(op));
        if (t.includes('transfer')) return 'Transfer';
        if (t.includes('logist')) return 'Logística';
        if (t.includes('flete')) return 'Fletes';
        return 'Otro';
      };
      const statusNombreDe = (op: any): string => String(op.statusNombre || sMap[String(op.status)] || op.status || '');
      const esNoCobrable = (op: any): boolean => {
        const s = norm(statusNombreDe(op));
        return KEYWORDS_NO_COBRABLE.some(k => s.includes(k));
      };

      const ctx: Ctx = { ops, desde, hasta, clasificarTipo, esNoCobrable, statusNombreDe };
      const def = reportes.find(r => r.id === reporteId) || reportes[0];
      setResultado(def.build(ctx));
      if (ops.length === 0) setError('No hay operaciones en ese rango de fechas.');
    } catch (e: any) {
      console.error('Error generando reporte:', e);
      setError(e?.message || 'Error generando el reporte. ¿Falta un índice en Firestore para fechaServicio?');
    } finally {
      setCargando(false);
    }
  };

  // ---------------- Export ----------------
  const nombreArchivo = () => {
    const base = (resultado?.titulo || 'reporte').replace(/[^a-z0-9]+/gi, '_');
    return `${base}_${desde}_a_${hasta}`;
  };

  const exportarExcel = () => {
    if (!resultado) return;
    const encabezados = resultado.columnas.map(c => c.label);
    const aoa: any[][] = [];
    aoa.push([resultado.titulo]);
    aoa.push([`Del ${fmtFechaCorta(desde)} al ${fmtFechaCorta(hasta)}`]);
    if (resultado.resumen && resultado.resumen.length) aoa.push(resultado.resumen.map(r => `${r.label}: ${r.valor}`));
    aoa.push([]);
    aoa.push(encabezados);
    resultado.filas.forEach(f => aoa.push(f));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
    XLSX.writeFile(wb, `${nombreArchivo()}.xlsx`);
  };

  const exportarPDF = () => {
    if (!resultado) return;
    const cols = resultado.columnas;
    const filasHtml = resultado.filas.map((f, i) => {
      const esTotalRow = typeof f[0] === 'string' && (f[0] === 'ACUMULADO' || f[0] === 'PROMEDIO MENSUAL');
      const weekend = resultado.weekendFlags && resultado.weekendFlags[i];
      const bg = esTotalRow ? '#e8eef7' : (weekend ? '#fff6e5' : (i % 2 ? '#fafbfc' : '#ffffff'));
      const fw = esTotalRow ? 'bold' : 'normal';
      const tds = f.map((v, j) => `<td style="padding:6px 10px;border:1px solid #d0d7de;text-align:${cols[j]?.align || 'left'};font-weight:${fw}">${v === '' || v == null ? '' : String(v)}</td>`).join('');
      return `<tr style="background:${bg}">${tds}</tr>`;
    }).join('');
    const ths = cols.map(c => `<th style="padding:8px 10px;border:1px solid #d0d7de;background:#24292f;color:#fff;text-align:${c.align || 'left'};font-size:11px;text-transform:uppercase;letter-spacing:.3px">${c.label}</th>`).join('');
    const resumenHtml = (resultado.resumen || []).map(r => `<span style="margin-right:18px"><b>${r.label}:</b> ${r.valor}</span>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${resultado.titulo}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328;padding:24px">
  <h1 style="font-size:20px;margin:0 0 4px">${resultado.titulo}</h1>
  <div style="color:#57606a;font-size:13px;margin-bottom:8px">Del ${fmtFechaCorta(desde)} al ${fmtFechaCorta(hasta)} · Roelca Inc.</div>
  <div style="font-size:13px;margin-bottom:14px">${resumenHtml}</div>
  <table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>${ths}</tr></thead><tbody>${filasHtml}</tbody></table>
  <div style="color:#8b949e;font-size:10px;margin-top:14px">Generado el ${new Date().toLocaleString('es-MX')}</div>
  <script>window.onload=function(){window.print();}</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Permite las ventanas emergentes para exportar a PDF.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  // ---------------- UI ----------------
  const inputEstilo: React.CSSProperties = { background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 6, padding: '8px 10px', fontSize: '0.9rem' };
  const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(180deg,#ea580c,#c2410c)', color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' };
  const btnOutline: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: '1px solid #30363d', background: 'transparent', color: '#c9d1d9', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };

  return (
    <div style={{ padding: 24, width: '100%', boxSizing: 'border-box', color: '#c9d1d9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 4px', fontWeight: 'bold' }}>Reportes</h1>
      <p style={{ color: '#8b949e', margin: '0 0 20px', fontSize: '0.92rem' }}>Reportes de operaciones por rango de fechas. Exporta a Excel o PDF.</p>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Lista de reportes */}
        <div style={{ width: 280, flexShrink: 0, background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, padding: 10 }}>
          <div style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', padding: '6px 10px' }}>Reportes</div>
          {reportes.map(r => (
            <button key={r.id} onClick={() => { setReporteId(r.id); setResultado(null); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 4, borderRadius: 8, cursor: 'pointer',
                border: '1px solid ' + (reporteId === r.id ? 'rgba(251,146,60,.4)' : 'transparent'),
                background: reporteId === r.id ? 'rgba(251,146,60,.12)' : 'transparent',
                color: reporteId === r.id ? '#fb923c' : '#c9d1d9', fontSize: '0.9rem', fontWeight: reporteId === r.id ? 600 : 400 }}>
              {r.nombre}
            </button>
          ))}
        </div>

        {/* Panel principal */}
        <div style={{ flex: 1, minWidth: 320 }}>
          <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, padding: 18, marginBottom: 18, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Desde</label>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inputEstilo} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Hasta</label>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inputEstilo} />
            </div>
            <button onClick={generar} disabled={cargando} style={{ ...btnPrimary, opacity: cargando ? 0.6 : 1 }}>
              {cargando ? 'Generando…' : 'Generar reporte'}
            </button>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={exportarExcel} disabled={!resultado} style={{ ...btnOutline, opacity: resultado ? 1 : 0.5 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Excel
              </button>
              <button onClick={exportarPDF} disabled={!resultado} style={{ ...btnOutline, opacity: resultado ? 1 : 0.5 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                PDF
              </button>
            </div>
          </div>

          {error && <div style={{ background: 'rgba(248,81,73,.08)', border: '1px solid rgba(248,81,73,.3)', color: '#ff9b94', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: '0.88rem' }}>{error}</div>}

          {resultado && (
            <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: '1.05rem' }}>{resultado.titulo}</div>
                  <div style={{ color: '#8b949e', fontSize: '0.8rem' }}>Del {fmtFechaCorta(desde)} al {fmtFechaCorta(hasta)}</div>
                </div>
                {resultado.resumen && (
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                    {resultado.resumen.map((r, i) => (
                      <div key={i} style={{ textAlign: 'right' }}>
                        <div style={{ color: '#8b949e', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>{r.label}</div>
                        <div style={{ color: '#fb923c', fontWeight: 700, fontSize: '1.1rem' }}>{r.valor}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr>
                      {resultado.columnas.map(c => (
                        <th key={c.key} style={{ padding: '12px 14px', background: '#161b22', color: '#8b949e', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', textAlign: c.align || 'left', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.filas.length === 0 ? (
                      <tr><td colSpan={resultado.columnas.length} style={{ padding: 30, textAlign: 'center', color: '#8b949e' }}>Sin datos.</td></tr>
                    ) : resultado.filas.map((f, i) => {
                      const esTotalRow = typeof f[0] === 'string' && (f[0] === 'ACUMULADO' || f[0] === 'PROMEDIO MENSUAL');
                      const weekend = resultado.weekendFlags && resultado.weekendFlags[i];
                      const bg = esTotalRow ? '#161b22' : (weekend ? 'rgba(210,153,34,.07)' : 'transparent');
                      return (
                        <tr key={i} style={{ background: bg, borderBottom: '1px solid #21262d' }}>
                          {f.map((v, j) => (
                            <td key={j} style={{ padding: '10px 14px', textAlign: resultado.columnas[j]?.align || 'left', color: esTotalRow ? '#f0f6fc' : '#c9d1d9', fontWeight: esTotalRow ? 700 : 400, whiteSpace: 'nowrap' }}>
                              {v === '' || v == null ? '' : String(v)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!resultado && !error && !cargando && (
            <div style={{ background: '#0d1117', border: '1px dashed #30363d', borderRadius: 12, padding: 40, textAlign: 'center', color: '#6e7681' }}>
              Elige un reporte y un rango de fechas, luego pulsa <b style={{ color: '#fb923c' }}>Generar reporte</b>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportesDashboard;
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
// Export EXCEL con logo + estilo profesional (ExcelJS) y PDF con logo
// (ventana de impresión → "Guardar como PDF"). Ambos muestran el rango.
// Los reportes resuelven IDs → NOMBRES (empresas, convenios, status, tipos).
//
// IMPORTANTE: el export a Excel usa ExcelJS. Instálalo una vez con:
//   npm install exceljs
// RUTA: src/features/reportes/components/ReportesDashboard.tsx
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';
// ✅ Logo de la empresa (mismo base64 que usan los PDF) para ambos exports
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';

// Palabras clave (normalizadas) que marcan una operación como NO COBRABLE
const KEYWORDS_NO_COBRABLE = ['cancel', 'no cobrable'];

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const norm = (s: any): string =>
  String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// ✅ NUEVO: detecta si un valor "parece" un ID (hex de catálogo o auto-id de Firestore),
//   para nunca mostrar IDs crudos cuando no se pudo resolver el nombre.
const esId = (v: any): boolean => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return /^[0-9a-f]{6,}$/i.test(s) || /^[A-Za-z0-9]{18,}$/.test(s);
};

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
  // ✅ NUEVO: resolución de IDs → nombres
  nombreEmpresa: (id: any, desnorm?: any) => string;
  nombreConvenio: (id: any, desnorm?: any) => string;
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

  // Caches de catálogos para resolver tipo/estatus/empresa/convenio
  const [tiposPorId, setTiposPorId] = useState<Record<string, string>>({});
  const [statusPorId, setStatusPorId] = useState<Record<string, string>>({});
  const [empresasPorId, setEmpresasPorId] = useState<Record<string, string>>({});
  const [convenioPorId, setConvenioPorId] = useState<Record<string, string>>({});

  const cargarCatalogos = async () => {
    if (Object.keys(tiposPorId).length > 0 && Object.keys(empresasPorId).length > 0) {
      return { t: tiposPorId, s: statusPorId, emp: empresasPorId, conv: convenioPorId };
    }
    try {
      const [tSnap, sSnap, eSnap, cdSnap, tarSnap] = await Promise.all([
        getDocs(collection(db, 'catalogo_tipo_operacion')),
        getDocs(collection(db, 'catalogo_status_servicio')),
        getDocs(collection(db, 'empresas')),
        getDocs(collection(db, 'convenios_clientes_detalles')),
        getDocs(collection(db, 'catalogo_tarifas_referencia')),
      ]);

      const t: Record<string, string> = {};
      tSnap.docs.forEach(d => { t[d.id] = String((d.data() as any).tipo_operacion || ''); });

      const s: Record<string, string> = {};
      sSnap.docs.forEach(d => { s[d.id] = String((d.data() as any).nombre || ''); });

      const emp: Record<string, string> = {};
      eSnap.docs.forEach(d => { emp[d.id] = String((d.data() as any).nombre || ''); });

      // Mapa de tarifas (para nombrar convenios)
      const tarifas: Record<string, string> = {};
      tarSnap.docs.forEach(d => {
        const data = d.data() as any;
        tarifas[d.id] = String(data.descripcion || data.nombre || '');
      });

      // Convenio (detalle del cliente) → nombre de su tarifa
      const conv: Record<string, string> = {};
      cdSnap.docs.forEach(d => {
        const data = d.data() as any;
        const tarifaId = data.tipoConvenioId || data.tipo_convenio_id || data.tipoConvenio || data.tipo_convenio || data['TIPO DE CONVENIO'];
        const nombre = tarifas[String(tarifaId)] || '';
        if (nombre) conv[d.id] = nombre;
      });

      setTiposPorId(t);
      setStatusPorId(s);
      setEmpresasPorId(emp);
      setConvenioPorId(conv);
      return { t, s, emp, conv };
    } catch (e) {
      console.error('Error cargando catálogos de reportes:', e);
      return { t: tiposPorId, s: statusPorId, emp: empresasPorId, conv: convenioPorId };
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
      c.nombreEmpresa(op.clientePaga || op.clienteId, op.clienteNombre || op.nombreCliente) || '-',
      c.nombreConvenio(op.convenio, op.convenioNombre) || '-',
      c.nombreEmpresa(op.origen, op.origenNombre) || '-',
      c.nombreEmpresa(op.destino, op.destinoNombre) || '-',
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
      const cli = c.nombreEmpresa(op.clientePaga || op.clienteId, op.clienteNombre || op.nombreCliente) || 'Sin cliente';
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
      const empMap = (cat && cat.emp) || empresasPorId;
      const convMap = (cat && cat.conv) || convenioPorId;

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
      const statusNombreDe = (op: any): string => {
        const desnorm = op.statusNombre;
        if (desnorm && !esId(desnorm)) return String(desnorm);
        return String(sMap[String(op.status)] || (esId(op.status) ? '' : (op.status || '')) || '');
      };
      const esNoCobrable = (op: any): boolean => {
        const s = norm(statusNombreDe(op));
        return KEYWORDS_NO_COBRABLE.some(k => s.includes(k));
      };
      // ✅ Resolución de IDs → nombres (nunca devuelve un ID crudo)
      const nombreEmpresa = (id: any, desnorm?: any): string => {
        if (desnorm && !esId(desnorm)) return String(desnorm);
        const k = String(id || '').trim();
        if (empMap[k]) return empMap[k];
        if (k && !esId(k)) return k;
        return '';
      };
      const nombreConvenio = (id: any, desnorm?: any): string => {
        if (desnorm && !esId(desnorm)) return String(desnorm);
        const k = String(id || '').trim();
        if (convMap[k]) return convMap[k];
        if (k && !esId(k)) return k;
        return '';
      };

      const ctx: Ctx = { ops, desde, hasta, clasificarTipo, esNoCobrable, statusNombreDe, nombreEmpresa, nombreConvenio };
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

  // Convierte "$ 1,234.00" → 1234 ; deja el resto igual
  const aNumeroMoneda = (v: any): number | null => {
    if (typeof v !== 'string') return null;
    if (!/^\s*\$\s*-?[\d,]/.test(v)) return null;
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? null : n;
  };

  // ✅ EXCEL profesional con logo (ExcelJS). Requiere: npm install exceljs
  const exportarExcel = async () => {
    if (!resultado) return;
    try {
      const ExcelJS: any = (await import('exceljs')).default || (await import('exceljs'));
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Roelca Inc.';
      wb.created = new Date();
      const ws = wb.addWorksheet('Reporte', { views: [{ showGridLines: false }] });
      const nCols = resultado.columnas.length;

      // Logo (col A, filas superiores)
      try {
        const b64 = LOGO_DEFAULT.includes(',') ? LOGO_DEFAULT.split(',')[1] : LOGO_DEFAULT;
        const imgId = wb.addImage({ base64: b64, extension: 'png' });
        ws.addImage(imgId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 86, height: 86 } });
      } catch (imgErr) { console.warn('No se pudo insertar el logo en Excel:', imgErr); }

      const colTitulo = Math.min(1, nCols - 1); // empieza junto al logo
      const setMerged = (row: number, text: string, font: any) => {
        ws.mergeCells(row, colTitulo + 1, row, nCols);
        const cell = ws.getCell(row, colTitulo + 1);
        cell.value = text;
        cell.font = font;
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      };
      setMerged(1, 'ROELCA INC.', { bold: true, size: 16, color: { argb: 'FFC2410C' } });
      setMerged(2, resultado.titulo, { bold: true, size: 13, color: { argb: 'FF24292F' } });
      setMerged(3, `Del ${fmtFechaCorta(desde)} al ${fmtFechaCorta(hasta)}`, { size: 11, color: { argb: 'FF57606A' } });
      setMerged(4, `Generado: ${new Date().toLocaleString('es-MX')}`, { italic: true, size: 9, color: { argb: 'FF8B949E' } });
      if (resultado.resumen && resultado.resumen.length) {
        setMerged(5, resultado.resumen.map(r => `${r.label}: ${r.valor}`).join('      '), { bold: true, size: 10, color: { argb: 'FF1F2328' } });
      }
      for (let r = 1; r <= 5; r++) ws.getRow(r).height = 19;

      const headerRow = 7;
      const thin = { style: 'thin', color: { argb: 'FFD0D7DE' } };
      const borderAll = { top: thin, left: thin, bottom: thin, right: thin };

      // Encabezados
      resultado.columnas.forEach((col, i) => {
        const cell = ws.getCell(headerRow, i + 1);
        cell.value = col.label;
        cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24292F' } };
        cell.alignment = { horizontal: col.align || 'left', vertical: 'middle' };
        cell.border = borderAll;
      });
      ws.getRow(headerRow).height = 22;

      // Filas de datos
      resultado.filas.forEach((f, ri) => {
        const r = headerRow + 1 + ri;
        const esTotalRow = typeof f[0] === 'string' && (f[0] === 'ACUMULADO' || f[0] === 'PROMEDIO MENSUAL');
        const weekend = resultado.weekendFlags && resultado.weekendFlags[ri];
        f.forEach((v, ci) => {
          const col = resultado.columnas[ci];
          const cell = ws.getCell(r, ci + 1);
          const num = aNumeroMoneda(v);
          if (num !== null) { cell.value = num; cell.numFmt = '"$"#,##0.00'; }
          else { cell.value = (v === '' || v == null) ? null : v; }
          cell.alignment = { horizontal: col?.align || 'left', vertical: 'middle' };
          cell.font = { size: 10, bold: esTotalRow, color: { argb: esTotalRow ? 'FF24292F' : 'FF1F2328' } };
          const fill = esTotalRow
            ? 'FFE8EEF7'
            : (weekend ? 'FFFFF6E5' : (ri % 2 ? 'FFFAFBFC' : 'FFFFFFFF'));
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
          cell.border = borderAll;
        });
      });

      // Ancho de columnas (auto aproximado)
      resultado.columnas.forEach((col, i) => {
        let max = String(col.label).length;
        resultado.filas.forEach(f => { const s = String(f[i] ?? ''); if (s.length > max) max = s.length; });
        ws.getColumn(i + 1).width = Math.min(Math.max(max + 2, 11), 42);
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${nombreArchivo()}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('Error exportando Excel:', e);
      alert('No se pudo exportar a Excel. Asegúrate de instalar la librería con:\n\n   npm install exceljs');
    }
  };

  // ✅ PDF profesional con logo y rango de fechas (ventana de impresión → Guardar como PDF)
  const exportarPDF = () => {
    if (!resultado) return;
    const cols = resultado.columnas;
    const filasHtml = resultado.filas.map((f, i) => {
      const esTotalRow = typeof f[0] === 'string' && (f[0] === 'ACUMULADO' || f[0] === 'PROMEDIO MENSUAL');
      const weekend = resultado.weekendFlags && resultado.weekendFlags[i];
      const bg = esTotalRow ? '#e8eef7' : (weekend ? '#fff6e5' : (i % 2 ? '#f6f8fa' : '#ffffff'));
      const fw = esTotalRow ? '700' : '400';
      const tds = f.map((v, j) => `<td style="padding:7px 11px;border:1px solid #d0d7de;text-align:${cols[j]?.align || 'left'};font-weight:${fw};white-space:nowrap">${v === '' || v == null ? '' : String(v)}</td>`).join('');
      return `<tr style="background:${bg}">${tds}</tr>`;
    }).join('');
    const ths = cols.map(c => `<th style="padding:9px 11px;border:1px solid #24292f;background:#24292f;color:#fff;text-align:${c.align || 'left'};font-size:11px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap">${c.label}</th>`).join('');
    const resumenHtml = (resultado.resumen || []).map(r =>
      `<div style="background:#fff;border:1px solid #e6eaf0;border-radius:8px;padding:8px 14px;min-width:120px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#8a94a6">${r.label}</div>
        <div style="font-size:16px;font-weight:700;color:#c2410c">${r.valor}</div>
      </div>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${resultado.titulo}</title>
<style>@page{margin:14mm} body{margin:0}</style></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2328;padding:24px">
  <div style="display:flex;align-items:center;gap:16px;border-bottom:3px solid #c2410c;padding-bottom:14px;margin-bottom:18px">
    <img src="${LOGO_DEFAULT}" alt="Roelca Inc." style="height:64px;width:auto" />
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#c2410c">ROELCA INC.</div>
      <div style="font-size:22px;font-weight:800;margin:2px 0 2px;color:#1f2328">${resultado.titulo}</div>
      <div style="color:#57606a;font-size:13px">Periodo: <b>${fmtFechaCorta(desde)}</b> al <b>${fmtFechaCorta(hasta)}</b></div>
    </div>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">${resumenHtml}</div>
  <table style="border-collapse:collapse;width:100%;font-size:12px"><thead><tr>${ths}</tr></thead><tbody>${filasHtml}</tbody></table>
  <div style="color:#8b949e;font-size:10px;margin-top:16px;border-top:1px solid #e6eaf0;padding-top:8px">
    Roelca Inc. · Reporte generado el ${new Date().toLocaleString('es-MX')}
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print();},200);}</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Permite las ventanas emergentes para exportar a PDF.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  // ---------------- UI ----------------
  const inputEstilo: React.CSSProperties = { background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 6, padding: '8px 10px', fontSize: '0.9rem' };
  const btnPrimary: React.CSSProperties = { padding: '9px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(180deg,#ea580c,#c2410c)', color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer' };
  const btnOutline: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: '1px solid #30363d', background: 'transparent', color: '#c9d1d9', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };

  const nombreReporteActual = (reportes.find(r => r.id === reporteId) || reportes[0]).nombre;

  return (
    <div style={{ padding: 24, width: '100%', boxSizing: 'border-box', color: '#c9d1d9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 4px', fontWeight: 'bold' }}>Reportes</h1>
      <p style={{ color: '#8b949e', margin: '0 0 20px', fontSize: '0.92rem' }}>Reportes de operaciones por rango de fechas. Exporta a Excel o PDF.</p>

      {/* ✅ Filtros en una sola barra: Reporte (desplegable) + Desde + Hasta + acciones */}
      <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, padding: 18, marginBottom: 18, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 260px', minWidth: 220 }}>
          <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Reporte</label>
          <select value={reporteId} onChange={e => { setReporteId(e.target.value); setResultado(null); setError(null); }} style={{ ...inputEstilo, width: '100%' }}>
            {reportes.map(r => (<option key={r.id} value={r.id}>{r.nombre}</option>))}
          </select>
        </div>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <img src={LOGO_DEFAULT} alt="Roelca Inc." style={{ height: 40, width: 'auto' }} />
              <div>
                <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: '1.05rem' }}>{resultado.titulo}</div>
                <div style={{ color: '#8b949e', fontSize: '0.8rem' }}>Del {fmtFechaCorta(desde)} al {fmtFechaCorta(hasta)}</div>
              </div>
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
          Reporte seleccionado: <b style={{ color: '#fb923c' }}>{nombreReporteActual}</b>. Elige el rango de fechas y pulsa <b style={{ color: '#fb923c' }}>Generar reporte</b>.
        </div>
      )}
    </div>
  );
};

export default ReportesDashboard;
// src/features/estadisticas/components/EstadisticasOperativas.tsx
// ---------------------------------------------------------------------------
// ✅ V00126 — ESTADÍSTICA OPERATIVA (conteo de servicios, SIN montos).
//   Réplica de las hojas operativas del Excel de estadísticas:
//   · Diario:     mes · semana · día · fecha · Transfer · Cruces · Fletes · Servicios
//   · Semanal:    servicios por semana y línea, con promedio y acumulado
//   · Mensual:    servicios por mes y línea, no cobrables, total y promedio
//                 diario + resumen por DÍA DE LA SEMANA (laborados / acumulado / promedio)
//   · Por cliente: conteo por TIPO DE OPERACIÓN (según catálogo) con % por
//                 cliente y % de participación sobre el total
//   · Tipo de operación × C/V: matriz según los catálogos "Tipo de Operación" y
//                 "Cargada / Vacía"
//   Los filtros (línea, tipo de operación, C/V) se alimentan de los CATÁLOGOS.
//   La parte MONETARIA vive en las demás pestañas de EstadisticasDashboard.
// ---------------------------------------------------------------------------
import { Fragment, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { cargarCatalogo, TTL } from '../../../hooks/useCatalogoCache';
import { capitalizar } from './DesgloseJerarquico';
import './EstadisticasOperativas.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc de operación sin tipo canónico (mismo criterio que EstadisticasDashboard).
type Op = any;
type Linea = 'Transfer' | 'Logística' | 'Fletes' | 'Otro';
type SubPestana = 'diario' | 'semanal' | 'mensual' | 'clientes' | 'tipoCv';

interface Props {
  ops: Op[];
  fechaDesde: string;
  fechaHasta: string;
  lineaDeOp: (op: Op) => Linea;
  /** true si la operación NO genera cobro (se resta del TOTAL, como "NO COBRABLES" del Excel). */
  esNoCobrable: (op: Op) => boolean;
  nombreCliente: (op: Op) => string;
  onVerOps?: (titulo: string, ops: Op[]) => void;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const fmtNum = (n: number) => (Number(n) || 0).toLocaleString('en-US');
const fmtPct = (n: number, d: number) => d > 0 ? `${Math.round((n / d) * 100)}%` : '';
const fmtFecha = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const fechaLocal = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
/** Semana del año (lunes a domingo, numeración simple desde el 1 de enero). */
const semanaDe = (iso: string) => {
  const f = fechaLocal(iso);
  const inicio = new Date(f.getFullYear(), 0, 1);
  const offset = (inicio.getDay() + 6) % 7; // lunes = 0
  const dia = Math.floor((f.getTime() - inicio.getTime()) / 86400000);
  return Math.floor((dia + offset) / 7) + 1;
};

/** Grupo de tipo de operación (importación / exportación / movimiento / otros) según el NOMBRE del catálogo. */
const grupoTipoDe = (nombre: string): 'Exportación' | 'Importación' | 'Movimiento' | 'Otros' => {
  const t = norm(nombre);
  if (t.includes('export')) return 'Exportación';
  if (t.includes('import')) return 'Importación';
  if (t.includes('mov')) return 'Movimiento';
  return 'Otros';
};

export function EstadisticasOperativas({ ops, fechaDesde, fechaHasta, lineaDeOp, esNoCobrable, nombreCliente, onVerOps }: Props) {
  const [sub, setSub] = useState<SubPestana>('diario');
  const [catTipos, setCatTipos] = useState<any[]>([]);
  const [catCV, setCatCV] = useState<any[]>([]);
  const filtroLinea: 'Todas' | Linea = 'Todas';
  const [filtroTipos, setFiltroTipos] = useState<string[]>([]);
  const [filtroCV, setFiltroCV] = useState<string>('Todas');

  useEffect(() => {
    cargarCatalogo('catalogo_tipo_operacion', { ttlMs: TTL.MEDIO }).then(setCatTipos).catch(() => {});
    cargarCatalogo('catalogo_carga_vacia', { ttlMs: TTL.MEDIO }).then(setCatCV).catch(() => {});
  }, []);

  const tipoDe = (op: Op) => String(op.tipoOperacionNombre || op.tipoOperacion || '').trim() || 'Sin tipo';
  const cvDe = (op: Op) => String(op.carga || op.estadoCarga || op.cargaVacia || '').trim() || 'N/A';

  // Opciones de filtro: catálogo ∪ valores presentes en las operaciones (por si hay nombres viejos)
  const opcionesTipo = useMemo(() => {
    const set = new Map<string, string>();
    catTipos.forEach((t: any) => { const n = String(t.tipo_operacion || t.nombre || '').trim(); if (n) set.set(norm(n), n); });
    ops.forEach((op) => { const n = tipoDe(op); if (n && !set.has(norm(n))) set.set(norm(n), n); });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, 'es'));
  }, [catTipos, ops]);
  const opcionesCV = useMemo(() => {
    const set = new Map<string, string>();
    catCV.forEach((c: any) => { const n = String(c.nombre || c.estado_carga || '').trim(); if (n) set.set(norm(n), n); });
    ops.forEach((op) => { const n = cvDe(op); if (n && !set.has(norm(n))) set.set(norm(n), n); });
    return Array.from(set.values());
  }, [catCV, ops]);

  const opsFiltradas = useMemo(() => ops.filter((op) =>
    (filtroLinea === 'Todas' || lineaDeOp(op) === filtroLinea) &&
    (filtroTipos.length === 0 || filtroTipos.some((t) => norm(t) === norm(tipoDe(op)))) &&
    (filtroCV === 'Todas' || norm(cvDe(op)) === norm(filtroCV))
  ), [ops, filtroLinea, filtroTipos, filtroCV, lineaDeOp]);

  const contar = (lista: Op[]) => {
    const r = { transfer: 0, cruces: 0, fletes: 0, otros: 0, servicios: 0, noCobrables: 0, ops: lista };
    lista.forEach((op) => {
      const l = lineaDeOp(op);
      if (l === 'Transfer') r.transfer++; else if (l === 'Logística') r.cruces++; else if (l === 'Fletes') r.fletes++; else r.otros++;
      r.servicios++;
      if (esNoCobrable(op)) r.noCobrables++;
    });
    return r;
  };

  // ── DIARIO: todos los días del rango (aunque no tengan servicios), como el Excel ──
  const diario = useMemo(() => {
    const porDia = new Map<string, Op[]>();
    opsFiltradas.forEach((op) => { const f = String(op.fechaServicio || '').slice(0, 10); if (f) (porDia.get(f) || porDia.set(f, []).get(f)!).push(op); });
    const filas: any[] = [];
    const ini = fechaLocal(fechaDesde), fin = fechaLocal(fechaHasta);
    for (let d = new Date(ini); d <= fin; d.setDate(d.getDate() + 1)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const c = contar(porDia.get(iso) || []);
      filas.push({ iso, mes: MESES[d.getMonth()], semana: semanaDe(iso), dia: DIAS[d.getDay()], diaNum: d.getDay(), ...c });
    }
    const total = contar(opsFiltradas);
    const diasConServicio = filas.filter((f) => f.servicios > 0).length;
    const maxServ = Math.max(0, ...filas.map((f) => f.servicios));
    return { filas, total, diasConServicio, umbralAlto: maxServ > 0 ? Math.max(1, Math.round(maxServ * 0.85)) : Infinity };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsFiltradas, fechaDesde, fechaHasta]);

  // ── SEMANAL ──
  const semanal = useMemo(() => {
    const m = new Map<number, Op[]>();
    opsFiltradas.forEach((op) => { const f = String(op.fechaServicio || '').slice(0, 10); if (!f) return; const s = semanaDe(f); (m.get(s) || m.set(s, []).get(s)!).push(op); });
    const semanas = Array.from(m.keys()).sort((a, b) => a - b);
    const filas = semanas.map((s) => ({ semana: s, ...contar(m.get(s)!) }));
    const total = contar(opsFiltradas);
    const n = filas.length || 1;
    const prom = { transfer: total.transfer / n, cruces: total.cruces / n, fletes: total.fletes / n, servicios: total.servicios / n };
    const maxServ = Math.max(0, ...filas.map((f) => f.servicios));
    return { filas, total, prom, umbralAlto: maxServ > 0 ? Math.max(1, Math.round(maxServ * 0.85)) : Infinity };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsFiltradas]);

  // ── MENSUAL + DÍA DE LA SEMANA ──
  const mensual = useMemo(() => {
    const porMes: Op[][] = Array.from({ length: 12 }, () => []);
    const porDiaSem: Map<number, Set<string>> = new Map();
    const opsDiaSem: Op[][] = Array.from({ length: 7 }, () => []);
    opsFiltradas.forEach((op) => {
      const f = String(op.fechaServicio || '').slice(0, 10); if (!f) return;
      const d = fechaLocal(f);
      porMes[d.getMonth()].push(op);
      opsDiaSem[d.getDay()].push(op);
      (porDiaSem.get(d.getDay()) || porDiaSem.set(d.getDay(), new Set()).get(d.getDay())!).add(f);
    });
    const diasLaboradosMes = (mes: number) => new Set(porMes[mes].map((op) => String(op.fechaServicio || '').slice(0, 10))).size;
    const filas = porMes.map((lista, i) => {
      const c = contar(lista); const dias = diasLaboradosMes(i);
      // Excel: PROMEDIO = TOTAL ÷ días laborados (en la hoja está fijo en 23; aquí se usan los días reales del mes)
      return { mes: MESES[i], ...c, total: c.servicios - c.noCobrables, promedio: dias > 0 ? Math.round((c.servicios - c.noCobrables) / dias) : 0, dias };
    });
    const conDatos = filas.filter((f) => f.servicios > 0);
    const acum = contar(opsFiltradas);
    const n = conDatos.length || 1;
    const prom = { transfer: Math.round(acum.transfer / n), cruces: Math.round(acum.cruces / n), fletes: Math.round(acum.fletes / n), servicios: Math.round(acum.servicios / n), noCobrables: Math.round(acum.noCobrables / n), total: Math.round((acum.servicios - acum.noCobrables) / n), promedio: Math.round(conDatos.reduce((s, f) => s + f.promedio, 0) / n) };
    // Excel: LABORADOS = cuántos lunes/martes/… hay en el periodo (días calendario), ACUM = servicios de ese día, PROMEDIO = ACUM ÷ LABORADOS
    const diasCalendario: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (let d = fechaLocal(fechaDesde), fin = fechaLocal(fechaHasta); d <= fin; d.setDate(d.getDate() + 1)) diasCalendario[d.getDay()]++;
    void porDiaSem;
    const porDia = ORDEN_DIAS.map((d) => { const lab = diasCalendario[d]; const ac = opsDiaSem[d].length; return { dia: DIAS[d], laborados: lab, acumulado: ac, promedio: lab > 0 ? Math.round(ac / lab) : 0, ops: opsDiaSem[d] }; });
    const totDia = { laborados: porDia.reduce((s, f) => s + f.laborados, 0), acumulado: acum.servicios, promedio: Math.round(porDia.reduce((s, f) => s + f.promedio, 0) / (porDia.filter((f) => f.laborados > 0).length || 1)) };
    return { filas, acum: { ...acum, total: acum.servicios - acum.noCobrables, promedio: Math.round(conDatos.reduce((s, f) => s + f.promedio, 0) / n) }, prom, porDia, totDia };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsFiltradas, fechaDesde, fechaHasta]);

  // ── POR CLIENTE × grupo de tipo de operación ──
  const clientes = useMemo(() => {
    const m = new Map<string, Op[]>();
    opsFiltradas.forEach((op) => { const c = nombreCliente(op) || 'Sin cliente'; (m.get(c) || m.set(c, []).get(c)!).push(op); });
    const grupos = ['Exportación', 'Importación', 'Movimiento', 'Otros'] as const;
    const esInterno = (c: string) => norm(c).includes('roelca');
    const filas = Array.from(m.entries()).map(([cliente, lista]) => {
      const conteo: Record<string, number> = { Exportación: 0, Importación: 0, Movimiento: 0, Otros: 0 };
      lista.forEach((op) => { conteo[grupoTipoDe(tipoDe(op))]++; });
      return { cliente, total: lista.length, conteo, ops: lista, interno: esInterno(cliente) };
    }).sort((a, b) => (Number(a.interno) - Number(b.interno)) || (b.total - a.total));
    const totales: Record<string, number> = { Exportación: 0, Importación: 0, Movimiento: 0, Otros: 0 };
    const totalesExternos: Record<string, number> = { Exportación: 0, Importación: 0, Movimiento: 0, Otros: 0 };
    filas.forEach((f) => grupos.forEach((g) => { totales[g] += f.conteo[g]; if (!f.interno) totalesExternos[g] += f.conteo[g]; }));
    const granTotal = opsFiltradas.length;
    // Excel: la base del "OPERACIÓN %" excluye a las empresas del grupo (Roelca), que van al final en rojo
    const baseExterna = filas.filter((f) => !f.interno).reduce((s, f) => s + f.total, 0);
    return { filas, totales, totalesExternos, granTotal, baseExterna, grupos };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsFiltradas]);

  // ── TIPO DE OPERACIÓN × C/V ──
  const tipoCv = useMemo(() => {
    const cvs = opcionesCV.length ? opcionesCV : ['N/A'];
    const m = new Map<string, Record<string, Op[]>>();
    opsFiltradas.forEach((op) => {
      const t = tipoDe(op); const cv = cvDe(op);
      if (!m.has(t)) m.set(t, {});
      const fila = m.get(t)!; (fila[cv] = fila[cv] || []).push(op);
    });
    const filas = Array.from(m.entries()).map(([tipo, porCv]) => ({ tipo, grupo: grupoTipoDe(tipo), linea: lineaDeOp({ tipoOperacionNombre: tipo }), porCv, total: Object.values(porCv).reduce((s, l) => s + l.length, 0) })).sort((a, b) => b.total - a.total);
    const totCv: Record<string, number> = {}; cvs.forEach((cv) => { totCv[cv] = filas.reduce((s, f) => s + (f.porCv[cv]?.length || 0), 0); });
    return { cvs, filas, totCv, granTotal: opsFiltradas.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsFiltradas, opcionesCV]);

  // ── EXPORTAR (sub-pestaña activa) ──
  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    const hoja = (nombre: string, aoa: (string | number)[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nombre.slice(0, 31));
    if (sub === 'diario') hoja('Diario', [['MES', 'SEMANA', 'DÍA', 'FECHA', 'TRANSFER', 'CRUCES', 'FLETES', 'SERVICIOS'], ...diario.filas.map((f) => [f.mes, `SEMANA ${f.semana}`, f.dia, fmtFecha(f.iso), f.transfer, f.cruces, f.fletes, f.servicios]), ['ACUMULADO', '', '', '', diario.total.transfer, diario.total.cruces, diario.total.fletes, diario.total.servicios]]);
    if (sub === 'semanal') hoja('Semanal', [['SEMANA', 'TRANSFER', 'CRUCES', 'FLETES', 'SERVICIOS'], ...semanal.filas.map((f) => [`SEMANA ${f.semana}`, f.transfer, f.cruces, f.fletes, f.servicios]), ['PROMEDIO', Math.round(semanal.prom.transfer), Math.round(semanal.prom.cruces), Math.round(semanal.prom.fletes), Math.round(semanal.prom.servicios)], ['ACUMULADO', semanal.total.transfer, semanal.total.cruces, semanal.total.fletes, semanal.total.servicios]]);
    if (sub === 'mensual') { hoja('Mensual', [['MES', 'TRANSFER', 'CRUCES', 'FLETES', 'SERVICIOS', 'NO COBRABLES', 'TOTAL', 'PROMEDIO'], ...mensual.filas.map((f) => [f.mes.toUpperCase(), f.transfer, f.cruces, f.fletes, f.servicios, f.noCobrables, f.total, f.promedio]), ['ACUMULADO', mensual.acum.transfer, mensual.acum.cruces, mensual.acum.fletes, mensual.acum.servicios, mensual.acum.noCobrables, mensual.acum.total, mensual.acum.promedio]]); hoja('Día de la semana', [['DÍA', 'LABORADOS', 'ACUM', 'PROMEDIO'], ...mensual.porDia.map((f) => [f.dia.toUpperCase(), f.laborados, f.acumulado, f.promedio]), ['TOTAL', mensual.totDia.laborados, mensual.totDia.acumulado, mensual.totDia.promedio]]); }
    if (sub === 'clientes') hoja('Por cliente', [['CLIENTE', ...clientes.grupos.flatMap((g) => [g.toUpperCase(), '%']), 'OPERACIÓN %'], ...clientes.filas.map((f) => [f.cliente, ...clientes.grupos.flatMap((g) => [f.conteo[g] || '', fmtPct(f.conteo[g], f.total)]), clientes.baseExterna > 0 ? `${((f.total / clientes.baseExterna) * 100).toFixed(2)}%` : '']), ['ACUMULADO', ...clientes.grupos.flatMap((g) => [clientes.totales[g], fmtPct(clientes.totales[g], clientes.granTotal)]), '']]);
    if (sub === 'tipoCv') hoja('Tipo x CV', [['TIPO DE OPERACIÓN', 'LÍNEA', ...tipoCv.cvs.map((c) => c.toUpperCase()), 'TOTAL'], ...tipoCv.filas.map((f) => [f.tipo, f.linea, ...tipoCv.cvs.map((c) => f.porCv[c]?.length || 0), f.total]), ['TOTAL', '', ...tipoCv.cvs.map((c) => tipoCv.totCv[c]), tipoCv.granTotal]]);
    XLSX.writeFile(wb, `Estadistica_Operativa_${sub}_${fechaDesde}_${fechaHasta}.xlsx`);
  };

  const ver = (titulo: string, lista: Op[]) => { if (onVerOps && lista.length) onVerOps(titulo, lista); };
  const celda = (n: number, titulo: string, lista: Op[], alto = false) => (
    <td className={`eo-num${alto ? ' eo-alto' : ''}${n > 0 && onVerOps ? ' eo-click' : ''}`} onClick={() => ver(titulo, lista)}>{n > 0 ? fmtNum(n) : ''}</td>
  );
  const opsDe = (lista: Op[], l: Linea) => lista.filter((o) => lineaDeOp(o) === l);

  return (
    <div className="eo-contenedor">
      {/* Filtros alimentados por los catálogos */}
      <div className="eo-filtros">
        {/* ✅ V00126: se retiró el filtro de Línea (las columnas Transfer/Cruces/Fletes ya la desglosan) */}
        <div className="eo-filtro">
          <span className="eo-etq">Tipo de operación</span>
          <button className={`eo-chip${filtroTipos.length === 0 ? ' activo' : ''}`} onClick={() => setFiltroTipos([])}>Todos</button>
          {opcionesTipo.map((t) => (
            <button key={t} className={`eo-chip${filtroTipos.includes(t) ? ' activo' : ''}`} onClick={() => setFiltroTipos((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}>{capitalizar(t)}</button>
          ))}
        </div>
        <div className="eo-filtro">
          <span className="eo-etq">Cargada / vacía</span>
          <button className={`eo-chip${filtroCV === 'Todas' ? ' activo' : ''}`} onClick={() => setFiltroCV('Todas')}>Todas</button>
          {opcionesCV.map((c) => (
            <button key={c} className={`eo-chip${filtroCV === c ? ' activo' : ''}`} onClick={() => setFiltroCV(c)}>{capitalizar(c)}</button>
          ))}
        </div>
      </div>

      <div className="eo-barra">
        <div className="eo-subtabs">
          {([['diario', 'Diario'], ['semanal', 'Semanal'], ['mensual', 'Mensual'], ['clientes', 'Por cliente'], ['tipoCv', 'Tipo de operación × C/V']] as const).map(([k, l]) => (
            <button key={k} className={`eo-subtab${sub === k ? ' activa' : ''}`} onClick={() => setSub(k)}>{l}</button>
          ))}
        </div>
        <div className="eo-resumen">
          <span><b>{fmtNum(opsFiltradas.length)}</b> servicios</span>
          <span className="eo-t">Transfer <b>{fmtNum(diario.total.transfer)}</b></span>
          <span className="eo-c">Cruces <b>{fmtNum(diario.total.cruces)}</b></span>
          <span className="eo-f">Fletes <b>{fmtNum(diario.total.fletes)}</b></span>
          {diario.total.otros > 0 && <span>Otros <b>{fmtNum(diario.total.otros)}</b></span>}
          <button className="est-btn" onClick={exportarExcel} disabled={opsFiltradas.length === 0}><Download size={14} /> Excel</button>
        </div>
      </div>

      {sub === 'diario' && (
        <div className="eo-tabla-wrap">
          <table className="eo-tabla">
            <thead>
              <tr className="eo-fila-acum"><th colSpan={4}>Acumulado</th><th>{fmtNum(diario.total.transfer)}</th><th>{fmtNum(diario.total.cruces)}</th><th>{fmtNum(diario.total.fletes)}</th><th>{fmtNum(diario.total.servicios)}</th></tr>
              <tr><th>Mes</th><th>Semana</th><th>Día</th><th>Fecha</th><th>Transfer</th><th>Cruces</th><th>Fletes</th><th>Servicios</th></tr>
            </thead>
            <tbody>
              {diario.filas.map((f) => (
                <tr key={f.iso} className={f.diaNum === 0 ? 'eo-domingo' : f.diaNum === 6 ? 'eo-sabado' : ''}>
                  <td>{capitalizar(f.mes)}</td><td>Semana {f.semana}</td><td>{capitalizar(f.dia)}</td><td className="eo-mono">{fmtFecha(f.iso)}</td>
                  {celda(f.transfer, `Transfer · ${fmtFecha(f.iso)}`, opsDe(f.ops, 'Transfer'))}
                  {celda(f.cruces, `Cruces · ${fmtFecha(f.iso)}`, opsDe(f.ops, 'Logística'))}
                  {celda(f.fletes, `Fletes · ${fmtFecha(f.iso)}`, opsDe(f.ops, 'Fletes'))}
                  {celda(f.servicios, `Servicios · ${fmtFecha(f.iso)}`, f.ops, f.servicios >= diario.umbralAlto)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'semanal' && (
        <div className="eo-tabla-wrap">
          <table className="eo-tabla eo-compacta">
            <thead>
              <tr className="eo-fila-acum"><th>Promedio</th><th>{fmtNum(Math.round(semanal.prom.transfer))}</th><th>{fmtNum(Math.round(semanal.prom.cruces))}</th><th>{fmtNum(Math.round(semanal.prom.fletes))}</th><th>{fmtNum(Math.round(semanal.prom.servicios))}</th></tr>
              <tr className="eo-fila-acum"><th>Acumulado</th><th>{fmtNum(semanal.total.transfer)}</th><th>{fmtNum(semanal.total.cruces)}</th><th>{fmtNum(semanal.total.fletes)}</th><th>{fmtNum(semanal.total.servicios)}</th></tr>
              <tr><th>Semana</th><th>Transfer</th><th>Cruces</th><th>Fletes</th><th>Servicios</th></tr>
            </thead>
            <tbody>
              {semanal.filas.map((f) => (
                <tr key={f.semana}>
                  <td>Semana {f.semana}</td>
                  {celda(f.transfer, `Transfer · Semana ${f.semana}`, opsDe(f.ops, 'Transfer'))}
                  {celda(f.cruces, `Cruces · Semana ${f.semana}`, opsDe(f.ops, 'Logística'))}
                  {celda(f.fletes, `Fletes · Semana ${f.semana}`, opsDe(f.ops, 'Fletes'))}
                  {celda(f.servicios, `Servicios · Semana ${f.semana}`, f.ops, f.servicios >= semanal.umbralAlto)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'mensual' && (
        <div className="eo-dos-col">
          <div className="eo-tabla-wrap">
            <table className="eo-tabla eo-compacta">
              <thead>
                <tr className="eo-fila-acum"><th>Promedio mensual</th><th>{fmtNum(mensual.prom.transfer)}</th><th>{fmtNum(mensual.prom.cruces)}</th><th>{fmtNum(mensual.prom.fletes)}</th><th>{fmtNum(mensual.prom.servicios)}</th><th className="eo-rojo">{fmtNum(mensual.prom.noCobrables)}</th><th>{fmtNum(mensual.prom.total)}</th><th>{fmtNum(mensual.prom.promedio)}</th></tr>
                <tr><th>Mes</th><th>Transfer</th><th>Cruces</th><th>Fletes</th><th>Servicios</th><th className="eo-rojo">No cobrables</th><th>Total</th><th>Promedio</th></tr>
              </thead>
              <tbody>
                {mensual.filas.map((f) => (
                  <tr key={f.mes} className={f.servicios === 0 ? 'eo-vacia' : ''}>
                    <td className="eo-mes">{capitalizar(f.mes)}</td>
                    {celda(f.transfer, `Transfer · ${f.mes}`, opsDe(f.ops, 'Transfer'))}
                    {celda(f.cruces, `Cruces · ${f.mes}`, opsDe(f.ops, 'Logística'))}
                    {celda(f.fletes, `Fletes · ${f.mes}`, opsDe(f.ops, 'Fletes'))}
                    {celda(f.servicios, `Servicios · ${f.mes}`, f.ops)}
                    <td className={`eo-num eo-rojo${f.noCobrables > 0 && onVerOps ? ' eo-click' : ''}`} onClick={() => ver(`No cobrables · ${f.mes}`, f.ops.filter(esNoCobrable))}>{f.noCobrables > 0 ? fmtNum(f.noCobrables) : ''}</td>
                    <td className="eo-num">{f.servicios > 0 ? fmtNum(f.total) : ''}</td>
                    <td className="eo-num">{f.servicios > 0 ? fmtNum(f.promedio) : ''}</td>
                  </tr>
                ))}
                <tr className="eo-fila-acum"><td>Acumulado</td><td className="eo-num">{fmtNum(mensual.acum.transfer)}</td><td className="eo-num">{fmtNum(mensual.acum.cruces)}</td><td className="eo-num">{fmtNum(mensual.acum.fletes)}</td><td className="eo-num">{fmtNum(mensual.acum.servicios)}</td><td className="eo-num eo-rojo">{fmtNum(mensual.acum.noCobrables)}</td><td className="eo-num">{fmtNum(mensual.acum.total)}</td><td className="eo-num">{fmtNum(mensual.acum.promedio)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="eo-tabla-wrap">
            <table className="eo-tabla eo-compacta">
              <thead>
                <tr className="eo-fila-acum"><th></th><th>{fmtNum(mensual.totDia.laborados)}</th><th>{fmtNum(mensual.totDia.acumulado)}</th><th>{fmtNum(mensual.totDia.promedio)}</th></tr>
                <tr><th>Día</th><th>Laborados</th><th>Acumulado</th><th>Promedio</th></tr>
              </thead>
              <tbody>
                {mensual.porDia.map((f) => (
                  <tr key={f.dia}><td>{capitalizar(f.dia)}</td><td className="eo-num">{fmtNum(f.laborados)}</td>{celda(f.acumulado, `Servicios · ${f.dia}`, f.ops)}<td className="eo-num">{fmtNum(f.promedio)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="eo-nota">Laborados = días distintos con al menos un servicio. Promedio = acumulado ÷ laborados. No cobrables = servicios sin importe al cliente.</p>
          </div>
        </div>
      )}

      {sub === 'clientes' && (
        <div className="eo-tabla-wrap">
          <table className="eo-tabla eo-compacta">
            <thead>
              <tr className="eo-fila-acum"><th>Sin grupo Roelca</th>{clientes.grupos.map((g) => (<Fragment key={g}><th>{fmtNum(clientes.totalesExternos[g])}</th><th>{fmtPct(clientes.totalesExternos[g], clientes.baseExterna)}</th></Fragment>))}<th>{fmtNum(clientes.baseExterna)}</th></tr>
              <tr className="eo-fila-acum"><th>Acumulado</th>{clientes.grupos.map((g) => (<Fragment key={g}><th>{fmtNum(clientes.totales[g])}</th><th>{fmtPct(clientes.totales[g], clientes.granTotal)}</th></Fragment>))}<th>{fmtNum(clientes.granTotal)}</th></tr>
              <tr><th>Cliente</th>{clientes.grupos.map((g) => (<Fragment key={g}><th>{g}</th><th>%</th></Fragment>))}<th>Operación %</th></tr>
            </thead>
            <tbody>
              {clientes.filas.map((f) => (
                <tr key={f.cliente} className={f.interno ? 'eo-interno' : ''}>
                  <td className="eo-cliente eo-click" onClick={() => ver(f.cliente, f.ops)}>{capitalizar(f.cliente)}</td>
                  {clientes.grupos.map((g) => (<Fragment key={g}>{celda(f.conteo[g], `${f.cliente} · ${g}`, f.ops.filter((o) => grupoTipoDe(tipoDe(o)) === g))}<td className="eo-num eo-pct">{fmtPct(f.conteo[g], f.total)}</td></Fragment>))}
                  <td className="eo-num eo-pct-total">{clientes.baseExterna > 0 ? `${((f.total / clientes.baseExterna) * 100).toFixed(2)}%` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'tipoCv' && (
        <div className="eo-tabla-wrap">
          <table className="eo-tabla eo-compacta">
            <thead>
              <tr><th>Tipo de operación</th><th>Grupo</th><th>Línea</th>{tipoCv.cvs.map((c) => <th key={c}>{capitalizar(c)}</th>)}<th>Total</th><th>%</th></tr>
            </thead>
            <tbody>
              {tipoCv.filas.map((f) => (
                <tr key={f.tipo}>
                  <td className="eo-cliente">{capitalizar(f.tipo)}</td><td>{f.grupo}</td><td>{f.linea}</td>
                  {tipoCv.cvs.map((c) => celda(f.porCv[c]?.length || 0, `${f.tipo} · ${c}`, f.porCv[c] || []))}
                  <td className="eo-num"><b>{fmtNum(f.total)}</b></td><td className="eo-num eo-pct">{fmtPct(f.total, tipoCv.granTotal)}</td>
                </tr>
              ))}
              <tr className="eo-fila-acum"><td>Total</td><td></td><td></td>{tipoCv.cvs.map((c) => <td key={c} className="eo-num">{fmtNum(tipoCv.totCv[c])}</td>)}<td className="eo-num">{fmtNum(tipoCv.granTotal)}</td><td className="eo-num">100%</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

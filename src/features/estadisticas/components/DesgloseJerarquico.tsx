// src/features/estadisticas/components/DesgloseJerarquico.tsx
// ---------------------------------------------------------------------------
// ✅ V00126 — DESGLOSE JERÁRQUICO (Operaciones y Facturación)
//   Dimensiones (todas del Excel de estadísticas): Tipo de Operación, C/V,
//   Exportación/Importación/Movimiento, Cliente, Operador, Unidad propia,
//   Proveedor de transporte. Cualquier dimensión puede ser el nivel raíz y se
//   desglosa en dos sub-niveles elegibles (▸). Ordenado de mayor a menor con %.
//   · Operaciones:  servicios.
//   · Facturación:  Pesos, Dólares, Venta total en MXN, Costo proveedor,
//                   Utilidad y margen — con filtro Pesos / Dólares.
//   · "Ver por mes": matriz dimensión × mes (como UNIDAD×MES / PROVEEDOR×MES
//     de las hojas E S TRANSFER / E S CRUCES).
//   Cada nombre es clic → resumen ejecutivo de esas operaciones.
// ---------------------------------------------------------------------------
import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import * as XLSX from 'xlsx';
import { ChevronDown, ChevronRight, Download, CalendarDays, Layers } from 'lucide-react';
import './DesgloseJerarquico.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Op = any;
type Modo = 'operaciones' | 'facturacion';
export type Dimension = 'tipo' | 'cv' | 'movimiento' | 'cliente' | 'operador' | 'unidad' | 'proveedor';
type Moneda = 'ambas' | 'MXN' | 'USD';

interface Props {
  ops: Op[];
  modo: Modo;
  montoDe: (op: Op) => { dol: number; pes: number; conv: number };
  costoDe: (op: Op) => number;
  monedaDe: (op: Op) => 'USD' | 'MXN' | 'Mixta' | 'Sin dato';
  /** Etiqueta de cada dimensión para una operación (ya resuelta contra catálogos por el dashboard). */
  etiquetaDe: (op: Op, d: Dimension) => string;
  onVerOps?: (titulo: string, ops: Op[]) => void;
}

const DIMENSIONES: Dimension[] = ['tipo', 'cv', 'movimiento', 'cliente', 'operador', 'unidad', 'proveedor'];
const ETQ: Record<Dimension, string> = {
  tipo: 'Tipo de operación', cv: 'C/V (cargada / vacía)', movimiento: 'Exportación / Importación / Movimiento',
  cliente: 'Cliente', operador: 'Operador', unidad: 'Unidad propia', proveedor: 'Proveedor de transporte',
};
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const fmtNum = (n: number) => (Number(n) || 0).toLocaleString('en-US');
const fmtMoney = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(2)}%` : '';
/** ✅ Primera letra mayúscula y el resto en minúsculas (también tras espacio, paréntesis, "/" o "-"). */
export const capitalizar = (t: string) => String(t || '').trim().toLowerCase().replace(/(^|[\s(/-])([a-záéíóúñü])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());

interface Agregado { clave: string; ops: Op[]; n: number; pes: number; dol: number; conv: number; costo: number; meses: number[]; }

export function DesgloseJerarquico({ ops, modo, montoDe, costoDe, monedaDe, etiquetaDe, onVerOps }: Props) {
  const [raizDim, setRaizDim] = useState<Dimension>('tipo');
  const [sub1, setSub1] = useState<Dimension>('cv');
  const [sub2, setSub2] = useState<Dimension>('movimiento');
  const [moneda, setMoneda] = useState<Moneda>('ambas');
  const [verMeses, setVerMeses] = useState(false);
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const esFact = modo === 'facturacion';

  const cambiarRaiz = (d: Dimension) => {
    setRaizDim(d); setAbiertas({});
    const resto = DIMENSIONES.filter((x) => x !== d);
    const s1 = sub1 === d ? resto[0] : sub1;
    const s2 = (sub2 === d || sub2 === s1) ? (resto.find((x) => x !== s1) || resto[1]) : sub2;
    setSub1(s1); setSub2(s2);
  };

  const opsMoneda = useMemo(() => moneda === 'ambas' ? ops : ops.filter((op) => monedaDe(op) === moneda), [ops, moneda, monedaDe]);

  const agrupar = (lista: Op[], d: Dimension): Agregado[] => {
    const m = new Map<string, Agregado>();
    lista.forEach((op) => {
      const k = capitalizar(etiquetaDe(op, d) || 'Sin dato');
      const a: Agregado = m.get(k) || { clave: k, ops: [] as Op[], n: 0, pes: 0, dol: 0, conv: 0, costo: 0, meses: Array(12).fill(0) as number[] };
      const mo = montoDe(op);
      const mes = parseInt(String(op.fechaServicio || '').slice(5, 7), 10) - 1;
      a.ops.push(op); a.n++; a.pes += mo.pes; a.dol += mo.dol; a.conv += mo.conv; a.costo += costoDe(op);
      if (mes >= 0 && mes < 12) a.meses[mes] += esFact ? mo.conv : 1;
      m.set(k, a);
    });
    return Array.from(m.values()).sort((a, b) => esFact ? (b.conv - a.conv) || (b.n - a.n) : (b.n - a.n) || (b.conv - a.conv));
  };

  const raiz = useMemo(() => agrupar(opsMoneda, raizDim), [opsMoneda, raizDim]); // eslint-disable-line react-hooks/exhaustive-deps
  const totales = useMemo(() => raiz.reduce((s, a) => ({ n: s.n + a.n, pes: s.pes + a.pes, dol: s.dol + a.dol, conv: s.conv + a.conv, costo: s.costo + a.costo, meses: s.meses.map((v, i) => v + a.meses[i]) }), { n: 0, pes: 0, dol: 0, conv: 0, costo: 0, meses: Array(12).fill(0) as number[] }), [raiz]);
  const mesesActivos = useMemo(() => MESES.map((_, i) => i).filter((i) => totales.meses[i] > 0), [totales]);

  const toggle = (k: string) => setAbiertas((p) => ({ ...p, [k]: !p[k] }));
  const ver = (t: string, l: Op[]) => { if (onVerOps && l.length) onVerOps(t, l); };

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    const mesesEnc = verMeses ? mesesActivos.map((i) => MESES[i].toUpperCase()) : [];
    const enc = esFact
      ? [ETQ[raizDim].toUpperCase(), 'SERVICIOS', 'PESOS (MXN)', 'DÓLARES (USD)', 'VENTA MXN', 'COSTO PROV. MXN', 'UTILIDAD MXN', 'MARGEN', '%', ...mesesEnc]
      : [ETQ[raizDim].toUpperCase(), 'SERVICIOS', '%', ...mesesEnc];
    const filaA = (a: Agregado, base: number, pref = ''): (string | number)[] => {
      const mes = verMeses ? mesesActivos.map((i) => a.meses[i]) : [];
      return esFact
        ? [pref + a.clave, a.n, a.pes, a.dol, a.conv, a.costo, a.conv - a.costo, fmtPct(a.conv - a.costo, a.conv), fmtPct(a.conv, base), ...mes]
        : [pref + a.clave, a.n, fmtPct(a.n, base), ...mes];
    };
    const filas: (string | number)[][] = [];
    raiz.forEach((a) => {
      filas.push(filaA(a, esFact ? totales.conv : totales.n));
      agrupar(a.ops, sub1).forEach((b) => {
        filas.push(filaA(b, esFact ? a.conv : a.n, '   ↳ '));
        agrupar(b.ops, sub2).forEach((c) => filas.push(filaA(c, esFact ? b.conv : b.n, '      ↳ ')));
      });
    });
    const mesesTot = verMeses ? mesesActivos.map((i) => totales.meses[i]) : [];
    filas.push(esFact ? ['TOTAL', totales.n, totales.pes, totales.dol, totales.conv, totales.costo, totales.conv - totales.costo, fmtPct(totales.conv - totales.costo, totales.conv), '100%', ...mesesTot] : ['TOTAL', totales.n, '100%', ...mesesTot]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([enc, ...filas]), 'Desglose');
    XLSX.writeFile(wb, `Desglose_${modo}_${raizDim}${moneda !== 'ambas' ? `_${moneda}` : ''}.xlsx`);
  };

  const colSpan = (esFact ? 9 : 3) + (verMeses ? mesesActivos.length : 0);

  const fila = (a: Agregado, base: Agregado | null, prof: number, ruta: string, hijo?: Dimension, nieto?: Dimension) => {
    const abierta = !!abiertas[ruta];
    const pctBase = base ? (esFact ? base.conv : base.n) : (esFact ? totales.conv : totales.n);
    const valor = esFact ? a.conv : a.n;
    const utilidad = a.conv - a.costo;
    return (
      <Fragment key={ruta}>
        <tr className={`dj-fila dj-n${prof}`}>
          <td className="dj-nombre">
            <span className="dj-sangria" data-prof={prof} />
            {hijo ? (
              <button className="dj-toggle" onClick={() => toggle(ruta)} title={abierta ? 'Contraer' : `Desglosar por ${ETQ[hijo]}`}>{abierta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
            ) : <span className="dj-toggle dj-hoja" />}
            <span className={`dj-etiqueta${onVerOps ? ' dj-click' : ''}`} onClick={() => ver(a.clave, a.ops)} title="Ver el resumen de estas operaciones">{a.clave}</span>
          </td>
          <td className="dj-num">{fmtNum(a.n)}</td>
          {esFact && <td className="dj-num dj-mxn">{a.pes > 0 ? fmtMoney(a.pes) : ''}</td>}
          {esFact && <td className="dj-num dj-usd">{a.dol > 0 ? fmtMoney(a.dol) : ''}</td>}
          {esFact && <td className="dj-num dj-conv">{fmtMoney(a.conv)}</td>}
          {esFact && <td className="dj-num dj-costo">{a.costo > 0 ? fmtMoney(a.costo) : ''}</td>}
          {esFact && <td className={`dj-num ${utilidad >= 0 ? 'dj-util' : 'dj-perdida'}`}>{fmtMoney(utilidad)}</td>}
          {esFact && <td className={`dj-num dj-pct ${utilidad >= 0 ? 'dj-util' : 'dj-perdida'}`}>{fmtPct(utilidad, a.conv)}</td>}
          <td className="dj-num dj-pct"><span className="dj-barra"><span className="dj-barra-fill" style={{ '--pct': Math.round(pctBase > 0 ? (valor / pctBase) * 100 : 0) } as CSSProperties} /></span>{fmtPct(valor, pctBase)}</td>
          {verMeses && mesesActivos.map((i) => (
            <td key={i} className={`dj-num dj-mes${a.meses[i] > 0 && onVerOps ? ' dj-click' : ''}`} onClick={() => ver(`${a.clave} · ${MESES[i]}`, a.ops.filter((o) => parseInt(String(o.fechaServicio || '').slice(5, 7), 10) - 1 === i))}>
              {a.meses[i] > 0 ? (esFact ? fmtMoney(a.meses[i]) : fmtNum(a.meses[i])) : ''}
            </td>
          ))}
        </tr>
        {abierta && hijo && agrupar(a.ops, hijo).map((b) => fila(b, a, prof + 1, `${ruta}|${b.clave}`, nieto))}
      </Fragment>
    );
  };

  const selectorSub = (valor: Dimension, setter: (d: Dimension) => void, excluir: Dimension[], etiqueta: string) => (
    <label className="dj-sub-sel">
      <span>{etiqueta}</span>
      <select className="form-control dj-select" value={valor} onChange={(e) => { setter(e.target.value as Dimension); setAbiertas({}); }}>
        {DIMENSIONES.filter((d) => !excluir.includes(d)).map((d) => <option key={d} value={d}>{ETQ[d]}</option>)}
      </select>
    </label>
  );

  return (
    <div className="dj-contenedor">
      <div className="dj-tabs">
        {DIMENSIONES.map((d) => <button key={d} className={`dj-tab${raizDim === d ? ' activa' : ''}`} onClick={() => cambiarRaiz(d)}>{ETQ[d]}</button>)}
      </div>
      <div className="dj-barra-sup">
        <div className="dj-izquierda">
          <Layers size={14} className="dj-icono" />
          {selectorSub(sub1, setSub1, [raizDim, sub2], 'Desglosar en')}
          {selectorSub(sub2, setSub2, [raizDim, sub1], 'y después en')}
        </div>
        <div className="dj-derecha">
          {esFact && (
            <div className="dj-monedas">
              {(['ambas', 'MXN', 'USD'] as Moneda[]).map((m) => <button key={m} className={`dj-chip${moneda === m ? ' activo' : ''}`} onClick={() => setMoneda(m)}>{m === 'ambas' ? 'Pesos + dólares' : m === 'MXN' ? 'Pesos' : 'Dólares'}</button>)}
            </div>
          )}
          <button className={`dj-chip${verMeses ? ' activo' : ''}`} onClick={() => setVerMeses((v) => !v)} title="Agrega una columna por mes (como la matriz UNIDAD × MES del Excel)"><CalendarDays size={13} /> Ver por mes</button>
          <button className="est-btn" onClick={exportar} disabled={raiz.length === 0}><Download size={14} /> Excel</button>
        </div>
      </div>
      <p className="dj-nota">
        {esFact ? 'Ordenado por venta (de mayor a menor). Venta MXN convierte los dólares con el TC de cada operación; Costo proveedor y Utilidad con el mismo criterio que Facturación de Proveedores.' : 'Ordenado por servicios (de mayor a menor).'} El % de las filas anidadas es respecto a su fila padre. Clic en un nombre abre el resumen de esas operaciones.
      </p>
      <div className="dj-tabla-wrap">
        <table className="dj-tabla">
          <thead>
            <tr>
              <th className="dj-th-nombre">{ETQ[raizDim]}</th>
              <th>Servicios</th>
              {esFact && <th>Pesos (MXN)</th>}
              {esFact && <th>Dólares (USD)</th>}
              {esFact && <th>Venta MXN</th>}
              {esFact && <th>Costo proveedor</th>}
              {esFact && <th>Utilidad</th>}
              {esFact && <th>Margen</th>}
              <th>%</th>
              {verMeses && mesesActivos.map((i) => <th key={i} className="dj-th-mes">{MESES[i]}</th>)}
            </tr>
            <tr className="dj-total">
              <th>Total</th>
              <th>{fmtNum(totales.n)}</th>
              {esFact && <th>{fmtMoney(totales.pes)}</th>}
              {esFact && <th>{fmtMoney(totales.dol)}</th>}
              {esFact && <th>{fmtMoney(totales.conv)}</th>}
              {esFact && <th>{fmtMoney(totales.costo)}</th>}
              {esFact && <th>{fmtMoney(totales.conv - totales.costo)}</th>}
              {esFact && <th>{fmtPct(totales.conv - totales.costo, totales.conv)}</th>}
              <th>100%</th>
              {verMeses && mesesActivos.map((i) => <th key={i} className="dj-th-mes">{esFact ? fmtMoney(totales.meses[i]) : fmtNum(totales.meses[i])}</th>)}
            </tr>
          </thead>
          <tbody>
            {raiz.length === 0 ? <tr><td colSpan={colSpan} className="dj-vacio">Sin operaciones para este criterio.</td></tr>
              : raiz.map((a) => fila(a, null, 0, a.clave, sub1, sub2))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

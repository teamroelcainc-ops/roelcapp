// src/features/estadisticas/components/DesgloseJerarquico.tsx
// ✅ V00126 — DESGLOSE JERÁRQUICO para las dos áreas de Estadísticas:
//   · Operaciones:  cuántos servicios (conteo) por Tipo de Operación → C/V → Grupo
//   · Facturación:  cuánto dinero (Pesos / Dólares) por los mismos niveles
//   Cada fila se puede expandir al siguiente nivel; todo va ordenado de mayor a
//   menor (por servicios o por dinero) con su % de participación.
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { cargarCatalogo, TTL } from '../../../hooks/useCatalogoCache';
import './DesgloseJerarquico.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Op = any;
type Modo = 'operaciones' | 'facturacion';
type Nivel = 'tipo' | 'cv' | 'grupo';
type Moneda = 'ambas' | 'MXN' | 'USD';

interface Props {
  ops: Op[];
  modo: Modo;
  /** Montos del cliente (mismo criterio que Facturación). */
  montoDe: (op: Op) => { dol: number; pes: number; conv: number };
  monedaDe: (op: Op) => 'USD' | 'MXN' | 'Mixta' | 'Sin dato';
  onVerOps?: (titulo: string, ops: Op[]) => void;
}

const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const fmtNum = (n: number) => (Number(n) || 0).toLocaleString('en-US');
const fmtMoney = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(2)}%` : '';
const grupoDe = (tipo: string) => { const t = norm(tipo); if (t.includes('export')) return 'Exportación'; if (t.includes('import')) return 'Importación'; if (t.includes('mov')) return 'Movimiento'; return 'Otros'; };
const ORDEN_NIVELES: Nivel[] = ['tipo', 'cv', 'grupo'];
const ETQ: Record<Nivel, string> = { tipo: 'Tipo de Operación', cv: 'C/V (Cargada / Vacía)', grupo: 'Exportación / Importación / Movimiento' };

interface Agregado { clave: string; ops: Op[]; n: number; pes: number; dol: number; conv: number; }

export function DesgloseJerarquico({ ops, modo, montoDe, monedaDe, onVerOps }: Props) {
  const [nivel, setNivel] = useState<Nivel>('tipo');
  const [moneda, setMoneda] = useState<Moneda>('ambas');
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [catCV, setCatCV] = useState<any[]>([]);
  useEffect(() => { cargarCatalogo('catalogo_carga_vacia', { ttlMs: TTL.MEDIO }).then(setCatCV).catch(() => {}); }, []);

  const tipoDe = (op: Op) => String(op.tipoOperacionNombre || op.tipoOperacion || '').trim() || 'Sin tipo';
  const cvDe = (op: Op) => {
    const v = String(op.carga || op.estadoCarga || op.cargaVacia || '').trim() || 'N/A';
    const cat = catCV.find((c: any) => norm(c.nombre || c.estado_carga) === norm(v));
    return cat ? String(cat.nombre || cat.estado_carga) : v;
  };
  const claveDe = (op: Op, n: Nivel) => n === 'tipo' ? tipoDe(op) : n === 'cv' ? cvDe(op) : grupoDe(tipoDe(op));

  const opsMoneda = useMemo(() => moneda === 'ambas' ? ops : ops.filter((op) => monedaDe(op) === moneda), [ops, moneda, monedaDe]);

  const agrupar = (lista: Op[], n: Nivel): Agregado[] => {
    const m = new Map<string, Agregado>();
    lista.forEach((op) => {
      const k = claveDe(op, n);
      const a = m.get(k) || { clave: k, ops: [], n: 0, pes: 0, dol: 0, conv: 0 };
      const mo = montoDe(op);
      a.ops.push(op); a.n++; a.pes += mo.pes; a.dol += mo.dol; a.conv += mo.conv;
      m.set(k, a);
    });
    const arr = Array.from(m.values());
    // ✅ Orden: Operaciones → por servicios; Facturación → por dinero (conversión a MXN)
    return arr.sort((a, b) => modo === 'facturacion' ? (b.conv - a.conv) || (b.n - a.n) : (b.n - a.n) || (b.conv - a.conv));
  };

  const raiz = useMemo(() => agrupar(opsMoneda, nivel), [opsMoneda, nivel, catCV]); // eslint-disable-line react-hooks/exhaustive-deps
  const totales = useMemo(() => raiz.reduce((s, a) => ({ n: s.n + a.n, pes: s.pes + a.pes, dol: s.dol + a.dol, conv: s.conv + a.conv }), { n: 0, pes: 0, dol: 0, conv: 0 }), [raiz]);
  const siguientes = ORDEN_NIVELES.filter((x) => x !== nivel);

  const toggle = (k: string) => setAbiertas((p) => ({ ...p, [k]: !p[k] }));
  const ver = (t: string, l: Op[]) => { if (onVerOps && l.length) onVerOps(t, l); };
  const esFact = modo === 'facturacion';

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    const enc = esFact ? [ETQ[nivel], 'SERVICIOS', 'PESOS (MXN)', 'DÓLARES (USD)', 'TOTAL EN MXN', '%'] : [ETQ[nivel], 'SERVICIOS', '%'];
    const filas: (string | number)[][] = [];
    raiz.forEach((a) => {
      filas.push(esFact ? [a.clave, a.n, a.pes, a.dol, a.conv, fmtPct(a.conv, totales.conv)] : [a.clave, a.n, fmtPct(a.n, totales.n)]);
      agrupar(a.ops, siguientes[0]).forEach((b) => {
        filas.push(esFact ? [`   ↳ ${b.clave}`, b.n, b.pes, b.dol, b.conv, fmtPct(b.conv, a.conv)] : [`   ↳ ${b.clave}`, b.n, fmtPct(b.n, a.n)]);
        agrupar(b.ops, siguientes[1]).forEach((c) => filas.push(esFact ? [`      ↳ ${c.clave}`, c.n, c.pes, c.dol, c.conv, fmtPct(c.conv, b.conv)] : [`      ↳ ${c.clave}`, c.n, fmtPct(c.n, b.n)]));
      });
    });
    filas.push(esFact ? ['TOTAL', totales.n, totales.pes, totales.dol, totales.conv, '100%'] : ['TOTAL', totales.n, '100%']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([enc, ...filas]), 'Desglose');
    XLSX.writeFile(wb, `Desglose_${modo}_${nivel}${moneda !== 'ambas' ? `_${moneda}` : ''}.xlsx`);
  };

  const fila = (a: Agregado, base: Agregado | null, prof: number, ruta: string, nivelHijo?: Nivel, nivelNieto?: Nivel) => {
    const abierta = !!abiertas[ruta];
    const pctBase = base ? (esFact ? base.conv : base.n) : (esFact ? totales.conv : totales.n);
    const valor = esFact ? a.conv : a.n;
    return (
      <Fragment key={ruta}>
        <tr className={`dj-fila dj-n${prof}`}>
          <td className="dj-nombre">
            <span className="dj-sangria" data-prof={prof} />
            {nivelHijo ? <button className="dj-toggle" onClick={() => toggle(ruta)} title={abierta ? 'Contraer' : `Desglosar por ${ETQ[nivelHijo]}`}>{abierta ? '▾' : '▸'}</button> : <span className="dj-toggle dj-hoja">·</span>}
            <span className={`dj-etiqueta${onVerOps ? ' dj-click' : ''}`} onClick={() => ver(a.clave, a.ops)}>{a.clave}</span>
          </td>
          <td className="dj-num">{fmtNum(a.n)}</td>
          {esFact && <td className="dj-num dj-mxn">{a.pes > 0 ? fmtMoney(a.pes) : ''}</td>}
          {esFact && <td className="dj-num dj-usd">{a.dol > 0 ? fmtMoney(a.dol) : ''}</td>}
          {esFact && <td className="dj-num dj-conv">{fmtMoney(a.conv)}</td>}
          <td className="dj-num dj-pct"><span className="dj-barra"><span className="dj-barra-fill" style={{ '--pct': Math.round(pctBase > 0 ? (valor / pctBase) * 100 : 0) } as CSSProperties} /></span>{fmtPct(valor, pctBase)}</td>
        </tr>
        {abierta && nivelHijo && agrupar(a.ops, nivelHijo).map((b) => fila(b, a, prof + 1, `${ruta}|${b.clave}`, nivelNieto))}
      </Fragment>
    );
  };

  return (
    <div className="dj-contenedor">
      <div className="dj-barra-sup">
        <div className="dj-tabs">
          {ORDEN_NIVELES.map((n) => <button key={n} className={`dj-tab${nivel === n ? ' activa' : ''}`} onClick={() => { setNivel(n); setAbiertas({}); }}>{ETQ[n]}</button>)}
        </div>
        <div className="dj-derecha">
          {esFact && (
            <div className="dj-monedas">
              {(['ambas', 'MXN', 'USD'] as Moneda[]).map((m) => <button key={m} className={`dj-chip${moneda === m ? ' activo' : ''}`} onClick={() => setMoneda(m)}>{m === 'ambas' ? 'Pesos + Dólares' : m === 'MXN' ? 'Pesos' : 'Dólares'}</button>)}
            </div>
          )}
          <button className="est-btn" onClick={exportar} disabled={raiz.length === 0}><Download size={14} /> Excel</button>
        </div>
      </div>
      <p className="dj-nota">
        {esFact ? 'Ordenado por dinero generado (de mayor a menor). "Total en MXN" convierte los dólares con el TC de cada operación.' : 'Ordenado por servicios (de mayor a menor).'} Haz clic en ▸ para desglosar cada fila en {ETQ[siguientes[0]]} y después en {ETQ[siguientes[1]]}.
      </p>
      <div className="dj-tabla-wrap">
        <table className="dj-tabla">
          <thead>
            <tr>
              <th className="dj-th-nombre">{ETQ[nivel].toUpperCase()}</th>
              <th>SERVICIOS</th>
              {esFact && <th>PESOS (MXN)</th>}
              {esFact && <th>DÓLARES (USD)</th>}
              {esFact && <th>TOTAL EN MXN</th>}
              <th>%</th>
            </tr>
            <tr className="dj-total">
              <th>TOTAL</th>
              <th>{fmtNum(totales.n)}</th>
              {esFact && <th>{fmtMoney(totales.pes)}</th>}
              {esFact && <th>{fmtMoney(totales.dol)}</th>}
              {esFact && <th>{fmtMoney(totales.conv)}</th>}
              <th>100%</th>
            </tr>
          </thead>
          <tbody>
            {raiz.length === 0 ? <tr><td colSpan={esFact ? 6 : 3} className="dj-vacio">Sin operaciones para este criterio.</td></tr>
              : raiz.map((a) => fila(a, null, 0, a.clave, siguientes[0], siguientes[1]))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

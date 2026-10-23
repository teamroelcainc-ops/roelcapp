// src/features/analisisClientes/components/DiasYPausas.tsx
// ✅ V00479 — Días y pausas: cuántos días opera cada cliente, sus días hábiles sin operar, la pausa
// más larga, desde cuándo no opera y en qué días de la semana trabaja.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { normalizarTexto } from '../../../shared/dominio/texto';
import { DIAS_SEMANA, REGLAS, direccionInicial, fmtNum, fmtPct, ordenarFichas } from '../services/analisisClientes';
import type { ColumnaFicha, FichaCliente, RolCliente } from '../services/analisisClientes';
import EstadoCliente from './EstadoCliente';
import './DiasYPausas.css';

const COLUMNAS: { clave: ColumnaFicha; texto: string }[] = [
  { clave: 'ops', texto: 'Ops' },
  { clave: 'diasConOp', texto: 'Días con operación' },
  { clave: 'pctDiasOpera', texto: '% de días que opera' },
  { clave: 'porDiaQueOpera', texto: 'Por día que opera' },
  { clave: 'diasHabilesSinOperar', texto: 'Días hábiles sin operar' },
  { clave: 'pausaMasLarga', texto: 'Pausa más larga' },
  { clave: 'pausaActual', texto: 'Sin operar desde hace' },
];

interface Props {
  fichas: Record<RolCliente, FichaCliente[]>;
  onVerOps: (rol: RolCliente, f: FichaCliente) => void;
}

export default function DiasYPausas({ fichas, onVerOps }: Props) {
  const [rol, setRol] = useState<RolCliente>('paga');
  const [soloFrecuentes, setSoloFrecuentes] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<{ col: ColumnaFicha; dir: 1 | -1 }>({ col: 'ops', dir: -1 });

  const visibles = useMemo(() => {
    const t = normalizarTexto(busqueda);
    const lista = fichas[rol].filter((f) => (!soloFrecuentes || f.ops >= REGLAS.minOps) && (!t || normalizarTexto(f.nombre).includes(t)));
    return ordenarFichas(lista, orden.col, orden.dir);
  }, [fichas, rol, soloFrecuentes, busqueda, orden]);
  const ordenar = (col: ColumnaFicha) => setOrden((p) => (p.col === col ? { col, dir: p.dir === 1 ? -1 : 1 } : { col, dir: direccionInicial(col) }));
  const marca = (col: ColumnaFicha) => (orden.col === col ? (orden.dir === 1 ? ' ▲' : ' ▼') : '');
  const aria = (col: ColumnaFicha) => (orden.col === col ? (orden.dir === 1 ? 'ascending' : 'descending') : undefined);

  return (
    <div className="acp-vista">
      <div className="acp-herramientas">
        <div className="acp-roles" role="group" aria-label="Papel del cliente">
          {(['paga', 'mercancia'] as const).map((r) => (
            <button key={r} type="button" className={`acp-rol${rol === r ? ' acp-rol--activo' : ''}`} aria-pressed={rol === r} onClick={() => setRol(r)}>
              {r === 'paga' ? 'Cliente Paga' : 'Cliente Mercancía'}
            </button>
          ))}
        </div>
        <input type="search" className="form-control acp-buscar" placeholder="Buscar cliente" aria-label="Buscar cliente" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <label className="acp-frecuentes">
          <input type="checkbox" checked={soloFrecuentes} onChange={(e) => setSoloFrecuentes(e.target.checked)} />
          Solo con {REGLAS.minOps} o más operaciones
        </label>
      </div>

      <div className="acp-marco">
        {visibles.length === 0 ? (
          <p className="acp-vacio">Ningún cliente con ese filtro.</p>
        ) : (
          <table className="acp-tabla">
            <thead>
              <tr>
                <th aria-sort={aria('nombre')}><button type="button" className="acp-orden" onClick={() => ordenar('nombre')}>Cliente{marca('nombre')}</button></th>
                <th aria-sort={aria('estado')}><button type="button" className="acp-orden" onClick={() => ordenar('estado')}>Estado{marca('estado')}</button></th>
                {COLUMNAS.map((c) => (
                  <th key={c.clave} className="acp-num" aria-sort={aria(c.clave)}>
                    <button type="button" className="acp-orden" onClick={() => ordenar(c.clave)}>{c.texto}{marca(c.clave)}</button>
                  </th>
                ))}
                <th>Por día de la semana</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const max = Math.max(1, ...f.porDiaSemana);
                return (
                  <tr key={f.id}>
                    <td><button type="button" className="acp-nombre" title="Ver sus operaciones" onClick={() => onVerOps(rol, f)}>{f.nombre}</button></td>
                    <td><EstadoCliente estado={f.estado} /></td>
                    <td className="acp-num">{f.ops.toLocaleString('es-MX')}</td>
                    <td className="acp-num">{f.diasConOp}</td>
                    <td className="acp-num">{fmtPct(f.pctDiasOpera, 0)}</td>
                    <td className="acp-num">{fmtNum(f.porDiaQueOpera)}</td>
                    <td className="acp-num">{f.diasHabilesSinOperar}</td>
                    <td className="acp-num">{f.pausaMasLarga} d</td>
                    <td className={`acp-num${f.pausaActual >= REGLAS.diasInactivo ? ' acp-alerta' : ''}`}>{f.pausaActual} d</td>
                    <td>
                      <span className="acp-semana">
                        {DIAS_SEMANA.map((d, i) => (
                          <span key={d} className="acp-dia" style={{ '--acp-i': f.porDiaSemana[i] / max } as CSSProperties} title={`${d}: ${f.porDiaSemana[i]} operaciones`}>{d[0]}</span>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

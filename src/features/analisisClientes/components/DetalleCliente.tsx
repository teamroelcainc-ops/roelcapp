// src/features/analisisClientes/components/DetalleCliente.tsx
// ✅ V00479 — ficha de un cliente: ritmo por trimestre, días que opera, tráfico, y operaciones por mes.
import type { CSSProperties } from 'react';
import { MESES, fmtDiaMes, fmtNum, fmtPct } from '../services/analisisClientes';
import type { FichaCliente } from '../services/analisisClientes';
import EstadoCliente from './EstadoCliente';
import './DetalleCliente.css';

interface Props {
  ficha: FichaCliente;
  /** Mes del corte (0 = enero): las barras llegan hasta ahí. */
  mesFin: number;
  onVerOps: (f: FichaCliente) => void;
}

const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

export default function DetalleCliente({ ficha: f, mesFin, onVerOps }: Props) {
  const datos: [string, string][] = [
    ['Operaciones', f.ops.toLocaleString('es-MX')],
    ['% del total', fmtPct(f.pct)],
    ...f.trimestres.map((t): [string, string] => [`Ops/sem ${t.etiqueta}`, fmtNum(t.opsSem)]),
    ['Ops/sem antes', f.opsSemAntes === null ? '—' : fmtNum(f.opsSemAntes)],
    ['Ops/sem últ. 3 meses', fmtNum(f.opsSemUlt3m)],
    ['Ops/sem últ. 4 sem', fmtNum(f.opsSemUlt4s)],
    ['Días con operación', f.diasConOp.toLocaleString('es-MX')],
    ['% de días que opera', fmtPct(f.pctDiasOpera, 0)],
    ['Por día que opera', fmtNum(f.porDiaQueOpera)],
    ['Días hábiles sin operar', f.diasHabilesSinOperar.toLocaleString('es-MX')],
    ['Primera operación', fmtDiaMes(f.primera)],
    ['Última operación', fmtDiaMes(f.ultima)],
    ['Importación', fmtPct(f.importacion, 0)],
    ['Exportación', fmtPct(f.exportacion, 0)],
    ['Vacíos', fmtPct(f.vacios, 0)],
    ['Hazmat', f.hazmat.toLocaleString('es-MX')],
    ['En falso', f.falso.toLocaleString('es-MX')],
    ['Sábados', fmtPct(f.sabados, 0)],
    ['Pausa más larga', dias(f.pausaMasLarga)],
    ['Sin operar desde hace', dias(f.pausaActual)],
  ];
  const meses = f.porMes.slice(0, mesFin + 1);
  const maximo = Math.max(1, ...meses);
  return (
    <aside className="acf-ficha" aria-label={`Ficha de ${f.nombre}`}>
      <div className="acf-cabeza">
        <button type="button" className="acf-nombre" onClick={() => onVerOps(f)} title="Ver sus operaciones">{f.nombre}</button>
        <EstadoCliente estado={f.estado} />
      </div>
      <dl className="acf-datos">
        {datos.map(([etq, valor]) => (
          <div className="acf-dato" key={etq}>
            <dt>{etq}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      <h3 className="acf-subtitulo">Operaciones por mes</h3>
      <ol className="acf-barras">
        {meses.map((n, i) => (
          <li className="acf-mes" key={MESES[i]} style={{ '--acf-alto': `${(n / maximo) * 100}%` } as CSSProperties}>
            <span className="acf-cuenta">{n > 0 ? n : ''}</span>
            <span className="acf-barra" title={`${MESES[i]}: ${n} operaciones`} />
            <span className="acf-etq">{MESES[i]}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="acf-ver" onClick={() => onVerOps(f)}>Ver sus {f.ops.toLocaleString('es-MX')} operaciones</button>
    </aside>
  );
}

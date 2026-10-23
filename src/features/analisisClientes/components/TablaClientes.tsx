// src/features/analisisClientes/components/TablaClientes.tsx
// ✅ V00479 — Cliente Paga / Cliente Mercancía: buscador, filtro por estado, tabla ordenable y la
// ficha del cliente elegido. El nombre abre sus operaciones.
import { useMemo, useState } from 'react';
import { normalizarTexto } from '../../../shared/dominio/texto';
import { DIAS_SEMANA, ETIQUETA_ESTADO, ORDEN_ESTADOS, direccionInicial, fmtCambio, fmtDiaMes, fmtNum, fmtPct, ordenarFichas } from '../services/analisisClientes';
import type { ColumnaFicha, EstadoCliente as Estado, FichaCliente, RolCliente } from '../services/analisisClientes';
import EstadoCliente from './EstadoCliente';
import DetalleCliente from './DetalleCliente';
import './TablaClientes.css';

const COLUMNAS: { clave: ColumnaFicha; texto: string; numero?: boolean }[] = [
  { clave: 'nombre', texto: 'Cliente' },
  { clave: 'estado', texto: 'Estado' },
  { clave: 'ops', texto: 'Ops', numero: true },
  { clave: 'pct', texto: '% total', numero: true },
  { clave: 'cambio', texto: 'Cambio últ. 3 meses', numero: true },
  { clave: 'opsSemUlt4s', texto: 'Ops/sem últ. 4 sem', numero: true },
  { clave: 'diaFuerte', texto: 'Día fuerte' },
  { clave: 'pausaMasLarga', texto: 'Pausa más larga', numero: true },
  { clave: 'ultima', texto: 'Última' },
];

interface Props {
  rol: RolCliente;
  fichas: FichaCliente[];
  filtroEstado: Estado | null;
  onFiltroEstado: (e: Estado | null) => void;
  onVerOps: (f: FichaCliente) => void;
  mesFin: number;
}

export default function TablaClientes({ rol, fichas, filtroEstado, onFiltroEstado, onVerOps, mesFin }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<{ col: ColumnaFicha; dir: 1 | -1 }>({ col: 'ops', dir: -1 });
  const [elegido, setElegido] = useState<string | null>(null);

  const visibles = useMemo(() => {
    const t = normalizarTexto(busqueda);
    const lista = fichas.filter((f) => (!filtroEstado || f.estado === filtroEstado) && (!t || normalizarTexto(f.nombre).includes(t)));
    return ordenarFichas(lista, orden.col, orden.dir);
  }, [fichas, filtroEstado, busqueda, orden]);
  const ficha = visibles.find((f) => f.id === elegido) ?? visibles[0] ?? null;
  const ordenar = (col: ColumnaFicha) => setOrden((p) => (p.col === col ? { col, dir: p.dir === 1 ? -1 : 1 } : { col, dir: direccionInicial(col) }));
  const conteo = (e: Estado) => fichas.filter((f) => f.estado === e).length;

  return (
    <div className="act-vista">
      <div className="act-herramientas">
        <input type="search" className="form-control act-buscar" placeholder="Buscar cliente" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          aria-label={rol === 'paga' ? 'Buscar cliente que paga' : 'Buscar cliente de mercancía'} />
        <div className="act-chips">
          <button type="button" className={`act-chip${filtroEstado === null ? ' act-chip--activo' : ''}`} onClick={() => onFiltroEstado(null)}>
            Todos <span className="act-chip-n">{fichas.length}</span>
          </button>
          {ORDEN_ESTADOS.map((e) => (
            <button key={e} type="button" className={`act-chip act-chip--${e}${filtroEstado === e ? ' act-chip--activo' : ''}`} onClick={() => onFiltroEstado(filtroEstado === e ? null : e)}>
              {ETIQUETA_ESTADO[e]} <span className="act-chip-n">{conteo(e)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="act-cuerpo">
        <div className="act-tabla-marco">
          {visibles.length === 0 ? (
            <p className="act-vacio">Ningún cliente con ese filtro.</p>
          ) : (
            <table className="act-tabla">
              <thead>
                <tr>
                  {COLUMNAS.map((c) => (
                    <th key={c.clave} className={c.numero ? 'act-num' : undefined} aria-sort={orden.col === c.clave ? (orden.dir === 1 ? 'ascending' : 'descending') : undefined}>
                      <button type="button" className="act-orden" onClick={() => ordenar(c.clave)}>
                        {c.texto}{orden.col === c.clave ? (orden.dir === 1 ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => (
                  <tr key={f.id} className={f.id === ficha?.id ? 'act-fila act-fila--elegida' : 'act-fila'} onClick={() => setElegido(f.id)}>
                    <td>
                      <button type="button" className="act-nombre" title="Ver sus operaciones" onClick={(ev) => { ev.stopPropagation(); setElegido(f.id); onVerOps(f); }}>
                        {f.nombre}
                      </button>
                    </td>
                    <td><EstadoCliente estado={f.estado} /></td>
                    <td className="act-num">{f.ops.toLocaleString('es-MX')}</td>
                    <td className="act-num">{fmtPct(f.pct)}</td>
                    <td className={`act-num${f.cambio !== null && f.cambio >= 0.2 ? ' act-sube' : f.cambio !== null && f.cambio <= -0.2 ? ' act-baja' : ''}`}>{fmtCambio(f.cambio)}</td>
                    <td className="act-num">{fmtNum(f.opsSemUlt4s)}</td>
                    <td>{DIAS_SEMANA[f.diaFuerte]}</td>
                    <td className="act-num">{f.pausaMasLarga} d</td>
                    <td>{fmtDiaMes(f.ultima)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {ficha && <div className="act-lado"><DetalleCliente ficha={ficha} mesFin={mesFin} onVerOps={onVerOps} /></div>}
      </div>
    </div>
  );
}

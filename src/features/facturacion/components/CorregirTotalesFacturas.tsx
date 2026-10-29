// src/features/facturacion/components/CorregirTotalesFacturas.tsx
// ---------------------------------------------------------------------------
// ✅ V00522 — Pestaña "Corregir" de Facturación de Clientes: las facturas cuya suma de operaciones (lo
// que cobra cada referencia en la factura) no es igual a su total. "Revisar" las busca entre TODAS las
// facturas (las que ya están en pantalla: cero lecturas) y NO cambia ningún total. Clic en la fila (o
// Ver factura) abre su Ficha para corregirla a mano.
// ✅ V00523: columna Referencias — cada referencia con lo que cobra en la factura y, si es distinto (o la
// factura no lo guardó), lo que cobra HOY la operación. Solo se leen las operaciones de las filas que se
// ven (useOperacionesPorId); con eso, el motivo dice si con el costo de hoy cuadraría.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Search } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { aCentavos } from '../../../shared/dominio/numeros';
import { useOperacionesPorId } from '../hooks/useOperacionesPorId';
import { importeEn } from '../services/cotejoCfdi';
import { sumaConHoy, TEXTO_MOTIVO } from '../services/cuadreFactura';
import type { CuadreFactura, MotivoCuadre } from '../services/cuadreFactura';
import './CorregirTotalesFacturas.css';

/** Una referencia de la factura: su operación (id real, o '' si solo se guardó la referencia) y lo que cobra en la factura. */
export interface RefCorregir { opId: string; ref: string; importe: number | null }

/** Una factura de la lista, lista para pintar. */
export interface FilaCorregirVista {
  clave: string;
  invoice: string;
  fecha: string;
  cliente: string;
  moneda: string;
  /** USD / MXN (para calcular lo que cobra hoy cada operación); null = sin moneda. */
  monedaCodigo: 'USD' | 'MXN' | null;
  refs: readonly RefCorregir[];
  cuadre: CuadreFactura;
}

export interface RevisionCuadre {
  filas: readonly FilaCorregirVista[];
  /** Cuántas facturas se revisaron (sin las canceladas). */
  revisadas: number;
  /** Cuándo (texto para mostrar). */
  en: string;
}

interface Props {
  revision: RevisionCuadre | null;
  /** Las facturas todavía están llegando: no se puede revisar. */
  cargando: boolean;
  onRevisar: () => void;
  onVer: (clave: string) => void;
}

type Filtro = Exclude<MotivoCuadre, 'cuadra'> | 'todas';
const MOTIVOS: readonly Exclude<MotivoCuadre, 'cuadra'>[] = ['diferencia', 'iva', 'sinMontos', 'sinOperaciones'];
const TOPE = 300;
const MAX_REFS = 6;
const miles = (n: number): string => n.toLocaleString('es-MX');
const dinero = (n: number): string => `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const conSigno = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${dinero(Math.abs(n))}`;

export default function CorregirTotalesFacturas({ revision, cargando, onRevisar, onVer }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [ver, setVer] = useState(TOPE);
  const todas = revision?.filas ?? [];
  const lista = filtro === 'todas' ? todas : todas.filter((f) => f.cuadre.motivo === filtro);
  const cuantas = (m: Filtro): number => (m === 'todas' ? todas.length : todas.filter((f) => f.cuadre.motivo === m).length);
  const elegir = (m: Filtro) => { setFiltro(m); setVer(TOPE); };
  const visibles = lista.slice(0, ver);
  const hoy = useOperacionesPorId(visibles.flatMap((f) => f.refs.map((r) => r.opId)));
  /** Lo que cobra HOY la operación en la moneda de la factura (undefined: todavía no llega; null: no se puede saber). */
  const importeHoy = (f: FilaCorregirVista, r: RefCorregir): number | null | undefined => {
    if (!r.opId || !f.monedaCodigo) return null;
    const op = hoy.ops.get(r.opId);
    if (op === undefined) return hoy.error ? null : undefined;
    return op === null ? null : importeEn(f.monedaCodigo, op);
  };

  return (
    <section className="ctf-panel" aria-labelledby="ctf-titulo">
      <div className="ctf-cabecera">
        <div>
          <h2 id="ctf-titulo" className="ctf-titulo">Facturas cuya suma de operaciones no es igual a su total</h2>
          <p className="ctf-texto">
            Compara lo que cobra cada operación en la factura con el total de la factura. Revisar no cambia ningún total:
            para corregir una, haz clic en ella (se abre su Ficha) y corrige el costo en sus operaciones.
          </p>
        </div>
        <button type="button" className="ctf-btn-revisar" onClick={() => { setVer(TOPE); onRevisar(); }} disabled={cargando}>
          <Search size={15} aria-hidden="true" /> {revision ? 'Revisar de nuevo' : 'Revisar'}
        </button>
      </div>

      {cargando && <CargandoDatos texto="Cargando las facturas…" />}
      {!cargando && !revision && <p className="ctf-vacio">Presiona Revisar para buscar las facturas que no cuadran.</p>}

      {!cargando && revision && (
        <>
          <p className="ctf-resumen" role="status">
            Se revisaron {miles(revision.revisadas)} facturas ({revision.en}): <b>{miles(todas.length)}</b> no cuadran. Las canceladas no se revisan.
          </p>
          {todas.length > 0 && (
            <div className="ctf-filtros" role="group" aria-label="Filtrar por motivo">
              {(['todas', ...MOTIVOS] as const).filter((m) => m === 'todas' || cuantas(m) > 0).map((m) => (
                <button key={m} type="button" className={`ctf-chip${filtro === m ? ' ctf-chip--activo' : ''}`} aria-pressed={filtro === m} onClick={() => elegir(m)}>
                  {m === 'todas' ? 'Todas' : TEXTO_MOTIVO[m]} ({miles(cuantas(m))})
                </button>
              ))}
            </div>
          )}
          {todas.length === 0 ? <p className="ctf-vacio">Todas las facturas cuadran con sus operaciones.</p> : (
            <div className="ctf-tabla-envoltura">
              <table className="ctf-tabla">
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Cliente</th>
                    <th scope="col">Moneda</th>
                    <th scope="col">Referencias</th>
                    <th scope="col" className="ctf-num">Suma de operaciones</th>
                    <th scope="col" className="ctf-num">Total</th>
                    <th scope="col" className="ctf-num">Diferencia</th>
                    <th scope="col">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => {
                    const hoyDe = f.refs.map((r) => importeHoy(f, r));
                    const conHoy = sumaConHoy(hoyDe, f.cuadre.total);
                    return (
                      // ✅ V00523: clic en la fila → la Ficha de la factura (el invoice es el botón, para el teclado)
                      <tr key={f.clave} className="ctf-fila" title="Ver la factura"
                        onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onVer(f.clave); }}>
                        <td><button type="button" className="ctf-invoice" onClick={() => onVer(f.clave)} title="Ver la factura">{f.invoice || '—'}</button></td>
                        <td className="ctf-tenue">{f.fecha || '—'}</td>
                        <td className="ctf-cliente" title={f.cliente}>{f.cliente}</td>
                        <td className="ctf-tenue">{f.moneda}</td>
                        <td className="ctf-refs">
                          <ul className="ctf-refs-lista">
                            {f.refs.slice(0, MAX_REFS).map((r, i) => {
                              const h = hoyDe[i];
                              const distinto = typeof h === 'number' && (r.importe === null || aCentavos(h) !== aCentavos(r.importe));
                              return (
                                <li key={`${r.opId || r.ref}-${i}`} className="ctf-ref">
                                  <span className="ctf-ref-id">{r.ref || '—'}</span>
                                  {r.importe !== null && <span className={`ctf-ref-monto${distinto ? ' ctf-ref-monto--viejo' : ''}`} title="Lo que cobra en la factura">{dinero(r.importe)}</span>}
                                  {distinto && <span className="ctf-ref-hoy" title="Lo que cobra hoy la operación">{r.importe === null ? 'hoy' : '→ hoy'} {dinero(h)}</span>}
                                  {h === undefined && r.opId && <span className="ctf-ref-leyendo">…</span>}
                                  {h === null && r.importe === null && <span className="ctf-ref-sin" title={r.opId ? 'No se encontró la operación' : 'La factura solo guardó la referencia, no la operación'}>sin monto</span>}
                                </li>
                              );
                            })}
                            {f.refs.length > MAX_REFS && <li className="ctf-ref ctf-ref--mas">+{f.refs.length - MAX_REFS} más (en la factura)</li>}
                          </ul>
                        </td>
                        <td className="ctf-num">{dinero(f.cuadre.suma)}</td>
                        <td className="ctf-num ctf-total">{dinero(f.cuadre.total)}</td>
                        <td className={`ctf-num ctf-dif ctf-dif--${f.cuadre.motivo}`}>{conSigno(f.cuadre.diferencia)}</td>
                        <td className="ctf-motivo">
                          {f.cuadre.motivo === 'cuadra' ? '' : TEXTO_MOTIVO[f.cuadre.motivo]}
                          {conHoy && (
                            <span className={`ctf-con-hoy${conHoy.cuadra ? ' ctf-con-hoy--ok' : ''}`}>
                              {conHoy.cuadra ? 'Con el costo de hoy, cuadra.' : `Con el costo de hoy suman ${dinero(conHoy.suma)}.`}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {hoy.error && <p className="ctf-error" role="alert">{hoy.error}</p>}
              {lista.length > ver && (
                <button type="button" className="ctf-mas" onClick={() => setVer((n) => n + TOPE)}>
                  Mostrar {miles(Math.min(TOPE, lista.length - ver))} más (van {miles(ver)} de {miles(lista.length)})
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

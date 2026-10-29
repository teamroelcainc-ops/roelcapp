// src/features/facturacion/components/CorregirTotalesFacturas.tsx
// ---------------------------------------------------------------------------
// ✅ V00522 — Pestaña "Corregir" de Facturación de Clientes: las facturas cuya suma de operaciones (lo
// que cobra cada referencia en la factura) no es igual a su total. "Revisar" las busca entre TODAS las
// facturas (las que ya están en pantalla: cero lecturas) y NO cambia ningún total. Ver factura abre su
// Ficha para corregirla a mano.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Search } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { TEXTO_MOTIVO } from '../services/cuadreFactura';
import type { CuadreFactura, MotivoCuadre } from '../services/cuadreFactura';
import './CorregirTotalesFacturas.css';

/** Una factura de la lista, lista para pintar. */
export interface FilaCorregirVista {
  clave: string;
  invoice: string;
  fecha: string;
  cliente: string;
  moneda: string;
  ops: number;
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

  return (
    <section className="ctf-panel" aria-labelledby="ctf-titulo">
      <div className="ctf-cabecera">
        <div>
          <h2 id="ctf-titulo" className="ctf-titulo">Facturas cuya suma de operaciones no es igual a su total</h2>
          <p className="ctf-texto">
            Compara lo que cobra cada operación en la factura con el total de la factura. Revisar no cambia ningún total:
            para corregir una, ábrela con Ver factura y corrige el costo en sus operaciones.
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
                    <th scope="col" className="ctf-num">Ops</th>
                    <th scope="col" className="ctf-num">Suma de operaciones</th>
                    <th scope="col" className="ctf-num">Total</th>
                    <th scope="col" className="ctf-num">Diferencia</th>
                    <th scope="col">Motivo</th>
                    <th scope="col"><span className="ctf-oculto">Acción</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.slice(0, ver).map((f) => (
                    <tr key={f.clave}>
                      <td className="ctf-invoice">{f.invoice || '—'}</td>
                      <td className="ctf-tenue">{f.fecha || '—'}</td>
                      <td className="ctf-cliente" title={f.cliente}>{f.cliente}</td>
                      <td className="ctf-tenue">{f.moneda}</td>
                      <td className="ctf-num ctf-tenue">{f.ops}</td>
                      <td className="ctf-num">{dinero(f.cuadre.suma)}</td>
                      <td className="ctf-num ctf-total">{dinero(f.cuadre.total)}</td>
                      <td className={`ctf-num ctf-dif ctf-dif--${f.cuadre.motivo}`}>{conSigno(f.cuadre.diferencia)}</td>
                      <td className="ctf-motivo">{f.cuadre.motivo === 'cuadra' ? '' : TEXTO_MOTIVO[f.cuadre.motivo]}</td>
                      <td><button type="button" className="ctf-ver" onClick={() => onVer(f.clave)}>Ver factura</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

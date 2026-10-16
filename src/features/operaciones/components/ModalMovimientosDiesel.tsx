// src/features/operaciones/components/ModalMovimientosDiesel.tsx
// ✅ V00457: al presionar la tarjeta Saldo Diesel (Operaciones Activas) se ve el HISTORIAL
//   del saldo con rango de fechas: los saldos agregados (+) y lo cargado cada día (−),
//   con el saldo que queda después de cada movimiento (la misma cuenta de la tarjeta y de
//   Referencias del Diesel → Saldos). Al abrir un día se ven sus cargas.
//   Usa el aspecto del modal de movimientos de los puentes (clases tmov- de
//   ModalMovimientosPuente.css) y agrega solo lo suyo (tmd-).
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { haceDias } from '../services/movimientosPuente';
import { cargasDelDia, cuentasDeSaldos, diasDesdeCorrientes, diasDesdeReferencias, movimientosDiesel, movimientosEnRango, resumenDiesel, type MovimientoDiesel } from '../services/movimientosDiesel';
import type { SaldoCorrienteDiesel } from '../../../shared/dominio/saldosCorrientes';
import { CLAVE_CARGAS_DIESEL_DIA, leerReferenciasDieselDelDia } from '../services/movimientosDieselDatos';
import './ModalMovimientosPuente.css';
import './ModalMovimientosDiesel.css';

type Datos = Record<string, unknown>;

interface Props {
  /** Saldo restante (la cifra de la tarjeta). */
  restante: number;
  /** Moneda de las cuentas cuando todas usan la misma ('' si son varias). */
  moneda: string;
  /** Saldos agregados (saldos_diesel), los mismos de la tarjeta. */
  saldos: readonly Datos[];
  /** Lo cargado: los documentos de saldo corriente (bandera saldosCorrientes) o las referencias que la tarjeta ya escucha. */
  cargas: { corrientes: readonly SaldoCorrienteDiesel[] } | { refs: readonly Datos[] };
  cargando: boolean;
  onCerrar: () => void;
}

const DIAS_POR_DEFECTO = 30;
const fmt = (n: number) => `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtGal = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 2 });
const fechaCorta = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
};

function DetalleCargas({ fecha, cuenta, cuentaNombre, version, refsLocales }: { fecha: string; cuenta: string; cuentaNombre: string; version: string; refsLocales: readonly Datos[] | null }) {
  // `version` (cargas y monto del día según el servidor) va en la clave: si llega una carga nueva
  //   se vuelve a leer ese día; si no cambió nada, se usa lo ya leído.
  const q = useQuery({
    queryKey: [...CLAVE_CARGAS_DIESEL_DIA, fecha, version],
    queryFn: () => leerReferenciasDieselDelDia(fecha),
    enabled: refsLocales === null,
  });
  if (refsLocales === null && q.isPending) return <CargandoDatos texto="Cargando las cargas del día…" compacto />;
  if (refsLocales === null && q.isError) return <p className="tmd-vacio">No se pudieron leer las cargas de ese día. Revisa tu conexión y vuelve a abrirlo.</p>;
  const lista = cargasDelDia(refsLocales ?? q.data ?? [], { clave: cuenta, nombre: cuentaNombre }, fecha);
  if (lista.length === 0) return <p className="tmd-vacio">No se encontraron las referencias de ese día.</p>;
  return (
    <table className="tmd-tabla">
      <thead>
        <tr><th>Referencia</th><th>Unidad</th><th>Proveedor</th><th className="tmd-num">Galones</th><th className="tmd-num">Costo / gal</th><th className="tmd-num">Total cargado</th></tr>
      </thead>
      <tbody>
        {lista.map((c) => (
          <tr key={c.id || c.consecutivo}>
            <td className="tmd-ref">{c.consecutivo}</td>
            <td>{c.unidad}</td>
            <td>{c.proveedor}</td>
            <td className="tmd-num">{fmtGal(c.galones)}</td>
            <td className="tmd-num">{c.costo > 0 ? fmt(c.costo) : '—'}</td>
            <td className="tmd-num tmov-cargo">−{fmt(c.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ModalMovimientosDiesel({ restante, moneda, saldos, cargas, cargando, onCerrar }: Props) {
  const hoy = hoyLocalISO();
  const cuentasMov = cuentasDeSaldos(saldos);
  const movimientos = movimientosDiesel(cuentasMov, (c) => ('corrientes' in cargas ? diasDesdeCorrientes(c, cargas.corrientes) : diasDesdeReferencias(c, cargas.refs)));
  // Sin la bandera, el detalle de un día sale de las referencias que la tarjeta ya tiene; con ella se lee por día.
  const refsLocales = 'refs' in cargas ? cargas.refs : null;
  const cuentas = cuentasMov.length;
  const [desde, setDesde] = useState(() => haceDias(hoy, DIAS_POR_DEFECTO));
  const [hasta, setHasta] = useState(hoy);
  const [abierto, setAbierto] = useState('');
  const lista = movimientosEnRango(movimientos, desde, hasta);
  const r = resumenDiesel(lista);
  const conCuenta = cuentas > 1;
  const columnas = conCuenta ? 8 : 7;

  // Escape cierra; el foco entra al modal y vuelve a donde estaba al cerrar. useEffectEvent:
  //   la tarjeta se repinta con cada snapshot y el efecto NO debe volver a correr (robaría
  //   el foco de las fechas).
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const alTeclear = useEffectEvent((e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); });
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();
    const escuchar = (e: KeyboardEvent) => alTeclear(e);
    window.addEventListener('keydown', escuchar);
    return () => { window.removeEventListener('keydown', escuchar); previo?.focus?.(); };
  }, []);

  return createPortal(
    <div className="modal-overlay tmov-fondo" onClick={onCerrar}>
      <div className="tmov-caja tmd-caja" role="dialog" aria-modal="true" aria-label="Movimientos del saldo de diesel" onClick={(e) => e.stopPropagation()}>
        <div className="tmov-enc">
          <div>
            <h2 className="tmov-titulo">Saldo Diesel · movimientos del saldo</h2>
            <span className="tmov-sub">Saldo restante: {cargando ? <CargandoDatos texto="Calculando…" enLinea /> : <><b className={restante < 0 ? 'tmov-neg' : ''}>{fmt(restante)}</b>{moneda ? ` ${moneda}` : ''}</>} · saldos agregados menos lo cargado por día (Referencias del Diesel → Saldos)</span>
          </div>
          <button type="button" className="tmov-x" onClick={onCerrar} aria-label="Cerrar" ref={cerrarRef}>✕</button>
        </div>

        <div className="tmov-filtros">
          <label className="tmov-campo"><span>Desde</span>
            <input type="date" className="tmov-input tmd-input" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="tmov-campo"><span>Hasta</span>
            <input type="date" className="tmov-input tmd-input" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <div className="tmov-rapidos">
            <button type="button" className="tmov-chip tmd-chip" onClick={() => { setDesde(hoy); setHasta(hoy); }}>Hoy</button>
            <button type="button" className="tmov-chip tmd-chip" onClick={() => { setDesde(haceDias(hoy, 7)); setHasta(hoy); }}>7 días</button>
            <button type="button" className="tmov-chip tmd-chip" onClick={() => { setDesde(haceDias(hoy, DIAS_POR_DEFECTO)); setHasta(hoy); }}>30 días</button>
            <button type="button" className="tmov-chip tmd-chip" onClick={() => { setDesde(''); setHasta(''); }}>Todo</button>
          </div>
          {!cargando && (
            <dl className="tmov-resumen">
              <div><dt>Saldo agregado</dt><dd className="tmov-abono">+{fmt(r.abonos)}</dd></div>
              <div><dt>Cargado · {r.cargas} {r.cargas === 1 ? 'carga' : 'cargas'}</dt><dd className="tmov-cargo">−{fmt(r.cargos)}</dd></div>
            </dl>
          )}
        </div>

        <div className="tmov-marco">
          <table className="tmov-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Concepto</th>
                {conCuenta && <th>Cuenta</th>}
                <th>Detalle</th>
                <th className="tmov-num">Cargo (−)</th>
                <th className="tmov-num">Abono (+)</th>
                <th className="tmov-num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={columnas}><CargandoDatos texto="Cargando movimientos…" /></td></tr>
              ) : lista.length === 0 ? (
                <tr><td colSpan={columnas} className="tmov-vacio">{movimientos.length === 0 ? 'Aún no hay saldos de diesel registrados. Usa "Actualizar saldo".' : 'Sin movimientos en estas fechas.'}</td></tr>
              ) : lista.map((m) => {
                const esCargas = m.tipo === 'cargas';
                const estaAbierto = abierto === m.id;
                return (
                  <FilaMovimiento key={m.id} m={m} esCargas={esCargas} estaAbierto={estaAbierto} conCuenta={conCuenta} monedaFila={moneda ? '' : m.moneda}
                    onAlternar={() => setAbierto(estaAbierto ? '' : m.id)}>
                    {esCargas && estaAbierto && (
                      <tr className="tmd-sub">
                        <td colSpan={columnas}><DetalleCargas fecha={m.fecha} cuenta={m.cuenta} cuentaNombre={m.cuentaNombre} version={`${m.cargas}:${m.cargo.toFixed(2)}`} refsLocales={refsLocales} /></td>
                      </tr>
                    )}
                  </FilaMovimiento>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="tmov-pie">
          <button type="button" className="tmov-btn tmd-btn" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FilaMovimiento({ m, esCargas, estaAbierto, conCuenta, monedaFila, onAlternar, children }: {
  m: MovimientoDiesel; esCargas: boolean; estaAbierto: boolean; conCuenta: boolean; monedaFila: string; onAlternar: () => void; children?: React.ReactNode;
}) {
  return (
    <>
      <tr className={esCargas ? 'tmd-fila--cargas' : 'tmov-fila--saldo'}>
        <td>{fechaCorta(m.fecha)}</td>
        <td>{m.hora || '—'}</td>
        <td>
          {esCargas ? (
            <button type="button" className="tmd-abrir" aria-expanded={estaAbierto} onClick={onAlternar} title="Ver las cargas de ese día">
              <span className="tmd-flecha" aria-hidden="true">{estaAbierto ? '▾' : '▸'}</span>Cargas del día
            </button>
          ) : (
            <>Saldo agregado<span className="tmov-chip-tipo tmov-chip-tipo--saldo">saldo</span></>
          )}
        </td>
        {conCuenta && <td>{m.cuentaNombre}</td>}
        <td className="tmd-detalle">
          {esCargas
            ? `${m.cargas} ${m.cargas === 1 ? 'carga' : 'cargas'}${m.galones != null ? ` · ${fmtGal(m.galones)} gal` : ''}`
            : (m.registradoPor ? `Registrado por ${m.registradoPor}` : '—')}
        </td>
        <td className="tmov-num">{m.cargo > 0 ? <span className="tmov-cargo">−{fmt(m.cargo)}</span> : ''}</td>
        <td className="tmov-num">{m.abono !== 0 ? <span className="tmov-abono">{m.abono < 0 ? '−' : '+'}{fmt(Math.abs(m.abono))}</span> : ''}</td>
        <td className={`tmov-num tmd-saldo${m.saldo < 0 ? ' tmov-neg' : ''}`}>{fmt(m.saldo)}{monedaFila && <span className="tmov-moneda"> {monedaFila}</span>}</td>
      </tr>
      {children}
    </>
  );
}

// src/features/diesel/components/ModalConfirmarCobroDiesel.tsx
// ✅ V00459: CONFIRMAR EL COBRO de una carga de diesel. Galones que realmente se cargaron
//   (contra los autorizados), el descuento y el monto cobrado tal como vienen en el reporte de
//   Murphy. Lo que se deja vacío se estima ($0.20 × galones en Murphy desde el inicio del
//   descuento) y el Saldo Diesel descuenta lo cobrado.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cobroDiesel, cobroEstimado, descuentoEstimadoDiesel, esCargaMurphy, DESCUENTO_MURPHY_POR_GALON } from '../../../shared/dominio/cobroDiesel';
import { avisoCaptura, capturaInicial, errorCaptura, referenciaConCaptura, type CapturaCobro } from '../services/confirmacionCobro';
import { guardarConfirmacionCobro } from '../services/confirmacionCobroDatos';
import './ModalConfirmarCobroDiesel.css';

type Datos = Record<string, unknown>;

interface Props {
  referencia: Datos & { id: string };
  /** Texto de la unidad y del proveedor tal como los muestra la tabla. */
  unidad: string;
  proveedor: string;
  onCerrar: () => void;
  /** Campos guardados (para reflejarlos al instante en la tabla y en la ficha). */
  onGuardado: (campos: Datos) => void;
}

const fmt = (n: number) => `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtGal = (n: number) => `${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gal`;
const conSigno = (n: number, f: (x: number) => string) => `${n > 0.004 ? '+' : n < -0.004 ? '−' : ''}${f(Math.abs(n))}`;
const fechaCorta = (iso: unknown) => {
  const s = String(iso ?? '').slice(0, 10);
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? (s || '—') : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function ModalConfirmarCobroDiesel({ referencia, unidad, proveedor, onCerrar, onGuardado }: Props) {
  const [captura, setCaptura] = useState<CapturaCobro>(() => capturaInicial(referencia));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  // Aviso de un valor raro (p. ej. el cobrado en Descuento): se muestra y el segundo Guardar lo acepta.
  const [avisoAceptado, setAvisoAceptado] = useState('');
  const primerCampo = useRef<HTMLInputElement>(null);

  const conCaptura = referenciaConCaptura(referencia, captura);
  const c = cobroDiesel(conCaptura);
  const est = cobroEstimado(conCaptura);
  const estimadoDesc = descuentoEstimadoDiesel(conCaptura);
  const aviso = avisoCaptura(referencia, captura);
  const esperado = c.sinDescuento - c.descuento;
  const costo = Number(referencia.costoDiesel) || 0;
  // Sin costo por galón no se pueden recalcular galones (el total viejo se quedaría en 0): solo lectura.
  const autorizados = Number(referencia.galonesAutorizados) || 0;

  const cerrar = () => { if (!guardando) onCerrar(); };
  const alTeclear = useEffectEvent((e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); });
  useEffect(() => {
    primerCampo.current?.focus();
    const escuchar = (e: KeyboardEvent) => alTeclear(e);
    window.addEventListener('keydown', escuchar);
    return () => window.removeEventListener('keydown', escuchar);
  }, []);

  const cambiar = (k: keyof CapturaCobro) => (e: React.ChangeEvent<HTMLInputElement>) => { setError(''); setCaptura((p) => ({ ...p, [k]: e.target.value })); };
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const problema = errorCaptura(referencia, captura);
    if (problema) { setError(problema); return; }
    if (aviso && avisoAceptado !== aviso) { setAvisoAceptado(aviso); return; }
    setGuardando(true);
    try {
      const campos = await guardarConfirmacionCobro(referencia.id, captura);
      onGuardado(campos);
      onCerrar();
    } catch (err) {
      setError(`No se pudo guardar: ${(err as Error)?.message || err}`);
    } finally { setGuardando(false); }
  };

  return createPortal(
    <div className="modal-overlay mcd-fondo" onClick={cerrar}>
      <div className="mcd-caja" role="dialog" aria-modal="true" aria-label={`Confirmar cobro de ${String(referencia.consecutivo || '')}`} onClick={(e) => e.stopPropagation()}>
        <div className="mcd-enc">
          <div>
            <h2 className="mcd-titulo">Confirmar cobro <span className="mcd-ref">{String(referencia.consecutivo || '')}</span></h2>
            <p className="mcd-sub">{proveedor} · {fechaCorta(referencia.fecha)} · {unidad}</p>
          </div>
          <button type="button" className="mcd-x" onClick={cerrar} aria-label="Cerrar">✕</button>
        </div>

        <form onSubmit={guardar} className="mcd-form">
            <div className="mcd-grid">
              <div className="mcd-campo mcd-campo--fijo">
                <label>Galones autorizados</label>
                <output>{fmtGal(autorizados)}</output>
              </div>
              <div className="mcd-campo">
                <label htmlFor="mcd-galones">Galones cargados</label>
                <input id="mcd-galones" ref={primerCampo} type="number" step="0.01" min="0" inputMode="decimal" required value={captura.galonesCargados} onChange={cambiar('galonesCargados')}
                  readOnly={!(costo > 0)} title={costo > 0 ? undefined : 'Sin costo por galón: corrige los galones desde Editar referencia'} />
              </div>
              <div className="mcd-campo mcd-campo--fijo">
                <label>Precio por galón</label>
                <output>{fmt(costo)}</output>
              </div>
              <div className="mcd-campo">
                <label htmlFor="mcd-descuento">Descuento</label>
                <input id="mcd-descuento" type="number" step="0.01" min="0" inputMode="decimal" value={captura.descuento} onChange={cambiar('descuento')}
                  placeholder={estimadoDesc > 0 ? `Estimado ${fmt(estimadoDesc)}` : 'Sin descuento'} />
              </div>
              <div className="mcd-campo">
                <label htmlFor="mcd-cobrado">Monto cobrado</label>
                <input id="mcd-cobrado" type="number" step="0.01" min="0" inputMode="decimal" value={captura.montoCobrado} onChange={cambiar('montoCobrado')}
                  placeholder={`Estimado ${fmt(esperado)}`} />
              </div>
            </div>
            <p className="mcd-ayuda">
              {esCargaMurphy(referencia)
                ? <>Del reporte de Murphy: el <b>Discount</b> va en Descuento y el <b>Net of Discount</b> en Monto cobrado. Lo que dejes vacío se estima con ${DESCUENTO_MURPHY_POR_GALON.toFixed(2)} por galón.</>
                : <>Captura lo que aparece cobrado en la tarjeta. Lo que dejes vacío se toma de galones × precio.</>}
            </p>

            <dl className="mcd-cuenta">
              <div><dt>Sin descuento</dt><dd>{fmt(c.sinDescuento)}</dd></div>
              <div><dt>Descuento{est.descuento ? ' (estimado)' : ''}</dt><dd className="mcd-menos">−{fmt(c.descuento)}</dd></div>
              <div className="mcd-cuenta__total"><dt>Cobrado{est.cobrado ? ' (estimado)' : ''}</dt><dd>{fmt(c.cobrado)}</dd></div>
              <div><dt>Dif. galones</dt><dd className={c.difGalones > 0.004 ? 'mcd-aviso' : ''}>{conSigno(c.difGalones, fmtGal)}</dd></div>
              <div><dt>Dif. monto</dt><dd>{conSigno(c.difMonto, fmt)}</dd></div>
            </dl>
            {c.cobradoCapturado && Math.abs(esperado - c.cobrado) > 0.004 && (
              <p className="mcd-nota">Lo cobrado difiere {conSigno(c.cobrado - esperado, fmt)} de sin descuento − descuento (por ejemplo, otro precio por galón en el reporte).</p>
            )}
            {aviso && avisoAceptado === aviso && <p className="mcd-error" role="alert">{aviso} Si está bien, presiona Guardar otra vez.</p>}
            {error && <p className="mcd-error" role="alert">{error}</p>}

            <div className="mcd-pie">
              <button type="button" className="mcd-btn" onClick={cerrar} disabled={guardando}>Cancelar</button>
              <button type="submit" className="mcd-btn mcd-btn--guardar" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </form>
      </div>
    </div>,
    document.body,
  );
}

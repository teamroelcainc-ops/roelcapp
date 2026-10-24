// src/features/operaciones/components/CorregirMonedasConvenioModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00487 — "Corregir monedas de convenio" (Operaciones). Operaciones sin Moneda Convenio
// (Cliente o Proveedor) se calculaban distinto en el formulario (Por Cobrar: con la moneda del
// convenio) y en Facturación (como si fuera la moneda de la factura). Esta ventana:
//   1) revisa TODAS las operaciones sin escribir nada y dice cuáles se corrigen, cuáles hay que
//      revisar a mano y cuáles no tienen de dónde sacar la moneda;
//   2) al confirmar, guarda la moneda del convenio y los montos recalculados, una por una.
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { registrarLog } from '../../../utils/logger';
import Importe, { NombreMoneda } from '../../facturacion/components/Importe';
import { etiquetaLado, resumirOperaciones } from '../services/corregirMonedaConvenio';
import type { CatalogoConvenios, Fuente, ResumenOperaciones, RevisionOperacion } from '../services/corregirMonedaConvenio';
import { corregirOperacion, leerConvenios, revisarTodas } from '../services/corregirMonedaConvenioDatos';
import './CorregirMonedasConvenioModal.css';

interface Props {
  onCerrar: () => void;
}

interface Problema { id: string; ref: string; motivo: string }

type Fase =
  | { tipo: 'convenios' }
  | { tipo: 'revisando'; leidas: number; total: number }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; resumen: ResumenOperaciones; cat: CatalogoConvenios }
  | { tipo: 'corrigiendo'; hechas: number; total: number }
  | { tipo: 'terminado'; corregidas: number; saltadas: Problema[]; fallidas: Problema[]; pendientes: number };

const MAX_FILAS = 200;
const HILOS = 4;
const FUENTE: Record<Fuente, string> = { ambas: 'Convenio y conversión', convenio: 'Su convenio', conversion: 'Conversión guardada' };
const n = (x: number): string => x.toLocaleString('es-MX');

function ListaProblemas({ titulo, filas }: { titulo: string; filas: readonly RevisionOperacion[] }) {
  if (filas.length === 0) return null;
  return (
    <details className="cmc-grupo">
      <summary>{titulo} ({n(filas.length)})</summary>
      <ul className="cmc-problemas">
        {filas.slice(0, MAX_FILAS).map((r) => (
          <li key={r.id}>
            <span className="cmc-ref">{r.ref}</span>
            {r.avisos.map((a) => <span key={a.lado} className="cmc-motivo">{etiquetaLado(a.lado)}: {a.motivo}</span>)}
          </li>
        ))}
      </ul>
      {filas.length > MAX_FILAS && <p className="cmc-nota">Se muestran {MAX_FILAS} de {n(filas.length)}.</p>}
    </details>
  );
}

export default function CorregirMonedasConvenioModal({ onCerrar }: Props) {
  const [fase, setFase] = useState<Fase>({ tipo: 'convenios' });
  const detener = useRef(false);

  // Revisión al abrir: solo lecturas.
  const revisar = useEffectEvent(async (sigue: () => boolean) => {
    try {
      const cat = await leerConvenios();
      if (!sigue()) return;
      const { revisiones, leidas } = await revisarTodas(cat, (a) => { if (sigue()) setFase({ tipo: 'revisando', ...a }); }, sigue);
      if (sigue()) setFase({ tipo: 'listo', resumen: resumirOperaciones(revisiones, leidas), cat });
    } catch (e) {
      console.error('No se pudieron revisar las operaciones:', e);
      if (sigue()) setFase({ tipo: 'error', mensaje: 'No se pudieron leer las operaciones o los convenios. Revisa la conexión e intenta de nuevo.' });
    }
  });
  useEffect(() => {
    let vivo = true;
    void revisar(() => vivo);
    return () => { vivo = false; };
  }, []);

  const corregir = async (resumen: ResumenOperaciones, cat: CatalogoConvenios) => {
    const lista = resumen.corregir;
    detener.current = false;
    const saltadas: Problema[] = [];
    const fallidas: Problema[] = [];
    let corregidas = 0;
    let siguiente = 0;
    let hechas = 0;
    setFase({ tipo: 'corrigiendo', hechas: 0, total: lista.length });
    const trabajar = async () => {
      while (siguiente < lista.length && !detener.current) {
        const r = lista[siguiente++];
        try {
          const res = await corregirOperacion(r.id, cat);
          if (res.tipo === 'corregida') corregidas += 1;
          else saltadas.push({ id: r.id, ref: r.ref, motivo: res.motivo });
        } catch (e) {
          console.error(`No se pudo corregir la operación ${r.ref}:`, e);
          fallidas.push({ id: r.id, ref: r.ref, motivo: String((e as { message?: string })?.message || e).split('\n')[0] });
        }
        hechas += 1;
        setFase({ tipo: 'corrigiendo', hechas, total: lista.length });
      }
    };
    await Promise.all(Array.from({ length: HILOS }, trabajar));
    void registrarLog('Operaciones', 'Edición',
      `Corregir monedas de convenio: ${corregidas} operación(es) corregida(s), ${saltadas.length} saltada(s), ${fallidas.length} con error${detener.current ? ' (detenido)' : ''}.`);
    setFase({ tipo: 'terminado', corregidas, saltadas, fallidas, pendientes: lista.length - hechas });
  };

  const trabajando = fase.tipo === 'corrigiendo';

  return createPortal(
    <div className="modal-overlay cmc-fondo" role="dialog" aria-modal="true" aria-labelledby="cmc-titulo">
      <div className="cmc-ventana">
        <header className="cmc-cabecera">
          <div>
            <h2 id="cmc-titulo" className="cmc-titulo">Corregir monedas de convenio</h2>
            <p className="cmc-sub">
              Operaciones sin Moneda Convenio (Cliente o Proveedor): se les pone la de su convenio o la que dice su
              conversión guardada, y se recalculan Dólares, Pesos, Conversión y Utilidad como en el formulario.
              Así Facturación da lo mismo que Por Cobrar.
            </p>
          </div>
          <button type="button" className="cmc-cerrar" onClick={onCerrar} disabled={trabajando} aria-label="Cerrar">✕</button>
        </header>

        {(fase.tipo === 'convenios' || fase.tipo === 'revisando') && (
          <div className="cmc-cuerpo">
            <CargandoDatos texto={fase.tipo === 'convenios' ? 'Leyendo los convenios…' : `Revisando operaciones: ${n(fase.leidas)} de ${n(fase.total)} leídas…`} />
            {fase.tipo === 'revisando' && fase.total > 0 && <progress className="cmc-avance" value={fase.leidas} max={fase.total} />}
            <p className="cmc-nota">Solo lee (una lectura por operación); no cambia nada hasta que confirmes.</p>
          </div>
        )}

        {fase.tipo === 'error' && (
          <div className="cmc-cuerpo"><p className="cmc-error" role="alert">{fase.mensaje}</p></div>
        )}

        {fase.tipo === 'listo' && (
          <>
            <div className="cmc-cuerpo">
              <ul className="cmc-cifras">
                <li className="cmc-cifra cmc-cifra--corregir"><b>{n(fase.resumen.corregir.length)}</b> se corrigen</li>
                <li className="cmc-cifra cmc-cifra--revisar"><b>{n(fase.resumen.revisar.length)}</b> para revisar</li>
                <li className="cmc-cifra"><b>{n(fase.resumen.sinDatos.length)}</b> sin datos</li>
                <li className="cmc-cifra cmc-cifra--leidas">{n(fase.resumen.leidas)} operaciones revisadas</li>
              </ul>
              {fase.resumen.corregir.length > 0 && (
                <p className="cmc-aviso">
                  {fase.resumen.cambianMonto > 0
                    ? <><b>{n(fase.resumen.cambianMonto)}</b> cambian lo que Facturación toma de ellas. </>
                    : <>Lo que Facturación toma de ellas ya era así (V00486); cambian la moneda y el Subtotal que muestra Por Cobrar. </>}
                  Después corre <b>Corregir monedas y montos</b> en Facturación para que sus facturas queden con estos montos.
                </p>
              )}

              {fase.resumen.corregir.length > 0 ? (
                <div className="cmc-tabla-caja">
                  <table className="cmc-tabla">
                    <thead>
                      <tr><th>Referencia</th><th>Lado</th><th>Moneda del convenio</th><th>De dónde</th><th className="cmc-num">Subtotal antes</th><th className="cmc-num">Subtotal nuevo</th><th className="cmc-num">Conversión</th></tr>
                    </thead>
                    <tbody>
                      {fase.resumen.corregir.slice(0, MAX_FILAS).flatMap((r) => r.cambios.map((c, i) => (
                        <tr key={`${r.id}-${c.lado}`} className={c.cambiaFactura ? 'cmc-fila--cambia' : undefined}>
                          <td className="cmc-ref">{i === 0 ? r.ref : ''}</td>
                          <td>{etiquetaLado(c.lado)}</td>
                          <td><NombreMoneda moneda={c.moneda} /></td>
                          <td className="cmc-fuente">{FUENTE[c.fuente]}</td>
                          <td className="cmc-num cmc-antes">{c.subtotalAntes > 0 ? <Importe monto={c.subtotalAntes} moneda={c.monedaFactura} /> : <span className="cmc-nada">—</span>}</td>
                          <td className="cmc-num"><Importe monto={c.subtotalDespues} moneda={c.monedaFactura} /></td>
                          <td className="cmc-num"><Importe monto={c.convDespues} moneda="MXN" /></td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                  {fase.resumen.corregir.length > MAX_FILAS && (
                    <p className="cmc-nota">Se muestran {MAX_FILAS} de {n(fase.resumen.corregir.length)}; se corrigen todas.</p>
                  )}
                </div>
              ) : (
                <p className="cmc-nota">No hay operaciones que corregir.</p>
              )}

              <ListaProblemas titulo="Para revisar en el formulario (no se tocan)" filas={fase.resumen.revisar} />
              <ListaProblemas titulo="Sin datos para saber la moneda (no se tocan)" filas={fase.resumen.sinDatos} />
            </div>
            <footer className="cmc-pie">
              <button type="button" className="cmc-btn" onClick={onCerrar}>Cerrar</button>
              <button type="button" className="cmc-btn cmc-btn--principal" disabled={fase.resumen.corregir.length === 0}
                onClick={() => { void corregir(fase.resumen, fase.cat); }}>
                Corregir {n(fase.resumen.corregir.length)} operaci{fase.resumen.corregir.length === 1 ? 'ón' : 'ones'}
              </button>
            </footer>
          </>
        )}

        {fase.tipo === 'corrigiendo' && (
          <>
            <div className="cmc-cuerpo">
              <p className="cmc-texto">Corrigiendo {n(fase.hechas)} de {n(fase.total)}… No cierres esta pestaña.</p>
              <progress className="cmc-avance" value={fase.hechas} max={fase.total} />
            </div>
            <footer className="cmc-pie">
              <button type="button" className="cmc-btn" onClick={() => { detener.current = true; }}>Detener</button>
            </footer>
          </>
        )}

        {fase.tipo === 'terminado' && (
          <>
            <div className="cmc-cuerpo">
              <ul className="cmc-cifras">
                <li className="cmc-cifra cmc-cifra--corregir"><b>{n(fase.corregidas)}</b> corregidas</li>
                {fase.saltadas.length > 0 && <li className="cmc-cifra cmc-cifra--revisar"><b>{n(fase.saltadas.length)}</b> saltadas al guardar</li>}
                {fase.fallidas.length > 0 && <li className="cmc-cifra cmc-cifra--error"><b>{n(fase.fallidas.length)}</b> con error</li>}
                {fase.pendientes > 0 && <li className="cmc-cifra"><b>{n(fase.pendientes)}</b> sin hacer (detenido)</li>}
              </ul>
              {[...fase.fallidas, ...fase.saltadas].length > 0 && (
                <ul className="cmc-problemas">
                  {[...fase.fallidas, ...fase.saltadas].slice(0, 100).map((p) => (
                    <li key={p.id}><span className="cmc-ref">{p.ref}</span><span className="cmc-motivo">{p.motivo}</span></li>
                  ))}
                </ul>
              )}
              <p className="cmc-nota">Las listas que ya estaban abiertas muestran los montos nuevos al presionar Actualizar o Buscar.</p>
            </div>
            <footer className="cmc-pie">
              <button type="button" className="cmc-btn cmc-btn--principal" onClick={onCerrar}>Listo</button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

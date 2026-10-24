// src/features/facturacion/components/CorregirFacturasModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00482 — "Corregir monedas y montos" (Facturación de Clientes y de Proveedores).
//   1) Revisa TODAS las facturas cargadas: lee sus operaciones (sin escribir nada) y dice cuáles
//      cambian, cuáles ya están bien y cuáles se saltan (y por qué).
//   2) Al confirmar, corrige una por una con datos frescos: moneda = la de su empresa en Empresas;
//      total = Dólares (Cliente/Proveedor) o Conversión Final de sus operaciones.
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Lado } from '../../../shared/dominio/dinero';
import { LADOS } from '../../../shared/dominio/facturacion';
import type { Moneda } from '../../../shared/dominio/moneda';
import { registrarLog } from '../../../utils/logger';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { idsDeOperaciones, resumirRevision, revisarFactura } from '../services/corregirFacturas';
import type { ResumenRevision } from '../services/corregirFacturas';
import { corregirFactura, leerOperaciones, usuarioCorrige } from '../services/corregirFacturasDatos';
import { mensajeDinero } from '../services/dineroServidor';
import Importe, { NombreMoneda } from './Importe';
import './CorregirFacturasModal.css';

type FacturaCargada = Record<string, unknown> & { id: string };

interface Props {
  lado: Lado;
  /** Las facturas cargadas en el módulo (todas, no solo las filtradas). */
  facturas: readonly FacturaCargada[];
  monedaDe: (empresaId: string) => Moneda | null;
  nombreDe: (empresaId: string, factura: FacturaCargada) => string;
  /** Con la bandera dineroPorServidor el total lo escribe el servidor. */
  conServidor: boolean;
  /** Campos escritos por factura (id → campos), para refrescar la lista sin volver a leerla. */
  onCorregidas: (cambios: Record<string, Record<string, unknown>>) => void;
  onCerrar: () => void;
}

interface Problema { id: string; invoice: string; motivo: string }

type Fase =
  | { tipo: 'revisando'; leidas: number; total: number }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; resumen: ResumenRevision }
  | { tipo: 'corrigiendo'; hechas: number; total: number }
  | { tipo: 'terminado'; corregidas: number; saltadas: Problema[]; fallidas: Problema[]; pendientes: number };

const MAX_FILAS = 200;
const HILOS = 4;

export default function CorregirFacturasModal({ lado, facturas, monedaDe, nombreDe, conServidor, onCorregidas, onCerrar }: Props) {
  const [fase, setFase] = useState<Fase>({ tipo: 'revisando', leidas: 0, total: 0 });
  const detener = useRef(false);
  const campoEmpresa = LADOS[lado].campoEmpresa;
  const quien = lado === 'cliente' ? 'cliente' : 'proveedor';

  // Revisión al abrir: solo lecturas (las operaciones de las facturas, por lotes de 30).
  const revisar = useEffectEvent(async (sigue: () => boolean) => {
    try {
      const ids = facturas.flatMap((f) => idsDeOperaciones(f));
      const ops = await leerOperaciones(ids, (leidas, total) => { if (sigue()) setFase({ tipo: 'revisando', leidas, total }); });
      if (!sigue()) return;
      const ahora = new Date().toISOString();
      const usuario = usuarioCorrige();
      const revisiones = facturas.map((f) => {
        const empresaId = String(f[campoEmpresa] ?? '');
        const suyas = idsDeOperaciones(f).map((id) => ops.get(id)).filter((o) => o !== undefined);
        return revisarFactura(lado, { id: f.id, datos: f }, suyas, monedaDe(empresaId), nombreDe(empresaId, f), ahora, usuario);
      });
      setFase({ tipo: 'listo', resumen: resumirRevision(revisiones) });
    } catch (e) {
      console.error('No se pudieron revisar las facturas:', e);
      if (sigue()) setFase({ tipo: 'error', mensaje: 'No se pudieron leer las operaciones de las facturas. Revisa la conexión e intenta de nuevo.' });
    }
  });
  useEffect(() => {
    let vivo = true;
    void revisar(() => vivo);
    return () => { vivo = false; };
  }, []);

  const corregir = async (resumen: ResumenRevision) => {
    const lista = resumen.corregir;
    detener.current = false;
    const cambios: Record<string, Record<string, unknown>> = {};
    const saltadas: Problema[] = [];
    const fallidas: Problema[] = [];
    let siguiente = 0;
    let hechas = 0;
    setFase({ tipo: 'corrigiendo', hechas: 0, total: lista.length });
    const trabajar = async () => {
      while (siguiente < lista.length && !detener.current) {
        const r = lista[siguiente++];
        try {
          const res = await corregirFactura(lado, r, r.monedaNueva as Moneda, conServidor, r.empresa);
          if (res.tipo === 'corregida') cambios[r.id] = res.datos;
          else saltadas.push({ id: r.id, invoice: r.invoice, motivo: res.motivo });
        } catch (e) {
          console.error(`No se pudo corregir la factura ${r.invoice}:`, e);
          fallidas.push({ id: r.id, invoice: r.invoice, motivo: mensajeDinero(e, 'No se pudo guardar').split('\n')[0] });
        }
        hechas += 1;
        setFase({ tipo: 'corrigiendo', hechas, total: lista.length });
      }
    };
    await Promise.all(Array.from({ length: HILOS }, trabajar));
    const corregidas = Object.keys(cambios).length;
    onCorregidas(cambios);
    void registrarLog(lado === 'cliente' ? 'Facturación Clientes' : 'Facturación Proveedores', 'Edición',
      `Corregir monedas y montos: ${corregidas} factura(s) corregida(s), ${saltadas.length} saltada(s), ${fallidas.length} con error${detener.current ? ' (detenido)' : ''}.`);
    setFase({ tipo: 'terminado', corregidas, saltadas, fallidas, pendientes: lista.length - hechas });
  };

  const trabajando = fase.tipo === 'revisando' || fase.tipo === 'corrigiendo';

  return createPortal(
    <div className="modal-overlay crf-fondo" role="dialog" aria-modal="true" aria-labelledby="crf-titulo">
      <div className="crf-ventana">
        <header className="crf-cabecera">
          <div>
            <h2 id="crf-titulo" className="crf-titulo">Corregir monedas y montos</h2>
            <p className="crf-sub">
              Cada factura queda en la moneda de su {quien} en Empresas, con el total de sus operaciones:
              en <NombreMoneda moneda="USD" /> la suma de Dólares; en <NombreMoneda moneda="MXN" /> la Conversión Final.
              Las que tienen pagos también: su saldo se recalcula con lo ya pagado (los pagos no se tocan).
            </p>
          </div>
          <button type="button" className="crf-cerrar" onClick={onCerrar} disabled={trabajando} aria-label="Cerrar">✕</button>
        </header>

        {fase.tipo === 'revisando' && (
          <div className="crf-cuerpo">
            <CargandoDatos texto={fase.total > 0 ? `Revisando ${facturas.length.toLocaleString('es-MX')} facturas: ${fase.leidas.toLocaleString('es-MX')} de ${fase.total.toLocaleString('es-MX')} operaciones leídas…` : `Revisando ${facturas.length.toLocaleString('es-MX')} facturas…`} />
            {fase.total > 0 && <progress className="crf-avance" value={fase.leidas} max={fase.total} />}
          </div>
        )}

        {fase.tipo === 'error' && (
          <div className="crf-cuerpo"><p className="crf-error" role="alert">{fase.mensaje}</p></div>
        )}

        {fase.tipo === 'listo' && (
          <>
            <div className="crf-cuerpo">
              <ul className="crf-cifras">
                <li className="crf-cifra crf-cifra--corregir"><b>{fase.resumen.corregir.length.toLocaleString('es-MX')}</b> se corrigen</li>
                <li className="crf-cifra"><b>{fase.resumen.bien.toLocaleString('es-MX')}</b> ya están bien</li>
                <li className="crf-cifra crf-cifra--saltar"><b>{fase.resumen.omitidas.length.toLocaleString('es-MX')}</b> se saltan</li>
              </ul>
              {fase.resumen.conPagos > 0 && (/* ✅ V00483 */
                <p className="crf-aviso-pagos">
                  {fase.resumen.conPagos.toLocaleString('es-MX')} de las que se corrigen tienen pagos: su saldo se recalcula.
                  {fase.resumen.deMas > 0 && <> <b>{fase.resumen.deMas.toLocaleString('es-MX')}</b> quedan <b>pagadas de más</b> (lo pagado pasa del total nuevo): quedan Pagadas con saldo $0; revísalas en Pagos.</>}
                </p>
              )}

              {fase.resumen.corregir.length > 0 ? (
                <div className="crf-tabla-caja">
                  <table className="crf-tabla">
                    <thead>
                      <tr><th>Factura</th><th>{lado === 'cliente' ? 'Cliente' : 'Proveedor'}</th><th>Moneda</th><th className="crf-num">Total antes</th><th className="crf-num">Total nuevo</th><th className="crf-num">Pagado</th></tr>
                    </thead>
                    <tbody>
                      {fase.resumen.corregir.slice(0, MAX_FILAS).map((r) => (
                        <tr key={r.id} className={r.pagadoDeMas > 0.009 ? 'crf-fila--demas' : undefined}>
                          <td className="crf-folio">{r.invoice}</td>
                          <td className="crf-empresa">{r.empresa || '—'}</td>
                          <td>
                            {r.monedaAntes === r.monedaNueva
                              ? <NombreMoneda moneda={r.monedaNueva} />
                              : <><NombreMoneda moneda={r.monedaAntes} respaldo="Sin moneda" /> → <NombreMoneda moneda={r.monedaNueva} /></>}
                          </td>
                          <td className="crf-num"><Importe monto={r.totalAntes} moneda={r.monedaAntes} /></td>
                          <td className="crf-num"><Importe monto={r.totalNuevo} moneda={r.monedaNueva} /></td>
                          <td className="crf-num">
                            {r.pagado > 0.009 ? <Importe monto={r.pagado} moneda={r.monedaNueva} /> : <span className="crf-nada">—</span>}
                            {r.pagadoDeMas > 0.009 && <span className="crf-demas">de más <Importe monto={r.pagadoDeMas} moneda={r.monedaNueva} /></span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {fase.resumen.corregir.length > MAX_FILAS && (
                    <p className="crf-nota">Se muestran {MAX_FILAS} de {fase.resumen.corregir.length.toLocaleString('es-MX')}; se corrigen todas.</p>
                  )}
                </div>
              ) : (
                <p className="crf-nota">No hay facturas que corregir.</p>
              )}

              {fase.resumen.porMotivo.length > 0 && (
                <details className="crf-saltadas">
                  <summary>Facturas que se saltan ({fase.resumen.omitidas.length.toLocaleString('es-MX')})</summary>
                  <ul className="crf-motivos">
                    {fase.resumen.porMotivo.map((m) => (
                      <li key={m.motivo}>
                        <span className="crf-motivo">{m.motivo}</span> <b>{m.n.toLocaleString('es-MX')}</b>
                        <span className="crf-folios">
                          {fase.resumen.omitidas.filter((r) => r.motivo === m.motivo).slice(0, 40).map((r) => r.invoice).join(', ')}
                          {m.n > 40 ? '…' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <footer className="crf-pie">
              <button type="button" className="crf-btn" onClick={onCerrar}>Cerrar</button>
              <button type="button" className="crf-btn crf-btn--principal" disabled={fase.resumen.corregir.length === 0}
                onClick={() => { void corregir(fase.resumen); }}>
                Corregir {fase.resumen.corregir.length.toLocaleString('es-MX')} factura{fase.resumen.corregir.length === 1 ? '' : 's'}
              </button>
            </footer>
          </>
        )}

        {fase.tipo === 'corrigiendo' && (
          <>
            <div className="crf-cuerpo">
              <p className="crf-texto">Corrigiendo {fase.hechas.toLocaleString('es-MX')} de {fase.total.toLocaleString('es-MX')}… No cierres esta pestaña.</p>
              <progress className="crf-avance" value={fase.hechas} max={fase.total} />
            </div>
            <footer className="crf-pie">
              <button type="button" className="crf-btn" onClick={() => { detener.current = true; }}>Detener</button>
            </footer>
          </>
        )}

        {fase.tipo === 'terminado' && (
          <>
            <div className="crf-cuerpo">
              <ul className="crf-cifras">
                <li className="crf-cifra crf-cifra--corregir"><b>{fase.corregidas.toLocaleString('es-MX')}</b> corregidas</li>
                {fase.saltadas.length > 0 && <li className="crf-cifra crf-cifra--saltar"><b>{fase.saltadas.length.toLocaleString('es-MX')}</b> saltadas al guardar</li>}
                {fase.fallidas.length > 0 && <li className="crf-cifra crf-cifra--error"><b>{fase.fallidas.length.toLocaleString('es-MX')}</b> con error</li>}
                {fase.pendientes > 0 && <li className="crf-cifra"><b>{fase.pendientes.toLocaleString('es-MX')}</b> sin hacer (detenido)</li>}
              </ul>
              {[...fase.fallidas, ...fase.saltadas].length > 0 && (
                <ul className="crf-lista">
                  {[...fase.fallidas, ...fase.saltadas].slice(0, 100).map((p) => (
                    <li key={p.id}><span className="crf-folio">{p.invoice}</span> — {p.motivo}</li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="crf-pie">
              <button type="button" className="crf-btn crf-btn--principal" onClick={onCerrar}>Listo</button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

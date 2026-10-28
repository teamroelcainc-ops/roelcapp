// src/features/empresas/components/PasarOperacionesModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00508 — "Pasar a otra empresa" (Referencias de una empresa): las operaciones elegidas cambian
// de empresa en el papel que se elige (p. ej. Proveedor (Unidad) de Monar → Jose Fernando). Si hay
// facturadas, la ventana pregunta qué hacer con ellas antes de dejar pasar nada. Muestra qué pasa
// y qué no (con el motivo) y pide confirmar. La regla está en services/pasarOperaciones.ts y la
// escritura (en transacción) en services/pasarOperacionesEscritura.ts.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import type { DocCatalogo } from '../../../shared/data/catalogos';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { idsDeRegistro } from '../../../shared/data/indiceCatalogo';
import { razonSocialEmpresa } from '../../../shared/dominio/nombres';
import { normalizarTexto } from '../../../shared/dominio/texto';
import { etiquetaPapel, PAPELES_EMPRESA, papelesDeEmpresa, planDePase } from '../services/pasarOperaciones';
import type { Lado, ModoFacturadas, Papel } from '../services/pasarOperaciones';
import { ejecutarPase, leerDatosDePase } from '../services/pasarOperacionesEscritura';
import type { DatosDePase, ResultadoPase } from '../services/pasarOperacionesEscritura';
import type { OperacionReferencia } from '../services/referenciasEmpresa';
import './PasarOperacionesModal.css';

interface Props {
  /** Registro de Empresas de la empresa abierta (con su `_docId`). */
  origen: DocCatalogo;
  operaciones: readonly OperacionReferencia[];
  empresas: readonly DocCatalogo[];
  onCerrar: () => void;
  /** Después de pasar (para releer Referencias). */
  onListo: () => void;
}

const miles = (n: number): string => n.toLocaleString('es-MX');
const MAX_COINCIDENCIAS = 8;
const idsDe = (e: DocCatalogo): string[] => Array.from(new Set([...idsDeRegistro(e), String(e.id)])).filter(Boolean);

export default function PasarOperacionesModal({ origen, operaciones, empresas, onCerrar, onListo }: Props) {
  const idsOrigen = idsDe(origen);
  const nombreOrigen = razonSocialEmpresa(origen);
  const elegidas = operaciones.map((o) => ({ ...o, id: idReal(o) }));
  const presentes = PAPELES_EMPRESA
    .map((p) => ({ ...p, n: elegidas.filter((o) => papelesDeEmpresa(o, idsOrigen).includes(p.campo)).length }))
    .filter((p) => p.n > 0);

  const [busqueda, setBusqueda] = useState('');
  const [destino, setDestino] = useState<DocCatalogo | null>(null);
  const [papeles, setPapeles] = useState<Papel[]>(() => (presentes.length === 1 ? [presentes[0].campo] : []));
  const [modo, setModo] = useState<ModoFacturadas | null>(null);
  const [datos, setDatos] = useState<DatosDePase | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoPase | null>(null);
  const [error, setError] = useState('');
  const pasando = avance !== null && resultado === null;
  const ocupado = leyendo || pasando;

  const lados = Array.from(new Set(papeles.map((p) => PAPELES_EMPRESA.find((x) => x.campo === p)?.lado).filter((l): l is Lado => !!l)));

  /** Facturas y pagos: solo hacen falta para pasar "con su factura" (y dependen de la destino). */
  const cargarDatos = async (dest: DocCatalogo, ls: Lado[]) => {
    setDatos(null);
    if (ls.length === 0) return;
    setLeyendo(true);
    setError('');
    try {
      setDatos(await leerDatosDePase(idsOrigen, idsDe(dest), ls));
    } catch (e) {
      console.error('No se pudieron leer las facturas y pagos para pasar operaciones:', e);
      setError('No se pudieron leer las facturas y los pagos de la empresa. Revisa la conexión e intenta de nuevo.');
    } finally {
      setLeyendo(false);
    }
  };

  const elegirDestino = (e: DocCatalogo) => {
    setDestino(e); setBusqueda(''); setConfirmando(false);
    if (modo === 'conFactura') void cargarDatos(e, lados);
  };
  const cambiarPapel = (p: Papel, activo: boolean) => {
    const siguientes = activo ? [...papeles, p] : papeles.filter((x) => x !== p);
    setPapeles(siguientes); setConfirmando(false);
    if (modo === 'conFactura' && destino) void cargarDatos(destino, Array.from(new Set(siguientes.map((x) => PAPELES_EMPRESA.find((y) => y.campo === x)?.lado).filter((l): l is Lado => !!l))));
  };
  const elegirModo = (m: ModoFacturadas) => {
    setModo(m); setConfirmando(false);
    if (m === 'conFactura' && destino) void cargarDatos(destino, lados); else setDatos(null);
  };

  const plan = planDePase({
    idsOrigen, operaciones: elegidas, papeles, modo,
    facturas: datos?.facturas, pagos: datos?.pagos, foliosDestino: datos?.foliosDestino,
  });
  const nombreDestino = destino ? razonSocialEmpresa(destino) : '';
  const faltaDatos = modo === 'conFactura' && plan.facturadas > 0 && !datos;
  const listo = !!destino && papeles.length > 0 && !plan.falta && !faltaDatos && plan.operaciones.length > 0;

  const q = normalizarTexto(busqueda);
  const coincidencias = q.length < 2 ? [] : empresas
    .filter((e) => !idsDe(e).some((id) => idsOrigen.includes(id)))
    .filter((e) => [e.nombre, e.nombreCorto, e.razonSocial, e.numCliente].some((v) => normalizarTexto(v).includes(q)))
    .slice(0, MAX_COINCIDENCIAS);

  const pasar = async () => {
    if (!destino || !listo) return;
    setError('');
    setAvance({ hechas: 0, total: plan.operaciones.length });
    try {
      const r = await ejecutarPase({
        plan, modo, papeles, idsOrigen, origenNombre: nombreOrigen,
        idDestino: String(destino.id), destino, destinoNombre: nombreDestino,
      }, (hechas, total) => setAvance({ hechas, total }));
      setResultado(r);
    } catch (e) {
      console.error('No se pudieron pasar las operaciones:', e);
      setError('No se terminó de pasar. Lo que ya se escribió quedó bien (cada tanda es todo o nada): presiona Actualizar en Referencias y vuelve a elegir las que falten.');
      setAvance(null);
    }
  };

  const cerrar = () => (resultado ? onListo() : onCerrar());
  const omitidasPorMotivo = Array.from((resultado?.omitidas ?? plan.omitidas).reduce((m, o) => m.set(o.motivo, [...(m.get(o.motivo) ?? []), o.ref]), new Map<string, string[]>()));

  return createPortal(
    <div className="modal-overlay pso-fondo" role="dialog" aria-modal="true" aria-labelledby="pso-titulo">
      <div className="pso-ventana">
        <header className="pso-cabecera">
          <div>
            <h2 id="pso-titulo" className="pso-titulo">Pasar {miles(elegidas.length)} {elegidas.length === 1 ? 'operación' : 'operaciones'} a otra empresa</h2>
            <p className="pso-sub">
              De <b>{nombreOrigen}</b>. Solo cambia la empresa en el papel que elijas: montos, convenio y moneda se quedan como están.
            </p>
          </div>
          <button type="button" className="pso-cerrar" onClick={cerrar} disabled={ocupado} aria-label="Cerrar">✕</button>
        </header>

        <div className="pso-cuerpo">
          {resultado ? (
            <section className="pso-listo" aria-label="Resultado">
              <p className="pso-listo-titulo">
                Se {resultado.pasadas.length === 1 ? 'pasó 1 operación' : `pasaron ${miles(resultado.pasadas.length)} operaciones`} a {nombreDestino}
                {resultado.facturas.length > 0 ? `, con ${resultado.facturas.length === 1 ? 'su factura' : `${resultado.facturas.length} facturas`} (${resultado.facturas.join(', ')})` : ''}
                {resultado.pagos > 0 ? ` y ${resultado.pagos === 1 ? '1 pago' : `${resultado.pagos} pagos`}` : ''}.
              </p>
              <p className="pso-ayuda">Puede tardar unos segundos en salir de la lista de {nombreOrigen}: el servidor actualiza sus datos. Quedó en la bitácora.</p>
            </section>
          ) : (
            <>
              <section className="pso-paso" aria-labelledby="pso-destino">
                <h3 id="pso-destino" className="pso-paso-titulo">Empresa a la que pasan</h3>
                {destino ? (
                  <div className="pso-elegida">
                    <span><b>{nombreDestino}</b>{destino.numCliente ? ` · ${String(destino.numCliente)}` : ''}</span>
                    <button type="button" className="pso-link" onClick={() => { setDestino(null); setDatos(null); setConfirmando(false); }} disabled={ocupado}>Cambiar</button>
                  </div>
                ) : (
                  <>
                    <input type="search" className="pso-buscar" placeholder="Busca por razón social, nombre corto o # de cliente…" value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar la empresa destino" autoFocus />
                    {coincidencias.length > 0 && (
                      <ul className="pso-opciones">
                        {coincidencias.map((e) => (
                          <li key={idReal(e)}>
                            <button type="button" className="pso-opcion" onClick={() => elegirDestino(e)}>
                              <span className="pso-opcion-nombre">{razonSocialEmpresa(e)}</span>
                              <span className="pso-opcion-meta">{[e.numCliente, e.nombreCorto].filter(Boolean).map(String).join(' · ')}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.length >= 2 && coincidencias.length === 0 && <p className="pso-ayuda">Ninguna empresa coincide.</p>}
                  </>
                )}
              </section>

              <section className="pso-paso" aria-labelledby="pso-papel">
                <h3 id="pso-papel" className="pso-paso-titulo">Papel que cambia</h3>
                {presentes.length === 0 ? (
                  <p className="pso-ayuda">{nombreOrigen} no aparece en ningún papel de estas operaciones.</p>
                ) : (
                  <div className="pso-papeles">
                    {presentes.map((p) => (
                      <label key={p.campo} className="pso-check">
                        <input type="checkbox" checked={papeles.includes(p.campo)} disabled={ocupado} onChange={(e) => cambiarPapel(p.campo, e.target.checked)} />
                        {p.etiqueta} <span className="pso-cuenta">{miles(p.n)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {plan.facturadas > 0 && (
                <section className="pso-paso pso-paso--pregunta" aria-labelledby="pso-facturadas">
                  <h3 id="pso-facturadas" className="pso-paso-titulo">
                    {plan.facturadas === 1 ? '1 operación ya está facturada' : `${miles(plan.facturadas)} operaciones ya están facturadas`} como {papeles.map(etiquetaPapel).join(' o ')}. ¿Qué hago con ellas?
                  </h3>
                  <div className="pso-modos" role="radiogroup" aria-labelledby="pso-facturadas">
                    {([
                      ['dejar', 'No pasarlas', 'Se quedan con ' + nombreOrigen + '.'],
                      ['sinFactura', 'Pasarlas sin tocar su factura', `La operación pasa; la factura y sus pagos siguen a nombre de ${nombreOrigen}.`],
                      ['conFactura', 'Pasarlas con su factura', `La factura y sus pagos también pasan${nombreDestino ? ` a ${nombreDestino}` : ''}. Solo si todas las operaciones de la factura se pasan.`],
                    ] as const).map(([m, titulo, detalle]) => (
                      <label key={m} className={`pso-modo${modo === m ? ' pso-modo--activo' : ''}`}>
                        <input type="radio" name="pso-modo" checked={modo === m} disabled={ocupado} onChange={() => elegirModo(m)} />
                        <span><b>{titulo}</b><br /><span className="pso-modo-detalle">{detalle}</span></span>
                      </label>
                    ))}
                  </div>
                  {modo === 'conFactura' && !destino && <p className="pso-ayuda">Elige la empresa destino para revisar sus facturas.</p>}
                  {leyendo && <CargandoDatos compacto texto="Revisando facturas y pagos…" />}
                </section>
              )}
            </>
          )}

          {pasando && avance && (
            <div className="pso-avance">
              <CargandoDatos compacto texto={`Pasando operaciones… ${miles(avance.hechas)} de ${miles(avance.total)}`} />
              <progress className="pso-progreso" max={Math.max(avance.total, 1)} value={avance.hechas} />
            </div>
          )}

          {!resultado && papeles.length > 0 && !pasando && (
            <section className="pso-resumen" aria-label="Qué se va a pasar">
              <p className="pso-resumen-linea">
                <b>{miles(plan.operaciones.length)}</b> {plan.operaciones.length === 1 ? 'operación pasa' : 'operaciones pasan'}{nombreDestino ? ` a ${nombreDestino}` : ''}
                {plan.facturas.length > 0 ? `, con ${plan.facturas.length === 1 ? '1 factura' : `${plan.facturas.length} facturas`} (${plan.facturas.map((f) => f.invoice || f.id).join(', ')})` : ''}
                {plan.pagos.length > 0 ? ` y ${plan.pagos.length === 1 ? '1 pago' : `${plan.pagos.length} pagos`}` : ''}.
              </p>
              {plan.operaciones.length > 0 && <p className="pso-refs">{plan.operaciones.map((o) => o.ref).join(', ')}</p>}
            </section>
          )}

          {omitidasPorMotivo.length > 0 && !pasando && (
            <section className="pso-omitidas" aria-label="No se pasan">
              <p className="pso-omitidas-titulo">No {resultado ? 'se pasaron' : 'se pasan'}:</p>
              <ul className="pso-motivos">
                {omitidasPorMotivo.map(([motivo, refs]) => (
                  <li key={motivo}><b>{motivo}</b> ({miles(refs.length)}): {refs.join(', ')}</li>
                ))}
              </ul>
            </section>
          )}

          {error && <p className="pso-error" role="alert">{error}</p>}
        </div>

        <footer className="pso-pie">
          {resultado ? (
            <button type="button" className="pso-btn pso-btn--principal" onClick={onListo}>Cerrar y actualizar</button>
          ) : confirmando ? (
            <>
              <span className="pso-confirmar">¿Pasar {miles(plan.operaciones.length)} {plan.operaciones.length === 1 ? 'operación' : 'operaciones'} de {nombreOrigen} a {nombreDestino}?</span>
              <button type="button" className="pso-btn" onClick={() => setConfirmando(false)} disabled={pasando}>No</button>
              <button type="button" className="pso-btn pso-btn--principal" onClick={pasar} disabled={pasando || !listo}>Sí, pasar</button>
            </>
          ) : (
            <>
              <button type="button" className="pso-btn" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
              <button type="button" className="pso-btn pso-btn--principal" onClick={() => setConfirmando(true)} disabled={!listo || ocupado}>
                <ArrowRightLeft size={15} aria-hidden="true" /> Pasar {miles(plan.operaciones.length)}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

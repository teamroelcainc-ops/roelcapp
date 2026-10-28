// src/features/operaciones/components/RevisionDatosModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00505 — "Revisión de datos" (barra de Operaciones). SOLO LECTURA: no lee nada hasta que el
// usuario presiona Revisar; entonces recorre operaciones y facturas de clientes (con avance) y lista
// cada error del reporte del 27-oct por grupo, con un botón para abrir cada registro y un Excel.
// La regla está en services/revisionDatos.ts y las lecturas en services/revisionDatosLectura.ts.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FileSpreadsheet, RefreshCw } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { abrirRegistro } from '../../../shared/data/aperturas';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { descargarExcel } from '../services/excelOperaciones';
import { GRUPOS_REVISION, filasExcelRevision } from '../services/revisionDatos';
import type { CodigoRevision, DestinoRevision, FilaRevision } from '../services/revisionDatos';
import { leerYRevisarDatos, ultimaRevisionDatos } from '../services/revisionDatosLectura';
import type { AvanceRevisionDatos, RevisionGuardada } from '../services/revisionDatosLectura';
import './RevisionDatosModal.css';

const POR_PAGINA = 100;
const miles = (n: number): string => n.toLocaleString('es-MX');
const hora = (d: Date): string => d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function Fila({ f, onAbrir }: { f: FilaRevision; onAbrir: (d: DestinoRevision) => void }) {
  return (
    <li className="rvd-fila">
      <div className="rvd-fila-datos">
        <span className="rvd-ref">{f.ref}</span>
        <span className="rvd-meta">{[f.cliente, f.fecha || 'sin fecha', f.status, f.invoice && `Invoice ${f.invoice}`].filter(Boolean).join(' · ')}</span>
        <span className="rvd-detalle">{f.detalle}</span>
      </div>
      <div className="rvd-fila-acciones">
        <button type="button" className="rvd-abrir" onClick={() => onAbrir(f.destino)} title="Abrir su ficha en su módulo">
          <ExternalLink size={13} aria-hidden="true" /> Abrir
        </button>
        {f.enlaces.map((e) => (
          <button type="button" key={`${e.destino.modulo}:${e.destino.id}`} className="rvd-enlace" onClick={() => onAbrir(e.destino)}>{e.texto}</button>
        ))}
      </div>
    </li>
  );
}

export default function RevisionDatosModal({ onCerrar }: { onCerrar: () => void }) {
  const [revision, setRevision] = useState<RevisionGuardada | null>(() => ultimaRevisionDatos());
  const [revisando, setRevisando] = useState(false);
  const [avance, setAvance] = useState<AvanceRevisionDatos | null>(null);
  const [error, setError] = useState('');
  const [grupo, setGrupo] = useState<CodigoRevision>('F4');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [exportando, setExportando] = useState(false);

  const revisar = async () => {
    setRevisando(true);
    setError('');
    setAvance(null);
    try {
      const r = await leerYRevisarDatos(setAvance);
      setRevision(r);
      setGrupo(GRUPOS_REVISION.find((g) => r.resultado.conteo[g.codigo] > 0)?.codigo ?? 'F4');
      setMostrar(POR_PAGINA);
    } catch (e) {
      console.error('No se pudo hacer la revisión de datos:', e);
      setError('No se pudieron leer las operaciones, las facturas, Empresas o el catálogo de status. Revisa la conexión e intenta de nuevo.');
    } finally {
      setRevisando(false);
    }
  };

  const abrir = (d: DestinoRevision) => {
    onCerrar();
    abrirRegistro(d.modulo, d.id);
  };

  const exportar = async () => {
    if (!revision) return;
    setExportando(true);
    try {
      await descargarExcel({ filas: filasExcelRevision(revision.resultado), columnasMoneda: [] }, 'Revisión', `Revision_datos_${hoyLocalISO()}.xlsx`);
    } catch (e) {
      console.error('No se pudo armar el Excel de la revisión:', e);
      setError('No se pudo armar el Excel. Intenta de nuevo.');
    } finally {
      setExportando(false);
    }
  };

  const r = revision?.resultado ?? null;
  const elegido = GRUPOS_REVISION.find((g) => g.codigo === grupo) ?? GRUPOS_REVISION[0];
  const filas = r ? r.filas.filter((f) => f.codigo === grupo) : [];
  const elegir = (codigo: CodigoRevision) => { setGrupo(codigo); setMostrar(POR_PAGINA); };

  return createPortal(
    <div className="modal-overlay rvd-fondo" role="dialog" aria-modal="true" aria-labelledby="rvd-titulo">
      <div className="rvd-ventana">
        <header className="rvd-cabecera">
          <div>
            <h2 id="rvd-titulo" className="rvd-titulo">Revisión de datos</h2>
            <p className="rvd-sub">
              Revisa todas las operaciones y las facturas de clientes y lista los errores por grupo. Solo lee: no cambia nada.
              Abre cada registro para corregirlo en su módulo.
            </p>
          </div>
          <button type="button" className="rvd-cerrar" onClick={onCerrar} disabled={revisando} aria-label="Cerrar">✕</button>
        </header>

        <div className="rvd-barra">
          <button type="button" className="rvd-btn rvd-btn--principal" onClick={revisar} disabled={revisando}>
            <RefreshCw size={14} aria-hidden="true" /> {r ? 'Revisar de nuevo' : 'Revisar'}
          </button>
          <button type="button" className="rvd-btn" onClick={exportar} disabled={!r || revisando || exportando}>
            <FileSpreadsheet size={14} aria-hidden="true" /> {exportando ? 'Armando el Excel…' : 'Excel'}
          </button>
          {revision && !revisando && (
            <span className="rvd-resumen">
              {miles(r?.operaciones ?? 0)} operaciones y {miles(r?.facturas ?? 0)} facturas revisadas el {hora(revision.en)}
            </span>
          )}
        </div>

        <div className="rvd-cuerpo">
          {error && <p className="rvd-error" role="alert">{error}</p>}
          {revisando && (
            <div className="rvd-avance">
              <CargandoDatos compacto texto={avance ? `Leyendo operaciones… ${miles(avance.leidas)} de ${miles(avance.total)}` : 'Contando operaciones…'} />
              {avance && <progress className="rvd-progreso" max={Math.max(avance.total, 1)} value={avance.leidas} />}
            </div>
          )}
          {!revisando && !r && !error && (
            <p className="rvd-vacio">Presiona Revisar. Lee todas las operaciones (tarda unos segundos y avisa cuántas lleva) y las facturas de clientes.</p>
          )}
          {!revisando && r && (
            <div className="rvd-resultado">
              <ul className="rvd-grupos" aria-label="Grupos de errores">
                {GRUPOS_REVISION.map((g) => (
                  <li key={g.codigo}>
                    <button type="button" onClick={() => elegir(g.codigo)} aria-pressed={g.codigo === grupo}
                      className={`rvd-grupo rvd-grupo--${g.prioridad.toLowerCase()}${g.codigo === grupo ? ' rvd-grupo--activo' : ''}${r.conteo[g.codigo] === 0 ? ' rvd-grupo--cero' : ''}`}>
                      <span className="rvd-grupo-codigo">{g.codigo}</span>
                      <span className="rvd-grupo-titulo">{g.titulo}</span>
                      <span className="rvd-grupo-cuenta">{miles(r.conteo[g.codigo])}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <section className="rvd-detalle-grupo" aria-labelledby="rvd-titulo-grupo">
                <h3 id="rvd-titulo-grupo" className="rvd-titulo-grupo">
                  {elegido.titulo} <span className={`rvd-prioridad rvd-prioridad--${elegido.prioridad.toLowerCase()}`}>{elegido.prioridad}</span>
                </h3>
                <p className="rvd-correccion">
                  {miles(filas.length)} {elegido.codigo === 'F2' || elegido.codigo === 'F2c' ? (filas.length === 1 ? 'factura' : 'facturas') : (filas.length === 1 ? 'operación' : 'operaciones')}
                  {elegido.codigo === 'D2' && r.referenciasRepetidas > 0 ? ` (${miles(r.referenciasRepetidas)} referencias)` : ''}. {elegido.correccion}
                </p>
                {(elegido.codigo === 'F2' || elegido.codigo === 'F4' || elegido.codigo === 'F1') && r.sinLigar > 0 && (
                  <p className="rvd-nota">
                    {miles(r.sinLigar)} renglones de facturas no se pudieron ligar a una operación (no existe, es de prueba o su referencia está repetida).
                  </p>
                )}
                {filas.length === 0 ? (
                  <p className="rvd-vacio">Sin errores en este grupo.</p>
                ) : (
                  <>
                    <ul className="rvd-filas">
                      {filas.slice(0, mostrar).map((f) => <Fila key={f.clave} f={f} onAbrir={abrir} />)}
                    </ul>
                    {filas.length > mostrar && (
                      <button type="button" className="rvd-btn rvd-mas" onClick={() => setMostrar((m) => m + POR_PAGINA)}>
                        Mostrar {miles(Math.min(POR_PAGINA, filas.length - mostrar))} más ({miles(filas.length - mostrar)} restantes)
                      </button>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

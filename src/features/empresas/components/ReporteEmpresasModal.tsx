// src/features/empresas/components/ReporteEmpresasModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00507 — "Reporte" de Empresas: Excel de clientes y proveedores con su dirección y sus
// operaciones (Importación, Exportación y Otros). SOLO LECTURA: no lee nada hasta que el usuario
// presiona Descargar. La regla está en services/reporteEmpresas.ts, las lecturas en
// reporteEmpresasLectura.ts y el Excel en excelReporteEmpresas.ts.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import type { AvanceExcel } from '../../operaciones/services/operacionesDelRangoExcel';
import { descargarReporteEmpresas, textoPeriodo } from '../services/excelReporteEmpresas';
import { leerReporteEmpresas } from '../services/reporteEmpresasLectura';
import type { RangoReporte } from '../services/reporteEmpresasLectura';
import type { ReporteEmpresas } from '../services/reporteEmpresas';
import './ReporteEmpresasModal.css';

const miles = (n: number): string => n.toLocaleString('es-MX');
/** Deja que la ventana pinte el aviso antes de armar el archivo (armarlo ocupa la página unos segundos). */
const dejarPintar = (): Promise<void> => new Promise((listo) => { setTimeout(listo, 50); });
const textoAvance = (a: AvanceExcel | null): string => {
  if (!a) return 'Contando operaciones…';
  if (a.total === null) return `Leyendo operaciones… ${miles(a.leidas)} leídas`;
  return `Revisando operaciones… ${miles(a.leidas)} de ${miles(a.total)}${a.enRango !== null ? ` · ${miles(a.enRango)} del periodo` : ''}`;
};
const mismoRango = (a: RangoReporte, b: RangoReporte): boolean => a.desde === b.desde && a.hasta === b.hasta;

export default function ReporteEmpresasModal({ onCerrar }: { onCerrar: () => void }) {
  const [rango, setRango] = useState<RangoReporte>({ desde: '', hasta: '' });
  const [leyendo, setLeyendo] = useState(false);
  const [armando, setArmando] = useState(false);
  const [avance, setAvance] = useState<AvanceExcel | null>(null);
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState<{ reporte: ReporteEmpresas; rango: RangoReporte } | null>(null);
  const ocupado = leyendo || armando;

  const armar = async (reporte: ReporteEmpresas, r: RangoReporte): Promise<void> => {
    setArmando(true);
    try {
      await dejarPintar();
      await descargarReporteEmpresas(reporte, r);
    } catch (e) {
      console.error('No se pudo armar el Excel del reporte de empresas:', e);
      setError('No se pudo armar el Excel. Intenta de nuevo.');
    } finally {
      setArmando(false);
    }
  };

  const descargar = async () => {
    if (rango.desde && rango.hasta && rango.desde > rango.hasta) {
      setError('La fecha "Desde" es posterior a "Hasta".');
      return;
    }
    setError('');
    // El mismo periodo que la última vez: se vuelve a descargar sin volver a leer.
    if (hecho && mismoRango(hecho.rango, rango)) { await armar(hecho.reporte, hecho.rango); return; }
    setLeyendo(true);
    setAvance(null);
    let reporte: ReporteEmpresas;
    try {
      reporte = await leerReporteEmpresas(rango, setAvance);
    } catch (e) {
      console.error('No se pudo leer el reporte de empresas:', e);
      setError('No se pudieron leer las operaciones, Empresas, Direcciones o los catálogos. Revisa la conexión e intenta de nuevo.');
      return;
    } finally {
      setLeyendo(false);
    }
    setHecho({ reporte, rango });
    await armar(reporte, rango);
  };

  const cambiar = (campo: keyof RangoReporte, valor: string) => setRango((r) => ({ ...r, [campo]: valor }));

  return createPortal(
    <div className="modal-overlay rpe-fondo" role="dialog" aria-modal="true" aria-labelledby="rpe-titulo">
      <div className="rpe-ventana">
        <header className="rpe-cabecera">
          <div>
            <h2 id="rpe-titulo" className="rpe-titulo">Reporte de empresas</h2>
            <p className="rpe-sub">
              Excel de clientes y proveedores con su dirección y cuántas operaciones tienen: importación, exportación y otros
              (movimientos, en falso y sin clasificar). Las canceladas no cuentan. Solo lee: no cambia nada.
            </p>
          </div>
          <button type="button" className="rpe-cerrar" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar">✕</button>
        </header>

        <div className="rpe-cuerpo">
          <fieldset className="rpe-periodo" disabled={ocupado}>
            <legend className="rpe-leyenda">Periodo (fecha de servicio)</legend>
            <label className="rpe-campo" htmlFor="rpe-desde">
              Desde
              <input id="rpe-desde" type="date" className="rpe-fecha" value={rango.desde} onChange={(e) => cambiar('desde', e.target.value)} />
            </label>
            <label className="rpe-campo" htmlFor="rpe-hasta">
              Hasta
              <input id="rpe-hasta" type="date" className="rpe-fecha" value={rango.hasta} onChange={(e) => cambiar('hasta', e.target.value)} />
            </label>
            <button type="button" className="rpe-todas" onClick={() => setRango({ desde: '', hasta: '' })} disabled={!rango.desde && !rango.hasta}>
              Todas las fechas
            </button>
            <p className="rpe-ayuda">
              {rango.desde || rango.hasta
                ? `${textoPeriodo(rango)}. Deja las fechas vacías para contar todas las operaciones.`
                : 'Sin fechas cuenta todas las operaciones, de cualquier fecha. Tarda unos segundos y avisa cuántas lleva.'}
            </p>
          </fieldset>

          {leyendo && (
            <div className="rpe-avance">
              <CargandoDatos compacto texto={textoAvance(avance)} />
              {avance?.total ? <progress className="rpe-progreso" max={Math.max(avance.total, 1)} value={avance.leidas} /> : null}
            </div>
          )}
          {armando && <CargandoDatos compacto texto="Armando el Excel…" />}
          {error && <p className="rpe-error" role="alert">{error}</p>}

          {hecho && !ocupado && (
            <section className="rpe-listo" aria-label="Resumen del reporte">
              <p className="rpe-listo-titulo">Excel descargado · {textoPeriodo(hecho.rango)}</p>
              <dl className="rpe-cifras">
                <div><dt>Clientes</dt><dd>{miles(hecho.reporte.clientes.length)}</dd></div>
                <div><dt>Proveedores</dt><dd>{miles(hecho.reporte.proveedores.length)}</dd></div>
                <div><dt>Operaciones revisadas</dt><dd>{miles(hecho.reporte.revisadas)}</dd></div>
                <div><dt>Canceladas (no cuentan)</dt><dd>{miles(hecho.reporte.canceladas)}</dd></div>
              </dl>
              {(hecho.reporte.sinEmpresa.cliente > 0 || hecho.reporte.sinEmpresa.proveedor > 0) && (
                <p className="rpe-nota">
                  Operaciones con un cliente que no está en Empresas: {miles(hecho.reporte.sinEmpresa.cliente)}; con un proveedor que no está en Empresas: {miles(hecho.reporte.sinEmpresa.proveedor)}. Esas no suman a ninguna empresa de su hoja (el Resumen del Excel lo dice).
                </p>
              )}
            </section>
          )}
        </div>

        <footer className="rpe-pie">
          <button type="button" className="rpe-btn" onClick={onCerrar} disabled={ocupado}>Cerrar</button>
          <button type="button" className="rpe-btn rpe-btn--principal" onClick={descargar} disabled={ocupado}>
            <FileSpreadsheet size={15} aria-hidden="true" />
            {hecho && mismoRango(hecho.rango, rango) ? 'Descargar de nuevo' : 'Descargar Excel'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

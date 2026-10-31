// src/features/operaciones/components/CorregirMonedasRevision.tsx
// ---------------------------------------------------------------------------
// ✅ V00538 — "Solucionar" de D1 (moneda de cobro distinta a la de la empresa) y D4 (montos que no
// cuadran con la regla) en la Revisión de datos:
//   · Sin facturar → "Corregir monedas y montos" (la herramienta de Operaciones, la misma regla).
//   · Ya facturadas → "Tomar lo de la factura": la factura emitida manda (decisión de Omaf, 31-oct).
//     Solo se corrigen las que cuadran con su factura; las demás quedan a mano con el motivo.
// ---------------------------------------------------------------------------
import { Suspense, useState } from 'react';
import { Wrench } from 'lucide-react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { auth } from '../../../config/firebase';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import { filasPruebaTomarDeFactura, MOTIVO_SIN_FACTURAR, respaldoTomarDeFactura } from '../services/tomarDeFactura';
import { aplicarTomarDeFactura, prepararTomarDeFactura } from '../services/tomarDeFacturaDatos';
import type { PreparacionTomarDeFactura } from '../services/tomarDeFacturaDatos';
import PasosCorreccion from './PasosCorreccion';
import './CorregirMonedasRevision.css';

const CorregirMonedasConvenioModal = lazyWithRetry(() => import('./CorregirMonedasConvenioModal'), 'CorregirMonedasConvenioModal');

const miles = (n: number): string => n.toLocaleString('es-MX');

interface CorregirMonedasRevisionProps {
  /** Las operaciones de D1 y D4 de la vista (sin repetir). */
  opIds: readonly string[];
}

const CorregirMonedasRevision = ({ opIds }: CorregirMonedasRevisionProps) => {
  const [abrirSinFacturar, setAbrirSinFacturar] = useState(false);
  const [preparacion, setPreparacion] = useState<PreparacionTomarDeFactura | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState('');

  const revisarFacturadas = async () => {
    setLeyendo(true);
    setError('');
    try {
      setPreparacion(await prepararTomarDeFactura(opIds));
    } catch (e) {
      console.error('No se pudieron leer las operaciones facturadas, sus facturas o los convenios:', e);
      setError('No se pudieron leer las operaciones, sus facturas o los convenios. Revisa la conexión e intenta de nuevo.');
    } finally {
      setLeyendo(false);
    }
  };

  const facturadas = preparacion ? preparacion.planes.filter((p) => p.motivo !== MOTIVO_SIN_FACTURAR) : [];
  const aCorregir = facturadas.filter((p) => p.estado === 'corregir');
  const aMano = facturadas.filter((p) => p.estado === 'manual');

  return (
    <section className="cmr-panel" aria-label="Solucionar monedas y montos">
      <h4 className="cmr-titulo"><Wrench size={14} aria-hidden="true" /> Solucionar</h4>
      <div className="cmr-opcion">
        <p className="cmr-texto"><b>Sin facturar:</b> pone "Facturado en" con la moneda de la empresa y recalcula Dólares, Pesos y Conversión con la regla (la herramienta de Operaciones).</p>
        <button type="button" className="cmr-btn" onClick={() => setAbrirSinFacturar(true)}>Corregir monedas y montos</button>
      </div>
      <div className="cmr-opcion">
        <p className="cmr-texto"><b>Ya facturadas:</b> la factura emitida manda. La operación toma la moneda y el monto con que se facturó; la factura y sus pagos no cambian. Si lo facturado no sale de su convenio y TC, queda para corregirla a mano.</p>
        {!preparacion && (
          <button type="button" className="cmr-btn" onClick={() => { void revisarFacturadas(); }} disabled={leyendo || opIds.length === 0}>
            {leyendo ? <CargandoDatos enLinea texto="Revisando sus facturas" /> : 'Revisar las facturadas'}
          </button>
        )}
        {error && <p className="cmr-error" role="alert">{error}</p>}
        {preparacion && (
          <>
            <p className="cmr-texto">
              {miles(facturadas.length)} facturadas: <b>{miles(aCorregir.length)}</b> se corrigen con lo de su factura y {miles(aMano.length)} quedan a mano.
            </p>
            {aMano.length > 0 && (
              <ul className="cmr-mano">
                {aMano.slice(0, 30).map((p) => <li key={p.opId}><b>{p.ref}</b>: {p.motivo}</li>)}
                {aMano.length > 30 && <li>… y {miles(aMano.length - 30)} más (todas en la prueba).</li>}
              </ul>
            )}
            <PasosCorreccion
              nombre="Tomar lo de la factura"
              cantidad={aCorregir.length}
              unidad={['operación', 'operaciones']}
              ayudaPrueba="Cada facturada con lo de antes y lo de después, o por qué se deja a mano. Revísalo."
              ayudaRespaldo="Archivo con los montos que tiene hoy cada operación que se corrige. Guárdalo."
              pideFunciones
              armarPrueba={() => ({ filas: filasPruebaTomarDeFactura(facturadas), columnasMoneda: [] })}
              armarRespaldo={(cuando) => respaldoTomarDeFactura(facturadas, cuando, auth.currentUser?.email || '')}
              aplicar={(cuando, alAvanzar) => aplicarTomarDeFactura(preparacion, cuando, alAvanzar)}
            />
          </>
        )}
      </div>
      {abrirSinFacturar && (
        <Suspense fallback={<CargandoDatos texto="Abriendo Corregir monedas y montos…" />}>
          <CorregirMonedasConvenioModal onCerrar={() => setAbrirSinFacturar(false)} />
        </Suspense>
      )}
    </section>
  );
};

export default CorregirMonedasRevision;

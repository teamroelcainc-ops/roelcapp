// src/features/facturacion/components/SubtotalFacturaEdicion.tsx
// ---------------------------------------------------------------------------
// ✅ V00533 — El campo del subtotal en Editar factura (Clientes): se puede escribir y avisa si coincide
// con el SUBTOTAL del documento de la factura (PDF o XML, el XML primero) y si no es lo que suman hoy sus
// operaciones. Solo avisa: guardar lo hace Actualizar (services/subtotalManual.ts, en transacción).
// ---------------------------------------------------------------------------
import type { Adjunto } from '../../../shared/archivos/adjuntos';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { useLecturasDocumentos } from '../hooks/useLecturasDocumentos';
import { avisosSubtotal, documentoParaSubtotal } from '../services/subtotalManual';
import './SubtotalFacturaEdicion.css';

interface Props {
  id: string;
  valor: string;
  onCambiar: (v: string) => void;
  moneda: 'USD' | 'MXN' | null;
  /** Los documentos de la factura (guardados y nuevos). */
  adjuntos: readonly Adjunto[];
  /** Lo que suman hoy sus operaciones en la moneda de la factura (null = se están leyendo). */
  sumaOps: number | null;
  /** Por qué no se puede cambiar aquí ('' = se puede). */
  bloqueo: string;
  deshabilitado: boolean;
}

const ICONO = { ok: '✅', aviso: '⚠️', info: 'ℹ️' } as const;
const dinero = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SubtotalFacturaEdicion({ id, valor, onCambiar, moneda, adjuntos, sumaOps, bloqueo, deshabilitado }: Props) {
  const { lecturas, leyendo, hayDocumentos } = useLecturasDocumentos(adjuntos, !bloqueo);
  const documento = documentoParaSubtotal(lecturas);

  if (bloqueo) {
    return (
      <>
        <span id={id} className="sfe-fijo">{dinero(Number(valor) || 0)}</span>
        <small className="sfe-nota">{bloqueo}</small>
      </>
    );
  }

  const avisos = avisosSubtotal({ valor, moneda, documento, sumaOps });
  return (
    <>
      <input id={id} className="sfe-input" type="number" inputMode="decimal" step="0.01" min="0" value={valor}
        onChange={(e) => onCambiar(e.target.value)} disabled={deshabilitado} aria-describedby={`${id}-avisos`} />
      <div id={`${id}-avisos`} className="sfe-avisos" aria-live="polite">
        {!documento && leyendo && <CargandoDatos compacto texto="Leyendo el documento para comparar el subtotal…" />}
        {!documento && !leyendo && (
          <p className="sfe-aviso sfe-aviso--info">
            {hayDocumentos ? 'ℹ️ No se pudo leer el subtotal del documento: compáralo a mano.' : 'ℹ️ Sin PDF ni XML de la factura para comparar el subtotal.'}
          </p>
        )}
        {avisos.map((a) => (
          <p key={a.texto} className={`sfe-aviso sfe-aviso--${a.nivel}`}><span aria-hidden="true">{ICONO[a.nivel]}</span> {a.texto}</p>
        ))}
      </div>
    </>
  );
}

// src/features/facturacion/components/CancelacionFicha.tsx
// ✅ V00481 — en la ficha de una factura Cancelada: qué factura la reemplaza, la nota, cuándo y quién.
import { XCircle } from 'lucide-react';
import { cancelacionDe, estaCancelada } from '../services/reglasFactura';
import './CancelacionFicha.css';

const fechaHora = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function CancelacionFicha({ factura }: { factura: { statusFactura?: unknown } & Record<string, unknown> }) {
  if (!estaCancelada(factura.statusFactura)) return null;
  const c = cancelacionDe(factura);
  const cuando = c ? [fechaHora(c.en), c.por].filter(Boolean).join(' · ') : '';
  return (
    <section className="cfi-caja" aria-label="Cancelación de la factura">
      <h3 className="cfi-titulo"><XCircle size={16} aria-hidden="true" /> Factura cancelada</h3>
      {c ? (
        <dl className="cfi-datos">
          <dt>La reemplaza</dt><dd className="cfi-reemplazo">{c.reemplazo || '—'}</dd>
          <dt>Nota</dt><dd>{c.nota || '—'}</dd>
          {cuando && <><dt>Cancelada</dt><dd>{cuando}</dd></>}
        </dl>
      ) : (
        <p className="cfi-sin">Se canceló sin nota ni factura de reemplazo (antes de que se pidieran).</p>
      )}
    </section>
  );
}

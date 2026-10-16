// src/features/operaciones/components/formulario/AvisoTipoCambio.tsx
// ✅ V00461: debajo de la Fecha de Servicio dice el T.C. OFICIAL de esa fecha y avisa
//   cuando la operación trae otro (por ejemplo, el de otro día que antes se quedaba
//   al abrirla o al cambiar la fecha). "Usar el oficial" lo corrige; se guarda al Guardar.
import { mismoTipoCambio } from '../../../../shared/dominio/tipoCambio';
import './AvisoTipoCambio.css';

interface Props {
  buscando: boolean;
  /** Fecha de servicio AAAA-MM-DD. */
  fechaISO: string;
  /** T.C. que le toca a esa fecha (null si no hay). */
  oficial: number | null;
  /** Día del registro de ese T.C. (otro solo en fin de semana: el del viernes). */
  fechaDelOficial: string;
  /** T.C. que trae la operación (tipoCambioAprobado). */
  deOperacion: number;
  /** Sin función (campo bloqueado por Autorizaciones) no se muestra el botón. */
  onUsarOficial?: () => void;
}

const fechaCorta = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/ de /g, ' ');
};
const tc = (n: number): string => `$${n.toFixed(4)}`;

export default function AvisoTipoCambio({ buscando, fechaISO, oficial, fechaDelOficial, deOperacion, onUsarOficial }: Props) {
  // Sábado o domingo sin registro: el del viernes.
  const delDia = fechaDelOficial && fechaDelOficial !== fechaISO ? `del ${fechaCorta(fechaISO)} (fin de semana, el del ${fechaCorta(fechaDelOficial)})` : `del ${fechaCorta(fechaISO)}`;
  if (buscando) return <small className="atc atc--buscando">Buscando TC…</small>;
  if (!fechaISO) return null;
  if (oficial === null) {
    return (
      <small className="atc atc--falta" title="Captúralo en Tipo de Cambio con esa fecha.">
        Sin TC registrado del {fechaCorta(fechaISO)}{deOperacion > 0 ? ` · se usa ${tc(deOperacion)}` : ''}
      </small>
    );
  }
  if (deOperacion > 0 && !mismoTipoCambio(deOperacion, oficial)) {
    return (
      <small className="atc atc--distinto">
        TC de la operación {tc(deOperacion)} · oficial {delDia} {tc(oficial)}
        {onUsarOficial && <button type="button" className="atc__usar" onClick={onUsarOficial}>Usar el oficial</button>}
      </small>
    );
  }
  return <small className="atc atc--ok">TC oficial {delDia}: {tc(oficial)}</small>;
}

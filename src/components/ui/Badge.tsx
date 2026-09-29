import { NEGATIVE_STATUS, POSITIVE_STATUS } from '../../config/enums';
import './Badge.css';

/** Tonos disponibles; si no se indica, se deduce del valor. */
export type BadgeTone = 'positive' | 'negative' | 'neutral' | 'info' | 'warning';

interface BadgeProps {
  value: string;
  tone?: BadgeTone;
}

/** Pastilla de estatus con color automático (verde/rojo/neutro). */
export function Badge({ value, tone }: BadgeProps) {
  const upper = value.toUpperCase();
  const resolved =
    tone ??
    (POSITIVE_STATUS.includes(upper)
      ? 'positive'
      : NEGATIVE_STATUS.includes(upper)
        ? 'negative'
        : 'neutral');
  return <span className={`badge-pill badge-${resolved}`}>{value}</span>;
}
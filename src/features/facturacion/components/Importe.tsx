// src/features/facturacion/components/Importe.tsx
// ---------------------------------------------------------------------------
// ✅ V00481 — un importe con el color de su moneda: Pesos en VERDE, Dólares en AZUL (y la
// palabra "Pesos" / "Dólares" con el mismo color). Sin moneda reconocida, color normal.
// ---------------------------------------------------------------------------
import { monedaCanonica, nombreMoneda } from '../../../shared/dominio/moneda';
import './Importe.css';

const claseDe = (moneda: unknown): string => {
  const m = monedaCanonica(moneda);
  return m === 'USD' ? ' imp--usd' : m === 'MXN' ? ' imp--mxn' : ' imp--sin';
};

/** Mismo formato que el resto de Facturación: "$ 1,234.50". */
const textoImporte = (monto: unknown): string => {
  const n = Number(monto) || 0;
  return `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

interface Props {
  monto: unknown;
  moneda: unknown;
  /** Agrega el nombre de la moneda después del importe ("$ 100.00 Dólares"). */
  conNombre?: boolean;
  className?: string;
}

export default function Importe({ monto, moneda, conNombre = false, className = '' }: Props) {
  const nombre = conNombre ? nombreMoneda(monedaCanonica(moneda)) : '';
  return (
    <span className={`imp${claseDe(moneda)}${className ? ` ${className}` : ''}`}>
      {textoImporte(monto)}{nombre ? ` ${nombre}` : ''}
    </span>
  );
}

interface PropsNombre {
  moneda: unknown;
  /** Lo que se muestra si la moneda no se reconoce. */
  respaldo?: string;
  /** 'codigo' muestra USD / MXN en lugar de Dólares / Pesos. */
  forma?: 'nombre' | 'codigo';
  className?: string;
}

/** La palabra de la moneda ("Dólares" / "Pesos", o USD / MXN) con su color. */
export function NombreMoneda({ moneda, respaldo = 'Sin moneda', forma = 'nombre', className = '' }: PropsNombre) {
  const m = monedaCanonica(moneda);
  const texto = m ? (forma === 'codigo' ? m : nombreMoneda(m)) : respaldo;
  return <span className={`imp imp-nombre${claseDe(m)}${className ? ` ${className}` : ''}`}>{texto}</span>;
}

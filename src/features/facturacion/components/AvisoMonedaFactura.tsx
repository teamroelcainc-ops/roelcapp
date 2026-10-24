// src/features/facturacion/components/AvisoMonedaFactura.tsx
// ✅ V00481 — aviso amarillo cuando la moneda de la factura no es la de la empresa en Empresas
// (o la empresa no tiene moneda). La moneda de la factura siempre es la de la empresa.
import { AlertTriangle } from 'lucide-react';
import './AvisoMonedaFactura.css';

export default function AvisoMonedaFactura({ texto, error = false }: { texto: string | null; error?: boolean }) {
  if (!texto) return null;
  return (
    <p className={`amf-aviso${error ? ' amf-aviso--error' : ''}`} role={error ? 'alert' : 'status'}>
      <AlertTriangle size={16} aria-hidden="true" />
      <span>{texto}</span>
    </p>
  );
}

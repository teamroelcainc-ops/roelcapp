// src/features/facturacion/components/ActualizarFacturaFicha.tsx
// ---------------------------------------------------------------------------
// ✅ V00528 — El aviso de la Ficha de Factura con el botón "Actualizar factura" (sin entrar a Editar factura).
// ✅ V00529: en su propio componente, con su propio "Actualizando…": presionarlo ya no vuelve a pintar todo
//   Facturación de Clientes (se notaba con muchas facturas); solo se repinta al terminar, con lo escrito.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import './ActualizarFacturaFicha.css';

interface Props {
  /** Qué pasa (una operación tiene otro total hoy / la factura no guardó lo que cobró cada operación). */
  motivo: string;
  /** Qué hace el botón con el total (o por qué no se puede); mientras se leen las operaciones, eso. */
  texto: string;
  /** Hay algo que guardar. */
  habilitado: boolean;
  onActualizar: () => Promise<void>;
}

export default function ActualizarFacturaFicha({ motivo, texto, habilitado, onActualizar }: Props) {
  const [actualizando, setActualizando] = useState(false);
  const actualizar = async () => {
    if (actualizando) return;
    setActualizando(true);
    try { await onActualizar(); } finally { setActualizando(false); }
  };
  return (
    <div className="afi-aviso" role="status">
      <p className="afi-texto">{motivo}{texto ? ` ${texto}` : ''}</p>
      <button type="button" className="afi-btn" disabled={!habilitado || actualizando} onClick={() => { void actualizar(); }}>
        {actualizando ? 'Actualizando…' : 'Actualizar factura'}
      </button>
    </div>
  );
}

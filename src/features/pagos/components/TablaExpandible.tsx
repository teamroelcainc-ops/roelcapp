// src/features/pagos/components/TablaExpandible.tsx
// ✅ V00484 — tabla de facturas de Pagos (Transacciones pendientes, Agregar facturas, facturas del
// pago) con el botón Expandir: la tabla pasa a ocupar casi toda la pantalla encima de la ventana,
// con la misma selección y los mismos campos (no es una copia). Contraer o Esc la regresa.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import './TablaExpandible.css';

interface Props {
  titulo: ReactNode;
  /** Buscador, conteos, plantilla… (en la misma fila que el título). */
  acciones?: ReactNode;
  /** Solo con la tabla expandida, abajo (p. ej. los totales del pago). */
  pie?: ReactNode;
  /** Alto de la tabla sin expandir: 'normal' 320 px, 'bajo' 260 px, 'libre' sin tope. */
  alto?: 'normal' | 'bajo' | 'libre';
  children: ReactNode;
}

export default function TablaExpandible({ titulo, acciones, pie, alto = 'normal', children }: Props) {
  const [expandida, setExpandida] = useState(false);

  // Esc contrae la tabla (y no llega a la ventana de atrás).
  useEffect(() => {
    if (!expandida) return undefined;
    const alTecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setExpandida(false);
    };
    window.addEventListener('keydown', alTecla, true);
    return () => window.removeEventListener('keydown', alTecla, true);
  }, [expandida]);

  return (
    <section className={`pte-bloque${expandida ? ' pte-bloque--expandida' : ''}`}>
      <div className="pte-encabezado">
        <span className="pte-titulo">{titulo}</span>
        {acciones}
        <button type="button" className="pte-btn" onClick={() => setExpandida((v) => !v)} aria-expanded={expandida}
          title={expandida ? 'Regresar la tabla a su tamaño (Esc)' : 'Ver la tabla en pantalla completa'}>
          {expandida ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          {expandida ? 'Contraer' : 'Expandir'}
        </button>
      </div>
      <div className={`pte-marco pte-marco--${alto}`}>{children}</div>
      {expandida && pie ? <div className="pte-pie">{pie}</div> : null}
    </section>
  );
}

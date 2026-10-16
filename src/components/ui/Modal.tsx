import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /**
   * Clase extra para el cuerpo. "is-grid" = el cuerpo NO desplaza y lo hace
   * la rejilla de adentro (encabezado y primera columna fijos). Sigue siendo
   * una sola barra; sin esto, el único scroll es el del cuerpo.
   */
  bodyClassName?: string;
  /** 'top' lo dibuja por encima de otro modal abierto (alta rápida de catálogo). */
  layer?: 'base' | 'top';
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  layer = 'base',
  bodyClassName,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`modal-overlay ${layer === 'top' ? 'is-top' : ''}`}
      onMouseDown={onClose}
    >
      <div
        className={`modal-card modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={`modal-body ${bodyClassName ?? ''}`}>{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

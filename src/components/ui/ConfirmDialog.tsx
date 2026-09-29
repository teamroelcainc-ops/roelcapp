import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  busy?: boolean;
  /** Texto del botón de confirmar (por defecto "Delete", que es su uso más común). */
  confirmLabel?: string;
  /** Texto mientras trabaja (por defecto "Deleting…"). */
  busyLabel?: string;
  /** false = botón azul en vez de rojo (acciones que no destruyen datos). */
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  busy = false,
  onCancel,
  onConfirm,
  confirmLabel = 'Delete',
  busyLabel = 'Deleting…',
  danger = true,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

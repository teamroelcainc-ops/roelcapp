import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { SearchableSelect } from '../ui/SearchableSelect';
import type { FieldConfig } from '../../types/models';
import './ExportExcelModal.css';

interface ExportExcelModalProps {
  title: string;
  fields: FieldConfig[];
  onClose: () => void;
  onExport: (dateField: string, from: string, to: string) => Promise<void>;
}

/**
 * Diálogo de exportación a Excel con su propio filtro por fechas,
 * independiente de la búsqueda y de los filtros de columnas de la tabla.
 */
export function ExportExcelModal({ title, fields, onClose, onExport }: ExportExcelModalProps) {
  const dateOptions = [
    { value: 'createdAt', label: 'Captured date (in the app)' },
    ...fields
      .filter((f) => f.type === 'date')
      .map((f) => ({ value: f.key, label: f.label })),
  ];

  const [dateField, setDateField] = useState('createdAt');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      await onExport(dateField, from, to);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Export Excel · ${title}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleExport()}
            disabled={busy}
          >
            <FileSpreadsheet size={16} />
            {busy ? 'Generating…' : 'Export'}
          </button>
        </>
      }
    >
      <div className="expmodal">
        <div className="expmodal-field">
          <label>Filter by date of</label>
          <SearchableSelect value={dateField} options={dateOptions} onChange={setDateField} />
        </div>
        <div className="expmodal-field">
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="expmodal-field">
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <p className="expmodal-hint">
          Leave the dates empty to export everything. This filter is independent from the search box
          and the table filters.
        </p>
      </div>
    </Modal>
  );
}

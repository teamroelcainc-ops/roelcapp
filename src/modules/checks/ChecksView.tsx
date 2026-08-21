import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { useCompany } from '../../hooks/useCompany';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import { printCheck } from '../../services/checkPrintService';
import { COLLECTIONS, type Check } from '../../types/models';
import { Toolbar } from '../../components/ui/Toolbar';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { CatalogSelect } from '../../components/ui/CatalogSelect';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { fmtMoney, round2, todayISO, toNumber } from '../../utils/format';
import './ChecksView.css';

const fmtDate = (iso: string): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

export function ChecksView() {
  const { can } = useAuth();
  const { checkSettings } = useAppConfig();
  const { data: checks } = useCollection<Check>(COLLECTIONS.CHECKS);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const { data: customerDocs } = useCollection<{ id: string; ADDRESS_CUSTOMER?: string; CITY_CUSTOMER?: string }>(COLLECTIONS.CUSTOMER);
  const { company } = useCompany();

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Check | null>(null);

  const [checkNumber, setCheckNumber] = useState('');
  const [date, setDate] = useState(todayISO());
  const [bankId, setBankId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [memo, setMemo] = useState('');
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');

  const bankOptions = useMemo(
    () =>
      (company.banks ?? []).map((b) => ({
        id: b.id,
        name: `${b.bankName}${b.account ? `-${b.account.slice(-4)}` : ''}`,
      })),
    [company.banks],
  );
  const bankLabel = useMemo(() => new Map(bankOptions.map((b) => [b.id, b.name])), [bankOptions]);

  /** Siguiente consecutivo: max(cheques existentes, numero inicial configurado - 1) + 1. */
  const nextNumber = useMemo(() => {
    const maxExisting = checks.reduce((acc, c) => Math.max(acc, c.CHECK_NUMBER ?? 0), 0);
    const start = checkSettings.startNumber ?? 1;
    return Math.max(maxExisting, start - 1) + 1;
  }, [checks, checkSettings.startNumber]);

  useEffect(() => {
    if (formOpen && !editing) setCheckNumber(String(nextNumber));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, editing, nextNumber]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const sorted = [...checks].sort((a, b) => (b.CHECK_NUMBER ?? 0) - (a.CHECK_NUMBER ?? 0));
    if (!term) return sorted;
    return sorted.filter((c) =>
      [String(c.CHECK_NUMBER ?? ''), customers.nameOf(c.ID_CUSTOMER), c.MEMO ?? '', c.REF ?? '', bankLabel.get(c.ID_BANK) ?? '']
        .some((v) => v.toLowerCase().includes(term)),
    );
  }, [checks, search, customers, bankLabel]);

  const total = round2(rows.reduce((acc, c) => acc + (c.AMOUNT ?? 0), 0));

  const openCreate = () => {
    setEditing(null);
    setDate(todayISO());
    setBankId(company.banks?.[0]?.id ?? '');
    setCustomerId('');
    setMemo('');
    setRef('');
    setAmount('');
    setFormOpen(true);
  };

  const openEdit = (check: Check) => {
    setEditing(check);
    setCheckNumber(String(check.CHECK_NUMBER ?? ''));
    setDate(check.DATE ?? todayISO());
    setBankId(check.ID_BANK ?? '');
    setCustomerId(check.ID_CUSTOMER ?? '');
    setMemo(check.MEMO ?? '');
    setRef(check.REF ?? '');
    setAmount(String(check.AMOUNT ?? ''));
    setFormOpen(true);
  };

  /** Guardado local-first con confirmacion del consecutivo (no repetir ni saltar). */
  const handleSave = () => {
    const amountValue = round2(toNumber(amount));
    if (!customerId || amountValue <= 0) {
      alert('Customer and a positive amount are required.');
      return;
    }
    const requested = parseInt(checkNumber, 10);
    const editingId = editing?.id ?? null;
    const editingNumber = editing?.CHECK_NUMBER ?? null;
    setFormOpen(false);

    /* Confirmar numero contra la lista viva: si ya existe (y no es el que edito), tomar el siguiente. */
    let finalNumber = Number.isFinite(requested) && requested > 0 ? requested : nextNumber;
    const taken = new Set(checks.filter((c) => c.id !== editingId).map((c) => c.CHECK_NUMBER));
    if (finalNumber !== editingNumber) {
      while (taken.has(finalNumber)) finalNumber += 1;
    }

    const payload: Omit<Check, 'id'> = {
      CHECK_NUMBER: finalNumber,
      DATE: date,
      ACCOUNT: company.name || '',
      ID_BANK: bankId,
      ID_CUSTOMER: customerId,
      MEMO: memo.trim(),
      REF: ref.trim(),
      AMOUNT: amountValue,
    };
    const persist = editingId
      ? updateDocument<Check>(COLLECTIONS.CHECKS, editingId, payload)
      : createDocument<Check>(COLLECTIONS.CHECKS, payload);
    persist.catch((error: unknown) =>
      alert(`Failed to save check: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  const handleDelete = () => {
    if (!editing) return;
    if (!window.confirm(`Delete check #${editing.CHECK_NUMBER}?`)) return;
    const id = editing.id;
    setFormOpen(false);
    deleteDocument(COLLECTIONS.CHECKS, id).catch((error: unknown) =>
      alert(`Failed to delete check: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  const handlePrint = (check: Check) => {
    const bank = (company.banks ?? []).find((b) => b.id === check.ID_BANK) ?? null;
    const payeeDoc = customerDocs.find((c) => c.id === check.ID_CUSTOMER);
    const payeeAddress = [payeeDoc?.ADDRESS_CUSTOMER, payeeDoc?.CITY_CUSTOMER].filter(Boolean).join('\n');
    printCheck(check, customers.nameOf(check.ID_CUSTOMER), company, bank, checkSettings, payeeAddress);
  };

  /** Borrado directo desde la tabla (en segundo plano). */
  const handleDeleteRow = (check: Check) => {
    if (!window.confirm(`Delete check #${check.CHECK_NUMBER}?`)) return;
    deleteDocument(COLLECTIONS.CHECKS, check.id).catch((error: unknown) =>
      alert(`Failed to delete check: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  return (
    <div className="checks">
      <Toolbar title="Checkbook" subtitle={`${rows.length} checks · ${fmtMoney(total)}`} searchValue={search} onSearchChange={setSearch}>
        {can('checks', 'add') && (
          <button type="button" className="btn btn--primary" onClick={openCreate}>+ Add check</button>
        )}
      </Toolbar>

      {(company.banks ?? []).length === 0 && (
        <div className="checks__notice">
          No bank accounts configured yet. Add them in <strong>Company Info</strong> to print checks properly.
        </div>
      )}

      <div className="checks__card">
        <table className="checks__table">
          <thead>
            <tr>
              <th className="checks__th"># Check</th>
              <th className="checks__th">Date</th>
              <th className="checks__th">Account</th>
              <th className="checks__th">Bank account</th>
              <th className="checks__th">Customer</th>
              <th className="checks__th">Memo</th>
              <th className="checks__th">Ref #</th>
              <th className="checks__th checks__th--num">Amount</th>
              <th className="checks__th checks__th--right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="checks__empty" colSpan={9}>No checks yet.</td></tr>
            )}
            {rows.map((check) => (
              <tr
                key={check.id}
                className="checks__row"
                onClick={() => (can('checks', 'edit') || can('checks', 'view')) && openEdit(check)}
              >
                <td className="checks__td checks__td--mono">{check.CHECK_NUMBER}</td>
                <td className="checks__td checks__td--muted">{fmtDate(check.DATE)}</td>
                <td className="checks__td">{check.ACCOUNT || company.name || '—'}</td>
                <td className="checks__td checks__td--muted">{bankLabel.get(check.ID_BANK) ?? '—'}</td>
                <td className="checks__td checks__td--strong">{customers.nameOf(check.ID_CUSTOMER)}</td>
                <td className="checks__td checks__td--muted">{check.MEMO || '—'}</td>
                <td className="checks__td checks__td--muted">{check.REF || '—'}</td>
                <td className="checks__td checks__td--num">{fmtMoney(check.AMOUNT ?? 0)}</td>
                <td className="checks__td checks__td--right">
                  {can('checks', 'documents') && (
                    <button
                      type="button"
                      className="checks__print"
                      title="Print check"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrint(check);
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><path d="M6 14h12v7H6z" />
                      </svg>
                    </button>
                  )}
                  {can('checks', 'edit') && (
                    <button
                      type="button"
                      className="checks__action checks__action--edit"
                      onClick={(e) => { e.stopPropagation(); openEdit(check); }}
                    >Edit</button>
                  )}
                  {can('checks', 'delete') && (
                    <button
                      type="button"
                      className="checks__action checks__action--delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteRow(check); }}
                    >Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        title={editing ? `Edit check #${editing.CHECK_NUMBER}` : 'New check'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            {editing && can('checks', 'delete') && (
              <button type="button" className="btn btn--danger" onClick={handleDelete}>Delete</button>
            )}
            <button type="button" className="btn btn--secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            {(editing ? can('checks', 'edit') : can('checks', 'add')) && (
              <button type="button" className="btn btn--primary" onClick={handleSave}>Save</button>
            )}
          </>
        }
      >
        <FormGrid>
          <FormField label="# Check">
            <input className="input mono" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
          </FormField>
          <FormField label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Account">
            <input className="input" value={company.name || ''} disabled />
          </FormField>
          <FormField label="Bank account">
            <SearchableSelect value={bankId} onChange={setBankId} options={bankOptions} placeholder="Select bank…" />
          </FormField>
          <FormField label="Customer">
            <CatalogSelect
              value={customerId}
              onChange={setCustomerId}
              options={customers.options}
              collection={COLLECTIONS.CUSTOMER}
              nameField="NAME_CUSTOMER"
              catalogLabel="customer"
            />
          </FormField>
          <FormField label="Amount">
            <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <FormField label="Memo" span2>
            <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </FormField>
          <FormField label="Ref #" span2>
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
          </FormField>
        </FormGrid>
      </Modal>
    </div>
  );
}

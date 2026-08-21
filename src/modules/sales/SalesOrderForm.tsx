import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { where } from 'firebase/firestore';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { useCollection } from '../../hooks/useCollection';
import { createDocument, deleteDocument, listDocuments, replaceChildren, updateDocument } from '../../services/firestore';
import { COLLECTIONS, SALES_STATUSES, type SalesOrder, type SalesOrderDetail, type SalesStatus, type SystemUser } from '../../types/models';
import { fmtMoney, round2, todayISO } from '../../utils/format';
import { Modal } from '../../components/ui/Modal';
import { ConfigurableGrid, FormField } from '../../components/ui/FormField';
import { CatalogSelect } from '../../components/ui/CatalogSelect';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { LineItemsEditor, lineTotal, sumLineTotals, type LineDraft } from '../../components/ui/LineItemsEditor';
import './SalesOrderForm.css';

/** Suma dias a una fecha ISO (yyyy-mm-dd) sin desfase de zona horaria. */
const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Dias de credito por defecto para el Due date (Date + 15). */
const DEFAULT_DUE_DAYS = 15;

/** Texto de Special Instructions segun el Temp log (patron del negocio). */
const TEMP_LOG_INSTRUCTIONS: Record<'Yes' | 'No', string> = {
  Yes: 'Place a Temperature Recorder',
  No: 'Do NOT Place a Temperature Recorder',
};

interface SalesOrderFormProps {
  open: boolean;
  initial: SalesOrder | null;
  purchaseOrderOptions: CatalogOption[];
  onClose: () => void;
}

export function SalesOrderForm({ open, initial, purchaseOrderOptions, onClose }: SalesOrderFormProps) {
  const { can } = useAuth();
  const { missingRequired } = useAppConfig();
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const { data: commodityDocs } = useCollection<{ id: string; DESCRIPTION_COMMODITIES?: string }>(COLLECTIONS.COMMODITIES);
  const { data: allSalesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const descriptionOf = (id: string): string =>
    (commodityDocs.find((c) => c.id === id)?.DESCRIPTION_COMMODITIES ?? '').trim();
  const buyerOptions = useMemo(
    () =>
      [...systemUsers]
        .map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [systemUsers],
  );
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const locations = useCatalog(COLLECTIONS.LOCATIONS, 'NAME_LOCATIONS');
  const { data: locationDocs } = useCollection<{ id: string; ADDRESS_LOCATIONS?: string }>(COLLECTIONS.LOCATIONS);
  const shipVia = useCatalog(COLLECTIONS.SHIPVIA, 'NAME_SHIPVIA');
  const termShipping = useCatalog(COLLECTIONS.TERMSHIPPING, 'NAME_TERMSHIPPING');
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');

  const [salesOrderNumber, setSalesOrderNumber] = useState('');

  /** Consecutivo del # de orden/invoice: inicia en 470001 y suma 1 por registro. */
  const nextSoNumber = useMemo(() => {
    const maxExisting = allSalesOrders.reduce((acc, so) => {
      const n = parseInt(so.SALES_ORDER_NUMBER ?? '', 10);
      return Number.isFinite(n) ? Math.max(acc, n) : acc;
    }, 0);
    return Math.max(maxExisting, 470000) + 1;
  }, [allSalesOrders]);
  const [date, setDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<SalesStatus>('Draft');
  const [customerId, setCustomerId] = useState('');
  const [userId, setUserId] = useState('');
  const [buyer, setBuyer] = useState('');
  const [ref, setRef] = useState('');
  const [refPickup, setRefPickup] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [shipViaId, setShipViaId] = useState('');
  const [termShippingId, setTermShippingId] = useState('');
  const [tempLog, setTempLog] = useState('');
  const [description, setDescription] = useState('');
  /** Selecciona el Temp log y auto-llena Special Instructions con el texto correspondiente. */
  const applyTempLog = (value: 'Yes' | 'No') => {
    setTempLog(value);
    setDescription(TEMP_LOG_INSTRUCTIONS[value]);
  };

  /** Direccion del warehouse seleccionado (solo lectura, viene de Locations). */
  const warehouseAddress = locationDocs.find((l) => l.id === warehouseId)?.ADDRESS_LOCATIONS ?? '';

  /** OD day: diferencia en dias entre Date y Due date (calculado en silencio, ya no visible). */
  const odDay = useMemo(() => {
    if (!date || !dueDate) return null;
    const from = new Date(`${date}T00:00:00`).getTime();
    const to = new Date(`${dueDate}T00:00:00`).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return Math.round((to - from) / 86400000);
  }, [date, dueDate]);
  const [lines, setLines] = useState<LineDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    setSalesOrderNumber(initial?.SALES_ORDER_NUMBER ?? String(nextSoNumber));
    setDate(initial?.DATE ?? todayISO());
    setDueDate(initial?.DUE_DATE ?? addDaysISO(todayISO(), DEFAULT_DUE_DAYS));
    setStatus(initial?.STATUS ?? 'Draft');
    setCustomerId(initial?.ID_CUSTOMER ?? '');
    setUserId(initial?.ID_USERS ?? '');
    setBuyer(initial?.BUYER ?? '');
    setRef(initial?.REF ?? '');
    setRefPickup(initial?.REF_PICKUP ?? '');
    setCarrierId(initial?.ID_CARRIER ?? '');
    setWarehouseId(initial?.ID_WAREHOUSE ?? '');
    setShipViaId(initial?.ID_SHIPVIA ?? '');
    setTermShippingId(initial?.ID_TERMSHIPPING ?? '');
    setTempLog(initial?.TEMP_LOG ?? '');
    setDescription(initial?.DESCRIPTION ?? '');
    setLines([]);
    if (initial) {
      void listDocuments<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL, [
        where('ID_SALESORDER', '==', initial.id),
      ]).then((details) =>
        setLines(
          details.map((d) => ({
            id: d.id,
            ID_COMMODITIES: d.ID_COMMODITIES,
            ID_PURCHASEORDER: d.ID_PURCHASEORDER,
            DESCRIPTION: d.DESCRIPTION,
            QUANTITY: d.QUANTITY,
            PRICE: d.PRICE,
          })),
        ),
      );
    }
  }, [open, initial]);

  const total = useMemo(() => sumLineTotals(lines), [lines]);

  /** Cierre inmediato: encabezado + detalle se guardan en segundo plano (local-first). */
  const handleSave = () => {
    /* Reglas duras del negocio: cada linea debe tener su # de lote y descripcion. */
    const lineWithoutLot = lines.find((line) => line.ID_COMMODITIES && !line.ID_PURCHASEORDER);
    if (lineWithoutLot) {
      alert('Every line item must be linked to a Lot # (purchase order).');
      return;
    }
    const lineWithoutDescription = lines.find((line) => line.ID_COMMODITIES && !(line.DESCRIPTION ?? '').trim());
    if (lineWithoutDescription) {
      alert('Every line item needs a Description.');
      return;
    }
    const missing = missingRequired('sales', { '# Sales order': salesOrderNumber, 'Status': status, 'Date': date, 'Due date': dueDate, 'Customer': customerId, 'Buyer': buyer, 'Salesperson': userId, 'Ref': ref, 'Ref pickup': refPickup, 'Carrier': carrierId, 'Warehouse': warehouseId, 'Warehouse address': warehouseAddress, 'Ship via': shipViaId, 'Shipping terms': termShippingId, 'Temp log': tempLog, 'Special instructions': description });
    if (missing.length > 0) {
      alert(`Required fields missing: ${missing.join(', ')}`);
      return;
    }
    const incomes = initial?.INCOMES ?? 0;
      const payload: Omit<SalesOrder, 'id'> = {
        ID_CUSTOMER: customerId,
        BUYER: buyer.trim(),
        ID_USERS: userId,
        REF: ref.trim(),
        REF_PICKUP: refPickup.trim(),
        DATE: date,
        DUE_DATE: dueDate,
        STATUS: status,
        SALES_ORDER_NUMBER: (() => {
          const requested = parseInt(salesOrderNumber, 10);
          let n = Number.isFinite(requested) && requested > 0 ? requested : nextSoNumber;
          const taken = new Set(
            allSalesOrders.filter((so) => so.id !== initial?.id).map((so) => parseInt(so.SALES_ORDER_NUMBER ?? '', 10)),
          );
          if (String(n) !== (initial?.SALES_ORDER_NUMBER ?? '')) {
            while (taken.has(n)) n += 1;
          }
          return String(n);
        })(),
        /* Campos retirados del formulario: se preserva el valor legado del registro. */
        PICK_UP_NUMBER: initial?.PICK_UP_NUMBER ?? '',
        ADDRESS: initial?.ADDRESS ?? '',
        CITY_STATE_ZIP: initial?.CITY_STATE_ZIP ?? '',
        ID_SUPPLIERS: initial?.ID_SUPPLIERS ?? '',
        TEMP_LOG: tempLog.trim(),
        DESCRIPTION: description.trim(),
        ID_CARRIER: carrierId,
        ID_WAREHOUSE: warehouseId,
        ID_PAYMENTTERM: initial?.ID_PAYMENTTERM ?? '',
        ID_TERMSHIPPING: termShippingId,
        ID_SHIPVIA: shipViaId,
        TOTAL: total,
        INCOMES: incomes,
        BALANCE: round2(total - incomes),
        OD_DAY: odDay ?? 0,
        SENT: initial?.SENT ?? false,
      };
      const detailRows = lines.map((line) => ({
        id: line.id,
        ID_PURCHASEORDER: line.ID_PURCHASEORDER ?? '',
        ID_COMMODITIES: line.ID_COMMODITIES,
        DESCRIPTION: line.DESCRIPTION ?? '',
        QUANTITY: line.QUANTITY,
        PRICE: line.PRICE,
        TOTAL: lineTotal(line),
      }));
      const editingId = initial?.id ?? null;
      onClose();

      const persist = async () => {
        const orderId = editingId
          ? (await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, editingId, payload), editingId)
          : await createDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, payload);
        await replaceChildren(COLLECTIONS.SALES_ORDER_DETAIL, 'ID_SALESORDER', orderId, detailRows);
      };
      persist().catch((error: unknown) =>
        alert(`Failed to save sales order: ${(error as Error).message ?? 'Unknown error'}`),
      );
  };

  const handleDelete = () => {
    if (!initial) return;
    if (!window.confirm(`Delete sales order ${initial.SALES_ORDER_NUMBER}?`)) return;
    const orderId = initial.id;
    onClose();
    const persist = async () => {
      await replaceChildren(COLLECTIONS.SALES_ORDER_DETAIL, 'ID_SALESORDER', orderId, []);
      await deleteDocument(COLLECTIONS.SALES_ORDER, orderId);
    };
    persist().catch((error: unknown) =>
      alert(`Failed to delete sales order: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  return (
    <Modal
      title={initial ? `Edit sales order ${initial.SALES_ORDER_NUMBER}` : 'New sales order'}
      open={open}
      onClose={onClose}
      wide
      footer={
        <>
          {initial && can('sales', 'delete') && (
            <button type="button" className="btn btn--danger" onClick={handleDelete}>Delete</button>
          )}
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
          {(initial ? can('sales', 'edit') : can('sales', 'add')) && (
            <button type="button" className="btn btn--primary" onClick={handleSave}>Save</button>
          )}
        </>
      }
    >
      <div className="so-form">
        <h4 className="so-form__section">General information</h4>
        <ConfigurableGrid formId="sales">
          <FormField label="# Sales order">
            <input className="input mono" placeholder="470001" value={salesOrderNumber} onChange={(e) => setSalesOrderNumber(e.target.value)} />
          </FormField>
          <FormField label="Status">
            <SearchableSelect
              value={status}
              onChange={(id) => setStatus((id || 'Draft') as SalesStatus)}
              options={SALES_STATUSES.map((s) => ({ id: s, name: s }))}
              placeholder="Status…"
            />
          </FormField>
          <FormField label="Date">
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (e.target.value) setDueDate(addDaysISO(e.target.value, DEFAULT_DUE_DAYS));
              }}
            />
          </FormField>
          <FormField label="Due date">
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
          <FormField label="Buyer">
            <input className="input" placeholder="W. Bentley" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
          </FormField>
          <FormField label="Salesperson">
            <SearchableSelect value={userId} onChange={setUserId} options={buyerOptions} placeholder="Select buyer…" />
          </FormField>
          <FormField label="Ref">
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
          </FormField>
          <FormField label="Ref pickup">
            <input className="input" value={refPickup} onChange={(e) => setRefPickup(e.target.value)} />
          </FormField>
          <FormField label="Carrier">
            <CatalogSelect
              value={carrierId}
              onChange={setCarrierId}
              options={carriers.options}
              collection={COLLECTIONS.CARRIER}
              nameField="NAME_CARRIER"
              catalogLabel="carrier"
            />
          </FormField>
          <FormField label="Warehouse">
            <CatalogSelect
              value={warehouseId}
              onChange={setWarehouseId}
              options={locations.options}
              collection={COLLECTIONS.LOCATIONS}
              nameField="NAME_LOCATIONS"
              catalogLabel="warehouse"
            />
          </FormField>
          <FormField label="Warehouse address" span2>
            <input
              className="input"
              value={warehouseAddress}
              placeholder="Select a warehouse to load its address"
              disabled
              title="Address comes from the Locations catalog"
            />
          </FormField>
          <FormField label="Ship via">
            <CatalogSelect
              value={shipViaId}
              onChange={setShipViaId}
              options={shipVia.options}
              collection={COLLECTIONS.SHIPVIA}
              nameField="NAME_SHIPVIA"
              catalogLabel="ship via"
            />
          </FormField>
          <FormField label="Shipping terms">
            <CatalogSelect
              value={termShippingId}
              onChange={setTermShippingId}
              options={termShipping.options}
              collection={COLLECTIONS.TERMSHIPPING}
              nameField="NAME_TERMSHIPPING"
              catalogLabel="shipping term"
            />
          </FormField>
          <FormField label="Temp log">
            <div className="so-form__segmented" role="group" aria-label="Temp log">
              <button
                type="button"
                className={`so-form__seg-btn${tempLog === 'No' ? ' so-form__seg-btn--active' : ''}`}
                onClick={() => applyTempLog('No')}
              >
                No
              </button>
              <button
                type="button"
                className={`so-form__seg-btn${tempLog === 'Yes' ? ' so-form__seg-btn--active' : ''}`}
                onClick={() => applyTempLog('Yes')}
              >
                Yes
              </button>
            </div>
          </FormField>
          <FormField label="Special instructions">
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              title="Prints only on the Pick Ticket"
            />
          </FormField>
        </ConfigurableGrid>

        <LineItemsEditor
          lines={lines}
          onChange={setLines}
          commodities={commodities.options}
          purchaseOrders={purchaseOrderOptions}
          showDescription
          descriptionOf={descriptionOf}
        />

        <div className="so-form__summary">
          <span>Order total <b className="num">{fmtMoney(total)}</b></span>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { COLLECTIONS, type PurchaseOrder, type SystemUser, type SalesOrder } from '../../types/models';
import { byNewest, fmtDate, fmtMoney } from '../../utils/format';
import { deleteDocument, replaceChildren } from '../../services/firestore';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { PURCHASES_SCHEMAS } from '../../config/entitySchemas';
import { PurchaseOrderForm } from './PurchaseOrderForm';
import { PurchaseOrderDetailPanel } from './PurchaseOrderDetailPanel';
import { printPurchaseOrderPdf } from '../../services/purchaseOrderPdfService';
import { printLiquidationReport } from '../../services/liquidationReportService';
import { useCompany } from '../../hooks/useCompany';
import { DocumentPicker } from '../../components/ui/DocumentPicker';
import './PurchaseOrdersView.css';

interface PurchaseOrdersViewProps {
  /** Abre el detalle de esta orden al montar (navegacion desde Inventory). */
  initialOpenId?: string | null;
}

export function PurchaseOrdersView({ initialOpenId = null }: PurchaseOrdersViewProps) {
  const { can } = useAuth();
  const { data, loading } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const locations = useCatalog(COLLECTIONS.LOCATIONS, 'NAME_LOCATIONS');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const paymentTermsCat = useCatalog(COLLECTIONS.PAYMENTTERM, 'NAME_PAYMENTTERM');
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const { data: customerDocs } = useCollection<{ id: string; ADDRESS_CUSTOMER?: string; CITY_CUSTOMER?: string }>(COLLECTIONS.CUSTOMER);
  const { company } = useCompany();
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  /** Resuelve buyer: usuarios del sistema primero, catalogo legado para registros viejos. */
  const buyerName = useMemo(() => {
    const map = new Map(
      systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]),
    );
  return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '—');
  }, [systemUsers, legacyUsers]);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<PurchaseOrder | null>(null);

  /* Abre el detalle solicitado desde otra vista (una sola vez, cuando llegan los datos). */
  const openedInitialRef = useRef(false);
  useEffect(() => {
    if (openedInitialRef.current || !initialOpenId) return;
    const target = data.find((o) => o.id === initialOpenId);
    if (!target) return;
    openedInitialRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apertura unica de detalle al navegar desde Inventory
    setViewing(target);
  }, [initialOpenId, data]);
  const [docsFor, setDocsFor] = useState<PurchaseOrder | null>(null);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);

  const rows = useMemo(() => {
    const sorted = [...data].sort(byNewest);
    const term = search.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter((po) =>
      [
        po.LOT_NUMBER,
        po.REF_NUMBER,
        growers.nameOf(po.ID_GROWER),
        customers.nameOf(po.ID_CUSTOMER),
        buyerName(po.ID_USERS),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [data, search, growers, customers, buyerName]);

  const columns: Array<Column<PurchaseOrder>> = [
    ...(can('purchases', 'documents')
      ? [{
          key: 'pdf',
          header: '',
          width: '48px',
          align: 'center' as const,
          render: (po: PurchaseOrder) => (
            <button
              type="button"
              className="po-pdf-btn"
              title="Documents"
              onClick={(e) => {
                e.stopPropagation();
                setDocsFor(po);
              }}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" /><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" />
              </svg>
            </button>
          ),
        }]
      : []),
    { key: 'ID_GROWER', header: 'Grower', render: (po) => growers.nameOf(po.ID_GROWER) },
    { key: 'ID_CUSTOMER', header: 'Vendor', render: (po) => customers.nameOf(po.ID_CUSTOMER) },
    { key: 'ID_USERS', header: 'Buyer', render: (po) => buyerName(po.ID_USERS) },
    { key: 'ARRIVAL_DATE', header: 'Arrival Date', render: (po) => fmtDate(po.ARRIVAL_DATE) },
    { key: 'LOT_NUMBER', header: 'Lot #', render: (po) => <span className="mono">{po.LOT_NUMBER || '—'}</span> },
    { key: 'REF_NUMBER', header: '# Ref', render: (po) => po.REF_NUMBER || '—' },
    { key: 'QUANTITY', header: 'Quantity', align: 'right', render: (po) => <span className="num">{po.QUANTITY ?? 0}</span> },
    { key: 'SUBTOTAL', header: 'Subtotal', align: 'right', render: (po) => <span className="num">{fmtMoney(po.SUBTOTAL)}</span> },
    { key: 'TOTAL', header: 'Total', align: 'right', render: (po) => <span className="num">{fmtMoney(po.TOTAL)}</span> },
    { key: 'AMOUNT_PAID', header: 'Amount paid', align: 'right', render: (po) => <span className="num">{fmtMoney(po.AMOUNT_PAID)}</span> },
    {
      key: 'BALANCE',
      header: 'Balance',
      align: 'right',
      render: (po) => (
        <span className={`num${(po.BALANCE ?? 0) > 0 ? ' text-bad' : ''}`}>{fmtMoney(po.BALANCE)}</span>
      ),
    },
  ];

  /** Genera el documento imprimible de la orden (formato Berry Source). */
  const handlePdf = (po: PurchaseOrder) => {
    const vendorDoc = customerDocs.find((c) => c.id === po.ID_CUSTOMER);
    void printPurchaseOrderPdf(po, {
      company,
      vendorName: customers.nameOf(po.ID_CUSTOMER),
      vendorAddress: vendorDoc?.ADDRESS_CUSTOMER ?? '',
      vendorCity: vendorDoc?.CITY_CUSTOMER ?? '',
      shipToName: locations.nameOf(po.SHIPTO),
      carrierName: carriers.nameOf(po.ID_CARRIER),
      salesPerson: buyerName(po.ID_USERS),
      payTerms: po.ID_PAYMENTTERM ? paymentTermsCat.nameOf(po.ID_PAYMENTTERM) : '',
      commodityName: (id) => commodities.nameOf(id),
    });
  };

  /** Genera el LIQUIDATION REPORT del lote (ventas, comision, gastos, balance). */
  const handleLiquidation = (po: PurchaseOrder) => {
    const soNumber = new Map(salesOrders.map((so) => [so.id, so.SALES_ORDER_NUMBER ?? '']));
    void printLiquidationReport(po, {
      company,
      growerName: growers.nameOf(po.ID_GROWER),
      soNumberOf: (id) => soNumber.get(id) ?? '',
      commodityName: (id) => commodities.nameOf(id),
    });
  };

  /** Borrado desde la tabla: detalle + encabezado, en segundo plano. */
  const handleDeleteRow = (po: PurchaseOrder) => {
    if (!window.confirm(`Delete purchase order ${po.LOT_NUMBER || po.REF_NUMBER || ''}?`)) return;
    const persist = async () => {
      await replaceChildren(COLLECTIONS.PURCHASE_DETAILS, 'ID_PURCHASEORDER', po.id, []);
      await deleteDocument(COLLECTIONS.PURCHASE_ORDER, po.id);
    };
    persist().catch((error: unknown) =>
      alert(`Failed to delete: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  return (
    <div className="purchase-orders">
      <Toolbar
        title="Purchase Order"
        subtitle={`${rows.length} orders`}
        searchValue={search}
        onSearchChange={setSearch}
      >
        {can('purchases', 'documents') && <DataPortButtons schemas={PURCHASES_SCHEMAS} fileName="purchase-orders" />}
        {can('purchases', 'add') && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + Add
          </button>
        )}
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        emptyMessage="No purchase orders yet"
        onRowClick={setViewing}
        onEdit={can('purchases', 'edit') ? (po) => { setEditing(po); setFormOpen(true); } : undefined}
        onDelete={can('purchases', 'delete') ? handleDeleteRow : undefined}
      />

      {docsFor && (
        <DocumentPicker
          title="Generate document"
          subtitle={`Purchase order ${docsFor.LOT_NUMBER || docsFor.REF_NUMBER || ''} — ${growers.nameOf(docsFor.ID_GROWER)}`}
          options={[
            { id: 'po', label: 'Purchase Order', description: 'PO document with terms and line items' },
            { id: 'liq', label: 'Liquidation Report', description: 'Lot sales, commission, expenses and balance' },
          ]}
          onClose={() => setDocsFor(null)}
          onSelect={(id) => {
            const target = docsFor;
            setDocsFor(null);
            if (!target) return;
            if (id === 'po') handlePdf(target);
            else handleLiquidation(target);
          }}
        />
      )}

      {viewing && (
        <PurchaseOrderDetailPanel
          order={viewing}
          buyerName={buyerName}
          onClose={() => setViewing(null)}
          onEdit={can('purchases', 'edit') ? () => {
            setEditing(viewing);
            setViewing(null);
            setFormOpen(true);
          } : undefined}
        />
      )}

      <PurchaseOrderForm open={formOpen} initial={editing} onClose={() => setFormOpen(false)} />
    </div>
  );
}

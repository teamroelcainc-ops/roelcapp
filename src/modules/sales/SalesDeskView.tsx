import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog, type CatalogOption } from '../../hooks/useCatalog';
import { deleteDocument, replaceChildren, updateDocument } from '../../services/firestore';
import { COLLECTIONS, type PurchaseOrder, type SalesOrder, type SystemUser } from '../../types/models';
import { byNewest, fmtDate, fmtMoney, round2 } from '../../utils/format';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import { SALES_SCHEMAS } from '../../config/entitySchemas';
import { Modal } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { PaymentsPanel } from '../payments/PaymentsPanel';
import { SalesOrderForm } from './SalesOrderForm';
import { SalesOrderDetailPanel } from './SalesOrderDetailPanel';
import { printSalesInvoice, printPickTicket, printSalesOrderDoc, printBillOfLading, type SalesDocContext } from '../../services/salesDocumentsService';
import { useCompany } from '../../hooks/useCompany';
import { DocumentPicker } from '../../components/ui/DocumentPicker';
import './SalesDeskView.css';

interface SalesDeskViewProps {
  /** Abre el detalle de esta orden al montar (navegacion desde Inventory). */
  initialOpenId?: string | null;
}

export function SalesDeskView({ initialOpenId = null }: SalesDeskViewProps) {
  const { can } = useAuth();
  const { data, loading } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const legacyUsers = useCatalog(COLLECTIONS.USERS, 'EMAIL_USERS');
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);
  const suppliers = useCatalog(COLLECTIONS.SUPPLIERS, 'NAME_SUPPLIERS');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const shipVia = useCatalog(COLLECTIONS.SHIPVIA, 'NAME_SHIPVIA');
  const termShipping = useCatalog(COLLECTIONS.TERMSHIPPING, 'NAME_TERMSHIPPING');
  const paymentTermsCat = useCatalog(COLLECTIONS.PAYMENTTERM, 'NAME_PAYMENTTERM');
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const { data: customerDocs } = useCollection<{ id: string; ADDRESS_CUSTOMER?: string; CITY_CUSTOMER?: string }>(COLLECTIONS.CUSTOMER);
  const { data: supplierDocs } = useCollection<{ id: string; ADDRESS_SUPPLIERS?: string; PHONE_SUPPLIERS?: string }>(COLLECTIONS.SUPPLIERS);
  const locations = useCatalog(COLLECTIONS.LOCATIONS, 'NAME_LOCATIONS');
  const { data: locationDocs } = useCollection<{ id: string; ADDRESS_LOCATIONS?: string; PHONE_LOCATIONS?: string }>(COLLECTIONS.LOCATIONS);
  const { company } = useCompany();
  const [docsFor, setDocsFor] = useState<SalesOrder | null>(null);
  /** Resuelve buyer: usuarios del sistema primero, catalogo legado para registros viejos. */
  const buyerName = useMemo(() => {
    const map = new Map(
      systemUsers.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]),
    );
  return (id?: string): string => (id ? (map.get(id) ?? legacyUsers.nameOf(id)) : '—');
  }, [systemUsers, legacyUsers]);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<SalesOrder | null>(null);

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
  const [editing, setEditing] = useState<SalesOrder | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<SalesOrder | null>(null);

  const purchaseOrderOptions = useMemo<CatalogOption[]>(
    () =>
      [...purchaseOrders]
        .sort((a, b) => (b.LOT_NUMBER ?? '').localeCompare(a.LOT_NUMBER ?? ''))
        .map((po) => ({ id: po.id, name: po.LOT_NUMBER || po.REF_NUMBER || '(PO without lot #)' })),
    [purchaseOrders],
  );

  const rows = useMemo(() => {
    const sorted = [...data].sort(byNewest);
    const term = search.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter((so) =>
      [so.SALES_ORDER_NUMBER, so.REF, so.BUYER, so.STATUS, customers.nameOf(so.ID_CUSTOMER), buyerName(so.ID_USERS)]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [data, search, customers, buyerName]);

  const columns: Array<Column<SalesOrder>> = [
    ...(can('sales', 'documents')
      ? [{
          key: 'docs',
          header: '',
          width: '48px',
          align: 'center' as const,
          render: (so: SalesOrder) => (
            <button
              type="button"
              className="so-docs__btn"
              title="Documents"
              onClick={(e) => {
                e.stopPropagation();
                setDocsFor(so);
              }}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" /><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" />
              </svg>
            </button>
          ),
        }]
      : []),
    { key: 'DATE', header: 'Date', render: (so) => fmtDate(so.DATE) },
    { key: 'SALES_ORDER_NUMBER', header: '# Sales Order', render: (so) => <span className="mono">{so.SALES_ORDER_NUMBER || '—'}</span> },
    { key: 'ID_CUSTOMER', header: 'Customer', render: (so) => customers.nameOf(so.ID_CUSTOMER) },
    { key: 'REF', header: 'Ref', render: (so) => so.REF || '—' },
    { key: 'TOTAL', header: 'Total', align: 'right', render: (so) => <span className="num">{fmtMoney(so.TOTAL)}</span> },
    { key: 'DUE_DATE', header: 'Due Date', render: (so) => fmtDate(so.DUE_DATE) },
    { key: 'STATUS', header: 'Status', render: (so) => <StatusBadge value={so.STATUS ?? 'Draft'} /> },
    {
      key: 'LOADED',
      header: 'Loaded',
      render: (so) => <span className={so.LOADED ? 'text-ok' : 'muted'}>{so.LOADED ? 'Yes' : 'No'}</span>,
    },
    { key: 'ID_USERS', header: 'Salesperson', render: (so) => buyerName(so.ID_USERS) },
    { key: 'BUYER', header: 'Buyer', render: (so) => so.BUYER || '—' },
    {
      key: 'payments',
      header: '',
      align: 'center',
      width: '52px',
      render: (so) => (
        <button
          type="button"
          className="btn btn--icon sales-desk__pay-btn"
          aria-label="Payments"
          title="Payments"
          onClick={(e) => {
            e.stopPropagation();
            setPaymentsFor(so);
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2 2.7 5 3.4 5 1.5 5 3.6-2.2 3-5 3-5-1.1-5-3" />
          </svg>
        </button>
      ),
    },
  ];

  const handleTotalPaidChange = async (so: SalesOrder, totalPaid: number) => {
    await updateDocument<SalesOrder>(COLLECTIONS.SALES_ORDER, so.id, {
      INCOMES: totalPaid,
      BALANCE: round2((so.TOTAL ?? 0) - totalPaid),
    });
  };

  /** Contexto compartido de los 4 documentos imprimibles de la orden. */
  const docContext = (so: SalesOrder): SalesDocContext => {
    const customerDoc = customerDocs.find((c) => c.id === so.ID_CUSTOMER);
    const supplierDoc = supplierDocs.find((s) => s.id === so.ID_SUPPLIERS);
    const locationDoc = locationDocs.find((l) => l.id === so.ID_WAREHOUSE);
    const lotMap = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));
    return {
      company,
      customerName: customers.nameOf(so.ID_CUSTOMER),
      customerAddress: customerDoc?.ADDRESS_CUSTOMER ?? '',
      customerCity: customerDoc?.CITY_CUSTOMER ?? '',
      salesPerson: buyerName(so.ID_USERS),
      carrierName: carriers.nameOf(so.ID_CARRIER),
      shipViaName: shipVia.nameOf(so.ID_SHIPVIA),
      shippingTermsName: termShipping.nameOf(so.ID_TERMSHIPPING),
      /* Payment terms: registro unico del catalogo (respeta el legado si la orden trae uno). */
      paymentTermName: so.ID_PAYMENTTERM ? paymentTermsCat.nameOf(so.ID_PAYMENTTERM) : (paymentTermsCat.options[0]?.name ?? ''),
      /* Warehouse del catalogo Locations; ordenes viejas caen al supplier legado. */
      warehouseName: so.ID_WAREHOUSE ? locations.nameOf(so.ID_WAREHOUSE) : suppliers.nameOf(so.ID_SUPPLIERS),
      warehouseAddress: (so.ID_WAREHOUSE ? locationDoc?.ADDRESS_LOCATIONS : supplierDoc?.ADDRESS_SUPPLIERS) ?? '',
      warehousePhone: (so.ID_WAREHOUSE ? locationDoc?.PHONE_LOCATIONS : supplierDoc?.PHONE_SUPPLIERS) ?? '',
      lotOf: (id) => lotMap.get(id) ?? '',
      commodityName: (id) => commodities.nameOf(id),
    };
  };

  const SALES_DOCS: { id: string; label: string; description: string; run: (so: SalesOrder, ctx: SalesDocContext) => Promise<void> }[] = [
    { id: 'invoice', label: 'Invoice', description: 'Customer invoice with PACA terms', run: printSalesInvoice },
    { id: 'pick', label: 'Pick Ticket', description: 'Warehouse picking list with lots and temp', run: printPickTicket },
    { id: 'so', label: 'Sales Order', description: 'Order confirmation with pick up info', run: printSalesOrderDoc },
    { id: 'bol', label: 'Bill of Lading', description: 'Straight BOL with carrier contract terms', run: printBillOfLading },
  ];
  /** Borrado desde la tabla: detalle + pagos + encabezado, en segundo plano. */
  const handleDeleteRow = (so: SalesOrder) => {
    if (!window.confirm(`Delete sales order ${so.SALES_ORDER_NUMBER || ''}?`)) return;
    const persist = async () => {
      await replaceChildren(COLLECTIONS.SALES_ORDER_DETAIL, 'ID_SALESORDER', so.id, []);
      await replaceChildren(COLLECTIONS.PAYMENT_SALES, 'ID_SALESORDER', so.id, []);
      await deleteDocument(COLLECTIONS.SALES_ORDER, so.id);
    };
    persist().catch((error: unknown) =>
      alert(`Failed to delete: ${(error as Error).message ?? 'Unknown error'}`),
    );
  };

  return (
    <div className="sales-desk">
      <Toolbar title="Sales Desk" subtitle={`${rows.length} orders`} searchValue={search} onSearchChange={setSearch}>
        {can('sales', 'documents') && <DataPortButtons schemas={SALES_SCHEMAS} fileName="sales-orders" />}
        {can('sales', 'add') && (
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
        emptyMessage="No sales orders yet"
        onRowClick={setViewing}
        onEdit={can('sales', 'edit') ? (so) => { setEditing(so); setFormOpen(true); } : undefined}
        onDelete={can('sales', 'delete') ? handleDeleteRow : undefined}
      />

      {docsFor && (
        <DocumentPicker
          title="Generate document"
          subtitle={`Sales order ${docsFor.SALES_ORDER_NUMBER || ''} — ${customers.nameOf(docsFor.ID_CUSTOMER)}`}
          options={SALES_DOCS.map((d) => ({ id: d.id, label: d.label, description: d.description }))}
          onClose={() => setDocsFor(null)}
          onSelect={(id) => {
            const docDef = SALES_DOCS.find((d) => d.id === id);
            const target = docsFor;
            setDocsFor(null);
            if (docDef && target) void docDef.run(target, docContext(target));
          }}
        />
      )}

      {viewing && (
        <SalesOrderDetailPanel
          order={viewing}
          purchaseOrders={purchaseOrders}
          buyerName={buyerName}
          onClose={() => setViewing(null)}
          onEdit={can('sales', 'edit') ? () => {
            setEditing(viewing);
            setViewing(null);
            setFormOpen(true);
          } : undefined}
        />
      )}

      <SalesOrderForm
        open={formOpen}
        initial={editing}
        purchaseOrderOptions={purchaseOrderOptions}
        onClose={() => setFormOpen(false)}
      />

      {paymentsFor && (
        <Modal
          title={`Payments — Sales order ${paymentsFor.SALES_ORDER_NUMBER}`}
          open
          onClose={() => setPaymentsFor(null)}
          wide
        >
          <PaymentsPanel
            moduleId="sales"
            collectionName={COLLECTIONS.PAYMENT_SALES}
            parentField="ID_SALESORDER"
            parentId={paymentsFor.id}
            expectedTotal={paymentsFor.TOTAL ?? 0}
            onTotalPaidChange={(totalPaid) => handleTotalPaidChange(paymentsFor, totalPaid)}
          />
        </Modal>
      )}
    </div>
  );
}

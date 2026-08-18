import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { useAppConfig } from '../../context/AppConfigContext';
import { where } from '../../services/firestore';
import { RecordDetail, DetailSection, type DetailField } from '../../components/ui/RecordDetail';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { FORM_DEFS } from '../../config/formDefs';
import {
  COLLECTIONS,
  type PaymentSales,
  type PurchaseOrder,
  type SalesOrder,
  type SalesOrderDetail,
} from '../../types/models';
import { fmtMoney, round2 } from '../../utils/format';

const fmtDate = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

interface Props {
  order: SalesOrder;
  purchaseOrders: PurchaseOrder[];
  buyerName: (id?: string) => string;
  onClose: () => void;
  onEdit?: () => void;
}

export function SalesOrderDetailPanel({ order, purchaseOrders, buyerName, onClose, onEdit }: Props) {
  const { fieldsFor } = useAppConfig();
  const { data: lines, loading } = useCollection<SalesOrderDetail>(
    COLLECTIONS.SALES_ORDER_DETAIL,
    [where('ID_SALESORDER', '==', order.id)],
    `${COLLECTIONS.SALES_ORDER_DETAIL}:${order.id}`,
  );
  const { data: payments } = useCollection<PaymentSales>(
    COLLECTIONS.PAYMENT_SALES,
    [where('ID_SALESORDER', '==', order.id)],
    `${COLLECTIONS.PAYMENT_SALES}:${order.id}`,
  );
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');
  const carriers = useCatalog(COLLECTIONS.CARRIER, 'NAME_CARRIER');
  const locations = useCatalog(COLLECTIONS.LOCATIONS, 'NAME_LOCATIONS');
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const paymentMethods = useCatalog(COLLECTIONS.PAYMENT_METHOD, 'NAME');

  const lotOf = new Map(purchaseOrders.map((po) => [po.id, po.LOT_NUMBER ?? '']));

  const valueByKey: Record<string, string> = {
    '# Sales order': order.SALES_ORDER_NUMBER ?? '',
    'Status': order.STATUS ?? '',
    'Date': fmtDate(order.DATE ?? ''),
    'Due date': fmtDate(order.DUE_DATE ?? ''),
    'Customer': customers.nameOf(order.ID_CUSTOMER),
    'Buyer': order.BUYER ?? '',
    'Salesperson': buyerName(order.ID_USERS),
    'Ref': order.REF ?? '',
    'Ref pickup': order.REF_PICKUP ?? '',
    'Carrier': carriers.nameOf(order.ID_CARRIER),
    'Warehouse': order.ID_WAREHOUSE ? locations.nameOf(order.ID_WAREHOUSE) : '',
    'Temp log': order.TEMP_LOG ?? '',
    'Description': order.DESCRIPTION ?? '',
  };
  const defaults = FORM_DEFS.find((f) => f.id === 'sales')?.fields ?? [];
  const fields: DetailField[] = fieldsFor('sales', defaults).map((f) => ({
    label: f.label,
    value: valueByKey[f.key] ?? '',
  }));

  const linesTotal = round2(lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0));
  const paymentsTotal = round2(payments.reduce((acc, p) => acc + (p.AMOUNT ?? 0), 0));

  return (
    <RecordDetail
      title={`Sales order ${order.SALES_ORDER_NUMBER || ''}`}
      badge={<StatusBadge value={order.STATUS} />}
      onClose={onClose}
      onEdit={onEdit}
      fields={fields}
    >
      <DetailSection title="Financial summary">
        <div className="record-detail__stats">
          <div className="record-detail__stat record-detail__stat--highlight"><span className="record-detail__stat-label">Total</span><span className="record-detail__stat-value">{fmtMoney(order.TOTAL ?? 0)}</span></div>
          <div className="record-detail__stat"><span className="record-detail__stat-label">Paid</span><span className="record-detail__stat-value">{fmtMoney(order.INCOMES ?? 0)}</span></div>
          <div className={`record-detail__stat${(order.BALANCE ?? 0) > 0 ? ' record-detail__stat--bad' : ''}`}><span className="record-detail__stat-label">Balance</span><span className="record-detail__stat-value">{fmtMoney(order.BALANCE ?? 0)}</span></div>
        </div>
      </DetailSection>

      <DetailSection title={`Line items (${lines.length})`}>
        <div className="record-detail__table-wrap">
          <table className="record-detail__table">
            <thead>
              <tr>
                <th className="record-detail__th">Lot #</th>
                <th className="record-detail__th">Commodity</th>
                <th className="record-detail__th">Description</th>
                <th className="record-detail__th record-detail__th--num">Quantity</th>
                <th className="record-detail__th record-detail__th--num">Price</th>
                <th className="record-detail__th record-detail__th--num">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td className="record-detail__empty" colSpan={6}>Loading…</td></tr>}
              {!loading && lines.length === 0 && (
                <tr><td className="record-detail__empty" colSpan={6}>No line items.</td></tr>
              )}
              {!loading && lines.map((line) => (
                <tr key={line.id}>
                  <td className="record-detail__td record-detail__td--muted">{lotOf.get(line.ID_PURCHASEORDER) || '—'}</td>
                  <td className="record-detail__td record-detail__td--strong">{commodities.nameOf(line.ID_COMMODITIES)}</td>
                  <td className="record-detail__td record-detail__td--muted">{line.DESCRIPTION || '—'}</td>
                  <td className="record-detail__td record-detail__td--num">{line.QUANTITY}</td>
                  <td className="record-detail__td record-detail__td--num">{fmtMoney(line.PRICE)}</td>
                  <td className="record-detail__td record-detail__td--num record-detail__td--strong">{fmtMoney(line.TOTAL)}</td>
                </tr>
              ))}
            </tbody>
            {!loading && lines.length > 0 && (
              <tfoot>
                <tr>
                  <td className="record-detail__tf" colSpan={5}>Total</td>
                  <td className="record-detail__tf record-detail__tf--num">{fmtMoney(linesTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </DetailSection>

      <DetailSection title={`Payments (${payments.length})`}>
        <div className="record-detail__table-wrap">
          <table className="record-detail__table">
            <thead>
              <tr>
                <th className="record-detail__th">Date</th>
                <th className="record-detail__th">Method</th>
                <th className="record-detail__th">Check #</th>
                <th className="record-detail__th">Ref #</th>
                <th className="record-detail__th record-detail__th--num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr><td className="record-detail__empty" colSpan={5}>No payments registered.</td></tr>
              )}
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="record-detail__td record-detail__td--muted">{fmtDate(payment.DATE ?? '')}</td>
                  <td className="record-detail__td">{paymentMethods.nameOf(payment.ID_PAYMENTMETHOD)}</td>
                  <td className="record-detail__td record-detail__td--muted">{payment.CHECK_NUMBER || '—'}</td>
                  <td className="record-detail__td record-detail__td--muted">{payment.REF_NUMBER || '—'}</td>
                  <td className="record-detail__td record-detail__td--num record-detail__td--strong">{fmtMoney(payment.AMOUNT ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            {payments.length > 0 && (
              <tfoot>
                <tr>
                  <td className="record-detail__tf" colSpan={4}>Total paid</td>
                  <td className="record-detail__tf record-detail__tf--num">{fmtMoney(paymentsTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </DetailSection>
    </RecordDetail>
  );
}

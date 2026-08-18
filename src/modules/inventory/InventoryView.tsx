import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useCatalog } from '../../hooks/useCatalog';
import { Toolbar } from '../../components/ui/Toolbar';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { round2, todayISO } from '../../utils/format';
import {
  COLLECTIONS,
  type PurchaseDetail,
  type PurchaseOrder,
  type SalesOrder,
  type SalesOrderDetail,
} from '../../types/models';
import './InventoryView.css';

type InventoryTab = 'stock' | 'movements';
type MovementType = 'all' | 'in' | 'out';

/** Fila unificada del kardex: entradas (Purchase Order) y salidas (Sales Desk). */
interface MovementRow {
  id: string;
  type: 'in' | 'out';
  date: string;
  documentNumber: string;
  commodityId: string;
  description: string;
  party: string;
  quantity: number;
}

const fmtDate = (iso: string): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}` : iso;
};

const fmtQty = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Exporta el reporte a Excel con el mismo formato de marca de Reports. */
async function exportMovements(rows: MovementRow[], commodityName: (id: string) => string): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Inventory Movements');
  const headers = ['Date', 'Type', 'Document', 'Commodity', 'Description', 'From / To', 'Quantity'];

  const titleRow = sheet.getRow(1);
  titleRow.getCell(1).value = 'Inventory Movements';
  titleRow.getCell(1).font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF1F7A4D' } };
  sheet.mergeCells(1, 1, 1, headers.length);

  const dateRow = sheet.getRow(2);
  dateRow.getCell(1).value = `Generated: ${new Date().toLocaleString('en-US')}`;
  dateRow.getCell(1).font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(2, 1, 2, headers.length);

  const headerRow = sheet.getRow(4);
  headers.forEach((header, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = header;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F7A4D' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  rows.forEach((row, r) => {
    const excelRow = sheet.getRow(5 + r);
    const values: (string | number)[] = [
      fmtDate(row.date),
      row.type === 'in' ? 'IN' : 'OUT',
      row.documentNumber,
      commodityName(row.commodityId),
      row.description,
      row.party,
      row.type === 'in' ? row.quantity : -row.quantity,
    ];
    values.forEach((value, c) => {
      excelRow.getCell(c + 1).value = value;
    });
  });

  headers.forEach((_, i) => {
    sheet.getColumn(i + 1).width = i === 3 || i === 5 ? 26 : 14;
  });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `inventory-movements-${todayISO()}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

export function InventoryView() {
  const { can } = useAuth();
  const { data: purchaseOrders } = useCollection<PurchaseOrder>(COLLECTIONS.PURCHASE_ORDER);
  const { data: purchaseDetails } = useCollection<PurchaseDetail>(COLLECTIONS.PURCHASE_DETAILS);
  const { data: salesOrders } = useCollection<SalesOrder>(COLLECTIONS.SALES_ORDER);
  const { data: salesDetails } = useCollection<SalesOrderDetail>(COLLECTIONS.SALES_ORDER_DETAIL);
  const commodities = useCatalog(COLLECTIONS.COMMODITIES, 'NAME_COMMODITIES');
  const growers = useCatalog(COLLECTIONS.GROWER, 'NAME_GROWER');
  const customers = useCatalog(COLLECTIONS.CUSTOMER, 'NAME_CUSTOMER');

  const [tab, setTab] = useState<InventoryTab>('stock');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MovementType>('all');
  const [commodityFilter, setCommodityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  /* Ordenes de venta canceladas no afectan el inventario. */
  const cancelledSales = useMemo(
    () => new Set(salesOrders.filter((so) => so.STATUS === 'Cancelled').map((so) => so.id)),
    [salesOrders],
  );

  /** Entradas: cada linea de Purchase Order es un ingreso al inventario. */
  const inRows = useMemo<MovementRow[]>(() => {
    const poById = new Map(purchaseOrders.map((po) => [po.id, po]));
    return purchaseDetails
      .filter((line) => line.ID_COMMODITIES)
      .map((line) => {
        const po = poById.get(line.ID_PURCHASEORDER);
        return {
          id: `in-${line.id}`,
          type: 'in' as const,
          date: po?.ARRIVAL_DATE ?? '',
          documentNumber: po?.LOT_NUMBER || po?.REF_NUMBER || '(no lot #)',
          commodityId: line.ID_COMMODITIES,
          description: line.DESCRIPTION ?? '',
          party: growers.nameOf(po?.ID_GROWER ?? ''),
          quantity: round2(line.QUANTITY ?? 0),
        };
      });
  }, [purchaseDetails, purchaseOrders, growers]);

  /** Salidas: cada linea de Sales Desk descuenta inventario (excepto canceladas). */
  const outRows = useMemo<MovementRow[]>(() => {
    const soById = new Map(salesOrders.map((so) => [so.id, so]));
    return salesDetails
      .filter((line) => line.ID_COMMODITIES && !cancelledSales.has(line.ID_SALESORDER))
      .map((line) => {
        const so = soById.get(line.ID_SALESORDER);
        return {
          id: `out-${line.id}`,
          type: 'out' as const,
          date: so?.DATE ?? '',
          documentNumber: so?.SALES_ORDER_NUMBER || '(no order #)',
          commodityId: line.ID_COMMODITIES,
          description: line.DESCRIPTION ?? '',
          party: customers.nameOf(so?.ID_CUSTOMER ?? ''),
          quantity: round2(line.QUANTITY ?? 0),
        };
      });
  }, [salesDetails, salesOrders, cancelledSales, customers]);

  /* ---- Resumen de stock por producto (Stock / Committed / Available) ---- */
  const stockRows = useMemo(() => {
    const totals = new Map<string, { stock: number; committed: number }>();
    for (const row of inRows) {
      const entry = totals.get(row.commodityId) ?? { stock: 0, committed: 0 };
      entry.stock = round2(entry.stock + row.quantity);
      totals.set(row.commodityId, entry);
    }
    for (const row of outRows) {
      const entry = totals.get(row.commodityId) ?? { stock: 0, committed: 0 };
      entry.committed = round2(entry.committed + row.quantity);
      totals.set(row.commodityId, entry);
    }
    const term = search.trim().toLowerCase();
    return [...totals.entries()]
      .map(([commodityId, entry]) => ({
        commodityId,
        name: commodities.nameOf(commodityId),
        stock: entry.stock,
        committed: entry.committed,
        available: round2(entry.stock - entry.committed),
      }))
      .filter((row) => !term || row.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inRows, outRows, commodities, search]);

  const stockTotals = useMemo(
    () => ({
      stock: round2(stockRows.reduce((acc, r) => acc + r.stock, 0)),
      committed: round2(stockRows.reduce((acc, r) => acc + r.committed, 0)),
      available: round2(stockRows.reduce((acc, r) => acc + r.available, 0)),
    }),
    [stockRows],
  );

  /* ---- Reporte de movimientos (entradas y salidas) ---- */
  const movementRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...inRows, ...outRows]
      .filter((row) => typeFilter === 'all' || row.type === typeFilter)
      .filter((row) => !commodityFilter || row.commodityId === commodityFilter)
      .filter((row) => !dateFrom || (row.date && row.date >= dateFrom))
      .filter((row) => !dateTo || (row.date && row.date <= dateTo))
      .filter(
        (row) =>
          !term ||
          [row.documentNumber, commodities.nameOf(row.commodityId), row.description, row.party]
            .join(' ')
            .toLowerCase()
            .includes(term),
      )
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.documentNumber.localeCompare(b.documentNumber));
  }, [inRows, outRows, typeFilter, commodityFilter, dateFrom, dateTo, search, commodities]);

  const movementTotals = useMemo(() => {
    const totalIn = round2(movementRows.filter((r) => r.type === 'in').reduce((acc, r) => acc + r.quantity, 0));
    const totalOut = round2(movementRows.filter((r) => r.type === 'out').reduce((acc, r) => acc + r.quantity, 0));
    return { totalIn, totalOut, net: round2(totalIn - totalOut) };
  }, [movementRows]);

  const commodityOptions = useMemo(
    () => [...commodities.options].sort((a, b) => a.name.localeCompare(b.name)),
    [commodities.options],
  );

  return (
    <div className="inventory">
      <Toolbar
        title="Inventory"
        subtitle="Entries from Purchase Orders, exits from Sales Desk"
        searchValue={search}
        onSearchChange={setSearch}
      >
        {tab === 'movements' && can('inventory', 'documents') && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void exportMovements(movementRows, commodities.nameOf)}
          >
            Export Excel
          </button>
        )}
      </Toolbar>

      <div className="inventory__tabs">
        <button
          type="button"
          className={`inventory__tab${tab === 'stock' ? ' inventory__tab--active' : ''}`}
          onClick={() => setTab('stock')}
        >
          Stock
        </button>
        <button
          type="button"
          className={`inventory__tab${tab === 'movements' ? ' inventory__tab--active' : ''}`}
          onClick={() => setTab('movements')}
        >
          Movements (In / Out)
        </button>
      </div>

      {tab === 'stock' && (
        <>
          <div className="inventory__chips">
            <span className="inventory__chip">{stockRows.length} products</span>
            <span className="inventory__chip">Stock <b className="num">{fmtQty(stockTotals.stock)}</b></span>
            <span className="inventory__chip">Committed <b className="num">{fmtQty(stockTotals.committed)}</b></span>
            <span className={`inventory__chip${stockTotals.available < 0 ? ' inventory__chip--bad' : ' inventory__chip--ok'}`}>
              Available <b className="num">{fmtQty(stockTotals.available)}</b>
            </span>
          </div>

          <div className="inventory__card">
            <table className="inventory__table">
              <thead>
                <tr>
                  <th className="inventory__th">Commodity</th>
                  <th className="inventory__th inventory__th--num">Stock</th>
                  <th className="inventory__th inventory__th--num">Committed</th>
                  <th className="inventory__th inventory__th--num">Available</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.length === 0 && (
                  <tr><td className="inventory__empty" colSpan={4}>No inventory movements yet. Register purchase orders to build stock.</td></tr>
                )}
                {stockRows.map((row) => (
                  <tr key={row.commodityId}>
                    <td className="inventory__td inventory__td--strong">{row.name}</td>
                    <td className="inventory__td inventory__td--num">{fmtQty(row.stock)}</td>
                    <td className="inventory__td inventory__td--num inventory__td--muted">{fmtQty(row.committed)}</td>
                    <td className={`inventory__td inventory__td--num inventory__available${row.available < 0 ? ' inventory__available--bad' : row.available === 0 ? ' inventory__available--zero' : ''}`}>
                      {fmtQty(row.available)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {stockRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td className="inventory__tf">Total</td>
                    <td className="inventory__tf inventory__tf--num">{fmtQty(stockTotals.stock)}</td>
                    <td className="inventory__tf inventory__tf--num">{fmtQty(stockTotals.committed)}</td>
                    <td className="inventory__tf inventory__tf--num">{fmtQty(stockTotals.available)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {tab === 'movements' && (
        <>
          <div className="inventory__filters">
            <div className="inventory__filter">
              <span className="inventory__filter-label">Type</span>
              <select
                className="input"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as MovementType)}
              >
                <option value="all">All movements</option>
                <option value="in">In (purchases)</option>
                <option value="out">Out (sales)</option>
              </select>
            </div>
            <div className="inventory__filter inventory__filter--wide">
              <span className="inventory__filter-label">Commodity</span>
              <SearchableSelect
                value={commodityFilter}
                onChange={setCommodityFilter}
                options={commodityOptions}
                placeholder="All commodities…"
              />
            </div>
            <div className="inventory__filter">
              <span className="inventory__filter-label">From</span>
              <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="inventory__filter">
              <span className="inventory__filter-label">To</span>
              <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>

          <div className="inventory__chips">
            <span className="inventory__chip">{movementRows.length} movements</span>
            <span className="inventory__chip inventory__chip--ok">In <b className="num">{fmtQty(movementTotals.totalIn)}</b></span>
            <span className="inventory__chip inventory__chip--bad">Out <b className="num">{fmtQty(movementTotals.totalOut)}</b></span>
            <span className="inventory__chip">Net <b className="num">{fmtQty(movementTotals.net)}</b></span>
          </div>

          <div className="inventory__card">
            <table className="inventory__table">
              <thead>
                <tr>
                  <th className="inventory__th">Date</th>
                  <th className="inventory__th">Type</th>
                  <th className="inventory__th">Document</th>
                  <th className="inventory__th">Commodity</th>
                  <th className="inventory__th">Description</th>
                  <th className="inventory__th">From / To</th>
                  <th className="inventory__th inventory__th--num">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {movementRows.length === 0 && (
                  <tr><td className="inventory__empty" colSpan={7}>No movements match the current filters.</td></tr>
                )}
                {movementRows.map((row) => (
                  <tr key={row.id}>
                    <td className="inventory__td inventory__td--muted">{fmtDate(row.date)}</td>
                    <td className="inventory__td">
                      <span className={`inventory__badge inventory__badge--${row.type}`}>
                        {row.type === 'in' ? 'IN' : 'OUT'}
                      </span>
                    </td>
                    <td className="inventory__td inventory__td--mono">{row.documentNumber}</td>
                    <td className="inventory__td inventory__td--strong">{commodities.nameOf(row.commodityId)}</td>
                    <td className="inventory__td inventory__td--muted">{row.description || '—'}</td>
                    <td className="inventory__td">{row.party || '—'}</td>
                    <td className={`inventory__td inventory__td--num inventory__qty--${row.type}`}>
                      {row.type === 'in' ? '+' : '−'}{fmtQty(row.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

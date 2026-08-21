/**
 * LIQUIDATION REPORT imprimible (formato Berry Source, LC).
 * Replica el layout de AppSheet: banner verde, logo, tabla de datos del lote
 * (Lot #, Grower, Arrival Date, REF), ventas del lote (ID Number, Product,
 * Qty Rcvd, Sale Price, Total Sales), marca de agua y bloque de totales
 * (SubTotal, Commission, Expenses, Total Liquidation, Total paid, Balance).
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { COLLECTIONS, type CompanyInfo, type PurchaseOrder, type SalesOrderDetail } from '../types/models';

const GREEN = '#6aa84f';

export interface LiquidationReportContext {
  company: CompanyInfo;
  growerName: string;
  /** Numero de sales order a partir del id del documento. */
  soNumberOf: (salesOrderId: string) => string;
  commodityName: (id: string) => string;
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtUsd = (n: number, decimals = 2): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtSlashDate = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}` : iso;
};

export async function printLiquidationReport(
  order: PurchaseOrder,
  ctx: LiquidationReportContext,
): Promise<void> {
  /* Ventas del lote: lineas de sales orders que vendieron de esta PO. */
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.SALES_ORDER_DETAIL), where('ID_PURCHASEORDER', '==', order.id)),
  );
  const lines: SalesOrderDetail[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SalesOrderDetail);

  const subtotal = lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0);
  const commission = order.COMMISION_AMOUNT ?? 0;
  const expenses = order.TOTAL_EXPENSES ?? order.EXPENSES ?? 0;
  const totalLiquidation = subtotal - commission - expenses;
  const totalPaid = order.AMOUNT_PAID ?? 0;
  const balance = totalLiquidation - totalPaid;
  const { company } = ctx;

  const rowsHtml = lines
    .map(
      (line) => `
      <tr>
        <td class="td center">${esc(ctx.soNumberOf(line.ID_SALESORDER))}</td>
        <td class="td">${esc(ctx.commodityName(line.ID_COMMODITIES))}</td>
        <td class="td center">${fmtUsd(line.QUANTITY ?? 0, 0)}</td>
        <td class="td num">$${fmtUsd(line.PRICE ?? 0, 6)}</td>
        <td class="td num">$${fmtUsd(line.TOTAL ?? 0, 6)}</td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(order.LOT_NUMBER || 'Liquidation Report')} - Liquidation</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1c1c; background: #eef0f3; padding: 24px; font-size: 12.5px; }
  .page { position: relative; max-width: 820px; margin: 0 auto; background: #ffffff; padding: 46px 54px 60px; min-height: 1060px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
  .watermark { position: absolute; top: 58%; left: 34%; transform: translate(-50%, -50%); opacity: 0.14; pointer-events: none; }
  .watermark img { width: 360px; }
  .content { position: relative; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  .logo img { max-height: 80px; max-width: 200px; object-fit: contain; }
  .banner { background: ${GREEN}; color: #ffffff; font-size: 13px; letter-spacing: 0.04em; padding: 9px 0; width: 340px; text-align: center; margin-top: 8px; }
  .info { width: 100%; border-collapse: collapse; margin-top: 26px; border: 1.4px solid ${GREEN}; }
  .info-label { background: ${GREEN}; color: #ffffff; padding: 8px 12px; width: 235px; border-bottom: 2px solid #ffffff; font-size: 12.5px; }
  .info-value { padding: 8px 14px; border-bottom: 1px solid #e2e8e0; }
  .sales { width: 100%; border-collapse: collapse; margin-top: 26px; }
  .sales thead th { background: ${GREEN}; color: #ffffff; padding: 9px 10px; font-weight: 600; font-size: 12.5px; }
  .sales thead th.left { text-align: left; }
  .td { padding: 9px 10px; font-size: 12.5px; }
  .num { text-align: right; }
  .center { text-align: center; }
  .totals { margin-top: 46px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .t-row { display: flex; align-items: center; justify-content: flex-end; gap: 18px; padding: 5px 0; }
  .t-label { font-size: 12.5px; }
  .t-label--chip { background: ${GREEN}; color: #ffffff; padding: 7px 34px; }
  .t-value { min-width: 130px; text-align: right; font-size: 12.5px; padding: 6px 4px; }
  .t-value--line { border-top: 1.4px solid #1c1c1c; border-bottom: 1.4px solid #1c1c1c; }
  .t-value--top { border-top: 1.4px solid #1c1c1c; }
  .t-gap { height: 22px; }
  .print-bar { text-align: center; margin: 0 0 18px; }
  .print-bar button { background: #1f7a4d; color: #ffffff; border: none; padding: 10px 26px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  @media print {
    body { background: #ffffff; padding: 0; }
    .print-bar { display: none; }
    .page { box-shadow: none; max-width: none; min-height: auto; padding: 30px 40px 50px; }
  }
</style>
</head>
<body>
<div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">
  ${company.logo ? `<div class="watermark"><img src="${company.logo}" alt="" /></div>` : ''}
  <div class="content">
    <div class="top">
      <div class="logo">${company.logo ? `<img src="${company.logo}" alt="logo" />` : `<strong>${esc(company.name)}</strong>`}</div>
      <div class="banner">LIQUIDATION REPORT</div>
    </div>

    <table class="info">
      <tbody>
        <tr><td class="info-label">Lot #</td><td class="info-value">${esc(order.LOT_NUMBER || '')}</td></tr>
        <tr><td class="info-label">Grower</td><td class="info-value">${esc(ctx.growerName)}</td></tr>
        <tr><td class="info-label">Arrival Date</td><td class="info-value">${fmtSlashDate(order.ARRIVAL_DATE || '')}</td></tr>
        <tr><td class="info-label">REF</td><td class="info-value">${esc(order.REF_NUMBER || '')}</td></tr>
      </tbody>
    </table>

    <table class="sales">
      <thead>
        <tr>
          <th>ID Number</th>
          <th class="left">Product</th>
          <th>Qty Rcvd</th>
          <th>Sale Price</th>
          <th>Total Sales</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || '<tr><td class="td center" colspan="5" style="color:#777">No sales registered for this lot</td></tr>'}</tbody>
    </table>

    <div class="totals">
      <div class="t-row">
        <span class="t-label">SubTotal</span>
        <span class="t-value t-value--line">$${fmtUsd(subtotal)}</span>
      </div>
      <div class="t-gap"></div>
      <div class="t-row">
        <span class="t-label t-label--chip">Commision</span>
        <span class="t-value">$${fmtUsd(commission)}</span>
      </div>
      <div class="t-gap"></div>
      <div class="t-row">
        <span class="t-label">Expenses</span>
        <span class="t-value t-value--top">$${fmtUsd(expenses)}</span>
      </div>
      <div class="t-gap"></div>
      <div class="t-row">
        <span class="t-label">Total Liquidation</span>
        <span class="t-value t-value--top">$${fmtUsd(totalLiquidation)}</span>
      </div>
      <div class="t-row">
        <span class="t-label">Total paid</span>
        <span class="t-value">$${fmtUsd(totalPaid)}</span>
      </div>
      <div class="t-row">
        <span class="t-label">Balance</span>
        <span class="t-value t-value--line">$${fmtUsd(balance)}</span>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the document window. Allow pop-ups for this site.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

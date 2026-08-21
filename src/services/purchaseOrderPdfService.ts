/**
 * Documento imprimible de Purchase Order (formato Berry Source, LC).
 * Replica el layout del PDF de AppSheet: encabezado con logo y datos de la
 * empresa, PO#/fecha, Vendor y Ship To, caja de terminos, tabla de lineas,
 * total y logo como marca de agua. Se abre en pestaña lista para imprimir o
 * guardar como PDF.
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { COLLECTIONS, type CompanyInfo, type PurchaseDetail, type PurchaseOrder } from '../types/models';

/* Terminos mostrados en la caja central (ajustables aqui o, si se necesita,
   los movemos a un campo por vendor o por orden). */
/** Fallback cuando la orden no tiene payment term del catalogo. */
const PAY_TERMS_FALLBACK = '21 Days';
const SALE_TERMS = 'PACA';
const DEFAULT_UOM = 'Cases';

export interface PurchaseOrderPdfContext {
  company: CompanyInfo;
  vendorName: string;
  vendorAddress: string;
  vendorCity: string;
  shipToName: string;
  carrierName: string;
  salesPerson: string;
  /** Payment term del catalogo (vacio = fallback). */
  payTerms: string;
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

export async function printPurchaseOrderPdf(
  order: PurchaseOrder,
  ctx: PurchaseOrderPdfContext,
): Promise<void> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.PURCHASE_DETAILS), where('ID_PURCHASEORDER', '==', order.id)),
  );
  const lines: PurchaseDetail[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PurchaseDetail);
  const total = lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0);
  const { company } = ctx;

  const rowsHtml = lines
    .map(
      (line) => `
      <tr>
        <td class="td">${esc(line.DESCRIPTION?.trim() || ctx.commodityName(line.ID_COMMODITIES))}</td>
        <td class="td num">${fmtUsd(line.QUANTITY ?? 0, 0)}</td>
        <td class="td center">${DEFAULT_UOM}</td>
        <td class="td num">$${fmtUsd(line.PRICE ?? 0, 6)}</td>
        <td class="td num">$${fmtUsd(line.TOTAL ?? 0)}</td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(order.LOT_NUMBER || 'Purchase Order')}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  :root { --blue: #1d3fc8; --ink: #1c1c1c; }
  body { font-family: Arial, Helvetica, sans-serif; color: var(--ink); background: #eef0f3; padding: 24px; font-size: 12px; }
  .page { position: relative; max-width: 820px; margin: 0 auto; background: #ffffff; padding: 46px 54px 60px; min-height: 1060px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
  .watermark { position: absolute; top: 66%; left: 50%; transform: translate(-50%, -50%); opacity: 0.16; pointer-events: none; }
  .watermark img { width: 320px; }
  .content { position: relative; }
  .logo img { max-height: 74px; max-width: 190px; object-fit: contain; }
  .title { text-align: center; color: var(--blue); font-size: 27px; font-weight: 800; margin-top: 2px; letter-spacing: 0.01em; }
  .co { text-align: center; margin-top: 8px; line-height: 1.55; font-size: 12.5px; }
  .po-meta { text-align: right; margin-top: 16px; color: var(--blue); font-weight: 700; font-size: 13px; line-height: 1.6; }
  .po-meta b { color: var(--blue); }
  .parties { display: flex; gap: 40px; margin-top: 34px; }
  .party { flex: 1; line-height: 1.55; }
  .party-title { color: var(--blue); font-weight: 700; margin-bottom: 4px; }
  .terms { display: grid; grid-template-columns: 1.1fr 1.1fr 1.1fr; border: 1.6px solid var(--ink); margin-top: 30px; }
  .terms-cell { padding: 9px 12px; line-height: 1.7; }
  .terms-cell + .terms-cell { border-left: 1.2px solid var(--ink); }
  .terms b { color: var(--blue); }
  .items { width: 100%; border-collapse: collapse; margin-top: 34px; }
  .items thead th { color: var(--blue); font-size: 12.5px; text-align: left; padding: 6px 8px; border-bottom: 2px solid var(--blue); }
  .items thead th.num { text-align: right; }
  .items thead th.center { text-align: center; }
  .td { padding: 9px 8px; font-size: 12.5px; }
  .num { text-align: right; }
  .center { text-align: center; }
  .total-row { display: flex; justify-content: flex-end; align-items: center; gap: 26px; margin-top: 26px; }
  .total-label { color: var(--blue); font-weight: 800; font-size: 14px; }
  .total-value { font-weight: 800; font-size: 14px; border-top: 2.4px solid var(--blue); padding: 6px 4px 0; min-width: 120px; text-align: right; }
  .page-num { position: absolute; bottom: 22px; right: 54px; color: var(--blue); font-size: 11.5px; }
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
    ${company.logo ? `<div class="logo"><img src="${company.logo}" alt="logo" /></div>` : ''}
    <div class="title">PURCHASE ORDER</div>
    <div class="co">
      ${esc(company.name)}<br />
      ${esc(company.address)}<br />
      ${esc(company.cityStateZip)}<br />
      ${company.phone ? `${esc(company.phone)} Phone<br />` : ''}
      ${esc(company.email)}
    </div>

    <div class="po-meta">
      PO#: ${esc(order.LOT_NUMBER || '')}<br />
      Date: ${fmtSlashDate(order.ARRIVAL_DATE || '')}
    </div>

    <div class="parties">
      <div class="party">
        <div class="party-title">Vendor:</div>
        ${esc(ctx.vendorName)}<br />
        ${ctx.vendorAddress ? `${esc(ctx.vendorAddress)}<br />` : ''}
        ${ctx.vendorCity ? esc(ctx.vendorCity) : ''}
      </div>
      <div class="party">
        <div class="party-title">Ship To:</div>
        ${esc(ctx.shipToName || company.name)}
      </div>
    </div>

    <div class="terms">
      <div class="terms-cell">
        <b>Pay Terms:</b> ${esc(ctx.payTerms || PAY_TERMS_FALLBACK)}<br />
        <b>Sale Terms:</b> ${esc(SALE_TERMS)}
      </div>
      <div class="terms-cell">
        <b>Ref Nº:</b> ${esc(order.REF_NUMBER || '')}<br />
        <b>SalesPerson:</b> ${esc(ctx.salesPerson)}
      </div>
      <div class="terms-cell">
        <b>Delivery Date:</b> ${fmtSlashDate(order.ARRIVAL_DATE || '')}<br />
        <b>Carrier:</b> ${esc(ctx.carrierName)}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Quantity</th>
          <th class="center">UOM</th>
          <th class="num">Cost</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || '<tr><td class="td" colspan="5" style="text-align:center;color:#777">No line items</td></tr>'}</tbody>
    </table>

    <div class="total-row">
      <span class="total-label">PURCHASE ORDER TOTAL:</span>
      <span class="total-value">$${fmtUsd(total)}</span>
    </div>
  </div>
  <div class="page-num">Page 1 of 1</div>
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

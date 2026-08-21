/**
 * Documentos imprimibles de Sales Desk (formato Berry Source, LC):
 * Invoice, Pick Ticket, Sales Order y Straight Bill of Lading.
 * Todos replican los layouts de AppSheet: logo + direccion, tablas verdes,
 * SOLD TO / SHIP TO, marca de agua y sus bloques especificos.
 */
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { COLLECTIONS, type CompanyInfo, type SalesOrder, type SalesOrderDetail } from '../types/models';

const GREEN = '#6aa84f';
const GREEN_DARK = '#38761d';
const GREEN_SOFT = '#d9ead3';

export interface SalesDocContext {
  company: CompanyInfo;
  customerName: string;
  customerAddress: string;
  customerCity: string;
  salesPerson: string;
  carrierName: string;
  shipViaName: string;
  shippingTermsName: string;
  /** Nombre del payment term del catalogo (ej. '15 Days'); vacio = fallback a dias calculados. */
  paymentTermName: string;
  /** Almacen de despacho: catalogo CAT_LOCATIONS (fallback a supplier legado). */
  warehouseName: string;
  warehouseAddress: string;
  warehousePhone: string;
  lotOf: (purchaseOrderId: string) => string;
  commodityName: (id: string) => string;
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtUsd = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtQty = (n: number): string => n.toLocaleString('en-US');

const fmtSlashDate = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}` : iso;
};

const paymentTermDays = (order: SalesOrder): string => {
  if (!order.DATE || !order.DUE_DATE) return '';
  const from = new Date(`${order.DATE}T00:00:00`).getTime();
  const to = new Date(`${order.DUE_DATE}T00:00:00`).getTime();
  const days = Math.round((to - from) / 86400000);
  return days > 0 ? `${days} Days` : '';
};

async function fetchLines(orderId: string): Promise<SalesOrderDetail[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.SALES_ORDER_DETAIL), where('ID_SALESORDER', '==', orderId)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SalesOrderDetail);
}

/* ---------- Piezas compartidas de layout ---------- */

const baseStyles = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1c1c; background: #eef0f3; padding: 24px; font-size: 12px; }
  .page { position: relative; max-width: 820px; margin: 0 auto; background: #ffffff; padding: 42px 50px 56px; min-height: 1060px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
  .watermark { position: absolute; top: 72%; left: 38%; transform: translate(-50%, -50%); opacity: 0.14; pointer-events: none; }
  .watermark img { width: 340px; }
  .content { position: relative; }
  .logo img { max-height: 66px; max-width: 170px; object-fit: contain; }
  .co-addr { font-size: 11.5px; line-height: 1.5; margin-top: 3px; text-align: center; max-width: 190px; }
  .kv { border-collapse: collapse; }
  .kv td { border: 1px solid ${GREEN_DARK}; padding: 6px 10px; font-size: 11.5px; }
  .kv .k { background: ${GREEN}; color: #ffffff; width: 108px; }
  .kv .v { min-width: 150px; background: #ffffff; }
  .sold-ship { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 30px; }
  .ss-head { background: #d9d9d9; text-align: center; font-weight: 700; padding: 7px 0; font-size: 12px; }
  .ss-body { text-align: center; padding: 10px 6px; line-height: 1.5; }
  .bar { width: 100%; border-collapse: collapse; margin-top: 22px; }
  .bar th { background: ${GREEN}; color: #ffffff; font-weight: 600; padding: 7px 8px; font-size: 11.8px; }
  .bar td { padding: 8px; text-align: center; font-size: 11.8px; }
  .bar td.soft { background: ${GREEN_SOFT}; border: 1px solid ${GREEN}; }
  .items { width: 100%; border-collapse: collapse; margin-top: 22px; }
  .items th { background: ${GREEN}; color: #ffffff; font-weight: 600; padding: 7px 8px; font-size: 11.8px; }
  .items td { padding: 9px 8px; font-size: 12px; vertical-align: top; }
  .items .left { text-align: left; }
  .items .center { text-align: center; }
  .items .num { text-align: right; }
  .print-bar { text-align: center; margin: 0 0 18px; }
  .print-bar button { background: #1f7a4d; color: #ffffff; border: none; padding: 10px 26px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  @media print {
    body { background: #ffffff; padding: 0; }
    .print-bar { display: none; }
    .page { box-shadow: none; max-width: none; min-height: auto; padding: 26px 36px 46px; }
  }
`;

const logoBlock = (company: CompanyInfo): string => `
  <div>
    ${company.logo ? `<div class="logo"><img src="${company.logo}" alt="logo" /></div>` : `<strong style="font-size:16px">${esc(company.name)}</strong>`}
    <div class="co-addr">${esc(company.address)}<br />${esc(company.cityStateZip)}<br />${company.phone ? `${esc(company.phone)} Main` : ''}</div>
  </div>`;

const soldShipBlock = (ctx: SalesDocContext, order: SalesOrder): string => {
  const sold = `${esc(ctx.customerName)}<br />${esc(ctx.customerAddress)}<br />${esc(ctx.customerCity)}`;
  /* SHIP TO: direccion del Warehouse (Locations); ordenes legadas caen al ADDRESS guardado o al cliente. */
  const ship = ctx.warehouseName
    ? `${esc(ctx.warehouseName)}<br />${esc(ctx.warehouseAddress)}${ctx.warehousePhone ? `<br />${esc(ctx.warehousePhone)}` : ''}`
    : order.ADDRESS
      ? `${esc(ctx.customerName)}<br />${esc(order.ADDRESS)}<br />${esc(order.CITY_STATE_ZIP || '')}`
      : sold;
  return `
  <div class="sold-ship">
    <div><div class="ss-head">SOLD TO</div><div class="ss-body">${sold}</div></div>
    <div><div class="ss-head">SHIP TO</div><div class="ss-body">${ship}</div></div>
  </div>`;
};

const watermark = (company: CompanyInfo): string =>
  company.logo ? `<div class="watermark"><img src="${company.logo}" alt="" /></div>` : '';

const openWindow = (html: string): void => {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the document window. Allow pop-ups for this site.');
    return;
  }
  win.document.write(html);
  win.document.close();
};

const headTables = (
  ctx: SalesDocContext,
  order: SalesOrder,
  titleHtml: string,
  numberLabel: string,
): string => `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      ${logoBlock(ctx.company)}
      <div style="text-align:right;">${titleHtml}</div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-top:14px;">
      <table class="kv">
        <tr><td class="k">SALES PERSON</td><td class="v">${esc(ctx.salesPerson)}</td></tr>
        <tr><td class="k">CARRIER</td><td class="v">${esc(ctx.carrierName)}</td></tr>
      </table>
      <table class="kv">
        <tr><td class="k">DATE</td><td class="v">${fmtSlashDate(order.DATE || '')}</td></tr>
        <tr><td class="k">${numberLabel}</td><td class="v">${esc(order.SALES_ORDER_NUMBER || '')}</td></tr>
        <tr><td class="k">CUSTOMER</td><td class="v">${esc(ctx.customerName)}</td></tr>
        <tr><td class="k">BUYER</td><td class="v">${esc(order.BUYER || '')}</td></tr>
      </table>
    </div>`;

/* ---------- 1. INVOICE ---------- */

const PACA_TEXT =
  'The perishable agricultural commodities listed on this invoice are sold subject to the statutory trust authorized by Section 5(c) of the Perishable Agricultural Commodities Act, 1930 (7 USC 499e(c)). The seller of these commodities retains a trust claim over these commodities, all inventories of food or other products derived from these commodities, and any receivables or proceeds from the sale of these commodities until full payment is received. NOTICE: Past due invoices shall accrue annual interest at the rate of 12% or at the maximum legal rate, whichever is lower. Receiver agrees that seller shall be entitled to collect reasonable attorney\u2019s fees and expenses as part of an action to collect on this invoice. Actual attorney\u2019s fees incurred in bringing any action to collect on this invoice and/or enforcing any judgment granted and interest shall be considered as additional sums owed in connection with this transaction.';

export async function printSalesInvoice(order: SalesOrder, ctx: SalesDocContext): Promise<void> {
  const lines = await fetchLines(order.id);
  const subtotal = lines.reduce((acc, l) => acc + (l.TOTAL ?? 0), 0);
  const rows = lines
    .map(
      (l) => `
      <tr>
        <td class="center">${esc(ctx.commodityName(l.ID_COMMODITIES))}</td>
        <td class="left">${esc(l.DESCRIPTION || '')}</td>
        <td class="center">${fmtQty(l.QUANTITY ?? 0)}</td>
        <td class="num">$${fmtUsd(l.PRICE ?? 0)}</td>
        <td class="num">$${fmtUsd(l.TOTAL ?? 0)}</td>
      </tr>`,
    )
    .join('');

  openWindow(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<title>Invoice ${esc(order.SALES_ORDER_NUMBER || '')}</title>
<style>${baseStyles}
  .inv-title { color: ${GREEN}; font-size: 24px; font-weight: 800; letter-spacing: 0.01em; margin-bottom: 8px; }
  .totals { margin-top: 40px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .t-row { display: flex; justify-content: flex-end; gap: 20px; padding: 5px 0; font-size: 12.5px; }
  .t-label { font-weight: 600; }
  .t-value { min-width: 120px; text-align: right; padding: 4px 8px; }
  .t-total .t-value { background: ${GREEN}; color: #ffffff; font-weight: 700; }
  .thanks { text-align: center; color: ${GREEN_DARK}; font-size: 26px; font-weight: 800; margin-top: 48px; }
  .paca { font-size: 9.3px; color: #555; text-align: justify; line-height: 1.45; margin-top: 26px; }
</style></head><body>
<div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">${watermark(ctx.company)}<div class="content">
  ${headTables(ctx, order, '<div class="inv-title">INVOICE</div>', 'INVOICE #')}
  ${soldShipBlock(ctx, order)}
  <table class="bar">
    <tr><th>Reference</th><th>Shipping Terms</th><th>Ship Via</th><th>Payment Terms</th></tr>
    <tr>
      <td><b>${esc(order.REF || '')}</b></td>
      <td class="soft">${esc(ctx.shippingTermsName)}</td>
      <td class="soft">${esc(ctx.shipViaName)}</td>
      <td class="soft"><b>${esc(ctx.paymentTermName) || fmtSlashDate(order.DUE_DATE || '')}</b></td>
    </tr>
  </table>
  <table class="items">
    <tr><th>Item</th><th>Description</th><th>QTY</th><th>Unit price</th><th>Total</th></tr>
    ${rows || '<tr><td class="center" colspan="5" style="color:#777">No line items</td></tr>'}
  </table>
  <div class="totals">
    <div class="t-row"><span class="t-label">Sub-total</span><span class="t-value">$${fmtUsd(subtotal)}</span></div>
    <div class="t-row"><span class="t-label">Tax Rate</span><span class="t-value">0.00%</span></div>
    <div class="t-row"><span class="t-label">Total Tax</span><span class="t-value">$0.00</span></div>
    <div class="t-row t-total"><span class="t-label">Total</span><span class="t-value">$${fmtUsd(subtotal)}</span></div>
  </div>
  <div class="thanks">Thank you..!</div>
  <div class="paca">${PACA_TEXT}</div>
</div></div></body></html>`);
}

/* ---------- 2. PICK TICKET ---------- */

export async function printPickTicket(order: SalesOrder, ctx: SalesDocContext): Promise<void> {
  const lines = await fetchLines(order.id);
  const totalQty = lines.reduce((acc, l) => acc + (l.QUANTITY ?? 0), 0);
  const temp = order.TEMP_LOG || '';
  const rows = lines
    .map(
      (l) => `
      <tr>
        <td class="center">${esc(ctx.commodityName(l.ID_COMMODITIES))}</td>
        <td class="left">${esc(l.DESCRIPTION || '')}</td>
        <td class="center">${fmtQty(l.QUANTITY ?? 0)}</td>
        <td class="center">${TEMP_RANGE}</td>
        <td class="center">${esc(ctx.lotOf(l.ID_PURCHASEORDER))}</td>
      </tr>`,
    )
    .join('');

  openWindow(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<title>Pick Ticket ${esc(order.SALES_ORDER_NUMBER || '')}</title>
<style>${baseStyles}
  .pt-title { color: ${GREEN}; font-size: 22px; font-weight: 700; margin-bottom: 8px; }
  .no-recorder { background: #ffff00; font-weight: 700; text-align: center; padding: 9px 18px; width: 340px; margin-top: 60px; font-size: 12.5px; }
  .pt-total { display: flex; justify-content: flex-end; align-items: center; gap: 22px; margin-top: 26px; }
  .pt-total .lbl { background: ${GREEN_SOFT}; border: 1px solid ${GREEN}; font-weight: 700; padding: 8px 26px; }
  .pt-total b { font-size: 13px; }
</style></head><body>
<div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">${watermark(ctx.company)}<div class="content">
  ${headTables(ctx, order, '<div class="pt-title">Pick Ticket</div>', 'SALES ORDER #')}
  ${soldShipBlock(ctx, order)}
  <table class="bar">
    <tr><th>Reference</th><th>Shipping Terms</th><th>Ship Via</th><th>Temp Recorder</th></tr>
    <tr>
      <td>${esc(order.REF || '')}</td>
      <td class="soft">${esc(ctx.shippingTermsName)}</td>
      <td class="soft">${esc(ctx.shipViaName)}</td>
      <td class="soft">${esc(temp || 'No')}</td>
    </tr>
  </table>
  <table class="items">
    <tr><th>Item</th><th>Description</th><th>QTY</th><th>Temp</th><th>Lot Number</th></tr>
    ${rows || '<tr><td class="center" colspan="5" style="color:#777">No line items</td></tr>'}
  </table>
  ${order.DESCRIPTION ? `<div class="no-recorder">${esc(order.DESCRIPTION)}</div>` : ''}
  <div class="pt-total"><span class="lbl">TOTAL</span><b>${fmtQty(totalQty)}</b><b>Items</b></div>
</div></div></body></html>`);
}

/* ---------- 3. SALES ORDER ---------- */

export async function printSalesOrderDoc(order: SalesOrder, ctx: SalesDocContext): Promise<void> {
  const lines = await fetchLines(order.id);
  const rows = lines
    .map(
      (l) => `
      <tr>
        <td class="center">${esc(ctx.commodityName(l.ID_COMMODITIES))}</td>
        <td class="center">${esc(l.DESCRIPTION || '')}</td>
        <td class="center">${fmtQty(l.QUANTITY ?? 0)}</td>
        <td class="num">$${fmtUsd(l.PRICE ?? 0)}</td>
        <td class="num">$${fmtUsd(l.TOTAL ?? 0)}</td>
      </tr>`,
    )
    .join('');

  openWindow(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<title>Sales Order ${esc(order.SALES_ORDER_NUMBER || '')}</title>
<style>${baseStyles}
  .so-title { color: ${GREEN}; font-size: 23px; font-weight: 800; margin-bottom: 8px; text-align: right; }
  .pickup-band { display: flex; justify-content: flex-end; margin-top: 26px; }
  .pickup-band .inner { display: flex; background: ${GREEN_SOFT}; min-width: 300px; }
  .pickup-band .lbl { font-weight: 700; padding: 8px 16px; }
  .pickup-band .val { padding: 8px 16px; }
  .bottom-band { width: 100%; border-collapse: collapse; margin-top: 60px; }
  .bottom-band td { border: 1px solid ${GREEN_DARK}; padding: 8px 12px; font-size: 11.8px; }
  .bottom-band .k { background: ${GREEN_SOFT}; font-weight: 700; text-align: center; }
  .wh { width: 100%; border-collapse: collapse; margin-top: 14px; }
  .wh td { padding: 8px 12px; font-size: 11.5px; vertical-align: middle; text-align: center; }
  .wh .k { background: ${GREEN_SOFT}; font-weight: 700; }
</style></head><body>
<div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">${watermark(ctx.company)}<div class="content">
  <div style="display:flex; justify-content:space-between; align-items:flex-start;">
    ${logoBlock(ctx.company)}
    <div>
      <div class="so-title">SALES ORDER</div>
      <table class="kv">
        <tr><td class="k" style="text-align:right">DATE</td><td class="v">${fmtSlashDate(order.DATE || '')}</td></tr>
        <tr><td class="k" style="text-align:right">SALES ORDER #</td><td class="v">${esc(order.SALES_ORDER_NUMBER || '')}</td></tr>
        <tr><td class="k" style="text-align:right">CUSTOMER</td><td class="v">${esc(ctx.customerName)}</td></tr>
        <tr><td class="k" style="text-align:right">BUYER</td><td class="v">${esc(order.BUYER || '')}</td></tr>
      </table>
    </div>
  </div>
  <div class="pickup-band"><div class="inner"><span class="lbl">Pick Up Date</span><span class="val">${fmtSlashDate(order.DATE || '')}</span></div></div>
  ${soldShipBlock(ctx, order)}
  <table class="bar">
    <tr><th>Reference</th><th>Shipping Terms</th><th>Sales Person</th><th>Ship Via</th><th>Carrier</th><th>Payment Terms</th></tr>
    <tr>
      <td>${esc(order.REF || '')}</td>
      <td class="soft">${esc(ctx.shippingTermsName)}</td>
      <td>${esc(ctx.salesPerson)}</td>
      <td class="soft">${esc(ctx.shipViaName)}</td>
      <td>${esc(ctx.carrierName)}</td>
      <td class="soft"><b>${esc(ctx.paymentTermName) || paymentTermDays(order) || fmtSlashDate(order.DUE_DATE || '')}</b></td>
    </tr>
  </table>
  <table class="items">
    <tr><th>Item</th><th>Description</th><th>QTY</th><th>Unit Price</th><th>Total</th></tr>
    ${rows || '<tr><td class="center" colspan="5" style="color:#777">No line items</td></tr>'}
  </table>
  <table class="bottom-band">
    <tr>
      <td class="k" style="width:22%">Pick Up Date</td><td style="width:28%">${fmtSlashDate(order.DATE || '')}</td>
      <td class="k" style="width:22%">Pick Up #</td><td style="width:28%">${esc(order.REF_PICKUP || '')}</td>
    </tr>
  </table>
  <table class="wh">
    <tr>
      <td class="k" style="width:18%">WAREHOUSE</td><td style="width:16%">${esc(ctx.warehouseName)}</td>
      <td class="k" style="width:12%">ADDRESS</td><td style="width:26%">${esc(ctx.warehouseAddress)}</td>
      <td class="k" style="width:10%">PHONE</td><td style="width:18%"><a href="tel:${esc(ctx.warehousePhone)}">${esc(ctx.warehousePhone)}</a></td>
    </tr>
  </table>
</div></div></body></html>`);
}

/* ---------- 4. STRAIGHT BILL OF LADING ---------- */

const BOL_TERMS: Array<[string, string]> = [
  ['Who the Carrier Is', "The term Carrier means the company or person driving and handling the shipment. The Carrier is fully responsible for the shipment while it's in their possession\u2014unless the damage or delay is caused by natural disasters, enemies, or by the shipper or receiver."],
  ['Transport and Delivery Responsibility', 'The Carrier agrees to transport the goods at the right temperature from the starting point to the destination and deliver them in good condition on time. If they fail to do this, they must pay for any loss or damage.'],
  ['Delivery Timing', 'If no delivery time is listed, the Carrier must still deliver the goods within their usual schedule for perishable items. The Carrier confirms they can complete the delivery legally and safely, following all relevant laws and regulations.'],
  ['Claim Time Limit', "Any claims for loss or damage must be made within nine months of delivery. If the shipment wasn\u2019t delivered, the claim must be made within nine months of when delivery should have reasonably occurred. Claims can be filed with either the Carrier or the Truck Broker."],
  ['Insurance Coverage', 'The Carrier confirms that their vehicle has valid insurance as required by law. They also confirm that cargo insurance of at least $25,000 is in place. If the shipper states a higher value, the Carrier will get extra insurance to match that amount.'],
  ['Truck Broker Role', "The Truck Broker (who helps arrange the shipment and is paid by the Carrier) acts as the Carrier\u2019s agent. The shipper or receiver trusted the Broker to arrange good transport. If the Carrier causes a loss through negligence or fails to meet the agreement, the Broker agrees to cover those losses."],
];

/** Rango de temperatura estandar impreso en Pick Ticket y BOL. */
const TEMP_RANGE = '32 - 34 F';

const BOL_FOOTER =
  'The Carrier has received the listed perishable goods in good condition (unless noted otherwise) and agrees to transport them to the destination named, as arranged by the Truck Broker (if involved). In return for payment, the Carrier agrees to deliver the goods to the consignee, following the terms of this contract, which are accepted by the Carrier, Shipper, and Broker';

export async function printBillOfLading(order: SalesOrder, ctx: SalesDocContext): Promise<void> {
  const lines = await fetchLines(order.id);
  const rows = lines
    .map(
      (l) => `
      <tr>
        <td class="center b1">${esc(ctx.commodityName(l.ID_COMMODITIES))}</td>
        <td class="center b1">${esc(l.DESCRIPTION || '')}</td>
        <td class="center b1">${fmtQty(l.QUANTITY ?? 0)}</td>
        <td class="center b1">${TEMP_RANGE}</td>
        <td class="center b1"></td>
      </tr>`,
    )
    .join('');

  openWindow(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<title>BOL ${esc(order.SALES_ORDER_NUMBER || '')}</title>
<style>${baseStyles}
  .bol-title { text-align: center; font-weight: 800; font-size: 14.5px; margin-bottom: 22px; }
  .bol-co { font-weight: 700; font-size: 11.5px; line-height: 1.5; margin-top: 3px; }
  .bol-meta { font-size: 12px; line-height: 2; }
  .bol-num { font-weight: 800; font-size: 15px; text-align: right; }
  .carrier-line { display: flex; gap: 26px; margin-top: 26px; font-size: 12px; flex-wrap: wrap; }
  .items-bol { width: 100%; border-collapse: collapse; margin-top: 26px; }
  .items-bol th { background: #93c47d; border: 1.4px solid #1c1c1c; font-weight: 700; padding: 7px 8px; font-size: 11.8px; }
  .items-bol td.b1 { border: 1.4px solid #1c1c1c; padding: 9px 8px; font-size: 12px; }
  .terms-title { text-align: center; font-weight: 700; margin-top: 40px; font-size: 12px; }
  .term h5 { font-size: 11.8px; margin-top: 14px; }
  .term p { font-size: 11.3px; line-height: 1.5; margin-top: 4px; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 30px; font-size: 12px; font-weight: 700; }
  .bol-footer { font-size: 8.8px; color: #444; line-height: 1.45; margin-top: 34px; }
</style></head><body>
<div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page"><div class="content">
  <div class="bol-title">STRAIGHT BILL OF LADING FOR EXEMPT COMMODITIES - ORIGINAL NON-NEGOTIABLE</div>
  <div style="display:flex; justify-content:space-between; align-items:flex-start;">
    <div>
      ${ctx.company.logo ? `<div class="logo"><img src="${ctx.company.logo}" alt="logo" /></div>` : ''}
      <div class="bol-co">${esc(ctx.company.address)}<br />${esc(ctx.company.cityStateZip)}<br />${ctx.company.phone ? `${esc(ctx.company.phone)} Main` : ''}</div>
    </div>
    <div class="bol-meta"><b>Ship:</b> &nbsp;${fmtSlashDate(order.DATE || '')}<br /><b>Terms:</b> &nbsp;${esc(ctx.shippingTermsName)}</div>
    <div class="bol-num"># ${esc(order.SALES_ORDER_NUMBER || '')}</div>
  </div>
  ${soldShipBlock(ctx, order)}
  <div class="carrier-line">
    <span><b>Carrier:</b> &nbsp;${esc(ctx.carrierName)}</span>
    <span><b>Loaded At:</b> &nbsp;${esc(ctx.warehouseName)}</span>
    <span><b>Maintain Temp at:</b> &nbsp;<b>${TEMP_RANGE}</b></span>
  </div>
  <table class="items-bol">
    <tr><th style="width:16%">Item</th><th style="width:38%">Description</th><th style="width:14%">QTY</th><th style="width:16%">Temp</th><th style="width:16%">COO</th></tr>
    ${rows || '<tr><td class="center b1" colspan="5" style="color:#777">No line items</td></tr>'}
  </table>
  <div class="terms-title">Contract Terms and Conditions</div>
  ${BOL_TERMS.map(([t, p]) => `<div class="term"><h5>${t}</h5><p>${p}</p></div>`).join('')}
  <div class="sig-row"><span>Drive\u2019s name:</span><span style="margin-right:28%">Phone</span></div>
  <div class="sig-row" style="margin-top:44px"><span>Driver\u2019s signature:</span><span style="margin-right:28%">Date</span></div>
  <div class="bol-footer">${BOL_FOOTER}</div>
</div></div></body></html>`);
}

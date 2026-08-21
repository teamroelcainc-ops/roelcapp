import type { Check, CheckSettings, CompanyBank, CompanyInfo } from '../types/models';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALE = ['', ' Thousand', ' Million', ' Billion'];

const belowThousand = (n: number): string => {
  let out = '';
  if (n >= 100) {
    out += `${ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n) out += ' ';
  }
  if (n >= 20) {
    out += TENS[Math.floor(n / 10)];
    if (n % 10) out += `-${ONES[n % 10]}`;
  } else if (n > 0) {
    out += ONES[n];
  }
  return out;
};

/** Convierte un monto USD a letras: 1250.5 -> "One Thousand Two Hundred Fifty and 50/100 Dollars" */
export function amountInWords(amount: number): string {
  const dollars = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - dollars) * 100);
  if (dollars === 0) return `Zero and ${String(cents).padStart(2, '0')}/100 Dollars`;
  const parts: string[] = [];
  let rest = dollars;
  let scale = 0;
  while (rest > 0) {
    const chunk = rest % 1000;
    if (chunk > 0) parts.unshift(belowThousand(chunk) + SCALE[scale]);
    rest = Math.floor(rest / 1000);
    scale += 1;
  }
  return `${parts.join(' ')} and ${String(cents).padStart(2, '0')}/100 Dollars`;
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtUsd = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


const fmtMonthYear = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
};

const fmtSlash = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}` : iso;
};

/**
 * Abre el cheque listo para imprimir en formato voucher (carta):
 * cheque arriba (3.5in, banda MICR al pie) + dos talones, siguiendo el
 * layout del cheque de referencia del cliente y el estandar bancario de EE.UU.
 * Nota: para deposito bancario real, imprimir con toner magnetico (MICR) o
 * sobre papel de cheques preimpreso, como exigen los bancos en Texas.
 */
export function printCheck(
  check: Check,
  payeeName: string,
  company: CompanyInfo,
  bank: CompanyBank | null,
  settings: CheckSettings,
  payeeAddress = '',
): void {
  const showLogo = settings.showLogo !== false && !!company.logo;
  const showAddress = settings.showAddress !== false;
  const showBank = settings.showBankInfo !== false && !!bank;
  const signature = settings.signatureText?.trim() || '';
  const fractional = settings.fractional?.trim() || '';
  const words = amountInWords(check.AMOUNT).replace(/ and (\d{2})\/100 Dollars$/, (_m, c) => (c === '00' ? '***' : ` and ${c}/100***`));

  const stub = `
    <div class="stub">
      <div class="stub-row">
        <b>${check.CHECK_NUMBER}</b>
        <span><b>Amount:</b> $${fmtUsd(check.AMOUNT)}</span>
        <span><b>Date:</b> ${fmtSlash(check.DATE)}</span>
      </div>
      <div class="stub-line"><b>Pay to:</b> ${esc(payeeName)}</div>
      <div class="stub-line stub-month">${fmtMonthYear(check.DATE)}</div>
      <div class="stub-ref"><b>Ref #</b> ${esc(check.REF || '')}</div>
      <div class="stub-line stub-co">${esc(company.name || '')}</div>
      <div class="stub-line"><b>Memo:</b> ${esc(check.MEMO || '')}</div>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Check #${check.CHECK_NUMBER}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  @page { size: letter; margin: 0.25in; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #f1f3f2; }
  .sheet { width: 8in; margin: 0 auto; background: #ffffff; }
  /* ---- Cheque (3.5in, estandar personal/business EE.UU.) ---- */
  .check { height: 3.5in; padding: 0.18in 0.22in 0; position: relative; display: flex; flex-direction: column; }
  .row-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .co { display: flex; gap: 10px; }
  .co img { max-height: 44px; max-width: 110px; object-fit: contain; }
  .co-name { font-size: 12.5px; font-weight: 700; }
  .co-sub { font-size: 9.5px; color: #333; line-height: 1.45; }
  .bank { font-size: 9.5px; color: #333; line-height: 1.45; text-align: left; }
  .num { text-align: right; }
  .num-value { font-size: 13.5px; font-weight: 700; }
  .num-frac { font-size: 8.5px; color: #333; margin-top: 2px; }
  .date-line { text-align: right; margin-top: 10px; font-size: 10.5px; }
  .date-line b { display: inline-block; min-width: 110px; border-bottom: 1px solid #111; text-align: center; padding-bottom: 1px; font-weight: 400; }
  .date-line .lbl { font-weight: 700; margin-right: 6px; }
  .pay-row { display: flex; align-items: flex-end; gap: 10px; margin-top: 10px; }
  .pay-label { font-size: 8.5px; font-weight: 700; width: 60px; line-height: 1.35; }
  .payee { flex: 1; border-bottom: 1px solid #111; font-size: 12px; padding: 0 4px 2px; }
  .amount-num { border-bottom: 1px solid #111; font-size: 12px; font-weight: 700; padding: 0 8px 2px; white-space: nowrap; }
  .amount-num .cur { margin-right: 6px; font-weight: 400; }
  .words-row { display: flex; align-items: flex-end; gap: 8px; margin-top: 12px; }
  .words { flex: 1; border-bottom: 1px solid #111; font-size: 11px; padding: 0 4px 2px; }
  .words-dollars { font-size: 10.5px; font-weight: 700; }
  .payee-address { margin: 14px 0 0 0.9in; font-size: 10.5px; line-height: 1.5; }
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto; gap: 20px; padding-bottom: 0.08in; }
  .memo { flex: 1; font-size: 10px; display: flex; align-items: flex-end; gap: 6px; }
  .memo .lbl { font-weight: 700; }
  .memo .val { flex: 0 1 260px; border-bottom: 1px solid #111; padding: 0 4px 1px; min-height: 12px; }
  .sig { width: 240px; border-top: 1px solid #111; text-align: center; font-size: 8.5px; font-weight: 700; padding-top: 3px; }
  /* Banda MICR: 5/8in libre al pie del cheque (estandar bancario). */
  .micr { height: 0.42in; display: flex; align-items: center; padding-left: 0.45in; font-family: 'Courier New', monospace; font-size: 14px; letter-spacing: 0.22em; }
  .cut { border: 0; border-top: 1px dashed #9aa8a0; margin: 0.08in 0; }
  /* ---- Talones ---- */
  .stub { height: 3.1in; padding: 0.24in 0.5in 0; font-size: 11px; }
  .stub-row { display: flex; justify-content: space-between; margin-bottom: 22px; }
  .stub-line { margin-top: 10px; }
  .stub-month { font-weight: 700; }
  .stub-ref { margin-top: 26px; text-align: center; }
  .stub-co { font-weight: 700; margin-top: 30px; }
  .print-bar { text-align: center; padding: 14px 0; }
  .print-bar button { background: #1f7a4d; color: #ffffff; border: none; padding: 10px 26px; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit; }
  @media print { body { background: #ffffff; } .sheet { width: auto; } .print-bar { display: none; } .cut { visibility: hidden; } }
</style>
</head>
<body>
<div class="print-bar"><button onclick="window.print()">Print check</button></div>
<div class="sheet">
  <div class="check">
    <div class="row-top">
      <div class="co">
        ${showLogo ? `<img src="${company.logo}" alt="logo" />` : ''}
        <div>
          <div class="co-name">${esc(company.name || 'Company name')}</div>
          ${showAddress ? `<div class="co-sub">${esc(company.address)}<br />${esc(company.cityStateZip)}</div>` : ''}
        </div>
      </div>
      ${showBank ? `<div class="bank">${esc(bank?.bankName ?? '')}<br />${esc(bank?.address ?? '')}</div>` : '<div></div>'}
      <div class="num">
        <div class="num-value">No. ${check.CHECK_NUMBER}</div>
        ${fractional ? `<div class="num-frac">${esc(fractional)}</div>` : ''}
        <div class="date-line"><span class="lbl">Date</span><b>${fmtSlash(check.DATE)}</b></div>
      </div>
    </div>

    <div class="pay-row">
      <div class="pay-label">Pay To The<br />Order Of</div>
      <div class="payee">${esc(payeeName)}</div>
      <div class="amount-num"><span class="cur">$</span>**$${fmtUsd(check.AMOUNT)}</div>
    </div>

    <div class="words-row">
      <div class="words">${esc(words)}</div>
      <div class="words-dollars">Dollars</div>
    </div>

    <div class="payee-address">
      ${esc(payeeName)}<br />
      ${payeeAddress ? esc(payeeAddress).replace(/\n/g, '<br />') : ''}
    </div>

    <div class="bottom">
      <div class="memo"><span class="lbl">Memo:</span><span class="val">${esc(check.MEMO || '')}</span></div>
      <div class="sig">${signature ? esc(signature) : 'Signature'}</div>
    </div>

    ${showBank && bank?.routing ? `<div class="micr">\u2448${check.CHECK_NUMBER}\u2448&nbsp;&nbsp;\u2446${esc(bank.routing)}\u2446&nbsp;&nbsp;${esc(bank.account)}\u2448</div>` : '<div class="micr"></div>'}
  </div>

  <hr class="cut" />
  ${stub}
  <hr class="cut" />
  ${stub}
</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the print window. Allow pop-ups for this site.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

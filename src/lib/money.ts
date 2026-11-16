// Money as integer minor units (cents). Never parsed through floating point.

/**
 * Accepts what people type: "1700", "1 700", "R1 700,50", "1,700.50", "1700.5".
 * Returns cents, or null if the text is not a clear positive amount.
 * A single comma followed by 1–2 digits is a decimal comma (South African style); otherwise commas group thousands.
 */
export function parseMoney(text: string): number | null {
  let s = text.trim().replace(/^[A-Za-z]{1,3}\s*/, '').replace(/[\s ']/g, '');
  if (!s) return null;
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}

const formatters = new Map<string, Intl.NumberFormat>();
export function formatMoney(cents: number, currency = 'ZAR') {
  let f = formatters.get(currency);
  if (!f) formatters.set(currency, (f = new Intl.NumberFormat('en-ZA', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })));
  return f.format(cents / 100); // display only; arithmetic stays in integer cents
}

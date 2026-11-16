// Link helpers. Only http(s) addresses are ever stored or opened (a "javascript:" link could run code).

/** Normalise what someone typed into a safe web address, or null if it is not one. */
export function safeUrl(input: string): string | null {
  const t = input.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    if (/[<>"]/.test(u.href)) return null;
    return u.href;
  } catch {
    return null;
  }
}

export function linkParts(url: string) {
  const u = new URL(url);
  return { host: u.hostname.replace(/^www\./, ''), path: u.pathname === '/' ? '' : u.pathname, origin: u.origin };
}

/** Open in the device browser, never inside the app. Re-checked at click time. */
export function openLink(url: string) {
  const safe = safeUrl(url);
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
}

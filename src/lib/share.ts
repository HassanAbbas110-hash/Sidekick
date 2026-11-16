// "Share to Sidekick": what another app shared, ready to be saved somewhere.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { safeUrl } from './links.ts';

type NativeFile = { name: string; mime: string; size: number; path?: string; tooBig?: boolean };
type NativeShare = { text: string | null; subject: string | null; files: NativeFile[] };
const ShareIn = registerPlugin<{
  take(): Promise<{ share: NativeShare | null }>;
  clear(): Promise<void>;
  addListener(event: 'shared', fn: () => void): Promise<PluginListenerHandle>;
}>('ShareIn');

export type Incoming = { url: string | null; title: string; body: string | null; files: File[]; refused: string[] };

/** Splits shared text into a link (the first web address in it), a title and the rest. */
export function parseShared(text: string | null, subject: string | null): Pick<Incoming, 'url' | 'title' | 'body'> {
  const t = (text ?? '').trim();
  const raw = t.match(/https?:\/\/[^\s<>"]+/i)?.[0] ?? null;
  const url = raw ? safeUrl(raw.replace(/[).,!?]+$/, '')) : null;
  const rest = (url && raw ? t.replace(raw, '') : t).trim().replace(/[\s:,-]+$/, '');
  const firstLine = rest.split('\n')[0].trim();
  const title = (subject?.trim() || firstLine || (url ? new URL(url).hostname.replace(/^www\./, '') : 'Shared item')).slice(0, 200);
  const body = rest && rest !== title ? rest : null;
  return { url, title, body };
}

/** Takes the waiting share from the Android app, once. Null in the browser or when nothing was shared. */
export async function takeShare(): Promise<Incoming | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const { share } = await ShareIn.take().catch(() => ({ share: null }));
  if (!share) return null;
  const files: File[] = [];
  const refused: string[] = [];
  for (const f of share.files ?? []) {
    if (f.tooBig || !f.path) { refused.push(f.tooBig ? `${f.name} is over 50 MB` : `${f.name} could not be read`); continue; }
    const blob = await fetch(Capacitor.convertFileSrc(`file://${f.path}`)).then((r) => r.blob()).catch(() => null);
    if (blob) files.push(new File([blob], f.name, { type: f.mime })); else refused.push(`${f.name} could not be read`);
  }
  return { ...parseShared(share.text, share.subject), files, refused };
}

export const clearShareCache = () => (Capacitor.isNativePlatform() ? ShareIn.clear().catch(() => {}) : Promise.resolve());

/** Calls back whenever something is shared into the running app (and once at start-up). */
export function onShare(fn: () => void) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const h = ShareIn.addListener('shared', fn);
  fn();
  return () => { h.then((x) => x.remove()); };
}

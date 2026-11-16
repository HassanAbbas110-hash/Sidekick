// Drains the push queue: claims pending inbox rows, sends each to the recipient's devices via FCM,
// records the outcome. Called every minute by pg_cron (x-cron-secret) and by signed-in clients after
// they sync (Authorization), so pushes go out quickly without depending on any client staying online.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { accessToken, send, type ServiceAccount } from './fcm.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function allowed(req: Request) {
  const cron = Deno.env.get('CRON_SECRET');
  if (cron && req.headers.get('x-cron-secret') === cron) return true;
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!jwt) return false;
  const { data } = await admin.auth.getUser(jwt);
  return Boolean(data.user);
}

Deno.serve(async (req) => {
  if (!(await allowed(req))) return new Response('forbidden', { status: 403 });

  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return Response.json({ error: 'FCM_SERVICE_ACCOUNT not set; inbox still works, pushes are queued' }, { status: 503 });
  const sa: ServiceAccount = JSON.parse(raw);

  const { data: rows, error } = await admin.rpc('claim_pushes', { p_limit: 50 });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ claimed: 0 });

  const token = await accessToken(sa);
  const summary = { claimed: rows.length, sent: 0, no_device: 0, retry: 0 };

  for (const n of rows as { id: string; user_id: string; title: string; body: string | null; item_id: string | null }[]) {
    const { data: devices } = await admin.from('device_tokens').select('token').eq('user_id', n.user_id);
    if (!devices?.length) {
      await admin.from('notifications').update({ push_state: 'no_device' }).eq('id', n.id);
      summary.no_device++;
      continue;
    }
    let delivered = false;
    let lastError = '';
    for (const d of devices) {
      const r = await send(sa, token, { token: d.token, title: n.title, body: n.body, data: { notification_id: n.id, item_id: n.item_id ?? '' } });
      if (r.outcome === 'sent') delivered = true;
      else if (r.outcome === 'unregistered') await admin.from('device_tokens').delete().eq('token', d.token);
      else lastError = r.detail ?? 'unknown';
    }
    // 'sent' means FCM accepted it, not that the phone displayed it (spec §11). Not 'read'.
    await admin.from('notifications').update(delivered
      ? { push_state: 'sent', push_error: null }
      : { push_state: 'pending', push_error: lastError || 'no device accepted' }).eq('id', n.id);
    if (delivered) summary.sent++; else summary.retry++;
  }
  return Response.json(summary);
});

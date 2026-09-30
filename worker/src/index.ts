import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config, enabled } from './config.js';
import * as kick from './kick.js';
import * as registry from './registry.js';
import * as twitch from './twitch.js';
import { Platform, PLATFORMS } from './types.js';
import * as youtube from './youtube.js';

const api = { twitch, youtube, kick };
const app = new Hono();
app.use('*', cors());

app.get('/health', c => c.json({ ok: true, platforms: { twitch: enabled.twitch, youtube: enabled.youtube, kick: enabled.kick }, push: enabled.supabase }));

const platformOf = (v: string | undefined): Platform | null => (PLATFORMS.includes(v as Platform) ? (v as Platform) : null);

/** Canal exato a partir do nome que veio no link (login, @handle, slug). */
app.get('/resolve', async c => {
  const p = platformOf(c.req.query('platform'));
  const name = (c.req.query('name') ?? '').trim();
  if (!p || !name) return c.json({ error: 'bad_request' }, 400);
  if (!enabled[p]) return c.json({ error: 'platform_not_configured' }, 503);
  const ch = await api[p].resolve(name);
  return ch ? c.json(ch) : c.json({ error: 'not_found' }, 404);
});

app.get('/search', async c => {
  const p = platformOf(c.req.query('platform'));
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  if (!p || q.length < 2) return c.json({ error: 'bad_request' }, 400);
  if (!enabled[p]) return c.json({ error: 'platform_not_configured' }, 503);
  return c.json(await api[p].search(q));
});

app.post('/status', async c => {
  const body = await c.req.json().catch(() => null);
  const keys: unknown = body?.keys;
  if (!Array.isArray(keys) || keys.some(k => typeof k !== 'string')) return c.json({ error: 'bad_request' }, 400);
  const channels = await registry.statusFor([...new Set(keys as string[])].slice(0, 500));
  return c.json({ at: new Date().toISOString(), channels });
});

app.post('/webhooks/twitch', async c => {
  if (!enabled.eventsub) return c.text('eventsub off', 404);
  const raw = await c.req.text();
  if (!twitch.verifyEventSub(c.req.raw.headers, raw)) return c.text('bad signature', 403);
  const msg = JSON.parse(raw);
  const type = c.req.header('twitch-eventsub-message-type');
  if (type === 'webhook_callback_verification') return c.text(msg.challenge);
  if (type === 'notification') {
    const id = msg.event?.broadcaster_user_id;
    // a Helix pode demorar alguns segundos para refletir o stream.online
    if (id) setTimeout(() => void registry.poll('twitch', [`twitch:${id}`]).catch(() => {}), 5000);
  }
  return c.body(null, 204);
});

app.onError((e, c) => {
  console.error('[http]', c.req.path, e.message);
  return c.json({ error: 'upstream_error' }, 502);
});

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Multistreams worker em :${config.port}`);
  for (const p of PLATFORMS) console.log(`  ${p}: ${enabled[p] ? 'ligado' : 'SEM CREDENCIAIS'}`);
  console.log(`  supabase/push: ${enabled.supabase ? 'ligado' : 'desligado'} · eventsub: ${enabled.eventsub ? 'ligado' : 'desligado'}`);
  void registry.start();
});

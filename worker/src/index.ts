import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { browse, categories } from './browse.js';
import { config, enabled } from './config.js';
import * as kick from './kick.js';
import * as registry from './registry.js';
import * as twitch from './twitch.js';
import { Channel, LANG_CODES, Platform, PLATFORMS } from './types.js';
import * as youtube from './youtube.js';

const api = { twitch, youtube, kick };
export const app = new Hono();
app.use('*', cors());

app.get('/health', c => c.json({ ok: true, platforms: { twitch: enabled.twitch, youtube: enabled.youtube, kick: enabled.kick }, push: enabled.supabase }));

const platformOf = (v: string | undefined): Platform | null => (PLATFORMS.includes(v as Platform) ? (v as Platform) : null);

/**
 * IP de quem pediu, para os limites. No Render tudo passa pela Cloudflare: ela grava o CF-Connecting-IP
 * (recusa um forjado) e sobrescreve o True-Client-IP. O X-Forwarded-For só ganha itens no fim, então o
 * primeiro pode ser forjado: fica de reserva para quem roda o worker fora do Render.
 */
function clientIp(c: Context): string {
  const h = c.req.header('cf-connecting-ip') ?? c.req.header('true-client-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0];
  if (h?.trim()) return registry.ipKey(h);
  try {
    return registry.ipKey(getConnInfo(c).remote.address ?? '');
  } catch {
    return '';
  }
}

/**
 * /search e /resolve gastam cota e limite das plataformas. Tetos por IP a cada 10 min (folgado, por causa do
 * CGNAT) e por minuto; no IPv6, também a rede /48 inteira, com 5 vezes os do IP (além dos do /64); e por
 * plataforma por minuto, somando todos os IPs, para um flood numa plataforma não fechar as outras.
 */
const NET = 5;
const lookups = {
  ip: new registry.Budget(config.limits.lookupsPerIp, 10 * 60e3),
  ipMinute: new registry.Budget(config.limits.lookupsPerIpMinute, 60e3),
  net: new registry.Budget(NET * config.limits.lookupsPerIp, 10 * 60e3),
  netMinute: new registry.Budget(NET * config.limits.lookupsPerIpMinute, 60e3),
  platform: new registry.Budget(config.limits.lookupsPerMinute, 60e3),
};
/** 429 quando algum teto acabou. Só gasta se todos deixarem: o pedido recusado não gasta nenhum. */
function limited(c: Context, p: Platform): Response | null {
  const ip = clientIp(c);
  const net = registry.ip48(ip);
  const now = Date.now();
  const use: [registry.Budget, string][] = [[lookups.ip, ip], [lookups.ipMinute, ip], [lookups.platform, p]];
  if (net) use.push([lookups.net, net], [lookups.netMinute, net]);
  if (use.every(([b, k]) => b.left(k, now) > 0)) {
    for (const [b, k] of use) b.take(k, 1, now);
    return null;
  }
  c.header('Retry-After', '60');
  return c.json({ error: 'rate_limited' }, 429);
}

// o id do YouTube (UC…) diferencia maiúsculas; logins, @handles, slugs e termos de busca, não
const cacheKey = (p: Platform, s: string) => `${p}|${p === 'youtube' && /^UC[\w-]{22}$/.test(s) ? s : s.toLowerCase()}`;

/** Respostas do /resolve (achado e não achado): o mesmo link colado por várias pessoas consulta a plataforma uma vez. */
const resolved = new Map<string, { at: number; ch: Channel | null }>();
const RESOLVE_TTL = { found: 6 * 3600e3, missing: 30 * 60e3 };

/** Canal exato a partir do nome que veio no link (login, @handle, slug). */
app.get('/resolve', async c => {
  const p = platformOf(c.req.query('platform'));
  const name = (c.req.query('name') ?? '').trim().slice(0, 100);
  if (!p || !name) return c.json({ error: 'bad_request' }, 400);
  if (!enabled[p]) return c.json({ error: 'platform_not_configured' }, 503);
  const k = cacheKey(p, name);
  const hit = resolved.get(k);
  let ch: Channel | null;
  if (hit && Date.now() - hit.at < (hit.ch ? RESOLVE_TTL.found : RESOLVE_TTL.missing)) ch = hit.ch;
  else {
    const stop = limited(c, p);
    if (stop) return stop;
    ch = await api[p].resolve(name);
    resolved.delete(k);
    if (resolved.size >= 5000) resolved.delete(resolved.keys().next().value!);
    resolved.set(k, { at: Date.now(), ch });
  }
  return ch ? c.json(ch) : c.json({ error: 'not_found' }, 404);
});

/** Respostas do /search por plataforma e termo: o mesmo nome digitado de novo (ou por outra pessoa) não consulta a plataforma. */
const searched = new Map<string, { at: number; res: Channel[] }>();
const SEARCH_TTL = 10 * 60e3;

app.get('/search', async c => {
  const p = platformOf(c.req.query('platform'));
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  if (!p || q.length < 2) return c.json({ error: 'bad_request' }, 400);
  if (!enabled[p]) return c.json({ error: 'platform_not_configured' }, 503);
  const k = cacheKey(p, q);
  const hit = searched.get(k);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return c.json(hit.res);
  const stop = limited(c, p);
  if (stop) return stop;
  const res = await api[p].search(q);
  searched.delete(k);
  if (searched.size >= 2000) searched.delete(searched.keys().next().value!);
  searched.set(k, { at: Date.now(), res });
  return c.json(res);
});

/** Plataformas e línguas da query (?platforms=twitch,kick&langs=pt,en). Língua que o app não oferece é ignorada. */
const filters = (c: { req: { query: (k: string) => string | undefined } }) => ({
  platforms: [...new Set((c.req.query('platforms') ?? '').split(',').map(platformOf).filter((p): p is Platform => !!p))],
  langs: [...new Set((c.req.query('langs') ?? '').split(','))].filter(l => LANG_CODES.has(l)),
});

/** Tudo que está ao vivo nas plataformas, línguas e categorias (?cat=…, repetido, até 20) pedidas, por viewers. */
app.get('/browse', async c => {
  const { platforms, langs } = filters(c);
  if (!platforms.length || !langs.length) return c.json({ error: 'bad_request' }, 400);
  const cats = [...new Set((c.req.queries('cat') ?? []).map(x => x.slice(0, 100)).filter(Boolean))].slice(0, 20);
  const sort = c.req.query('sort') === 'asc' ? 'asc' : 'desc';
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
  return c.json({ at: new Date().toISOString(), ...(await browse(platforms, langs, cats, sort, offset, limit)) });
});

/** Categorias de quem está ao vivo, para o filtro (jogos, IRL, Just Chatting…). */
app.get('/categories', async c => {
  const { platforms, langs } = filters(c);
  if (!platforms.length || !langs.length) return c.json({ error: 'bad_request' }, 400);
  return c.json(await categories(platforms, langs));
});

// o app manda até ~2.000 chaves (uns 80 KB); o onError próprio evita o 502 do app.onError
const tooLarge = (c: Context) => c.json({ error: 'too_large' }, 413);
app.use('/status', bodyLimit({ maxSize: 256 * 1024, onError: tooLarge }));

/** Chave inválida é ignorada e o excedente de MAX_KEYS é cortado (truncated: true): nunca recusa o pedido inteiro. */
app.post('/status', async c => {
  const body = await c.req.json().catch(() => null);
  const raw: unknown = body?.keys;
  if (!Array.isArray(raw)) return c.json({ error: 'bad_request' }, 400);
  const { keys, truncated } = registry.pickKeys(raw);
  const channels = await registry.statusFor(keys, clientIp(c));
  return c.json({ at: new Date().toISOString(), channels, ...(truncated ? { truncated: true } : {}) });
});

app.use('/webhooks/twitch', bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge }));
app.post('/webhooks/twitch', async c => {
  if (!enabled.eventsub) return c.text('eventsub off', 404);
  const raw = await c.req.text();
  if (!twitch.verifyEventSub(c.req.raw.headers, raw)) return c.text('bad signature', 403);
  const msg = JSON.parse(raw);
  const type = c.req.header('twitch-eventsub-message-type');
  if (type === 'webhook_callback_verification') return c.text(msg.challenge);
  if (type === 'notification') {
    const key = `twitch:${msg.event?.broadcaster_user_id ?? ''}`;
    // só anota o canal: a consulta sai em lote, sem atropelar a rodada periódica
    if (registry.parseKey(key)) registry.enqueue(key);
  }
  return c.body(null, 204);
});

app.onError((e, c) => {
  if (e instanceof HTTPException) return c.json({ error: e.status === 413 ? 'too_large' : 'bad_request' }, e.status);
  // cota do YouTube esgotada no /search ou no /resolve: com bucket 'searches', o app sugere colar o link ou o
  // @handle (campo novo e opcional: os APKs até a 1.0.4 leem só o error)
  if (e instanceof youtube.QuotaError) return c.json({ error: 'quota', bucket: e.bucket }, 503);
  console.error('[http]', c.req.path, e.message);
  return c.json({ error: 'upstream_error' }, 502);
});

// os testes (MULTISTREAMS_NO_SERVER=1) importam só o app: sem servidor nem polling
if (process.env.MULTISTREAMS_NO_SERVER !== '1') {
  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    console.log(`Multistreams worker em :${config.port}`);
    for (const p of PLATFORMS) console.log(`  ${p}: ${enabled[p] ? 'ligado' : 'SEM CREDENCIAIS'}`);
    console.log(`  supabase/push: ${enabled.supabase ? 'ligado' : 'desligado'} · eventsub: ${enabled.eventsub ? 'ligado' : 'desligado'}`);
    void registry.start();
  });

  // deploy no Render: SIGTERM e até 30 s para sair. Para os timers, grava o pendente e sai.
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[worker] ${signal}: gravando o que falta e saindo`);
    server.close();
    void Promise.race([registry.stop(), new Promise(r => setTimeout(r, 10e3))]).finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

// só as rotas, sem servidor, sem plataformas, sem Supabase e com os limites no padrão, mesmo com um .env
// (o loadEnvFile não sobrescreve o que já existe)
for (const k of ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'YOUTUBE_API_KEY', 'KICK_CLIENT_ID', 'KICK_CLIENT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PUBLIC_URL', 'TWITCH_EVENTSUB_SECRET', 'LOOKUPS_PER_IP', 'LOOKUPS_PER_IP_MINUTE', 'LOOKUPS_PER_MINUTE']) process.env[k] = '';
process.env.MULTISTREAMS_NO_SERVER = '1';

// Twitch e Kick falsas, contando as consultas: os testes de /search e /resolve ligam as duas
const upstream = { twitch: 0, kick: 0 };
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.host === 'id.twitch.tv' || url.host === 'id.kick.com') return Response.json({ access_token: 't', expires_in: 3600 });
  if (url.host === 'api.twitch.tv') {
    upstream.twitch++;
    const q = url.searchParams.get('query');
    if (url.pathname === '/helix/search/channels') return Response.json({ data: [{ id: '1', broadcaster_login: q, display_name: q, broadcaster_language: 'pt' }] });
    if (url.pathname === '/helix/channels/followers') return Response.json({ total: 7, data: [] });
    return Response.json({ data: [] });
  }
  if (url.host === 'api.kick.com') {
    upstream.kick++;
    return Response.json({ data: [] });
  }
  return new Response('sem rota', { status: 599 });
}) as typeof fetch;

const { app } = await import('./index.js');
const { enabled } = await import('./config.js');

const status = (body: string) => app.request('/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
const get = (path: string, ip: string) => app.request(path, { headers: { 'cf-connecting-ip': ip } });

/** Liga a Twitch e a Kick só no teste (o enabled é lido a cada pedido), com o relógio numa hora só dele. */
let hours = 0;
function lookups(t: TestContext) {
  enabled.twitch = enabled.kick = true;
  t.after(() => void (enabled.twitch = enabled.kick = false));
  let now = Date.now() + ++hours * 3600e3;
  t.mock.method(Date, 'now', () => now);
  return (ms: number) => void (now += ms);
}

test('/status com corpo grande demais responde 413 too_large', async () => {
  const res = await status(JSON.stringify({ keys: ['x'.repeat(300 * 1024)] }));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'too_large' });
});

test('/status ignora chave inválida e nunca recusa a lista que os apps mandam', async () => {
  const res = await status(JSON.stringify({ keys: ['twitch:123', 'kickx', 42, 'youtube:UCruim', null, 'kick:gaules'] }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.channels, {});
  assert.equal(typeof body.at, 'string');
  assert.equal('truncated' in body, false);
});

test('/status com mais de 2000 chaves corta e responde truncated', async () => {
  const keys = Array.from({ length: 2500 }, (_, i) => `twitch:${i + 1}`);
  const res = await status(JSON.stringify({ keys }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).truncated, true);
});

test('/status sem lista de chaves continua 400', async () => {
  assert.equal((await status('{"keys":"twitch:1"}')).status, 400);
  assert.equal((await status('nada')).status, 400);
});

test('/browse e /categories ignoram línguas que o app não oferece', async () => {
  assert.equal((await app.request('/browse?platforms=twitch&langs=xx,zz')).status, 400);
  const res = await app.request('/browse?platforms=twitch,kick&langs=pt,xx&cat=a&cat=a');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).total, 0);
  assert.equal((await app.request('/categories?platforms=kick&langs=en,zz')).status, 200);
  assert.equal((await app.request('/categories?platforms=kick&langs=zz')).status, 400);
});

test('/search e /resolve sem a plataforma configurada respondem como antes', async () => {
  assert.equal((await app.request('/search?platform=twitch&q=gaules')).status, 503);
  assert.equal((await app.request('/resolve?platform=kick&name=gaules')).status, 503);
  assert.equal((await app.request('/search?platform=twitch&q=g')).status, 400);
});

test('/search: o 21º pedido do mesmo IP no mesmo minuto dá 429 e outro IP segue com 200', async t => {
  const tick = lookups(t);
  const ip = '198.51.100.1';
  for (let i = 0; i < 20; i++) assert.equal((await get(`/search?platform=kick&q=a${i}`, ip)).status, 200);
  const res = await get('/search?platform=kick&q=a20', ip);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'rate_limited' });
  assert.equal(res.headers.get('retry-after'), '60');
  // o /resolve de um link fora do cache divide o limite do IP
  assert.equal((await get('/resolve?platform=twitch&name=novo', ip)).status, 429);
  assert.equal((await get('/search?platform=kick&q=a20', '198.51.100.2')).status, 200);
  // insistir não gasta os 120 de 10 min: no minuto seguinte o IP volta
  for (let i = 0; i < 150; i++) await get(`/search?platform=kick&q=b${i}`, ip);
  tick(61e3);
  assert.equal((await get('/search?platform=kick&q=volta', ip)).status, 200);
});

test('/search: um flood numa plataforma não fecha a outra, e o pedido recusado não gasta o limite do IP', async t => {
  lookups(t);
  // 3 IPs de 20 gastam os 60 do minuto na Kick
  for (let n = 1; n <= 3; n++) for (let i = 0; i < 20; i++) assert.equal((await get(`/search?platform=kick&q=f${n}x${i}`, `203.0.113.${n}`)).status, 200);
  for (let i = 0; i < 30; i++) assert.equal((await get(`/search?platform=kick&q=g${i}`, '203.0.113.9')).status, 429);
  // as 30 recusas não contaram: o mesmo IP ainda faz as 20 do minuto na Twitch
  for (let i = 0; i < 20; i++) assert.equal((await get(`/search?platform=twitch&q=g${i}`, '203.0.113.9')).status, 200);
});

test('/search: no IPv6, cada /64 tem o limite de um IP e a rede /48 inteira, 5 vezes ele', async t => {
  lookups(t);
  const v6 = (net: string, n: number) => `2001:db8:${net}:${n.toString(16)}::1`;
  // 5 /64 do mesmo /48 fazem 20 cada, metade em cada plataforma (cada uma tem 60 por minuto)
  for (let n = 1; n <= 5; n++) {
    for (let i = 0; i < 20; i++) assert.equal((await get(`/search?platform=${i % 2 ? 'twitch' : 'kick'}&q=v${n}x${i}`, v6('a', n))).status, 200);
  }
  assert.equal((await get('/search?platform=twitch&q=v6', v6('a', 6))).status, 429);
  assert.equal((await get('/search?platform=twitch&q=v6', v6('b', 1))).status, 200);
});

test('/search: busca repetida vem do cache, sem chamar a plataforma nem gastar o limite', async t => {
  const tick = lookups(t);
  const ip = '198.51.100.30';
  const first = await get('/search?platform=twitch&q=Gaules', ip);
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body[0].login, 'Gaules');
  const calls = upstream.twitch;
  // termo com espaços nas pontas e outras maiúsculas, de outro IP
  assert.deepEqual(await (await get('/search?platform=twitch&q=%20gAULES%20', '198.51.100.31')).json(), body);
  assert.equal(upstream.twitch, calls);
  // o acerto não conta no limite: com o minuto do IP gasto, a busca repetida continua respondendo
  for (let i = 0; i < 19; i++) await get(`/search?platform=twitch&q=x${i}`, ip);
  assert.equal((await get('/search?platform=twitch&q=outra', ip)).status, 429);
  assert.equal((await get('/search?platform=twitch&q=gaules', ip)).status, 200);
  // cada plataforma tem o seu; 10 min depois a consulta sai de novo
  const kick = upstream.kick;
  assert.equal((await get('/search?platform=kick&q=gaules', '198.51.100.32')).status, 200);
  assert.ok(upstream.kick > kick);
  tick(10 * 60e3);
  const twitch = upstream.twitch;
  assert.equal((await get('/search?platform=twitch&q=gaules', '198.51.100.32')).status, 200);
  assert.ok(upstream.twitch > twitch);
});

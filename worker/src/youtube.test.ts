import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { QuotaDay, QuotaLimits } from './youtube.js';

// Supabase falso, atendido pelo fetch daqui: a conta da cota passa pelo kv (o loadEnvFile não sobrescreve o que já existe)
const KV_HOST = 'kv.falso.test';
process.env.SUPABASE_URL = `https://${KV_HOST}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'falso';
const { config } = await import('./config.js');
const { QuotaError, allowSearch, allowUnits, discoverEvery, fetchLive, isHandle, isoSeconds, pacificDay, parseFeed, refreshEvery, rollDay, search } =
  await import('./youtube.js');

/** Instância nova do módulo: conta da cota, bloqueios e caches zerados (config e db continuam os mesmos). */
const fresh = (tag: string): Promise<typeof import('./youtube.js')> => import(`./youtube.js?${tag}`);

/** kv falso: guarda o que o worker grava; as próximas leituras falham com os status de kvFail */
let kvSaved: QuotaDay | null = null;
let kvFail: number[] = [];
let kvReads = 0;
async function kv(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : new Request(String(input), init);
  if (req.method === 'GET') {
    kvReads++;
    const status = kvFail.shift();
    if (status) return Response.json({ message: 'upstream connect error' }, { status });
    return Response.json(kvSaved ? [{ value: kvSaved }] : []);
  }
  const body = await req.json();
  kvSaved = (Array.isArray(body) ? body[0] : body).value;
  return new Response(null, { status: 201 });
}

// ---- funções puras ----

test('isoSeconds: durações do YouTube', () => {
  assert.equal(isoSeconds('P0D'), 0);
  assert.equal(isoSeconds('PT0S'), 0);
  assert.equal(isoSeconds('PT1H2M3S'), 3723);
  assert.equal(isoSeconds('PT10M'), 600);
  assert.equal(isoSeconds('P1DT1S'), 86401);
  assert.equal(isoSeconds('P1W'), 7 * 86400);
  for (const d of ['P', 'PT', '', 'abc', '1H', null, undefined, 42]) assert.equal(isoSeconds(d), null, String(d));
});

test('isHandle: letras de qualquer alfabeto, com acentos e sinais', () => {
  for (const h of ['@원정상', '원정상', '@gamerjoão', 'casimiro', '@foo.bar_baz-1', '@हिन्दी', '@a·b', '@漢']) assert.ok(isHandle(h), h);
  for (const h of ['@', 'a b', 'foo/bar', '@' + 'a'.repeat(31), 'foo%20bar', 'x#1']) assert.ok(!isHandle(h), h);
});

test('pacificDay: o dia vira à meia-noite do Pacífico (com horário de verão)', () => {
  // PDT (UTC-7) em outubro
  assert.equal(pacificDay(Date.parse('2026-10-28T06:59:59Z')), '2026-10-27');
  assert.equal(pacificDay(Date.parse('2026-10-28T07:00:00Z')), '2026-10-28');
  // PST (UTC-8) em dezembro
  assert.equal(pacificDay(Date.parse('2026-12-01T07:59:59Z')), '2026-11-30');
  assert.equal(pacificDay(Date.parse('2026-12-01T08:00:00Z')), '2026-12-01');
});

test('rollDay: mantém a conta no mesmo dia e zera no dia seguinte', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const s: QuotaDay = { day: '2026-10-28', units: 10, browseUnits: 5, searches: 3, browseSearches: 2 };
  assert.equal(rollDay(s, now), s);
  assert.deepEqual(rollDay(s, now + 24 * 3600e3), { day: '2026-10-29', units: 0, browseUnits: 0, searches: 0, browseSearches: 0 });
  assert.equal(rollDay(null, now).day, '2026-10-28');
});

const LIM: QuotaLimits = { units: 10000, searches: 100, browseSearches: 60, browseUnits: 6000 };
const day = (o: Partial<QuotaDay>): QuotaDay => ({ day: 'd', units: 0, browseUnits: 0, searches: 0, browseSearches: 0, ...o });

test('allowUnits: lista com teto próprio, polling dos seguidos sempre passa', () => {
  assert.ok(allowUnits(day({}), LIM, 'browse', 1));
  assert.ok(!allowUnits(day({ units: 6000, browseUnits: 6000 }), LIM, 'browse', 1));
  assert.ok(allowUnits(day({ units: 6000, browseUnits: 6000 }), LIM, 'lookup', 1));
  // 20% ficam para o polling: lista e consultas do app param em 8.000
  assert.ok(!allowUnits(day({ units: 8000, browseUnits: 100 }), LIM, 'lookup', 1));
  assert.ok(!allowUnits(day({ units: 8000, browseUnits: 100 }), LIM, 'browse', 1));
  assert.ok(allowUnits(day({ units: 12000 }), LIM, 'follow', 1));
});

test('allowSearch: a descoberta usa no máximo 60, o resto é da busca por nome', () => {
  assert.ok(allowSearch(day({}), LIM, 'browse'));
  assert.ok(!allowSearch(day({ searches: 60, browseSearches: 60 }), LIM, 'browse'));
  assert.ok(allowSearch(day({ searches: 60, browseSearches: 60 }), LIM, 'lookup'));
  assert.ok(!allowSearch(day({ searches: 100, browseSearches: 60 }), LIM, 'lookup'));
  // a busca por nome não come a parte da descoberta
  assert.ok(!allowSearch(day({ searches: 40, browseSearches: 0 }), LIM, 'lookup'));
  assert.ok(allowSearch(day({ searches: 40, browseSearches: 0 }), LIM, 'browse'));
  // com as buscas do dia no teto, a descoberta também para
  assert.ok(!allowSearch(day({ searches: 100 }), LIM, 'browse'));
});

test('refreshEvery e discoverEvery: a cota do dia se divide entre as línguas pedidas', () => {
  assert.equal(refreshEvery(1, LIM), 180e3);
  assert.equal(refreshEvery(12, LIM), 216e3);
  assert.equal(refreshEvery(50, LIM), 900e3);
  assert.equal(discoverEvery(3, LIM, 120 * 60e3), 120 * 60e3);
  assert.equal(discoverEvery(10, LIM, 120 * 60e3), 4 * 3600e3);
});

test('parseFeed: até 15 vídeos; vazio só vale com <feed', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `v${i}`);
  assert.deepEqual(parseFeed(feedXml(ids)), ids.slice(0, 15));
  assert.deepEqual(parseFeed('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'), []);
  assert.equal(parseFeed('<!DOCTYPE html><html><title>Error 404</title></html>'), null);
  assert.equal(parseFeed(''), null);
});

// ---- fetchLive com fetch falso ----

const UC = (s: string) => 'UC' + s.padEnd(22, 'x');
const feedXml = (ids: string[]) =>
  `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${ids.map(id => `<entry><yt:videoId>${id}</yt:videoId></entry>`).join('')}</feed>`;

const feeds = new Map<string, () => Response>();
const videos = new Map<string, any>();
let asked: string[][] = [];
let videosDown = false;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.host === KV_HOST) return kv(input, init);
  if (url.pathname === '/feeds/videos.xml') return feeds.get(url.searchParams.get('channel_id')!)?.() ?? new Response('nf', { status: 404 });
  if (url.pathname.endsWith('/videoCategories')) return Response.json({ items: [{ id: '20', snippet: { title: 'Jogos' } }] });
  if (url.pathname.endsWith('/videos')) {
    const ids = url.searchParams.get('id')!.split(',');
    asked.push(ids);
    if (videosDown) return new Response('erro', { status: 500 });
    return Response.json({ items: ids.map(id => videos.get(id)).filter(Boolean) });
  }
  return new Response('sem rota', { status: 599 });
}) as typeof fetch;

const video = (id: string, ch: string, state: 'live' | 'upcoming' | 'none', o: { viewers?: number; duration?: string | null; start?: string; end?: string } = {}) =>
  videos.set(id, {
    id,
    snippet: { channelId: ch, liveBroadcastContent: state, title: `t ${id}`, categoryId: '20', channelTitle: 'Canal', thumbnails: { maxres: { url: 'maxres' }, high: { url: 'high' } } },
    liveStreamingDetails: { concurrentViewers: String(o.viewers ?? 10), actualStartTime: '2026-10-28T00:00:00Z', scheduledStartTime: o.start, actualEndTime: o.end },
    ...(o.duration === null ? {} : { contentDetails: { duration: o.duration ?? 'P0D' } }),
  });

test('fetchLive: acha a live no 10º item do feed e não reconsulta o que já é none', async () => {
  const ch = UC('a');
  const ids = Array.from({ length: 15 }, (_, i) => `a${i}`);
  feeds.set(ch, () => new Response(feedXml(ids)));
  ids.forEach((id, i) => video(id, ch, i === 9 ? 'live' : 'none'));
  asked = [];
  const r1 = await fetchLive([ch]);
  assert.equal(r1.live.get(ch)?.url, 'https://www.youtube.com/watch?v=a9');
  assert.equal(r1.live.get(ch)?.thumb, 'high');
  assert.equal(r1.live.get(ch)?.cat, 'Jogos');
  assert.equal(r1.live.get(ch)?.premiere, undefined);
  assert.deepEqual(asked, [ids]);

  // segunda rodada: só a live (acompanhada) volta para a videos.list
  asked = [];
  await fetchLive([ch]);
  assert.deepEqual(asked, [['a9']]);

  // um canal novo (chamada só com ele) não zera o que já se sabe do primeiro
  const other = UC('b');
  feeds.set(other, () => new Response(feedXml(['b0'])));
  video('b0', other, 'none');
  await fetchLive([other]);
  asked = [];
  const r3 = await fetchLive([ch]);
  assert.deepEqual(asked, [['a9']]);
  assert.ok(r3.live.has(ch));
});

test('fetchLive: com o feed fora, o vídeo conhecido segue conferido e a live acaba na hora', async () => {
  const ch = UC('c');
  video('c1', ch, 'live');
  const known = new Map([[ch, ['c1']]]);
  const r1 = await fetchLive([ch], known);
  assert.ok(r1.live.has(ch));
  assert.ok(!r1.unknown.has(ch));

  video('c1', ch, 'none', { end: '2026-10-28T03:00:00Z' });
  const r2 = await fetchLive([ch], known);
  assert.ok(!r2.live.has(ch));
  assert.ok(!r2.unknown.has(ch));
  assert.equal(r2.ended.get(ch), '2026-10-28T03:00:00Z');

  // o registry ainda manda o mesmo id: já se sabe que acabou, então não fica unknown
  asked = [];
  const r3 = await fetchLive([ch], known);
  assert.deepEqual(asked, []);
  assert.ok(!r3.unknown.has(ch));
});

test('fetchLive: feed fora e nada conferido = unknown; feed vazio só com <feed', async () => {
  const down = UC('d');
  const empty = UC('e');
  const html = UC('f');
  feeds.set(empty, () => new Response('<?xml version="1.0"?><feed></feed>'));
  feeds.set(html, () => new Response('<!DOCTYPE html><html></html>'));
  const r = await fetchLive([down, empty, html, 'UCcurto', 'youtube:lixo']);
  assert.deepEqual([...r.unknown].sort(), [down, html].sort());
  assert.equal(r.live.size, 0);
});

test('fetchLive: videos.list fora deixa unknown quem tinha vídeo para conferir', async () => {
  const ch = UC('g');
  const quiet = UC('g2');
  feeds.set(ch, () => new Response(feedXml(['g1'])));
  feeds.set(quiet, () => new Response(feedXml([])));
  videosDown = true;
  try {
    const r = await fetchLive([ch, quiet]);
    assert.deepEqual([...r.unknown], [ch]);
  } finally {
    videosDown = false;
  }
});

test('fetchLive: a live vai para o dono de verdade (snippet.channelId), não para um alias', async () => {
  const alias = UC('h');
  const real = UC('i');
  feeds.set(alias, () => new Response(feedXml(['h1'])));
  video('h1', real, 'live');
  const r = await fetchLive([alias, real]);
  assert.ok(!r.live.has(alias));
  assert.ok(r.live.has(real));
});

test('fetchLive: estreia vem marcada; a live de verdade tem prioridade; sem contentDetails é live', async () => {
  const both = UC('j');
  const only = UC('k');
  const noDetails = UC('k2');
  feeds.set(both, () => new Response(feedXml(['j1', 'j2'])));
  feeds.set(only, () => new Response(feedXml(['k1'])));
  feeds.set(noDetails, () => new Response(feedXml(['k3'])));
  video('j1', both, 'live', { viewers: 500, duration: 'PT10M' });
  video('j2', both, 'live', { viewers: 100 });
  video('k1', only, 'live', { duration: 'PT1H2M' });
  video('k3', noDetails, 'live', { duration: null });
  const r = await fetchLive([both, only, noDetails]);
  assert.equal(r.live.get(both)?.url, 'https://www.youtube.com/watch?v=j2');
  assert.equal(r.live.get(both)?.premiere, undefined);
  assert.equal(r.live.get(only)?.premiere, true);
  assert.equal(r.live.get(noDetails)?.premiere, undefined);

  // a estreia acaba: o fim dela não vira "última live"
  video('k1', only, 'none', { end: '2026-10-28T05:00:00Z', duration: 'PT1H2M' });
  const r2 = await fetchLive([only]);
  assert.ok(!r2.live.has(only));
  assert.equal(r2.ended.get(only), undefined);
});

test('fetchLive: upcoming segue conferido fora do feed; o marcado para longe espera', async () => {
  const ch = UC('l');
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const later = new Date(Date.now() + 10 * 24 * 3600e3).toISOString();
  feeds.set(ch, () => new Response(feedXml(['l1', 'l2'])));
  video('l1', ch, 'upcoming', { start: soon });
  video('l2', ch, 'upcoming', { start: later });
  await fetchLive([ch]);
  // o feed agora vem sem eles (canal postou Shorts, por exemplo)
  feeds.set(ch, () => new Response(feedXml(['l3'])));
  video('l3', ch, 'none');
  video('l1', ch, 'live');
  asked = [];
  const r = await fetchLive([ch]);
  assert.deepEqual(asked.flat().sort(), ['l1', 'l3']);
  assert.equal(r.live.get(ch)?.url, 'https://www.youtube.com/watch?v=l1');
});

test('fetchLive: upcoming atrasado há mais de um dia volta a ser conferido em 30 min, não em 6 h', async t => {
  const ch = UC('n');
  feeds.set(ch, () => new Response(feedXml(['n1'])));
  video('n1', ch, 'upcoming', { start: new Date(Date.now() - 30 * 3600e3).toISOString() });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await fetchLive([ch]);
  // entra ao vivo logo depois: a rodada seguinte ainda não confere
  video('n1', ch, 'live');
  now += 3 * 60e3;
  asked = [];
  assert.ok(!(await fetchLive([ch])).live.has(ch));
  assert.deepEqual(asked, []);
  now += 30 * 60e3;
  assert.ok((await fetchLive([ch])).live.has(ch));
});

// ---- cota da busca ----

test("search: sem busca sobrando, só o @handle funciona; o resto lança QuotaError 'searches'", async () => {
  const real = globalThis.fetch;
  (config as unknown as { youtubeQuota: QuotaLimits }).youtubeQuota = { units: 100, searches: 2, browseSearches: 1, browseUnits: 50 };
  const ch = UC('m');
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/channels')) {
      const ok = url.searchParams.get('forHandle') === '@achado' || url.searchParams.get('id') === ch;
      return Response.json({ items: ok ? [{ id: ch, snippet: { title: 'Achado', thumbnails: {} }, statistics: { subscriberCount: '10' } }] : [] });
    }
    if (url.pathname.endsWith('/search')) return Response.json({ items: [{ snippet: { channelId: ch } }] });
    return new Response('sem rota', { status: 599 });
  }) as typeof fetch;
  try {
    // 1ª busca por nome: gasta a única busca que sobra para isso (2 - 1 da descoberta)
    assert.equal((await search('nome qualquer'))[0]?.channelId, ch);
    await assert.rejects(search('outro nome'), (e: unknown) => e instanceof QuotaError && e.bucket === 'searches');
    // o @handle continua funcionando
    assert.equal((await search('@achado'))[0]?.channelId, ch);
    assert.deepEqual(await search('@sumido'), []);
  } finally {
    globalThis.fetch = real;
  }
});

// ---- 403 de cota, leitura do kv e o balde do QuotaError (cada um numa instância nova do módulo) ----

const channelJson = (id: string) => ({ id, snippet: { title: 'Canal', thumbnails: {} }, statistics: { subscriberCount: '10' } });
const quota403 = () => new Response('{"error":{"code":403,"errors":[{"reason":"quotaExceeded"}]}}', { status: 403 });

/** Troca o fetch e a cota só no teste; o kv continua no falso daqui. */
function upstream(t: TestContext, route: (url: URL) => Response | Promise<Response>) {
  const real = globalThis.fetch;
  const lim = config.youtubeQuota;
  config.youtubeQuota = { ...LIM };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    return url.host === KV_HOST ? kv(input, init) : route(url);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
    config.youtubeQuota = lim;
  });
}

test('403 de cota: o pedido de antes da virada não fecha o dia novo; o do mesmo dia para as consultas por até 1 h', async t => {
  const yt = await fresh('virada');
  kvSaved = null;
  // 23:59:59.8 no Pacífico (a meia-noite de 28/10, em PDT, é 07:00 UTC)
  let now = Date.parse('2026-10-28T06:59:59.800Z');
  t.mock.method(Date, 'now', () => now);
  const ch = UC('q');
  let release!: () => void;
  let hold: Promise<void> | null = new Promise<void>(r => (release = r));
  let sent!: () => void;
  const inFlight = new Promise<void>(r => (sent = r));
  upstream(t, async url => {
    if (url.pathname === '/feeds/videos.xml') return new Response(feedXml(['q1']));
    if (url.pathname.endsWith('/channels')) return Response.json({ items: [channelJson(ch)] });
    if (!url.pathname.endsWith('/videos')) return new Response('sem rota', { status: 599 });
    sent();
    if (hold) await hold;
    return quota403();
  });
  // a videos.list do polling sai no dia 27; um /resolve vira o dia antes de o 403 chegar
  const poll = yt.fetchLive([ch]);
  await inFlight;
  now += 400;
  assert.equal((await yt.resolve('@virada1'))?.channelId, ch);
  release();
  await poll;
  assert.equal((await yt.resolve('@virada2'))?.channelId, ch);
  // 403 de um pedido do próprio dia: as consultas do app param (balde das unidades), o polling não
  hold = null;
  await yt.fetchLive([UC('q2')]);
  await assert.rejects(yt.resolve('@virada3'), (e: unknown) => e instanceof yt.QuotaError && e.bucket === 'units');
  now += 61 * 60e3;
  assert.equal((await yt.resolve('@virada4'))?.channelId, ch);
});

test('cota salva: leitura do kv que falha não zera a conta nem grava por cima; 30 s depois lê de novo e soma', async t => {
  const yt = await fresh('kv');
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const today = pacificDay(now);
  kvSaved = { day: today, units: 5000, browseUnits: 3000, searches: 30, browseSearches: 20 };
  kvFail = [504];
  kvReads = 0;
  upstream(t, url => (url.pathname.endsWith('/channels') ? Response.json({ items: [channelJson(UC('r'))] }) : new Response('sem rota', { status: 599 })));
  await yt.resolve('@kv1');
  await yt.flush();
  assert.equal(kvSaved?.units, 5000);
  // antes de 30 s, não tenta ler de novo
  await yt.resolve('@kv2');
  assert.equal(kvReads, 1);
  now += 31e3;
  await yt.resolve('@kv3');
  await new Promise(r => setTimeout(r, 50));
  await yt.flush();
  assert.equal(kvReads, 2);
  assert.deepEqual(kvSaved, { day: today, units: 5003, browseUnits: 3000, searches: 30, browseSearches: 20 });
});

test("QuotaError diz o balde: sem unidades para o app, 'units'; 403 do search.list, 'searches'", async t => {
  const yt = await fresh('balde');
  // a lista gastou 6.000 e o polling 2.000: as consultas do app param em 8.000
  kvSaved = { day: pacificDay(Date.now()), units: 8000, browseUnits: 6000, searches: 10, browseSearches: 10 };
  let google = 0;
  upstream(t, url => {
    google++;
    return url.pathname.endsWith('/search') ? quota403() : new Response('sem rota', { status: 599 });
  });
  const bucket = (b: string) => (e: unknown) => e instanceof yt.QuotaError && e.bucket === b;
  // colar o link também não adiantaria: a busca e o /resolve dizem 'units'
  await assert.rejects(yt.search('gaules'), bucket('units'));
  await assert.rejects(yt.resolve('@gaules'), bucket('units'));
  assert.equal(google, 0);
  // termo que não é @handle vai direto ao search.list
  await assert.rejects(yt.search('canal do jogo!'), bucket('searches'));
  assert.equal(google, 1);
});

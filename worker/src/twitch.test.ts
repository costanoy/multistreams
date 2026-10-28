import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bucket, crawlLive, fetchLive, helixWait, lastLiveAt, resolve, vodEnd } from './twitch.js';
import { HttpError } from './types.js';

test('vodEnd: início do VOD + duração, no máximo agora', () => {
  const far = Date.parse('2030-01-01T00:00:00Z');
  assert.equal(vodEnd('2026-10-27T20:00:00Z', '10h0m0s', far), '2026-10-28T06:00:00Z');
  assert.equal(vodEnd('2026-10-27T20:00:00Z', '3h8m33s', far), '2026-10-27T23:08:33Z');
  assert.equal(vodEnd('2026-10-27T20:00:00Z', '45m2s', far), '2026-10-27T20:45:02Z');
  assert.equal(vodEnd('2026-10-27T20:00:00Z', '33s', far), '2026-10-27T20:00:33Z');
  // ainda não acabou (ou relógio adiantado): no máximo agora
  assert.equal(vodEnd('2026-10-27T20:00:00Z', '10h0m0s', Date.parse('2026-10-28T01:00:00Z')), '2026-10-28T01:00:00Z');
  // duração ilegível: fica o início
  for (const d of ['', '1 hora', '3h8x', null, 42]) assert.equal(vodEnd('2026-10-27T20:00:00Z', d, far), '2026-10-27T20:00:00Z', String(d));
});

test('helixWait: varredura deixa a reserva para o polling dos seguidos', () => {
  const now = 1_000_000;
  const b = (o: Partial<Bucket>): Bucket => ({ limit: 800, remaining: 800, reset: now + 60e3, at: now, inflight: 0, ...o });
  assert.equal(helixWait(b({}), now, true), 0);
  assert.equal(helixWait(b({ remaining: 150 }), now, false), 0);
  assert.ok(helixWait(b({ remaining: 150 }), now, true) > 0);
  // sem pontos, até o polling espera um pouco (mas não até o reset)
  const w = helixWait(b({ remaining: 0, reset: now + 60e3 }), now, false);
  assert.ok(w > 0 && w < 1000, String(w));
  // chamadas em andamento contam
  assert.ok(helixWait(b({ remaining: 210, inflight: 20 }), now, true) > 0);
  // balde já cheio de novo (ou ainda sem resposta nenhuma)
  assert.equal(helixWait(b({ remaining: 0, reset: now - 1 }), now, true), 0);
  assert.equal(helixWait(b({ reset: 0, at: 0 }), now, false), 0);
  // mas não manda mais chamadas de uma vez do que o balde aguenta
  assert.ok(helixWait(b({ reset: 0, at: 0, inflight: 800 }), now, false) > 0);
  assert.ok(helixWait(b({ reset: 0, at: 0, inflight: 650 }), now, true) > 0);
  // nunca espera além do reset
  assert.ok(helixWait(b({ remaining: 0, reset: now + 5000, limit: 100 }), now, true) <= 5000);
});

// ---- com fetch falso ----

let failUser = '';
let limited = 0;
const calls: string[] = [];
/** varredura: 3 páginas de 2 lives; a do meio responde antes com estes status ('rede' = a conexão cai) */
let pageFails: (number | 'rede')[] = [];

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  calls.push(url.pathname);
  if (url.host === 'id.twitch.tv') return Response.json({ access_token: 'x', expires_in: 3600 });
  if (url.pathname === '/helix/streams' && url.searchParams.has('language')) {
    const page = Number(url.searchParams.get('after') ?? 0);
    if (page === 1 && pageFails.length) {
      const f = pageFails.shift()!;
      if (f === 'rede') throw new TypeError('fetch failed');
      return new Response('erro', { status: f });
    }
    return Response.json({
      data: [0, 1].map(i => ({ user_id: `${page}${i}`, user_login: `p${page}${i}`, user_name: 'P', type: 'live', viewer_count: 9, title: 't', game_name: 'Jogo', language: 'pt' })),
      pagination: page < 2 ? { cursor: String(page + 1) } : {},
    });
  }
  if (url.pathname === '/helix/streams') {
    const ids = url.searchParams.getAll('user_id');
    if (ids.includes(failUser)) return new Response('erro', { status: 500 });
    if (limited > 0) {
      limited--;
      return new Response('limite', { status: 429, headers: { 'ratelimit-remaining': '0', 'ratelimit-reset': String(Math.floor(Date.now() / 1000) - 1), 'ratelimit-limit': '800' } });
    }
    return Response.json({
      data: ids.filter(id => Number(id) % 2 === 0).map(id => ({
        user_id: id, user_login: `u${id}`, user_name: `U${id}`, type: 'live', viewer_count: 5, title: 't', game_name: 'Jogo',
        language: 'pt', started_at: '2026-10-28T00:00:00Z', thumbnail_url: 'https://x/{width}x{height}.jpg',
      })),
    });
  }
  if (url.pathname === '/helix/users') return Response.json({ data: [{ id: '42', login: 'gaules', display_name: 'Gaules', profile_image_url: 'p' }] });
  if (url.pathname === '/helix/channels') return failUser === 'channels' ? new Response('erro', { status: 500 }) : Response.json({ data: [{ broadcaster_language: 'pt' }] });
  if (url.pathname === '/helix/channels/followers') return Response.json({ total: 1000 });
  if (url.pathname === '/helix/videos') return Response.json({ data: [{ created_at: '2026-10-27T20:00:00Z', duration: '10h0m0s' }] });
  return new Response('sem rota', { status: 599 });
}) as typeof fetch;

test('fetchLive: lote que falha vai inteiro para unknown, os outros seguem', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => String(1000 + i));
  failUser = '1150';
  try {
    const r = await fetchLive([...ids, 'abc', 'twitch:1']);
    assert.equal(r.unknown.size, 100);
    assert.ok(r.unknown.has('1100') && r.unknown.has('1199') && !r.unknown.has('1200'));
    assert.ok(r.live.has('1000') && r.live.has('1248') && !r.live.has('1001') && !r.live.has('1150'));
    assert.equal(r.live.get('1000')?.thumb, 'https://x/440x248.jpg');
    assert.ok(!r.unknown.has('abc'));
  } finally {
    failUser = '';
  }
});

test('fetchLive: 429 espera o balde e tenta de novo', async () => {
  limited = 1;
  const r = await fetchLive(['2000']);
  assert.equal(limited, 0);
  assert.ok(r.live.has('2000'));
  assert.equal(r.unknown.size, 0);
});

test('resolve: o idioma vem da Get Channel Information, que é opcional', async () => {
  const c = await resolve('gaules');
  assert.equal(c?.lang, 'pt');
  assert.equal(c?.followers, 1000);
  failUser = 'channels';
  try {
    const d = await resolve('gaules');
    assert.equal(d?.channelId, '42');
    assert.equal(d?.lang, null);
  } finally {
    failUser = '';
  }
  assert.equal(await resolve('nome com espaço'), null);
});

test('lastLiveAt: fim do último VOD, não o início', async () => {
  assert.equal(await lastLiveAt('42'), '2026-10-28T06:00:00Z');
});

test('crawlLive: página com 5xx é pedida de novo, sem recomeçar a varredura; 4xx desiste na hora', async () => {
  const pages = () => calls.filter(p => p === '/helix/streams').length;
  const got: string[] = [];
  pageFails = [503];
  let before = pages();
  await crawlLive(['pt'], items => got.push(...items.map(i => i.channelId)));
  assert.deepEqual(got, ['00', '01', '10', '11', '20', '21']);
  assert.equal(pages() - before, 4);
  pageFails = [400];
  before = pages();
  await assert.rejects(crawlLive(['pt'], () => {}), (e: unknown) => e instanceof HttpError && e.status === 400);
  assert.equal(pages() - before, 2);
});

test('crawlLive: erro de rede também é pedido de novo; depois de 2 novas tentativas, desiste da página', async t => {
  // relógio falso: as esperas de 1 e 2 s passam na hora
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pages = () => calls.filter(p => p === '/helix/streams').length;
  const run = async (p: Promise<unknown>) => {
    let done = false;
    p.then(() => (done = true), () => (done = true));
    for (let i = 0; i < 50 && !done; i++) {
      await new Promise(r => setImmediate(r));
      t.mock.timers.tick(1000);
    }
    return p;
  };
  pageFails = ['rede', 503];
  let before = pages();
  await run(crawlLive(['pt'], () => {}));
  assert.equal(pages() - before, 5);
  pageFails = [503, 'rede', 502];
  before = pages();
  await assert.rejects(run(crawlLive(['pt'], () => {})), (e: unknown) => e instanceof HttpError && e.status === 502);
  assert.equal(pages() - before, 4);
});

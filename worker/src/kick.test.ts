import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoryIds, fetchLive, resolve } from './kick.js';

const asked: string[][] = [];
let badSlug = '';
let catsDown = false;
let catCalls = 0;

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.host === 'id.kick.com') return Response.json({ access_token: 'x', expires_in: 3600 });
  if (url.pathname === '/public/v1/categories') {
    catCalls++;
    if (catsDown) return new Response('erro', { status: 500 });
    // a busca da Kick é por trecho do nome
    return Response.json({ data: [{ id: 7, name: 'Slots' }, { id: 8, name: 'Slots & Casino' }] });
  }
  if (url.pathname === '/public/v1/channels') {
    const slugs = url.searchParams.getAll('slug');
    asked.push(slugs);
    // como a Kick: slug com mais de 25 caracteres recusa o lote inteiro
    if (slugs.some(s => s.length > 25 || s === badSlug)) return Response.json({ message: 'Invalid parameters' }, { status: 400 });
    return Response.json({
      data: slugs.map((slug, i) => ({
        slug, stream_title: `t ${slug}`, category: { name: 'Just Chatting' },
        stream: { is_live: i % 2 === 0, viewer_count: 7, thumbnail: 'th', language: 'pt', start_time: '0001-01-01T00:00:00Z' },
      })),
    });
  }
  return new Response('sem rota', { status: 599 });
}) as typeof fetch;

test('fetchLive: lote que falha vai para unknown; slug fora do formato nem é pedido', async () => {
  const slugs = Array.from({ length: 60 }, (_, i) => `canal${i}`);
  badSlug = 'canal55';
  asked.length = 0;
  try {
    const r = await fetchLive([...slugs, 'a'.repeat(26), 'Maiusculo']);
    assert.equal(asked.length, 2);
    assert.ok(asked.flat().every(s => s.length <= 25 && s === s.toLowerCase()));
    assert.deepEqual([...r.unknown].sort(), slugs.slice(50).sort());
    assert.ok(r.live.has('canal0') && !r.live.has('canal1') && !r.live.has('canal50'));
    assert.equal(r.live.get('canal0')?.startedAt, null);
    assert.equal(r.live.get('canal0')?.lang, 'pt');
  } finally {
    badSlug = '';
  }
});

test('resolve: nome com mais de 25 caracteres não vai para a API', async () => {
  asked.length = 0;
  assert.equal(await resolve('a'.repeat(26)), null);
  assert.equal(asked.length, 0);
  assert.equal((await resolve('Gaules'))?.channelId, 'gaules');
});

test('categoryIds: a busca que falha fica 5 min devolvendo vazio, sem chamar a Kick de novo', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  catsDown = true;
  t.after(() => void (catsDown = false));
  await assert.rejects(categoryIds('Slots'));
  assert.equal(catCalls, 1);
  assert.deepEqual(await categoryIds('Slots'), []);
  assert.equal(catCalls, 1);
  catsDown = false;
  now += 5 * 60e3;
  assert.deepEqual(await categoryIds('Slots'), [7]);
  assert.equal(catCalls, 2);
  // o acerto fica guardado
  assert.deepEqual(await categoryIds('slots'), [7]);
  assert.equal(catCalls, 2);
});

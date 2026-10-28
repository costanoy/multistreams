import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Gate, browse, categories, join, prune, snapshot } from './browse.js';
import { enabled } from './config.js';
import { BrowseItem, HttpError } from './types.js';

const item = (key: string, viewers: number, lang = 'pt', cat = 'Jogo'): BrowseItem => ({
  key, platform: 'twitch', channelId: key, login: key, name: key, avatar: 'a', viewers, title: '', cat, thumb: null, lang, url: '',
});
const keys = (items: BrowseItem[]) => items.map(i => i.key);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('join: sem repetir canal, só nas línguas e categorias pedidas, por viewers', () => {
  const a = [item('x', 10), item('y', 30, 'en'), item('z', 5, 'pt', 'Grand Theft Auto V (GTA)')];
  const b = [item('x', 99), item('w', 20), item('v', 1, 'fr')];
  assert.deepEqual(keys(join([a, b], new Set(['pt', 'en']), new Set())), ['y', 'w', 'x', 'z']);
  // o primeiro retrato vence na repetição
  assert.equal(join([a, b], new Set(['pt']), new Set()).find(i => i.key === 'x')?.viewers, 10);
  assert.deepEqual(keys(join([a, b], new Set(['pt']), new Set(['grand theft auto v']))), ['z']);
});

test('snapshot: o primeiro pedido espera a primeira página; repetidos saem na montagem', async () => {
  let finish!: () => void;
  const done = new Promise<void>(r => (finish = r));
  const s = await snapshot('t|first', 60e3, async onPage => {
    onPage([item('a', 1), item('b', 5)]);
    onPage([item('b', 4), item('c', 3)]);
    await done;
  });
  assert.equal(s.complete, false);
  assert.deepEqual(keys(s.items).sort(), ['a', 'b', 'c']);
  finish();
  await sleep(5);
  assert.equal(s.complete, true);
  assert.deepEqual(keys(s.items), ['b', 'c', 'a']);
});

test('snapshot: falha mantém o retrato anterior, sem carimbar como novo, e tenta de novo logo', async t => {
  // relógio falso: com a máquina ocupada, um sleep de 120 ms passaria dos 2 TTLs e descartaria o retrato
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const ttl = 100;
  const s = await snapshot('t|fail', ttl, async onPage => onPage([item('a', 1)]));
  await sleep(5);
  const at = s.at;
  now += ttl + 20;
  await snapshot('t|fail', ttl, async onPage => {
    onPage([item('novo', 9)]);
    throw new Error('Kick fora');
  });
  await sleep(5);
  assert.deepEqual(keys(s.items), ['a']);
  assert.equal(s.at, at);
  assert.equal(s.complete, false);
  assert.ok(s.next - Date.now() <= ttl, 'nova tentativa antes do TTL');
});

test('snapshot: falha no primeiro boot fica com o que chegou, como parcial', async () => {
  const s = await snapshot('t|fail-first', 60e3, async onPage => {
    onPage([item('a', 1), item('b', 2)]);
    throw new Error('caiu no meio');
  });
  await sleep(5);
  assert.deepEqual(keys(s.items), ['b', 'a']);
  assert.equal(s.complete, false);
});

test('snapshot: 400 não melhora tentando de novo: vale como completo', async () => {
  const s = await snapshot('t|400', 60e3, async () => {
    throw new HttpError(400, '400 api.kick.com: Invalid parameters');
  });
  await sleep(5);
  assert.equal(s.complete, true);
  assert.deepEqual(s.items, []);
  assert.ok(s.next - Date.now() > 30e3);
});

test('snapshot: vencido serve o anterior enquanto monta; com mais de 2 TTLs, descarta e volta parcial', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const ttl = 100;
  const s = await snapshot('t|old', ttl, async onPage => onPage([item('velho', 1)]));
  await sleep(5);
  // entre 1 e 2 TTLs: devolve o anterior na hora e monta outro por trás
  now += ttl + 20;
  let release!: () => void;
  const hold = new Promise<void>(r => (release = r));
  const mid = await snapshot('t|old', ttl, async onPage => {
    await hold;
    onPage([item('meio', 2)]);
  });
  assert.deepEqual(keys(mid.items), ['velho']);
  assert.equal(mid.complete, true);
  release();
  await sleep(5);
  assert.deepEqual(keys(s.items), ['meio']);
  // mais de 2 TTLs parado: o velho sai antes de montar de novo
  now += 3 * ttl;
  const fresh = await snapshot('t|old', ttl, async onPage => {
    onPage([item('agora', 3)]);
    await sleep(20);
  });
  assert.deepEqual(keys(fresh.items), ['agora']);
  assert.equal(fresh.complete, false);
});

test('snapshot: montagem longa (e keep maior) seguram o anterior por mais de 2 TTLs', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const ttl = 1000;
  // a montagem leva 2 TTLs, como a varredura inteira da Twitch
  const s = await snapshot('t|longa', ttl, async onPage => {
    now += 2 * ttl;
    onPage([item('velho', 1)]);
  });
  await sleep(5);
  assert.equal(s.complete, true);
  // vencido há 3 TTLs: com o TTL mais 2 montagens, ainda serve o anterior enquanto monta de novo
  now += 3 * ttl;
  let release!: () => void;
  const hold = new Promise<void>(r => (release = r));
  const mid = await snapshot('t|longa', ttl, async onPage => {
    await hold;
    onPage([item('novo', 2)]);
  });
  assert.deepEqual(keys(mid.items), ['velho']);
  release();
  await sleep(5);
  assert.deepEqual(keys(s.items), ['novo']);
  // montagem rápida, mas com keep de 10 TTLs (o 'twitch|*' usa 10 min)
  await snapshot('t|keep', ttl, async onPage => onPage([item('velho', 1)]), undefined, 10 * ttl);
  await sleep(5);
  now += 5 * ttl;
  const kept = await snapshot('t|keep', ttl, async onPage => {
    await sleep(20);
    onPage([item('novo', 2)]);
  }, undefined, 10 * ttl);
  assert.deepEqual(keys(kept.items), ['velho']);
});

test('prune: retrato parado sai da memória, mas nunca durante a montagem', async () => {
  let release!: () => void;
  const hold = new Promise<void>(r => (release = r));
  await snapshot('t|idle', 60e3, async onPage => onPage([item('a', 1)]));
  await snapshot('t|busy', 60e3, async onPage => {
    onPage([item('b', 1)]);
    await hold;
  });
  await sleep(5);
  const gone = prune(Date.now() + 16 * 60e3);
  assert.ok(gone.includes('t|idle'));
  assert.ok(!gone.includes('t|busy'));
  release();
  await sleep(5);
  assert.ok(prune(Date.now() + 16 * 60e3).includes('t|busy'));
});

test('Gate: no máximo n ao mesmo tempo; urgente passa na frente da fila', async () => {
  const gate = new Gate(2);
  let active = 0;
  let peak = 0;
  const order: string[] = [];
  const job = (name: string, ms: number) => async () => {
    active++;
    peak = Math.max(peak, active);
    order.push(name);
    await sleep(ms);
    active--;
  };
  await Promise.all([
    gate.run(job('a', 20)),
    gate.run(job('b', 20)),
    gate.run(job('c', 5)),
    gate.run(job('d', 5), true),
  ]);
  assert.equal(peak, 2);
  assert.deepEqual(order, ['a', 'b', 'd', 'c']);
});

// ---- browse e categories com fetch falso ----

const streamsAsked: string[][] = [];
const kickAsked: string[] = [];
/** língua em que a lista da Kick responde 500 */
let kickDown = '';

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.host === 'id.twitch.tv' || url.host === 'id.kick.com') return Response.json({ access_token: 'x', expires_in: 3600 });
  if (url.pathname === '/helix/streams') {
    streamsAsked.push(url.searchParams.getAll('language'));
    const langs = ['pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'ru', 'other'];
    return Response.json({
      data: langs.map((language, i) => ({
        user_id: String(900 + i), user_login: `u${i}`, user_name: `U${i}`, type: 'live', viewer_count: 100 - i, title: 't', game_name: 'Jogo', language,
      })),
    });
  }
  if (url.pathname === '/helix/users') return Response.json({ data: [] });
  if (url.pathname === '/public/v1/livestreams') {
    const lang = url.searchParams.get('language')!;
    const cat = url.searchParams.get('category_id');
    kickAsked.push(cat ? `${lang}:${cat}` : lang);
    if (lang === kickDown) return new Response('erro', { status: 500 });
    // português tem mais de 100 lives (vem a lista cheia); espanhol, só 3
    const n = cat ? 5 : lang === 'pt' ? 100 : 3;
    return Response.json({
      data: Array.from({ length: n }, (_, i) => ({
        slug: cat ? `${lang}-c${cat}-${i}` : `${lang}-${i}`, viewer_count: 1000 - i, stream_title: 't', thumbnail: null,
        category: { id: cat ? Number(cat) : (i % 3) + 1, name: `Cat ${cat ?? (i % 3) + 1}` }, profile_picture: 'p',
      })),
    });
  }
  return new Response('sem rota', { status: 599 });
}) as typeof fetch;

test('browse: com muitas línguas a Twitch é varrida uma vez, sem filtro, e filtrada aqui', async () => {
  enabled.twitch = true;
  try {
    const langs = ['pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh'];
    const r = await browse(['twitch'], langs, [], 'desc', 0, 50);
    assert.deepEqual(streamsAsked, [[]]);
    assert.equal(r.total, 8);
    assert.ok(r.items.every(i => langs.includes(i.lang)));
    // com poucas línguas, um retrato por língua
    await browse(['twitch'], ['pt', 'en'], [], 'desc', 0, 50);
    assert.deepEqual(streamsAsked.slice(1).sort(), [['en'], ['pt']]);
  } finally {
    enabled.twitch = false;
  }
});

test('browse: na Kick, categorias fortes só na língua com a lista cheia; categories() fica junto da junção', async () => {
  enabled.kick = true;
  try {
    const r = await browse(['kick'], ['pt', 'es'], [], 'desc', 0, 500);
    assert.deepEqual(kickAsked.filter(k => k.startsWith('es')), ['es']);
    assert.deepEqual(kickAsked.filter(k => k.startsWith('pt:')).sort(), ['pt:1', 'pt:2', 'pt:3']);
    assert.equal(r.total, 100 + 3 + 3 * 5);
    assert.equal(r.partial, false);
    const c1 = await categories(['kick'], ['pt', 'es']);
    const c2 = await categories(['kick'], ['pt', 'es']);
    assert.equal(c1.items, c2.items);
    assert.equal(c1.items[0].lives > 0, true);
    // com categoria marcada, só ela entra (e a busca vai direto nela)
    kickAsked.length = 0;
    const f = await browse(['kick'], ['pt', 'es'], ['Cat 2'], 'desc', 0, 500);
    assert.ok(f.items.every(i => i.cat === 'Cat 2'));
  } finally {
    enabled.kick = false;
  }
});

test('browse: fonte fora do ar é parcial só até a segunda falha seguida', async t => {
  enabled.kick = true;
  kickDown = 'it';
  t.after(() => {
    enabled.kick = false;
    kickDown = '';
  });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  // primeira falha: o app ainda relê logo (a nova tentativa vem em 15 s)
  assert.equal((await browse(['kick'], ['it'], [], 'desc', 0, 10)).partial, true);
  now += 16e3;
  // segunda falha seguida: está fora do ar, não "ainda juntando"
  const r = await browse(['kick'], ['it'], [], 'desc', 0, 10);
  assert.equal(r.partial, false);
  assert.equal(r.total, 0);
});

test('prune: a junção sai assim que um retrato dela muda, sem esperar os 15 min', async t => {
  enabled.kick = true;
  t.after(() => void (enabled.kick = false));
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const key = 'kick|de|';
  await browse(['kick'], ['de'], [], 'desc', 0, 10);
  await sleep(5);
  await browse(['kick'], ['de'], [], 'desc', 0, 10);
  assert.ok(!prune(now).includes(key));
  // o retrato vence e é montado de novo: a junção que segurava a geração anterior sai no prune seguinte
  now += 61e3;
  await browse(['kick'], ['de'], [], 'desc', 0, 10);
  await sleep(5);
  assert.ok(prune(now).includes(key));
});

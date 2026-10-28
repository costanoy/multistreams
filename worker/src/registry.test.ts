import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import type { StoredStatus, Tracked } from './registry.js';
import type { Live, Status } from './types.js';

// sem rede: Kick, Twitch e Supabase (PostgREST em memória) falsos; o YouTube fica desligado. O loadEnvFile não
// sobrescreve o que já existe.
for (const k of ['YOUTUBE_API_KEY', 'PUBLIC_URL', 'TWITCH_EVENTSUB_SECRET']) process.env[k] = '';
Object.assign(process.env, {
  KICK_CLIENT_ID: 'teste', KICK_CLIENT_SECRET: 'teste', TWITCH_CLIENT_ID: 'teste', TWITCH_CLIENT_SECRET: 'teste',
  SUPABASE_URL: 'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'teste', POLL_KICK: '3600', POLL_TWITCH: '3600',
  MAX_CHANNELS: '1000', NEW_CHANNELS_PER_IP: '120', NEW_CHANNELS_PER_IP_DAY: '300', NEW_CHANNELS_PER_WINDOW: '700',
});

type Row = Record<string, any>;
type Gate = Promise<void> & { open: () => void };
const gate = (): Gate => {
  let open = () => {};
  const p = new Promise<void>(r => (open = r));
  return Object.assign(p, { open });
};
const fake = {
  t: { channels: [], follows: [], profiles: [], push_tokens: [] } as Record<string, Row[]>,
  /** GETs por tabela */
  reads: {} as Record<string, number>,
  kickGate: null as Gate | null,
  followsGate: null as Gate | null,
  kickFail: false,
  streamsFail: false,
  /** user_id de cada Get Videos */
  videos: [] as string[],
  /** Twitch ao vivo: user_id → início da live (a Get Videos devolve o VOD dela, em andamento) */
  twitchLive: new Map<string, string>(),
};

function postgrest(url: URL, method: string, body: unknown): Response | Promise<Response> {
  const table = url.pathname.split('/').pop()!;
  const rows = fake.t[table];
  if (!rows) return Response.json({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }, { status: 404 });
  const q = url.searchParams;
  const match = (r: Row) =>
    [...q].every(([k, v]) => {
      if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) return true;
      const [op, ...rest] = v.split('.');
      const val = rest.join('.');
      const x = String(r[k] ?? '');
      if (op === 'eq') return x === val;
      if (op === 'gte') return Date.parse(x) >= Date.parse(val);
      if (op === 'lt') return Date.parse(x) < Date.parse(val);
      if (op === 'in') return val.slice(1, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(x);
      return true;
    });
  if (method === 'POST') {
    const list = [JSON.parse(String(body))].flat() as Row[];
    // como o Postgres: o upsert não mexe duas vezes na mesma linha (o lote inteiro falha)
    if (table === 'channels' && new Set(list.map(r => r.key)).size < list.length) {
      return Response.json({ code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' }, { status: 500 });
    }
    for (const r of list) {
      const old = rows.find(x => x.key === r.key);
      if (old) Object.assign(old, r);
      else rows.push({ ...r });
    }
    return new Response(null, { status: 201 });
  }
  if (method === 'DELETE') {
    const keep = rows.filter(r => !match(r));
    fake.t[table] = keep;
    return new Response(null, { status: 204, headers: { 'content-range': `*/${rows.length - keep.length}` } });
  }
  fake.reads[table] = (fake.reads[table] ?? 0) + 1;
  const order = (q.get('order') ?? '').split(',').filter(Boolean).map(o => o.split('.')[0]);
  const cols = (q.get('select') ?? '').split(',');
  const from = Number(q.get('offset') ?? 0);
  const out = rows
    .filter(match)
    .sort((a, b) => {
      for (const c of order) if (String(a[c]) !== String(b[c])) return String(a[c]) < String(b[c]) ? -1 : 1;
      return 0;
    })
    .slice(from, from + Number(q.get('limit') ?? 1000))
    .map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? null])));
  return table === 'follows' && fake.followsGate ? fake.followsGate.then(() => Response.json(out)) : Response.json(out);
}

globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.host === 'id.kick.com' || url.host === 'id.twitch.tv') return Response.json({ access_token: 'x', expires_in: 3600 });
  // a Kick responde todo canal pedido, offline
  if (url.host === 'api.kick.com') {
    await fake.kickGate;
    if (fake.kickFail) return Response.json({ message: 'fora do ar' }, { status: 503 });
    return Response.json({ data: url.searchParams.getAll('slug').map(slug => ({ slug, stream: { is_live: false } })) });
  }
  // Twitch: só os de twitchLive ao vivo; o resto tem um VOD de 3 h que começou em 25/10 às 10:00
  if (url.host === 'api.twitch.tv') {
    if (url.pathname.endsWith('/videos')) {
      const id = url.searchParams.get('user_id')!;
      fake.videos.push(id);
      const on = fake.twitchLive.get(id);
      return Response.json({ data: [on ? { created_at: on, duration: '30m0s' } : { created_at: '2026-10-25T10:00:00Z', duration: '3h0m0s' }] });
    }
    if (fake.streamsFail) return Response.json({ message: 'fora do ar' }, { status: 503 });
    const on = url.searchParams.getAll('user_id').filter(id => fake.twitchLive.has(id));
    return Response.json({
      data: on.map(id => ({ user_id: id, user_login: `u${id}`, user_name: `U${id}`, type: 'live', title: 'live', game_name: 'IRL', viewer_count: 9, started_at: fake.twitchLive.get(id), language: 'pt', thumbnail_url: '' })),
    });
  }
  if (url.host !== 'supabase.test') throw new Error(`rede de verdade: ${url}`);
  return postgrest(url, String(init.method ?? 'GET').toUpperCase(), init.body);
}) as typeof fetch;

// relógio adiantável (os orçamentos e o prazo contam pelo Date.now)
let skew = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + skew;

/** Espera a condição, até 3 s. */
async function until(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  for (const end = realNow() + ms; !(await cond()); await new Promise(r => setTimeout(r, 10))) {
    if (realNow() > end) throw new Error('a condição não aconteceu a tempo');
  }
}

const { Budget, MAX_KEYS, applyTo, ip48, ipKey, mergeSaved, nextStatus, parseKey, pickKeys, publicStatus, shouldNotify, statusFor } = await import('./registry.js');
/** Outra instância do registro (mesmo config, banco e plataformas), com o estado zerado. */
const fresh = (tag: string): Promise<typeof import('./registry.js')> => import(`./registry.js?${tag}`);

const M = 60e3;
const H = 3600e3;
const D = 24 * H;
const T0 = Date.parse('2026-10-28T12:00:00Z');
const iso = (t: number) => new Date(t).toISOString();
const live = (o: Partial<Live> = {}): Live => ({ viewers: 10, title: 'live', cat: 'Just Chatting', thumb: null, lang: 'pt', startedAt: iso(T0 - M), url: 'https://www.twitch.tv/x', ...o });
const off = (o: Partial<StoredStatus> = {}): StoredStatus => ({
  live: false, viewers: 0, title: '', cat: '', thumb: null, lang: 'pt', startedAt: null, lastLiveAt: null, url: null, checkedAt: iso(T0 - M), ...o,
});
const on = (o: Partial<StoredStatus> = {}): StoredStatus => off({ live: true, viewers: 10, title: 'live', startedAt: iso(T0 - H), url: 'https://www.twitch.tv/x', ...o });

test('parseKey aceita só o formato de cada plataforma', () => {
  assert.deepEqual(parseKey('twitch:12345'), { platform: 'twitch', channelId: '12345' });
  assert.deepEqual(parseKey(`youtube:UC${'a_-B'.repeat(5)}xy`), { platform: 'youtube', channelId: `UC${'a_-B'.repeat(5)}xy` });
  assert.deepEqual(parseKey('kick:adin-ross_2'), { platform: 'kick', channelId: 'adin-ross_2' });
  const bad = [
    'kickx', ':123', 'twitch', 'twitch:', 'twitch:abc', `twitch:${'1'.repeat(21)}`, 'twitch:12 34',
    'kick:Gaules', `kick:${'a'.repeat(26)}`, 'kick:a,b', 'kick:a"b', 'kick:a)b',
    `youtube:UC${'a'.repeat(22)}#1`, 'youtube:UCabc', `youtube:XX${'a'.repeat(22)}`,
    'facebook:123', '__proto__:1', 'constructor:1',
  ];
  for (const k of bad) assert.equal(parseKey(k), null, k);
});

test('pickKeys ignora o inválido, tira as repetidas e corta em MAX_KEYS', () => {
  assert.deepEqual(pickKeys(['twitch:1', 'twitch:1', 42, null, { k: 1 }, 'kick:x y', 'kick:ok']), { keys: ['twitch:1', 'kick:ok'], truncated: false });
  const many = Array.from({ length: MAX_KEYS + 1 }, (_, i) => `twitch:${i + 1}`);
  const cut = pickKeys(many);
  assert.equal(cut.keys.length, MAX_KEYS);
  assert.equal(cut.truncated, true);
  assert.equal(pickKeys([...many.slice(0, MAX_KEYS), 'twitch:1', 'lixo']).truncated, false);
});

test('ipKey: o IPv4 inteiro, o IPv6 pelo /64 (e ip48 dá a rede inteira)', () => {
  assert.equal(ipKey(' 203.0.113.9 '), '203.0.113.9');
  assert.equal(ipKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:0db8:0001:0002:ffff::1'), '2001:db8:1:2::/64');
  assert.equal(ipKey('[2001:db8::1]'), '2001:db8:0:0::/64');
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
  assert.equal(ipKey(''), '');
  assert.equal(ip48(ipKey('2001:db8:1:2::1')), '2001:db8:1::/48');
  assert.equal(ip48(ipKey('2001:db8:1:3::1')), '2001:db8:1::/48');
  assert.equal(ip48(ipKey('203.0.113.9')), null);
});

test('Budget gasta até o tamanho na janela e recomeça na seguinte', () => {
  const b = new Budget(5, 1000);
  assert.equal(b.take('a', 3, 0), 3);
  assert.equal(b.left('a', 10), 2);
  assert.equal(b.take('a', 3, 10), 2);
  assert.equal(b.take('a', 1, 999), 0);
  assert.equal(b.take('b', 5, 999), 5);
  assert.equal(b.left('a', 1000), 5);
  assert.equal(b.take('a', 4, 1000), 4);
});

test('Budget com chaves demais tira as janelas mais antigas', () => {
  const b = new Budget(1, 1000, 2);
  b.take('a', 1, 0);
  b.take('b', 1, 1);
  b.take('c', 1, 2);
  assert.equal(b.take('a', 1, 3), 1);
  assert.equal(b.take('c', 1, 3), 0);
});

test('primeira observação ao vivo não avisa', () => {
  const r = nextStatus(null, live(), null, T0);
  assert.equal(r.notify, false);
  assert.equal(r.status.live, true);
  assert.equal(r.changed, true);
});

test('live nova depois de mais de 10 min offline avisa e guarda qual live foi avisada', () => {
  const r = nextStatus(off({ lastLiveAt: iso(T0 - 2 * H) }), live(), null, T0);
  assert.equal(r.notify, true);
  assert.equal(r.status.notifiedAt, iso(T0));
  assert.equal(r.status.notifiedStart, iso(T0 - M));
  assert.equal(shouldNotify(off(), live(), T0), true);
});

test('carência: a live que volta poucos minutos depois de cair não avisa de novo', () => {
  const prev = off({ lastLiveAt: iso(T0 - 4 * M), notifiedAt: iso(T0 - 3 * H), notifiedStart: iso(T0 - 3 * H) });
  assert.equal(shouldNotify(prev, live({ startedAt: iso(T0 - M) }), T0), false);
  // sem início informado, conta o agora
  assert.equal(shouldNotify(prev, live({ startedAt: null }), T0), false);
});

test('a mesma live nunca é avisada duas vezes', () => {
  // o fim da live anterior (9 h atrás) é antes do início avisado: só o notifiedStart impede o aviso
  const prev = off({ lastLiveAt: iso(T0 - 9 * H), notifiedStart: iso(T0 - 3 * H) });
  assert.equal(shouldNotify(prev, live({ startedAt: iso(T0 - 3 * H) }), T0), false);
  assert.equal(shouldNotify({ ...prev, notifiedStart: null }, live({ startedAt: iso(T0 - 3 * H) }), T0), true);
});

test('estreia aparece ao vivo, mas não avisa', () => {
  const r = nextStatus(off({ lastLiveAt: iso(T0 - 2 * H) }), live({ premiere: true }), null, T0);
  assert.equal(r.notify, false);
  assert.equal(r.status.live, true);
  assert.equal(r.status.premiere, true);
});

test('estreia seguida de live avisa (a estreia conta como offline)', () => {
  // rodadas de 3 min: a estreia que começou 11:55 aparece às 11:57; a live de verdade começa às 12:00
  const s1 = nextStatus(off({ lastLiveAt: iso(T0 - 26 * H) }), live({ premiere: true, startedAt: iso(T0 - 5 * M) }), null, T0 - 3 * M);
  assert.equal(s1.notify, false);
  const s2 = nextStatus(s1.status, live({ startedAt: iso(T0) }), null, T0 + 10e3);
  assert.equal(s2.notify, true);
  assert.equal(nextStatus(s2.status, live({ startedAt: iso(T0) }), null, T0 + 3 * M).notify, false);
  // a live começa com a estreia ainda no ar (o YouTube escolhe a live de verdade)
  assert.equal(shouldNotify(s1.status, live({ startedAt: iso(T0 - M) }), T0), true);
  // a mesma estreia, ou outra, não avisa
  assert.equal(shouldNotify(s1.status, live({ premiere: true, startedAt: iso(T0) }), T0), false);
  // a live caiu há 4 min e volta com uma estreia no meio: vale a carência
  const queda = nextStatus(off({ lastLiveAt: iso(T0 - 4 * M), notifiedAt: iso(T0 - 2 * H), notifiedStart: iso(T0 - 2 * H) }), live({ premiere: true, startedAt: iso(T0 - 3 * M) }), null, T0 - M);
  assert.equal(shouldNotify(queda.status, live({ startedAt: iso(T0) }), T0), false);
});

test('status nunca confirmado não avisa na primeira confirmação', () => {
  assert.equal(shouldNotify(off({ stale: true }), live(), T0), false);
});

test('seguia ao vivo com outro início: só avisa se a nova começou bem depois da última confirmação', () => {
  // ficou sem confirmação por 2 h (feed fora) e voltou numa live que começou há 30 min
  assert.equal(shouldNotify(on({ checkedAt: iso(T0 - 2 * H), startedAt: iso(T0 - 5 * H) }), live({ startedAt: iso(T0 - 30 * M) }), T0), true);
  // reconexão entre duas rodadas
  assert.equal(shouldNotify(on({ checkedAt: iso(T0 - 2 * M), startedAt: iso(T0 - 5 * H) }), live({ startedAt: iso(T0 - M) }), T0), false);
  // a mesma live, de volta depois do status velho: nada muda
  assert.equal(shouldNotify(on({ checkedAt: iso(T0 - 2 * H), startedAt: iso(T0 - 5 * H) }), live({ startedAt: iso(T0 - 5 * H) }), T0), false);
});

test('fim da live: lastLiveAt é o fim informado desta live, senão agora', () => {
  const prev = on({ startedAt: iso(T0 - 2 * H) });
  assert.equal(nextStatus(prev, undefined, iso(T0 - 5 * M), T0).status.lastLiveAt, iso(T0 - 5 * M));
  assert.equal(nextStatus(prev, undefined, null, T0).status.lastLiveAt, iso(T0));
  // fim de uma live anterior (antes do início desta): vale agora
  assert.equal(nextStatus(prev, undefined, iso(T0 - 3 * H), T0).status.lastLiveAt, iso(T0));
  // fim no futuro não vale
  assert.equal(nextStatus(prev, undefined, iso(T0 + H), T0).status.lastLiveAt, iso(T0));
  // estreia que acabou não conta como live
  assert.equal(nextStatus(on({ premiere: true, lastLiveAt: iso(T0 - 9 * H) }), undefined, null, T0).status.lastLiveAt, iso(T0 - 9 * H));
});

test('offline com o fim de uma live mais nova atualiza o lastLiveAt; mais velha, não', () => {
  const prev = off({ lastLiveAt: iso(T0 - 3 * H) });
  assert.equal(nextStatus(prev, undefined, iso(T0 - H), T0).status.lastLiveAt, iso(T0 - H));
  assert.equal(nextStatus(prev, undefined, iso(T0 - 5 * H), T0).status.lastLiveAt, iso(T0 - 3 * H));
  assert.equal(nextStatus(prev, undefined, iso(T0 - 5 * H), T0).changed, false);
});

test('o controle do aviso continua salvo depois que a live acaba', () => {
  const r = nextStatus(on({ notifiedAt: iso(T0 - H), notifiedStart: iso(T0 - H) }), undefined, null, T0);
  assert.equal(r.status.live, false);
  assert.equal(r.status.notifiedStart, iso(T0 - H));
});

test('a marca da Get Videos segue nos status seguintes', () => {
  assert.equal(nextStatus(off({ lastChecked: true }), live(), null, T0).status.lastChecked, true);
  assert.equal(nextStatus(off({ lastChecked: true }), undefined, null, T0).status.lastChecked, true);
  assert.equal(nextStatus(off(), undefined, null, T0).status.lastChecked, undefined);
});

test('canal novo sem resposta vira offline marcado como velho', () => {
  const r = nextStatus(null, undefined, null, T0, false);
  assert.equal(r.status.live, false);
  assert.equal(r.status.stale, true);
  assert.equal(nextStatus(r.status, undefined, null, T0 + M).changed, true);
});

test('ordem por carimbo: o resultado de uma consulta mais velha não sobrescreve um mais novo', () => {
  const t: Tracked = { platform: 'twitch', channelId: '1', status: null, wantedAt: 0, wantedSaved: 0, observedAt: 0, misses: 0 };
  assert.ok(applyTo(t, live(), null, 2000, T0));
  assert.equal(applyTo(t, undefined, null, 1000, T0 + 1), null);
  assert.equal(t.status?.live, true);
  assert.ok(applyTo(t, undefined, null, 3000, T0 + 2));
  assert.equal(t.status?.live, false);
});

test('publicStatus tira os campos internos e mostra o status velho de quem estava ao vivo como offline', () => {
  const s = on({ notifiedAt: iso(T0), notifiedStart: iso(T0), premiere: true, lastChecked: true, checkedAt: iso(T0 - 20 * M) });
  const pub = publicStatus(s, false);
  assert.deepEqual(Object.keys(pub).sort(), Object.keys(off()).sort());
  assert.equal(pub.live, true);
  const old = publicStatus(s, true);
  assert.equal(old.live, false);
  assert.equal(old.viewers, 0);
  assert.equal(old.stale, true);
  assert.equal(old.lastLiveAt, s.checkedAt);
  assert.ok(!('lastChecked' in old));
  assert.equal(publicStatus(off({ stale: true }), true).stale, true);
});

test('mergeSaved: o status da 1ª consulta fica com a última live, a língua e o controle do aviso do salvo', () => {
  const cur = off({ lang: null, checkedAt: iso(T0) });
  const saved = off({ lang: 'es', lastLiveAt: iso(T0 - 3 * D), notifiedAt: iso(T0 - 4 * D), notifiedStart: iso(T0 - 4 * D), lastChecked: true, checkedAt: iso(T0 - D) });
  assert.deepEqual(mergeSaved(cur, saved), { ...cur, lang: 'es', lastLiveAt: iso(T0 - 3 * D), notifiedAt: iso(T0 - 4 * D), notifiedStart: iso(T0 - 4 * D), lastChecked: true });
  // fica a mais nova; e o que a consulta já trouxe (língua, aviso) vale
  const now = off({ lang: 'pt', lastLiveAt: iso(T0 - H), notifiedAt: iso(T0 - H), notifiedStart: iso(T0 - 2 * H) });
  assert.deepEqual(mergeSaved(now, saved), { ...now, lastChecked: true });
  // salvo ao vivo e agora offline: a live acabou depois da última confirmação salva
  assert.equal(mergeSaved(cur, on({ checkedAt: iso(T0 - 20 * M) })).lastLiveAt, iso(T0 - 20 * M));
  // ao vivo nos dois (a mesma live): fica o fim da live anterior; estreia salva não conta como live
  assert.equal(mergeSaved(on({ lastLiveAt: null }), on({ lastLiveAt: iso(T0 - 9 * H) })).lastLiveAt, iso(T0 - 9 * H));
  assert.equal(mergeSaved(cur, on({ premiere: true, lastLiveAt: iso(T0 - 9 * H) })).lastLiveAt, iso(T0 - 9 * H));
});

// ---- /status: orçamentos de canais novos ----

const keys = (p: string, n = 100) => Array.from({ length: n }, (_, i) => `kick:${p}${i}`);
const got = async (r: typeof import('./registry.js'), k: string[], ip: string) => Object.keys(await r.statusFor(k, ip)).length;
/** stale do /status (campo opcional, fora do tipo Status) */
const staleOf = (s: Status | undefined) => (s as (Status & { stale?: boolean }) | undefined)?.stale;

test('statusFor: até 100 canais novos por pedido, dentro do orçamento de 10 min do IP', async () => {
  const all = Array.from({ length: 300 }, (_, i) => `kick:canal${i}`);
  // plataforma desligada e chave inválida: ignoradas, sem recusar o pedido
  const r1 = await statusFor([`youtube:UC${'a'.repeat(22)}`, 'kick:INVALIDO', ...all], 'ip-a');
  assert.equal(Object.keys(r1).length, 100);
  assert.deepEqual(Object.keys(r1).slice(0, 2), ['kick:canal0', 'kick:canal1']);
  assert.equal(r1['kick:canal0'].live, false);
  assert.ok(!('stale' in r1['kick:canal0']) && !('notifiedAt' in r1['kick:canal0']));
  // o IP só tinha 120 no orçamento
  assert.equal(Object.keys(await statusFor(all, 'ip-a')).length, 120);
  // outro IP: mais 100 por pedido
  assert.equal(Object.keys(await statusFor(all, 'ip-b')).length, 220);
});

test('statusFor: teto de 700 novos a cada 10 min somando os IPs, e cada orçamento gasta só o que todos dão', async () => {
  const R = await fresh('global');
  assert.equal(await got(R, keys('g0a'), 'ip-1'), 100);
  // o IP só tem mais 20: o global gasta 20, não 100
  assert.equal(await got(R, keys('g0b'), 'ip-1'), 20);
  for (let i = 2; i <= 6; i++) assert.equal(await got(R, keys(`g${i}`), `ip-${i}`), 100);
  assert.equal(await got(R, keys('g7'), 'ip-7'), 80);
  assert.equal(await got(R, keys('g8'), 'ip-8'), 0);
});

test('statusFor: no IPv6, o /48 inteiro tem 5 vezes o orçamento do IP, além do de cada /64', async () => {
  const R = await fresh('rede');
  const ip = (n: number, net = 'aa') => ipKey(`2001:db8:${net}:${n.toString(16)}::1`);
  for (let i = 1; i <= 6; i++) assert.equal(await got(R, keys(`r${i}`, 90), ip(i)), 90);
  assert.equal(await got(R, keys('r7', 90), ip(7)), 60);
  assert.equal(await got(R, keys('r8', 90), ip(8)), 0);
  // outro /48: o global (700) gastou só os 600 que entraram
  assert.equal(await got(R, keys('s1'), ip(1, 'bb')), 100);
  assert.equal(await got(R, keys('s2'), ip(2, 'bb')), 0);
});

test('statusFor: teto de 300 novos por IP a cada 24 h', async () => {
  const R = await fresh('dia');
  try {
    assert.equal(await got(R, keys('d1'), 'ip-d'), 100);
    assert.equal(await got(R, keys('d2'), 'ip-d'), 20);
    skew += 10 * M;
    assert.equal(await got(R, keys('d3'), 'ip-d'), 100);
    assert.equal(await got(R, keys('d4'), 'ip-d'), 20);
    skew += 10 * M;
    assert.equal(await got(R, keys('d5'), 'ip-d'), 60);
    skew += 10 * M;
    assert.equal(await got(R, keys('d6'), 'ip-d'), 0);
    assert.equal(await got(R, keys('d7'), 'ip-e'), 100);
    skew += D;
    assert.equal(await got(R, keys('d8'), 'ip-d'), 100);
  } finally {
    skew = 0;
  }
});

test('statusFor: no teto do registro, canal novo fica sem status e o que já está nele continua respondido', async () => {
  const R = await fresh('teto');
  try {
    for (let i = 0; i < 7; i++) assert.equal(await got(R, keys(`t${i}`), `ip-t${i}`), 100);
    skew += 10 * M;
    for (let i = 7; i < 10; i++) assert.equal(await got(R, keys(`t${i}`), `ip-t${i}`), 100);
    assert.equal(await got(R, keys('t10'), 'ip-t10'), 0);
    assert.equal(await got(R, keys('t0'), 'ip-t10'), 100);
  } finally {
    skew = 0;
  }
});

test('canal que a plataforma nunca confirmou: o /status não renova o prazo dele', async () => {
  const R = await fresh('nunca');
  const t0 = Date.now();
  fake.kickFail = true;
  try {
    // 3 rodadas sem resposta: offline, marcado como velho
    assert.deepEqual(await R.statusFor(['kick:sumido'], 'ip-n'), {});
    await R.poll('kick');
    await R.poll('kick');
  } finally {
    fake.kickFail = false;
  }
  assert.equal(staleOf((await R.statusFor(['kick:sumido'], 'ip-n'))['kick:sumido']), true);
  try {
    skew += 30 * M;
    await R.statusFor(['kick:sumido', 'kick:visto'], 'ip-n');
    await R.stop();
  } finally {
    skew = 0;
  }
  const wanted = (k: string) => Date.parse(fake.t.channels.find(r => r.key === k)?.wanted_at);
  assert.ok(wanted('kick:sumido') < t0 + M);
  assert.ok(wanted('kick:visto') >= t0 + 30 * M);
});

// ---- partida: carga do banco, status salvo e fila da Twitch ----

let P: typeof import('./registry.js') | undefined;
let T = 0;
after(() => P?.stop());
const at = iso;
const dbStatus = (k: string) => fake.t.channels.find(r => r.key === k)?.status as StoredStatus | undefined;
const saved = (key: string, status: StoredStatus, wanted: number) => ({ key, live: status.live, status, wanted_at: at(wanted) });

test('partida: com a carga do banco lenta, o /status responde só o que conhece e não registra canal novo', async () => {
  P = await fresh('partida');
  T = Date.now();
  fake.t.channels = [
    saved('kick:salvo', off({ lang: 'es', lastLiveAt: at(T - 3 * D), notifiedAt: at(T - 4 * D), notifiedStart: at(T - 4 * D), checkedAt: at(T - D) }), T - H),
    saved('kick:velho', off({ lastLiveAt: at(T - 3 * D), checkedAt: at(T - 3 * D) }), T - H),
    saved('kick:nunca', off({ lang: null, stale: true, checkedAt: at(T - 2 * H) }), T - 2 * H),
    saved('twitch:111', off({ lang: null, checkedAt: at(T - H) }), T - H),
    saved('twitch:222', off({ lang: null, checkedAt: at(T - H), lastChecked: true }), T - H),
    // sem a marca, mas entrou ao vivo durante o reinício
    saved('twitch:444', off({ lang: null, checkedAt: at(T - H) }), T - H),
  ];
  // kick:salvo também é seguido: o put passa duas vezes por ele
  fake.t.follows = [{ user_id: '0aaaaaaa-0000-4000-8000-000000000001', channel_key: 'kick:salvo', created_at: at(T - D) }];
  fake.videos = [];
  fake.twitchLive = new Map([['444', at(T - 30 * M)]]);
  // o app pede antes de a carga chegar e a consulta espera a Kick; a carga lê channels e espera follows
  const kick = (fake.kickGate = gate());
  const first = P!.statusFor(['kick:salvo'], 'ip-p');
  const follows = (fake.followsGate = gate());
  const reads = fake.reads.channels ?? 0;
  const started = P!.start();
  await until(() => (fake.reads.channels ?? 0) >= reads + 2);
  // a 1ª consulta termina e grava por cima do banco, sem a última live
  kick.open();
  assert.equal((await first)['kick:salvo'].lastLiveAt, null);
  assert.equal(dbStatus('kick:salvo')?.lastLiveAt, null);
  // a 1ª rodada da Kick vai esperar; o pedido seguinte passa da espera com a carga ainda no meio
  fake.kickGate = gate();
  mock.timers.enable({ apis: ['setTimeout'] });
  const pending = P!.statusFor(['kick:novo', 'kick:salvo'], 'ip-p');
  mock.timers.tick(20e3);
  mock.timers.reset();
  assert.deepEqual(Object.keys(await pending), ['kick:salvo']);
  follows.open();
  fake.followsGate = null;
  await started;
});

test('partida: o put junta o status salvo ao da consulta que chegou antes e grava de volta', async () => {
  const s = (await P!.statusFor(['kick:salvo'], 'ip-p'))['kick:salvo'];
  assert.equal(s.lastLiveAt, at(T - 3 * D));
  assert.equal(s.lang, 'es');
  await until(() => dbStatus('kick:salvo')?.lastLiveAt === at(T - 3 * D));
  assert.equal(dbStatus('kick:salvo')?.notifiedStart, at(T - 4 * D));
});

test('partida: o offline do banco só fica velho pela idade depois da 1ª rodada da plataforma', async () => {
  assert.ok(!('stale' in (await P!.statusFor(['kick:velho'], 'ip-p'))['kick:velho']));
  // a 1ª rodada falha: agora sim, sem confirmação há 3 dias
  fake.kickFail = true;
  try {
    fake.kickGate!.open();
    await until(async () => staleOf((await P!.statusFor(['kick:velho'], 'ip-p'))['kick:velho']) === true);
  } finally {
    fake.kickFail = false;
  }
  // a carga terminou: o canal novo entra no registro
  assert.equal((await P!.statusFor(['kick:novo'], 'ip-p'))['kick:novo'].live, false);
});

test('partida: o canal nunca confirmado sem pedido há mais de 1 h sai do registro e do banco', async () => {
  await until(() => !fake.t.channels.some(r => r.key === 'kick:nunca'));
});

test('partida: quem ficou sem a Get Videos da Twitch volta para a fila, e a marca não sai no /status', async () => {
  await until(() => dbStatus('twitch:111')?.lastChecked === true);
  // a fila só recebe quem a rodada confirmou offline: o VOD da live em andamento não vira a última live nem cala o aviso
  assert.equal(dbStatus('twitch:444')?.live, true);
  assert.equal(dbStatus('twitch:444')?.notifiedStart, at(T - 30 * M));
  assert.deepEqual(fake.videos, ['111']);
  assert.equal(dbStatus('twitch:111')?.lastLiveAt, '2026-10-25T13:00:00Z');
  const s = (await P!.statusFor(['twitch:111', 'twitch:222'], 'ip-p'));
  assert.equal(s['twitch:111'].lastLiveAt, '2026-10-25T13:00:00Z');
  assert.ok(!('lastChecked' in s['twitch:111']) && !('lastChecked' in s['twitch:222']));
});

test('Twitch: canal confirmado depois de 3 rodadas sem resposta também ganha a Get Videos', async () => {
  fake.streamsFail = true;
  try {
    assert.deepEqual(await P!.statusFor(['twitch:333'], 'ip-p'), {});
    await P!.poll('twitch', ['twitch:333']);
    await P!.poll('twitch', ['twitch:333']);
    assert.equal(staleOf((await P!.statusFor(['twitch:333'], 'ip-p'))['twitch:333']), true);
  } finally {
    fake.streamsFail = false;
  }
  await P!.poll('twitch', ['twitch:333']);
  await until(async () => (await P!.statusFor(['twitch:333'], 'ip-p'))['twitch:333'].lastLiveAt === '2026-10-25T13:00:00Z');
  assert.deepEqual(fake.videos, ['111', '333']);
});

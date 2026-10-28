import assert from 'node:assert/strict';
import { test } from 'node:test';

// Supabase falso: follows em memória, servida em páginas de 2 linhas; a tabela kv não existe.
// O loadEnvFile não sobrescreve o que já existe.
Object.assign(process.env, { SUPABASE_URL: 'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'teste', FOLLOWS_PER_ACCOUNT: '3' });
type Follow = { user_id: string; channel_key: string; created_at: string };
const follows: Follow[] = [];
/** created_at em µs, como o Postgres compara (o Date.parse corta nos ms) */
const us = (s: string) => Date.parse(s) * 1000 + Number(/\.\d{3}(\d{1,3})/.exec(s)?.[1].padEnd(3, '0') ?? 0);
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const table = url.pathname.split('/').pop();
  if (table !== 'follows') return Response.json({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }, { status: 404 });
  const q = url.searchParams;
  const since = q.get('created_at')?.replace(/^gte\./, '');
  const order = (q.get('order') ?? '').split(',').map(o => o.split('.')[0] as keyof Follow);
  const val = (r: Follow, c: keyof Follow) => (c === 'created_at' ? us(r[c]) : r[c]);
  const rows = follows.filter(r => !since || us(r.created_at) >= us(since)).sort((a, b) => {
    for (const c of order) if (val(a, c) !== val(b, c)) return val(a, c) < val(b, c) ? -1 : 1;
    return 0;
  });
  const from = Number(q.get('offset') ?? 0);
  return Response.json(rows.slice(from, from + 2));
}) as typeof fetch;

const { followedKeys, isExpoToken, loadKv, missing, readAll, readReceipts, readTickets, saveKv } = await import('./db.js');

test('readAll avança pelo que veio e só para na página vazia', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => i);
  const calls: [number, number][] = [];
  // o servidor devolve no máximo 700 por resposta, menos que a página pedida
  const got = await readAll<number>(async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + 700)), error: null };
  });
  assert.deepEqual(got, rows);
  assert.deepEqual(calls.slice(0, 2), [[0, 999], [700, 1699]]);
  assert.equal(calls.at(-1)![0], 2500);
});

test('readAll lança o erro do banco', async () => {
  await assert.rejects(readAll(async () => ({ data: null, error: { message: 'boom', code: 'XX000' } })), { message: 'boom' });
});

test('missing reconhece a tabela ou a coluna que a migração ainda não criou', () => {
  assert.ok(missing({ code: '42703', message: 'column channels.wanted_at does not exist' }, 'wanted_at'));
  assert.ok(missing({ code: 'PGRST204', message: "Could not find the 'wanted_at' column of 'channels' in the schema cache" }, 'wanted_at'));
  assert.ok(missing({ code: 'PGRST205', message: "Could not find the table 'public.kv' in the schema cache" }, 'kv'));
  assert.ok(missing({ code: '42P01', message: 'relation "public.kv" does not exist' }, 'kv'));
  assert.ok(!missing({ code: '23505', message: 'duplicate key value violates unique constraint "kv_pkey"' }, 'kv'));
  assert.ok(!missing(null, 'kv'));
});

test('sem a tabela kv, loadKv devolve null e saveKv não faz nada', async () => {
  assert.equal(await loadKv('youtube-quota'), null);
  await saveKv('youtube-quota', { day: '2026-10-28' });
});

const T = Date.parse('2026-10-28T10:00:00Z');
const M = 60e3;
/** created_at como o PostgREST devolve (µs e fuso) */
const created = (t: number, micro = 0) => new Date(t).toISOString().replace('Z', `${String(micro).padStart(3, '0')}+00:00`);
const A = '0aaaaaaa-0000-4000-8000-000000000001';
const B = '0bbbbbbb-0000-4000-8000-000000000002';
const C = '0ccccccc-0000-4000-8000-000000000003';
const sorted = (r: { keys: string[] }) => [...r.keys].sort();
const quiet = async <T>(fn: () => Promise<T>): Promise<{ r: T; warned: string[] }> => {
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.join(' '));
  try {
    return { r: await fn(), warned };
  } finally {
    console.warn = warn;
  }
};

test('followedKeys: cada conta entra com até 3 canais e a que passa não tira o lugar da outra', async () => {
  // A segue 5 canais; B segue 2 (um deles também de A, gravado por último)
  for (let i = 1; i <= 5; i++) follows.push({ user_id: A, channel_key: `kick:a${i}`, created_at: created(T - 60 * M) });
  follows.push({ user_id: B, channel_key: 'kick:b1', created_at: created(T - 120 * M) }, { user_id: B, channel_key: 'kick:a1', created_at: created(T, 500) });
  const { r, warned } = await quiet(() => followedKeys());
  assert.deepEqual(sorted(r), ['kick:a1', 'kick:a2', 'kick:a3', 'kick:b1']);
  assert.equal(r.latest, new Date(T).toISOString());
  assert.deepEqual(warned, ['[db] follows: 1 contas passam de 3 canais; 2 linhas ficaram de fora do polling']);
});

test('followedKeys(since): as novas somam à conta da leitura completa, sem contar duas vezes o que é relido', async () => {
  // no mesmo ms da borda (relida pelo gte), C grava depois da leitura; B chega ao teto; A já tinha passado
  follows.push(
    { user_id: C, channel_key: 'kick:c1', created_at: created(T, 900) },
    { user_id: A, channel_key: 'kick:a6', created_at: created(T + M) },
    { user_id: B, channel_key: 'kick:b2', created_at: created(T + M) },
    { user_id: B, channel_key: 'kick:b3', created_at: created(T + M, 1) },
  );
  const r1 = await followedKeys(new Date(T).toISOString());
  // kick:a1 (de B, na borda) volta sem contar: senão B já estaria no teto e kick:b2 ficaria de fora
  assert.deepEqual(sorted(r1), ['kick:a1', 'kick:b2', 'kick:c1']);
  assert.equal(r1.latest, new Date(T + M).toISOString());
  follows.push({ user_id: C, channel_key: 'kick:c2', created_at: created(T + 2 * M) });
  const r2 = await followedKeys(r1.latest!);
  assert.deepEqual(sorted(r2), ['kick:b2', 'kick:c2']);
  // um since de antes da última leitura (esperou a vez) não conta de novo o que ela já contou
  follows.push({ user_id: C, channel_key: 'kick:c3', created_at: created(T + 3 * M) }, { user_id: C, channel_key: 'kick:c4', created_at: created(T + 3 * M, 1) });
  const [r3, r4] = await Promise.all([followedKeys(r1.latest!), followedKeys(r1.latest!)]);
  assert.deepEqual(sorted(r3), ['kick:c2', 'kick:c3']);
  assert.deepEqual(sorted(r4), ['kick:c3']);
});

test('followedKeys: a leitura completa recomeça a conta de cada conta', async () => {
  follows.splice(follows.findIndex(f => f.channel_key === 'kick:a1' && f.user_id === A), 1);
  const { r, warned } = await quiet(() => followedKeys());
  // A: a2, a3, a4 · B: a1, b1, b2 · C: c1, c2, c3 (em ordem de channel_key)
  assert.deepEqual(sorted(r), ['kick:a1', 'kick:a2', 'kick:a3', 'kick:a4', 'kick:b1', 'kick:b2', 'kick:c1', 'kick:c2', 'kick:c3']);
  assert.deepEqual(warned, ['[db] follows: 3 contas passam de 3 canais; 4 linhas ficaram de fora do polling']);
});

test('isExpoToken aceita só tokens do Expo bem formados', () => {
  assert.ok(isExpoToken('ExponentPushToken[abcDEF123-_]'));
  assert.ok(isExpoToken('ExpoPushToken[xyz]'));
  for (const t of ['', 'ExponentPushToken[]', 'ExponentPushToken[a,b]', 'ExponentPushToken[a"b]', 'abc', 42, null]) assert.ok(!isExpoToken(t), String(t));
});

test('readTickets separa recibos, tokens mortos e os outros erros', () => {
  const r = readTickets(['t1', 't2', 't3', 't4'], [
    { status: 'ok', id: 'r1' },
    { status: 'error', message: 'não registrado', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', message: 'grande', details: { error: 'MessageTooBig' } },
  ]);
  assert.deepEqual(r.receipts, [['r1', 't1']]);
  assert.deepEqual(r.dead, ['t2']);
  assert.deepEqual(r.errors, ['MessageTooBig grande', 'sem ticket']);
});

test('readReceipts: token morto sai, credencial errada vai à parte e recibo que não veio espera até 1 h', () => {
  const now = 10 * 3600e3;
  const sent: [string, { token: string; at: number }][] = [
    ['a', { token: 'ta', at: now - 20 * 60e3 }],
    ['b', { token: 'tb', at: now - 20 * 60e3 }],
    ['c', { token: 'tc', at: now - 20 * 60e3 }],
    ['d', { token: 'td', at: now - 20 * 60e3 }],
    ['e', { token: 'te', at: now - 2 * 3600e3 }],
  ];
  const r = readReceipts(sent, {
    a: { status: 'ok' },
    b: { status: 'error', details: { error: 'DeviceNotRegistered' } },
    c: { status: 'error', message: 'chave do FCM', details: { error: 'InvalidCredentials' } },
  }, now);
  assert.deepEqual(r.done, ['a', 'b', 'c', 'e']);
  assert.deepEqual(r.dead, ['tb']);
  assert.deepEqual(r.credentials, ['InvalidCredentials chave do FCM']);
});

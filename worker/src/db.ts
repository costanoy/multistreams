import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config, enabled } from './config.js';
import { Status, chunk } from './types.js';

const db: SupabaseClient | null = enabled.supabase
  ? createClient(config.supabase.url, config.supabase.key, { auth: { persistSession: false } })
  : null;

interface DbError {
  message: string;
  code?: string;
}

const warned = new Set<string>();
const warnOnce = (k: string, msg: string) => {
  if (warned.has(k)) return;
  warned.add(k);
  console.warn(msg);
};

/** Erro de tabela ou coluna que a migração ainda não criou (o PostgREST e o Postgres usam códigos diferentes). */
export const missing = (e: DbError | null | undefined, name: string) =>
  !!e && ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(e.code ?? '') && (e.message ?? '').includes(name);

type Page<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError | null }>;

/**
 * O PostgREST corta cada resposta em 1000 linhas (ou menos, conforme o painel): lê página a página,
 * avançando pelo que veio, até uma página vazia, e entrega cada uma a `each` sem guardar as linhas.
 * A consulta precisa estar ordenada por coluna única.
 */
export async function eachPage<T>(page: Page<T>, each: (rows: T[]) => void, size = 1000): Promise<void> {
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    if (!data?.length) return;
    each(data);
    from += data.length;
  }
}

/** Todas as linhas da consulta, página a página (veja eachPage). */
export async function readAll<T>(page: Page<T>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  await eachPage(page, rows => out.push(...rows), size);
  return out;
}

/** null = ainda não sabe (o worker funciona antes e depois da migração 20261028) */
let wantedAtColumn: boolean | null = null;
/** A coluna channels.wanted_at existe: o prazo dos canais sobrevive aos reinícios. */
export const hasWantedAt = () => wantedAtColumn === true;
const noWantedAt = () => {
  wantedAtColumn = false;
  warnOnce('wanted_at', '[db] falta a coluna channels.wanted_at (rode supabase/migrations/20261028_endurecimento.sql): o prazo dos canais recomeça a cada reinício');
};

type ChannelRow = { key: string; status: Status | null; wanted_at?: string };

export async function loadChannels(): Promise<{ key: string; status: Status | null; wantedAt: number | null }[]> {
  const sb = db;
  if (!sb) return [];
  try {
    const rows = await readAll<ChannelRow>((from, to) => sb.from('channels').select('key,status,wanted_at').order('key').range(from, to));
    wantedAtColumn = true;
    return rows.map(r => ({ key: r.key, status: r.status, wantedAt: Date.parse(r.wanted_at ?? '') || null }));
  } catch (e) {
    if (!missing(e as DbError, 'wanted_at')) throw e;
    noWantedAt();
    const rows = await readAll<ChannelRow>((from, to) => sb.from('channels').select('key,status').order('key').range(from, to));
    return rows.map(r => ({ key: r.key, status: r.status, wantedAt: null }));
  }
}

/** Linhas de follows por conta: as da última leitura completa mais as novas lidas depois (o teto vale nas duas). */
let perAccount = new Map<string, number>();
/** Linhas aceitas no ms do created_at mais novo já lido: a leitura das novas (gte) as lê de novo e não conta duas vezes. */
let edge = { at: 0, rows: new Set<string>() };
/** Uma leitura de follows por vez: a conta por conta depende da ordem. */
let followsTurn: Promise<unknown> = Promise.resolve();

/**
 * Canais que algum usuário logado segue: continuam sendo consultados mesmo com o app fechado (push).
 * Com `since`, só os seguidos a partir daquele instante (created_at), para uma importação entrar logo.
 * latest = o created_at mais novo que veio (para o próximo `since`). Cada conta entra com até followsPerAccount
 * canais (uma conta só não enche o registro); o resto fica de fora. Lê página a página, sem guardar as linhas.
 */
export function followedKeys(since?: string): Promise<{ keys: string[]; latest: string | null }> {
  const run = followsTurn.then(() => readFollows(since));
  followsTurn = run.catch(() => {});
  return run;
}

async function readFollows(since?: string): Promise<{ keys: string[]; latest: string | null }> {
  const sb = db;
  if (!sb) return { keys: [], latest: null };
  const cap = config.limits.followsPerAccount;
  // since de antes de uma leitura mais nova (esperou a vez): as linhas até ela já foram contadas
  const after = since && edge.at > Date.parse(since) ? new Date(edge.at).toISOString() : since;
  const keys = new Set<string>();
  /** linhas contadas nesta leitura, por conta (a das novas soma à da última completa) */
  const added = new Map<string, number>();
  const over = new Set<string>();
  let cut = 0;
  let latest = 0;
  let top = new Set<string>();
  await eachPage<{ user_id: string; channel_key: string; created_at: string }>(
    (from, to) => {
      const q = sb.from('follows').select('user_id,channel_key,created_at');
      return (after ? q.gte('created_at', after).order('created_at') : q).order('user_id').order('channel_key').range(from, to);
    },
    rows => {
      for (const r of rows) {
        const at = Date.parse(r.created_at) || 0;
        const id = `${r.user_id} ${r.channel_key}`;
        // a borda do since volta em toda leitura das novas: já foi contada (e aceita)
        let ok = !!after && at === edge.at && edge.rows.has(id);
        if (!ok) {
          const n = added.get(r.user_id) ?? 0;
          added.set(r.user_id, n + 1);
          ok = n + (after ? perAccount.get(r.user_id) ?? 0 : 0) < cap;
          if (!ok) {
            over.add(r.user_id);
            cut++;
          }
        }
        if (ok) keys.add(r.channel_key);
        if (at > latest) {
          latest = at;
          top = new Set<string>();
        }
        if (ok && at === latest) top.add(id);
      }
    },
  );
  if (after) for (const [u, n] of added) perAccount.set(u, (perAccount.get(u) ?? 0) + n);
  else perAccount = added;
  if (latest || !after) edge = { at: latest, rows: top };
  if (!after && over.size) console.warn(`[db] follows: ${over.size} contas passam de ${cap} canais; ${cut} linhas ficaram de fora do polling`);
  return { keys: [...keys], latest: latest ? new Date(latest).toISOString() : null };
}

export async function saveChannels(rows: { key: string; status: Status }[]): Promise<void> {
  if (!db || !rows.length) return;
  for (const part of chunk(rows, 1000)) {
    const { error } = await db.from('channels').upsert(
      part.map(r => ({ key: r.key, live: r.status.live, status: r.status, updated_at: new Date().toISOString() })),
    );
    if (error) console.warn('[db] channels', error.message);
  }
}

/** Grava o último pedido de cada canal, em lote (o upsert só mexe nas colunas enviadas). false = não gravou. */
export async function saveWanted(rows: { key: string; wantedAt: number }[]): Promise<boolean> {
  if (!db) return true;
  for (const part of chunk(rows, 1000)) {
    const { error } = await db.from('channels').upsert(part.map(r => ({ key: r.key, wanted_at: new Date(r.wantedAt).toISOString() })));
    if (error) {
      if (missing(error, 'wanted_at')) noWantedAt();
      else console.warn('[db] channels (prazo)', error.message);
      return false;
    }
  }
  if (rows.length) wantedAtColumn = true;
  return true;
}

/** Apaga os canais que nenhum app pede desde `cutoff` (só depois de gravar o prazo de todos). */
export async function removeOlderThan(cutoff: string): Promise<void> {
  if (!db || !hasWantedAt()) return;
  const { error, count } = await db.from('channels').delete({ count: 'exact' }).lt('wanted_at', cutoff);
  if (error) console.warn('[db] channels (limpeza)', error.message);
  else if (count) console.log(`[db] ${count} canais sem pedido apagados`);
}

/** Sem a coluna wanted_at: apaga as chaves que saíram do registro, em lotes (só chaves já validadas). */
export async function removeChannels(keys: string[]): Promise<void> {
  if (!db || !keys.length) return;
  for (const part of chunk(keys.filter(k => /^[a-z]+:[\w-]+$/.test(k)), 100)) {
    const { error } = await db.from('channels').delete().in('key', part);
    if (error) return console.warn('[db] channels (remoção)', error.message);
  }
}

// ---- estado pequeno do worker (tabela kv) ----

/** Sem a tabela (migração não aplicada), para de tentar por 10 min. */
let kvOffUntil = 0;
function kvError(e: DbError) {
  if (!missing(e, 'kv')) return console.warn('[db] kv:', e.message);
  kvOffUntil = Date.now() + 10 * 60e3;
  warnOnce('kv', '[db] falta a tabela kv (rode supabase/migrations/20261028_endurecimento.sql): o estado do worker zera a cada reinício');
}

/**
 * null: sem linha, sem Supabase ou sem a tabela. undefined: a leitura falhou (rede, 5xx), e quem chama não deve
 * tratar isso como "sem linha" nem gravar por cima do que está salvo.
 */
export async function loadKv<T>(key: string): Promise<T | null | undefined> {
  if (!db || Date.now() < kvOffUntil) return null;
  try {
    const { data, error } = await db.from('kv').select('value').eq('key', key).maybeSingle();
    if (!error) return (data?.value ?? null) as T | null;
    kvError(error);
    if (missing(error, 'kv')) return null;
  } catch (e) {
    console.warn('[db] kv:', (e as Error).message);
  }
  return undefined;
}

export async function saveKv(key: string, value: unknown): Promise<void> {
  if (!db || value == null || Date.now() < kvOffUntil) return;
  try {
    const { error } = await db.from('kv').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) kvError(error);
  } catch (e) {
    console.warn('[db] kv:', (e as Error).message);
  }
}

// ---- push ----

const EXPO = 'https://exp.host/--/api/v2/push';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Token do Expo bem formado: um token estranho faria o Expo recusar o lote inteiro. */
export const isExpoToken = (t: unknown): t is string => typeof t === 'string' && t.length < 256 && /^Expo(nent)?PushToken\[[^\]\s",()]+\]$/.test(t);

/** POST no Expo. 429, 5xx e falha de rede tentam de novo (4 s, depois 8 s); o resto lança com o status. */
async function expo(path: 'send' | 'getReceipts', body: unknown): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    let why = '';
    let again = true;
    try {
      const res = await fetch(`${EXPO}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const data: any = await res.json().catch(() => null);
      if (res.ok && !data?.errors) return data;
      why = `${res.status} ${JSON.stringify(data?.errors ?? data ?? '').slice(0, 300)}`;
      again = res.status === 429 || res.status >= 500;
    } catch (e) {
      why = (e as Error).message;
    }
    if (!again || attempt === 3) throw new Error(why);
    await sleep(attempt * 4000);
  }
}

/** Tickets de um envio: recibos para conferir depois, tokens que o Expo já deu como mortos e os outros erros. */
export function readTickets(tokens: string[], tickets: unknown): { receipts: [string, string][]; dead: string[]; errors: string[] } {
  const list: any[] = Array.isArray(tickets) ? tickets : [];
  const out = { receipts: [] as [string, string][], dead: [] as string[], errors: [] as string[] };
  tokens.forEach((token, i) => {
    const t = list[i];
    if (t?.status === 'ok') {
      if (typeof t.id === 'string') out.receipts.push([t.id, token]);
    } else if (t?.details?.error === 'DeviceNotRegistered') out.dead.push(token);
    else out.errors.push(t ? `${t.details?.error ?? ''} ${t.message ?? ''}`.trim() : 'sem ticket');
  });
  return out;
}

/** Recibos que voltaram: o que já pode sair da lista, os tokens mortos e os erros (sem recibo ainda: espera até 1 h). */
export function readReceipts(sent: [string, { token: string; at: number }][], data: any, now: number) {
  const out = { done: [] as string[], dead: [] as string[], credentials: [] as string[], errors: [] as string[] };
  for (const [id, { token, at }] of sent) {
    const rec = data?.[id];
    if (!rec && now - at < 3600e3) continue;
    out.done.push(id);
    if (rec?.status !== 'error') continue;
    const err = rec.details?.error ?? '';
    if (err === 'DeviceNotRegistered') out.dead.push(token);
    else if (err === 'InvalidCredentials' || err === 'MismatchSenderId') out.credentials.push(`${err} ${rec.message ?? ''}`.trim());
    else out.errors.push(`${err} ${rec.message ?? ''}`.trim());
  }
  return out;
}

async function dropTokens(tokens: string[]): Promise<void> {
  if (!db || !tokens.length) return;
  for (const part of chunk(tokens.filter(isExpoToken), 100)) {
    const { error } = await db.from('push_tokens').delete().in('token', part);
    if (error) return console.warn('[push] tokens mortos:', error.message);
  }
}

/** Recibos a conferir ~15 min depois do envio (id → token). Só em memória: um reinício perde os pendentes. */
const receipts = new Map<string, { token: string; at: number }>();
const RECEIPT_AFTER = 15 * 60e3;
let receiptTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReceipts() {
  if (receiptTimer || !receipts.size) return;
  const oldest = receipts.values().next().value!.at;
  receiptTimer = setTimeout(() => void checkReceipts(), Math.max(60e3, oldest + RECEIPT_AFTER - Date.now())).unref();
}

async function checkReceipts(): Promise<void> {
  const now = Date.now();
  const due = [...receipts].filter(([, r]) => now - r.at >= RECEIPT_AFTER);
  const dead: string[] = [];
  for (const part of chunk(due, 1000)) {
    try {
      const r = readReceipts(part, (await expo('getReceipts', { ids: part.map(([id]) => id) }))?.data, now);
      r.done.forEach(id => receipts.delete(id));
      dead.push(...r.dead);
      // credencial errada: nenhum aviso chega a ninguém naquele sistema
      for (const c of r.credentials) console.error(`[push] ${c}: confira a credencial do FCM/APNs no Expo`);
      if (r.errors.length) console.warn(`[push] ${r.errors.length} recibos com erro:`, r.errors.slice(0, 3).join(' | '));
    } catch (e) {
      console.warn('[push] recibos:', (e as Error).message);
    }
  }
  await dropTokens(dead);
  receiptTimer = null;
  scheduleReceipts();
}

/** Expo Notifications: avisa quem segue o canal com aviso ligado. */
export async function notifyLive(key: string, name: string, title: string, platformLabel: string, url: string): Promise<void> {
  const sb = db;
  if (!sb) return;
  const tokens: string[] = [];
  let display = name;
  try {
    const follows = await readAll<{ user_id: string; name: string }>((from, to) =>
      sb.from('follows').select('user_id,name').eq('channel_key', key).eq('notify', true).order('user_id').range(from, to),
    );
    if (!follows.length) return;
    display ||= follows[0].name;
    // os ids vão na URL: de 100 em 100 para ela não passar do limite
    const users = follows.map(f => f.user_id);
    const muted = new Set<string>();
    for (const part of chunk(users, 100)) {
      const { data, error } = await sb.from('profiles').select('id').in('id', part).eq('notify_all', false);
      // sem saber quem desligou os avisos, não manda para ninguém
      if (error) throw error;
      for (const p of data ?? []) muted.add(p.id as string);
    }
    for (const part of chunk(users.filter(u => !muted.has(u)), 100)) {
      const rows = await readAll<{ token: string }>((from, to) => sb.from('push_tokens').select('token').in('user_id', part).order('token').range(from, to));
      for (const r of rows) if (isExpoToken(r.token)) tokens.push(r.token);
    }
  } catch (e) {
    console.warn('[push] seguidores de', key, (e as DbError).message);
    return;
  }
  if (!tokens.length) return;
  const messages = tokens.map(to => ({
    to,
    title: `${display} está ao vivo`,
    body: title ? `${title} · ${platformLabel}` : platformLabel,
    data: { url, key },
    // som próprio do app (client/assets/sounds/notification.wav, embutido no build)
    sound: 'notification.wav',
    channelId: 'live',
  }));
  const dead: string[] = [];
  for (const part of chunk(messages, 100)) {
    try {
      const r = readTickets(part.map(m => m.to), (await expo('send', part))?.data);
      dead.push(...r.dead);
      const now = Date.now();
      for (const [id, token] of r.receipts) receipts.set(id, { token, at: now });
      if (r.errors.length) console.warn(`[push] ${key}: ${r.errors.length} de ${part.length} avisos recusados:`, r.errors.slice(0, 3).join(' | '));
    } catch (e) {
      console.warn('[push] envio:', (e as Error).message);
    }
  }
  // teto de memória: os recibos mais velhos saem primeiro
  for (const id of receipts.keys()) {
    if (receipts.size <= 20000) break;
    receipts.delete(id);
  }
  scheduleReceipts();
  await dropTokens(dead);
}

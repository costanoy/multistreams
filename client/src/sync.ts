import type { SupabaseClient } from '@supabase/supabase-js';
import type { Streamer } from './store';
import type { Plat, SkinKey } from './theme';

// Sincronização da lista com a conta, sem React nem armazenamento: account.ts guarda a base e a fila e decide quando rodar.

/** Preferências que a conta guarda (tabela profiles). */
export interface Prefs {
  langs: string[];
  skin: SkinKey;
  notifyAll: boolean;
}

/** Linha de follows como o Supabase devolve. */
export interface Remote {
  channel_key: string;
  platform: string;
  channel_id: string;
  login: string;
  name: string;
  avatar: string | null;
  lang: string;
  notify: boolean;
  created_at?: string;
}

/** O que a conta tinha na última sincronização confirmada. Separa o que foi removido aqui do que foi removido em outro aparelho. */
export interface Base {
  follows: Record<string, { notify: boolean; lang: string }>;
  prefs: Prefs | null;
}

/** Mudanças locais que a conta ainda não confirmou. Por canal vale a última; null = apagar. */
export interface Queue {
  follows: Record<string, Streamer | null>;
  prefs: Prefs | null;
}

export const emptyBase = (): Base => ({ follows: {}, prefs: null });
export const emptyQueue = (): Queue => ({ follows: {}, prefs: null });
export const pending = (q: Queue) => !!q.prefs || Object.keys(q.follows).length > 0;

export const toStreamer = (r: Remote): Streamer => ({
  id: r.channel_key, plat: r.platform as Plat, channelId: r.channel_id, login: r.login, name: r.name, avatar: r.avatar, lang: r.lang, notify: r.notify,
});

export const row = (userId: string, s: Streamer) => ({
  user_id: userId, channel_key: s.id, platform: s.plat, channel_id: s.channelId, login: s.login, name: s.name, avatar: s.avatar, lang: s.lang, notify: s.notify,
});

const sameRow = (a: Streamer, b: Streamer) =>
  a.id === b.id && a.plat === b.plat && a.channelId === b.channelId && a.login === b.login && a.name === b.name && a.avatar === b.avatar && a.lang === b.lang && a.notify === b.notify;

const langsKey = (l: string[]) => [...l].sort().join(',');
const samePref = <K extends keyof Prefs>(k: K, a: Prefs, b: Prefs) => (k === 'langs' ? langsKey(a.langs) === langsKey(b.langs) : a[k] === b[k]);
const samePrefs = (a: Prefs, b: Prefs) => samePref('langs', a, b) && samePref('skin', a, b) && samePref('notifyAll', a, b);

export interface Merged {
  streams: Streamer[];
  prefs: Prefs;
  /** o que a conta tem agora (antes de subir a fila) */
  base: Base;
  /** o que falta subir */
  queue: Queue;
}

/**
 * Junta o aparelho com a conta.
 * - 'merge': compara os dois lados com a base. O que mudou só de um lado vale; mudou dos dois, vale o daqui (é o que a fila mandaria).
 *   Remoção vence edição. Sem base (primeira vez neste aparelho), une as listas e, no que existe dos dois lados, vale a conta.
 * - 'replace': outra conta usou o aparelho por último. Começa pela lista da conta, mais as mudanças dela que ficaram na fila.
 *   `other` é a base e a fila da outra conta: o canal daqui que não é dela (fora das duas, ou tirado na fila) entrou
 *   depois que ela saiu, e fica e sobe. Sem elas, nada daqui sobe.
 */
export function mergeLists(mode: 'merge' | 'replace', local: Streamer[], localPrefs: Prefs, base: Base | null, remote: Remote[], remotePrefs: Prefs | null, waiting: Queue, other: { base: Base; queue: Queue } | null = null): Merged {
  const queue = emptyQueue();
  const next: Base = { follows: {}, prefs: remotePrefs };
  // a conta na ordem em que os canais entraram nela
  const ordered = [...remote].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  const rem = new Map(ordered.map(r => [r.channel_key, toStreamer(r)]));
  for (const r of rem.values()) next.follows[r.id] = { notify: r.notify, lang: r.lang };

  if (mode === 'replace') {
    const list = new Map(rem);
    for (const [id, x] of Object.entries(waiting.follows)) {
      if (x) list.set(id, x);
      else list.delete(id);
      queue.follows[id] = x;
    }
    // adicionado aqui depois que a outra conta saiu: não é dela, então não some. A fila dela vale mais que a base:
    // null lá é um canal que ela tirou (e a remoção não subiu); se ele está aqui, voltou depois que ela saiu
    if (other) {
      for (const l of local) {
        const hers = other.queue.follows[l.id] !== undefined ? other.queue.follows[l.id] : other.base.follows[l.id];
        if (list.has(l.id) || hers) continue;
        list.set(l.id, l);
        queue.follows[l.id] = l;
      }
    }
    const prefs = waiting.prefs ?? remotePrefs ?? localPrefs;
    if (waiting.prefs || !remotePrefs) queue.prefs = prefs;
    return { streams: [...list.values()], prefs, base: next, queue };
  }

  const was = base?.follows ?? {};
  const streams: Streamer[] = [];
  for (const l of local) {
    const r = rem.get(l.id);
    if (!r) {
      if (was[l.id]) continue; // removido em outro aparelho
      streams.push(l); // novo aqui: sobe
      queue.follows[l.id] = l;
      continue;
    }
    const b = was[l.id];
    // campo que mudou aqui desde a base vale o daqui; senão, o da conta
    const notify = b && l.notify !== b.notify ? l.notify : r.notify;
    const lang = b && l.lang !== b.lang ? l.lang : r.lang;
    const m = { ...r, notify, lang };
    streams.push(sameRow(m, l) ? l : m);
    if (!sameRow(m, r)) queue.follows[l.id] = m;
  }
  const here = new Set(local.map(s => s.id));
  for (const r of rem.values()) {
    if (here.has(r.id)) continue;
    if (was[r.id]) queue.follows[r.id] = null; // removido aqui: apaga na conta
    else streams.push(r); // novo na conta: desce
  }

  let prefs = localPrefs;
  if (!remotePrefs) queue.prefs = localPrefs; // a conta ainda não tem perfil
  else {
    const bp = base?.prefs;
    // mudou aqui desde a base, ou é igual dos dois lados: fica o daqui; senão, o da conta
    const pick = <K extends keyof Prefs>(k: K): Prefs[K] =>
      (bp && !samePref(k, localPrefs, bp)) || samePref(k, localPrefs, remotePrefs) ? localPrefs[k] : remotePrefs[k];
    prefs = { langs: pick('langs'), skin: pick('skin'), notifyAll: pick('notifyAll') };
    if (samePrefs(prefs, localPrefs)) prefs = localPrefs;
    if (!samePrefs(prefs, remotePrefs)) queue.prefs = prefs;
  }
  return { streams, prefs, base: next, queue };
}

/** Anota na fila o que mudou entre dois estados do store. Devolve se mudou algo que vai para a conta. */
export function track(q: Queue, prev: Prefs & { streams: Streamer[] }, next: Prefs & { streams: Streamer[] }): boolean {
  let changed = false;
  if (next.streams !== prev.streams) {
    const before = new Map(prev.streams.map(x => [x.id, x]));
    for (const x of next.streams) {
      if (before.get(x.id) !== x) {
        q.follows[x.id] = x;
        changed = true;
      }
    }
    const now = new Set(next.streams.map(x => x.id));
    for (const x of prev.streams) {
      if (!now.has(x.id)) {
        q.follows[x.id] = null;
        changed = true;
      }
    }
  }
  // línguas por valor: a releitura de outra aba traz um array novo com o mesmo conteúdo, e isso não é mudança
  if (langsKey(next.langs) !== langsKey(prev.langs) || next.skin !== prev.skin || next.notifyAll !== prev.notifyAll) {
    q.prefs = { langs: next.langs, skin: next.skin, notifyAll: next.notifyAll };
    changed = true;
  }
  return changed;
}

// ---- idas ao Supabase ----

/** 'auth': renovar a sessão e tentar de novo; 'retry': tentar mais tarde. */
export type Step = 'ok' | 'retry' | 'auth';

/** O que fazer com um erro do PostgREST: rede (status 0), 408, 429 e 5xx repetem; 401 renova a sessão; o resto (RLS, validação) descarta. */
export const verdict = (status: number): Step | 'drop' =>
  status === 401 ? 'auth' : status === 0 || status === 408 || status === 429 || status >= 500 ? 'retry' : 'drop';

// erros que dependem da linha (formato, restrição, tamanho): vale dividir o lote para salvar o resto
const perRow = (status: number) => status === 400 || status === 409 || status === 413 || status === 422;

export class SyncError extends Error {
  constructor(public step: Step, message: string) {
    super(message);
  }
}

interface Reply<T> {
  data: T | null;
  error: { message: string } | null;
  status: number;
}

/** Desiste em 20 s: no Android um pedido pode ficar pendurado e travar a fila. */
async function send<T>(go: (signal: AbortSignal) => PromiseLike<Reply<T>>): Promise<Reply<T>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    return await go(abort.signal);
  } finally {
    clearTimeout(timer);
  }
}

const bearer = (token: string) => `Bearer ${token}`;
const COLS = 'channel_key,platform,channel_id,login,name,avatar,lang,notify,created_at';

/**
 * Lê da conta os seguidos e o perfil. O token vai explícito: sem ele o cliente cairia na chave anônima,
 * e a RLS devolveria uma lista vazia que pareceria "tudo removido". Pagina até uma página vazia
 * (o PostgREST corta em 1.000 linhas, ou no Max rows do painel). Qualquer falha lança SyncError: nada é aplicado pela metade.
 */
export async function readAccount(db: SupabaseClient, userId: string, token: string) {
  const follows: Remote[] = [];
  for (;;) {
    const from = follows.length;
    const r = await send<Remote[]>(signal =>
      db.from('follows').select(COLS).eq('user_id', userId).order('channel_key').range(from, from + 999).abortSignal(signal).setHeader('Authorization', bearer(token)),
    );
    if (r.error) throw new SyncError(stepOf(r.status), `follows: ${r.error.message}`);
    if (!r.data?.length) break;
    follows.push(...r.data);
  }
  const p = await send<{ langs: string[] | null; skin: string | null; notify_all: boolean | null }>(signal =>
    db.from('profiles').select('langs,skin,notify_all').eq('id', userId).abortSignal(signal).maybeSingle().setHeader('Authorization', bearer(token)),
  );
  if (p.error) throw new SyncError(stepOf(p.status), `profiles: ${p.error.message}`);
  return { follows, profile: p.data };
}

// leitura que falhou com 4xx (tabela ou coluna errada) é configuração: tenta de novo mais tarde, sem descartar nada
const stepOf = (status: number): Step => {
  const v = verdict(status);
  return v === 'drop' ? 'retry' : v;
};

const chunk = <T>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/**
 * Sobe a fila. Só sai dela (e entra na base) o que a conta confirmou; se o canal mudou de novo no caminho, a versão nova fica.
 * Do que a conta já tinha (está na base) só sobem os campos que mudaram aqui: os outros podem ter mudado em outro aparelho.
 * Erro de RLS ou validação descarta o item com log; num lote, divide ao meio até achar o culpado.
 * `saved` é chamado depois de cada confirmação, para guardar base e fila.
 */
export async function pushQueue(db: SupabaseClient, userId: string, token: string, q: Queue, base: Base, saved: () => void): Promise<Step> {
  const auth = bearer(token);

  const upsert = async (rows: Streamer[]): Promise<Step> => {
    const r = await send<{ channel_key: string }[]>(signal => db.from('follows').upsert(rows.map(x => row(userId, x))).select('channel_key').abortSignal(signal).setHeader('Authorization', auth));
    if (!r.error) {
      // com 3.000 seguidos, a conta ignora sem erro o canal novo (gatilho follows_cap): ele não volta na resposta e fica
      // fora da base (senão a próxima fusão o tiraria daqui como removido em outro aparelho); a fusão o manda de novo
      const got = new Set((r.data ?? []).map(d => d.channel_key));
      let over = 0;
      for (const x of rows) {
        if (got.has(x.id)) base.follows[x.id] = { notify: x.notify, lang: x.lang };
        else over++;
        if (q.follows[x.id] === x) delete q.follows[x.id];
      }
      if (over) console.warn('[sync] follows:', over, 'canais além do teto da conta ficaram só neste aparelho');
      saved();
      return 'ok';
    }
    const v = verdict(r.status);
    if (v !== 'drop') return v;
    if (rows.length > 1 && perRow(r.status)) {
      const half = rows.length >> 1;
      const a = await upsert(rows.slice(0, half));
      return a === 'ok' ? upsert(rows.slice(half)) : a;
    }
    console.warn('[sync] follows', rows.length === 1 ? rows[0].id : `${rows.length} canais`, r.error.message);
    for (const x of rows) if (q.follows[x.id] === x) delete q.follows[x.id];
    saved();
    return 'ok';
  };

  const remove = async (keys: string[]): Promise<Step> => {
    const r = await send<null>(signal => db.from('follows').delete().eq('user_id', userId).in('channel_key', keys).abortSignal(signal).setHeader('Authorization', auth));
    if (!r.error) {
      for (const k of keys) {
        delete base.follows[k];
        if (q.follows[k] === null) delete q.follows[k];
      }
      saved();
      return 'ok';
    }
    const v = verdict(r.status);
    if (v !== 'drop') return v;
    if (keys.length > 1 && perRow(r.status)) {
      const half = keys.length >> 1;
      const a = await remove(keys.slice(0, half));
      return a === 'ok' ? remove(keys.slice(half)) : a;
    }
    console.warn('[sync] follows', keys.length === 1 ? keys[0] : `${keys.length} canais`, r.error.message);
    for (const k of keys) if (q.follows[k] === null) delete q.follows[k];
    saved();
    return 'ok';
  };

  // canal que a conta já tinha: atualiza só a linha que existe. Sem linha, outro aparelho removeu o canal: ele sai
  // da fila e fica na base, e a próxima fusão o tira daqui (remoção vence edição; o upsert recriaria a linha)
  const update = async (x: Streamer): Promise<Step> => {
    const b = base.follows[x.id];
    const cols: Partial<Pick<Streamer, 'notify' | 'lang'>> = {};
    if (x.notify !== b.notify) cols.notify = x.notify;
    if (x.lang !== b.lang) cols.lang = x.lang;
    if (Object.keys(cols).length) {
      const r = await send<{ channel_key: string }[]>(signal =>
        db.from('follows').update(cols).eq('user_id', userId).eq('channel_key', x.id).select('channel_key').abortSignal(signal).setHeader('Authorization', auth),
      );
      if (r.error) {
        const v = verdict(r.status);
        if (v !== 'drop') return v;
        console.warn('[sync] follows', x.id, r.error.message);
      } else if (r.data?.length) base.follows[x.id] = { notify: x.notify, lang: x.lang };
    }
    if (q.follows[x.id] === x) delete q.follows[x.id];
    saved();
    return 'ok';
  };

  const entries = Object.entries(q.follows);
  const ups = entries.flatMap(([, x]) => (x ? [x] : []));
  const known = ups.filter(x => base.follows[x.id]);
  const fresh = ups.filter(x => !base.follows[x.id]);
  for (const x of known) {
    const s = await update(x);
    if (s !== 'ok') return s;
  }
  for (const part of chunk(fresh, 200)) {
    const s = await upsert(part);
    if (s !== 'ok') return s;
  }
  for (const part of chunk(entries.flatMap(([k, x]) => (x ? [] : [k])), 100)) {
    const s = await remove(part);
    if (s !== 'ok') return s;
  }
  const prefs = q.prefs;
  if (prefs) {
    // sem perfil na conta, cria com tudo; com perfil, só o que mudou aqui desde a base
    const bp = base.prefs;
    const cols: Record<string, unknown> = {};
    if (!bp || !samePref('langs', prefs, bp)) cols.langs = prefs.langs;
    if (!bp || prefs.skin !== bp.skin) cols.skin = prefs.skin;
    if (!bp || prefs.notifyAll !== bp.notifyAll) cols.notify_all = prefs.notifyAll;
    const r = Object.keys(cols).length
      ? await send<null>(signal => {
          const vals = { ...cols, updated_at: new Date().toISOString() };
          return (bp ? db.from('profiles').update(vals).eq('id', userId) : db.from('profiles').upsert({ id: userId, ...vals })).abortSignal(signal).setHeader('Authorization', auth);
        })
      : null;
    const v = r?.error ? verdict(r.status) : 'ok';
    if (v === 'retry' || v === 'auth') return v;
    if (r?.error) console.warn('[sync] profiles', r.error.message);
    // os campos que não subiram já eram iguais aos da base
    else base.prefs = prefs;
    if (q.prefs === prefs) q.prefs = null;
    saved();
  }
  return 'ok';
}

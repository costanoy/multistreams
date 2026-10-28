import { enabled } from './config.js';
import * as kick from './kick.js';
import * as twitch from './twitch.js';
import { BrowseItem, HttpError, LANG_CODES, Platform, catKey } from './types.js';
import * as youtube from './youtube.js';

/**
 * Lista "tudo ao vivo". Cada fonte vira um retrato (snapshot) em cache, um por plataforma e língua,
 * reaproveitado por todos os apps abertos e juntado no collect():
 * - Twitch: todas as lives da língua, varridas página a página (com muitas línguas, uma varredura só,
 *   sem filtro de língua, filtrada aqui);
 * - Kick: as 100 maiores da língua (a API v1 não pagina), mais as 100 maiores das categorias mais fortes
 *   ou das filtradas, um retrato por língua e categoria;
 * - YouTube: as ~50 maiores por língua (limitado pela cota).
 */
export interface Snap {
  /** quando os itens foram montados (0 = ainda não montou) */
  at: number;
  /** quando montar de novo */
  next: number;
  /** último pedido: retrato parado há IDLE sai da memória */
  usedAt: number;
  /** muda a cada troca de itens (a junção é refeita quando muda) */
  v: number;
  items: BrowseItem[];
  complete: boolean;
  building: boolean;
  /** falhas seguidas: a nova tentativa vem mais cedo */
  fails: number;
  /** quanto levou a última montagem que deu certo (a varredura inteira da Twitch leva minutos) */
  took: number;
  /** resolve na primeira página da montagem em andamento */
  ready: Promise<void>;
}

type Build = (onPage: (items: BrowseItem[]) => void) => Promise<unknown>;

const TTL: Record<Platform, number> = { twitch: 180e3, kick: 60e3, youtube: 180e3 };
/** retrato (e junção) não pedido há esse tempo sai da memória */
const IDLE = 15 * 60e3;
/** depois de uma falha, nova tentativa em 15 s, dobrando a cada falha seguida (até o TTL) */
const RETRY = 15e3;
/** primeiro pedido espera no máximo isso pela primeira página: depois volta parcial e o app pede de novo */
const FIRST_WAIT = 8000;
/** com mais línguas que isso, a Twitch é varrida uma vez só, sem filtro de língua */
const WIDE = 8;
/** essa varredura leva minutos: o retrato anterior vale por pelo menos 10 min enquanto ela refaz (ou tenta de novo) */
const WIDE_KEEP = 10 * 60e3;
const snaps = new Map<string, Snap>();
let version = 0;

const byViewers = (a: BrowseItem, b: BrowseItem) => b.viewers - a.viewers;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms).unref());

/** No máximo n tarefas ao mesmo tempo; as outras esperam na fila (as urgentes na frente). */
export class Gate {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private n: number) {}

  async run<T>(task: () => Promise<T>, urgent = false): Promise<T> {
    if (this.active < this.n) this.active++;
    // a vaga passa direto de quem termina para quem está na fila
    else await new Promise<void>(r => (urgent ? this.queue.unshift(r) : this.queue.push(r)));
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/**
 * Monta (ou devolve do cache) um retrato. Na primeira vez, espera a primeira página (até FIRST_WAIT).
 * Retrato vencido continua servindo enquanto o novo é montado; com mais de `keep` (2 TTLs, ou o TTL mais 2
 * montagens, quando ela é longa), é descartado antes (volta parcial, como no primeiro boot). Montagem que falha
 * mantém os itens anteriores e tenta de novo logo.
 */
export function snapshot(key: string, ttl: number, build: Build, gate?: Gate, keep = 2 * ttl): Promise<Snap> {
  const now = Date.now();
  let cur = snaps.get(key);
  if (!cur) {
    cur = { at: 0, next: 0, usedAt: now, v: ++version, items: [], complete: false, building: false, fails: 0, took: 0, ready: Promise.resolve() };
    snaps.set(key, cur);
  }
  cur.usedAt = now;
  if (!cur.building && now >= cur.next) start(key, cur, ttl, build, gate, keep);
  const s = cur;
  return s.at || s.items.length ? Promise.resolve(s) : Promise.race([s.ready, wait(FIRST_WAIT)]).then(() => s);
}

function start(key: string, cur: Snap, ttl: number, build: Build, gate: Gate | undefined, keep: number) {
  // na montagem longa, uma falha perto do fim não pode derrubar o retrato inteiro na nova tentativa
  if (cur.at && Date.now() - cur.at > Math.max(keep, ttl + 2 * cur.took)) Object.assign(cur, { at: 0, items: [], complete: false, v: ++version });
  cur.building = true;
  let firstPage!: () => void;
  cur.ready = new Promise<void>(r => (firstPage = r));
  // sem retrato anterior, mostra o que já chegou enquanto a varredura continua
  const fresh = !cur.at;
  const seen = new Set<string>();
  const acc: BrowseItem[] = [];
  const onPage = (items: BrowseItem[]) => {
    for (const i of items) {
      if (seen.has(i.key)) continue;
      seen.add(i.key);
      acc.push(i);
    }
    if (fresh) Object.assign(cur, { items: acc, v: ++version });
    firstPage();
  };
  let began = 0;
  const run = () => {
    began = Date.now();
    return build(onPage);
  };
  (gate ? gate.run(run, fresh) : run())
    .then(() => {
      const t = Date.now();
      Object.assign(cur, { at: t, next: t + ttl, items: acc.sort(byViewers), complete: true, fails: 0, took: t - began, v: ++version });
    })
    .catch(e => {
      console.warn(`[browse] ${key}:`, (e as Error).message);
      const t = Date.now();
      // 400 e parecidos não melhoram tentando de novo (ex.: língua que a plataforma não aceita): vale o que chegou
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status)) {
        Object.assign(cur, { at: t, next: t + ttl, items: acc.sort(byViewers), complete: true, fails: 0, v: ++version });
        return;
      }
      cur.fails++;
      cur.next = t + Math.min(ttl, RETRY * 2 ** (cur.fails - 1));
      cur.complete = false;
      // com retrato anterior (no máximo 2 TTLs), fica com ele como estava; sem, com o que chegou
      if (fresh) Object.assign(cur, { at: acc.length ? t : 0, items: acc.sort(byViewers), v: ++version });
    })
    .finally(() => {
      cur.building = false;
      firstPage();
    });
}

/** Junção das fontes: sem repetir canal, só nas línguas (e categorias) pedidas, por viewers. */
export function join(parts: BrowseItem[][], langs: Set<string>, want: Set<string>): BrowseItem[] {
  const seen = new Set<string>();
  const out: BrowseItem[] = [];
  for (const items of parts) {
    for (const i of items) {
      if (seen.has(i.key) || !langs.has(i.lang) || (want.size && !want.has(catKey(i.cat)))) continue;
      seen.add(i.key);
      out.push(i);
    }
  }
  return out.sort(byViewers);
}

/** Junção ordenada das fontes, guardada até alguma fonte mudar (e as categorias dela, quando pedidas). */
interface Merged {
  stamp: string;
  desc: BrowseItem[];
  usedAt: number;
  /** retratos usados: quando algum muda, a junção sai (ela segura os itens da geração anterior) */
  parts: Snap[];
  cats?: Category[];
}
const merged = new Map<string, Merged>();
const MERGED_MAX = 30;

/**
 * Tira da memória os retratos e junções que ninguém pede há IDLE (nunca um retrato em montagem) e as junções
 * de retratos que já mudaram. Devolve as chaves que saíram.
 */
export function prune(now: number): string[] {
  const gone: string[] = [];
  for (const [k, s] of snaps) {
    if (s.building || now - s.usedAt <= IDLE) continue;
    snaps.delete(k);
    gone.push(k);
  }
  for (const [k, m] of merged) {
    if (now - m.usedAt <= IDLE && m.parts.map(s => s.v).join(',') === m.stamp) continue;
    merged.delete(k);
    gone.push(k);
  }
  return gone;
}
let pruning: ReturnType<typeof setInterval> | null = null;

/** No máximo 2 varreduras da Twitch ao mesmo tempo (cada uma tem centenas de páginas). */
const sweeps = new Gate(2);
const kickCalls = new Gate(10);

const twitchSnap = (lang: string) =>
  lang
    ? snapshot(`twitch|${lang}`, TTL.twitch, onPage => twitch.crawlLive([lang], onPage), sweeps)
    : snapshot('twitch|*', TTL.twitch, onPage => twitch.crawlLive([], items => onPage(items.filter(i => LANG_CODES.has(i.lang)))), sweeps, WIDE_KEEP);

const youtubeSnap = (lang: string) => snapshot(`youtube|${lang}`, TTL.youtube, async onPage => onPage(await youtube.topLive(lang)));

const kickSnap = (lang: string, cat?: number) =>
  snapshot(cat ? `kick|${lang}|cat:${cat}` : `kick|${lang}`, TTL.kick, async onPage => onPage(await kick.topLive(lang, cat)), kickCalls);

/**
 * A lista geral da Kick deixa de fora lives grandes (vimos uma de 49 mil fora do "top 100" de
 * português). Por isso, além dela, busca as 100 maiores de cada uma das categorias mais fortes (ou das
 * filtradas). Língua com menos de 100 lives já veio inteira na lista geral.
 */
const KICK_TOP_CATS = 10;
const KICK_MAX_EXTRA = 60;
async function kickSnaps(langs: string[], cats: string[]): Promise<Snap[]> {
  const names = cats.slice(0, 10);
  const want = new Set(names.map(catKey));
  // categorias filtradas: as das lives e as que a busca da Kick acha pelo nome. As buscas saem todas de uma vez,
  // junto com as listas: com a Kick travada, o pedido espera um timeout só (e a falha fica guardada)
  const found = Promise.allSettled(names.map(n => kick.categoryIds(n)));
  const bases = await Promise.all(langs.map(l => kickSnap(l)));
  const picked = new Set<number>();
  if (want.size) {
    for (const b of bases) for (const i of b.items) if (i.catId && want.has(catKey(i.cat))) picked.add(i.catId);
    for (const r of await found) {
      if (r.status === 'fulfilled') r.value.forEach(id => picked.add(id));
      else console.warn('[kick] categorias:', (r.reason as Error).message);
    }
  }
  const extra: [string, number][] = [];
  langs.forEach((l, n) => {
    const base = bases[n];
    if (base.items.length < kick.TOP_LIMIT) return;
    if (want.size) {
      for (const id of [...picked].slice(0, 20)) extra.push([l, id]);
      return;
    }
    const weight = new Map<number, number>();
    for (const i of base.items) if (i.catId) weight.set(i.catId, (weight.get(i.catId) ?? 0) + i.viewers);
    for (const [id] of [...weight].sort((a, b) => b[1] - a[1]).slice(0, KICK_TOP_CATS)) extra.push([l, id]);
  });
  return [...bases, ...(await Promise.all(extra.slice(0, KICK_MAX_EXTRA).map(([l, id]) => kickSnap(l, id))))];
}

async function collect(platforms: Platform[], langs: string[], cats: string[]) {
  const now = Date.now();
  prune(now);
  pruning ??= setInterval(() => prune(Date.now()), 60e3).unref();
  const on = platforms.filter(p => enabled[p]).sort();
  const ls = [...new Set(langs)].sort();
  const groups = await Promise.all(
    on.map(p =>
      p === 'twitch' ? Promise.all(ls.length > WIDE ? [twitchSnap('')] : ls.map(twitchSnap))
      : p === 'youtube' ? Promise.all(ls.map(youtubeSnap))
      : kickSnaps(ls, cats),
    ),
  );
  const parts = groups.flat();
  const want = new Set(cats.map(catKey));
  const key = `${on.join()}|${ls.join()}|${[...want].sort().join('|')}`;
  const stamp = parts.map(s => s.v).join(',');
  let m = merged.get(key);
  if (m?.stamp !== stamp) m = { stamp, desc: join(parts.map(s => s.items), new Set(ls), want), usedAt: now, parts };
  m.usedAt = now;
  // a mais usada por último fica no fim: passou do teto, sai a do começo
  merged.delete(key);
  merged.set(key, m);
  if (merged.size > MERGED_MAX) merged.delete(merged.keys().next().value!);
  // fonte que falhou 2 vezes seguidas está fora do ar, não "ainda montando": o app não precisa reler a cada 8 s
  return { m, partial: parts.some(s => !s.complete && s.fails < 2) };
}

/** Foto do canal por chave: a Get Streams da Twitch e a busca do YouTube não trazem (a Kick já manda). */
const AVATAR_TTL = 24 * 3600e3;
const avatarCache = new Map<string, { url: string | null; at: number }>();
const AVATAR_LOOKUP: [Platform, (ids: string[]) => Promise<Map<string, string | null>>][] = [
  ['twitch', twitch.avatars],
  ['youtube', youtube.avatars],
];

/** Completa a foto das lives de uma página, consultando só os canais que ainda não estão no cache. */
async function withAvatars(items: BrowseItem[]): Promise<BrowseItem[]> {
  const now = Date.now();
  await Promise.all(AVATAR_LOOKUP.map(async ([p, lookup]) => {
    const stale = items.filter(i => i.platform === p && !i.avatar && now - (avatarCache.get(i.key)?.at ?? 0) >= AVATAR_TTL);
    const ids = [...new Set(stale.map(i => i.channelId))];
    if (!ids.length || !enabled[p]) return;
    try {
      const found = await lookup(ids);
      if (avatarCache.size > 50000) avatarCache.clear();
      for (const [id, url] of found) avatarCache.set(`${p}:${id}`, { url, at: now });
    } catch (e) {
      // sem foto a lista continua funcionando: tenta de novo no próximo pedido
      console.warn(`[${p}] fotos dos canais:`, (e as Error).message);
    }
  }));
  return items.map(i => (i.avatar ? i : { ...i, avatar: avatarCache.get(i.key)?.url ?? null }));
}

export async function browse(platforms: Platform[], langs: string[], cats: string[], sort: 'desc' | 'asc', offset: number, limit: number) {
  const { m, partial } = await collect(platforms, langs, cats);
  const desc = m.desc;
  const total = desc.length;
  const items =
    sort === 'desc' ? desc.slice(offset, offset + limit)
    : desc.slice(Math.max(0, total - offset - limit), Math.max(0, total - offset)).reverse();
  return { total, partial, items: await withAvatars(items) };
}

export interface Category {
  key: string;
  name: string;
  viewers: number;
  lives: number;
  platforms: Platform[];
}

/** Soma por categoria, das mais assistidas para as menos. */
function tally(desc: BrowseItem[]): Category[] {
  const map = new Map<string, Category & { best: number }>();
  for (const i of desc) {
    if (!i.cat) continue;
    const k = catKey(i.cat);
    if (!k) continue;
    let c = map.get(k);
    if (!c) map.set(k, (c = { key: k, name: i.cat, viewers: 0, lives: 0, platforms: [], best: i.viewers }));
    c.viewers += i.viewers;
    c.lives++;
    if (!c.platforms.includes(i.platform)) c.platforms.push(i.platform);
    // o nome que aparece é o da live mais assistida daquela categoria
    if (i.viewers > c.best) Object.assign(c, { name: i.cat, best: i.viewers });
  }
  return [...map.values()]
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, 500)
    .map(({ best: _, ...c }) => c);
}

/** Categorias de quem está ao vivo agora, das mais assistidas para as menos. */
export async function categories(platforms: Platform[], langs: string[]): Promise<{ partial: boolean; items: Category[] }> {
  const { m, partial } = await collect(platforms, langs, []);
  m.cats ??= tally(m.desc);
  return { partial, items: m.cats };
}

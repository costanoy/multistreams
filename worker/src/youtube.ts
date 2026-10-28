import { config } from './config.js';
import * as db from './db.js';
import { BrowseItem, CHANNEL_ID, Channel, FetchResult, HttpError, Live, chunk, getJson, langCode } from './types.js';

const API = 'https://www.googleapis.com/youtube/v3';
const DAY = 24 * 3600e3;

// ---- Cota ----

/**
 * Cota da Data API, no modelo de junho de 2026: o search.list tem balde próprio (100 chamadas por dia,
 * 1 por chamada) e os outros métodos dividem 10.000 unidades (videos.list, channels.list e
 * videoCategories.list custam 1 cada). Os dois baldes viram à meia-noite do Pacífico. A conta fica no
 * banco (kv 'youtube-quota') para não zerar a cada reinício.
 * - buscas: a descoberta do "tudo ao vivo" usa no máximo browseSearches; o resto é da busca por nome;
 * - unidades: o polling dos seguidos sempre passa; a lista "tudo ao vivo" usa no máximo browseUnits, e
 *   ela e as consultas do app (adicionar canal) param antes, deixando FOLLOW_SHARE para o polling.
 */
export interface QuotaDay {
  /** dia do Pacífico (AAAA-MM-DD) */
  day: string;
  units: number;
  browseUnits: number;
  searches: number;
  browseSearches: number;
}
export interface QuotaLimits {
  units: number;
  searches: number;
  browseSearches: number;
  browseUnits: number;
}
/** follow = polling dos seguidos · browse = lista "tudo ao vivo" · lookup = adicionar canal (resolve e busca) */
export type Use = 'follow' | 'browse' | 'lookup';
const FOLLOW_SHARE = 0.2;

/**
 * Lançada por search e resolve quando a cota do dia acabou (o worker responde 503 'quota'). `bucket` diz o que
 * acabou: 'searches' (as buscas do dia; colar o link do canal ainda funciona) ou 'units' (as unidades).
 */
export class QuotaError extends Error {
  constructor(message: string, public bucket: 'units' | 'searches' = 'units') {
    super(message);
  }
}

export const pacificDay = (now: number) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

/** A conta do dia: a mesma, ou zerada se o dia do Pacífico virou. */
export const rollDay = (s: QuotaDay | null, now: number): QuotaDay => {
  const day = pacificDay(now);
  return s?.day === day ? s : { day, units: 0, browseUnits: 0, searches: 0, browseSearches: 0 };
};

export function allowUnits(s: QuotaDay, lim: QuotaLimits, use: Use, n: number): boolean {
  if (use === 'follow') return true;
  if (s.units + n > lim.units * (1 - FOLLOW_SHARE)) return false;
  return use === 'lookup' || s.browseUnits + n <= lim.browseUnits;
}

export function allowSearch(s: QuotaDay, lim: QuotaLimits, use: 'browse' | 'lookup'): boolean {
  if (s.searches >= lim.searches) return false;
  const browse = Math.min(lim.browseSearches, lim.searches);
  return use === 'browse' ? s.browseSearches < browse : s.searches - s.browseSearches < lim.searches - browse;
}

const count = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);
let quota: QuotaDay | null = null;
/** leitura da conta salva em andamento */
let reading: Promise<void> | null = null;
/** a conta salva já foi lida: até lá nada é gravado (a da memória apagaria a do banco) */
let synced = false;
/** a leitura falhou (rede, 5xx): a próxima tentativa só depois disso */
let retryAt = 0;
let saving: ReturnType<typeof setTimeout> | null = null;
const warned = new Set<string>();
const limits = (): QuotaLimits => config.youtubeQuota;

/** 403 quotaExceeded: o balde fica fechado por até 1 h, só em memória e só no dia do pedido */
const BLOCK = 3600e3;
const blocked: Record<'units' | 'searches', { day: string; until: number } | null> = { units: null, searches: null };
const closed = (kind: 'units' | 'searches', day: string) => {
  const b = blocked[kind];
  return !!b && b.day === day && Date.now() < b.until;
};

function warnOnce(key: string, msg: string) {
  if (warned.has(key)) return;
  if (warned.size > 50) warned.clear();
  warned.add(key);
  console.warn(msg);
}

/** Lê a conta salva. O que a memória contou enquanto a leitura falhava soma com o salvo do mesmo dia. */
async function read(): Promise<void> {
  const s = await db.loadKv<QuotaDay>('youtube-quota');
  if (s === undefined) {
    retryAt = Date.now() + 30e3;
    return;
  }
  synced = true;
  if (!s || typeof s.day !== 'string') return;
  const now = Date.now();
  const saved = rollDay({ day: s.day, units: count(s.units), browseUnits: count(s.browseUnits), searches: count(s.searches), browseSearches: count(s.browseSearches) }, now);
  // soma no mesmo objeto: quem já pegou a conta da memória continua descontando nela
  const q = (quota = rollDay(quota, now));
  const counted = q.units + q.searches > 0;
  for (const k of ['units', 'browseUnits', 'searches', 'browseSearches'] as const) q[k] += saved[k];
  if (counted) save();
}

/** Conta do dia, lida do banco na primeira vez. Se a leitura falha, vale a da memória e ela é refeita 30 s depois. */
async function book(): Promise<QuotaDay> {
  if (!synced && !reading && Date.now() >= retryAt) {
    reading = read()
      .catch(e => {
        retryAt = Date.now() + 30e3;
        console.warn('[youtube] cota salva:', (e as Error).message);
      })
      .finally(() => (reading = null));
  }
  // só a primeira leitura segura os pedidos: depois de uma falha, eles seguem com a conta da memória
  if (reading && !retryAt) await reading;
  return (quota = rollDay(quota, Date.now()));
}

/** Grava a conta no banco, no máximo a cada 30 s (só depois de ler a salva). */
function save() {
  if (saving || !synced) return;
  saving = setTimeout(() => {
    saving = null;
    void Promise.resolve()
      .then(() => db.saveKv('youtube-quota', quota))
      .catch(e => console.warn('[youtube] cota:', (e as Error).message));
  }, 30e3);
  saving.unref();
}

/** Encerramento (SIGTERM): grava agora a conta que esperava os 30 s. */
export async function flush(): Promise<void> {
  if (!saving || !synced) return;
  clearTimeout(saving);
  saving = null;
  await Promise.resolve()
    .then(() => db.saveKv('youtube-quota', quota))
    .catch(e => console.warn('[youtube] cota:', (e as Error).message));
}

/** Desconta n unidades, se o uso ainda cabe no dia e o balde não está fechado por um 403 (o polling passa sempre). */
async function take(use: Use, n = 1): Promise<boolean> {
  const s = await book();
  if (!allowUnits(s, limits(), use, n) || (use !== 'follow' && closed('units', s.day))) {
    warnOnce(`${s.day}:${use}`, `[youtube] cota do dia esgotada para ${use === 'browse' ? 'a lista "tudo ao vivo"' : 'adicionar canais'}`);
    return false;
  }
  s.units += n;
  if (use === 'browse') s.browseUnits += n;
  save();
  return true;
}

/** Desconta uma chamada do search.list, se ainda cabe no dia e o balde não está fechado por um 403. */
async function takeSearch(use: 'browse' | 'lookup'): Promise<boolean> {
  const s = await book();
  if (!allowSearch(s, limits(), use) || closed('searches', s.day)) {
    warnOnce(`${s.day}:search:${use}`, `[youtube] buscas do dia esgotadas para ${use === 'browse' ? 'a lista "tudo ao vivo"' : 'a busca por nome'}`);
    return false;
  }
  s.searches++;
  if (use === 'browse') s.browseSearches++;
  save();
  return true;
}

const quotaExceeded = (e: unknown) => e instanceof HttpError && e.status === 403 && /quotaExceeded|dailyLimitExceeded/.test(e.body);

/**
 * Chamada à Data API. 403 quotaExceeded = o balde acabou: a lista e as consultas do app param por até 1 h (ou até
 * uma chamada do mesmo balde dar certo). A resposta de um pedido feito antes da virada do dia não fecha o dia novo.
 */
async function yt<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const kind = path === 'search' ? 'searches' : 'units';
  const day = pacificDay(Date.now());
  try {
    const r = await getJson<T>(`${API}/${path}?${new URLSearchParams({ ...params, key: config.youtube.key })}`);
    blocked[kind] = null;
    return r;
  } catch (e) {
    if (!quotaExceeded(e)) throw e;
    if (pacificDay(Date.now()) === day) blocked[kind] = { day, until: Date.now() + BLOCK };
    warnOnce(`${day}:403:${kind}`, `[youtube] ${path}: cota do Google esgotada (a lista e as consultas param por até 1 h)`);
    throw new QuotaError(`cota do YouTube esgotada (${path})`, kind);
  }
}

// ---- Canais ----

const toChannel = (c: any): Channel => ({
  key: `youtube:${c.id}`,
  platform: 'youtube',
  channelId: c.id,
  login: c.snippet.customUrl ?? '',
  name: c.snippet.title,
  avatar: c.snippet.thumbnails?.medium?.url ?? c.snippet.thumbnails?.default?.url ?? null,
  followers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount) || null,
  lang: langCode(c.snippet.defaultLanguage),
});

/** @handle do YouTube: letras de qualquer alfabeto (com acentos e sinais), números, _ . - e ·, até 30. */
export const isHandle = (s: string) => /^@?[\p{L}\p{M}\p{N}_.·-]{1,30}$/u.test(s);

const resolved = new Map<string, { at: number; ch: Channel | null }>();

/** Aceita @handle ou o id do canal (UC…). Custa 1 unidade; a resposta fica 6 h em cache (não achado, 1 h). */
export async function resolve(name: string): Promise<Channel | null> {
  const byId = CHANNEL_ID.youtube.test(name);
  if (!byId && !isHandle(name)) return null;
  const handle = name.startsWith('@') ? name : '@' + name;
  const k = byId ? name : handle.toLowerCase();
  const hit = resolved.get(k);
  if (hit && Date.now() - hit.at < (hit.ch ? 6 : 1) * 3600e3) return hit.ch;
  if (!(await take('lookup'))) throw new QuotaError('cota do YouTube esgotada');
  const r = await yt('channels', { part: 'snippet,statistics', ...(byId ? { id: name } : { forHandle: handle }) });
  const ch = r.items?.[0] ? toChannel(r.items[0]) : null;
  if (resolved.size > 500) resolved.clear();
  resolved.set(k, { at: Date.now(), ch });
  return ch;
}

const searchCache = new Map<string, { at: number; res: Channel[] }>();

/**
 * Tenta o @handle (1 unidade). Só cai no search.list (1 das buscas do dia) se o handle não existir.
 * Sem busca sobrando, só o @handle funciona: o resto lança QuotaError com bucket 'searches' (o app sugere colar o link).
 */
export async function search(q: string): Promise<Channel[]> {
  const k = q.toLowerCase();
  const hit = searchCache.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.res;
  let res: Channel[] = [];
  const handle = q.replace(/\s+/g, '');
  if (isHandle(handle)) {
    const c = await resolve(handle);
    if (c) res = [c];
  }
  if (!res.length && !q.startsWith('@')) {
    if (!(await takeSearch('lookup'))) throw new QuotaError('buscas do YouTube esgotadas hoje', 'searches');
    const s = await yt('search', { part: 'snippet', type: 'channel', q, maxResults: '5' });
    const ids = (s.items ?? []).map((i: any) => i.snippet.channelId).join(',');
    if (ids) {
      if (!(await take('lookup'))) throw new QuotaError('cota do YouTube esgotada');
      res = ((await yt('channels', { part: 'snippet,statistics', id: ids })).items ?? []).map(toChannel);
    }
  }
  if (searchCache.size > 500) searchCache.clear();
  searchCache.set(k, { at: Date.now(), res });
  return res;
}

let categories: Promise<Map<string, string>> | null = null;
async function categoryName(id: string): Promise<string> {
  // guarda a promessa, não o mapa: chamadas simultâneas esperam a mesma consulta
  categories ??= take('follow')
    .then(() => yt('videoCategories', { part: 'snippet', regionCode: 'BR', hl: 'pt_BR' }))
    .then(r => new Map<string, string>((r.items ?? []).map((c: any) => [c.id, c.snippet.title])))
    .catch(() => {
      categories = null;
      return new Map<string, string>();
    });
  return (await categories).get(id) ?? '';
}

// ---- Lista "tudo ao vivo" ----

const LIVE_WORD: Record<string, string> = { pt: 'ao vivo', es: 'en vivo', fr: 'en direct', it: 'in diretta', ja: 'ライブ', ko: '라이브', zh: '直播', ru: 'прямой эфир', tr: 'canlı', pl: 'na żywo', nl: 'live', ar: 'بث مباشر', hi: 'लाइव', id: 'live', th: 'ไลฟ์', vi: 'trực tiếp' };

/** Línguas pedidas nos últimos 15 min: a cota da lista é dividida entre elas. */
const asked = new Map<string, number>();
function activeLangs(now: number): number {
  for (const [l, t] of asked) if (now - t > 15 * 60e3) asked.delete(l);
  return Math.max(1, asked.size);
}

const TOP_TTL = 180e3;
/** Parte das unidades da lista para atualizar os viewers (o resto fica para as fotos dos canais). */
const VIEWERS_SHARE = 0.8;
/** Atualizar os viewers de uma língua: a cada 3 min, ou mais devagar se a cota da lista não der para todas. */
export const refreshEvery = (langs: number, lim: QuotaLimits) => Math.max(TOP_TTL, (DAY * langs) / Math.max(1, lim.browseUnits * VIEWERS_SHARE));
/** Redescobrir quem está ao vivo numa língua: a cada `every`, ou mais devagar se as buscas do dia não derem para todas. */
export const discoverEvery = (langs: number, lim: QuotaLimits, every: number) => Math.max(every, (DAY * langs) / Math.max(1, lim.browseSearches));

const found = new Map<string, { at: number; ids: string[]; retryAt: number }>();

/** Vídeos ao vivo numa língua. Descobrir gasta uma busca, então é refeito só de tempos em tempos. */
async function discover(lang: string, now: number): Promise<string[]> {
  const d = found.get(lang);
  if (d && (now < d.retryAt || now - d.at < discoverEvery(activeLangs(now), limits(), config.browseYoutube))) return d.ids;
  if (!(await takeSearch('browse'))) return d?.ids ?? [];
  try {
    // sem um termo de busca a API devolve uma lista vazia; "ao vivo" na língua pedida é o mais neutro
    const s = await yt('search', { part: 'id', type: 'video', eventType: 'live', order: 'viewCount', q: LIVE_WORD[lang] ?? 'live', relevanceLanguage: lang, maxResults: '50' });
    const ids: string[] = (s.items ?? []).map((i: any) => i.id?.videoId).filter(Boolean);
    found.set(lang, { at: now, ids, retryAt: 0 });
    return ids;
  } catch (e) {
    // falhou: segue com a última descoberta e só tenta de novo daqui a uma hora (sem gastar outra busca antes)
    found.set(lang, { at: d?.at ?? 0, ids: d?.ids ?? [], retryAt: now + 3600e3 });
    if (!d?.ids.length) throw e;
    console.warn(`[youtube] tudo ao vivo (${lang}): descoberta falhou, seguindo com a anterior:`, (e as Error).message);
    return d.ids;
  }
}

/** Sem unidade para atualizar, a última lista vale por no máximo 15 min (depois as lives podem ter acabado). */
const STALE = 15 * 60e3;
const last = new Map<string, { at: number; items: BrowseItem[] }>();
const tops = new Map<string, { until: number; p: Promise<BrowseItem[]> }>();

async function refresh(lang: string, now: number): Promise<BrowseItem[]> {
  const ids = await discover(lang, now);
  if (!ids.length) return [];
  // sem nova descoberta, continua atualizando os ids conhecidos: as lives que acabaram saem da lista
  if (!(await take('browse'))) {
    const l = last.get(lang);
    return l && Date.now() - l.at < STALE ? l.items : [];
  }
  const r = await yt('videos', { part: 'snippet,liveStreamingDetails', id: ids.join(',') });
  const live = (r.items ?? []).filter((v: any) => {
    const vl = langCode(v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage);
    // relevanceLanguage é só uma dica: descarta o que declara outra língua
    return v.snippet.liveBroadcastContent === 'live' && (!vl || vl === lang);
  });
  const items = await Promise.all(live.map(async (v: any): Promise<BrowseItem> => ({
    key: `youtube:${v.snippet.channelId}`,
    platform: 'youtube',
    channelId: v.snippet.channelId,
    login: '',
    name: v.snippet.channelTitle,
    avatar: null,
    viewers: Number(v.liveStreamingDetails?.concurrentViewers) || 0,
    title: v.snippet.title,
    cat: await categoryName(v.snippet.categoryId),
    thumb: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.medium?.url ?? null,
    lang,
    url: `https://www.youtube.com/watch?v=${v.id}`,
  })));
  last.set(lang, { at: Date.now(), items });
  return items;
}

/**
 * Lives do YouTube com mais viewers em uma língua. Descobrir quem está ao vivo gasta uma busca
 * (search.list), refeita só a cada `browseYoutube`; os viewers desses vídeos são atualizados a cada
 * 3 min (videos.list, 1 unidade). Pedidos da mesma língua nesse meio tempo dividem a mesma consulta.
 */
export function topLive(lang: string): Promise<BrowseItem[]> {
  const now = Date.now();
  asked.set(lang, now);
  const hit = tops.get(lang);
  if (hit && now < hit.until) return hit.p;
  const entry = { until: Infinity, p: refresh(lang, now) };
  tops.set(lang, entry);
  entry.p.then(
    () => (entry.until = Date.now() + refreshEvery(activeLangs(Date.now()), limits())),
    () => (entry.until = Date.now() + 30e3),
  );
  return entry.p;
}

/**
 * Foto dos canais (a busca e a videos.list não trazem). Custa 1 unidade a cada 50 canais, da cota da
 * lista "tudo ao vivo"; sem cota, os canais que faltaram ficam fora do resultado e são pedidos depois.
 */
export async function avatars(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const part of chunk(ids, 50)) {
    if (!(await take('browse'))) break;
    const r = await yt('channels', { part: 'snippet', id: part.join(','), maxResults: '50' });
    for (const id of part) out.set(id, null);
    for (const c of r.items ?? []) out.set(c.id, c.snippet?.thumbnails?.default?.url ?? null);
  }
  return out;
}

// ---- Canais seguidos ----

/** Duração ISO 8601 do YouTube em segundos (PT1H2M3S, P0D…); null se não der para ler. */
export function isoSeconds(d: unknown): number | null {
  if (typeof d !== 'string' || d === 'P') return null;
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(d);
  if (!m) return null;
  const [w, dd, h, mi, s] = m.slice(1).map(x => Number(x ?? 0));
  return ((w * 7 + dd) * 24 + h) * 3600 + mi * 60 + s;
}

const FEED_ITEMS = 15;

/** Ids dos vídeos de um feed (os 15 mais novos); null se a resposta não é um feed (vazio só vale com '<feed'). */
export function parseFeed(xml: string): string[] | null {
  const ids = [...xml.matchAll(/<yt:videoId>([\w-]+)<\/yt:videoId>/g)].map(m => m[1]).slice(0, FEED_ITEMS);
  return ids.length || xml.includes('<feed') ? ids : null;
}

/** Vídeos recentes pelo feed RSS do canal (não gasta cota). Na falha, o motivo: status HTTP, 'sem feed', 'rede'… */
async function feed(channelId: string): Promise<string[] | string> {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return String(res.status);
    return parseFeed(await res.text()) ?? 'sem feed';
  } catch (e) {
    return (e as Error).name === 'TimeoutError' ? 'tempo' : 'rede';
  }
}

interface Watch {
  /** próxima consulta (0 = toda rodada) */
  next: number;
  premiere: boolean;
}

/** O que já sabemos dos vídeos de cada canal seguido. */
interface Memo {
  /** última rodada que incluiu o canal: memória parada há uma semana é descartada */
  at: number;
  /** vídeos que já sabemos que não estão (nem vão ficar) ao vivo: não são consultados de novo */
  done: Set<string>;
  /** vídeos 'live' ou 'upcoming' já vistos: consultados a cada rodada até virarem 'none' */
  watch: Map<string, Watch>;
}

const memo = new Map<string, Memo>();
const MEMO_KEEP = 7 * DAY;
/** 'upcoming' marcado para longe é consultado só a cada 6 h; o atrasado há mais de um dia (como os "chats livres"), a cada 30 min */
const SOON = 2 * DAY;
const FAR_EVERY = 6 * 3600e3;
const LATE_EVERY = 30 * 60e3;
/** acompanhados por canal (agendas longas): os mais distantes deixam de ser consultados */
const WATCH_MAX = 20;

/** Canal com mais de um vídeo ao vivo: vale a live de verdade (não a estreia) e, entre iguais, a mais assistida. */
const better = (a: Live, b: Live) => (!!a.premiere !== !!b.premiere ? !a.premiere : a.viewers > b.viewers);

/** Aplica o estado de um vídeo da videos.list: live, upcoming ou none. */
async function see(v: any, owner: string, m: Memo, out: FetchResult, now: number): Promise<void> {
  // indexa pelo dono de verdade: nenhum alias rouba a live de outro canal
  const ch: string = v.snippet?.channelId ?? owner;
  const state = v.snippet?.liveBroadcastContent;
  const det = v.liveStreamingDetails;
  // estreia (vídeo gravado exibido como live) tem duração; a live de verdade vem com P0D
  const premiere = (isoSeconds(v.contentDetails?.duration) ?? 0) > 0;
  if (state === 'live') {
    m.watch.set(v.id, { next: 0, premiere });
    const live: Live = {
      viewers: Number(det?.concurrentViewers) || 0,
      title: v.snippet.title,
      cat: await categoryName(v.snippet.categoryId),
      thumb: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.medium?.url ?? null,
      lang: langCode(v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage),
      startedAt: det?.actualStartTime ?? null,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      name: v.snippet.channelTitle,
      ...(premiere ? { premiere: true } : {}),
    };
    const prev = out.live.get(ch);
    if (!prev || better(live, prev)) out.live.set(ch, live);
  } else if (state === 'upcoming') {
    const at = Date.parse(det?.scheduledStartTime ?? '');
    m.watch.set(v.id, { next: at - now > SOON ? now + FAR_EVERY : now - at > DAY ? now + LATE_EVERY : 0, premiere });
  } else {
    const w = m.watch.get(v.id);
    m.watch.delete(v.id);
    m.done.add(v.id);
    // o fim de uma estreia não é fim de live
    const end = det?.actualEndTime;
    if (end && !w?.premiere && end > (out.ended.get(ch) ?? '')) out.ended.set(ch, end);
  }
}

/**
 * Status dos canais seguidos. Consulta na videos.list (1 unidade a cada 50 vídeos) os vídeos novos dos
 * feeds RSS (até 15 por canal) e os 'live' e 'upcoming' já vistos, até virarem 'none'. known = vídeos que
 * o registry sabe que estavam ao vivo (status.url): conferidos mesmo com o feed fora, para a live acabar
 * na hora certa. Canal com o feed fora e nenhum vídeo conferido vai para unknown.
 */
export async function fetchLive(channelIds: string[], known?: Map<string, string[]>): Promise<FetchResult> {
  const out: FetchResult = { live: new Map(), ended: new Map(), unknown: new Set() };
  const now = Date.now();
  for (const [ch, m] of memo) if (now - m.at > MEMO_KEEP) memo.delete(ch);
  // id fora do formato não tem feed: nem é consultado (fica offline)
  const ids = [...new Set(channelIds)].filter(id => CHANNEL_ID.youtube.test(id));
  const memoOf = (ch: string) => {
    let m = memo.get(ch);
    if (!m) memo.set(ch, (m = { at: now, done: new Set(), watch: new Map() }));
    m.at = now;
    return m;
  };
  /** canais com algum vídeo conferido nesta rodada */
  const answered = new Set<string>();
  /** canais com vídeo que não deu para conferir */
  const failed = new Set<string>();

  for (const id of ids) {
    const m = memoOf(id);
    for (const v of known?.get(id) ?? []) {
      if (m.done.has(v)) answered.add(id);
      else m.watch.set(v, { next: 0, premiere: m.watch.get(v)?.premiere ?? false });
    }
  }

  const feeds = new Map<string, string[]>();
  const fails: string[] = [];
  for (const part of chunk(ids, 8)) {
    await Promise.all(part.map(async id => {
      const r = await feed(id);
      if (typeof r === 'string') fails.push(r);
      else feeds.set(id, r);
    }));
  }
  if (fails.length) {
    const why = new Map<string, number>();
    for (const f of fails) why.set(f, (why.get(f) ?? 0) + 1);
    console.warn(`[youtube] feeds RSS: ${fails.length} de ${ids.length} falharam (${[...why].map(([k, n]) => `${k}: ${n}`).join(', ')})`);
  }

  // o que consultar: os vídeos novos dos feeds e os acompanhados que estão na vez
  const owner = new Map<string, string>();
  for (const id of ids) {
    const m = memoOf(id);
    for (const v of feeds.get(id) ?? []) if (!m.done.has(v) && !m.watch.has(v) && !owner.has(v)) owner.set(v, id);
    for (const [v, w] of m.watch) if (w.next <= now && !owner.has(v)) owner.set(v, id);
  }

  let quotaOut = false;
  for (const part of chunk([...owner.keys()], 50)) {
    if (quotaOut) {
      part.forEach(v => failed.add(owner.get(v)!));
      continue;
    }
    try {
      await take('follow');
      const r = await yt('videos', { part: 'snippet,liveStreamingDetails,contentDetails', id: part.join(',') });
      const got = new Set<string>();
      for (const v of r.items ?? []) {
        const ch = owner.get(v.id);
        if (!ch) continue;
        got.add(v.id);
        answered.add(ch);
        await see(v, ch, memoOf(ch), out, now);
      }
      // vídeo que não voltou foi apagado ou ficou privado: não vai mais ficar ao vivo
      for (const v of part) {
        if (got.has(v)) continue;
        const ch = owner.get(v)!;
        const m = memoOf(ch);
        m.watch.delete(v);
        m.done.add(v);
        answered.add(ch);
      }
    } catch (e) {
      part.forEach(v => failed.add(owner.get(v)!));
      // sem cota, o resto da rodada falharia igual
      if (e instanceof QuotaError) quotaOut = true;
      console.warn(`[youtube] status de ${part.length} vídeos:`, (e as Error).message);
    }
  }

  for (const id of ids) {
    const m = memoOf(id);
    const vids = feeds.get(id);
    // done só muda nos canais cujo feed respondeu: fica o que ainda está no feed
    if (vids) {
      const keep = new Set(vids);
      for (const v of m.done) if (!keep.has(v)) m.done.delete(v);
    }
    if (m.watch.size > WATCH_MAX) {
      for (const [v] of [...m.watch].sort((a, b) => a[1].next - b[1].next).slice(WATCH_MAX)) {
        m.watch.delete(v);
        m.done.add(v);
      }
    }
    if (!out.live.has(id) && (failed.has(id) || (!vids && !answered.has(id)))) out.unknown.add(id);
  }
  return out;
}

/** Nome antigo do resultado do polling do YouTube. */
export type YtResult = FetchResult;

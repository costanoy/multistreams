import { config } from './config.js';
import { BrowseItem, Channel, Live, chunk, getJson, langCode } from './types.js';

const API = 'https://www.googleapis.com/youtube/v3';

const yt = <T = any>(path: string, params: Record<string, string>) =>
  getJson<T>(`${API}/${path}?${new URLSearchParams({ ...params, key: config.youtube.key })}`);

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

/** Aceita @handle ou o id do canal (UC…). Custa 1 unidade de cota. */
export async function resolve(name: string): Promise<Channel | null> {
  const byId = /^UC[\w-]{22}$/.test(name);
  const r = await yt('channels', { part: 'snippet,statistics', ...(byId ? { id: name } : { forHandle: name.startsWith('@') ? name : '@' + name }) });
  return r.items?.[0] ? toChannel(r.items[0]) : null;
}

const searchCache = new Map<string, { at: number; res: Channel[] }>();

/** Tenta o @handle (1 unidade). Só cai no search.list (100 unidades) se o handle não existir. */
export async function search(q: string): Promise<Channel[]> {
  const k = q.toLowerCase();
  const hit = searchCache.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.res;
  let res: Channel[] = [];
  const handle = q.replace(/\s+/g, '');
  if (/^@?[\w.-]{3,30}$/.test(handle)) {
    const c = await resolve(handle);
    if (c) res = [c];
  }
  if (!res.length && !q.startsWith('@')) {
    const s = await yt('search', { part: 'snippet', type: 'channel', q, maxResults: '5' });
    const ids = (s.items ?? []).map((i: any) => i.snippet.channelId).join(',');
    if (ids) res = ((await yt('channels', { part: 'snippet,statistics', id: ids })).items ?? []).map(toChannel);
  }
  if (searchCache.size > 500) searchCache.clear();
  searchCache.set(k, { at: Date.now(), res });
  return res;
}

let categories: Promise<Map<string, string>> | null = null;
async function categoryName(id: string): Promise<string> {
  // guarda a promessa, não o mapa: chamadas simultâneas esperam a mesma consulta
  categories ??= yt('videoCategories', { part: 'snippet', regionCode: 'BR', hl: 'pt_BR' })
    .then(r => new Map<string, string>((r.items ?? []).map((c: any) => [c.id, c.snippet.title])))
    .catch(() => {
      categories = null;
      return new Map<string, string>();
    });
  return (await categories).get(id) ?? '';
}

const LIVE_WORD: Record<string, string> = { pt: 'ao vivo', es: 'en vivo', fr: 'en direct', it: 'in diretta', ja: 'ライブ', ko: '라이브', zh: '直播', ru: 'прямой эфир', tr: 'canlı', pl: 'na żywo', nl: 'live', ar: 'بث مباشر', hi: 'लाइव', id: 'live', th: 'ไลฟ์', vi: 'trực tiếp' };
const found = new Map<string, { at: number; ids: string[] }>();

/**
 * Cota gasta hoje pela lista "tudo ao vivo" (o dia da cota vira à meia-noite do Pacífico).
 * Passou do limite, a lista do YouTube para de atualizar até o dia seguinte e o resto da cota
 * fica para acompanhar os canais seguidos e para adicionar canais.
 */
const budget = { day: '', spent: 0 };
function spend(units: number): boolean {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  if (budget.day !== day) Object.assign(budget, { day, spent: 0 });
  if (budget.spent + units > config.browseYoutubeBudget) return false;
  budget.spent += units;
  return true;
}

const last = new Map<string, BrowseItem[]>();

/**
 * Lives do YouTube com mais viewers em uma língua. Descobrir quem está ao vivo custa caro
 * (search.list = 100 unidades), então a descoberta é refeita só a cada `browseYoutube` ms;
 * os viewers desses vídeos são atualizados a cada chamada (videos.list = 1 unidade).
 */
export async function topLive(lang: string): Promise<BrowseItem[]> {
  let d = found.get(lang);
  if ((!d || Date.now() - d.at > config.browseYoutube) && spend(100)) {
    try {
      // sem um termo de busca a API devolve uma lista vazia; "ao vivo" na língua pedida é o mais neutro
      const s = await yt('search', { part: 'id', type: 'video', eventType: 'live', order: 'viewCount', q: LIVE_WORD[lang] ?? 'live', relevanceLanguage: lang, maxResults: '50' });
      d = { at: Date.now(), ids: (s.items ?? []).map((i: any) => i.id.videoId).filter(Boolean) };
      found.set(lang, d);
    } catch (e) {
      if (!d) throw e; // sem cota: segue com a última descoberta
    }
  }
  if (!d?.ids.length) return [];
  if (!spend(1)) return last.get(lang) ?? [];
  const r = await yt('videos', { part: 'snippet,liveStreamingDetails', id: d.ids.join(',') });
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
  last.set(lang, items);
  return items;
}

/**
 * Foto dos canais (a busca e a videos.list não trazem). Custa 1 unidade a cada 50 canais, da cota da
 * lista "tudo ao vivo"; sem cota, os canais que faltaram ficam fora do resultado e são pedidos depois.
 */
export async function avatars(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const part of chunk(ids, 50)) {
    if (!spend(1)) break;
    const r = await yt('channels', { part: 'snippet', id: part.join(','), maxResults: '50' });
    for (const id of part) out.set(id, null);
    for (const c of r.items ?? []) out.set(c.id, c.snippet?.thumbnails?.default?.url ?? null);
  }
  return out;
}

/** Vídeos recentes pelo feed RSS do canal (não gasta cota). null = feed indisponível. */
async function feed(channelId: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return [...(await res.text()).matchAll(/<yt:videoId>([\w-]+)<\/yt:videoId>/g)].map(m => m[1]).slice(0, 5);
  } catch {
    return null;
  }
}

/** Vídeos que já sabemos que não estão (nem vão ficar) ao vivo: não são consultados de novo. */
let done = new Set<string>();

export interface YtResult {
  live: Map<string, Live>;
  /** fim da live mais recente vista em cada canal */
  ended: Map<string, string>;
  /** canais cujo feed falhou: manter o status anterior */
  unknown: Set<string>;
}

export async function fetchLive(channelIds: string[]): Promise<YtResult> {
  const out: YtResult = { live: new Map(), ended: new Map(), unknown: new Set() };
  const owner = new Map<string, string>();
  for (const part of chunk(channelIds, 8)) {
    await Promise.all(part.map(async id => {
      const vids = await feed(id);
      if (!vids) out.unknown.add(id);
      else for (const v of vids) owner.set(v, id);
    }));
  }
  const pending = [...owner.keys()].filter(v => !done.has(v));
  const stillDone = new Set([...done].filter(v => owner.has(v)));
  for (const part of chunk(pending, 50)) {
    const r = await yt('videos', { part: 'snippet,liveStreamingDetails', id: part.join(',') });
    for (const v of r.items ?? []) {
      const ch = owner.get(v.id)!;
      const state = v.snippet.liveBroadcastContent;
      const det = v.liveStreamingDetails;
      if (state === 'live') {
        const prev = out.live.get(ch);
        const viewers = Number(det?.concurrentViewers) || 0;
        if (prev && prev.viewers >= viewers) continue;
        out.live.set(ch, {
          viewers,
          title: v.snippet.title,
          cat: await categoryName(v.snippet.categoryId),
          thumb: v.snippet.thumbnails?.maxres?.url ?? v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.medium?.url ?? null,
          lang: langCode(v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage),
          startedAt: det?.actualStartTime ?? null,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          name: v.snippet.channelTitle,
        });
      } else if (state === 'none') {
        stillDone.add(v.id);
        const end = det?.actualEndTime;
        if (end && end > (out.ended.get(ch) ?? '')) out.ended.set(ch, end);
      }
    }
  }
  done = stillDone;
  return out;
}

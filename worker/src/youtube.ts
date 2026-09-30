import { config } from './config.js';
import { Channel, Live, chunk, getJson, langCode } from './types.js';

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

let categories: Map<string, string> | null = null;
async function categoryName(id: string): Promise<string> {
  if (!categories) {
    categories = new Map();
    try {
      const r = await yt('videoCategories', { part: 'snippet', regionCode: 'BR', hl: 'pt_BR' });
      for (const c of r.items ?? []) categories.set(c.id, c.snippet.title);
    } catch {
      categories = null;
      return '';
    }
  }
  return categories.get(id) ?? '';
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

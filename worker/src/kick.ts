import { config } from './config.js';
import { BrowseItem, CHANNEL_ID, Channel, FetchResult, HttpError, catKey, chunk, getJson, langCode } from './types.js';

const API = 'https://api.kick.com/public/v1';
let token: { value: string; exp: number } | null = null;

async function appToken(): Promise<string> {
  if (token && token.exp > Date.now()) return token.value;
  const r = await getJson('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.kick.id, client_secret: config.kick.secret }),
  });
  token = { value: r.access_token, exp: Date.now() + ((r.expires_in ?? 3600) - 300) * 1000 };
  return token.value;
}

async function kick<T = any>(path: string, params: [string, string][], retry = true): Promise<T> {
  try {
    return await getJson(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${await appToken()}` } });
  } catch (e) {
    if (retry && e instanceof HttpError && e.status === 401) {
      token = null;
      return kick(path, params, false);
    }
    throw e;
  }
}

const channels = async (slugs: string[]): Promise<any[]> =>
  (await kick('channels', slugs.map((s): [string, string] => ['slug', s]))).data ?? [];

export async function resolve(slug: string): Promise<Channel | null> {
  slug = slug.toLowerCase();
  // a API recusa (400) slugs com mais de 25 caracteres
  if (!/^[\w-]{2,25}$/.test(slug)) return null;
  const c = (await channels([slug]))[0];
  if (!c) return null;
  let user: any = null;
  try {
    user = (await kick('users', [['id', String(c.broadcaster_user_id)]])).data?.[0];
  } catch {
    // nome e avatar são opcionais
  }
  return {
    key: `kick:${c.slug}`,
    platform: 'kick',
    channelId: c.slug,
    login: c.slug,
    name: user?.name ?? c.slug,
    avatar: user?.profile_picture ?? null,
    followers: null,
    lang: langCode(c.stream?.language),
  };
}

/** A API da Kick não tem busca por nome: só dá para conferir o slug exato. */
export async function search(q: string): Promise<Channel[]> {
  const c = await resolve(q.replace(/\s+/g, ''));
  return c ? [c] : [];
}

/** Ids de categoria da Kick com esse nome (a busca da Kick é por trecho do nome). */
const catIds = new Map<string, number[]>();
/** busca que falhou: fica 5 min devolvendo vazio (com a Kick travada, cada chamada esperaria os 15 s do timeout) */
const catFailed = new Map<string, number>();
const CAT_RETRY = 5 * 60e3;
export async function categoryIds(name: string): Promise<number[]> {
  const k = catKey(name);
  if (catIds.has(k)) return catIds.get(k)!;
  if (Date.now() - (catFailed.get(k) ?? -Infinity) < CAT_RETRY) return [];
  const r = await kick('categories', [['q', name.replace(/\(.*?\)/g, '').trim()]]).catch(e => {
    if (catFailed.size > 2000) catFailed.clear();
    catFailed.set(k, Date.now());
    throw e;
  });
  const ids = (r.data ?? []).filter((c: any) => catKey(c.name) === k).map((c: any) => c.id as number);
  if (catIds.size > 2000) catIds.clear();
  catIds.set(k, ids);
  return ids;
}

/** Quantas lives a lista da Kick devolve por chamada: veio menos que isso, veio tudo. */
export const TOP_LIMIT = 100;

/**
 * As 100 lives com mais viewers da Kick em uma língua (e, opcionalmente, numa categoria).
 * /public/v1/livestreams e /public/v1/categories estão marcados como deprecated (a v2 pagina).
 */
export async function topLive(lang: string, categoryId?: number): Promise<BrowseItem[]> {
  const params: [string, string][] = [['limit', String(TOP_LIMIT)], ['sort', 'viewer_count'], ['language', lang]];
  if (categoryId) params.push(['category_id', String(categoryId)]);
  const r = await kick('livestreams', params);
  return (r.data ?? []).filter((s: any) => s.slug).map((s: any): BrowseItem => ({
    key: `kick:${s.slug}`,
    platform: 'kick',
    channelId: s.slug,
    login: s.slug,
    name: s.slug,
    avatar: s.profile_picture || null,
    viewers: s.viewer_count ?? 0,
    title: s.stream_title ?? '',
    cat: s.category?.name ?? '',
    catId: s.category?.id,
    thumb: s.thumbnail || null,
    lang,
    url: `https://kick.com/${s.slug}`,
  }));
}

/** Status dos canais, de 50 em 50. Lote que falha (429, 5xx) fica em unknown, sem derrubar os outros. */
export async function fetchLive(slugs: string[]): Promise<FetchResult> {
  const out: FetchResult = { live: new Map(), ended: new Map(), unknown: new Set() };
  // slug fora do formato faz a Kick recusar o lote inteiro: nem vai para a API (fica offline)
  for (const part of chunk(slugs.filter(s => CHANNEL_ID.kick.test(s)), 50)) {
    try {
      for (const c of await channels(part)) {
        if (!c.stream?.is_live) continue;
        out.live.set(c.slug, {
          viewers: c.stream.viewer_count ?? 0,
          title: c.stream_title ?? '',
          cat: c.category?.name ?? '',
          thumb: c.stream.thumbnail || null,
          lang: langCode(c.stream.language),
          startedAt: c.stream.start_time && !c.stream.start_time.startsWith('0001') ? c.stream.start_time : null,
          url: `https://kick.com/${c.slug}`,
        });
      }
    } catch (e) {
      part.forEach(s => out.unknown.add(s));
      console.warn(`[kick] status de ${part.length} canais:`, (e as Error).message);
    }
  }
  return out;
}

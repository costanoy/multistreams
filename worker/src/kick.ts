import { config } from './config.js';
import { Channel, HttpError, Live, chunk, getJson, langCode } from './types.js';

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
  if (!/^[\w-]{2,40}$/.test(slug)) return null;
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

export async function fetchLive(slugs: string[]): Promise<Map<string, Live>> {
  const out = new Map<string, Live>();
  for (const part of chunk(slugs, 50)) {
    for (const c of await channels(part)) {
      if (!c.stream?.is_live) continue;
      out.set(c.slug, {
        viewers: c.stream.viewer_count ?? 0,
        title: c.stream_title ?? '',
        cat: c.category?.name ?? '',
        thumb: c.stream.thumbnail || null,
        lang: langCode(c.stream.language),
        startedAt: c.stream.start_time && !c.stream.start_time.startsWith('0001') ? c.stream.start_time : null,
        url: `https://kick.com/${c.slug}`,
      });
    }
  }
  return out;
}

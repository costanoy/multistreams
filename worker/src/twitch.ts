import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { BrowseItem, Channel, HttpError, Live, chunk, getJson, langCode } from './types.js';

let token: { value: string; exp: number } | null = null;

async function appToken(): Promise<string> {
  if (token && token.exp > Date.now()) return token.value;
  const q = new URLSearchParams({ client_id: config.twitch.id, client_secret: config.twitch.secret, grant_type: 'client_credentials' });
  const r = await getJson(`https://id.twitch.tv/oauth2/token?${q}`, { method: 'POST' });
  token = { value: r.access_token, exp: Date.now() + (r.expires_in - 300) * 1000 };
  return token.value;
}

async function helix<T = any>(path: string, params: [string, string][] = [], init?: RequestInit, retry = true): Promise<T> {
  const q = new URLSearchParams(params);
  try {
    return await getJson(`https://api.twitch.tv/helix/${path}?${q}`, {
      ...init,
      headers: { 'Client-Id': config.twitch.id, Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    if (retry && e instanceof HttpError && e.status === 401) {
      token = null;
      return helix(path, params, init, false);
    }
    throw e;
  }
}

async function followers(id: string): Promise<number | null> {
  try {
    return (await helix('channels/followers', [['broadcaster_id', id], ['first', '1']])).total ?? null;
  } catch {
    return null;
  }
}

const toChannel = async (u: any): Promise<Channel> => ({
  key: `twitch:${u.id}`,
  platform: 'twitch',
  channelId: u.id,
  login: u.login ?? u.broadcaster_login,
  name: u.display_name,
  avatar: u.profile_image_url ?? u.thumbnail_url ?? null,
  followers: await followers(u.id),
  lang: langCode(u.broadcaster_language),
});

export async function resolve(login: string): Promise<Channel | null> {
  if (!/^\w{2,25}$/.test(login)) return null;
  const r = await helix('users', [['login', login.toLowerCase()]]);
  return r.data[0] ? toChannel(r.data[0]) : null;
}

export async function search(q: string): Promise<Channel[]> {
  const r = await helix('search/channels', [['query', q], ['first', '6']]);
  return Promise.all(r.data.map(toChannel));
}

/** Get Streams: até 100 canais por chamada. Quem não volta está offline. */
export async function fetchLive(ids: string[]): Promise<Map<string, Live>> {
  const out = new Map<string, Live>();
  for (const part of chunk(ids, 100)) {
    const r = await helix('streams', [...part.map((id): [string, string] => ['user_id', id]), ['first', '100']]);
    for (const s of r.data) {
      if (s.type !== 'live') continue;
      out.set(s.user_id, {
        viewers: s.viewer_count,
        title: s.title,
        cat: s.game_name || '',
        thumb: s.thumbnail_url ? s.thumbnail_url.replace('{width}', '640').replace('{height}', '360') : null,
        lang: langCode(s.language),
        startedAt: s.started_at,
        url: `https://www.twitch.tv/${s.user_login}`,
        name: s.user_name,
      });
    }
  }
  return out;
}

/** Data da última live gravada, para o "ao vivo há X dias" de quem acabou de ser adicionado. */
export async function lastLiveAt(id: string): Promise<string | null> {
  try {
    const r = await helix('videos', [['user_id', id], ['type', 'archive'], ['first', '1']]);
    return r.data[0]?.created_at ?? null;
  } catch {
    return null;
  }
}

const avatars = new Map<string, string>();

/** As 100 lives com mais viewers da Twitch em uma língua. */
export async function topLive(lang: string): Promise<BrowseItem[]> {
  const r = await helix('streams', [['first', '100'], ['language', lang]]);
  const live = r.data.filter((s: any) => s.type === 'live');
  const need = live.map((s: any) => s.user_id as string).filter((id: string) => !avatars.has(id));
  if (need.length) {
    if (avatars.size > 5000) avatars.clear();
    try {
      const u = await helix('users', need.map((id: string): [string, string] => ['id', id]));
      for (const x of u.data) avatars.set(x.id, x.profile_image_url);
    } catch {
      // avatar é opcional
    }
  }
  return live.map((s: any): BrowseItem => ({
    key: `twitch:${s.user_id}`,
    platform: 'twitch',
    channelId: s.user_id,
    login: s.user_login,
    name: s.user_name,
    avatar: avatars.get(s.user_id) ?? null,
    viewers: s.viewer_count,
    title: s.title,
    cat: s.game_name || '',
    thumb: s.thumbnail_url ? s.thumbnail_url.replace('{width}', '640').replace('{height}', '360') : null,
    lang,
    url: `https://www.twitch.tv/${s.user_login}`,
  }));
}

// ---- EventSub (opcional) ----

const subscribed = new Set<string>();

export async function subscribeOnline(id: string): Promise<void> {
  if (subscribed.has(id)) return;
  subscribed.add(id);
  for (const type of ['stream.online', 'stream.offline']) {
    try {
      await helix('eventsub/subscriptions', [], {
        method: 'POST',
        body: JSON.stringify({
          type,
          version: '1',
          condition: { broadcaster_user_id: id },
          transport: { method: 'webhook', callback: `${config.publicUrl}/webhooks/twitch`, secret: config.eventsubSecret },
        }),
      });
    } catch (e) {
      // 409 = assinatura já existe
      if (!(e instanceof HttpError && e.status === 409)) {
        subscribed.delete(id);
        console.warn('[twitch] eventsub', id, (e as Error).message);
      }
    }
  }
}

export function verifyEventSub(headers: Headers, rawBody: string): boolean {
  const id = headers.get('twitch-eventsub-message-id') ?? '';
  const ts = headers.get('twitch-eventsub-message-timestamp') ?? '';
  const sig = headers.get('twitch-eventsub-message-signature') ?? '';
  const expected = 'sha256=' + createHmac('sha256', config.eventsubSecret).update(id + ts + rawBody).digest('hex');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

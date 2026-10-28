import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { BrowseItem, CHANNEL_ID, Channel, FetchResult, HttpError, chunk, getJson, langCode } from './types.js';

let token: { value: string; exp: number } | null = null;

async function appToken(): Promise<string> {
  if (token && token.exp > Date.now()) return token.value;
  const q = new URLSearchParams({ client_id: config.twitch.id, client_secret: config.twitch.secret, grant_type: 'client_credentials' });
  const r = await getJson(`https://id.twitch.tv/oauth2/token?${q}`, { method: 'POST' });
  token = { value: r.access_token, exp: Date.now() + (r.expires_in - 300) * 1000 };
  return token.value;
}

/**
 * Limite da Helix: um balde de pontos por token (800 por minuto), que enche aos poucos até ficar
 * cheio em `reset`. O polling dos seguidos e as varreduras do "tudo ao vivo" dividem o mesmo balde,
 * então as varreduras param antes, deixando RESERVE pontos para o polling.
 */
export interface Bucket {
  limit: number;
  remaining: number;
  /** quando o balde fica cheio de novo (ms) */
  reset: number;
  /** quando remaining foi lido */
  at: number;
  /** chamadas em andamento (ainda não descontadas em remaining) */
  inflight: number;
}
const bucket: Bucket = { limit: 800, remaining: 800, reset: 0, at: 0, inflight: 0 };
const RESERVE = 200;

/** Quanto esperar (ms) antes da próxima chamada. low = varredura, que não usa a reserva. */
export function helixWait(b: Bucket, now: number, low: boolean): number {
  const want = (low ? RESERVE : 0) + 1 + b.inflight;
  // depois do reset (ou antes da primeira resposta) o balde está cheio: só as chamadas em andamento contam
  if (now >= b.reset) return want <= b.limit ? 0 : 100;
  if (b.remaining >= want) return 0;
  const full = Math.max(1, b.limit - b.remaining);
  const ready = b.at + ((want - b.remaining) * (b.reset - b.at)) / full;
  return Math.max(0, Math.ceil(Math.min(b.reset, ready)) - now);
}

function readLimit(res: Response) {
  const h = res.headers;
  const now = Date.now();
  const remaining = Number(h.get('ratelimit-remaining') ?? NaN);
  const reset = Number(h.get('ratelimit-reset') ?? NaN) * 1000;
  const limit = Number(h.get('ratelimit-limit') ?? NaN);
  if (Number.isFinite(remaining) && Number.isFinite(reset)) Object.assign(bucket, { remaining, reset, at: now, limit: limit > 0 ? limit : bucket.limit });
  // 429 sem cabeçalhos: espera uns segundos
  else if (res.status === 429) Object.assign(bucket, { remaining: 0, reset: now + 3000, at: now });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function helix<T = any>(path: string, params: [string, string][] = [], init?: RequestInit, retry = 3, low = false): Promise<T> {
  for (let w = helixWait(bucket, Date.now(), low); w > 0; w = helixWait(bucket, Date.now(), low)) await sleep(w);
  const q = new URLSearchParams(params);
  bucket.inflight++;
  try {
    return await getJson(
      `https://api.twitch.tv/helix/${path}?${q}`,
      { ...init, headers: { 'Client-Id': config.twitch.id, Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json' } },
      readLimit,
    );
  } catch (e) {
    if (retry && e instanceof HttpError && e.status === 401) {
      token = null;
      return helix(path, params, init, 0, low);
    }
    // estourou o limite: a próxima tentativa espera o balde encher (helixWait)
    if (retry && e instanceof HttpError && e.status === 429) return helix(path, params, init, retry - 1, low);
    throw e;
  } finally {
    bucket.inflight--;
  }
}

async function followers(id: string): Promise<number | null> {
  try {
    return (await helix('channels/followers', [['broadcaster_id', id], ['first', '1']])).total ?? null;
  } catch {
    return null;
  }
}

/** Idioma da transmissão (Get Channel Information). Opcional: sem ele, o app usa o do aparelho. */
async function channelLang(id: string): Promise<string | null> {
  try {
    return langCode((await helix('channels', [['broadcaster_id', id]])).data?.[0]?.broadcaster_language);
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
  const u = (await helix('users', [['login', login.toLowerCase()]])).data[0];
  if (!u) return null;
  // a Get Users não traz o idioma: vem da Get Channel Information, junto com os seguidores
  const [c, lang] = await Promise.all([toChannel(u), channelLang(u.id)]);
  return { ...c, lang: c.lang ?? lang };
}

export async function search(q: string): Promise<Channel[]> {
  const r = await helix('search/channels', [['query', q], ['first', '6']]);
  return Promise.all(r.data.map(toChannel));
}

/** Get Streams: até 100 canais por chamada. Quem não volta está offline; lote que falha fica em unknown. */
export async function fetchLive(ids: string[]): Promise<FetchResult> {
  const out: FetchResult = { live: new Map(), ended: new Map(), unknown: new Set() };
  // id fora do formato derrubaria o lote inteiro: nem vai para a API (fica offline)
  for (const part of chunk(ids.filter(id => CHANNEL_ID.twitch.test(id)), 100)) {
    try {
      const r = await helix('streams', [...part.map((id): [string, string] => ['user_id', id]), ['first', '100']]);
      for (const s of r.data) {
        if (s.type !== 'live') continue;
        out.live.set(s.user_id, {
          viewers: s.viewer_count,
          title: s.title,
          cat: s.game_name || '',
          thumb: s.thumbnail_url ? s.thumbnail_url.replace('{width}', '440').replace('{height}', '248') : null,
          lang: langCode(s.language),
          startedAt: s.started_at,
          url: `https://www.twitch.tv/${s.user_login}`,
          name: s.user_name,
        });
      }
    } catch (e) {
      part.forEach(id => out.unknown.add(id));
      console.warn(`[twitch] status de ${part.length} canais:`, (e as Error).message);
    }
  }
  return out;
}

/** Fim de um VOD: created_at (início da live) + duration ("3h8m33s"), no máximo agora. Duração ilegível: o início. */
export function vodEnd(createdAt: string, duration: unknown, now: number): string {
  const start = Date.parse(createdAt);
  const m = typeof duration === 'string' && duration ? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(duration) : null;
  if (!m || !Number.isFinite(start)) return createdAt;
  const secs = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return new Date(Math.min(now, start + secs * 1000)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Fim da última live gravada, para o "ao vivo há X" de quem acabou de ser adicionado. */
export async function lastLiveAt(id: string): Promise<string | null> {
  try {
    const v = (await helix('videos', [['user_id', id], ['type', 'archive'], ['first', '1']])).data[0];
    return v?.created_at ? vodEnd(v.created_at, v.duration, Date.now()) : null;
  } catch {
    return null;
  }
}

/** Foto de perfil dos canais (a Get Streams não traz). Todo id consultado entra no resultado: null = sem foto. */
export async function avatars(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const part of chunk(ids, 100)) {
    const r = await helix('users', part.map((id): [string, string] => ['id', id]));
    for (const id of part) out.set(id, null);
    for (const u of r.data) out.set(u.id, u.profile_image_url || null);
  }
  return out;
}

const MAX_PAGES = 1000;

/**
 * Uma página da varredura. 5xx, tempo esgotado e erro de rede tentam de novo (até 2 vezes, depois de 1 e 2 s):
 * a varredura tem até 1.000 páginas, e uma falha a recomeçaria do zero. 4xx (e o 429 que já esperou o balde), não.
 */
async function streamsPage(params: [string, string][]): Promise<any> {
  for (let tries = 0; ; tries++) {
    try {
      return await helix('streams', params, undefined, 3, true);
    } catch (e) {
      if (tries >= 2 || (e instanceof HttpError && e.status < 500)) throw e;
      await sleep(1000 * (tries + 1));
    }
  }
}

/**
 * Todas as lives da Twitch nas línguas pedidas (nenhuma = todas), do mais assistido para o menos.
 * Get Streams pagina de 100 em 100 (só em português são ~90 páginas), então cada página é entregue
 * a `onPage` assim que chega. A varredura cede a vez ao polling dos seguidos quando o limite aperta.
 */
export async function crawlLive(langs: string[], onPage: (items: BrowseItem[]) => void): Promise<void> {
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: [string, string][] = [['first', '100'], ...langs.map((l): [string, string] => ['language', l])];
    if (cursor) params.push(['after', cursor]);
    const r = await streamsPage(params);
    onPage(r.data.filter((s: any) => s.type === 'live').map((s: any): BrowseItem => ({
      key: `twitch:${s.user_id}`,
      platform: 'twitch',
      channelId: s.user_id,
      login: s.user_login,
      name: s.user_name,
      avatar: null,
      viewers: s.viewer_count,
      title: s.title,
      cat: s.game_name || '',
      thumb: s.thumbnail_url ? s.thumbnail_url.replace('{width}', '440').replace('{height}', '248') : null,
      lang: langCode(s.language) ?? '',
      url: `https://www.twitch.tv/${s.user_login}`,
    })));
    cursor = r.pagination?.cursor ?? '';
    if (!cursor) return;
  }
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

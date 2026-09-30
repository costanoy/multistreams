export type Platform = 'twitch' | 'youtube' | 'kick';
export const PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick'];

/** Canal como o app cadastra. key = `${platform}:${channelId}`. */
export interface Channel {
  key: string;
  platform: Platform;
  /** Twitch: id numérico · YouTube: UC… · Kick: slug */
  channelId: string;
  /** Twitch: login · YouTube: @handle (ou '') · Kick: slug */
  login: string;
  name: string;
  avatar: string | null;
  followers: number | null;
  lang: string | null;
}

/** O que o polling descobre sobre uma live em andamento. */
export interface Live {
  viewers: number;
  title: string;
  cat: string;
  thumb: string | null;
  lang: string | null;
  startedAt: string | null;
  url: string;
  name?: string;
}

export interface Status {
  live: boolean;
  viewers: number;
  title: string;
  cat: string;
  thumb: string | null;
  lang: string | null;
  startedAt: string | null;
  lastLiveAt: string | null;
  url: string | null;
  checkedAt: string;
}

/** Uma live qualquer da plataforma, para a lista "tudo ao vivo". */
export interface BrowseItem {
  key: string;
  platform: Platform;
  channelId: string;
  login: string;
  name: string;
  avatar: string | null;
  viewers: number;
  title: string;
  cat: string;
  thumb: string | null;
  lang: string;
  url: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${new URL(url).host}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export const langCode = (l: unknown): string | null =>
  typeof l === 'string' && /^[a-z]{2}/i.test(l) ? l.slice(0, 2).toLowerCase() : null;

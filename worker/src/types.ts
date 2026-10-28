export type Platform = 'twitch' | 'youtube' | 'kick';
export const PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick'];

/** Formato do id de cada plataforma (Kick: o slug, em minúsculas, até 25 caracteres como a API aceita). */
export const CHANNEL_ID: Record<Platform, RegExp> = {
  twitch: /^\d{1,20}$/,
  youtube: /^UC[\w-]{22}$/,
  kick: /^[a-z0-9_-]{1,25}$/,
};

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
  /** estreia do YouTube (vídeo gravado exibido como live): aparece ao vivo, mas não gera push */
  premiere?: boolean;
}

/** Resultado de uma rodada de polling. Chaves = id do canal na plataforma. */
export interface FetchResult {
  live: Map<string, Live>;
  /** fim da live mais recente vista em cada canal */
  ended: Map<string, string>;
  /** canais que não deu para conferir nesta rodada: o registry mantém o status anterior */
  unknown: Set<string>;
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
  /** id da categoria na Kick (para pedir mais lives daquela categoria) */
  catId?: number;
}

const catKeys = new Map<string, string>();

/**
 * Chave para juntar a mesma categoria entre plataformas: "Grand Theft Auto V (GTA)" = "Grand Theft Auto V".
 * Guardada por nome: os nomes distintos são poucos milhares, e a lista recalcula a chave de cada live.
 */
export const catKey = (name: string): string => {
  let k = catKeys.get(name);
  if (k === undefined) {
    k = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (catKeys.size >= 5000) catKeys.clear();
    catKeys.set(name, k);
  }
  return k;
};

export class HttpError extends Error {
  /** body = começo da resposta (o YouTube diz ali o motivo do 403, como quotaExceeded) */
  constructor(public status: number, message: string, public body = '') {
    super(message);
  }
}

/** onRes recebe a resposta antes da leitura, mesmo com erro (a Twitch manda o limite nos cabeçalhos). */
export async function getJson<T = any>(url: string, init?: RequestInit, onRes?: (res: Response) => void): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  onRes?.(res);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 2000);
    throw new HttpError(res.status, `${res.status} ${new URL(url).host}: ${body.slice(0, 200)}`, body);
  }
  return res.json() as Promise<T>;
}

export const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Línguas que o app oferece (cópia da LANG_TABLE de client/src/theme.ts). */
export const LANG_CODES: ReadonlySet<string> = new Set([
  'pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'tr', 'pl', 'nl', 'sv', 'no', 'da', 'fi', 'cs',
  'sk', 'hu', 'ro', 'bg', 'el', 'uk', 'he', 'th', 'vi', 'id', 'ms', 'tl', 'ca', 'hr', 'sr', 'sl', 'lt', 'lv', 'et', 'fa',
  'bn', 'ta', 'te', 'ur', 'sw', 'af', 'is', 'ka', 'kk', 'az',
]);

/** Códigos que as plataformas usam no lugar do de 2 letras (filipino, hebraico antigo, norueguês…). */
const LANG_ALIAS = new Map([['fil', 'tl'], ['iw', 'he'], ['in', 'id'], ['ji', 'yi'], ['nb', 'no'], ['nn', 'no']]);

/** Código de 2 letras da língua ('pt-BR' → 'pt', 'fil' → 'tl'); null se não houver um ('other', 'zxx'). */
export const langCode = (l: unknown): string | null => {
  if (typeof l !== 'string') return null;
  const p = l.toLowerCase().split(/[-_]/)[0];
  const c = LANG_ALIAS.get(p) ?? p;
  return /^[a-z]{2}$/.test(c) ? c : null;
};

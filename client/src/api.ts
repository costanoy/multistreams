import { PLAT, Plat } from './theme';

const BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/** Canal como o worker devolve em /resolve e /search. */
export interface Channel {
  key: string;
  platform: Plat;
  channelId: string;
  login: string;
  name: string;
  avatar: string | null;
  followers: number | null;
  lang: string | null;
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

export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) throw new ApiError('no_api');
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) throw new ApiError((await res.json().catch(() => null))?.error ?? 'upstream_error');
  return res.json();
}

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const resolveChannel = (platform: Plat, name: string) => call<Channel>(`/resolve?${qs({ platform, name })}`);
export const searchChannels = (platform: Plat, q: string) => call<Channel[]>(`/search?${qs({ platform, q })}`);
export const fetchStatus = (keys: string[]) =>
  call<{ at: string; channels: Record<string, Status> }>('/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  });

/** Uma live qualquer da plataforma, para a lista "tudo ao vivo". */
export interface BrowseItem {
  key: string;
  platform: Plat;
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

export type Sort = 'desc' | 'asc';

const filterQs = (platforms: Plat[], langs: string[], cats: string[] = []) => {
  const q = new URLSearchParams({ platforms: platforms.join(','), langs: langs.join(',') });
  cats.forEach(c => q.append('cat', c));
  return q;
};

/** Uma página de "tudo ao vivo". `partial` = o worker ainda está varrendo alguma plataforma. */
export const fetchBrowse = (platforms: Plat[], langs: string[], cats: string[], sort: Sort, offset: number, limit: number) => {
  const q = filterQs(platforms, langs, cats);
  q.set('sort', sort);
  q.set('offset', String(offset));
  q.set('limit', String(limit));
  return call<{ at: string; total: number; partial: boolean; items: BrowseItem[] }>(`/browse?${q}`);
};

export interface Category {
  key: string;
  name: string;
  viewers: number;
  lives: number;
  platforms: Plat[];
}

/** Categorias de quem está ao vivo agora (jogos, IRL, Just Chatting…), das mais assistidas para as menos. */
export const fetchCategories = (platforms: Plat[], langs: string[]) =>
  call<{ partial: boolean; items: Category[] }>(`/categories?${filterQs(platforms, langs)}`);

export const errorText =(e: unknown, plat?: Plat) => {
  const code = e instanceof ApiError ? e.code : '';
  if (code === 'platform_not_configured' && plat) return `${PLAT[plat].label} ainda não está configurada no servidor.`;
  if (code === 'no_api') return 'Servidor não configurado (EXPO_PUBLIC_API_URL).';
  if (code === 'network') return 'Sem conexão com o servidor.';
  return 'Não deu para consultar agora. Tente de novo.';
};

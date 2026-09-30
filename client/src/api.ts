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

export const fetchBrowse = (platforms: Plat[], langs: string[]) =>
  call<{ at: string; items: BrowseItem[] }>(`/browse?${qs({ platforms: platforms.join(','), langs: langs.join(',') })}`);

export const errorText =(e: unknown, plat?: Plat) => {
  const code = e instanceof ApiError ? e.code : '';
  if (code === 'platform_not_configured' && plat) return `${PLAT[plat].label} ainda não está configurada no servidor.`;
  if (code === 'no_api') return 'Servidor não configurado (EXPO_PUBLIC_API_URL).';
  if (code === 'network') return 'Sem conexão com o servidor.';
  return 'Não deu para consultar agora. Tente de novo.';
};

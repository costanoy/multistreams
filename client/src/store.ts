import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { BrowseItem, Status, fetchBrowse, fetchStatus } from './api';
import { DEFAULT_LANGS, LANGS, LANG_ORDER, PLAT, PLATS, Plat, SkinKey, ago } from './theme';

export interface Streamer {
  /** `${plat}:${channelId}` */
  id: string;
  plat: Plat;
  channelId: string;
  login: string;
  name: string;
  avatar: string | null;
  /** idioma cadastrado: fallback quando a plataforma não informa o da live */
  lang: string;
  notify: boolean;
}

export type Provider = 'twitch' | 'google';

interface State {
  hydrated: boolean;
  onboarded: boolean;
  streams: Streamer[];
  statuses: Record<string, Status>;
  statusAt: number | null;
  netDown: boolean;
  langs: string[];
  /** plataformas que aparecem em Ao vivo (mínimo 1) */
  platforms: Plat[];
  /** Ao vivo mostra só a lista do usuário, em vez de tudo que está no ar */
  onlyFollowed: boolean;
  /** tudo que está ao vivo nas plataformas e línguas marcadas, por viewers */
  browse: BrowseItem[];
  browseAt: number | null;
  skin: SkinKey;
  notifyAll: boolean;
  account: { provider: Provider; userId: string } | null;
  /** tokens das plataformas para importar seguidos (só em memória) */
  providerTokens: Partial<Record<Provider, string>>;
  toast: string | null;

  showToast: (msg: string) => void;
  addStreamers: (list: Omit<Streamer, 'notify'>[]) => number;
  removeStreamer: (id: string) => void;
  toggleNotify: (id: string) => void;
  setStreamerLang: (id: string, lang: string) => void;
  toggleLang: (k: string) => void;
  togglePlatform: (p: Plat) => void;
  refresh: () => Promise<boolean>;
  refreshBrowse: () => Promise<boolean>;
}

let browseSeq = 0;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      hydrated: false,
      onboarded: false,
      streams: [],
      statuses: {},
      statusAt: null,
      netDown: false,
      langs: DEFAULT_LANGS,
      platforms: PLATS,
      onlyFollowed: false,
      browse: [],
      browseAt: null,
      skin: 'prata',
      notifyAll: true,
      account: null,
      providerTokens: {},
      toast: null,

      showToast: msg => {
        set({ toast: msg });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => set({ toast: null }), 2200);
      },
      addStreamers: list => {
        const have = new Set(get().streams.map(s => s.id));
        const fresh = list.filter(s => !have.has(s.id)).map(s => ({ ...s, notify: true }));
        if (fresh.length) {
          set(s => ({ streams: [...s.streams, ...fresh] }));
          void get().refresh();
        }
        return fresh.length;
      },
      removeStreamer: id =>
        set(s => {
          const { [id]: _, ...statuses } = s.statuses;
          return { streams: s.streams.filter(x => x.id !== id), statuses };
        }),
      toggleNotify: id => set(s => ({ streams: s.streams.map(x => (x.id === id ? { ...x, notify: !x.notify } : x)) })),
      setStreamerLang: (id, lang) => set(s => ({ streams: s.streams.map(x => (x.id === id ? { ...x, lang } : x)) })),
      toggleLang: k => {
        const { langs, showToast } = get();
        if (!langs.includes(k)) return set({ langs: [...langs, k] });
        if (langs.length === 1) return showToast('Mantenha pelo menos uma língua marcada');
        set({ langs: langs.filter(x => x !== k) });
      },
      togglePlatform: p => {
        const { platforms, showToast } = get();
        if (!platforms.includes(p)) return set({ platforms: PLATS.filter(x => x === p || platforms.includes(x)) });
        if (platforms.length === 1) return showToast('Mantenha pelo menos uma plataforma marcada');
        set({ platforms: platforms.filter(x => x !== p) });
      },
      refreshBrowse: async () => {
        const seq = ++browseSeq;
        const { platforms, langs } = get();
        try {
          const r = await fetchBrowse(platforms, langs);
          // só vale a resposta do pedido mais recente (os filtros podem ter mudado no caminho)
          if (seq === browseSeq) set({ browse: r.items, browseAt: Date.now(), netDown: false });
          return true;
        } catch {
          if (seq === browseSeq) set({ netDown: true });
          return false;
        }
      },
      refresh: async () => {
        const keys = get().streams.map(s => s.id);
        if (!keys.length) {
          set({ netDown: false });
          return true;
        }
        try {
          const r = await fetchStatus(keys);
          set(s => ({ statuses: { ...s.statuses, ...r.channels }, statusAt: Date.now(), netDown: false }));
          return true;
        } catch {
          set({ netDown: true });
          return false;
        }
      },
    }),
    {
      name: 'multistreams',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({ onboarded: s.onboarded, streams: s.streams, statuses: s.statuses, statusAt: s.statusAt, langs: s.langs, platforms: s.platforms, onlyFollowed: s.onlyFollowed, skin: s.skin, notifyAll: s.notifyAll }),
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
);

/** Streamer + status ao vivo, pronto para as telas. */
export interface Item extends Streamer {
  status: Status | undefined;
  live: boolean;
  viewers: number;
  /** idioma efetivo: o da live, se a plataforma informou um que conhecemos; senão o cadastrado */
  effLang: string;
  offTxt: string;
}

export const decorate = (st: Streamer, status: Status | undefined): Item => {
  const live = !!status?.live;
  return {
    ...st,
    status,
    live,
    viewers: live ? status!.viewers : 0,
    effLang: live && status!.lang && LANGS[status!.lang] ? status!.lang : st.lang,
    offTxt: !status ? 'verificando status…' : status.lastLiveAt ? `ao vivo ${ago(status.lastLiveAt)}` : 'offline',
  };
};

export function useLists() {
  const streams = useStore(s => s.streams);
  const statuses = useStore(s => s.statuses);
  const langs = useStore(s => s.langs);
  const items = streams.map(st => decorate(st, statuses[st.id]));
  const allLive = items.filter(x => x.live).sort((a, b) => b.viewers - a.viewers);
  const offline = items
    .filter(x => !x.live)
    .sort((a, b) => (b.status ? b.status.lastLiveAt ?? '0' : '9').localeCompare(a.status ? a.status.lastLiveAt ?? '0' : '9'));
  return {
    /** ao vivo nas línguas marcadas, por viewers */
    live: allLive.filter(x => langs.includes(x.effLang)),
    allLive,
    offline,
    all: [...allLive, ...offline],
  };
}

/** Uma linha da aba Ao vivo, venha ela da lista do usuário ou de "tudo ao vivo". */
export interface LiveCard {
  id: string;
  plat: Plat;
  name: string;
  title: string;
  cat: string;
  thumb: string | null;
  viewers: number;
  lang: string;
  /** só existe quando o canal está na lista do usuário */
  followed?: Item;
  url: string | null;
}

/** O que a aba Ao vivo mostra agora, já filtrado por língua e plataforma e ordenado por viewers. */
export function useLiveCards(): LiveCard[] {
  const { live } = useLists();
  const browse = useStore(s => s.browse);
  const langs = useStore(s => s.langs);
  const platforms = useStore(s => s.platforms);
  const onlyFollowed = useStore(s => s.onlyFollowed);
  if (onlyFollowed) {
    return live
      .filter(x => platforms.includes(x.plat))
      .map(x => ({ id: x.id, plat: x.plat, name: x.name, title: x.status!.title, cat: x.status!.cat, thumb: x.status!.thumb, viewers: x.viewers, lang: x.effLang, followed: x, url: x.status!.url }));
  }
  const mine = new Map(live.map(x => [x.id, x]));
  return browse
    .filter(b => platforms.includes(b.platform) && langs.includes(b.lang))
    .map(b => ({ id: b.key, plat: b.platform, name: b.name, title: b.title, cat: b.cat, thumb: b.thumb, viewers: b.viewers, lang: b.lang, followed: mine.get(b.key), url: b.url }));
}

export const platSummary = (platforms: Plat[]) =>
  platforms.length === PLATS.length ? 'Todas' : PLATS.filter(p => platforms.includes(p)).map(p => PLAT[p].label).join(', ');

export const langSummary =(langs: string[]) => {
  const codes = LANG_ORDER.filter(k => langs.includes(k)).map(x => x.toUpperCase());
  return codes.length === LANG_ORDER.length ? 'Todas' : codes.length > 3 ? codes.slice(0, 2).join(', ') + ' +' + (codes.length - 2) : codes.join(', ');
};

export const addedToast = (name: string, plat: Plat) => `${name} adicionado · ${PLAT[plat].label}`;

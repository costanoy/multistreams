import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Status, fetchStatus } from './api';
import { DEFAULT_LANGS, LANGS, LANG_ORDER, PLAT, Plat, SkinKey, ago } from './theme';

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
  refresh: () => Promise<boolean>;
}

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
      partialize: s => ({ onboarded: s.onboarded, streams: s.streams, statuses: s.statuses, statusAt: s.statusAt, langs: s.langs, skin: s.skin, notifyAll: s.notifyAll }),
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

export const langSummary = (langs: string[]) => {
  const codes = LANG_ORDER.filter(k => langs.includes(k)).map(x => x.toUpperCase());
  return codes.length === LANG_ORDER.length ? 'Todas' : codes.length > 3 ? codes.slice(0, 2).join(', ') + ' +' + (codes.length - 2) : codes.join(', ');
};

export const addedToast = (name: string, plat: Plat) => `${name} adicionado · ${PLAT[plat].label}`;

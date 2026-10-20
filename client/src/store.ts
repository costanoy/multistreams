import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { BrowseItem, Status, fetchBrowse, fetchStatus } from './api';
import { DEFAULT_LANGS, LANGS, LANG_ORDER, PLAT, PLATS, Plat, SkinKey, ago, catKey } from './theme';

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

/** Modo da aba Ao vivo. */
export type View = 'desc' | 'asc' | 'following';

/** Tamanho de cada página da lista infinita. */
export const PAGE = 50;

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
  view: View;
  /** categorias marcadas (nomes); vazio = todas */
  cats: string[];
  /** páginas já carregadas de "tudo ao vivo" (na ordem do modo atual) */
  browse: BrowseItem[];
  /** quantas lives existem no total com os filtros atuais */
  browseTotal: number;
  /** o worker ainda está varrendo alguma plataforma: a lista vai crescer */
  browsePartial: boolean;
  browseAt: number | null;
  browseLoading: boolean;
  skin: SkinKey;
  notifyAll: boolean;
  /** sons de toque e liga/desliga (ligados por padrão) */
  uiSounds: boolean;
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
  toggleCat: (name: string) => void;
  refresh: () => Promise<boolean>;
  /** recarrega "tudo ao vivo": `reset` volta ao topo; senão atualiza o que já está carregado */
  refreshBrowse: (reset?: boolean) => Promise<boolean>;
  loadMore: () => Promise<void>;
}

let browseSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const dedupe = (items: BrowseItem[]) => {
  const seen = new Set<string>();
  return items.filter(i => !seen.has(i.key) && !!seen.add(i.key));
};

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
      view: 'desc',
      cats: [],
      browse: [],
      browseTotal: 0,
      browsePartial: false,
      browseAt: null,
      browseLoading: false,
      skin: 'prata',
      notifyAll: true,
      uiSounds: true,
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
      toggleCat: name => {
        const k = catKey(name);
        const { cats } = get();
        set({ cats: cats.some(c => catKey(c) === k) ? cats.filter(c => catKey(c) !== k) : [...cats, name] });
      },
      refreshBrowse: async reset => {
        const seq = ++browseSeq;
        const { platforms, langs, cats, view, browse } = get();
        if (view === 'following') return true;
        // atualizar sem voltar ao topo: relê o que já estava carregado (até um limite)
        const limit = reset ? PAGE : Math.min(Math.max(PAGE, browse.length), 200);
        if (reset) set({ browse: [], browseTotal: 0, browseAt: null });
        set({ browseLoading: true });
        try {
          const r = await fetchBrowse(platforms, langs, cats, view, 0, limit);
          // só vale a resposta do pedido mais recente (os filtros podem ter mudado no caminho)
          if (seq !== browseSeq) return true;
          const rest = reset ? [] : get().browse.slice(limit);
          set({ browse: dedupe([...r.items, ...rest]), browseTotal: r.total, browsePartial: r.partial, browseAt: Date.now(), netDown: false, browseLoading: false });
          return true;
        } catch {
          if (seq === browseSeq) set({ netDown: true, browseLoading: false });
          return false;
        }
      },
      loadMore: async () => {
        const { platforms, langs, cats, view, browse, browseTotal, browseLoading } = get();
        if (view === 'following' || browseLoading || browse.length >= browseTotal) return;
        const seq = browseSeq;
        set({ browseLoading: true });
        try {
          const r = await fetchBrowse(platforms, langs, cats, view, browse.length, PAGE);
          if (seq !== browseSeq) return;
          set(s => ({ browse: dedupe([...s.browse, ...r.items]), browseTotal: r.total, browsePartial: r.partial, browseLoading: false }));
        } catch {
          if (seq === browseSeq) set({ browseLoading: false });
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
      // v1: os sons dos botões passaram a vir ligados; quem tinha o padrão antigo (desligado) recebe o novo
      version: 1,
      migrate: (old, from) => (from < 1 ? { ...(old as object), uiSounds: true } : old) as State,
      partialize: s => ({ onboarded: s.onboarded, streams: s.streams, statuses: s.statuses, statusAt: s.statusAt, langs: s.langs, platforms: s.platforms, view: s.view, cats: s.cats, skin: s.skin, notifyAll: s.notifyAll, uiSounds: s.uiSounds }),
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
  /** foto do canal; sem ela, aparece a inicial do nome */
  avatar: string | null;
  title: string;
  cat: string;
  thumb: string | null;
  viewers: number;
  lang: string;
  /** só existe quando o canal está na lista do usuário */
  followed?: Item;
  url: string | null;
}

/** O que a aba Ao vivo mostra agora, já filtrado por língua e plataforma e na ordem do modo. */
export function useLiveCards(): LiveCard[] {
  const { live } = useLists();
  const browse = useStore(s => s.browse);
  const langs = useStore(s => s.langs);
  const platforms = useStore(s => s.platforms);
  const view = useStore(s => s.view);
  const cats = useStore(s => s.cats);
  const want = new Set(cats.map(catKey));
  const inCats = (cat: string) => !want.size || want.has(catKey(cat));
  if (view === 'following') {
    return live
      .filter(x => platforms.includes(x.plat) && inCats(x.status!.cat))
      .map(x => ({ id: x.id, plat: x.plat, name: x.name, avatar: x.avatar, title: x.status!.title, cat: x.status!.cat, thumb: x.status!.thumb, viewers: x.viewers, lang: x.effLang, followed: x, url: x.status!.url }));
  }
  const mine = new Map(live.map(x => [x.id, x]));
  return browse
    .filter(b => platforms.includes(b.platform) && langs.includes(b.lang) && inCats(b.cat))
    .map(b => ({ id: b.key, plat: b.platform, name: b.name, avatar: b.avatar ?? mine.get(b.key)?.avatar ?? null, title: b.title, cat: b.cat, thumb: b.thumb, viewers: b.viewers, lang: b.lang, followed: mine.get(b.key), url: b.url }));
}

/** Quantas lives há no modo atual (no "tudo ao vivo", o total do worker, não só o que já carregou). */
export function useLiveTotal(): number {
  const cards = useLiveCards();
  const view = useStore(s => s.view);
  const total = useStore(s => s.browseTotal);
  return view === 'following' ? cards.length : Math.max(total, cards.length);
}

export const platSummary = (platforms: Plat[]) =>
  platforms.length === PLATS.length ? 'Todas' : PLATS.filter(p => platforms.includes(p)).map(p => PLAT[p].label).join(', ');

export const langSummary = (langs: string[]) => {
  const codes = LANG_ORDER.filter(k => langs.includes(k)).map(x => x.toUpperCase());
  return codes.length === LANG_ORDER.length ? 'Todas' : codes.length > 3 ? codes.slice(0, 2).join(', ') + ' +' + (codes.length - 2) : codes.join(', ');
};

export const catSummary = (cats: string[]) => (!cats.length ? 'Categorias' : cats.length === 1 ? cats[0] : `${cats[0]} +${cats.length - 1}`);

export const addedToast =(name: string, plat: Plat) => `${name} adicionado · ${PLAT[plat].label}`;

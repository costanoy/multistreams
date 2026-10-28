import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { PersistStorage, createJSONStorage, persist } from 'zustand/middleware';
import { ApiError, BrowseItem, Status, fetchBrowse, fetchStatus } from './api';
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

/** Como foi a última consulta: false = respondeu; 'offline' = sem rede; 'server' = o servidor falhou ou demorou demais. */
export type Down = false | 'offline' | 'server';

/** Tamanho de cada página da lista infinita. */
export const PAGE = 50;

/** Status mais velho que isso (ou de uma consulta que falhou) aparece como desatualizado. */
export const STALE_MS = 5 * 60_000;

interface State {
  hydrated: boolean;
  onboarded: boolean;
  streams: Streamer[];
  statuses: Record<string, Status>;
  statusAt: number | null;
  /** último /status */
  statusDown: Down;
  /** última atualização do topo de "tudo ao vivo" (a falha do "carregar mais" fica em browseMoreError) */
  browseDown: Down;
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
  /** null enquanto a lista dos filtros novos não chega (a anterior continua em browse) */
  browseAt: number | null;
  /** modo, plataformas, línguas e categorias da lista que está em browse */
  browseKey: string | null;
  browseLoading: boolean;
  /** o último "carregar mais" falhou: a lista não pede mais sozinha até retryMore */
  browseMoreError: boolean;
  skin: SkinKey;
  notifyAll: boolean;
  /** sons de toque e liga/desliga (ligados por padrão) */
  uiSounds: boolean;
  account: { provider: Provider; userId: string } | null;
  /** tokens das plataformas para importar seguidos (só em memória) */
  providerTokens: Partial<Record<Provider, string>>;
  toast: string | null;

  showToast: (msg: string) => void;
  /** `notify`: se os canais novos entram com aviso ligado */
  addStreamers: (list: Omit<Streamer, 'notify'>[], notify?: boolean) => number;
  removeStreamer: (id: string) => void;
  toggleNotify: (id: string) => void;
  setStreamerLang: (id: string, lang: string) => void;
  toggleLang: (k: string) => void;
  togglePlatform: (p: Plat) => void;
  toggleCat: (name: string) => void;
  refresh: () => Promise<boolean>;
  /** recarrega "tudo ao vivo": `reset` volta ao topo; senão atualiza o que já está carregado */
  refreshBrowse: (reset?: boolean) => Promise<boolean>;
  /** ao abrir a tela: com os mesmos filtros mantém a lista (e só atualiza se tiver mais de 30 s); com outros, volta ao topo */
  ensureBrowse: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** limpa o erro do "carregar mais" e tenta de novo */
  retryMore: () => void;
}

/** /status em lotes (o worker atende até 2.000 chaves por pedido; o de antes, 500), 2 pedidos de cada vez. */
const STATUS_BATCH = 200;
const STATUS_PARALLEL = 2;
/** Canal que voltou sem status (o worker ainda está na primeira consulta): pede de novo logo, poucas vezes. */
const RETRY_MS = 8000;
const RETRIES = 3;
const retries = new Map<string, number>();
const retryKeys = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** A atualização de "tudo ao vivo" relê a faixa carregada em páginas deste tamanho (o máximo do worker). */
const BROWSE_MAX = 200;
/** Até aqui a faixa é relida (5 pedidos no máximo); quem rolou além disso mantém o resto como veio. */
const BROWSE_REREAD = 1000;
/** Ao abrir a tela com os mesmos filtros, uma lista mais nova que isso nem é atualizada. */
const BROWSE_FRESH_MS = 30_000;
/** Muda a cada volta ao topo: o que foi pedido antes é descartado. */
let browseGen = 0;
/** pedido do topo da lista a caminho (volta ao topo ou atualização) */
let topJob: { key: string; p: Promise<boolean> } | null = null;
/** "carregar mais" a caminho */
let moreJob: { gen: number } | null = null;
/** pediram mais antes de a lista dos filtros atuais chegar: carrega quando ela chegar */
let moreWanted = false;
const busy = () => !!topJob || !!moreJob;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

const dedupe = (items: BrowseItem[]) => {
  const seen = new Set<string>();
  return items.filter(i => !seen.has(i.key) && !!seen.add(i.key));
};

/** Filtros de "tudo ao vivo", sem depender da ordem em que foram marcados. */
const browseKeyOf = (s: Pick<State, 'view' | 'platforms' | 'langs' | 'cats'>) =>
  `${s.view}|${[...s.platforms].sort().join()}|${[...s.langs].sort().join()}|${s.cats.map(catKey).sort().join('|')}`;

const downOf = (e: unknown): Down => (e instanceof ApiError && e.code === 'network' ? 'offline' : 'server');

/** Mesmos campos com os mesmos valores (comparação rasa); `skip` fica de fora. */
const sameFields = (a: object, b: object, skip?: string) => {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(k => k === skip || x[k] === y[k]);
};
/** O worker renova checkedAt a cada consulta: sem ele, dá para saber se o status mudou de fato. */
const sameStatus = (a: Status, b: Status) => sameFields(a, b, 'checkedAt');

/**
 * O worker esquece o canal que ninguém pede há 2 dias e, quando volta a acompanhá-lo, não sabe da última live
 * (a Kick nunca informa o fim): offline sem lastLiveAt fica com a última live (e a língua) que o app já sabia.
 */
const keepLastLive = (prev: Status | undefined, next: Status | undefined) =>
  next && prev?.lastLiveAt && !next.live && !next.lastLiveAt ? { ...next, lastLiveAt: prev.lastLiveAt, lang: next.lang ?? prev.lang } : next;

// ---- gravação no aparelho ----

const NAME = 'multistreams';
const VERSION = 1;

/** O que fica salvo no aparelho. */
const saved = (s: State) => ({ onboarded: s.onboarded, streams: s.streams, statuses: s.statuses, statusAt: s.statusAt, langs: s.langs, platforms: s.platforms, view: s.view, cats: s.cats, skin: s.skin, notifyAll: s.notifyAll, uiSounds: s.uiSounds });
type Saved = ReturnType<typeof saved>;

/** Status chegam a cada minuto: a gravação deles espera um pouco e sai numa vez só. */
const SAVE_MS = 3000;
const json = createJSONStorage<Saved>(() => AsyncStorage)!;
/** o que está gravado agora, campo a campo (por referência) */
let written: Saved | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const changedKeys = (a: Saved, b: Saved) => (Object.keys(a) as (keyof Saved)[]).filter(k => a[k] !== b[k]);

/** Grava o estado atual, se algo salvo mudou desde a última gravação. */
function save() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!useStore.getState().hydrated) return;
  const state = saved(useStore.getState());
  if (written && !changedKeys(state, written).length) return;
  written = state;
  void json.setItem(NAME, { state, version: VERSION });
}

/**
 * O persist do zustand grava o estado salvo inteiro a cada set(). Aqui só grava quando algo salvo mudou:
 * escolhas da pessoa vão na hora (outra aba relê), status esperam SAVE_MS, e a hora do último status vai
 * junto com a próxima gravação ou quando o app sai da frente.
 */
const storage: PersistStorage<Saved> = {
  getItem: name => json.getItem(name),
  setItem: (_name, { state }) => {
    // antes de carregar o que está salvo, gravar apagaria tudo
    if (!useStore.getState().hydrated) return;
    if (!written) return save();
    const diff = changedKeys(state, written);
    if (diff.every(k => k === 'statusAt')) return;
    if (diff.every(k => k === 'statuses' || k === 'statusAt')) {
      saveTimer ??= setTimeout(save, SAVE_MS);
      return;
    }
    save();
  },
  removeItem: name => json.removeItem(name),
};

/** Lista nova com os mesmos objetos onde nada mudou (a sincronização com a conta só envia o que mudou). */
const shareStreams = (cur: Streamer[], next: Streamer[]) => {
  const old = new Map(cur.map(x => [x.id, x]));
  const out = next.map(x => {
    const o = old.get(x.id);
    return o && sameFields(o, x) ? o : x;
  });
  return out.length === cur.length && out.every((x, i) => x === cur[i]) ? cur : out;
};

/** O mesmo array se o conteúdo não mudou (o JSON de outra aba traz sempre um novo): nada redesenha nem volta para a conta. */
const keepList = <T>(cur: T[], next: T[] | undefined) =>
  !next || (next.length === cur.length && next.every((x, i) => x === cur[i])) ? cur : next;

/** Por canal, o status mais novo das duas abas (pelo checkedAt do worker). */
const newestStatuses = (cur: Record<string, Status>, next: Record<string, Status>, streams: Streamer[]) => {
  const out: Record<string, Status> = {};
  for (const { id } of streams) {
    const a = cur[id], b = next[id];
    const v = !a ? b : !b || sameStatus(a, b) || a.checkedAt >= b.checkedAt ? a : b;
    if (v) out[id] = v;
  }
  const keys = Object.keys(out);
  return keys.length === Object.keys(cur).length && keys.every(k => out[k] === cur[k]) ? cur : out;
};

/** Junta o que está gravado. Vindo de outra aba: cada aba fica no seu modo, e o que não mudou continua o mesmo objeto. */
const merge = (persisted: unknown, cur: State): State => {
  const p = persisted as Partial<Saved> | undefined;
  if (!p) return cur;
  if (!cur.hydrated) return { ...cur, ...p };
  const streams = p.streams ? shareStreams(cur.streams, p.streams) : cur.streams;
  return {
    ...cur,
    ...p,
    view: cur.view,
    streams,
    langs: keepList(cur.langs, p.langs),
    platforms: keepList(cur.platforms, p.platforms),
    cats: keepList(cur.cats, p.cats),
    statuses: p.statuses ? newestStatuses(cur.statuses, p.statuses, streams) : cur.statuses,
    statusAt: Math.max(cur.statusAt ?? 0, p.statusAt ?? 0) || null,
  };
};

export const useStore = create<State>()(
  persist(
    (set, get) => {
      /** Troca o status das chaves pedidas pelo que voltou (o mesmo objeto se nada mudou) e apaga o das que não voltaram. */
      const applyStatuses = (st: State, done: [string[], Record<string, Status>][]) => {
        const have = new Set(st.streams.map(x => x.id));
        let out = st.statuses;
        for (const [keys, got] of done) {
          for (const k of keys) {
            const prev = out[k], next = keepLastLive(prev, got[k]);
            const v = next && prev && sameStatus(prev, next) ? prev : next;
            if (v === prev || !have.has(k)) continue;
            if (out === st.statuses) out = { ...out };
            if (v) out[k] = v;
            else delete out[k];
          }
        }
        return out;
      };

      /**
       * Pede /status em lotes, 2 de cada vez, e aplica cada grupo que responder. `main`: é a atualização de todos;
       * só marca statusAt se nenhum lote falhar (senão o status antigo do lote que falhou pareceria atual).
       * Devolve as chaves dos lotes que falharam e o tipo da falha (false se nenhum falhou).
       */
      const pull = async (keys: string[], main: boolean): Promise<{ failed: string[]; down: Down }> => {
        const batches: string[][] = [];
        for (let i = 0; i < keys.length; i += STATUS_BATCH) batches.push(keys.slice(i, i + STATUS_BATCH));
        const failed: string[] = [];
        let down: Down = false;
        for (let i = 0; i < batches.length; i += STATUS_PARALLEL) {
          const group = batches.slice(i, i + STATUS_PARALLEL);
          const res = await Promise.allSettled(group.map(b => fetchStatus(b)));
          const done: [string[], Record<string, Status>][] = [];
          for (const [j, r] of res.entries()) {
            if (r.status === 'fulfilled') done.push([group[j], r.value.channels]);
            else {
              failed.push(...group[j]);
              if (down !== 'server') down = downOf(r.reason);
            }
          }
          if (done.length) set(st => ({ statuses: applyStatuses(st, done) }));
        }
        if (main) set(down ? { statusDown: down } : { statusAt: Date.now(), statusDown: false });
        return { failed, down };
      };

      /**
       * Canais que seguem sem status depois da consulta, e os de `failed` (lote que falhou), mesmo com o status
       * de antes: pede só eles de novo em RETRY_MS, até RETRIES vezes cada.
       */
      const retryMissing = (keys: string[], failed: string[] = []) => {
        const { statuses, streams } = get();
        const have = new Set(streams.map(x => x.id));
        const lost = new Set(failed);
        for (const k of keys) {
          if ((statuses[k] && !lost.has(k)) || !have.has(k)) {
            retries.delete(k);
            retryKeys.delete(k);
            continue;
          }
          const n = retries.get(k) ?? 0;
          if (n >= RETRIES) continue;
          retries.set(k, n + 1);
          retryKeys.add(k);
        }
        if (!retryKeys.size || retryTimer) return;
        retryTimer = setTimeout(async () => {
          retryTimer = undefined;
          const again = [...retryKeys];
          retryKeys.clear();
          const { failed: still } = await pull(again, false);
          retryMissing(again, still);
        }, RETRY_MS);
      };

      return {
        hydrated: false,
        onboarded: false,
        streams: [],
        statuses: {},
        statusAt: null,
        statusDown: false,
        browseDown: false,
        langs: DEFAULT_LANGS,
        platforms: PLATS,
        view: 'desc',
        cats: [],
        browse: [],
        browseTotal: 0,
        browsePartial: false,
        browseAt: null,
        browseKey: null,
        browseLoading: false,
        browseMoreError: false,
        skin: 'prata',
        notifyAll: true,
        uiSounds: true,
        account: null,
        providerTokens: {},
        toast: null,

        showToast: msg => {
          set({ toast: msg });
          // no iOS a região de status não é lida sozinha: o VoiceOver anuncia o aviso
          if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(msg);
          clearTimeout(toastTimer);
          toastTimer = setTimeout(() => set({ toast: null }), 2200);
        },
        addStreamers: (list, notify = true) => {
          const have = new Set(get().streams.map(s => s.id));
          const fresh = list.filter(s => !have.has(s.id) && !!have.add(s.id)).map(s => ({ ...s, notify }));
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
          const s = get();
          const { platforms, langs, cats, view, browse } = s;
          if (view === 'following') return true;
          const key = browseKeyOf(s);
          // filtros novos voltam ao topo; a lista anterior fica (esmaecida) até a nova chegar. O pedido a caminho destes
          // filtros é aproveitado; o de outros (a pessoa voltou ao filtro anterior antes da resposta) é descartado
          const top = !!reset || (topJob ? topJob.key !== key : s.browseKey !== key);
          if (!top && topJob) return topJob.p;
          if (top) {
            browseGen++;
            set({ browseAt: null, browseMoreError: false });
          }
          const gen = browseGen;
          // atualizar sem voltar ao topo: relê toda a faixa já carregada, em páginas paralelas, e troca de uma vez
          const n = top ? PAGE : Math.min(Math.max(PAGE, browse.length), BROWSE_REREAD);
          const offsets: number[] = [];
          for (let o = 0; o < n; o += BROWSE_MAX) offsets.push(o);
          const p = Promise.allSettled(offsets.map(o => fetchBrowse(platforms, langs, cats, view, o, Math.min(BROWSE_MAX, n - o)))).then(res => {
            // os filtros mudaram no caminho: vale o pedido mais recente
            if (gen !== browseGen) return true;
            const first = res[0];
            if (first.status === 'rejected') {
              set({ browseDown: downOf(first.reason) });
              return false;
            }
            // se a lista do worker mudou entre as páginas, só vale até a última que bate com a primeira
            const { total, partial } = first.value;
            const fresh: BrowseItem[] = [];
            let end = 0;
            for (const [i, r] of res.entries()) {
              if (r.status === 'rejected' || r.value.total !== total) break;
              fresh.push(...r.value.items);
              end = Math.min(n, offsets[i] + BROWSE_MAX);
            }
            set(st => ({ browse: dedupe([...fresh, ...(top ? [] : st.browse.slice(end))]), browseTotal: total, browsePartial: partial, browseAt: Date.now(), browseKey: key, browseDown: false }));
            if (moreWanted) {
              moreWanted = false;
              void get().loadMore();
            }
            return true;
          });
          const job = { key, p };
          topJob = job;
          set({ browseLoading: true });
          const ok = await p;
          if (topJob === job) topJob = null;
          set({ browseLoading: busy() });
          return ok;
        },
        ensureBrowse: async () => {
          const s = get();
          if (s.view === 'following') return;
          const key = browseKeyOf(s);
          if (topJob?.key === key) {
            await topJob.p;
            return;
          }
          if (s.browseKey !== key) {
            await s.refreshBrowse(true);
            return;
          }
          if (s.browseAt === null || Date.now() - s.browseAt > BROWSE_FRESH_MS) await s.refreshBrowse();
        },
        loadMore: async () => {
          const s = get();
          const { platforms, langs, cats, view, browse } = s;
          if (view === 'following' || s.browseMoreError) return;
          if (s.browseAt === null || s.browseKey !== browseKeyOf(s)) {
            moreWanted = true;
            return;
          }
          if (moreJob?.gen === browseGen || browse.length >= s.browseTotal) return;
          const gen = browseGen;
          const job = { gen };
          moreJob = job;
          set({ browseLoading: true });
          try {
            const r = await fetchBrowse(platforms, langs, cats, view, browse.length, PAGE);
            // a atualização de fundo não descarta a página: ela só some se os filtros mudaram
            if (gen === browseGen) set(st => ({ browse: dedupe([...st.browse, ...r.items]), browseTotal: r.total, browsePartial: r.partial }));
          } catch {
            if (gen === browseGen) set({ browseMoreError: true });
          } finally {
            if (moreJob === job) moreJob = null;
            set({ browseLoading: busy() });
          }
        },
        retryMore: () => {
          set({ browseMoreError: false });
          void get().loadMore();
        },
        refresh: async () => {
          const keys = get().streams.map(s => s.id);
          if (!keys.length) {
            set({ statusDown: false });
            return true;
          }
          const { failed, down } = await pull(keys, true);
          // algum lote respondeu: o servidor está lá, e os lotes que falharam tentam de novo logo
          if (failed.length < keys.length) retryMissing(keys, failed);
          // sem rede, tentar de novo em segundos não adianta: fica para a próxima atualização
          else if (down !== 'offline') retryMissing(keys);
          return !down;
        },
      };
    },
    {
      name: NAME,
      storage,
      // v1: os sons dos botões passaram a vir ligados; quem tinha o padrão antigo (desligado) recebe o novo
      version: VERSION,
      migrate: (old, from) => (from < 1 ? { ...(old as object), uiSounds: true } : old) as Saved,
      partialize: saved,
      merge,
      onRehydrateStorage: () => () => {
        // o que acabou de ser lido já está gravado; a releitura vinda de outra aba não grava de novo
        written = saved(useStore.getState());
        if (!useStore.getState().hydrated) useStore.setState({ hydrated: true });
      },
    },
  ),
);

// ao sair do app (ou esconder a aba), grava o que estava esperando
AppState.addEventListener('change', st => st !== 'active' && save());

// web: outra aba gravou (o evento só chega nas outras abas); relê para uma não apagar o que a outra fez
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === NAME && e.newValue != null && e.newValue !== e.oldValue) void useStore.persist.rehydrate();
  });
}

/** Os status guardados estão velhos: a última consulta falhou ou foi há mais de STALE_MS. Use com useStore(statusOld). */
export const statusOld = (s: { statusAt: number | null; statusDown: Down }) =>
  !!s.statusDown || !s.statusAt || Date.now() - s.statusAt > STALE_MS;

/** Streamer + status ao vivo, pronto para as telas. */
export interface Item extends Streamer {
  status: Status | undefined;
  live: boolean;
  viewers: number;
  /** idioma efetivo: o da live, se a plataforma informou um que conhecemos; senão o cadastrado */
  effLang: string;
  offTxt: string;
  /** o status pode ter mudado: consulta falhou, ficou velho (STALE_MS) ou o worker não o confirmou */
  stale: boolean;
}

/** `old`: os status guardados estão velhos (statusOld). */
export const decorate = (st: Streamer, status: Status | undefined, old = false): Item => {
  const live = !!status?.live;
  return {
    ...st,
    status,
    live,
    viewers: live ? status!.viewers : 0,
    effLang: live && status!.lang && LANGS[status!.lang] ? status!.lang : st.lang,
    offTxt: !status ? 'verificando status…' : status.lastLiveAt ? `última live ${ago(status.lastLiveAt)}` : 'sem live recente',
    stale: !!status && (old || !!status.stale),
  };
};

/** Devolve o objeto anterior do mesmo id enquanto nenhum campo mudar: a linha não redesenha a cada atualização. */
const keeper = <T extends object>() => {
  const cache = new Map<string, T>();
  return (id: string, next: T): T => {
    const prev = cache.get(id);
    if (prev && sameFields(prev, next)) return prev;
    if (cache.size > 5000) cache.clear();
    cache.set(id, next);
    return next;
  };
};
const keepItem = keeper<Item>();
const keepCard = keeper<LiveCard>();
const keepFollowedCard = keeper<LiveCard>();

export function useLists() {
  const streams = useStore(s => s.streams);
  const statuses = useStore(s => s.statuses);
  const langs = useStore(s => s.langs);
  const old = useStore(statusOld);
  const items = streams.map(st => keepItem(st.id, decorate(st, statuses[st.id], old)));
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
  channelId: string;
  login: string;
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
  /** status de um seguido que pode ter mudado (Item.stale); em "tudo ao vivo" é sempre false */
  stale: boolean;
}

/** Card de um seguido ao vivo (o mesmo objeto enquanto nada mudar). */
export const toCard = (x: Item): LiveCard =>
  keepFollowedCard(x.id, {
    id: x.id, plat: x.plat, channelId: x.channelId, login: x.login, name: x.name, avatar: x.avatar,
    title: x.status?.title ?? '', cat: x.status?.cat ?? '', thumb: x.status?.thumb ?? null, viewers: x.viewers,
    lang: x.effLang, followed: x, url: x.status?.url ?? null, stale: x.stale,
  });

/** Por que um seguido ao vivo não aparece em Seguindo (plataforma, língua ou categoria fora do filtro); null se aparece. */
export function hiddenReason(x: Item, langs: string[], platforms: Plat[], cats: string[]): string | null {
  if (!platforms.includes(x.plat)) return `${PLAT[x.plat].label} desmarcada no filtro`;
  if (!langs.includes(x.effLang)) return `Live em ${x.effLang.toUpperCase()} · língua não marcada`;
  const cat = x.status?.cat ?? '';
  const k = catKey(cat);
  if (cats.length && !cats.some(c => catKey(c) === k)) return `Categoria ${cat || 'sem nome'} não marcada`;
  return null;
}

/** Seguidos ao vivo que os filtros escondem de Seguindo, com o motivo. Com os cards de Seguindo, somam todos os seguidos ao vivo. */
export function useHiddenLive(): { item: Item; why: string }[] {
  const { allLive } = useLists();
  const langs = useStore(s => s.langs);
  const platforms = useStore(s => s.platforms);
  const cats = useStore(s => s.cats);
  return allLive.flatMap(item => {
    const why = hiddenReason(item, langs, platforms, cats);
    return why ? [{ item, why }] : [];
  });
}

/** O que a aba Ao vivo mostra agora, já filtrado por língua e plataforma e na ordem do modo. */
export function useLiveCards(): LiveCard[] {
  const { live, allLive } = useLists();
  const browse = useStore(s => s.browse);
  const langs = useStore(s => s.langs);
  const platforms = useStore(s => s.platforms);
  const view = useStore(s => s.view);
  const cats = useStore(s => s.cats);
  if (view === 'following') return allLive.filter(x => !hiddenReason(x, langs, platforms, cats)).map(toCard);
  const want = new Set(cats.map(catKey));
  const mine = new Map(live.map(x => [x.id, x]));
  return browse
    .filter(b => platforms.includes(b.platform) && langs.includes(b.lang) && (!want.size || want.has(catKey(b.cat))))
    .map(b =>
      keepCard(b.key, {
        id: b.key, plat: b.platform, channelId: b.channelId, login: b.login, name: b.name,
        avatar: b.avatar ?? mine.get(b.key)?.avatar ?? null, title: b.title, cat: b.cat, thumb: b.thumb,
        viewers: b.viewers, lang: b.lang, followed: mine.get(b.key), url: b.url, stale: false,
      }),
    );
}

/** Quantas lives há no modo atual (no "tudo ao vivo", o total do worker, não só o que já carregou). */
export function useLiveTotal(): number {
  const cards = useLiveCards();
  const view = useStore(s => s.view);
  const total = useStore(s => s.browseTotal);
  return view === 'following' ? cards.length : Math.max(total, cards.length);
}

export const langSummary = (langs: string[]) => {
  const codes = LANG_ORDER.filter(k => langs.includes(k)).map(x => x.toUpperCase());
  return codes.length === LANG_ORDER.length ? 'Todas as línguas' : codes.length > 3 ? codes.slice(0, 2).join(', ') + ' +' + (codes.length - 2) : codes.join(', ');
};

export const catSummary = (cats: string[]) => (!cats.length ? 'Categorias' : cats.length === 1 ? cats[0] : `${cats[0]} +${cats.length - 1}`);

export const addedToast =(name: string, plat: Plat) => `${name} adicionado · ${PLAT[plat].label}`;

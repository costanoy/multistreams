import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { AppState, Platform } from 'react-native';
import { registerPush, unregisterPush, usePushState } from './push';
import { Provider, Streamer, useStore } from './store';
import { Base, Merged, Prefs, Queue, Step, SyncError, emptyBase, emptyQueue, mergeLists, pending, pushQueue, readAccount, track } from './sync';
import { LANGS, SKINS, SkinKey } from './theme';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const web = Platform.OS === 'web';

// na web, a volta do login traz no endereço o token da plataforma (ou o erro); lido antes que o supabase limpe a URL
const back = web && typeof window !== 'undefined' ? new URLSearchParams(`${window.location.search.slice(1)}&${window.location.hash.slice(1)}`) : null;
let redirectToken = back?.get('provider_token') ?? null;
const redirectError = back?.get('error_code') ?? back?.get('error') ?? null;

export const supabase = URL_ && KEY
  ? createClient(URL_, KEY, { auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: web } })
  : null;

const SCOPES: Record<Provider, string> = {
  twitch: 'user:read:follows',
  google: 'https://www.googleapis.com/auth/youtube.readonly',
};
const PENDING = 'multistreams-oauth-provider';

const loginError = (code: string) =>
  code === 'identity_already_exists' ? 'Essa conta já está ligada a outro usuário.' : code === 'access_denied' ? 'Login cancelado.' : 'Não deu para entrar. Tente de novo.';

/** Login (ou vínculo de uma segunda conta) com Twitch/Google. `returnPath` é a tela para onde voltar. */
export async function signIn(provider: Provider, returnPath: string): Promise<boolean> {
  const { showToast } = useStore.getState();
  if (!supabase) {
    showToast('Login ainda não configurado neste app.');
    return false;
  }
  const { data: sess } = await supabase.auth.getSession();
  const link = !!sess.session && !sess.session.user.identities?.some(i => i.provider === provider);
  const redirectTo = web ? window.location.origin + returnPath : Linking.createURL(returnPath);
  const options = { redirectTo, scopes: SCOPES[provider], skipBrowserRedirect: !web };
  // na web a página sai para o login e volta do zero: anota de qual plataforma é o token que vai chegar
  if (web) await AsyncStorage.setItem(PENDING, provider);
  const { data, error } = link
    ? await supabase.auth.linkIdentity({ provider, options })
    : await supabase.auth.signInWithOAuth({ provider, options });
  if (error || !data.url) {
    if (web) void AsyncStorage.removeItem(PENDING);
    showToast('Não deu para iniciar o login.');
    return false;
  }
  if (web) return true; // o navegador redireciona; a sessão chega por onAuthStateChange na volta

  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return false;
  const p = new URLSearchParams(res.url.split('#')[1] ?? res.url.split('?')[1] ?? '');
  const access_token = p.get('access_token'), refresh_token = p.get('refresh_token');
  if (!access_token || !refresh_token) {
    const code = p.get('error_code') ?? p.get('error');
    showToast(code ? loginError(code) : 'Login cancelado.');
    return false;
  }
  const providerToken = p.get('provider_token');
  if (providerToken) useStore.setState(s => ({ providerTokens: { ...s.providerTokens, [provider]: providerToken } }));
  const { error: e2 } = await supabase.auth.setSession({ access_token, refresh_token });
  return !e2;
}

export async function signOut() {
  if (supabase) {
    // antes de sair: manda o que falta para a conta e tira dela o token de push deste aparelho, sem travar a saída
    await Promise.race([Promise.all([flushNow(), unregisterPush(supabase)]), new Promise(r => setTimeout(r, 5000))]);
    stopSync();
    // 'local': sair aqui não derruba a sessão dos outros aparelhos
    await supabase.auth.signOut({ scope: 'local' });
  }
  useStore.setState({ account: null, providerTokens: {} });
}

// ---- sincronização da lista e das preferências ----
// Por conta, fora do estado salvo do app: a base (o que a conta tinha na última sincronização confirmada) e a fila
// (o que ainda não subiu). Na entrada, a fusão compara aparelho, base e conta (sync.ts); depois, cada mudança local entra na fila.

const LAST = 'multistreams-sync-last'; // última conta que sincronizou neste aparelho
const baseKey = (u: string) => `multistreams-sync-base:${u}`;
const queueKey = (u: string) => `multistreams-sync-queue:${u}`;
const PULL = 10 * 60_000; // voltando ao app depois disso, relê a conta (mudanças feitas em outro aparelho)

let user: string | null = null; // conta que está sincronizando
let synced = false; // a fusão desta conta já rodou nesta execução
let mergedAt = 0;
let base: Base = emptyBase();
let queue: Queue = emptyQueue();
let applying = false; // o set da fusão não volta para a conta como mudança local
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let fails = 0;

// base ou fila guardada; o que não tiver o formato esperado vale como ausente
const readSaved = async <T extends Base | Queue>(key: string): Promise<T | null> => {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(key)) ?? 'null');
    return v && typeof v.follows === 'object' && v.follows ? (v as T) : null;
  } catch {
    return null;
  }
};

const save = (u: string, b: Base, q: Queue) =>
  void AsyncStorage.multiSet([[baseKey(u), JSON.stringify(b)], [queueKey(u), JSON.stringify(q)]]).catch(() => {});

const prefsOf = (s: { langs: string[]; skin: SkinKey; notifyAll: boolean }): Prefs => ({ langs: s.langs, skin: s.skin, notifyAll: s.notifyAll });

// perfil da conta só com o que esta versão conhece (línguas e skins)
const toPrefs = (p: { langs: string[] | null; skin: string | null; notify_all: boolean | null } | null, local: Prefs): Prefs | null => {
  if (!p) return null;
  const langs = (Array.isArray(p.langs) ? p.langs : []).filter(l => LANGS[l]);
  return {
    langs: langs.length ? langs : local.langs,
    skin: p.skin && p.skin in SKINS ? (p.skin as SkinKey) : local.skin,
    notifyAll: p.notify_all ?? local.notifyAll,
  };
};

/** Token da sessão desta conta; `renew` força a renovação (depois de um 401). */
async function tokenFor(u: string, renew = false) {
  try {
    const { data } = renew ? await supabase!.auth.refreshSession() : await supabase!.auth.getSession();
    return data.session?.user.id === u ? data.session.access_token : null;
  } catch {
    return null;
  }
}

/** Uma ida à conta com o token; num 401, renova a sessão e tenta mais uma vez. */
async function withToken(u: string, task: (token: string) => Promise<Step>): Promise<Step> {
  let token = await tokenFor(u);
  let step: Step = token ? await task(token) : 'retry';
  if (step === 'auth') {
    token = await tokenFor(u, true);
    step = token ? await task(token) : 'retry';
  }
  return step === 'auth' ? 'retry' : step;
}

/** Junta a lista deste aparelho com a da conta e aplica sobre o estado atual. */
async function merge(u: string, token: string): Promise<Step> {
  const [last, savedBase, savedQueue] = await Promise.all([AsyncStorage.getItem(LAST).catch(() => null), readSaved<Base>(baseKey(u)), readSaved<Queue>(queueKey(u))]);
  // outra conta usou o aparelho por último: começa pela lista desta (a de lá não sobe para cá). A base e a fila
  // da outra separam o que era dela do que entrou aqui depois que ela saiu; sem as duas, nada daqui sobe
  const other = last && last !== u ? last : null;
  const [otherBase, otherQueue] = other ? await Promise.all([readSaved<Base>(baseKey(other)), readSaved<Queue>(queueKey(other))]) : [null, null];
  let acc: Awaited<ReturnType<typeof readAccount>>;
  try {
    acc = await readAccount(supabase!, u, token);
  } catch (e) {
    console.warn('[sync]', (e as Error).message);
    return e instanceof SyncError ? e.step : 'retry';
  }
  if (user !== u) return 'ok';
  const mode = other ? 'replace' : 'merge';
  const theirs = otherBase && otherQueue ? { base: otherBase, queue: otherQueue } : null;
  let out!: Merged;
  let added = false;
  applying = true;
  try {
    useStore.setState(s => {
      const local = prefsOf(s);
      out = mergeLists(mode, s.streams, local, last === u ? savedBase : null, acc.follows, toPrefs(acc.profile, local), savedQueue ?? emptyQueue(), theirs);
      const had = new Set(s.streams.map(x => x.id));
      added = out.streams.some(x => !had.has(x.id));
      return { streams: out.streams, langs: out.prefs.langs, skin: out.prefs.skin, notifyAll: out.prefs.notifyAll };
    });
  } finally {
    applying = false;
  }
  base = out.base;
  queue = out.queue;
  synced = true;
  mergedAt = Date.now();
  save(u, base, queue);
  void AsyncStorage.setItem(LAST, u).catch(() => {});
  if (added) void useStore.getState().refresh();
  return 'ok';
}

/** Uma rodada: a fusão (se ainda não rodou para esta conta) e depois a fila. Se falhar, tenta de novo com espera crescente. */
function run(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const u = user;
    if (!u || !supabase) return;
    clearTimeout(timer);
    let step: Step;
    try {
      step = synced ? 'ok' : await withToken(u, token => merge(u, token));
      const b = base, q = queue;
      if (step === 'ok' && user === u && pending(q)) step = await withToken(u, token => pushQueue(supabase!, u, token, q, b, () => save(u, b, q)));
    } catch (e) {
      console.warn('[sync]', e);
      step = 'retry';
    }
    if (user !== u) return;
    if (step === 'ok') fails = 0;
    else {
      fails++;
      kick(Math.min(5 * 60_000, 5000 * 2 ** (fails - 1)));
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void run();
    }
  });
  return running;
}

function kick(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void run(), ms);
}

function startSync(u: string) {
  stopSync();
  user = u;
  base = emptyBase();
  queue = emptyQueue();
  void run();
}

function stopSync() {
  clearTimeout(timer);
  user = null;
  synced = false;
  fails = 0;
}

// antes de sair: espera a rodada em curso e manda o que ainda estiver na fila
async function flushNow() {
  await running;
  if (user && synced && pending(queue)) await run();
}

// ligou um aviso (geral, ou de um streamer, inclusive ao adicionar)
const notifyOn = (prev: Streamer[], next: Streamer[]) => {
  if (prev === next) return false;
  const before = new Map(prev.map(x => [x.id, x.notify]));
  return next.some(x => x.notify && !before.get(x.id));
};

let started = false;

/** Liga o app à sessão do Supabase. Chamado uma vez, depois que o estado local foi carregado. */
export function startAccount() {
  if (!supabase || started) return;
  started = true;

  // carga que não veio da volta do login: um PENDING que sobrou (login abandonado ou que falhou) não vale mais
  if (!redirectToken) void AsyncStorage.removeItem(PENDING).catch(() => {});
  if (redirectError) useStore.getState().showToast(loginError(redirectError));

  supabase.auth.onAuthStateChange((_event, session) => {
    // não chamar o supabase de dentro do callback (trava o cliente): adia
    setTimeout(() => onSession(session), 0);
  });

  // cada mudança local vai para a fila da conta
  useStore.subscribe((s, prev) => {
    if (applying) return;
    const userId = s.account?.userId;
    if (!userId) return;
    // o aviso só chega se o token deste aparelho estiver na conta
    if (s.notifyAll && usePushState.getState().state !== 'ok' && (!prev.notifyAll || notifyOn(prev.streams, s.streams))) void registerPush(supabase!, userId);
    // antes da fusão nada entra na fila: ela compara o aparelho com a base e manda essas mudanças
    if (userId !== user || !synced) return;
    if (track(queue, prev, s)) {
      save(userId, base, queue);
      kick(1500);
    }
  });

  AppState.addEventListener('change', st => {
    if (st !== 'active' || !user) return;
    if (synced && Date.now() - mergedAt > PULL) synced = false;
    kick(0);
    // as notificações podem ter sido liberadas nos ajustes do sistema: confere sem perguntar de novo
    const push = usePushState.getState().state;
    if (push === 'denied' || push === 'error') void registerPush(supabase!, user, false);
  });
}

function onSession(session: Session | null) {
  if (!session) {
    stopSync();
    usePushState.setState({ state: 'idle' });
    if (useStore.getState().account) useStore.setState({ account: null, providerTokens: {} });
    return;
  }
  const userId = session.user.id;
  // primeira sessão desta conta nesta execução, venha no evento que vier (com o token vencido, o primeiro é TOKEN_REFRESHED)
  if (useStore.getState().account?.userId !== userId) {
    const main = session.user.app_metadata.provider === 'twitch' ? 'twitch' : 'google';
    useStore.setState({ account: { provider: main, userId }, onboarded: true });
    startSync(userId);
    void registerPush(supabase!, userId);
  }
  // o token da plataforma só vale na sessão que veio da volta do login: numa recarga, o da sessão salva pode ser de outra plataforma
  if (redirectToken && session.provider_token === redirectToken) {
    const token = redirectToken;
    redirectToken = null;
    void (async () => {
      const provider = await AsyncStorage.getItem(PENDING).catch(() => null);
      void AsyncStorage.removeItem(PENDING).catch(() => {});
      if (provider === 'twitch' || provider === 'google') useStore.setState(s => ({ providerTokens: { ...s.providerTokens, [provider]: token } }));
    })();
  }
}

// ---- importação de seguidos (direto nas APIs das plataformas, com o token do usuário) ----

export type Importable = Omit<Streamer, 'notify' | 'lang'>;

/** O token da plataforma venceu ou foi revogado: é preciso entrar de novo. */
export class TokenExpired extends Error {
  constructor() {
    super('O acesso à plataforma expirou. Entre de novo para importar.');
  }
}

/** A plataforma recusou a leitura. `message` já vem pronta para mostrar. */
export class ImportError extends Error {
  constructor(public reason: 'permission' | 'quota' | 'config' | 'other', message: string) {
    super(message);
  }
}

const TWITCH_CONFIG = 'A importação da Twitch não está configurada neste app.';
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

// a Twitch diz o motivo em `message`: "Missing scope: …", "Client ID and OAuth token do not match", "Invalid OAuth token"
function twitchError(status: number, body: any): Error {
  const msg = String(body?.message ?? '');
  if (/client[ -]?id/i.test(msg)) return new ImportError('config', TWITCH_CONFIG);
  if (/scope/i.test(msg)) return new ImportError('permission', 'Permita ver quem você segue na tela de login da Twitch.');
  if (status === 401) return new TokenExpired();
  if (status === 429) return new ImportError('quota', 'A Twitch limitou as consultas agora. Tente de novo em instantes.');
  if (status === 403) return new ImportError('other', 'A Twitch não liberou a lista de quem você segue.');
  return new Error(String(status));
}

// o Google põe o motivo em error.errors[].reason e, no formato novo, em error.details[].reason e error.status
function googleError(status: number, body: any): Error {
  const e = body?.error;
  const reasons: unknown[] = [...list(e?.errors), ...list(e?.details)].map(x => x?.reason).concat(e?.status);
  const has = (...r: string[]) => r.some(x => reasons.includes(x));
  if (has('youtubeSignupRequired')) return new ImportError('other', 'Essa conta do Google ainda não tem canal no YouTube.');
  if (status === 401) return new TokenExpired();
  if (has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) return new ImportError('permission', 'Permita o acesso ao YouTube na tela de login do Google.');
  if (status === 429 || has('quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED')) {
    return new ImportError('quota', 'O YouTube atingiu o limite de consultas. Tente mais tarde.');
  }
  if (has('accessNotConfigured', 'SERVICE_DISABLED')) return new ImportError('config', 'A importação do YouTube não está configurada neste app.');
  if (has('accountClosed', 'accountSuspended')) return new ImportError('other', 'Essa conta do YouTube está encerrada ou suspensa.');
  if (status === 403) return new ImportError('other', 'O YouTube não liberou a lista das suas inscrições.');
  return new Error(String(status));
}

async function authed(url: string, headers: Record<string, string>, fail: (status: number, body: any) => Error) {
  const res = await fetch(url, { headers });
  if (res.ok) return res.json();
  throw fail(res.status, await res.json().catch(() => null));
}

export async function twitchFollowed(token: string): Promise<Importable[]> {
  const clientId = process.env.EXPO_PUBLIC_TWITCH_CLIENT_ID ?? '';
  if (!clientId) throw new ImportError('config', TWITCH_CONFIG);
  const h = { Authorization: `Bearer ${token}`, 'Client-Id': clientId };
  const get = (url: string) => authed(url, h, twitchError);
  const me = (await get('https://api.twitch.tv/helix/users')).data[0];
  const ids: string[] = [];
  let cursor = '';
  do {
    const r = await get(`https://api.twitch.tv/helix/channels/followed?user_id=${me.id}&first=100${cursor ? `&after=${cursor}` : ''}`);
    ids.push(...r.data.map((c: any) => c.broadcaster_id));
    cursor = r.pagination?.cursor ?? '';
  } while (cursor && ids.length < 1000);
  const out: Importable[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await get(`https://api.twitch.tv/helix/users?${ids.slice(i, i + 100).map(id => `id=${id}`).join('&')}`);
    out.push(...r.data.map((u: any) => ({ id: `twitch:${u.id}`, plat: 'twitch' as const, channelId: u.id, login: u.login, name: u.display_name, avatar: u.profile_image_url ?? null })));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function youtubeSubscriptions(token: string): Promise<Importable[]> {
  const h = { Authorization: `Bearer ${token}` };
  const get = (url: string) => authed(url, h, googleError);
  const out: Importable[] = [];
  let page = '';
  do {
    const r = await get(`https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50&order=alphabetical${page ? `&pageToken=${page}` : ''}`);
    out.push(...(r.items ?? []).map((i: any) => {
      const id = i.snippet.resourceId.channelId;
      return { id: `youtube:${id}`, plat: 'youtube' as const, channelId: id, login: '', name: i.snippet.title, avatar: i.snippet.thumbnails?.default?.url ?? null };
    }));
    page = r.nextPageToken ?? '';
  } while (page && out.length < 1000);
  return out;
}

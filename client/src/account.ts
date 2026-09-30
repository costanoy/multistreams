import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { registerPush } from './push';
import { Provider, Streamer, useStore } from './store';
import { LANGS, Plat, SkinKey } from './theme';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const web = Platform.OS === 'web';

export const supabase = URL_ && KEY
  ? createClient(URL_, KEY, { auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: web } })
  : null;

const SCOPES: Record<Provider, string> = {
  twitch: 'user:read:follows',
  google: 'https://www.googleapis.com/auth/youtube.readonly',
};
const PENDING = 'multistreams-oauth-provider';

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
  await AsyncStorage.setItem(PENDING, provider);
  const { data, error } = link
    ? await supabase.auth.linkIdentity({ provider, options })
    : await supabase.auth.signInWithOAuth({ provider, options });
  if (error || !data.url) {
    showToast('Não deu para iniciar o login.');
    return false;
  }
  if (web) return true; // o navegador redireciona; a sessão chega por onAuthStateChange na volta

  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return false;
  const p = new URLSearchParams(res.url.split('#')[1] ?? res.url.split('?')[1] ?? '');
  const access_token = p.get('access_token'), refresh_token = p.get('refresh_token');
  if (!access_token || !refresh_token) {
    showToast(p.get('error_description')?.replace(/\+/g, ' ') ?? 'Login cancelado.');
    return false;
  }
  const providerToken = p.get('provider_token');
  if (providerToken) useStore.setState(s => ({ providerTokens: { ...s.providerTokens, [provider]: providerToken } }));
  const { error: e2 } = await supabase.auth.setSession({ access_token, refresh_token });
  return !e2;
}

export async function signOut() {
  await supabase?.auth.signOut();
  useStore.setState({ account: null, providerTokens: {} });
}

// ---- sincronização da lista e das preferências ----

const row = (userId: string, s: Streamer) => ({
  user_id: userId, channel_key: s.id, platform: s.plat, channel_id: s.channelId, login: s.login, name: s.name, avatar: s.avatar, lang: s.lang, notify: s.notify,
});

/** No login: junta a lista deste aparelho com a da conta. Preferências da conta, se existirem, valem. */
async function mergeRemote(userId: string) {
  if (!supabase) return;
  const [{ data: follows, error }, { data: profile }] = await Promise.all([
    supabase.from('follows').select('*').eq('user_id', userId).order('created_at'),
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
  ]);
  if (error) return;
  const local = useStore.getState();
  const have = new Set(local.streams.map(s => s.id));
  const remote: Streamer[] = (follows ?? [])
    .filter(f => !have.has(f.channel_key))
    .map(f => ({ id: f.channel_key, plat: f.platform as Plat, channelId: f.channel_id, login: f.login, name: f.name, avatar: f.avatar, lang: f.lang, notify: f.notify }));
  const remoteKeys = new Set((follows ?? []).map(f => f.channel_key));
  const onlyLocal = local.streams.filter(s => !remoteKeys.has(s.id));
  if (onlyLocal.length) await supabase.from('follows').upsert(onlyLocal.map(s => row(userId, s)));
  const langs = (profile?.langs as string[] | undefined)?.filter(l => LANGS[l]);
  if (profile) {
    useStore.setState({
      streams: [...local.streams, ...remote],
      langs: langs?.length ? langs : local.langs,
      skin: (profile.skin as SkinKey) ?? local.skin,
      notifyAll: profile.notify_all ?? local.notifyAll,
    });
  } else {
    useStore.setState({ streams: [...local.streams, ...remote] });
    await supabase.from('profiles').upsert({ id: userId, langs: local.langs, skin: local.skin, notify_all: local.notifyAll });
  }
  void useStore.getState().refresh();
}

let started = false;

/** Liga o app à sessão do Supabase. Chamado uma vez, depois que o estado local foi carregado. */
export function startAccount() {
  if (!supabase || started) return;
  started = true;

  supabase.auth.onAuthStateChange((event, session) => {
    // não chamar o supabase de dentro do callback (trava o cliente): adia
    setTimeout(async () => {
      if (!session) {
        if (useStore.getState().account) useStore.setState({ account: null, providerTokens: {} });
        return;
      }
      const userId = session.user.id;
      const first = useStore.getState().account?.userId !== userId;
      const main = session.user.app_metadata.provider === 'twitch' ? 'twitch' : 'google';
      if (first) useStore.setState({ account: { provider: main, userId }, onboarded: true });
      if (session.provider_token) {
        const pending = ((await AsyncStorage.getItem(PENDING)) as Provider | null) ?? main;
        useStore.setState(s => ({ providerTokens: { ...s.providerTokens, [pending]: session.provider_token! } }));
      }
      if (first && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        await mergeRemote(userId);
        void registerPush(supabase!, userId);
      }
    }, 0);
  });

  // cada mudança local vai para a conta
  useStore.subscribe((s, prev) => {
    const userId = s.account?.userId;
    if (!userId || !prev.account) return;
    if (s.streams !== prev.streams) {
      const before = new Map(prev.streams.map(x => [x.id, x]));
      const changed = s.streams.filter(x => before.get(x.id) !== x);
      const now = new Set(s.streams.map(x => x.id));
      const removed = prev.streams.filter(x => !now.has(x.id)).map(x => x.id);
      if (changed.length) void supabase!.from('follows').upsert(changed.map(x => row(userId, x))).then();
      if (removed.length) void supabase!.from('follows').delete().eq('user_id', userId).in('channel_key', removed).then();
    }
    if (s.langs !== prev.langs || s.skin !== prev.skin || s.notifyAll !== prev.notifyAll) {
      void supabase!.from('profiles').upsert({ id: userId, langs: s.langs, skin: s.skin, notify_all: s.notifyAll, updated_at: new Date().toISOString() }).then();
    }
  });
}

// ---- importação de seguidos (direto nas APIs das plataformas, com o token do usuário) ----

export type Importable = Omit<Streamer, 'notify' | 'lang'>;

export class TokenExpired extends Error {}

async function authed(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  if (res.status === 401 || res.status === 403) throw new TokenExpired();
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function twitchFollowed(token: string): Promise<Importable[]> {
  const h = { Authorization: `Bearer ${token}`, 'Client-Id': process.env.EXPO_PUBLIC_TWITCH_CLIENT_ID ?? '' };
  const me = (await authed('https://api.twitch.tv/helix/users', h)).data[0];
  const ids: string[] = [];
  let cursor = '';
  do {
    const r = await authed(`https://api.twitch.tv/helix/channels/followed?user_id=${me.id}&first=100${cursor ? `&after=${cursor}` : ''}`, h);
    ids.push(...r.data.map((c: any) => c.broadcaster_id));
    cursor = r.pagination?.cursor ?? '';
  } while (cursor && ids.length < 1000);
  const out: Importable[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await authed(`https://api.twitch.tv/helix/users?${ids.slice(i, i + 100).map(id => `id=${id}`).join('&')}`, h);
    out.push(...r.data.map((u: any) => ({ id: `twitch:${u.id}`, plat: 'twitch' as const, channelId: u.id, login: u.login, name: u.display_name, avatar: u.profile_image_url ?? null })));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function youtubeSubscriptions(token: string): Promise<Importable[]> {
  const h = { Authorization: `Bearer ${token}` };
  const out: Importable[] = [];
  let page = '';
  do {
    const r = await authed(`https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50&order=alphabetical${page ? `&pageToken=${page}` : ''}`, h);
    out.push(...(r.items ?? []).map((i: any) => {
      const id = i.snippet.resourceId.channelId;
      return { id: `youtube:${id}`, plat: 'youtube' as const, channelId: id, login: '', name: i.snippet.title, avatar: i.snippet.thumbnails?.default?.url ?? null };
    }));
    page = r.nextPageToken ?? '';
  } while (page && out.length < 1000);
  return out;
}

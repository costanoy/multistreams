import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { Status } from './api';
import { Streamer } from './store';

export const profileUrl = (st: Pick<Streamer, 'plat' | 'login' | 'channelId'>) =>
  st.plat === 'twitch'
    ? `https://www.twitch.tv/${st.login}`
    : st.plat === 'kick'
      ? `https://kick.com/${st.login}`
      : st.login
        ? `https://www.youtube.com/${st.login}`
        : `https://www.youtube.com/channel/${st.channelId}`;

export async function openUrl(url: string) {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  // links https do YouTube e da Kick já abrem no app instalado (universal/app links)
  await Linking.openURL(url).catch(() => {});
}

/** Abre a live (ou o perfil, se offline) na plataforma original. */
export async function openStream(st: Streamer, status?: Status) {
  const liveUrl = status?.live && status.url ? status.url : null;
  if (st.plat === 'twitch' && Platform.OS !== 'web') {
    // o link da live vem do worker com o login atual; o salvo é o de quando o canal entrou na lista (a Twitch deixa trocar o nome)
    const login = liveUrl?.match(/twitch\.tv\/([^/?#]+)/i)?.[1] ?? st.login;
    try {
      await Linking.openURL(`twitch://stream/${login}`);
      return;
    } catch {
      // app da Twitch não instalado: cai no navegador
    }
  }
  await openUrl(liveUrl ?? profileUrl(st));
}

/** Endereço comparável: caminho e parâmetros decodificados, em ordem. */
const addr = (href: string) => {
  const [path, query = ''] = href.split('?');
  const params = query
    .split('&')
    .filter(Boolean)
    .map(p => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    })
    .sort();
  return params.length ? `${path}?${params.join('&')}` : path;
};

/** A tela aberta agora, anotada pela carcaça (useHere). */
let here = '';

/** Anota a tela aberta, para go() e goBack() não navegarem para onde já estão. Usado uma vez, na carcaça. */
export function useHere() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const query = Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(x => `${k}=${encodeURIComponent(x)}`))
    .join('&');
  const href = query ? `${pathname}?${query}` : pathname;
  useEffect(() => {
    here = addr(href);
  }, [href]);
}

/** Navegação "plana" como no protótipo: no nativo troca de tela sem empilhar; na web usa o histórico. Na tela atual, não faz nada. */
export const go = (href: string) => {
  if (addr(href) === here) return;
  if (Platform.OS === 'web') router.push(href as never);
  else router.replace(href as never);
};

/**
 * Volta para `href` sem empilhar: na web, recua no histórico até essa tela, se ela ficou para trás
 * (senão troca a atual por ela); no nativo, troca de tela. Na tela atual, não faz nada.
 */
export const goBack = (href: string) => {
  if (addr(href) === here) return;
  if (Platform.OS === 'web') router.dismissTo(href as never);
  else router.replace(href as never);
};

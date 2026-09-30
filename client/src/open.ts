import { router } from 'expo-router';
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
  if (st.plat === 'twitch' && Platform.OS !== 'web') {
    try {
      await Linking.openURL(`twitch://stream/${st.login}`);
      return;
    } catch {
      // app da Twitch não instalado: cai no navegador
    }
  }
  await openUrl(status?.live && status.url ? status.url : profileUrl(st));
}

/** Navegação "plana" como no protótipo: no nativo troca de tela sem empilhar; na web usa o histórico. */
export const go = (href: string) => (Platform.OS === 'web' ? router.push(href as never) : router.replace(href as never));

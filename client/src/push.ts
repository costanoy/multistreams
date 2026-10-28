import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { create } from 'zustand';
import { openUrl } from './open';

const native = Platform.OS !== 'web';
const TOKEN = 'multistreams-push-token';

if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
  });
}

/**
 * idle: ainda não registrado (sem conta, ou na web, onde não há push); ok: token gravado na conta;
 * denied: permissão negada; unavailable: build sem projectId do EAS ou sem FCM (ou simulador); error: falha que pode passar (rede, banco).
 */
export type PushState = 'idle' | 'ok' | 'denied' | 'unavailable' | 'error';

/** Situação do push neste aparelho (só em memória). */
export const usePushState = create<{ state: PushState }>(() => ({ state: 'idle' }));

const report = (state: PushState) => {
  usePushState.setState({ state });
  return state;
};

// erro do próprio build, que não passa tentando de novo: sem projectId, sem google-services.json (FCM) ou sem a permissão de push no iOS
const misconfigured = (e: unknown) => {
  const { code, message } = (e ?? {}) as { code?: string; message?: string };
  return code === 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID' || code === 'ERR_NOTIFICATIONS_NO_APPLICATION_ID' || /firebase|googleServicesFile|aps-environment/i.test(message ?? '');
};

// banco sem a função claim_push_token (schema antigo)
const noClaim = (e: { code?: string }) => e.code === 'PGRST202' || e.code === '42883';

let flight: { userId: string; p: Promise<PushState> } | null = null;

/** Pede permissão (só com `ask`) e grava o token de push deste aparelho na conta. */
export function registerPush(supabase: SupabaseClient, userId: string, ask = true): Promise<PushState> {
  if (!native) return Promise.resolve<PushState>('idle');
  if (flight?.userId === userId) return flight.p;
  const f = { userId, p: register(supabase, userId, ask) };
  flight = f;
  void f.p.finally(() => {
    if (flight === f) flight = null;
  });
  return f.p;
}

async function register(supabase: SupabaseClient, userId: string, ask: boolean): Promise<PushState> {
  if (!Device.isDevice) return report('unavailable');
  let token: string;
  try {
    if (Platform.OS === 'android') {
      // o som do canal não muda depois de criado no aparelho
      await Notifications.setNotificationChannelAsync('live', { name: 'Streamers ao vivo', importance: Notifications.AndroidImportance.HIGH, sound: 'notification.wav' });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return report('denied');
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('push: build sem extra.eas.projectId (ver README)');
      return report('unavailable');
    }
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e) {
    console.warn('push:', e);
    return report(misconfigured(e) ? 'unavailable' : 'error');
  }
  // a função do banco passa o token para esta conta mesmo se ele estava com outra (o upsert esbarraria na RLS)
  let { error } = await supabase.rpc('claim_push_token', { p_token: token, p_platform: Platform.OS });
  if (error && noClaim(error)) {
    ({ error } = await supabase.from('push_tokens').upsert({ token, user_id: userId, platform: Platform.OS, updated_at: new Date().toISOString() }));
  }
  if (error) {
    console.warn('push:', error.message);
    return report('error');
  }
  await AsyncStorage.setItem(TOKEN, token).catch(() => {});
  return report('ok');
}

/** Ao sair: tira da conta o token deste aparelho, para os avisos dela não chegarem mais aqui. */
export async function unregisterPush(supabase: SupabaseClient) {
  if (!native) return;
  await flight?.p;
  report('idle');
  const token = await AsyncStorage.getItem(TOKEN).catch(() => null);
  if (!token) return;
  const { error } = await supabase.from('push_tokens').delete().eq('token', token);
  if (error) console.warn('push:', error.message);
}

/** Abre os ajustes do app no sistema, onde dá para liberar as notificações negadas. */
export function openNotificationSettings() {
  if (native) void Linking.openSettings().catch(() => {});
}

// último toque já tratado: o JS continua vivo quando a Activity é recriada (fonte, idioma ou tamanho de tela) e o layout remonta
let handled: string | null = null;

/** Tocar no aviso abre a live na plataforma. */
export function listenPushTaps() {
  if (!native) return () => {};
  const open = (r: Notifications.NotificationResponse | null) => {
    if (!r || r.notification.request.identifier === handled) return;
    handled = r.notification.request.identifier;
    const url = r.notification.request.content.data?.url;
    if (typeof url === 'string') void openUrl(url);
    // o módulo nativo guarda a última resposta enquanto o processo vive: sem limpar, cada remontagem reabriria a live
    try {
      Notifications.clearLastNotificationResponse();
    } catch {}
  };
  open(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}

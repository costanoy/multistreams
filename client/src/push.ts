import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { openUrl } from './open';

const native = Platform.OS !== 'web';

if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
  });
}

/** Pede permissão e grava o token de push deste aparelho na conta. */
export async function registerPush(supabase: SupabaseClient, userId: string) {
  if (!native || !Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('live', { name: 'Streamers ao vivo', importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return; // precisa de `eas init` (ver README)
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').upsert({ token, user_id: userId, platform: Platform.OS, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn('push:', e);
  }
}

/** Tocar no aviso abre a live na plataforma. */
export function listenPushTaps() {
  if (!native) return () => {};
  const open = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url === 'string') void openUrl(url);
  };
  open(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}

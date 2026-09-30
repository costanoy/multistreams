import { ChakraPetch_400Regular, ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { Michroma_400Regular } from '@expo-google-fonts/michroma';
import { useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { startAccount } from '@/account';
import { listenPushTaps } from '@/push';
import { Shell } from '@/Shell';
import { useStore } from '@/store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fonts, fontError] = useFonts({
    ChakraPetch_400Regular, ChakraPetch_500Medium, ChakraPetch_600SemiBold, ChakraPetch_700Bold, Michroma_400Regular,
    DSEG14: require('../../assets/fonts/DSEG14Classic-Bold.ttf'),
  });
  const hydrated = useStore(s => s.hydrated);
  const ready = (fonts || !!fontError) && hydrated;

  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync();
    startAccount();
    const { refresh } = useStore.getState();
    void refresh();
    // o worker consulta as plataformas por canal; o app só relê o resultado
    const timer = setInterval(() => AppState.currentState === 'active' && void refresh(), 60000);
    const sub = AppState.addEventListener('change', st => st === 'active' && void refresh());
    const stopPush = listenPushTaps();
    return () => {
      clearInterval(timer);
      sub.remove();
      stopPush();
    };
  }, [ready]);

  if (!ready) return null;
  return (
    <Shell>
      <Slot />
    </Shell>
  );
}

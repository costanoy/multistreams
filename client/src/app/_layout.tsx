import { ChakraPetch_400Regular, ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { Michroma_400Regular } from '@expo-google-fonts/michroma';
import { FontDisplay, useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { startAccount } from '@/account';
import { listenPushTaps } from '@/push';
import { Shell } from '@/Shell';
import { useStore } from '@/store';

SplashScreen.preventAutoHideAsync();

// na web, o texto aparece na hora com a fonte do sistema e troca quando a do app chega (font-display: swap)
const swap = (uri: number) => ({ uri, display: FontDisplay.SWAP });
const FONTS = {
  ChakraPetch_400Regular: swap(ChakraPetch_400Regular),
  ChakraPetch_600SemiBold: swap(ChakraPetch_600SemiBold),
  ChakraPetch_700Bold: swap(ChakraPetch_700Bold),
  Michroma_400Regular: swap(Michroma_400Regular),
  DSEG14: swap(require('../../assets/fonts/DSEG14Classic-Bold.ttf')),
};

export default function RootLayout() {
  const [fonts, fontError] = useFonts(FONTS);
  const hydrated = useStore(s => s.hydrated);
  // no app as fontes são locais e chegam logo; na web, esperar por elas deixava a primeira tela em branco
  const ready = (Platform.OS === 'web' || fonts || !!fontError) && hydrated;

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

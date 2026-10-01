import { Image, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signIn } from '@/account';
import { DownloadApk } from '@/DownloadApk';
import { go } from '@/open';
import { play } from '@/sounds';
import { Provider, useStore } from '@/store';
import { grad } from '@/theme';
import { Btn, Lcd, LcdText, T, useSkin } from '@/ui';

export default function Onboarding() {
  const s = useSkin();
  const insets = useSafeAreaInsets();

  // a abertura toca uma vez, quando a pessoa entra no app pela primeira vez
  const enter = () => {
    play('startup');
    useStore.setState({ onboarded: true });
    go('/');
  };
  const login = async (provider: Provider) => {
    if (await signIn(provider, '/')) enter();
  };

  return (
    <ScrollView
      style={[{ flex: 1 }, grad(s.frame, s.frameTop)]}
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + 36 }}>
      <View style={{ width: '100%', maxWidth: 400, alignItems: 'center', gap: 22 }}>
        <View style={{ borderRadius: 64, boxShadow: '0 8px 16px rgba(0,0,0,0.3)' }}>
          <Image source={require('../../assets/images/logo-round.png')} alt="Logo do Multistreams" style={{ width: 128, height: 128, borderRadius: 64 }} />
        </View>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <T font="brand" s={22} ls={0.08} c={s.frameInk}>MULTISTREAMS</T>
          <Lcd r={6} style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
            <LcdText s={11}>TWITCH YOUTUBE KICK</LcdText>
          </Lcd>
        </View>
        <View style={{ gap: 8 }}>
          <T heading={1} s={28} w={700} lh={1.1} c={s.frameInk} center>Quem está ao vivo agora, numa lista só.</T>
          <T s={15} lh={1.4} c={s.frameMuted} center>Seus streamers da Twitch, do YouTube e da Kick em uma lista, do mais assistido para o menos, nas línguas que você escolher.</T>
        </View>
        <View style={{ width: '100%', gap: 10 }}>
          <Btn h={50} label="Entrar com Twitch" color="#7c3aed" onPress={() => login('twitch')} />
          <Btn h={50} label="Entrar com Google" color="#ffffff" ink="#1a1c21" onPress={() => login('google')} />
          <Btn h={50} label="Continuar sem conta" onPress={enter} />
          <DownloadApk variant="onboarding" />
        </View>
        <T s={12.5} lh={1.45} c={s.frameMuted} center>Sem conta, a lista fica salva neste aparelho. Com conta: sincronização, push e importação de quem você já segue.</T>
      </View>
    </ScrollView>
  );
}

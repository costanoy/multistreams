import { useLocalSearchParams } from 'expo-router';
import { Image, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signIn } from '@/account';
import { DownloadApk } from '@/DownloadApk';
import { goBack } from '@/open';
import { BackButton } from '@/Shell';
import { play } from '@/sounds';
import { Provider, useStore } from '@/store';
import { grad } from '@/theme';
import { Btn, Lcd, LcdText, T, useSkin } from '@/ui';

export default function Onboarding() {
  const s = useSkin();
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const onboarded = useStore(st => st.onboarded);
  // aberta por "Entrar" (Ajustes ou Notificações): dá para voltar; no primeiro uso, não
  const back = onboarded && (from === 'settings' || from === 'notifications') ? `/${from}` : null;

  // a abertura toca uma vez, quando a pessoa entra no app pela primeira vez; a boas-vindas sai do histórico
  const enter = (to: string) => {
    if (!onboarded) play('startup');
    useStore.setState({ onboarded: true });
    goBack(to);
  };
  // no primeiro uso, o login termina em Importar: o token da plataforma, que só fica em memória, vale agora
  const login = async (provider: Provider) => {
    const to = back ?? '/import?from=onboarding';
    if (!(await signIn(provider, to))) return;
    // na web a página sai para o login e volta direto nesse endereço
    if (Platform.OS === 'web') return;
    if (back) goBack(back);
    else enter(to);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={[{ flex: 1 }, grad(s.frame, s.frameTop)]}
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top + 28, paddingHorizontal: 24, paddingBottom: insets.bottom + 36 }}>
        <View style={{ width: '100%', maxWidth: 400, alignItems: 'center', gap: 22 }}>
          <View style={{ borderRadius: 64, boxShadow: '0 8px 16px rgba(0,0,0,0.3)' }}>
            <Image source={require('../../assets/images/logo-small.png')} alt="Logo do Multistreams" style={{ width: 128, height: 128, borderRadius: 64 }} />
          </View>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <T font="brand" s={22} ls={0.08} c={s.frameInk}>MULTISTREAMS</T>
            <Lcd r={6} style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
              <LcdText s={11}>TWITCH YOUTUBE KICK</LcdText>
            </Lcd>
          </View>
          <View style={{ gap: 8 }}>
            <T heading={1} s={28} w={700} lh={1.1} c={s.frameInk} center>Quem está ao vivo agora, numa lista só.</T>
            <T s={15} lh={1.4} c={s.frameMuted} center>Twitch, YouTube e Kick juntos, da live mais assistida para a menos, nas línguas que você escolher. Siga seus streamers e saiba quando entram no ar.</T>
          </View>
          <View style={{ width: '100%', gap: 10 }}>
            <Btn h={50} label="Entrar com Twitch" color="#7c3aed" onPress={() => login('twitch')} />
            <Btn h={50} label="Entrar com Google" color="#ffffff" ink="#1a1c21" onPress={() => login('google')} />
            {back ? <Btn h={50} label="Agora não" onPress={() => goBack(back)} /> : <Btn h={50} label="Continuar sem conta" onPress={() => enter('/')} />}
            <DownloadApk variant="onboarding" />
          </View>
          <T s={12.5} lh={1.45} c={s.frameMuted} center>Sem conta, a lista fica salva neste aparelho. Com conta: sincronização, push e importação de quem você já segue.</T>
        </View>
      </ScrollView>
      {back ? (
        <View style={{ position: 'absolute', top: insets.top + 12, left: 16 }}>
          <BackButton to={back} />
        </View>
      ) : null}
    </View>
  );
}

import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { signOut } from '@/account';
import { DownloadApk } from '@/DownloadApk';
import { go } from '@/open';
import { AccountBadge, Screen, accountSub, accountTitle, enterKey } from '@/Shell';
import { langSummary, useStore } from '@/store';
import { Btn, Card, Chrome, Switch, T, useSkin } from '@/ui';

/** Estado do Pressable na web (o react-native-web informa o hover). */
type Hover = { pressed: boolean; hovered?: boolean };

export default function Settings() {
  const s = useSkin();
  const account = useStore(st => st.account);
  const langs = useStore(st => st.langs);
  const notifyAll = useStore(st => st.notifyAll);
  const uiSounds = useStore(st => st.uiSounds);
  // a mesma base de Notificações: todos os seguidos, em qualquer língua
  const streams = useStore(st => st.streams);
  const [leaving, setLeaving] = useState(false);

  const items: [string, string, string][] = [
    ['Idiomas', langSummary(langs), '/languages'],
    ['Notificações', !notifyAll ? 'Desligadas' : streams.length ? `${streams.filter(x => x.notify).length} de ${streams.length}` : 'Nenhum streamer', '/notifications'],
    ['Skin', s.name, '/skins'],
    ['Importar seguidos', 'Twitch · YouTube', '/import?from=settings'],
  ];

  // sair pode levar alguns segundos (manda o que falta para a conta e tira o push deste aparelho)
  const leave = async () => {
    setLeaving(true);
    await signOut().catch(() => {});
    setLeaving(false);
    if (!useStore.getState().account) useStore.getState().showToast('Você saiu. A lista continua neste aparelho.');
  };

  return (
    <Screen>
      <View style={{ gap: 14 }}>
        <Chrome r={18} shadow="inset 0 2px 1px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.14)" style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <AccountBadge size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <T s={15} w={700} c={s.frameInk}>{accountTitle(account?.provider)}</T>
            <T s={12.5} c={s.frameMuted}>{accountSub(!!account)}</T>
          </View>
          {account ? (
            <Btn h={34} label={leaving ? 'Saindo…' : 'Sair'} onPress={leaving ? undefined : leave} />
          ) : (
            <Btn h={34} label="Entrar" onPress={() => go('/onboarding?from=settings')} />
          )}
        </Chrome>
        <Card style={{ overflow: 'hidden' }}>
          {items.map(([label, value, href], i) => (
            <Pressable
              key={href}
              role="link"
              aria-label={`${label}: ${value}`}
              {...enterKey(() => go(href))}
              onPress={() => go(href)}
              style={(st: Hover) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 14, backgroundColor: st.hovered ? s.field : undefined, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: s.line })}>
              <T s={15} w={600} style={{ flex: 1 }}>{label}</T>
              <T s={13} c={s.muted}>{value}</T>
              <T s={18} c={s.muted} decorative>›</T>
            </Pressable>
          ))}
        </Card>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T s={15} w={600}>Sons dos botões</T>
            <T s={12} c={s.muted}>{Platform.OS === 'web' ? 'Clique nos botões e nos interruptores.' : 'Clique nos botões e nos interruptores. Respeita o modo silencioso do celular.'}</T>
          </View>
          <Switch on={uiSounds} label="Sons dos botões" onPress={() => useStore.setState({ uiSounds: !uiSounds })} />
        </Card>
        <DownloadApk variant="card" />
      </View>
    </Screen>
  );
}

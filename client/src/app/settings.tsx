import { Pressable, View } from 'react-native';

import { signOut } from '@/account';
import { go } from '@/open';
import { AccountBadge, Screen, accountSub, accountTitle } from '@/Shell';
import { langSummary, useLists, useStore } from '@/store';
import { Btn, Card, Chrome, T, useSkin } from '@/ui';

export default function Settings() {
  const s = useSkin();
  const account = useStore(st => st.account);
  const langs = useStore(st => st.langs);
  const notifyAll = useStore(st => st.notifyAll);
  const shown = useLists().all.filter(x => langs.includes(x.effLang));

  const items: [string, string, string][] = [
    ['Idiomas', langSummary(langs), '/languages'],
    ['Notificações', notifyAll ? `${shown.filter(x => x.notify).length} de ${shown.length}` : 'Desligadas', '/notifications'],
    ['Skin', s.name, '/skins'],
    ['Importar seguidos', 'Twitch · YouTube', '/import'],
  ];

  return (
    <Screen>
      <View style={{ gap: 14 }}>
        <Chrome r={18} shadow="inset 0 2px 1px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.14)" style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <AccountBadge size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <T s={15} w={700} c={s.frameInk}>{accountTitle(account?.provider)}</T>
            <T s={12.5} c={s.frameMuted}>{accountSub(!!account)}</T>
          </View>
          <Btn h={34} label={account ? 'Sair' : 'Entrar'} onPress={() => (account ? void signOut() : go('/onboarding'))} />
        </Chrome>
        <Card style={{ overflow: 'hidden' }}>
          {items.map(([label, value, href], i) => (
            <Pressable key={href} onPress={() => go(href)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 14, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: s.line }}>
              <T s={15} w={600} style={{ flex: 1 }}>{label}</T>
              <T s={13} c={s.muted}>{value}</T>
              <T s={18} c={s.muted}>›</T>
            </Pressable>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

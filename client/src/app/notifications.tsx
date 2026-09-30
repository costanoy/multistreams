import { Pressable, View } from 'react-native';

import { go } from '@/open';
import { Screen } from '@/Shell';
import { useLists, useStore } from '@/store';
import { Avatar, Btn, Card, Chrome, PlatChip, Switch, T, useSkin } from '@/ui';

export default function Notifications() {
  const s = useSkin();
  const account = useStore(st => st.account);
  const notifyAll = useStore(st => st.notifyAll);
  const langs = useStore(st => st.langs);
  const toggleNotify = useStore(st => st.toggleNotify);
  const shown = useLists().all.filter(x => langs.includes(x.effLang));
  const on = shown.filter(x => x.notify).length;

  return (
    <Screen>
      <View style={{ gap: 14 }}>
        {!account ? (
          <Chrome r={16} shadow="inset 0 2px 1px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.2)" style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <T s={13} lh={1.4} c={s.frameInk} style={{ flex: 1 }}>Push precisa de conta. Entre para receber avisos no celular.</T>
            <Btn h={34} kind="accent" label="Entrar" onPress={() => go('/onboarding')} />
          </Chrome>
        ) : null}
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T s={15} w={700}>Avisar quando entrarem ao vivo</T>
            <T s={12.5} c={s.muted}>{notifyAll ? `${on} de ${shown.length} streamers com aviso` : 'Todos os avisos desligados'}</T>
          </View>
          <Switch on={notifyAll} onPress={() => useStore.setState({ notifyAll: !notifyAll })} />
        </Card>
        {shown.length ? (
          <Card style={{ overflow: 'hidden', opacity: notifyAll ? 1 : 0.45 }}>
            {shown.map((item, i) => (
              <Pressable key={item.id} onPress={() => go(`/streamer?id=${encodeURIComponent(item.id)}&from=notifications`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, borderBottomWidth: i < shown.length - 1 ? 1 : 0, borderBottomColor: s.line }}>
                <Avatar uri={item.avatar} name={item.name} size={32} />
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <T s={14} w={600} lines={1}>{item.name}</T>
                  <PlatChip plat={item.plat} size={15} />
                </View>
                <Switch small on={item.notify && notifyAll} onPress={() => toggleNotify(item.id)} />
              </Pressable>
            ))}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

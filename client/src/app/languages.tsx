import { View } from 'react-native';

import { LangList } from '@/LangList';
import { Screen, useWide } from '@/Shell';
import { useStore } from '@/store';
import { DEFAULT_LANGS, LANG_ORDER } from '@/theme';
import { Btn, Card, T, useSkin } from '@/ui';

export default function Languages() {
  const s = useSkin();
  const wide = useWide();
  return (
    <Screen>
      <View style={{ gap: 14 }}>
        <T s={13.5} lh={1.45} c={s.muted}>A aba Ao vivo mostra só as lives nas línguas marcadas. Em Seguindo, quem estiver ao vivo em outra língua aparece em “Fora dos filtros”.</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn h={34} fs={13} kind="outline" label="Só a minha língua" onPress={() => useStore.setState({ langs: DEFAULT_LANGS })} />
          <Btn h={34} fs={13} kind="outline" label="Marcar todas" onPress={() => useStore.setState({ langs: [...LANG_ORDER] })} />
        </View>
        <Card style={{ padding: 6 }}>
          <LangList cols={wide ? 4 : 1} />
        </Card>
      </View>
    </Screen>
  );
}

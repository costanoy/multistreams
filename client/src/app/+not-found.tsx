import { usePathname } from 'expo-router';
import { View } from 'react-native';

import { goBack } from '@/open';
import { Screen } from '@/Shell';
import { Btn, Chrome, Eq, Lcd, LcdText, T, useSkin } from '@/ui';

/** Endereço que não existe (link antigo, erro de digitação, deep link desconhecido): dentro da carcaça, com saída para Ao vivo. */
export default function NotFound() {
  const s = useSkin();
  const path = usePathname();
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 18, paddingTop: 22, paddingHorizontal: 12, paddingBottom: 12 }}>
        <Chrome style={{ padding: 10 }}>
          <Lcd r={12} decorative style={{ width: 180, paddingVertical: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <LcdText s={34}>404</LcdText>
            <Eq color={s.lcdFg} h={30} w={5} bars={5} gap={3} still />
          </Lcd>
        </Chrome>
        <View style={{ gap: 6, maxWidth: 340, alignItems: 'center' }}>
          <T s={22} w={700} lh={1.15} center>Esse endereço não existe</T>
          <T s={14} lh={1.45} c={s.muted} center>O link pode estar errado ou ser de uma versão antiga do Multistreams.</T>
          <T font="mono" s={12.5} c={s.muted} center lines={2}>{path.length > 60 ? `${path.slice(0, 59)}…` : path}</T>
        </View>
        {/* troca esta tela pela lista (ou volta até ela), sem deixar o endereço errado no histórico */}
        <View style={{ width: '100%', maxWidth: 340 }}>
          <Btn kind="accent" label="Ir para Ao vivo" onPress={() => goBack('/')} />
        </View>
      </View>
    </Screen>
  );
}

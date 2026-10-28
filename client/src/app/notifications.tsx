import { FlatList, Platform, Pressable, View } from 'react-native';

import { supabase } from '@/account';
import { go } from '@/open';
import { openNotificationSettings, registerPush, usePushState } from '@/push';
import { ScreenTitle, enterKey, useColumn, usePad } from '@/Shell';
import { Item, useLists, useStore } from '@/store';
import { PLAT } from '@/theme';
import { Avatar, Btn, Card, Chrome, PlatChip, Switch, T, useSkin } from '@/ui';

const web = Platform.OS === 'web';

export default function Notifications() {
  const s = useSkin();
  const pad = usePad();
  const col = useColumn();
  // todos os seguidos, sem o filtro de línguas: o aviso chega de qualquer um com aviso ligado
  const shown = [...useLists().all].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  const last = shown.length - 1;

  // a lista é o próprio rolador da tela (virtualizada): o aviso e o interruptor geral vão no topo dela
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: s.panel }}
      contentContainerStyle={pad}
      data={shown}
      keyExtractor={x => x.id}
      renderItem={({ item, index }) => (
        <View style={col}>
          <Row item={item} first={index === 0} last={index === last} />
        </View>
      )}
      ListHeaderComponent={
        <View style={[col, { gap: 16, marginBottom: 14 }]}>
          <ScreenTitle />
          <View style={{ gap: 14 }}>
            <Banner />
            <General total={shown.length} on={shown.filter(x => x.notify).length} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={col}>
          <Card style={{ padding: 18, gap: 10, alignItems: 'center' }}>
            <T s={15} w={700} center>Você ainda não segue ninguém.</T>
            <T s={13} c={s.muted} center>Adicione streamers para escolher de quem receber aviso.</T>
            <Btn kind="accent" h={42} fs={14} label="Adicionar streamer" onPress={() => go('/add')} />
          </Card>
        </View>
      }
    />
  );
}

/** Por que o aviso pode não chegar neste aparelho, e o que fazer. */
function Banner() {
  const s = useSkin();
  const account = useStore(st => st.account);
  const push = usePushState(st => st.state);
  const login = { label: 'Entrar', onPress: () => go('/onboarding?from=notifications') };

  let text: string | null = null;
  let action: { label: string; onPress: () => void } | null = null;
  if (!account) {
    text = web ? 'Os avisos chegam no app do celular e precisam de conta.' : 'Push precisa de conta. Entre para receber avisos no celular.';
    action = login;
  } else if (web) {
    // no navegador não há push (registerPush não faz nada na web)
    text = 'No navegador não chegam avisos. Eles vão para o app no celular, entrando com esta mesma conta.';
  } else if (push === 'denied') {
    text = 'As notificações do app estão bloqueadas nos ajustes do celular.';
    action = { label: 'Abrir ajustes', onPress: openNotificationSettings };
  } else if (push === 'unavailable') {
    text = 'Os avisos ainda não estão disponíveis nesta versão do app.';
  } else if (push === 'error') {
    text = 'Não deu para ligar os avisos neste celular agora.';
    action = {
      label: 'Tentar de novo',
      onPress: () => {
        if (supabase) void registerPush(supabase, account.userId);
      },
    };
  }
  if (!text) return null;

  return (
    <Chrome r={16} shadow="inset 0 2px 1px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.2)" style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <T s={13} lh={1.4} c={s.frameInk} style={{ flex: 1 }}>{text}</T>
      {action ? <Btn h={34} kind="accent" label={action.label} onPress={action.onPress} /> : null}
    </Chrome>
  );
}

/** Interruptor geral dos avisos. */
function General({ total, on }: { total: number; on: number }) {
  const s = useSkin();
  const notifyAll = useStore(st => st.notifyAll);
  const sub = !notifyAll
    ? 'Todos os avisos desligados. Ligue para escolher por streamer.'
    : total
      ? `${on} de ${total} ${total === 1 ? 'streamer' : 'streamers'} com aviso`
      : 'Nenhum streamer na lista';
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T s={15} w={700}>Avisar quando entrarem ao vivo</T>
        <T s={12.5} c={s.muted}>{sub}</T>
      </View>
      <Switch on={notifyAll} label="Avisar quando entrarem ao vivo" onPress={() => useStore.setState({ notifyAll: !notifyAll })} />
    </Card>
  );
}

/** Estado do Pressable na web (o react-native-web informa o hover). */
type Hover = { pressed: boolean; hovered?: boolean };

/** Uma linha por seguido, como pedaço de um card só: abre o Detalhe do canal, e o interruptor liga o aviso dele. */
function Row({ item, first, last }: { item: Item; first: boolean; last: boolean }) {
  const s = useSkin();
  const notifyAll = useStore(st => st.notifyAll);
  // fora das línguas marcadas: o código da língua deixa o filtro à vista
  const otherLang = useStore(st => !st.langs.includes(item.effLang));
  const toggleNotify = useStore(st => st.toggleNotify);
  const open = () => go(`/streamer?id=${encodeURIComponent(item.id)}&from=notifications`);
  const r = 16;
  return (
    <Pressable
      role="link"
      aria-label={`${item.name}, ${PLAT[item.plat].label}. Ajustes do canal`}
      // no app, o leitor de tela lê a linha inteira: o aviso vira uma ação dela
      accessibilityActions={notifyAll ? [{ name: 'notify', label: item.notify ? 'Desligar aviso' : 'Ligar aviso' }] : undefined}
      onAccessibilityAction={e => e.nativeEvent.actionName === 'notify' && toggleNotify(item.id)}
      {...enterKey(open)}
      onPress={open}
      style={(st: Hover) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, opacity: notifyAll ? 1 : 0.45,
        backgroundColor: st.hovered ? s.field : s.card, borderColor: s.line, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: first ? 1 : 0, borderBottomWidth: 1,
        borderTopLeftRadius: first ? r : 0, borderTopRightRadius: first ? r : 0, borderBottomLeftRadius: last ? r : 0, borderBottomRightRadius: last ? r : 0,
      })}>
      <Avatar uri={item.avatar} name={item.name} size={32} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <T s={14} w={600} lines={1}>{item.name}</T>
          <PlatChip plat={item.plat} size={15} />
          {otherLang ? <T s={11} w={700} c={s.muted}>{item.effLang.toUpperCase()}</T> : null}
        </View>
        <T s={11.5} c={s.muted}>Ajustes do canal ›</T>
      </View>
      {/* com os avisos gerais desligados, o interruptor não responde: o toque nele explica, em vez de cair na linha e abrir o canal */}
      <Pressable accessible={false} tabIndex={-1} onPress={() => useStore.getState().showToast('Ligue os avisos gerais primeiro')}>
        <Switch small on={item.notify && notifyAll} disabled={!notifyAll} label={`Avisar quando ${item.name} entrar ao vivo`} onPress={() => toggleNotify(item.id)} />
      </Pressable>
    </Pressable>
  );
}

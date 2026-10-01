import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Importable, TokenExpired, signIn, twitchFollowed, youtubeSubscriptions } from '@/account';
import { go } from '@/open';
import { Screen } from '@/Shell';
import { Provider, useStore } from '@/store';
import { LOCAL, PLAT, Plat } from '@/theme';
import { Avatar, Btn, Card, Check, PlatLogo, T, useSkin } from '@/ui';

const SOURCES: { plat: Plat; provider: Provider; idle: string; connect: string; load: (t: string) => Promise<Importable[]> }[] = [
  { plat: 'twitch', provider: 'twitch', idle: 'Canais que você segue', connect: 'Entrar com Twitch', load: twitchFollowed },
  { plat: 'youtube', provider: 'google', idle: 'Suas inscrições', connect: 'Entrar com Google', load: youtubeSubscriptions },
];

function Source({ src, from }: { src: (typeof SOURCES)[number]; from?: string }) {
  const s = useSkin();
  const token = useStore(st => st.providerTokens[src.provider]);
  const streams = useStore(st => st.streams);
  const [list, setList] = useState<Importable[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const loading = !!token && !list && failed !== token;
  const [done, setDone] = useState(false);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const has = (id: string) => streams.some(x => x.id === id);

  // com o token em mãos (logo após o login), busca a lista
  useEffect(() => {
    if (!token || list) return;
    let stale = false;
    src.load(token)
      .then(r => !stale && setList(r))
      .catch(e => {
        if (stale) return;
        if (e instanceof TokenExpired) return useStore.setState(st => ({ providerTokens: { ...st.providerTokens, [src.provider]: undefined } }));
        setFailed(token);
        useStore.getState().showToast(`Não deu para ler seus canais ${PLAT[src.plat].prep} ${PLAT[src.plat].label}.`);
      });
    return () => {
      stale = true;
    };
  }, [token, list, src]);

  const picked = (list ?? []).filter(c => !has(c.id) && !off[c.id]);
  const showList = !!list && !done;

  const connect = () => {
    if (done) return setDone(false);
    void signIn(src.provider, `/import${from ? `?from=${from}` : ''}`);
  };
  const doImport = () => {
    const { addStreamers, showToast } = useStore.getState();
    const n = addStreamers(picked.map(c => ({ ...c, lang: LOCAL })));
    setDone(true);
    if (n) showToast(`${n} ${n === 1 ? 'canal importado' : 'canais importados'} ${PLAT[src.plat].prep} ${PLAT[src.plat].label}`);
  };

  return (
    <Card style={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <PlatLogo plat={src.plat} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <T s={15} w={700}>{PLAT[src.plat].label}</T>
          <T s={12.5} c={s.muted}>{done ? 'Importado' : list ? `${list.length} ${list.length === 1 ? 'canal encontrado' : 'canais encontrados'}` : src.idle}</T>
        </View>
        {loading ? <ActivityIndicator color={s.muted} /> : !showList ? <Btn h={34} label={done ? 'Rever' : src.connect} color={PLAT[src.plat].color} ink={PLAT[src.plat].ink} onPress={connect} /> : null}
      </View>
      {showList ? (
        <View style={{ gap: 2, borderTopWidth: 1, borderTopColor: s.line, paddingTop: 8 }}>
          {list.map(c => {
            const exists = has(c.id);
            return (
              <Pressable key={c.id} disabled={exists} onPress={() => setOff(o => ({ ...o, [c.id]: !o[c.id] }))} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 4 }}>
                <Check on={!exists && !off[c.id]} dim={exists} size={20} />
                <Avatar uri={c.avatar} name={c.name} size={24} />
                <T s={14} lines={1} style={{ flex: 1 }}>{c.name}</T>
                {exists ? <T s={11.5} c={s.muted}>já na lista</T> : null}
              </Pressable>
            );
          })}
          {list.length === 0 ? <T s={13} c={s.muted} style={{ padding: 8 }}>Nenhum canal encontrado nesta conta.</T> : null}
          <Btn h={44} fs={14} kind="accent" style={{ marginTop: 6 }} label={picked.length ? `Importar ${picked.length} ${picked.length === 1 ? 'canal' : 'canais'}` : 'Nada selecionado'} onPress={picked.length ? doImport : undefined} />
        </View>
      ) : null}
    </Card>
  );
}

export default function Import() {
  const s = useSkin();
  const { from } = useLocalSearchParams<{ from?: string }>();
  return (
    <Screen>
      <View style={{ gap: 12 }}>
        <T s={13.5} lh={1.45} c={s.muted}>Entre com sua conta para trazer quem você já segue. Você escolhe quem entra na lista.</T>
        {SOURCES.map(src => <Source key={src.plat} src={src} from={from} />)}
        <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <PlatLogo plat="kick" size={36} />
          <View style={{ flex: 1, gap: 2 }}>
            <T s={15} w={700}>Kick</T>
            <T s={12.5} c={s.muted}>Sem importação. Adicione pelo link do canal.</T>
          </View>
          <Btn h={34} kind="outline" label="Colar link" onPress={() => go('/add')} />
        </Card>
      </View>
    </Screen>
  );
}

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, View, ViewStyle } from 'react-native';

import { ImportError, Importable, TokenExpired, signIn, twitchFollowed, youtubeSubscriptions } from '@/account';
import { go } from '@/open';
import { ScreenTitle, useColumn, usePad } from '@/Shell';
import { Provider, useStore } from '@/store';
import { LOCAL, PLAT, Plat, Skin } from '@/theme';
import { Avatar, Btn, Check, PlatLogo, Switch, T, WebSlop, spaceKey, useSkin } from '@/ui';

type Source = { plat: Plat; provider: Provider; idle: string; connect: string; load: (t: string) => Promise<Importable[]> };
const TWITCH: Source = { plat: 'twitch', provider: 'twitch', idle: 'Canais que você segue', connect: 'Entrar com Twitch', load: twitchFollowed };
const YOUTUBE: Source = { plat: 'youtube', provider: 'google', idle: 'Suas inscrições', connect: 'Entrar com Google', load: youtubeSubscriptions };

/** Com até tantos canais marcados, os importados entram com aviso ligado; acima, desligado (o interruptor troca). */
const NOTIFY_UP_TO = 20;

/** A leitura falhou: o texto do card e o botão ('retry' tenta com o mesmo token; 'login' entra de novo). */
type Failure = { token: string; msg: string; next: 'retry' | 'login' | null };

const failureOf = (e: unknown, src: Source, token: string): Failure =>
  e instanceof ImportError
    ? // sem permissão, ou conta sem canal ou encerrada: só entrando de novo; configuração do app: nada a fazer aqui
      { token, msg: e.message, next: e.reason === 'config' ? null : e.reason === 'quota' ? 'retry' : 'login' }
    : { token, msg: `Não deu para ler seus canais ${PLAT[src.plat].prep} ${PLAT[src.plat].label}.`, next: 'retry' };

/** Uma plataforma: login, leitura da lista, escolhas e importação. */
function useSource(src: Source, from?: string) {
  const token = useStore(st => st.providerTokens[src.provider]);
  const streams = useStore(st => st.streams);
  const [list, setList] = useState<Importable[] | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [expired, setExpired] = useState<string | null>(null);
  const [doneN, setDoneN] = useState<number | null>(null);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [notifyPick, setNotifyPick] = useState<boolean | null>(null);

  // com o token em mãos (logo após o login), busca a lista; "Tentar de novo" muda attempt e reusa o mesmo token
  useEffect(() => {
    if (!token || list) return;
    let stale = false;
    src.load(token)
      .then(r => !stale && setList(r))
      .catch(e => {
        if (stale) return;
        if (e instanceof TokenExpired) {
          setExpired(e.message);
          useStore.setState(st => ({ providerTokens: { ...st.providerTokens, [src.provider]: undefined } }));
          return;
        }
        setFailed(failureOf(e, src, token));
      });
    return () => {
      stale = true;
    };
  }, [token, list, src, attempt]);

  const failure = failed?.token === token ? failed : null;
  const have = new Set(streams.map(x => x.id));
  const picked = (list ?? []).filter(c => !have.has(c.id) && !off[c.id]);
  // até a pessoa mexer no interruptor, o aviso acompanha quantos estão marcados
  const notify = notifyPick ?? picked.length <= NOTIFY_UP_TO;

  return {
    src, list, failure, have, off, picked, notify, doneN,
    loading: !!token && !list && !failure,
    /** o token venceu: o card volta para "Entrar com…" dizendo por quê */
    expired: token ? null : expired,
    /** a lista aberta para escolher (antes de importar, ou de novo em "Ver lista") */
    open: !!list && doneN === null,
    setOff, setNotifyPick, setDoneN,
    connect: () => void signIn(src.provider, `/import${from ? `?from=${from}` : ''}`),
    retry: () => {
      setFailed(null);
      setAttempt(a => a + 1);
    },
    doImport: () => {
      const { addStreamers, showToast } = useStore.getState();
      const n = addStreamers(picked.map(c => ({ ...c, lang: LOCAL })), notify);
      setDoneN(n);
      showToast(n ? `${n} ${n === 1 ? 'canal importado' : 'canais importados'} ${PLAT[src.plat].prep} ${PLAT[src.plat].label}` : 'Esses canais já estavam na sua lista.');
    },
  };
}

type SourceState = ReturnType<typeof useSource>;
type Section = { key: string; st: SourceState };

/** Pedaço do card de uma plataforma: a lista de canais (virtualizada) fica entre o topo e o fim do card. */
const part = (s: Skin, top: boolean, bottom: boolean): ViewStyle => ({
  backgroundColor: s.card, borderColor: s.line, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: top ? 1 : 0, borderBottomWidth: bottom ? 1 : 0,
  borderTopLeftRadius: top ? 16 : 0, borderTopRightRadius: top ? 16 : 0, borderBottomLeftRadius: bottom ? 16 : 0, borderBottomRightRadius: bottom ? 16 : 0,
});

export default function Import() {
  const s = useSkin();
  const pad = usePad();
  const col = useColumn();
  const { from } = useLocalSearchParams<{ from?: string }>();
  // a volta do login que falhou (ou foi cancelado) também cai aqui, sem conta
  const logged = useStore(st => !!st.account);
  const twitch = useSource(TWITCH, from);
  const youtube = useSource(YOUTUBE, from);
  const sections = [twitch, youtube].map(st => ({ key: st.src.plat, st, data: st.open ? st.list ?? [] : [] }));

  // a lista é o próprio rolador da tela (virtualizada, para contas que seguem centenas de canais)
  return (
    <SectionList<Importable, Section>
      style={{ flex: 1, backgroundColor: s.panel }}
      contentContainerStyle={pad}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      sections={sections}
      keyExtractor={c => c.id}
      renderSectionHeader={({ section }) => <View style={col}><Top st={section.st} /></View>}
      renderItem={({ item, section }) => <View style={col}><Channel c={item} st={section.st} /></View>}
      renderSectionFooter={({ section }) => <View style={[col, { paddingBottom: 12 }]}><Bottom st={section.st} /></View>}
      ListHeaderComponent={
        <View style={[col, { gap: 16, marginBottom: 12 }]}>
          <ScreenTitle />
          {from === 'onboarding' && logged ? (
            <T s={17} w={700} lh={1.3}>Pronto! Escolha quem entra na sua lista.</T>
          ) : (
            <T s={13.5} lh={1.45} c={s.muted}>Entre com a conta da plataforma e escolha quem entra na sua lista.</T>
          )}
        </View>
      }
      ListFooterComponent={
        <View style={[col, { gap: 12 }]}>
          <View style={[part(s, true, true), { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <PlatLogo plat="kick" size={36} />
            <View style={{ flex: 1, gap: 2 }}>
              <T s={15} w={700}>Kick</T>
              <T s={12.5} c={s.muted}>Sem importação. Adicione pelo link do canal.</T>
            </View>
            <Btn h={34} kind="outline" label="Colar link" onPress={() => go('/add')} />
          </View>
          {from === 'onboarding' ? <Btn h={44} fs={14} label="Pular por agora" onPress={() => go('/')} /> : null}
        </View>
      }
    />
  );
}

/** Texto que age como botão ("Marcar todos"). */
function TextAction({ label, onPress }: { label: string; onPress: () => void }) {
  const s = useSkin();
  return (
    <Pressable role="button" onPress={onPress} hitSlop={8}>
      <WebSlop n={8} />
      <T s={13} w={600} c={s.dark ? s.ink : s.accent}>{label}</T>
    </Pressable>
  );
}

/** Topo do card: a plataforma, a situação e o próximo passo. Com a lista fechada, é o card inteiro. */
function Top({ st }: { st: SourceState }) {
  const s = useSkin();
  const { src, list, failure, doneN, open } = st;
  const p = PLAT[src.plat];
  const sub =
    doneN !== null ? (doneN ? `✓ ${doneN} ${doneN === 1 ? 'canal importado' : 'canais importados'}` : 'Nenhum canal novo')
    : list ? `${list.length} ${list.length === 1 ? 'canal encontrado' : 'canais encontrados'}`
    : failure ? failure.msg
    : st.expired ?? src.idle;
  const next =
    st.loading ? <ActivityIndicator color={s.muted} />
    : failure ? (failure.next === 'retry' ? <Btn h={34} label="Tentar de novo" onPress={st.retry} /> : failure.next === 'login' ? <Btn h={34} label={src.connect} color={p.color} ink={p.ink} onPress={st.connect} /> : null)
    : doneN !== null ? <Btn h={34} kind="outline" label="Ver lista" onPress={() => st.setDoneN(null)} />
    : !list ? <Btn h={34} label={src.connect} color={p.color} ink={p.ink} onPress={st.connect} />
    : null;
  const all = list ?? [];
  return (
    <View style={[part(s, true, !open), { padding: 14, paddingBottom: open ? 8 : 14, gap: 12 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <PlatLogo plat={src.plat} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <T s={15} w={700}>{p.label}</T>
          <T s={12.5} c={s.muted}>{sub}</T>
        </View>
        {next}
      </View>
      {doneN !== null ? (
        <Btn h={44} fs={14} kind="accent" label="Ver quem está ao vivo" onPress={() => {
          useStore.setState({ view: 'following' });
          go('/');
        }} />
      ) : null}
      {open ? (
        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 4, paddingTop: all.length > 5 ? 10 : 0, borderTopWidth: 1, borderTopColor: s.line }}>
          {all.length > 5 ? (
            <>
              <TextAction label="Marcar todos" onPress={() => st.setOff({})} />
              <TextAction label="Desmarcar todos" onPress={() => st.setOff(Object.fromEntries(all.map(c => [c.id, true])))} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Um canal da lista, com a caixa de marcar; os que já estão na lista vêm marcados e travados. */
function Channel({ c, st }: { c: Importable; st: SourceState }) {
  const s = useSkin();
  const exists = st.have.has(c.id);
  const on = !exists && !st.off[c.id];
  const toggle = () => st.setOff(o => ({ ...o, [c.id]: !o[c.id] }));
  return (
    <View style={[part(s, false, false), { paddingHorizontal: 14, paddingBottom: 2 }]}>
      <Pressable
        role="checkbox"
        aria-checked={exists || on}
        aria-label={exists ? `${c.name}, já na lista` : c.name}
        aria-disabled={exists}
        disabled={exists}
        {...spaceKey(toggle, exists)}
        onPress={toggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 4 }}>
        <Check on={on} dim={exists} size={20} />
        <Avatar uri={c.avatar} name={c.name} size={24} />
        <T s={14} lines={1} style={{ flex: 1 }}>{c.name}</T>
        {exists ? <T s={11.5} c={s.muted}>já na lista</T> : null}
      </Pressable>
    </View>
  );
}

/** Fim do card com a lista aberta: o aviso dos importados e o botão de importar. */
function Bottom({ st }: { st: SourceState }) {
  const s = useSkin();
  const { list, picked, notify } = st;
  if (!st.open || !list) return null;
  const n = picked.length;
  return (
    <View style={[part(s, false, true), { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 14, gap: 10 }]}>
      {list.length === 0 ? <T s={13} c={s.muted} style={{ padding: 8 }}>Nenhum canal encontrado nesta conta.</T> : null}
      {n ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: s.line }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T s={14} w={600}>Avisar quando entrarem ao vivo</T>
            <T s={12} c={s.muted}>Dá para mudar um por um em Notificações.</T>
          </View>
          <Switch small on={notify} label="Avisar quando os canais importados entrarem ao vivo" onPress={() => st.setNotifyPick(!notify)} />
        </View>
      ) : null}
      <Btn h={44} fs={14} kind="accent" label={n ? `Importar ${n} ${n === 1 ? 'canal' : 'canais'}` : 'Nada selecionado'} onPress={n ? st.doImport : undefined} />
    </View>
  );
}

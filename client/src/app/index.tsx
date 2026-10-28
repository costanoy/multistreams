import { Redirect } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Platform, Pressable, RefreshControl, View, ViewStyle, ViewToken } from 'react-native';

import { LangList } from '@/LangList';
import { go, openStream, openUrl } from '@/open';
import { play } from '@/sounds';
import { ScreenTitle, usePad, useWide } from '@/Shell';
import { CatList } from '@/CatList';
import { Item, LiveCard, Streamer, View as Mode, addedToast, catSummary, langSummary, statusOld, toCard, useHiddenLive, useLists, useLiveCards, useLiveTotal, useStore } from '@/store';
import { AMBER, LANG_ORDER, PLAT, PLATS, SH, fmtCount, fmtLcd, grad } from '@/theme';
import { Avatar, Btn, Card, Check, Chrome, Eq, Label, Lcd, LcdText, PlatChip, PlatLogo, Rise, Segmented, T, Thumb, WebSlop, spaceKey, useSkin } from '@/ui';

type Panel = 'plat' | 'lang' | 'cat';
const PANEL_TITLE: Record<Panel, string> = { plat: 'MOSTRAR LIVES DA', lang: 'MOSTRAR LIVES EM', cat: 'MOSTRAR SÓ ESTAS CATEGORIAS' };

/** No celular, os nomes curtos cabem em 360 px; o leitor de tela ouve sempre o nome longo. */
const MODES: { key: Mode; label: string; short: string }[] = [
  { key: 'desc', label: 'Mais espectadores', short: 'Mais vistas' },
  { key: 'asc', label: 'Menos espectadores', short: 'Menos vistas' },
  { key: 'following', label: 'Seguindo', short: 'Seguindo' },
];
const MODE_FLEX: Record<Mode, number> = { desc: 1.1, asc: 1.1, following: 0.75 };

/** Trocar línguas, plataformas ou categorias espera os toques pararem: cada combinação vira um retrato novo no worker. */
const FILTER_WAIT = 600;
/** Primeira página do Offline e quanto cada "Mostrar mais" acrescenta. */
const OFF_FIRST = 30;
const OFF_MORE = 50;
/** Fora dos filtros: linhas pesadas (tela, foto e bolha), montadas 20 por vez. */
const HIDDEN_PAGE = 20;
/** Linha com 10% na tela conta como visível (só as visíveis animam o equalizador). */
const VIEWABLE = { itemVisiblePercentThreshold: 10 };

/** A tela desmonta a cada troca de aba: guarda onde a lista estava, para voltar lá com os mesmos filtros. */
let scrollMemo = { want: '', y: 0 };

export default function Radar() {
  const onboarded = useStore(s => s.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Live />;
}

const open = (c: LiveCard) => (c.followed ? openStream(c.followed, c.followed.status) : c.url ? openUrl(c.url) : undefined);

/**
 * Na web, o react-native-web não chama onPress no Enter de um role="link" (conta com o clique nativo de um <a>,
 * que o <div> não tem): o Enter da linha abre por aqui. Vai por spread, como o heading do T.
 */
const enterOpens = (fn: () => void) =>
  Platform.OS === 'web'
    ? ({ onKeyDown: (e: { key: string; repeat?: boolean; target: unknown; currentTarget: unknown }) => e.key === 'Enter' && !e.repeat && e.target === e.currentTarget && fn() } as object)
    : null;

const hm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dm = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const today = (d: Date) => d.toDateString() === new Date().toDateString();
/** "das 22:10" hoje; "de 27/10 às 22:10" em outro dia */
const statusTime = (t: number) => {
  const d = new Date(t);
  return today(d) ? `das ${hm(d)}` : `de ${dm(d)} às ${hm(d)}`;
};
/** "às 22:10" hoje; "em 27/10" em outro dia */
const seenAt = (t: number) => {
  const d = new Date(t);
  return today(d) ? `às ${hm(d)}` : `em ${dm(d)}`;
};

/** "Twitch, YouTube e Kick" */
const listPt = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs.join(''));

/**
 * Hora do último status que respondeu, só para a linha com status que pode ter mudado (as outras não
 * redesenham a cada minuto). É a mesma hora do aviso de conexão.
 */
const useSeenAt = (c: LiveCard) => useStore(st => (c.stale ? st.statusAt : null));

/** Nome da linha para o leitor de tela: quem, onde, quantos assistem (ou desde quando o status vale) e o título. */
const liveLabel = (c: LiveCard, at: number | null) => {
  const now = c.stale ? `estava ao vivo${at ? ` ${seenAt(at)}` : ''}` : `${fmtCount(c.viewers)} ${c.viewers === 1 ? 'espectador' : 'espectadores'}`;
  return [`${c.name}, ${PLAT[c.plat].label}, ${now}`, c.title].filter(Boolean).join('. ');
};

function Live() {
  const s = useSkin();
  const wide = useWide();
  const pad = usePad();
  const langs = useStore(st => st.langs);
  const platforms = useStore(st => st.platforms);
  const view = useStore(st => st.view);
  const cats = useStore(st => st.cats);
  const partial = useStore(st => st.browsePartial);
  const browseAt = useStore(st => st.browseAt);
  const hasBrowse = useStore(st => st.browse.length > 0);
  const loadMore = useStore(st => st.loadMore);
  const cards = useLiveCards();
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  // linhas na tela (null = ainda não medidas: todas animam)
  const [visible, setVisible] = useState<ReadonlySet<string> | null>(null);

  // "tudo ao vivo" vem do worker, página por página; a lista do usuário é atualizada no layout raiz
  const filters = `${platforms.join()}|${langs.join()}|${cats.join('|')}`;
  const want = `${view}|${filters}`;
  // filtros do último pedido: até o pedido sair, a lista na tela ainda é a dos filtros anteriores
  const [asked, setAsked] = useState(filters);
  const pending = view !== 'following' && asked !== filters;
  const lastFilters = useRef<string | null>(null);
  useEffect(() => {
    const { ensureBrowse, refreshBrowse } = useStore.getState();
    // filtros novos esperam FILTER_WAIT; abrir a tela e trocar o modo pedem na hora
    const wait = lastFilters.current !== null && lastFilters.current !== filters ? FILTER_WAIT : 0;
    lastFilters.current = filters;
    const first = setTimeout(() => {
      setAsked(filters);
      void ensureBrowse();
    }, wait);
    // só com o app (ou a aba do navegador) à vista; ao voltar, atualiza se a lista tiver mais de 30 s
    const timer = setInterval(() => AppState.currentState === 'active' && void refreshBrowse(), 60000);
    const sub = AppState.addEventListener('change', st => st === 'active' && void ensureBrowse());
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      sub.remove();
    };
  }, [view, filters]);
  // enquanto o worker ainda varre a Twitch, a lista cresce: relê com mais frequência
  // (recomeça a cada troca de filtro, para não pedir antes da espera acima)
  useEffect(() => {
    if (!partial || view === 'following') return;
    const timer = setInterval(() => AppState.currentState === 'active' && void useStore.getState().refreshBrowse(), 8000);
    return () => clearInterval(timer);
  }, [partial, view, filters]);

  // puxar para atualizar (só no app; na web o RefreshControl não faz nada)
  const onPull = async () => {
    setPulling(true);
    const { refresh, refreshBrowse } = useStore.getState();
    await Promise.all([refresh(), view === 'following' ? null : refreshBrowse()]);
    setPulling(false);
  };

  const list = useRef<FlatList<LiveCard>>(null);
  const box = useRef(0);
  // ao voltar para a aba, rola até onde estava; uma rolagem antes disso desiste
  const restore = useRef(scrollMemo.want === want ? scrollMemo.y : 0);
  // a FlatList não aceita trocar esta função; no estado ela sobrevive até ao Fast Refresh (o useCallback, não)
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken<LiveCard>[] }) => setVisible(new Set(viewableItems.map(v => v.key))));

  const featured = view !== 'asc' ? cards[0] : undefined;
  const rest = featured ? cards.slice(1) : cards;
  const wrap = { width: '100%' as const, maxWidth: wide ? 1080 : undefined, alignSelf: 'center' as const };
  // filtros novos: a lista anterior fica esmaecida até a nova chegar
  const dim = view !== 'following' && hasBrowse && (browseAt === null || pending) ? { opacity: 0.55 } : null;

  return (
    <FlatList
      ref={list}
      style={{ flex: 1, backgroundColor: s.panel }}
      contentContainerStyle={pad}
      data={rest}
      keyExtractor={c => c.id}
      renderItem={({ item }) => (
        <View style={[wrap, dim]}>
          <Row card={item} thumbW={wide ? 148 : 96} face={wide ? 30 : 22} bubble={wide ? 26 : 22} active={!visible || visible.has(item.id)} />
        </View>
      )}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      // a lista vazia (ou a esmaecida, dos filtros anteriores) já "chega ao fim" sem rolagem: só pede mais com a lista de verdade
      onEndReached={() => {
        if (rest.length && !dim) void loadMore();
      }}
      onEndReachedThreshold={0.8}
      // poucas telas montadas além da visível (o padrão é 21)
      windowSize={7}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABLE}
      onLayout={e => {
        box.current = e.nativeEvent.layout.height;
      }}
      onScroll={e => {
        restore.current = 0;
        scrollMemo = { want, y: e.nativeEvent.contentOffset.y };
      }}
      scrollEventThrottle={100}
      onContentSizeChange={(_w, h) => {
        const y = restore.current;
        if (!y || h < y + box.current) return;
        restore.current = 0;
        list.current?.scrollToOffset({ offset: y, animated: false });
      }}
      refreshControl={Platform.OS === 'web' ? undefined : <RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={s.muted} colors={[s.accent]} progressBackgroundColor={s.card} />}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={[wrap, { gap: 14, marginBottom: 14 }]}>
          <ScreenTitle action={view === 'following' ? { label: '+ Adicionar streamer', onPress: () => go('/add') } : undefined} />
          <Controls pending={pending} />
          <Status pending={pending} onShowHidden={() => setHiddenOpen(true)} />
          {featured ? (
            <View style={dim}>
              <Featured card={featured} thumbW={wide ? 240 : 128} face={wide ? 40 : 28} bubble={wide ? 30 : 24} />
            </View>
          ) : null}
        </View>
      }
      ListFooterComponent={
        <View style={[wrap, { marginTop: 14 }]}>
          <Footer hiddenOpen={hiddenOpen} onToggleHidden={() => setHiddenOpen(o => !o)} />
        </View>
      }
    />
  );
}

function Controls({ pending }: { pending: boolean }) {
  const s = useSkin();
  const wide = useWide();
  const langs = useStore(st => st.langs);
  const platforms = useStore(st => st.platforms);
  const view = useStore(st => st.view);
  const cats = useStore(st => st.cats);
  const hasStreams = useStore(st => st.streams.length > 0);
  const counting = useStore(st => st.browseAt === null);
  const down = useStore(st => st.browseDown);
  const partial = useStore(st => st.browsePartial);
  const togglePlatform = useStore(st => st.togglePlatform);
  const total = useLiveTotal();
  const cards = useLiveCards();
  const statusAt = useStore(st => st.statusAt);
  const [panel, setPanel] = useState<Panel | null>(null);
  // pílulas, para o foco voltar à que abriu o painel
  const pills = useRef<Partial<Record<Panel, View | null>>>({});
  // Seguindo sem ninguém na lista: sem contagem, sem filtros e sem painel
  const bare = view === 'following' && !hasStreams;
  const shown = bare ? null : panel;

  // na web, Esc e "Pronto" fecham o painel e devolvem o foco à pílula (sem isso, ele cai no começo da página)
  useEffect(() => {
    if (Platform.OS !== 'web' || !shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      pills.current[shown]?.focus();
      setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown]);
  const done = () => {
    if (Platform.OS === 'web' && shown) pills.current[shown]?.focus();
    setPanel(null);
  };

  const count = (k: number) => `${k.toLocaleString('pt-BR')} ${k === 1 ? 'CANAL' : 'CANAIS'} NO AR`;
  // Seguindo: status que pode ter mudado não conta como no ar (como no LCD do topo); se só sobrou ele, vale a contagem com a hora
  const fresh = cards.filter(c => !c.stale).length;
  const label =
    view === 'following' ? (fresh || !cards.length ? count(fresh) : statusAt ? `${count(cards.length)} ${seenAt(statusAt).toUpperCase()}` : null)
    // a lista dos filtros atuais ainda não chegou (sem resposta, o aviso acima explica)
    : pending || counting ? (down ? null : 'CONTANDO CANAIS…')
    : partial ? `${total.toLocaleString('pt-BR')}+ CANAIS NO AR`
    : count(total);
  const marked = PLATS.filter(p => platforms.includes(p));
  // no celular, "Todas" cabe ao lado das outras pílulas; o leitor de tela ouve o nome longo
  const langText = !wide && LANG_ORDER.every(k => langs.includes(k)) ? 'Todas' : langSummary(langs);

  const pill = (key: Panel, a11y: string, content: ReactNode, active?: boolean) => {
    const on = shown === key;
    return (
      <Pressable
        ref={el => {
          pills.current[key] = el;
        }}
        onPress={() => setPanel(p => (p === key ? null : key))}
        hitSlop={6}
        role="button"
        aria-expanded={on}
        aria-label={a11y}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: active ? s.accent : s.line, backgroundColor: on ? s.field : s.card, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, flexShrink: 1, maxWidth: 200 }}>
        <WebSlop n={6} />
        {content}
        <T s={10} decorative>{on ? '▴' : '▾'}</T>
      </Pressable>
    );
  };

  return (
    <>
      <NetBanner />
      <Segmented
        options={MODES.map(m => ({ key: m.key, label: wide ? m.label : m.short, a11y: m.label }))}
        value={view}
        onPick={k => {
          if (k === 'following' && !hasStreams) setPanel(null);
          useStore.setState({ view: k });
        }}
        fs={wide ? 13 : 12.5}
        flexOf={wide ? k => MODE_FLEX[k] : undefined}
      />

      {bare ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {/* sem rótulo, um vazio no lugar dele mantém as pílulas à direita */}
          {label ? <Label>{label}</Label> : <View />}
          <View style={{ flexDirection: 'row', gap: 6, flexShrink: 1 }}>
            {pill(
              'plat',
              `Plataformas: ${listPt(marked.map(p => PLAT[p].label))}`,
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 16 }}>{marked.map(p => <PlatLogo key={p} plat={p} size={14} />)}</View>,
              marked.length < PLATS.length,
            )}
            {pill('lang', `Línguas: ${langSummary(langs)}`, <T s={12} w={600} lines={1}>{langText}</T>)}
            {pill('cat', `Categorias: ${cats.join(', ') || 'todas'}`, <T s={12} w={600} lines={1}>{catSummary(cats)}</T>, cats.length > 0)}
          </View>
        </View>
      )}

      {shown ? (
        <Rise key={shown}>
          <Card r={14} style={{ padding: 8, gap: 6, boxShadow: `0 0 0 1px ${s.line}, 0 6px 14px rgba(0,0,0,0.1)` }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 4 }}>
              <T s={11} w={700} ls={0.14} c={s.muted} style={{ flexShrink: 1 }}>{PANEL_TITLE[shown]}</T>
              <Btn h={28} fs={12} px={12} label="Pronto" onPress={done} />
            </View>
            {shown === 'lang' ? <LangList compact cols={wide ? 4 : 2} /> : shown === 'cat' ? <CatList cols={wide ? 3 : 1} /> : (
              <View style={{ flexDirection: wide ? 'row' : 'column' }}>
                {PLATS.map(p => {
                  const on = platforms.includes(p);
                  return (
                    <Pressable key={p} {...spaceKey(() => togglePlatform(p))} onPress={() => togglePlatform(p)} role="checkbox" aria-checked={on} aria-label={PLAT[p].label} style={{ flex: wide ? 1 : undefined, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, margin: 1, paddingHorizontal: 7, borderRadius: 10, backgroundColor: on ? s.field : 'transparent' }}>
                      <Check on={on} />
                      <PlatChip plat={p} size={18} />
                      <T s={12.5} w={600}>{PLAT[p].label}</T>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Card>
        </Rise>
      ) : null}
    </>
  );
}

type Action = { label: string; onPress: () => void };

/** Lista vazia: o motivo, um detalhe e o próximo passo. */
function EmptyCard({ text, sub, action }: { text: string; sub?: string; action?: Action }) {
  const s = useSkin();
  return (
    <Card r={14} style={{ paddingVertical: 22, paddingHorizontal: 16, gap: 10, alignItems: 'center' }}>
      <T s={13.5} lh={1.45} c={s.muted} center>{text}</T>
      {sub ? <T s={12.5} c={s.muted} center>{sub}</T> : null}
      {action ? <Btn h={34} fs={13} label={action.label} onPress={action.onPress} /> : null}
    </Card>
  );
}

/** Carregando, vazio, ou avisos sobre a lista. */
function Status({ pending, onShowHidden }: { pending: boolean; onShowHidden: () => void }) {
  const s = useSkin();
  const view = useStore(st => st.view);
  const count = useStore(st => st.streams.length);
  const cats = useStore(st => st.cats);
  const allPlats = useStore(st => st.platforms.length === PLATS.length);
  const statusAt = useStore(st => st.statusAt);
  const statusDown = useStore(st => st.statusDown);
  const old = useStore(statusOld);
  const browseAt = useStore(st => st.browseAt);
  const browseDown = useStore(st => st.browseDown);
  // ainda sem resposta para os filtros atuais
  const waiting = useStore(st => (st.browseLoading && st.browse.length === 0) || (st.browseAt === null && !st.browseDown));
  const partial = useStore(st => st.browsePartial);
  const empty = useLiveCards().length === 0;
  const hidden = useHiddenLive().length;

  if (view === 'following') {
    if (!count) return <NoFollows />;
    if (!empty) return null;
    if (hidden) return <EmptyCard text="Ninguém que você segue está ao vivo dentro dos filtros." action={{ label: `Ver ${hidden} fora dos filtros`, onPress: onShowHidden }} />;
    // ainda verificando (sem resposta, o aviso acima já explica)
    if (statusAt === null) return statusDown ? null : <ActivityIndicator color={s.muted} style={{ padding: 28 }} />;
    // a última consulta falhou ou ficou velha: não dá para dizer "agora"
    if (old) return <EmptyCard text={count === 1 ? 'O streamer que você segue não estava ao vivo na última consulta.' : `Na última consulta, nenhum dos seus ${count} streamers estava ao vivo.`} />;
    return <EmptyCard text={count === 1 ? 'O streamer que você segue não está ao vivo agora.' : `Nenhum dos seus ${count} streamers está ao vivo agora.`} sub="A lista se atualiza sozinha a cada minuto." />;
  }
  if (empty && (pending || waiting)) return <ActivityIndicator color={s.muted} style={{ padding: 28 }} />;
  if (empty) {
    if (browseDown && browseAt === null) {
      return (
        <EmptyCard
          text="A lista de agora não carregou."
          sub={count ? 'Quem você segue continua em Seguindo, com o último status salvo.' : undefined}
          action={count ? { label: 'Ver Seguindo', onPress: () => useStore.setState({ view: 'following' }) } : undefined}
        />
      );
    }
    if (cats.length) return <EmptyCard text="Ninguém ao vivo nessas categorias agora." action={{ label: 'Limpar categorias', onPress: () => useStore.setState({ cats: [] }) }} />;
    if (!allPlats) return <EmptyCard text="Ninguém ao vivo nas plataformas e línguas marcadas." action={{ label: 'Mostrar as três plataformas', onPress: () => useStore.setState({ platforms: PLATS }) }} />;
    return <EmptyCard text="Ninguém ao vivo nas línguas marcadas. Marque mais línguas no filtro acima." />;
  }
  if (view === 'asc' && partial) {
    return (
      <Card r={12} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ActivityIndicator color={s.muted} />
        <T s={12.5} lh={1.4} c={s.muted} style={{ flex: 1 }}>Ainda juntando todas as lives da Twitch. Os canais com menos espectadores aparecem em instantes.</T>
      </Card>
    );
  }
  return null;
}

/** Botão cromado de seção ("OFFLINE · 3"), que abre e fecha a lista logo abaixo. */
function SectionToggle({ label, name, count, open: on, onPress }: { label: string; name: string; count: number; open: boolean; onPress: () => void }) {
  const s = useSkin();
  return (
    <Pressable
      onPress={onPress}
      role="button"
      aria-expanded={on}
      aria-label={`${name}, ${count} ${count === 1 ? 'canal' : 'canais'}`}
      style={[grad(s.btn, s.btnFlat), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44, paddingHorizontal: 14, marginTop: 6, borderRadius: 12, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.14)' }]}>
      <T s={12} w={700} ls={0.14} c={s.btnInk}>{label} · {count}</T>
      <T s={14} c={s.btnInk} decorative>{on ? '▾' : '▸'}</T>
    </Pressable>
  );
}

function Footer({ hiddenOpen, onToggleHidden }: { hiddenOpen: boolean; onToggleHidden: () => void }) {
  const s = useSkin();
  const wide = useWide();
  const view = useStore(st => st.view);
  const hasStreams = useStore(st => st.streams.length > 0);
  const more = useStore(st => st.browse.length > 0 && st.browse.length < st.browseTotal);
  const moreError = useStore(st => st.browseMoreError);
  const loading = useStore(st => st.browseLoading);
  const { offline } = useLists();
  const hidden = useHiddenLive();
  const shownCards = useLiveCards().length;
  // null = ainda não tocado: o Offline abre sozinho quando ninguém está ao vivo
  const [offOpen, setOffOpen] = useState<boolean | null>(null);
  const [limit, setLimit] = useState(OFF_FIRST);
  const [hiddenLimit, setHiddenLimit] = useState(HIDDEN_PAGE);

  if (view !== 'following') {
    if (!more || !shownCards) return null;
    if (moreError) {
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12 }}>
          <T s={13} c={s.muted}>Não deu para carregar mais.</T>
          <Btn h={34} fs={13} label="Tentar de novo" onPress={() => useStore.getState().retryMore()} />
        </View>
      );
    }
    if (loading) return <ActivityIndicator color={s.muted} style={{ padding: 18 }} />;
    // a rolagem até o fim já pede a próxima página; o botão fica de reserva, se ela não pedir
    return (
      <View style={{ alignItems: 'center', padding: 12 }}>
        <Btn h={34} fs={13} label="Carregar mais" onPress={() => void useStore.getState().loadMore()} />
      </View>
    );
  }
  if (!hasStreams) return null;
  const offShown = offOpen ?? (shownCards === 0 && hidden.length === 0);
  const left = offline.length - limit;
  const hiddenLeft = hidden.length - hiddenLimit;
  return (
    <View style={{ gap: 6 }}>
      {hidden.length ? <SectionToggle label="FORA DOS FILTROS" name="Fora dos filtros" count={hidden.length} open={hiddenOpen} onPress={onToggleHidden} /> : null}
      {/* fora da FlatList, todas ficam montadas: o equalizador fica aceso e parado, como nas linhas fora da tela */}
      {hidden.length && hiddenOpen
        ? hidden.slice(0, hiddenLimit).map(({ item, why }) => <Row key={item.id} card={toCard(item)} note={why} thumbW={wide ? 148 : 96} face={wide ? 30 : 22} bubble={wide ? 26 : 22} active={false} />)
        : null}
      {hiddenOpen && hiddenLeft > 0 ? <Btn h={34} fs={13} label={`Mostrar mais (faltam ${hiddenLeft})`} onPress={() => setHiddenLimit(l => l + HIDDEN_PAGE)} style={{ alignSelf: 'center', marginTop: 4 }} /> : null}
      {offline.length ? <SectionToggle label="OFFLINE" name="Offline" count={offline.length} open={offShown} onPress={() => setOffOpen(!offShown)} /> : null}
      {offShown ? offline.slice(0, limit).map(x => <OffRow key={x.id} item={x} />) : null}
      {offShown && left > 0 ? <Btn h={34} fs={13} label={`Mostrar mais (faltam ${left})`} onPress={() => setLimit(l => l + OFF_MORE)} style={{ alignSelf: 'center', marginTop: 4 }} /> : null}
    </View>
  );
}

/** "Seguindo" sem ninguém na lista: de onde trazer os canais. */
function NoFollows() {
  const s = useSkin();
  return (
    <View style={{ alignItems: 'center', gap: 18, paddingTop: 22, paddingHorizontal: 12, paddingBottom: 12 }}>
      <Chrome style={{ padding: 10 }}>
        <Lcd r={12} decorative style={{ width: 180, paddingVertical: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <LcdText s={34}>00</LcdText>
          <Eq color={s.lcdFg} h={30} w={5} bars={5} gap={3} still />
        </Lcd>
      </Chrome>
      <View style={{ gap: 6, maxWidth: 340 }}>
        <T s={22} w={700} lh={1.15} center>Nenhum streamer ainda</T>
        <T s={14} lh={1.45} c={s.muted} center>Entre com a Twitch e com o Google para trazer quem você já segue. A Kick não libera a lista de seguidos: adicione esses canais pelo link.</T>
      </View>
      <View style={{ width: '100%', maxWidth: 340, gap: 10 }}>
        <Btn kind="accent" label="Importar da Twitch ou YouTube" onPress={() => go('/import?from=radar')} />
        <Btn label="Colar link de um canal" onPress={() => go('/add')} />
      </View>
    </View>
  );
}

function NetBanner() {
  const following = useStore(st => st.view === 'following');
  // Seguindo sem ninguém na lista não consulta nada: o aviso de uma falha antiga não vale
  const down = useStore(st => (st.view === 'following' ? st.streams.length > 0 && st.statusDown : st.browseDown));
  const at = useStore(st => (st.view === 'following' ? st.statusAt : st.browseAt));
  const [busy, setBusy] = useState(false);
  if (!down) return null;
  const retry = async () => {
    setBusy(true);
    const { refresh, refreshBrowse, showToast } = useStore.getState();
    // as duas consultas: o LCD do topo depende do status em qualquer modo (em Seguindo, refreshBrowse não pede nada)
    const [okStatus, okBrowse] = await Promise.all([refresh(), refreshBrowse()]);
    setBusy(false);
    const st = useStore.getState();
    const ok = following ? okStatus : okStatus && okBrowse;
    const now = following ? st.statusDown : st.browseDown || st.statusDown;
    showToast(ok ? 'Conectado. Status atualizado.' : now === 'offline' ? 'Ainda sem conexão.' : 'O servidor ainda não respondeu.');
  };
  const time = at ? statusTime(at) : null;
  // 'server': o servidor falhou ou demorou demais (a rede do aparelho funciona)
  const server = down === 'server';
  const text = server
    ? time ? `O servidor do Multistreams não respondeu. Mostrando o status ${time}.` : 'O servidor do Multistreams não respondeu agora.'
    : time ? `Mostrando o status ${time}. Pode ter mudado.` : 'Ainda não deu para consultar quem está ao vivo.';
  return (
    <Lcd r={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 14 }}>
      <View style={{ flex: 1, gap: 3 }}>
        <LcdText s={13} c={AMBER} glow="rgba(255,179,71,0.7)">{server ? 'SEM RESPOSTA' : 'SEM CONEXAO'}</LcdText>
        <T s={12.5} lh={1.35} c="#e9ecef">{text}</T>
      </View>
      <Btn h={34} label={busy ? 'Tentando…' : 'Tentar agora'} onPress={busy ? undefined : retry} />
    </Lcd>
  );
}

/** ids da lista do usuário, refeitos só quando ela muda (cada linha pergunta pelo seu) */
let followIds: { of: Streamer[]; ids: Set<string> } | null = null;
const isFollowed = (streams: Streamer[], id: string) => {
  if (followIds?.of !== streams) followIds = { of: streams, ids: new Set(streams.map(x => x.id)) };
  return followIds.ids.has(id);
};

/** Seguir pela bolha da live; quem já segue vai para os ajustes do canal. */
function useFollow(card: LiveCard) {
  const followed = useStore(st => isFollowed(st.streams, card.id));
  const act = () => {
    if (followed) {
      play('tap');
      go(`/streamer?id=${encodeURIComponent(card.id)}&from=live`);
      return;
    }
    const { addStreamers, showToast } = useStore.getState();
    if (!addStreamers([{ id: card.id, plat: card.plat, channelId: card.channelId, login: card.login, name: card.name, avatar: card.avatar, lang: card.lang }])) return;
    play('on');
    showToast(addedToast(card.name, card.plat));
  };
  return { followed, act };
}

/**
 * Área de toque da bolha. No app, a própria bolha (a 4 px do canto) com hitSlop; na web, que ignora o hitSlop,
 * o canto da tela da live, com folga transparente de 8 px à esquerda e embaixo e a bolha no mesmo lugar.
 */
const BUBBLE_AREA: ViewStyle = Platform.OS === 'web' ? { position: 'absolute', top: 0, right: 0, paddingTop: 4, paddingRight: 4, paddingLeft: 8, paddingBottom: 8 } : { position: 'absolute', top: 4, right: 4 };

/** Bolha no canto da tela da live, oposto ao da foto: "+" segue; "✓" (já segue) abre os ajustes do canal. */
function FollowBubble({ name, size, followed, act }: { name: string; size: number; followed: boolean; act: () => void }) {
  const s = useSkin();
  return (
    <Pressable onPress={act} hitSlop={8} role="button" aria-label={followed ? `Você segue ${name}. Abrir opções do canal` : `Seguir ${name}`} style={BUBBLE_AREA}>
      <View
        style={[
          followed ? { backgroundColor: s.accent, boxShadow: '0 1px 3px rgba(0,0,0,0.45)' } : [grad(s.btn, s.btnFlat), { boxShadow: SH.bulb }],
          { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' },
        ]}>
        <T s={Math.round(size * 0.62)} w={700} c={followed ? s.accentInk : s.btnInk} decorative>{followed ? '✓' : '+'}</T>
      </View>
    </Pressable>
  );
}

/** Informações da live, iguais no destaque e nas linhas. `note`: por que a live está fora dos filtros. */
function Info({ card, big, ink, muted, active = true, note }: { card: LiveCard; big?: boolean; ink?: string; muted?: string; active?: boolean; note?: string }) {
  const s = useSkin();
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {/* no destaque, o equalizador fica no selo AO VIVO da tela */}
        {big ? null : <Eq color={s.eq} active={active && !card.stale} />}
        <T s={big ? 16 : 15} w={700} c={ink} lines={1}>{card.name}</T>
        <PlatChip plat={card.plat} size={big ? 18 : 16} />
      </View>
      {/* à esquerda também em árabe e hebraico, alinhado com o nome */}
      <T s={13} c={ink} lines={big ? 2 : 1} style={{ textAlign: 'left' }}>{card.title}</T>
      <T s={11.5} c={muted ?? s.muted} lines={1} style={{ textAlign: 'left' }}>{[card.cat, card.lang.toUpperCase()].filter(Boolean).join(' · ')}</T>
      {note ? <T s={11.5} w={600} c={s.muted} lines={2}>{note}</T> : null}
    </View>
  );
}

const Viewers = ({ n }: { n: number }) => {
  const s = useSkin();
  return (
    <Lcd r={7} decorative style={{ paddingTop: 6, paddingHorizontal: 7, paddingBottom: 5, alignItems: 'flex-end', gap: 3, minWidth: 52 }}>
      <LcdText s={13}>{fmtLcd(n)}</LcdText>
      <T s={8} w={700} ls={0.14} c={s.lcdFg}>VIEWERS</T>
    </Lcd>
  );
};

/** No lugar dos viewers, quando o status pode ter mudado: desde quando ele vale (o LCD diria que é agora). */
function Was({ at, c }: { at: number | null; c?: string }) {
  const s = useSkin();
  return (
    <View aria-hidden style={{ alignItems: 'flex-end', gap: 2, opacity: 0.8 }}>
      <T s={10.5} w={600} c={c ?? s.muted}>estava ao vivo</T>
      {at ? <T s={11.5} w={700} c={c ?? s.muted}>{seenAt(at)}</T> : null}
    </View>
  );
}

/** Foto do streamer no canto da tela da live, num botão cromado como o da tela do streamer. */
function Face({ card, size }: { card: LiveCard; size: number }) {
  const s = useSkin();
  const ring = size >= 28 ? 3 : 2;
  return (
    <View style={[grad(s.btn, s.btnFlat), { position: 'absolute', left: ring + 2, bottom: ring + 2, padding: ring, borderRadius: 999, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), 0 2px 5px rgba(0,0,0,0.45)' }]}>
      <Avatar uri={card.avatar} name={card.name} size={size} />
    </View>
  );
}

/** A live com mais espectadores: mesmo formato das linhas, na moldura cromada. */
function Featured({ card, thumbW, face, bubble }: { card: LiveCard; thumbW: number; face: number; bubble: number }) {
  const s = useSkin();
  const follow = useFollow(card);
  const at = useSeenAt(card);
  // hover (web): a moldura ganha o contorno das linhas; no Preto fosco ele clareia
  const hover = `${SH.frame}, 0 0 0 1px ${s.dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'}`;
  return (
    <Pressable
      {...enterOpens(() => open(card))}
      onPress={() => open(card)}
      role="link"
      aria-label={liveLabel(card, at)}
      accessibilityActions={[{ name: 'follow', label: follow.followed ? 'Abrir opções do canal' : 'Seguir' }]}
      onAccessibilityAction={e => e.nativeEvent.actionName === 'follow' && follow.act()}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      {(st: { pressed: boolean; hovered?: boolean }) => (
        <Chrome r={18} shadow={st.hovered ? hover : SH.frame} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 9, paddingRight: 11 }}>
          <Thumb uri={card.thumb} width={thumbW} r={10} shadow="inset 0 0 0 2px rgba(0,0,0,0.5)">
            {/* selo AO VIVO da handoff: o verde do LCD sobre fundo escuro, legível em qualquer skin */}
            <View style={{ position: 'absolute', top: 5, left: 5, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Eq color={s.lcdFg} h={10} active={!card.stale} />
              {thumbW >= 200 && !card.stale ? <T s={10} w={700} ls={0.1} c="#fff">AO VIVO</T> : null}
            </View>
            <Face card={card} size={face} />
            <FollowBubble name={card.name} size={bubble} {...follow} />
          </Thumb>
          <Info card={card} big ink={s.frameInk} muted={s.frameMuted} />
          {card.stale ? <Was at={at} c={s.frameMuted} /> : <Viewers n={card.viewers} />}
        </Chrome>
      )}
    </Pressable>
  );
}

function Row({ card, thumbW, face, bubble, active, note }: { card: LiveCard; thumbW: number; face: number; bubble: number; active?: boolean; note?: string }) {
  const s = useSkin();
  const follow = useFollow(card);
  const at = useSeenAt(card);
  return (
    <Card
      {...enterOpens(() => open(card))}
      r={14}
      onPress={() => open(card)}
      role="link"
      aria-label={note ? `${liveLabel(card, at)}. ${note}` : liveLabel(card, at)}
      accessibilityActions={[{ name: 'follow', label: follow.followed ? 'Abrir opções do canal' : 'Seguir' }]}
      onAccessibilityAction={e => e.nativeEvent.actionName === 'follow' && follow.act()}
      style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 8, paddingRight: 10, boxShadow: SH.card(s.line) }}>
      <Thumb uri={card.thumb} width={thumbW} r={8} shadow={`0 0 0 2px ${s.bezelRing}`}>
        <Face card={card} size={face} />
        <FollowBubble name={card.name} size={bubble} {...follow} />
      </Thumb>
      <Info card={card} active={active} note={note} />
      {card.stale ? <Was at={at} /> : <Viewers n={card.viewers} />}
    </Card>
  );
}

function OffRow({ item }: { item: Item }) {
  const s = useSkin();
  const notifyAll = useStore(st => st.notifyAll);
  // com os avisos gerais desligados nenhum aviso vale: o botão mostra isso e não muda nada por baixo
  const on = item.notify && notifyAll;
  const toggle = () => {
    const { toggleNotify, showToast } = useStore.getState();
    if (notifyAll) toggleNotify(item.id);
    else showToast('Ligue os avisos gerais em Notificações');
  };
  return (
    <Card
      {...enterOpens(() => openStream(item))}
      r={12}
      onPress={() => openStream(item)}
      role="link"
      aria-label={`${item.name}, ${PLAT[item.plat].label}, ${item.offTxt.replace(/…$/, '')}. Abrir canal`}
      accessibilityActions={[{ name: 'notify', label: on ? 'Desligar aviso' : 'Ligar aviso' }]}
      onAccessibilityAction={e => e.nativeEvent.actionName === 'notify' && toggle()}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 10 }}>
      <Avatar uri={item.avatar} name={item.name} size={36} gray={0.6} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <T s={14} w={600} lines={1}>{item.name}</T>
          <PlatChip plat={item.plat} size={15} />
        </View>
        <T s={12} c={s.muted}>{item.offTxt}</T>
      </View>
      <Pressable
        {...spaceKey(toggle)}
        onPress={toggle}
        hitSlop={8}
        role="switch"
        aria-checked={on}
        aria-label={`Avisar quando ${item.name} entrar ao vivo`}
        style={{ height: 28, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: s.line, backgroundColor: on ? s.accent : 'transparent', justifyContent: 'center' }}>
        <WebSlop n={8} />
        <T s={11} w={700} c={on ? s.accentInk : s.muted}>{on ? 'Aviso ligado' : 'Avisar'}</T>
      </Pressable>
    </Card>
  );
}

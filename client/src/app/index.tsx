import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { LangList } from '@/LangList';
import { go, openStream, openUrl } from '@/open';
import { play } from '@/sounds';
import { ScreenTitle, usePad, useWide } from '@/Shell';
import { CatList } from '@/CatList';
import { Item, LiveCard, View as Mode, catSummary, langSummary, platSummary, useLists, useLiveCards, useLiveTotal, useStore } from '@/store';
import { AMBER, PLAT, PLATS, SH, fmt, grad } from '@/theme';
import { Avatar, Btn, Card, Check, Chrome, Eq, Label, Lcd, LcdText, PlatChip, Rise, T, Thumb, useSkin } from '@/ui';

type Panel = 'plat' | 'lang' | 'cat';
const PANEL_TITLE: Record<Panel, string> = { plat: 'MOSTRAR LIVES DA', lang: 'MOSTRAR LIVES EM', cat: 'MOSTRAR SÓ ESTAS CATEGORIAS' };

const MODES: [Mode, string][] =[['desc', 'Mais espectadores'], ['asc', 'Menos espectadores'], ['following', 'Seguindo']];

export default function Radar() {
  const onboarded = useStore(s => s.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Live />;
}

const open = (c: LiveCard) => (c.followed ? openStream(c.followed, c.followed.status) : c.url ? openUrl(c.url) : undefined);

function Live() {
  const s = useSkin();
  const wide = useWide();
  const pad = usePad();
  const langs = useStore(st => st.langs);
  const platforms = useStore(st => st.platforms);
  const view = useStore(st => st.view);
  const cats = useStore(st => st.cats);
  const partial = useStore(st => st.browsePartial);
  const loadMore = useStore(st => st.loadMore);
  const cards = useLiveCards();

  // "tudo ao vivo" vem do worker, página por página; a lista do usuário é atualizada no layout raiz
  const filters = `${view}|${platforms.join()}|${langs.join()}|${cats.join('|')}`;
  useEffect(() => {
    const { refreshBrowse } = useStore.getState();
    void refreshBrowse(true);
    const timer = setInterval(() => void refreshBrowse(), 60000);
    return () => clearInterval(timer);
  }, [filters]);
  // enquanto o worker ainda varre a Twitch, a lista cresce: relê com mais frequência
  useEffect(() => {
    if (!partial || view === 'following') return;
    const timer = setInterval(() => void useStore.getState().refreshBrowse(), 8000);
    return () => clearInterval(timer);
  }, [partial, view]);

  const featured = view !== 'asc' ? cards[0] : undefined;
  const rest = featured ? cards.slice(1) : cards;
  const wrap = { width: '100%' as const, maxWidth: wide ? 1080 : undefined, alignSelf: 'center' as const };

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: s.panel }}
      contentContainerStyle={pad}
      data={rest}
      keyExtractor={c => c.id}
      renderItem={({ item }) => <View style={wrap}><Row card={item} thumbW={wide ? 148 : 96} /></View>}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.8}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={[wrap, { gap: 14, marginBottom: 14 }]}>
          <ScreenTitle action={view === 'following' ? { label: '+ Adicionar streamer', onPress: () => go('/add') } : undefined} />
          <Controls />
          <Status />
          {featured ? <Featured card={featured} thumbW={wide ? 240 : 128} /> : null}
        </View>
      }
      ListFooterComponent={<View style={[wrap, { marginTop: 14 }]}><Footer /></View>}
    />
  );
}

function Controls() {
  const s = useSkin();
  const wide = useWide();
  const langs = useStore(st => st.langs);
  const platforms = useStore(st => st.platforms);
  const view = useStore(st => st.view);
  const cats = useStore(st => st.cats);
  const togglePlatform = useStore(st => st.togglePlatform);
  const total = useLiveTotal();
  const [panel, setPanel] = useState<Panel | null>(null);

  const pill = (key: Panel, label: string, active?: boolean) => (
    <Pressable onPress={() => setPanel(p => (p === key ? null : key))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: active ? s.accent : s.line, backgroundColor: panel === key ? s.field : s.card, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, flexShrink: 1, maxWidth: 200 }}>
      <T s={12} w={600} lines={1}>{label}</T>
      <T s={10}>{panel === key ? '▴' : '▾'}</T>
    </Pressable>
  );

  return (
    <>
      <NetBanner />
      <Chrome r={12} shadow="inset 0 1px 3px rgba(0,0,0,0.25)" style={{ flexDirection: 'row', padding: 3, gap: 3 }}>
        {MODES.map(([value, label]) => {
          const on = view === value;
          return (
            <Pressable key={value} onPress={() => { play('tap'); useStore.setState({ view: value }); }} style={{ flex: value === 'following' ? 0.75 : 1.1, height: 34, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? s.card : 'transparent', boxShadow: on ? '0 1px 3px rgba(0,0,0,0.2)' : undefined }}>
              <T s={wide ? 13 : 11.5} w={600} c={on ? s.ink : s.frameInk} lines={1}>{label}</T>
            </Pressable>
          );
        })}
      </Chrome>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Label>{total.toLocaleString('pt-BR')} {total === 1 ? 'CANAL' : 'CANAIS'} NO AR</Label>
        <View style={{ flexDirection: 'row', gap: 6, flexShrink: 1 }}>
          {pill('plat', platSummary(platforms))}
          {pill('lang', langSummary(langs))}
          {pill('cat', catSummary(cats), cats.length > 0)}
        </View>
      </View>

      {panel ? (
        <Rise key={panel}>
          <Card r={14} style={{ padding: 8, gap: 6, boxShadow: `0 0 0 1px ${s.line}, 0 6px 14px rgba(0,0,0,0.1)` }}>
            <T s={11} w={700} ls={0.14} c={s.muted} style={{ paddingHorizontal: 4, paddingTop: 2 }}>{PANEL_TITLE[panel]}</T>
            {panel === 'lang' ? <LangList compact cols={wide ? 4 : 2} /> : panel === 'cat' ? <CatList cols={wide ? 3 : 1} /> : (
              <View style={{ flexDirection: wide ? 'row' : 'column' }}>
                {PLATS.map(p => {
                  const on = platforms.includes(p);
                  return (
                    <Pressable key={p} onPress={() => togglePlatform(p)} style={{ flex: wide ? 1 : undefined, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, margin: 1, paddingHorizontal: 7, borderRadius: 10, backgroundColor: on ? s.field : 'transparent' }}>
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

/** Carregando, vazio, ou avisos sobre a lista. */
function Status() {
  const s = useSkin();
  const view = useStore(st => st.view);
  const hasStreams = useStore(st => st.streams.length > 0);
  // ainda sem resposta para os filtros atuais
  const waiting = useStore(st => (st.browseLoading && st.browse.length === 0) || (st.browseAt === null && !st.netDown));
  const partial = useStore(st => st.browsePartial);
  const empty = useLiveCards().length === 0;

  if (view === 'following' && !hasStreams) return <NoFollows />;
  if (empty && view !== 'following' && waiting) return <ActivityIndicator color={s.muted} style={{ padding: 28 }} />;
  if (empty) {
    return (
      <Card r={14} style={{ paddingVertical: 22, paddingHorizontal: 16 }}>
        <T s={13.5} lh={1.45} c={s.muted} center>Ninguém ao vivo nas línguas e plataformas marcadas. Marque mais para ver outras lives.</T>
      </Card>
    );
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

function Footer() {
  const s = useSkin();
  const view = useStore(st => st.view);
  const hasStreams = useStore(st => st.streams.length > 0);
  const more = useStore(st => st.browse.length > 0 && st.browse.length < st.browseTotal);
  const { offline } = useLists();
  const [offOpen, setOffOpen] = useState(false);

  if (view !== 'following') return more ? <ActivityIndicator color={s.muted} style={{ padding: 18 }} /> : null;
  if (!hasStreams) return null;
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setOffOpen(o => !o)} style={[grad(s.btn, s.btnFlat), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44, paddingHorizontal: 14, marginTop: 6, borderRadius: 12, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.14)' }]}>
        <T s={12} w={700} ls={0.14} c={s.btnInk}>OFFLINE · {offline.length}</T>
        <T s={14} c={s.btnInk}>{offOpen ? '▾' : '▸'}</T>
      </Pressable>
      {offOpen ? offline.map(x => <OffRow key={x.id} item={x} />) : null}
    </View>
  );
}

/** "Seguindo" sem ninguém na lista: de onde trazer os canais. */
function NoFollows() {
  const s = useSkin();
  return (
    <View style={{ alignItems: 'center', gap: 18, paddingTop: 22, paddingHorizontal: 12, paddingBottom: 12 }}>
      <Chrome style={{ padding: 10 }}>
        <Lcd r={12} style={{ width: 180, paddingVertical: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <LcdText s={34}>00</LcdText>
          <Eq color={s.lcdFg} h={30} w={5} bars={5} gap={3} still />
        </Lcd>
      </Chrome>
      <View style={{ gap: 6, maxWidth: 340 }}>
        <T s={22} w={700} lh={1.15} center>Você ainda não segue ninguém aqui</T>
        <T s={14} lh={1.45} c={s.muted} center>Entre com a Twitch e com o Google para trazer quem você já segue. A Kick não libera a lista de seguidos: adicione esses canais pelo link.</T>
      </View>
      <View style={{ width: '100%', maxWidth: 340, gap: 10 }}>
        <Btn kind="accent" label="Importar da Twitch ou YouTube" onPress={() => go('/import')} />
        <Btn label="Colar link de um canal" onPress={() => go('/add')} />
      </View>
    </View>
  );
}

function NetBanner() {
  const netDown = useStore(st => st.netDown);
  const following = useStore(st => st.view === 'following');
  const at = useStore(st => (st.view === 'following' ? st.statusAt : st.browseAt));
  if (!netDown) return null;
  const retry = async () => {
    const { refresh, refreshBrowse, showToast } = useStore.getState();
    showToast((await (following ? refresh() : refreshBrowse())) ? 'Conectado. Status atualizado.' : 'Ainda sem conexão.');
  };
  const time = at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <Lcd r={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 14 }}>
      <View style={{ flex: 1, gap: 3 }}>
        <LcdText s={13} c={AMBER} glow="rgba(255,179,71,0.7)">SEM CONEXAO</LcdText>
        <T s={12.5} lh={1.35} c="#e9ecef">{time ? `Mostrando o status das ${time}. Pode ter mudado.` : 'Ainda não deu para consultar quem está ao vivo.'}</T>
      </View>
      <Btn h={34} label="Tentar agora" onPress={retry} />
    </Lcd>
  );
}

/** Informações da live, iguais no destaque e nas linhas. */
function Info({ card, big, ink, muted }: { card: LiveCard; big?: boolean; ink?: string; muted?: string }) {
  const s = useSkin();
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Eq color={big ? s.lcdFg : s.eq} />
        <T s={big ? 16 : 15} w={700} c={ink} lines={1}>{card.name}</T>
        <PlatChip plat={card.plat} size={big ? 18 : 16} />
      </View>
      <T s={13} c={ink} lines={big ? 2 : 1}>{card.title}</T>
      <T s={11.5} c={muted ?? s.muted} lines={1}>{[card.cat, card.lang.toUpperCase()].filter(Boolean).join(' · ')}</T>
    </View>
  );
}

const Viewers = ({ n }: { n: number }) => {
  const s = useSkin();
  return (
    <Lcd r={7} style={{ paddingTop: 6, paddingHorizontal: 7, paddingBottom: 5, alignItems: 'flex-end', gap: 3, minWidth: 52 }}>
      <LcdText s={13}>{fmt(n)}</LcdText>
      <T s={8} w={700} ls={0.14} c={s.lcdFg}>VIEWERS</T>
    </Lcd>
  );
};

/** A live com mais espectadores: mesmo formato das linhas, na moldura cromada. */
function Featured({ card, thumbW }: { card: LiveCard; thumbW: number }) {
  const s = useSkin();
  return (
    <Pressable onPress={() => open(card)} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      <Chrome r={18} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 9, paddingRight: 11 }}>
        <Thumb uri={card.thumb} width={thumbW} r={10} shadow="inset 0 0 0 2px rgba(0,0,0,0.5)" />
        <Info card={card} big ink={s.frameInk} muted={s.frameMuted} />
        <Viewers n={card.viewers} />
      </Chrome>
    </Pressable>
  );
}

function Row({ card, thumbW }: { card: LiveCard; thumbW: number }) {
  const s = useSkin();
  return (
    <Card r={14} onPress={() => open(card)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 8, paddingRight: 10, boxShadow: SH.card(s.line) }}>
      <Thumb uri={card.thumb} width={thumbW} r={8} shadow={`0 0 0 2px ${s.bezelRing}`} />
      <Info card={card} />
      <Viewers n={card.viewers} />
    </Card>
  );
}

function OffRow({ item }: { item: Item }) {
  const s = useSkin();
  const toggleNotify = useStore(st => st.toggleNotify);
  return (
    <Card r={12} onPress={() => openStream(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 10 }}>
      <Avatar uri={item.avatar} name={item.name} size={36} gray={0.6} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <T s={14} w={600} lines={1}>{item.name}</T>
          <PlatChip plat={item.plat} size={15} />
        </View>
        <T s={12} c={s.muted}>{item.offTxt}</T>
      </View>
      <Pressable onPress={() => toggleNotify(item.id)} hitSlop={6} style={{ height: 28, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: s.line, backgroundColor: item.notify ? s.accent : 'transparent', justifyContent: 'center' }}>
        <T s={11} w={700} c={item.notify ? s.accentInk : s.muted}>{item.notify ? 'Aviso ligado' : 'Avisar'}</T>
      </Pressable>
    </Card>
  );
}

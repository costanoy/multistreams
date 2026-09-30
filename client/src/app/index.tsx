import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { LangList } from '@/LangList';
import { go, openStream } from '@/open';
import { Screen, useWide } from '@/Shell';
import { Item, langSummary, useLists, useStore } from '@/store';
import { AMBER, SH, fmt, grad } from '@/theme';
import { Avatar, Btn, Card, Chrome, Eq, Label, Lcd, LcdText, PlatChip, Rise, T, Thumb, useSkin } from '@/ui';

export default function Radar() {
  const onboarded = useStore(s => s.onboarded);
  const hasStreams = useStore(s => s.streams.length > 0);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Screen action={{ label: '+ Adicionar streamer', onPress: () => go('/add') }}>{hasStreams ? <Full /> : <Empty />}</Screen>;
}

function Empty() {
  const s = useSkin();
  return (
    <View style={{ alignItems: 'center', gap: 18, paddingTop: 36, paddingHorizontal: 12, paddingBottom: 12 }}>
      <Chrome style={{ padding: 10 }}>
        <Lcd r={12} style={{ width: 180, paddingVertical: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <LcdText s={34}>00</LcdText>
          <Eq color={s.lcdFg} h={30} w={5} bars={5} gap={3} still />
        </Lcd>
      </Chrome>
      <View style={{ gap: 6, maxWidth: 320 }}>
        <T s={22} w={700} lh={1.15} center>Nenhum streamer ainda</T>
        <T s={14} lh={1.45} c={s.muted} center>Adicione quem você acompanha e a gente avisa quem está no ar, em qualquer plataforma.</T>
      </View>
      <View style={{ width: '100%', maxWidth: 340, gap: 10 }}>
        <Btn kind="accent" label="Colar link de um canal" onPress={() => go('/add')} />
        <Btn label="Importar da Twitch ou YouTube" onPress={() => go('/import')} />
      </View>
    </View>
  );
}

function Full() {
  const s = useSkin();
  const wide = useWide();
  const langs = useStore(st => st.langs);
  const { live, offline } = useLists();
  const [langOpen, setLangOpen] = useState(false);
  const [offOpen, setOffOpen] = useState(false);

  return (
    <View style={{ gap: 14 }}>
      <NetBanner />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Label>{live.length} {live.length === 1 ? 'CANAL' : 'CANAIS'} NO AR</Label>
        <Pressable onPress={() => setLangOpen(o => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: s.line, backgroundColor: langOpen ? s.field : s.card, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
          <T s={12} w={600}>{langSummary(langs)}</T>
          <T s={10}>{langOpen ? '▴' : '▾'}</T>
        </Pressable>
      </View>

      {langOpen ? (
        <Rise>
          <Card r={14} style={{ padding: 8, gap: 6, boxShadow: `0 0 0 1px ${s.line}, 0 6px 14px rgba(0,0,0,0.1)` }}>
            <T s={11} w={700} ls={0.14} c={s.muted} style={{ paddingHorizontal: 4, paddingTop: 2 }}>MOSTRAR LIVES EM</T>
            <LangList compact cols={wide ? 4 : 2} />
          </Card>
        </Rise>
      ) : null}

      {live.length === 0 ? (
        <Card r={14} style={{ paddingVertical: 22, paddingHorizontal: 16 }}>
          <T s={13.5} lh={1.45} c={s.muted} center>Ninguém ao vivo nas línguas marcadas. Marque mais línguas para ver outras lives.</T>
        </Card>
      ) : (
        <>
          <Hero item={live[0]} />
          {live.length > 1 ? <View style={{ gap: 8 }}>{live.slice(1).map(x => <Row key={x.id} item={x} thumbW={wide ? 148 : 96} />)}</View> : null}
        </>
      )}

      <Pressable onPress={() => setOffOpen(o => !o)} style={[grad(s.btn, s.btnFlat), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44, paddingHorizontal: 14, marginTop: 6, borderRadius: 12, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.14)' }]}>
        <T s={12} w={700} ls={0.14} c={s.btnInk}>OFFLINE · {offline.length}</T>
        <T s={14} c={s.btnInk}>{offOpen ? '▾' : '▸'}</T>
      </Pressable>
      {offOpen ? <View style={{ gap: 6 }}>{offline.map(x => <OffRow key={x.id} item={x} />)}</View> : null}
    </View>
  );
}

function NetBanner() {
  const netDown = useStore(st => st.netDown);
  const statusAt = useStore(st => st.statusAt);
  if (!netDown) return null;
  const retry = async () => {
    const { refresh, showToast } = useStore.getState();
    showToast((await refresh()) ? 'Conectado. Status atualizado.' : 'Ainda sem conexão.');
  };
  const time = statusAt ? new Date(statusAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
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

function Hero({ item }: { item: Item }) {
  const s = useSkin();
  const st = item.status!;
  return (
    <Pressable onPress={() => openStream(item, st)} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, width: '100%', maxWidth: 720 })}>
      <Chrome style={{ padding: 10, paddingBottom: 14, gap: 12 }}>
        <Thumb uri={st.thumb} r={14} shadow="inset 0 0 0 2px rgba(0,0,0,0.5)">
          <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 6, paddingVertical: 5, paddingHorizontal: 8 }}>
            <Eq color={s.lcdFg} />
            <T s={11} w={700} ls={0.1} c="#fff">AO VIVO</T>
          </View>
          <Lcd r={6} style={{ position: 'absolute', bottom: 10, right: 10, paddingVertical: 6, paddingHorizontal: 8, boxShadow: '0 0 0 1px rgba(255,255,255,0.25)' }}>
            <LcdText s={16}>{fmt(item.viewers)}</LcdText>
          </Lcd>
        </Thumb>
        <View style={{ gap: 4, paddingHorizontal: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T s={18} w={700} c={s.frameInk} lines={1}>{item.name}</T>
            <PlatChip plat={item.plat} size={18} full />
            <T s={11} w={700} c={s.frameMuted}>{item.effLang.toUpperCase()}</T>
          </View>
          {st.title ? <T s={14} lh={1.35} c={s.frameInk}>{st.title}</T> : null}
          {st.cat ? <T s={12.5} c={s.frameMuted}>{st.cat}</T> : null}
        </View>
      </Chrome>
    </Pressable>
  );
}

function Row({ item, thumbW }: { item: Item; thumbW: number }) {
  const s = useSkin();
  const st = item.status!;
  return (
    <Card r={14} onPress={() => openStream(item, st)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 8, paddingRight: 10, boxShadow: SH.card(s.line) }}>
      <Thumb uri={st.thumb} width={thumbW} r={8} shadow={`0 0 0 2px ${s.bezelRing}`} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Eq color={s.eq} />
          <T s={15} w={700} lines={1}>{item.name}</T>
          <PlatChip plat={item.plat} />
        </View>
        <T s={13} lines={1}>{st.title}</T>
        <T s={11.5} c={s.muted} lines={1}>{[st.cat, item.effLang.toUpperCase()].filter(Boolean).join(' · ')}</T>
      </View>
      <Lcd r={7} style={{ paddingTop: 6, paddingHorizontal: 7, paddingBottom: 5, alignItems: 'flex-end', gap: 3, minWidth: 52 }}>
        <LcdText s={13}>{fmt(item.viewers)}</LcdText>
        <T s={8} w={700} ls={0.14} c={s.lcdFg}>VIEWERS</T>
      </Lcd>
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

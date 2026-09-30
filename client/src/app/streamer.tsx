import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { go, openStream, profileUrl } from '@/open';
import { Screen } from '@/Shell';
import { decorate, useStore } from '@/store';
import { DANGER, LANGS, LANG_ORDER, PLAT, SH, fmt, grad } from '@/theme';
import { Avatar, Btn, Card, Chips, Chrome, Eq, Lcd, LcdText, PlatChip, Rise, Switch, T, Thumb, useSkin } from '@/ui';

export default function StreamerDetail() {
  const s = useSkin();
  const { id, from } = useLocalSearchParams<{ id?: string; from?: string }>();
  const st = useStore(x => x.streams.find(y => y.id === id));
  const status = useStore(x => (id ? x.statuses[id] : undefined));
  const notifyAll = useStore(x => x.notifyAll);
  const [confirmRm, setConfirmRm] = useState(false);
  const back = from === 'notifications' ? '/notifications' : '/';
  if (!st) return <Redirect href={back} />;

  const d = decorate(st, status);
  const p = PLAT[d.plat];
  const remove = () => {
    const { removeStreamer, showToast } = useStore.getState();
    go(back);
    removeStreamer(d.id);
    showToast(`${d.name} removido da lista`);
  };

  return (
    <Screen>
      <View style={{ gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Chrome style={{ paddingTop: 22, paddingHorizontal: 16, paddingBottom: 16, alignItems: 'center', gap: 12, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.8), inset 0 -3px 6px rgba(0,0,0,0.25), 0 8px 20px rgba(0,0,0,0.16)' }}>
          <View style={[grad(s.btn, s.btnFlat), { width: 92, height: 92, borderRadius: 46, padding: 5, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.9), inset 0 -3px 6px rgba(0,0,0,0.3), 0 4px 10px rgba(0,0,0,0.25)' }]}>
            <Avatar uri={d.avatar} name={d.name} size={82} gray={d.live ? undefined : 0.5} />
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T s={22} w={700} c={s.frameInk} lines={1}>{d.name}</T>
              <PlatChip plat={d.plat} size={20} full />
            </View>
            <T s={13} c={s.frameMuted}>{d.plat === 'youtube' && d.login ? d.login : profileUrl(d).replace(/^https:\/\/(www\.)?/, '')}</T>
          </View>
          <Lcd r={10} style={{ paddingVertical: 8, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {d.live ? <Eq color={s.lcdFg} h={14} /> : null}
            {d.live ? <LcdText>{`AO VIVO ${fmt(d.viewers)}`}</LcdText> : <LcdText c="#8a9199">OFFLINE</LcdText>}
          </Lcd>
          <T s={12.5} c={s.frameMuted}>
            {d.live ? ['viewers agora', status?.cat].filter(Boolean).join(' · ') : status?.lastLiveAt ? `Última live: ${d.offTxt.replace('ao vivo ', '')}` : d.offTxt}
          </T>
        </Chrome>

        {d.live && status ? (
          <Card onPress={() => openStream(d, status)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10 }}>
            <Thumb uri={status.thumb} width={120} r={9} shadow={`0 0 0 2px ${s.bezelRing}`} />
            <View style={{ flex: 1, gap: 3 }}>
              <T s={14} w={600} lh={1.3}>{status.title}</T>
              {status.cat ? <T s={12} c={s.muted}>{status.cat}</T> : null}
            </View>
          </Card>
        ) : null}

        <Btn h={50} color={p.color} ink={p.ink} label={d.live ? `Assistir no ${p.app}` : `Abrir canal no ${p.app}`} onPress={() => openStream(d, status)} />

        <Card style={{ overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: s.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T s={15} w={600}>Avisar quando entrar ao vivo</T>
              <T s={12} c={s.muted}>{!notifyAll ? 'Avisos gerais desligados em Notificações' : d.notify ? 'Ligado' : 'Desligado'}</T>
            </View>
            <Switch on={d.notify && notifyAll} onPress={() => useStore.getState().toggleNotify(d.id)} />
          </View>
          <View style={{ gap: 10, padding: 14 }}>
            <View style={{ gap: 2 }}>
              <T s={15} w={600}>Idioma do streamer</T>
              <T s={12} c={s.muted}>Usado no filtro de línguas quando a plataforma não informa.</T>
            </View>
            <Chips options={[...new Set([...LANG_ORDER.slice(0, 6), d.lang])].map(k => ({ key: k, label: LANGS[k] ?? k }))} value={d.lang} onPick={k => useStore.getState().setStreamerLang(d.id, k)} />
          </View>
        </Card>

        {confirmRm ? (
          <Rise>
            <Card style={{ padding: 14, gap: 10, boxShadow: SH.ring('rgba(210,59,59,0.45)') }}>
              <T s={14} w={600} lh={1.4}>Remover {d.name}? Você para de receber avisos deste canal.</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn h={42} fs={14} label="Cancelar" color={s.field} ink={s.ink} flat style={{ flex: 1, borderWidth: 1, borderColor: s.line }} onPress={() => setConfirmRm(false)} />
                <Btn h={42} fs={14} label="Remover" color={DANGER} flat style={{ flex: 1 }} onPress={remove} />
              </View>
            </Card>
          </Rise>
        ) : (
          <Pressable onPress={() => setConfirmRm(true)} style={{ height: 46, borderWidth: 1, borderColor: s.line, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
            <T s={14} w={600} c={DANGER}>Remover da lista</T>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

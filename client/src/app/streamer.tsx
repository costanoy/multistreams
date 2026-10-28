import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { Status } from '@/api';
import { LangPicker } from '@/LangPicker';
import { goBack, openStream, profileUrl } from '@/open';
import { Screen, enterKey } from '@/Shell';
import { play } from '@/sounds';
import { Streamer, decorate, statusOld, useStore } from '@/store';
import { DANGER, PLAT, SH, ago, fmtLcd, grad } from '@/theme';
import { Avatar, Btn, Card, Chrome, Eq, Lcd, LcdText, PlatChip, Rise, Switch, T, Thumb, WebSlop, useSkin } from '@/ui';

/** Quando o status foi conferido (ms): "às 22:00", "ontem às 22:00" ou "em 12/10 às 22:00". */
function checkedWhen(ms: number): string | null {
  if (!(ms > 0)) return null;
  const t = new Date(ms);
  const hm = t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (t.toDateString() === now.toDateString()) return `às ${hm}`;
  if (t.toDateString() === yesterday.toDateString()) return `ontem às ${hm}`;
  return `em ${t.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hm}`;
}

export default function StreamerDetail() {
  const s = useSkin();
  const { id, from } = useLocalSearchParams<{ id?: string; from?: string }>();
  const saved = useStore(x => x.streams.find(y => y.id === id));
  const savedStatus = useStore(x => (id ? x.statuses[id] : undefined));
  const old = useStore(statusOld);
  const statusAt = useStore(x => x.statusAt);
  const notifyAll = useStore(x => x.notifyAll);
  const [confirmRm, setConfirmRm] = useState(false);
  // depois de remover, a tela segue com o que mostrava até a volta terminar (o Redirect empilharia outra entrada)
  const [gone, setGone] = useState<{ st: Streamer; status?: Status } | null>(null);
  const back = from === 'notifications' ? '/notifications' : from === 'add' ? '/add' : '/';
  const st = saved ?? gone?.st;
  const status = saved ? savedStatus : gone?.status;
  if (!st) return <Redirect href={back} />;

  const d = decorate(st, status, old);
  const p = PLAT[d.plat];
  const web = Platform.OS === 'web';
  // status velho (consulta falhou ou ficou para trás) de quem estava ao vivo não aparece como atual
  const liveNow = d.live && !d.stale;
  // com o stale do worker, o checkedAt é a última confirmação dele; velho só do lado do app, vale a última resposta
  // do /status (o checkedAt guardado fica parado no primeiro de um status que não muda), ou o checkedAt, se for mais novo
  const checked = Date.parse(status?.checkedAt ?? '') || 0;
  const when = d.stale && status ? checkedWhen(status.stale ? checked : Math.max(statusAt ?? 0, checked)) : null;
  const line =
    liveNow ? ['espectadores agora', status?.cat].filter(Boolean).join(' · ')
    : d.live ? null
    : status?.lastLiveAt ? `Última live ${ago(status.lastLiveAt)}`
    : status ? 'Sem live recente registrada'
    : 'verificando status…';

  const remove = () => {
    const { removeStreamer, showToast } = useStore.getState();
    setGone({ st, status });
    goBack(back);
    removeStreamer(d.id);
    showToast(`${d.name} removido da lista`);
  };
  const notifyAllOn = () => {
    play('on');
    useStore.setState({ notifyAll: true });
    useStore.getState().showToast('Avisos ligados');
  };

  return (
    <Screen maxWidth={560}>
      <View style={{ gap: 14 }}>
        <Chrome style={{ paddingTop: 22, paddingHorizontal: 16, paddingBottom: 16, alignItems: 'center', gap: 12, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.8), inset 0 -3px 6px rgba(0,0,0,0.25), 0 8px 20px rgba(0,0,0,0.16)' }}>
          <View style={[grad(s.btn, s.btnFlat), { width: 92, height: 92, borderRadius: 46, padding: 5, boxShadow: 'inset 0 2px 1px rgba(255,255,255,0.9), inset 0 -3px 6px rgba(0,0,0,0.3), 0 4px 10px rgba(0,0,0,0.25)' }]}>
            <Avatar uri={d.avatar} name={d.name} size={82} gray={d.live ? undefined : 0.5} />
          </View>
          {/* na web, o texto de uma linha só encolhe (com reticências) se a linha tiver teto de largura;
              o endereço comprido (youtube.com/channel/UC…) quebra em duas linhas, centralizadas */}
          <View style={{ alignItems: 'center', gap: 6, alignSelf: 'stretch' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
              <T s={22} w={700} c={s.frameInk} lines={1}>{d.name}</T>
              <PlatChip plat={d.plat} size={20} full />
            </View>
            <T s={13} c={s.frameMuted} center>{d.plat === 'youtube' && d.login ? (d.login.startsWith('@') ? d.login : '@' + d.login) : profileUrl(d).replace(/^https:\/\/(www\.)?/, '')}</T>
          </View>
          <Lcd r={10} style={{ paddingVertical: 8, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {liveNow ? <Eq color={s.lcdFg} h={14} /> : null}
            {liveNow ? <LcdText>{`AO VIVO ${fmtLcd(d.viewers)}`}</LcdText> : <LcdText c="#8a9199">{d.live ? 'ESTAVA AO VIVO' : 'OFFLINE'}</LcdText>}
          </Lcd>
          {line ? <T s={12.5} c={s.frameMuted} center>{line}</T> : null}
          {d.stale ? <T s={12} c={s.frameMuted} center>{when ? `Conferido ${when}. Pode ter mudado.` : 'O status pode ter mudado.'}</T> : null}
        </Chrome>

        {d.live && status ? (
          <Card
            {...(liveNow ? enterKey(() => openStream(d, status)) : null)}
            onPress={liveNow ? () => openStream(d, status) : undefined}
            role={liveNow ? 'link' : undefined}
            aria-label={liveNow ? `Assistir: ${status.title}` : undefined}
            style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 10, opacity: liveNow ? 1 : 0.55 }}>
            <Thumb uri={status.thumb} width={120} r={9} shadow={`0 0 0 2px ${s.bezelRing}`} />
            <View style={{ flex: 1, gap: 3 }}>
              <T s={14} w={600} lh={1.3}>{status.title}</T>
              {status.cat ? <T s={12} c={s.muted}>{status.cat}</T> : null}
            </View>
          </Card>
        ) : null}

        <Btn
          h={50}
          color={p.color}
          ink={p.ink}
          label={liveNow ? (web ? `Assistir ${p.in}` : `Assistir no ${p.app}`) : web ? `Abrir canal ${p.in}` : `Abrir canal no ${p.app}`}
          onPress={() => openStream(d, liveNow ? status : undefined)}
        />

        <Card style={{ overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: notifyAll ? 0 : 12, borderBottomWidth: 1, borderBottomColor: s.line }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T s={15} w={600}>Avisar quando entrar ao vivo</T>
              <T s={12} c={s.muted}>{!notifyAll ? 'Avisos gerais desligados.' : d.notify ? 'Ligado' : 'Desligado'}</T>
              {!notifyAll ? (
                <Pressable role="button" aria-label="Ligar avisos gerais" hitSlop={8} onPress={notifyAllOn} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                  <WebSlop n={8} />
                  <T s={12.5} w={600} c={s.dark ? s.ink : s.accent}>Ligar avisos gerais</T>
                </Pressable>
              ) : null}
            </View>
            {/* com os avisos gerais desligados, o switch deste canal não muda nada */}
            <View style={{ opacity: notifyAll ? 1 : 0.45 }}>
              <Switch on={d.notify && notifyAll} disabled={!notifyAll} label="Avisar quando entrar ao vivo" onPress={() => useStore.getState().toggleNotify(d.id)} />
            </View>
          </View>
          <View style={{ gap: 10, padding: 14 }}>
            <View style={{ gap: 2 }}>
              <T s={15} w={600}>Idioma do streamer</T>
              <T s={12} c={s.muted}>Usado no filtro de línguas quando a plataforma não informa.</T>
            </View>
            {/* o mesmo idioma de novo não grava (cada gravação vai também para a conta) */}
            <LangPicker key={d.id} value={d.lang} suggest={status?.lang} onPick={k => k !== d.lang && useStore.getState().setStreamerLang(d.id, k)} />
          </View>
        </Card>

        {confirmRm ? (
          <Rise>
            <Card style={{ padding: 14, gap: 10, boxShadow: SH.ring(`${s.danger}73`) }}>
              <T s={14} w={600} lh={1.4}>Remover {d.name}? Você para de receber avisos deste canal.</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn h={42} fs={14} label="Cancelar" color={s.field} ink={s.ink} flat style={{ flex: 1, borderWidth: 1, borderColor: s.line }} onPress={() => setConfirmRm(false)} />
                <Btn h={42} fs={14} label="Remover" color={DANGER} flat style={{ flex: 1 }} onPress={remove} />
              </View>
            </Card>
          </Rise>
        ) : (
          <Pressable role="button" aria-label="Remover da lista" onPress={() => setConfirmRm(true)} style={{ height: 46, borderWidth: 1, borderColor: s.line, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
            <T s={14} w={600} c={s.danger}>Remover da lista</T>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

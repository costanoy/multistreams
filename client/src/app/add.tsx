import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Channel, errorText, resolveChannel, searchChannels } from '@/api';
import { go } from '@/open';
import { Screen, useWide } from '@/Shell';
import { addedToast, useStore } from '@/store';
import { AMBER, FONT, LANGS, LANG_ORDER, LOCAL, PLAT, PLATS, Plat, fmtCount, grad } from '@/theme';
import { Avatar, Btn, Card, Chips, Chrome, Lcd, PlatChip, Rise, T, useSkin } from '@/ui';

/** Reconhece a plataforma pelo link do canal. */
const detect = (q: string): { plat: Plat; name: string } | null => {
  let m = q.match(/twitch\.tv\/([\w.-]+)/i);
  if (m) return { plat: 'twitch', name: m[1] };
  m = q.match(/youtube\.com\/(@[\w.-]+)/i) || q.match(/youtube\.com\/channel\/(UC[\w-]{22})/i) || q.match(/youtu\.be\/(@[\w.-]+)/i);
  if (m) return { plat: 'youtube', name: m[1] };
  m = q.match(/kick\.com\/([\w.-]+)/i);
  if (m) return { plat: 'kick', name: m[1] };
  return null;
};

const subOf = (c: Channel) =>
  PLAT[c.platform].label + (c.followers != null ? ` · ${fmtCount(c.followers)} ${c.platform === 'youtube' ? 'inscritos' : 'seguidores'}` : '');
const langOf = (c: Channel) => (c.lang && LANGS[c.lang] ? c.lang : LOCAL);

type Lookup = { state: 'idle' | 'loading' } | { state: 'error'; msg: string } | { state: 'done'; found: Channel[] };

export default function Add() {
  const s = useSkin();
  const wide = useWide();
  const [q, setQ] = useState('');
  const [searchPlat, setSearchPlat] = useState<Plat>('twitch');
  const [addLang, setAddLang] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ target: string; result: Lookup } | null>(null);
  const streams = useStore(st => st.streams);
  const has = (key: string) => streams.some(x => x.id === key);

  const qt = q.trim();
  const det = detect(qt);
  const badLink = !det && !!qt && /(https?:|www\.|\.[a-z]{2,}\/)/i.test(qt);
  const searching = !det && qt.length >= 2 && !badLink;
  const target = det ? `${det.plat}|${det.name}` : searching ? `${searchPlat}|${qt}` : '';
  // a resposta só vale para a consulta atual; enquanto não chega, está carregando
  const look: Lookup = !target ? { state: 'idle' } : answer?.target === target ? answer.result : { state: 'loading' };

  useEffect(() => {
    if (!target) return;
    const [plat, name] = target.split('|') as [Plat, string];
    let stale = false;
    const done = (result: Lookup) => {
      if (stale) return;
      setAnswer({ target, result });
      setAddLang(null);
    };
    const timer = setTimeout(async () => {
      try {
        done({ state: 'done', found: det ? [await resolveChannel(plat, name)] : await searchChannels(plat, name) });
      } catch (e: any) {
        done(e?.code === 'not_found' ? { state: 'done', found: [] } : { state: 'error', msg: errorText(e, plat) });
      }
    }, 450);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `det` é derivado de `target`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const add = (c: Channel, lang: string) => {
    const { addStreamers, showToast } = useStore.getState();
    if (addStreamers([{ id: c.key, plat: c.platform, channelId: c.channelId, login: c.login, name: c.name, avatar: c.avatar, lang }])) {
      showToast(addedToast(c.name, c.platform));
      setQ('');
    }
  };

  const status =
    look.state === 'loading' ? <ActivityIndicator color={s.muted} style={{ padding: 18 }} />
    : look.state === 'error' ? <Card r={12} style={{ padding: 14 }}><T s={13.5} c={s.muted} center>{look.msg}</T></Card>
    : null;
  const found = look.state === 'done' ? look.found : null;

  return (
    <Screen>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: s.field, borderRadius: 14, paddingLeft: 14, paddingRight: 6, boxShadow: `inset 0 2px 4px rgba(0,0,0,0.12), 0 0 0 1px ${s.line}` }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Cole o link ou busque pelo nome"
            placeholderTextColor={s.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[{ flex: 1, height: 48, color: s.ink, fontFamily: FONT[400], fontSize: 15 }, { outlineStyle: 'none' } as never]}
          />
          {q ? (
            <Pressable onPress={() => setQ('')} style={[grad(s.btn, s.btnFlat), { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -2px 4px rgba(0,0,0,0.25)' }]}>
              <T s={14} c={s.btnInk}>×</T>
            </Pressable>
          ) : null}
        </View>

        {!qt ? (
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 10 }}>
            <Card r={14} style={{ flex: wide ? 1 : undefined, padding: 14, gap: 4 }}>
              <T s={14} w={700}>Colar o link</T>
              <T s={12.5} lh={1.4} c={s.muted}>A gente reconhece se é Twitch, YouTube ou Kick.</T>
            </Card>
            <Card r={14} style={{ flex: wide ? 1 : undefined, padding: 14, gap: 4 }}>
              <T s={14} w={700}>Buscar pelo nome</T>
              <T s={12.5} lh={1.4} c={s.muted}>No YouTube, o @handle acha o canal certo.</T>
            </Card>
            <Pressable onPress={() => go('/import?from=add')} style={{ flex: wide ? 1 : undefined }}>
              <Chrome r={14} shadow="inset 0 2px 1px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.2), 0 2px 5px rgba(0,0,0,0.15)" style={{ padding: 14, gap: 4 }}>
                <T s={14} w={700} c={s.frameInk}>Importar seguidos ›</T>
                <T s={12.5} lh={1.4} c={s.frameMuted}>Traga quem você segue na Twitch e no YouTube.</T>
              </Chrome>
            </Pressable>
          </View>
        ) : null}

        {badLink ? (
          <Rise>
            <Card style={{ padding: 16, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Lcd r={7} style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
                  <T font="lcd" s={13} c={AMBER} glow="rgba(255,179,71,0.7)">ERRO</T>
                </Lcd>
                <T s={16} w={700}>Link não reconhecido</T>
              </View>
              <T s={13.5} lh={1.45} c={s.muted}>Por enquanto aceitamos canais da Twitch, do YouTube e da Kick. Confira se o link é de um destes formatos:</T>
              <View style={{ gap: 6 }}>
                {['twitch.tv/nome', 'youtube.com/@handle', 'kick.com/nome'].map(f => (
                  <View key={f} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: s.field }}>
                    <T font="mono" s={12.5}>{f}</T>
                  </View>
                ))}
              </View>
              <Btn h={42} fs={14} label="Buscar pelo nome" onPress={() => setQ('')} />
            </Card>
          </Rise>
        ) : null}

        {det ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <PlatChip plat={det.plat} size={18} />
              <T s={13} w={600}>Link {PLAT[det.plat].prep} {PLAT[det.plat].label} detectado</T>
            </View>
            {status}
            {found && !found.length ? (
              <Card r={12} style={{ padding: 14 }}>
                <T s={13.5} lh={1.45} c={s.muted} center>Não achamos esse canal na {PLAT[det.plat].label === 'YouTube' ? 'plataforma' : PLAT[det.plat].label}. Confira o link.</T>
              </Card>
            ) : null}
            {found?.[0] ? (
              <Rise>
                <Card style={{ padding: 14, gap: 14, boxShadow: `0 0 0 1px ${s.line}, 0 4px 12px rgba(0,0,0,0.06)` }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Avatar uri={found[0].avatar} name={found[0].name} size={48} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T s={16} w={700} lines={1}>{found[0].name}</T>
                      <T s={12.5} c={s.muted}>{subOf(found[0])}</T>
                    </View>
                  </View>
                  <View style={{ gap: 8 }}>
                    <T s={12} w={600} c={s.muted}>Idioma do streamer (usado quando a plataforma não informa)</T>
                    <Chips options={[...new Set([langOf(found[0]), ...LANG_ORDER])].slice(0, 4).map(k => ({ key: k, label: LANGS[k] }))} value={addLang ?? langOf(found[0])} onPick={setAddLang} />
                  </View>
                  {has(found[0].key)
                    ? <Btn h={46} label="Já está na lista" color={s.field} ink={s.muted} flat />
                    : <Btn h={46} kind="accent" label="Adicionar" onPress={() => add(found[0], addLang ?? langOf(found[0]))} />}
                </Card>
              </Rise>
            ) : null}
          </View>
        ) : null}

        {searching ? (
          <View style={{ gap: 10 }}>
            <Chrome r={12} shadow="inset 0 1px 3px rgba(0,0,0,0.25)" style={{ flexDirection: 'row', padding: 3, gap: 3 }}>
              {PLATS.map(k => {
                const on = searchPlat === k;
                return (
                  <Pressable key={k} onPress={() => setSearchPlat(k)} style={{ flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? s.card : 'transparent', boxShadow: on ? '0 1px 3px rgba(0,0,0,0.2)' : undefined }}>
                    <T s={13} w={600} c={on ? s.ink : s.frameInk}>{PLAT[k].label}</T>
                  </Pressable>
                );
              })}
            </Chrome>
            {searchPlat === 'youtube' && !qt.startsWith('@') ? (
              <Card r={10} style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
                <T s={12.5} lh={1.4}>Dica: busque pelo <T s={12.5} w={700}>@handle</T> do canal. Nomes no YouTube se repetem muito.</T>
              </Card>
            ) : null}
            {searchPlat === 'kick' ? (
              <Card r={10} style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
                <T s={12.5} lh={1.4}>Na Kick a busca é pelo nome exato do canal, como aparece no link.</T>
              </Card>
            ) : null}
            {status}
            {found && !found.length ? <T s={13.5} c={s.muted} center style={{ padding: 14 }}>Nenhum canal encontrado.</T> : null}
            {found?.map(c => (
              <Card key={c.key} r={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                <Avatar uri={c.avatar} name={c.name} size={38} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T s={14} w={700} lines={1}>{c.name}</T>
                  <T s={12} c={s.muted} lines={1}>{subOf(c)}</T>
                </View>
                {has(c.key)
                  ? <Btn h={32} label="Já está na lista" color={s.field} ink={s.muted} />
                  : <Btn h={32} kind="accent" label="Adicionar" onPress={() => add(c, langOf(c))} />}
              </Card>
            ))}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

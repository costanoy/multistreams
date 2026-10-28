import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, TextInput, View } from 'react-native';

import { ApiError, Channel, errorText, resolveChannel, searchChannels } from '@/api';
import { LangPicker } from '@/LangPicker';
import { go } from '@/open';
import { Screen, enterKey, useWide } from '@/Shell';
import { play } from '@/sounds';
import { addedToast, useStore } from '@/store';
import { AMBER, FONT, LANGS, LOCAL, PLAT, PLATS, Plat, SH, fmtCount, grad } from '@/theme';
import { Avatar, Btn, Card, Chrome, Label, Lcd, PlatChip, Rise, Segmented, T, WebSlop, useFocusRing, useSkin } from '@/ui';

/** Link de canal (`name`) ou link da plataforma que não é de canal. */
type Det = { plat: Plat; name: string } | { plat: Plat; notChannel: 'video' | 'page' };

/** Primeiro trecho do caminho que não é nome de canal: vídeo ou outra página da plataforma. */
const TWITCH = {
  video: new Set(['videos', 'clip', 'clips']),
  page: new Set(['directory', 'search', 'settings', 'downloads', 'p', 'subscriptions', 'wallet', 'inventory', 'drops', 'prime', 'turbo', 'jobs', 'store', 'following', 'login', 'signup', 'popout', 'moderator', 'team', 'u']),
};
const KICK = {
  video: new Set(['video', 'videos', 'clips']),
  page: new Set(['categories', 'category', 'search', 'browse', 'following', 'dashboard', 'settings', 'login', 'signup']),
};

// o domínio vale no começo, depois de "/", "." ou espaço (não pega "sidekick.com" nem "youtube.comedy")
const TWITCH_RE = /(?:^|[\s/.])twitch\.tv(?=[/?#\s]|$)(?:\/([\w.-]*))?/i;
const KICK_RE = /(?:^|[\s/.])kick\.com(?=[/?#\s]|$)(?:\/([\w.-]*))?/i;
const YOUTUBE_RE = /(?:^|[\s/.])(?:youtube\.com|youtu\.be)(?=[/?#\s]|$)/i;
const YOUTUBE_VIDEO = /youtube\.com\/(?:watch|live|shorts|embed|v)(?=[/?#\s]|$)|youtu\.be\/(?!@)[^/?#\s]/i;

/** O navegador copia com %XX os @handles com acento ou em outro alfabeto. */
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const pathOf = (plat: Plat, seg: string, sets: { video: Set<string>; page: Set<string> }): Det => {
  const k = seg.toLowerCase();
  if (sets.video.has(k)) return { plat, notChannel: 'video' };
  if (!k || sets.page.has(k)) return { plat, notChannel: 'page' };
  return { plat, name: seg };
};

/** @handle (até "/", "?", "#", espaço ou pontuação), id UC… ou os nomes antigos /c/ e /user/ (que viram @handle). */
const youtubeChannel = (q: string): string | null => {
  const h = q.match(/(?:youtube\.com|youtu\.be)\/(@[^/?#\s,;!()<>"']+)/i);
  if (h) return decode(h[1]);
  const id = q.match(/youtube\.com\/channel\/(UC[\w-]{22})/i);
  if (id) return id[1];
  const old = q.match(/youtube\.com\/(?:c|user)\/([^/?#\s,;!()<>"']+)/i);
  return old ? '@' + decode(old[1]) : null;
};

/** Reconhece a plataforma pelo link e diz se ele é de um canal. */
const detect = (q: string): Det | null => {
  if (/(?:^|[\s/.])clips\.twitch\.tv\//i.test(q)) return { plat: 'twitch', notChannel: 'video' };
  let m = q.match(TWITCH_RE);
  if (m) return pathOf('twitch', m[1] ?? '', TWITCH);
  if (YOUTUBE_RE.test(q)) {
    const name = youtubeChannel(q);
    return name ? { plat: 'youtube', name } : { plat: 'youtube', notChannel: YOUTUBE_VIDEO.test(q) ? 'video' : 'page' };
  }
  m = q.match(KICK_RE);
  if (m) return pathOf('kick', m[1] ?? '', KICK);
  return null;
};

const EXAMPLES = ['twitch.tv/gaules', 'youtube.com/@CazeTV', 'kick.com/brkk'];
const FORMAT: Record<Plat, string> = { twitch: 'twitch.tv/nome', youtube: 'youtube.com/@nome', kick: 'kick.com/nome' };

const subOf = (c: Channel) => {
  const n = c.followers;
  // no YouTube a busca pode cair num @handle exato: mostrar qual
  if (c.platform === 'youtube' && c.login) return (c.login.startsWith('@') ? c.login : '@' + c.login) + (n != null ? ` · ${fmtCount(n)} inscritos` : '');
  if (c.platform === 'kick' && n == null && c.login) return `kick.com/${c.login}`;
  return PLAT[c.platform].label + (n != null ? ` · ${fmtCount(n)} ${c.platform === 'youtube' ? 'inscritos' : 'seguidores'}` : '');
};
const langOf = (c: Channel) => (c.lang && LANGS[c.lang] ? c.lang : LOCAL);

/** Tentar de novo não adianta: cota do dia, plataforma ou servidor sem configuração. */
const NO_RETRY = new Set(['quota', 'platform_not_configured', 'no_api']);
/**
 * Cota do YouTube: o errorText sugere colar o link, o que só adianta quando acabaram as buscas ('searches').
 * No link, com as unidades esgotadas ou sem o campo (worker antigo), só resta esperar.
 */
const failText = (e: unknown, plat: Plat, link: boolean) =>
  e instanceof ApiError && e.code === 'quota' && (link || e.bucket !== 'searches') ? 'O YouTube chegou ao limite de consultas de hoje. Tente de novo mais tarde.' : errorText(e, plat);

type Lookup = { state: 'idle' | 'loading' } | { state: 'error'; msg: string; retry: boolean } | { state: 'done'; found: Channel[] };

export default function Add() {
  const s = useSkin();
  const wide = useWide();
  const focus = useFocusRing();
  const input = useRef<TextInput>(null);
  const [q, setQ] = useState('');
  const [searchPlat, setSearchPlat] = useState<Plat>('twitch');
  /** idioma escolhido por canal; sem escolha, vale o detectado */
  const [picks, setPicks] = useState<Record<string, string>>({});
  /** resultado da busca com a escolha de idioma aberta */
  const [langOpen, setLangOpen] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ target: string; result: Lookup } | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Enter: faz agora a consulta que esperava a pausa na digitação */
  const runNow = useRef<(() => void) | null>(null);
  const streams = useStore(st => st.streams);
  const inList = new Set(streams.map(x => x.id));

  const qt = q.trim();
  const det = detect(qt);
  const chan = det && 'name' in det ? det : null;
  const other = det && 'notChannel' in det ? det : null;
  const badLink = !det && !!qt && /(https?:|www\.|\.[a-z]{2,}\/)/i.test(qt);
  const searching = !det && qt.length >= 2 && !badLink;
  // no YouTube cada busca gasta uma das poucas do dia (as de todo mundo): só a partir de 3 letras
  const ready = searching && (searchPlat !== 'youtube' || qt.length >= 3);
  // o modo entra na chave: buscar "gaules" e colar twitch.tv/gaules são consultas diferentes
  const target = chan ? `link|${chan.plat}|${chan.name}` : ready ? `search|${searchPlat}|${qt}` : '';
  // a resposta só vale para a consulta atual; enquanto não chega, está carregando
  const look: Lookup = !target ? { state: 'idle' } : answer?.target === target ? answer.result : { state: 'loading' };

  useEffect(() => {
    if (!target) return;
    const [mode, plat, ...rest] = target.split('|') as [string, Plat, ...string[]];
    const name = rest.join('|');
    const link = mode === 'link';
    let stale = false;
    const run = async () => {
      runNow.current = null;
      let result: Lookup;
      try {
        result = { state: 'done', found: link ? [await resolveChannel(plat, name)] : await searchChannels(plat, name) };
      } catch (e) {
        result =
          e instanceof ApiError && e.code === 'not_found' ? { state: 'done', found: [] }
          : { state: 'error', msg: failText(e, plat, link), retry: !(e instanceof ApiError && NO_RETRY.has(e.code)) };
      }
      if (!stale) setAnswer({ target, result });
    };
    // no YouTube a pausa é maior: digitar devagar não gasta uma busca a cada sílaba
    const timer = setTimeout(run, !link && plat === 'youtube' ? 800 : 450);
    runNow.current = () => {
      clearTimeout(timer);
      void run();
    };
    return () => {
      stale = true;
      clearTimeout(timer);
      runNow.current = null;
    };
  }, [target, attempt]);

  const change = (t: string) => {
    // "@nome" é @handle do YouTube
    if (t.trimStart().startsWith('@') && !q.trimStart().startsWith('@')) setSearchPlat('youtube');
    setQ(t);
  };
  const clear = () => {
    setQ('');
    input.current?.focus();
  };
  const submit = () => {
    runNow.current?.();
    if (!wide) Keyboard.dismiss();
  };
  const retry = () => {
    setAnswer(null);
    setAttempt(a => a + 1);
  };
  const langFor = (c: Channel) => picks[c.key] ?? langOf(c);
  const setLang = (c: Channel, k: string) => setPicks(p => ({ ...p, [c.key]: k }));

  const add = (c: Channel, fromLink: boolean) => {
    const { addStreamers, showToast } = useStore.getState();
    if (addStreamers([{ id: c.key, plat: c.platform, channelId: c.channelId, login: c.login, name: c.name, avatar: c.avatar, lang: langFor(c) }])) {
      showToast(addedToast(c.name, c.platform));
      // na busca, campo e resultados ficam: dá para seguir o mesmo streamer em outra plataforma
      if (fromLink) setQ('');
    }
  };

  const status =
    look.state === 'loading' ? <ActivityIndicator color={s.muted} style={{ padding: 18 }} />
    : look.state === 'error' ? (
      <Card r={12} style={{ padding: 14, gap: 10, alignItems: 'center' }}>
        <T s={13.5} lh={1.45} c={s.muted} center>{look.msg}</T>
        {look.retry ? <Btn h={34} label="Tentar de novo" onPress={retry} /> : null}
      </Card>
    )
    : null;
  const found = look.state === 'done' ? look.found : null;
  const linked = chan ? found?.[0] ?? null : null;

  return (
    <Screen>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: s.field, borderRadius: 14, paddingLeft: 14, paddingRight: 6, boxShadow: `inset 0 2px 4px rgba(0,0,0,0.12), ${focus.focused ? `0 0 0 2px ${s.accent}` : `0 0 0 1px ${s.line}`}` }}>
          <TextInput
            ref={input}
            value={q}
            onChangeText={change}
            placeholder="Cole o link ou busque pelo nome"
            placeholderTextColor={s.muted}
            aria-label="Link ou nome do canal"
            autoCapitalize="none"
            autoCorrect={false}
            enterKeyHint="search"
            onSubmitEditing={submit}
            onFocus={focus.onFocus}
            onBlur={focus.onBlur}
            style={[{ flex: 1, height: 48, color: s.ink, fontFamily: FONT[400], fontSize: 15 }, { outlineStyle: 'none' } as never]}
          />
          {q ? (
            <Pressable role="button" aria-label="Limpar campo" hitSlop={8} onPress={clear} style={[grad(s.btn, s.btnFlat), { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -2px 4px rgba(0,0,0,0.25)' }]}>
              <WebSlop n={8} />
              <T s={14} c={s.btnInk} decorative>×</T>
            </Pressable>
          ) : null}
        </View>

        {!qt ? (
          <>
            <View style={{ gap: 8 }}>
              <Label>EXPERIMENTE COLAR</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {EXAMPLES.map(link => (
                  <Pressable
                    key={link}
                    role="button"
                    aria-label={`Colar ${link}`}
                    hitSlop={6}
                    onPress={() => {
                      play('tap');
                      setQ('https://' + link);
                    }}
                    style={{ height: 32, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', backgroundColor: s.card, boxShadow: SH.ring(s.line) }}>
                    <WebSlop n={6} />
                    <T font="mono" s={12.5}>{link}</T>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={{ flexDirection: wide ? 'row' : 'column', gap: 10 }}>
              <Card r={14} style={{ flex: wide ? 1 : undefined, padding: 14, gap: 4 }}>
                <T s={14} w={700}>Colar o link</T>
                <T s={12.5} lh={1.4} c={s.muted}>A gente reconhece se é Twitch, YouTube ou Kick.</T>
              </Card>
              <Card r={14} style={{ flex: wide ? 1 : undefined, padding: 14, gap: 4 }}>
                <T s={14} w={700}>Buscar pelo nome</T>
                <T s={12.5} lh={1.4} c={s.muted}>No YouTube, o @handle acha o canal certo.</T>
              </Card>
              <Pressable role="link" aria-label="Importar seguidos" {...enterKey(() => go('/import?from=add'))} onPress={() => go('/import?from=add')} style={{ flex: wide ? 1 : undefined }}>
                <Chrome r={14} shadow="inset 0 2px 1px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.2), 0 2px 5px rgba(0,0,0,0.15)" style={{ padding: 14, gap: 4 }}>
                  <T s={14} w={700} c={s.frameInk}>Importar seguidos ›</T>
                  <T s={12.5} lh={1.4} c={s.frameMuted}>Traga quem você segue na Twitch e no YouTube.</T>
                </Chrome>
              </Pressable>
            </View>
          </>
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
              <Btn h={42} fs={14} label="Buscar pelo nome" onPress={clear} />
            </Card>
          </Rise>
        ) : null}

        {other ? (
          <Rise>
            <Card style={{ padding: 16, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Lcd r={7} style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
                  <T font="lcd" s={13} c={AMBER} glow="rgba(255,179,71,0.7)">ERRO</T>
                </Lcd>
                <T s={16} w={700} style={{ flex: 1 }}>{other.notChannel === 'video' ? 'Esse link é de um vídeo' : 'Esse link não é de um canal'}</T>
              </View>
              <T s={13.5} lh={1.45} c={s.muted}>
                Para seguir, abra o canal {PLAT[other.plat].in} e copie o link dele, no formato <T font="mono" s={13} c={s.ink}>{FORMAT[other.plat]}</T>.
              </T>
              <Btn
                h={42}
                fs={14}
                label="Buscar pelo nome"
                onPress={() => {
                  setSearchPlat(other.plat);
                  clear();
                }}
              />
            </Card>
          </Rise>
        ) : null}

        {chan ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <PlatChip plat={chan.plat} size={18} />
              <T s={13} w={600}>Link {PLAT[chan.plat].prep} {PLAT[chan.plat].label} detectado</T>
            </View>
            {status}
            {found && !found.length ? (
              <Card r={12} style={{ padding: 14 }}>
                <T s={13.5} lh={1.45} c={s.muted} center>Não achamos esse canal {PLAT[chan.plat].in}. Confira o link.</T>
              </Card>
            ) : null}
            {linked ? (
              <Rise>
                <Card style={{ padding: 14, gap: 14, boxShadow: `0 0 0 1px ${s.line}, 0 4px 12px rgba(0,0,0,0.06)` }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Avatar uri={linked.avatar} name={linked.name} size={48} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T s={16} w={700} lines={1}>{linked.name}</T>
                      <T s={12.5} c={s.muted}>{subOf(linked)}</T>
                    </View>
                  </View>
                  {inList.has(linked.key) ? (
                    <View style={{ gap: 10 }}>
                      <T s={13.5} c={s.muted}>Já está na sua lista.</T>
                      <Btn kind="outline" h={42} fs={14} label="Ajustes do canal ›" onPress={() => go(`/streamer?id=${encodeURIComponent(linked.key)}&from=add`)} />
                    </View>
                  ) : (
                    <>
                      <View style={{ gap: 8 }}>
                        <T s={12} w={600} c={s.muted}>Idioma do streamer (usado quando a plataforma não informa)</T>
                        <LangPicker key={linked.key} value={langFor(linked)} onPick={k => setLang(linked, k)} />
                      </View>
                      <Btn h={46} kind="accent" label="Adicionar" onPress={() => add(linked, true)} />
                    </>
                  )}
                </Card>
              </Rise>
            ) : null}
          </View>
        ) : null}

        {searching ? (
          <View style={{ gap: 10 }}>
            <Segmented options={PLATS.map(k => ({ key: k, label: PLAT[k].label }))} value={searchPlat} onPick={setSearchPlat} />
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
            {/* dentro da busca, só o YouTube com menos de 3 letras não está pronto */}
            {!ready ? <T s={13.5} c={s.muted} center style={{ padding: 14 }}>No YouTube, digite pelo menos 3 letras.</T> : null}
            {found && !found.length ? <T s={13.5} c={s.muted} center style={{ padding: 14 }}>Nenhum canal encontrado.</T> : null}
            {found?.map(c => (
              <ResultRow
                key={c.key}
                c={c}
                added={inList.has(c.key)}
                lang={langFor(c)}
                open={langOpen === c.key}
                onLangs={() => setLangOpen(o => (o === c.key ? null : c.key))}
                onLang={k => {
                  setLang(c, k);
                  setLangOpen(null);
                }}
                onAdd={() => add(c, false)}
              />
            ))}
            {searchPlat === 'youtube' && found?.length ? <T s={12.5} c={s.muted} center>Não é esse? Cole o link do canal (youtube.com/@…).</T> : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

/** Resultado da busca: o idioma vem do detectado e pode ser trocado antes de adicionar. */
function ResultRow({ c, added, lang, open, onLangs, onLang, onAdd }: { c: Channel; added: boolean; lang: string; open: boolean; onLangs: () => void; onLang: (k: string) => void; onAdd: () => void }) {
  const s = useSkin();
  const wide = useWide();
  const name = LANGS[lang] ?? lang.toUpperCase();
  return (
    <Card r={12} style={{ padding: 10, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar uri={c.avatar} name={c.name} size={38} />
        <View style={{ flex: 1, gap: 2 }}>
          <T s={14} w={700} lines={1}>{c.name}</T>
          <T s={12} c={s.muted} lines={1}>{subOf(c)}</T>
        </View>
        {added ? (
          <Btn h={32} label="Já está na lista" />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* folga só para cima, para baixo e para a esquerda: um toque ao lado não pode cair em "Adicionar"
                (na web o WebSlop vale para os quatro lados, mas os 6 px ficam dentro do vão de 10 até ele) */}
            <Pressable
              role="button"
              aria-label={`Idioma do streamer: ${name}. Trocar`}
              aria-expanded={open}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 0 }}
              onPress={onLangs}
              style={{ height: 32, paddingHorizontal: 10, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: s.field, boxShadow: open ? `0 0 0 2px ${s.accent}` : SH.ring(s.line) }}>
              <WebSlop n={6} />
              <T s={12} w={700}>{wide ? name : lang.toUpperCase()}</T>
              <T s={10} c={s.muted} decorative>{open ? '▴' : '▾'}</T>
            </Pressable>
            <Btn h={32} kind="accent" label="Adicionar" onPress={onAdd} />
          </View>
        )}
      </View>
      {open && !added ? (
        <View style={{ gap: 8 }}>
          <T s={12} w={600} c={s.muted}>Idioma do streamer (usado quando a plataforma não informa)</T>
          <LangPicker value={lang} onPick={onLang} />
        </View>
      ) : null}
    </Card>
  );
}

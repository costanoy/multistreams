import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Category, errorText, fetchCategories } from './api';
import { useStore } from './store';
import { FONT, SH, catKey, fmt, fmtCount, fold } from './theme';
import { Check, PlatLogo, T, WebSlop, spaceKey, useFocusRing, useSkin } from './ui';

/** Quantas categorias o painel desenha de uma vez (cada linha tem até 3 logos); as outras, pela busca. */
const SHOWN = 50;
/** Ao voltar para o app, relê as categorias se a última resposta tiver mais que isso. */
const FRESH_MS = 30_000;

/** Filtro por categoria (jogos, IRL, Just Chatting…), com as categorias de quem está ao vivo agora. */
export function CatList({ cols }: { cols: number }) {
  const s = useSkin();
  const platforms = useStore(st => st.platforms);
  const langs = useStore(st => st.langs);
  const cats = useStore(st => st.cats);
  const toggleCat = useStore(st => st.toggleCat);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ key: string; items: Category[] | null; error?: string } | null>(null);
  const ring = useFocusRing();

  const key = `${platforms.join()}|${langs.join()}`;
  useEffect(() => {
    let stale = false;
    let loading = false;
    // um "de novo em 8 s" caiu com o app (ou a aba) escondido: pede assim que ele voltar
    let missed = false;
    let at = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      timer = undefined;
      loading = true;
      missed = false;
      fetchCategories(platforms, langs)
        .then(r => {
          if (stale) return;
          at = Date.now();
          setRes({ key, items: r.items });
          // a Twitch ainda está sendo varrida: as categorias vão mudar
          if (r.partial) timer = setTimeout(tick, 8000);
        })
        .catch(e => !stale && setRes({ key, items: null, error: errorText(e) }))
        .finally(() => {
          loading = false;
        });
    };
    const tick = () => {
      timer = undefined;
      if (AppState.currentState === 'active') load();
      else missed = true;
    };
    timer = setTimeout(load, 0);
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active' && !loading && !timer && (missed || Date.now() - at > FRESH_MS)) load();
    });
    return () => {
      stale = true;
      clearTimeout(timer);
      sub.remove();
    };
    // `key` resume plataformas e línguas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = res?.key === key ? res : null;
  const chosen = new Set(cats.map(catKey));
  const f = fold(q.trim());
  // as marcadas ficam sempre no topo, mesmo que ninguém esteja ao vivo nelas agora
  const marked: Category[] = cats.map(name => current?.items?.find(c => c.key === catKey(name)) ?? { key: catKey(name), name, viewers: 0, lives: 0, platforms: [] });
  const others = (current?.items ?? []).filter(c => !chosen.has(c.key) && (!f || fold(c.name).includes(f)));
  const all = [...marked.filter(c => !f || fold(c.name).includes(f)), ...others];
  const list = all.slice(0, SHOWN);

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {/* com o foco no campo, o contorno vira um anel na cor de destaque */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: s.field, borderRadius: 10, paddingHorizontal: 10, boxShadow: `inset 0 1px 3px rgba(0,0,0,0.1), ${ring.focused ? `0 0 0 2px ${s.accent}` : `0 0 0 1px ${s.line}`}` }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            onFocus={ring.onFocus}
            onBlur={ring.onBlur}
            aria-label="Buscar categoria ou jogo"
            placeholder="Buscar categoria ou jogo"
            placeholderTextColor={s.muted}
            autoCorrect={false}
            style={[{ flex: 1, height: 34, color: s.ink, fontFamily: FONT[400], fontSize: 13 }, { outlineStyle: 'none' } as never]}
          />
          {q ? (
            <Pressable onPress={() => setQ('')} hitSlop={12} role="button" aria-label="Limpar busca">
              <WebSlop n={12} />
              <T s={15} c={s.muted} decorative>×</T>
            </Pressable>
          ) : null}
        </View>
        {cats.length ? (
          <Pressable onPress={() => useStore.setState({ cats: [] })} hitSlop={7} role="button" aria-label="Limpar categorias" style={{ height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: s.field, boxShadow: SH.ring(s.line), justifyContent: 'center' }}>
            <WebSlop n={7} />
            <T s={12} w={600} c={s.dark ? s.ink : s.accent}>Limpar</T>
          </Pressable>
        ) : null}
      </View>
      <T s={11} c={s.muted} style={{ paddingHorizontal: 4 }}>{cats.length ? `${cats.length} marcada${cats.length > 1 ? 's' : ''}` : 'Nenhuma marcada: aparecem todas.'}</T>
      <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {!current ? <ActivityIndicator color={s.muted} style={{ padding: 16 }} /> : current.error && !marked.length ? (
          <T s={13} c={s.muted} style={{ padding: 10 }}>{current.error}</T>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {list.map(c => {
              const on = chosen.has(c.key);
              return (
                <View key={c.key} style={{ width: `${100 / cols}%`, padding: 1 }}>
                  <Pressable
                    {...spaceKey(() => toggleCat(c.name))}
                    onPress={() => toggleCat(c.name)}
                    role="checkbox"
                    aria-checked={on}
                    aria-label={c.viewers ? `${c.name}, ${fmtCount(c.viewers)} ${c.viewers === 1 ? 'espectador' : 'espectadores'}` : c.name}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 36, paddingHorizontal: 7, borderRadius: 10, backgroundColor: on ? s.field : 'transparent' }}>
                    <Check on={on} />
                    {/* árabe e hebraico também à esquerda, junto do checkbox */}
                    <T s={12.5} w={600} lines={1} style={{ flex: 1, textAlign: 'left' }}>{c.name}</T>
                    <View style={{ flexDirection: 'row', gap: 2 }}>{c.platforms.map(p => <PlatLogo key={p} plat={p} size={12} />)}</View>
                    {c.viewers ? <T s={10.5} w={700} c={s.muted}>{fmt(c.viewers)}</T> : null}
                  </Pressable>
                </View>
              );
            })}
            {list.length === 0 ? <T s={13} c={s.muted} style={{ padding: 10 }}>{f ? 'Nenhuma categoria ao vivo com esse nome.' : 'Ninguém ao vivo nas plataformas e línguas marcadas.'}</T> : null}
            {all.length > SHOWN ? <T s={11.5} c={s.muted} style={{ width: '100%', padding: 10 }}>{`Mostrando ${SHOWN} de ${all.length}. Busque pelo nome para achar as outras.`}</T> : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

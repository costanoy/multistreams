import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Category, errorText, fetchCategories } from './api';
import { useStore } from './store';
import { FONT, catKey, fmt, fold } from './theme';
import { Check, PlatLogo, T, useSkin } from './ui';

/** Filtro por categoria (jogos, IRL, Just Chatting…), com as categorias de quem está ao vivo agora. */
export function CatList({ cols }: { cols: number }) {
  const s = useSkin();
  const platforms = useStore(st => st.platforms);
  const langs = useStore(st => st.langs);
  const cats = useStore(st => st.cats);
  const toggleCat = useStore(st => st.toggleCat);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ key: string; items: Category[] | null; error?: string } | null>(null);

  const key = `${platforms.join()}|${langs.join()}`;
  useEffect(() => {
    let stale = false;
    const load = () =>
      fetchCategories(platforms, langs)
        .then(r => {
          if (stale) return;
          setRes({ key, items: r.items });
          // a Twitch ainda está sendo varrida: as categorias vão mudar
          if (r.partial) timer = setTimeout(load, 8000);
        })
        .catch(e => !stale && setRes({ key, items: null, error: errorText(e) }));
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    return () => {
      stale = true;
      clearTimeout(timer);
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
  const list = [...marked.filter(c => !f || fold(c.name).includes(f)), ...others].slice(0, 200);

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: s.field, borderRadius: 10, paddingHorizontal: 10, boxShadow: `inset 0 1px 3px rgba(0,0,0,0.1), 0 0 0 1px ${s.line}` }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Buscar categoria ou jogo"
            placeholderTextColor={s.muted}
            autoCorrect={false}
            style={[{ flex: 1, height: 34, color: s.ink, fontFamily: FONT[400], fontSize: 13 }, { outlineStyle: 'none' } as never]}
          />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8}><T s={15} c={s.muted}>×</T></Pressable> : null}
        </View>
        {cats.length ? (
          <Pressable onPress={() => useStore.setState({ cats: [] })} hitSlop={6} style={{ paddingHorizontal: 6 }}>
            <T s={12} w={600} c={s.accent === '#8dff5c' ? s.ink : s.accent}>Limpar</T>
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
                  <Pressable onPress={() => toggleCat(c.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34, paddingHorizontal: 7, borderRadius: 10, backgroundColor: on ? s.field : 'transparent' }}>
                    <Check on={on} />
                    <T s={12.5} w={600} lines={1} style={{ flex: 1 }}>{c.name}</T>
                    <View style={{ flexDirection: 'row', gap: 2 }}>{c.platforms.map(p => <PlatLogo key={p} plat={p} size={12} />)}</View>
                    {c.viewers ? <T s={10.5} w={700} c={s.muted}>{fmt(c.viewers)}</T> : null}
                  </Pressable>
                </View>
              );
            })}
            {list.length === 0 ? <T s={13} c={s.muted} style={{ padding: 10 }}>Nenhuma categoria ao vivo com esse nome.</T> : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

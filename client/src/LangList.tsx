import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLists, useStore } from './store';
import { FONT, LANGS, LANG_ORDER, matchLang } from './theme';
import { Check, T, WebSlop, spaceKey, useFocusRing, useSkin } from './ui';

/**
 * Checkboxes do filtro de línguas, com busca: compacto no painel da aba Ao vivo,
 * espaçoso na tela Idiomas.
 */
export function LangList({ compact, cols }: { compact?: boolean; cols: number }) {
  const s = useSkin();
  const langs = useStore(st => st.langs);
  const toggle = useStore(st => st.toggleLang);
  // a contagem por língua só faz sentido para a lista do usuário, que é conhecida inteira
  const following = useStore(st => st.view === 'following');
  const allLive = useLists().allLive.filter(() => following);
  const [q, setQ] = useState('');
  const ring = useFocusRing();
  const list = LANG_ORDER.filter(k => matchLang(k, q));

  const grid = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {list.map(k => {
        const on = langs.includes(k);
        const n = allLive.filter(x => x.effLang === k).length;
        return (
          <View key={k} style={{ width: `${100 / cols}%`, padding: 1 }}>
            <Pressable
              {...spaceKey(() => toggle(k))}
              onPress={() => toggle(k)}
              role="checkbox"
              aria-checked={on}
              aria-label={n ? `${LANGS[k]}, ${n} ao vivo` : LANGS[k]}
              style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 7 : 12, minHeight: compact ? 36 : 50, paddingHorizontal: compact ? 7 : 12, borderRadius: 10, backgroundColor: on ? s.field : 'transparent' }}>
              <Check on={on} size={compact ? 16 : 22} />
              {/* árabe e hebraico também à esquerda, junto do checkbox */}
              <T s={compact ? 12.5 : 15} w={600} lines={1} style={{ flex: 1, textAlign: 'left' }}>{LANGS[k]}</T>
              {n ? <T s={compact ? 10.5 : 12} w={700} c={s.muted}>{compact ? n : `${n} ao vivo`}</T> : null}
            </Pressable>
          </View>
        );
      })}
      {list.length === 0 ? <T s={13} c={s.muted} style={{ padding: 10 }}>Nenhuma língua com esse nome.</T> : null}
    </View>
  );

  return (
    <View style={{ gap: 6 }}>
      {/* com o foco no campo, o contorno vira um anel na cor de destaque */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: s.field, borderRadius: 10, paddingHorizontal: 10, boxShadow: `inset 0 1px 3px rgba(0,0,0,0.1), ${ring.focused ? `0 0 0 2px ${s.accent}` : `0 0 0 1px ${s.line}`}` }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          onFocus={ring.onFocus}
          onBlur={ring.onBlur}
          aria-label="Buscar língua"
          placeholder="Buscar língua"
          placeholderTextColor={s.muted}
          autoCorrect={false}
          style={[{ flex: 1, height: compact ? 34 : 42, color: s.ink, fontFamily: FONT[400], fontSize: compact ? 13 : 15 }, { outlineStyle: 'none' } as never]}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={12} role="button" aria-label="Limpar busca">
            <WebSlop n={12} />
            <T s={15} c={s.muted} decorative>×</T>
          </Pressable>
        ) : null}
      </View>
      {/* no painel, a lista rola dentro de uma altura fixa para não empurrar as lives para longe */}
      {compact ? <ScrollView style={{ maxHeight: 264 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">{grid}</ScrollView> : grid}
    </View>
  );
}

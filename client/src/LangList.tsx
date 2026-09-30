import { Pressable, View } from 'react-native';
import { useLists, useStore } from './store';
import { LANGS, LANG_ORDER } from './theme';
import { Check, T, useSkin } from './ui';

/** Checkboxes do filtro de línguas: compacto no painel da aba Ao vivo, espaçoso na tela Idiomas. */
export function LangList({ compact, cols }: { compact?: boolean; cols: number }) {
  const s = useSkin();
  const langs = useStore(st => st.langs);
  const toggle = useStore(st => st.toggleLang);
  // a contagem por língua só faz sentido para a lista do usuário, que é conhecida inteira
  const onlyFollowed = useStore(st => st.onlyFollowed);
  const allLive = useLists().allLive.filter(() => onlyFollowed);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {LANG_ORDER.map(k => {
        const on = langs.includes(k);
        const n = allLive.filter(x => x.effLang === k).length;
        return (
          <View key={k} style={{ width: `${100 / cols}%`, padding: 1 }}>
            <Pressable onPress={() => toggle(k)} style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 7 : 12, minHeight: compact ? 32 : 50, paddingHorizontal: compact ? 7 : 12, borderRadius: 10, backgroundColor: on ? s.field : 'transparent' }}>
              <Check on={on} size={compact ? 16 : 22} />
              <T s={compact ? 12.5 : 15} w={600} lines={1} style={{ flex: 1 }}>{LANGS[k]}</T>
              {n ? <T s={compact ? 10.5 : 12} w={700} c={s.muted}>{compact ? n : `${n} ao vivo`}</T> : null}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

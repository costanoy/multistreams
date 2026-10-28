import { useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View, ViewStyle } from 'react-native';
import { useWide } from './Shell';
import { useStore } from './store';
import { FONT, LANGS, LANG_ORDER, SH, matchLang } from './theme';
import { T, WebSlop, spaceKey, useFocusRing, useSkin } from './ui';

/** Atalhos vindos do filtro de línguas: com "Marcar todas" seriam 50. */
const MARKED = 5;

const nameOf = (k: string) => LANGS[k] ?? k.toUpperCase();

const chip: ViewStyle = { height: 32, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center' };
/** completa 44 pt de altura sem invadir o chip do lado */
const SLOP = { top: 6, bottom: 6, left: 3, right: 3 };
/**
 * A mesma folga na web, onde o hitSlop não vale (como o WebSlop, primeiro filho do Pressable). O WebSlop é igual
 * nos quatro lados: com 6, o vão de 6 entre dois chips iria todo para o de depois.
 */
const ChipSlop = () =>
  Platform.OS === 'web' ? <View aria-hidden style={{ position: 'absolute', top: -SLOP.top, bottom: -SLOP.bottom, left: -SLOP.left, right: -SLOP.right }} /> : null;

/**
 * Idioma de um streamer: atalhos com o atual (ou o detectado), o que a plataforma informou e as
 * línguas marcadas no filtro, mais "Outra…", que abre a lista completa com busca.
 */
export function LangPicker({ value, onPick, suggest }: { value: string; onPick: (k: string) => void; suggest?: string | null }) {
  const s = useSkin();
  const wide = useWide();
  const langs = useStore(st => st.langs);
  // os atalhos não mudam de lugar ao tocar: o primeiro é o de quando abriu, e os escolhidos na lista vão para o fim
  const [first] = useState(value);
  const [extra, setExtra] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ring = useFocusRing();

  const marked = LANG_ORDER.filter(k => langs.includes(k)).slice(0, MARKED);
  const chips = [...new Set([first, ...(suggest && LANGS[suggest] ? [suggest] : []), ...marked, ...extra, value])];
  const list = LANG_ORDER.filter(k => matchLang(k, q));
  const cols = wide ? 3 : 2;

  const pickFromList = (k: string) => {
    if (!chips.includes(k)) setExtra(e => [...e, k]);
    setOpen(false);
    setQ('');
    onPick(k);
  };

  return (
    <View style={{ gap: 8 }}>
      <View role="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {chips.map(k => {
          const on = k === value;
          return (
            <Pressable key={k} role="radio" aria-checked={on} aria-label={nameOf(k)} hitSlop={SLOP} {...spaceKey(() => onPick(k))} onPress={() => onPick(k)} style={[chip, { backgroundColor: on ? s.accent : s.field, boxShadow: on ? undefined : SH.ring(s.line) }]}>
              <ChipSlop />
              <T s={12.5} w={600} c={on ? s.accentInk : s.ink}>{nameOf(k)}</T>
            </Pressable>
          );
        })}
        <Pressable role="button" aria-label="Outra língua" aria-expanded={open} hitSlop={SLOP} onPress={() => setOpen(o => !o)} style={[chip, { backgroundColor: s.field, boxShadow: open ? `0 0 0 2px ${s.accent}` : SH.ring(s.line) }]}>
          <ChipSlop />
          <T s={12.5} w={600} c={s.dark ? s.ink : s.accent}>Outra…</T>
        </Pressable>
      </View>

      {open ? (
        <View style={{ gap: 6, padding: 6, borderRadius: 12, boxShadow: SH.ring(s.line) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: s.field, borderRadius: 10, paddingHorizontal: 10, boxShadow: `inset 0 1px 3px rgba(0,0,0,0.1), ${ring.focused ? `0 0 0 2px ${s.accent}` : `0 0 0 1px ${s.line}`}` }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Buscar língua"
              placeholderTextColor={s.muted}
              aria-label="Buscar língua"
              autoCapitalize="none"
              autoCorrect={false}
              // no computador o foco já vai para a busca; no celular, o teclado cobriria a lista
              autoFocus={wide}
              onFocus={ring.onFocus}
              onBlur={ring.onBlur}
              style={[{ flex: 1, height: 38, color: s.ink, fontFamily: FONT[400], fontSize: 14 }, { outlineStyle: 'none' } as never]}
            />
            {q ? (
              <Pressable role="button" aria-label="Limpar busca" hitSlop={12} onPress={() => setQ('')}>
                <WebSlop n={12} />
                <T s={15} c={s.muted} decorative>×</T>
              </Pressable>
            ) : null}
          </View>
          <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <View role="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {list.map(k => {
                const on = k === value;
                return (
                  <View key={k} style={{ width: `${100 / cols}%`, padding: 1 }}>
                    <Pressable role="radio" aria-checked={on} aria-label={LANGS[k]} {...spaceKey(() => pickFromList(k))} onPress={() => pickFromList(k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: on ? s.field : 'transparent' }}>
                      <T s={13.5} w={600} lines={1} style={{ flex: 1, textAlign: 'left' }}>{LANGS[k]}</T>
                      {on ? <T s={13} w={700} c={s.dark ? s.ink : s.accent} decorative>✓</T> : null}
                    </Pressable>
                  </View>
                );
              })}
              {!list.length ? <T s={13} c={s.muted} style={{ padding: 10 }}>Nenhuma língua com esse nome.</T> : null}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

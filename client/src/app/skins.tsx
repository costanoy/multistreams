import { Pressable, View } from 'react-native';

import { Screen, useWide } from '@/Shell';
import { useStore } from '@/store';
import { FONT, SKINS, SkinKey, grad } from '@/theme';
import { T, useSkin } from '@/ui';

const knob = 'inset 0 1px 1px rgba(255,255,255,0.8), inset 0 -2px 3px rgba(0,0,0,0.3)';

export default function Skins() {
  const s = useSkin();
  const wide = useWide();
  const current = useStore(st => st.skin);
  return (
    <Screen>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12 }}>
          {(Object.keys(SKINS) as SkinKey[]).map(k => {
            const x = SKINS[k];
            const sel = k === current;
            return (
              <Pressable key={k} onPress={() => useStore.setState({ skin: k })} style={{ flex: wide ? 1 : undefined, gap: 8 }}>
                <View style={{ borderRadius: 18, boxShadow: sel ? `0 0 0 3px ${s.accent}, 0 6px 16px rgba(0,0,0,0.18)` : `0 0 0 1px ${s.line}, 0 3px 10px rgba(0,0,0,0.12)` }}>
                  <View style={{ borderRadius: 18, overflow: 'hidden' }}>
                    <View style={[grad(x.frame, x.frameTop), { height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }]}>
                      <View style={[grad(x.btn, x.btnFlat), { width: 22, height: 22, borderRadius: 11, boxShadow: knob }]} />
                      <View style={[grad(x.btn, x.btnFlat), { width: 22, height: 22, borderRadius: 11, boxShadow: knob }]} />
                      <View style={{ flex: 1 }} />
                      <View style={[grad(x.lcdBg, x.lcdFlat), { borderRadius: 5, paddingVertical: 4, paddingHorizontal: 6 }]}>
                        <T s={11} c={x.lcdFg} glow={x.lcdGlow} style={{ fontFamily: FONT.lcd }}>12.4K</T>
                      </View>
                    </View>
                    <View style={{ backgroundColor: x.panel, paddingVertical: 10, paddingHorizontal: 12, gap: 6 }}>
                      <View style={{ height: 12, borderRadius: 4, backgroundColor: x.card, width: '80%' }} />
                      <View style={{ height: 12, borderRadius: 4, backgroundColor: x.card, width: '60%' }} />
                    </View>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
                  <T s={14} w={700}>{x.name}</T>
                  {sel ? (
                    <View style={{ paddingVertical: 3, paddingHorizontal: 6, borderRadius: 5, backgroundColor: s.accent }}>
                      <T s={10} w={700} ls={0.1} c={s.accentInk}>EM USO</T>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <T s={12.5} c={s.muted}>Mais skins chegam com o plano pago.</T>
      </View>
    </Screen>
  );
}

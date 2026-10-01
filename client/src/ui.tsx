import { ReactNode, useEffect } from 'react';
import { Image, Platform, Pressable, StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { play } from './sounds';
import { useStore } from './store';
import { FONT, Plat, SH, SKINS, Skin, grad, hueOf } from './theme';

export const useSkin = (): Skin => SKINS[useStore(s => s.skin)] ?? SKINS.prata;

interface TProps {
  children: ReactNode;
  /** tamanho */ s?: number;
  /** peso (Chakra Petch) */ w?: 400 | 500 | 600 | 700;
  /** cor */ c?: string;
  font?: 'brand' | 'lcd' | 'mono';
  /** letter-spacing em em */ ls?: number;
  /** line-height como multiplicador */ lh?: number;
  center?: boolean;
  lines?: number;
  /** brilho de LCD */ glow?: string;
  style?: StyleProp<TextStyle>;
}

export function T({ children, s = 15, w = 400, c, font, ls, lh, center, lines, glow, style }: TProps) {
  const skin = useSkin();
  return (
    <Text
      numberOfLines={lines}
      style={[
        { fontSize: s, color: c ?? skin.ink, fontFamily: font ? FONT[font] : FONT[w] },
        ls ? { letterSpacing: ls * s } : null,
        lh ? { lineHeight: lh * s } : null,
        center ? { textAlign: 'center' } : null,
        lines ? { flexShrink: 1 } : null,
        glow ? { textShadowColor: glow, textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } } : null,
        style,
      ]}>
      {children}
    </Text>
  );
}

/** Texto em fonte de segmentos com brilho, como o contador do Winamp. */
export const LcdText = ({ children, s = 15, c, glow }: { children: string; s?: number; c?: string; glow?: string }) => {
  const skin = useSkin();
  // a DSEG não tem largura de espaço: cada palavra vira um bloco
  return (
    <View style={{ flexDirection: 'row', gap: s * 0.55 }}>
      {children.split(' ').map((word, i) => (
        <T key={i} font="lcd" s={s} c={c ?? skin.lcdFg} glow={glow ?? (c ? undefined : skin.lcdGlow)}>{word}</T>
      ))}
    </View>
  );
};

export function Lcd({ children, style, r = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; r?: number }) {
  const skin = useSkin();
  return <View style={[grad(skin.lcdBg, skin.lcdFlat), { borderRadius: r, boxShadow: SH.lcd }, style]}>{children}</View>;
}

function Bar({ w, color, duration, delay }: { w: number; color: string; duration: number; delay: number }) {
  const v = useSharedValue(0.2);
  useEffect(() => {
    v.set(withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }), -1, true)));
  }, [v, duration, delay]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleY: v.get() }] }));
  return <Animated.View style={[{ width: w, height: '100%', backgroundColor: color, transformOrigin: 'bottom' }, anim]} />;
}

const EQ = [[700, 0], [900, 300], [600, 100], [800, 450], [750, 200]];

/** Equalizador pulsando: o indicador de "ao vivo". `still` = apagado (estado vazio). */
export function Eq({ color, h = 12, w = 3, bars = 3, gap = 2, still }: { color: string; h?: number; w?: number; bars?: number; gap?: number; still?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap, height: h, flexShrink: 0 }}>
      {EQ.slice(0, bars).map(([duration, delay], i) =>
        still ? <View key={i} style={{ width: w, height: 4, backgroundColor: color, opacity: 0.5 }} /> : <Bar key={i} w={w} color={color} duration={duration} delay={delay} />,
      )}
    </View>
  );
}

/** Pastilha da plataforma: letra ("T") ou nome ("Twitch"). */
const TWITCH_GLITCH = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z';
/** K em blocos, no estilo da marca da Kick */
const KICK_K = 'M5 5h4.5v14H5z M9.5 10.25h3.25v3.5H9.5z M12.75 7.5h3v3h-3z M15.75 5H19v2.5h-3.25z M12.75 13.5h3v3h-3z M15.75 16.5H19V19h-3.25z';

/** Logo da plataforma, em ladrilho, para ficar ao lado do nome do streamer. */
export function PlatLogo({ plat, size = 16 }: { plat: Plat; size?: number }) {
  const r = 5.5;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      {plat === 'twitch' ? (
        <>
          <Rect width={24} height={24} rx={r} fill="#9146ff" />
          <G transform="translate(4.5 4.5) scale(0.625)">
            <Path d={TWITCH_GLITCH} fill="#fff" />
          </G>
        </>
      ) : plat === 'youtube' ? (
        <>
          <Rect y={3.5} width={24} height={17} rx={r} fill="#ff0000" />
          <Path d="M9.6 8.2v7.6l6.4-3.8z" fill="#fff" />
        </>
      ) : (
        <>
          <Rect width={24} height={24} rx={r} fill="#0b0b0b" />
          <Path d={KICK_K} fill="#53fc18" />
        </>
      )}
    </Svg>
  );
}

/** Marca da plataforma ao lado do nome (logo). */
export function PlatChip({ plat, size = 16 }: { plat: Plat; size?: number; full?: boolean }) {
  return <PlatLogo plat={plat} size={size} />;
}

export function Avatar({ uri, name, size, gray }: { uri: string | null; name: string; size: number; gray?: number }) {
  const dim = gray ? { filter: `grayscale(${gray})`, opacity: Platform.OS === 'ios' ? 0.7 : 1 } : null;
  const base = { width: size, height: size, borderRadius: size / 2, flexShrink: 0 };
  if (uri) return <Image source={{ uri }} style={[base, { backgroundColor: '#8a8f98' }, dim as never]} />;
  return (
    <View style={[base, { backgroundColor: `hsl(${hueOf(name)}, 45%, 42%)`, alignItems: 'center', justifyContent: 'center' }, dim as never]}>
      <T s={size * 0.38} w={700} c="#fff">{name.replace('@', '').charAt(0).toUpperCase()}</T>
    </View>
  );
}

/** Thumbnail 16:9 da live: a "tela" dentro da moldura. */
export function Thumb({ uri, width, r, shadow, children }: { uri: string | null; width?: number; r: number; shadow: string; children?: ReactNode }) {
  return (
    <View style={{ width: width ?? '100%', aspectRatio: 16 / 9, borderRadius: r, flexShrink: 0, boxShadow: shadow, backgroundColor: '#1b1d22' }}>
      <View style={{ flex: 1, borderRadius: r, overflow: 'hidden' }}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
        <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, grad('linear-gradient(160deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%)', 'transparent')]} />
        {children}
      </View>
    </View>
  );
}

interface BtnProps {
  label: string;
  onPress?: () => void;
  /** chrome = botão cromado · accent = cor da skin · outline = borda fina */
  kind?: 'chrome' | 'accent' | 'outline';
  h?: number;
  fs?: number;
  px?: number;
  /** cor sólida (ex.: cor da plataforma) */
  color?: string;
  ink?: string;
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Btn({ label, onPress, kind = 'chrome', h = 48, fs, px, color, ink, flat, style }: BtnProps) {
  const s = useSkin();
  const small = h <= 36;
  const look: ViewStyle =
    color ? { backgroundColor: color, boxShadow: flat || small ? undefined : SH.color }
    : kind === 'accent' ? { backgroundColor: s.accent, boxShadow: flat || small ? undefined : SH.color }
    : kind === 'outline' ? { backgroundColor: s.card, borderWidth: 1, borderColor: s.line }
    : { ...grad(s.btn, s.btnFlat), boxShadow: small ? 'inset 0 2px 1px rgba(255,255,255,0.8), inset 0 -2px 4px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.2)' : SH.chrome };
  const textColor = ink ?? (color ? '#fff' : kind === 'accent' ? s.accentInk : kind === 'outline' ? s.ink : s.btnInk);
  return (
    <Pressable
      onPress={onPress && (() => { play('tap'); onPress(); })}
      style={({ pressed }) => [{ height: h, borderRadius: 999, paddingHorizontal: px ?? (small ? 14 : 20), alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: pressed ? 0.85 : 1 }, look, style]}>
      <T s={fs ?? (small ? 12.5 : 15)} w={600} c={textColor} lines={1}>{label}</T>
    </Pressable>
  );
}

export function Card({ children, r = 16, style, onPress }: { children: ReactNode; r?: number; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const s = useSkin();
  const base: ViewStyle = { backgroundColor: s.card, borderRadius: r, boxShadow: SH.ring(s.line) };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={(st: { pressed: boolean; hovered?: boolean }) => [base, style, st.hovered ? { boxShadow: '0 0 0 1px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.1)' } : null, st.pressed ? { opacity: 0.85 } : null]}>
      {children}
    </Pressable>
  );
}

/** Painel com a moldura cromada da skin. */
export function Chrome({ children, r = 22, shadow = SH.frame, style }: { children: ReactNode; r?: number; shadow?: string; style?: StyleProp<ViewStyle> }) {
  const s = useSkin();
  return <View style={[grad(s.frame, s.frameTop), { borderRadius: r, boxShadow: shadow }, style]}>{children}</View>;
}

export function Switch({ on, onPress, small }: { on: boolean; onPress: () => void; small?: boolean }) {
  const s = useSkin();
  const w = small ? 46 : 52, h = small ? 27 : 30, knob = h - 6;
  const x = useSharedValue(on ? w - knob - 3 : 3);
  useEffect(() => {
    x.set(withTiming(on ? w - knob - 3 : 3, { duration: 180 }));
  }, [on, x, w, knob]);
  const anim = useAnimatedStyle(() => ({ left: x.get() }));
  return (
    <Pressable onPress={() => { play(on ? 'off' : 'on'); onPress(); }} hitSlop={8} style={{ width: w, height: h, borderRadius: 999, backgroundColor: on ? s.swOn : s.swOff, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.35)', flexShrink: 0 }}>
      <Animated.View style={[{ position: 'absolute', top: 3, width: knob, height: knob, borderRadius: knob / 2, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), 0 1px 3px rgba(0,0,0,0.4)' }, grad(s.btn, s.btnFlat), anim]} />
    </Pressable>
  );
}

export function Check({ on, size = 16, dim }: { on: boolean; size?: number; dim?: boolean }) {
  const s = useSkin();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: dim ? s.line : on ? s.accent : 'transparent', borderWidth: on || dim ? 0 : 1.5, borderColor: s.muted, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {on || dim ? <T s={size * 0.62} w={700} c={dim ? s.muted : s.accentInk}>✓</T> : null}
    </View>
  );
}

/** Chips de escolha única (idioma do streamer). */
export function Chips<K extends string>({ options, value, onPick }: { options: { key: K; label: string }[]; value: K; onPick: (k: K) => void }) {
  const s = useSkin();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onPick(o.key)} style={{ height: 32, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? s.accent : s.field, boxShadow: on ? undefined : SH.ring(s.line) }}>
            <T s={12.5} w={600} c={on ? s.accentInk : s.ink}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Entrada de baixo para cima (cards, painéis). */
export function Rise({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(withTiming(1, { duration: 250, easing: Easing.out(Easing.ease) }));
  }, [v]);
  const anim = useAnimatedStyle(() => ({ opacity: v.get(), transform: [{ translateY: (1 - v.get()) * 30 }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

export const Label = ({ children }: { children: ReactNode }) => {
  const s = useSkin();
  return <T s={12} w={700} ls={0.14} c={s.muted}>{children}</T>;
};

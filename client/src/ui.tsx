import { ReactNode, useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleProp, Text, TextStyle, View, ViewProps, ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, css, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { play } from './sounds';
import { useStore } from './store';
import { FONT, Plat, SH, SKINS, Skin, grad, hoverShadow, hueOf } from './theme';

export const useSkin = (): Skin => SKINS[useStore(s => s.skin)] ?? SKINS.prata;

/**
 * Na web, o react-native-web só transforma o Espaço em clique num role="button": em checkbox, switch e radio
 * (cuja tecla é o Espaço) ele não faz nada e ainda rola a página. Espalhe isto no Pressable desses papéis.
 */
export const spaceKey = (fn: () => void, disabled?: boolean) =>
  Platform.OS === 'web'
    ? ({
        onKeyDown: (e: { key: string; repeat?: boolean; target: unknown; currentTarget: unknown; preventDefault: () => void }) => {
          if (e.key !== ' ' || e.target !== e.currentTarget) return;
          e.preventDefault();
          if (!e.repeat && !disabled) fn();
        },
      } as object)
    : null;

/**
 * Na web, o react-native-web ignora o hitSlop: como primeiro filho do Pressable, esta camada transparente estende a
 * área de toque em `n` px para cada lado (o clique nela sobe para o Pressable). Fica por baixo dos irmãos que vêm
 * depois e é cortada por um pai com overflow hidden. No nativo não desenha nada: lá vale o hitSlop.
 */
export function WebSlop({ n }: { n?: number }) {
  if (Platform.OS !== 'web' || !n) return null;
  return <View aria-hidden style={{ position: 'absolute', top: -n, left: -n, right: -n, bottom: -n }} />;
}

interface TProps {
  children: ReactNode;
  /** tamanho */ s?: number;
  /** peso (Chakra Petch) */ w?: 400 | 600 | 700;
  /** cor */ c?: string;
  font?: 'brand' | 'lcd' | 'mono';
  /** letter-spacing em em */ ls?: number;
  /** line-height como multiplicador */ lh?: number;
  center?: boolean;
  lines?: number;
  /** brilho de LCD */ glow?: string;
  /** título da página: vira <h1>/<h2> no site (bom para leitores de tela e buscadores) */ heading?: 1 | 2;
  /** teto da ampliação pela fonte do sistema (1.3 = até 130%) */ maxScale?: number;
  /** enfeite (seta, glifo): fica fora do leitor de tela */ decorative?: boolean;
  style?: StyleProp<TextStyle>;
}

export function T({ children, s = 15, w = 400, c, font, ls, lh, center, lines, glow, heading, maxScale, decorative, style }: TProps) {
  const skin = useSkin();
  return (
    <Text
      {...(heading ? ({ role: 'heading', 'aria-level': heading } as object) : null)}
      aria-hidden={decorative || undefined}
      maxFontSizeMultiplier={maxScale}
      numberOfLines={lines}
      style={[
        { fontSize: s, color: c ?? skin.ink, fontFamily: font ? FONT[font] : FONT[w] },
        ls ? { letterSpacing: ls * s } : null,
        lh ? { lineHeight: lh * s } : null,
        center ? { textAlign: 'center' } : null,
        lines ? { flexShrink: 1 } : null,
        // na web, o textShadow em texto (o react-native-web avisa que os textShadow* saíram de uso)
        glow ? (Platform.OS === 'web' ? ({ textShadow: `0 0 6px ${glow}` } as never) : { textShadowColor: glow, textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } }) : null,
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

/** `decorative`: o que está no LCD já é dito em outro lugar (ex.: no rótulo da linha). */
export function Lcd({ children, style, r = 8, decorative }: { children: ReactNode; style?: StyleProp<ViewStyle>; r?: number; decorative?: boolean }) {
  const skin = useSkin();
  return <View aria-hidden={decorative || undefined} style={[grad(skin.lcdBg, skin.lcdFlat), { borderRadius: r, boxShadow: SH.lcd }, style]}>{children}</View>;
}

type BarProps = { w: number; color: string; duration: number; delay: number; level: number; active: boolean };
const barBase = (w: number, color: string): ViewStyle => ({ width: w, height: '100%', backgroundColor: color, transformOrigin: 'bottom' });

/** No app, a barra pulsa com valor compartilhado; parada, a animação é cancelada. */
function Bar({ w, color, duration, delay, level, active }: BarProps) {
  const v = useSharedValue(active ? 0.2 : level);
  useEffect(() => {
    if (!active) {
      cancelAnimation(v);
      v.set(level);
      return;
    }
    // recomeça de baixo: partindo do nível parado, o vai e vem não teria amplitude
    v.set(0.2);
    v.set(withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }), -1, true)));
    return () => cancelAnimation(v);
  }, [v, duration, delay, level, active]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleY: v.get() }] }));
  return <Animated.View style={[barBase(w, color), anim]} />;
}

/** Na web, animação CSS: o navegador anima sozinho, sem um quadro de JS por barra. */
const PULSE = Platform.OS === 'web' ? css.keyframes({ from: { transform: [{ scaleY: 0.2 }] }, to: { transform: [{ scaleY: 1 }] } }) : null;

function CssBar({ w, color, duration, delay, level, active }: BarProps) {
  return (
    <Animated.View
      style={[
        barBase(w, color),
        // atraso negativo: cada barra já começa no meio do ciclo, como na handoff
        active && PULSE
          ? { animationName: PULSE, animationDuration: duration, animationDelay: -delay, animationIterationCount: 'infinite', animationDirection: 'alternate', animationTimingFunction: 'ease-in-out' }
          : { transform: [{ scaleY: level }] },
      ]}
    />
  );
}

const EqBar = Platform.OS === 'web' ? CssBar : Bar;

/** [duração, atraso, altura parada] de cada barra */
const EQ = [[700, 0, 0.55], [900, 300, 1], [600, 100, 0.75], [800, 450, 0.45], [750, 200, 0.9]];

/**
 * Equalizador pulsando: o indicador de "ao vivo". `still` = apagado (estado vazio).
 * `active={false}` = parado mas aceso (ex.: linha fora da tela), sem animação rodando.
 */
export function Eq({ color, h = 12, w = 3, bars = 3, gap = 2, still, active = true }: { color: string; h?: number; w?: number; bars?: number; gap?: number; still?: boolean; active?: boolean }) {
  // com "reduzir movimento" ligado no sistema, as barras ficam paradas
  const reduce = useReducedMotion();
  return (
    <View aria-hidden style={{ flexDirection: 'row', alignItems: 'flex-end', gap, height: h, flexShrink: 0 }}>
      {EQ.slice(0, bars).map(([duration, delay, level], i) =>
        still ? <View key={i} style={{ width: w, height: 4, backgroundColor: color, opacity: 0.5 }} /> : <EqBar key={i} w={w} color={color} duration={duration} delay={delay} level={level} active={active && !reduce} />,
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

/** No Android, decodifica a imagem no tamanho da view (sem isso, a foto remota é decodificada inteira). */
const RESIZE = Platform.OS === 'android' ? 'resize' : undefined;

/** A Twitch manda a foto em 300x300: pede a menor que ainda fica nítida no tamanho exibido. */
const twitchSized = (uri: string, size: number) =>
  uri.includes('static-cdn.jtvnw.net/') && uri.includes('-300x300.')
    ? uri.replace('-300x300.', size <= 24 ? '-70x70.' : size <= 50 ? '-150x150.' : '-300x300.')
    : uri;

/** Foto do streamer sobre a inicial colorida: carregando ou se a foto falhar, fica a inicial. */
export function Avatar({ uri, name, size, gray }: { uri: string | null; name: string; size: number; gray?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const dim = gray ? { filter: `grayscale(${gray})`, opacity: Platform.OS === 'ios' ? 0.7 : 1 } : null;
  const sized = uri ? twitchSized(uri, size) : null;
  // a foto menor falhou: tenta a original; se esta também falhar, fica a inicial (uma uri nova tenta de novo)
  const src = !uri || failed === uri ? null : failed === sized ? uri : sized;
  // foto carregada: sai a inicial, que apareceria pelas fotos de fundo transparente (atrás fica o cinza de antes)
  const shown = !!src && loaded === src;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, flexShrink: 0, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: shown ? '#8a8f98' : `hsl(${hueOf(name)}, 45%, 42%)` }, dim as never]}>
      {shown ? null : <T s={size * 0.38} w={700} c="#fff" decorative>{name.replace('@', '').charAt(0).toUpperCase()}</T>}
      {src ? (
        <Image
          source={{ uri: src }}
          resizeMethod={RESIZE}
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, borderRadius: size / 2 }}
        />
      ) : null}
    </View>
  );
}

/** Thumbnail 16:9 da live: a "tela" dentro da moldura. */
export function Thumb({ uri, width, r, shadow, children }: { uri: string | null; width?: number; r: number; shadow: string; children?: ReactNode }) {
  return (
    <View style={{ width: width ?? '100%', aspectRatio: 16 / 9, borderRadius: r, flexShrink: 0, boxShadow: shadow, backgroundColor: '#1b1d22' }}>
      <View style={{ flex: 1, borderRadius: r, overflow: 'hidden' }}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" resizeMethod={RESIZE} /> : null}
        <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, grad('linear-gradient(160deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%)', 'transparent')]} />
        {children}
      </View>
    </View>
  );
}

interface BtnProps {
  label: string;
  onPress?: () => void;
  /** não responde ao toque (padrão: sem onPress); sem `color`, fica com o visual de "Já está na lista" */
  disabled?: boolean;
  /** chrome = botão cromado · accent = cor da skin · outline = borda fina */
  kind?: 'chrome' | 'accent' | 'outline';
  h?: number;
  fs?: number;
  px?: number;
  /** cor sólida (ex.: cor da plataforma) */
  color?: string;
  ink?: string;
  flat?: boolean;
  /** área de toque além do desenho; o padrão completa 44 pt de altura */
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
}

export function Btn({ label, onPress, disabled = !onPress, kind = 'chrome', h = 48, fs, px, color, ink, flat, hitSlop, style }: BtnProps) {
  const s = useSkin();
  const small = h <= 36;
  const look: ViewStyle =
    color ? { backgroundColor: color, boxShadow: flat || small ? undefined : SH.color }
    : disabled ? { backgroundColor: s.field, boxShadow: SH.ring(s.line) }
    : kind === 'accent' ? { backgroundColor: s.accent, boxShadow: flat || small ? undefined : SH.color }
    : kind === 'outline' ? { backgroundColor: s.card, borderWidth: 1, borderColor: s.line }
    : { ...grad(s.btn, s.btnFlat), boxShadow: small ? 'inset 0 2px 1px rgba(255,255,255,0.8), inset 0 -2px 4px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.2)' : SH.chrome };
  const textColor = disabled && !color ? s.muted : ink ?? (color ? '#fff' : kind === 'accent' ? s.accentInk : kind === 'outline' ? s.ink : s.btnInk);
  const slop = hitSlop ?? Math.max(0, Math.ceil((44 - h) / 2));
  return (
    <Pressable
      role="button"
      aria-label={label}
      disabled={disabled}
      hitSlop={slop}
      onPress={disabled || !onPress ? undefined : () => { play('tap'); onPress(); }}
      style={({ pressed }) => [{ height: h, borderRadius: 999, paddingHorizontal: px ?? (small ? 14 : 20), alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: pressed ? 0.85 : 1 }, look, style]}>
      {/* desativado, o botão engoliria o toque ao lado: fica sem folga */}
      <WebSlop n={disabled ? 0 : slop} />
      <T s={fs ?? (small ? 12.5 : 15)} w={600} c={textColor} lines={1}>{label}</T>
    </Pressable>
  );
}

/** Papel e nome para leitor de tela, repassados ao card (ex.: linha clicável com role="link"). */
type CardA11y = Pick<ViewProps, 'role' | 'aria-label' | 'accessibilityActions' | 'onAccessibilityAction'>;

export function Card({ children, r = 16, style, onPress, ...a11y }: { children: ReactNode; r?: number; style?: StyleProp<ViewStyle>; onPress?: () => void } & CardA11y) {
  const s = useSkin();
  const base: ViewStyle = { backgroundColor: s.card, borderRadius: r, boxShadow: SH.ring(s.line) };
  if (!onPress) return <View {...a11y} style={[base, style]}>{children}</View>;
  return (
    <Pressable
      {...a11y}
      onPress={onPress}
      style={(st: { pressed: boolean; hovered?: boolean }) => [base, style, st.hovered ? { boxShadow: hoverShadow(s) } : null, st.pressed ? { opacity: 0.85 } : null]}>
      {children}
    </Pressable>
  );
}

/** Painel com a moldura cromada da skin. */
export function Chrome({ children, r = 22, shadow = SH.frame, style }: { children: ReactNode; r?: number; shadow?: string; style?: StyleProp<ViewStyle> }) {
  const s = useSkin();
  return <View style={[grad(s.frame, s.frameTop), { borderRadius: r, boxShadow: shadow }, style]}>{children}</View>;
}

/** `disabled`: não toca som nem chama onPress; o visual não muda (quem usa decide se esmaece). */
export function Switch({ on, onPress, small, disabled, label }: { on: boolean; onPress: () => void; small?: boolean; disabled?: boolean; label?: string }) {
  const s = useSkin();
  const w = small ? 46 : 52, h = small ? 27 : 30, knob = h - 6;
  const x = useSharedValue(on ? w - knob - 3 : 3);
  useEffect(() => {
    x.set(withTiming(on ? w - knob - 3 : 3, { duration: 180 }));
  }, [on, x, w, knob]);
  const anim = useAnimatedStyle(() => ({ left: x.get() }));
  const press = () => {
    play(on ? 'off' : 'on');
    onPress();
  };
  return (
    <Pressable
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      {...spaceKey(press, disabled)}
      onPress={press}
      hitSlop={8}
      style={{ width: w, height: h, borderRadius: 999, backgroundColor: on ? s.swOn : s.swOff, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.35)', flexShrink: 0 }}>
      <WebSlop n={disabled ? 0 : 8} />
      <Animated.View style={[{ position: 'absolute', top: 3, width: knob, height: knob, borderRadius: knob / 2, boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), 0 1px 3px rgba(0,0,0,0.4)' }, grad(s.btn, s.btnFlat), anim]} />
    </Pressable>
  );
}

/** Só o desenho: o papel de checkbox e o estado ficam na linha que recebe o toque. */
export function Check({ on, size = 16, dim }: { on: boolean; size?: number; dim?: boolean }) {
  const s = useSkin();
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: dim ? s.line : on ? s.accent : 'transparent', borderWidth: on || dim ? 0 : 1.5, borderColor: s.muted, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {on || dim ? <T s={size * 0.62} w={700} c={dim ? s.muted : s.accentInk}>✓</T> : null}
    </View>
  );
}

/** Chips de escolha única (idioma do streamer). */
export function Chips<K extends string>({ options, value, onPick }: { options: { key: K; label: string }[]; value: K; onPick: (k: K) => void }) {
  const s = useSkin();
  return (
    <View role="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} role="radio" aria-checked={on} {...spaceKey(() => onPick(o.key))} onPress={() => onPick(o.key)} style={{ height: 32, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? s.accent : s.field, boxShadow: on ? undefined : SH.ring(s.line) }}>
            <T s={12.5} w={600} c={on ? s.accentInk : s.ink}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Controle segmentado na canaleta cromada (modos de Ao vivo, plataforma em Adicionar).
 * No Preto fosco, o selecionado ganha um anel fino na cor de destaque para não sumir na moldura.
 */
export function Segmented<K extends string>({ options, value, onPick, fs = 13, flexOf }: {
  options: { key: K; label: string; a11y?: string }[];
  value: K;
  onPick: (k: K) => void;
  fs?: number;
  /** flex de cada segmento (padrão 1) */
  flexOf?: (k: K) => number;
}) {
  const s = useSkin();
  return (
    <Chrome r={12} shadow="inset 0 1px 3px rgba(0,0,0,0.25)" style={{ padding: 3 }}>
      <View role="tablist" style={{ flexDirection: 'row', gap: 3 }}>
        {options.map(o => {
          const on = o.key === value;
          return (
            <Pressable
              key={o.key}
              role="tab"
              aria-selected={on}
              aria-label={o.a11y ?? o.label}
              onPress={() => { play('tap'); onPick(o.key); }}
              style={{
                flex: flexOf ? flexOf(o.key) : 1, height: 34, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? (s.dark ? s.field : s.card) : 'transparent',
                boxShadow: on ? (s.dark ? `0 0 0 1px ${s.accent}66, 0 1px 3px rgba(0,0,0,0.4)` : '0 1px 3px rgba(0,0,0,0.2)') : undefined,
              }}>
              <T s={fs} w={on ? 700 : 600} c={on ? s.ink : s.frameMuted} lines={1} maxScale={1.3}>{o.label}</T>
            </Pressable>
          );
        })}
      </View>
    </Chrome>
  );
}

/** Foco do campo de texto, para trocar o contorno por um anel na cor de destaque. */
export function useFocusRing() {
  const [focused, setFocused] = useState(false);
  return { focused, onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
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

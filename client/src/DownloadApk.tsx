import { Platform, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { play } from './sounds';
import { SH, grad } from './theme';
import { T, useSkin } from './ui';

/** Caminho do APK no site (o arquivo fica na raiz da hospedagem, ao lado do index.html). */
export const APK_URL = '/multistreams.apk';

const download = () => {
  play('tap');
  window.location.href = APK_URL;
};

/** Robozinho do Android, para o botão de download. */
const AndroidIcon = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      fill={color}
      d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"
    />
  </Svg>
);

/** iPhone, iPad ou iPod (o iPad novo se apresenta como Mac, mas tem tela de toque): o APK não instala lá. */
const apple = () =>
  typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/**
 * Botão "Baixar para Android": só aparece no site (no app instalado não faz sentido), e não no iPhone nem no iPad.
 * `variant`: "sidebar" (menu da web larga), "card" (Ajustes) ou "onboarding".
 */
export function DownloadApk({ variant }: { variant: 'sidebar' | 'card' | 'onboarding' }) {
  const s = useSkin();
  if (Platform.OS !== 'web' || apple()) return null;

  if (variant === 'card') {
    return (
      <Pressable role="button" aria-label="Baixar o app para Android (APK)" onPress={download} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: s.card, boxShadow: SH.ring(s.line) }}>
          <View style={[grad(s.lcdBg, s.lcdFlat), { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', boxShadow: SH.lcd }]}>
            <AndroidIcon size={26} color={s.lcdFg} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T s={15} w={700}>App para Android</T>
            <T s={12.5} c={s.muted}>Baixe o APK e instale no celular.</T>
          </View>
          <View style={{ height: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: s.accent, justifyContent: 'center' }}>
            <T s={12.5} w={600} c={s.accentInk}>Baixar</T>
          </View>
        </View>
      </Pressable>
    );
  }

  const big = variant === 'onboarding';
  return (
    <Pressable
      role="button"
      aria-label="Baixar o app para Android (APK)"
      onPress={download}
      style={({ pressed }) => [
        grad(s.lcdBg, s.lcdFlat),
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: big ? 50 : 44, borderRadius: big ? 999 : 12, paddingHorizontal: 14, boxShadow: SH.lcd, opacity: pressed ? 0.85 : 1 },
      ]}>
      <AndroidIcon size={big ? 22 : 18} color={s.lcdFg} />
      <T s={big ? 15 : 13} w={600} c={s.lcdFg} glow={s.lcdGlow}>Baixar para Android</T>
    </Pressable>
  );
}
